// SPDX-License-Identifier: MIT

use soroban_sdk::{contracttype, Address, Bytes, BytesN, Map, String, Vec};

// ── Merchant ──────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MerchantCategory {
    Retail,
    Food,
    Services,
    Digital,
    Other,
}

/// Merchant KYC / verification tier (MISC-012).
///
/// All merchants start at `Unverified` on registration. An admin (via the
/// multi-sig threshold, see `helper::require_multi_admin`) can upgrade a
/// merchant to `Verified` or `Premium` as they complete off-chain KYC. See
/// `docs/MERCHANT_TIERS.md` for the tier criteria and upgrade process.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MerchantTier {
    /// Default tier for every newly registered merchant. No KYC has been
    /// performed; the merchant is trusted only to the extent the contract
    /// trusts any registered address.
    Unverified,
    /// Merchant has completed baseline off-chain identity verification.
    Verified,
    /// Merchant has completed enhanced verification (e.g. for high-volume
    /// or regulated-market use) and may be eligible for higher per-transaction
    /// limits in a future revision.
    Premium,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Merchant {
    pub address: Address,
    pub name: String,
    pub description: String,
    pub contact_info: String,
    pub category: MerchantCategory,
    pub active: bool,
    pub registered_at: u64,
    pub signing_public_key: Option<BytesN<32>>,
    /// KYC / verification tier (MISC-012). Defaults to `Unverified` at
    /// registration and is changed only by an admin via `set_merchant_tier`.
    pub tier: MerchantTier,
}

// ── Payment ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PaymentStatus {
    Completed,
    PartiallyRefunded,
    FullyRefunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentOrder {
    pub order_id: Bytes,
    pub merchant_address: Address,
    pub payer: Address,
    pub token: Address,
    pub amount: i128,
    pub description: String,
    /// Unix timestamp (seconds) when the order expires. A value of `0`
    /// is treated as "never expires" (an order that does not expire).
    /// This special-case is relied upon by existing integrations and is
    /// intentionally accepted by the contract.
    pub expires_at: u64,
    /// Optional structured metadata (e.g. customer ID, product SKU) that
    /// merchants can attach to a payment for off-chain reconciliation.
    /// The combined size of all keys and values is capped at
    /// `helper::MAX_METADATA_SIZE_BYTES` (see MISC-013).
    pub metadata: Option<Map<String, String>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentRecord {
    pub order_id: Bytes,
    pub merchant_address: Address,
    pub payer: Address,
    pub token: Address,
    pub amount: i128,
    pub refunded_amount: i128,
    pub pending_refund_amount: i128,
    pub status: PaymentStatus,
    pub paid_at: u64,
    pub description: String,
    /// Metadata carried over from the originating [`PaymentOrder`], if any.
    pub metadata: Option<Map<String, String>>,
}

/// On-chain data source for a payer/merchant-facing payment receipt
/// (see docs/RECEIPT_FORMAT.md). This struct only carries fields the
/// contract itself can attest to; the Stellar transaction hash and any
/// PDF rendering are produced off-chain (e.g. by an indexer/API layer)
/// since a contract cannot observe the hash of the transaction that
/// invoked it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentReceipt {
    pub order_id: Bytes,
    pub amount: i128,
    pub token: Address,
    pub merchant_address: Address,
    pub merchant_name: String,
    pub payer: Address,
    pub status: PaymentStatus,
    pub paid_at: u64,
}

// ── Refund ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RefundStatus {
    Pending,
    Approved,
    Rejected,
    Completed,
    /// Payer has escalated a merchant-rejected refund for admin resolution.
    Disputed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundRecord {
    pub refund_id: Bytes,
    pub order_id: Bytes,
    pub amount: i128,
    pub reason: String,
    pub status: RefundStatus,
    pub initiated_by: Address,
    pub initiated_at: u64,
    /// Set when the payer disputes a merchant rejection. Empty string if not disputed.
    pub dispute_reason: String,
}

/// A single page of refunds returned by `get_refund_page` (SC-052).
///
/// Replaces the unbounded `get_all_refunds` query, which loaded the entire
/// refund index into memory in one call. Callers should iterate pages using
/// `next_cursor` until it is `None`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundPage {
    pub records: Vec<RefundRecord>,
    /// Opaque pagination cursor pointing to the last record on the page.
    ///
    /// Current format: raw `refund_id` bytes of the last record. Callers that
    /// transport the cursor over textual channels (CLI, HTTP) should encode
    /// it (for example as base64). The contract treats the cursor as an opaque
    /// `Bytes` value and will start the next page after the matching
    /// `refund_id`.
    ///
    /// NOTE: changing this format is a breaking change. Any future change
    /// should use a versioned encoding and include a migration note in an ADR.
    pub next_cursor: Option<Bytes>,
    /// Total number of refunds matching the query, across all pages.
    pub total: u32,
}

// ── Multisig ──────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigPayment {
    pub payment_id: Bytes,
    pub order: PaymentOrder,
    pub required_signers: Vec<Address>,
    pub signatures: Vec<Address>,
    pub executed: bool,
    pub expires_at: u64,
    pub created_at: u64,
}

// ── Subscriptions ───────────────────────────────────────────────────────────
// Full SubscriptionState, SubscriptionPlan, SubscriptionStatus definitions
// are below (search "Subscription" section lower in this file).

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionPage {
    pub records: Vec<SubscriptionState>,
    /// Opaque pagination cursor pointing to the last returned subscription id.
    pub next_cursor: Option<Bytes>,
    pub total: u32,
}

// ── Query helpers ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SortField {
    Date,
    Amount, // .
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SortOrder {
    Ascending,
    Descending,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StatusFilter {
    Any,
    Completed,
    PartiallyRefunded,
    FullyRefunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentFilter {
    pub date_start: Option<u64>,
    pub date_end: Option<u64>,
    pub amount_min: Option<i128>,
    pub amount_max: Option<i128>,
    /// Filter by one or more token contract addresses. `None` matches all tokens.
    /// An empty list also matches all tokens (treated as no filter).
    pub tokens: Option<Vec<Address>>,
    pub status: StatusFilter,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentPage {
    pub records: Vec<PaymentRecord>,
    /// Opaque pagination cursor pointing to the last record on the page.
    ///
    /// Current format: raw `order_id` bytes of the last record. Callers that
    /// transport the cursor over textual channels (CLI, HTTP) should encode
    /// it (for example as base64). The contract treats the cursor as an opaque
    /// `Bytes` value and will start the next page after the matching `order_id`.
    ///
    /// NOTE: changing this format is a breaking change. Any future change
    /// should use a versioned encoding and include a migration note in an ADR.
    pub next_cursor: Option<Bytes>,
    pub total: u32,
}

// ── Stats ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalStats {
    pub total_payments: u64,
    pub total_volume: i128,
    pub total_refunds: u64,
    pub total_refund_volume: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantStats {
    pub merchant_address: Address,
    pub total_payments: u64,
    pub total_volume: i128,
    pub total_refunds: u64,
    pub total_refund_volume: i128,
}

// ── Admin ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminConfig {
    pub admins: Vec<Address>,
    pub threshold: u32,
}

// ── Subscription ──────────────────────────────────────────────────────────────

/// Defines the recurring payment terms for a subscription.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionPlan {
    /// Payment interval in seconds (e.g. 2_592_000 for 30 days).
    pub interval: u64,
    /// Amount charged per interval, in the smallest token unit.
    pub amount: i128,
    /// Token contract address used for recurring charges.
    pub token: Address,
}

/// Lifecycle state of a subscription.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubscriptionStatus {
    Active,
    Cancelled,
}

/// Persisted state for a single payer–merchant subscription.
///
/// # Off-chain scheduler requirement
/// Soroban contracts cannot autonomously schedule execution. An off-chain
/// scheduler service MUST call `process_subscription_payment` at each interval
/// boundary. The contract enforces correctness (idempotency, interval guard,
/// status checks) but relies on the scheduler for timely invocation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionState {
    /// Unique subscription identifier (caller-supplied).
    pub subscription_id: Bytes,
    pub payer: Address,
    pub merchant: Address,
    pub plan: SubscriptionPlan,
    pub status: SubscriptionStatus,
    /// Ledger timestamp when the subscription was created.
    pub created_at: u64,
    /// Ledger timestamp of the most recent successful payment (0 if none yet).
    pub last_charged_at: u64,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    AdminConfig,
    ContractVersion,
    Merchant(Address),
    Payment(Bytes),
    MerchantPaymentChunk(Address, u32),
    MerchantPaymentCount(Address),
    PayerPaymentChunk(Address, u32),
    PayerPaymentCount(Address),
    /// Flat payment index list per merchant (replaces chunked approach).
    MerchantPayments(Address),
    /// Flat payment index list per payer.
    PayerPayments(Address),
    /// Global flat payment index.
    GlobalPaymentIndex,
    Refund(Bytes),
    Multisig(Bytes),
    CleanupPeriod,
    DefaultMultisigExpiry,
    GlobalStats,
    /// Deprecated (SC-052): flat list of all refund IDs. Superseded by the
    /// paginated refund index below; retained only for migration/cleanup.
    AllRefunds,
    /// Flat refund index list (paginated via `get_refund_page`, SC-052).
    GlobalRefundIndex,
    /// Refund window in seconds, stored in instance storage (SC-055).
    /// Defaults to the legacy `REFUND_WINDOW` constant on first access.
    RefundWindow,
    /// Refund grace buffer in seconds, stored in instance storage (SC-055).
    /// Defaults to the legacy `REFUND_GRACE_BUFFER` constant on first access.
    RefundGraceBuffer,
    WhitelistEnabled,
    Whitelist(Address),
    OrderRefundCount(Bytes),
    ArchivedPayment(Bytes),
    TokenAllowlistEnabled,
    AllowedToken(Address),
    Subscription(Bytes),
    /// Index of subscription IDs per merchant for list queries.
    MerchantSubscriptions(Address),
    MerchantStats(Address),
    /// Emergency stop flag (SEC-010). When `true`, all state-mutating functions
    /// return `ContractPaused`. Read-only functions are unaffected.
    Paused,
    /// Namespaced feature flag (MISC-034). Maps a flag name (e.g.
    /// `"subscriptions_enabled"`) to a `bool` value in persistent storage.
    /// Flags are toggled by an admin via `set_feature_flag` without a
    /// contract upgrade; see `docs/FEATURE_FLAGS.md` for the flag API and
    /// the list of currently recognised flags.
    FeatureFlag(String),
}
