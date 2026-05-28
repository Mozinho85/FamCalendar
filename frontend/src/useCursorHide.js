import { useEffect, useRef } from "react";

const HIDE_AFTER_MS = 5000;

export function useCursorHide() {
  const timer = useRef(null);

  useEffect(() => {
    const show = () => {
      document.body.classList.add("cursor-active");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        document.body.classList.remove("cursor-active");
      }, HIDE_AFTER_MS);
    };

    // Only real mouse hardware — ignores touch (pointerType "touch") and stylus
    const onPointerMove = (e) => {
      if (e.pointerType === "mouse") show();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      clearTimeout(timer.current);
      document.body.classList.remove("cursor-active");
    };
  }, []);
}
