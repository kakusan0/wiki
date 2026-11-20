import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new THREE.TextureLoader();
let maxAniso = 8;
export function setAniso(n: number) { maxAniso = n; }
const cache = new Map<string, THREE.Texture>();
const pending: Promise<unknown>[] = [];

export function tex(path: string, srgb = false, repeat = 1): THREE.Texture {
  const key = `${path}|${srgb}|${repeat}`;
  const c = cache.get(key);
  if (c) return c;
  const t = loader.load(path);
  pending.push(new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = path; }));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export interface PbrOpts { repeat?: number; color?: THREE.ColorRepresentation; metalness?: number; roughness?: number; normalScale?: number; side?: THREE.Side; }

/** tex/<name>_diff|nor|rough.jpg の PBR 材質 */
export function pbr(name: string, o: PbrOpts = {}): THREE.MeshStandardMaterial {
  const r = o.repeat ?? 1;
  const m = new THREE.MeshStandardMaterial({
    map: tex(`tex/${name}_diff.jpg`, true, r),
    normalMap: tex(`tex/${name}_nor.jpg`, false, r),
    roughnessMap: tex(`tex/${name}_rough.jpg`, false, r),
    color: o.color ?? 0xffffff,
    metalness: o.metalness ?? 0,
    roughness: o.roughness ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  const ns = o.normalScale ?? 1;
  m.normalScale.set(ns, ns);
  return m;
}

export function texturesReady(): Promise<unknown> { return Promise.all(pending); }

export interface Prop { geos: THREE.BufferGeometry[]; mats: THREE.Material[]; size: THREE.Vector3; }

/** Poly Haven の glTF：中のメッシュをそれぞれ「変化形」として取り出す（原点に置き直す） */
export async function loadProp(id: string): Promise<Prop[]> {
  const gltf = await new GLTFLoader().loadAsync(`models/${id}/${id}.json`);
  gltf.scene.updateMatrixWorld(true);
  const out: Prop[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const c = new THREE.Vector3(); b.getCenter(c);
    g.translate(-c.x, -b.min.y, -c.z);
    const size = new THREE.Vector3(); b.getSize(size);
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mm) => {
      const sm = mm as THREE.MeshStandardMaterial;
      if (sm.transparent || sm.alphaTest > 0) { sm.transparent = false; sm.alphaTest = 0.45; sm.alphaToCoverage = true; }
      sm.side = THREE.DoubleSide;
      return sm;
    });
    out.push({ geos: [g], mats, size });
  });
  return out;
}
