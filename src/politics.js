// Kingdom politics: big nations found satellite villages that pay tribute as vassals; vassals
// that grow strong and resentful rebel; conquered nations submit; and a dead ruler can split
// the realm in a succession fight.
import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, groundTop } from './world.js';
import { nations, rel, nm, game, YEAR, createNation, refreshDiplomacy } from './nations.js';
import { sfx } from './audio.js';
import { log } from './ui.js';
import { rand, pick } from './noise.js';

const SUFFIX = { human: 'Village', goblin: 'Warcamp', elf: 'Grove' };
const TITLE = { human: 'Reeve', goblin: 'Chief', elf: 'Warden' };
const MAX_NATIONS = 9;
let polT = 0;

export const vassalsOf = n => nations.filter(m => m.alive && m.liege === n);

// ---------- wars drag vassals and lieges in ----------

function join(c, enemy) {
  if (!c.alive || c === enemy || enemy.liege === c || c.liege === enemy) return;
  const r = rel(c, enemy);
  if (r.war) return;
  r.war = true; r.ally = false; r.warT = 0;
  log(`🛡️ ${nm(c)} is drawn into the war against ${nm(enemy)}.`);
}

export function bindVassals(att, def) {
  for (const [x, y] of [[att, def], [def, att]]) {
    for (const v of vassalsOf(x)) join(v, y);
    if (x.liege) join(x.liege, y);
  }
}

// A war has ended between a and b: their vassals stand down too, and a crushed rival may submit.
export function settleWar(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    for (const v of vassalsOf(x)) { const r = rel(v, y); if (r.war) { r.war = false; r.tension = rand(-30, 0); } }
  }
  const [big, small] = a.units.size >= b.units.size ? [a, b] : [b, a];
  if (big.liege || small.liege || vassalsOf(small).length) return;
  if (big.units.size >= small.units.size * 2.2 && small.units.size >= 3 && big.houses.length >= 5 && vassalsOf(big).length < 3 && Math.random() < 0.7) {
    small.liege = big;
    small.unrest = 2;
    const r = rel(big, small);
    r.war = false; r.ally = true; r.tension = -40;
    log(`🏳️ ${nm(small)} submits as a vassal of ${nm(big)}.`);
  }
}

// ---------- the yearly round ----------

export function updatePolitics(dt) {
  polT += dt;
  if (polT < YEAR) return;
  polT -= YEAR;
  for (const n of [...nations]) {
    if (!n.alive) continue;
    if (n.liege && !n.liege.alive) liberate(n, 'its liege has fallen');
    if (n.liege) vassalYear(n);
    else villageYear(n);
  }
}

function liberate(n, why) {
  n.liege = null;
  n.unrest = 0;
  if (n.title) {
    n.title = null;
    n.name = n.R.realm(n.place);
    n.css = n.R.color; n.color = new THREE.Color(n.css);
    n.armor = n.color.clone().lerp(new THREE.Color('#6d727b'), 0.45);
  }
  log(`🕊️ ${nm(n)} stands free: ${why}.`);
}

function vassalYear(v) {
  const L = v.liege;
  const ratio = v.units.size / Math.max(1, L.units.size);
  const tribute = v.gold * 0.12;
  v.gold -= tribute; L.gold += tribute;
  v.unrest += (ratio > 0.6 ? 0.55 : -0.25) + (ratio > 1 ? 0.8 : 0) + (L.starving ? 1.3 : 0) + (L.enemies.length ? 0.35 : 0) + (L.king ? 0 : 0.8) + (v.starving ? 0.6 : 0);
  v.unrest = Math.max(0, v.unrest);
  if (v.unrest >= 8 && v.units.size >= 12 && v.houses.length >= 2) rebel(v, L);
}

function rebel(v, L) {
  v.liege = null;
  v.unrest = 0;
  if (v.title) {
    v.title = null;
    v.name = v.R.realm(v.place);
    v.css = v.R.color; v.color = new THREE.Color(v.css);
    v.armor = v.color.clone().lerp(new THREE.Color('#6d727b'), 0.45);
  }
  const r = rel(v, L);
  r.war = true; r.ally = false; r.warT = 0; r.tension = 0;
  log(`🔥 ${nm(v)} rises in rebellion against ${nm(L)}!`);
  sfx('horn', v.capital.x, v.capital.z);
  refreshDiplomacy();
}

// ---------- satellite villages ----------

export function findVillageSite(n) {
  const others = nations.filter(m => m.alive);
  for (let tries = 0; tries < 140; tries++) {
    const base = pick(n.houses);
    const a = Math.random() * Math.PI * 2, d = rand(18, 40);
    const x = Math.round(base.cx + Math.cos(a) * d), z = Math.round(base.cz + Math.sin(a) * d);
    if (x < 10 || z < 10 || x > W - 14 || z > D - 14) continue;
    const g0 = groundTop(x, z);
    if (g0 < SEA + 1 || g0 > 26) continue;
    let mn = 99, mx = -1, ok = true;
    for (let dz = -4; dz <= 4 && ok; dz += 2) for (let dx = -4; dx <= 4; dx += 2) {
      const h = groundTop(x + dx, z + dz);
      if (h < SEA + 1) { ok = false; break; }
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    if (!ok || mx - mn > 4) continue;
    if (others.some(m => m.houses.some(h => Math.hypot(h.cx - x, h.cz - z) < (m === n ? 16 : 20)))) continue;
    return { x, z };
  }
  return null;
}

function villageYear(n) {
  n.villageT -= 1;
  if (n.villageT > 0) return;
  n.villageT = rand(14, 24);
  if (n.houses.length < 7 || n.units.size < 26 || n.enemies.length || n.wood < 24) return;
  if (nations.filter(m => m.alive).length >= MAX_NATIONS || vassalsOf(n).length >= 3) return;
  const pool = [...n.units].filter(u => u.alive && !u.possessed && u.role === 'villager' && u.age >= 16 && !u.held && !u.flying);
  if (pool.length < 8) return;
  const settlers = [];
  while (settlers.length < 7 && pool.length) settlers.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const site = findVillageSite(n);
  if (!site) return;
  n.wood -= 20;
  const v = createNation(n.race, site.x, site.z, { members: settlers });
  v.liege = n;
  v.title = TITLE[n.race];
  v.name = `${v.place} ${SUFFIX[n.race]}`;
  v.css = '#' + new THREE.Color(n.R.color).lerp(new THREE.Color('#ffffff'), 0.3).getHexString();
  v.color = new THREE.Color(v.css);
  v.armor = v.color.clone().lerp(new THREE.Color('#6d727b'), 0.45);
  const r = rel(v, n);
  r.war = false; r.ally = true; r.tension = -40;
  log(`🏘️ ${nm(n)} founds a new settlement: ${nm(v)}.`);
}

// ---------- succession fights ----------

// Called as a ruler dies, before the heir is crowned. Sometimes a rival takes part of the realm.
export function trySuccessionSplit(n) {
  if (n.houses.length < 4 || n.units.size < 14 || game.year - n.lastSplit < 30) return null;
  if (nations.filter(m => m.alive).length >= MAX_NATIONS || Math.random() > 0.3) return null;
  const adults = [...n.units].filter(u => u.alive && !u.possessed && u.age >= 18 && (u.role === 'villager' || u.role === 'soldier'));
  if (adults.length < 6) return null;
  adults.sort((a, b) => b.age - a.age);
  const rival = adults[1 + Math.floor(Math.random() * Math.min(4, adults.length - 2))];
  const far = n.houses.filter(h => !h.capital && h.built && !h.dead)
    .sort((a, b) => Math.hypot(b.cx - n.capital.x, b.cz - n.capital.z) - Math.hypot(a.cx - n.capital.x, a.cz - n.capital.z))[0];
  if (!far) return null;
  const pool = adults.filter(u => u !== rival);
  const k = Math.min(pool.length, Math.floor(n.units.size * rand(0.3, 0.42)));
  const members = [rival];
  while (members.length <= k && pool.length) members.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  n.lastSplit = game.year;
  const s = createNation(n.race, far.cx, far.cz, { house: far, members, king: rival });
  s.lastSplit = game.year;
  s.liege = null;
  const r = rel(n, s);
  r.war = true; r.ally = false; r.warT = 0; r.tension = 0;
  refreshDiplomacy();
  log(`⚔️ A succession crisis splits ${nm(n)}: ${rival.name} claims the throne and ${nm(s)} breaks away.`);
  sfx('horn', far.cx, far.cz);
  return rival;
}
