// Invasion fleets: when a war enemy lives on another landmass, soldiers muster at a port, board a
// ship that sails around the land, and disembark beside the enemy's houses.
import * as THREE from '../vendor/three.module.js';
import { W, D, H, SEA, WATER_Y, height } from './world.js';
import { nations, nm, rel } from './nations.js';
import { units, setState, groundUnder } from './units.js';
import { compAt, compSize, refreshLandmass } from './landmass.js';
import { splash } from './effects.js';
import { pickCargo, settleTrade, GOODS } from './economy.js';
import { sfx } from './audio.js';
import { log } from './ui.js';

const fleets = [];
let scene = null, timer = 3, rr = 0;
export const fleetStats = { landed: 0, sailed: 0, trade: 0 };
const SPEED = 9, CAP = 8;
const SLOTS = [[-1.5, -0.55], [-1.5, 0.55], [-0.5, -0.55], [-0.5, 0.55], [0.5, -0.55], [0.5, 0.55], [1.5, -0.55], [1.5, 0.55]];
const rand = (a, b) => a + Math.random() * (b - a);

export function initFleets(s) { scene = s; }

const isW = (x, z) => x >= 0 && z >= 0 && x < W && z < D && height[z * W + x] < SEA;
const deep = (x, z) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!isW(x + dx, z + dz)) return false; return true; };

// ---------- ship model ----------
const hullGeo = new THREE.BoxGeometry(6, 0.8, 2.2), bowGeo = new THREE.BoxGeometry(1.6, 0.8, 1.6), deckGeo = new THREE.BoxGeometry(5.6, 0.1, 1.9);
const mastGeo = new THREE.BoxGeometry(0.2, 4.2, 0.2), sailGeo = new THREE.BoxGeometry(0.08, 2.9, 3.0);
const wood = new THREE.MeshLambertMaterial({ color: '#6b4a2b' }), plank = new THREE.MeshLambertMaterial({ color: '#b98d55' });
const crateGeo = new THREE.BoxGeometry(0.9, 0.7, 0.9), crateMat = new THREE.MeshLambertMaterial({ color: '#8a5f33' });
function makeShip(n, trade = false) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(hullGeo, wood), bow = new THREE.Mesh(bowGeo, wood), deck = new THREE.Mesh(deckGeo, plank), mast = new THREE.Mesh(mastGeo, wood);
  const sail = new THREE.Mesh(sailGeo, new THREE.MeshLambertMaterial({ color: n.color, side: THREE.DoubleSide }));
  bow.position.set(3.0, 0, 0); bow.rotation.y = Math.PI / 4;
  deck.position.y = 0.42; mast.position.set(0.5, 2.5, 0); sail.position.set(0.6, 2.9, 0);
  g.add(hull, bow, deck, mast, sail);
  if (trade) for (const [x, z] of [[-1.6, -0.5], [-1.6, 0.5], [-0.6, 0.5], [1.4, -0.5]]) { const c = new THREE.Mesh(crateGeo, crateMat); c.position.set(x, 0.85, z); g.add(c); }
  g.traverse(o => { o.castShadow = true; });
  scene.add(g);
  return g;
}

// ---------- planning ----------
function nearestShore(cx, cz, comp, maxR, toward) {
  const bestBy = new Map();
  for (let z = Math.max(1, cz - maxR); z < Math.min(D - 1, cz + maxR); z++) for (let x = Math.max(1, cx - maxR); x < Math.min(W - 1, cx + maxR); x++) {
    if (height[z * W + x] < SEA || compAt(x, z) !== comp) continue;
    let w = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isW(x + dx, z + dz) && compSize(compAt(x + dx, z + dz)) > 350) { w = [x + dx, z + dz]; break; }
    if (!w) continue;
    const d = Math.hypot(x - toward.cx, z - toward.cz);
    const wc = compAt(w[0], w[1]), cur = bestBy.get(wc);
    if (!cur || d < cur.d) bestBy.set(wc, { x, z, wx: w[0], wz: w[1], water: wc, d });
  }
  return [...bestBy.values()].sort((p, q) => p.d - q.d); // one port candidate per sea, nearest the target first
}

function nearLanding(h, comp, water) {
  let best = null, bd = Infinity;
  const cx = Math.floor(h.cx), cz = Math.floor(h.cz);
  for (let z = Math.max(1, cz - 45); z < Math.min(D - 1, cz + 45); z++) for (let x = Math.max(1, cx - 45); x < Math.min(W - 1, cx + 45); x++) {
    if (height[z * W + x] < SEA || compAt(x, z) !== comp) continue;
    const d = Math.hypot(x - h.cx, z - h.cz);
    if (d < 8 || d >= bd) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (compAt(x + dx, z + dz) === water) { bd = d; best = { x, z, wx: x + dx, wz: z + dz }; break; }
  }
  return best;
}

const par = new Int32Array(W * D), qu = new Int32Array(W * D), vis = new Uint32Array(W * D);
let vstamp = 0;
function route(a, b) { // a, b: {wx, wz}; BFS over open water, staying off the coast where it can
  const goal = b.wz * W + b.wx, start = a.wz * W + a.wx;
  const run = needDeep => {
    vstamp++;
    let qh = 0, qt = 0;
    qu[qt++] = start; vis[start] = vstamp; par[start] = -1;
    while (qh < qt) {
      const i = qu[qh++];
      if (i === goal) {
        const out = [];
        for (let c = i; c !== -1; c = par[c]) out.push([c % W + 0.5, ((c / W) | 0) + 0.5]);
        return out.reverse();
      }
      const x = i % W, z = (i / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz, j = nz * W + nx;
        if (!isW(nx, nz) || vis[j] === vstamp) continue;
        if (dx && dz && (!isW(x + dx, z) || !isW(x, z + dz))) continue;
        if (needDeep && !deep(nx, nz) && Math.hypot(nx - a.wx, nz - a.wz) > 6 && Math.hypot(nx - b.wx, nz - b.wz) > 6) continue;
        vis[j] = vstamp; par[j] = i; qu[qt++] = j;
      }
    }
    return null;
  };
  const p = run(true) || run(false);
  if (!p) return null;
  const clear = (x0, z0, x1, z1) => { const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2); for (let k = 0; k <= n; k++) { const t = k / n, x = Math.floor(x0 + (x1 - x0) * t), z = Math.floor(z0 + (z1 - z0) * t); if (!isW(x, z)) return false; } return true; };
  const out = [p[0]]; // string-pull the grid path into a few long legs
  let i = 0;
  while (i < p.length - 1) {
    let j = p.length - 1;
    while (j > i + 1 && !clear(p[i][0], p[i][1], p[j][0], p[j][1])) j--;
    out.push(p[j]); i = j;
  }
  return out;
}

export function planFleet(a) {
  const mine = new Set();
  for (const h of a.houses) if (!h.dead) mine.add(compAt(h.cx, h.cz));
  if (!mine.size) return null;
  const home = a.houses.find(h => h.capital) || a.houses[0];
  const targets = [];
  for (const b of a.enemies) for (const h of b.houses) if (!h.dead && !mine.has(compAt(h.cx, h.cz))) targets.push({ h, b, d: Math.hypot(h.cx - home.cx, h.cz - home.cz) });
  if (!targets.length) { return null; }
  targets.sort((p, q) => p.d - q.d);
  for (const t of targets.slice(0, 3)) {
    const port = a.houses.filter(h => !h.dead && compAt(h.cx, h.cz) > 0).sort((p, q) => Math.hypot(p.cx - t.h.cx, p.cz - t.h.cz) - Math.hypot(q.cx - t.h.cx, q.cz - t.h.cz))[0];
    if (!port) { continue; }
    const shores = nearestShore(Math.floor(port.cx), Math.floor(port.cz), compAt(port.cx, port.cz), 70, t.h);
    if (!shores.length) { continue; }
    for (const shore of shores) {
      const land = nearLanding(t.h, compAt(t.h.cx, t.h.cz), shore.water);
      if (!land) { continue; }
      const wps = route(shore, land);
      if (!wps) { continue; }
      return { enemy: t.b, shore, land, wps };
    }
  }
  return null;
}

function launch(a) {
  const plan = planFleet(a);
  if (!plan) return false;
  const pool = [...a.units].filter(u => u.alive && !u.possessed && !u.held && !u.flying && u.role === 'soldier' && u.state !== 'fight' && !(u.swim > 0));
  const comp = compAt(plan.shore.x, plan.shore.z);
  const crew = pool.filter(u => compAt(u.x, u.z) === comp).sort((p, q) => Math.hypot(p.x - plan.shore.x, p.z - plan.shore.z) - Math.hypot(q.x - plan.shore.x, q.z - plan.shore.z)).slice(0, CAP);
  if (crew.length < 4) return false;
  for (const u of crew) { setState(u, 'goto'); u.tx = plan.shore.x + 0.5 + rand(-2.5, 2.5); u.tz = plan.shore.z + 0.5 + rand(-2.5, 2.5); }
  const f = { n: a, enemy: plan.enemy, state: 'muster', crew, shore: plan.shore, land: plan.land, wps: plan.wps, wi: 1, x: plan.shore.wx + 0.5, z: plan.shore.wz + 0.5, h: 0, t: 0, mesh: makeShip(a), orig: plan.wps };
  f.h = plan.wps.length > 1 ? Math.atan2(plan.wps[1][1] - f.z, plan.wps[1][0] - f.x) : 0;
  fleets.push(f);
  log(`⛵ ${nm(a)} gathers ${crew.length} soldiers at the docks to sail against ${nm(plan.enemy)}.`);
  return true;
}


// ---------- merchant ships: cargo between coastal nations on different landmasses ----------

function planTrade(a, b) {
  const ca = new Set();
  for (const h of a.houses) if (!h.dead) ca.add(compAt(h.cx, h.cz));
  const targets = b.houses.filter(h => !h.dead && !ca.has(compAt(h.cx, h.cz)));
  if (!targets.length || !a.houses.length) return null;
  const home = a.houses.find(h => h.capital) || a.houses[0];
  const t = targets.sort((p, q) => Math.hypot(p.cx - home.cx, p.cz - home.cz) - Math.hypot(q.cx - home.cx, q.cz - home.cz))[0];
  const port = a.houses.filter(h => !h.dead && compAt(h.cx, h.cz) > 0).sort((p, q) => Math.hypot(p.cx - t.cx, p.cz - t.cz) - Math.hypot(q.cx - t.cx, q.cz - t.cz))[0];
  if (!port) return null;
  for (const shore of nearestShore(Math.floor(port.cx), Math.floor(port.cz), compAt(port.cx, port.cz), 40, t)) {
    const land = nearLanding(t, compAt(t.cx, t.cz), shore.water);
    if (!land) continue;
    const wps = route(shore, land);
    if (wps) return { shore, land, wps };
  }
  return null;
}

function launchTrade(a) {
  const partners = nations.filter(m => m.alive && m !== a && m.houses.length && !rel(a, m).war && (m.tier || 0) >= 1);
  partners.sort(() => Math.random() - 0.5);
  let b = null, plan = null;
  for (const m of partners.slice(0, 5)) { plan = planTrade(a, m); if (plan) { b = m; break; } }
  if (!plan) return false;
  const load = pickCargo(a, b, 20);
  if (!load) return false;
  const f = { kind: 'trade', n: a, enemy: b, state: 'sail', crew: [], shore: plan.shore, land: plan.land, wps: plan.wps, orig: plan.wps, wi: 1, x: plan.shore.wx + 0.5, z: plan.shore.wz + 0.5, h: 0, t: 0, mesh: makeShip(a, true), good: load.good, cargo: load.amount, dist: Math.hypot(plan.land.x - plan.shore.x, plan.land.z - plan.shore.z) };
  f.h = plan.wps.length > 1 ? Math.atan2(plan.wps[1][1] - f.z, plan.wps[1][0] - f.x) : 0;
  fleets.push(f);
  return true;
}

function arriveTrade(f) {
  const a = f.n, b = f.enemy;
  if (f.state === 'return' || !b.alive) { a[f.good] += f.cargo; return; }
  const { gain, tax } = settleTrade(a, b, f.good, f.cargo, f.dist);
  fleetStats.trade++;
  sfx('bell', f.land.x, f.land.z, 0.8);
  log(`⛵ A merchant ship from ${nm(a)} docks at ${nm(b)} with ${f.cargo} ${GOODS[f.good].icon}: +${gain} 🪙${tax ? `, ${tax} 🪙 in duties for ${b.place}` : ''}.`);
}

// ---------- running ----------
function place(f, y) {
  const c = Math.cos(f.h), s = Math.sin(f.h);
  f.mesh.position.set(f.x, y, f.z);
  f.mesh.rotation.set(0, -f.h, 0);
  let k = 0;
  for (const u of f.crew) {
    if (!u.boarded) continue;
    const [ox, oz] = SLOTS[k++ % SLOTS.length];
    u.x = f.x + c * ox - s * oz; u.z = f.z + s * ox + c * oz; u.y = y + 0.5; u.face = f.h; u.moving = false; u.swim = 0;
  }
}

function disembark(f, at) {
  let k = 0;
  for (const u of f.crew) {
    if (!u.alive || !u.boarded) continue;
    u.boarded = null; u.held = false;
    for (let tries = 0; tries < 12; tries++) {
      const x = at.x + 0.5 + rand(-3, 3), z = at.z + 0.5 + rand(-3, 3);
      if (height[Math.floor(z) * W + Math.floor(x)] >= SEA) { u.x = x; u.z = z; break; }
      if (tries === 11) { u.x = at.x + 0.5; u.z = at.z + 0.5; }
    }
    u.y = groundUnder(u.x, H - 1, u.z); u.vy = 0; u.swim = 0;
    setState(u, 'idle'); u.think = rand(0.2, 0.9); k++;
  }
  splash(at.wx + 0.5, at.wz + 0.5, 10);
  return k;
}

function end(f) { scene.remove(f.mesh); fleets.splice(fleets.indexOf(f), 1); if (f.kind !== 'trade') f.n.fleetCd = 30; }

export function updateFleets(dt) {
  if (!scene) return;
  for (let i = fleets.length - 1; i >= 0; i--) {
    const f = fleets[i];
    const trade = f.kind === 'trade';
    f.crew = f.crew.filter(u => u.alive);
    f.t += dt;
    const over = trade ? (!f.n.alive || !f.enemy.alive || rel(f.n, f.enemy).war || !f.enemy.houses.length) : (!f.n.alive || !f.enemy.alive || !rel(f.n, f.enemy).war || !f.enemy.houses.length);
    const bob = WATER_Y + 0.15 + Math.sin(f.t * 2.2) * 0.06;
    if (f.state === 'muster') {
      if (over || !f.crew.length) { for (const u of f.crew) if (u.state === 'goto') { setState(u, 'idle'); u.think = 0.3; } end(f); continue; }
      const near = f.crew.filter(u => Math.hypot(u.x - f.shore.x, u.z - f.shore.z) < 6);
      if (near.length >= Math.ceil(f.crew.length * 0.75) || f.t > 20) {
        if (near.length < 3) { for (const u of f.crew) { setState(u, 'idle'); u.think = 0.3; } end(f); continue; }
        for (const u of f.crew) {
          if (near.includes(u)) { u.boarded = f; u.held = true; setState(u, 'idle'); }
          else { setState(u, 'idle'); u.think = 0.3; }
        }
        f.crew = near; f.state = 'sail'; f.t = 0; fleetStats.sailed++;
        sfx('horn', f.x, f.z, 1);
        log(`⛵ The fleet of ${nm(f.n)} sets sail with ${near.length} soldiers.`);
      }
      place(f, bob);
      continue;
    }
    if (!trade && !f.crew.length) { end(f); continue; }
    if (f.state === 'sail' && over) { // the war ended at sea: turn back
      f.wps = f.orig.slice().reverse(); f.wi = 1; f.state = 'return'; f.land = f.shore;
      if (!trade) log(`⛵ ${nm(f.n)} recalls its fleet.`);
    }
    const wp = f.wps[f.wi];
    if (wp) {
      const dx = wp[0] - f.x, dz = wp[1] - f.z, d = Math.hypot(dx, dz);
      const a = Math.atan2(dz, dx); let da = a - f.h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      f.h += da * Math.min(1, dt * 2.5);
      const sp = Math.min(d, SPEED * dt);
      if (d > 0.01) { f.x += dx / d * sp; f.z += dz / d * sp; }
      if (d < 1.2) f.wi++;
    } else if (trade) {
      arriveTrade(f); end(f); continue;
    } else {
      const k = disembark(f, f.land);
      place(f, bob);
      if (f.state === 'sail') { fleetStats.landed++; log(`🛬 ${nm(f.n)} lands ${k} soldiers beside ${nm(f.enemy)}'s lands!`); sfx('horn', f.land.x, f.land.z, 1); }
      end(f);
      continue;
    }
    place(f, bob);
  }
  timer -= dt;
  if (timer > 0) return;
  timer = 4;
  refreshLandmass();
  const live = nations.filter(n => n.alive && n.enemies.length && n.houses.length);
  if (live.length) {
    const a = live[rr++ % live.length];
    a.fleetCd = (a.fleetCd || 0) - 4;
    if (!(a.fleetCd > 0 || fleets.some(f => f.n === a && f.kind !== 'trade'))) { a.fleetCd = 12; launch(a); }
  }
  const traders = nations.filter(n => n.alive && n.houses.length >= 4 && (n.tier || 0) >= 1 && !n.starving);
  if (traders.length) {
    const a = traders[Math.floor(Math.random() * traders.length)];
    a.shipCd = (a.shipCd || 0) - 4;
    if (!(a.shipCd > 0 || fleets.some(f => f.n === a && f.kind === 'trade'))) { a.shipCd = launchTrade(a) ? 20 + Math.random() * 20 : 8; }
  }
}
