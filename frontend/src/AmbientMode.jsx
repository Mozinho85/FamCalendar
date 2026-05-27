import { useState, useEffect, useRef } from "react";
import "./AmbientMode.css";

const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

function pad(n) { return String(n).padStart(2, "0"); }

export default function AmbientMode({ current, settings }) {
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
      </div>
    </div>
  );
}
