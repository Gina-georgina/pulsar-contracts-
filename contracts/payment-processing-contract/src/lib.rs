// SPDX-License-Identifier: MIT

#![no_std]

extern crate alloc;

#[cfg(feature = "scaffold")]
mod archival;
#[cfg(feature = "scaffold")]
mod audit;
#[cfg(feature = "scaffold")]
mod webhook;
mod error;
mod helper;
#[cfg(feature = "scaffold")]
mod request_validation;
mod response_formatting;
mod storage;
mod types;

#[cfg(test)]
mod repro_tests;
#[cfg(test)]
mod prop_tests;
#[cfg(test)]
mod payer_payment_history_tests;

use alloc::vec::Vec as RustVec;
use soroban_sdk::{
    contract, contractimpl, token, xdr::ToXdr, Address, Bytes, BytesN, Env, String, Vec,
};

use error::PaymentError;
use storage::{REFUND_GRACE_BUFFER, REFUND_WINDOW};
use types::{
    DataKey, GlobalStats, Merchant, MerchantCategory, MerchantStats, MultisigPayment,
    PaymentFilter, PaymentOrder, PaymentPage, PaymentReceipt, PaymentRecord, PaymentStatus,
    RefundRecord, RefundStatus, SortField, SortOrder,
};

/// Maximum number of subscriptions a single merchant may accumulate (SC-042).
///
/// Bounds the size of `DataKey::MerchantSubscriptions` so that
/// `list_subscriptions_by_merchant` cannot scan an unbounded list and exceed
/// Soroban CPU/memory limits.
pub const MAX_SUBSCRIPTIONS_PER_MERCHANT: u32 = 10_000;

#[contract]
pub struct PaymentContract;

#[contractimpl]
impl PaymentContract {
    // ── Admin ─────────────────────────────────────────────────────────────────

    /// One-time admin initialisation. Stores the first admin address.
    pub fn set_admin(env: Env, admins: Vec<Address>, threshold: u32) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        if storage::get_admin_config(&env).is_some() || storage::get_admin(&env).is_some() {
            return Err(PaymentError::AdminAlreadySet);
        }
        if admins.is_empty() {
            return Err(PaymentError::InvalidInput);
        }
        let first = admins.get(0).unwrap();
        helper::validate_admin_address(&env, &first)?;
        first.require_auth();
        storage::set_admin(&env, &first);
        storage::set_admin_config(&env, &types::AdminConfig { admins, threshold });
        storage::set_contract_version(&env, 1);
        env.events()
            .publish((DataKey::Admin,), (String::from_str(&env, "admin_set"), first));
        Ok(())
    }

    /// Transfer admin authority to a new address (two-step handoff).
    ///
    /// Both the current admin and the new admin must authorise this call,
    /// ensuring the new admin key is live and in possession of the caller.
    ///
    /// # Parameters
    /// - `current_admin` — The existing admin address; must be authenticated
    ///   and must match the stored admin.
    /// - `new_admin` — The incoming admin address; must also authenticate,
    ///   proving key possession before the transfer is committed.
    ///
    /// # Events
    /// Emits `admin_transferred` with payload `(current_admin, new_admin)`.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if `current_admin` is not the stored admin.
    /// - [`PaymentError::InvalidInput`] if `new_admin` is the zero/burn address.
    pub fn transfer_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        // Require auth from both parties — proves the new key is live.
        current_admin.require_auth();
        new_admin.require_auth();
        helper::validate_admin_address(&env, &new_admin)?;
        // Verify current_admin is actually the stored admin.
        let stored = storage::get_admin(&env).ok_or(PaymentError::Unauthorized)?;
        if stored != current_admin {
            return Err(PaymentError::Unauthorized);
        }
        // Update single-admin storage.
        storage::set_admin(&env, &new_admin);
        // If a multi-admin config exists, replace the old admin entry with the new one.
        if let Some(mut config) = storage::get_admin_config(&env) {
            let mut new_admins = Vec::new(&env);
            for addr in config.admins.iter() {
                if addr == current_admin {
                    new_admins.push_back(new_admin.clone());
                } else {
                    new_admins.push_back(addr);
                }
            }
            config.admins = new_admins;
            storage::set_admin_config(&env, &config);
        }
        env.events().publish(
            (String::from_str(&env, "admin_transferred"),),
            (current_admin, new_admin),
        );
        Ok(())
    }

    /// Upgrade the contract WASM and bump the stored contract version.
    ///
    /// Replaces the previous `upgrade` entry point, which updated the WASM but
    /// left `contract_version` untouched, so off-chain tooling could not detect
    /// that a migration had occurred (SC-054).
    ///
    /// The version is incremented by exactly one on every successful upgrade and
    /// a `contract_upgraded` event is emitted with `(old_version, new_version)`.
    ///
    /// # Parameters
    /// - `admin` — The stored admin address; must be authenticated.
    /// - `new_wasm_hash` — The 32-byte hash of the new contract WASM.
    ///
    /// # Events
    /// Emits `contract_upgraded` with payload `(old_version, new_version)`.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if `admin` is not the stored admin.
    /// - [`PaymentError::ArithmeticError`] if the version would overflow `u32`.
    pub fn upgrade_contract(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        helper::require_admin(&env, &admin)?;
        let old_version = storage::get_contract_version(&env);
        let new_version = old_version
            .checked_add(1)
            .ok_or(PaymentError::ArithmeticError)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        storage::set_contract_version(&env, new_version);
        env.events().publish(
            (String::from_str(&env, "contract_upgraded"),),
            (old_version, new_version),
        );
        Ok(())
    }

    /// Set the stored contract version explicitly. Admin only.
    ///
    /// Intended for manual upgrades performed outside `upgrade_contract`
    /// (e.g. when the WASM was already replaced). The version must be strictly
    /// greater than the current one so that off-chain tooling never observes a
    /// version regression.
    ///
    /// # Parameters
    /// - `admin` — The stored admin address; must be authenticated.
    /// - `new_version` — The version to store; must be greater than the current version.
    ///
    /// # Events
    /// Emits `contract_upgraded` with payload `(old_version, new_version)`.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if `admin` is not the stored admin.
    /// - [`PaymentError::InvalidInput`] if `new_version` is not greater than the
    ///   current version.
    pub fn set_contract_version(
        env: Env,
        admin: Address,
        new_version: u32,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        helper::require_admin(&env, &admin)?;
        let old_version = storage::get_contract_version(&env);
        if new_version <= old_version {
            return Err(PaymentError::InvalidInput);
        }
        storage::set_contract_version(&env, new_version);
        env.events().publish(
            (String::from_str(&env, "contract_upgraded"),),
            (old_version, new_version),
        );
        Ok(())
    }

    /// Update the admin set and signing threshold.
    ///
    /// Requires the existing threshold of currently-registered admins to
    /// authorise the change (i.e., the change itself must pass multi-sig).
    /// This prevents a single compromised key from unilaterally replacing
    /// the full admin set.
    ///
    /// # Parameters
    /// - `current_admins` — Addresses of the admins authorising this change.
    ///   Must satisfy the current threshold.
    /// - `new_admins` — The new admin address list.
    /// - `new_threshold` — The new signing threshold (1 ≤ threshold ≤ len(new_admins)).
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if `current_admins` does not satisfy
    ///   the current threshold.
    /// - [`PaymentError::InvalidInput`] if `new_admins` is empty, or
    ///   `new_threshold` is zero or greater than the number of new admins.
    pub fn update_admin_config(
        env: Env,
        current_admins: Vec<Address>,
        new_admins: Vec<Address>,
        new_threshold: u32,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        // The change must be authorised by the existing multi-sig.
        helper::require_multi_admin(&env, current_admins)?;
        if new_admins.is_empty() {
            return Err(PaymentError::InvalidInput);
        }
        if new_threshold == 0 || new_threshold as usize > new_admins.len() as usize {
            return Err(PaymentError::InvalidInput);
        }
        let first = new_admins.get(0).unwrap();
        // Keep single-admin pointer in sync with the first new admin.
        storage::set_admin(&env, &first);
        storage::set_admin_config(&env, &types::AdminConfig {
            admins: new_admins.clone(),
            threshold: new_threshold,
        });
        env.events().publish(
            (String::from_str(&env, "admin_config_updated"),),
            (new_admins, new_threshold),
        );
        Ok(())
    }

    /// Return the current admin configuration (admin list and threshold).
    pub fn get_admin_config(env: Env) -> Result<types::AdminConfig, PaymentError> {
        storage::bump_instance_ttl(&env);
        storage::get_admin_config(&env).ok_or(PaymentError::Unauthorized)
    }

    pub fn get_version(env: Env) -> u32 {
        storage::bump_instance_ttl(&env);
        storage::get_contract_version(&env)
    }

    /// Health check endpoint for monitoring systems (BE-007).
    ///
    /// Returns the current ledger timestamp (`env.ledger().timestamp()`), which
    /// is the `close_time` of the most-recently closed ledger as reported by the
    /// validator quorum.  Because this function makes **no state-mutating calls**
    /// it is safe to invoke as frequently as needed without triggering surge
    /// pricing or consuming write-fee budget.
    ///
    /// ## Recommended usage
    ///
    /// Off-chain monitoring systems should call `ping` every **5 minutes** via
    /// Stellar RPC (simulation mode, no account sequence consumed):
    ///
    /// ```bash
    /// stellar contract invoke --id $CONTRACT_ID --source-account <KEY> \
    ///   --network testnet -- ping
    /// ```
    ///
    /// A successful response (any `u64` value) confirms the contract is live and
    /// accessible.  An error or timeout indicates a liveness problem.
    ///
    /// ## Return value
    ///
    /// The ledger `close_time` in Unix seconds (UTC).  Compare this value
    /// against wall-clock time to detect severely stale ledger heads.
    pub fn ping(env: Env) -> u64 {
        env.ledger().timestamp()
    }

    /// Extend the instance storage TTL so the contract never goes dormant.
    ///
    /// Instance storage holds Admin, GlobalStats, CleanupPeriod, and
    /// DefaultMultisigExpiry. If the contract goes dormant and instance storage
    /// expires the contract becomes unusable. This function is callable by
    /// anyone and should be invoked periodically to keep the contract alive.
    pub fn bump_instance_ttl(env: Env) {
        storage::bump_instance_ttl(&env);
    }

    // ── Emergency stop (SEC-010) ──────────────────────────────────────────────

    /// Pause the contract, blocking all state-mutating operations.
    ///
    /// Use this as an emergency stop when a critical vulnerability is discovered
    /// post-deployment. Read-only query functions remain accessible while paused.
    /// Only the admin may call this function.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if `admin` is not the stored admin.
    pub fn pause(env: Env, admin: Address) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        helper::require_admin(&env, &admin)?;
        storage::set_paused(&env, true);
        env.events().publish(
            (String::from_str(&env, "contract_paused"),),
            admin,
        );
        Ok(())
    }

    /// Resume the contract after it has been paused.
    ///
    /// Re-enables all state-mutating operations. Only the admin may call this.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if `admin` is not the stored admin.
    pub fn unpause(env: Env, admin: Address) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        helper::require_admin(&env, &admin)?;
        storage::set_paused(&env, false);
        env.events().publish(
            (String::from_str(&env, "contract_unpaused"),),
            admin,
        );
        Ok(())
    }

    /// Returns `true` if the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        storage::bump_instance_ttl(&env);
        storage::is_paused(&env)
    }

    // ── Merchant management ───────────────────────────────────────────────────

    /// Register a new merchant on the contract.
    ///
    /// # Parameters
    /// - `merchant_address` — The address that will own this merchant profile.
    /// - `name` — Display name (max 64 bytes).
    /// - `description` — Short description (max 256 bytes).
    /// - `contact_info` — Printable ASCII contact string (max 128 bytes).
    /// - `category` — Merchant category enum.
    /// - `signing_public_key` — Optional ed25519 public key used to verify
    ///   payment signatures. Pass `None` to skip signature verification.
    ///
    /// # Errors
    /// - [`PaymentError::MerchantAlreadyRegistered`] if the address is already registered.
    /// - [`PaymentError::Unauthorized`] if whitelist mode is on and the address is not approved.
    /// - [`PaymentError::InvalidInput`] if any string field exceeds its length limit.
    pub fn register_merchant(
        env: Env,
        merchant_address: Address,
        name: String,
        description: String,
        contact_info: String,
        category: MerchantCategory,
        signing_public_key: Option<BytesN<32>>,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        merchant_address.require_auth();
        if storage::get_merchant(&env, &merchant_address).is_some() {
            return Err(PaymentError::MerchantAlreadyRegistered);
        }
        if storage::is_whitelist_enabled(&env)
            && !storage::is_whitelisted(&env, &merchant_address)
        {
            return Err(PaymentError::Unauthorized);
        }
        helper::validate_merchant_fields(&name, &description, &contact_info)?;
        let merchant = Merchant {
            address: merchant_address.clone(),
            name,
            description,
            contact_info,
            category,
            active: true,
            registered_at: env.ledger().timestamp(),
            signing_public_key,
            tier: MerchantTier::Unverified,
        };
        storage::save_merchant(&env, &merchant);
        env.events().publish(
            (String::from_str(&env, "merchant_registered"),),
            merchant_address,
        );
        Ok(())
    }

    /// Assign a KYC / verification tier to a merchant (MISC-012).
    ///
    /// All merchants start at [`MerchantTier::Unverified`] at registration.
    /// Only an admin (via the multi-sig threshold) may upgrade or downgrade
    /// a merchant's tier, after completing the corresponding off-chain KYC
    /// process. See `docs/MERCHANT_TIERS.md` for tier criteria and the
    /// upgrade process.
    ///
    /// # Parameters
    /// - `admins` — Admin addresses satisfying the multi-sig threshold.
    /// - `merchant_address` — The merchant whose tier is being changed.
    /// - `tier` — The new tier to assign.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if the admin multi-sig check fails.
    /// - [`PaymentError::MerchantNotFound`] if the merchant does not exist.
    ///
    /// # Events
    /// Emits `merchant_tier_set` with payload `(merchant_address, tier)`.
    pub fn set_merchant_tier(
        env: Env,
        admins: Vec<Address>,
        merchant_address: Address,
        tier: MerchantTier,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        helper::require_multi_admin(&env, admins)?;
        let mut merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        merchant.tier = tier.clone();
        storage::save_merchant(&env, &merchant);
        env.events().publish(
            (String::from_str(&env, "merchant_tier_set"),),
            (merchant_address, tier),
        );
        Ok(())
    }

    /// Returns the merchant's current KYC / verification tier (MISC-012).
    ///
    /// # Errors
    /// - [`PaymentError::MerchantNotFound`] if the merchant does not exist.
    pub fn get_merchant_tier(env: Env, merchant_address: Address) -> Result<MerchantTier, PaymentError> {
        storage::bump_instance_ttl(&env);
        let merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        Ok(merchant.tier)
    }

    /// Enable or disable admin-whitelist mode for merchant registration.
    ///
    /// # Anti-spam mechanism (SEC-003)
    /// When whitelist mode is **enabled**, `register_merchant` requires the
    /// merchant address to be pre-approved by an admin before registration
    /// succeeds. This prevents unrestricted storage spam — an attacker cannot
    /// register unlimited merchants without admin approval, making large-scale
    /// storage-inflation attacks economically and operationally infeasible.
    ///
    /// When disabled (default), any address may register freely. Enable this
    /// mode on mainnet deployments where open registration is not desired.
    ///
    /// # Parameters
    /// - `admins` — Admin addresses satisfying the multi-sig threshold.
    /// - `enabled` — `true` to require pre-approval; `false` for open registration.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if the admin multi-sig check fails.
    pub fn set_whitelist_mode(
        env: Env,
        admins: Vec<Address>,
        enabled: bool,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        helper::require_multi_admin(&env, admins)?;
        storage::set_whitelist_enabled(&env, enabled);
        Ok(())
    }

    /// Pre-approve a merchant address for registration when whitelist mode is on.
    ///
    /// Must be called by an admin before the merchant calls `register_merchant`.
    /// Has no effect when whitelist mode is disabled (pre-approval is always
    /// accepted in that case, acting as an early-approval for future use).
    ///
    /// # Parameters
    /// - `admins` — Admin addresses satisfying the multi-sig threshold.
    /// - `merchant_address` — Address to whitelist.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if the admin multi-sig check fails.
    pub fn approve_merchant_registration(
        env: Env,
        admins: Vec<Address>,
        merchant_address: Address,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        helper::require_multi_admin(&env, admins)?;
        storage::set_whitelisted(&env, &merchant_address, true);
        Ok(())
    }

    // ── Token allowlist management (SEC-009) ──────────────────────────────────

    /// Enable or disable enforcement of the token allowlist.
    ///
    /// When enabled, any payment whose `order.token` is not on the allowlist
    /// will be rejected with [`PaymentError::TokenNotAllowed`].
    /// When disabled (default), any token contract address is accepted.
    ///
    /// Use `add_allowed_token` to populate the allowlist before enabling it.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if the admin multi-sig check fails.
    pub fn set_token_allowlist_mode(
        env: Env,
        admins: Vec<Address>,
        enabled: bool,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        helper::require_multi_admin(&env, admins)?;
        storage::set_token_allowlist_enabled(&env, enabled);
        env.events().publish(
            (String::from_str(&env, "token_allowlist_mode_set"),),
            enabled,
        );
        Ok(())
    }

    /// Add a token contract address to the admin-managed allowlist.
    ///
    /// Has no effect if the token is already on the allowlist.
    /// The allowlist is only enforced when `set_token_allowlist_mode(true)`
    /// has been called.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if the admin multi-sig check fails.
    pub fn add_allowed_token(
        env: Env,
        admins: Vec<Address>,
        token: Address,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        helper::require_multi_admin(&env, admins)?;
        storage::set_token_allowed(&env, &token, true);
        env.events().publish(
            (String::from_str(&env, "token_allowed"),),
            token,
        );
        Ok(())
    }

    /// Remove a token contract address from the admin-managed allowlist.
    ///
    /// After removal, payments using this token will be rejected when the
    /// allowlist is enabled.
    ///
    /// # Errors
    /// - [`PaymentError::Unauthorized`] if the admin multi-sig check fails.
    pub fn remove_allowed_token(
        env: Env,
        admins: Vec<Address>,
        token: Address,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        helper::require_multi_admin(&env, admins)?;
        storage::set_token_allowed(&env, &token, false);
        env.events().publish(
            (String::from_str(&env, "token_removed"),),
            token,
        );
        Ok(())
    }

    /// Returns `true` when `token` is on the allowlist.
    pub fn is_token_allowed(env: Env, token: Address) -> bool {
        storage::bump_instance_ttl(&env);
        storage::is_token_allowed(&env, &token)
    }

    /// Deactivate a merchant, preventing new payments from being processed.
    ///
    /// Can be called by the merchant themselves or by the admin multi-sig.
    ///
    /// # Parameters
    /// - `caller` — The address initiating the deactivation; must be authenticated.
    ///   If `admin_authorizers` is `None`, `caller` must equal `merchant_address`.
    /// - `merchant_address` — The merchant to deactivate.
    /// - `admin_authorizers` — If `Some`, the call is treated as an admin
    ///   action and the provided addresses must satisfy the multi-sig threshold.
    ///   If `None`, `caller` must be the merchant and must authorise the call directly.
    ///
    /// # Events
    /// Emits `merchant_deactivated` with payload `(merchant_address, caller)`.
    ///
    /// # Errors
    /// - [`PaymentError::MerchantNotFound`] if the merchant does not exist.
    /// - [`PaymentError::Unauthorized`] if neither the merchant nor a valid
    ///   admin multi-sig authorises the call.
    pub fn deactivate_merchant(
        env: Env,
        caller: Address,
        merchant_address: Address,
        admin_authorizers: Option<Vec<Address>>,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        if let Some(admins) = admin_authorizers {
            helper::require_multi_admin(&env, admins)?;
        } else {
            caller.require_auth();
            if caller != merchant_address {
                return Err(PaymentError::Unauthorized);
            }
        }
        let mut merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
        merchant.active = false;
        storage::save_merchant(&env, &merchant);
        env.events().publish(
            (String::from_str(&env, "merchant_deactivated"),),
            (merchant_address, caller),
        );
        Ok(())
    }

    /// Reactivate a previously deactivated merchant.
    ///
    /// Allows an admin or the merchant themselves to restore an inactive merchant
    /// to active status, preserving all existing payment history.
    ///
    /// # Parameters
    /// - `merchant_address` — The merchant to reactivate.
    /// - `admin_authorizers` — If `Some`, the call is treated as an admin
    ///   action and the provided addresses must satisfy the multi-sig threshold.
    ///   If `None`, `merchant_address` must authorise the call directly.
    ///
    /// # Errors
    /// - [`PaymentError::MerchantNotFound`] if the merchant does not exist.
    /// - [`PaymentError::MerchantAlreadyActive`] if the merchant is already active.
    /// - [`PaymentError::Unauthorized`] if neither the merchant nor a valid
    ///   admin multi-sig authorises the call.
    pub fn reactivate_merchant(
        env: Env,
        merchant_address: Address,
        admin_authorizers: Option<Vec<Address>>,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        if let Some(admins) = admin_authorizers {
            helper::require_multi_admin(&env, admins)?;
        } else {
            merchant_address.require_auth();
        }
        let mut merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
        if merchant.active {
            return Err(PaymentError::MerchantAlreadyActive);
        }
        merchant.active = true;
        storage::save_merchant(&env, &merchant);
        env.events().publish(
            (String::from_str(&env, "merchant_reactivated"),),
            merchant_address,
        );
        Ok(())
    }

    /// Retrieve a merchant's profile by address.
    ///
    /// # Parameters
    /// - `merchant_address` — The address of the merchant to look up.
    ///
    /// # Returns
    /// The [`Merchant`] struct if found.
    ///
    /// # Errors
    /// - [`PaymentError::MerchantNotFound`] if no merchant is registered at
    ///   `merchant_address`.
    pub fn get_merchant(env: Env, merchant_address: Address) -> Result<Merchant, PaymentError> {
        storage::bump_instance_ttl(&env);
        storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)
    }

    /// Update mutable profile fields of an existing merchant.
    /// Only the merchant themselves may call this.
    /// Immutable fields (address, registered_at, signing_public_key, active) are preserved.
    pub fn update_merchant(
        env: Env,
        merchant_address: Address,
        name: String,
        description: String,
        contact_info: String,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        merchant_address.require_auth();
        helper::validate_merchant_fields(&name, &description, &contact_info)?;
        let mut merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
        merchant.name = name.clone();
        merchant.description = description.clone();
        merchant.contact_info = contact_info.clone();
        storage::save_merchant(&env, &merchant);
        env.events().publish(
            (String::from_str(&env, "merchant_updated"),),
            (merchant_address, name, description, contact_info),
        );
        Ok(())
    }

    /// Bind or update the ed25519 signing key for a registered merchant.
    ///
    /// Separates key management from profile registration so that merchants can
    /// rotate their signing key without re-registering. Only the merchant
    /// themselves may call this function.
    ///
    /// `process_payment_with_signature` always verifies signatures against the
    /// on-chain stored key, so updating this binding takes immediate effect.
    ///
    /// # Parameters
    /// - `merchant_address` — The merchant updating their key; must be authenticated.
    /// - `signing_public_key` — The new ed25519 public key to store. Pass `None`
    ///   to clear the key and disable signature verification for this merchant.
    ///
    /// # Errors
    /// - [`PaymentError::MerchantNotFound`] if no merchant is registered.
    /// - [`PaymentError::MerchantInactive`] if the merchant is deactivated.
    pub fn set_merchant_signing_key(
        env: Env,
        merchant_address: Address,
        signing_public_key: Option<BytesN<32>>,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        merchant_address.require_auth();
        let mut merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }
        merchant.signing_public_key = signing_public_key;
        storage::save_merchant(&env, &merchant);
        env.events().publish(
            (String::from_str(&env, "merchant_signing_key_updated"),),
            merchant_address,
        );
        Ok(())
    }

    // ── Payment processing ────────────────────────────────────────────────────

    /// Process a payment by verifying an ed25519 merchant signature and transferring tokens.
    ///
    /// The payer authorises the call. The order payload is verified against the
    /// merchant's registered `signing_public_key` (if one is set). Funds are
    /// transferred atomically after the payment record is written to storage to
    /// reduce re-entrancy risk.
    ///
    /// # Parameters
    /// - `payer` — The address paying for the order; must be authenticated and
    ///   must match `order.payer`.
    /// - `order` — The [`PaymentOrder`] describing the transaction details.
    /// - `signature` — 64-byte ed25519 signature of the XDR-serialised order,
    ///   produced by the merchant's signing key.
    /// - `merchant_public_key` — 32-byte ed25519 public key used to verify
    ///   `signature`. Must match the merchant's registered key when one is set.
    ///
    /// # Returns
    /// `Ok(())` on success. Emits `payment_processed`.
    ///
    /// # Errors
    /// - [`PaymentError::InvalidInput`] if `order.payer` does not match `payer`.
    /// - [`PaymentError::InvalidAmount`] if `order.amount` ≤ 0.
    /// - [`PaymentError::PaymentAlreadyExists`] if `order.order_id` has already been processed.
    /// - [`PaymentError::PaymentExpired`] if the order's `expires_at` is in the past.
    /// - [`PaymentError::MerchantNotFound`] if the merchant is not registered.
    /// - [`PaymentError::MerchantInactive`] if the merchant has been deactivated.
    /// - [`PaymentError::InvalidSignature`] if signature verification fails.
    pub fn process_payment_with_signature(
        env: Env,
        payer: Address,
        order: PaymentOrder,
        signature: BytesN<64>,
        merchant_public_key: BytesN<32>,
    ) -> Result<(), PaymentError> {
        storage::bump_instance_ttl(&env);
        if storage::is_paused(&env) { return Err(PaymentError::ContractPaused); }
        payer.require_auth();
        if order.payer != payer {
            return Err(PaymentError::InvalidInput);
        }
        helper::validate_amount(order.amount)?;
        helper::validate_order_id(&order.order_id)?;
        helper::validate_metadata(&order.metadata)?;
        if storage::get_payment(&env, &order.order_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }
        let now = env.ledger().timestamp();
        if order.expires_at > 0 && now > order.expires_at {
            return Err(PaymentError::PaymentExpired);
        }
        // SEC-009: enforce token allowlist when enabled
        if storage::is_token_allowlist_enabled(&env)
            && !storage::is_token_allowed(&env, &order.token)
        {
            return Err(PaymentError::TokenNotAllowed);
        }
        let merchant = storage::get_merchant(&env, &order.merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }
        let stored_key = merchant
            .signing_public_key
            .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]));
        let zero_key = BytesN::from_array(&env, &[0u8; 32]);
        if stored_key != zero_key {
            let payload = order.clone().to_xdr(&env);
            helper::verify_signature(&env, &stored_key, &payload, &signature)?;
        }
        let record = PaymentRecord {
            order_id: order.order_id.clone(),
            merchant_address: order.merchant_address.clone(),
            payer: payer.clone(),
            token: order.token.clone(),
            amount: order.amount,
            refunded_amount: 0,
            pending_refund_amount: 0,
            status: PaymentStatus::Completed,
            paid_at: now,
            description: order.description.clone(),
            metadata: order.metadata.clone(),
        };
        storage::save_payment(&env, &record);
        storage::push_merchant_payment_id(&env, &order.merchant_address, &order.order_id);
        storage::push_payer_payment_id(&env, &payer, &order.order_id);
        storage::push_global_payment_id(&env, &order.order_id);
        storage::increment_payment_stats(&env, order.amount)?;

        // ── Re-entrancy model (SC-011) ───────────────────────────────────────
        // All state mutations (payment record, index updates, stats) are
        // committed to persistent storage BEFORE the external token transfer
        // call below. This follows the Checks-Effects-Interactions (CEI)
        // pattern and is the primary defence against re-entrancy.
        //
        // Why Soroban further limits re-entrancy risk:
        // Soroban's execution model enforces contract-level authorisation at
        // the VM boundary. A re-entrant call from a malicious token contract
        // back into THIS contract would require a fresh authorisation context
        // that is not present in the current transaction. In practice:
        //   1. `payer.require_auth()` has already been consumed for this
        //      invocation; the same auth cannot be reused.
        //   2. Soroban does not support call-stack re-entry into the same
        //      contract instance within a single transaction in the same
        //      authorisation scope.
        //
        // Taken together, the CEI ordering plus the Soroban execution model
        // means that even if the token contract attempts a re-entrant call,
        // the state it observes will already reflect the completed payment,
        // causing any duplicate `process_payment_with_signature` call to fail
        // with `PaymentAlreadyExists`.
        let token_client = token::Client::new(&env, &order.token);
        // Pre-check balance to return a typed error instead of a host trap.
        if token_client.balance(&payer) < order.amount {
            return Err(PaymentError::InsufficientBalance);
        }
        token_client.transfer(&payer, &order.merchant_address, &order.amount);
        env.events().publish(
            (String::from_str(&env, "payment_processed"),),
            (order.order_id, payer, order.merchant_address, order.amount),
        );
        Ok(())
    }

    /// Process multiple payments from the same payer in a single contract
    /// invocation (MISC-011), avoiding the fee/latency overhead of one
    /// transaction per payment (e.g. a marketplace collecting several
    /// merchant payouts at once).
    ///
    /// Unlike [`Self::process_payment_with_signature`], batch orders are not
    /// individually signature-verified by a merchant key; the payer alone
    /// authorises the whole batch via `require_auth`. Signature-verified
    /// payments should still use `process_payment_with_signature` one at a
    /// time.
    ///
    /// # Atomicity
    /// All orders in `orders` succeed or the entire call fails and every
    /// state change (payment records, indexes, stats, and token transfers)
    /// is rolled back. This holds because `process_batch_payments` is a
    /// single contract entry point: returning `Err` for any order aborts
    /// the whole host invocation, and the Soroban host reverts all ledger
    /// writes performed during a failed invocation
