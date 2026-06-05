import { useState, useEffect, useRef } from "react";

const API = "/api/settings";
const CACHE_KEY = "famcal-display-settings";

const DEFAULTS = {
  locationName: "Ammanford",
  locationLat: 51.7956,
  locationLon: -3.9994,
  timezone: "Europe/London",
  tempUnit: "celsius",
  ambientIdleMinutes: 2,
  ambientBackground: "none",
  ambientSlideshowInterval: 30,
  tapSound: "mechanical",
};

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveCache(s) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch {}
}

export function useSettings() {
  const [settings, setSettings] = useState(loadCache);
  const pendingRef = useRef(null);

  // Fetch from server on mount — overrides the local cache
  useEffect(() => {
    fetch(API)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const merged = { ...DEFAULTS, ...data };
        setSettings(merged);
        saveCache(merged);
      })
      .catch(() => {});
  }, []);

  function update(partial) {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      saveCache(next);

      // Debounce server writes — wait 400ms for rapid changes (e.g. slider)
      clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => {
        fetch(API, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }).catch(() => {});
      }, 400);

      return next;
    });
  }

  return { settings, update };
}
