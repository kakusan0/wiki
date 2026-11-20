// 絵（Canvas で描く独自の図案）：メダルの面、床、星空
export function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  return cv;
}

// メダルの面：星と波の紋
export function medalFace(): HTMLCanvasElement {
  return canvas(256, 256, (c) => {
    const g = c.createRadialGradient(100, 90, 10, 128, 128, 128);
    g.addColorStop(0, '#FFF4C2'); g.addColorStop(0.55, '#F5C542'); g.addColorStop(1, '#B9831A');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    c.strokeStyle = '#8E6312'; c.lineWidth = 10; c.beginPath(); c.arc(128, 128, 112, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#FFF0B0'; c.lineWidth = 4; c.beginPath(); c.arc(128, 128, 96, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#FFF0B0';
    c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 26 : 60; c.lineTo(128 + Math.cos(a) * r, 120 + Math.sin(a) * r); }
    c.closePath(); c.fill();
    c.strokeStyle = '#FFF0B0'; c.lineWidth = 6; c.beginPath();
    for (let x = 70; x <= 186; x += 2) c.lineTo(x, 190 + Math.sin((x - 70) / 9) * 6);
    c.stroke();
  });
}

// 床：濃い藍に細い光の格子
export function floor(): HTMLCanvasElement {
  return canvas(512, 512, (c) => {
    c.fillStyle = '#16205A'; c.fillRect(0, 0, 512, 512);
    c.strokeStyle = 'rgba(92,225,230,0.18)'; c.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 512); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(512, i); c.stroke(); }
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; c.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  });
}

// 背景：夜空と星
export function sky(): HTMLCanvasElement {
  return canvas(1024, 512, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#02030C'); g.addColorStop(0.55, '#0B1340'); g.addColorStop(1, '#1A1050');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 500; i++) { const s = Math.random() * 1.8; c.fillStyle = Math.random() < 0.2 ? '#FFE38A' : '#FFFFFF'; c.globalAlpha = 0.3 + Math.random() * 0.7; c.fillRect(Math.random() * 1024, Math.random() * 380, s, s); }
    c.globalAlpha = 1;
  });
}
