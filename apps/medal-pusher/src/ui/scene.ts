// 3D の台（three.js）。メダル・プッシャー・液晶・ルーレット・チャッカー・光の演出
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CHUCKERS, type Game } from '../game/game';
import { BALL_R, HALF_W, LOWER_Y, L_EDGE, R, SIDE_OPEN_Z, UPPER_Y, U_BACK, U_EDGE } from '../game/sim';
import { drawLcd, drawRoulette, type Message } from './screens';
import { floor, medalFace, sky } from './textures';

const MAX_COINS = 700;
const MAX_BALLS = 6;
const ROULETTE_C = new THREE.Vector3(0, 3.35, -4.15);
const ROULETTE_R = 1.05;

export class Scene3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private coins: THREE.InstancedMesh;
  private balls: THREE.Mesh[] = [];
  private upperPusher: THREE.Mesh;
  private lowerPusher: THREE.Mesh;
  private lcdCtx: CanvasRenderingContext2D;
  private lcdTex: THREE.CanvasTexture;
  private disc: THREE.Mesh;
  private rouletteBall: THREE.Mesh;
  private gates: THREE.Mesh[] = [];
  private chuckerRings: THREE.Mesh[] = [];
  private aimBeam: THREE.Mesh;
  private launcher: THREE.Mesh;
  private sideLights: THREE.PointLight[] = [];
  private dummy = new THREE.Object3D();
  private camPos = new THREE.Vector3(0, 8, 10);
  private camAt = new THREE.Vector3(0, 1.5, -1.4);
  private shake = 0;
  private flash = 0;
  private flashColor = new THREE.Color('#FFE38A');
  private time = 0;
  private lastLcd = -1;
  aim = 0;
  message: Message | null = null;
  jpShown = 0;
  lite = false;
  private ballAngle = 0;
  private discAngle = 0;

  constructor(private game: Game, mobile: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'stage';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.75 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !mobile;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const skyTex = new THREE.CanvasTexture(sky()); skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;

    // 光
    this.scene.add(new THREE.HemisphereLight('#8FA8FF', '#120A30', 0.55));
    const key = new THREE.DirectionalLight('#FFF2DD', 1.6);
    key.position.set(3, 9, 6); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -6, near: 1, far: 30 });
    this.scene.add(key);
    for (const x of [-3.2, 3.2]) { const p = new THREE.PointLight('#5CE1E6', 6, 9, 1.6); p.position.set(x, 2.2, -0.5); this.scene.add(p); this.sideLights.push(p); }

    const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, ...o });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z); mesh.receiveShadow = shadow; mesh.castShadow = shadow; this.scene.add(mesh); return mesh;
    };
    const floorTex = new THREE.CanvasTexture(floor()); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(3, 3);
    const floorMat = std('#FFFFFF', { map: floorTex, roughness: 0.35, metalness: 0.3 });
    const W = HALF_W * 2;
    // 下段の床・上段の床
    box(W, 0.3, L_EDGE + 2.4, floorMat, 0, LOWER_Y - 0.15, (L_EDGE - 2.4) / 2);
    box(W, 0.3, U_EDGE - U_BACK, floorMat, 0, UPPER_Y - 0.15, (U_BACK + U_EDGE) / 2);
    // 上段の前の面（金の縁）
    box(W, 0.08, 0.08, std('#F5C542', { metalness: 0.9, roughness: 0.25, emissive: '#5A3A00' }), 0, UPPER_Y, U_EDGE);
    // 下段の手前（払い出し口）
    box(W + 0.6, 0.12, 0.12, std('#F5C542', { metalness: 0.9, roughness: 0.25, emissive: '#5A3A00' }), 0, LOWER_Y, L_EDGE + 0.06);
    box(W + 0.6, 1.4, 0.8, std('#05081A'), 0, -0.85, L_EDGE + 0.55);
    // プッシャー
    const pusherMat = std('#2B356F', { metalness: 0.6, roughness: 0.3 });
    this.upperPusher = box(W - 0.02, 0.5, 1.6, pusherMat, 0, UPPER_Y + 0.25, 0);
    this.lowerPusher = box(W - 0.02, 0.9, 2.2, pusherMat, 0, LOWER_Y + 0.45, 0);
    const strip = std('#5CE1E6', { emissive: '#5CE1E6', emissiveIntensity: 1.5 });
    const us = box(W - 0.02, 0.06, 0.02, strip, 0, 0.2, 0.81, false); this.upperPusher.add(us); us.position.set(0, 0.2, 0.81);
    const ls = box(W - 0.02, 0.06, 0.02, strip, 0, 0.35, 1.11, false); this.lowerPusher.add(ls); ls.position.set(0, 0.35, 1.11);
    // 横のガラスと枠
    const glass = new THREE.MeshPhysicalMaterial({ color: '#9FD8FF', transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, transmission: 0 });
    for (const sx of [-1, 1]) {
      box(0.06, 1.0, U_EDGE - U_BACK, glass, sx * (HALF_W + 0.03), UPPER_Y + 0.5, (U_BACK + U_EDGE) / 2, false);
      box(0.06, 1.0, SIDE_OPEN_Z + 1.9, glass, sx * (HALF_W + 0.03), LOWER_Y + 0.5, (SIDE_OPEN_Z - 1.9) / 2, false);
      box(0.25, 4.5, 8.2, std('#0B1030', { metalness: 0.5, roughness: 0.4 }), sx * (HALF_W + 0.9), 0.9, -0.9);
      box(0.08, 0.08, 7, std('#5CE1E6', { emissive: '#5CE1E6', emissiveIntensity: 2 }), sx * (HALF_W + 0.76), 3.1, -0.9, false);
    }
    // 横に落ちる溝（暗い）
    for (const sx of [-1, 1]) box(0.5, 0.1, L_EDGE - SIDE_OPEN_Z + 0.4, std('#020308'), sx * (HALF_W + 0.3), -0.6, (L_EDGE + SIDE_OPEN_Z) / 2, false);

    // 奥の板
    box(W + 2, 6, 0.3, std('#0B1030', { metalness: 0.4, roughness: 0.5 }), 0, 3.5, U_BACK - 0.35);
    // 液晶
    const lcd = document.createElement('canvas'); lcd.width = 1024; lcd.height = 512;
    this.lcdCtx = lcd.getContext('2d')!;
    this.lcdTex = new THREE.CanvasTexture(lcd); this.lcdTex.colorSpace = THREE.SRGBColorSpace;
    const lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshBasicMaterial({ map: this.lcdTex, toneMapped: false }));
    lcdMesh.position.set(0, 5.4, U_BACK - 0.18); this.scene.add(lcdMesh);
    box(4.6, 2.4, 0.1, std('#F5C542', { metalness: 0.9, roughness: 0.3 }), 0, 5.4, U_BACK - 0.26, false);
    // 星図ルーレット
    const rc = document.createElement('canvas'); rc.width = rc.height = 512; drawRoulette(rc.getContext('2d')!);
    const rTex = new THREE.CanvasTexture(rc); rTex.colorSpace = THREE.SRGBColorSpace;
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(ROULETTE_R, 64), new THREE.MeshStandardMaterial({ map: rTex, roughness: 0.35, metalness: 0.3, emissive: '#FFFFFF', emissiveMap: rTex, emissiveIntensity: 0.25 }));
    this.disc.position.copy(ROULETTE_C); this.scene.add(this.disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(ROULETTE_R + 0.05, 0.06, 12, 64), std('#F5C542', { metalness: 0.95, roughness: 0.2 }));
    rim.position.copy(ROULETTE_C); this.scene.add(rim);
    this.rouletteBall = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 16), std('#F4F1FF', { metalness: 0.3, roughness: 0.1, emissive: '#5CE1E6', emissiveIntensity: 0.5 }));
    this.scene.add(this.rouletteBall);
    // チャッカー（入口の輪と扉）
    CHUCKERS.forEach((cx, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 12, 32, Math.PI), std(i === 1 ? '#F5C542' : '#5CE1E6', { emissive: i === 1 ? '#F5C542' : '#5CE1E6', emissiveIntensity: 0.8 }));
      ring.position.set(cx, 2.35, U_BACK + 0.05); this.scene.add(ring); this.chuckerRings.push(ring);
      box(0.68, 0.34, 0.1, std('#000000'), cx, 2.18, U_BACK - 0.02, false);
      const gate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.3), std('#E8513A', { emissive: '#E8513A', emissiveIntensity: 0.6 }));
      gate.position.set(cx, 2.05, U_BACK + 0.2); this.scene.add(gate); this.gates.push(gate);
    });
    // 狙いの光と発射口
    this.aimBeam = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 2.0), new THREE.MeshBasicMaterial({ color: '#5CE1E6', transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false }));
    this.aimBeam.position.set(0, UPPER_Y + 1.0, -2.75); this.scene.add(this.aimBeam);
    this.launcher = box(0.42, 0.2, 0.42, std('#F5C542', { metalness: 0.9, roughness: 0.25, emissive: '#5A3A00' }), 0, 3.3, -2.75, false);
    box(W, 0.06, 0.08, std('#2B356F', { metalness: 0.7 }), 0, 3.42, -2.75, false);

    // メダル（まとめて描く）
    const face = new THREE.CanvasTexture(medalFace()); face.colorSpace = THREE.SRGBColorSpace; face.anisotropy = 4;
    const side = std('#D9A62E', { metalness: 0.95, roughness: 0.28 });
    const top = new THREE.MeshStandardMaterial({ map: face, metalness: 0.85, roughness: 0.3 });
    this.coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(R, R, 0.07, 28), [side, top, top], MAX_COINS);
    this.coins.castShadow = true; this.coins.receiveShadow = true;
    this.coins.frustumCulled = false;
    this.scene.add(this.coins);
    for (let i = 0; i < MAX_BALLS; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 24), new THREE.MeshPhysicalMaterial({ color: '#A8F3F5', metalness: 0.1, roughness: 0.05, clearcoat: 1, emissive: '#2E9AA0', emissiveIntensity: 0.4 }));
      b.castShadow = true; b.visible = false; this.scene.add(b); this.balls.push(b);
    }
  }

  // 演出
  doShake(a: number) { this.shake = Math.max(this.shake, this.lite ? a * 0.3 : a); }
  doFlash(a: number, color = '#FFE38A') { this.flash = Math.max(this.flash, this.lite ? a * 0.4 : a); this.flashColor.set(color); }
  say(text: string, sub = '', color = '#FFE38A', sec = 2.2, big = false) { this.message = { text, sub, color, until: this.time + sec, big }; this.lastLcd = -1; }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    if (aspect >= 1) { this.camera.fov = 40; this.camPos.set(1.9, 9.4, 12.2); this.camAt.set(1.9, 2.6, -1.6); }
    else { this.camera.fov = 50; this.camPos.set(0, 12.4, 11.6 + (1 / aspect - 1.6) * 2); this.camAt.set(0, 2.3, -1.3); }
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    this.time += dt;
    const g = this.game, sim = g.sim;
    // プッシャー
    const uf = sim.upperFace(), lf = sim.lowerFace();
    this.upperPusher.position.z = uf - 0.8;
    this.lowerPusher.position.z = lf - 1.1;
    // メダル
    let n = 0, b = 0;
    for (const c of sim.coins) {
      if (c.ball) {
        if (b < MAX_BALLS) { const m = this.balls[b++]; m.visible = true; m.position.set(c.x, c.y + BALL_R, c.z); m.rotation.x += c.vz * dt * 3; }
        continue;
      }
      if (n >= MAX_COINS) break;
      const d = this.dummy;
      d.position.set(c.x, c.y + 0.035 + c.h * 0.07, c.z);
      if (c.falling) d.rotation.set(c.spin, 0, c.spin * 0.6);
      else d.rotation.set(((c.id * 37) % 7 - 3) * 0.01 + c.h * 0.08, 0, ((c.id * 53) % 7 - 3) * 0.01);
      d.updateMatrix();
      this.coins.setMatrixAt(n++, d.matrix);
    }
    this.coins.count = n;
    this.coins.instanceMatrix.needsUpdate = true;
    for (let i = b; i < MAX_BALLS; i++) this.balls[i].visible = false;
    // 狙い
    const ax = this.aim * (HALF_W - R - 0.05);
    this.aimBeam.position.x = ax; this.launcher.position.x = ax;
    (this.aimBeam.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.2 * Math.sin(this.time * 6);
    // チャッカーの扉
    CHUCKERS.forEach((cx, i) => {
      const open = g.gateOpen(i);
      this.gates[i].position.z = U_BACK + (open ? -0.1 : 0.2);
      this.gates[i].position.y = 2.05 + (open ? -0.15 : 0);
      const near = Math.abs(cx - ax) < 0.3;
      (this.chuckerRings[i].material as THREE.MeshStandardMaterial).emissiveIntensity = (open ? 1.2 : 0.3) + (near ? 0.8 : 0);
    });
    // ルーレット
    this.discAngle -= dt * 0.5;
    this.disc.rotation.z = this.discAngle;
    const ro = g.roulette;
    const pocketAngle = (i: number) => -((i + 0.5) * Math.PI) / 6; // 盤の上の角度（上から時計回り）
    if (ro) {
      const k = ro.t / ro.dur;
      const endDisc = this.discAngle - (ro.dur - ro.t) * 0.5;
      const target = endDisc + pocketAngle(ro.index);
      this.ballAngle = target + 26 * (1 - k) ** 2.4;
    } else this.ballAngle -= dt * 0.5;
    const br = ro ? ROULETTE_R * (0.95 - 0.2 * Math.min(1, (ro.t / ro.dur) ** 3)) : ROULETTE_R * 0.75;
    // 玉の角度：上から時計回りに -ballAngle
    this.rouletteBall.position.set(ROULETTE_C.x - Math.sin(this.ballAngle) * br, ROULETTE_C.y + Math.cos(this.ballAngle) * br, ROULETTE_C.z + 0.1);
    // 液晶（30 コマ／秒）
    if (this.time - this.lastLcd > 1 / 30) {
      this.jpShown += (g.pool - this.jpShown) * 0.2;
      drawLcd(this.lcdCtx, g, this.time, this.message, this.jpShown);
      this.lcdTex.needsUpdate = true;
      this.lastLcd = this.time;
    }
    // 光と揺れ
    this.flash *= Math.exp(-dt * 3);
    this.shake *= Math.exp(-dt * 6);
    for (const p of this.sideLights) { p.color.lerpColors(new THREE.Color('#5CE1E6'), this.flashColor, Math.min(1, this.flash)); p.intensity = 6 + this.flash * 30; }
    this.renderer.toneMappingExposure = 1.05 + this.flash * 0.35;
    this.camera.position.copy(this.camPos);
    this.camera.position.x += (Math.random() - 0.5) * this.shake;
    this.camera.position.y += (Math.random() - 0.5) * this.shake;
    this.camera.lookAt(this.camAt);
    this.renderer.render(this.scene, this.camera);
    if (this.sampler) { const f = this.sampler; this.sampler = null; f(this.bright()); }
  }

  // 描けているか（画面テスト用）
  private sampler: ((n: number) => void) | null = null;
  sample(): Promise<number> { return new Promise((r) => { this.sampler = r; }); }
  private bright(): number {
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const d = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, d);
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 300) n++;
    return n;
  }

  // 画面上の位置（0〜1）から、狙う位置（-1〜1）
  aimFromScreen(sx: number, sy: number): number {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(sx * 2 - 1, -(sy * 2 - 1)), this.camera);
    const p = new THREE.Vector3();
    ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -UPPER_Y), p);
    return Math.max(-1, Math.min(1, p.x / (HALF_W - R - 0.05)));
  }

  dispose() { this.renderer.dispose(); this.canvas.remove(); }
}
