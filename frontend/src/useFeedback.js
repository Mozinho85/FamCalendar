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

function getTapSound() {
  try {
    const raw = localStorage.getItem('famcal-display-settings');
    return raw ? (JSON.parse(raw).tapSound || 'mechanical') : 'mechanical';
  } catch { return 'mechanical'; }
}

function playTapMechanical(ctx, now) {
  // Short white-noise burst through bandpass (simulates switch actuation)
  const bufSize = ctx.sampleRate * 0.025;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 1000;
  bpf.Q.value = 1.5;
  const noiseEnv = ctx.createGain();
  noiseEnv.gain.setValueAtTime(0.35, now);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
  noise.connect(bpf);
  bpf.connect(noiseEnv);
  noiseEnv.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.025);

  // Resonant body tone underneath
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.connect(env);
  env.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + 0.02);
  env.gain.setValueAtTime(0.15, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
  osc.start(now);
  osc.stop(now + 0.02);
}

function playTapCrisp(ctx, now) {
  // High sawtooth transient
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.connect(env);
  env.connect(ctx.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(2000, now);
  osc.frequency.exponentialRampToValueAtTime(1000, now + 0.025);
  env.gain.setValueAtTime(0.14, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
  osc.start(now);
  osc.stop(now + 0.025);

  // Punchy mid body
  const osc2 = ctx.createOscillator();
  const env2 = ctx.createGain();
  osc2.connect(env2);
  env2.connect(ctx.destination);
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(500, now);
  osc2.frequency.exponentialRampToValueAtTime(200, now + 0.02);
  env2.gain.setValueAtTime(0.12, now);
  env2.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
  osc2.start(now);
  osc2.stop(now + 0.02);
}

function playTapSoft(ctx, now) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.connect(env);
  env.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(280, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);
  env.gain.setValueAtTime(0.10, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  osc.start(now);
  osc.stop(now + 0.07);
}

function playClick(type = 'tap') {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;

    if (type === 'tap') {
      const profile = getTapSound();
      if (profile === 'off') return;
      if (profile === 'crisp')      playTapCrisp(ctx, now);
      else if (profile === 'soft')  playTapSoft(ctx, now);
      else                          playTapMechanical(ctx, now);

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
