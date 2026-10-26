#!/usr/bin/env bash
# ============================================================
#  MC Paradise Apartment — MongoDB backup
#  Usage:  sudo -u deploy bash deploy/backup-mongo.sh
#  Keeps 14 daily archives in /var/backups/mc-paradise.
#  Add to cron (as the app user):
#    0 3 * * * bash /var/www/mc-paradise/deploy/backup-mongo.sh >> /var/log/mc-paradise-backup.log 2>&1
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MONGO_DB="${MONGO_DB:-mc_paradise}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mc-paradise}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y-%m-%d_%H%M)"
file="$BACKUP_DIR/${MONGO_DB}_${stamp}.archive.gz"

mongodump \
  --uri="mongodb://127.0.0.1:27017/$MONGO_DB" \
  --archive="$file" \
  --gzip

find "$BACKUP_DIR" -name '*.archive.gz' -type f -mtime "+$KEEP_DAYS" -delete
printf 'Backup written: %s (%s)\n' "$file" "$(du -h "$file" | cut -f1)"
