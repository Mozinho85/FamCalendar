#!/bin/bash
# FamCalendar - Raspberry Pi 4B Setup Script
# Run as: sudo bash setup-pi.sh
# Tested on Raspberry Pi OS Bookworm (64-bit)

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash setup-pi.sh"

FAMCAL_USER="pi"
FAMCAL_DIR="/home/$FAMCAL_USER/FamCalendar"
DATA_DIR="$FAMCAL_DIR/data"

info "=== FamCalendar Pi Setup ==="
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
  cron \
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
  USB_MOUNT="/media/famcalendar-data"

  info "Found USB device: $USB_DEV"
  mkdir -p "$USB_MOUNT"

  # Format if not already formatted
  FS_TYPE=$(blkid -o value -s TYPE "$USB_PART" 2>/dev/null || echo "")
  if [ "$FS_TYPE" != "ext4" ]; then
    warn "Formatting $USB_PART as ext4 (ALL DATA ON IT WILL BE LOST)"
    echo "Press ENTER to confirm, CTRL+C to cancel"
    read -r
    mkfs.ext4 -L famcalendar-data "$USB_PART"
  fi

  USB_UUID=$(blkid -o value -s UUID "$USB_PART")
  # Add to fstab for auto-mount on boot
  if ! grep -q "$USB_UUID" /etc/fstab; then
    echo "UUID=$USB_UUID $USB_MOUNT ext4 defaults,noatime 0 2" >> /etc/fstab
    info "Added USB to /etc/fstab (UUID: $USB_UUID)"
  fi

  mount -a
  mkdir -p "$USB_MOUNT/FamCalendar"
  chown -R "$FAMCAL_USER:$FAMCAL_USER" "$USB_MOUNT/FamCalendar"
  DATA_DIR="$USB_MOUNT/FamCalendar"
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

# ── 6. Deploy FamCalendar backend ────────────────────────────────────────────────
info "Setting up FamCalendar application..."
mkdir -p "$FAMCAL_DIR"
mkdir -p "$DATA_DIR"
chown -R "$FAMCAL_USER:$FAMCAL_USER" "$FAMCAL_DIR"

# Write the DATA_DIR into the .env
if [ ! -f "$FAMCAL_DIR/backend/.env" ]; then
  if [ -f "$FAMCAL_DIR/backend/.env.example" ]; then
    cp "$FAMCAL_DIR/backend/.env.example" "$FAMCAL_DIR/backend/.env"
    sed -i "s|DB_PATH=.*|DB_PATH=$DATA_DIR/events.db|" "$FAMCAL_DIR/backend/.env"
    SESSION_SECRET=$(openssl rand -hex 32)
    sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|" "$FAMCAL_DIR/backend/.env"
    info "Created .env — edit $FAMCAL_DIR/backend/.env to add your Google credentials"
  fi
fi

# Install npm dependencies
if [ -f "$FAMCAL_DIR/backend/package.json" ]; then
  info "Installing Node dependencies..."
  cd "$FAMCAL_DIR/backend"
  sudo -u "$FAMCAL_USER" npm install --production
fi

# ── 7. systemd service for backend ───────────────────────────────────────────
info "Creating systemd service for FamCalendar backend..."
cat > /etc/systemd/system/famcalendar-backend.service << EOF
[Unit]
Description=FamCalendar Backend
After=network.target

[Service]
Type=simple
User=$FAMCAL_USER
WorkingDirectory=$FAMCAL_DIR/backend
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
systemctl enable famcalendar-backend
systemctl start famcalendar-backend

# ── 8. Kiosk display setup ────────────────────────────────────────────────────
info "Configuring kiosk display (landscape, 1200p)..."

# Set display rotation if needed (0=normal landscape, 1=90°, 2=180°, 3=270°)
if ! grep -q "display_rotate" /boot/firmware/config.txt 2>/dev/null; then
  echo "display_rotate=0" >> /boot/firmware/config.txt
fi

# Pi OS Bookworm uses labwc (Wayland) not Openbox — configure labwc autostart
info "Configuring labwc autostart for Chromium kiosk..."
mkdir -p "/home/$FAMCAL_USER/.config/labwc"
cat > "/home/$FAMCAL_USER/.config/labwc/autostart" << 'AUTOSTART'
# Wait until the backend is actually responding before launching Chromium
until curl -s http://localhost:3001/health > /dev/null; do sleep 1; done

# Launch Chromium in kiosk mode (Wayland)
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --ozone-platform=wayland \
  --disable-features=TranslateUI \
  --password-store=basic \
  --use-mock-keychain \
  --check-for-update-interval=31536000 \
  --disk-cache-dir=/tmp/chromium-cache \
  --disk-cache-size=52428800 \
  http://localhost:3001 &
AUTOSTART

chown -R "$FAMCAL_USER:$FAMCAL_USER" "/home/$FAMCAL_USER/.config"

# ── 9. Backup cron job ────────────────────────────────────────────────────────
info "Setting up nightly database backup..."
BACKUP_SCRIPT="/home/$FAMCAL_USER/FamCalendar/scripts/backup.sh"

cat > "$BACKUP_SCRIPT" << BACKUP
#!/bin/bash
# FamCalendar nightly backup
DB_PATH="$DATA_DIR/events.db"
BACKUP_DIR="$FAMCAL_DIR/backups"
mkdir -p "\$BACKUP_DIR"

# Keep last 30 days
DEST="\$BACKUP_DIR/events-\$(date +%Y%m%d).db"
sqlite3 "\$DB_PATH" ".backup '\$DEST'"

# Remove backups older than 30 days
find "\$BACKUP_DIR" -name "events-*.db" -mtime +30 -delete

echo "\$(date): Backup complete -> \$DEST"
BACKUP

chmod +x "$BACKUP_SCRIPT"
chown "$FAMCAL_USER:$FAMCAL_USER" "$BACKUP_SCRIPT"

# Add backup + auto-update cron jobs
UPDATE_SCRIPT="$FAMCAL_DIR/scripts/update.sh"
chmod +x "$UPDATE_SCRIPT"
(
  crontab -u "$FAMCAL_USER" -l 2>/dev/null
  echo "0 3 * * * $BACKUP_SCRIPT >> $FAMCAL_DIR/logs/backup.log 2>&1"
  echo "*/5 * * * * $UPDATE_SCRIPT >> $FAMCAL_DIR/logs/update.log 2>&1"
) | sort -u | crontab -u "$FAMCAL_USER" -
info "Auto-update cron set — Pi will check GitHub every 5 minutes"

mkdir -p "$FAMCAL_DIR/logs"
chown -R "$FAMCAL_USER:$FAMCAL_USER" "$FAMCAL_DIR"

# ── 10. Done ──────────────────────────────────────────────────────────────────
echo ""
info "=== Setup complete! ==="
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Edit $FAMCAL_DIR/backend/.env — add your Google OAuth credentials"
echo "  2. Build and copy the React frontend to $FAMCAL_DIR/backend/public/"
echo "  3. Run: sudo systemctl restart famcalendar-backend"
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
