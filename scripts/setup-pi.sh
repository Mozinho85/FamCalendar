#!/bin/bash
# FamCalendar - Setup Script
# Supports: Ubuntu Server 24.04 LTS and Raspberry Pi OS Bookworm
# Run as: sudo bash setup-pi.sh

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash setup-pi.sh"

# ── Detect distro ─────────────────────────────────────────────────────────────
DISTRO_ID=$(grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
DISTRO_VERSION=$(grep '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
info "Detected OS: $DISTRO_ID $DISTRO_VERSION"

IS_UBUNTU=false
IS_PIOS=false
[[ "$DISTRO_ID" == "ubuntu" ]] && IS_UBUNTU=true
[[ "$DISTRO_ID" == "raspbian" || "$DISTRO_ID" == "debian" ]] && IS_PIOS=true

# ── Detect logged-in user ─────────────────────────────────────────────────────
# On Ubuntu Server the default user is 'ubuntu', Pi OS uses 'pi'
if id "ubuntu" &>/dev/null; then
  FAMCAL_USER="ubuntu"
elif id "pi" &>/dev/null; then
  FAMCAL_USER="pi"
else
  FAMCAL_USER=$(logname 2>/dev/null || echo "pi")
fi
info "Using user: $FAMCAL_USER"

FAMCAL_DIR="/home/$FAMCAL_USER/FamCalendar"
DATA_DIR="$FAMCAL_DIR/data"

info "=== FamCalendar Setup ==="
echo ""

# ── 1. System updates ─────────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ── 2. Install Node.js 20 ─────────────────────────────────────────────────────
info "Installing Node.js 20..."
NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
if [ "$NODE_VERSION" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
info "Node $(node --version), npm $(npm --version)"

# ── 3. Install display & kiosk packages ───────────────────────────────────────
info "Installing display and kiosk packages..."

if $IS_UBUNTU; then
  # Ubuntu Server — install minimal Wayland kiosk stack
  # cage is a Wayland compositor designed specifically for single-app kiosks
  apt-get install -y \
    cage \
    xwayland \
    curl \
    git \
    sqlite3 \
    watchdog \
    cron \
    rsync \
    unzip \
    libgtk-3-0 \
    libnss3 \
    libxss1 \
    libasound2t64 \
    fonts-liberation

  # Chromium on Ubuntu — snap version often has issues in kiosk mode, use the deb
  apt-get install -y chromium-browser 2>/dev/null || \
  apt-get install -y chromium 2>/dev/null || \
  snap install chromium

  # Detect chromium binary name
  if command -v chromium-browser &>/dev/null; then
    CHROMIUM_BIN="chromium-browser"
  elif command -v chromium &>/dev/null; then
    CHROMIUM_BIN="chromium"
  else
    CHROMIUM_BIN="chromium"
  fi

  # Auto-login service for kiosk user
  mkdir -p /etc/systemd/system/getty@tty1.service.d
  cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $FAMCAL_USER --noclear %I \$TERM
EOF

  # Bash profile launches cage+chromium on tty1 login
  cat > "/home/$FAMCAL_USER/.bash_profile" << PROFILE
# Only launch kiosk on tty1
if [ "\$(tty)" = "/dev/tty1" ]; then
  until curl -s http://localhost:3001/health > /dev/null 2>&1; do sleep 1; done
  exec cage -- $CHROMIUM_BIN \
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
    http://localhost:3001
fi
PROFILE
  chown "$FAMCAL_USER:$FAMCAL_USER" "/home/$FAMCAL_USER/.bash_profile"
  info "Kiosk configured: cage + Chromium on tty1 autologin"

else
  # Raspberry Pi OS — uses labwc/Wayland on Bookworm
  apt-get install -y \
    chromium-browser \
    curl \
    git \
    sqlite3 \
    watchdog \
    cron \
    rsync
  CHROMIUM_BIN="chromium-browser"

  # Configure labwc autostart
  mkdir -p "/home/$FAMCAL_USER/.config/labwc"
  cat > "/home/$FAMCAL_USER/.config/labwc/autostart" << AUTOSTART
until curl -s http://localhost:3001/health > /dev/null; do sleep 1; done
$CHROMIUM_BIN \
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
  http://localhost:3001 &
AUTOSTART
  chown -R "$FAMCAL_USER:$FAMCAL_USER" "/home/$FAMCAL_USER/.config"
  info "Kiosk configured: labwc + Chromium"
fi

# ── 4. USB stick setup ────────────────────────────────────────────────────────
info "USB storage setup..."
echo ""
echo "Plug in your USB stick now and press ENTER, or CTRL+C to use the SD card"
read -r

USB_DEV=$(lsblk -rno NAME,TYPE,TRAN | awk '$2=="disk" && $3=="usb" {print $1}' | head -1)

if [ -n "$USB_DEV" ]; then
  USB_PART="/dev/${USB_DEV}1"
  USB_MOUNT="/media/famcalendar-data"
  info "Found USB: $USB_DEV"
  mkdir -p "$USB_MOUNT"

  FS_TYPE=$(blkid -o value -s TYPE "$USB_PART" 2>/dev/null || echo "")
  if [ "$FS_TYPE" != "ext4" ]; then
    warn "Formatting $USB_PART as ext4 — ALL DATA ON IT WILL BE LOST"
    echo "Press ENTER to confirm or CTRL+C to cancel"
    read -r
    mkfs.ext4 -L famcalendar-data "$USB_PART"
  fi

  USB_UUID=$(blkid -o value -s UUID "$USB_PART")
  if ! grep -q "$USB_UUID" /etc/fstab; then
    echo "UUID=$USB_UUID $USB_MOUNT ext4 defaults,noatime 0 2" >> /etc/fstab
    info "Added USB to /etc/fstab"
  fi
  mount -a
  mkdir -p "$USB_MOUNT/FamCalendar"
  chown -R "$FAMCAL_USER:$FAMCAL_USER" "$USB_MOUNT/FamCalendar"
  DATA_DIR="$USB_MOUNT/FamCalendar"
  info "Database on USB: $DATA_DIR"
else
  warn "No USB found — using SD card at $DATA_DIR"
fi

# ── 5. tmpfs RAM disk ─────────────────────────────────────────────────────────
info "Configuring tmpfs RAM disks..."
if ! grep -q "tmpfs /tmp" /etc/fstab; then
  cat >> /etc/fstab << 'EOF'
tmpfs /tmp     tmpfs defaults,noatime,nosuid,size=64m 0 0
tmpfs /var/tmp tmpfs defaults,noatime,nosuid,size=16m 0 0
EOF
  info "tmpfs added to /etc/fstab"
fi

# ── 6. Hardware watchdog ──────────────────────────────────────────────────────
info "Enabling hardware watchdog..."
BOOT_CONFIG="/boot/firmware/config.txt"
[ -f "$BOOT_CONFIG" ] && grep -q "dtparam=watchdog" "$BOOT_CONFIG" || \
  echo "dtparam=watchdog=on" >> "$BOOT_CONFIG"

cat > /etc/watchdog.conf << 'EOF'
watchdog-device = /dev/watchdog
watchdog-timeout = 15
max-load-1 = 24
interval = 10
EOF
systemctl enable watchdog 2>/dev/null || true
systemctl start watchdog 2>/dev/null || true

# ── 7. FamCalendar backend ────────────────────────────────────────────────────
info "Setting up FamCalendar backend..."
mkdir -p "$DATA_DIR"
mkdir -p "$FAMCAL_DIR/logs"
chown -R "$FAMCAL_USER:$FAMCAL_USER" "$FAMCAL_DIR"

# Create .env if it doesn't exist
if [ ! -f "$FAMCAL_DIR/backend/.env" ]; then
  cp "$FAMCAL_DIR/backend/.env.example" "$FAMCAL_DIR/backend/.env"
  sed -i "s|DB_PATH=.*|DB_PATH=$DATA_DIR/events.db|" "$FAMCAL_DIR/backend/.env"
  SESSION_SECRET=$(openssl rand -hex 32)
  sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|" "$FAMCAL_DIR/backend/.env"
  info "Created .env — add your Google credentials before rebooting"
fi

# Install backend npm deps
info "Installing backend dependencies..."
cd "$FAMCAL_DIR/backend"
sudo -u "$FAMCAL_USER" npm install --production

# Build frontend
info "Building frontend..."
cd "$FAMCAL_DIR/frontend"
sudo -u "$FAMCAL_USER" npm install
sudo -u "$FAMCAL_USER" npm run build

# ── 8. Systemd backend service ────────────────────────────────────────────────
info "Creating famcalendar-backend systemd service..."
NODE_PATH=$(which node)
cat > /etc/systemd/system/famcalendar-backend.service << EOF
[Unit]
Description=FamCalendar Backend
After=network.target

[Service]
Type=simple
User=$FAMCAL_USER
WorkingDirectory=$FAMCAL_DIR/backend
ExecStart=$NODE_PATH src/index.js
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

# ── 9. Boot-time GitHub update service ───────────────────────────────────────
info "Installing boot-time update service..."
cp "$FAMCAL_DIR/scripts/famcalendar-update-boot.service" \
   /etc/systemd/system/famcalendar-update-boot.service
# Patch user into service file
sed -i "s/User=pi/User=$FAMCAL_USER/" \
  /etc/systemd/system/famcalendar-update-boot.service
systemctl daemon-reload
systemctl enable famcalendar-update-boot

# ── 10. Cron jobs ─────────────────────────────────────────────────────────────
info "Setting up cron jobs..."

BACKUP_SCRIPT="$FAMCAL_DIR/scripts/backup.sh"
UPDATE_SCRIPT="$FAMCAL_DIR/scripts/update.sh"

cat > "$BACKUP_SCRIPT" << BACKUP
#!/bin/bash
DB_PATH="$DATA_DIR/events.db"
BACKUP_DIR="$FAMCAL_DIR/backups"
mkdir -p "\$BACKUP_DIR"
DEST="\$BACKUP_DIR/events-\$(date +%Y%m%d).db"
sqlite3 "\$DB_PATH" ".backup '\$DEST'"
find "\$BACKUP_DIR" -name "events-*.db" -mtime +30 -delete
echo "\$(date): Backup -> \$DEST"
BACKUP

chmod +x "$BACKUP_SCRIPT" "$UPDATE_SCRIPT"
chown "$FAMCAL_USER:$FAMCAL_USER" "$BACKUP_SCRIPT"

(
  crontab -u "$FAMCAL_USER" -l 2>/dev/null
  echo "0 3 * * * $BACKUP_SCRIPT >> $FAMCAL_DIR/logs/backup.log 2>&1"
  echo "*/5 * * * * $UPDATE_SCRIPT >> $FAMCAL_DIR/logs/update.log 2>&1"
) | sort -u | crontab -u "$FAMCAL_USER" -

chown -R "$FAMCAL_USER:$FAMCAL_USER" "$FAMCAL_DIR"

# ── 11. SSH deploy key reminder ───────────────────────────────────────────────
echo ""
info "=== Setup complete! ==="
echo ""
echo -e "${YELLOW}If you haven't already, generate a deploy key for GitHub:${NC}"
echo "  ssh-keygen -t ed25519 -f ~/.ssh/github_famcalendar -N \"\""
echo "  cat ~/.ssh/github_famcalendar.pub"
echo "  Add it at: github.com/Mozinho85/FamCalendar → Settings → Deploy keys"
echo ""
echo -e "${YELLOW}Then add to ~/.ssh/config:${NC}"
echo "  Host github.com"
echo "    IdentityFile ~/.ssh/github_famcalendar"
echo ""
echo -e "${YELLOW}Edit your Google credentials:${NC}"
echo "  nano $FAMCAL_DIR/backend/.env"
echo ""
echo -e "${YELLOW}Then reboot:${NC}"
echo "  sudo reboot"
echo ""
