#!/bin/bash
# FamCalendar auto-update — pulls from GitHub and redeploys if changes found
# Runs every 5 minutes via cron and at boot via systemd

# Detect user
if id "ubuntu" &>/dev/null; then
  FAMCAL_USER="ubuntu"
else
  FAMCAL_USER="pi"
fi

FAMCAL_DIR="/home/$FAMCAL_USER/FamCalendar"
LOG="$FAMCAL_DIR/logs/update.log"

mkdir -p "$FAMCAL_DIR/logs"
cd "$FAMCAL_DIR" || exit 1

git fetch origin main 2>/dev/null

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "$(date): Update found ($LOCAL -> $REMOTE)" >> "$LOG"
git pull origin main >> "$LOG" 2>&1

# Reinstall backend deps if package.json changed
if git diff "$LOCAL" HEAD --name-only | grep -q "backend/package.json"; then
  echo "$(date): Backend deps changed, reinstalling..." >> "$LOG"
  cd "$FAMCAL_DIR/backend" && npm install --production >> "$LOG" 2>&1
fi

# Rebuild frontend if source files changed
if git diff "$LOCAL" HEAD --name-only | grep -q "^frontend/src/"; then
  echo "$(date): Frontend changed, rebuilding..." >> "$LOG"
  cd "$FAMCAL_DIR/frontend" && npm run build >> "$LOG" 2>&1
fi

sudo systemctl restart famcalendar-backend >> "$LOG" 2>&1
echo "$(date): Update complete" >> "$LOG"
