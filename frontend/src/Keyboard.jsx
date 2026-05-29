import { useState, useEffect, useCallback, useRef } from "react";
import "./Keyboard.css";
import { useFeedback } from "./useFeedback.js";

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

const DEFAULT_W = 875;
const DEFAULT_H = 400;

export default function TouchKeyboard({ value, onChange, onDone, visible }) {
  const [mode, setMode]         = useState("alpha");
  const [shift, setShift]       = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const { tap, back }           = useFeedback();
  const lastPress               = useRef(0);

  const [pos,  setPos]  = useState(() => ({
    x: Math.max(0, (window.innerWidth  - DEFAULT_W) / 2),
    y: Math.max(40, window.innerHeight - DEFAULT_H - 48),
  }));
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });

  // Reset mode/shift on each open
  useEffect(() => {
    if (visible) {
      setMode("alpha");
      setShift(false);
    }
  }, [visible]);

  // ── Drag ──────────────────────────────────────────────────────────────────────
  const dragOrigin = useRef(null);

  function onDragPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    dragOrigin.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };

    function onMove(ev) {
      setPos({
        x: Math.max(0, dragOrigin.current.px + ev.clientX - dragOrigin.current.mx),
        y: Math.max(0, dragOrigin.current.py + ev.clientY - dragOrigin.current.my),
      });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
      dragOrigin.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
  }

  // ── Resize ────────────────────────────────────────────────────────────────────
  const resizeOrigin = useRef(null);

  function onResizePointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    resizeOrigin.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h };

    function onMove(ev) {
      setSize({
        w: Math.max(320, resizeOrigin.current.w + ev.clientX - resizeOrigin.current.mx),
        h: Math.max(220, resizeOrigin.current.h + ev.clientY - resizeOrigin.current.my),
      });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
      resizeOrigin.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
  }

  // ── Key press ─────────────────────────────────────────────────────────────────
  const press = useCallback((key) => {
    const now = Date.now();
    if (now - lastPress.current < 80) return;
    lastPress.current = now;

    if (key === "SHIFT") {
      tap();
      if (shift) {
        if (capsLock) { setCapsLock(false); setShift(false); }
        else { setCapsLock(true); }
      } else { setShift(true); }
      return;
    }
    if (key === "ABC")  { tap(); setMode("alpha"); return; }
    if (key === "123")  { tap(); setMode("num");   return; }
    if (key === "⌫")   { back(); onChange(value.slice(0, -1)); return; }
    if (key === "DONE") { tap(); onDone(); return; }

    tap();
    const char = (mode === "alpha" && (shift || capsLock)) ? key.toUpperCase() : key;
    onChange(value + char);
    if (shift && !capsLock) setShift(false);
  }, [value, onChange, onDone, mode, shift, capsLock, tap, back]);

  if (!visible) return null;

  const rows = mode === "num" ? ROWS_NUM : (shift || capsLock) ? ROWS_ALPHA_SHIFT : ROWS_ALPHA;

  return (
    <div
      className="kb"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      onMouseDown={e => e.preventDefault()}
    >
      {/* ── Drag handle ── */}
      <div className="kb__handle" onPointerDown={onDragPointerDown}>
        <span className="kb__handle-grip">⠿⠿⠿</span>
        <span className="kb__handle-label">Keyboard</span>
        <button
          className="kb__close"
          onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }}
          onTouchStart={e => { e.preventDefault(); onDone(); }}
          onClick={onDone}
        >✕</button>
      </div>

      {/* ── Keys ── */}
      <div className="kb__body">
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
                      isShift  ? "kb__key--shift"  : "",
                      isBack   ? "kb__key--back"   : "",
                      isSpace  ? "kb__key--space"  : "",
                      isMode   ? "kb__key--mode"   : "",
                      isActive ? "kb__key--active" : "",
                      isCaps   ? "kb__key--caps"   : "",
                    ].filter(Boolean).join(" ")}
                    onTouchStart={e => { e.preventDefault(); press(key); }}
                    onPointerDown={e => e.preventDefault()}
                  >
                    {isShift ? (capsLock ? "⇪" : "⇧") : key === " " ? "" : key}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Bottom row */}
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

      {/* ── Resize handle ── */}
      <div className="kb__resize" onPointerDown={onResizePointerDown} />
    </div>
  );
}
