// 画面のペダル：押した指の高さで強さが変わる（下の方 = 弱く、上の方 = 強く）
export function pedalValue(y: number, top: number, height: number): number {
  const t = 1 - (y - top) / height; // 0 = 下の端、1 = 上の端
  return Math.max(0.2, Math.min(1, 0.2 + t * 0.9));
}

export class Pedal {
  value = 0;
  private pid: number | null = null;
  constructor(private el: HTMLElement, private fill: HTMLElement) {
    el.addEventListener('pointerdown', (e) => { this.pid = e.pointerId; el.setPointerCapture(e.pointerId); this.read(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.pid) this.read(e); });
    const up = (e: PointerEvent) => { if (e.pointerId === this.pid) { this.pid = null; this.set(0); } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  private read(e: PointerEvent) { const r = this.el.getBoundingClientRect(); this.set(pedalValue(e.clientY, r.top, r.height)); }
  set(v: number) {
    this.value = v;
    this.fill.style.height = `${Math.round(v * 100)}%`;
    this.el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }
}
