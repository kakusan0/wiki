// 画面の後処理：物の陰の暗がり（GTAO）・光のにじみ・色の調子・速さのぼかし・アンチエイリアス
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const Grade = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0 },
    uVig: { value: 0.32 },
    uWarm: { value: 0.04 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
uniform sampler2D tDiffuse; uniform float uSpeed; uniform float uVig; uniform float uWarm;
varying vec2 vUv;
void main(){
  vec2 c = vUv - 0.5;
  // 速さのぼかし：画面の外側ほど、中心から外へ流す
  vec3 col = vec3(0.0);
  float k = uSpeed * smoothstep(0.18, 0.62, length(c));
  for (int i = 0; i < 6; i++) col += texture2D(tDiffuse, vUv - c * k * float(i) * 0.012).rgb;
  col /= 6.0;
  // 色の調子（線形のまま）：影は少し青く、明るい所は少し暖かく
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.93, 0.98, 1.06), smoothstep(0.25, 0.0, l) * 0.6);
  col = mix(col, col * vec3(1.0 + uWarm, 1.0, 1.0 - uWarm), smoothstep(0.3, 1.5, l));
  col = mix(vec3(l), col, 1.08); // 彩度を少し上げる
  // 周辺減光
  col *= 1.0 - uVig * dot(c, c) * 1.6;
  gl_FragColor = vec4(col, 1.0);
}`,
};

/** 陰の暗がりは半分の解像度で計算する（全体の重さを大きく減らす） */
class HalfGTAOPass extends GTAOPass {
  setSize(width: number, height: number) { super.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2))); }
}

export interface Post {
  composer: EffectComposer; grade: ShaderPass; gtao: GTAOPass; bloom: UnrealBloomPass;
  setSize(w: number, h: number): void;
  setLevel(o: { gtao: boolean; bloom: boolean; samples: number }): void;
}

export function buildPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Post {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new HalfGTAOPass(scene, camera, size.x, size.y);
  gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
  gtao.blendIntensity = 0.85;
  composer.addPass(gtao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.5, 1.05);
  composer.addPass(bloom);
  const grade = new ShaderPass(Grade);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  let samples = 4;
  return {
    composer, grade, gtao, bloom,
    setSize(w, h) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); },
    setLevel(o) {
      gtao.enabled = o.gtao;
      bloom.enabled = o.bloom;
      if (o.samples !== samples) {
        samples = o.samples;
        for (const t of [composer.renderTarget1, composer.renderTarget2]) { t.samples = samples; t.dispose(); }
      }
    },
  };
}
