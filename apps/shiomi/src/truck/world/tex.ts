// テクスチャの道具：Poly Haven の写真の素材と、canvas で描く絵（コンテナの文字や汚れ）
import * as THREE from 'three';

export const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
let aniso = 8;
export function setAniso(n: number) { aniso = n; }

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

export function ctex(c: HTMLCanvasElement, srgb: boolean, rx = 1, ry = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = aniso;
  return t;
}

function file(name: string, srgb: boolean, rx: number, ry: number): THREE.Texture {
  const t = loader.load(`tex/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface PbrOpts { color?: THREE.ColorRepresentation; metalness?: number; roughness?: number; normalScale?: number; }
/** tex/<name>_diff|nor|rough.jpg の写実的な材質 */
export function pbr(name: string, rx: number, ry: number, o: PbrOpts = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: file(`${name}_diff`, true, rx, ry),
    normalMap: file(`${name}_nor`, false, rx, ry),
    roughnessMap: file(`${name}_rough`, false, rx, ry),
    color: o.color ?? 0xffffff, metalness: o.metalness ?? 0, roughness: o.roughness ?? 1,
  });
  const ns = o.normalScale ?? 1;
  m.normalScale.set(ns, ns);
  return m;
}

/** 高さ（灰色）の絵から法線マップを作る */
export function normalFromHeight(hc: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const [oc, og] = canvas(w, h);
  const out = og.createImageData(w, h);
  const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = -(H(x + 1, y) - H(x - 1, y)) * strength;
      const ny = -(H(x, y - 1) - H(x, y + 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      out.data[i] = (nx / l * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  og.putImageData(out, 0, 0);
  return ctex(oc, false);
}

/** 細かいざらつき */
export function grain(g: CanvasRenderingContext2D, w: number, h: number, R: () => number, n: number, light: boolean) {
  for (let i = 0; i < n; i++) {
    const a = 0.02 + R() * 0.06;
    g.fillStyle = light && R() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2);
  }
}

/** 空の光：HDR を RGBE のまま PNG にしたもの（上半分が色、下半分が指数）を読み戻す */
export async function loadEnv(renderer: THREE.WebGLRenderer): Promise<THREE.Texture | null> {
  manager.itemStart('env');
  try {
    const blob = await (await fetch('tex/env_rgbe.png')).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const W = bmp.width, H = bmp.height / 2;
    const [, g] = canvas(bmp.width, bmp.height);
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const f = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, e = px[((y + H) * W + x) * 4];
        const k = e ? Math.pow(2, e - 136) : 0;
        f[i] = px[i] * k; f[i + 1] = px[i + 1] * k; f[i + 2] = px[i + 2] * k; f[i + 3] = 1;
      }
    }
    const hdr = new THREE.DataTexture(f, W, H, THREE.RGBAFormat, THREE.FloatType);
    hdr.flipY = true; hdr.magFilter = THREE.LinearFilter; hdr.minFilter = THREE.LinearFilter;
    hdr.colorSpace = THREE.LinearSRGBColorSpace;
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    hdr.needsUpdate = true;
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromEquirectangular(hdr).texture;
    hdr.dispose(); pm.dispose();
    return env;
  } catch {
    return null;
  } finally {
    manager.itemEnd('env');
  }
}

/** 部品を置く小さな道具 */
export function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
