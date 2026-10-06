// Time of day and weather: a sun/moon cycle with stars and lit windows, plus rain and storms.
// Rain puts out fires and waters the fields; storms throw lightning.
import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, groundTop, isWaterCol } from './world.js';
import { nations, game, nm } from './nations.js';
import { civics } from './buildings.js';
import { lightning, wet } from './effects.js';
import { ambience } from './audio.js';
import { log } from './ui.js';

const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const DAY = 48; // simulated seconds per day (12 years)
export const sky = {
  time: DAY * 0.4,           // seconds into the cycle
  t01: 0.4, elev: 1, dayK: 1, night: 0, warm: 0,
  kind: 'clear', k: 0, goal: 0, // weather: 'clear' | 'rain' | 'storm', k = how strong right now
  changeT: rand(30, 60), stormT: 3,
  sunColor: new THREE.Color(), hemiColor: new THREE.Color(), fogColor: new THREE.Color(0xc4dcec),
  sunMul: 1, hemiMul: 1, sunDir: new THREE.Vector3(-70, 120, -55),
};

let scene, camera, getFocus, stars, lights, rain, lightPos, lightGeo, rainPos, lightT = 0, lastYear = -1;
const NR = 1600;
const drops = new Float32Array(NR * 3); // x, y, z offsets relative to the focus
const C = { dusk: new THREE.Color('#ff9150'), moon: new THREE.Color('#8aa4de'), nightHemi: new THREE.Color('#23305c'), dayFog: new THREE.Color('#c4dcec'), nightFog: new THREE.Color('#0a1024'), duskFog: new THREE.Color('#e0a27a'), grey: new THREE.Color('#8c97a3') };

export function initSky(s, cam, focusFn) {
  scene = s; camera = cam; getFocus = focusFn;
  // stars
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.acos(rand(0.05, 1)); // upper hemisphere
    pos[i * 3] = Math.sin(e) * Math.cos(a) * 1000; pos[i * 3 + 1] = Math.cos(e) * 1000; pos[i * 3 + 2] = Math.sin(e) * Math.sin(a) * 1000;
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  stars.frustumCulled = false; stars.renderOrder = -1;
  scene.add(stars);
  // village lights
  lightPos = new Float32Array(900 * 3);
  lightGeo = new THREE.BufferGeometry();
  lightGeo.setAttribute('position', new THREE.BufferAttribute(lightPos, 3).setUsage(THREE.DynamicDrawUsage));
  lightGeo.setDrawRange(0, 0);
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,230,160,1)'); gr.addColorStop(0.35, 'rgba(255,190,90,0.6)'); gr.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  lights = new THREE.Points(lightGeo, new THREE.PointsMaterial({ size: 2.6, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  lights.frustumCulled = false;
  scene.add(lights); sky.obj = { lights, stars };
  // rain streaks
  for (let i = 0; i < NR; i++) { drops[i * 3] = rand(-60, 60); drops[i * 3 + 1] = rand(0, 50); drops[i * 3 + 2] = rand(-60, 60); }
  rainPos = new Float32Array(NR * 6);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  rg.setDrawRange(0, 0);
  rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xbcd3ee, transparent: true, opacity: 0.45, depthWrite: false }));
  rain.frustumCulled = false;
  scene.add(rain);
}

export function setWeather(kind) {
  sky.kind = kind; sky.goal = kind === 'clear' ? 0 : kind === 'rain' ? 0.6 : 1;
  sky.changeT = rand(40, 90);
  if (kind === 'storm') log('⛈️ A storm rolls across the land.');
}
export function cycleWeather() { setWeather(sky.kind === 'clear' ? 'rain' : sky.kind === 'rain' ? 'storm' : 'clear'); return sky.kind; }

export function skyLabel() {
  const tod = sky.elev > 0.25 ? '☀️' : sky.elev > -0.12 ? (sky.t01 < 0.5 ? '🌅' : '🌇') : '🌙';
  const wx = sky.k < 0.05 ? '' : sky.kind === 'storm' ? ' ⛈️' : ' 🌧️';
  return tod + wx;
}

function updateLights() {
  let n = 0;
  const put = (x, y, z) => { if (n < 900) { lightPos[n * 3] = x; lightPos[n * 3 + 1] = y; lightPos[n * 3 + 2] = z; n++; } };
  for (const nat of nations) {
    if (!nat.alive) continue;
    for (const h of nat.houses) if (!h.dead && h.placed > 8) put(h.x0 + 3.5, h.g + 2.2, h.z0 + 3.5);
  }
  for (const c of civics) if (!c.dead) put(c.cx, c.g + (c.type === 'tower' ? 10.6 : 2.2), c.cz);
  lightGeo.setDrawRange(0, n); sky.lightCount = n;
  lightGeo.attributes.position.needsUpdate = true;
}

export function updateSky(sdt, dt, time) {
  // ---- time of day (sim time) ----
  sky.time += sdt;
  sky.t01 = (sky.time / DAY) % 1;
  sky.elev = Math.sin((sky.t01 - 0.25) * Math.PI * 2);
  sky.dayK = smooth(-0.14, 0.28, sky.elev);
  sky.night = 1 - sky.dayK;
  sky.warm = 1 - smooth(0.02, 0.38, Math.abs(sky.elev));

  // ---- weather (sim time) ----
  if (sdt > 0) {
    sky.changeT -= sdt;
    if (sky.changeT <= 0) {
      const r = Math.random();
      setWeather(sky.kind !== 'clear' ? 'clear' : r < 0.62 ? 'rain' : 'storm');
      if (sky.kind === 'rain') sky.changeT = rand(25, 55);
    }
    sky.k += (sky.goal - sky.k) * Math.min(1, sdt * 0.35);
    if (sky.kind === 'storm' && sky.k > 0.5) {
      sky.stormT -= sdt;
      if (sky.stormT <= 0) {
        sky.stormT = rand(2.5, 7);
        const f = getFocus();
        for (let k = 0; k < 12; k++) {
          const near = Math.random() < 0.7;
          const x = near ? f.x + rand(-50, 50) : rand(8, W - 8), z = near ? f.z + rand(-50, 50) : rand(8, D - 8);
          if (x < 4 || z < 4 || x >= W - 4 || z >= D - 4) continue;
          const gy = groundTop(Math.floor(x), Math.floor(z));
          if (gy < SEA) continue;
          lightning(x, gy + 1, z);
          break;
        }
      }
    }
    if (game.year !== lastYear) {
      if (lastYear >= 0 && sky.k > 0.4) for (const n of nations) if (n.alive && n.farms.length) n.food += Math.min(5, n.farms.length * 1.5); // rain waters the fields
      lastYear = game.year;
    }
  }
  wet.v = sky.k > 0.15 ? Math.min(1, sky.k) : 0;
  ambience.rain = sky.k; ambience.night = sky.night;

  // ---- lighting state, read by main.js ----
  const cloud = sky.k * 0.65;
  sky.sunMul = (0.2 + 0.8 * sky.dayK) * (1 - cloud);
  sky.hemiMul = (0.5 + 0.5 * sky.dayK) * (1 - cloud * 0.5);
  const a = (sky.t01 - 0.25) * Math.PI * 2;
  const el = Math.max(0.22, Math.abs(Math.sin(a)));
  sky.sunDir.set(-Math.cos(a) * 95, 30 + 100 * el, -50);
  sky.fogColor.copy(C.nightFog).lerp(C.dayFog, sky.dayK).lerp(C.duskFog, sky.warm * 0.55 * sky.dayK).lerp(C.grey, cloud * (0.35 + 0.65 * sky.dayK));

  // ---- props ----
  const f = getFocus();
  stars.position.copy(camera.position);
  stars.material.opacity = Math.max(0, sky.night - 0.25) * (1 - sky.k * 0.9) * 1.1;
  lights.material.opacity = Math.min(1, sky.night * 1.4 + sky.k * 0.35) * 0.9;
  lights.material.size = 2.6 + Math.sin(time * 5) * 0.12;
  lightT -= dt;
  if (lightT <= 0 && lights.material.opacity > 0.02) { lightT = 1.5; updateLights(); }
  const nd = Math.floor(NR * Math.min(1, sky.k * 1.15));
  if (nd > 0) {
    const fall = 46 + sky.k * 12, wind = sky.kind === 'storm' ? 9 : 3;
    for (let i = 0; i < nd; i++) {
      let y = drops[i * 3 + 1] - fall * dt;
      let x = drops[i * 3] - wind * dt;
      if (y < -6) { y += 56; x = rand(-60, 60); drops[i * 3 + 2] = rand(-60, 60); }
      drops[i * 3] = x; drops[i * 3 + 1] = y;
      const wx = f.x + x, wz = f.z + drops[i * 3 + 2], wy = SEA + 2 + y;
      rainPos[i * 6] = wx; rainPos[i * 6 + 1] = wy; rainPos[i * 6 + 2] = wz;
      rainPos[i * 6 + 3] = wx + wind * 0.018; rainPos[i * 6 + 4] = wy + 1.8; rainPos[i * 6 + 5] = wz;
    }
    rain.geometry.attributes.position.needsUpdate = true;
  }
  rain.geometry.setDrawRange(0, nd * 2);
  rain.material.opacity = 0.35 + sky.k * 0.35;
}
