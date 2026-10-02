// God powers: the hand of god, meteors, lightning, fire, terraforming, spawning and possession.
import * as THREE from '../vendor/three.module.js';
import { W, D, H, SEA, WATER_Y, B, BLOCK, raycast, get, set, solid, topAt, owner, idx, structs, removeStruct, colOcc, isWaterCol } from './world.js';
import { units, pickUnit, setState, standY, groundUnder, damageUnit, spawnUnit } from './units.js';
import { nations, createNation, detachHouse, nm } from './nations.js';
import { explode, launchMeteor, lightning, igniteArea, spawnDebris, splash, sparks, debrisRoom, leafBurst } from './effects.js';
import * as ui from './ui.js';
import { rand } from './noise.js';

export const TOOLS = [
  { id: 'inspect', key: '`', icon: '🔍', name: 'Inspect', hint: 'Click a person or building to learn about them.' },
  { id: 'grab', key: '1', icon: '✋', name: 'Hand of God', hint: 'Drag to rip up houses, trees, people or earth. Let go while moving to throw.' },
  { id: 'meteor', key: '2', icon: '☄️', name: 'Meteor', hint: 'Call down a burning star. Hold to keep them falling.', rate: 0.45 },
  { id: 'lightning', key: '3', icon: '⚡', name: 'Lightning', hint: 'Strike the ground with lightning. Hold for a storm.', rate: 0.22 },
  { id: 'fire', key: '4', icon: '🔥', name: 'Wildfire', hint: 'Set things ablaze. Wood, leaves and thatch burn; stone and marble do not.', rate: 0.1 },
  { id: 'raise', key: '5', icon: '⛰️', name: 'Raise Land', hint: 'Hold to lift the earth.', rate: 0.07 },
  { id: 'lower', key: '6', icon: '🕳️', name: 'Lower Land', hint: 'Hold to dig the earth away.', rate: 0.07 },
  { id: 'human', key: '7', icon: '🛡️', name: 'Humans', hint: 'Place humans. Far from their kingdom, or once it has fallen, they found a new one.' },
  { id: 'goblin', key: '8', icon: '👺', name: 'Goblins', hint: 'Place goblins. Far from their horde, or once it has fallen, they found a new one.' },
  { id: 'elf', key: '9', icon: '🌿', name: 'Elves', hint: 'Place elves. Far from their realm, or once it has fallen, they found a new one.' },
  { id: 'possess', key: '0', icon: '👁️', name: 'Possess', hint: 'Click a person to walk in their body. WASD move, mouse look, Space jump, click strike, right-click build, Esc leave.' },
];
const KEYMAP = { Backquote: 'inspect', Digit1: 'grab', Digit2: 'meteor', Digit3: 'lightning', Digit4: 'fire', Digit5: 'raise', Digit6: 'lower', Digit7: 'human', Digit8: 'goblin', Digit9: 'elf', Digit0: 'possess' };

export const input = { keys: {}, speed: 1, lastSpeed: 1 };
let tool = TOOLS[1];
let camera, godCam, canvas, scene;
const ndc = new THREE.Vector2();
const caster = new THREE.Raycaster();
let mx = 0, my = 0, lastX = 0, lastY = 0;
let leftDown = false, rightDown = false, midDown = false;
let repeatT = 0;
const hover = { hit: null, unit: null, point: null, struct: null };
let held = null;
const projectiles = [];
let poss = null;
let selected = null;
let ringMesh, boxMesh, heldMat, cubeGeo;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let lastGroundY = SEA + 2;

export const isPossessing = () => !!poss;

export function setTool(id) {
  const t = TOOLS.find(t => t.id === id);
  if (!t) return;
  tool = t;
  ui.setToolUI(t);
}

export function setSpeed(s) {
  if (s > 0) input.lastSpeed = s;
  input.speed = s;
  ui.setSpeedUI(s);
}

// ---------- hover / picking ----------

function updateHover() {
  caster.setFromCamera(ndc, camera);
  const o = caster.ray.origin, d = caster.ray.direction;
  const hit = raycast(o, d);
  hover.hit = hit;
  hover.unit = held ? null : pickUnit(o, d, hit ? hit.t + 1 : Infinity);
  hover.struct = null;
  hover.point = null;
  if (hit) {
    hover.point = new THREE.Vector3(hit.x + 0.5, hit.y + 1, hit.z + 0.5);
    const s = structs[owner[idx(hit.x, hit.y, hit.z)]];
    if (s && !s.dead) hover.struct = s;
  }
  if (d.y < 0) {
    const tw = (WATER_Y - o.y) / d.y;
    if (tw > 0 && (!hit || tw < hit.t)) {
      const wx = o.x + d.x * tw, wz = o.z + d.z * tw;
      if (wx >= 0 && wz >= 0 && wx < W && wz < D) hover.point = new THREE.Vector3(wx, WATER_Y, wz);
    }
  }
  if (hover.point) lastGroundY = hover.point.y;
}

// cursor position at ground level, even off the edge of the world
function cursorGround() {
  if (hover.point) return hover.point;
  caster.setFromCamera(ndc, camera);
  const o = caster.ray.origin, d = caster.ray.direction;
  if (Math.abs(d.y) < 1e-4) return null;
  const t = (lastGroundY - o.y) / d.y;
  return t > 0 ? new THREE.Vector3(o.x + d.x * t, lastGroundY, o.z + d.z * t) : null;
}

function structBox(s) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k < s.placed; k++) {
    const [x, y, z] = s.plan[k];
    if (owner[idx(x, y, z)] !== s.id) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
    x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); z1 = Math.max(z1, z + 1);
  }
  return x0 === Infinity ? null : [x0, y0, z0, x1, y1, z1];
}

const RING = { meteor: 6, lightning: 2, fire: 2.2, raise: 2.6, lower: 2.6, human: 1.6, goblin: 1.6, elf: 1.6 };

function updateIndicators() {
  ringMesh.visible = false;
  boxMesh.visible = false;
  if (poss || held) return;
  const r = RING[tool.id];
  if (r && hover.point) {
    ringMesh.visible = true;
    ringMesh.position.set(hover.point.x, hover.point.y + 0.06, hover.point.z);
    ringMesh.scale.setScalar(r);
  }
  if ((tool.id === 'grab' || tool.id === 'inspect') && !hover.unit && hover.hit) {
    let b = hover.struct ? structBox(hover.struct) : null;
    if (!b) {
      const { x, y, z } = hover.hit;
      const g = tool.id === 'grab' ? 2 : 0;
      b = [x - g, y - g, z - g, x + 1 + g, y + 1 + g, z + 1 + g];
    }
    boxMesh.visible = true;
    boxMesh.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    boxMesh.scale.set(b[3] - b[0] + 0.04, b[4] - b[1] + 0.04, b[5] - b[2] + 0.04);
  }
}

function houseHTML(s) {
  const pct = Math.round(s.alive / Math.max(1, s.built ? s.total : s.placed) * 100);
  const who = s.nation ? nm(s.nation) : 'no one';
  return `<b>${s.capital ? 'Capital house' : 'House'}</b> of ${who}<br>${s.built ? `${pct}% intact` : `under construction · ${Math.round(s.placed / s.plan.length * 100)}%`}`;
}

function updateTooltip() {
  if (poss || held) { ui.hideTip(); return; }
  if (hover.unit) ui.showTip(mx, my, ui.unitHTML(hover.unit));
  else if (hover.struct && hover.struct.kind === 'house' && (tool.id === 'inspect' || tool.id === 'grab')) ui.showTip(mx, my, houseHTML(hover.struct));
  else ui.hideTip();
}

// ---------- tools ----------

function primary(start) {
  const h = hover;
  switch (tool.id) {
    case 'inspect':
      if (!start) return;
      if (h.unit) selected = h.unit;
      else { selected = null; ui.inspect(h.struct && h.struct.kind === 'house' ? houseHTML(h.struct) : ''); }
      break;
    case 'grab':
      if (start) beginGrab();
      break;
    case 'meteor':
      if (h.point) launchMeteor(h.point.x + (start ? 0 : rand(-4, 4)), h.point.y, h.point.z + (start ? 0 : rand(-4, 4)));
      break;
    case 'lightning':
      if (h.point) lightning(h.point.x + (start ? 0 : rand(-3, 3)), h.point.y, h.point.z + (start ? 0 : rand(-3, 3)));
      break;
    case 'fire':
      if (h.hit) {
        igniteArea(h.hit.x, h.hit.y, h.hit.z, 2.2, 0.45);
        sparks(h.point.x, h.point.y, h.point.z, 10);
        for (const u of units) if (u.alive && Math.hypot(u.x - h.point.x, u.z - h.point.z) < 1.8) u.onFire = 4;
      }
      break;
    case 'raise': brush(1); break;
    case 'lower': brush(-1); break;
    case 'human': case 'goblin': case 'elf':
      if (start) spawnPeople(tool.id);
      break;
    case 'possess':
      if (!start) return;
      if (h.unit) enterPossess(h.unit);
      else ui.toast('Click on a person to possess them.');
      break;
  }
}

function brush(sign) {
  const h = hover.hit;
  if (!h) return;
  const r = 2.6;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.hypot(dx, dz);
    if (d > r || Math.random() > 1 - d / (r + 0.6)) continue;
    const x = h.x + dx, z = h.z + dz;
    if (x < 1 || z < 1 || x >= W - 1 || z >= D - 1) continue;
    const top = topAt(x, z);
    if (sign > 0) {
      const o = colOcc[z * W + x];
      if (o && !structs[o].dead) continue;
      if (top >= H - 6) continue;
      const ny = top + 1;
      const nt = ny > 29 ? B.STONE : ny <= SEA + 1 ? B.SAND : B.GRASS;
      if (get(x, top, z) === B.GRASS) set(x, top, z, B.DIRT);
      set(x, ny, z, nt);
    } else {
      if (top <= 1) continue;
      set(x, top, z, B.AIR);
      if (get(x, top - 1, z) === B.DIRT && top - 1 > SEA) set(x, top - 1, z, B.GRASS);
    }
  }
  if (Math.random() < 0.5) leafBurst(h.x + 0.5, h.y + 1, h.z + 0.5, 6, sign > 0 ? '#9a8060' : '#6a5038');
}

function spawnPeople(race) {
  const h = hover.hit;
  if (!h) return;
  if (h.y < SEA) { ui.toast('They cannot live beneath the sea.'); return; }
  const alive = nations.filter(m => m.alive);
  let n = null, bd = Infinity;
  for (const m of alive) {
    if (m.race !== race) continue;
    const d = Math.hypot(m.capital.x - h.x, m.capital.z - h.z);
    if (d < bd) { bd = d; n = m; }
  }
  if (!n || (bd > 60 && alive.length < 8)) {
    n = createNation(race, h.x, h.z);
    ui.log(`✨ ${nm(n)} is founded by divine will.`);
    return;
  }
  for (let i = 0; i < 4; i++) spawnUnit(n, h.x + 0.5 + rand(-1.5, 1.5), h.z + 0.5 + rand(-1.5, 1.5), { y: h.y + 3 });
  sparks(h.x + 0.5, h.y + 1.5, h.z + 0.5, 20);
}

// ---------- hand of god ----------

function scoop(cx, cy, cz, r) {
  const out = [];
  const R = Math.ceil(r);
  for (let y = cy - R; y <= cy + R; y++) for (let z = cz - R; z <= cz + R; z++) for (let x = cx - R; x <= cx + R; x++) {
    if (y < 1 || Math.hypot(x - cx, y - cy, z - cz) > r) continue;
    const t = get(x, y, z);
    if (!t) continue;
    out.push([x, y, z, t]);
    set(x, y, z, B.AIR);
  }
  return out;
}

function beginGrab() {
  if (hover.unit) {
    const u = hover.unit;
    u.held = true;
    u.flying = false;
    setState(u, 'idle');
    held = { kind: 'unit', u, pos: new THREE.Vector3(u.x, u.y + 1, u.z), vel: new THREE.Vector3(), lift: 6 };
    return;
  }
  const hit = hover.hit;
  if (!hit) return;
  const s = hover.struct;
  let voxels;
  if (s) {
    voxels = removeStruct(s);
    if (s.kind === 'house') {
      detachHouse(s);
      if (s.nation && s.nation.alive) ui.log(`✋ The hand of god tears a house from ${nm(s.nation)}.`);
    }
  } else voxels = scoop(hit.x, hit.y, hit.z, 2.2);
  if (!voxels.length) return;

  const c = new THREE.Vector3();
  for (const [x, y, z] of voxels) c.x += x + 0.5, c.y += y + 0.5, c.z += z + 0.5;
  c.divideScalar(voxels.length);
  const mesh = new THREE.InstancedMesh(cubeGeo, heldMat, voxels.length);
  mesh.castShadow = true;
  const offs = [], types = [];
  const m = new THREE.Matrix4();
  voxels.forEach(([x, y, z, t], i) => {
    const o = new THREE.Vector3(x + 0.5 - c.x, y + 0.5 - c.y, z + 0.5 - c.z);
    offs.push(o); types.push(t);
    mesh.setMatrixAt(i, m.makeTranslation(o.x, o.y, o.z));
    mesh.setColorAt(i, BLOCK[t].top);
  });
  mesh.position.copy(c);
  scene.add(mesh);
  held = { kind: 'voxels', mesh, offs, types, pos: c.clone(), vel: new THREE.Vector3(), lift: 9 + Math.min(6, Math.sqrt(voxels.length) * 0.3) };
}

function updateHeld(dt, time) {
  if (!held) return;
  const p = cursorGround();
  const prev = tmp2.copy(held.pos);
  if (p) {
    tmp.set(p.x, p.y + held.lift, p.z);
    held.pos.lerp(tmp, 1 - Math.exp(-dt * 14));
  }
  tmp.copy(held.pos).sub(prev).divideScalar(Math.max(dt, 1e-3));
  held.vel.lerp(tmp, 0.25);
  if (held.kind === 'unit') {
    const u = held.u;
    if (!u.alive) { held = null; return; }
    u.x = Math.min(W - 1.5, Math.max(1.5, held.pos.x));
    u.z = Math.min(D - 1.5, Math.max(1.5, held.pos.z));
    u.y = held.pos.y - 1;
    u.spin = Math.sin(time * 3) * 0.3;
  } else {
    held.mesh.position.copy(held.pos);
    held.mesh.rotation.set(
      Math.sin(time * 2.1) * 0.05 + held.vel.z * 0.01,
      held.mesh.rotation.y,
      Math.sin(time * 1.7) * 0.05 - held.vel.x * 0.01,
    );
  }
}

function release() {
  if (!held) return;
  const v = held.vel.clone().multiplyScalar(0.9).clampLength(0, 70);
  if (held.kind === 'unit') {
    const u = held.u;
    u.held = false;
    u.spin = 0;
    if (u.alive) { u.flying = true; u.vx = v.x; u.vy = v.y + 2; u.vz = v.z; }
  } else {
    const sp = v.length();
    projectiles.push({
      mesh: held.mesh, offs: held.offs, types: held.types, pos: held.pos.clone(), vel: v,
      q: held.mesh.quaternion.clone(),
      av: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.6 + sp * 0.05),
    });
  }
  held = null;
}

const euler = new THREE.Euler(), dq = new THREE.Quaternion();

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.vel.y -= 28 * dt;
    pr.pos.addScaledVector(pr.vel, dt);
    euler.set(pr.av.x * dt, pr.av.y * dt, pr.av.z * dt);
    pr.q.multiply(dq.setFromEuler(euler));
    pr.mesh.position.copy(pr.pos);
    pr.mesh.quaternion.copy(pr.q);
    if (pr.pos.y < -30) { scene.remove(pr.mesh); pr.mesh.dispose(); projectiles.splice(i, 1); continue; }
    let hitP = null, wet = false;
    const step = Math.max(1, Math.floor(pr.offs.length / 160));
    for (let k = 0; k < pr.offs.length; k += step) {
      tmp.copy(pr.offs[k]).applyQuaternion(pr.q).add(pr.pos);
      const x = Math.floor(tmp.x), y = Math.floor(tmp.y), z = Math.floor(tmp.z);
      if (x < 0 || z < 0 || x >= W || z >= D) continue;
      if (tmp.y < 0.5) { hitP = tmp.clone(); break; }
      if (tmp.y < WATER_Y && isWaterCol(x, z)) { hitP = tmp.clone(); wet = true; break; }
      if (solid(x, y, z)) { hitP = tmp.clone(); break; }
    }
    if (hitP) { impact(pr, hitP, wet); projectiles.splice(i, 1); }
  }
}

function impact(pr, p, wet) {
  scene.remove(pr.mesh);
  pr.mesh.dispose();
  const sp = pr.vel.length(), n = pr.offs.length;
  if (wet) splash(p.x, p.z, 90);
  else explode(p.x, p.y, p.z, Math.min(6.5, Math.max(1.5, 1 + sp * 0.06 + Math.sqrt(n) * 0.14)), { cause: 'blast', settle: 0.35 });
  let room = debrisRoom();
  for (let k = 0; k < n; k++) {
    tmp.copy(pr.offs[k]).applyQuaternion(pr.q).add(pr.pos);
    const t = pr.types[k];
    if (room-- > 0) {
      const s = wet ? 0.2 : 0.25;
      spawnDebris(tmp.x, tmp.y, tmp.z, pr.vel.x * s + rand(-5, 5), wet ? rand(-1, 1) : rand(4, 11), pr.vel.z * s + rand(-5, 5), t, wet ? 0.8 : 0.55);
    } else {
      const cx = Math.floor(tmp.x), cz = Math.floor(tmp.z), g = topAt(cx, cz) + 1;
      if (g > 0 && g < H - 1) set(cx, g, cz, t);
    }
  }
}

// ---------- possession ----------

function enterPossess(u) {
  poss = { u, yaw: u.face, pitch: -0.1, bob: 0 };
  u.possessed = true;
  u.held = false;
  setState(u, 'idle');
  selected = null;
  ui.inspect('');
  ui.hideTip();
  ui.showPossess(u);
  canvas.requestPointerLock?.();
}

function exitPossess(msg) {
  if (!poss) return;
  const u = poss.u;
  u.possessed = false;
  u.think = 0.5;
  godCam.focus(u.x, u.z);
  poss = null;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hidePossess();
  if (msg) ui.toast(msg);
}

function tryMove(u, nx, nz) {
  const g = standY(u, nx, nz);
  if (g === null) return;
  u.x = nx; u.z = nz;
  if (g > u.y) u.y = g;
}

function updatePossess(dt) {
  const u = poss.u;
  if (!u.alive) { exitPossess('Your vessel has perished.'); return; }
  const k = input.keys;
  if (!u.held && !u.flying) {
    let f = 0, s = 0;
    if (k.KeyW || k.ArrowUp) f += 1;
    if (k.KeyS || k.ArrowDown) f -= 1;
    if (k.KeyA || k.ArrowLeft) s -= 1;
    if (k.KeyD || k.ArrowRight) s += 1;
    if (f || s) {
      const l = Math.hypot(f, s);
      const sp = u.st.speed * 2.4 * (k.ShiftLeft || k.ShiftRight ? 1.7 : 1) * dt;
      const c = Math.cos(poss.yaw), sn = Math.sin(poss.yaw);
      const dx = (c * f - sn * s) / l * sp, dz = (sn * f + c * s) / l * sp;
      tryMove(u, u.x + dx, u.z);
      tryMove(u, u.x, u.z + dz);
      u.moving = true;
      u.walk += dt * 8;
      poss.bob += dt * 11;
    }
    const grounded = Math.abs(u.y - groundUnder(u.x, u.y + 0.01, u.z)) < 0.02 && u.vy === 0;
    if (k.Space && grounded) u.vy = 9.5;
    u.face = poss.yaw;
  }
  const eye = u.y + 1.32 * u.st.scale + (u.moving ? Math.sin(poss.bob) * 0.06 : 0);
  camera.position.set(u.x, eye, u.z);
  const cp = Math.cos(poss.pitch);
  camera.lookAt(u.x + Math.cos(poss.yaw) * cp, eye + Math.sin(poss.pitch), u.z + Math.sin(poss.yaw) * cp);
  ui.updatePossess(u);
}

function possAttack() {
  const u = poss.u;
  if (u.cd > 0) return;
  u.cd = 0.35;
  u.swing = 1;
  const c = Math.cos(poss.yaw), s = Math.sin(poss.yaw);
  let best = null, bd = 2.6;
  for (const t of units) {
    if (!t.alive || t === u || t.held) continue;
    const dx = t.x - u.x, dz = t.z - u.z, d = Math.hypot(dx, dz);
    if (d > bd || Math.abs(t.y - u.y) > 2) continue;
    if ((dx * c + dz * s) / (d || 1) < 0.5) continue;
    best = t; bd = d;
  }
  if (best) {
    damageUnit(best, rand(4, 7), u, 'battle');
    if (best.alive && !best.held) { best.flying = true; best.vx = c * 5; best.vz = s * 5; best.vy = 4; }
    return;
  }
  camera.getWorldDirection(tmp);
  const hit = raycast(camera.position, tmp, 4.5);
  if (hit && hit.y > 0) {
    const t = get(hit.x, hit.y, hit.z);
    set(hit.x, hit.y, hit.z, B.AIR);
    sparks(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 6);
    spawnDebris(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, rand(-1, 1), 3, rand(-1, 1), t, 0);
  }
}

function possPlace() {
  const u = poss.u;
  camera.getWorldDirection(tmp);
  const hit = raycast(camera.position, tmp, 5);
  if (!hit) return;
  const x = hit.x + hit.fx, y = hit.y + hit.fy, z = hit.z + hit.fz;
  if (x === Math.floor(u.x) && z === Math.floor(u.z) && (y === Math.floor(u.y) || y === Math.floor(u.y) + 1)) return;
  const wall = u.race === 'human' ? B.PLANK : u.race === 'goblin' ? B.MUD : B.MARBLE;
  set(x, y, z, wall);
}

// ---------- events ----------

export function initPowers(opts) {
  ({ camera, godCam, canvas, scene } = opts);
  cubeGeo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
  heldMat = new THREE.MeshLambertMaterial();
  ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.renderOrder = 5;
  boxMesh = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  scene.add(ringMesh, boxMesh);

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (poss) {
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) possAttack(); else if (e.button === 2) possPlace();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX; lastY = e.clientY;
    if (e.button === 0) {
      if (e.shiftKey) { midDown = true; return; }
      leftDown = true;
      updateHover();
      primary(true);
      repeatT = tool.rate || 0;
    } else if (e.button === 2) rightDown = true;
    else if (e.button === 1) { midDown = true; e.preventDefault(); }
  });
  canvas.addEventListener('pointermove', e => {
    if (poss) {
      if (document.pointerLockElement === canvas) {
        poss.yaw += e.movementX * 0.0025;
        poss.pitch = Math.max(-1.45, Math.min(1.45, poss.pitch - e.movementY * 0.0025));
      }
      return;
    }
    mx = e.clientX; my = e.clientY;
    const r = canvas.getBoundingClientRect();
    ndc.set((mx - r.left) / r.width * 2 - 1, -((my - r.top) / r.height) * 2 + 1);
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (rightDown) godCam.rotate(dx, dy);
    if (midDown) godCam.pan(dx, dy);
  });
  const up = e => {
    if (e.button === 0) { leftDown = false; midDown = false; release(); }
    else if (e.button === 2) rightDown = false;
    else if (e.button === 1) midDown = false;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { leftDown = rightDown = midDown = false; release(); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (!poss) godCam.zoom(e.deltaY); }, { passive: false });
  window.addEventListener('blur', () => { input.keys = {}; leftDown = rightDown = midDown = false; release(); });
  document.addEventListener('pointerlockchange', () => {
    if (poss && document.pointerLockElement !== canvas && poss.locked) exitPossess();
    if (poss && document.pointerLockElement === canvas) poss.locked = true;
  });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    input.keys[e.code] = true;
    if (e.code === 'Escape' && poss) { exitPossess(); return; }
    if (poss) { if (e.code === 'Space') e.preventDefault(); return; }
    if (KEYMAP[e.code]) setTool(KEYMAP[e.code]);
    if (e.code === 'Space') { e.preventDefault(); setSpeed(input.speed ? 0 : input.lastSpeed); }
    if (e.code === 'KeyF' && selected && selected.alive) godCam.focus(selected.x, selected.z);
  });
  window.addEventListener('keyup', e => { input.keys[e.code] = false; });
  setTool('grab');
  setSpeed(1);
}

export function updatePowers(dt, simDt, time) {
  if (poss) updatePossess(dt);
  else {
    updateHover();
    if (leftDown && tool.rate) {
      repeatT -= dt;
      if (repeatT <= 0) { repeatT = tool.rate; primary(false); }
    }
  }
  updateHeld(dt, time);
  updateProjectiles(simDt);
  updateIndicators();
  updateTooltip();
  if (selected) {
    if (selected.alive) ui.inspect(ui.unitHTML(selected) + '<br><span class="dim">F to focus</span>');
    else { ui.inspect(`<b>${selected.name}</b> is no more.`); selected = null; }
  }
}
