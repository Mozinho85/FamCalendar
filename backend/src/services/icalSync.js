const ical = require('node-ical');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

// Expand recurring events within a window.
// We handle RRULE simply — daily, weekly, monthly, yearly with optional COUNT/UNTIL.
function expandRecurrences(event, windowStart, windowEnd) {
  const instances = [];

  const dtstart = event.start;
  const duration = event.end - event.start; // ms

  if (!event.rrule) {
    // Non-recurring — just check if it falls in window
    if (event.end >= windowStart && event.start <= windowEnd) {
      instances.push({ start: event.start, end: event.end });
    }
    return instances;
  }

  // Use node-ical's built-in rrule support if available
  try {
    const rule = event.rrule;
    const until = rule.options?.until || windowEnd;
    const count  = rule.options?.count || 500;
    const freq   = rule.options?.freq;  // 0=yearly,1=monthly,2=weekly,3=daily

    let current = new Date(dtstart);
    let generated = 0;

    const freqMs = {
      3: 24 * 60 * 60 * 1000,           // daily
      2: 7 * 24 * 60 * 60 * 1000,       // weekly
    };

    const advance = (d) => {
      const next = new Date(d);
      if (freq === 3) next.setDate(next.getDate() + (rule.options?.interval || 1));
      else if (freq === 2) next.setDate(next.getDate() + 7 * (rule.options?.interval || 1));
      else if (freq === 1) next.setMonth(next.getMonth() + (rule.options?.interval || 1));
      else if (freq === 0) next.setFullYear(next.getFullYear() + (rule.options?.interval || 1));
      else next.setDate(next.getDate() + 1);
      return next;
    };

    while (current <= windowEnd && current <= until && generated < count) {
      const end = new Date(current.getTime() + duration);
      if (current >= windowStart) {
        instances.push({ start: new Date(current), end });
      }
      const next = advance(current);
      if (next.getTime() === current.getTime()) break; // safety
      current = next;
      generated++;
    }
  } catch {
    // Fallback — just use the base event
    if (event.end >= windowStart && event.start <= windowEnd) {
      instances.push({ start: event.start, end: event.end });
    }
  }

  return instances;
}

async function syncIcalForMember(member, url) {
  const headers = { 'User-Agent': 'FamCalendar/1.0' };

  // Use ETag for conditional fetching — avoids re-parsing unchanged feeds
  const state = db.prepare(
    'SELECT last_etag FROM ical_sync_state WHERE member_id = ? AND url = ?'
  ).get(member.id, url);

  if (state?.last_etag) {
    headers['If-None-Match'] = state.last_etag;
  }

  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new Error(`Failed to fetch iCal URL: ${err.message}`);
  }

  if (response.status === 304) {
    // Not modified — nothing to do
    return { added: 0, updated: 0, deleted: 0, skipped: true };
  }

  if (!response.ok) {
    throw new Error(`iCal fetch returned ${response.status}`);
  }

  const etag    = response.headers.get('etag') || null;
  const icsText = await response.text();

  let parsed;
  try {
    parsed = ical.sync.parseICS(icsText);
  } catch (err) {
    throw new Error(`Failed to parse ICS: ${err.message}`);
  }

  // Window: 6 months back to 1 year ahead
  const windowStart = new Date(); windowStart.setMonth(windowStart.getMonth() - 6);
  const windowEnd   = new Date(); windowEnd.setFullYear(windowEnd.getFullYear() + 1);

  const upsertEvent = db.prepare(`
    INSERT INTO events (id, title, start_datetime, end_datetime, all_day, member_id, color, location, notes, source, google_event_id, google_cal_id)
    VALUES (@id, @title, @start_datetime, @end_datetime, @all_day, @member_id, @color, @location, @notes, 'ical', @ical_uid, @ical_url)
    ON CONFLICT(id) DO UPDATE SET
      title          = excluded.title,
      start_datetime = excluded.start_datetime,
      end_datetime   = excluded.end_datetime,
      all_day        = excluded.all_day,
      color          = excluded.color,
      location       = excluded.location,
      notes          = excluded.notes,
      updated_at     = datetime('now')
  `);

  const existingByUid = db.prepare(
    "SELECT id FROM events WHERE google_event_id = ? AND google_cal_id = ? AND source = 'ical'"
  );

  // Track which UIDs we see so we can delete removed events
  const seenUids = new Set();
  let added = 0, updated = 0;

  for (const key of Object.keys(parsed)) {
    const event = parsed[key];
    if (event.type !== 'VEVENT') continue;

    const uid = event.uid || key;
    const instances = expandRecurrences(event, windowStart, windowEnd);

    for (let i = 0; i < instances.length; i++) {
      const { start, end } = instances[i];
      const instanceUid = instances.length > 1 ? `${uid}_${i}` : uid;
      seenUids.add(instanceUid);

      const isAllDay = (event.datetype === 'date');
      const localDateStr = d => {
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
      };
      const startStr = isAllDay
        ? localDateStr(start) + 'T00:00:00'
        : start.toISOString();
      // iCal all-day end is exclusive (next day); store as midnight so displayEndDate adjusts it correctly
      const endStr = isAllDay
        ? localDateStr(end) + 'T00:00:00'
        : end.toISOString();

      const existing = existingByUid.get(instanceUid, url);
      const rowId = existing?.id || uuidv4();

      upsertEvent.run({
        id:             rowId,
        title:          event.summary || '(no title)',
        start_datetime: startStr,
        end_datetime:   endStr,
        all_day:        isAllDay ? 1 : 0,
        member_id:      member.id,
        color:          member.color,
        location:       event.location || null,
        notes:          event.description || null,
        ical_uid:       instanceUid,
        ical_url:       url,
      });

      existing ? updated++ : added++;
    }
  }

  // Remove events from this URL that no longer exist in the feed
  const existing = db.prepare(
    "SELECT id, google_event_id FROM events WHERE google_cal_id = ? AND source = 'ical' AND member_id = ?"
  ).all(url, member.id);

  let deleted = 0;
  for (const row of existing) {
    if (!seenUids.has(row.google_event_id)) {
      db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
      deleted++;
    }
  }

  // Save sync state
  db.prepare(`
    INSERT INTO ical_sync_state (member_id, url, last_sync, last_etag)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(member_id, url) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_etag = excluded.last_etag
  `).run(member.id, url, etag);

  return { added, updated, deleted, skipped: false };
}

async function syncAllIcal() {
  const members = db.prepare('SELECT * FROM family_members').all();
  const results = [];

  for (const member of members) {
    let urls = [];
    try { urls = JSON.parse(member.ical_urls || '[]'); } catch { continue; }

    for (const url of urls) {
      try {
        const result = await syncIcalForMember(member, url);
        if (!result.skipped) {
          console.log(`iCal sync ${member.name}: +${result.added} ~${result.updated} -${result.deleted} (${url.slice(0, 60)}...)`);
        }
        results.push({ member: member.name, url, ...result });
      } catch (err) {
        console.error(`iCal sync failed for ${member.name} (${url}):`, err.message);
        results.push({ member: member.name, url, error: err.message });
      }
    }
  }

  return results;
}

module.exports = { syncAllIcal, syncIcalForMember };
