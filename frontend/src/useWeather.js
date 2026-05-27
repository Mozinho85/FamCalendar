import { useState, useEffect } from "react";

// Open-Meteo — free, no API key required
// Ammanford, Wales coordinates
const LAT = 51.7956;
const LON = -3.9994;

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

export function useWeather() {
  const [weather, setWeather] = useState(null); // keyed by YYYY-MM-DD

  useEffect(() => {
    async function fetch_() {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Europe%2FLondon&forecast_days=7`;
        const res  = await fetch(url);
        const data = await res.json();
        const map  = {};
        data.daily.time.forEach((date, i) => {
          map[date] = {
            ...getWeatherInfo(data.daily.weathercode[i]),
            max: Math.round(data.daily.temperature_2m_max[i]),
            min: Math.round(data.daily.temperature_2m_min[i]),
          };
        });
        setWeather(map);
      } catch {}
    }
    fetch_();
    const id = setInterval(fetch_, 60 * 60 * 1000); // refresh hourly
    return () => clearInterval(id);
  }, []);

  return weather;
}
