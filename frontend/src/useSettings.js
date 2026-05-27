import { useState } from "react";

const KEY = "famcal-display-settings";

const DEFAULTS = {
  locationName: "Ammanford",
  locationLat: 51.7956,
  locationLon: -3.9994,
  timezone: "Europe/London",
  tempUnit: "celsius",       // "celsius" | "fahrenheit"
  ambientIdleMinutes: 2,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export function useSettings() {
  const [settings, setSettings] = useState(load);

  function update(partial) {
    setSettings(s => {
      const next = { ...s, ...partial };
      save(next);
      return next;
    });
  }

  return { settings, update };
}
