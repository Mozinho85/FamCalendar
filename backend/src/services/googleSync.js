const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
require('dotenv').config();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
}

async function exchangeCodeForTokens(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// List all calendars for a member so they can pick which ones to sync
async function listCalendars(refreshToken) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const res = await calendar.calendarList.list();
  return res.data.items.map(c => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary || false,
    backgroundColor: c.backgroundColor,
  }));
}

// Sync a single calendar for a member.
// Uses incremental sync (syncToken) where possible to minimise API calls.
async function syncCalendarForMember(member, calendarId) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: member.google_refresh_token });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const syncState = db.prepare(
    'SELECT sync_token FROM google_sync_state WHERE member_id = ? AND calendar_id = ?'
  ).get(member.id, calendarId);

  const params = {
    calendarId,
    singleEvents: true,
    maxResults: 2500,
  };

  if (syncState?.sync_token) {
    params.syncToken = syncState.sync_token;
  } else {
    // Full sync: fetch from 6 months ago to 1 year ahead
    const timeMin = new Date();
    timeMin.setMonth(timeMin.getMonth() - 6);
    const timeMax = new Date();
    timeMax.setFullYear(timeMax.getFullYear() + 1);
    params.timeMin = timeMin.toISOString();
    params.timeMax = timeMax.toISOString();
    params.orderBy = 'startTime';
  }

  let pageToken = null;
  let newSyncToken = null;
  let added = 0, updated = 0, deleted = 0;

  const upsertEvent = db.prepare(`
    INSERT INTO events (id, title, start_datetime, end_datetime, all_day, member_id, color, location, notes, source, google_event_id, google_cal_id, recurrence_rule)
    VALUES (@id, @title, @start_datetime, @end_datetime, @all_day, @member_id, @color, @location, @notes, 'google', @google_event_id, @google_cal_id, @recurrence_rule)
    ON CONFLICT(id) DO UPDATE SET
      title          = excluded.title,
      start_datetime = excluded.start_datetime,
      end_datetime   = excluded.end_datetime,
      all_day        = excluded.all_day,
      color          = excluded.color,
      location       = excluded.location,
      notes          = excluded.notes,
      recurrence_rule= excluded.recurrence_rule,
      updated_at     = datetime('now')
  `);

  const deleteEvent = db.prepare(
    'DELETE FROM events WHERE google_event_id = ? AND google_cal_id = ?'
  );

  const existingEvent = db.prepare(
    'SELECT id FROM events WHERE google_event_id = ? AND google_cal_id = ?'
  );

  do {
    if (pageToken) params.pageToken = pageToken;

    let res;
    try {
      res = await calendar.events.list(params);
    } catch (err) {
      if (err.code === 410) {
        // Sync token invalid - clear and do a full sync next time
        db.prepare('DELETE FROM google_sync_state WHERE member_id = ? AND calendar_id = ?')
          .run(member.id, calendarId);
        console.log(`Sync token expired for ${member.name}/${calendarId}, will do full sync next cycle`);
        return { added, updated, deleted };
      }
      throw err;
    }

    const items = res.data.items || [];
    newSyncToken = res.data.nextSyncToken;
    pageToken = res.data.nextPageToken;

    for (const event of items) {
      if (event.status === 'cancelled') {
        deleteEvent.run(event.id, calendarId);
        deleted++;
        continue;
      }

      const isAllDay = Boolean(event.start?.date);
      const startDt = event.start?.dateTime || event.start?.date;
      const endDt   = event.end?.dateTime   || event.end?.date;

      if (!startDt || !endDt) continue;

      const existing = existingEvent.get(event.id, calendarId);
      const rowId = existing?.id || uuidv4();

      upsertEvent.run({
        id:              rowId,
        title:           event.summary || '(no title)',
        start_datetime:  startDt,
        end_datetime:    endDt,
        all_day:         isAllDay ? 1 : 0,
        member_id:       member.id,
        color:           member.color,
        location:        event.location || null,
        notes:           event.description || null,
        google_event_id: event.id,
        google_cal_id:   calendarId,
        recurrence_rule: event.recurrence ? JSON.stringify(event.recurrence) : null,
      });

      existing ? updated++ : added++;
    }
  } while (pageToken);

  // Save the new sync token
  if (newSyncToken) {
    db.prepare(`
      INSERT INTO google_sync_state (member_id, calendar_id, sync_token, last_sync)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(member_id, calendar_id) DO UPDATE SET
        sync_token = excluded.sync_token,
        last_sync  = excluded.last_sync
    `).run(member.id, calendarId, newSyncToken);
  }

  return { added, updated, deleted };
}

// Sync all calendars for all members that have a refresh token
async function syncAllMembers() {
  const members = db.prepare(
    'SELECT * FROM family_members WHERE google_refresh_token IS NOT NULL'
  ).all();

  const results = [];

  for (const member of members) {
    let calendarIds = [];
    try {
      calendarIds = JSON.parse(member.google_calendar_ids || '[]');
    } catch {
      continue;
    }

    if (calendarIds.length === 0) {
      // Default to primary calendar
      calendarIds = ['primary'];
    }

    for (const calId of calendarIds) {
      try {
        const result = await syncCalendarForMember(member, calId);
        results.push({ member: member.name, calendar: calId, ...result });
        console.log(`Synced ${member.name}/${calId}: +${result.added} ~${result.updated} -${result.deleted}`);
      } catch (err) {
        console.error(`Sync failed for ${member.name}/${calId}:`, err.message);
        results.push({ member: member.name, calendar: calId, error: err.message });
      }
    }
  }

  return results;
}

module.exports = { getAuthUrl, exchangeCodeForTokens, listCalendars, syncAllMembers, syncCalendarForMember };
