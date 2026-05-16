const express = require('express');
const db = require('../db/database');
const { getAuthUrl, exchangeCodeForTokens, listCalendars, syncAllMembers } = require('../services/googleSync');

const router = express.Router();

// GET /auth/google/start?member_id=xxx
// Redirects the user to Google's consent screen.
// Open this URL in a browser on the Pi or a phone on the same network.
router.get('/google/start', (req, res) => {
  const { member_id } = req.query;
  if (!member_id) return res.status(400).send('member_id is required');

  const member = db.prepare('SELECT * FROM family_members WHERE id = ?').get(member_id);
  if (!member) return res.status(404).send('Member not found');

  // Stash member_id in state param so we get it back in the callback
  const url = getAuthUrl() + `&state=${encodeURIComponent(member_id)}`;
  res.redirect(url);
});

// GET /auth/google/callback - Google redirects here after consent
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(`<h2>Auth cancelled: ${error}</h2><p>You can close this tab.</p>`);
  }
  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  const member_id = decodeURIComponent(state);
  const member = db.prepare('SELECT * FROM family_members WHERE id = ?').get(member_id);
  if (!member) return res.status(404).send('Member not found');

  try {
    const tokens = await exchangeCodeForTokens(code);

    db.prepare('UPDATE family_members SET google_refresh_token = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(tokens.refresh_token, member_id);

    // Immediately fetch and display their calendars so they can pick which to sync
    const calendars = await listCalendars(tokens.refresh_token);

    const calOptions = calendars.map(c =>
      `<li><label><input type="checkbox" name="cal" value="${c.id}" ${c.primary ? 'checked' : ''}> ${c.summary} ${c.primary ? '(primary)' : ''}</label></li>`
    ).join('');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>FamCalendar - Connected!</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; max-width: 480px; margin: 40px auto; padding: 0 20px; }
          h2 { color: #4fc3a1; }
          ul { list-style: none; padding: 0; }
          li { padding: 8px 0; border-bottom: 1px solid #eee; }
          button { background: #8b6fde; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; cursor: pointer; margin-top: 16px; width: 100%; }
        </style>
      </head>
      <body>
        <h2>✓ Google Calendar connected for ${member.name}</h2>
        <p>Choose which calendars to sync:</p>
        <form method="POST" action="/auth/google/calendars">
          <input type="hidden" name="member_id" value="${member_id}">
          <ul>${calOptions}</ul>
          <button type="submit">Save & Start Syncing</button>
        </form>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send(`<h2>Auth failed</h2><pre>${err.message}</pre>`);
  }
});

// POST /auth/google/calendars - save chosen calendars and trigger first sync
router.post('/google/calendars', express.urlencoded({ extended: true }), async (req, res) => {
  const { member_id, cal } = req.body;
  if (!member_id) return res.status(400).send('Missing member_id');

  const calIds = Array.isArray(cal) ? cal : (cal ? [cal] : ['primary']);

  db.prepare('UPDATE family_members SET google_calendar_ids = ? WHERE id = ?')
    .run(JSON.stringify(calIds), member_id);

  // Trigger an immediate sync
  syncAllMembers().catch(console.error);

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>FamCalendar - All Set!</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: sans-serif; max-width: 480px; margin: 40px auto; padding: 0 20px; text-align: center; }
        h2 { color: #4fc3a1; }
        p { color: #666; line-height: 1.6; }
      </style>
    </head>
    <body>
      <h2>✓ All set!</h2>
      <p>Syncing ${calIds.length} calendar${calIds.length > 1 ? 's' : ''}.<br>
      Events will appear on the display within a minute.<br>
      You can close this tab.</p>
    </body>
    </html>
  `);
});

// POST /auth/google/disconnect?member_id=xxx
router.post('/google/disconnect', (req, res) => {
  const { member_id } = req.query;
  if (!member_id) return res.status(400).json({ error: 'member_id required' });

  db.prepare(`
    UPDATE family_members
    SET google_refresh_token = NULL, google_calendar_ids = '[]', updated_at = datetime('now')
    WHERE id = ?
  `).run(member_id);

  db.prepare('DELETE FROM google_sync_state WHERE member_id = ?').run(member_id);
  db.prepare("DELETE FROM events WHERE member_id = ? AND source = 'google'").run(member_id);

  res.json({ disconnected: true });
});

module.exports = router;
