// Sound, synthesised with WebAudio (no asset files): ambient wind and birdsong, crackling fire,
// and one-shot sounds for explosions, lightning, battle, disasters and the great events of history.
let ctx = null, master = null, noiseBuf = null, muted = false, listener = null;
let fireGain = null, windGain = null;
const last = {};

try { muted = localStorage.getItem('ws-muted') === '1'; } catch { /* storage unavailable */ }

export const isMuted = () => muted;
export function setListener(fn) { listener = fn; }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  startAmbient();
}

export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('ws-muted', m ? '1' : '0'); } catch { /* storage unavailable */ }
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.05);
}

function noiseSrc(loop = true) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = loop;
  s.loopStart = Math.random(); // offset so layers don't phase together
  return s;
}

function startAmbient() {
  // wind: band-limited noise with a slow swell
  const w = noiseSrc(), wf = ctx.createBiquadFilter();
  wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 0.6;
  windGain = ctx.createGain(); windGain.gain.value = 0.06;
  w.connect(wf); wf.connect(windGain); windGain.connect(master); w.start();
  const lfo = ctx.createOscillator(), lg = ctx.createGain();
  lfo.frequency.value = 0.11; lg.gain.value = 0.03;
  lfo.connect(lg); lg.connect(windGain.gain); lfo.start();
  // fire: crackling noise whose level follows the number of burning blocks
  const f = noiseSrc(), ff = ctx.createBiquadFilter();
  ff.type = 'bandpass'; ff.frequency.value = 2600; ff.Q.value = 1.2;
  fireGain = ctx.createGain(); fireGain.gain.value = 0;
  f.connect(ff); ff.connect(fireGain); fireGain.connect(master); f.start();
  // birds
  const chirp = () => {
    if (ctx && !muted && ctx.state === 'running') {
      const n = 2 + Math.floor(Math.random() * 3), base = 2200 + Math.random() * 1600;
      for (let i = 0; i < n; i++) tone(base * (1 + i * 0.06), base * 1.35, 0.1, 0.028, 'sine', ctx.currentTime + i * 0.13);
    }
    setTimeout(chirp, 2500 + Math.random() * 6000);
  };
  chirp();
}

// call each frame: fire level, wind with zoom
export function updateAudio(fires, zoom) {
  if (!ctx) return;
  fireGain.gain.setTargetAtTime(Math.min(0.2, Math.sqrt(fires) * 0.012), ctx.currentTime, 0.4);
  windGain.gain.setTargetAtTime(0.04 + Math.min(1, zoom / 160) * 0.05, ctx.currentTime, 0.8);
}

function tone(f0, f1, dur, vol, type = 'sine', t0 = ctx.currentTime) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function burst(type, f0, f1, dur, vol, q = 0.7) {
  const t0 = ctx.currentTime;
  const s = noiseSrc(false), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
}

const GAP = { clash: 0.09, death: 0.15, boom: 0.12, splash: 0.12, thunder: 0.3, whoosh: 0.3, rumble: 0.6, bell: 0.4, build: 0.5, horn: 1, chime: 1, toll: 1, roar: 1 };

// Positional one-shot: quieter with distance from the listener, skipped when inaudible.
export function sfx(name, x, z, size = 1) {
  if (!ctx || muted || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now - (last[name] || -9) < (GAP[name] ?? 0.1)) return;
  let att = 1;
  if (x !== undefined && listener) {
    const p = listener();
    att = 1 / (1 + Math.hypot(p.x - x, p.z - z) / 45);
    if (att < 0.12) return;
  }
  last[name] = now;
  const v = att * Math.min(1.5, size);
  switch (name) {
    case 'boom':
      burst('lowpass', 900, 60, 0.9 + size * 0.25, 0.9 * v, 0.5);
      tone(80, 30, 0.7 + size * 0.1, 0.9 * v);
      break;
    case 'thunder':
      burst('highpass', 3500, 1500, 0.12, 0.7 * v);
      burst('lowpass', 1400, 120, 2.2, 0.8 * v, 0.4);
      break;
    case 'whoosh': burst('bandpass', 250, 1800, 1.5, 0.35 * v, 1.2); break;
    case 'splash': burst('highpass', 900, 3000, 0.35, 0.3 * v); break;
    case 'clash':
      burst('bandpass', 3200, 2400, 0.06, 0.28 * v, 6);
      tone(1300, 800, 0.08, 0.06 * v, 'triangle');
      break;
    case 'death': burst('lowpass', 500, 120, 0.2, 0.35 * v); break;
    case 'rumble': burst('lowpass', 140, 40, 1.4, 0.8 * v, 0.3); break;
    case 'roar': burst('lowpass', 600, 200, 2.5, 0.5 * v, 0.3); break;
    case 'bell': tone(1568, 1500, 0.5, 0.1 * v, 'sine'); tone(2349, 2300, 0.4, 0.05 * v, 'sine', now + 0.02); break;
    case 'horn':
      tone(196, 180, 0.9, 0.18 * v, 'sawtooth');
      tone(294, 270, 0.9, 0.1 * v, 'sawtooth');
      break;
    case 'chime':
      tone(523, 523, 1.2, 0.12 * v, 'sine'); tone(659, 659, 1.2, 0.1 * v, 'sine', now + 0.15); tone(784, 784, 1.4, 0.1 * v, 'sine', now + 0.3);
      break;
    case 'build': tone(220, 200, 0.12, 0.12 * v, 'square'); tone(330, 300, 0.12, 0.1 * v, 'square', now + 0.13); burst('bandpass', 1800, 900, 0.2, 0.2 * v, 3); break;
    case 'toll': tone(147, 140, 1.8, 0.2 * v, 'sine'); tone(294, 280, 1.4, 0.06 * v, 'sine'); break;
  }
}
