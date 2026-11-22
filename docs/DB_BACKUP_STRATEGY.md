# Database Backup Strategy

This document describes the automated backup and recovery strategy for the Pulsar backend database.

## Daily backup automation

- A daily GitHub Actions workflow runs at `02:00 UTC`.
- The workflow executes `scripts/db-backup.sh`.
- Backups are created using `pg_dump --format=custom`.
- Successful backups are uploaded to off-site storage when `AWS_S3_BUCKET` is configured.

## Backup integrity verification

After `pg_dump` completes, the backup script verifies the dump before treating the backup as successful:

- The dump file must be larger than `0` bytes. An empty or missing dump file fails the check.
- `pg_restore --list` must succeed against the dump, confirming the file is a parseable custom-format archive.
- If either check fails, the script logs an error and exits with a non-zero status, so the workflow fails instead of silently producing a corrupt backup.

CI runs a backup test against a small test database: it creates a throwaway database, runs `scripts/db-backup.sh` against it, and asserts that the resulting dump passes the integrity checks.

## Backup retention

- The backup script retains backups locally for `30` days by default.
- Backups older than the configured `BACKUP_RETENTION_DAYS` are automatically deleted.
- Set `BACKUP_RETENTION_DAYS` to update the retention policy.

## Off-site storage

- `AWS_S3_BUCKET` must be set in the environment or GitHub secret.
- The script uses the AWS CLI to upload backups from the repository root.
- Backups are named with UTC timestamps: `pulsar-db-backup-YYYYMMDDTHHMMSSZ.dump`.

## Point-in-time recovery

- Daily backup files support full restore from a known state.
- For point-in-time recovery, restore the latest backup and replay WAL segments from the PostgreSQL server if WAL archiving is configured externally.
- This repository provides the backup workflow; PITR support requires PostgreSQL WAL archiving to the same storage target.

## Recovery testing

To verify a recovery process locally:

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/pulsar_events"
export PGPASSWORD="password"
psql -c "DROP DATABASE IF EXISTS pulsar_recovery; CREATE DATABASE pulsar_recovery;"
pg_restore --dbname=postgresql://user:password@localhost:5432/pulsar_recovery ./backups/pulsar-db-backup-*.dump
```

## Disaster recovery plan

1. Verify the latest backup exists in the off-site storage bucket.
2. Select the recovery target database instance.
3. Restore the latest backup with `pg_restore`.
4. If point-in-time recovery is required, replay WAL segments from the archive up to the desired timestamp.
5. Validate the restored data using application smoke tests or direct queries.
