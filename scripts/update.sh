#!/bin/bash
# FamCalendar auto-update script
# Runs every 5 minutes via cron, pulls from GitHub and redeploys if there are changes

FAMCAL_DIR="/home/pi/FamCalendar"
LOG="$FAMCAL_DIR/logs/update.log"

mkdir -p "$FAMCAL_DIR/logs"
cd "$FAMCAL_DIR" || exit 1

# Fetch latest without merging yet
git fetch origin main 2>/dev/null

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

# Nothing to do
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "$(date): Update found ($LOCAL -> $REMOTE)" >> "$LOG"

# Pull the changes
git pull origin main >> "$LOG" 2>&1

# Reinstall backend deps only if package.json changed
if git diff "$LOCAL" HEAD --name-only | grep -q "backend/package.json"; then
  echo "$(date): Backend deps changed, reinstalling..." >> "$LOG"
  cd "$FAMCAL_DIR/backend" && npm install --production >> "$LOG" 2>&1
fi

# Rebuild frontend only if frontend source files changed
if git diff "$LOCAL" HEAD --name-only | grep -q "^frontend/src/"; then
  echo "$(date): Frontend changed, rebuilding..." >> "$LOG"
  cd "$FAMCAL_DIR/frontend" && npm run build >> "$LOG" 2>&1
fi

# Restart backend to pick up any changes
sudo systemctl restart famcalendar-backend >> "$LOG" 2>&1

echo "$(date): Update complete" >> "$LOG"
