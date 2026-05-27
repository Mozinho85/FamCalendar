import { useState, useEffect } from "react";
import "./AmbientMode.css";

const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

function pad(n) { return String(n).padStart(2, "0"); }

export default function AmbientMode({ current, hourly, daily, settings }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  const hours   = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const dayName = DAYS[now.getDay()];
  const date    = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const unit    = settings?.tempUnit === "fahrenheit" ? "°F" : "°C";

  // Upcoming hours today (from current hour, up to 12)
  const upcomingHours = (hourly || [])
    .filter(h => h.hour >= now.getHours())
    .slice(0, 12);

  // 7-day forecast as sorted array
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const weekDays = Object.entries(daily || {})
    .filter(([d]) => d >= today)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 7)
    .map(([dateStr, d]) => {
      const dt = new Date(dateStr + "T12:00:00");
      return { dayName: DAYS_SHORT[dt.getDay()], dateStr, ...d };
    });

  return (
    <div className="ambient">
      <div className="ambient__content">
        <div className="ambient__time">
          <span className="ambient__hours">{hours}</span>
          <span className="ambient__colon">:</span>
          <span className="ambient__minutes">{minutes}</span>
        </div>
        <div className="ambient__date">{dayName}, {date}</div>

        {current && (
          <div className="ambient__weather">
            <span className="ambient__weather-icon">{current.icon}</span>
            <span className="ambient__weather-temp">{current.temp}{unit}</span>
            <span className="ambient__weather-label">{current.label}</span>
          </div>
        )}

        {settings?.locationName && (
          <div className="ambient__location">📍 {settings.locationName}</div>
        )}

        {upcomingHours.length > 0 && (
          <div className="ambient__section">
            <div className="ambient__section-label">Today</div>
            <div className="ambient__hourly">
              {upcomingHours.map((h, i) => (
                <div key={i} className={`ambient__hour ${h.hour === now.getHours() ? "ambient__hour--now" : ""}`}>
                  <span className="ambient__hour-time">{h.timeStr}</span>
                  <span className="ambient__hour-icon">{h.icon}</span>
                  <span className="ambient__hour-temp">{h.temp}°</span>
                  {h.precip > 0 && (
                    <span className="ambient__hour-precip">{h.precip}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {weekDays.length > 0 && (
          <div className="ambient__section">
            <div className="ambient__section-label">7-day forecast</div>
            <div className="ambient__week">
              {weekDays.map((d, i) => (
                <div key={i} className={`ambient__weekday ${i === 0 ? "ambient__weekday--today" : ""}`}>
                  <span className="ambient__weekday-name">{i === 0 ? "Today" : d.dayName}</span>
                  <span className="ambient__weekday-icon">{d.icon}</span>
                  <span className="ambient__weekday-max">{d.max}°</span>
                  <span className="ambient__weekday-min">{d.min}°</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
