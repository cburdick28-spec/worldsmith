// Water look: shallow-to-deep tint and animated foam where the sea meets land. A small distance-to-shore
// texture is rebuilt from the heightmap a few times a second, so floods, quakes and digging all show up.
import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, height } from './world.js';

const data = new Uint8Array(W * D);
const shoreTex = new THREE.DataTexture(data, W, D, THREE.RedFormat, THREE.UnsignedByteType);
shoreTex.magFilter = shoreTex.minFilter = THREE.LinearFilter;
shoreTex.wrapS = shoreTex.wrapT = THREE.ClampToEdgeWrapping;
shoreTex.needsUpdate = true;
const U = { uShore: { value: shoreTex }, uTime: { value: 0 }, uSize: { value: new THREE.Vector2(W, D) } };
const dist = new Float32Array(W * D);
let acc = 99;

export function makeWaterMaterial() {
  const m = new THREE.MeshPhongMaterial({ color: 0x2f74c4, transparent: true, opacity: 0.78, shininess: 40, specular: 0x5f8fcf, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWP; uniform sampler2D uShore; uniform float uTime; uniform vec2 uSize;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float sd = texture2D(uShore, vWP.xz / uSize).r * 255.0 / 8.0; // tiles to the nearest land
      float shallow = 1.0 - smoothstep(0.0, 6.0, sd);
      float deep = smoothstep(5.0, 20.0, sd);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.17, 0.42), deep * 0.65);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.70, 0.78), shallow * 0.42);
      float caustic = vn(vWP.xz * 0.55 + vec2(uTime * 0.12, uTime * 0.09)) * 0.7 + vn(vWP.xz * 1.7 - vec2(uTime * 0.2, 0.0)) * 0.3;
      diffuseColor.rgb *= 0.88 + 0.24 * caustic;
      float n = vn(vWP.xz * 0.9 + vec2(uTime * 0.25, -uTime * 0.18));
      float wave = 0.5 + 0.5 * sin(sd * 5.0 - uTime * 1.6 + n * 4.0);
      float rim = (1.0 - smoothstep(0.55, 1.25 + n * 0.5, sd));            // churn hugging the shore
      float band = (1.0 - smoothstep(1.5, 3.4, sd)) * smoothstep(0.35, 0.95, wave) * 0.55; // rolling foam lines
      float foam = clamp(rim * (0.7 + 0.3 * n) + band * n, 0.0, 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.99, 1.0), foam);
      diffuseColor.a = mix(diffuseColor.a, 0.97, deep * 0.95);
      diffuseColor.a = mix(diffuseColor.a, 0.96, foam);`);
  };
  return m;
}

function rebuild() {
  const BIG = 99;
  for (let i = 0; i < W * D; i++) dist[i] = height[i] >= SEA ? 0 : BIG;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x; let d = dist[i]; if (!d) continue;
    if (x > 0) d = Math.min(d, dist[i - 1] + 1);
    if (z > 0) { d = Math.min(d, dist[i - W] + 1); if (x > 0) d = Math.min(d, dist[i - W - 1] + 1.414); if (x < W - 1) d = Math.min(d, dist[i - W + 1] + 1.414); }
    dist[i] = d;
  }
  for (let z = D - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) {
    const i = z * W + x; let d = dist[i]; if (!d) continue;
    if (x < W - 1) d = Math.min(d, dist[i + 1] + 1);
    if (z < D - 1) { d = Math.min(d, dist[i + W] + 1); if (x < W - 1) d = Math.min(d, dist[i + W + 1] + 1.414); if (x > 0) d = Math.min(d, dist[i + W - 1] + 1.414); }
    dist[i] = d;
  }
  for (let i = 0; i < W * D; i++) data[i] = Math.min(255, Math.round(dist[i] * 8));
  shoreTex.needsUpdate = true;
}

export function updateWater(time, dt) {
  U.uTime.value = time;
  acc += dt;
  if (acc > 1.5) { acc = 0; rebuild(); }
}
