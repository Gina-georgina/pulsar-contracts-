#!/usr/bin/env bash
# =============================================================================
# Pulsar Contracts — Database backup script
# =============================================================================
# Creates a managed PostgreSQL backup and optionally uploads it to S3.
# Designed for automated daily backups, retention pruning, integrity checking,
# and recovery support.
# =============================================================================

set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DATABASE_URL="${DATABASE_URL:-}" 
AWS_S3_BUCKET="${AWS_S3_BUCKET:-}"
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL environment variable is required"
  exit 1
fi

mkdir -p "$BACKUP_ROOT"

target_file="$BACKUP_ROOT/pulsar-db-backup-$TIMESTAMP.dump"

export PGPASSWORD="${PGPASSWORD:-}"

echo "[backup] Creating PostgreSQL dump: $target_file"
if ! pg_dump --format=custom --file="$target_file" "$DATABASE_URL"; then
  echo "[backup] ERROR: pg_dump failed for $target_file" >&2
  exit 1
fi

echo "[backup] Verifying backup file is non-empty"
if [[ ! -s "$target_file" ]]; then
  echo "[backup] ERROR: backup file is missing or empty: $target_file" >&2
  exit 1
fi

echo "[backup] Verifying backup file integrity (pg_restore --list)"
if ! pg_restore --list "$target_file" >/dev/null; then
  echo "[backup] ERROR: backup file is not a valid/parseable dump: $target_file" >&2
  exit 1
fi

if [[ -n "$AWS_S3_BUCKET" ]]; then
  echo "[backup] Uploading backup to s3://$AWS_S3_BUCKET/"
  aws s3 cp "$target_file" "s3://$AWS_S3_BUCKET/$(basename "$target_file")" --region "$AWS_DEFAULT_REGION"
fi

if [[ -d "$BACKUP_ROOT" ]]; then
  echo "[backup] Pruning backups older than $BACKUP_RETENTION_DAYS days"
  find "$BACKUP_ROOT" -type f -name 'pulsar-db-backup-*.dump' -mtime +"$BACKUP_RETENTION_DAYS" -print -delete || true
fi

echo "[backup] Completed successfully: $target_file"
