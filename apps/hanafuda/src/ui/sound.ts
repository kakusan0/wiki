// 効果音（Web Audio で作る短い音）
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem('hanafuda/mute') === '1'; } catch { return false; } })();
export const isMuted = () => muted;
export function setMuted(m: boolean) { muted = m; try { localStorage.setItem('hanafuda/mute', m ? '1' : '0'); } catch { /* 保存できない */ } }

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function noise(c: AudioContext, dur: number, freq: number, gain: number, when = 0) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + when);
}
function tone(c: AudioContext, freq: number, dur: number, gain: number, when = 0, type: OscillatorType = 'sine', slide = 0) {
  const o = c.createOscillator(); o.type = type;
  const g = c.createGain();
  const t = c.currentTime + when;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

// 高さが変わる風の音
function sweep(c: AudioContext, dur: number, f0: number, f1: number, gain: number) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
  f.frequency.setValueAtTime(f0, c.currentTime); f.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}

export type Sound = 'slap' | 'flip' | 'yaku' | 'koikoi' | 'win' | 'lose' | 'select' | 'final' | 'whoosh' | 'impactBig' | 'rise' | 'boom' | 'beat' | 'count';
export function play(s: Sound) {
  const c = ac();
  if (!c) return;
  switch (s) {
    case 'slap': noise(c, 0.12, 1800, 0.9); tone(c, 140, 0.1, 0.4, 0, 'sine', 0.5); break;
    case 'flip': noise(c, 0.06, 5000, 0.35); break;
    case 'select': tone(c, 880, 0.08, 0.08, 0, 'triangle'); break;
    case 'yaku': [523, 659, 784, 1047].forEach((f, i) => tone(c, f, 0.5, 0.18, i * 0.09, 'triangle')); noise(c, 0.6, 9000, 0.12, 0.3); break;
    case 'koikoi': tone(c, 90, 0.5, 0.9, 0, 'sine', 0.4); noise(c, 0.3, 600, 0.8); tone(c, 90, 0.4, 0.7, 0.22, 'sine', 0.4); break;
    case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, f, 0.7, 0.16, i * 0.12, 'triangle')); break;
    case 'lose': [392, 330, 262].forEach((f, i) => tone(c, f, 0.6, 0.14, i * 0.18, 'sine')); break;
    case 'final': tone(c, 55, 1.6, 0.6, 0, 'sawtooth', 2); noise(c, 1.2, 300, 0.4); break;
    case 'whoosh': sweep(c, 0.32, 400, 3200, 0.35); break;
    case 'impactBig': noise(c, 0.25, 2600, 1.0); tone(c, 70, 0.45, 0.9, 0, 'sine', 0.45); tone(c, 1600, 0.25, 0.07, 0.01, 'triangle', 0.7); tone(c, 2400, 0.3, 0.05, 0.02, 'sine'); break;
    case 'rise': sweep(c, 1.2, 200, 4000, 0.18); [262, 330, 392, 523].forEach((f, i) => tone(c, f, 0.9 - i * 0.15, 0.06, i * 0.22, 'sawtooth')); break;
    case 'boom': noise(c, 0.9, 900, 1.0); tone(c, 50, 1.0, 1.0, 0, 'sine', 0.35); noise(c, 1.4, 6000, 0.25, 0.05); break;
    case 'beat': tone(c, 60, 0.18, 0.7, 0, 'sine', 0.6); tone(c, 55, 0.16, 0.5, 0.22, 'sine', 0.6); break;
    case 'count': tone(c, 880, 0.12, 0.2, 0, 'square'); tone(c, 440, 0.2, 0.15, 0, 'triangle'); break;
  }
}
