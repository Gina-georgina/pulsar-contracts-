// SPDX-License-Identifier: MIT
/// Data Archival Module
/// 
/// Implements a strategy for archiving old payment records to optimize database performance
/// while maintaining data availability for compliance and audit purposes.
/// 
/// Acceptance Criteria:
/// - Archive jobs for records > 1 year old
/// - Archived data accessible via query
/// - Archive storage (cold storage)
/// - Archive index for quick retrieval
/// - Bulk delete of archived data
/// - Data retention compliance
/// - Performance monitoring

use alloc::vec::Vec as RustVec;
use soroban_sdk::{Address, Bytes, BytesN, Env, String, Vec};

use crate::error::PaymentError;
use crate::types::PaymentRecord;

/// Archive metadata for tracking archived records
#[derive(Clone, Debug)]
pub struct ArchiveMetadata {
    /// Timestamp when the record was archived
    pub archived_at: u64,
    /// Number of days the archived data will be retained
    pub retention_days: u32,
    /// Hash of the original record for integrity verification
    pub record_hash: BytesN<32>,
    /// Flag to indicate if data has been redacted for compliance
    pub redacted: bool,
}

/// Archive index entry for quick retrieval of archived payments
#[derive(Clone, Debug)]
pub struct ArchiveIndex {
    /// Order ID of the archived payment
    pub order_id: Bytes,
    /// Merchant address associated with the archived payment
    pub merchant_address: Address,
    /// Timestamp when payment was archived
    pub archived_at: u64,
}

/// Archive configuration for controlling archival behavior
#[derive(Clone, Debug)]
pub struct ArchiveConfig {
    /// Threshold in seconds for considering a record as "old" (default: 1 year)
    pub archival_threshold_secs: u64,
    /// Retention period in days for archived data (minimum: 5 years for compliance)
    pub retention_days: u32,
    /// Whether sensitive data should be redacted when archived
    pub redact_sensitive_data: bool,
    /// Whether archival is enabled
    pub enabled: bool,
}

/// Archive statistics for monitoring archival operations
pub struct ArchiveStats {
    /// Total number of archived payment records
    pub archived_payments_count: u32,
    /// Total number of archived refund records
    pub archived_refunds_count: u32,
    /// Timestamp of the last archival job run
    pub last_archival_job_run: u64,
    /// Number of records purged
    pub purged_count: u32,
}

impl ArchiveConfig {
    /// Create default archival configuration
    /// - 1 year threshold for archival (31,536,000 seconds)
    /// - 5+ year retention for compliance
    /// - Sensitive data redaction enabled
    pub fn default() -> Self {
        ArchiveConfig {
            archival_threshold_secs: 31_536_000,      // 1 year
            retention_days: 1_825,                     // 5 years
            redact_sensitive_data: true,
            enabled: true,
        }
    }
}

/// Check if a payment record is eligible for archival (older than 1 year)
pub fn is_eligible_for_archival(
    env: &Env,
    record: &PaymentRecord,
    config: &ArchiveConfig,
) -> bool {
    let current_time = env.ledger().timestamp();
    let age_secs = current_time.saturating_sub(record.paid_at);
    age_secs >= config.archival_threshold_secs
}

/// Check if an archived record has exceeded its retention period
pub fn has_retention_expired(metadata: &ArchiveMetadata, current_time: u64) -> bool {
    let retention_secs = (metadata.retention_days as u64) * 86_400;
    let age_since_archive = current_time.saturating_sub(metadata.archived_at);
    age_since_archive >= retention_secs
}

/// Compute hash of payment record for integrity verification (simplified)
pub fn compute_payment_hash(record: &PaymentRecord) -> BytesN<32> {
    // In production, this would use a proper cryptographic hash
    // For now, return a placeholder
    BytesN::from_array(&[
        0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
        24, 25, 26, 27, 28, 29, 30, 31,
    ])
}

/// Archive a payment record
pub fn archive_payment(
    env: &Env,
    record: &PaymentRecord,
    config: &ArchiveConfig,
) -> Result<ArchiveMetadata, PaymentError> {
    if !config.enabled {
        return Err(PaymentError::Unauthorized);
    }

    if !is_eligible_for_archival(env, record, config) {
        return Err(PaymentError::InvalidInput);
    }

    let metadata = ArchiveMetadata {
        archived_at: env.ledger().timestamp(),
        retention_days: config.retention_days,
        record_hash: compute_payment_hash(record),
        redacted: config.redact_sensitive_data,
    };

    Ok(metadata)
}

/// Create archive index entry for quick retrieval
pub fn create_archive_index(
    order_id: Bytes,
    merchant_address: Address,
    current_time: u64,
) -> ArchiveIndex {
    ArchiveIndex {
        order_id,
        merchant_address,
        archived_at: current_time,
    }
}

/// Emit a `payment_archived` event for a cleaned-up payment record.
///
/// The event uses the topic `("payment_archived",)` and data `(order_id, archived_at)`
/// so that off-chain consumers (indexer, analytics, webhook listener) can
/// soft-delete the corresponding row.
pub fn emit_payment_archived(env: &Env, order_id: &Bytes, archived_at: u64) {
    let topics = (String::from_str(env, "payment_archived"),);
    env.events().publish(topics, (order_id.clone(), archived_at));
}

/// Get archive statistics
pub fn get_archive_stats(
    archived_payments_count: u32,
    archived_refunds_count: u32,
    last_job_run: u64,
    purged_count: u32,
) -> ArchiveStats {
    ArchiveStats {
        archived_payments_count,
        archived_refunds_count,
        last_archival_job_run: last_job_run,
        purged_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_archive_config_default() {
        let config = ArchiveConfig::default();
        assert_eq!(config.archival_threshold_secs, 31_536_000); // 1 year
        assert_eq!(config.retention_days, 1_825); // 5 years
        assert!(config.redact_sensitive_data);
        assert!(config.enabled);
    }

    #[test]
    fn test_retention_expiry_calculation() {
        let metadata = ArchiveMetadata {
            archived_at: 1000,
            retention_days: 1,
            record_hash: BytesN::from_array(&[0u8; 32]),
            redacted: false,
        };

        // 1 day = 86,400 seconds
        let current_time_before = 1000 + 86_399;
        let current_time_after = 1000 + 86_401;

        assert!(!has_retention_expired(&metadata, current_time_before));
        assert!(has_retention_expired(&metadata, current_time_after));
    }
}
