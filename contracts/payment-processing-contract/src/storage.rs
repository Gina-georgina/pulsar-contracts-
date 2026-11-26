// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Bytes, Env, Vec};

use crate::error::PaymentError;
use crate::types::{
    AdminConfig, DataKey, GlobalStats, Merchant, MerchantStats, MultisigPayment, PaymentRecord,
    RefundRecord, SubscriptionState,
};

// ── TTL constants ─────────────────────────────────────────────────────────────

/// ~1 year in ledgers (5-second ledger close time).
pub const TTL_LEDGERS: u32 = 6_307_200;
/// Refresh TTL when remaining lifetime drops below ~6 months.
pub const TTL_THRESHOLD: u32 = TTL_LEDGERS / 2;

// ── Instance TTL management ───────────────────────────────────────────────────

/// Extend the instance storage TTL so the contract never goes dormant.
///
/// Instance storage holds Admin, GlobalStats, CleanupPeriod, and
/// DefaultMultisigExpiry. If the contract goes dormant and instance storage
/// expires the contract becomes unusable. Call this on every invocation (or
/// at minimum on every admin operation) to keep the contract alive.
pub fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_LEDGERS);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin_config(env: &Env) -> Option<AdminConfig> {
    env.storage().instance().get(&DataKey::AdminConfig)
}

pub fn set_admin_config(env: &Env, config: &AdminConfig) {
    env.storage().instance().set(&DataKey::AdminConfig, config);
}

// ── Contract version ──────────────────────────────────────────────────────────

pub fn get_contract_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ContractVersion)
        .unwrap_or(0)
}

pub fn set_contract_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&DataKey::ContractVersion, &version);
}

// ── Merchant ──────────────────────────────────────────────────────────────────

pub fn get_merchant(env: &Env, address: &Address) -> Option<Merchant> {
    let key = DataKey::Merchant(address.clone());
    let result = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result
}

pub fn save_merchant(env: &Env, merchant: &Merchant) {
    let key = DataKey::Merchant(merchant.address.clone());
    env.storage().persistent().set(&key, merchant);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

// ── Payment ───────────────────────────────────────────────────────────────────

pub fn get_payment(env: &Env, order_id: &Bytes) -> Option<PaymentRecord> {
    let key = DataKey::Payment(order_id.clone());
    let result = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result
}

pub fn save_payment(env: &Env, record: &PaymentRecord) {
    let key = DataKey::Payment(record.order_id.clone());
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

pub fn remove_payment(env: &Env, order_id: &Bytes) {
    env.storage()
        .persistent()
        .remove(&DataKey::Payment(order_id.clone()));
}

// ── Archived payments (tombstones) ──────────────────────────────────────────

pub fn is_archived_payment(env: &Env, order_id: &Bytes) -> bool {
    let key = DataKey::ArchivedPayment(order_id.clone());
    let result: bool = env.storage().persistent().get(&key).unwrap_or(false);
    if result {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result
}

pub fn set_archived_payment(env: &Env, order_id: &Bytes) {
    let key = DataKey::ArchivedPayment(order_id.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

// ── Payment index lists ───────────────────────────────────────────────────────

pub fn get_merchant_payment_ids(env: &Env, merchant: &Address) -> Vec<Bytes> {
    let key = DataKey::MerchantPayments(merchant.clone());
    let result: Option<Vec<Bytes>> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result.unwrap_or_else(|| Vec::new(env))
}

pub fn push_merchant_payment_id(env: &Env, merchant: &Address, order_id: &Bytes) {
    let mut ids = get_merchant_payment_ids(env, merchant);
    // SC-013: cap the in-contract merchant payment-ID index to prevent
    // unbounded ledger entry growth. Loading and re-saving the entire Vec on
    // every payment is O(n) in storage reads/writes; without a cap the entry
    // would eventually exceed Soroban's per-entry size limit and make payments
    // infeasible for active merchants.
    //
    // When the cap is reached, the oldest entry is evicted (FIFO). The
    // underlying PaymentRecord stored under DataKey::Payment(order_id) is NOT
    // deleted; it remains in persistent storage and is still queryable via
    // get_payment_by_id. Only the paginated history index is capped.
    //
    // See ADR-0006 (docs/adr/0006-payment-id-index-cap.md) for the full
    // trade-off analysis and the long-term chunked-index roadmap.
    if ids.len() >= MAX_PAYMENT_IDS_PER_KEY {
        let mut trimmed = Vec::new(env);
        for i in 1..ids.len() {
            trimmed.push_back(ids.get(i).unwrap());
        }
        ids = trimmed;
    }
    ids.push_back(order_id.clone());
    let key = DataKey::MerchantPayments(merchant.clone());
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

pub fn get_payer_payment_ids(env: &Env, payer: &Address) -> Vec<Bytes> {
    let key = DataKey::PayerPayments(payer.clone());
    let result: Option<Vec<Bytes>> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result.unwrap_or_else(|| Vec::new(env))
}

pub fn push_payer_payment_id(env: &Env, payer: &Address, order_id: &Bytes) {
    let mut ids = get_payer_payment_ids(env, payer);
    // SC-013: same FIFO cap as the merchant index. See push_merchant_payment_id
    // and ADR-0006 for the full rationale.
    if ids.len() >= MAX_PAYMENT_IDS_PER_KEY {
        let mut trimmed = Vec::new(env);
        for i in 1..ids.len() {
            trimmed.push_back(ids.get(i).unwrap());
        }
        ids = trimmed;
    }
    ids.push_back(order_id.clone());
    let key = DataKey::PayerPayments(payer.clone());
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

pub fn get_global_payment_ids(env: &Env) -> Vec<Bytes> {
    let key = DataKey::GlobalPaymentIndex;
    let result: Option<Vec<Bytes>> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result.unwrap_or_else(|| Vec::new(env))
}

pub fn push_global_payment_id(env: &Env, order_id: &Bytes) {
    let mut ids = get_global_payment_ids(env);
    ids.push_back(order_id.clone());
    let key = DataKey::GlobalPaymentIndex;
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

pub fn set_global_payment_ids(env: &Env, ids: &Vec<Bytes>) {
    let key = DataKey::GlobalPaymentIndex;
    env.storage().persistent().set(&key, ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

pub fn remove_merchant_payment_id(env: &Env, merchant: &Address, order_id: &Bytes) {
    let ids = get_merchant_payment_ids(env, merchant);
    let mut new_ids = Vec::new(env);
    for id in ids.iter() {
        if id != *order_id {
            new_ids.push_back(id);
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::MerchantPayments(merchant.clone()), &new_ids);
}

pub fn remove_payer_payment_id(env: &Env, payer: &Address, order_id: &Bytes) {
    let ids = get_payer_payment_ids(env, payer);
    let mut new_ids = Vec::new(env);
    for id in ids.iter() {
        if id != *order_id {
            new_ids.push_back(id);
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::PayerPayments(payer.clone()), &new_ids);
}

pub fn remove_global_payment_id(env: &Env, order_id: &Bytes) {
    let ids = get_global_payment_ids(env);
    let mut new_ids = Vec::new(env);
    for id in ids.iter() {
        if id != *order_id {
            new_ids.push_back(id);
        }
    }
    set_global_payment_ids(env, &new_ids);
}

// ── Refund ────────────────────────────────────────────────────────────────────

pub fn get_refund(env: &Env, refund_id: &Bytes) -> Option<RefundRecord> {
    let key = DataKey::Refund(refund_id.clone());
    let result = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result
}

pub fn save_refund(env: &Env, refund: &RefundRecord) {
    let key = DataKey::Refund(refund.refund_id.clone());
    env.storage().persistent().set(&key, refund);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

/// A page of refund IDs returned by `get_refund_page_ids`.
///
/// `next_cursor` is `None` when the returned page is the last one; otherwise
/// it is the cursor that should be passed to the next call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RefundPage {
    pub ids: Vec<Bytes>,
    pub next_cursor: Option<u32>,
}

/// Maximum number of refund IDs returned by a single page query.
pub const MAX_REFUND_PAGE_SIZE: u32 = 100;

/// Return the total number of refund IDs recorded in the refund index.
pub fn get_refund_count(env: &Env) -> u32 {
    let key = DataKey::RefundCount;
    let result: u32 = env.storage().persistent().get(&key).unwrap_or(0);
    if result > 0 {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result
}

/// Append a refund ID to the insertion-ordered refund index.
///
/// The index is stored as one entry per position (`DataKey::RefundIndex(i)`)
/// so that appending is O(1) and paging never loads the full list into memory.
pub fn append_refund_id(env: &Env, refund_id: &Bytes) {
    let count = get_refund_count(env);
    let key = DataKey::RefundIndex(count);
    env.storage().persistent().set(&key, refund_id);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);

    let count_key = DataKey::RefundCount;
    env.storage().persistent().set(&count_key, &(count + 1));
    env.storage()
        .persistent()
        .extend_ttl(&count_key, TTL_THRESHOLD, TTL_LEDGERS);
}

/// Return a cursor-paginated slice of refund IDs.
///
/// `cursor` is the zero-based index of the first ID to return (pass `0` for
/// the first page). `limit` is clamped to `[1, MAX_REFUND_PAGE_SIZE]`.
pub fn get_refund_page_ids(env: &Env, cursor: u32, limit: u32) -> RefundPage {
    let total = get_refund_count(env);
    let limit = if limit == 0 {
        1
    } else if limit > MAX_REFUND_PAGE_SIZE {
        MAX_REFUND_PAGE_SIZE
    } else {
        limit
    };

    let mut ids = Vec::new(env);
    if cursor >= total {
        return RefundPage {
            ids,
            next_cursor: None,
        };
    }

    let end = cursor.saturating_add(limit).min(total);
    let mut i = cursor;
    while i < end {
        let key = DataKey::RefundIndex(i);
        if let Some(id) = env.storage().persistent().get::<DataKey, Bytes>(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
            ids.push_back(id);
        }
        i += 1;
    }

    let next_cursor = if end < total { Some(end) } else { None };
    RefundPage { ids, next_cursor }
}

// ── Per-order pending refund count ────────────────────────────────────────────

pub fn get_order_refund_count(env: &Env, order_id: &Bytes) -> u32 {
    let key = DataKey::OrderRefundCount(order_id.clone());
    let result: u32 = env.storage().persistent().get(&key).unwrap_or(0);
    if result > 0 {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result
}

pub fn increment_order_refund_count(env: &Env, order_id: &Bytes) {
    let count = get_order_refund_count(env, order_id) + 1;
    let key = DataKey::OrderRefundCount(order_id.clone());
    env.storage().persistent().set(&key, &count);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

pub fn decrement_order_refund_count(env: &Env, order_id: &Bytes) {
    let count = get_order_refund_count(env, order_id).saturating_sub(1);
    let key = DataKey::OrderRefundCount(order_id.clone());
    env.storage().persistent().set(&key, &count);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

// ── Multisig ──────────────────────────────────────────────────────────────────

pub fn get_multisig(env: &Env, payment_id: &Bytes) -> Option<MultisigPayment> {
    let key = DataKey::Multisig(payment_id.clone());
    let result = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result
}

pub fn save_multisig(env: &Env, ms: &MultisigPayment) {
    let key = DataKey::Multisig(ms.payment_id.clone());
    env.storage().persistent().set(&key, ms);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

// ── Whitelist ─────────────────────────────────────────────────────────────────

pub fn is_whitelist_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::WhitelistEnabled)
        .unwrap_or(false)
}

pub fn set_whitelist_enabled(env: &Env, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::WhitelistEnabled, &enabled);
}

pub fn is_whitelisted(env: &Env, address: &Address) -> bool {
    let key = DataKey::Whitelist(address.clone());
    let result: bool = env.storage().persistent().get(&key).unwrap_or(false);
    if result {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result
}

pub fn set_whitelisted(env: &Env, address: &Address, approved: bool) {
    let key = DataKey::Whitelist(address.clone());
    env.storage().persistent().set(&key, &approved);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

// ── Config ────────────────────────────────────────────────────────────────────

/// Default cleanup period: 90 days in seconds
pub const DEFAULT_CLEANUP_PERIOD: u64 = 7_776_000;

/// Refund eligibility window: 30 days in seconds.
///
/// # Timestamp trust model
///
/// The refund deadline is computed as `paid_at + REFUND_WINDOW + REFUND_GRACE_BUFFER`,
/// where `paid_at` and the current time (`now`) are both sourced from
/// `env.ledger().timestamp()`.
///
/// **Why timestamps, not ledger sequence numbers?**
/// Stellar ledger sequence numbers increment by 1 per closed ledger, but the
/// wall-clock duration of each ledger varies (typically 5–7 s, but not
/// guaranteed). Converting a 30-day window into a fixed sequence-number delta
/// would require assuming a constant close time; any deviation accumulates
/// drift that could silently shorten or extend the window. Because `paid_at`
/// already stores a Unix timestamp, using timestamps for the deadline check is
/// the only consistent approach.
///
/// **Validator-provided timestamps and their bounds**
/// `env.ledger().timestamp()` returns the `close_time` field of the ledger
/// header, which is set by the validator quorum. The Stellar Consensus Protocol
/// requires that each ledger's `close_time` is strictly greater than the
/// previous ledger's `close_time`, so timestamps are monotonically increasing.
/// However, they are *not* guaranteed to match wall-clock time exactly:
/// validators may set `close_time` up to a small number of seconds ahead of or
/// behind real time. In practice the drift is well under a minute, but callers
/// should not rely on sub-minute precision.
///
/// **Abuse resistance**
/// Because timestamps are monotonically increasing and the grace buffer is
/// only 1 hour (small relative to the 30-day window), a validator cannot
/// meaningfully extend refund eligibility by manipulating `close_time` without
/// violating consensus rules. The grace buffer is sized to absorb legitimate
/// network timing variance, not to provide a meaningful extension of the window.
pub const REFUND_WINDOW: u64 = 2_592_000;

/// Maximum configurable refund window: 365 days in seconds.
pub const MAX_REFUND_WINDOW: u64 = 31_536_000;

/// Grace buffer added to the refund deadline: 1 hour in seconds.
///
/// A refund is accepted when `now <= paid_at + REFUND_WINDOW + REFUND_GRACE_BUFFER`.
///
/// The 1-hour buffer absorbs minor timestamp drift near the deadline boundary
/// (e.g., a refund submitted seconds before midnight on day 30 that lands in a
/// ledger whose `close_time` is a few seconds past the nominal deadline). It
/// does not meaningfully extend the 30-day window from a user perspective.
pub const REFUND_GRACE_BUFFER: u64 = 3_600;

/// Return the configured refund window, falling back to `REFUND_WINDOW`
/// when no admin override has been stored (migration path).
pub fn get_refund_window(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::RefundWindow)
        .unwrap_or(REFUND_WINDOW)
}

/// Return the configured refund grace buffer, falling back to
/// `REFUND_GRACE_BUFFER` when no admin override has been stored.
pub fn get_refund_grace_buffer(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::RefundGraceBuffer)
        .unwrap_or(REFUND_GRACE_BUFFER)
}

/// Set the refund window and grace buffer in instance storage.
///
/// Bounds validation:
/// * `window_secs` must be greater than zero and at most `MAX_REFUND_WINDOW`.
/// * `grace_buffer_secs` must not exceed `window_secs`.
pub fn set_refund_window(
    env: &Env,
    window_secs: u64,
    grace_buffer_secs: u64,
) -> Result<(), PaymentError> {
    if window_secs == 0 || window_secs > MAX_REFUND_WINDOW {
        return Err(PaymentError::InvalidRefundWindow);
    }
    if grace_buffer_secs > window_secs {
        return Err(PaymentError::InvalidRefundWindow);
    }
    env.storage()
        .instance()
        .set(&DataKey::RefundWindow, &window_secs);
    env.storage()
        .instance()
        .set(&DataKey::RefundGraceBuffer, &grace_buffer_secs);
    Ok(())
}

/// Default multisig expiry: 24 hours in seconds
pub const DEFAULT_MULTISIG_EXPIRY: u64 = 86_400;
/// Maximum number of signers for a multisig payment
pub const MAX_SIGNERS: u32 = 10;
/// Maximum number of pending refunds per order
pub const MAX_PENDING_REFUNDS: u32 = 10;
/// Maximum number of payment orders accepted in a single
/// `process_batch_payments` call (MISC-011). Keeps a single batch
/// invocation within the ledger's CPU/memory budget and bounds the
/// amount of per-order work (validation + token transfer) that must
/// succeed atomically for the batch to commit.
pub const MAX_BATCH_PAYMENTS: u32 = 10;
/// Maximum number of payment IDs tracked per merchant or payer in the
/// in-contract index (SC-013). Older IDs are evicted (FIFO) from the index
/// once the cap is reached; the full `PaymentRecord` objects remain in
/// persistent storage and are still queryable by `order_id`. Off-chain
/// indexers should be used for complete history beyond this cap.
///
/// See `docs/adr/0006-payment-id-index-cap.md` for the trade-off analysis,
/// benchmark estimates, and the long-term chunked-index roadmap.
pub const MAX_PAYMENT_IDS_PER_KEY: u32 = 10_000;

pub fn get_cleanup_period(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::CleanupPeriod)
        .unwrap_or(DEFAULT_CLEANUP_PERIOD)
}

pub fn set_cleanup_period(env: &Env, period: u64) {
    env.storage()
        .instance()
        .set(&DataKey::CleanupPeriod, &period);
}

pub fn get_default_multisig_expiry(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::DefaultMultisigExpiry)
        .unwrap_or(DEFAULT_MULTISIG_EXPIRY)
}

pub fn set_default_multisig_expiry(env: &Env, expiry: u64) {
    env.storage()
        .instance()
        .set(&DataKey::DefaultMultisigExpiry, &expiry);
}

// ── Feature flags (MISC-034) ──────────────────────────────────────────────────

/// Feature flag name for subscription payments.
pub const FLAG_SUBSCRIPTIONS_ENABLED: &str = "subscriptions_enabled";
/// Feature flag name for token allowlist enforcement.
pub const FLAG_TOKEN_ALLOWLIST_ENFORCED: &str = "token_allowlist_enforced";

/// Returns the value of the named feature flag, defaulting to `false` when
/// the flag has never been set. Flags live in instance storage so reads are
/// O(1) and are covered by `bump_instance_ttl`.
pub fn get_feature_flag(env: &Env, name: &str) -> bool {
    let key = DataKey::FeatureFlag(soroban_sdk::String::from_str(env, name));
    env.storage().instance().get(&key).unwrap_or(false)
}

/// Enable or disable the named feature flag. Callers must be admin-gated at
/// the contract entry-point level; this helper performs no auth checks.
pub fn set_feature_flag(env: &Env, name: &str, enabled: bool) {
    let key = DataKey::FeatureFlag(soroban_sdk::String::from_str(env, name));
    env.storage().instance().set(&key, &enabled);
    bump_instance_ttl(env);
}

// ── Token allowlist (SEC-009) ─────────────────────────────────────────────────

/// Returns true when the token allowlist enforcement is active.
///
/// Consults the `token_allowlist_enforced` feature flag first (MISC-034).
/// When the flag is unset, falls back to the legacy `TokenAllowlistEnabled`
/// key for backward compatibility with deployments that predate the flag.
pub fn is_token_allowlist_enabled(env: &Env) -> bool {
    let flag_key = DataKey::FeatureFlag(soroban_sdk::String::from_str(
        env,
        FLAG_TOKEN_ALLOWLIST_ENFORCED,
    ));
    if let Some(enabled) = env.storage().instance().get::<_, bool>(&flag_key) {
        return enabled;
    }
    env.storage()
        .instance()
        .get(&DataKey::TokenAllowlistEnabled)
        .unwrap_or(false)
}

pub fn set_token_allowlist_enabled(env: &Env, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::TokenAllowlistEnabled, &enabled);
}

/// Returns true when `token` is on the admin-managed allowlist.
pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AllowedToken(token.clone()))
        .unwrap_or(false)
}

pub fn set_token_allowed(env: &Env, token: &Address, allowed: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::AllowedToken(token.clone()), &allowed);
    env.storage().persistent().extend_ttl(
        &DataKey::AllowedToken(token.clone()),
        TTL_THRESHOLD,
        TTL_LEDGERS,
    );
}

// ── Global stats ──────────────────────────────────────────────────────────────

pub fn get_global_stats(env: &Env) -> GlobalStats {
    env.storage()
        .instance()
        .get(&DataKey::GlobalStats)
        .unwrap_or(GlobalStats {
            total_payments: 0,
            total_volume: 0,
            total_refunds: 0,
            total_refund_volume: 0,
        })
}

pub fn save_global_stats(env: &Env, stats: &GlobalStats) {
    env.storage().instance().set(&DataKey::GlobalStats, stats);
}

pub fn increment_payment_stats(env: &Env, amount: i128) -> Result<(), PaymentError> {
    let mut stats = get_global_stats(env);
    stats.total_payments += 1;
    stats.total_volume = stats
        .total_volume
        .checked_add(amount)
        .ok_or(PaymentError::ArithmeticError)?;
    save_global_stats(env, &stats);
    Ok(())
}

pub fn increment_refund_stats(env: &Env, amount: i128) -> Result<(), PaymentError> {
    let mut stats = get_global_stats(env);
    stats.total_refunds += 1;
    stats.total_refund_volume = stats
        .total_refund_volume
        .checked_add(amount)
        .ok_or(PaymentError::ArithmeticError)?;
    save_global_stats(env, &stats);
    Ok(())
}

/// Decrement global payment stats when a payment is archived or rolled back.
pub fn decrement_payment_stats(env: &Env, amount: i128) {
    let mut stats = get_global_stats(env);
    stats.total_payments = stats.total_payments.saturating_sub(1);
    stats.total_volume = stats.total_volume.saturating_sub(amount);
    save_global_stats(env, &stats);
}

/// Decrement global refund stats when a refund record is archived.
pub fn decrement_refund_stats(env: &Env, amount: i128) {
    let mut stats = get_global_stats(env);
    stats.total_refunds = stats.total_refunds.saturating_sub(1);
    stats.total_refund_volume = stats.total_refund_volume.saturating_sub(amount);
    save_global_stats(env, &stats);
}

// ── Subscription ──────────────────────────────────────────────────────────────

pub fn get_subscription(env: &Env, subscription_id: &Bytes) -> Option<SubscriptionState> {
    let key = DataKey::Subscription(subscription_id.clone());
    let result = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result
}

pub fn save_subscription(env: &Env, sub: &SubscriptionState) {
    let key = DataKey::Subscription(sub.subscription_id.clone());
    env.storage().persistent().set(&key, sub);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

/// Return the list of subscription IDs for a given merchant.
pub fn get_merchant_subscription_ids(env: &Env, merchant: &Address) -> Vec<Bytes> {
    let key = DataKey::MerchantSubscriptions(merchant.clone());
    let result: Option<Vec<Bytes>> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result.unwrap_or_else(|| Vec::new(env))
}

/// Append a subscription ID to the merchant's subscription index.
pub fn push_merchant_subscription_id(env: &Env, merchant: &Address, subscription_id: &Bytes) {
    let mut ids = get_merchant_subscription_ids(env, merchant);
    ids.push_back(subscription_id.clone());
    let key = DataKey::MerchantSubscriptions(merchant.clone());
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

// ── Merchant stats ────────────────────────────────────────────────────────────

pub fn get_merchant_stats(env: &Env, merchant: &Address) -> MerchantStats {
    let key = DataKey::MerchantStats(merchant.clone());
    let result: Option<MerchantStats> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
    }
    result.unwrap_or(MerchantStats {
        merchant_address: merchant.clone(),
        total_payments: 0,
        total_volume: 0,
        total_refunds: 0,
        total_refund_volume: 0,
    })
}

pub fn save_merchant_stats(env: &Env, stats: &MerchantStats) {
    let key = DataKey::MerchantStats(stats.merchant_address.clone());
    env.storage().persistent().set(&key, stats);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_LEDGERS);
}

// ── Emergency stop / pause flag (SEC-010) ─────────────────────────────────────

/// Returns `true` when the contract is paused.
///
/// Stored in instance storage so that the check is O(1) and survives
/// without TTL management (instance TTL is managed by `bump_instance_ttl`).
pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

/// Set or clear the contract-paused flag.
pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}
