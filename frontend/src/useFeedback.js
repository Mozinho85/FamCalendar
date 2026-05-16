// useFeedback — click sound + haptic vibration for touch interactions

// Shared AudioContext (created once on first use)
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browsers suspend until user gesture)
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// A short, satisfying mechanical click:
// Quick high-frequency tap + soft low thump underneath
function playClick(type = 'tap') {
  try {
    const ctx  = getAudioCtx();
    const now  = ctx.currentTime;

    if (type === 'tap') {
      // High click transient
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env);
      env.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.04);
      env.gain.setValueAtTime(0.18, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.06);

      // Soft thump underneath
      const osc2 = ctx.createOscillator();
      const env2 = ctx.createGain();
      osc2.connect(env2);
      env2.connect(ctx.destination);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(180, now);
      osc2.frequency.exponentialRampToValueAtTime(60, now + 0.05);
      env2.gain.setValueAtTime(0.12, now);
      env2.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc2.start(now);
      osc2.stop(now + 0.08);

    } else if (type === 'success') {
      // Two-tone confirmation (save event)
      [0, 0.12].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.connect(env);
        env.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(i === 0 ? 660 : 880, now + delay);
        env.gain.setValueAtTime(0.12, now + delay);
        env.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.1);
        osc.start(now + delay);
        osc.stop(now + delay + 0.1);
      });

    } else if (type === 'back') {
      // Soft low tap (backspace / cancel)
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env);
      env.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.05);
      env.gain.setValueAtTime(0.1, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.start(now);
      osc.stop(now + 0.07);
    }
  } catch {}
}

function vibrate(pattern = [12]) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {}
}

export function useFeedback() {
  function tap()     { playClick('tap');     vibrate([10]); }
  function success() { playClick('success'); vibrate([10, 50, 20]); }
  function back()    { playClick('back');    vibrate([8]); }
  return { tap, success, back };
}
