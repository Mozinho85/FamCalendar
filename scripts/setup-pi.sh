#!/bin/bash
# Skylight Calendar - Raspberry Pi 4B Setup Script
# Run as: sudo bash setup-pi.sh
# Tested on Raspberry Pi OS Bookworm (64-bit)

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash setup-pi.sh"

SKYLIGHT_USER="pi"
SKYLIGHT_DIR="/home/$SKYLIGHT_USER/skylight"
DATA_DIR="$SKYLIGHT_DIR/data"

info "=== Skylight Calendar Pi Setup ==="
echo ""

# ── 1. System updates ────────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ── 2. Install dependencies ───────────────────────────────────────────────────
info "Installing Node.js 20, Chromium, and utilities..."
apt-get install -y -qq \
  nodejs npm \
  chromium-browser \
  unclutter \
  xdotool \
  openbox \
  x11-xserver-utils \
  lightdm \
  curl \
  git \
  sqlite3 \
  watchdog \
  cronie \
  rsync

# Use Node 20 LTS if current version is too old
NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
if [ "$NODE_VERSION" -lt 18 ]; then
  info "Upgrading Node.js to v20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

info "Node $(node --version), npm $(npm --version)"

# ── 3. USB stick setup ────────────────────────────────────────────────────────
info "Setting up USB storage for database..."
echo ""
echo "Plug in your USB stick and press ENTER (or CTRL+C to skip and use SD card)"
read -r

USB_DEV=$(lsblk -rno NAME,TYPE,TRAN | awk '$2=="disk" && $3=="usb" {print $1}' | head -1)

if [ -n "$USB_DEV" ]; then
  USB_PART="/dev/${USB_DEV}1"
  USB_MOUNT="/media/skylight-data"

  info "Found USB device: $USB_DEV"
  mkdir -p "$USB_MOUNT"

  # Format if not already formatted
  FS_TYPE=$(blkid -o value -s TYPE "$USB_PART" 2>/dev/null || echo "")
  if [ "$FS_TYPE" != "ext4" ]; then
    warn "Formatting $USB_PART as ext4 (ALL DATA ON IT WILL BE LOST)"
    echo "Press ENTER to confirm, CTRL+C to cancel"
    read -r
    mkfs.ext4 -L skylight-data "$USB_PART"
  fi

  USB_UUID=$(blkid -o value -s UUID "$USB_PART")
  # Add to fstab for auto-mount on boot
  if ! grep -q "$USB_UUID" /etc/fstab; then
    echo "UUID=$USB_UUID $USB_MOUNT ext4 defaults,noatime 0 2" >> /etc/fstab
    info "Added USB to /etc/fstab (UUID: $USB_UUID)"
  fi

  mount -a
  mkdir -p "$USB_MOUNT/skylight"
  chown -R "$SKYLIGHT_USER:$SKYLIGHT_USER" "$USB_MOUNT/skylight"
  DATA_DIR="$USB_MOUNT/skylight"
  info "Database will live on USB: $DATA_DIR"
else
  warn "No USB device found — database will use SD card at $DATA_DIR"
  warn "Consider adding a USB stick for better SD card longevity"
fi

# ── 4. tmpfs RAM disk (protect SD card from log writes) ──────────────────────
info "Configuring tmpfs RAM disk for logs and browser cache..."
if ! grep -q "tmpfs /tmp" /etc/fstab; then
  cat >> /etc/fstab << 'EOF'
tmpfs /tmp              tmpfs defaults,noatime,nosuid,size=64m  0 0
tmpfs /var/log          tmpfs defaults,noatime,nosuid,size=32m  0 0
tmpfs /var/tmp          tmpfs defaults,noatime,nosuid,size=16m  0 0
EOF
  info "tmpfs entries added to /etc/fstab"
fi

# ── 5. Hardware watchdog ──────────────────────────────────────────────────────
info "Enabling hardware watchdog..."
if ! grep -q "dtparam=watchdog=on" /boot/firmware/config.txt 2>/dev/null; then
  echo "dtparam=watchdog=on" >> /boot/firmware/config.txt
fi

cat > /etc/watchdog.conf << 'EOF'
watchdog-device = /dev/watchdog
watchdog-timeout = 15
max-load-1 = 24
interval = 10
EOF

systemctl enable watchdog
systemctl start watchdog

# ── 6. Deploy Skylight backend ────────────────────────────────────────────────
info "Setting up Skylight application..."
mkdir -p "$SKYLIGHT_DIR"
mkdir -p "$DATA_DIR"
chown -R "$SKYLIGHT_USER:$SKYLIGHT_USER" "$SKYLIGHT_DIR"

# Write the DATA_DIR into the .env
if [ ! -f "$SKYLIGHT_DIR/backend/.env" ]; then
  if [ -f "$SKYLIGHT_DIR/backend/.env.example" ]; then
    cp "$SKYLIGHT_DIR/backend/.env.example" "$SKYLIGHT_DIR/backend/.env"
    sed -i "s|DB_PATH=.*|DB_PATH=$DATA_DIR/events.db|" "$SKYLIGHT_DIR/backend/.env"
    SESSION_SECRET=$(openssl rand -hex 32)
    sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|" "$SKYLIGHT_DIR/backend/.env"
    info "Created .env — edit $SKYLIGHT_DIR/backend/.env to add your Google credentials"
  fi
fi

# Install npm dependencies
if [ -f "$SKYLIGHT_DIR/backend/package.json" ]; then
  info "Installing Node dependencies..."
  cd "$SKYLIGHT_DIR/backend"
  sudo -u "$SKYLIGHT_USER" npm install --production
fi

# ── 7. systemd service for backend ───────────────────────────────────────────
info "Creating systemd service for Skylight backend..."
cat > /etc/systemd/system/skylight-backend.service << EOF
[Unit]
Description=Skylight Calendar Backend
After=network.target

[Service]
Type=simple
User=$SKYLIGHT_USER
WorkingDirectory=$SKYLIGHT_DIR/backend
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable skylight-backend
systemctl start skylight-backend

# ── 8. Kiosk display setup ────────────────────────────────────────────────────
info "Configuring kiosk display (landscape, 1200p)..."

# Set display rotation if needed (0=normal landscape, 1=90°, 2=180°, 3=270°)
if ! grep -q "display_rotate" /boot/firmware/config.txt 2>/dev/null; then
  echo "display_rotate=0" >> /boot/firmware/config.txt
fi

# Auto-login to desktop for kiosk user
mkdir -p /etc/lightdm
cat > /etc/lightdm/lightdm.conf << EOF
[Seat:*]
autologin-user=$SKYLIGHT_USER
autologin-user-timeout=0
user-session=openbox
EOF

# Openbox autostart — launches Chromium in kiosk mode
mkdir -p "/home/$SKYLIGHT_USER/.config/openbox"
cat > "/home/$SKYLIGHT_USER/.config/openbox/autostart" << 'AUTOSTART'
# Disable screen blanking and power management
xset s off
xset s noblank
xset -dpms

# Hide the cursor after 1 second of inactivity
unclutter -idle 1 -root &

# Wait for the backend to be ready
sleep 5

# Launch Chromium in kiosk mode
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --disk-cache-dir=/tmp/chromium-cache \
  --disk-cache-size=52428800 \
  http://localhost:3000 &
AUTOSTART

chown -R "$SKYLIGHT_USER:$SKYLIGHT_USER" "/home/$SKYLIGHT_USER/.config"

# ── 9. Backup cron job ────────────────────────────────────────────────────────
info "Setting up nightly database backup..."
BACKUP_SCRIPT="/home/$SKYLIGHT_USER/skylight/scripts/backup.sh"

cat > "$BACKUP_SCRIPT" << BACKUP
#!/bin/bash
# Skylight nightly backup
DB_PATH="$DATA_DIR/events.db"
BACKUP_DIR="$SKYLIGHT_DIR/backups"
mkdir -p "\$BACKUP_DIR"

# Keep last 30 days
DEST="\$BACKUP_DIR/events-\$(date +%Y%m%d).db"
sqlite3 "\$DB_PATH" ".backup '\$DEST'"

# Remove backups older than 30 days
find "\$BACKUP_DIR" -name "events-*.db" -mtime +30 -delete

echo "\$(date): Backup complete -> \$DEST"
BACKUP

chmod +x "$BACKUP_SCRIPT"
chown "$SKYLIGHT_USER:$SKYLIGHT_USER" "$BACKUP_SCRIPT"

# Add cron job
(crontab -u "$SKYLIGHT_USER" -l 2>/dev/null; echo "0 3 * * * $BACKUP_SCRIPT >> $SKYLIGHT_DIR/logs/backup.log 2>&1") | \
  sort -u | crontab -u "$SKYLIGHT_USER" -

mkdir -p "$SKYLIGHT_DIR/logs"
chown -R "$SKYLIGHT_USER:$SKYLIGHT_USER" "$SKYLIGHT_DIR"

# ── 10. Done ──────────────────────────────────────────────────────────────────
echo ""
info "=== Setup complete! ==="
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Edit $SKYLIGHT_DIR/backend/.env — add your Google OAuth credentials"
echo "  2. Build and copy the React frontend to $SKYLIGHT_DIR/backend/public/"
echo "  3. Run: sudo systemctl restart skylight-backend"
echo "  4. Reboot: sudo reboot"
echo ""
echo -e "${YELLOW}Google OAuth setup:${NC}"
echo "  1. Go to https://console.cloud.google.com"
echo "  2. Create a project, enable Google Calendar API"
echo "  3. Create OAuth2 credentials (Web application)"
echo "  4. Add http://<pi-ip>:3001/auth/google/callback as redirect URI"
echo "  5. Paste client ID and secret into .env"
echo ""
echo -e "${YELLOW}Connect a family member's Google Calendar:${NC}"
echo "  Open http://<pi-ip>:3001/auth/google/start?member_id=<id> on their phone"
echo ""
