#!/bin/bash
# Replaces mjpeg-streamer with motion for CCTV motion detection + recording.
# Stream stays on port 8090, camera UI HTML stays on port 8091.
# Recordings saved to /media/famcalendar-data/recordings/
# Run as: sudo bash setup-motion.sh

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash setup-motion.sh"

if id "ubuntu" &>/dev/null; then FAMCAL_USER="ubuntu"
elif id "pi" &>/dev/null;    then FAMCAL_USER="pi"
else FAMCAL_USER=$(logname 2>/dev/null || echo "pi"); fi
info "Using user: $FAMCAL_USER"

FAMCAL_DIR="/home/$FAMCAL_USER/FamCalendar"
RECORDINGS_DIR="/media/famcalendar-data/recordings"
CAMERA_UI_DIR="/home/$FAMCAL_USER/camera-ui"

# ── 1. Stop and disable mjpeg-streamer ───────────────────────────────────────
info "Stopping mjpeg-streamer if running..."
systemctl stop mjpeg-streamer 2>/dev/null || true
systemctl disable mjpeg-streamer 2>/dev/null || true

# ── 2. Install motion ────────────────────────────────────────────────────────
info "Installing motion..."
apt-get update -qq
apt-get install -y motion

# ── 3. Create recordings directory ──────────────────────────────────────────
info "Creating recordings directory at $RECORDINGS_DIR..."
mkdir -p "$RECORDINGS_DIR"
chown "$FAMCAL_USER:$FAMCAL_USER" "$RECORDINGS_DIR"
# motion runs as the motion user by default — give it write access
chmod 775 "$RECORDINGS_DIR"
usermod -aG video "$FAMCAL_USER" 2>/dev/null || true

# Allow motion user to write recordings
if getent group motion > /dev/null 2>&1; then
  chgrp motion "$RECORDINGS_DIR" 2>/dev/null || true
fi

# ── 4. Write motion config ───────────────────────────────────────────────────
info "Writing /etc/motion/motion.conf..."
cat > /etc/motion/motion.conf << 'EOF'
# FamCalendar CCTV — motion config

daemon off   # systemd manages the process

# ── Camera ──────────────────────────────────────────────────────────────────
videodevice /dev/v4l/by-id/usb-Remo_Tech_Co.__Ltd._OBSBOT_Meet_SE-video-index0
v4l2_palette 8        # MJPEG — uses the camera's native compression (low CPU)
width 1920
height 1080
framerate 15          # 15fps is plenty for CCTV; keeps CPU load low

# ── MJPEG stream (replaces mjpeg-streamer on same port) ─────────────────────
stream_port 8090
stream_quality 80
stream_maxrate 15
stream_localhost off   # allow LAN access
stream_auth_method 0
stream_cors_header on  # required for cross-port browser requests

# ── Webcontrol (admin API — localhost only) ──────────────────────────────────
webcontrol_port 8092
webcontrol_localhost on
webcontrol_interface 0

# ── Motion detection ─────────────────────────────────────────────────────────
threshold 1500         # pixel change count to trigger detection
minimum_motion_frames 3
event_gap 15           # seconds of no motion before ending an event

# ── Recording ────────────────────────────────────────────────────────────────
target_dir /media/famcalendar-data/recordings
output_pictures off    # no per-frame JPEGs, just video clips
movie_output on
movie_max_time 120     # cap clips at 2 minutes
movie_quality 65       # H.264 quality (lower = smaller files)
movie_filename %Y%m%d-%H%M%S-%v

# ── Pre/post capture buffer ───────────────────────────────────────────────────
pre_capture 3          # seconds before motion to include
post_capture 5         # seconds after motion ends to include

# ── Logging — stdout only (captured by systemd journal in RAM, not SD card) ──
log_level 5
; log_file not set — do NOT write to /var/log to protect the SD card
EOF

# ── 5. Install updated camera UI HTML ───────────────────────────────────────
info "Installing camera UI to $CAMERA_UI_DIR..."
mkdir -p "$CAMERA_UI_DIR"
cp "$FAMCAL_DIR/scripts/camera-ui/index.html" "$CAMERA_UI_DIR/index.html"
chown -R "$FAMCAL_USER:$FAMCAL_USER" "$CAMERA_UI_DIR"

# Copy any existing icons if present
for f in icon.png icon-180.png; do
  SRC="$(dirname "$(find /home/$FAMCAL_USER -name "$f" 2>/dev/null | head -1)")"
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$CAMERA_UI_DIR/" 2>/dev/null || true
done

# ── 6. Install systemd services ─────────────────────────────────────────────
info "Installing systemd services..."

# motion service
cat > /etc/systemd/system/famcalendar-motion.service << EOF
[Unit]
Description=FamCalendar Motion CCTV
After=network.target
RequiresMountsFor=/media/famcalendar-data

[Service]
Type=simple
User=$FAMCAL_USER
Group=video
ExecStartPre=/bin/mkdir -p /media/famcalendar-data/recordings
ExecStart=/usr/bin/motion -c /etc/motion/motion.conf
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# camera UI web server service
cp "$FAMCAL_DIR/scripts/camera-ui.service" /etc/systemd/system/famcalendar-camera-ui.service
sed -i "s|__USER__|$FAMCAL_USER|g" /etc/systemd/system/famcalendar-camera-ui.service
sed -i "s|__UI_DIR__|$CAMERA_UI_DIR|g" /etc/systemd/system/famcalendar-camera-ui.service

systemctl daemon-reload
systemctl enable famcalendar-motion
systemctl enable famcalendar-camera-ui
systemctl start famcalendar-motion
systemctl start famcalendar-camera-ui

# ── 7. Done ──────────────────────────────────────────────────────────────────
info "=== Motion CCTV setup complete! ==="
echo ""
echo "  Stream:      http://$(hostname -I | awk '{print $1}'):8090/stream"
echo "  Camera UI:   http://$(hostname -I | awk '{print $1}'):8091"
echo "  Recordings:  $RECORDINGS_DIR"
echo "  Webcontrol:  http://localhost:8092"
echo ""
echo "Check status:   sudo systemctl status famcalendar-motion"
echo "Watch logs:     sudo journalctl -u famcalendar-motion -f"
echo "Tune detection: edit /etc/motion/motion.conf then sudo systemctl restart famcalendar-motion"
