// Civic buildings: nations raise wells, markets, windmills, watchtowers and more as they grow.
// Each one is a real voxel structure (it can burn, be torn down or be looted) with a small effect
// on its nation's economy or defence. Placement is instant, like inns.
import { W, D, SEA, B, colOcc, structs, groundTop, newStruct, placeStruct, claimFoot, flatten, removeStruct, height } from './world.js';
import { nations, nm, clearTrees, game } from './nations.js';
import { units, damageUnit } from './units.js';
import { leafBurst, arrow, smokeColumn, dustCloud } from './effects.js';
import { sfx } from './audio.js';
import { log } from './ui.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

export const civics = []; // living civic structs (rebuilt from `structs` after a load)
let lastYear = -1, buildT = 3, civicsDirty = true;

// ---------- blueprints ----------
// Each returns voxels [x, y, z, block] for a size x size plot with its corner at (x0, z0), floor level g.

const wallOf = n => (n.race === 'human' ? B.PLANK : n.race === 'goblin' ? B.MUD : B.MARBLE);

function ring(plan, x0, z0, s, y, t, skip) {
  for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) {
    if (i > 0 && i < s - 1 && j > 0 && j < s - 1) continue;
    if (skip && skip(i, j)) continue;
    plan.push([x0 + i, y, z0 + j, t]);
  }
}
function slab(plan, x0, z0, s, y, t, inset = 0) {
  for (let i = inset; i < s - inset; i++) for (let j = inset; j < s - inset; j++) plan.push([x0 + i, y, z0 + j, t]);
}

export const TYPES = {
  well: {
    name: 'well', icon: '⛲', size: 3, wood: 6, stone: 2, minHouses: 3,
    max: n => Math.min(4, Math.floor(n.houses.length / 4)),
    plan(n, x0, z0, g) {
      const p = [];
      ring(p, x0, z0, 3, g, B.STONE);
      p.push([x0 + 1, g - 1, z0 + 1, B.MUD]);
      for (const [i, j] of [[0, 0], [2, 0], [0, 2], [2, 2]]) { p.push([x0 + i, g + 1, z0 + j, B.LOG], [x0 + i, g + 2, z0 + j, B.LOG]); }
      slab(p, x0, z0, 3, g + 3, n.R.roof);
      p.push([x0 + 1, g + 2, z0 + 1, B.GOLD]); // the bucket
      return p;
    },
  },
  fishing: {
    name: 'fishing hut', icon: '🎣', size: 3, wood: 6, stone: 0, minHouses: 3, coastal: true,
    max: () => 2,
    plan(n, x0, z0, g) {
      const p = [];
      ring(p, x0, z0, 3, g, B.PLANK, (i, j) => i === 1 && j === 0);
      ring(p, x0, z0, 3, g + 1, B.PLANK, (i, j) => (i === 1 && j === 0) || (i === 1 && j === 2));
      slab(p, x0, z0, 3, g + 2, n.R.roof);
      p.push([x0 + 1, g + 3, z0 + 1, n.R.roof], [x0, g, z0 - 1, B.LOG], [x0 + 2, g, z0 - 1, B.LOG]); // net poles
      return p;
    },
  },
  market: {
    name: 'market', icon: '🏪', size: 5, wood: 14, stone: 4, minHouses: 5,
    max: n => Math.min(2, Math.floor(n.houses.length / 6)),
    plan(n, x0, z0, g) {
      const p = [];
      slab(p, x0, z0, 5, g - 1, B.PLANK);
      for (const [i, j] of [[0, 0], [4, 0], [0, 4], [4, 4]]) for (let y = g; y < g + 3; y++) p.push([x0 + i, y, z0 + j, B.LOG]);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) p.push([x0 + i, g + 3, z0 + j, (i + j) % 2 ? n.R.roof : B.MARBLE]);
      for (const [i, j] of [[1, 1], [3, 1], [1, 3], [3, 3]]) { p.push([x0 + i, g, z0 + j, B.PLANK]); p.push([x0 + i, g + 1, z0 + j, B.GOLD]); }
      return p;
    },
  },
  windmill: {
    name: 'windmill', icon: '🌬️', size: 5, wood: 14, stone: 6, minHouses: 4, needFarms: 2, front: 1,
    max: n => Math.min(3, Math.floor(n.farms.length / 3)),
    plan(n, x0, z0, g) {
      const p = [], w = wallOf(n);
      for (let y = g; y < g + 3; y++) ring(p, x0, z0, 5, y, y === g ? B.STONE : w, (i, j) => y < g + 2 && i === 2 && j === 0);
      for (let y = g + 3; y < g + 6; y++) ring(p, x0 + 1, z0 + 1, 3, y, w);
      slab(p, x0 + 1, z0 + 1, 3, g + 6, n.R.roof);
      p.push([x0 + 2, g + 7, z0 + 2, n.R.roof], [x0 + 2, g + 8, z0 + 2, B.GOLD]);
      const hz = z0 - 1; // sails on the front, facing -z
      for (let k = -3; k <= 3; k++) { p.push([x0 + 2, g + 4 + k, hz, B.LOG]); if (k) p.push([x0 + 2 + k, g + 4, hz, B.LOG]); }
      p.push([x0 + 2, g + 4, hz, B.GOLD]);
      for (const [a, b] of [[-2, -1], [2, 1], [-1, 2], [1, -2]]) p.push([x0 + 2 + a, g + 4 + b, hz, B.MARBLE]);
      return p;
    },
  },
  tower: {
    name: 'watchtower', icon: '🗼', size: 3, wood: 10, stone: 8, minHouses: 5,
    max: n => Math.min(4, Math.floor(n.houses.length / 4)),
    plan(n, x0, z0, g) {
      const p = [];
      for (let y = g; y < g + 8; y++) ring(p, x0, z0, 3, y, B.STONE, (i, j) => (y < g + 2 && i === 1 && j === 0) || (y % 3 === 2 && i === 1 && j === 2)); // door + arrow slits
      slab(p, x0, z0, 3, g + 8, B.PLANK);
      ring(p, x0, z0, 3, g + 9, B.STONE, (i, j) => (i + j) % 2 === 1);
      p.push([x0 + 1, g + 9, z0 + 1, B.LOG], [x0 + 1, g + 10, z0 + 1, B.LOG], [x0 + 1, g + 11, z0 + 1, B.LOG], [x0 + 2, g + 11, z0 + 1, n.R.roof], [x0 + 2, g + 10, z0 + 1, n.R.roof]);
      return p;
    },
  },
  forge: {
    name: 'forge', icon: '⚒️', size: 5, wood: 12, stone: 10, minHouses: 6,
    max: () => 1,
    plan(n, x0, z0, g) {
      const p = [];
      for (let y = g; y < g + 3; y++) ring(p, x0, z0, 5, y, y === g ? B.STONE : B.MUD, (i, j) => y < g + 2 && i === 2 && j === 0);
      slab(p, x0, z0, 5, g + 3, B.PLANK);
      for (let y = g; y < g + 7; y++) p.push([x0 + 4, y, z0 + 4, B.STONE]);
      p.push([x0 + 2, g, z0 + 2, B.SCORCH], [x0 + 2, g + 1, z0 + 2, B.GOLD], [x0 + 3, g, z0 + 2, B.STONE]); // forge + anvil
      return p;
    },
    smoke: [4, 7, 4],
  },
  barracks: {
    name: 'barracks', icon: '🛡️', size: 7, wood: 14, stone: 12, minHouses: 7,
    max: n => (n.houses.length >= 14 ? 2 : 1),
    plan(n, x0, z0, g) {
      const p = [];
      for (let y = g; y < g + 3; y++) ring(p, x0, z0, 7, y, B.STONE, (i, j) => y < g + 2 && i === 3 && j === 0);
      slab(p, x0, z0, 7, g + 3, B.PLANK);
      ring(p, x0, z0, 7, g + 4, B.STONE, (i, j) => (i + j) % 2 === 1);
      for (let y = g + 4; y < g + 9; y++) p.push([x0 + 3, y, z0 + 3, B.LOG]);
      for (let y = g + 7; y < g + 9; y++) { p.push([x0 + 4, y, z0 + 3, n.R.roof], [x0 + 5, y, z0 + 3, n.R.roof]); }
      return p;
    },
  },
  temple: {
    name: 'temple', icon: '🏛️', size: 7, wood: 12, stone: 16, gold: 8, minHouses: 8,
    max: () => 1,
    plan(n, x0, z0, g) {
      const p = [];
      slab(p, x0, z0, 7, g, B.MARBLE);
      for (let i = 1; i < 6; i += 2) for (const j of [1, 5]) for (let y = g + 1; y < g + 5; y++) p.push([x0 + i, y, z0 + j, B.MARBLE]);
      for (const i of [1, 5]) for (const j of [3]) for (let y = g + 1; y < g + 5; y++) p.push([x0 + i, y, z0 + j, B.MARBLE]);
      slab(p, x0, z0, 7, g + 5, B.MARBLE);
      slab(p, x0, z0, 7, g + 6, n.R.roof, 1);
      slab(p, x0, z0, 7, g + 7, n.R.roof, 2);
      slab(p, x0, z0, 7, g + 8, B.GOLD, 3);
      p.push([x0 + 3, g + 9, z0 + 3, B.GOLD], [x0 + 3, g + 10, z0 + 3, B.GOLD]);
      p.push([x0 + 3, g + 1, z0 + 3, B.GOLD]); // altar
      return p;
    },
  },
};
const ORDER = ['well', 'fishing', 'market', 'windmill', 'tower', 'forge', 'barracks', 'temple'];

// ---------- bookkeeping ----------

function refreshCivics() {
  civics.length = 0;
  for (const s of structs) if (s && s.kind === 'civic' && !s.dead) civics.push(s);
  civicsDirty = false;
}
export const civicsOf = (n, type) => civics.filter(s => s.nation === n && !s.dead && (!type || s.type === type));
export function civicCount(n) { return civics.filter(s => s.nation === n && !s.dead).length; }

// ---------- placement ----------

function nearWater(x, z, s) {
  for (let dz = -3; dz < s + 3; dz++) for (let dx = -3; dx < s + 3; dx++) {
    const xx = x + dx, zz = z + dz;
    if (xx < 1 || zz < 1 || xx >= W - 1 || zz >= D - 1) continue;
    if (height[zz * W + xx] < SEA - 1) return true;
  }
  return false;
}

function findPlot(n, T) {
  const s = T.size;
  const homes = n.houses.filter(h => !h.dead);
  if (!homes.length) return null;
  for (let tries = 0; tries < 90; tries++) {
    const allowTrees = tries >= 40;
    const base = pick(homes);
    const a = Math.random() * Math.PI * 2, d = rand(7, 14 + tries * (T.coastal ? 0.45 : 0.15));
    const x0 = Math.round(base.cx + Math.cos(a) * d - s / 2), z0 = Math.round(base.cz + Math.sin(a) * d - s / 2);
    const zf = T.front || 0;
    if (x0 < 5 || z0 < 5 + zf || x0 + s > W - 5 || z0 + s > D - 5) continue;
    let ok = true, mn = 99, mx = -1;
    for (let z = z0 - zf; z < z0 + s && ok; z++) for (let x = x0; x < x0 + s; x++) {
      const o = colOcc[z * W + x];
      if (o && !(allowTrees && structs[o].kind === 'tree')) { ok = false; break; }
      const h = groundTop(x, z);
      if (h < SEA + 1) { ok = false; break; }
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    if (!ok || mx - mn > 2) continue;
    if (T.coastal && !nearWater(x0, z0, s)) continue;
    // keep a gap from every other house and civic building
    const cx = x0 + s / 2, cz = z0 + s / 2, gap = s / 2 + 5;
    let clear = true;
    for (const m of nations) {
      if (!m.alive) continue;
      for (const h of m.houses) if (Math.hypot(h.cx - cx, h.cz - cz) < gap + 1) { clear = false; break; }
      if (!clear) break;
    }
    if (!clear) continue;
    if (civics.some(c => !c.dead && Math.hypot(c.cx - cx, c.cz - cz) < gap)) continue;
    return { x0, z0 };
  }
  return null;
}

export function buildCivic(n, type, spot) {
  const T = TYPES[type];
  const plot = spot || findPlot(n, T);
  if (!plot) return null;
  const { x0, z0 } = plot, s = T.size, zf = T.front || 0;
  clearTrees(x0 - 1, z0 - 1 - zf, x0 + s, z0 + s, n);
  const g = flatten(x0, z0, s);
  const st = newStruct('civic', { type, nation: n, x0, z0, g, cx: x0 + s / 2, cz: z0 + s / 2, size: s, shootT: rand(0, 1) });
  st.plan = T.plan(n, x0, z0, g);
  claimFoot(st, x0, z0 - zf, x0 + s - 1, z0 + s - 1);
  for (const [x, y, z, t] of st.plan) placeStruct(st, x, y, z, t);
  st.placed = st.plan.length; st.total = st.alive; st.built = true;
  n.wood -= T.wood; n.stone -= T.stone; if (T.gold) n.gold -= T.gold;
  civics.push(st);
  leafBurst(st.cx, g + 3, st.cz, 14, '#b98d55');
  dustCloud(st.cx, g + 0.5, st.cz, 14, s / 2 + 1);
  sfx('build', st.cx, st.cz, 0.6);
  return st;
}

function wants(n, type) {
  const T = TYPES[type];
  if (n.houses.length < T.minHouses) return false;
  if (T.needFarms && n.farms.length < T.needFarms) return false;
  if (civicsOf(n, type).length >= T.max(n)) return false;
  if (n.wood < T.wood + 12 || n.stone < T.stone || (T.gold && n.gold < T.gold)) return false;
  return true;
}

function tryBuild(n) {
  if (n.starving) return;
  if (n.sites.some(s => !s.dead && !s.built)) return; // finish the houses first
  for (const type of ORDER) {
    if (!wants(n, type)) continue;
    const st = buildCivic(n, type);
    if (!st) continue;
    const T = TYPES[type];
    if (civicsOf(n, type).length === 1) log(`${T.icon} ${nm(n)} raises a ${T.name}.`);
    return;
  }
}

// ---------- yearly effects ----------

function yearly() {
  for (const s of civics) {
    if (s.dead) continue;
    if (s.alive < s.total * 0.5) { // wrecked
      removeStruct(s, false);
      if (s.nation && s.nation.alive) log(`🏚️ ${nm(s.nation)}'s ${TYPES[s.type].name} lies in ruins.`);
    }
  }
  refreshCivics();
  for (const n of nations) {
    if (!n.alive) continue;
    let cap = 0;
    const h = n.houses.length;
    for (const s of civicsOf(n)) {
      switch (s.type) {
        case 'well': cap += 2; break;
        case 'market': n.gold += 1 + Math.floor(h / 4); break;
        case 'windmill': n.food += 2 * Math.min(n.farms.length, 4); break;
        case 'fishing': n.food += 3; break;
        case 'forge': n.stone += 2; smokeColumn(s.x0 + 4.5, s.g + 7, s.z0 + 4.5, 3); break;
        case 'temple':
          n.gold += 2;
          n.unrest = Math.max(0, (n.unrest || 0) - 1);
          for (const u of n.units) if (u.alive && Math.hypot(u.x - s.cx, u.z - s.cz) < 24) u.hp = Math.min(u.maxHp, u.hp + 3);
          break;
        case 'barracks': {
          let sol = 0;
          for (const u of n.units) if (u.role === 'soldier') sol++;
          if (n.units.size >= 12 && sol < n.units.size * 0.28) {
            for (const u of n.units) if (u.alive && u.role === 'villager' && u.age >= 16 && u.age < 55 && !u.possessed) { u.role = 'soldier'; break; }
          }
          break;
        }
      }
    }
    n.bonusCap = cap;
  }
}

// ---------- watchtowers shoot ----------

function towerFire(dt) {
  for (const s of civics) {
    if (s.dead || s.type !== 'tower') continue;
    s.shootT -= dt;
    if (s.shootT > 0) continue;
    s.shootT = 1.4;
    const n = s.nation;
    if (!n || !n.alive) continue;
    const tx = s.cx, ty = s.g + 9.5, tz = s.cz;
    let best = null, bd = 17 * 17;
    for (const t of units) {
      if (!t.alive || t.held || t.nation === n || n.allies.includes(t.nation)) continue;
      const hostile = n.enemies.includes(t.nation) || t.role === 'raider';
      if (!hostile) continue;
      const d = (t.x - tx) ** 2 + (t.z - tz) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    if (best) {
      arrow(tx, ty, tz, best.x, best.y + 0.9, best.z);
      damageUnit(best, rand(2, 4), null, 'battle');
    }
  }
}

export function updateBuildings(dt) {
  if (civicsDirty) refreshCivics();
  if (game.year !== lastYear) {
    if (lastYear >= 0) yearly();
    lastYear = game.year;
  }
  towerFire(dt);
  buildT -= dt;
  if (buildT > 0) return;
  buildT = 7;
  for (const n of nations) if (n.alive) tryBuild(n);
}

// After a load the list must be rebuilt from the restored structures.
export function resetBuildings() { civicsDirty = true; lastYear = -1; }

const EFFECT = {
  well: 'houses 2 more people', fishing: 'brings in fish (+3 food a year)', market: 'brings in coin every year',
  windmill: 'grinds the harvest (+food from farms)', tower: 'archers pick off enemies and bandits', forge: 'smiths stone tools (+stone)',
  barracks: 'drills villagers into soldiers', temple: 'heals the faithful, soothes unrest, collects offerings',
};
export function civicHTML(s) {
  const T = TYPES[s.type];
  const pct = Math.round(s.alive / Math.max(1, s.total) * 100);
  return `<b>${T.icon} ${T.name[0].toUpperCase() + T.name.slice(1)}</b> of ${s.nation ? nm(s.nation) : 'no one'}<br>${pct}% intact<br><span class="dim">${EFFECT[s.type]}</span>`;
}
