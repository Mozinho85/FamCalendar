#!/bin/bash
# FamCalendar auto-update — pulls from GitHub and redeploys if changes found
# Runs every 5 minutes via cron and at boot via systemd
# Set FORCE=1 to update regardless of whether there are new commits

# Ensure npm/node are on PATH regardless of how this script was invoked
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

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
if ! git fetch origin main 2>&1; then
  echo "ERROR: git fetch failed — check network and GitHub access"
  exit 1
fi

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
  git stash 2>&1 || true
  if ! git pull origin main 2>&1; then
    echo "ERROR: git pull failed"
    exit 1
  fi
fi

# Reinstall backend deps if package.json changed (or forced)
if git diff "$LOCAL" HEAD --name-only 2>/dev/null | grep -q "backend/package.json" || [ "${FORCE:-0}" = "1" ]; then
  echo "Installing backend dependencies..."
  cd "$FAMCAL_DIR/backend" && npm install --production 2>&1
  cd "$FAMCAL_DIR"
fi

# Rebuild frontend if any frontend files changed (or forced)
if git diff "$LOCAL" HEAD --name-only 2>/dev/null | grep -q "^frontend/" || [ "${FORCE:-0}" = "1" ]; then
  echo "Installing frontend dependencies..."
  cd "$FAMCAL_DIR/frontend" && npm install 2>&1
  echo "Building frontend..."
  # Limit Node memory to avoid OOM on Pi (512 MB is safe on a Pi 4 with display running)
  NODE_OPTIONS="--max-old-space-size=512" npm run build 2>&1
  BUILD_EXIT=$?
  cd "$FAMCAL_DIR"
  if [ $BUILD_EXIT -ne 0 ]; then
    echo "ERROR: Frontend build failed (exit $BUILD_EXIT) — keeping existing build"
    exit 1
  fi
  echo "Frontend build complete."
fi

echo "Restarting backend..."
sudo systemctl restart famcalendar-backend 2>&1

echo ""
echo "Update complete!"
echo "$(date): Update complete (${FORCE:-0} forced)" >> "$LOG"
