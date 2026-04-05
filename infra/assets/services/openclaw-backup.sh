#!/bin/bash
set -euo pipefail
BACKUP_DIR="$HOME/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
AGE_RECIPIENTS="$HOME/.openclaw/.age-recipients"
mkdir -p "$BACKUP_DIR"

if [ -f "$AGE_RECIPIENTS" ]; then
  tar cz \
    --exclude='.openclaw/logs' \
    --exclude='.openclaw/sandboxes' \
    -C "$HOME" .openclaw \
    | age -R "$AGE_RECIPIENTS" > "$BACKUP_DIR/openclaw-$TIMESTAMP.tar.gz.age"
  find "$BACKUP_DIR" -name "openclaw-*.tar.gz.age" -mtime +7 -delete
  echo "Encrypted backup: $BACKUP_DIR/openclaw-$TIMESTAMP.tar.gz.age"
else
  tar czf "$BACKUP_DIR/openclaw-$TIMESTAMP.tar.gz" \
    --exclude='.openclaw/logs' \
    --exclude='.openclaw/sandboxes' \
    -C "$HOME" .openclaw
  find "$BACKUP_DIR" -name "openclaw-*.tar.gz" -mtime +7 -delete
  echo "Backup (unencrypted, no age key): $BACKUP_DIR/openclaw-$TIMESTAMP.tar.gz"
fi
