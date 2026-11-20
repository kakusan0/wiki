// WebGL の描画：電子空間の背景・光る格子・光の粒・厚みのある札・札のまわりの光
import { BACK, uvRect } from '../art';
import type { Mat4, Vec3 } from './math';

export const CW = 1; // 札の幅
export const CH = 1.6; // 札の高さ
export const CD = 0.035; // 札の厚み

export interface CardDraw { m: Mat4; face: number; glow: [number, number, number, number]; dim: number; alpha?: number }
export interface HaloDraw { m: Mat4; color: [number, number, number, number] }
export interface FrameOpts {
  time: number; vp: Mat4; eye: Vec3;
  tint: Vec3; // 空間の色（ふだんは青、決戦は赤、応援が満ちると金）
  cheer: number; // 0〜1：光の粒の量
  burst: number; // 粒がはじける演出の時刻（秒）
  pulse: number; // 格子に輪が広がる演出の時刻（秒）
  dim: number; // 0〜1：空間を暗くする（役の場面）
  overlay: { flash: number; flashColor: Vec3; speed: number; vignette: number; red: number };
  rings: RingDraw[];
  pillars: PillarDraw[];
  sparks: Float32Array; // [x,y,z, r,g,b, size] × sparkCount
  sparkCount: number;
}
export interface RingDraw { c: Vec3; r: number; w: number; color: Vec3; a: number }
export interface PillarDraw { m: Mat4; color: Vec3; a: number }
export const SPARK_STRIDE = 7;
export const SPARK_MAX = 700;

const BG_VS = `attribute vec2 aP;varying vec2 vP;void main(){vP=aP;gl_Position=vec4(aP,0.999,1.0);}`;
const BG_FS = `precision mediump float;varying vec2 vP;uniform float uT;uniform vec3 uTint;uniform float uDim;
float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){float r=length(vP*vec2(1.0,0.8));vec3 c=mix(uTint*0.22+vec3(0.02,0.03,0.07),vec3(0.005,0.008,0.02),smoothstep(0.0,1.3,r));
vec2 g=floor(gl_FragCoord.xy/3.0);float s=step(0.9975,h(g))*(0.5+0.5*sin(uT*2.0+h(g+1.0)*30.0));c+=vec3(s)*0.6;
gl_FragColor=vec4(c*(1.0-uDim*0.8),1.0);}`;

const GRID_VS = `attribute vec2 aP;uniform mat4 uVP;varying vec3 vW;void main(){vW=vec3(aP.x,-0.9,aP.y);gl_Position=uVP*vec4(vW,1.0);}`;
const GRID_FS = `precision mediump float;varying vec3 vW;uniform float uT;uniform vec3 uTint;uniform float uPulse;uniform float uDim;
float line(float v,float w){float d=abs(fract(v-0.5)-0.5)/fwidth(v);return 1.0-min(d/w,1.0);}
void main(){vec2 p=vW.xz;float l=max(line(p.x*0.5,1.0),line(p.y*0.5,1.0))*0.55+max(line(p.x*0.1,1.4),line(p.y*0.1,1.4))*0.6;
float r=length(p);float fade=1.0-smoothstep(6.0,34.0,r);
float wave=0.5+0.5*sin(r*0.8-uT*2.2);
float age=uT-uPulse;float ring=age>0.0&&age<2.5?exp(-pow((r-age*14.0)*0.6,2.0))*(1.0-age/2.5):0.0;
vec3 c=uTint*(l*(0.35+0.35*wave)+ring*1.6)+vec3(1.0)*ring*0.4;
gl_FragColor=vec4(c*fade*(1.0-uDim*0.85),1.0);}`;

const PT_VS = `attribute vec4 aS;uniform mat4 uVP;uniform float uT;uniform float uAmount;uniform float uBurst;varying float vA;
void main(){float ang=aS.x*6.2831+uT*0.05*(0.5+aS.z);float rad=3.0+aS.y*16.0;
float y=mod(aS.w*14.0+uT*(0.25+aS.z*0.5),14.0)-3.0;
float b=uT-uBurst;float push=b>0.0&&b<1.6?(1.0-b/1.6)*6.0*aS.z:0.0;
vec3 p=vec3(cos(ang)*(rad+push),y,sin(ang)*(rad+push)-2.0);
vec4 c=uVP*vec4(p,1.0);gl_Position=c;float on=step(aS.w,uAmount);
vA=on*(1.0-smoothstep(8.0,11.0,y))*(0.35+0.65*aS.z);gl_PointSize=on*(2.0+aS.z*6.0)*(30.0/max(c.w,1.0));}`;
const PT_FS = `precision mediump float;varying float vA;uniform vec3 uTint;
void main(){vec2 d=gl_PointCoord-0.5;float a=smoothstep(0.5,0.0,length(d));gl_FragColor=vec4((uTint*0.8+vec3(0.35))*a*vA,1.0);}`;

const CARD_VS = `attribute vec3 aP;attribute vec3 aN;attribute vec2 aU;attribute float aF;
uniform mat4 uVP;uniform mat4 uM;uniform vec4 uFront;uniform vec4 uBack;
varying vec3 vN;varying vec3 vW;varying vec2 vUV;varying vec2 vL;varying float vF;
void main(){vec4 w=uM*vec4(aP,1.0);vW=w.xyz;vN=normalize(mat3(uM)*aN);vL=aU;vF=aF;
vec4 r=aF<0.5?uFront:uBack;vUV=mix(r.xy,r.zw,aU);gl_Position=uVP*w;}`;
const CARD_FS = `precision mediump float;uniform sampler2D uTex;uniform vec3 uEye;uniform vec4 uGlow;uniform float uDim;uniform float uT;uniform float uAlpha;
varying vec3 vN;varying vec3 vW;varying vec2 vUV;varying vec2 vL;varying float vF;
void main(){vec3 n=normalize(vN);vec3 base=vF>1.5?vec3(0.18,0.1,0.06):texture2D(uTex,vUV).rgb;
vec3 L=normalize(vec3(-0.35,1.0,0.55));vec3 v=normalize(uEye-vW);
float dif=max(dot(n,L),0.0);vec3 hh=normalize(L+v);float spec=pow(max(dot(n,hh),0.0),40.0)*0.35;
float sheen=pow(max(0.0,sin((vL.x+vL.y)*3.0-uT*1.2+vW.x*0.3)),24.0)*0.08;
vec3 c=base*(0.42+0.68*dif)+vec3(spec+sheen);
float e=max(abs(vL.x*2.0-1.0),abs(vL.y*2.0-1.0));float edge=smoothstep(0.82,1.0,e);
c+=uGlow.rgb*uGlow.a*(edge*1.4+0.12);c*=1.0-uDim*0.75;
gl_FragColor=vec4(c*uAlpha,1.0);}`;

const HALO_VS = `attribute vec2 aP;uniform mat4 uVP;uniform mat4 uM;varying vec2 vP;void main(){vP=aP;gl_Position=uVP*uM*vec4(aP.x*0.9,aP.y*1.35,-0.03,1.0);}`;
const HALO_FS = `precision mediump float;varying vec2 vP;uniform vec4 uC;
void main(){vec2 d=abs(vP)-vec2(0.38,0.38);float r=length(max(d,0.0));float a=exp(-r*r*40.0);gl_FragColor=vec4(uC.rgb*a*uC.a,1.0);}`;

// 床に広がる衝撃波の輪
const RING_VS = `attribute vec2 aP;uniform mat4 uVP;uniform vec3 uC;uniform mediump float uR;varying vec2 vP;
void main(){vP=aP*(uR+1.0);gl_Position=uVP*vec4(uC.x+vP.x,uC.y,uC.z+vP.y,1.0);}`;
const RING_FS = `precision mediump float;varying vec2 vP;uniform float uR;uniform float uW;uniform vec3 uCol;uniform float uA;
void main(){float d=abs(length(vP)-uR);float a=exp(-d*d/(uW*uW))*uA;float inner=smoothstep(uR,0.0,length(vP))*0.15*uA;gl_FragColor=vec4(uCol*(a+inner),1.0);}`;
// はじける火花
const SP_VS = `attribute vec3 aP;attribute vec3 aC;attribute float aS;uniform mat4 uVP;varying vec3 vC;
void main(){vec4 c=uVP*vec4(aP,1.0);gl_Position=c;vC=aC;gl_PointSize=aS*(40.0/max(c.w,1.0));}`;
const SP_FS = `precision mediump float;varying vec3 vC;void main(){vec2 d=gl_PointCoord-0.5;float a=smoothstep(0.5,0.0,length(d));gl_FragColor=vec4(vC*a*(0.6+a),1.0);}`;
// 立ち上がる光の柱
const PIL_VS = `attribute vec2 aP;uniform mat4 uVP;uniform mat4 uM;varying vec2 vP;void main(){vP=aP;gl_Position=uVP*uM*vec4(aP.x*0.5,(aP.y+1.0)*0.5,0.0,1.0);}`;
const PIL_FS = `precision mediump float;varying vec2 vP;uniform vec3 uCol;uniform float uA;uniform float uT;
void main(){float x=abs(vP.x);float core=exp(-x*x*30.0)+exp(-x*x*4.0)*0.5;float y=(vP.y+1.0)*0.5;float fade=smoothstep(0.0,0.08,y)*(1.0-smoothstep(0.55,1.0,y));
float stripes=0.8+0.2*sin(y*40.0-uT*12.0);gl_FragColor=vec4(uCol*core*fade*stripes*uA,1.0);}`;
// 画面全体：閃光・周辺の暗さ・スピード線・赤い脈動
const OV_VS = `attribute vec2 aP;varying vec2 vP;void main(){vP=aP;gl_Position=vec4(aP,0.0,1.0);}`;
const OV_FS = `precision mediump float;varying vec2 vP;uniform float uFlash;uniform vec3 uFlashC;uniform float uSpeed;uniform float uVig;uniform float uRed;uniform float uT;uniform float uAspect;
float h(float n){return fract(sin(n)*43758.5453);}
void main(){vec2 p=vP*vec2(uAspect,1.0);float r=length(p);float ang=atan(p.y,p.x);
float id=floor(ang*90.0/3.14159);float line=step(0.62,h(id+floor(uT*24.0)*7.0))*smoothstep(0.35,1.2,r)*(0.5+0.5*h(id*3.1));
vec3 add=uFlashC*uFlash+vec3(1.0)*line*uSpeed*0.55+vec3(1.0,0.1,0.15)*uRed*smoothstep(0.4,1.4,r)*0.6;
float dark=clamp(uVig*smoothstep(0.35,1.35,r),0.0,0.92);gl_FragColor=vec4(add,dark);}`;

function cardGeometry(): Float32Array {
  const out: number[] = [];
  const x = CW / 2, y = CH / 2, z = CD / 2;
  // [x,y,z, nx,ny,nz, u,v, face]  face 0=表 1=裏 2=縁
  const quad = (q: number[][], n: number[], uv: number[][], f: number) => { for (const k of [0, 1, 2, 0, 2, 3]) out.push(...q[k], ...n, ...uv[k], f); };
  const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  quad([[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [0, 0, 1], UV, 0);
  quad([[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], [0, 0, -1], UV, 1);
  quad([[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], [1, 0, 0], UV, 2);
  quad([[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], [-1, 0, 0], UV, 2);
  quad([[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], [0, 1, 0], UV, 2);
  quad([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0], UV, 2);
  return new Float32Array(out);
}

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; a: Record<string, number> };

export class Stage {
  readonly gl: WebGLRenderingContext;
  private bg: Prog; private grid: Prog; private pts: Prog; private card: Prog; private halo: Prog; private ring: Prog; private sp: Prog; private pil: Prog; private ov: Prog;
  private spBuf!: WebGLBuffer;
  private quadBuf: WebGLBuffer; private gridBuf: WebGLBuffer; private ptBuf: WebGLBuffer; private cardBuf: WebGLBuffer;
  private ptCount = 900;
  private tex: WebGLTexture;
  private rects: [number, number, number, number][] = [];

  static create(canvas: HTMLCanvasElement, atlasCanvas: HTMLCanvasElement): Stage | null {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    try { return new Stage(gl, atlasCanvas); } catch (e) { console.warn(e); return null; }
  }

  private constructor(gl: WebGLRenderingContext, atlasCanvas: HTMLCanvasElement) {
    this.gl = gl;
    gl.getExtension('OES_standard_derivatives');
    const mk = (vs: string, fs: string, us: string[], as: string[], deriv = false): Prog => {
      const sh = (t: number, src: string) => {
        const s = gl.createShader(t)!;
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
        return s;
      };
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, (deriv ? '#extension GL_OES_standard_derivatives : enable\n' : '') + fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
      const u: Prog['u'] = {}, a: Prog['a'] = {};
      for (const k of us) u[k] = gl.getUniformLocation(p, k);
      for (const k of as) a[k] = gl.getAttribLocation(p, k);
      return { p, u, a };
    };
    this.bg = mk(BG_VS, BG_FS, ['uT', 'uTint', 'uDim'], ['aP']);
    this.grid = mk(GRID_VS, GRID_FS, ['uVP', 'uT', 'uTint', 'uPulse', 'uDim'], ['aP'], true);
    this.ring = mk(RING_VS, RING_FS, ['uVP', 'uC', 'uR', 'uW', 'uCol', 'uA'], ['aP']);
    this.sp = mk(SP_VS, SP_FS, ['uVP'], ['aP', 'aC', 'aS']);
    this.pil = mk(PIL_VS, PIL_FS, ['uVP', 'uM', 'uCol', 'uA', 'uT'], ['aP']);
    this.ov = mk(OV_VS, OV_FS, ['uFlash', 'uFlashC', 'uSpeed', 'uVig', 'uRed', 'uT', 'uAspect'], ['aP']);
    this.pts = mk(PT_VS, PT_FS, ['uVP', 'uT', 'uAmount', 'uBurst', 'uTint'], ['aS']);
    this.card = mk(CARD_VS, CARD_FS, ['uVP', 'uM', 'uFront', 'uBack', 'uTex', 'uEye', 'uGlow', 'uDim', 'uT', 'uAlpha'], ['aP', 'aN', 'aU', 'aF']);
    this.halo = mk(HALO_VS, HALO_FS, ['uVP', 'uM', 'uC'], ['aP']);

    const buf = (data: Float32Array) => { const b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    this.quadBuf = buf(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    const G = 60;
    this.gridBuf = buf(new Float32Array([-G, -G, G, -G, G, G, -G, -G, G, G, -G, G]));
    const seeds = new Float32Array(this.ptCount * 4);
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < this.ptCount; i++) { seeds[i * 4] = r(); seeds[i * 4 + 1] = r(); seeds[i * 4 + 2] = r(); seeds[i * 4 + 3] = i / this.ptCount; }
    this.ptBuf = buf(seeds);
    this.cardBuf = buf(cardGeometry());
    this.spBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spBuf);
    gl.bufferData(gl.ARRAY_BUFFER, SPARK_MAX * SPARK_STRIDE * 4, gl.DYNAMIC_DRAW);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    for (let i = 0; i <= BACK; i++) this.rects.push(uvRect(i));
  }

  private attrib(prog: Prog, buf: WebGLBuffer, layout: [string, number][]) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const stride = layout.reduce((a, [, n]) => a + n, 0) * 4;
    let off = 0;
    for (const [name, n] of layout) {
      const loc = prog.a[name];
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off); }
      off += n * 4;
    }
  }
  private disable(prog: Prog) { for (const k in prog.a) if (prog.a[k] >= 0) this.gl.disableVertexAttribArray(prog.a[k]); }

  resize(w: number, h: number) {
    const cv = this.gl.canvas as HTMLCanvasElement;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    this.gl.viewport(0, 0, w, h);
  }

  brightPixels(): number {
    const gl = this.gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const d = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, d);
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 300) n++;
    return n;
  }

  draw(f: FrameOpts, cards: CardDraw[], halos: HaloDraw[], ghosts: CardDraw[] = []) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // 背景
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.bg.p);
    gl.uniform1f(this.bg.u.uT, f.time); gl.uniform3fv(this.bg.u.uTint, f.tint); gl.uniform1f(this.bg.u.uDim, f.dim);
    this.attrib(this.bg, this.quadBuf, [['aP', 2]]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.disable(this.bg);
    // 格子（足し合わせ）
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.grid.p);
    gl.uniformMatrix4fv(this.grid.u.uVP, false, f.vp); gl.uniform1f(this.grid.u.uT, f.time); gl.uniform3fv(this.grid.u.uTint, f.tint); gl.uniform1f(this.grid.u.uPulse, f.pulse); gl.uniform1f(this.grid.u.uDim, f.dim);
    this.attrib(this.grid, this.gridBuf, [['aP', 2]]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.disable(this.grid);
    // 衝撃波の輪（札に隠れるよう奥行きを見る）
    gl.enable(gl.DEPTH_TEST); gl.depthMask(false);
    if (f.rings.length) {
      gl.useProgram(this.ring.p);
      gl.uniformMatrix4fv(this.ring.u.uVP, false, f.vp);
      this.attrib(this.ring, this.quadBuf, [['aP', 2]]);
      for (const r of f.rings) {
        gl.uniform3fv(this.ring.u.uC, r.c); gl.uniform1f(this.ring.u.uR, r.r); gl.uniform1f(this.ring.u.uW, r.w);
        gl.uniform3fv(this.ring.u.uCol, r.color); gl.uniform1f(this.ring.u.uA, r.a);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      this.disable(this.ring);
    }
    // 札のまわりの光
    gl.useProgram(this.halo.p);
    gl.uniformMatrix4fv(this.halo.u.uVP, false, f.vp);
    this.attrib(this.halo, this.quadBuf, [['aP', 2]]);
    for (const hd of halos) { gl.uniformMatrix4fv(this.halo.u.uM, false, hd.m); gl.uniform4fv(this.halo.u.uC, hd.color); gl.drawArrays(gl.TRIANGLES, 0, 6); }
    this.disable(this.halo);
    // 札
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.useProgram(this.card.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.card.u.uTex, 0);
    gl.uniformMatrix4fv(this.card.u.uVP, false, f.vp); gl.uniform3fv(this.card.u.uEye, f.eye); gl.uniform1f(this.card.u.uT, f.time);
    gl.uniform4fv(this.card.u.uBack, this.rects[BACK]);
    gl.uniform1f(this.card.u.uAlpha, 1);
    this.attrib(this.card, this.cardBuf, [['aP', 3], ['aN', 3], ['aU', 2], ['aF', 1]]);
    const drawCard = (c: CardDraw) => {
      gl.uniformMatrix4fv(this.card.u.uM, false, c.m);
      gl.uniform4fv(this.card.u.uFront, this.rects[c.face]);
      gl.uniform4fv(this.card.u.uGlow, c.glow); gl.uniform1f(this.card.u.uDim, c.dim);
      if (c.alpha != null) gl.uniform1f(this.card.u.uAlpha, c.alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    };
    for (const c of cards) drawCard(c);
    // 残像（足し合わせ・奥行きは書かない）
    if (ghosts.length) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      for (const c of ghosts) drawCard(c);
      gl.uniform1f(this.card.u.uAlpha, 1);
    }
    this.disable(this.card);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    // 光の柱
    if (f.pillars.length) {
      gl.useProgram(this.pil.p);
      gl.uniformMatrix4fv(this.pil.u.uVP, false, f.vp); gl.uniform1f(this.pil.u.uT, f.time);
      this.attrib(this.pil, this.quadBuf, [['aP', 2]]);
      for (const p of f.pillars) { gl.uniformMatrix4fv(this.pil.u.uM, false, p.m); gl.uniform3fv(this.pil.u.uCol, p.color); gl.uniform1f(this.pil.u.uA, p.a); gl.drawArrays(gl.TRIANGLES, 0, 6); }
      this.disable(this.pil);
    }
    // 光の粒
    gl.useProgram(this.pts.p);
    gl.uniformMatrix4fv(this.pts.u.uVP, false, f.vp); gl.uniform1f(this.pts.u.uT, f.time); gl.uniform1f(this.pts.u.uAmount, (0.25 + f.cheer * 0.75) * (1 - f.dim * 0.7));
    gl.uniform1f(this.pts.u.uBurst, f.burst); gl.uniform3fv(this.pts.u.uTint, f.tint);
    this.attrib(this.pts, this.ptBuf, [['aS', 4]]);
    gl.drawArrays(gl.POINTS, 0, this.ptCount);
    this.disable(this.pts);
    // 火花
    if (f.sparkCount > 0) {
      gl.useProgram(this.sp.p);
      gl.uniformMatrix4fv(this.sp.u.uVP, false, f.vp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.sparks.subarray(0, f.sparkCount * SPARK_STRIDE));
      this.attrib(this.sp, this.spBuf, [['aP', 3], ['aC', 3], ['aS', 1]]);
      gl.drawArrays(gl.POINTS, 0, f.sparkCount);
      this.disable(this.sp);
    }
    // 画面全体の効果
    const o = f.overlay;
    if (o.flash > 0.001 || o.speed > 0.001 || o.vignette > 0.001 || o.red > 0.001) {
      gl.disable(gl.DEPTH_TEST);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.ov.p);
      gl.uniform1f(this.ov.u.uFlash, o.flash); gl.uniform3fv(this.ov.u.uFlashC, o.flashColor); gl.uniform1f(this.ov.u.uSpeed, o.speed);
      gl.uniform1f(this.ov.u.uVig, o.vignette); gl.uniform1f(this.ov.u.uRed, o.red); gl.uniform1f(this.ov.u.uT, f.time);
      const cv = gl.canvas as HTMLCanvasElement;
      gl.uniform1f(this.ov.u.uAspect, cv.width / Math.max(1, cv.height));
      this.attrib(this.ov, this.quadBuf, [['aP', 2]]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.disable(this.ov);
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
}
