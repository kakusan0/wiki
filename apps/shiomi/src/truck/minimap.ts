// 小さな地図：進む向きが上。道・構内・建物は最初に一度だけ描いておき、毎コマ回して切り出す
import { EDGES, KIND, LOTS, node, PLACES } from './world/roadnet';

const X0 = -80, Z0 = -660, X1 = 1640, Z1 = 1100, K = 0.5; // 1 m = 0.5 px

export class Minimap {
  private base: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private route: { x: number; z: number }[] = [];
  constructor(public el: HTMLCanvasElement) {
    this.g = el.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = (X1 - X0) * K; this.base.height = (Z1 - Z0) * K;
    const b = this.base.getContext('2d')!;
    const px = (x: number) => (x - X0) * K, pz = (z: number) => (z - Z0) * K;
    b.fillStyle = '#2b3036'; b.fillRect(0, 0, this.base.width, this.base.height);
    b.fillStyle = '#163447'; b.fillRect(0, 0, px(-45), this.base.height); // 海
    b.fillStyle = '#3a414a';
    for (const l of LOTS) b.fillRect(px(l.x0), pz(l.z0), (l.x1 - l.x0) * K, (l.z1 - l.z0) * K);
    for (const e of EDGES) {
      const a = node(e.a), c = node(e.b);
      b.strokeStyle = e.kind === 'main' ? '#c9ced6' : '#8f98a5';
      b.lineWidth = Math.max(3, KIND[e.kind].w * K * 1.6);
      b.lineCap = 'square';
      b.beginPath(); b.moveTo(px(a.x), pz(a.z)); b.lineTo(px(c.x), pz(c.z)); b.stroke();
    }
    b.fillStyle = '#3FD08A';
    for (const p of PLACES) { b.beginPath(); b.arc(px(p.dock.x), pz(p.dock.z), 6, 0, Math.PI * 2); b.fill(); }
  }
  setRoute(pts: { x: number; z: number }[]) { this.route = pts; }

  /** 位置 (x, z) と向き h で描く。前が上 */
  draw(x: number, z: number, h: number) {
    const { g, el } = this;
    const W = el.width, H = el.height;
    g.save();
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2b3036'; g.fillRect(0, 0, W, H);
    g.translate(W / 2, H * 0.62);
    // 前 (cos h, -sin h) が画面の上 (0, -1) になるように回す
    g.rotate(h - Math.PI / 2);
    const zoom = W / 260; // 260 m ぶんを見せる
    g.scale(zoom / K, zoom / K);
    g.translate(-(x - X0) * K, -(z - Z0) * K);
    g.drawImage(this.base, 0, 0);
    if (this.route.length > 1) {
      g.strokeStyle = '#3CC8F5'; g.lineWidth = 7 * K / zoom * 2.2; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      this.route.forEach((p, i) => { const qx = (p.x - X0) * K, qz = (p.z - Z0) * K; if (i) g.lineTo(qx, qz); else g.moveTo(qx, qz); });
      g.stroke();
    }
    g.restore();
    // 自分（真ん中より少し下、上向きの三角）
    g.fillStyle = '#FF9A2E'; g.strokeStyle = '#0E1218'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W / 2, H * 0.62 - 9); g.lineTo(W / 2 + 7, H * 0.62 + 7); g.lineTo(W / 2 - 7, H * 0.62 + 7); g.closePath(); g.fill(); g.stroke();
    // 北の印
    g.save(); g.translate(W / 2, H / 2); g.rotate(h - Math.PI / 2);
    g.fillStyle = '#EEF2F7'; g.font = '700 12px "Zen Kaku Gothic New", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('北', 0, -W / 2 + 10);
    g.restore();
  }
}
