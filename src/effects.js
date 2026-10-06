// Particles, debris, fire, meteors, lightning and explosions.
import * as THREE from '../vendor/three.module.js';
import { W, D, H, SEA, WATER_Y, B, BLOCK, get, set, solid, topAt, idx, inB, vox, isWaterCol } from './world.js';
import { units, killUnit, damageUnit } from './units.js';
import { sfx } from './audio.js';
import { rand } from './noise.js';

export const fx = { shake: 0 };
export const wet = { v: 0 };        // 0..1 rain: puts out fires
export const blastHooks = [];       // fn(x, y, z, r) called on every explosion (monsters listen)
let scene, flashLight, meteorLight;

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class Pool {
  constructor(max, size, blending, tex) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3);
    this.c = new Float32Array(max * 4);
    this.v = new Float32Array(max * 3);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pa);
    this.geo.setAttribute('color', this.ca);
    this.mat = new THREE.PointsMaterial({
      size, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true,
    });
    this.pts = new THREE.Points(this.geo, this.mat);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }
  spawn(x, y, z, vx, vy, vz, life, c0, c1, grav = 0, drag = 0, alpha = 1) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.a0[i] = alpha;
  }
  update(dt) {
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const i3 = i * 3, j3 = j * 3;
      if (i !== j) {
        for (let k = 0; k < 3; k++) {
          this.p[j3 + k] = this.p[i3 + k]; this.v[j3 + k] = this.v[i3 + k];
          this.c0[j3 + k] = this.c0[i3 + k]; this.c1[j3 + k] = this.c1[i3 + k];
        }
        this.maxLife[j] = this.maxLife[i]; this.grav[j] = this.grav[i]; this.drag[j] = this.drag[i]; this.a0[j] = this.a0[i];
      }
      this.life[j] = life;
      const dr = Math.max(0, 1 - this.drag[j] * dt);
      this.v[j3] *= dr; this.v[j3 + 1] = this.v[j3 + 1] * dr - this.grav[j] * dt; this.v[j3 + 2] *= dr;
      this.p[j3] += this.v[j3] * dt; this.p[j3 + 1] += this.v[j3 + 1] * dt; this.p[j3 + 2] += this.v[j3 + 2] * dt;
      const k = 1 - life / this.maxLife[j];
      const j4 = j * 4;
      this.c[j4] = this.c0[j3] + (this.c1[j3] - this.c0[j3]) * k;
      this.c[j4 + 1] = this.c0[j3 + 1] + (this.c1[j3 + 1] - this.c0[j3 + 1]) * k;
      this.c[j4 + 2] = this.c0[j3 + 2] + (this.c1[j3 + 2] - this.c0[j3 + 2]) * k;
      this.c[j4 + 3] = this.a0[j] * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      j++;
    }
    this.n = j;
    this.geo.setDrawRange(0, j);
    this.pa.needsUpdate = true;
    this.ca.needsUpdate = true;
  }
}

let firePool, smokePool, dustPool;
const C = hex => new THREE.Color(hex);
const COL = {
  fireA: C('#ffd27a'), fireB: C('#ff4a10'), ember: C('#ffb347'), dark: C('#200800'),
  smokeA: C('#5a5550'), smokeB: C('#9a9590'), dust: C('#a89070'), dustB: C('#c8b89a'),
  white: C('#ffffff'), blood: C('#a01818'), bloodB: C('#400808'), water: C('#cfe8ff'), waterB: C('#5a9ad8'),
  spark: C('#fff2c0'),
};

// ---------- debris (flying voxel cubes) ----------

const DMAX = 900;
let debrisMesh;
const deb = [];
const dummy = new THREE.Object3D();

function initDebris() {
  debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), new THREE.MeshLambertMaterial(), DMAX);
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.castShadow = true;
  debrisMesh.frustumCulled = false;
  for (let i = 0; i < DMAX; i++) debrisMesh.setColorAt(i, COL.white);
  debrisMesh.count = 0;
  scene.add(debrisMesh);
}

export function spawnDebris(x, y, z, vx, vy, vz, type, settle = 0.3) {
  if (deb.length >= DMAX || !BLOCK[type]) return false;
  deb.push({ x, y, z, vx, vy, vz, type, settle, rx: Math.random() * 6, ry: Math.random() * 6, rvx: rand(-8, 8), rvy: rand(-8, 8), life: 7, bounces: 0 });
  return true;
}
export const debrisRoom = () => DMAX - deb.length;

function updateDebris(dt) {
  for (let i = deb.length - 1; i >= 0; i--) {
    const d = deb[i];
    d.life -= dt;
    const wet = d.y < WATER_Y && isWaterCol(d.x, d.z);
    d.vy -= (wet ? 8 : 28) * dt;
    if (wet) { d.vx *= 0.94; d.vz *= 0.94; d.vy *= 0.94; }
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    d.rx += d.rvx * dt; d.ry += d.rvy * dt;
    let remove = d.life <= 0 || d.y < -5 || d.x < 0 || d.z < 0 || d.x >= W || d.z >= D;
    if (!remove) {
      const cx = Math.floor(d.x), cz = Math.floor(d.z);
      const ground = topAt(cx, cz) + 1;
      if (d.y - 0.27 <= ground && d.vy < 0) {
        if (Math.random() < d.settle && ground > 0 && ground < H - 2 && !get(cx, ground, cz)) {
          set(cx, ground, cz, d.type);
          remove = true;
        } else if (d.bounces < 1 && d.y > ground - 1) {
          d.y = ground + 0.27; d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; d.bounces++;
        } else remove = true;
      }
    }
    if (remove) { deb[i] = deb[deb.length - 1]; deb.pop(); }
  }
  for (let i = 0; i < deb.length; i++) {
    const d = deb[i];
    dummy.position.set(d.x, d.y, d.z);
    dummy.rotation.set(d.rx, d.ry, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    debrisMesh.setMatrixAt(i, dummy.matrix);
    debrisMesh.setColorAt(i, BLOCK[d.type].top);
  }
  debrisMesh.count = deb.length;
  debrisMesh.instanceMatrix.needsUpdate = true;
  if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
}

// ---------- fire ----------

const burning = new Map();
let fireAcc = 0;

export function ignite(x, y, z) {
  if (!inB(x, y, z) || burning.size > 2500) return false;
  const t = vox[idx(x, y, z)];
  if (!t || !BLOCK[t].flam) return false;
  const i = idx(x, y, z);
  if (burning.has(i)) return false;
  burning.set(i, { x, y, z, t: BLOCK[t].burn * rand(0.7, 1.3) });
  return true;
}

export function igniteArea(x, y, z, r, chance = 0.6) {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy + dz * dz > r * r) continue;
    if (Math.random() < chance && ignite(Math.floor(x + dx), Math.floor(y + dy), Math.floor(z + dz))) n++;
  }
  return n;
}

export const isBurning = (x, y, z) => inB(x, y, z) && burning.has(idx(x, y, z));
export const fireCount = () => burning.size;

const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function fireTick(step) {
  for (const [i, b] of burning) {
    const t = vox[i];
    if (!t || !BLOCK[t].flam) { burning.delete(i); continue; }
    if (wet.v > 0.05 && Math.random() < wet.v * 0.6 * step) { burning.delete(i); if (Math.random() < 0.4) smokePool.spawn(b.x + 0.5, b.y + 1, b.z + 0.5, 0, 2, 0, 1.5, COL.smokeA, COL.smokeB, -0.2, 0.3, 0.5); continue; }
    b.t -= step;
    if (Math.random() < 0.55) {
      firePool.spawn(b.x + Math.random(), b.y + 0.6 + Math.random() * 0.6, b.z + Math.random(), rand(-0.4, 0.4), rand(1.5, 3), rand(-0.4, 0.4), rand(0.4, 0.9), COL.fireA, COL.fireB, -1, 0.5, 0.9);
    }
    if (Math.random() < 0.12) {
      smokePool.spawn(b.x + 0.5, b.y + 1.4, b.z + 0.5, rand(-0.3, 0.3), rand(1.2, 2.2), rand(-0.3, 0.3), rand(2, 3.5), COL.smokeA, COL.smokeB, -0.2, 0.3, 0.45);
    }
    for (const [dx, dy, dz] of NB) {
      const nx = b.x + dx, ny = b.y + dy, nz = b.z + dz;
      if (!inB(nx, ny, nz)) continue;
      const nt = vox[idx(nx, ny, nz)];
      if (nt && BLOCK[nt].flam && Math.random() < BLOCK[nt].flam * step * 5) ignite(nx, ny, nz);
    }
    if (b.t <= 0) {
      burning.delete(i);
      set(b.x, b.y, b.z, t === B.GRASS ? B.SCORCH : B.AIR);
      if (t !== B.GRASS && get(b.x, b.y - 1, b.z) === B.GRASS && Math.random() < 0.5) set(b.x, b.y - 1, b.z, B.SCORCH);
      if (Math.random() < 0.35) dustPool.spawn(b.x + 0.5, b.y + 0.5, b.z + 0.5, rand(-1, 1), rand(1, 3), rand(-1, 1), 1.2, COL.ember, COL.dark, 3, 0.5, 1);
    }
  }
  // burn the people standing in it
  for (const u of units) {
    if (!u.alive || u.held) continue;
    const x = Math.floor(u.x), y = Math.floor(u.y), z = Math.floor(u.z);
    if (isBurning(x, y, z) || isBurning(x, y - 1, z) || isBurning(x, y + 1, z)) u.onFire = 4;
  }
}

function updateFire(dt) {
  fireAcc += dt;
  const step = 0.2;
  while (fireAcc >= step) { fireAcc -= step; fireTick(step); }
  for (const u of units) {
    if (!u.alive || u.onFire <= 0) continue;
    u.onFire -= dt;
    if (Math.random() < dt * 14) firePool.spawn(u.x + rand(-0.3, 0.3), u.y + rand(0.3, 1.4), u.z + rand(-0.3, 0.3), 0, rand(1.5, 2.5), 0, 0.5, COL.fireA, COL.fireB, -1, 0.5, 0.9);
    if (u.y < WATER_Y && isWaterCol(u.x, u.z)) u.onFire = 0;
    damageUnit(u, dt * 2.2, null, 'fire');
  }
}

// ---------- explosions ----------

export function carve(cx, cy, cz, r) {
  const removed = [];
  const R = Math.ceil(r + 1.5);
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let z = Math.floor(cz - R); z <= cz + R; z++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    if (!inB(x, y, z) || y < 1) continue;
    const t = vox[idx(x, y, z)];
    if (!t) continue;
    const dd = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.15, z + 0.5 - cz);
    if (dd <= r + (Math.random() - 0.5) * 0.8) {
      removed.push([x, y, z, t]);
      set(x, y, z, B.AIR);
    }
  }
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let z = Math.floor(cz - R); z <= cz + R; z++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    if (!inB(x, y, z)) continue;
    const t = vox[idx(x, y, z)];
    if (t !== B.GRASS && t !== B.DIRT && t !== B.SAND && t !== B.SNOW) continue;
    const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
    if (dd <= r + 1.6 && !solid(x, y + 1, z) && Math.random() < 0.75) set(x, y, z, B.SCORCH);
  }
  return removed;
}

export function explode(x, y, z, r, opts = {}) {
  sfx('boom', x, z, r / 3);
  for (const f of blastHooks) f(x, y, z, r);
  const removed = carve(x, y, z, r);
  const step = Math.max(1, Math.floor(removed.length / 160));
  for (let i = 0; i < removed.length; i += step) {
    const [vx, vy, vz, t] = removed[i];
    const dx = vx + 0.5 - x, dz = vz + 0.5 - z;
    const l = Math.hypot(dx, dz) || 1;
    const sp = rand(5, 13) * (r / 4 + 0.5);
    spawnDebris(vx + 0.5, vy + 0.5, vz + 0.5, dx / l * sp, rand(8, 18) * (r / 5 + 0.4), dz / l * sp, t, opts.settle ?? 0.3);
  }
  const dustN = Math.min(140, 20 + r * 18);
  for (let i = 0; i < dustN; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(2, 9) * (r / 4 + 0.4);
    smokePool.spawn(x, y + 0.5, z, Math.cos(a) * s, rand(0.5, 5), Math.sin(a) * s, rand(1.5, 3.2), COL.dust, COL.dustB, -0.4, 1.2, 0.7);
  }
  if (opts.fire) {
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(3, 14);
      firePool.spawn(x, y + 1, z, Math.cos(a) * s, rand(2, 10), Math.sin(a) * s, rand(0.4, 1.1), COL.fireA, COL.fireB, 6, 1.5, 1);
    }
    const fr = opts.fireRadius || r + 3;
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * fr;
      const px = Math.floor(x + Math.cos(a) * d), pz = Math.floor(z + Math.sin(a) * d);
      const top = topAt(px, pz);
      for (let yy = top; yy >= Math.max(0, top - 6); yy--) if (ignite(px, yy, pz) && Math.random() < 0.5) break;
    }
  }
  // people
  for (const u of units) {
    if (!u.alive || u.held) continue;
    const d = Math.hypot(u.x - x, (u.y + 0.7 - y) * 0.8, u.z - z);
    if (d < r + 1) killUnit(u, opts.cause || 'blast');
    else if (d < r * 2.6 + 2) {
      const dx = u.x - x, dz = u.z - z, l = Math.hypot(dx, dz) || 1;
      const p = (r * 2.6 + 2 - d) * 2.2;
      u.flying = true; u.vx = dx / l * p; u.vz = dz / l * p; u.vy = rand(5, 9) + p * 0.4;
      if (opts.fire && Math.random() < 0.5) u.onFire = 4;
    }
  }
  ring(x, y + 0.6, z, r * 3.2);
  flash(x, y + 3, z, opts.fire ? 0xff8040 : 0xfff0d0, r * 900);
  fx.shake = Math.min(2.2, fx.shake + r * 0.18);
}

export function splash(x, z, n = 40) {
  sfx('splash', x, z, n / 60);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(1, 6);
    dustPool.spawn(x, WATER_Y, z, Math.cos(a) * s, rand(6, 14), Math.sin(a) * s, rand(0.8, 1.4), COL.water, COL.waterB, 20, 0.5, 1);
  }
  ring(x, WATER_Y + 0.05, z, 7);
}

export function puff(x, y, z, kind = 'blood') {
  const [a, b] = kind === 'blood' ? [COL.blood, COL.bloodB] : [COL.smokeA, COL.smokeB];
  for (let i = 0; i < 14; i++) {
    dustPool.spawn(x, y, z, rand(-2, 2), rand(1, 4), rand(-2, 2), rand(0.5, 1), a, b, 9, 1, 1);
  }
}

export function sparks(x, y, z, n = 6) {
  for (let i = 0; i < n; i++) dustPool.spawn(x, y, z, rand(-2, 2), rand(1, 3), rand(-2, 2), 0.35, COL.spark, COL.fireB, 8, 1, 1);
}

export function leafBurst(x, y, z, n = 30, color = '#47923a') {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) dustPool.spawn(x + rand(-2, 2), y + rand(-1, 2), z + rand(-2, 2), rand(-1.5, 1.5), rand(0, 2), rand(-1.5, 1.5), rand(1, 2), c, c, 3, 1.5, 1);
}

// dragon fire: a jet of flame along (dx,dy,dz) from the mouth
export function flameBreath(x, y, z, dx, dy, dz, n = 14) {
  for (let i = 0; i < n; i++) {
    const sp = rand(14, 26);
    firePool.spawn(x, y, z, dx * sp + rand(-2.2, 2.2), dy * sp + rand(-2.2, 2.2), dz * sp + rand(-2.2, 2.2), rand(0.35, 0.8), COL.fireA, COL.fireB, 0, 0.9, 1);
  }
  if (Math.random() < 0.5) smokePool.spawn(x + dx * 8, y + dy * 8, z + dz * 8, rand(-1, 1), rand(0.5, 2), rand(-1, 1), rand(1.5, 2.5), COL.smokeA, COL.smokeB, -0.3, 0.5, 0.4);
}

// helpers used by disasters.js
export function smokeColumn(x, y, z, n = 6) {
  for (let i = 0; i < n; i++) smokePool.spawn(x + rand(-1.5, 1.5), y, z + rand(-1.5, 1.5), rand(-1, 1), rand(3, 7), rand(-1, 1), rand(2.5, 4.5), COL.smokeA, COL.smokeB, -0.3, 0.3, 0.55);
}
export function lavaSpray(x, y, z, n = 10, up = 6) {
  for (let i = 0; i < n; i++) firePool.spawn(x + rand(-0.4, 0.4), y, z + rand(-0.4, 0.4), rand(-3, 3), rand(up * 0.3, up), rand(-3, 3), rand(0.4, 0.9), COL.fireA, COL.fireB, 9, 0.4, 1);
}
export function swirlPuff(x, y, z, vx, vy, vz, life = 1.2) {
  dustPool.spawn(x, y, z, vx, vy, vz, life, COL.dust, COL.dustB, 0, 0.3, 0.8);
}
export function dustCloud(x, y, z, n = 10, spread = 3) {
  for (let i = 0; i < n; i++) dustPool.spawn(x + rand(-spread, spread), y, z + rand(-spread, spread), rand(-1.5, 1.5), rand(1, 4), rand(-1.5, 1.5), rand(0.8, 1.6), COL.dust, COL.dustB, 2, 1, 0.8);
}
const SICKA = new THREE.Color('#9ad24a'), SICKB = new THREE.Color('#3f5a1c');
export function sickPuff(x, y, z) {
  dustPool.spawn(x + rand(-0.3, 0.3), y, z + rand(-0.3, 0.3), rand(-0.4, 0.4), rand(0.8, 1.6), rand(-0.4, 0.4), rand(0.8, 1.3), SICKA, SICKB, -0.5, 0.6, 0.9);
}
export function glow(x, y, z, color, intensity) { flash(x, y, z, color, intensity); }
export function shockRing(x, y, z, size) { ring(x, y, z, size); }

export function arrow(x0, y0, z0, x1, y1, z1) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    dustPool.spawn(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k + Math.sin(k * Math.PI) * 0.8, z0 + (z1 - z0) * k, 0, 0, 0, 0.12 + k * 0.15, COL.spark, COL.dust, 0, 0, 0.8);
  }
}

// ---------- shockwave rings & light flashes ----------

const rings = [];
function ring(x, y, z, size) {
  let r = rings.find(r => r.t >= r.dur);
  if (!r) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    r = { m, t: 0, dur: 0.6, size };
    rings.push(r);
  }
  r.t = 0; r.size = size;
  r.m.position.set(x, y, z);
  r.m.visible = true;
}

function flash(x, y, z, color, intensity) {
  flashLight.position.set(x, y, z);
  flashLight.color.setHex(color);
  flashLight.intensity = intensity;
}

// ---------- meteors & lightning ----------

const meteors = [];
let meteorGeo, meteorMat;

export function launchMeteor(tx, ty, tz) {
  sfx('whoosh', tx, tz);
  const ang = Math.random() * Math.PI * 2;
  const from = new THREE.Vector3(tx + Math.cos(ang) * 45, ty + 85, tz + Math.sin(ang) * 45);
  const to = new THREE.Vector3(tx, ty, tz);
  const m = new THREE.Mesh(meteorGeo, meteorMat);
  m.scale.setScalar(rand(1.1, 1.6));
  m.position.copy(from);
  scene.add(m);
  meteors.push({ m, from, to, t: 0, dur: from.distanceTo(to) / 70, spin: new THREE.Vector3(rand(-4, 4), rand(-4, 4), rand(-4, 4)) });
}

function updateMeteors(dt) {
  for (let i = meteors.length - 1; i >= 0; i--) {
    const mt = meteors[i];
    mt.t += dt;
    const k = Math.min(1, mt.t / mt.dur);
    mt.m.position.lerpVectors(mt.from, mt.to, k);
    mt.m.rotation.x += mt.spin.x * dt; mt.m.rotation.y += mt.spin.y * dt;
    const p = mt.m.position;
    for (let j = 0; j < 6; j++) firePool.spawn(p.x + rand(-1, 1), p.y + rand(-1, 1), p.z + rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(0.3, 0.7), COL.fireA, COL.fireB, 0, 0, 1);
    if (Math.random() < 0.7) smokePool.spawn(p.x, p.y, p.z, rand(-0.5, 0.5), rand(0, 1), rand(-0.5, 0.5), rand(2, 3.5), COL.smokeA, COL.smokeB, -0.1, 0.4, 0.6);
    if (i === meteors.length - 1) { meteorLight.position.copy(p); meteorLight.intensity = 1500; }
    if (k >= 1) {
      scene.remove(mt.m);
      meteors.splice(i, 1);
      if (isWaterCol(p.x, p.z) && p.y <= WATER_Y + 0.5) splash(p.x, p.z, 120);
      explode(p.x, p.y, p.z, rand(5, 6.5), { fire: true, fireRadius: 10, cause: 'meteor' });
    }
  }
  if (!meteors.length) meteorLight.intensity = 0;
}

const bolts = [];
export function lightning(tx, ty, tz) {
  sfx('thunder', tx, tz);
  const pts = [];
  let x = tx + rand(-8, 8), z = tz + rand(-8, 8);
  const top = ty + 70, n = 18;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    pts.push(new THREE.Vector3(x + (tx - x) * k + (i && i < n ? rand(-1.6, 1.6) : 0), top + (ty - top) * k, z + (tz - z) * k + (i && i < n ? rand(-1.6, 1.6) : 0)));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true }));
  scene.add(line);
  bolts.push({ line, t: 0 });
  flash(tx, ty + 6, tz, 0xcfe0ff, 9000);
  explode(tx, ty, tz, 1.8, { fire: true, fireRadius: 2.5, cause: 'lightning' });
  fx.shake = Math.min(2, fx.shake + 0.5);
}

function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t += dt;
    b.line.material.opacity = Math.max(0, 1 - b.t / 0.35) * (Math.random() < 0.3 ? 0.3 : 1);
    if (b.t > 0.35) { scene.remove(b.line); b.line.geometry.dispose(); bolts.splice(i, 1); }
  }
}

// ---------- lifecycle ----------

export function initEffects(s) {
  scene = s;
  const tex = dotTexture();
  firePool = new Pool(4000, 0.7, THREE.AdditiveBlending, tex);
  smokePool = new Pool(3000, 2.2, THREE.NormalBlending, tex);
  dustPool = new Pool(3000, 0.4, THREE.NormalBlending, tex);
  initDebris();
  flashLight = new THREE.PointLight(0xffffff, 0, 0, 2);
  meteorLight = new THREE.PointLight(0xff8040, 0, 0, 2);
  scene.add(flashLight, meteorLight);
  meteorGeo = new THREE.DodecahedronGeometry(1.4, 0);
  meteorMat = new THREE.MeshLambertMaterial({ color: 0x3a2a20, emissive: 0xff5a10, emissiveIntensity: 1.2 });
}

// sim-time effects (freeze when paused)
export function updateEffects(dt) {
  updateFire(dt);
  updateDebris(dt);
  updateMeteors(dt);
}

// real-time effects (keep animating smoothly)
export function updateVisuals(dt, simDt) {
  firePool.update(simDt);
  smokePool.update(simDt);
  dustPool.update(simDt);
  updateBolts(dt);
  for (const r of rings) {
    if (!r.m.visible) continue;
    r.t += dt;
    const k = r.t / r.dur;
    if (k >= 1) { r.m.visible = false; continue; }
    r.m.scale.setScalar(1 + k * r.size);
    r.m.material.opacity = 0.7 * (1 - k);
  }
  flashLight.intensity *= Math.exp(-dt * 7);
  fx.shake *= Math.exp(-dt * 4);
}
