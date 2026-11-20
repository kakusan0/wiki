// 音：すべてその場で合成（モーター・走行音・継ぎ目・警笛・ATS・ドア・踏切・発車メロディ）
export class Sound {
  ctx: AudioContext | null = null;
  master!: GainNode;
  motorA!: OscillatorNode; motorB!: OscillatorNode; motorG!: GainNode; motorF!: BiquadFilterNode;
  roll!: GainNode; rollF!: BiquadFilterNode;
  brakeG!: GainNode;
  bellOn = false; bellT = 0;
  atsT = 0; atsOn = false;
  muted = false;
  jointBuf: AudioBuffer | null = null;

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    // モーター（インバーターのうなり）
    this.motorF = ctx.createBiquadFilter(); this.motorF.type = 'bandpass'; this.motorF.Q.value = 3;
    this.motorG = ctx.createGain(); this.motorG.gain.value = 0;
    this.motorA = ctx.createOscillator(); this.motorA.type = 'sawtooth';
    this.motorB = ctx.createOscillator(); this.motorB.type = 'square';
    this.motorA.connect(this.motorF); this.motorB.connect(this.motorF); this.motorF.connect(this.motorG); this.motorG.connect(this.master);
    this.motorA.start(); this.motorB.start();
    // 走行音（ノイズ）
    const noise = this.noise(2);
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    this.rollF = ctx.createBiquadFilter(); this.rollF.type = 'lowpass'; this.rollF.frequency.value = 400;
    this.roll = ctx.createGain(); this.roll.gain.value = 0;
    src.connect(this.rollF); this.rollF.connect(this.roll); this.roll.connect(this.master); src.start();
    // ブレーキのきしみ
    const src2 = ctx.createBufferSource(); src2.buffer = noise; src2.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 2400; bf.Q.value = 8;
    this.brakeG = ctx.createGain(); this.brakeG.gain.value = 0;
    src2.connect(bf); bf.connect(this.brakeG); this.brakeG.connect(this.master); src2.start();
  }
  noise(sec: number) {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  setMute(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.7; }

  /** 毎フレーム：速度 m/s、力行の強さ 0..1、ブレーキの効き */
  update(v: number, power: number, brake: number, inTunnel: boolean) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const f = 40 + v * 38;
    this.motorA.frequency.setTargetAtTime(f, t, 0.05);
    this.motorB.frequency.setTargetAtTime(f * 1.5, t, 0.05);
    this.motorF.frequency.setTargetAtTime(300 + v * 60, t, 0.1);
    const load = Math.min(1, power * 1.6 + (brake > 0.1 && v > 1 ? brake * 0.6 : 0));
    this.motorG.gain.setTargetAtTime(v > 0.2 ? 0.05 * load + 0.008 : 0, t, 0.12);
    this.roll.gain.setTargetAtTime(Math.min(0.32, v * 0.014) * (inTunnel ? 2.0 : 1), t, 0.2);
    this.rollF.frequency.setTargetAtTime(250 + v * 25 + (inTunnel ? 400 : 0), t, 0.2);
    this.brakeG.gain.setTargetAtTime(brake > 0.3 && v > 0.3 && v < 4 ? 0.06 * (1 - v / 4) : 0, t, 0.1);
  }

  tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, when = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  /** レールの継ぎ目（台車 2 つ分の「タタン」） */
  joint(v: number) {
    const ctx = this.ctx; if (!ctx || v < 0.5) return;
    const gap = 2.1 / v;
    for (const w of [0, gap]) {
      const t = ctx.currentTime + w;
      const src = ctx.createBufferSource(); src.buffer = this.jointBuf ??= this.noise(0.08);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(0.5, 0.08 + v * 0.012), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
    }
  }
  horn() { this.tone(370, 0.9, 'sawtooth', 0.09); this.tone(466, 0.9, 'sawtooth', 0.07); }
  atsBell(on: boolean) { this.atsOn = on; }
  chime() { [880, 1175, 1480].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.12, i * 0.18)); }
  doorChime() { [988, 784].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.12, i * 0.35)); }
  hiss() {
    const ctx = this.ctx; if (!ctx) return;
    const src = ctx.createBufferSource(); src.buffer = this.noise(1.2);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }
  /** 発車メロディ（このゲームのための短い旋律） */
  melody() {
    const notes = [659, 784, 988, 880, 784, 659, 740, 784, 988, 1175, 988, 784];
    notes.forEach((f, i) => { this.tone(f, 0.32, 'triangle', 0.1, i * 0.24); this.tone(f / 2, 0.32, 'sine', 0.05, i * 0.24); });
  }
  whoosh() {
    const ctx = this.ctx; if (!ctx) return;
    const src = ctx.createBufferSource(); src.buffer = this.noise(3);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 0.7;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }
  /** 鳴りつづける音（ATS のベル、踏切）を時間で進める */
  tick(dt: number, crossingVol: number) {
    if (!this.ctx) return;
    this.atsT += dt;
    if (this.atsOn && this.atsT > 0.28) { this.atsT = 0; this.tone(1320, 0.22, 'square', 0.06); }
    this.bellT += dt;
    if (crossingVol > 0.01 && this.bellT > 0.45) { this.bellT = 0; this.tone(1046, 0.4, 'triangle', 0.14 * crossingVol); this.tone(1318, 0.3, 'sine', 0.06 * crossingVol); }
  }
}
