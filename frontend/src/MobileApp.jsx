import { useState, useEffect, useCallback, useRef } from "react";
import "./MobileApp.css";

const API = "/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }
function formatTime(dt) { const d = new Date(dt); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAY_NAMES_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_NAMES_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useMembers() {
  const [members, setMembers] = useState([]);
  const load = useCallback(async () => {
    try { const r = await fetch(`${API}/members`); setMembers(await r.json()); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);
  return { members, reload: load };
}

function useEvents(start, end) {
  const [events, setEvents] = useState([]);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/events?start=${start.toISOString()}&end=${end.toISOString()}`);
      setEvents(await r.json());
    } catch {}
  }, [start.toISOString(), end.toISOString()]);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  return { events, reload: load };
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 10000); return () => clearInterval(id); }, []);
  return now;
}

// ── Add Event Sheet ───────────────────────────────────────────────────────────

function AddEventSheet({ date, members, onClose, onSave }) {
  const [title, setTitle]       = useState("");
  const [memberId, setMemberId] = useState(members[0]?.id || "");
  const [allDay, setAllDay]     = useState(true);
  const [dateStr, setDateStr]   = useState(
    date ? `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}` : ""
  );
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime]     = useState("10:00");
  const [saving, setSaving]       = useState(false);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const start = allDay ? `${dateStr}T00:00:00` : `${dateStr}T${startTime}:00`;
    const end   = allDay ? `${dateStr}T23:59:59` : `${dateStr}T${endTime}:00`;
    await onSave({ title: title.trim(), start_datetime: start, end_datetime: end,
                   all_day: allDay, member_id: memberId });
    setSaving(false);
    onClose();
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__head">
          <h2>New event</h2>
          <button className="sheet__close" onClick={onClose}>✕</button>
        </div>
        <div className="sheet__body">
          <label className="mfield">
            <span>Title</span>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="What's happening?" autoFocus />
          </label>
          <label className="mfield">
            <span>Who</span>
            <select value={memberId} onChange={e => setMemberId(e.target.value)}>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="mfield">
            <span>Date</span>
            <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} />
          </label>
          <label className="mfield mfield--inline">
            <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
            <span>All day</span>
          </label>
          {!allDay && (
            <div className="mfield-row">
              <label className="mfield"><span>Start</span>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </label>
              <label className="mfield"><span>End</span>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </label>
            </div>
          )}
        </div>
        <div className="sheet__foot">
          <button className="m-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="m-btn-primary" onClick={save} disabled={saving || !title.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Event detail sheet ────────────────────────────────────────────────────────

function EventSheet({ event, member, onClose, onDelete }) {
  const start = new Date(event.start_datetime);
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__head" style={{ borderLeft: `4px solid ${member?.color || "#4f6ef7"}` }}>
          <h2>{event.title}</h2>
          <button className="sheet__close" onClick={onClose}>✕</button>
        </div>
        <div className="sheet__body">
          {[
            ["Who",  member?.name],
            ["Date", `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`],
            !event.all_day && ["Time", `${formatTime(event.start_datetime)} – ${formatTime(event.end_datetime)}`],
            event.location && ["Where", event.location],
            event.notes    && ["Notes", event.notes],
          ].filter(Boolean).map(([label, val]) => (
            <div key={label} className="mev-detail">
              <span className="mev-detail__label">{label}</span>
              <span>{val}</span>
            </div>
          ))}
          {event.source === "google" && (
            <p className="mev-google-note">From Google Calendar — edit it there to make changes.</p>
          )}
        </div>
        <div className="sheet__foot">
          {event.source === "local" && (
            <button className="m-btn-danger" onClick={() => onDelete(event.id)}>Delete</button>
          )}
          <button className="m-btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Day strip (horizontal scrolling week picker) ──────────────────────────────

function DayStrip({ selectedDate, onSelect, events, members }) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 3));

  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  function hasEvents(day) {
    return events.some(e => {
      const s = new Date(e.start_datetime); s.setHours(0,0,0,0);
      const en = new Date(e.end_datetime); en.setHours(23,59,59,999);
      return day >= s && day <= en;
    });
  }

  return (
    <div className="day-strip">
      {days.map((day, i) => {
        const isToday    = isSameDay(day, today);
        const isSelected = isSameDay(day, selectedDate);
        const hasDot     = hasEvents(day);
        return (
          <button
            key={i}
            className={`day-strip__day ${isSelected ? "day-strip__day--selected" : ""} ${isToday ? "day-strip__day--today" : ""}`}
            onClick={() => onSelect(day)}
          >
            <span className="day-strip__name">{DAY_NAMES_SHORT[day.getDay()]}</span>
            <span className="day-strip__num">{day.getDate()}</span>
            {hasDot && <span className="day-strip__dot" />}
          </button>
        );
      })}
    </div>
  );
}

// ── Agenda list for selected day ──────────────────────────────────────────────

function AgendaDay({ date, events, members, onEventTap, onAddTap }) {
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  const dayEvents = events.filter(e => {
    const s = new Date(e.start_datetime); s.setHours(0,0,0,0);
    const en = new Date(e.end_datetime); en.setHours(23,59,59,999);
    const d = new Date(date); d.setHours(0,0,0,0);
    return d >= s && d <= en;
  }).sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));

  return (
    <div className="agenda">
      <div className="agenda__head">
        <div>
          <div className="agenda__day-name">{DAY_NAMES_FULL[date.getDay()]}</div>
          <div className="agenda__date">{date.getDate()} {MONTHS[date.getMonth()]} {date.getFullYear()}</div>
        </div>
        <button className="agenda__add" onClick={onAddTap}>+ Add</button>
      </div>

      {dayEvents.length === 0 && (
        <div className="agenda__empty">
          <p>Nothing on this day</p>
          <button className="m-btn-primary" onClick={onAddTap}>Add event</button>
        </div>
      )}

      {dayEvents.map(ev => {
        const member = memberMap[ev.member_id];
        const color = ev.color || member?.color || "#4f6ef7";
        return (
          <div key={ev.id} className="agenda-item" style={{ "--mc": color }}
            onClick={() => onEventTap(ev, member)}>
            <div className="agenda-item__bar" />
            <div className="agenda-item__info">
              <div className="agenda-item__title">{ev.title}</div>
              <div className="agenda-item__meta">
                {!ev.all_day && (
                  <span>{formatTime(ev.start_datetime)} – {formatTime(ev.end_datetime)}</span>
                )}
                {ev.all_day && <span>All day</span>}
                {member && <span>· {member.name}</span>}
                {ev.source === "google" && <span className="mbadge-g">G</span>}
                {ev.source === "ical"   && <span className="mbadge-ical">iCal</span>}
              </div>
            </div>
            {member?.avatar_url ? (
              <img src={member.avatar_url} alt={member.name} className="agenda-item__avatar" />
            ) : member ? (
              <div className="agenda-item__initial" style={{ background: member.color }}>
                {member.name[0]}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Mobile App ───────────────────────────────────────────────────────────

export default function MobileApp() {
  const now   = useClock();
  const today = new Date(); today.setHours(0,0,0,0);

  const [selectedDate, setSelectedDate] = useState(new Date(today));
  const [addSheet, setAddSheet]         = useState(false);
  const [evSheet, setEvSheet]           = useState(null);
  const [view, setView]                 = useState("agenda"); // agenda | members

  const windowStart = addDays(today, -7);
  const windowEnd   = addDays(today, 30);

  const { members, reload: reloadMembers } = useMembers();
  const { events,  reload: reloadEvents  } = useEvents(windowStart, windowEnd);
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  async function saveEvent(data) {
    await fetch(`${API}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    reloadEvents();
  }

  async function deleteEvent(id) {
    await fetch(`${API}/events/${id}`, { method: "DELETE" });
    reloadEvents();
    setEvSheet(null);
  }

  return (
    <div className="mobile-app">
      {/* Header */}
      <header className="m-topbar">
        <div className="m-topbar__left">
          <div className="m-clock">{pad(now.getHours())}:{pad(now.getMinutes())}</div>
          <div className="m-date">
            {DAY_NAMES_SHORT[now.getDay()]} {now.getDate()} {MONTHS[now.getMonth()].slice(0,3)}
          </div>
        </div>
        <div className="m-topbar__title">FamCalendar</div>
      </header>

      {/* Day strip */}
      <DayStrip
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
        events={events}
        members={members}
      />

      {/* Agenda */}
      <div className="m-content">
        <AgendaDay
          date={selectedDate}
          events={events}
          members={members}
          onEventTap={(ev, member) => setEvSheet({ ev, member })}
          onAddTap={() => setAddSheet(true)}
        />
      </div>

      {/* FAB */}
      <button className="m-fab" onClick={() => setAddSheet(true)}>+</button>

      {/* Sheets */}
      {addSheet && (
        <AddEventSheet
          date={selectedDate}
          members={members}
          onClose={() => setAddSheet(false)}
          onSave={saveEvent}
        />
      )}
      {evSheet && (
        <EventSheet
          event={evSheet.ev}
          member={evSheet.member}
          onClose={() => setEvSheet(null)}
          onDelete={deleteEvent}
        />
      )}
    </div>
  );
}
