require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const eventsRouter  = require('./routes/events');
const membersRouter = require('./routes/members');
const authRouter    = require('./routes/auth');
const { syncAllMembers } = require('./services/googleSync');

const app = express();
const PORT = process.env.PORT || 3001;
const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL_MINUTES || '15', 10);

// Allow requests from the kiosk frontend (same machine) and phones on the local network
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (direct API calls, curl) and anything on the LAN
    if (!origin || origin.startsWith('http://192.168.') || origin.startsWith('http://10.') ||
        origin.startsWith('http://172.') || origin === 'http://localhost:3000') {
      cb(null, true);
    } else {
      cb(new Error('CORS: origin not allowed'));
    }
  },
  credentials: true,
}));

app.use(express.json());

// API routes
app.use('/api/events',  eventsRouter);
app.use('/api/members', membersRouter);
app.use('/auth',        authRouter);

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

// Manual sync trigger (useful from phone UI)
app.post('/api/sync/now', async (req, res) => {
  try {
    const results = await syncAllMembers();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
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
    res.json({ message: 'Skylight backend is running. Frontend not yet built.' });
  }
});

// Schedule Google Calendar sync
const cronExpression = `*/${SYNC_INTERVAL} * * * *`;
cron.schedule(cronExpression, async () => {
  console.log(`[${new Date().toISOString()}] Running scheduled Google Calendar sync...`);
  try {
    const results = await syncAllMembers();
    const total = results.reduce((s, r) => s + (r.added || 0) + (r.updated || 0), 0);
    if (total > 0) console.log(`Sync complete: ${total} changes`);
  } catch (err) {
    console.error('Scheduled sync failed:', err.message);
  }
});

// Also run a sync on startup after a short delay
setTimeout(() => {
  syncAllMembers()
    .then(r => r.length && console.log('Initial sync complete'))
    .catch(err => console.error('Initial sync failed:', err.message));
}, 5000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Skylight backend running on port ${PORT}`);
  console.log(`Google Calendar sync every ${SYNC_INTERVAL} minutes`);
  console.log(`Phone UI available at http://<pi-ip>:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
