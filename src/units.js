// People: humans, goblins and elves. AI, movement, combat and rendering.
import * as THREE from '../vendor/three.module.js';
import { W, D, H, SEA, WATER_Y, groundTop, solid, set, get, owner, idx, inB, structs, B, BLOCK, isWaterCol, height } from './world.js';
import { onUnitDeath, chopTree, placeNext, nations, game, arriveCaravan, abortCaravan, caravanLost, raiderDown } from './nations.js';
import { trample, onRoadXZ, onRoadCol, ROAD_COST, ROAD_SPEED } from './roads.js';
import { puff, sparks, arrow, spawnDebris, ignite, splash } from './effects.js';
import { nearInn, visitInns } from './infra.js';
import { sfx } from './audio.js';
import { rand } from './noise.js';

export const units = [];
export const MAXU = 2400;
let nextId = 1;
export const setNextUnitId = n => { nextId = n; };
export const getNextUnitId = () => nextId;

export const RSTAT = {
  human: { skin: '#e9b98c', speed: 1.7, hp: 12, dmg: [2, 4], scale: 1.0, life: [56, 82], range: 1.3, legs: '#4a3a2a', weapon: '#cfd3da' },
  goblin: { skin: '#7fae3a', speed: 2.05, hp: 9, dmg: [1.5, 4], scale: 0.8, life: [34, 52], range: 1.2, legs: '#3b3424', weapon: '#8a8f96' },
  elf: { skin: '#f3dfc8', speed: 1.85, hp: 10, dmg: [2, 4], scale: 1.12, life: [150, 240], range: 1.3, bow: 7, legs: '#3a4a3a', weapon: '#8a5a30' },
};
for (const k in RSTAT) for (const c of ['skin', 'legs', 'weapon']) RSTAT[k][c + 'C'] = new THREE.Color(RSTAT[k][c]);

const dist = (u, x, z) => Math.hypot(x - u.x, z - u.z);

export function groundUnder(x, fromY, z) {
  const cx = Math.floor(x), cz = Math.floor(z);
  for (let y = Math.min(H - 1, Math.floor(fromY)); y >= 0; y--) if (solid(cx, y, cz)) return y + 1;
  return 0;
}

// Water columns are swimmable: the surface (SEA) acts as the floor there.
const colIsWater = (cx, cz) => height[cz * W + cx] < SEA;
const canSwim = u => u.role !== 'caravan' || u.y <= SEA + 0.01; // caravans keep to bridges unless already in the water
function waterStand(u, cx, cz) {
  if (!canSwim(u)) return null;
  if (solid(cx, SEA, cz) || solid(cx, SEA + 1, cz)) return null;
  if (!u.possessed && u.y > SEA + 3.01) return null; // no jumping off cliffs on purpose
  return SEA;
}

// Where a unit would stand if it stepped to (nx, nz), or null if it can't go there.
export function standY(u, nx, nz) {
  const cx = Math.floor(nx), cz = Math.floor(nz);
  if (cx < 1 || cz < 1 || cx >= W - 1 || cz >= D - 1) return null;
  if (colIsWater(cx, cz)) return waterStand(u, cx, cz);
  if (cx === Math.floor(u.x) && cz === Math.floor(u.z)) return groundUnder(nx, u.y + 0.05, nz);
  let y = Math.min(H - 1, Math.floor(u.y + 0.05));
  while (y >= 0 && !solid(cx, y, cz)) y--;
  const g = y + 1;
  if (solid(cx, g, cz) || solid(cx, g + 1, cz)) return null;
  if (!u.possessed && g < u.y - 3) return null;
  return g;
}

export function spawnUnit(n, x, z, opts = {}) {
  const st = RSTAT[n.race];
  const age = opts.age ?? Math.floor(rand(16, 30));
  let maxAge = Math.floor(rand(st.life[0], st.life[1]));
  if (maxAge <= age + 3) maxAge = age + Math.floor(rand(5, 20));
  const u = {
    id: nextId++, nation: n, race: n.race, st, name: n.genName(), role: opts.role || 'villager',
    age, maxAge, hp: st.hp, maxHp: st.hp,
    x, y: groundUnder(x, opts.y ?? H - 1, z), z, vx: 0, vy: 0, vz: 0, face: Math.random() * Math.PI * 2, side: 1,
    walk: 0, moving: false, state: 'idle', think: Math.random() * 2, timer: 0, target: null, task: null, tx: x, tz: z,
    cd: 0, swing: 0, stuck: 0, path: null, pi: 0, pgx: 0, pgz: 0, pathCd: 0, partial: false, repath: false, fails: 0, held: false, flying: false, swim: 0, spin: 0, possessed: false, onFire: 0, alive: true, kills: 0,
    born: performance.now(),
  };
  units.push(u);
  n.units.add(u);
  return u;
}

function releaseTask(u) {
  const t = u.task;
  if (t) {
    if (t.builders) t.builders.delete(u);
    if (t.claimedBy === u) t.claimedBy = null;
  }
  u.task = null;
}

export function setState(u, state, task = null) {
  releaseTask(u);
  u.state = state;
  u.task = task;
  u.timer = 0;
  u.stuck = 0;
  u.path = null;
  u.fails = 0;
}

export function damageUnit(u, dmg, by, cause) {
  if (!u.alive) return;
  u.hp -= dmg;
  if (by) { puff(u.x, u.y + 0.9, u.z, 'blood'); sfx('clash', u.x, u.z); }
  if (u.hp <= 0) { killUnit(u, cause || 'battle', by); return; }
  if (by && by.alive && !u.possessed && u.role !== 'caravan' && u.state !== 'fight' && by.nation !== u.nation) {
    if (u.role === 'villager' && by.role === 'soldier' && Math.random() < 0.5) flee(u, by.x, by.z);
    else { setState(u, 'fight'); u.target = by; }
  }
}

export function killUnit(u, cause, by) {
  if (!u.alive) return;
  u.alive = false;
  releaseTask(u);
  u.nation.units.delete(u);
  if (by) by.kills++;
  puff(u.x, u.y + 0.8, u.z, cause === 'age' ? 'smoke' : 'blood');
  if (u.role === 'caravan') caravanLost(u, cause, by);
  if (u.role === 'raider') raiderDown(u, by);
  if (by) sfx('death', u.x, u.z);
  onUnitDeath(u, cause, by);
}

export function flee(u, fx, fz) {
  setState(u, 'flee');
  const n = u.nation;
  const home = n.houses.length ? n.houses[0] : null;
  if (home && Math.random() < 0.6) { u.tx = home.cx + rand(-6, 6); u.tz = home.cz - 5; }
  else {
    const a = Math.atan2(u.z - fz, u.x - fx) + rand(-0.6, 0.6);
    u.tx = u.x + Math.cos(a) * 10; u.tz = u.z + Math.sin(a) * 10;
  }
}

const OFFS = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3];
function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

// Returns true when within `near` of the goal, 'stuck' when blocked for a while.
function moveToward(u, tx, tz, dt, mul = 1, near = 0.5) {
  const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz);
  if (d < near) return true;
  const base = Math.atan2(dz, dx);
  const sp = Math.min(d, u.st.speed * mul * dt * (u.onFire > 0 ? 1.4 : 1) * (onRoadXZ(u.x, u.z) ? ROAD_SPEED : 1)) * (u.swim > 0 ? 0.55 : 1);
  for (const o of OFFS) {
    const a = base + o * u.side;
    const nx = u.x + Math.cos(a) * sp, nz = u.z + Math.sin(a) * sp;
    const g = standY(u, nx, nz);
    if (g === null) continue;
    u.x = nx; u.z = nz;
    trample(Math.floor(nx), Math.floor(nz), dt * (u.role === 'caravan' ? 1.6 : 1));
    if (g > u.y) u.y = g;
    u.face = lerpAngle(u.face, a, Math.min(1, dt * 10));
    u.moving = true;
    u.walk += dt * u.st.speed * 5 * mul;
    if (o === 0) u.stuck = Math.max(0, u.stuck - dt); else u.stuck += dt * 0.3;
    return u.stuck > 4 ? 'stuck' : false;
  }
  u.stuck += dt;
  u.side = -u.side;
  return u.stuck > 1.5 ? 'stuck' : false;
}

// ---------- pathfinding: A* over columns, using the same step rules as walking ----------

const NC = W * D;
const gS = new Float32Array(NC), fromC = new Int32Array(NC), nodeY = new Int16Array(NC);
const seen = new Uint32Array(NC), closed = new Uint32Array(NC);
const hc = [], hf = [];
let stamp = 0, pathBudget = 0;
const MAX_NODES = 2500;
const HW = 1.6; // weighted A*: slightly longer paths, far fewer nodes
export const pathStats = { calls: 0, nodes: 0, partial: 0, unreachable: 0 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function hpush(c, f) {
  let i = hc.length;
  hc.push(c); hf.push(f);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (hf[p] <= f) break;
    hc[i] = hc[p]; hf[i] = hf[p]; i = p;
  }
  hc[i] = c; hf[i] = f;
}
function hpop() {
  const top = hc[0];
  const c = hc.pop(), f = hf.pop();
  const n = hc.length;
  if (n) {
    let i = 0;
    for (;;) {
      let m = i * 2 + 1;
      if (m >= n) break;
      if (m + 1 < n && hf[m + 1] < hf[m]) m++;
      if (hf[m] >= f) break;
      hc[i] = hc[m]; hf[i] = hf[m]; i = m;
    }
    hc[i] = c; hf[i] = f;
  }
  return top;
}

// Standing height after stepping from height y into column (nx, nz), or -1 if impossible.
let curSwim = true;
function stepFrom(y, nx, nz) {
  if (nx < 1 || nz < 1 || nx >= W - 1 || nz >= D - 1) return -1;
  if (height[nz * W + nx] < SEA) {
    if (!curSwim || y > SEA + 3 || solid(nx, SEA, nz) || solid(nx, SEA + 1, nz)) return -1;
    return SEA;
  }
  let yy = Math.min(H - 1, y);
  while (yy >= 0 && !solid(nx, yy, nz)) yy--;
  const g = yy + 1;
  if (solid(nx, g, nz) || solid(nx, g + 1, nz)) return -1;
  if (g < y - 3) return -1;
  return g;
}

const octile = (ax, az, bx, bz) => {
  const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
  return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
};

// Returns { cells, partial } leading to the goal or the closest reachable cell, or null when out of budget.
function findPath(u, tx, tz, near) {
  const reach = Math.max(0.75, near);
  if (pathBudget <= 0) return null;
  pathBudget--;
  curSwim = canSwim(u);
  stamp++;
  hc.length = 0; hf.length = 0;
  const sx = Math.floor(u.x), sz = Math.floor(u.z), gx = Math.floor(tx), gz = Math.floor(tz);
  const start = sz * W + sx;
  seen[start] = stamp; gS[start] = 0; fromC[start] = -1; nodeY[start] = Math.floor(u.y + 0.05);
  hpush(start, octile(sx, sz, gx, gz) * HW);
  let best = start, bestH = Infinity, expanded = 0, reached = false;
  while (hc.length && expanded < MAX_NODES) {
    const c = hpop();
    if (closed[c] === stamp) continue;
    closed[c] = stamp;
    expanded++;
    const cx = c % W, cz = (c / W) | 0;
    const h = octile(cx, cz, gx, gz);
    if (h < bestH) { bestH = h; best = c; }
    if (Math.hypot(cx + 0.5 - tx, cz + 0.5 - tz) <= reach) { best = c; reached = true; break; }
    const y = nodeY[c];
    for (let k = 0; k < 8; k++) {
      const dx = DIRS[k][0], dz = DIRS[k][1];
      const nx = cx + dx, nz = cz + dz;
      const ni = nz * W + nx;
      if (closed[ni] === stamp) continue;
      if (k >= 4 && (stepFrom(y, cx + dx, cz) < 0 || stepFrom(y, cx, cz + dz) < 0)) continue; // no corner cutting
      const ny = stepFrom(y, nx, nz);
      if (ny < 0) continue;
      const cost = gS[c] + ((k >= 4 ? 1.414 : 1) + (ny > y ? 0.4 : 0) + (ny <= SEA ? 3 : 0)) * (onRoadCol(ni) ? ROAD_COST : 1);
      if (seen[ni] !== stamp || cost < gS[ni]) {
        seen[ni] = stamp; gS[ni] = cost; fromC[ni] = c; nodeY[ni] = ny;
        hpush(ni, cost + octile(nx, nz, gx, gz) * HW);
      }
    }
  }
  const cells = [];
  for (let c = best; c !== start && c >= 0; c = fromC[c]) cells.push(c);
  cells.reverse();
  pathStats.calls++; pathStats.nodes += expanded; if (!reached) { if (expanded >= MAX_NODES) pathStats.partial++; else pathStats.unreachable++; }
  return { cells, partial: !reached && expanded >= MAX_NODES };
}

// Walk toward a goal along a planned path. Same return values as moveToward.
function navigate(u, tx, tz, dt, mul = 1, near = 0.5) {
  const d = Math.hypot(tx - u.x, tz - u.z);
  if (d < near) { u.path = null; return true; }
  if (d < 2.5 && !u.path) return moveToward(u, tx, tz, dt, mul, near);
  u.pathCd -= dt;
  const gx = Math.floor(tx), gz = Math.floor(tz);
  if (!u.path || u.repath || Math.hypot(gx - u.pgx, gz - u.pgz) > 2.5) {
    if (u.pathCd > 0) return moveToward(u, tx, tz, dt, mul, near); // don't replan every frame
    const p = findPath(u, tx, tz, near);
    if (!p) return moveToward(u, tx, tz, dt, mul, near); // planner busy this step
    u.pathCd = 1;
    u.repath = false;
    if (!p.cells.length) { u.path = null; return d < near + 1.2 ? true : 'stuck'; }
    u.path = p.cells; u.partial = p.partial; u.pi = 0; u.pgx = gx; u.pgz = gz;
  }
  while (u.pi < u.path.length) {
    const c = u.path[u.pi];
    if (Math.hypot(c % W + 0.5 - u.x, ((c / W) | 0) + 0.5 - u.z) < 0.45) u.pi++;
    else break;
  }
  if (u.pi >= u.path.length) {
    u.path = null;
    if (u.partial) { u.pathCd = 0; return false; } // keep going: plan the next leg
    return d < near + 1.2 ? true : 'stuck';
  }
  const c = u.path[u.pi];
  const r = moveToward(u, c % W + 0.5, ((c / W) | 0) + 0.5, dt, mul, 0.05);
  if (r === 'stuck') {
    u.stuck = 0;
    u.repath = true;
    if (++u.fails > 3) { u.fails = 0; u.path = null; return 'stuck'; }
  }
  return false;
}

const isMil = u => u.role === 'soldier' || u.role === 'escort' || u.role === 'raider';

function faceToward(u, x, z, dt) {
  u.face = lerpAngle(u.face, Math.atan2(z - u.z, x - u.x), Math.min(1, dt * 10));
}

function nearestEnemyUnit(u, r, enemies) {
  let best = null, bd = r * r;
  for (const t of units) {
    if (!t.alive || t.held || t.flying || !enemies.includes(t.nation)) continue;
    const d = (t.x - u.x) ** 2 + (t.z - u.z) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function nearestCaravan(u, r) {
  let best = null, bd = r * r;
  for (const t of units) {
    if (!t.alive || t.role !== 'caravan' || t.nation === u.nation || t.held || t.flying) continue;
    if (u.nation.allies.includes(t.nation)) continue;
    const d = (t.x - u.x) ** 2 + (t.z - u.z) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function nearestRaider(u, r) {
  let best = null, bd = r * r;
  for (const t of units) {
    if (!t.alive || t.role !== 'raider' || t.nation === u.nation || t.held || t.flying) continue;
    const d = (t.x - u.x) ** 2 + (t.z - u.z) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function nearestEnemyHouse(u, enemies) {
  let best = null, bd = Infinity;
  for (const n of enemies) for (const h of n.houses) {
    if (h.dead) continue;
    const d = (h.cx - u.x) ** 2 + (h.cz - u.z) ** 2;
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

function nearestTree(u, r) {
  let best = null, bd = r * r;
  for (let i = 1; i < structs.length; i++) {
    const s = structs[i];
    if (s.dead || s.kind !== 'tree' || s.claimedBy) continue;
    const d = (s.x - u.x) ** 2 + (s.z - u.z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function homePoint(u) {
  const n = u.nation;
  if (n.houses.length) {
    const h = n.houses[Math.floor(Math.random() * n.houses.length)];
    return [h.cx, h.cz];
  }
  return [n.capital.x, n.capital.z];
}

function decide(u) {
  const n = u.nation;
  const enemies = n.enemies;
  u.think = rand(0.4, 1.2);
  if (u.role === 'caravan') {
    if (u.trade) { setState(u, 'trade'); return; } // e.g. after a scuffle: back on the road
    u.role = 'villager';
  }
  if (u.role === 'raider') {
    if (u.raid) { setState(u, 'raid'); return; }
    u.role = 'villager';
  }
  if (u.role === 'escort') {
    if (u.escortOf && u.escortOf.alive && u.escortOf.role === 'caravan') { setState(u, 'escort'); return; }
    u.escortOf = null; u.role = 'villager';
  }
  if (u.role === 'soldier' && enemies.length) {
    const t = nearestEnemyUnit(u, 32, enemies);
    if (t) { setState(u, 'fight'); u.target = t; return; }
    const h = nearestEnemyHouse(u, enemies);
    if (h) { setState(u, 'siege', h); return; }
  }
  if (u.role !== 'soldier' && enemies.length) {
    const t = nearestEnemyUnit(u, 5, enemies);
    if (t) {
      if (u.role === 'king' || (t.role === 'soldier' && Math.random() < 0.6)) flee(u, t.x, t.z);
      else { setState(u, 'fight'); u.target = t; }
      return;
    }
  }
  if (u.role === 'villager') {
    let site = null;
    const crew = 3 + Math.floor(game.prosperity / 5);
    for (const st of n.sites) if (!st.dead && !st.built && st.builders.size < crew) { site = st; break; }
    if (site) {
      setState(u, 'build', site);
      site.builders.add(u);
      return;
    }
    if (n.wood < 60 && Math.random() < 0.6) {
      const tr = nearestTree(u, 40);
      if (tr) { setState(u, 'chop', tr); tr.claimedBy = u; return; }
    }
  }
  const [hx, hz] = homePoint(u);
  const r = u.role === 'king' ? 5 : u.role === 'soldier' ? 9 : 13;
  setState(u, 'goto');
  if (u.role === 'villager' && Math.random() < 0.05) { // a dip in the sea
    for (let k = 0; k < 10; k++) {
      const x = hx + rand(-16, 16), z = hz + rand(-16, 16);
      if (height[Math.floor(z) * W + Math.floor(x)] < SEA - 1 && groundTop(Math.floor(x), Math.floor(z)) < SEA) { u.tx = x; u.tz = z; u.think = rand(3, 6); return; }
    }
  }
  for (let k = 0; k < 6; k++) {
    u.tx = hx + rand(-r, r);
    u.tz = hz + rand(-r, r);
    if (groundTop(Math.floor(u.tx), Math.floor(u.tz)) > SEA) break;
  }
  u.think = rand(1, 4);
}

function hitHouse(u, s) {
  let best = -1, bd = Infinity;
  for (let k = 0; k < s.placed; k++) {
    const [x, y, z] = s.plan[k];
    if (owner[idx(x, y, z)] !== s.id) continue;
    if (y > u.y + 4) continue;
    const d = (x + 0.5 - u.x) ** 2 + (y - u.y) ** 2 * 0.5 + (z + 0.5 - u.z) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  if (best < 0) {
    // nothing in reach; tear at whatever is left
    for (let k = s.placed - 1; k >= 0; k--) { const [x, y, z] = s.plan[k]; if (owner[idx(x, y, z)] === s.id) { best = k; break; } }
    if (best < 0) return;
  }
  const [x, y, z] = s.plan[best];
  const t = get(x, y, z);
  if (u.race === 'goblin' && Math.random() < 0.15) {
    for (let k = s.placed - 1; k >= 0; k--) { const p = s.plan[k]; if (ignite(p[0], p[1], p[2])) break; }
  }
  set(x, y, z, B.AIR);
  sparks(x + 0.5, y + 0.5, z + 0.5);
  if (t) spawnDebris(x + 0.5, y + 0.5, z + 0.5, rand(-2, 2), rand(2, 5), rand(-2, 2), t, 0.25);
}

function act(u, dt) {
  switch (u.state) {
    case 'goto':
    case 'flee': {
      const r = navigate(u, u.tx, u.tz, dt, u.state === 'flee' ? 1.35 : 1);
      if (r) { setState(u, 'idle'); u.think = rand(0.5, 2.5); }
      break;
    }
    case 'trade': {
      const t = u.trade;
      if (!t || !t.dest.alive || !t.dest.houses.length || u.nation.enemies.includes(t.dest)) { abortCaravan(u); break; }
      visitInns(u);
      const d = dist(u, t.gx, t.gz);
      const r = navigate(u, t.gx, t.gz, dt, 1.1, 4.5);
      if (r === true || (r === 'stuck' && d < 9)) arriveCaravan(u);
      else if (r === 'stuck') abortCaravan(u, 'stuck');
      break;
    }
    case 'raid': {
      const r = u.raid;
      if (!r) { u.role = 'villager'; setState(u, 'idle'); break; }
      r.t -= dt;
      if (r.phase === 'go') {
        const res = navigate(u, r.x, r.z, dt, 1.05, 1.5);
        if (res === true || res === 'stuck') r.phase = 'wait';
        else if (r.t <= 0) r.phase = 'home';
      } else if (r.phase === 'wait') {
        r.scan -= dt;
        if (r.scan <= 0) {
          r.scan = 0.4;
          const prey = nearestCaravan(u, 10);
          if (prey) { setState(u, 'fight'); u.target = prey; break; }
          if (nearInn(u.x, u.z, 14)) r.t = 0; // the inn's guards drive them off
        }
        if (r.t <= 0) r.phase = 'home';
      } else {
        const [hx, hz] = homePoint(u);
        const res = navigate(u, hx, hz, dt, 1, 6);
        if (res === true || res === 'stuck' || r.t < -40) { u.raid = null; u.role = 'villager'; setState(u, 'idle'); u.think = 0.5; }
      }
      break;
    }
    case 'escort': {
      const c = u.escortOf;
      if (!c || !c.alive || c.role !== 'caravan') { u.escortOf = null; u.role = 'villager'; setState(u, 'idle'); u.think = 0.3; break; }
      u.think -= dt;
      if (u.think <= 0) {
        u.think = 0.5;
        const t = nearestRaider(u, 12);
        if (t) { setState(u, 'fight'); u.target = t; break; }
      }
      navigate(u, c.x, c.z, dt, 1.25, 2.2);
      break;
    }
    case 'chop': {
      const s = u.task;
      if (!s || s.dead) { setState(u, 'idle'); break; }
      const d = dist(u, s.x + 0.5, s.z + 0.5);
      if (u.timer === 0) {
        const r = navigate(u, s.x + 0.5, s.z + 0.5, dt, 1, 1.6);
        if (r === false) break;
        if (r === 'stuck' && d > 2.8) { setState(u, 'idle'); break; }
      }
      faceToward(u, s.x + 0.5, s.z + 0.5, dt);
      const before = Math.floor(u.timer * 1.6);
      u.timer += dt;
      if (Math.floor(u.timer * 1.6) !== before) { u.swing = 1; sparks(s.x + 0.5, u.y + 0.8, s.z + 0.5, 3); }
      if (u.timer >= 3 / game.prosperity) { chopTree(s, u.nation); setState(u, 'idle'); u.think = 0.3; }
      break;
    }
    case 'build': {
      const s = u.task;
      if (!s || s.dead || s.built) { setState(u, 'idle'); break; }
      const tx = s.x0 + 3.5, tz = s.z0 + 0.5;
      const d = dist(u, tx, tz);
      if (u.timer === 0 && d > 3.5) {
        const r = navigate(u, tx, tz, dt, 1, 3.5);
        if (r === false) break;
        if (r === 'stuck' && d > 7) { setState(u, 'idle'); break; }
      }
      faceToward(u, s.cx, s.cz, dt);
      u.timer += dt;
      const iv = 0.14 / game.prosperity;
      for (let k = 0; k < 400 && u.timer > 0.5; k++) {
        u.timer -= iv;
        u.swing = Math.max(u.swing, 0.6);
        if (!placeNext(s)) { setState(u, 'idle'); u.think = 0.5; break; }
      }
      break;
    }
    case 'fight': {
      const t = u.target;
      if (!t || !t.alive || t.held || t.flying || dist(u, t.x, t.z) > 34) { setState(u, 'idle'); u.think = 0.2; break; }
      const ranged = u.role === 'soldier' && u.st.bow;
      const range = ranged ? u.st.bow : u.st.range;
      const d = dist(u, t.x, t.z);
      if (d > range) {
        const r = navigate(u, t.x, t.z, dt, 1.15, range * 0.9);
        if (r === 'stuck') { setState(u, 'idle'); u.think = 0.5; }
        break;
      }
      faceToward(u, t.x, t.z, dt);
      if (u.cd <= 0) {
        u.cd = u.race === 'goblin' ? 0.8 : ranged ? 1.4 : 1.0;
        u.swing = 1;
        if (ranged) arrow(u.x, u.y + 1.1, u.z, t.x, t.y + 0.9, t.z);
        damageUnit(t, rand(u.st.dmg[0], u.st.dmg[1]) * (isMil(u) ? 1.25 : 0.8), u, 'battle');
      }
      break;
    }
    case 'siege': {
      const s = u.task;
      if (!s || s.dead || !u.nation.enemies.length) { setState(u, 'idle'); break; }
      u.think -= dt;
      if (u.think <= 0) {
        u.think = 1.2;
        const t = nearestEnemyUnit(u, 10, u.nation.enemies);
        if (t) { setState(u, 'fight'); u.target = t; break; }
      }
      const d = dist(u, s.cx, s.cz);
      if (u.timer === 0 && d > 4.2) {
        const r = navigate(u, s.cx, s.cz, dt, 1, 4.2);
        if (r === false) break;
        if (r === 'stuck' && d > 7.5) { setState(u, 'idle'); break; }
      }
      faceToward(u, s.cx, s.cz, dt);
      u.timer += dt;
      if (u.timer >= 1.1) { u.timer = 0.001; u.swing = 1; hitHouse(u, s); }
      break;
    }
  }
}

function physics(u, dt) {
  const cx = Math.floor(u.x), cz = Math.floor(u.z);
  if (colIsWater(cx, cz) && !solid(cx, SEA, cz)) {
    if (u.y > SEA + 0.02) {
      u.vy -= 28 * dt; u.y += u.vy * dt;
      if (u.y > SEA) return;
    }
    if (!(u.swim > 0)) { splash(u.x, u.z, 8); u.swim = 0.001; }
    u.vy = 0; u.y += (SEA - u.y) * Math.min(1, dt * 6) + 0.0001; if (u.y > SEA) u.y = SEA;
    u.swim += dt;
    if (u.onFire > 0) u.onFire = 0; // the water puts the flames out
    return;
  }
  u.swim = 0;
  const fy = Math.floor(u.y + 0.01);
  if (solid(cx, fy, cz)) {
    let y = fy;
    while (y < H - 1 && solid(cx, y, cz)) y++;
    u.y = y; u.vy = 0;
    return;
  }
  const g = groundUnder(u.x, u.y + 0.01, u.z);
  if (u.y > g + 0.001 || u.vy > 0) {
    u.vy -= 28 * dt;
    u.y += u.vy * dt;
    if (u.y <= g) {
      if (u.vy < -17) damageUnit(u, (-u.vy - 17) * 1.2, null, 'fall');
      u.y = g; u.vy = 0;
    }
  } else { u.y = g; u.vy = 0; }
}

function flyUpdate(u, dt) {
  u.vy -= 28 * dt;
  u.x = Math.min(W - 1.5, Math.max(1.5, u.x + u.vx * dt));
  u.z = Math.min(D - 1.5, Math.max(1.5, u.z + u.vz * dt));
  u.y += u.vy * dt;
  u.spin += dt * 9; u.swim = 0;
  if (u.y < -5) { killUnit(u, 'splat'); return; }
  const cx = Math.floor(u.x), cz = Math.floor(u.z);
  const inside = solid(cx, Math.floor(u.y), cz);
  const g = groundUnder(u.x, u.y + 0.5, u.z);
  if (isWaterCol(u.x, u.z) && u.y <= WATER_Y && u.vy < 0) {
    splash(u.x, u.z, 20);
    u.flying = false; u.vx = u.vz = u.vy = 0; u.spin = 0;
    u.y = SEA + 0.5;
    setState(u, 'idle'); u.think = 1;
    return;
  }
  if (inside || (u.y <= g && u.vy <= 0)) {
    const sp = Math.hypot(u.vx, u.vy, u.vz);
    u.flying = false; u.spin = 0; u.vx = u.vz = u.vy = 0;
    if (inside) { let y = Math.floor(u.y); while (y < H - 1 && solid(cx, y, cz)) y++; u.y = y; } else u.y = g;
    if (sp > 19) killUnit(u, 'splat', null);
    else { damageUnit(u, Math.max(0, sp - 10) * 0.8, null, 'fall'); setState(u, 'idle'); u.think = 1.5; }
  }
}

export function updateUnits(dt) {
  pathBudget = 10;
  for (const u of units) {
    if (!u.alive) continue;
    u.cd -= dt;
    u.swing = Math.max(0, u.swing - dt * 4);
    u.moving = false;
    if (u.held) continue;
    if (u.flying) { flyUpdate(u, dt); continue; }
    physics(u, dt);
    if (!u.alive || u.possessed) continue;
    if (u.swim > 40) damageUnit(u, dt * 0.8, null, 'drown'); // too long in the water: exhaustion
    if (!u.alive) continue;
    if (u.onFire > 0 && u.state !== 'flee') {
      setState(u, 'flee');
      const a = Math.random() * Math.PI * 2;
      u.tx = u.x + Math.cos(a) * 8; u.tz = u.z + Math.sin(a) * 8;
    }
    if (u.state === 'idle') {
      u.think -= dt;
      if (u.think <= 0) decide(u);
    }
    act(u, dt);
  }
  // compact
  let j = 0;
  for (let i = 0; i < units.length; i++) if (units[i].alive) units[j++] = units[i];
  units.length = j;
}

// Closest unit to a ray, within tolerance.
export function pickUnit(o, d, maxT = Infinity) {
  let best = null, bt = maxT;
  const p = new THREE.Vector3();
  for (const u of units) {
    if (!u.alive || u.possessed) continue;
    p.set(u.x - o.x, u.y + 0.7 * u.st.scale - o.y, u.z - o.z);
    const t = p.dot(d);
    if (t <= 0 || t >= bt) continue;
    const dd = p.addScaledVector(d, -t).length();
    if (dd < 0.55 * u.st.scale + t * 0.006) { bt = t; best = u; }
  }
  return best;
}

// ---------- rendering ----------

let M;
const rig = {};
const GOLD = new THREE.Color('#f2c443');
const PACK = new THREE.Color('#c9a15f');
const BANDIT = new THREE.Color('#3a3330');
const SICK = new THREE.Color('#7fa83a');
const tmpC = new THREE.Color();

export function initUnitMeshes(scene) {
  const mat = new THREE.MeshLambertMaterial();
  const white = new THREE.Color(1, 1, 1);
  const mk = (geo, n) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true;
    m.frustumCulled = false;
    for (let i = 0; i < n; i++) m.setColorAt(i, white);
    m.count = 0;
    scene.add(m);
    return m;
  };
  const leg = new THREE.BoxGeometry(0.17, 0.55, 0.2); leg.translate(0, -0.275, 0);
  const weapon = new THREE.BoxGeometry(0.07, 0.8, 0.07); weapon.translate(0, 0.32, 0);
  const ear = new THREE.BoxGeometry(0.1, 0.12, 0.26);
  M = {
    leg: mk(leg, MAXU * 2),
    body: mk(new THREE.BoxGeometry(0.46, 0.55, 0.3), MAXU),
    head: mk(new THREE.BoxGeometry(0.36, 0.36, 0.36), MAXU),
    weapon: mk(weapon, MAXU),
    crown: mk(new THREE.BoxGeometry(0.42, 0.13, 0.42), 80),
    ear: mk(ear, MAXU * 2),
    pack: mk(new THREE.BoxGeometry(0.5, 0.42, 0.34), 96),
  };
  rig.root = new THREE.Object3D();
  const add = (name, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); rig.root.add(o); rig[name] = o; };
  add('legL', -0.11, 0.55, 0); add('legR', 0.11, 0.55, 0);
  add('body', 0, 0.83, 0); add('head', 0, 1.29, 0);
  add('weapon', 0.3, 0.85, 0.08); add('crown', 0, 1.52, 0);
  add('earL', -0.24, 1.33, -0.02); add('earR', 0.24, 1.33, -0.02);
  add('pack', 0, 0.95, -0.3);
  rig.earL.rotation.y = 0.6; rig.earR.rotation.y = -0.6;
}

export function renderUnits(time) {
  let nu = 0, nl = 0, nw = 0, nc = 0, ne = 0, np = 0;
  const r = rig;
  for (const u of units) {
    if (!u.alive || u.possessed) continue;
    if (nu >= MAXU) break;
    const st = u.st;
    let y = u.y;
    if (u.swim > 0 && !u.flying && !u.held) y = SEA + 0.28 + Math.sin(time * 3 + u.id) * 0.07;
    r.root.position.set(u.x, y, u.z);
    r.root.rotation.set(u.spin, Math.PI / 2 - u.face, 0);
    r.root.scale.setScalar(st.scale);
    let swing = u.moving ? Math.sin(u.walk) * 0.7 : 0;
    if (u.held || u.flying) swing = Math.sin(time * 22 + u.id) * 0.9;
    r.legL.rotation.x = swing;
    r.legR.rotation.x = -swing;
    r.weapon.rotation.x = 0.4 - u.swing * 1.9;
    r.root.updateMatrixWorld(true);

    const n = u.nation;
    M.leg.setMatrixAt(nl, r.legL.matrixWorld); M.leg.setColorAt(nl++, st.legsC);
    M.leg.setMatrixAt(nl, r.legR.matrixWorld); M.leg.setColorAt(nl++, st.legsC);
    M.body.setMatrixAt(nu, r.body.matrixWorld);
    tmpC.copy(u.role === 'raider' ? BANDIT : isMil(u) ? n.armor : n.color);
    if (u.plague > 0) tmpC.lerp(SICK, 0.6);
    if (u.onFire > 0 && (time * 10 | 0) % 2) tmpC.lerp(GOLD, 0.6);
    M.body.setColorAt(nu, tmpC);
    M.head.setMatrixAt(nu, r.head.matrixWorld); M.head.setColorAt(nu, st.skinC);
    nu++;
    if (isMil(u) || u.state === 'chop' || u.state === 'build') {
      M.weapon.setMatrixAt(nw, r.weapon.matrixWorld);
      M.weapon.setColorAt(nw++, isMil(u) ? st.weaponC : RSTAT.goblin.legsC);
    }
    if (u.role === 'caravan' && np < 96) {
      M.pack.setMatrixAt(np, r.pack.matrixWorld);
      M.pack.setColorAt(np++, tmpC.copy(n.color).lerp(PACK, 0.55));
    }
    if ((u.role === 'king' || u.hero) && nc < 80) {
      M.crown.setMatrixAt(nc, r.crown.matrixWorld); M.crown.setColorAt(nc++, GOLD);
    }
    if (u.race !== 'human') {
      M.ear.setMatrixAt(ne, r.earL.matrixWorld); M.ear.setColorAt(ne++, st.skinC);
      M.ear.setMatrixAt(ne, r.earR.matrixWorld); M.ear.setColorAt(ne++, st.skinC);
    }
  }
  const fin = (m, n) => {
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  fin(M.leg, nl); fin(M.body, nu); fin(M.head, nu); fin(M.weapon, nw); fin(M.crown, nc); fin(M.ear, ne); fin(M.pack, np);
}
