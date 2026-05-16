import { useEffect, useRef, useState } from "react";

// Dims the screen after IDLE_MS of no interaction
// Brightens instantly on any touch/click
const IDLE_MS = 2 * 60 * 1000; // 2 minutes
const DIM_OPACITY = 0.08;       // how dark to go (0 = black, 1 = full brightness)

export function useDimmer() {
  const [dimmed, setDimmed] = useState(false);
  const timer = useRef(null);

  function reset() {
    setDimmed(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDimmed(true), IDLE_MS);
  }

  useEffect(() => {
    // Start the timer
    reset();

    // Any interaction resets it
    const events = ["touchstart", "pointerdown", "mousemove", "keydown"];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));

    return () => {
      clearTimeout(timer.current);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, []);

  return dimmed;
}
