// Nations: kingdoms that grow, build, crown kings, make alliances and wage war on their own.
import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, B, structs, colOcc, topAt, groundTop, newStruct, placeStruct, removeStruct, flatten, housePlan, claimFoot, damaged } from './world.js';
import { units, spawnUnit, killUnit, setState, MAXU } from './units.js';
import { leafBurst, spawnDebris } from './effects.js';
import { log } from './ui.js';
import { rand, pick } from './noise.js';
import { initEconomy, seedFarm, updateEconomy, economyBuild, updateWorldEconomy, pickCargo, settleTrade, lawWar, warMult, GOODS } from './economy.js';

export const YEAR = 4; // sim seconds per year
export const game = { year: 1, yearT: 0, prosperity: 1 };
export const nations = [];
const rels = new Map();
let nextNid = 1, dipT = 0;

export const RACES = {
  human: {
    label: 'Humans', color: '#4f86f0', roof: B.ROOF_H, perHouse: 4, birth: 4, warRatio: 0.4, aggression: 1, ruler: 'King',
    realm: p => `Kingdom of ${p}`,
    places: ['Aldmere', 'Westmarch', 'Brightvale', 'Dunhollow', 'Ravenford', 'Highgarth', 'Stonebridge', 'Ashwick'],
    syl: [['Al', 'Ed', 'Ro', 'Ga', 'El', 'Ma', 'Os', 'Be', 'Ce', 'Is', 'To', 'Wy', 'Ha', 'Ri', 'Ber', 'Gwen', 'Ul', 'Ar', 'Wil', 'Ann'],
      ['dric', 'mund', 'wan', 'reth', 'inor', 'tilda', 'ric', 'atrix', 'olde', 'bin', 'nn', 'lden', 'chard', 'tram', 'dolyn', 'fric', 'thur', 'helm', 'ora']],
  },
  goblin: {
    label: 'Goblins', color: '#d9573c', roof: B.ROOF_G, perHouse: 5, birth: 3, warRatio: 0.6, aggression: 1.6, ruler: 'Warboss',
    realm: p => `the ${p} Horde`,
    places: ['Gutrot', 'Skragg', 'Mudfang', 'Grimtooth', 'Rotbelly', 'Snaggle', 'Bonegnaw', 'Filthmire'],
    syl: [['Gr', 'Sk', 'Zug', 'Nak', 'Rot', 'Gob', 'Snik', 'Brak', 'Muk', 'Grim', 'Zog', 'Krag', 'Ug', 'Snot', 'Gnar'],
      ['ak', 'ug', 'nash', 'gut', 'tooth', 'bag', 'rik', 'za', 'lok', 'nob', 'grub', 'fang', 'gash', 'skull']],
  },
  elf: {
    label: 'Elves', color: '#b58cf0', roof: B.ROOF_E, perHouse: 3, birth: 6, warRatio: 0.35, aggression: 0.7, ruler: 'High Elder',
    realm: p => `Realm of ${p}`,
    places: ['Sylvaris', 'Elenwë', 'Lothmira', 'Aelindor', 'Ithilwood', 'Caras Vael', 'Nimloth'],
    syl: [['Ae', 'Li', 'Tha', 'Syl', 'Ith', 'Fae', 'Nae', 'Elo', 'Cala', 'Vae', 'Ara', 'Ely', 'Gala', 'Lue', 'Mir'],
      ['lar', 'rael', 'lion', 'wen', 'il', 'lan', 'ris', 'wyn', 'dir', 'lith', 'nor', 'sse', 'driel', 'thien', 'iel']],
  },
};

export const nm = n => `<b style="color:${n.css}">${n.name}</b>`;

function genName(race) {
  const [a, b] = RACES[race].syl;
  return pick(a) + pick(b);
}

function pickPlace(race) {
  const used = new Set(nations.map(n => n.place));
  const free = RACES[race].places.filter(p => !used.has(p));
  return free.length ? pick(free) : genName(race) + (race === 'goblin' ? 'gash' : 'mar');
}

export function rel(a, b) {
  const k = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
  let r = rels.get(k);
  if (!r) { r = { tension: rand(0, 20), war: false, ally: false, warT: 0 }; rels.set(k, r); }
  return r;
}

function refreshDiplomacy() {
  for (const n of nations) {
    n.enemies = nations.filter(m => m.alive && m !== n && n.alive && rel(n, m).war);
    n.allies = nations.filter(m => m.alive && m !== n && n.alive && rel(n, m).ally);
  }
}

// ---------- houses ----------

function createHouse(n, x0, z0, g, capital) {
  const s = newStruct('house', { nation: n, x0, z0, g, cx: x0 + 3.5, cz: z0 + 3.5, capital, built: false, builders: new Set() });
  s.plan = housePlan(n.race, x0, z0, g, n.R.roof, capital);
  s.total = s.plan.length;
  claimFoot(s, x0, z0, x0 + 6, z0 + 6);
  return s;
}

export function placeNext(s) {
  if (s.dead || s.placed >= s.plan.length) return false;
  const [x, y, z, t] = s.plan[s.placed++];
  placeStruct(s, x, y, z, t);
  if (s.placed >= s.plan.length) {
    s.built = true;
    s.total = s.alive;
    const n = s.nation;
    const si = n.sites.indexOf(s);
    if (si >= 0) n.sites.splice(si, 1);
    if (!n.houses.includes(s)) n.houses.push(s);
    return false;
  }
  return true;
}

export function detachHouse(s) {
  const n = s.nation;
  if (!n) return;
  const i = n.houses.indexOf(s);
  if (i >= 0) n.houses.splice(i, 1);
  const si = n.sites.indexOf(s);
  if (si >= 0) n.sites.splice(si, 1);
  if (s.capital && n.alive) {
    log(`🔥 The capital of ${nm(n)} lies in ruins.`);
    const next = n.houses[0];
    if (next) { n.capital = { x: next.cx, z: next.cz }; }
  }
}

function ruinHouse(s) {
  removeStruct(s, false); // voxels stay where they are: ruins
  detachHouse(s);
}

export function clearTrees(x0, z0, x1, z1, n) {
  for (let i = 1; i < structs.length; i++) {
    const s = structs[i];
    if (s.dead || s.kind !== 'tree') continue;
    if (s.x >= x0 && s.x <= x1 && s.z >= z0 && s.z <= z1) {
      removeStruct(s);
      if (n) n.wood += 4;
    }
  }
}

function findSite(n, rough = 2) {
  for (let tries = 0; tries < 70; tries++) {
    const allowTrees = tries >= 35;
    const bases = n.houses.length ? n.houses : n.sites;
    const base = bases.length ? pick(bases) : null;
    const bx = base ? base.cx : n.capital.x, bz = base ? base.cz : n.capital.z;
    const a = Math.random() * Math.PI * 2, d = rand(8, 15 + tries * 0.15);
    const x0 = Math.round(bx + Math.cos(a) * d - 3.5), z0 = Math.round(bz + Math.sin(a) * d - 3.5);
    if (x0 < 4 || z0 < 4 || x0 + 7 > W - 4 || z0 + 7 > D - 4) continue;
    let ok = true, mn = 99, mx = -1;
    for (let z = z0; z < z0 + 7 && ok; z++) for (let x = x0; x < x0 + 7; x++) {
      const o = colOcc[z * W + x];
      if (o && !(allowTrees && structs[o].kind === 'tree')) { ok = false; break; }
      const h = groundTop(x, z);
      if (h < SEA + 1) { ok = false; break; }
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    if (!ok || mx - mn > rough) continue;
    if (nations.some(m => m !== n && m.alive && [...m.houses, ...m.sites].some(h => Math.hypot(h.cx - x0 - 3.5, h.cz - z0 - 3.5) < 13))) continue;
    return { x0, z0 };
  }
  return null;
}

// ---------- nations ----------

export function createNation(race, x, z) {
  const R = RACES[race];
  const place = pickPlace(race);
  const n = {
    id: nextNid++, race, R, place, name: R.realm(place), css: R.color, color: new THREE.Color(R.color),
    alive: true, wood: 24, houses: [], sites: [], capital: { x, z }, king: null, units: new Set(),
    founded: game.year, birthT: 0, buildT: rand(0, 2), enemies: [], allies: [], genName: () => genName(race),
    caravanT: rand(8, 16), caravans: 0, trips: 0,
  };
  initEconomy(n);
  n.armor = n.color.clone().lerp(new THREE.Color('#6d727b'), 0.45);
  nations.push(n);

  const x0 = Math.max(5, Math.min(W - 12, Math.round(x) - 3));
  const z0 = Math.max(5, Math.min(D - 12, Math.round(z) - 3));
  clearTrees(x0 - 2, z0 - 2, x0 + 8, z0 + 8);
  const g = flatten(x0, z0, 7);
  const h = createHouse(n, x0, z0, g, true);
  while (placeNext(h));
  n.capital = { x: h.cx, z: h.cz };
  seedFarm(n);

  n.king = spawnUnit(n, x0 + 3.5, z0 + 0.5, { role: 'king', age: Math.floor(rand(24, 38)), y: g + 1 });
  for (let i = 0; i < 6; i++) spawnUnit(n, x0 + rand(0.5, 6.5), z0 + 0.5, { y: g + 1 });
  refreshDiplomacy();
  return n;
}

// The heir is the eldest adult with years still ahead of them, else whoever is left.
function crown(n) {
  let heir = null, fallback = null;
  for (const u of n.units) {
    if (!u.alive || u.possessed || u.role === 'caravan') continue;
    if (!fallback || u.age > fallback.age) fallback = u;
    if (u.age < 18 || u.maxAge - u.age < 12) continue;
    if (!heir || u.age > heir.age) heir = u;
  }
  heir = heir || fallback;
  if (heir) { heir.role = 'king'; setState(heir, 'idle'); }
  n.king = heir;
  return heir;
}

const DEATHS = {
  age: u => `died of old age at ${u.age}`,
  meteor: () => 'was crushed by a falling star',
  lightning: () => 'was struck down by lightning',
  fire: () => 'burned to death',
  splat: () => 'was hurled to their death by the hand of god',
  blast: () => 'was swept away by divine wrath',
  drown: () => 'drowned',
  fall: () => 'fell to their death',
  hunger: () => 'starved',
};

export function onUnitDeath(u, cause, by) {
  const n = u.nation;
  if (n.king !== u) return;
  n.king = null;
  let how = DEATHS[cause] ? DEATHS[cause](u) : 'perished';
  if (cause === 'battle' && by) how = `was slain by ${by.name} of ${nm(by.nation)}`;
  const heir = crown(n);
  log(`👑 ${n.R.ruler} ${u.name} of ${nm(n)} ${how}.` + (heir ? ` ${heir.name} inherits the throne.` : ''));
  if (heir) for (const m of nations) if (m !== n && m.alive) rel(n, m).tension += rand(0, 25);
}

function fallNation(n) {
  n.alive = false;
  for (const h of [...n.houses]) removeStruct(h, false);
  for (const st of n.sites) removeStruct(st, false);
  for (const f of n.farms) removeStruct(f, false);
  n.farms.length = 0;
  n.houses.length = 0;
  n.sites.length = 0;
  for (const m of nations) if (m !== n) { const r = rel(n, m); r.war = false; r.ally = false; }
  log(`🏚️ ${nm(n)} has fallen. Only ruins remain.`);
  refreshDiplomacy();
}

// ---------- trade caravans ----------
// A nation with a few houses and spare wood periodically sends a caravan to a peaceful
// neighbour's capital. The trip follows (and wears down) roads; on arrival both sides gain
// wood and relations warm. A caravan that is cut down loses its cargo.

const CARAVAN_EVERY = 22;     // sim seconds between a nation's departures
const CARAVAN_CARGO = 12;
export const tradeStats = { trips: 0 };

const homeHouse = n => n.houses.find(h => h.capital) || n.houses[0];

function maybeSendCaravan(n, dt) {
  n.caravanT -= dt * Math.min(game.prosperity, 4) * (n.law === 'free' ? 1.6 : 1);
  if (n.caravanT > 0) return;
  n.caravanT = CARAVAN_EVERY * rand(0.8, 1.3);
  if (n.caravans >= 1 || n.houses.length < 2 || units.length >= MAXU - 8) return;
  const partners = nations.filter(m => m.alive && m !== n && m.houses.length && !rel(n, m).war);
  if (!partners.length) return;
  const dest = pick(partners);
  const from = homeHouse(n), to = homeHouse(dest);
  const load = pickCargo(n, dest, CARAVAN_CARGO);
  if (!load) return;
  n.caravans++;
  const u = spawnUnit(n, from.x0 + 3.5, from.z0 + 0.5, { role: 'caravan', age: 22, y: from.g + 1 });
  u.trade = { dest, gx: to.cx, gz: to.cz, cargo: load.amount, good: load.good, sx: u.x, sz: u.z };
  setState(u, 'trade');
}

function endTrade(u) {
  if (u.trade) { u.trade = null; u.nation.caravans = Math.max(0, u.nation.caravans - 1); }
}

// Delivered: the destination gains the cargo, the origin earns it back with a profit that
// grows with the distance travelled, and both nations' tension eases.
export function arriveCaravan(u) {
  const t = u.trade;
  if (!t) return;
  const n = u.nation, d = t.dest;
  const dist = Math.hypot(t.gx - t.sx, t.gz - t.sz);
  const { gain, tax } = settleTrade(n, d, t.good, t.cargo, dist);
  tradeStats.trips++;
  const G = GOODS[t.good];
  log(`🐪 A caravan from ${nm(n)} brings ${t.cargo} ${G.icon} to ${nm(d)}: +${gain} 🪙 for ${n.place}${tax ? `, ${tax} 🪙 in tariffs for ${d.place}` : ''}.`);
  endTrade(u);
  u.role = 'villager'; // the trader walks home as an ordinary villager
  setState(u, 'idle');
  u.think = 0.3;
}

// Called when the trip can't go on (destination fell, war broke out, no way through).
export function abortCaravan(u) {
  const t = u.trade;
  if (t) u.nation[t.good] += t.cargo; // cargo comes home
  endTrade(u);
  u.role = 'villager';
  setState(u, 'idle');
  u.think = 0.3;
}

export function caravanLost(u, cause, by) {
  const t = u.trade;
  if (!t) return;
  endTrade(u);
  if (by) log(`🗡️ A ${nm(u.nation)} caravan was cut down by ${by.name} of ${nm(by.nation)}.`);
}

// ---------- divine gifts ----------

export function giftWood(n, amount) {
  n.wood += amount;
}

export function blessPeople(n, count) {
  const homes = n.houses.length ? n.houses : null;
  let made = 0;
  for (let i = 0; i < count && units.length < MAXU; i++) {
    if (homes) { const h = pick(homes); spawnUnit(n, h.x0 + 3.5, h.z0 + 0.5, { y: h.g + 1, age: 18 }); }
    else if (n.king) spawnUnit(n, n.king.x + rand(-1, 1), n.king.z + rand(-1, 1), { y: n.king.y + 2, age: 18 });
    made++;
  }
  return made;
}

// Prosperity packs more people into each house (1x: normal, 50x: about 6x as many).
export const capacity = n => 3 + Math.round(n.houses.length * n.R.perHouse * (1 + (game.prosperity - 1) * 0.1));

function updateNation(n, dt) {
  if (n.units.size === 0) { fallNation(n); return; }
  if (!n.king || !n.king.alive) crown(n);

  const cap = capacity(n);
  const P = game.prosperity;
  n.birthT += dt * P;
  while (n.birthT >= n.R.birth) {
    n.birthT -= n.R.birth;
    if (n.units.size < cap && n.houses.length && units.length < MAXU && !n.starving && n.food > 0) {
      const h = pick(n.houses);
      const role = n.enemies.length && Math.random() < n.R.warRatio * lawWar(n) ? 'soldier' : 'villager';
      spawnUnit(n, h.x0 + 3.5, h.z0 + 0.5, { role, age: 16, y: h.g + 1 });
    } else { n.birthT = 0; break; }
  }

  updateEconomy(n, dt);
  maybeSendCaravan(n, dt);

  n.buildT += dt * Math.min(P, 10);
  if (n.buildT < 2) return;
  n.buildT = 0;
  n.sites = n.sites.filter(st => !st.dead && !st.built);
  economyBuild(n);
  const maxSites = P >= 3 ? Math.min(6, 1 + Math.floor(P / 3)) : 1;
  const pending = n.sites.length * n.R.perHouse;
  if (n.sites.length < maxSites && n.wood >= 8 && n.houses.length + n.sites.length < (P > 1 ? 90 : 45) &&
      (n.units.size >= cap + pending - 3 || n.houses.length < 2)) {
    const spot = findSite(n, P > 1 ? 4 : 2);
    if (spot) {
      clearTrees(spot.x0 - 1, spot.z0 - 1, spot.x0 + 7, spot.z0 + 7, n);
      n.wood -= 8;
      const g = flatten(spot.x0, spot.z0, 7);
      const site = createHouse(n, spot.x0, spot.z0, g, !n.houses.some(h => h.capital) && !n.sites.some(h => h.capital));
      n.sites.push(site);
      if (site.capital) n.capital = { x: site.cx, z: site.cz };
    }
  }
  // conscription
  const want = n.enemies.length ? Math.min(n.units.size - 1, Math.ceil(n.units.size * n.R.warRatio * lawWar(n))) : 0;
  let have = 0;
  for (const u of n.units) if (u.role === 'soldier') have++;
  for (const u of n.units) {
    if (u.possessed) continue;
    if (have < want && u.role === 'villager') { u.role = 'soldier'; have++; setState(u, 'idle'); }
    else if (have > want && u.role === 'soldier') { u.role = 'villager'; have--; setState(u, 'idle'); }
  }
}

function minHouseDist(a, b) {
  let best = Infinity;
  const pa = a.houses.length ? a.houses : [{ cx: a.capital.x, cz: a.capital.z }];
  const pb = b.houses.length ? b.houses : [{ cx: b.capital.x, cz: b.capital.z }];
  for (const h of pa) for (const k of pb) best = Math.min(best, Math.hypot(h.cx - k.cx, h.cz - k.cz));
  return best;
}

function declareWar(a, b, r) {
  const att = Math.random() * (a.R.aggression + b.R.aggression) < a.R.aggression ? a : b;
  const def = att === a ? b : a;
  if (r.ally) log(`🗡️ Betrayal! ${nm(att)} turns on its ally ${nm(def)}.`);
  r.war = true; r.ally = false; r.warT = 0; r.tension = 0;
  log(`⚔️ ${nm(att)} declares war on ${nm(def)}!`);
  for (const c of nations) {
    if (!c.alive || c === att || c === def) continue;
    if (rel(c, def).ally && !rel(c, att).war && Math.random() < 0.75) {
      const rc = rel(c, att);
      rc.war = true; rc.ally = false; rc.warT = 0;
      log(`🛡️ ${nm(c)} honors its alliance and marches against ${nm(att)}.`);
    }
  }
}

function sharesEnemy(a, b) {
  return nations.some(c => c.alive && c !== a && c !== b && rel(a, c).war && rel(b, c).war);
}

function diplomacy(step) {
  const alive = nations.filter(n => n.alive);
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j], r = rel(a, b);
    if (r.war) {
      r.warT += step;
      if ((r.warT > 50 && Math.random() < 0.025) || a.units.size <= 2 || b.units.size <= 2) {
        r.war = false; r.tension = rand(-30, 0);
        log(`🕊️ ${nm(a)} and ${nm(b)} make peace.`);
      }
      continue;
    }
    const dmin = minHouseDist(a, b);
    const aggro = (a.R.aggression + b.R.aggression) / 2;
    r.tension += (Math.random() * 1.1 + Math.max(0, 45 - dmin) * 0.06) * aggro * warMult() - (r.ally ? 1.0 : 0);
    r.tension = Math.max(-40, r.tension);
    if (r.tension >= 100) declareWar(a, b, r);
    else if (r.ally && Math.random() < 0.004) {
      r.ally = false; r.tension += 45;
      log(`💔 The alliance between ${nm(a)} and ${nm(b)} has shattered.`);
    } else if (!r.ally && r.tension < 45 && sharesEnemy(a, b) && Math.random() < 0.12) {
      r.ally = true; r.tension = Math.min(r.tension, 10);
      log(`🤝 ${nm(a)} and ${nm(b)} forge an alliance.`);
    }
  }
  refreshDiplomacy();
}

// ---------- structures reacting to damage ----------

function fellTree(s) {
  const vs = removeStruct(s);
  let top = 0;
  for (const [x, y, z, t] of vs) {
    top = Math.max(top, y);
    if (t === B.LOG) spawnDebris(x + 0.5, y + 0.5, z + 0.5, rand(-1.5, 1.5), rand(0, 2), rand(-1.5, 1.5), t, 0.15);
  }
  if (vs.length) leafBurst(s.x + 0.5, top, s.z + 0.5, 25);
}

export function chopTree(s, n) {
  if (s.dead) return;
  fellTree(s);
  n.wood += Math.round(6 * game.prosperity);
}

function processDamaged() {
  for (const s of damaged) {
    if (s.dead) continue;
    if (s.kind === 'tree') { if (s.alive < s.total * 0.6) fellTree(s); }
    else if (s.kind === 'house') {
      const ref = s.built ? s.total : s.placed;
      if (ref > 10 && s.alive < ref * 0.5) ruinHouse(s);
    }
  }
  damaged.clear();
}

export function updateNations(dt) {
  game.yearT += dt;
  while (game.yearT >= YEAR) {
    game.yearT -= YEAR;
    game.year++;
    for (const u of units) if (u.alive) { u.age++; if (u.age >= u.maxAge) killUnit(u, 'age'); }
  }
  for (const n of nations) if (n.alive) updateNation(n, dt);
  updateWorldEconomy(dt);
  dipT += dt;
  if (dipT >= 1.5) { diplomacy(dipT); dipT = 0; }
  processDamaged();
}

export function setupNations() {
  const cands = [];
  for (let i = 0; i < 2500; i++) {
    const x = Math.floor(rand(16, W - 16)), z = Math.floor(rand(16, D - 16));
    const h = groundTop(x, z);
    if (h < SEA + 2 || h > 24) continue;
    let mn = 99, mx = -1, ok = true;
    for (let dz = -4; dz <= 4 && ok; dz += 2) for (let dx = -4; dx <= 4; dx += 2) {
      const hh = groundTop(x + dx, z + dz);
      if (hh < SEA + 1) { ok = false; break; }
      mn = Math.min(mn, hh); mx = Math.max(mx, hh);
    }
    if (ok && mx - mn <= 3) cands.push({ x, z });
  }
  if (!cands.length) cands.push({ x: W / 2, z: D / 2 }, { x: W / 2 + 30, z: D / 2 }, { x: W / 2, z: D / 2 + 30 });
  const chosen = [pick(cands)];
  while (chosen.length < 3) {
    let best = null, bs = -Infinity;
    for (const c of cands) {
      const d = Math.min(...chosen.map(o => Math.hypot(o.x - c.x, o.z - c.z)));
      const s = Math.min(d, 62) + Math.random() * 4;
      if (s > bs) { bs = s; best = c; }
    }
    chosen.push(best);
  }
  const races = ['human', 'goblin', 'elf'];
  chosen.forEach((c, i) => createNation(races[i], c.x, c.z));
  log(`🌍 The world is young. Three peoples awaken: ${nations.map(nm).join(', ')}.`);
}
