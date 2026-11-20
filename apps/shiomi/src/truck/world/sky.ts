// 空（色の移り変わり・太陽の光の輪・雲）と、太陽の光
import * as THREE from 'three';

export function buildSky(scene: THREE.Scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x1f63b8) }, mid: { value: new THREE.Color(0x9cc4ea) }, bot: { value: new THREE.Color(0x8a8a86) },
      sunDir: { value: new THREE.Vector3(0.4, 0.8, 0.5).normalize() }, sunGlow: { value: new THREE.Color(0xfff0d8) },
      cloudLit: { value: new THREE.Color(0xffffff) }, cloudDark: { value: new THREE.Color(0xa4b0c0) }, cloud: { value: 0.45 },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunGlow;
      uniform vec3 cloudLit; uniform vec3 cloudDark; uniform float cloud;
      varying vec3 vP;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ v += a*noise(p); p = p*2.03 + 1.7; a *= 0.5; } return v; }
      void main(){
        vec3 d = normalize(vP); float h = d.y;
        vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.5, 0.0, 1.0), 0.6)) : mix(mid, bot, clamp(-h*5.0, 0.0, 1.0));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        c += sunGlow * (pow(sd, 4.0)*0.55 + pow(sd, 40.0)*1.2);
        c += sunGlow * smoothstep(0.9990, 0.9996, sd) * 6.0;
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.15) * 1.1;
          float n = fbm(uv + vec2(4.3, 1.9));
          float cl = smoothstep(0.62 - cloud*0.3, 0.92, n) * smoothstep(0.0, 0.1, h);
          float lit = fbm(uv*1.7 + 3.0);
          vec3 cc = mix(cloudDark, cloudLit, 0.35 + 0.65*lit) + sunGlow * pow(sd, 5.0) * 0.8;
          c = mix(c, cc, cl * 0.92);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  dome.frustumCulled = false;
  scene.add(dome);

  const sun = new THREE.DirectionalLight(0xfff1de, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x6a5e50, 0.35);
  scene.add(hemi);
  scene.fog = new THREE.Fog(0xb9cde2, 260, 1300);
  const dir = mat.uniforms.sunDir.value as THREE.Vector3;

  return {
    dome, sun, hemi,
    /** 影の範囲をトラックに合わせて動かす */
    follow(x: number, z: number) {
      sun.target.position.set(x, 0, z);
      sun.position.set(x, 0, z).addScaledVector(dir, 160);
      dome.position.set(x, 0, z);
    },
  };
}
