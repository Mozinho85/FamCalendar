# FamCalendar

A self-hosted family calendar for a Raspberry Pi kiosk display.
Weekly view with a row per family member, Google Calendar sync, and a phone-friendly web UI for adding events.

---

## Hardware

- Raspberry Pi 4B (2GB+ RAM)
- 15" 1200p touchscreen (landscape)
- USB 3.0 stick or small SSD in USB enclosure (for database — protects SD card)
- Optional: UPS HAT for clean shutdowns during power cuts

---

## Architecture

```
┌─────────────────────────────────┐
│  Pi Display (Chromium kiosk)    │  localhost:3001
│  React app — full screen        │
└────────────┬────────────────────┘
             │ HTTP
┌────────────▼────────────────────┐
│  Node.js Backend                │  port 3001
│  Express API + Google sync      │
└────────────┬────────────────────┘
             │
     ┌───────┴────────┐
     │                │
┌────▼────┐    ┌──────▼──────┐
│ SQLite  │    │ Google Cal  │
│ on USB  │    │ sync every  │
│ stick   │    │ 15 minutes  │
└─────────┘    └─────────────┘
```

Phone web UI is served by the same backend on port 3001.
Access from any phone on your home network: `http://<pi-ip>:3001`

---

## Pi setup — step by step

### 1. Flash Raspberry Pi OS

Download **Raspberry Pi OS Bookworm (Desktop, 32-bit or 64-bit)** from raspberrypi.com/software.
Flash to SD card with Raspberry Pi Imager. In Imager settings: set hostname, username (`pi`), enable SSH, configure WiFi.

### 2. Set up SSH deploy key for GitHub

```bash
ssh pi@<pi-ip>
ssh-keygen -t ed25519 -f ~/.ssh/github_famcalendar -N ""
cat ~/.ssh/github_famcalendar.pub
```

Copy the output. Go to **github.com/Mozinho85/FamCalendar → Settings → Deploy keys → Add deploy key**.
Paste it in — read-only access is fine.

Then configure SSH to use the key:

```bash
nano ~/.ssh/config
```

```
Host github.com
  IdentityFile ~/.ssh/github_famcalendar
```

### 3. Clone the repo

```bash
cd ~
git clone git@github.com:Mozinho85/FamCalendar.git FamCalendar
```

### 4. Run the setup script

```bash
cd ~/FamCalendar
sudo bash scripts/setup-pi.sh
```

The script will:
- Install Node.js 20, Chromium, and dependencies
- Format and mount your USB stick (you'll be prompted)
- Set up tmpfs RAM disks for logs/cache (protects SD card from writes)
- Enable the hardware watchdog (auto-reboot on crash or lockup)
- Create and enable the `famcalendar-backend` systemd service
- Configure Chromium kiosk mode for Pi OS Bookworm (labwc/Wayland)
- Set up a nightly SQLite backup cron job
- Set up the auto-update cron job (checks GitHub every 5 minutes)

### 5. Set up Google OAuth credentials

1. Go to https://console.cloud.google.com
2. Create a project, enable the **Google Calendar API**
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
4. Application type: **Web application**
5. Authorised redirect URI: `http://<pi-ip>:3001/auth/google/callback`
6. Copy the Client ID and Client Secret

Edit the .env file on the Pi:

```bash
nano ~/FamCalendar/backend/.env
```

Fill in:

```
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
DB_PATH=/media/famcalendar-data/FamCalendar/data/events.db
```

Restart the backend:

```bash
sudo systemctl restart famcalendar-backend
```

### 6. Build the frontend

```bash
cd ~/FamCalendar/frontend
npm install
npm run build
```

### 7. Connect each family member's Google Calendar

For each person, open this on their phone while on home WiFi (replace the ID):

```
http://<pi-ip>:3001/auth/google/start?member_id=member-1
```

Get member IDs with:

```bash
curl http://localhost:3001/api/members
```

They'll be taken to Google's consent screen, then asked which calendars to sync.
Events appear on the display within a minute.

### 8. Reboot

```bash
sudo reboot
```

The Pi boots directly into the calendar in kiosk mode.

---

## Day-to-day workflow — pushing updates

Make changes on your computer, then:

```bash
git add .
git commit -m "describe what you changed"
git push
```

The Pi checks GitHub every 5 minutes. If there are new commits it will:
- Pull the changes
- Rebuild the frontend (only if frontend source files changed)
- Reinstall backend deps (only if package.json changed)
- Restart the backend

No manual SSH needed after initial setup.

---

## Managing family members

Open **Settings** (⚙ button, top right of the display or phone UI) to:
- Rename family members
- Change their colour
- Add new members
- Remove members

---

## Useful commands

```bash
# Check backend status
sudo systemctl status famcalendar-backend

# View backend logs live
sudo journalctl -u famcalendar-backend -f

# View update log
tail -f ~/FamCalendar/logs/update.log

# Trigger Google Calendar sync manually
curl -X POST http://localhost:3001/api/sync/now

# Check last sync times per person
curl http://localhost:3001/api/sync/status

# Inspect the database
sqlite3 /media/famcalendar-data/FamCalendar/data/events.db "SELECT title, start_datetime, source FROM events LIMIT 20;"

# Force a frontend rebuild
cd ~/FamCalendar/frontend && npm run build

# Force sync to GitHub main + clean reinstall + rebuild
cd ~/FamCalendar && FORCE_PULL=1 CLEAN_INSTALL=1 bash scripts/update.sh

# Restart backend
sudo systemctl restart famcalendar-backend
```

Notes:
- `FORCE_PULL=1` hard-resets the local repo to `origin/main` and removes untracked files.
- `CLEAN_INSTALL=1` removes `node_modules` and frontend `dist` before reinstall/build.
- This is intended for recovery when the Pi install gets into a bad state.

---

## Backups

Nightly backup runs at 3am, keeps 30 days of copies at:

```
~/FamCalendar/backups/events-YYYYMMDD.db
```

To restore:

```bash
sudo systemctl stop famcalendar-backend
cp ~/FamCalendar/backups/events-20260101.db /media/famcalendar-data/FamCalendar/data/events.db
sudo systemctl start famcalendar-backend
```

---

## Longevity

- Database on USB stick, not SD card — SD card only reads after setup
- tmpfs mounts keep log/cache writes in RAM
- SQLite WAL mode reduces write frequency significantly
- Hardware watchdog auto-reboots on lockup
- `Restart=always` in systemd means backend self-recovers after crashes

---

## Project structure

```
FamCalendar/
├── backend/
│   ├── src/
│   │   ├── index.js              # Express server + cron scheduler
│   │   ├── db/database.js        # SQLite, WAL mode, migrations
│   │   ├── routes/
│   │   │   ├── events.js         # CRUD for local events
│   │   │   ├── members.js        # Family member management
│   │   │   └── auth.js           # Google OAuth flow
│   │   └── services/
│   │       └── googleSync.js     # Incremental Google Calendar sync
│   ├── public/                   # Built React app (gitignored, built on Pi)
│   ├── .env                      # Your credentials (gitignored, never committed)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Calendar UI — weekly view, per-person rows
│   │   ├── App.css               # Dark kiosk theme
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── scripts/
│   ├── setup-pi.sh               # One-shot Pi setup
│   └── update.sh                 # GitHub auto-update (runs via cron)
└── README.md
```
