import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import TouchKeyboard from "./Keyboard.jsx";
import { useFeedback } from "./useFeedback.js";
import { useDimmer } from "./useDimmer.js";
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
  const target = new Date(dateStr); target.setHours(0,0,0,0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

function pad(n) { return String(n).padStart(2, "0"); }
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
function eventOnDay(ev, day) {
  const start = new Date(ev.start_datetime);
  const end   = new Date(ev.end_datetime);
  const dayEnd = new Date(day); dayEnd.setHours(23,59,59,999);
  return start <= dayEnd && end >= new Date(day);
}

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const PALETTE = ["#e05a8a","#2db88a","#f09030","#3a9fe0","#8b6fde","#e06030","#10b981","#d946ef"];

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useMembers() {
  const [members, setMembers] = useState([]);
  const load = useCallback(async () => {
    try { const r = await fetch(`${API}/members`); setMembers(await r.json()); } catch {}
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

function AddEventModal({ date, member, members, onClose, onSave }) {
  const { tap, success, back } = useFeedback();
  const [title, setTitle]         = useState("");
  const [memberId, setMemberId]   = useState(member?.id || members[0]?.id || "");
  const [allDay, setAllDay]       = useState(true);
  const [dateStr, setDateStr]     = useState(
    date ? `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}` : ""
  );
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime]     = useState("10:00");
  const [location, setLocation]   = useState("");
  const [important, setImportant] = useState(false);
  const [saving, setSaving]       = useState(false);

  // Keyboard state
  const [kbTarget, setKbTarget]   = useState(null); // "title" | "location" | null
  const [kbVisible, setKbVisible] = useState(false);

  function focusField(field) {
    tap();
    setKbTarget(field);
    setKbVisible(true);
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
    const end   = allDay ? `${dateStr}T23:59:59` : `${dateStr}T${endTime}:00`;
    await onSave({ title: title.trim(), start_datetime: start, end_datetime: end,
                   all_day: allDay, member_id: memberId, location, important });
    success();
    setSaving(false);
    onClose();
  }

  return (
    <>
      <div className="overlay" onClick={() => { setKbVisible(false); onClose(); }}>
        <div className={`modal ${kbVisible ? "modal--kb-open" : ""}`}
          onClick={e => e.stopPropagation()}>
          <div className="modal__head">
            <h2>Add event</h2>
            <button className="modal__close" onClick={onClose}>✕</button>
          </div>
          <div className="modal__body">

            {/* Title — tappable field, shows keyboard */}
            <div className="field">
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
            <label className="field"><span>Date</span>
              <input type="date" value={dateStr}
                onChange={e => setDateStr(e.target.value)}
                onFocus={() => setKbVisible(false)} />
            </label>

            {/* All day toggle */}
            <label className="field field--inline">
              <input type="checkbox" checked={allDay}
                onChange={e => setAllDay(e.target.checked)} />
              <span>All day</span>
            </label>

            {/* Time pickers */}
            {!allDay && (
              <div className="field-row">
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
            <div className="field">
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
            <label className="field field--inline">
              <input type="checkbox" checked={important}
                onChange={e => setImportant(e.target.checked)} />
              <span>⭐ Mark as important (shows countdown)</span>
            </label>

          </div>
          <div className="modal__foot">
            <button className="btn-cancel" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={saving || !title.trim()}>
              {saving ? "Saving…" : "Save"}
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

function EventModal({ event, member, onClose, onDelete }) {
  const start = new Date(event.start_datetime);
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
            ["Date",     `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`],
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
        </div>
        <div className="modal__foot">
          {event.source === "local" && (
            <button className="btn-danger" onClick={() => onDelete(event.id)}>Delete</button>
          )}
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────

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

function AvatarUpload({ member, onReload }) {
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
  }

  async function handleRemove() {
    await fetch(`${API}/members/${member.id}/avatar`, { method: 'DELETE' });
    onReload();
  }

  return (
    <div className="avatar-upload">
      <div className="avatar-upload__preview" style={{ "--mc": member.color }}>
        {member.avatar_url ? (
          <img src={member.avatar_url} alt={member.name} className="avatar-upload__img" />
        ) : (
          <div className="avatar-upload__initial">{member.name[0]}</div>
        )}
      </div>
      <div className="avatar-upload__btns">
        <button className="btn-icon" onClick={() => fileRef.current.click()} disabled={busy}>
          {busy ? "Uploading…" : "📷 Upload photo"}
        </button>
        {member.avatar_url && (
          <button className="btn-icon btn-icon--danger" onClick={handleRemove}>✕ Remove</button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </div>
  );
}

// ── Update Button ─────────────────────────────────────────────────────────────

function UpdateButton() {
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [log, setLog]       = useState("");

  async function runUpdate() {
    setStatus("running");
    setLog("");
    try {
      const res = await fetch(`${API}/update`, { method: "POST" });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setLog(l => l + decoder.decode(value));
      }
      setStatus("done");
    } catch (err) {
      setLog(l => l + `\nError: ${err.message}`);
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
      {status === "done" && (
        <button className="btn-update btn-update--done" onClick={() => { setStatus("idle"); setLog(""); }}>
          ✓ Updated — tap to dismiss
        </button>
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

// ── Settings Modal ────────────────────────────────────────────────────────────

function SettingsModal({ members, onClose, onReload, settings, onSettingsChange }) {
  const [editing, setEditing]     = useState(null);
  const [editName, setEditName]   = useState("");
  const [editColor, setEditColor] = useState(PALETTE[0]);
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
          {members.map(m => (
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
                    <div className="s-avatar" style={{ background: m.color }}>{m.name[0]}</div>
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
        </div>
        <div className="modal__foot">
          <UpdateButton />
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const now   = useClock();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [addModal, setAddModal]   = useState(null);
  const [evModal, setEvModal]     = useState(null);
  const [showSettings, setShowSettings] = useState(false);
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
  const dimmed  = useDimmer(settings.ambientIdleMinutes * 60 * 1000);
  const { daily: weather, current: currentWeather } = useWeather({
    lat:      settings.locationLat,
    lon:      settings.locationLon,
    timezone: settings.timezone,
    tempUnit: settings.tempUnit,
  });

  const { members, reload: reloadMembers } = useMembers();
  const { events,  reload: reloadEvents  } = useEvents(weekStart);
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  // Today's events for the sidebar panel
  const todayEvents = events
    .filter(e => eventOnDay(e, today))
    .sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));

  const handlePrevWeek = useDebounce(useCallback(() => { tap(); setWeekStart(w => addDays(w, -7)); }, [tap]), 300);
  const handleNextWeek = useDebounce(useCallback(() => { tap(); setWeekStart(w => addDays(w,  7)); }, [tap]), 300);
  const handleToday    = useDebounce(useCallback(() => { tap(); setWeekStart(startOfWeek(today)); }, [tap, today]), 300);
  const handleCellTap  = useDebounce(useCallback((member, day) => { tap(); setAddModal({ member, date: day }); }, [tap]), 300);
  const handleEventTap = useDebounce(useCallback((ev, member) => { tap(); setEvModal({ event: ev, member }); }, [tap]), 300);

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
    reloadEvents(); setEvModal(null);
  }

  async function saveEvent(data) {
    await fetch(`${API}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    reloadEvents();
  }

  const isThisWeek = isSameDay(weekStart, startOfWeek(today));

  return (
    <div className="app">
      <LoadingScreen visible={loading} />
      {dimmed && <AmbientMode current={currentWeather} settings={settings} />}
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
          <span className="week-label">{weekLabel}</span>
          <button className="nav-btn" onClick={handleNextWeek}>›</button>
          {!isThisWeek && (
            <button className="today-btn" onClick={handleToday}>Today</button>
          )}
        </div>
        <button className="settings-btn" onClick={() => setShowSettings(true)}>⚙ Settings</button>
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
              const mEvents = events.filter(e => e.member_id === m.id);
              return (
                <div key={m.id} className="cal__row">
                  <div className="cal__row-label" style={{ "--mc": m.color }}>
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt={m.name} className="cal__avatar cal__avatar--img" />
                    ) : (
                      <div className="cal__avatar">{m.name[0]}</div>
                    )}
                    <span className="cal__member-name">{m.name}</span>
                  </div>
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
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Today panel ── */}
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
      </div>

      {addModal && (
        <AddEventModal date={addModal.date} member={addModal.member} members={members}
          onClose={() => setAddModal(null)} onSave={saveEvent} />
      )}
      {evModal && (
        <EventModal event={evModal.event} member={memberMap[evModal.event.member_id]}
          onClose={() => setEvModal(null)} onDelete={deleteEvent} />
      )}
      {showSettings && (
        <SettingsModal members={members} settings={settings} onSettingsChange={updateSettings}
          onClose={() => setShowSettings(false)} onReload={reloadMembers} />
      )}
    </div>
  );
}
