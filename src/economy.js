// Economy: farms and hunger, three trade goods with scarcity prices, crises, laws and eras.
// Everything runs in plain sim-seconds (a year is YEAR seconds), independent of prosperity,
// so a bigger population simply needs more farms.
import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, B, structs, colOcc, groundTop, newStruct, placeStruct, removeStruct, flatten, claimFoot, owner, idx, get, set } from './world.js';
import { units, spawnUnit, killUnit, MAXU } from './units.js';
import { leafBurst } from './effects.js';
import { log } from './ui.js';
import { nations, game, nm, YEAR, rel, clearTrees } from './nations.js';
import { rand, pick } from './noise.js';

// ---------- goods & prices ----------

export const GOODS = {
  food: { icon: '🌾', base: 1, label: 'food' },
  wood: { icon: '🪵', base: 1.4, label: 'wood' },
  stone: { icon: '🪨', base: 2.2, label: 'stone' },
};

const target = (n, g) => g === 'food' ? n.units.size * 2 + 12 : g === 'wood' ? 40 + n.houses.length * 3 : 20 + n.houses.length * 2;
const reserve = (n, g) => g === 'food' ? n.units.size * 1.2 + 10 : g === 'wood' ? 24 : 8;

// Scarce goods cost more: price rises as stock falls below what the nation wants to hold.
export function price(n, g) {
  const r = Math.pow(target(n, g) / (n[g] + 3), 0.8);
  return GOODS[g].base * Math.min(4, Math.max(0.35, r));
}

// What a caravan from n should carry to dest: the good with the best price gap that n can spare.
export function pickCargo(n, dest, max) {
  let best = null, bs = -Infinity;
  for (const g of Object.keys(GOODS)) {
    const avail = n[g] - reserve(n, g);
    if (avail < 6) continue;
    const s = (price(dest, g) - price(n, g) + 0.15) * Math.min(avail, max);
    if (s > bs) { bs = s; best = g; }
  }
  if (!best) return null;
  const amount = Math.min(max, Math.floor((n[best] - reserve(n, best)) * 0.5));
  if (amount < 3) return null;
  n[best] -= amount;
  return { good: best, amount };
}

// Delivered cargo: the destination stocks it, the origin is paid; laws bend the split.
export function settleTrade(n, dest, good, amount, dist) {
  const value = amount * (price(n, good) + price(dest, good)) / 2 + dist * 0.2;
  let gain = value, tax = 0;
  if (dest.law === 'tariff') { tax = value * 0.3; gain -= tax; }
  if (n.law === 'free') gain *= 1.2;
  dest[good] += amount;
  n.gold += gain;
  dest.gold += tax;
  n.trips++;
  const r = rel(n, dest);
  const ease = n.law === 'free' ? 18 : dest.law === 'tariff' ? 4 : 12;
  r.tension = Math.max(-40, r.tension - ease);
  return { gain: Math.round(gain), tax: Math.round(tax) };
}

// ---------- laws ----------

export const LAWS = {
  none: { name: 'Common law', icon: '📜', hint: 'No special decree.' },
  free: { name: 'Free-Market Charter', icon: '⚖️', hint: 'Caravans run more often and pay 20% more; neighbours warm to the nation.' },
  tariff: { name: 'Tariff Edict', icon: '🛃', hint: 'Foreign caravans pay 30% of their profit to this nation, which sours relations.' },
  conscript: { name: 'Conscription Decree', icon: '🗡️', hint: 'More of the people are made soldiers, and fields lose 15% of their yield.' },
};
const LAW_ORDER = ['none', 'free', 'tariff', 'conscript'];

export const lawWar = n => n.law === 'conscript' ? 1.5 : 1;

export function cycleLaw(n) {
  const next = LAW_ORDER[(LAW_ORDER.indexOf(n.law) + 1) % LAW_ORDER.length];
  setLaw(n, next, true);
  n.lawT = 20;
}

function setLaw(n, law, byGod = false) {
  if (n.law === law) return;
  n.law = law;
  log(`${LAWS[law].icon} ${nm(n)} ${byGod ? 'is decreed' : 'adopts'} the ${LAWS[law].name}.`);
}

function reviewLaw(n) {
  const war = n.enemies.length > 0;
  let want = 'none';
  if (war) want = 'conscript';
  else if (n.gold < 25 && n.houses.length >= 3) want = 'tariff';
  else if (n.gold > 60 || n.trips >= 2) want = 'free';
  setLaw(n, want);
}

// ---------- farms ----------

export const FARM_SIZE = 5;
const CROP_YIELD = 26;       // food from a fully ripe farm
const RIPEN = 7;             // sim seconds from planting to harvest
const POP_EATS = 0.25;       // food per person per sim second (one per year)
const FORAGE = 0.09;         // hunting and gathering per person per sim second

const farmFoot = (x0, z0) => [x0, z0, x0 + FARM_SIZE - 1, z0 + FARM_SIZE - 1];

export function farmsNeeded(n) {
  const pop = n.units.size;
  return Math.min(40, Math.max(1, Math.ceil(pop * (POP_EATS - FORAGE) * 1.15 / (CROP_YIELD / RIPEN))));
}

function plantCrops(s, ripe) {
  const t = ripe ? B.WHEAT_RIPE : B.WHEAT;
  for (const [x, y, z] of s.plan) {
    if (get(x, y, z) && owner[idx(x, y, z)] !== s.id) continue; // something else stands here
    placeStruct(s, x, y, z, t);
  }
  s.placed = s.plan.length;
  s.total = Math.max(s.total, s.alive);
}

function findFarmSite(n) {
  const bases = n.houses;
  if (!bases.length) return null;
  for (let tries = 0; tries < 90; tries++) {
    const allowTrees = tries >= 30, rough = tries >= 60 ? 3 : 1;
    const base = pick(bases);
    const a = Math.random() * Math.PI * 2, d = rand(6, 11 + tries * 0.18);
    const x0 = Math.round(base.cx + Math.cos(a) * d - 2), z0 = Math.round(base.cz + Math.sin(a) * d - 2);
    if (x0 < 4 || z0 < 4 || x0 + FARM_SIZE > W - 4 || z0 + FARM_SIZE > D - 4) continue;
    let ok = true, mn = 99, mx = -1;
    for (let z = z0 - 1; z <= z0 + FARM_SIZE && ok; z++) for (let x = x0 - 1; x <= x0 + FARM_SIZE; x++) {
      const o = colOcc[z * W + x];
      if (o && !(allowTrees && structs[o].kind === 'tree')) { ok = false; break; }
      const h = groundTop(x, z);
      if (h < SEA + 1) { ok = false; break; }
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    if (!ok || mx - mn > rough) continue;
    if (nations.some(m => m !== n && m.alive && m.houses.some(h => Math.hypot(h.cx - x0 - 2, h.cz - z0 - 2) < 13))) continue;
    return { x0, z0, trees: allowTrees };
  }
  return null;
}

export function buildFarm(n, spot) {
  spot = spot || findFarmSite(n);
  if (!spot) return null;
  const { x0, z0 } = spot;
  clearTrees(x0 - 1, z0 - 1, x0 + FARM_SIZE, z0 + FARM_SIZE, n);
  const g = flatten(x0, z0, FARM_SIZE);
  const s = newStruct('farm', { nation: n, x0, z0, g, growT: rand(0, RIPEN * 0.5), ripe: false });
  for (let z = 0; z < FARM_SIZE; z++) for (let x = 0; x < FARM_SIZE; x++) {
    set(x0 + x, g - 1, z0 + z, B.FARM);       // tilled soil stays even if the crops burn
    if (z % 2 === 0) s.plan.push([x0 + x, g, z0 + z, B.WHEAT]);
  }
  claimFoot(s, ...farmFoot(x0, z0));
  plantCrops(s, false);
  n.farms.push(s);
  leafBurst(x0 + 2.5, g + 1, z0 + 2.5, 8, '#7a5a35');
  return s;
}

function tendFarms(n, dt, mult) {
  n.farms = n.farms.filter(f => {
    if (f.dead) return false;
    if (f.alive <= 2) { removeStruct(f, false); return false; }
    return true;
  });
  let yieldNow = 0;
  for (const f of n.farms) {
    f.growT += dt * (n.crisis && n.crisis.kind === 'famine' ? 0.6 : 1);
    if (!f.ripe && f.growT >= RIPEN * 0.6) { f.ripe = true; plantCrops(f, true); }
    if (f.growT >= RIPEN) {
      const frac = f.alive / Math.max(1, f.total);
      const food = CROP_YIELD * Math.min(1, frac) * mult;
      n.food += food;
      yieldNow += food;
      f.growT = 0; f.ripe = false;
      plantCrops(f, false); // replant: burnt rows grow back
      leafBurst(f.x0 + 2.5, f.g + 1, f.z0 + 2.5, 10, '#e3b93c');
    }
  }
  return yieldNow;
}

// ---------- per-nation tick ----------

export function initEconomy(n) {
  Object.assign(n, { food: 40, stone: 12, gold: 20, farms: [], law: 'none', lawT: rand(6, 14), crisis: null, starving: false, hungerT: 0, ecoT: 0 });
}

export function seedFarm(n) { return buildFarm(n); }

export function updateEconomy(n, dt) {
  const pop = n.units.size;
  let mult = 1;
  if (n.crisis) {
    n.crisis.t -= dt / YEAR;
    if (n.crisis.t <= 0) {
      log(`🌤️ The ${CRISES[n.crisis.kind].name.toLowerCase()} of ${nm(n)} is over.`);
      n.crisis = null;
    } else if (n.crisis.kind === 'famine') mult = 0.25;
    else if (n.crisis.kind === 'harvest') mult = 2;
  }
  if (n.law === 'conscript') mult *= 0.85;

  tendFarms(n, dt, mult);
  n.food += pop * FORAGE * dt;
  n.food -= pop * POP_EATS * dt * (n.law === 'conscript' ? 1.1 : 1);
  n.stone += n.houses.length * 0.05 * dt;       // quarrying
  n.food = Math.min(n.food, pop * 8 + 60);       // granaries only hold so much; the surplus spoils
  n.stone = Math.min(n.stone, 150);

  n.ecoT += dt;
  if (n.ecoT >= 1) {
    n.ecoT = 0;
    // the market: gold buys food when the granary runs dry, and timber when building stalls
    if (n.food < pop * 0.6 && n.gold >= 8) {
      const pay = Math.min(n.gold, 8 + pop * 0.5);
      n.gold -= pay; n.food += pay / price(n, 'food');
    }
    if (n.wood < 10 && n.gold >= 15) { n.gold -= 15; n.wood += Math.round(15 / price(n, 'wood')); }
    if (n.gold > 120) { n.gold -= 40; n.wood += Math.max(1, Math.round(40 / price(n, 'wood'))); } // surplus coin buys timber
    n.gold += (n.law === 'tariff' ? 0.2 : 0) * n.houses.length; // customs at the gate
    n.gold = Math.max(0, n.gold);
  }

  if (n.food <= 0) {
    n.food = 0;
    n.hungerT += dt;
    if (!n.starving && n.hungerT > 1.5) {
      n.starving = true;
      log(`☠️ Famine grips ${nm(n)}: the granaries are empty.`);
    }
    if (n.starving && n.hungerT > 2.4) {
      n.hungerT = 1.5;
      let k = Math.max(1, Math.round(pop * 0.05));
      for (const u of n.units) {
        if (k <= 0) break;
        if (u.possessed || u.role === 'caravan' || Math.random() > 0.35) continue;
        killUnit(u, 'hunger'); k--;
      }
    }
  } else if (n.food > pop * 0.5) {
    if (n.starving) log(`🍞 The hunger in ${nm(n)} is over.`);
    n.starving = false; n.hungerT = 0;
  } else n.hungerT = Math.max(0, n.hungerT - dt);

  n.lawT -= dt / YEAR;
  if (n.lawT <= 0) { n.lawT = rand(8, 16); reviewLaw(n); }
}

// Farming and building decisions, run from the nation's slow build timer.
export function economyBuild(n) {
  const need = farmsNeeded(n);
  if (n.farms.length < need && n.wood >= 6 && n.houses.length >= 1) {
    if (buildFarm(n)) n.wood -= 6;
  }
}

// ---------- crises ----------

export const CRISES = {
  famine: { name: 'Famine', icon: '🥀' },
  harvest: { name: 'Bountiful harvest', icon: '🌽' },
  goldrush: { name: 'Gold rush', icon: '⛏️' },
};

export function startCrisis(n, kind) {
  if (!n.alive) return;
  if (kind === 'goldrush') {
    n.gold += 90 + n.houses.length * 6;
    let k = 0;
    for (let i = 0; i < 4 && units.length < MAXU && n.houses.length; i++) {
      const h = pick(n.houses);
      spawnUnit(n, h.x0 + 3.5, h.z0 + 0.5, { y: h.g + 1, age: 20 }); k++;
    }
    log(`⛏️ Gold is found in the hills near ${nm(n)}! Prospectors flood in.`);
    return;
  }
  n.crisis = { kind, t: kind === 'famine' ? 5 : 4 };
  if (kind === 'famine') {
    n.food *= 0.5;
    log(`🥀 Drought and blight: a famine threatens ${nm(n)}.`);
  } else {
    n.food += 20;
    log(`🌽 A bountiful harvest blesses ${nm(n)}.`);
  }
}

let eventT = rand(10, 16);

function updateCrises(dt) {
  eventT -= dt / YEAR;
  if (eventT > 0) return;
  eventT = rand(12, 26);
  const alive = nations.filter(n => n.alive);
  if (!alive.length) return;
  const n = pick(alive);
  const kind = pick(['famine', 'harvest', 'goldrush', 'harvest', 'famine']);
  if (n.crisis && kind !== 'goldrush') return;
  startCrisis(n, kind);
}

// ---------- eras ----------

export const ERAS = [
  { name: 'Age of Dawn', from: 0, war: 0.8, sun: '#fff4e0', si: 2.3, hemi: '#d8ecff', hi: 1.15 },
  { name: 'Age of Bronze', from: 45, war: 1.0, sun: '#ffe7b8', si: 2.3, hemi: '#e8e0c8', hi: 1.1 },
  { name: 'Age of Iron', from: 110, war: 1.25, sun: '#dfe8f4', si: 2.15, hemi: '#c8d4e4', hi: 1.05 },
  { name: 'Age of Embers', from: 190, war: 1.6, sun: '#ff9a5e', si: 1.9, hemi: '#e6b496', hi: 0.95 },
  { name: 'Golden Age', from: 270, war: 0.65, sun: '#ffe08a', si: 2.5, hemi: '#fff0c8', hi: 1.25 },
];
const CYCLE_FROM = 45, CYCLE_LEN = 330;

export function eraAt(year) {
  let y = year;
  if (y >= CYCLE_FROM + CYCLE_LEN) y = CYCLE_FROM + ((y - CYCLE_FROM) % CYCLE_LEN);
  let e = ERAS[0];
  for (const c of ERAS) if (y >= c.from) e = c;
  return e;
}

export const eraState = { era: ERAS[0], sun: new THREE.Color(ERAS[0].sun), hemi: new THREE.Color(ERAS[0].hemi), si: ERAS[0].si, hi: ERAS[0].hi };
export const warMult = () => eraState.era.war;

function updateEra(dt) {
  const e = eraAt(game.year);
  if (e !== eraState.era) {
    eraState.era = e;
    log(`🕰️ The <b>${e.name}</b> begins.`);
  }
  const k = 1 - Math.exp(-dt * 0.6);
  eraState.sun.lerp(new THREE.Color(e.sun), k);
  eraState.hemi.lerp(new THREE.Color(e.hemi), k);
  eraState.si += (e.si - eraState.si) * k;
  eraState.hi += (e.hi - eraState.hi) * k;
}

export function updateWorldEconomy(dt) {
  updateCrises(dt);
  updateEra(dt);
}
