import { useState, useEffect, useCallback } from "react";
import "./Keyboard.css";

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
  const [mode, setMode]       = useState("alpha"); // alpha | num
  const [shift, setShift]     = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  // Reset state when keyboard opens
  useEffect(() => {
    if (visible) { setMode("alpha"); setShift(false); }
  }, [visible]);

  const press = useCallback((key) => {
    if (key === "SHIFT") {
      if (shift) {
        // Double tap = caps lock
        if (capsLock) { setCapsLock(false); setShift(false); }
        else { setCapsLock(true); }
      } else {
        setShift(true);
      }
      return;
    }
    if (key === "ABC") { setMode("alpha"); return; }
    if (key === "123") { setMode("num");   return; }
    if (key === "⌫") {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === "DONE") { onDone(); return; }

    const char = (mode === "alpha" && (shift || capsLock)) ? key.toUpperCase() : key;
    onChange(value + char);

    // Auto-unshift after one character (unless caps lock)
    if (shift && !capsLock) setShift(false);
  }, [value, onChange, onDone, mode, shift, capsLock]);

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
                  onPointerDown={(e) => { e.preventDefault(); press(key); }}
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
            onPointerDown={e => { e.preventDefault(); setMode(m => m === "alpha" ? "num" : "alpha"); }}>
            {mode === "alpha" ? "123" : "ABC"}
          </button>
          <button className="kb__key kb__key--space"
            onPointerDown={e => { e.preventDefault(); press(" "); }}>
            space
          </button>
          <button className="kb__key kb__key--done"
            onPointerDown={e => { e.preventDefault(); onDone(); }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
