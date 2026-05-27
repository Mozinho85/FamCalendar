import { useEffect, useRef, useState } from "react";

// Dims the screen after idleMs of no interaction
// Brightens instantly on any touch/click
const DEFAULT_IDLE_MS = 2 * 60 * 1000;

export function useDimmer(idleMs = DEFAULT_IDLE_MS) {
  const [dimmed, setDimmed] = useState(false);
  const timer = useRef(null);
  const idleMsRef = useRef(idleMs);
  idleMsRef.current = idleMs;

  function reset() {
    setDimmed(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDimmed(true), idleMsRef.current);
  }

  useEffect(() => {
    reset();

    const events = ["touchstart", "pointerdown", "mousemove", "keydown"];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));

    return () => {
      clearTimeout(timer.current);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, []);

  function activate() {
    clearTimeout(timer.current);
    setDimmed(true);
  }

  return { dimmed, activate };
}
