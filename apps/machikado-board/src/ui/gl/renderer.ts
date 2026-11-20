// WebGL の描画（シェーダー・メッシュ・テクスチャ）
import { STRIDE, type Geo } from './geometry';
import type { Mat4, Vec3 } from './math';

export interface Mesh { buf: WebGLBuffer; count: number }
export interface Item {
  mesh: Mesh;
  p: Vec3;
  s: Vec3;
  r: number; // y 軸まわりの回転
  c: Vec3; // 色（テクスチャに掛ける）
  tex: WebGLTexture;
  uvs: [number, number];
  alpha?: number;
  flat?: number; // 1 で光の当たり方を無視（ランプなど）
  shadow?: number; // 影の長さ（0 なら影なし）
  m3?: number[]; // 自由な向きの回転（3×3・列優先）。形の中心のまわりに回す
  onTop?: boolean; // 建物に隠れず、いつも手前に描く（分かれ道の矢印）
}

const VS = `attribute vec3 aPos;attribute vec3 aNor;attribute vec2 aUV;
uniform mat4 uVP;uniform mat4 uModel;uniform vec3 uScl;uniform vec2 uUVS;
varying vec3 vN;varying vec3 vW;varying vec2 vUV;
void main(){vec4 w=uModel*vec4(aPos*uScl,1.0);vW=w.xyz;vN=normalize(mat3(uModel)*(aNor/uScl));vUV=aUV*uUVS;gl_Position=uVP*w;}`;
const FS = `precision mediump float;
uniform sampler2D uTex;uniform vec3 uCol;uniform vec3 uSun;uniform vec3 uEye;uniform float uAlpha;uniform float uFlat;uniform vec2 uFog;uniform vec3 uSky;
varying vec3 vN;varying vec3 vW;varying vec2 vUV;
void main(){vec4 t=texture2D(uTex,vUV);vec3 base=t.rgb*uCol;vec3 n=normalize(vN);
float dif=max(dot(n,uSun),0.0);float hemi=0.5+0.5*n.y;vec3 v=normalize(uEye-vW);vec3 h=normalize(uSun+v);
float spec=pow(max(dot(n,h),0.0),48.0)*0.2;float rim=pow(1.0-max(dot(n,v),0.0),3.0)*0.12;
vec3 lit=base*(vec3(0.32,0.35,0.44)+vec3(0.22,0.22,0.2)*hemi+vec3(0.66,0.6,0.5)*dif)+vec3(spec+rim);
vec3 c=mix(lit,base,uFlat);float d=length(uEye-vW);c=mix(c,uSky,smoothstep(uFog.x,uFog.y,d)*(1.0-uFlat));
gl_FragColor=vec4(c,uAlpha*t.a);}`;

export class Renderer {
  gl: WebGLRenderingContext;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private a: { pos: number; nor: number; uv: number };
  private aniso: EXT_texture_filter_anisotropic | null;
  private bound: Mesh | null = null;
  private texCache = new Map<string, WebGLTexture>();
  white: WebGLTexture;
  meshes: Mesh[] = [];

  static create(canvas: HTMLCanvasElement): Renderer | null {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) return null;
    try { return new Renderer(gl); } catch { return null; }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(prog);
    this.a = { pos: gl.getAttribLocation(prog, 'aPos'), nor: gl.getAttribLocation(prog, 'aNor'), uv: gl.getAttribLocation(prog, 'aUV') };
    for (const k of [this.a.pos, this.a.nor, this.a.uv]) gl.enableVertexAttribArray(k);
    for (const k of ['uVP', 'uModel', 'uScl', 'uUVS', 'uCol', 'uSun', 'uEye', 'uAlpha', 'uFlat', 'uTex', 'uFog', 'uSky']) this.u[k] = gl.getUniformLocation(prog, k);
    gl.uniform1i(this.u.uTex, 0);
    gl.enable(gl.DEPTH_TEST);
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }

  mesh(data: Geo): Mesh {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const m = { buf, count: data.length / STRIDE };
    this.meshes.push(m);
    return m;
  }

  dropMeshes() {
    for (const m of this.meshes) this.gl.deleteBuffer(m.buf);
    this.meshes = [];
    this.bound = null;
  }

  // 同じ key のテクスチャは 1 回だけ作る
  tex(key: string, make: () => HTMLCanvasElement, repeat = true): WebGLTexture {
    const hit = this.texCache.get(key);
    if (hit) return hit;
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, make());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (this.aniso) {
      const max = gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    this.texCache.set(key, t);
    return t;
  }

  // 文字を含むテクスチャ（看板）は、フォントが読み込まれたら作り直す
  dropTextures(prefix: string) {
    for (const [k, t] of this.texCache) if (k.startsWith(prefix)) { this.gl.deleteTexture(t); this.texCache.delete(k); }
  }

  get textureCount() { return this.texCache.size; }

  frame(o: { w: number; h: number; vp: Mat4; eye: Vec3; sun: Vec3; sky: Vec3; fog: [number, number]; items: Item[]; blob: WebGLTexture; plane: Mesh; overlay?: Item[] }) {
    const gl = this.gl;
    gl.viewport(0, 0, o.w, o.h);
    gl.clearColor(o.sky[0], o.sky[1], o.sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(this.u.uVP, false, new Float32Array(o.vp));
    gl.uniform3fv(this.u.uSun, o.sun);
    gl.uniform3fv(this.u.uEye, o.eye);
    gl.uniform3fv(this.u.uSky, o.sky);
    gl.uniform2fv(this.u.uFog, o.fog);
    this.bound = null;
    gl.disable(gl.BLEND); gl.depthMask(true);
    for (const it of o.items) this.draw(it);
    // 影：ぼかした円を太陽と反対へずらして置く
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    for (const it of o.items) {
      if (!it.shadow) continue;
      const len = it.shadow * 0.45;
      const size = Math.max(it.s[0], it.s[2]) * 1.7 + len * 0.6;
      this.draw({ mesh: o.plane, p: [it.p[0] - o.sun[0] * len, 0.068, it.p[2] - o.sun[2] * len], s: [size, 1, size], r: 0,
        c: [0.08, 0.1, 0.2], tex: o.blob, uvs: [1, 1], alpha: 0.3, flat: 1 });
    }
    for (const it of o.overlay ?? []) if (!it.onTop) this.draw(it);
    // いつも手前に描くもの（奥行きを無視する）
    gl.disable(gl.DEPTH_TEST);
    for (const it of o.overlay ?? []) if (it.onTop) this.draw(it);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  private draw(it: Item) {
    const gl = this.gl, u = this.u, a = this.a;
    if (this.bound !== it.mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, it.mesh.buf);
      gl.vertexAttribPointer(a.pos, 3, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(a.nor, 3, gl.FLOAT, false, 32, 12);
      gl.vertexAttribPointer(a.uv, 2, gl.FLOAT, false, 32, 24);
      this.bound = it.mesh;
    }
    if (it.m3) {
      const m = it.m3;
      const cy = it.s[1] / 2; // 形の中心（底から半分の高さ）を軸にする
      const tx = it.p[0] - m[3] * cy, ty = it.p[1] + cy - m[4] * cy, tz = it.p[2] - m[5] * cy;
      gl.uniformMatrix4fv(u.uModel, false, new Float32Array([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, tx, ty, tz, 1]));
    } else {
      const c = Math.cos(it.r), sn = Math.sin(it.r);
      gl.uniformMatrix4fv(u.uModel, false, new Float32Array([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, it.p[0], it.p[1], it.p[2], 1]));
    }
    gl.uniform3fv(u.uScl, it.s);
    gl.uniform2fv(u.uUVS, it.uvs);
    gl.uniform3fv(u.uCol, it.c);
    gl.uniform1f(u.uAlpha, it.alpha ?? 1);
    gl.uniform1f(u.uFlat, it.flat ?? 0);
    gl.bindTexture(gl.TEXTURE_2D, it.tex);
    gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
  }
}
