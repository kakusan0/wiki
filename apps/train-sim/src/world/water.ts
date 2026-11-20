// 海と川：空を映す水面。波は法線をずらして作る
import * as THREE from 'three';
import { at, BRIDGE } from '../route';
import { RIVER_LEVEL, riverS } from './terrain';

export function waterMaterial(color: number, scale: number, uTime: { value: number }) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.04, metalness: 0.0, envMapIntensity: 1.0 });
  m.userData.key = 'water' + scale;
  m.userData.patch = (sh: THREE.WebGLProgramParametersWithUniforms) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; varying vec3 vWP;
vec2 wave(vec2 p, vec2 dir, float k, float sp, float amp){
  float ph = dot(p, dir) * k + uTime * sp;
  return dir * cos(ph) * amp * k;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 p = vWP.xz * ${scale.toFixed(2)};
  vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 0.9, 1.3, 0.05)
         + wave(p, normalize(vec2(-0.4, 1.0)), 1.7, 1.9, 0.03)
         + wave(p, normalize(vec2(0.8, -0.7)), 3.3, 2.7, 0.014)
         + wave(p, normalize(vec2(-1.0, -0.2)), 7.1, 3.9, 0.006)
         + wave(p, normalize(vec2(0.2, 1.0)), 13.0, 5.3, 0.003);
  vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`)
      .replace('#include <tonemapping_fragment>', `
  // 深い所の色と、空の映り込みの強さ（フレネル）
  {
    vec3 V = normalize(cameraPosition - vWP);
    float fr = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb * 0.85, gl_FragColor.rgb * 1.1, fr);
  }
  #include <tonemapping_fragment>`);
  };
  return m;
}

export function buildWater(group: THREE.Group, uTime: { value: number }) {
  // 海：大きな板（地形の下にもぐる所は隠れる）
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000, 1, 1), waterMaterial(0x1d4a5a, 0.35, uTime));
  sea.rotation.x = -Math.PI / 2;
  const c = at(900);
  sea.position.set(c.x, 0, c.z);
  sea.receiveShadow = true;
  group.add(sea);
  // 川：谷にそって曲がる帯
  const y = RIVER_LEVEL();
  const pos: number[] = [], idx: number[] = [];
  let k = 0;
  for (let d = -900; d <= 900; d += 10) {
    const s = riverS(d);
    for (const w of [-34, 34]) { const f = at(s + w, d); pos.push(f.x, y, f.z); }
    if (d > -900) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    k++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 向きをそろえる（上向き）
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const river = new THREE.Mesh(g, waterMaterial(0x2c4a3c, 0.9, uTime));
  river.material.side = THREE.DoubleSide;
  river.receiveShadow = true;
  group.add(river);
  void BRIDGE;
}
