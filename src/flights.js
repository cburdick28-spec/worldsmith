// Airports send planes: trade flights between airports, and settler flights that found new
// nations in unclaimed regions of the Earth map.
import * as THREE from '../vendor/three.module.js';
import { W, D, topAt } from './world.js';
import { earth, BIOME } from './earth.js';
import { nations, game, nm, rel, createNation, siteInRegion } from './nations.js';
import { civics, civicsOf } from './buildings.js';
import { pickCargo, settleTrade, GOODS } from './economy.js';
import { MAX_NATIONS } from './politics.js';
import { log } from './ui.js';
import { sfx } from './audio.js';

const flights = [];
let scene = null, timer = 4;
export const flightStats = { trade: 0, settled: 0 };
const bodyGeo = new THREE.BoxGeometry(3.4, 0.9, 0.9), wingGeo = new THREE.BoxGeometry(0.8, 0.15, 4.2), tailGeo = new THREE.BoxGeometry(0.6, 1.1, 0.15), tailWingGeo = new THREE.BoxGeometry(0.5, 0.12, 1.6);
const white = new THREE.MeshLambertMaterial({ color: '#f1f3f6' });

export function initFlights(s) { scene = s; }

function makePlane(n) {
  const g = new THREE.Group();
  const stripe = new THREE.MeshLambertMaterial({ color: n.color });
  const body = new THREE.Mesh(bodyGeo, white), wing = new THREE.Mesh(wingGeo, stripe), tail = new THREE.Mesh(tailGeo, stripe), tw = new THREE.Mesh(tailWingGeo, white);
  tail.position.set(-1.5, 0.8, 0); tw.position.set(-1.5, 0.35, 0); wing.position.set(0.2, 0, 0);
  g.add(body, wing, tail, tw);
  g.traverse(o => { o.castShadow = true; });
  scene.add(g);
  return g;
}

function launch(n, ap, tx, tz, kind, extra = {}) {
  const sx = ap.x0 + 1, sz = ap.z0 + 2.5, dist = Math.hypot(tx - sx, tz - sz);
  const f = { n, kind, sx, sz, sy: ap.g + 1.5, tx, tz, t: 0, dur: Math.max(6, dist / 14), dist, alt: Math.min(34, 14 + dist * 0.18), mesh: makePlane(n), ...extra };
  flights.push(f);
  sfx('horn', sx, sz);
  return f;
}

function tradeFlight(n, ap) {
  const partners = civics.filter(c => !c.dead && c.type === 'airport' && c.nation && c.nation.alive && c.nation !== n && !rel(n, c.nation).war);
  if (!partners.length) return false;
  const dest = partners[Math.floor(Math.random() * partners.length)];
  const load = pickCargo(n, dest.nation, 24);
  if (!load) return false;
  launch(n, ap, dest.x0 + 1, dest.z0 + 2.5, 'trade', { dest: dest.nation, good: load.good, cargo: load.amount });
  return true;
}

function settleFlight(n, ap) {
  if (!earth.active || nations.filter(m => m.alive).length >= MAX_NATIONS) return false;
  if (n.units.size < 22 || n.houses.length < 9 || n.wood < 30) return false;
  const pool = [...n.units].filter(u => u.alive && !u.possessed && u.role === 'villager' && u.age >= 16 && !u.held && !u.flying);
  if (pool.length < 8) return false;
  const cand = earth.regions.filter(r => !r.owner && r.area >= 50 && r.houses === 0 && r.biome !== BIOME.a && Math.hypot(r.cx - ap.cx, r.cz - ap.cz) > 45 && !flights.some(f => f.region === r))
    .sort((a, b) => Math.hypot(a.cx - ap.cx, a.cz - ap.cz) - Math.hypot(b.cx - ap.cx, b.cz - ap.cz));
  for (const r of cand.slice(0, 6)) {
    if (nations.some(m => m.alive && m.houses.some(h => Math.hypot(h.cx - r.cx, h.cz - r.cz) < 22))) continue;
    const site = siteInRegion(r);
    if (!site) continue;
    n.wood -= 20;
    launch(n, ap, site.x, site.z, 'settle', { region: r });
    log(`✈️ ${nm(n)} sends settlers by air toward <b>${r.name}</b>.`);
    return true;
  }
  return false;
}

function land(f) {
  const n = f.n;
  sfx('bell', f.tx, f.tz, 0.8);
  if (f.kind === 'trade') {
    const d = f.dest;
    if (!d.alive) { n[f.good] += f.cargo; return; }
    const { gain, tax } = settleTrade(n, d, f.good, f.cargo, f.dist);
    flightStats.trade++;
    log(`✈️ A cargo plane from ${nm(n)} lands in ${nm(d)} with ${f.cargo} ${GOODS[f.good].icon}: +${gain} 🪙${tax ? `, ${tax} 🪙 in fees for ${d.place}` : ''}.`);
    return;
  }
  if (!n.alive || nations.filter(m => m.alive).length >= MAX_NATIONS) return;
  const pool = [...n.units].filter(u => u.alive && !u.possessed && u.role === 'villager' && u.age >= 16 && !u.held && !u.flying);
  if (pool.length < 6) return;
  const settlers = [];
  while (settlers.length < 6) settlers.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const v = createNation(n.race, f.tx, f.tz, { members: settlers, place: f.region.name });
  v.liege = n; v.title = n.R.ruler; v.name = `${v.place} Colony`;
  v.css = '#' + new THREE.Color(n.R.color).lerp(new THREE.Color('#ffffff'), 0.3).getHexString();
  v.color = new THREE.Color(v.css); v.armor = v.color.clone().lerp(new THREE.Color('#6d727b'), 0.45);
  const r = rel(v, n); r.war = false; r.ally = true; r.tension = -40;
  flightStats.settled++;
  log(`🛬 Settlers from ${nm(n)} land in <b>${f.region.name}</b> and found ${nm(v)}.`);
}

const dir = new THREE.Vector3();
export function updateFlights(dt) {
  if (!scene) return;
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    f.t += dt / f.dur;
    const t = Math.min(1, f.t), e = t * t * (3 - 2 * t);
    const x = f.sx + (f.tx - f.sx) * e, z = f.sz + (f.tz - f.sz) * e;
    const ground = topAt(Math.max(0, Math.min(W - 1, x | 0)), Math.max(0, Math.min(D - 1, z | 0))) + 2;
    const climb = Math.sin(Math.PI * Math.min(1, t * 1.05));
    const y = Math.max(ground, f.sy + f.alt * climb);
    dir.set(f.tx - f.sx, 0, f.tz - f.sz);
    f.mesh.position.set(x, y, z);
    f.mesh.rotation.set(0, -Math.atan2(dir.z, dir.x), 0);
    f.mesh.rotation.z = Math.cos(Math.PI * t) * -0.12;
    if (f.t >= 1) { land(f); scene.remove(f.mesh); flights.splice(i, 1); }
  }
  timer -= dt * Math.min(game.prosperity, 4);
  if (timer > 0) return;
  timer = 7;
  for (const n of nations) {
    if (!n.alive) continue;
    const ap = civicsOf(n, 'airport')[0];
    if (!ap) continue;
    n.flightT = (n.flightT === undefined ? 0 : n.flightT) - 7;
    if (n.flightT > 0) continue;
    n.flightT = 16 + Math.random() * 12;
    if (flights.filter(f => f.n === n).length >= 2) continue;
    if (Math.random() < 0.45 && settleFlight(n, ap)) continue;
    tradeFlight(n, ap);
  }
}
