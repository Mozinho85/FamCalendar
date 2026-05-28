const https = require('https');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const SHARED_MEMBER_ID = 'family-shared-events';
const SHARED_COLOR = '#6366f1';

function ensureSharedMember() {
  db.prepare(`
    INSERT OR IGNORE INTO family_members (id, name, color)
    VALUES (?, 'Family', ?)
  `).run(SHARED_MEMBER_ID, SHARED_COLOR);
}

// Meeus/Jones/Butcher algorithm
function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// nth occurrence of weekday (0=Sun) in a given month (0-indexed)
function nthWeekday(year, month, weekday, n) {
  const d = new Date(year, month, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) { count++; if (count === n) return new Date(d); }
    d.setDate(d.getDate() + 1);
  }
}

function getRecurringEvents(year) {
  const easter = easterDate(year);
  return [
    { title: "New Year's Day",  date: new Date(year, 0, 1) },
    { title: "Valentine's Day", date: new Date(year, 1, 14) },
    // UK Mothering Sunday = 3 weeks before Easter
    { title: "Mother's Day",    date: addDays(easter, -21) },
    { title: "Good Friday",     date: addDays(easter, -2) },
    { title: "Easter Sunday",   date: easter },
    { title: "Easter Monday",   date: addDays(easter, 1) },
    // Father's Day = 3rd Sunday of June (UK)
    { title: "Father's Day",    date: nthWeekday(year, 5, 0, 3) },
    { title: "Halloween",       date: new Date(year, 9, 31) },
    { title: "Bonfire Night",   date: new Date(year, 10, 5) },
    { title: "Christmas Eve",   date: new Date(year, 11, 24) },
    { title: "Christmas Day",   date: new Date(year, 11, 25) },
    { title: "Boxing Day",      date: new Date(year, 11, 26) },
    { title: "New Year's Eve",  date: new Date(year, 11, 31) },
  ];
}

function upsertHoliday(title, date) {
  const ds    = dateStr(date);
  const start = `${ds}T00:00:00`;
  const end   = `${ds}T23:59:59`;

  const existing = db.prepare(`
    SELECT id FROM events
    WHERE member_id = ? AND title = ? AND start_datetime = ? AND source = 'holiday'
  `).get(SHARED_MEMBER_ID, title, start);

  if (!existing) {
    db.prepare(`
      INSERT INTO events
        (id, title, start_datetime, end_datetime, all_day, member_id, color, source)
      VALUES (?, ?, ?, ?, 1, ?, ?, 'holiday')
    `).run(uuidv4(), title, start, end, SHARED_MEMBER_ID, SHARED_COLOR);
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function syncBankHolidays() {
  const data   = await fetchJson('https://www.gov.uk/bank-holidays.json');
  const events = data['england-and-wales']?.events || [];
  for (const ev of events) {
    upsertHoliday(ev.title, new Date(ev.date));
  }
  console.log(`[sharedEvents] Synced ${events.length} UK bank holidays`);
}

async function syncSharedEvents() {
  ensureSharedMember();

  const currentYear = new Date().getFullYear();
  for (const year of [currentYear, currentYear + 1]) {
    for (const { title, date } of getRecurringEvents(year)) {
      upsertHoliday(title, date);
    }
  }

  try {
    await syncBankHolidays();
  } catch (err) {
    console.error('[sharedEvents] Bank holiday sync failed:', err.message);
  }

  console.log('[sharedEvents] Shared events sync complete');
}

module.exports = { syncSharedEvents, ensureSharedMember, SHARED_MEMBER_ID };
