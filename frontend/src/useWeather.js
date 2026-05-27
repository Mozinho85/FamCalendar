import { useState, useEffect, useRef } from "react";

const WMO = {
  0:  { icon: "☀️",  label: "Clear" },
  1:  { icon: "🌤️", label: "Mostly clear" },
  2:  { icon: "⛅",  label: "Partly cloudy" },
  3:  { icon: "☁️",  label: "Overcast" },
  45: { icon: "🌫️", label: "Fog" },
  48: { icon: "🌫️", label: "Icy fog" },
  51: { icon: "🌦️", label: "Light drizzle" },
  53: { icon: "🌦️", label: "Drizzle" },
  55: { icon: "🌧️", label: "Heavy drizzle" },
  61: { icon: "🌧️", label: "Light rain" },
  63: { icon: "🌧️", label: "Rain" },
  65: { icon: "🌧️", label: "Heavy rain" },
  71: { icon: "🌨️", label: "Light snow" },
  73: { icon: "🌨️", label: "Snow" },
  75: { icon: "❄️",  label: "Heavy snow" },
  77: { icon: "🌨️", label: "Snow grains" },
  80: { icon: "🌦️", label: "Showers" },
  81: { icon: "🌧️", label: "Heavy showers" },
  82: { icon: "⛈️",  label: "Violent showers" },
  85: { icon: "🌨️", label: "Snow showers" },
  86: { icon: "🌨️", label: "Heavy snow showers" },
  95: { icon: "⛈️",  label: "Thunderstorm" },
  96: { icon: "⛈️",  label: "Thunderstorm w/ hail" },
  99: { icon: "⛈️",  label: "Heavy thunderstorm" },
};

function getWeatherInfo(code) {
  if (code === null || code === undefined) return { icon: "🌡️", label: "Unknown" };
  return WMO[code] || WMO[Math.floor(code / 10) * 10] || { icon: "🌡️", label: "Unknown" };
}

const DEFAULT_PARAMS = {
  lat: 51.7956,
  lon: -3.9994,
  timezone: "Europe/London",
  tempUnit: "celsius",
};

export function useWeather(params = {}) {
  const { lat, lon, timezone, tempUnit } = { ...DEFAULT_PARAMS, ...params };

  const [daily, setDaily]     = useState(null);
  const [current, setCurrent] = useState(null);
  const [hourly, setHourly]   = useState(null);

  // Track previous params to re-fetch when they change
  const prevRef = useRef(null);
  const key = `${lat},${lon},${timezone},${tempUnit}`;

  useEffect(() => {
    async function fetch_() {
      try {
        const unitParam = tempUnit === "fahrenheit" ? "&temperature_unit=fahrenheit" : "";
        const url = `https://api.open-meteo.com/v1/forecast`
          + `?latitude=${lat}&longitude=${lon}`
          + `&daily=weathercode,temperature_2m_max,temperature_2m_min`
          + `&hourly=temperature_2m,weathercode,precipitation_probability`
          + `&current=temperature_2m,weathercode`
          + `&timezone=${encodeURIComponent(timezone)}`
          + `&forecast_days=7`
          + unitParam;

        const res  = await fetch(url);
        const data = await res.json();

        // Daily map keyed by YYYY-MM-DD
        const map = {};
        data.daily.time.forEach((date, i) => {
          map[date] = {
            ...getWeatherInfo(data.daily.weathercode[i]),
            max: Math.round(data.daily.temperature_2m_max[i]),
            min: Math.round(data.daily.temperature_2m_min[i]),
          };
        });
        setDaily(map);

        // Current conditions
        if (data.current) {
          setCurrent({
            ...getWeatherInfo(data.current.weathercode),
            temp: Math.round(data.current.temperature_2m),
          });
        }

        // Hourly for today
        if (data.hourly) {
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
          const arr = [];
          data.hourly.time.forEach((t, i) => {
            if (!t.startsWith(todayStr)) return;
            arr.push({
              timeStr: t.slice(11, 16),
              hour: parseInt(t.slice(11, 13), 10),
              ...getWeatherInfo(data.hourly.weathercode[i]),
              temp: Math.round(data.hourly.temperature_2m[i]),
              precip: data.hourly.precipitation_probability?.[i] ?? 0,
            });
          });
          setHourly(arr);
        }
      } catch {}
    }

    fetch_();
    const id = setInterval(fetch_, 30 * 60 * 1000); // refresh every 30 min
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { daily, current, hourly };
}
