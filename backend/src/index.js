require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const eventsRouter  = require('./routes/events');
const membersRouter = require('./routes/members');
const authRouter    = require('./routes/auth');
const { syncAllMembers } = require('./services/googleSync');
const { syncAllIcal }   = require('./services/icalSync');

const app = express();
const PORT = process.env.PORT || 3001;
const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL_MINUTES || '15', 10);

// Allow requests from the kiosk frontend (same machine) and phones on the local network
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, same-origin) and anything on the LAN
    if (!origin) return cb(null, true);
    const allowed =
      origin.startsWith('http://192.168.') ||
      origin.startsWith('http://10.')      ||
      origin.startsWith('http://172.')     ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://pi.local');
    allowed ? cb(null, true) : cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

app.use(express.json());

// One-time cleanup: remove the shared-events member if it exists from a previous install
(function cleanupSharedMember() {
  const db = require('./db/database');
  db.prepare("DELETE FROM events WHERE member_id = 'family-shared-events'").run();
  db.prepare("DELETE FROM family_members WHERE id = 'family-shared-events'").run();
})();

// API routes
app.use('/api/events',  eventsRouter);
app.use('/api/members', membersRouter);
app.use('/auth',        authRouter);

// App settings — shared across all devices
const SETTINGS_DEFAULTS = {
  locationName: "Ammanford",
  locationLat: 51.7956,
  locationLon: -3.9994,
  timezone: "Europe/London",
  tempUnit: "celsius",
  ambientIdleMinutes: 2,
  ambientBackground: "none",            // "none" | "slideshow"
  ambientSlideshowInterval: 30,         // seconds between slides
  tapSound: "mechanical",               // "mechanical" | "crisp" | "soft" | "off"
  ambientShowHourly: true,
  ambientShowWeekly: true,
  ambientPanelOpacity: 0.55,
  ambientWeatherScale: 1,
  ambientCurrentWeatherScale: 1,
};

app.get('/api/settings', (req, res) => {
  const db = require('./db/database');
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const stored = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
  res.json({ ...SETTINGS_DEFAULTS, ...stored });
});

app.put('/api/settings', (req, res) => {
  const db = require('./db/database');
  const upsert = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const allowed = new Set(Object.keys(SETTINGS_DEFAULTS));
  const upsertMany = db.transaction(updates => {
    for (const [k, v] of Object.entries(updates)) {
      if (allowed.has(k)) upsert.run(k, JSON.stringify(v));
    }
  });
  upsertMany(req.body);
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const stored = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
  res.json({ ...SETTINGS_DEFAULTS, ...stored });
});

// Sync status endpoint
app.get('/api/sync/status', (req, res) => {
  const db = require('./db/database');
  const status = db.prepare(`
    SELECT fm.name, fm.id, gs.calendar_id, gs.last_sync
    FROM family_members fm
    LEFT JOIN google_sync_state gs ON gs.member_id = fm.id
    WHERE fm.google_refresh_token IS NOT NULL
    ORDER BY fm.name, gs.calendar_id
  `).all();
  res.json(status);
});

// Manual update trigger — runs the update script and streams progress
app.post('/api/update', (req, res) => {
  const { exec } = require('child_process');
  const scriptPath = path.join(__dirname, '../../scripts/update.sh');

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  const os = require('os');
  const child = exec(`FORCE=1 bash ${scriptPath} 2>&1`, {
    env: { ...process.env, HOME: os.homedir() },
  });

  child.stdout.on('data', data => res.write(data));
  child.stderr.on('data', data => res.write(data));
  child.on('close', code => {
    res.write(`\nUpdate script exited with code ${code}\n`);
    res.end();
  });
  child.on('error', err => {
    res.write(`Error: ${err.message}\n`);
    res.end();
  });
});

// Manual sync trigger
app.post('/api/sync/now', async (req, res) => {
  try {
    const [gResults, iResults] = await Promise.all([syncAllMembers(), syncAllIcal()]);
    res.json({ success: true, google: gResults, ical: iResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reboot the Pi
app.post('/api/reboot', (req, res) => {
  res.json({ rebooting: true });
  setTimeout(() => require('child_process').exec('sudo reboot'), 500);
});

// Restart the backend service (frontend reloads itself after calling this)
app.post('/api/restart', (req, res) => {
  res.json({ restarting: true });
  setTimeout(() => require('child_process').exec('sudo systemctl restart famcalendar-backend'), 500);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
});

// Serve avatars from data/avatars/ — separate from public/ so builds don't wipe them
app.use('/avatars', express.static(path.join(__dirname, '../data/avatars')));

// ── Ambient background photos ────────────────────────────────────────────────
const ambientPhotosDir = path.join(__dirname, '../data/ambient-photos');
if (!fs.existsSync(ambientPhotosDir)) fs.mkdirSync(ambientPhotosDir, { recursive: true });

app.use('/ambient-photos', express.static(ambientPhotosDir));

const multer = require('multer');
const ambientUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ambientPhotosDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpe?g|png|webp|gif)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

app.get('/api/ambient-photos', (req, res) => {
  const files = fs.readdirSync(ambientPhotosDir)
    .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
    .map(f => ({ filename: f, url: `/ambient-photos/${f}` }));
  res.json(files);
});

app.post('/api/ambient-photos', ambientUpload.array('photos', 20), (req, res) => {
  const uploaded = (req.files || []).map(f => ({ filename: f.filename, url: `/ambient-photos/${f.filename}` }));
  res.json(uploaded);
});

app.delete('/api/ambient-photos/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(ambientPhotosDir, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ deleted: filename });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Serve the phone web UI as static files (built React app goes in /public)
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all: return the phone UI for any unmatched GET (SPA routing)
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../public/index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'FamCalendar backend is running. Frontend not yet built.' });
  }
});

// Schedule Google Calendar sync
const cronExpression = `*/${SYNC_INTERVAL} * * * *`;
cron.schedule(cronExpression, async () => {
  console.log(`[${new Date().toISOString()}] Running scheduled sync...`);
  try {
    const [gResults, iResults] = await Promise.all([syncAllMembers(), syncAllIcal()]);
    const total = [...gResults, ...iResults].reduce((s, r) => s + (r.added || 0) + (r.updated || 0), 0);
    if (total > 0) console.log(`Sync complete: ${total} changes`);
  } catch (err) {
    console.error('Scheduled sync failed:', err.message);
  }
});

// Also run a sync on startup after a short delay
setTimeout(() => {
  Promise.all([syncAllMembers(), syncAllIcal()])
    .then(([g, i]) => (g.length || i.length) && console.log('Initial sync complete'))
    .catch(err => console.error('Initial sync failed:', err.message));
}, 5000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FamCalendar backend running on port ${PORT}`);
  console.log(`Google Calendar sync every ${SYNC_INTERVAL} minutes`);
  console.log(`Phone UI available at http://<pi-ip>:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
