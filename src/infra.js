// Infrastructure that grows out of trade: bridges where caravans are stopped by narrow water,
// and inns (waystations) beside the busiest stretches of road far from any town.
import { W, D, SEA, B, colOcc, topAt, groundTop, isWaterCol, newStruct, placeStruct, claimFoot, flatten, housePlan, structs } from './world.js';
import { traffic } from './roads.js';
import { nations, nm, clearTrees } from './nations.js';

import { leafBurst } from './effects.js';
import { log } from './ui.js';

export const infra = { bridges: [], inns: [], blocked: new Map() };
const INN_TRAFFIC = 6;      // wear a road column needs before an inn is worth building
const INN_SPACING = 26;     // keep inns apart
const TOWN_GAP = 10;        // ...and away from houses
const MAX_SPAN = 8;         // longest water gap a bridge will cross
let infraT = 4;

export const nearInn = (x, z, r) => infra.inns.some(i => !i.dead && Math.hypot(i.cx - x, i.cz - z) < r);

// ---------- bridges ----------

const pairKey = (a, b) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);

// A caravan could not reach its destination: maybe water is in the way.
export function noteBlocked(a, b) {
  const k = pairKey(a, b);
  const r = infra.blocked.get(k) || { a, b, count: 0, tries: 0 };
  r.count++;
  infra.blocked.set(k, r);
}

function planBridge(a, b) {
  const ha = a.houses[0] || { cx: a.capital.x, cz: a.capital.z }, hb = b.houses[0] || { cx: b.capital.x, cz: b.capital.z };
  const dx = hb.cx - ha.cx, dz = hb.cz - ha.cz;
  const len = Math.hypot(dx, dz);
  if (len < 4) return null;
  const steps = Math.ceil(len * 2);
  let best = null;
  let run = null;
  for (let i = 0; i <= steps; i++) {
    const x = Math.floor(ha.cx + dx * i / steps), z = Math.floor(ha.cz + dz * i / steps);
    const water = isWaterCol(x, z);
    if (water) { if (!run) run = { x0: x, z0: z, x1: x, z1: z }; run.x1 = x; run.z1 = z; }
    else if (run) {
      const span = Math.max(Math.abs(run.x1 - run.x0), Math.abs(run.z1 - run.z0)) + 1;
      if (span <= MAX_SPAN && (!best || span < best.span)) best = { ...run, span, ex: x, ez: z };
      run = null;
    }
  }
  return best;
}

function buildBridge(owner, a, b) {
  const g = planBridge(a, b);
  if (!g) return false;
  // axis-aligned crossing: along the longer axis of the water run, three planks wide
  const alongX = Math.abs(g.x1 - g.x0) >= Math.abs(g.z1 - g.z0);
  const cells = [];
  if (alongX) {
    const z = g.z0, xa = Math.min(g.x0, g.x1) - 1, xb = Math.max(g.x0, g.x1) + 1;
    for (let x = xa; x <= xb; x++) for (let k = -1; k <= 1; k++) cells.push([x, z + k, x === xa || x === xb]);
  } else {
    const x = g.x0, za = Math.min(g.z0, g.z1) - 1, zb = Math.max(g.z0, g.z1) + 1;
    for (let z = za; z <= zb; z++) for (let k = -1; k <= 1; k++) cells.push([x + k, z, z === za || z === zb]);
  }
  // deck height follows the lower shore so both ends can be stepped onto
  const ends = cells.filter(c => c[2] && !isWaterCol(c[0], c[1]) && !colOcc[c[1] * W + c[0]]);
  if (ends.length < 2) return false;
  const deckY = Math.max(SEA, Math.min(...ends.map(c => topAt(c[0], c[1]))));
  if (ends.some(c => Math.abs(topAt(c[0], c[1]) - deckY) > 1)) return false;
  const waterCells = cells.filter(c => isWaterCol(c[0], c[1]));
  if (waterCells.length < 2) return false;
  const cost = Math.ceil(waterCells.length * 1.5);
  if (owner.wood < cost) return false;
  const s = newStruct('bridge', { nation: owner, cx: (g.x0 + g.x1) / 2 + 0.5, cz: (g.z0 + g.z1) / 2 + 0.5 });
  for (const [x, z] of waterCells) {
    if (colOcc[z * W + x]) continue;
    s.plan.push([x, deckY, z, B.PLANK]);
    if ((alongX ? x : z) % 3 === 0 && ((alongX ? z - g.z0 : x - g.x0) !== 0)) {
      for (let y = topAt(x, z) + 1; y < deckY; y++) s.plan.push([x, y, z, B.LOG]); // piles
    }
  }
  if (!s.plan.length) return false;
  for (const [x, y, z, t] of s.plan) placeStruct(s, x, y, z, t);
  s.placed = s.plan.length; s.total = s.alive;
  owner.wood -= cost;
  infra.bridges.push(s);
  leafBurst(s.cx, deckY + 1, s.cz, 14, '#b98d55');
  log(`🌉 ${nm(owner)} bridges the waters on the road to ${nm(owner === a ? b : a)}.`);
  return true;
}

function updateBridges() {
  infra.bridges = infra.bridges.filter(s => !s.dead && s.alive > 0);
  for (const [k, r] of infra.blocked) {
    if (!r.a.alive || !r.b.alive) { infra.blocked.delete(k); continue; }
    if (r.tries >= 4) continue;
    r.tries++;
    const owner = r.a.wood >= r.b.wood ? r.a : r.b;
    if (buildBridge(owner, r.a, r.b)) infra.blocked.delete(k);
  }
}

// ---------- inns ----------

function nearestNation(x, z, maxD) {
  let best = null, bd = maxD;
  for (const n of nations) {
    if (!n.alive) continue;
    for (const h of n.houses) {
      const d = Math.hypot(h.cx - x, h.cz - z);
      if (d < bd) { bd = d; best = n; }
    }
  }
  return best;
}

function farFromTowns(x, z) {
  for (const n of nations) if (n.alive) for (const h of n.houses) if (Math.hypot(h.cx - x, h.cz - z) < TOWN_GAP) return false;
  return true;
}

function updateInns() {
  infra.inns = infra.inns.filter(s => !s.dead && s.alive > 0);
  if (infra.inns.length >= 6) return;
  let best = null, bt = INN_TRAFFIC;
  for (const [c, t] of traffic) {
    if (t < bt) continue;
    const x = c % W, z = (c / W) | 0;
    if (!farFromTowns(x, z) || nearInn(x, z, INN_SPACING)) continue;
    best = { x, z }; bt = t;
  }
  if (!best) return;
  const n = nearestNation(best.x, best.z, 60);
  if (!n || n.wood < 18 || n.stone < 6) return;
  // a 7x7 plot beside the road, not on it
  for (let tries = 0; tries < 24; tries++) {
    const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 3;
    const x0 = Math.round(best.x + Math.cos(a) * d - 3), z0 = Math.round(best.z + Math.sin(a) * d - 3);
    if (x0 < 4 || z0 < 4 || x0 + 7 > W - 4 || z0 + 7 > D - 4) continue;
    let ok = true, mn = 99, mx = -1;
    for (let z = z0; z < z0 + 7 && ok; z++) for (let x = x0; x < x0 + 7; x++) {
      const o = colOcc[z * W + x];
      if (o && structs[o].kind !== 'tree') { ok = false; break; }
      const h = groundTop(x, z);
      if (h < SEA + 1) { ok = false; break; }
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    if (!ok || mx - mn > 2) continue;
    clearTrees(x0 - 1, z0 - 1, x0 + 7, z0 + 7, n);
    const g = flatten(x0, z0, 7);
    const s = newStruct('inn', { nation: n, x0, z0, g, cx: x0 + 3.5, cz: z0 + 3.5, visits: 0 });
    s.plan = housePlan(n.race, x0, z0, g, n.R.roof, false);
    s.plan.push([x0 + 3, g, z0 - 1, B.LOG], [x0 + 3, g + 1, z0 - 1, B.LOG], [x0 + 3, g + 2, z0 - 1, B.GOLD]); // signpost
    claimFoot(s, x0, z0 - 1, x0 + 6, z0 + 6);
    for (const [x, y, z, t] of s.plan) placeStruct(s, x, y, z, t);
    s.placed = s.plan.length; s.total = s.alive;
    n.wood -= 18; n.stone -= 6;
    infra.inns.push(s);
    leafBurst(s.cx, g + 3, s.cz, 16, '#b98d55');
    log(`🏨 ${nm(n)} opens a waystation inn at a busy crossroads.`);
    return;
  }
}

// Caravans passing an inn rest there: they heal, and the inn's nation earns the toll.
export function visitInns(u) {
  const t = u.trade;
  if (!t || !infra.inns.length) return;
  for (const i of infra.inns) {
    if (i.dead) continue;
    if (Math.hypot(i.cx - u.x, i.cz - u.z) > 8) continue;
    t.seen = t.seen || new Set();
    if (t.seen.has(i)) continue;
    t.seen.add(i);
    u.hp = u.maxHp;
    i.visits++;
    if (i.nation && i.nation.alive) {
      const fee = Math.min(u.nation.gold, 3);
      u.nation.gold -= fee; i.nation.gold += fee;
    }
  }
}

export function updateInfra(dt) {
  infraT -= dt;
  if (infraT > 0) return;
  infraT = 6;
  updateBridges();
  updateInns();
}
