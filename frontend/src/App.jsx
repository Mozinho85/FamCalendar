import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import TouchKeyboard from "./Keyboard.jsx";
import { useFeedback } from "./useFeedback.js";
import { useDimmer } from "./useDimmer.js";
import { useCursorHide } from "./useCursorHide.js";
import { useDebounce } from "./useDebounce.js";
import { useWeather } from "./useWeather.js";
import { useSettings } from "./useSettings.js";
import AmbientMode from "./AmbientMode.jsx";

const API = "/api";

// ── Loading screen ────────────────────────────────────────────────────────────

function LoadingScreen({ visible }) {
  return (
    <div className={`loading ${visible ? "" : "loading--gone"}`}>
      <div className="loading__inner">
        <div className="loading__rings">
          <div className="ring ring--1" />
          <div className="ring ring--2" />
          <div className="ring ring--3" />
        </div>
        <div className="loading__dots">
          <span /><span /><span /><span /><span /><span /><span />
        </div>
        <p className="loading__label">FamCalendar</p>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBirthday(event) {
  return /birthday|bday|b-day/i.test(event.title);
}

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = parseLocalDate(dateStr); target.setHours(0,0,0,0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

function pad(n) { return String(n).padStart(2, "0"); }
// Date-only strings (from Google Calendar API) are parsed as UTC by new Date().
// This helper forces local-time interpretation so all-day events never shift a day.
function parseLocalDate(str) {
  if (!str) return new Date(NaN);
  return str.length === 10 ? new Date(str + 'T00:00:00') : new Date(str);
}
function formatTime(dt) { const d = new Date(dt); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0) ? -6 : 1 - day; // Monday = 1, so shift Sunday back 6, others forward
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// For all-day events Google/iCal use exclusive end (midnight next day).
// Normalise to the last inclusive day for display.
function displayEndDate(ev) {
  const end = parseLocalDate(ev.end_datetime);
  if (ev.all_day && end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
    return addDays(end, -1);
  }
  return end;
}

function isMultiDayAllDay(ev) {
  if (!ev.all_day) return false;
  const start = parseLocalDate(ev.start_datetime);
  return !isSameDay(start, displayEndDate(ev));
}

function eventOnDay(ev, day) {
  if (!ev.all_day) {
    // Timed events: only on start day, even if they run past midnight
    return isSameDay(parseLocalDate(ev.start_datetime), day);
  }
  if (isMultiDayAllDay(ev)) {
    return false; // rendered separately in the spanning layer
  }
  return isSameDay(parseLocalDate(ev.start_datetime), day);
}

// Returns { startCol, endCol, startsBeforeWeek, endsAfterWeek } for spanning events.
// Columns are 1-based; endCol is exclusive (for CSS grid-column).
function getEventSpan(ev, days) {
  const s = parseLocalDate(ev.start_datetime); s.setHours(0, 0, 0, 0);
  const e = displayEndDate(ev);          e.setHours(0, 0, 0, 0);

  const wFirst = new Date(days[0]); wFirst.setHours(0, 0, 0, 0);
  const wLast  = new Date(days[6]); wLast.setHours(0, 0, 0, 0);

  if (e < wFirst || s > wLast) return null;

  const startsBeforeWeek = s < wFirst;
  const endsAfterWeek    = e > wLast;

  let startCol = 1;
  if (!startsBeforeWeek) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(days[i]); d.setHours(0, 0, 0, 0);
      if (+d === +s) { startCol = i + 1; break; }
    }
  }

  let endCol = 8;
  if (!endsAfterWeek) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(days[i]); d.setHours(0, 0, 0, 0);
      if (+d === +e) { endCol = i + 2; break; }
    }
  }

  return { startCol, endCol, startsBeforeWeek, endsAfterWeek };
}

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const PALETTE = ["#e05a8a","#2db88a","#f09030","#3a9fe0","#8b6fde","#e06030","#10b981","#d946ef"];

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useMembers() {
  const [members, setMembers] = useState([]);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/members`);
      setMembers(await r.json());
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);
  return { members, reload: load };
}

function useEvents(weekStart) {
  const [events, setEvents] = useState([]);
  const load = useCallback(async () => {
    const start = addDays(weekStart, -1);
    const end   = addDays(weekStart, 8);
    try {
      const r = await fetch(`${API}/events?start=${start.toISOString()}&end=${end.toISOString()}`);
      setEvents(await r.json());
    } catch {}
  }, [weekStart]);
  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);
  return { events, reload: load };
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 10000); return () => clearInterval(id); }, []);
  return now;
}

// ── Add Event Modal ───────────────────────────────────────────────────────────

function AddEventModal({ date, member, members, onClose, onSave, existingEvent }) {
  const ev = existingEvent;
  const { tap, success, back } = useFeedback();

  function initDateStr() {
    if (ev) return ev.start_datetime.slice(0, 10);
    return date ? `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}` : "";
  }
  function initEndDateStr() {
    if (ev) {
      const end = parseLocalDate(ev.end_datetime);
      if (ev.all_day && end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
        const d = addDays(end, -1);
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      }
      return ev.end_datetime.slice(0, 10);
    }
    return initDateStr();
  }

  const [title, setTitle]         = useState(ev?.title ?? "");
  const [memberId, setMemberId]   = useState(
    ev?.member_id ?? member?.id ?? members.find(m => !m.is_shared)?.id ?? members[0]?.id ?? ""
  );
  const [allDay, setAllDay]       = useState(ev ? !!ev.all_day : true);
  const [dateStr, setDateStr]     = useState(initDateStr);
  const [endDateStr, setEndDateStr] = useState(initEndDateStr);
  const [startTime, setStartTime] = useState(() => ev && !ev.all_day ? ev.start_datetime.slice(11, 16) : "09:00");
  const [endTime, setEndTime]     = useState(() => ev && !ev.all_day ? ev.end_datetime.slice(11, 16)   : "10:00");
  const [location, setLocation]   = useState(ev?.location ?? "");
  const [important, setImportant] = useState(ev ? !!ev.important : false);
  const [saving, setSaving]       = useState(false);

  // Keyboard state
  const [kbTarget, setKbTarget]   = useState(null); // "title" | "location" | null
  const [kbVisible, setKbVisible] = useState(false);

  function focusField(field) {
    tap();
    setKbTarget(field);
  }

  function toggleKeyboard() {
    if (kbVisible) {
      setKbVisible(false);
    } else {
      if (!kbTarget) setKbTarget("title");
      setKbVisible(true);
    }
  }

  function kbChange(val) {
    if (kbTarget === "title")    setTitle(val);
    if (kbTarget === "location") setLocation(val);
  }

  function kbValue() {
    if (kbTarget === "title")    return title;
    if (kbTarget === "location") return location;
    return "";
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const start = allDay ? `${dateStr}T00:00:00` : `${dateStr}T${startTime}:00`;
    const end   = allDay ? `${endDateStr}T23:59:59` : `${endDateStr}T${endTime}:00`;
    await onSave({ title: title.trim(), start_datetime: start, end_datetime: end,
                   all_day: allDay, member_id: memberId, location, important });
    success();
    setSaving(false);
    onClose();
  }

  return (
    <>
      <div className="overlay" onClick={() => { setKbVisible(false); onClose(); }}>
        <div className="modal modal--add-event"
          onClick={e => e.stopPropagation()}>
          <div className="modal__head">
            <h2>{ev ? "Edit event" : "Add event"}</h2>
            <button className="modal__close" onClick={onClose}>✕</button>
          </div>
          <div className="modal__body modal__body--add-event">

            {/* Title — tappable field, shows keyboard */}
            <div className="field field--full">
              <span>Title</span>
              <div
                className={`touch-input ${kbTarget === "title" && kbVisible ? "touch-input--active" : ""}`}
                onPointerDown={() => focusField("title")}
              >
                {title || <span className="touch-input__placeholder">What's happening?</span>}
                {kbTarget === "title" && kbVisible && <span className="touch-input__cursor" />}
              </div>
            </div>

            {/* Who */}
            <label className="field"><span>Who</span>
              <select value={memberId} onChange={e => setMemberId(e.target.value)}
                onFocus={() => setKbVisible(false)}>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>

            {/* Date */}
            <label className="field"><span>Start date</span>
              <input type="date" value={dateStr}
                onChange={e => {
                  const v = e.target.value;
                  if (v > endDateStr) setEndDateStr(v);
                  setDateStr(v);
                }}
                onFocus={() => setKbVisible(false)} />
            </label>

            {/* End date — always visible; for timed events it locks to start date */}
            <label className="field"><span>End date</span>
              <input type="date" value={endDateStr} min={dateStr}
                onChange={e => setEndDateStr(e.target.value)}
                onFocus={() => setKbVisible(false)} />
            </label>

            {/* All day toggle */}
            <label className="field field--inline field--full">
              <input type="checkbox" checked={allDay}
                onChange={e => setAllDay(e.target.checked)} />
              <span>All day</span>
            </label>

            {/* Time pickers */}
            {!allDay && (
              <div className="field-row field--full">
                <label className="field"><span>Start</span>
                  <input type="time" value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    onFocus={() => setKbVisible(false)} />
                </label>
                <label className="field"><span>End</span>
                  <input type="time" value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    onFocus={() => setKbVisible(false)} />
                </label>
              </div>
            )}

            {/* Location */}
            <div className="field field--full">
              <span>Location (optional)</span>
              <div
                className={`touch-input ${kbTarget === "location" && kbVisible ? "touch-input--active" : ""}`}
                onPointerDown={() => focusField("location")}
              >
                {location || <span className="touch-input__placeholder">Where?</span>}
                {kbTarget === "location" && kbVisible && <span className="touch-input__cursor" />}
              </div>
            </div>

            {/* Important */}
            <label className="field field--inline field--full">
              <input type="checkbox" checked={important}
                onChange={e => setImportant(e.target.checked)} />
              <span>⭐ Mark as important (shows countdown)</span>
            </label>

          </div>
          <div className="modal__foot">
            <button className="btn-cancel" onClick={onClose}>Cancel</button>
            <button
              className={`btn-keyboard ${kbVisible ? "btn-keyboard--on" : ""}`}
              onPointerDown={e => e.preventDefault()}
              onClick={toggleKeyboard}
            >⌨</button>
            <button className="btn-primary" onClick={save} disabled={saving || !title.trim()}>
              {saving ? "Saving…" : ev ? "Save changes" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <TouchKeyboard
        visible={kbVisible}
        value={kbValue()}
        onChange={kbChange}
        onDone={() => setKbVisible(false)}
      />
    </>
  );
}

// ── Event Detail Modal ────────────────────────────────────────────────────────

function EventModal({ event, member, onClose, onDelete, onEdit, onToggleImportant }) {
  const start = parseLocalDate(event.start_datetime);
  const end   = parseLocalDate(event.end_datetime);
  const isMultiDay = event.all_day && !isSameDay(start, displayEndDate(event));
  const isHoliday  = event.source === "holiday";
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__head" style={{ borderLeft: `4px solid ${member?.color || "#8b6fde"}` }}>
          <h2>{event.title}</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          {[
            ["Who",      member?.name],
            isMultiDay
              ? ["Dates", `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`]
              : ["Date",  `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`],
            !event.all_day && ["Time", `${formatTime(event.start_datetime)} – ${formatTime(event.end_datetime)}`],
            event.location && ["Location", event.location],
            event.notes    && ["Notes",    event.notes],
          ].filter(Boolean).map(([label, val]) => (
            <div key={label} className="ev-detail">
              <span className="ev-detail__label">{label}</span>
              <span>{val}</span>
            </div>
          ))}
          {event.source === "google" && (
            <p className="ev-google-note">From Google Calendar — edit it there to make changes.</p>
          )}
          {isHoliday && (
            <p className="ev-google-note">Bank holiday / shared event — tap Important to add countdown.</p>
          )}
        </div>
        <div className="modal__foot">
          {event.source === "local" && (
            <button className="btn-danger" onClick={() => onDelete(event.id)}>Delete</button>
          )}
          {event.source === "local" && (
            <button className="btn-secondary" onClick={onEdit}>Edit</button>
          )}
          <button
            className={`btn-secondary ${event.important ? "btn-important--on" : ""}`}
            onClick={onToggleImportant}
          >
            {event.important ? "⭐ Important" : "☆ Important"}
          </button>
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Date Picker Popup ─────────────────────────────────────────────────────────

const DAY_HDR = ["Mo","Tu","We","Th","Fr","Sa","Su"];

function DatePickerPopup({ weekStart, today, onSelect, onClose }) {
  const [viewYear,  setViewYear]  = useState(weekStart.getFullYear());
  const [viewMonth, setViewMonth] = useState(weekStart.getMonth());

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const lastOfMonth  = new Date(viewYear, viewMonth + 1, 0);
  const startDow     = (firstOfMonth.getDay() + 6) % 7; // 0 = Mon

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastOfMonth.getDate(); d++) cells.push(new Date(viewYear, viewMonth, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
  const wEnd   = addDays(wStart, 6);

  return (
    <div className="dp-overlay" onClick={onClose}>
      <div className="dp" onClick={e => e.stopPropagation()}>
        <div className="dp__head">
          <button className="dp__nav" onClick={() => setViewYear(y => y - 1)}>«</button>
          <button className="dp__nav" onClick={prevMonth}>‹</button>
          <span className="dp__title">{MONTHS[viewMonth]} {viewYear}</span>
          <button className="dp__nav" onClick={nextMonth}>›</button>
          <button className="dp__nav" onClick={() => setViewYear(y => y + 1)}>»</button>
        </div>
        <div className="dp__grid">
          {DAY_HDR.map(d => <div key={d} className="dp__dh">{d}</div>)}
          {cells.map((date, i) => {
            if (!date) return <div key={i} className="dp__cell dp__cell--empty" />;
            const d = new Date(date); d.setHours(0,0,0,0);
            const isToday = isSameDay(date, today);
            const inWeek  = d >= wStart && d <= wEnd;
            return (
              <div key={i}
                className={[
                  "dp__cell",
                  isToday ? "dp__cell--today"    : "",
                  inWeek  ? "dp__cell--selected" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => onSelect(date)}
              >
                {date.getDate()}
              </div>
            );
          })}
        </div>
        <div className="dp__foot">
          <button className="dp__today-btn" onClick={() => onSelect(today)}>Today</button>
        </div>
      </div>
    </div>
  );
}

// ── IcalManager / AvatarUpload / UpdateButton ────────────────────────────────

function IcalManager({ member, onReload }) {
  const [urls, setUrls]     = useState(member.ical_urls || []);
  const [newUrl, setNewUrl] = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState("");

  async function save(updatedUrls) {
    setBusy(true);
    await fetch(`${API}/members/${member.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ical_urls: updatedUrls }),
    });
    // Trigger an immediate sync
    fetch(`${API}/sync/now`, { method: "POST" }).catch(() => {});
    setBusy(false);
    onReload();
  }

  async function addUrl() {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("http")) { setError("URL must start with http:// or https://"); return; }
    setError("");
    const updated = [...urls, trimmed];
    setUrls(updated);
    setNewUrl("");
    await save(updated);
  }

  async function removeUrl(url) {
    const updated = urls.filter(u => u !== url);
    setUrls(updated);
    await save(updated);
  }

  return (
    <div className="ical-manager">
      {urls.length === 0 && (
        <p className="ical-empty">No iCal feeds connected</p>
      )}
      {urls.map((url, i) => (
        <div key={i} className="ical-url-row">
          <span className="ical-badge">iCal</span>
          <span className="ical-url-text">{url}</span>
          <button className="btn-icon btn-icon--danger" onClick={() => removeUrl(url)}>✕</button>
        </div>
      ))}
      <div className="ical-add-row">
        <input
          className="s-input"
          value={newUrl}
          onChange={e => { setNewUrl(e.target.value); setError(""); }}
          placeholder="https://example.com/calendar.ics"
          onKeyDown={e => e.key === "Enter" && addUrl()}
        />
        <button className="btn-primary" onClick={addUrl} disabled={busy || !newUrl.trim()}>
          {busy ? "…" : "Add"}
        </button>
      </div>
      {error && <p className="ical-error">{error}</p>}
    </div>
  );
}

function AvatarUpload({ member, onReload, compact = false }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append('avatar', file);
    await fetch(`${API}/members/${member.id}/avatar`, { method: 'POST', body: form });
    setBusy(false);
    onReload();
    e.target.value = "";
  }

  async function handleRemove() {
    await fetch(`${API}/members/${member.id}/avatar`, { method: 'DELETE' });
    onReload();
  }

  const input = (
    <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
  );

  if (compact) {
    return (
      <div className="s-avatar-btn" onClick={() => !busy && fileRef.current?.click()} title="Tap to change photo">
        {member.avatar_url
          ? <img src={member.avatar_url} alt={member.name} className="s-avatar-btn__img" />
          : <div className="s-avatar-btn__initial" style={{ background: member.color }}>{member.name[0]}</div>
        }
        {busy
          ? <div className="s-avatar-btn__overlay">…</div>
          : <div className="s-avatar-btn__overlay">📷</div>
        }
        {input}
      </div>
    );
  }

  return (
    <div className="avatar-upload">
      <div className="avatar-upload__preview" style={{ "--mc": member.color }}>
        {member.avatar_url
          ? <img src={member.avatar_url} alt={member.name} className="avatar-upload__img" />
          : <div className="avatar-upload__initial">{member.name[0]}</div>
        }
      </div>
      <div className="avatar-upload__btns">
        <button className="btn-icon" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "📷 Upload photo"}
        </button>
        {member.avatar_url && (
          <button className="btn-icon btn-icon--danger" onClick={handleRemove}>✕ Remove</button>
        )}
      </div>
      {input}
    </div>
  );
}

// ── Update Button ─────────────────────────────────────────────────────────────

function UpdateButton() {
  const [status, setStatus] = useState("idle"); // idle | running | restarting | done | error
  const [log, setLog]       = useState("");

  async function runUpdate() {
    setStatus("running");
    setLog("");
    let accumulated = "";
    try {
      const res = await fetch(`${API}/update`, { method: "POST" });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        accumulated += chunk;
        setLog(l => l + chunk);
      }
    } catch {
      // Stream interrupted — expected when backend restarts itself
    }

    if (accumulated.includes("Restarting backend")) {
      setStatus("restarting");
      setTimeout(() => window.location.reload(), 8000);
    } else if (accumulated.includes("Update complete") || accumulated.includes("Already up to date")) {
      setStatus("restarting");
      setTimeout(() => window.location.reload(), 3000);
    } else {
      setStatus("error");
    }
  }

  return (
    <div className="update-btn-wrap">
      {status === "idle" && (
        <button className="btn-update" onClick={runUpdate}>↑ Check for updates</button>
      )}
      {status === "running" && (
        <button className="btn-update btn-update--busy" disabled>Updating…</button>
      )}
      {status === "restarting" && (
        <button className="btn-update btn-update--busy" disabled>Restarting… reloading shortly</button>
      )}
      {status === "error" && (
        <button className="btn-update btn-update--error" onClick={() => { setStatus("idle"); setLog(""); }}>
          ✕ Failed — tap to retry
        </button>
      )}
      {log && (
        <pre className="update-log">{log}</pre>
      )}
    </div>
  );
}

// ── Reboot Button ─────────────────────────────────────────────────────────────

function RebootButton() {
  const [status, setStatus] = useState("idle"); // idle | confirm | rebooting

  if (status === "rebooting") {
    return <button className="btn-reboot btn-reboot--busy" disabled>Rebooting…</button>;
  }
  if (status === "confirm") {
    return (
      <div className="reboot-confirm">
        <span className="reboot-confirm__label">Reboot?</span>
        <button className="btn-danger" onClick={async () => {
          setStatus("rebooting");
          await fetch(`${API}/reboot`, { method: "POST" }).catch(() => {});
        }}>Yes, reboot</button>
        <button className="btn-cancel" onClick={() => setStatus("idle")}>Cancel</button>
      </div>
    );
  }
  return <button className="btn-reboot" onClick={() => setStatus("confirm")}>↺ Reboot</button>;
}

// ── Reload Button ─────────────────────────────────────────────────────────────

function ReloadButton() {
  const [status, setStatus] = useState("idle"); // idle | restarting

  async function reload() {
    setStatus("restarting");
    try { await fetch(`${API}/restart`, { method: "POST" }); } catch {}
    setTimeout(() => window.location.reload(), 5000);
  }

  if (status === "restarting") {
    return <button className="btn-reload btn-reload--busy" disabled>↺ Restarting…</button>;
  }
  return <button className="btn-reload" onClick={reload}>↺ Reload</button>;
}

// ── Ambient Photos Manager (used inside Settings) ─────────────────────────────

function AmbientPhotosManager() {
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { loadPhotos(); }, []);

  function loadPhotos() {
    fetch("/api/ambient-photos")
      .then(r => r.ok ? r.json() : [])
      .then(setPhotos)
      .catch(() => setPhotos([]));
  }

  async function handleUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    const form = new FormData();
    for (const f of files) form.append("photos", f);
    try {
      const res = await fetch("/api/ambient-photos", { method: "POST", body: form });
      if (res.ok) loadPhotos();
    } catch {}
    setUploading(false);
    e.target.value = "";
  }

  async function handleDelete(filename) {
    await fetch(`/api/ambient-photos/${encodeURIComponent(filename)}`, { method: "DELETE" });
    loadPhotos();
  }

  return (
    <div className="s-photos">
      <div className="s-photos__grid">
        {photos.map(p => (
          <div key={p.filename} className="s-photos__thumb">
            <img src={p.url} alt="" />
            <button className="s-photos__del" onClick={() => handleDelete(p.filename)}>✕</button>
          </div>
        ))}
      </div>
      <label className="s-photos__upload-btn">
        {uploading ? "Uploading…" : "＋ Add photos"}
        <input type="file" accept="image/*" multiple onChange={handleUpload} hidden />
      </label>
    </div>
  );
}

// ── Slideshow Settings Modal ──────────────────────────────────────────────────

function SlideshowSettingsModal({ settings, onSettingsChange, onClose }) {
  const opacity = Math.round((settings?.ambientPanelOpacity ?? 0.55) * 100);
  return (
    <div className="overlay overlay--raised" onClick={onClose}>
      <div className="modal modal--slideshow" onClick={e => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Slideshow settings</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <div className="s-display-row">
            <label className="s-label">Slide interval</label>
            <select
              className="s-select"
              value={settings?.ambientSlideshowInterval ?? 30}
              onChange={e => onSettingsChange({ ambientSlideshowInterval: Number(e.target.value) })}>
              <option value={10}>10 seconds</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>1 minute</option>
              <option value={120}>2 minutes</option>
              <option value={300}>5 minutes</option>
            </select>
          </div>

          <div className="s-section-divider" />
          <p className="s-section-heading">Weather overlay</p>

          <div className="s-display-row">
            <label className="s-label">Hourly forecast</label>
            <div className="s-unit-toggle">
              <button
                className={`s-unit-btn ${settings?.ambientShowHourly !== false ? "s-unit-btn--on" : ""}`}
                onClick={() => onSettingsChange({ ambientShowHourly: true })}>On</button>
              <button
                className={`s-unit-btn ${settings?.ambientShowHourly === false ? "s-unit-btn--on" : ""}`}
                onClick={() => onSettingsChange({ ambientShowHourly: false })}>Off</button>
            </div>
          </div>

          <div className="s-display-row">
            <label className="s-label">7-day forecast</label>
            <div className="s-unit-toggle">
              <button
                className={`s-unit-btn ${settings?.ambientShowWeekly !== false ? "s-unit-btn--on" : ""}`}
                onClick={() => onSettingsChange({ ambientShowWeekly: true })}>On</button>
              <button
                className={`s-unit-btn ${settings?.ambientShowWeekly === false ? "s-unit-btn--on" : ""}`}
                onClick={() => onSettingsChange({ ambientShowWeekly: false })}>Off</button>
            </div>
          </div>

          <div className="s-display-row">
            <label className="s-label">Panel opacity — {opacity}%</label>
            <input
              type="range" min="10" max="90" step="5"
              value={opacity}
              onChange={e => onSettingsChange({ ambientPanelOpacity: Number(e.target.value) / 100 })}
              className="s-slider"
            />
          </div>

          <div className="s-display-row">
            <label className="s-label">Current weather scale — {Math.round((settings?.ambientCurrentWeatherScale ?? 1) * 100)}%</label>
            <input
              type="range" min="50" max="200" step="5"
              value={Math.round((settings?.ambientCurrentWeatherScale ?? 1) * 100)}
              onChange={e => onSettingsChange({ ambientCurrentWeatherScale: Number(e.target.value) / 100 })}
              className="s-slider"
            />
          </div>

          <div className="s-display-row">
            <label className="s-label">Forecast scale — {Math.round((settings?.ambientWeatherScale ?? 1) * 100)}%</label>
            <input
              type="range" min="50" max="150" step="5"
              value={Math.round((settings?.ambientWeatherScale ?? 1) * 100)}
              onChange={e => onSettingsChange({ ambientWeatherScale: Number(e.target.value) / 100 })}
              className="s-slider"
            />
          </div>

          <div className="s-section-divider" />
          <p className="s-section-label" style={{ marginTop: 4 }}>Photos</p>
          <AmbientPhotosManager />
        </div>
        <div className="modal__foot">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────

function SettingsModal({ members, onClose, onReload, settings, onSettingsChange }) {
  const { tap } = useFeedback();
  const [editing, setEditing]     = useState(null);
  const [editName, setEditName]   = useState("");
  const [editColor, setEditColor] = useState(PALETTE[0]);
  const [showSlideshow, setShowSlideshow] = useState(false);
  const [expanded, setExpanded]   = useState(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName]     = useState("");
  const [newColor, setNewColor]   = useState(PALETTE[0]);
  const [busy, setBusy]           = useState(false);

  // Display / ambient settings
  const [locQuery,   setLocQuery]   = useState(settings?.locationName || "");
  const [locResults, setLocResults] = useState([]);
  const [locBusy,    setLocBusy]    = useState(false);

  async function searchLocation() {
    if (!locQuery.trim()) return;
    setLocBusy(true);
    setLocResults([]);
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locQuery.trim())}&count=5&language=en&format=json`;
      const res  = await fetch(url);
      const data = await res.json();
      setLocResults(data.results || []);
    } catch {}
    setLocBusy(false);
  }

  function pickLocation(r) {
    onSettingsChange({
      locationName: `${r.name}${r.admin1 ? ", " + r.admin1 : ""}, ${r.country}`,
      locationLat:  r.latitude,
      locationLon:  r.longitude,
      timezone:     r.timezone || "UTC",
    });
    setLocQuery(`${r.name}${r.admin1 ? ", " + r.admin1 : ""}, ${r.country}`);
    setLocResults([]);
  }

  function startEdit(m) { setEditing(m.id); setEditName(m.name); setEditColor(m.color); }

  async function saveEdit(id) {
    setBusy(true);
    await fetch(`${API}/members/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, color: editColor }),
    });
    setBusy(false); setEditing(null); onReload();
  }

  async function remove(id) {
    if (!window.confirm("Remove this person? Their local events will be kept but unassigned.")) return;
    await fetch(`${API}/members/${id}`, { method: "DELETE" });
    onReload();
  }

  async function addMember() {
    if (!newName.trim()) return;
    setBusy(true);
    await fetch(`${API}/members`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    });
    setBusy(false); setAddingNew(false); setNewName(""); onReload();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal--settings" onClick={e => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Family members</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          {members.filter(m => !m.is_shared).map(m => (
            <div key={m.id} className="s-member">
              {editing === m.id ? (
                <>
                  <input className="s-input" value={editName}
                    onChange={e => setEditName(e.target.value)} autoFocus />
                  <div className="s-palette">
                    {PALETTE.map(c => (
                      <button key={c} className={`s-swatch ${editColor===c?"s-swatch--on":""}`}
                        style={{ background: c }} onClick={() => setEditColor(c)} />
                    ))}
                  </div>
                  <div className="s-actions">
                    <button className="btn-cancel" onClick={() => setEditing(null)}>Cancel</button>
                    <button className="btn-primary" onClick={() => saveEdit(m.id)} disabled={busy}>
                      {busy ? "…" : "Save"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="s-member__row">
                    <AvatarUpload member={m} onReload={onReload} compact />
                    <span className="s-member__name">{m.name}</span>
                    {m.google_connected && <span className="badge-g" title="Google Calendar connected">G</span>}
                    {(m.ical_urls?.length > 0) && (
                      <span className="badge-ical" title={`${m.ical_urls.length} iCal feed(s)`}>
                        iCal {m.ical_urls.length}
                      </span>
                    )}
                    <div className="s-member__btns">
                      <button className="btn-icon"
                        onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                        {expanded === m.id ? "▲ Feeds" : "▼ Feeds"}
                      </button>
                      <button className="btn-icon" onClick={() => startEdit(m)}>✎ Edit</button>
                      <button className="btn-icon btn-icon--danger" onClick={() => remove(m.id)}>✕</button>
                    </div>
                  </div>
                  {expanded === m.id && (
                    <div className="s-expanded">
                      <p className="s-section-label">Photo</p>
                      <AvatarUpload member={m} onReload={onReload} />
                      <p className="s-section-label" style={{ marginTop: 12 }}>iCal feeds</p>
                      <IcalManager member={m} onReload={onReload} />
                      {m.google_connected ? (
                        <p className="s-note" style={{ marginTop: 8 }}>✓ Google Calendar connected</p>
                      ) : (
                        <>
                          <p className="s-section-label" style={{ marginTop: 12 }}>Google Calendar</p>
                          <code className="s-url">
                            http://pi.local:3001/auth/google/start?member_id={m.id}
                          </code>
                          <p className="s-note">Open on their phone while on home WiFi</p>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {addingNew ? (
            <div className="s-member s-member--new">
              <input className="s-input" value={newName}
                onChange={e => setNewName(e.target.value)} placeholder="Name" autoFocus />
              <div className="s-palette">
                {PALETTE.map(c => (
                  <button key={c} className={`s-swatch ${newColor===c?"s-swatch--on":""}`}
                    style={{ background: c }} onClick={() => setNewColor(c)} />
                ))}
              </div>
              <div className="s-actions">
                <button className="btn-cancel" onClick={() => setAddingNew(false)}>Cancel</button>
                <button className="btn-primary" onClick={addMember} disabled={busy || !newName.trim()}>
                  {busy ? "…" : "Add"}
                </button>
              </div>
            </div>
          ) : (
            <button className="s-add-btn" onClick={() => setAddingNew(true)}>+ Add person</button>
          )}

          {/* ── Display / Ambient settings ── */}
          <div className="s-section-divider" />
          <p className="s-section-heading">Display</p>

          <div className="s-display-row">
            <label className="s-label">Location</label>
            <div className="s-loc-search">
              <input
                className="s-input s-input--loc"
                value={locQuery}
                onChange={e => { setLocQuery(e.target.value); setLocResults([]); }}
                onKeyDown={e => e.key === "Enter" && searchLocation()}
                placeholder="City name…"
              />
              <button className="btn-icon" onClick={searchLocation} disabled={locBusy}>
                {locBusy ? "…" : "Search"}
              </button>
            </div>
            {locResults.length > 0 && (
              <ul className="s-loc-results">
                {locResults.map((r, i) => (
                  <li key={i} className="s-loc-result" onClick={() => pickLocation(r)}>
                    {r.name}{r.admin1 ? `, ${r.admin1}` : ""}, {r.country}
                    <span className="s-loc-tz">{r.timezone}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="s-display-row">
            <label className="s-label">Temperature</label>
            <div className="s-unit-toggle">
              <button
                className={`s-unit-btn ${settings?.tempUnit !== "fahrenheit" ? "s-unit-btn--on" : ""}`}
                onClick={() => onSettingsChange({ tempUnit: "celsius" })}>°C</button>
              <button
                className={`s-unit-btn ${settings?.tempUnit === "fahrenheit" ? "s-unit-btn--on" : ""}`}
                onClick={() => onSettingsChange({ tempUnit: "fahrenheit" })}>°F</button>
            </div>
          </div>

          <div className="s-display-row">
            <label className="s-label">Ambient after</label>
            <select
              className="s-select"
              value={settings?.ambientIdleMinutes ?? 2}
              onChange={e => onSettingsChange({ ambientIdleMinutes: Number(e.target.value) })}>
              <option value={1}>1 minute</option>
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </div>

          <div className="s-display-row">
            <label className="s-label">Background</label>
            <div className="s-display-row__controls">
              <select
                className="s-select"
                value={settings?.ambientBackground ?? "none"}
                onChange={e => onSettingsChange({ ambientBackground: e.target.value })}>
                <option value="none">Dark (default)</option>
                <option value="slideshow">Photo slideshow</option>
              </select>
              {settings?.ambientBackground === "slideshow" && (
                <button className="btn-icon btn-icon--settings" onClick={() => setShowSlideshow(true)}>⚙</button>
              )}
            </div>
          </div>

          <div className="s-display-row">
            <label className="s-label">Tap sound</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="s-select"
                value={settings?.tapSound ?? "mechanical"}
                onChange={e => onSettingsChange({ tapSound: e.target.value })}>
                <option value="mechanical">Mechanical</option>
                <option value="crisp">Crisp</option>
                <option value="soft">Soft</option>
                <option value="off">Off</option>
              </select>
              <button className="btn-icon" onClick={() => tap()}>&#9654; Test</button>
            </div>
          </div>

          {showSlideshow && (
            <SlideshowSettingsModal
              settings={settings}
              onSettingsChange={onSettingsChange}
              onClose={() => setShowSlideshow(false)}
            />
          )}
        </div>
        <div className="modal__foot">
          <UpdateButton />
          <RebootButton />
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Upcoming important events ─────────────────────────────────────────────────

function useUpcomingImportant() {
  const [events, setEvents] = useState([]);
  const load = useCallback(async () => {
    const start = new Date();
    const end   = addDays(start, 180);
    try {
      const r   = await fetch(`${API}/events?start=${start.toISOString()}&end=${end.toISOString()}`);
      const all = await r.json();
      setEvents(
        all
          .filter(e => e.important && daysUntil(e.start_datetime) >= 0)
          .sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime))
      );
    } catch {}
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);
  return { events, reload: load };
}

function CountdownCard({ event }) {
  const start   = parseLocalDate(event.start_datetime);
  const days    = daysUntil(event.start_datetime);
  const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][start.getDay()];
  const dateStr = `${start.getDate()} ${MONTHS[start.getMonth()]}`;
  const isToday = days === 0;

  return (
    <div className={`cd-card ${isToday ? "cd-card--today" : ""}`}>
      <div className="cd-card__date">{dayName}, {dateStr}</div>
      <div className="cd-card__number">{isToday ? "🎉" : days}</div>
      <div className="cd-card__label">
        {isToday ? "Today!" : days === 1 ? "day until" : "days until"}
      </div>
      <div className="cd-card__name">{event.title}</div>
    </div>
  );
}

// ── Person Summary Overlay ───────────────────────────────────────────────────

function PersonSummaryOverlay({ member, onClose }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = startOfWeek(today);
    const end   = addDays(today, 180);
    fetch(`${API}/events?start=${start.toISOString()}&end=${end.toISOString()}`)
      .then(r => r.json())
      .then(data => { setEvents(data.filter(e => e.member_id === member.id)); setLoading(false); })
      .catch(() => setLoading(false));
  }, [member.id]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const thisWeekStart = startOfWeek(today);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const nextWeekEnd   = addDays(thisWeekStart, 14);

  function evStart(ev) { const d = parseLocalDate(ev.start_datetime); d.setHours(0,0,0,0); return d; }

  const thisWeekEvents = events
    .filter(ev => { const s = evStart(ev); return s >= thisWeekStart && s < nextWeekStart; })
    .sort((a, b) => parseLocalDate(a.start_datetime) - parseLocalDate(b.start_datetime));

  const nextWeekEvents = events
    .filter(ev => { const s = evStart(ev); return s >= nextWeekStart && s < nextWeekEnd; })
    .sort((a, b) => parseLocalDate(a.start_datetime) - parseLocalDate(b.start_datetime));

  const importantEvents = events
    .filter(ev => ev.important && daysUntil(ev.start_datetime) >= 0)
    .sort((a, b) => parseLocalDate(a.start_datetime) - parseLocalDate(b.start_datetime))
    .slice(0, 3);

  function EventRow({ ev }) {
    const s = parseLocalDate(ev.start_datetime);
    const dayLabel = d => `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
    const dateStr = isMultiDayAllDay(ev)
      ? `${dayLabel(s)} – ${dayLabel(displayEndDate(ev))}`
      : dayLabel(s);
    const timeStr = ev.all_day ? null : `${formatTime(ev.start_datetime)} – ${formatTime(ev.end_datetime)}`;
    return (
      <div className="ps__event" style={{ "--mc": member.color }}>
        <span className="ps__event-date">{dateStr}</span>
        {timeStr && <span className="ps__event-time">{timeStr}</span>}
        <span className="ps__event-title">{ev.title}</span>
      </div>
    );
  }

  function Column({ title, evs }) {
    return (
      <div className="ps__col">
        <h2 className="ps__col-title">{title}</h2>
        {evs.length
          ? evs.map(ev => <EventRow key={ev.id} ev={ev} />)
          : <p className="ps__empty">Nothing scheduled</p>}
      </div>
    );
  }

  return (
    <div className="overlay ps-overlay" onClick={onClose}>
      <div className="ps" onClick={e => e.stopPropagation()}>
        <button className="modal__close ps__close" onClick={onClose}>✕</button>
        <div className="ps__header" style={{ "--mc": member.color }}>
          {member.avatar_url
            ? <img src={member.avatar_url} alt={member.name} className="ps__avatar" />
            : <div className="ps__avatar ps__avatar--initial">{member.name[0]}</div>}
          <h1 className="ps__name">{member.name}</h1>
        </div>
        <div className="ps__columns">
          <Column title="This Week"  evs={thisWeekEvents}  />
          <Column title="Next Week"  evs={nextWeekEvents}  />
          <Column title="Important"  evs={importantEvents} />
        </div>
        {loading && <div className="ps__loading">Loading…</div>}
      </div>
    </div>
  );
}

function VoiceAssistantDock({ voice }) {
  const statusLabel = {
    off: "Off",
    unsupported: "Unsupported",
    listening: "Listening",
    "listening-local": "Local wake listening",
    "listening-local-wait": "Local wake waiting",
    capturing: "Capturing",
    saving: "Saving",
  }[voice.status] || voice.status;

  return (
    <div className="voice-dock">
      <div className="voice-dock__row">
        <button
          className={`voice-btn ${voice.enabled ? "voice-btn--on" : ""}`}
          onClick={() => voice.setEnabled(v => !v)}
          disabled={!voice.supported}
        >
          {voice.enabled ? "Voice: On" : "Voice: Off"}
        </button>
        <button
          className={`voice-btn ${voice.useLocalWake ? "voice-btn--on" : ""}`}
          onClick={() => voice.setUseLocalWake(v => !v)}
          disabled={!voice.localWakeAvailable}
          title={voice.localWakeAvailable ? "Use backend local wake listener" : "Local wake unavailable on backend"}
        >
          {voice.useLocalWake ? "Local wake: On" : "Local wake: Off"}
        </button>
        <button
          className="voice-btn voice-btn--secondary"
          onClick={voice.captureNow}
          disabled={!voice.supported || voice.busy}
        >
          Tap to speak
        </button>
        {voice.conversationActive && (
          <button
            className="voice-btn voice-btn--secondary"
            onClick={voice.cancelConversation}
          >
            Cancel
          </button>
        )}
      </div>

      <div className="voice-dock__status">Status: {statusLabel}</div>
      <div className="voice-dock__status">Backend wake: {voice.localWakeRunning ? "Running" : "Stopped"}</div>
      <div className="voice-dock__assistant">{voice.assistantText}</div>
      {voice.lastHeard && <div className="voice-dock__heard">Heard: {voice.lastHeard}</div>}
      {voice.error && <div className="voice-dock__error">{voice.error}</div>}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const now   = useClock();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [addModal, setAddModal]         = useState(null);
  const [evModal, setEvModal]           = useState(null);
  const [editModal, setEditModal]       = useState(null);
  const [personSummary, setPersonSummary] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [fontSize, setFontSize]   = useState(() => {
    return parseInt(localStorage.getItem("famcal-fontsize") || "16", 10);
  });

  // Apply font size to root element
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem("famcal-fontsize", fontSize);
  }, [fontSize]);

  function increaseFontSize() { setFontSize(f => Math.min(f + 1, 24)); }
  function decreaseFontSize() { setFontSize(f => Math.max(f - 1, 12)); }

  const { tap, success, back } = useFeedback();
  const { settings, update: updateSettings } = useSettings();
  const { dimmed, waking, activate: activateAmbient } = useDimmer(settings.ambientIdleMinutes * 60 * 1000);
  useCursorHide();
  const { daily: weather, current: currentWeather, hourly: hourlyWeather } = useWeather({
    lat:      settings.locationLat,
    lon:      settings.locationLon,
    timezone: settings.timezone,
    tempUnit: settings.tempUnit,
  });

  const { members, reload: reloadMembers } = useMembers();
  const { events,  reload: reloadEvents  } = useEvents(weekStart);
  const { events: countdownEvents, reload: reloadUpcoming } = useUpcomingImportant();

  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  // Today's events for the sidebar panel
  const todayEvents = events
    .filter(e => eventOnDay(e, today))
    .sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));

  const handlePrevWeek = useDebounce(useCallback(() => { tap(); setWeekStart(w => addDays(w, -7)); }, [tap]), 600);
  const handleNextWeek = useDebounce(useCallback(() => { tap(); setWeekStart(w => addDays(w,  7)); }, [tap]), 600);
  const handleToday    = useDebounce(useCallback(() => { tap(); setWeekStart(startOfWeek(today)); }, [tap, today]), 600);
  const handleCellTap   = useDebounce(useCallback((member, day) => { if (waking) return; tap(); setAddModal({ member, date: day }); }, [tap, waking]), 600);
  const handleEventTap  = useDebounce(useCallback((ev, member) => { if (waking) return; tap(); setEvModal({ event: ev, member }); }, [tap, waking]), 600);
  const handleAvatarTap = useDebounce(useCallback((member) => { if (waking) return; tap(); setPersonSummary(member); }, [tap, waking]), 300);

  // Swipe gestures
  // 1 finger left/right → change week; 2 fingers down → ambient mode
  const touchStartRef = useRef(null);
  function onTouchStart(e) {
    const t = e.touches;
    if (t.length === 1) {
      touchStartRef.current = { fingers: 1, x: t[0].clientX, y: t[0].clientY, wasAmbient: dimmed };
    } else if (t.length === 2) {
      touchStartRef.current = {
        fingers: 2,
        x: (t[0].clientX + t[1].clientX) / 2,
        y: (t[0].clientY + t[1].clientY) / 2,
        wasAmbient: dimmed,
      };
    } else {
      touchStartRef.current = null;
    }
  }
  function onTouchEnd(e) {
    if (!touchStartRef.current || e.touches.length > 0) return;
    const { fingers, x: x0, y: y0, wasAmbient } = touchStartRef.current;
    touchStartRef.current = null;
    if (wasAmbient || waking) return;
    const ct = e.changedTouches;
    const x1 = Array.from(ct).reduce((s, t) => s + t.clientX, 0) / ct.length;
    const y1 = Array.from(ct).reduce((s, t) => s + t.clientY, 0) / ct.length;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const THRESHOLD = 60;
    if (fingers === 1 && Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > THRESHOLD) {
      dx < 0 ? handleNextWeek() : handlePrevWeek();
    } else if (fingers === 2 && dy > THRESHOLD && dy > Math.abs(dx) * 1.5) {
      activateAmbient();
    }
  }

  // Hide loading screen once we have a response from the API
  useEffect(() => {
    if (members.length >= 0) {
      const t = setTimeout(() => setLoading(false), 600);
      return () => clearTimeout(t);
    }
  }, [members]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const weekLabel = (() => {
    const s = days[0], e = days[6];
    if (s.getMonth() === e.getMonth())
      return `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
    return `${s.getDate()} ${MONTHS[s.getMonth()].slice(0,3)} – ${e.getDate()} ${MONTHS[e.getMonth()].slice(0,3)} ${e.getFullYear()}`;
  })();

  async function deleteEvent(id) {
    await fetch(`${API}/events/${id}`, { method: "DELETE" });
    reloadEvents(); reloadUpcoming(); setEvModal(null);
  }

  async function saveEvent(data) {
    await fetch(`${API}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    reloadEvents(); reloadUpcoming();
  }

  async function updateEvent(id, data) {
    await fetch(`${API}/events/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    reloadEvents(); reloadUpcoming();
  }

  const isThisWeek = isSameDay(weekStart, startOfWeek(today));

  return (
    <div className="app" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <LoadingScreen visible={loading} />
      {dimmed && <AmbientMode current={currentWeather} hourly={hourlyWeather} daily={weather} settings={settings} />}
      <header className="topbar">
        <div className="topbar__clock">
          <span className="clock">{pad(now.getHours())}:{pad(now.getMinutes())}</span>
          <span className="topbar__date">
            {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][now.getDay()]},&nbsp;
            {now.getDate()} {MONTHS[now.getMonth()]}
          </span>
        </div>
        <div className="topbar__nav">
          <button className="nav-btn" onClick={handlePrevWeek}>‹</button>
          <button className="week-label" onClick={() => setShowDatePicker(p => !p)}>
            {weekLabel}
            <span className="week-label__chevron">{showDatePicker ? "▴" : "▾"}</span>
          </button>
          <button className="nav-btn" onClick={handleNextWeek}>›</button>
          {!isThisWeek && (
            <button className="today-btn" onClick={handleToday}>Today</button>
          )}
        </div>
        <button className="settings-btn" onClick={() => setShowSettings(true)}>⚙ Settings</button>
        <ReloadButton />
        <div className="font-controls">
          <button className="font-btn" onClick={decreaseFontSize}>A−</button>
          <button className="font-btn" onClick={increaseFontSize}>A+</button>
        </div>
      </header>

      <div className="main-area">
        {/* ── Calendar ── */}
        <div className="cal">
          <div className="cal__head">
            <div className="cal__corner" />
            {days.map((day, i) => {
              const dk = dateKey(day);
              const w  = weather?.[dk];
              const hasBirthday = events.some(e => eventOnDay(e, day) && isBirthday(e));
              return (
                <div key={i} className={`cal__day-hdr ${isSameDay(day, today) ? "cal__day-hdr--today" : ""}`}>
                  {w && (
                    <div className="cal__weather">
                      <span className="cal__weather-icon">{w.icon}</span>
                      <span className="cal__weather-temp">{w.max}°</span>
                    </div>
                  )}
                  <div className="cal__day-hdr-main">
                    <span className="cal__day-name">{DAY_NAMES[day.getDay()]}</span>
                    <span className="cal__day-num">{day.getDate()}</span>
                  </div>
                  {hasBirthday && <span className="cal__birthday">🎂</span>}
                </div>
              );
            })}
          </div>

          <div className="cal__body">
            {members.length === 0 && (
              <div className="cal__empty">
                No family members yet —&nbsp;
                <button onClick={() => setShowSettings(true)}>open Settings</button>
                &nbsp;to add people.
              </div>
            )}
            {members.map(m => {
              const mEvents     = events.filter(e => e.member_id === m.id);
              const spanningEvs = mEvents.filter(e => isMultiDayAllDay(e));
              return (
                <div key={m.id} className="cal__row">
                  <div className="cal__row-label" style={{ "--mc": m.color, cursor: "pointer" }}
                    onClick={e => { e.stopPropagation(); handleAvatarTap(m); }}>
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt={m.name} className="cal__avatar cal__avatar--img" />
                    ) : (
                      <div className="cal__avatar">{m.name[0]}</div>
                    )}
                    <span className="cal__member-name">{m.name}</span>
                  </div>

                  <div className="cal__row-right">
                    {/* ── Spanning all-day events ── */}
                    {spanningEvs.length > 0 && (
                      <div className="cal__span-layer">
                        {spanningEvs.map(ev => {
                          const span = getEventSpan(ev, days);
                          if (!span) return null;
                          const { startCol, endCol, startsBeforeWeek, endsAfterWeek } = span;
                          return (
                            <div
                              key={ev.id}
                              className={[
                                "ev ev--span",
                                startsBeforeWeek ? "ev--span-clipped-s" : "",
                                endsAfterWeek    ? "ev--span-clipped-e" : "",
                              ].filter(Boolean).join(" ")}
                              style={{ "--mc": m.color, gridColumn: `${startCol} / ${endCol}` }}
                              onClick={e => { e.stopPropagation(); handleEventTap(ev, m); }}
                            >
                              {startsBeforeWeek && <span className="ev__span-arrow">◀</span>}
                              <span className="ev__title">{ev.title}</span>
                              {endsAfterWeek && <span className="ev__span-arrow">▶</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ── Day cells ── */}
                    <div className="cal__cells-row">
                      {days.map((day, di) => {
                        const dayEvs = mEvents.filter(e => eventOnDay(e, day));
                        const isToday = isSameDay(day, today);
                        return (
                          <div
                            key={di}
                            className={`cal__cell ${isToday ? "cal__cell--today" : ""}`}
                            onClick={() => handleCellTap(m, day)}
                          >
                            {dayEvs.map((ev, ei) => {
                              const days_until = daysUntil(ev.start_datetime);
                              return (
                                <div
                                  key={ei}
                                  className={`ev ${ev.important ? "ev--important" : ""}`}
                                  style={{ "--mc": m.color }}
                                  onClick={e => { e.stopPropagation(); handleEventTap(ev, m); }}
                                >
                                  <div className="ev__top">
                                    <span className="ev__title">{ev.title}</span>
                                    {ev.important && days_until > 0 && days_until <= 14 && (
                                      <span className="ev__countdown">
                                        {days_until === 1 ? "tomorrow" : `in ${days_until}d`}
                                      </span>
                                    )}
                                    {ev.important && days_until === 0 && (
                                      <span className="ev__countdown ev__countdown--today">today!</span>
                                    )}
                                  </div>
                                  <div className="ev__meta">
                                    {!ev.all_day && (
                                      <span className="ev__time">
                                        {formatTime(ev.start_datetime)}–{formatTime(ev.end_datetime)}
                                      </span>
                                    )}
                                    {ev.source === "google" && <span className="ev__g">G</span>}
                                    {ev.source === "ical"   && <span className="ev__ical">iCal</span>}
                                    {ev.source === "holiday" && <span className="ev__holiday">🏖</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div className="sidebar">
          <aside className="today-panel">
            <div className="today-panel__head">
              <div className="today-panel__title">Today</div>
              <div className="today-panel__date">
                {today.getDate()} {MONTHS[today.getMonth()]}
              </div>
            </div>
            <div className="today-panel__body">
              {todayEvents.length === 0 && (
                <p className="today-panel__empty">Nothing on today</p>
              )}
              {todayEvents.map(ev => {
                const member = memberMap[ev.member_id];
                const color  = ev.color || member?.color || "#4f6ef7";
                return (
                  <div key={ev.id} className="today-ev" style={{ "--mc": color }}
                    onClick={() => handleEventTap(ev, member)}>
                    <div className="today-ev__bar" />
                    <div className="today-ev__info">
                      <div className="today-ev__title">{ev.title}</div>
                      <div className="today-ev__meta">
                        {ev.all_day
                          ? <span>All day</span>
                          : <span>{formatTime(ev.start_datetime)}–{formatTime(ev.end_datetime)}</span>
                        }
                        {member && <span>· {member.name}</span>}
                      </div>
                    </div>
                    {member?.avatar_url ? (
                      <img src={member.avatar_url} alt={member.name} className="today-ev__avatar" />
                    ) : member ? (
                      <div className="today-ev__initial" style={{ background: member.color }}>
                        {member.name[0]}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button className="today-panel__add" onClick={() => handleCellTap(members[0], today)}>
              + Add today
            </button>
          </aside>

          {countdownEvents.length > 0 && (
            <div className="countdown-panel">
              <div className="countdown-panel__head">Upcoming</div>
              <div className="countdown-panel__body">
                {countdownEvents.map(ev => (
                  <CountdownCard key={ev.id} event={ev} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showDatePicker && (
        <DatePickerPopup
          weekStart={weekStart}
          today={today}
          onSelect={date => { setWeekStart(startOfWeek(date)); setShowDatePicker(false); tap(); }}
          onClose={() => setShowDatePicker(false)}
        />
      )}
      {addModal && (
        <AddEventModal date={addModal.date} member={addModal.member}
          members={members}
          onClose={() => setAddModal(null)} onSave={saveEvent} />
      )}
      {evModal && (
        <EventModal event={evModal.event} member={memberMap[evModal.event.member_id]}
          onClose={() => setEvModal(null)} onDelete={deleteEvent}
          onEdit={() => { setEditModal(evModal.event); setEvModal(null); }}
          onToggleImportant={() => {
            updateEvent(evModal.event.id, { important: evModal.event.important ? 0 : 1 });
            setEvModal(null);
          }} />
      )}
      {editModal && (
        <AddEventModal existingEvent={editModal} member={memberMap[editModal.member_id]}
          members={members} onClose={() => setEditModal(null)}
          onSave={data => updateEvent(editModal.id, data)} />
      )}
      {showSettings && (
        <SettingsModal members={members} settings={settings} onSettingsChange={updateSettings}
          onClose={() => setShowSettings(false)} onReload={reloadMembers} />
      )}
      {personSummary && (
        <PersonSummaryOverlay member={personSummary} onClose={() => setPersonSummary(null)} />
      )}
    </div>
  );
}
