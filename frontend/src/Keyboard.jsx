import { useState, useEffect, useCallback, useRef } from "react";
import "./Keyboard.css";
import { useFeedback } from "./useFeedback.js";

// ── Key layout ────────────────────────────────────────────────────────────────

const ROWS_ALPHA = [
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l"],
  ["SHIFT","z","x","c","v","b","n","m","⌫"],
];

const ROWS_ALPHA_SHIFT = [
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L"],
  ["SHIFT","Z","X","C","V","B","N","M","⌫"],
];

const ROWS_NUM = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["-","_",".",",","!","?","@","#","£","&"],
  ["ABC","(",")"," "," ","'",'"',"/","⌫"],
];

// ── Keyboard component ────────────────────────────────────────────────────────

export default function TouchKeyboard({ targetRef, value, onChange, onDone, visible }) {
  const [mode, setMode]         = useState("alpha");
  const [shift, setShift]       = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const { tap, back }           = useFeedback();
  const lastPress               = useRef(0);

  // Reset state when keyboard opens
  useEffect(() => {
    if (visible) { setMode("alpha"); setShift(false); }
  }, [visible]);

  const press = useCallback((key) => {
    const now = Date.now();
    if (now - lastPress.current < 80) return;
    lastPress.current = now;
    if (key === "SHIFT") {
      tap();
      if (shift) {
        if (capsLock) { setCapsLock(false); setShift(false); }
        else { setCapsLock(true); }
      } else {
        setShift(true);
      }
      return;
    }
    if (key === "ABC") { tap(); setMode("alpha"); return; }
    if (key === "123") { tap(); setMode("num");   return; }
    if (key === "⌫") {
      back();
      onChange(value.slice(0, -1));
      return;
    }
    if (key === "DONE") { tap(); onDone(); return; }

    tap();
    const char = (mode === "alpha" && (shift || capsLock)) ? key.toUpperCase() : key;
    onChange(value + char);
    if (shift && !capsLock) setShift(false);
  }, [value, onChange, onDone, mode, shift, capsLock, tap, back]);

  if (!visible) return null;

  const rows = mode === "num" ? ROWS_NUM : (shift || capsLock) ? ROWS_ALPHA_SHIFT : ROWS_ALPHA;

  return (
    <div className="kb" onMouseDown={e => e.preventDefault()}>
      <div className="kb__rows">
        {rows.map((row, ri) => (
          <div key={ri} className="kb__row">
            {row.map((key, ki) => {
              const isShift  = key === "SHIFT";
              const isBack   = key === "⌫";
              const isSpace  = key === " ";
              const isMode   = key === "ABC" || key === "123";
              const isActive = isShift && (shift || capsLock);
              const isCaps   = isShift && capsLock;
              return (
                <button
                  key={ki}
                  className={[
                    "kb__key",
                    isShift ? "kb__key--shift" : "",
                    isBack  ? "kb__key--back"  : "",
                    isSpace ? "kb__key--space" : "",
                    isMode  ? "kb__key--mode"  : "",
                    isActive ? "kb__key--active" : "",
                    isCaps   ? "kb__key--caps"   : "",
                  ].filter(Boolean).join(" ")}
                  onTouchStart={(e) => { e.preventDefault(); press(key); }}
                  onPointerDown={(e) => { e.preventDefault(); }}
                >
                  {isShift ? (capsLock ? "⇪" : "⇧") : key === " " ? "" : key}
                </button>
              );
            })}
          </div>
        ))}

        {/* Bottom row: mode toggle, space, done */}
        <div className="kb__row kb__row--bottom">
          <button className="kb__key kb__key--mode"
            onTouchStart={e => { e.preventDefault(); setMode(m => m === "alpha" ? "num" : "alpha"); tap(); }}
            onPointerDown={e => e.preventDefault()}>
            {mode === "alpha" ? "123" : "ABC"}
          </button>
          <button className="kb__key kb__key--space"
            onTouchStart={e => { e.preventDefault(); press(" "); }}
            onPointerDown={e => e.preventDefault()}>
            space
          </button>
          <button className="kb__key kb__key--done"
            onTouchStart={e => { e.preventDefault(); onDone(); tap(); }}
            onPointerDown={e => e.preventDefault()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
