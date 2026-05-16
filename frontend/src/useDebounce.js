import { useRef, useCallback } from "react";

// Returns a debounced version of fn that ignores calls within `ms` of the last call
export function useDebounce(fn, ms = 200) {
  const last = useRef(0);
  return useCallback((...args) => {
    const now = Date.now();
    if (now - last.current < ms) return;
    last.current = now;
    fn(...args);
  }, [fn, ms]);
}
