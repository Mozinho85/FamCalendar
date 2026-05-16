# Skylight Calendar — Raspberry Pi 4B Kiosk

A self-hosted family calendar display for a 15" 1200p landscape touchscreen.
Local SQLite database, Google Calendar sync per person, phone web UI for adding events.

---

## Hardware

- Raspberry Pi 4B (2GB+ RAM)
- 15" 1200p touchscreen (landscape)
- USB 3.0 stick or small SSD in USB enclosure (for database storage)
- Optional: UPS HAT for clean shutdowns during power cuts

---

## Architecture

```
┌─────────────────────────────────┐
│  Pi Display (Chromium kiosk)    │  localhost:3000
│  React app — full screen        │
└────────────┬────────────────────┘
             │ HTTP
┌────────────▼────────────────────┐
│  Node.js Backend               │  localhost:3001
│  Express API + cron sync        │
└────────────┬────────────────────┘
             │
     ┌───────┴────────┐
     │                │
┌────▼────┐    ┌──────▼──────┐
│ SQLite  │    │ Google Cal  │
│ on USB  │    │ API (sync   │
│ stick   │    │ every 15m)  │
└─────────┘    └─────────────┘
```

Phone web UI is served by the same backend on port 3001.
Access from any phone on your home network: `http://<pi-ip>:3001`

---

## Step-by-step setup

### 1. Flash Raspberry Pi OS

Download **Raspberry Pi OS Bookworm (64-bit, Desktop)** from raspberrypi.com/software.
Flash to SD card with Raspberry Pi Imager.
In Imager settings: set hostname, username (`pi`), enable SSH, set WiFi.

### 2. Copy project files to the Pi

```bash
# From your computer
scp -r skylight/ pi@<pi-ip>:~/skylight
```

Or clone from your git repo if you've pushed it there.

### 3. Run the setup script

```bash
ssh pi@<pi-ip>
cd ~/skylight
sudo bash scripts/setup-pi.sh
```

The script will:
- Install Node.js 20, Chromium, and all dependencies
- Format and mount your USB stick (you'll be prompted)
- Set up tmpfs RAM disks for logs/cache (protects SD card)
- Enable the hardware watchdog (auto-reboot on crash)
- Create and enable the `skylight-backend` systemd service
- Configure Chromium kiosk mode in Openbox autostart
- Set up a nightly SQLite backup cron job

### 4. Set up Google OAuth credentials

1. Go to https://console.cloud.google.com
2. Create a new project (e.g. "Skylight Calendar")
3. Enable the **Google Calendar API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
5. Application type: **Web application**
6. Authorised redirect URI: `http://<pi-ip>:3001/auth/google/callback`
   (also add `http://localhost:3001/auth/google/callback` for testing)
7. Download the credentials JSON and copy the Client ID and Client Secret

Edit the .env file:
```bash
nano ~/skylight/backend/.env
```

Fill in:
```
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
DB_PATH=/media/skylight-data/skylight/events.db
```

Restart the backend:
```bash
sudo systemctl restart skylight-backend
```

### 5. Connect each family member's Google Calendar

For each family member, open this URL on their phone (while on your home WiFi):

```
http://<pi-ip>:3001/auth/google/start?member_id=<id>
```

To get the member IDs:
```bash
curl http://localhost:3001/api/members
```

Default member IDs after fresh install: `member-1` through `member-4`.

The person will be taken to Google's consent screen, then returned to a page
where they choose which of their calendars to sync. Their events will appear
on the display within a minute.

### 6. Build and deploy the React frontend

```bash
cd ~/skylight/frontend
npm install
npm run build
# This builds into ~/skylight/backend/public/ automatically
```

### 7. Reboot

```bash
sudo reboot
```

The Pi will boot directly into Chromium kiosk mode showing the calendar.

---

## Customising family members

Edit names and colours via the API (from any device on the network):

```bash
# List members
curl http://<pi-ip>:3001/api/members

# Update a member's name and colour
curl -X PUT http://<pi-ip>:3001/api/members/member-1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "color": "#e2719a"}'

# Add a new member
curl -X POST http://<pi-ip>:3001/api/members \
  -H "Content-Type: application/json" \
  -d '{"name": "Gran", "color": "#4fc3a1"}'
```

A proper settings UI for this is on the roadmap.

---

## Adding events from a phone

Open `http://<pi-ip>:3001` on any phone on your home WiFi.
The same React app loads and you can add/view events.

Note: events added here are stored on the Pi's database (not on your phone,
and not pushed back to Google Calendar). Google Calendar events are read-only
on the Pi — to edit them, change them in Google Calendar and they'll sync back
within 15 minutes, or tap "Sync now" in the phone UI.

---

## Useful commands

```bash
# Check backend status
sudo systemctl status skylight-backend

# View backend logs (live)
sudo journalctl -u skylight-backend -f

# Trigger manual Google sync
curl -X POST http://localhost:3001/api/sync/now

# Check last sync times
curl http://localhost:3001/api/sync/status

# Inspect the database directly
sqlite3 /media/skylight-data/skylight/events.db ".tables"
sqlite3 /media/skylight-data/skylight/events.db "SELECT title, start_datetime, source FROM events LIMIT 20;"

# Restart everything
sudo systemctl restart skylight-backend

# Exit kiosk mode temporarily (SSH in and kill Chromium)
pkill chromium-browser
```

---

## Backups

The nightly backup runs at 3am and keeps 30 days of copies:

```
~/skylight/backups/events-YYYYMMDD.db
```

To restore from a backup:
```bash
sudo systemctl stop skylight-backend
cp ~/skylight/backups/events-20260101.db /media/skylight-data/skylight/events.db
sudo systemctl start skylight-backend
```

---

## Longevity notes

- Database lives on USB stick, not SD card — SD card only reads after setup
- tmpfs mounts absorb log writes into RAM (cleared on reboot, that's fine)
- SQLite WAL mode reduces write frequency by ~10x vs default journal mode
- Hardware watchdog auto-reboots if the system locks up
- `Restart=always` in systemd means the backend and Chromium self-recover
- The setup script sets `--disk-cache-dir=/tmp/chromium-cache` so Chromium's
  cache also goes to RAM, not storage

---

## Project structure

```
skylight/
├── backend/
│   ├── src/
│   │   ├── index.js           # Express server + cron scheduler
│   │   ├── db/database.js     # SQLite setup, WAL mode, migrations
│   │   ├── routes/
│   │   │   ├── events.js      # CRUD for local events
│   │   │   ├── members.js     # Family member management
│   │   │   └── auth.js        # Google OAuth flow
│   │   └── services/
│   │       └── googleSync.js  # Incremental Google Calendar sync
│   ├── public/                # Built React app (served statically)
│   ├── .env                   # Your credentials (not in git)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Full calendar UI
│   │   ├── App.css            # Kiosk-optimised dark theme
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── scripts/
│   ├── setup-pi.sh            # One-shot Pi configuration
│   └── backup.sh              # Generated by setup script
└── README.md
```
