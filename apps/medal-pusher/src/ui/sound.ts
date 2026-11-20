// 効果音（Web Audio で作る短い音）
let ctx: AudioContext | null = null;
let muted = false;
let unlocked = false;
// 最初に画面に触れてから音を出す（ブラウザの決まり）
if (typeof window !== 'undefined') window.addEventListener('pointerdown', () => { unlocked = true; }, { once: true, capture: true });
export const setMuted = (m: boolean) => { muted = m; };

function ac(): AudioContext | null {
  if (muted || !unlocked) return null;
  try { ctx ??= new AudioContext(); if (ctx.state === 'suspended') void ctx.resume(); return ctx; } catch { return null; }
}
function tone(c: AudioContext, f: number, dur: number, gain: number, when = 0, type: OscillatorType = 'sine', slide = 0) {
  const o = c.createOscillator(); o.type = type;
  const g = c.createGain(); const t = c.currentTime + when;
  o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
}
function noise(c: AudioContext, dur: number, freq: number, gain: number, when = 0) {
  const len = Math.floor(c.sampleRate * dur); const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const s = c.createBufferSource(); s.buffer = buf; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
  const g = c.createGain(); g.gain.value = gain; s.connect(f).connect(g).connect(c.destination); s.start(c.currentTime + when);
}

let lastClink = 0;
export type Sound = 'insert' | 'clink' | 'payout' | 'chucker' | 'tick' | 'reach' | 'win' | 'miss' | 'roulette' | 'prize' | 'sail' | 'jackpot' | 'claim';
export function play(s: Sound) {
  const c = ac(); if (!c) return;
  switch (s) {
    case 'insert': noise(c, 0.05, 3000, 0.25); break;
    case 'clink': { const now = c.currentTime; if (now - lastClink < 0.04) return; lastClink = now; tone(c, 2600 + Math.random() * 1200, 0.08, 0.05, 0, 'triangle'); break; }
    case 'payout': tone(c, 1568, 0.09, 0.08, 0, 'square'); tone(c, 2093, 0.12, 0.06, 0.05, 'square'); break;
    case 'chucker': [880, 1175, 1568].forEach((f, i) => tone(c, f, 0.15, 0.1, i * 0.05, 'triangle')); break;
    case 'tick': tone(c, 1200, 0.03, 0.04, 0, 'square'); break;
    case 'reach': [523, 659, 784, 659, 523].forEach((f, i) => tone(c, f, 0.18, 0.12, i * 0.12, 'sawtooth')); break;
    case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, f, 0.35, 0.12, i * 0.08, 'triangle')); break;
    case 'miss': tone(c, 330, 0.25, 0.08, 0, 'sine', 0.7); break;
    case 'roulette': tone(c, 800, 0.05, 0.05, 0, 'square'); break;
    case 'prize': [784, 988, 1175, 1568].forEach((f, i) => tone(c, f, 0.3, 0.12, i * 0.07, 'triangle')); break;
    case 'sail': tone(c, 196, 0.5, 0.25, 0, 'sawtooth', 1.5); break;
    case 'jackpot': for (let i = 0; i < 12; i++) tone(c, [523, 659, 784, 1047][i % 4] * (1 + Math.floor(i / 4) * 0.5), 0.4, 0.12, i * 0.09, 'triangle'); noise(c, 1.5, 6000, 0.15, 0.2); break;
    case 'claim': [659, 784, 1047].forEach((f, i) => tone(c, f, 0.25, 0.1, i * 0.08, 'triangle')); break;
  }
}
