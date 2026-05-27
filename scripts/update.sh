#!/bin/bash
# FamCalendar auto-update — pulls from GitHub and redeploys if changes found
# Runs every 5 minutes via cron and at boot via systemd
# Set FORCE=1 to update regardless of whether there are new commits

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

echo "Fetching latest from GitHub..."
git fetch origin main 2>&1

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Already up to date."
  exit 0
fi

if [ "$LOCAL" = "$REMOTE" ] && [ "${FORCE:-0}" = "1" ]; then
  echo "Already up to date, but running forced reinstall..."
else
  echo "Update found ($LOCAL -> $REMOTE), pulling..."
  git pull origin main 2>&1
fi

# Reinstall backend deps if package.json changed (or forced)
if git diff "$LOCAL" HEAD --name-only 2>/dev/null | grep -q "backend/package.json" || [ "${FORCE:-0}" = "1" ]; then
  echo "Installing backend dependencies..."
  cd "$FAMCAL_DIR/backend" && npm install --production 2>&1 && cd "$FAMCAL_DIR"
fi

# Rebuild frontend if source files changed (or forced)
if git diff "$LOCAL" HEAD --name-only 2>/dev/null | grep -q "^frontend/src/" || [ "${FORCE:-0}" = "1" ]; then
  echo "Building frontend..."
  cd "$FAMCAL_DIR/frontend" && npm run build 2>&1 && cd "$FAMCAL_DIR"
fi

echo "Restarting backend..."
sudo systemctl restart famcalendar-backend 2>&1

echo ""
echo "Update complete!"
echo "$(date): Update complete (${FORCE:-0} forced)" >> "$LOG"
