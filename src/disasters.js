// Divine disasters that leave lasting marks: earthquakes, plague, floods, volcanoes and the
// harvest blessing. Terrain changes are permanent; the plague travels with people and caravans.
import { W, D, H, SEA, B, get, set, topAt, colOcc, structs, isWaterCol, idx, owner } from './world.js';
import { units, damageUnit, killUnit } from './units.js';
import { nations, nm, YEAR } from './nations.js';
import { startCrisis } from './economy.js';
import { fx, spawnDebris, igniteArea, smokeColumn, lavaSpray, dustCloud, sickPuff, splash, glow, shockRing, leafBurst } from './effects.js';
import { log } from './ui.js';
import { rand } from './noise.js';

export const disasterStats = { quakes: 0, floods: 0, volcanoes: 0, plagueDeaths: 0, plagueSick: 0 };

function nationNear(x, z, maxD = 40) {
  let best = null, bd = maxD;
  for (const n of nations) {
    if (!n.alive) continue;
    for (const h of n.houses) { const d = Math.hypot(h.cx - x, h.cz - z); if (d < bd) { bd = d; best = n; } }
  }
  return best;
}

// Remove up to `depth` voxels from a column: a standing structure first, else the ground.
function cutColumn(x, z, depth, floor = SEA - 2) {
  if (x < 1 || z < 1 || x >= W - 1 || z >= D - 1) return;
  for (let i = 0; i < depth; i++) {
    const y = topAt(x, z);
    if (y <= floor || y < 2) return;
    const t = get(x, y, z);
    if (!t) return;
    if (Math.random() < 0.3) spawnDebris(x + 0.5, y + 0.8, z + 0.5, rand(-1.5, 1.5), rand(2, 5), rand(-1.5, 1.5), t, 0.3);
    set(x, y, z, B.AIR);
  }
}

// ---------- earthquake ----------

const quakes = [];

export function startEarthquake(x, z) {
  const R = 15;
  const fis = [];
  const seen = new Set();
  for (let f = 0; f < 3; f++) {
    const a = Math.random() * Math.PI * 2;
    let cx = x, cz = z, dir = a;
    for (let d = 0; d < R * 1.3; d += 0.7) {
      dir += rand(-0.25, 0.25);
      cx += Math.cos(dir) * 0.7; cz += Math.sin(dir) * 0.7;
      const k = Math.floor(cz) * W + Math.floor(cx);
      if (!seen.has(k)) { seen.add(k); fis.push([Math.floor(cx), Math.floor(cz)]); }
    }
  }
  quakes.push({ x, z, R, t: 5, tick: 0, fis, fi: 0 });
  disasterStats.quakes++;
  const n = nationNear(x, z, 30);
  log(`🌋 The earth splits${n ? ` beneath ${nm(n)}` : ''}: an earthquake!`);
}

function tickQuake(q, dt) {
  q.t -= dt;
  fx.shake = Math.max(fx.shake, 1.3);
  q.tick -= dt;
  if (q.tick > 0) return;
  q.tick = 0.12;
  for (let k = 0; k < 9 && q.fi < q.fis.length; k++, q.fi++) {
    const [cx, cz] = q.fis[q.fi];
    cutColumn(cx, cz, 3); cutColumn(cx + 1, cz, 2); cutColumn(cx, cz + 1, 2);
    if (Math.random() < 0.4) dustCloud(cx + 0.5, topAt(cx, cz) + 1, cz + 0.5, 4, 1.5);
  }
  for (let k = 0; k < 20; k++) {
    const a = Math.random() * Math.PI * 2, r = q.R * Math.sqrt(Math.random());
    const cx = Math.floor(q.x + Math.cos(a) * r), cz = Math.floor(q.z + Math.sin(a) * r);
    if (cx < 1 || cz < 1 || cx >= W - 1 || cz >= D - 1) continue;
    const oc = colOcc[cz * W + cx];
    if (oc && structs[oc] && (structs[oc].kind === 'house' || structs[oc].kind === 'inn' || structs[oc].kind === 'bridge')) {
      if (Math.random() < 0.6) cutColumn(cx, cz, 2);
    } else if (Math.random() < 0.4) cutColumn(cx, cz, 1);
    if (Math.random() < 0.2) dustCloud(cx + 0.5, topAt(cx, cz) + 1, cz + 0.5, 3, 1);
  }
  for (const u of units) {
    if (!u.alive || u.held || u.flying || u.possessed) continue;
    if (Math.hypot(u.x - q.x, u.z - q.z) > q.R) continue;
    if (Math.random() < 0.06) { u.flying = true; u.vy = rand(3, 5); u.vx = rand(-2, 2); u.vz = rand(-2, 2); damageUnit(u, rand(0.3, 1.2), null, 'fall'); }
  }
}

// ---------- flood ----------

const floods = [];

export function startFlood(x, z) {
  floods.push({ x, z, R: 15, t: 0, dur: 5, done: new Set() });
  disasterStats.floods++;
  const n = nationNear(x, z, 30);
  log(`🌊 A great flood sweeps the lowlands${n ? ` of ${nm(n)}` : ''}.`);
}

function tickFlood(f, dt) {
  f.t += dt;
  const r = 2 + (f.R - 2) * Math.min(1, f.t / f.dur);
  const x0 = Math.floor(f.x - f.R), x1 = Math.ceil(f.x + f.R), z0 = Math.floor(f.z - f.R), z1 = Math.ceil(f.z + f.R);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (x < 1 || z < 1 || x >= W - 1 || z >= D - 1) continue;
    const d = Math.hypot(x + 0.5 - f.x, z + 0.5 - f.z);
    if (d > r) continue;
    const key = z * W + x;
    if (f.done.has(key)) continue;
    f.done.add(key);
    const top = topAt(x, z);
    if (top < SEA || top > SEA + 3) continue; // hills stay dry
    // sweep away whatever stands here, then let the land sink under the water
    for (let y = top; y >= SEA; y--) set(x, y, z, B.AIR);
    if (!get(x, SEA - 1, z)) set(x, SEA - 1, z, B.SAND);
    if (Math.random() < 0.18) splash(x + 0.5, z + 0.5, 6);
  }
  fx.shake = Math.max(fx.shake, 0.4);
  for (const u of units) {
    if (!u.alive || u.held || u.possessed) continue;
    const d = Math.hypot(u.x - f.x, u.z - f.z);
    if (d < r && d > r - 3 && u.y < SEA + 4 && !u.flying && Math.random() < dt * 2) { u.flying = true; u.vy = 4; u.vx = (u.x - f.x) / (d || 1) * 3; u.vz = (u.z - f.z) / (d || 1) * 3; }
  }
}

// ---------- volcano ----------

const volcanoes = [];
const bombs = [];
const lavaCool = [];
const MAX_VOLCANOES = 4;

export function startVolcano(x, z) {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (isWaterCol(cx, cz) || topAt(cx, cz) < SEA) return false;
  if (volcanoes.length >= MAX_VOLCANOES) return false;
  const base = topAt(cx, cz);
  volcanoes.push({ x: cx, z: cz, base, h: 13, R: 8, layer: 0, tick: 0, state: 'rising', erupt: 0, next: 0, bt: 0 });
  disasterStats.volcanoes++;
  const n = nationNear(cx, cz, 35);
  log(`🌋 The ground swells${n ? ` near ${nm(n)}` : ''}: a volcano is born!`);
  fx.shake = Math.min(2.2, fx.shake + 1);
  return true;
}

const heightAt = (v, dist) => {
  if (dist > v.R) return -1;
  let h = Math.floor(v.h * Math.pow(1 - dist / v.R, 0.85));
  if (dist < 2.2) h = v.h - 3;
  return h;
};

function raise(v) {
  const L = v.layer;
  const R = Math.ceil(v.R);
  for (let z = v.z - R; z <= v.z + R; z++) for (let x = v.x - R; x <= v.x + R; x++) {
    if (x < 1 || z < 1 || x >= W - 1 || z >= D - 1) continue;
    const dist = Math.hypot(x - v.x, z - v.z) + (Math.random() - 0.5) * 0.8;
    const h = heightAt(v, dist);
    if (h < L) continue;
    const oc = colOcc[z * W + x];
    if (oc && structs[oc] && !structs[oc].dead && structs[oc].kind !== 'tree') continue; // buildings are not buried
    // ground below the cone's base is filled in on the first layers
    const y0 = L === 0 ? Math.min(topAt(x, z), v.base) + 1 : v.base + L;
    for (let y = y0; y <= v.base + L; y++) {
      if (get(x, y, z)) continue;
      set(x, y, z, Math.random() < 0.45 ? B.BASALT : B.STONE);
    }
    if (dist < 2.2 && L === v.h - 3) set(x, v.base + L, z, B.LAVA);
  }
  dustCloud(v.x + 0.5, v.base + L + 1, v.z + 0.5, 6, v.R * 0.6);
  fx.shake = Math.max(fx.shake, 1.0);
}

function eruption(v, secs) {
  v.state = 'erupting';
  v.erupt = secs;
  v.bt = 0;
  log(`🌋 The volcano near ${nationNear(v.x, v.z, 40) ? nm(nationNear(v.x, v.z, 40)) : 'the wilds'} erupts!`);
  glow(v.x + 0.5, v.base + v.h + 4, v.z + 0.5, 0xff7a30, 20000);
  shockRing(v.x + 0.5, v.base + v.h, v.z + 0.5, 28);
}

function throwBomb(v, small) {
  const a = Math.random() * Math.PI * 2, s = rand(4, small ? 8 : 12);
  bombs.push({ x: v.x + 0.5, y: v.base + v.h, z: v.z + 0.5, vx: Math.cos(a) * s, vy: rand(16, 26), vz: Math.sin(a) * s });
}

function tickVolcano(v, dt) {
  if (v.state === 'rising') {
    v.tick -= dt;
    if (v.tick <= 0) {
      v.tick = 0.4;
      raise(v);
      if (++v.layer > v.h - 3) { v.layer = v.h - 3; eruption(v, 14); }
    }
    return;
  }
  const top = v.base + v.h;
  if (v.state === 'erupting') {
    v.erupt -= dt;
    fx.shake = Math.max(fx.shake, 0.7);
    v.bt -= dt;
    if (v.bt <= 0) { v.bt = 0.3; for (let k = 0; k < 2 + (Math.random() < 0.5 ? 1 : 0); k++) throwBomb(v, v.small); }
    smokeColumn(v.x + 0.5, top + 1, v.z + 0.5, 3);
    lavaSpray(v.x + 0.5, top + 0.5, v.z + 0.5, 4, 12);
    if (v.erupt <= 0) { v.state = 'dormant'; v.next = rand(26, 46); v.small = true; }
  } else if (v.state === 'dormant') {
    if (Math.random() < dt * 2) smokeColumn(v.x + 0.5, top + 1, v.z + 0.5, 1);
    v.next -= dt / YEAR;
    if (v.next <= 0) eruption(v, 6);
  }
}

function tickBombs(dt) {
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.vy -= 26 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    lavaSpray(b.x, b.y, b.z, 1, 1);
    const cx = Math.floor(b.x), cz = Math.floor(b.z);
    if (cx < 1 || cz < 1 || cx >= W - 1 || cz >= D - 1) { bombs.splice(i, 1); continue; }
    const g = topAt(cx, cz) + 1;
    if (b.vy < 0 && b.y <= g) {
      bombs.splice(i, 1);
      if (g <= SEA) { splash(b.x, b.z, 18); continue; }
      igniteArea(cx, g, cz, 2.5, 0.6);
      lavaSpray(b.x, g, b.z, 10, 6);
      for (const u of units) if (u.alive && !u.held && Math.hypot(u.x - b.x, u.z - b.z) < 2.4) { u.onFire = 4; damageUnit(u, 4, null, 'fire'); }
      const oc = colOcc[cz * W + cx];
      if (!oc && !get(cx, g, cz) && g < H - 2) { set(cx, g, cz, B.LAVA); lavaCool.push({ x: cx, y: g, z: cz, t: rand(6, 11) }); }
      else if (oc && structs[oc] && !structs[oc].dead && structs[oc].kind !== 'tree') cutColumn(cx, cz, 2);
    }
  }
}

function tickLava(dt) {
  for (let i = lavaCool.length - 1; i >= 0; i--) {
    const l = lavaCool[i];
    l.t -= dt;
    if (l.t > 0) continue;
    if (get(l.x, l.y, l.z) === B.LAVA) set(l.x, l.y, l.z, B.BASALT);
    lavaCool.splice(i, 1);
  }
  // lava burns whoever stands on or in it
  if (!lavaCool.length && !volcanoes.length) return;
  for (const u of units) {
    if (!u.alive || u.held || u.flying) continue;
    const x = Math.floor(u.x), z = Math.floor(u.z), y = Math.floor(u.y - 0.1);
    if (get(x, y, z) === B.LAVA || get(x, y + 1, z) === B.LAVA) { u.onFire = 4; damageUnit(u, 6 * dt, null, 'fire'); }
  }
}

// ---------- plague ----------

let plagueLive = false, plagueScan = 0;
const plagueNations = new Set();

function infect(u) {
  u.plague = 14;
  u.plagueDmg = rand(0.55, 1.15);
  disasterStats.plagueSick++;
}

export function startPlague(x, z) {
  const near = units.filter(u => u.alive && !u.held && Math.hypot(u.x - x, u.z - z) < 7).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)).slice(0, 5);
  if (!near.length) return 0;
  for (const u of near) if (!(u.plague > 0)) infect(u);
  plagueLive = true;
  plagueNations.clear();
  plagueNations.add(near[0].nation);
  log(`☠️ A plague breaks out among the people of ${nm(near[0].nation)}.`);
  return near.length;
}

function tickPlague(dt) {
  if (!plagueLive) {
    for (const u of units) if (u.immune > 0) u.immune -= dt;
    return;
  }
  let sick = 0;
  plagueScan -= dt;
  const spread = plagueScan <= 0;
  if (spread) plagueScan = 0.5;
  for (const u of units) {
    if (!u.alive) continue;
    if (u.immune > 0) u.immune -= dt;
    if (!(u.plague > 0)) continue;
    sick++;
    u.plague -= dt;
    if (Math.random() < dt * 4) sickPuff(u.x, u.y + 1.3, u.z);
    damageUnit(u, u.plagueDmg * dt, null, 'plague');
    if (!u.alive) { disasterStats.plagueDeaths++; continue; }
    if (u.plague <= 0) { u.plague = 0; u.immune = 40; continue; }
    if (!spread) continue;
    for (const v of units) {
      if (v === u || !v.alive || v.plague > 0 || v.immune > 0 || v.held) continue;
      if (Math.abs(v.x - u.x) > 2.4 || Math.abs(v.z - u.z) > 2.4) continue;
      if (Math.random() < 0.28) {
        infect(v);
        if (!plagueNations.has(v.nation)) { plagueNations.add(v.nation); log(`☠️ The plague reaches ${nm(v.nation)}.`); }
      }
    }
  }
  if (!sick) {
    plagueLive = false;
    log(`🕊️ The plague burns itself out after claiming ${disasterStats.plagueDeaths} lives.`);
    disasterStats.plagueDeaths = 0;
  }
}

// ---------- harvest blessing ----------

export function blessHarvest(x, z) {
  const n = nationNear(x, z, 80);
  if (!n) return null;
  if (n.crisis && n.crisis.kind === 'harvest') n.crisis.t = Math.max(n.crisis.t, 4);
  else { if (n.crisis) n.crisis = null; startCrisis(n, 'harvest'); }
  n.food += 15;
  for (const f of n.farms) {
    if (f.dead) continue;
    f.growT = 1e3; // ripe: harvested on the next tick
    leafBurst(f.x0 + 2.5, f.g + 2, f.z0 + 2.5, 8, '#f2c443');
  }
  return n;
}

export function updateDisasters(dt) {
  for (let i = quakes.length - 1; i >= 0; i--) { tickQuake(quakes[i], dt); if (quakes[i].t <= 0) quakes.splice(i, 1); }
  for (let i = floods.length - 1; i >= 0; i--) { tickFlood(floods[i], dt); if (floods[i].t >= floods[i].dur + 1) floods.splice(i, 1); }
  for (const v of volcanoes) tickVolcano(v, dt);
  tickBombs(dt);
  tickLava(dt);
  tickPlague(dt);
}
