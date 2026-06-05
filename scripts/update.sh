#!/bin/bash
# FamCalendar auto-update — pulls from GitHub and redeploys if changes found
# Runs every 5 minutes via cron and at boot via systemd
# Set FORCE=1 to update regardless of whether there are new commits
# Set FORCE_PULL=1 to hard-reset local repo to origin/main before reinstalling
# Set CLEAN_INSTALL=1 to remove node_modules/build artifacts before reinstall

# Ensure npm/node are on PATH regardless of how this script was invoked
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# When run from the web UI (no SSH agent), explicitly point git at the SSH key
if [ -z "$SSH_AUTH_SOCK" ]; then
  for key in ~/.ssh/id_ed25519 ~/.ssh/id_rsa ~/.ssh/id_ecdsa; do
    if [ -f "$key" ]; then
      export GIT_SSH_COMMAND="ssh -i $key -o StrictHostKeyChecking=no -o BatchMode=yes"
      break
    fi
  done
fi

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
EFFECTIVE_FORCE="${FORCE:-0}"

if [ "${FORCE_PULL:-0}" = "1" ] || [ "${CLEAN_INSTALL:-0}" = "1" ]; then
  EFFECTIVE_FORCE="1"
fi

if [ "${FORCE_PULL:-0}" = "1" ]; then
  echo "FORCE_PULL=1 set — resetting local branch to origin/main..."
  if ! git reset --hard origin/main 2>&1; then
    echo "ERROR: git reset --hard failed"
    exit 1
  fi
  # Remove untracked files so the deploy folder is fully in sync with GitHub.
  if ! git clean -fd 2>&1; then
    echo "ERROR: git clean failed"
    exit 1
  fi
fi

if [ "$LOCAL" = "$REMOTE" ] && [ "$EFFECTIVE_FORCE" != "1" ]; then
  echo "Already up to date."
  exit 0
fi

if [ "$LOCAL" = "$REMOTE" ] && [ "$EFFECTIVE_FORCE" = "1" ]; then
  echo "Already up to date, but running forced reinstall..."
else
  echo "Update found ($LOCAL -> $REMOTE), pulling..."
  git stash 2>&1 || true
  if ! git pull origin main 2>&1; then
    echo "ERROR: git pull failed"
    exit 1
  fi
fi

if [ "${CLEAN_INSTALL:-0}" = "1" ]; then
  echo "CLEAN_INSTALL=1 set — removing existing install/build artifacts..."
  rm -rf "$FAMCAL_DIR/backend/node_modules" \
         "$FAMCAL_DIR/frontend/node_modules" \
         "$FAMCAL_DIR/frontend/dist"
fi

# Reinstall backend deps if package.json changed (or forced)
if git diff "$LOCAL" HEAD --name-only 2>/dev/null | grep -q "backend/package.json" || [ "$EFFECTIVE_FORCE" = "1" ]; then
  echo "Installing backend dependencies..."
  if [ -f "$FAMCAL_DIR/backend/package-lock.json" ]; then
    cd "$FAMCAL_DIR/backend" && npm ci --omit=dev 2>&1
  else
    cd "$FAMCAL_DIR/backend" && npm install --production 2>&1
  fi
  cd "$FAMCAL_DIR"
fi

# Rebuild frontend if any frontend files changed (or forced)
if git diff "$LOCAL" HEAD --name-only 2>/dev/null | grep -q "^frontend/" || [ "$EFFECTIVE_FORCE" = "1" ]; then
  echo "Installing frontend dependencies..."
  if [ -f "$FAMCAL_DIR/frontend/package-lock.json" ]; then
    cd "$FAMCAL_DIR/frontend" && npm ci 2>&1
  else
    cd "$FAMCAL_DIR/frontend" && npm install 2>&1
  fi
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
sleep 2
sudo systemctl restart famcalendar-backend 2>&1

echo ""
echo "Update complete!"
echo "$(date): Update complete (${EFFECTIVE_FORCE} forced, pull=${FORCE_PULL:-0}, clean=${CLEAN_INSTALL:-0})" >> "$LOG"
