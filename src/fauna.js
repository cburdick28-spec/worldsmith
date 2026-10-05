// Ambient life: deer that graze and bolt from people (hunters bring home food), gulls wheeling over
// the coast, and fishing boats bobbing beside every fishing hut.
import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, WATER_Y, B, height, groundTop, structs, colOcc } from './world.js';
import { units } from './units.js';
import { civics } from './buildings.js';
import { puff } from './effects.js';

const rand = (a, b) => a + Math.random() * (b - a);
const MAX_DEER = 70, MAX_GULLS = 28;
let scene, deerBody, deerHead, deerLegs, gullWing, gullBody;
const deer = [], gulls = [], boats = new Map();
const dummy = new THREE.Object3D();
let seeded = false, spawnT = 2, huntCd = 0, scanT = 0;

export const faunaStats = { deer: 0, hunted: 0, gulls: 0, boats: 0 };

function mk(geo, color, n) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), n);
  m.count = 0; m.frustumCulled = false; m.castShadow = true;
  scene.add(m);
  return m;
}

export function initFauna(s) {
  scene = s;
  deerBody = mk(new THREE.BoxGeometry(0.95, 0.5, 0.42), '#a8743f', MAX_DEER);
  deerHead = mk(new THREE.BoxGeometry(0.34, 0.34, 0.28), '#b98450', MAX_DEER);
  deerLegs = mk(new THREE.BoxGeometry(0.7, 0.45, 0.3), '#5b3d22', MAX_DEER);
  gullBody = mk(new THREE.BoxGeometry(0.5, 0.2, 0.22), '#f4f4f0', MAX_GULLS);
  gullWing = mk(new THREE.BoxGeometry(0.14, 0.04, 1.3), '#e6e8ea', MAX_GULLS);
}

const walkable = (x, z) => {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (cx < 2 || cz < 2 || cx >= W - 2 || cz >= D - 2) return false;
  return height[cz * W + cx] >= SEA + 1 && !colOcc[cz * W + cx];
};

function spawnDeer() {
  for (let k = 0; k < 30; k++) {
    const x = rand(8, W - 8), z = rand(8, D - 8);
    if (!walkable(x, z)) continue;
    const gt = groundTop(Math.floor(x), Math.floor(z));
    if (gt > 24) continue; // no deer on the peaks
    const herd = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < herd && deer.length < MAX_DEER; i++) {
      const dx = x + rand(-3, 3), dz = z + rand(-3, 3);
      if (walkable(dx, dz)) deer.push({ x: dx, z: dz, y: groundTop(Math.floor(dx), Math.floor(dz)) + 1, face: rand(0, 6.28), t: rand(0, 3), mode: 'graze', fleeT: 0, step: Math.random() * 6 });
    }
    return;
  }
}

function spawnGull() {
  for (let k = 0; k < 40; k++) {
    const x = rand(10, W - 10), z = rand(10, D - 10);
    if (height[Math.floor(z) * W + Math.floor(x)] < SEA - 1) continue;
    // a land column with water nearby
    let wet = false;
    for (let a = 0; a < 6.28 && !wet; a += 0.8) for (let r = 4; r <= 12; r += 4) if (height[Math.floor(z + Math.sin(a) * r) * W + Math.floor(x + Math.cos(a) * r)] < SEA - 1) { wet = true; break; }
    if (!wet) continue;
    gulls.push({ cx: x, cz: z, r: rand(5, 12), a: rand(0, 6.28), sp: rand(0.35, 0.7) * (Math.random() < 0.5 ? -1 : 1), h: rand(8, 15), ph: rand(0, 6) });
    return;
  }
}

function boatMesh() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.8), new THREE.MeshLambertMaterial({ color: '#8a5a30' }));
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), new THREE.MeshLambertMaterial({ color: '#5b3d22' }));
  mast.position.set(0, 1, 0);
  const sail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.9), new THREE.MeshLambertMaterial({ color: '#f1ecdc' }));
  sail.position.set(0, 1.1, 0.1);
  hull.castShadow = sail.castShadow = true;
  g.add(hull, mast, sail);
  scene.add(g);
  return g;
}

function boatSpot(hut) {
  for (let k = 0; k < 40; k++) {
    const a = rand(0, 6.28), r = rand(4, 10);
    const x = hut.cx + Math.cos(a) * r, z = hut.cz + Math.sin(a) * r;
    if (x < 2 || z < 2 || x >= W - 2 || z >= D - 2) continue;
    if (height[Math.floor(z) * W + Math.floor(x)] < SEA - 1) return { x, z };
  }
  return null;
}

function nearestPerson(x, z, r) {
  let best = null, bd = r * r;
  for (const u of units) {
    if (!u.alive || u.held || u.flying || u.swim > 0) continue;
    const d = (u.x - x) ** 2 + (u.z - z) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

export function updateFauna(sdt, dt, time) {
  if (!scene) return;
  // --- spawning
  if (!seeded) { seeded = true; for (let k = 0; k < 120 && deer.length < 48; k++) spawnDeer(); for (let k = 0; k < 20; k++) spawnGull(); }
  spawnT -= sdt;
  if (spawnT <= 0) { spawnT = 3; if (deer.length < MAX_DEER) spawnDeer(); if (gulls.length < MAX_GULLS) spawnGull(); }
  huntCd -= sdt;
  scanT -= sdt;
  const scan = scanT <= 0;
  if (scan) scanT = 0.3;

  // --- deer (frozen while the simulation is paused)
  for (let i = deer.length - 1; i >= 0 && sdt > 0; i--) {
    const d = deer[i];
    if (scan) {
      const p = nearestPerson(d.x, d.z, 7);
      if (p) {
        d.fleeT = 2.2; d.mode = 'flee'; d.face = Math.atan2(d.z - p.z, d.x - p.x) + rand(-0.4, 0.4);
        if (huntCd <= 0 && (p.role === 'soldier' || p.role === 'villager') && Math.hypot(p.x - d.x, p.z - d.z) < 2.6 && Math.random() < 0.35) {
          // a hunter brings it down
          huntCd = 3;
          puff(d.x, d.y + 0.4, d.z, 'blood');
          if (p.nation && p.nation.alive) p.nation.food += 5;
          faunaStats.hunted++;
          deer.splice(i, 1);
          continue;
        }
      }
    }
    d.t -= sdt;
    if (d.mode === 'flee') { d.fleeT -= sdt; if (d.fleeT <= 0) { d.mode = 'graze'; d.t = rand(1, 4); } }
    else if (d.t <= 0) { d.mode = d.mode === 'graze' ? 'walk' : 'graze'; d.t = rand(2, 6); if (d.mode === 'walk') d.face += rand(-1.2, 1.2); }
    if (d.mode !== 'graze') {
      const sp = (d.mode === 'flee' ? 4.2 : 0.9) * sdt;
      const nx = d.x + Math.cos(d.face) * sp, nz = d.z + Math.sin(d.face) * sp;
      if (walkable(nx, nz) && Math.abs(groundTop(Math.floor(nx), Math.floor(nz)) + 1 - d.y) <= 1.01) {
        d.x = nx; d.z = nz; d.step += sp * 4;
        d.y += (groundTop(Math.floor(nx), Math.floor(nz)) + 1 - d.y) * Math.min(1, sdt * 12);
      } else d.face += rand(1.4, 2.6); // turn away from water, cliffs and buildings
    }
    if (!walkable(d.x, d.z)) deer.splice(i, 1); // the ground vanished under it (flood, quake...)
  }
  faunaStats.deer = deer.length;
  let n = 0;
  for (const d of deer) {
    const bob = d.mode === 'flee' ? Math.abs(Math.sin(d.step)) * 0.18 : d.mode === 'walk' ? Math.abs(Math.sin(d.step)) * 0.05 : 0;
    const dip = d.mode === 'graze' ? -0.08 : 0;
    dummy.position.set(d.x, d.y + 0.65 + bob, d.z);
    dummy.rotation.set(0, -d.face, 0);
    dummy.scale.setScalar(1); dummy.updateMatrix(); deerBody.setMatrixAt(n, dummy.matrix);
    const hx = Math.cos(d.face) * 0.6, hz = Math.sin(d.face) * 0.6;
    dummy.position.set(d.x + hx, d.y + (d.mode === 'graze' ? 0.55 : 0.98) + bob, d.z + hz);
    dummy.updateMatrix(); deerHead.setMatrixAt(n, dummy.matrix);
    dummy.position.set(d.x, d.y + 0.22 + bob * 0.4 + dip * 0, d.z);
    dummy.updateMatrix(); deerLegs.setMatrixAt(n, dummy.matrix);
    n++;
  }
  deerBody.count = deerHead.count = deerLegs.count = n;
  for (const m of [deerBody, deerHead, deerLegs]) m.instanceMatrix.needsUpdate = true;

  // --- gulls (real time, they never pause)
  n = 0;
  for (const g of gulls) {
    g.a += g.sp * dt;
    const x = g.cx + Math.cos(g.a) * g.r, z = g.cz + Math.sin(g.a) * g.r, y = SEA + g.h + Math.sin(time * 0.7 + g.ph) * 1.2;
    const yaw = -(g.a + (g.sp > 0 ? Math.PI / 2 : -Math.PI / 2));
    const flap = Math.sin(time * 7 + g.ph) * 0.55;
    dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
    gullBody.setMatrixAt(n, dummy.matrix);
    dummy.rotation.set(flap, yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    gullWing.setMatrixAt(n, dummy.matrix);
    n++;
  }
  faunaStats.gulls = n;
  gullBody.count = gullWing.count = n;
  gullBody.instanceMatrix.needsUpdate = gullWing.instanceMatrix.needsUpdate = true;

  // --- boats beside fishing huts
  for (const c of civics) {
    if (c.dead || c.type !== 'fishing') continue;
    if (!boats.has(c)) {
      const spot = boatSpot(c);
      if (!spot) { boats.set(c, null); continue; }
      boats.set(c, { mesh: boatMesh(), x: spot.x, z: spot.z, ph: rand(0, 6), yaw: rand(0, 6.28) });
    }
  }
  let nb = 0;
  for (const [c, b] of boats) {
    if (!b) { if (c.dead) boats.delete(c); continue; }
    if (c.dead) { scene.remove(b.mesh); boats.delete(c); continue; }
    nb++;
    b.mesh.position.set(b.x + Math.sin(time * 0.3 + b.ph) * 0.8, WATER_Y - 0.05 + Math.sin(time * 1.6 + b.ph) * 0.07, b.z + Math.cos(time * 0.25 + b.ph) * 0.8);
    b.mesh.rotation.set(Math.sin(time * 1.3 + b.ph) * 0.05, b.yaw + Math.sin(time * 0.2 + b.ph) * 0.3, Math.sin(time * 1.1 + b.ph) * 0.06);
  }
  faunaStats.boats = nb;
}
