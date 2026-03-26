#!/bin/bash
# =============================================================================
# Sovereign Console — Audit Log Backup Script
# Exports the audit_log table to an encrypted, timestamped JSON file.
# Verifies hash chain integrity before backup.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
INSTALL_DIR="${INSTALL_DIR:-/opt/sovereign-console}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sovereign-console}"
GPG_RECIPIENT="${GPG_RECIPIENT:-lance@lancewfisher.com}"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="audit_log_${TIMESTAMP}.json"
ENCRYPTED_FILE="${BACKUP_FILE}.gpg"

# Database connection (from .env)
ENV_FILE="${INSTALL_DIR}/config/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $(date +%H:%M:%S) $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $(date +%H:%M:%S) $*"; }
err()  { echo -e "${RED}[x]${NC} $(date +%H:%M:%S) $*" >&2; }

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
  err "Environment file not found: ${ENV_FILE}"
  exit 1
fi

# shellcheck source=/dev/null
DATABASE_URL=$(grep '^DATABASE_URL=' "${ENV_FILE}" | cut -d'=' -f2-)
if [[ -z "${DATABASE_URL}" ]]; then
  err "DATABASE_URL not found in ${ENV_FILE}"
  exit 1
fi

if ! command -v gpg &>/dev/null; then
  err "gpg is required but not found."
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

log "Starting audit log backup..."

# ---------------------------------------------------------------------------
# 1. Verify hash chain integrity before backup
# ---------------------------------------------------------------------------
log "Verifying hash chain integrity..."

CHAIN_CHECK=$(docker compose -f "${INSTALL_DIR}/docker-compose.yml" exec -T postgres \
  psql "${DATABASE_URL}" -t -A -c "
    WITH chain AS (
      SELECT
        id,
        entry_hash,
        prev_hash,
        LAG(entry_hash) OVER (ORDER BY id) AS expected_prev_hash
      FROM audit_log
      ORDER BY id
    )
    SELECT COUNT(*) AS broken_links
    FROM chain
    WHERE id > 1 AND prev_hash != expected_prev_hash;
  " 2>/dev/null || echo "ERROR")

if [[ "${CHAIN_CHECK}" == "ERROR" ]]; then
  warn "Could not verify hash chain (database may not be accessible via Docker)."
  warn "Attempting direct psql connection..."

  CHAIN_CHECK=$(psql "${DATABASE_URL}" -t -A -c "
    WITH chain AS (
      SELECT
        id,
        entry_hash,
        prev_hash,
        LAG(entry_hash) OVER (ORDER BY id) AS expected_prev_hash
      FROM audit_log
      ORDER BY id
    )
    SELECT COUNT(*) AS broken_links
    FROM chain
    WHERE id > 1 AND prev_hash != expected_prev_hash;
  " 2>/dev/null || echo "UNAVAILABLE")
fi

if [[ "${CHAIN_CHECK}" == "UNAVAILABLE" ]]; then
  warn "Hash chain verification skipped — database not reachable."
elif [[ "${CHAIN_CHECK}" -gt 0 ]]; then
  err "HASH CHAIN INTEGRITY FAILURE: ${CHAIN_CHECK} broken link(s) detected!"
  err "Backup will proceed but the chain is compromised. Investigate immediately."
elif [[ "${CHAIN_CHECK}" == "0" ]]; then
  log "Hash chain integrity verified — 0 broken links."
fi

# ---------------------------------------------------------------------------
# 2. Export audit_log table to JSON
# ---------------------------------------------------------------------------
log "Exporting audit_log table..."

EXPORT_CMD="
  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      id, event_type, operator_id, device_id, session_id,
      action, resource, detail, ip_address,
      timestamp AT TIME ZONE 'UTC' AS timestamp,
      prev_hash, entry_hash
    FROM audit_log
    ORDER BY id
  ) t;
"

# Try Docker first, fall back to direct connection
EXPORT_RESULT=$(docker compose -f "${INSTALL_DIR}/docker-compose.yml" exec -T postgres \
  psql "${DATABASE_URL}" -t -A -c "${EXPORT_CMD}" 2>/dev/null) || \
EXPORT_RESULT=$(psql "${DATABASE_URL}" -t -A -c "${EXPORT_CMD}" 2>/dev/null) || {
  err "Failed to export audit logs from database."
  exit 1
}

if [[ -z "${EXPORT_RESULT}" || "${EXPORT_RESULT}" == "null" ]]; then
  warn "No audit log entries found. Nothing to back up."
  exit 0
fi

# Write JSON with metadata wrapper
cat > "${BACKUP_DIR}/${BACKUP_FILE}" <<EOF
{
  "backup_timestamp": "$(date -Iseconds)",
  "hostname": "$(hostname)",
  "entry_count": $(echo "${EXPORT_RESULT}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "unknown"),
  "chain_status": "${CHAIN_CHECK}",
  "entries": ${EXPORT_RESULT}
}
EOF

EXPORT_SIZE=$(stat -c%s "${BACKUP_DIR}/${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_DIR}/${BACKUP_FILE}" 2>/dev/null || echo "unknown")
log "Exported ${EXPORT_SIZE} bytes to ${BACKUP_FILE}"

# ---------------------------------------------------------------------------
# 3. GPG encrypt the export
# ---------------------------------------------------------------------------
log "Encrypting backup with GPG (recipient: ${GPG_RECIPIENT})..."

gpg --batch --yes --trust-model always \
  --recipient "${GPG_RECIPIENT}" \
  --output "${BACKUP_DIR}/${ENCRYPTED_FILE}" \
  --encrypt "${BACKUP_DIR}/${BACKUP_FILE}"

if [[ $? -eq 0 ]]; then
  log "Encrypted backup: ${ENCRYPTED_FILE}"

  # Remove unencrypted file
  rm -f "${BACKUP_DIR}/${BACKUP_FILE}"
  log "Removed unencrypted export."
else
  err "GPG encryption failed. Unencrypted backup remains at ${BACKUP_DIR}/${BACKUP_FILE}"
  warn "Secure or delete this file immediately!"
fi

# ---------------------------------------------------------------------------
# 4. Compute and record checksum
# ---------------------------------------------------------------------------
sha256sum "${BACKUP_DIR}/${ENCRYPTED_FILE}" > "${BACKUP_DIR}/${ENCRYPTED_FILE}.sha256"
log "Checksum: $(cat "${BACKUP_DIR}/${ENCRYPTED_FILE}.sha256")"

# ---------------------------------------------------------------------------
# 5. Rotate old backups (keep last RETENTION_DAYS)
# ---------------------------------------------------------------------------
log "Rotating backups older than ${RETENTION_DAYS} days..."

DELETED_COUNT=$(find "${BACKUP_DIR}" -name "audit_log_*.json.gpg" -mtime +${RETENTION_DAYS} -print -delete 2>/dev/null | wc -l)
find "${BACKUP_DIR}" -name "audit_log_*.json.gpg.sha256" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

if [[ "${DELETED_COUNT}" -gt 0 ]]; then
  log "Deleted ${DELETED_COUNT} old backup(s)."
else
  log "No old backups to rotate."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
REMAINING=$(find "${BACKUP_DIR}" -name "audit_log_*.json.gpg" 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1)

echo ""
echo "============================================================================="
log "Audit log backup complete!"
echo "============================================================================="
echo ""
echo "  Backup file:   ${BACKUP_DIR}/${ENCRYPTED_FILE}"
echo "  Checksum file:  ${BACKUP_DIR}/${ENCRYPTED_FILE}.sha256"
echo "  Chain status:   ${CHAIN_CHECK} broken links"
echo "  Total backups:  ${REMAINING}"
echo "  Backup dir size: ${TOTAL_SIZE}"
echo ""
echo "  To decrypt:  gpg --decrypt ${BACKUP_DIR}/${ENCRYPTED_FILE} > audit_log.json"
echo "============================================================================="
