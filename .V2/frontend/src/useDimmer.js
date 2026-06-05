import { useEffect, useRef, useState, useCallback } from "react";

// Dims the screen after idleMs of no interaction
// Brightens instantly on any touch/click
const DEFAULT_IDLE_MS = 2 * 60 * 1000;
const WAKE_GUARD_MS   = 800; // block calendar input for this long after waking

export function useDimmer(idleMs = DEFAULT_IDLE_MS) {
  const [dimmed, setDimmed]   = useState(false);
  const [waking, setWaking]   = useState(false);
  const timer     = useRef(null);
  const wakeTimer = useRef(null);
  const wasDimmed = useRef(false);
  const idleMsRef = useRef(idleMs);
  idleMsRef.current = idleMs;

  const reset = useCallback(() => {
    if (wasDimmed.current) {
      // Screen is waking — engage guard
      wasDimmed.current = false;
      setWaking(true);
      clearTimeout(wakeTimer.current);
      wakeTimer.current = setTimeout(() => setWaking(false), WAKE_GUARD_MS);
    }
    setDimmed(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      wasDimmed.current = true;
      setDimmed(true);
    }, idleMsRef.current);
  }, []);

  useEffect(() => {
    reset();

    const events = ["touchstart", "pointerdown", "mousemove", "keydown"];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));

    return () => {
      clearTimeout(timer.current);
      clearTimeout(wakeTimer.current);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [reset]);

  function activate() {
    clearTimeout(timer.current);
    wasDimmed.current = true;
    setDimmed(true);
  }

  return { dimmed, waking, activate };
}
