// Dragons, built from boxes in code. Wild ones wake in the Age of Embers (and sometimes before),
// roost on the high peaks and burn towns in strafing runs; elven archers can bring them down.
// The god can summon one and ride it.
import * as THREE from '../vendor/three.module.js';
import { W, D, H, SEA, raycast, topAt, set, get, B } from './world.js';
import { units, damageUnit, flee } from './units.js';
import { nations, nm, game, YEAR } from './nations.js';
import { explode, flameBreath, igniteArea, sparks, smokeColumn } from './effects.js';
import { eraState } from './economy.js';
import { sfx } from './audio.js';
import { log, toast } from './ui.js';
import { input } from './powers.js';
import { rand, pick } from './noise.js';

export const dragons = [];
let scene, ridden = null, wildT = rand(8, 16);
export const isRiding = () => !!ridden;

const NAMES = ['Vharzul', 'Kaldrith', 'Ashmaw', 'Nyxor', 'Ember-of-the-North', 'Skorrath', 'Ilmarax', 'Dracul-Teth'];
const MAX_DRAGONS = 4;
const SCALE = 1.35;
const mat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
const M = { scale: mat('#7a1f1a'), belly: mat('#d6a050'), horn: mat('#e8dcc0'), eye: new THREE.MeshBasicMaterial({ color: 0xffd23a }), wing: mat('#a22d2a', { side: THREE.DoubleSide }) };

function box(w, h, l, m, x, y, z, parent) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  parent.add(b);
  return b;
}

function membrane(sign) {
  const g = new THREE.BufferGeometry();
  const v = [0, 0, 0.9, 3.6 * sign, 0.15, 0.5, 2.6 * sign, 0, -2.2, 0, 0, 0.9, 2.6 * sign, 0, -2.2, 0.3 * sign, 0, -1.7];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, M.wing);
  m.castShadow = true;
  return m;
}

function buildModel() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  box(1.5, 1.3, 2.8, M.scale, 0, 0, 0, body);
  box(1.1, 0.5, 2.4, M.belly, 0, -0.6, 0.1, body);
  box(0.8, 0.8, 1.0, M.scale, 0, 0.5, 1.8, body).rotation.x = -0.4;
  box(0.7, 0.7, 1.0, M.scale, 0, 0.95, 2.6, body).rotation.x = -0.2;
  const head = new THREE.Group();
  head.position.set(0, 1.2, 3.4);
  body.add(head);
  box(0.9, 0.75, 1.2, M.scale, 0, 0, 0, head);
  box(0.6, 0.4, 0.9, M.scale, 0, -0.1, 0.9, head);
  box(0.12, 0.12, 0.12, M.eye, 0.4, 0.2, 0.3, head); box(0.12, 0.12, 0.12, M.eye, -0.4, 0.2, 0.3, head);
  box(0.12, 0.5, 0.12, M.horn, 0.3, 0.5, -0.4, head).rotation.x = -0.5; box(0.12, 0.5, 0.12, M.horn, -0.3, 0.5, -0.4, head).rotation.x = -0.5;
  const tail = [];
  for (let k = 0; k < 6; k++) tail.push(box(1.0 - k * 0.15, 0.85 - k * 0.12, 1.4, M.scale, 0, 0, -1.9 - k * 1.3, body));
  const wings = [];
  for (const sign of [1, -1]) {
    const w = new THREE.Group();
    w.position.set(0.7 * sign, 0.65, 0.4);
    w.add(membrane(sign));
    const bone = box(3.6, 0.14, 0.2, M.scale, 1.8 * sign, 0.05, 0.6, w);
    bone.rotation.z = 0;
    body.add(w);
    wings.push(w);
  }
  root.scale.setScalar(SCALE);
  scene.add(root);
  return { root, body, head, tail, wings };
}

export function initDragons(s) {
  scene = s;
  addEventListener('keydown', e => { if (e.code === 'Escape' && ridden) dismount('You climb down from the dragon.'); });
  addEventListener('pointerup', () => { input.fire = false; });
}

export function spawnDragon(x, z, opts = {}) {
  if (dragons.filter(d => !d.dead).length >= MAX_DRAGONS) return null;
  const m = buildModel();
  // roost: the highest ground in a wide sample around the spawn point
  let rx = x, rz = z, best = -1;
  for (let i = 0; i < 300; i++) {
    const cx = Math.floor(rand(6, W - 6)), cz = Math.floor(rand(6, D - 6));
    const h = topAt(cx, cz);
    if (h > best && Math.hypot(cx - x, cz - z) < 80) { best = h; rx = cx; rz = cz; }
  }
  const d = {
    ...m, x, z, y: Math.max(topAt(x, z) + 16, SEA + 16), yaw: Math.random() * Math.PI * 2, pitch: 0, roll: 0, speed: 11,
    hp: 90, maxHp: 90, fuel: 100, state: 'cruise', t: 0, huntT: rand(2, 5), pass: 0, rest: 0, target: null, goal: null, roost: { x: rx, z: rz },
    name: pick(NAMES), kills: 0, player: false, dead: false, breathing: false, fleeT: 0, snd: 0,
  };
  dragons.push(d);
  if (!opts.silent) log(`🐉 A dragon, <b>${d.name}</b>, takes wing over the land!`);
  sfx('roar', x, z, 1.5);
  return d;
}

// ---------- riding ----------

export function rideDragon(d) {
  if (ridden) dismount();
  ridden = d;
  d.player = true;
  d.state = 'ride';
  d.speed = 13;
  const el = document.getElementById('ride');
  if (el) el.style.display = 'block';
  toast(`You are riding ${d.name}.`);
}

function dismount(msg) {
  if (!ridden) return;
  ridden.player = false;
  if (!ridden.dead) { ridden.state = 'cruise'; ridden.huntT = 3; }
  ridden = null;
  input.fire = false;
  const el = document.getElementById('ride');
  if (el) el.style.display = 'none';
  if (msg) toast(msg);
}

export function nearestDragon(x, z, r) {
  let best = null, bd = r;
  for (const d of dragons) { if (d.dead) continue; const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; best = d; } }
  return best;
}

const fwd = d => {
  const cp = Math.cos(d.pitch);
  return new THREE.Vector3(Math.sin(d.yaw) * cp, Math.sin(d.pitch), Math.cos(d.yaw) * cp);
};

export function updateRideCamera(camera) {
  const d = ridden;
  if (!d) return;
  const f = fwd(d);
  const p = new THREE.Vector3(d.x - f.x * 15, d.y + 5 - f.y * 6, d.z - f.z * 15);
  p.y = Math.max(p.y, topAt(p.x, p.z) + 2);
  camera.position.lerp(p, 0.18);
  camera.lookAt(d.x + f.x * 8, d.y + f.y * 8, d.z + f.z * 8);
  const hp = document.getElementById('ride-hp'), fu = document.getElementById('ride-fuel');
  if (hp) hp.style.width = `${Math.max(0, d.hp / d.maxHp) * 100}%`;
  if (fu) fu.style.width = `${Math.max(0, d.fuel)}%`;
}

// ---------- fire ----------

function breathe(d, dt) {
  if (d.fuel <= 0) { d.breathing = false; return; }
  d.fuel -= 26 * dt;
  d.breathing = true;
  const f = fwd(d);
  const dir = new THREE.Vector3(f.x, f.y - 0.3, f.z).normalize();
  const o = new THREE.Vector3(d.x + f.x * 5.4, d.y + 1.0 + f.y * 5.4, d.z + f.z * 5.4);
  flameBreath(o.x, o.y, o.z, dir.x, dir.y, dir.z, 12);
  if ((d.snd -= dt) <= 0) { d.snd = 1.2; sfx('roar', d.x, d.z, 1); }
  const hit = raycast(o, dir, 34);
  if (!hit) return;
  const px = hit.x + 0.5, py = hit.y + 1, pz = hit.z + 0.5;
  igniteArea(hit.x, hit.y, hit.z, 2.4, 0.3);
  if (Math.random() < dt * 8) {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.hypot(dx, dz) > 2.2) continue;
      const y = topAt(hit.x + dx, hit.z + dz);
      if (get(hit.x + dx, y, hit.z + dz) === B.GRASS && Math.random() < 0.5) set(hit.x + dx, y, hit.z + dz, B.SCORCH);
    }
    sparks(px, py, pz, 5);
  }
  for (const u of units) {
    if (!u.alive || u.held) continue;
    if (Math.hypot(u.x - px, u.z - pz) < 3 && Math.abs(u.y - py) < 4) { u.onFire = 4; damageUnit(u, 7 * dt, null, 'fire'); if (!u.alive) d.kills++; }
  }
}

// ---------- AI ----------

const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

function pickTarget(d) {
  let best = null, bd = 100;
  for (const n of nations) {
    if (!n.alive) continue;
    for (const h of n.houses) {
      const dist = Math.hypot(h.cx - d.x, h.cz - d.z);
      if (dist < bd && Math.random() < 0.7) { bd = dist; best = { x: h.cx, z: h.cz, nation: n }; }
    }
  }
  return best;
}

function steer(d, gx, gz, gy, dt, rate = 1.3) {
  const want = Math.atan2(gx - d.x, gz - d.z);
  const dy = angDiff(d.yaw, want);
  const turn = Math.max(-rate * dt, Math.min(rate * dt, dy));
  d.yaw += turn;
  d.roll += (-turn / Math.max(dt, 1e-3) * 0.35 - d.roll) * Math.min(1, dt * 4);
  const h = Math.hypot(gx - d.x, gz - d.z);
  const wp = Math.atan2(gy - d.y, Math.max(h, 1));
  d.pitch += (Math.max(-0.55, Math.min(0.45, wp)) - d.pitch) * Math.min(1, dt * 2);
}

function ai(d, dt) {
  d.breathing = false;
  d.fuel = Math.min(100, d.fuel + 9 * dt);
  const edge = d.x < 10 || d.z < 10 || d.x > W - 10 || d.z > D - 10;
  switch (d.state) {
    case 'cruise': {
      if (!d.goal || Math.hypot(d.goal.x - d.x, d.goal.z - d.z) < 8 || edge) d.goal = { x: Math.min(W - 15, Math.max(15, d.x + rand(-40, 40))), z: Math.min(D - 15, Math.max(15, d.z + rand(-40, 40))) };
      steer(d, d.goal.x, d.goal.z, topAt(d.goal.x, d.goal.z) + 18, dt);
      d.speed = 10;
      d.huntT -= dt;
      if (d.huntT <= 0) {
        if (d.pass >= 4) { d.state = 'roost'; d.pass = 0; break; }
        d.target = pickTarget(d);
        if (d.target) { d.state = 'hunt'; d.fuel = Math.max(d.fuel, 60); } else d.huntT = rand(3, 6);
      }
      break;
    }
    case 'hunt': {
      const t = d.target;
      if (!t || !t.nation.alive) { d.state = 'cruise'; d.huntT = 3; break; }
      const h = Math.hypot(t.x - d.x, t.z - d.z);
      d.speed = 12;
      steer(d, t.x, t.z, topAt(t.x, t.z) + 12, dt, 1.5);
      const diff = Math.abs(angDiff(d.yaw, Math.atan2(t.x - d.x, t.z - d.z)));
      if (h < 26 && diff < 0.5) breathe(d, dt);
      if (h < 5 || d.y < topAt(d.x, d.z) + 3.5) { d.state = 'cruise'; d.pass++; d.huntT = rand(2.5, 5); d.goal = null; }
      break;
    }
    case 'roost': {
      const r = d.roost, h = Math.hypot(r.x - d.x, r.z - d.z);
      const g = topAt(r.x, r.z) + 1;
      steer(d, r.x, r.z, h < 14 ? g + 1 : g + 14, dt);
      d.speed = h < 14 ? 6 : 11;
      if (h < 3.5 && d.y < g + 2.5) { d.state = 'rest'; d.rest = 12; d.x = r.x; d.z = r.z; d.pitch = 0; d.roll = 0; }
      break;
    }
    case 'rest':
      d.rest -= dt; d.speed = 0; d.pitch = 0; d.roll = 0;
      d.y += (topAt(d.x, d.z) + 1.6 - d.y) * Math.min(1, dt * 4);
      d.hp = Math.min(d.maxHp, d.hp + 4 * dt);
      d.fuel = Math.min(100, d.fuel + 25 * dt);
      if (d.rest <= 0) { d.state = 'cruise'; d.huntT = rand(2, 4); d.goal = null; }
      break;
  }
}

function playerControl(d, dt) {
  const k = input.keys;
  let turn = 0;
  if (k.KeyA || k.ArrowLeft) turn += 1;
  if (k.KeyD || k.ArrowRight) turn -= 1;
  d.yaw += turn * 1.5 * dt;
  d.roll += (turn * 0.7 - d.roll) * Math.min(1, dt * 5);
  let pit = 0;
  if (k.KeyW || k.ArrowDown) pit -= 1;   // push the stick forward: dive
  if (k.KeyS || k.ArrowUp) pit += 1;     // pull back: climb
  d.pitch += pit * 1.1 * dt;
  if (!pit) d.pitch *= Math.max(0, 1 - dt * 1.2);
  d.pitch = Math.max(-1.1, Math.min(1.0, d.pitch));
  const boost = k.ShiftLeft || k.ShiftRight;
  d.speed += ((boost ? 24 : 13) - d.speed) * Math.min(1, dt * 2);
  d.fuel = Math.min(100, d.fuel + (input.fire || k.Space ? 0 : 12) * dt);
  d.breathing = false;
  if ((input.fire || k.Space) && d.fuel > 0) breathe(d, dt);
}

// elven archers (and anyone standing on a roost) can hurt a dragon within their reach
function defend(d, dt) {
  for (const u of units) {
    if (!u.alive || u.role !== 'soldier' || u.held) continue;
    const reach = u.race === 'elf' ? 13 : 3.5;
    if (Math.hypot(u.x - d.x, u.z - d.z) > reach || d.y - u.y > (u.race === 'elf' ? 18 : 5)) continue;
    if (Math.random() < dt * 0.35) hurt(d, rand(2, 4), u);
  }
}

function hurt(d, dmg, by) {
  if (d.dead) return;
  d.hp -= dmg * (d.player ? 0.35 : 1);
  sparks(d.x, d.y + 1, d.z, 4);
  if (d.hp <= 0) {
    d.dead = true;
    d.state = 'dying';
    d.vy = 0;
    if (d.player) dismount(`${d.name} falls from the sky!`);
    log(`🐉 <b>${d.name}</b> is slain${by ? ` by ${by.name} of ${nm(by.nation)}` : ''} after burning ${d.kills} souls.`);
  }
}

function flapAndPose(d, time) {
  d.root.position.set(d.x, d.y + Math.sin(time * 2 + d.x) * 0.15, d.z);
  d.root.rotation.set(-d.pitch, d.yaw, d.roll, 'YXZ');
  const flap = d.state === 'rest' ? Math.sin(time * 1.2) * 0.12 + 0.55 : Math.sin(time * (d.speed > 16 ? 9 : 6) + d.x * 0.1) * 0.75 + 0.1;
  d.wings[0].rotation.z = flap; d.wings[1].rotation.z = -flap;
  d.tail.forEach((t, k) => { t.position.x = Math.sin(time * 3 - k * 0.8) * 0.12 * (k + 1); t.rotation.y = Math.sin(time * 3 - k * 0.8 + 0.8) * 0.12; });
  d.head.rotation.x = d.breathing ? -0.15 : 0.05 + Math.sin(time * 1.5) * 0.04;
}

export function updateDragons(dt, time) {
  // wild dragons wake now and then, most often in the Age of Embers
  wildT -= dt / YEAR;
  if (wildT <= 0) {
    wildT = rand(16, 30);
    if (game.year > 40 && dragons.filter(d => !d.dead).length < 2 && (eraState.era.name === 'Age of Embers' || Math.random() < 0.12)) {
      const a = Math.random() * Math.PI * 2;
      spawnDragon(W / 2 + Math.cos(a) * 70, D / 2 + Math.sin(a) * 70);
    }
  }
  for (let i = dragons.length - 1; i >= 0; i--) {
    const d = dragons[i];
    if (d.dead) {
      // a slain dragon plummets and crashes
      d.vy = (d.vy || 0) - 30 * dt;
      d.y += d.vy * dt; d.pitch = Math.min(1.1, d.pitch + dt * 1.5); d.roll += dt * 3;
      d.x += Math.sin(d.yaw) * 4 * dt; d.z += Math.cos(d.yaw) * 4 * dt;
      smokeColumn(d.x, d.y, d.z, 1);
      if (d.y <= topAt(d.x, d.z) + 1.5) {
        explode(d.x, d.y, d.z, 3.6, { fire: true, fireRadius: 6, cause: 'blast' });
        scene.remove(d.root);
        dragons.splice(i, 1);
        continue;
      }
      flapAndPose(d, time);
      continue;
    }
    d.t += dt;
    if (d.player) playerControl(d, dt); else ai(d, dt);
    // the people scatter from the shadow of wings
    d.fleeT -= dt;
    if (d.fleeT <= 0) {
      d.fleeT = 0.6;
      for (const u of units) if (u.alive && !u.held && !u.flying && u.state !== 'flee' && u.role !== 'soldier' && Math.hypot(u.x - d.x, u.z - d.z) < 14 && Math.random() < 0.6) flee(u, d.x, d.z);
    }
    defend(d, dt);
    if (d.dead) continue;
    // move
    const f = fwd(d);
    d.x += f.x * d.speed * dt; d.y += f.y * d.speed * dt; d.z += f.z * d.speed * dt;
    d.x = Math.min(W - 2, Math.max(2, d.x)); d.z = Math.min(D - 2, Math.max(2, d.z));
    const floor = topAt(d.x, d.z) + 2.2;
    if (d.state !== 'rest' && d.y < floor) { d.y = floor; if (d.pitch < 0) d.pitch *= 0.5; }
    d.y = Math.min(H + 40, d.y);
    flapAndPose(d, time);
  }
}
