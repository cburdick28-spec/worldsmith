// Scars and recovery: ruined houses are remembered and rebuilt once their nation can afford it,
// burnt earth slowly turns green again, and forests creep back over the felled and burnt.
import { W, D, SEA, B, colOcc, structs, owner, idx, get, set, topAt, flatten, plantTree, worldInfo } from './world.js';
import { nations, createHouse, nm, game } from './nations.js';
import { dustCloud } from './effects.js';
import { log } from './ui.js';
import { rand, pick } from './noise.js';

const MEMORY = 6;
let ruinT = 0, healT = 0, treeT = 0;

const felled = [];
export function noteFelled(x, z, kind) {
  if (felled.length < 400) felled.push({ x, z, kind, year: game.year, tries: 0 });
}

export function noteRuin(n, s) {
  n.ruins = n.ruins || [];
  if (n.ruins.length < MEMORY) n.ruins.push({ x0: s.x0, z0: s.z0, g: s.g, capital: !!s.capital });
}

function clearRuin(r) {
  for (let z = r.z0; z < r.z0 + 7; z++) for (let x = r.x0; x < r.x0 + 7; x++) {
    for (let y = r.g; y <= r.g + 14; y++) if (get(x, y, z) && !owner[idx(x, y, z)]) set(x, y, z, B.AIR);
  }
  dustCloud(r.x0 + 3.5, r.g + 1, r.z0 + 3.5, 10, 3);
}

function rebuild() {
  for (const n of nations) {
    if (!n.alive || !n.ruins || !n.ruins.length) continue;
    if (n.wood < 12 || n.sites.length >= 2) continue;
    if (n.enemies.length && Math.random() < 0.7) continue; // wait for peace
    const r = n.ruins[0];
    let blocked = false;
    for (let z = r.z0; z < r.z0 + 7 && !blocked; z++) for (let x = r.x0; x < r.x0 + 7; x++) if (colOcc[z * W + x]) { blocked = true; break; }
    if (blocked) { n.ruins.shift(); continue; }
    clearRuin(r);
    const g = flatten(r.x0, r.z0, 7);
    const site = createHouse(n, r.x0, r.z0, g, r.capital && !n.houses.some(h => h.capital) && !n.sites.some(h => h.capital));
    n.sites.push(site);
    if (site.capital) n.capital = { x: site.cx, z: site.cz };
    n.wood -= 8;
    n.ruins.shift();
    n.rebuilt = (n.rebuilt || 0) + 1;
    if (n.rebuilt % 3 === 1) log(`🔨 ${nm(n)} rebuilds a ruined house.`);
  }
}

// scorched ground greens over after a few decades
function heal() {
  for (let k = 0; k < 300; k++) {
    const x = 1 + Math.floor(Math.random() * (W - 2)), z = 1 + Math.floor(Math.random() * (D - 2));
    const y = topAt(x, z);
    if (y < SEA || get(x, y, z) !== B.SCORCH || colOcc[z * W + x]) continue;
    if (Math.random() < 0.18) set(x, y, z, B.GRASS);
  }
}

// saplings return to where trees were felled or burnt, a decade or two later
function replant() {
  let budget = 4;
  for (let i = 0; i < felled.length && budget > 0; i++) {
    const f = felled[i];
    if (game.year - f.year < 15) continue;
    budget--;
    const h = topAt(f.x, f.z);
    let ok = h > SEA + 1 && get(f.x, h, f.z) === B.GRASS;
    for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 2; dx++) if (colOcc[(f.z + dz) * W + f.x + dx] || get(f.x + dx, h + 1, f.z + dz)) { ok = false; break; }
    if (ok) { plantTree(f.x, f.z, Math.random, f.kind); felled.splice(i--, 1); }
    else if (++f.tries > 6) felled.splice(i--, 1);
  }
}

function regrow() {
  replant();
  let alive = 0;
  const trees = [];
  for (let i = 1; i < structs.length; i++) { const s = structs[i]; if (s.kind === 'tree' && !s.dead) { alive++; trees.push(s); } }
  if (alive >= worldInfo.baseStructs * 0.9 || !trees.length) return;
  for (let tries = 0; tries < 8; tries++) {
    const t = pick(trees);
    const a = Math.random() * Math.PI * 2, d = rand(3, 8);
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 4 || z < 4 || x >= W - 4 || z >= D - 4) continue;
    const h = topAt(x, z);
    if (h <= SEA + 1 || get(x, h, z) !== B.GRASS) continue;
    let free = true;
    for (let dz = -2; dz <= 2 && free; dz++) for (let dx = -2; dx <= 2; dx++) if (colOcc[(z + dz) * W + x + dx] || get(x + dx, h + 1, z + dz)) { free = false; break; }
    if (!free) continue;
    plantTree(x, z, Math.random, h > 21 ? 'pine' : 'oak');
    return;
  }
}

export function updateRuins(dt) {
  ruinT += dt; healT += dt; treeT += dt;
  if (ruinT >= 3) { ruinT = 0; rebuild(); }
  if (healT >= 0.5) { healT = 0; heal(); }
  if (treeT >= 4) { treeT = 0; regrow(); }
}
