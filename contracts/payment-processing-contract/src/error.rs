// SPDX-License-Identifier: MIT

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PaymentError {
    // Auth
    Unauthorized = 1,
    AdminAlreadySet = 2,

    // Merchant
    MerchantNotFound = 10,
    MerchantAlreadyRegistered = 11,
    MerchantInactive = 12,
    /// Attempted to reactivate a merchant that is already active.
    MerchantAlreadyActive = 13,

    // Payment
    PaymentNotFound = 20,
    PaymentAlreadyExists = 21,
    InvalidAmount = 22,
    InvalidSignature = 23,
    PaymentExpired = 24,
    /// Payer or merchant does not have enough token balance to complete the transfer.
    InsufficientBalance = 25,

    // Refund
    RefundNotFound = 30,
    RefundAlreadyExists = 31,
    RefundWindowExpired = 32,
    RefundAmountExceedsPayment = 33,
    RefundNotApproved = 34,
    RefundAlreadyCompleted = 35,
    /// Refund must be in Rejected state to be disputed.
    RefundNotRejected = 36,
    /// Dispute can only be raised by the original payer.
    DisputeUnauthorized = 37,
    /// Refund is not in Disputed state; cannot resolve.
    RefundNotDisputed = 38,

    // Multisig
    MultisigNotFound = 40,
    MultisigAlreadySigned = 41,
    MultisigAlreadyExecuted = 42,
    InsufficientSignatures = 43,

    // General
    InvalidInput = 50,
    // StorageError = 51 was removed: the variant was never returned by any
    // code path and only inflated the ABI. See issue SC-009.
    ArithmeticError = 52,

    // Subscription
    /// Subscription ID not found in storage.
    SubscriptionNotFound = 60,
    /// A subscription with this ID already exists.
    SubscriptionAlreadyExists = 61,
    /// Subscription is not in Active state (e.g. already cancelled).
    SubscriptionNotActive = 62,
    /// Payment interval has not elapsed since the last charge.
    /// The off-chain scheduler must wait until `last_charged_at + interval`
    /// before invoking `process_subscription_payment` again.
    SubscriptionIntervalNotElapsed = 63,

    // Token allowlist (SEC-009)
    /// The token contract address is not on the admin-managed allowlist.
    /// Enable the allowlist with `set_token_allowlist_mode` and add approved
    /// tokens with `add_allowed_token` before processing payments.
    TokenNotAllowed = 71,

    // Feature flags (MISC-034)
    /// The feature flag gating this function is disabled.
    /// The admin can enable it at runtime with `set_feature_flag`; the flag
    /// name is reported in the error context (e.g. `subscriptions_enabled`,
    /// `token_allowlist_enforced`). See `docs/FEATURE_FLAGS.md`.
    FeatureFlagDisabled = 72,
}
