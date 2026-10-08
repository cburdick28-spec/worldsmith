// Voxel world: storage, terrain generation, structures, chunk meshing, raycasting.
import * as THREE from '../vendor/three.module.js';
import { makeNoise, rng, hash3 } from './noise.js';

export const W = 256, D = 256, H = 48, SEA = 12, CS = 16;
export const CX = W / CS, CZ = D / CS;
export const WATER_Y = SEA + 0.85;

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, SNOW: 5, LOG: 6, LEAVES: 7, PLANK: 8,
  MUD: 9, MARBLE: 10, ROOF_H: 11, ROOF_G: 12, ROOF_E: 13, SCORCH: 14, PINE: 15, GOLD: 16, ROAD: 17, FARM: 18, WHEAT: 19, WHEAT_RIPE: 20, LAVA: 21, BASALT: 22, GLASS: 23, COBBLE: 24, SHUTTER: 25, THATCH: 26, FLOWER: 27, BONE: 28, PLASTER_A: 29, PLASTER_B: 30, PLASTER_C: 31, PLASTER_D: 32, PLASTER_E: 33, BIRCH: 34, LEAVES_L: 35, BLOSSOM: 36,
};

// flam: chance per fire tick to spread into this block; burn: seconds it burns for
export const BLOCK = [];
function def(t, top, side, flam = 0, burn = 0) {
  BLOCK[t] = { top: new THREE.Color(top), side: new THREE.Color(side || top), flam, burn };
}
def(B.GRASS, '#6fae4a', '#7f9447', 0.025, 1.5);
def(B.DIRT, '#8b6a43');
def(B.STONE, '#8d9095');
def(B.SAND, '#e0cc8f');
def(B.SNOW, '#f4f7fa', '#dfe6ec');
def(B.LOG, '#9a7448', '#6b4a2b', 0.12, 7);
def(B.LEAVES, '#47923a', null, 0.26, 2.5);
def(B.PLANK, '#b98d55', null, 0.14, 6);
def(B.MUD, '#7b5f3e');
def(B.MARBLE, '#ece8dc');
def(B.ROOF_H, '#3f6fd6');
def(B.ROOF_G, '#b0392c', null, 0.2, 3.5);
def(B.ROOF_E, '#9265d8');
def(B.SCORCH, '#35302c');
def(B.PINE, '#2f6b3a', null, 0.22, 2.5);
def(B.GOLD, '#f2c443');
def(B.ROAD, '#94724a', '#6e5333'); // packed dirt, worn in by foot traffic (see roads.js)
def(B.LAVA, '#ff6a1a', '#e2480f');   // molten rock from volcanoes
def(B.BASALT, '#3b3a42', '#2c2b33'); // cooled lava
def(B.FARM, '#5b3d22', '#4a321c');   // tilled soil
def(B.WHEAT, '#86b83c', '#6c9a2e', 0.2, 2);
def(B.WHEAT_RIPE, '#e6b93a', '#c99a2a', 0.2, 2);
def(B.GLASS, '#a6d9ec', '#8fc6dc');
def(B.COBBLE, '#7a7e85', '#676b72');
def(B.SHUTTER, '#4c3320', null, 0.12, 6);
def(B.THATCH, '#c9aa5c', '#b08f45', 0.35, 3);
def(B.FLOWER, '#e0527a', '#4f8a35', 0.1, 1.5);
def(B.BONE, '#ece3cf', '#cfc4aa');
for (const [t, c, d] of [[B.PLASTER_A, '#f1dcae', '#e4cb96'], [B.PLASTER_B, '#e8a39a', '#d98f86'], [B.PLASTER_C, '#a9c7a0', '#97b78e'], [B.PLASTER_D, '#9fc6e0', '#8bb4d0'], [B.PLASTER_E, '#efbf86', '#e0ad70']]) def(t, c, d, 0.05, 3); // pastel lime-wash walls
def(B.BIRCH, '#e8e4d8', '#d9d4c4', 0.12, 7);
def(B.LEAVES_L, '#86bb44', null, 0.26, 2.5);
def(B.BLOSSOM, '#f0a9c6', null, 0.26, 2.5);
// surface texture kinds drawn in the chunk shader: 1 brick, 2 planks, 3 thatch, 4 shingles
for (const [t, k] of [[B.COBBLE, 1], [B.MARBLE, 1], [B.MUD, 3], [B.PLANK, 2], [B.SHUTTER, 2], [B.LOG, 2], [B.THATCH, 3], [B.ROOF_H, 4], [B.ROOF_G, 4], [B.ROOF_E, 4]]) BLOCK[t].tex = k;

export const vox = new Uint8Array(W * D * H);
export const owner = new Int32Array(W * D * H);   // voxel -> structure id
export const height = new Int16Array(W * D).fill(-1); // top solid y per column
export const colOcc = new Int32Array(W * D);       // column footprint -> structure id
export const structs = [null];
export const damaged = new Set();
export const worldInfo = { baseStructs: 0, seed: 0 };
const dirty = new Set();

export const idx = (x, y, z) => (y * D + z) * W + x;
export const inB = (x, y, z) => x >= 0 && x < W && z >= 0 && z < D && y >= 0 && y < H;

export function get(x, y, z) {
  if (y < 0) return B.STONE;
  if (x < 0 || x >= W || z < 0 || z >= D || y >= H) return B.AIR;
  return vox[idx(x, y, z)];
}
export const solid = (x, y, z) => get(x, y, z) !== 0;

export function topAt(x, z) {
  x = Math.floor(x); z = Math.floor(z);
  if (x < 0 || x >= W || z < 0 || z >= D) return -1;
  return height[z * W + x];
}
export const isWaterCol = (x, z) => topAt(x, z) < SEA;

// Top of the bare ground, ignoring trees and buildings standing on it.
export function groundTop(x, z) {
  let y = topAt(x, z);
  while (y >= 0) {
    const i = idx(x, y, z);
    if (vox[i] && !owner[i]) break;
    y--;
  }
  return y;
}

function markDirty(x, z) {
  const cx = (x / CS) | 0, cz = (z / CS) | 0;
  dirty.add(cx + cz * CX);
  const lx = x % CS, lz = z % CS;
  if (lx === 0 && cx > 0) dirty.add(cx - 1 + cz * CX);
  if (lx === CS - 1 && cx < CX - 1) dirty.add(cx + 1 + cz * CX);
  if (lz === 0 && cz > 0) dirty.add(cx + (cz - 1) * CX);
  if (lz === CS - 1 && cz < CZ - 1) dirty.add(cx + (cz + 1) * CX);
}

export function set(x, y, z, t) {
  if (!inB(x, y, z)) return false;
  const i = idx(x, y, z), old = vox[i];
  if (old === t) return false;
  vox[i] = t;
  if (old && owner[i]) {
    const s = structs[owner[i]];
    owner[i] = 0;
    if (s && !s.dead) { s.alive--; damaged.add(s); }
  }
  const c = z * W + x;
  if (t && y > height[c]) height[c] = y;
  else if (!t && y === height[c]) {
    let yy = y - 1;
    while (yy >= 0 && !vox[idx(x, yy, z)]) yy--;
    height[c] = yy;
  }
  markDirty(x, z);
  return true;
}

// ---------- structures (trees, houses) ----------

export function newStruct(kind, props) {
  const s = { id: structs.length, kind, alive: 0, total: 0, placed: 0, plan: [], foot: [], dead: false, ...props };
  structs.push(s);
  return s;
}

export function placeStruct(s, x, y, z, t) {
  if (!inB(x, y, z)) return;
  const i = idx(x, y, z);
  if (owner[i] === s.id && vox[i] === t) return;
  set(x, y, z, t);
  owner[i] = s.id;
  s.alive++;
}

export function claimFoot(s, x0, z0, x1, z1) {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (x < 0 || z < 0 || x >= W || z >= D) continue;
    colOcc[z * W + x] = s.id;
    s.foot.push(z * W + x);
  }
}

function releaseFoot(s) {
  for (const c of s.foot) if (colOcc[c] === s.id) colOcc[c] = 0;
  s.foot.length = 0;
}

// Detach a structure from the world. Returns its remaining voxels [x,y,z,type].
export function removeStruct(s, clearVoxels = true) {
  s.dead = true;
  const out = [];
  for (let k = 0; k < s.placed; k++) {
    const [x, y, z] = s.plan[k];
    if (!inB(x, y, z)) continue;
    const i = idx(x, y, z);
    if (owner[i] !== s.id) continue;
    owner[i] = 0;
    if (vox[i]) out.push([x, y, z, vox[i]]);
    if (clearVoxels) set(x, y, z, B.AIR);
  }
  releaseFoot(s);
  return out;
}

export function plantTree(x, z, R, kind = 'oak') {
  const g = height[z * W + x] + 1;
  const th = kind === 'pine' ? 5 + Math.floor(R() * 3) : 4 + Math.floor(R() * 3);
  const s = newStruct('tree', { x, z });
  const plan = [];
  for (let i = 0; i < th; i++) plan.push([x, g + i, z, B.LOG]);
  if (kind === 'pine') {
    const top = g + th + 1;
    for (let ly = g + 2; ly <= top; ly++) {
      const r = Math.round((top - ly) * 0.5);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > r) continue;
        if (dx === 0 && dz === 0 && ly < g + th) continue;
        plan.push([x + dx, ly, z + dz, B.PINE]);
      }
    }
  } else {
    // broadleaf variants: round oak, tall birch, wide spreading oak, rare blossom tree
    const v = R();
    const birch = v < 0.2, blossom = v >= 0.2 && v < 0.27, wide = v >= 0.27 && v < 0.5;
    if (birch) for (let i = 0; i < th; i++) plan[i][3] = B.BIRCH;
    const cy = g + th - 1, rx = wide ? 3 : 2, lim = wide ? 7.5 : birch ? 4.6 : 5.3;
    for (let dy = -1; dy <= (birch ? 3 : 2); dy++) for (let dz = -rx; dz <= rx; dz++) for (let dx = -rx; dx <= rx; dx++) {
      const sq = wide ? 1.9 : birch ? 1.0 : 1.4;
      if (dx * dx + dy * dy * sq + dz * dz > lim) continue;
      if (dx === 0 && dz === 0 && dy < 1) continue;
      if (R() < 0.08) continue;
      const t = blossom ? B.BLOSSOM : birch ? (R() < 0.5 ? B.LEAVES_L : B.LEAVES) : (dy >= 1 && R() < 0.35 ? B.LEAVES_L : B.LEAVES);
      plan.push([x + dx, cy + dy, z + dz, t]);
    }
    if (wide) { plan.push([x + 1, g + th - 2, z, B.LOG], [x - 1, g + th - 2, z, B.LOG]); } // side limbs
  }
  s.plan = plan;
  for (const [vx, vy, vz, t] of plan) if (inB(vx, vy, vz) && !vox[idx(vx, vy, vz)]) placeStruct(s, vx, vy, vz, t);
  s.placed = plan.length;
  s.total = s.alive;
  claimFoot(s, x - 1, z - 1, x + 1, z + 1);
  return s;
}

// Level a square area to the median height so a house can stand on it.
export function flatten(x0, z0, size) {
  const hs = [];
  for (let z = z0; z < z0 + size; z++) for (let x = x0; x < x0 + size; x++) hs.push(topAt(x, z));
  hs.sort((a, b) => a - b);
  const g = Math.max(SEA + 1, hs[hs.length >> 1] + 1);
  for (let z = z0; z < z0 + size; z++) for (let x = x0; x < x0 + size; x++) {
    for (let y = topAt(x, z); y >= g; y--) set(x, y, z, B.AIR);
    for (let y = Math.max(0, topAt(x, z)); y < g; y++) if (!get(x, y, z)) set(x, y, z, B.DIRT);
    const top = get(x, g - 1, z);
    if (top === B.DIRT || top === B.SCORCH) set(x, g - 1, z, B.GRASS);
  }
  return g;
}

// Voxel layout of a house in a 7x7 footprint starting at (x0, z0) on ground level g.
export function housePlan(race, x0, z0, g, roof, capital) {
  const plan = [];
  const ax = x0 + 1, az = z0 + 1; // 5x5 walls
  const pv = hash3(x0, z0, 23); // human wall finish: bare plank or a pastel plaster
  const humanWall = pv < 0.35 ? B.PLANK : B.PLASTER_A + Math.min(4, Math.floor((pv - 0.35) / 0.65 * 5));
  const wall = race === 'human' ? humanWall : race === 'goblin' ? B.MUD : B.MARBLE;
  const hv = hash3(x0, z0, 11); // per-house variety: tall, stone-ground or porch
  const tall = race === 'human' && hv < 0.3, stoneGround = race === 'human' && hv >= 0.3 && hv < 0.6, porch = race === 'human' && hv >= 0.6 && hv < 0.8;
  const tallOther = (race === 'elf' || race === 'goblin') && hv < 0.35; // a storey taller
  const wallH = race === 'human' ? (tall ? 4 : 3) : race === 'goblin' ? (tallOther ? 3 : 2) : (tallOther ? 5 : 4);
  const wy = race === 'elf' ? 2 : 1; // window row
  for (let y = g; y < g + wallH; y++) {
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      if (i > 0 && i < 4 && j > 0 && j < 4) continue;
      const corner = (i === 0 || i === 4) && (j === 0 || j === 4);
      if (j === 0 && i === 2 && y < g + 2) continue; // door
      let t = wall;
      if (corner) t = race === 'human' ? B.LOG : race === 'elf' ? B.GOLD : B.BONE;
      else if (y === g && race !== 'elf') t = B.COBBLE; // stone footing
      else if (y === g && race === 'elf') t = B.COBBLE;
      else if (race === 'human' && y === g + wallH - 1) t = B.COBBLE; // stone course under the eaves
      else if (stoneGround && y <= g + 1) t = B.COBBLE; // stone ground floor
      const winFront = j === 0 && (i === 1 || i === 3) && y === g + 1;
      const winBack = j === 4 && i === 2 && y === g + wy;
      const winSide = (i === 0 || i === 4) && j === 2 && y === g + wy && race !== 'goblin';
      const upRow = race === 'elf' ? g + 4 : g + 2;
      const winUp = ((tall && race === 'human') || (tallOther && race === 'elf')) && y === upRow && ((j === 0 && (i === 1 || i === 3)) || (j === 4 && i === 2) || ((i === 0 || i === 4) && j === 2));
      if (winFront && race !== 'goblin') t = B.GLASS;
      else if (winUp) t = B.GLASS;
      else if (winBack || winSide) t = B.GLASS;
      plan.push([ax + i, y, az + j, t]);
    }
  }
  // door frame and a step
  plan.push([ax + 2, g + 2, az, race === 'elf' ? B.GOLD : B.SHUTTER]);
  plan.push([ax + 2, g, az - 1, B.COBBLE]);
  if (race === 'human') {
    plan.push([ax + 2, g + 2, az, B.LOG]); // door lintel
    plan.push([ax + 4, g, az - 1, B.LOG], [ax + 4, g + 1, az - 1, B.GOLD]); // lantern post beside the door
    if (hv >= 0.5) { // low garden fence with a gate gap
      for (const i of [0, 6]) { plan.push([x0 + i, g, z0, B.LOG], [x0 + i, g + 1, z0, B.LOG]); }
      for (const i of [1, 5]) plan.push([x0 + i, g, z0, B.PLANK]);
    }
  }
  if (porch) { // pergola over the door
    for (const i of [1, 2, 3]) plan.push([ax + i, g + 3, az - 1, B.SHUTTER]);
    for (const i of [1, 3]) for (let y = g; y < g + 3; y++) plan.push([ax + i, y, az - 1, y < g + 3 ? B.LOG : B.SHUTTER]);
  }
  if (race === 'human' && !porch) {
    plan.push([ax + 1, g + 1, az - 1, B.SHUTTER], [ax + 3, g + 1, az - 1, B.SHUTTER]); // flower boxes
    plan.push([ax + 1, g + 2, az - 1, B.FLOWER], [ax + 3, g + 2, az - 1, B.FLOWER]);
  }
  const ry = g + wallH;
  const layer = (y, x1, z1, n, t) => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) plan.push([x1 + i, y, z1 + j, t]);
  };
  const rect = (y, x1, z1, w, d, t) => { for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) plan.push([x1 + i, y, z1 + j, t]); };
  if (race === 'human') {
    // gabled roof running east-west, with eaves, a ridge, gable ends and a chimney
    rect(ry, x0, z0, 7, 7, roof);
    rect(ry + 1, x0, z0 + 1, 7, 5, roof);
    rect(ry + 2, x0, z0 + 2, 7, 3, roof);
    rect(ry + 3, x0, z0 + 3, 7, 1, B.SHUTTER); // ridge beam
    for (let i = 0; i < 7; i++) { plan.push([x0 + i, ry, z0, B.MARBLE], [x0 + i, ry, z0 + 6, B.MARBLE]); } // white fascia boards along the eaves
    for (const j of [2, 3, 4]) { plan.push([x0 + 1, ry + 1, z0 + j, B.PLANK], [x0 + 5, ry + 1, z0 + j, B.PLANK]); }
    plan.push([x0 + 1, ry + 1, z0 + 3, B.GLASS]);
    if (hv >= 0.2 && hv < 0.7) { // front dormer
      plan.push([x0 + 2, ry + 1, z0 + 1, humanWall], [x0 + 4, ry + 1, z0 + 1, humanWall], [x0 + 3, ry + 1, z0 + 1, B.GLASS], [x0 + 3, ry + 2, z0 + 1, roof], [x0 + 2, ry + 2, z0 + 1, roof], [x0 + 4, ry + 2, z0 + 1, roof]);
    }
    for (let y = ry; y < ry + 5; y++) plan.push([x0 + (tall ? 1 : 5), y, z0 + 4, B.COBBLE]);
    plan.push([x0 + (tall ? 1 : 5), ry + 5, z0 + 4, B.SCORCH]);
  } else if (race === 'goblin') {
    // hide-and-thatch hut: a squat cone, skull totem and a fence stub
    layer(ry, x0 + 1, z0 + 1, 5, roof); layer(ry + 1, x0 + 2, z0 + 2, 3, B.THATCH);
    plan.push([x0 + 3, ry + 2, z0 + 3, B.LOG], [x0 + 3, ry + 3, z0 + 3, B.LOG], [x0 + 3, ry + 4, z0 + 3, B.BONE]);
    plan.push([x0, g, z0 + 1, B.LOG], [x0, g + 1, z0 + 1, B.BONE], [x0 + 6, g, z0 + 1, B.LOG], [x0 + 6, g + 1, z0 + 1, B.BONE]); // bone posts by the door
    plan.push([ax + 2, g + 2, az, B.BONE]);
  } else {
    // elven spire: tapering marble tower with a violet roof, gold finial and arched trim
    layer(ry, x0 + 1, z0 + 1, 5, roof); layer(ry + 1, x0 + 2, z0 + 2, 3, roof);
    plan.push([x0 + 3, ry + 2, z0 + 3, roof], [x0 + 3, ry + 3, z0 + 3, roof], [x0 + 3, ry + 4, z0 + 3, B.GOLD]);
    for (const [i, j] of [[0, 0], [4, 0], [0, 4], [4, 4]]) plan.push([ax + i, ry, az + j, B.GOLD]); // corner finials
    plan.push([ax + 1, g + 3, az, B.GOLD], [ax + 3, g + 3, az, B.GOLD]); // lintels
    plan.push([ax + 2, g + 3, az, B.GLASS]);
  }
  if (capital) {
    for (let y = g; y < g + wallH + 6; y++) plan.push([x0, y, z0, B.LOG]);
    const fy = g + wallH + 4;
    plan.push([x0 + 1, fy, z0, roof], [x0 + 2, fy, z0, roof], [x0 + 3, fy, z0, roof], [x0 + 1, fy + 1, z0, roof], [x0 + 2, fy + 1, z0, roof], [x0, fy + 2, z0, B.GOLD]);
  }
  const seen = new Map();
  for (const c of plan) seen.set(c[0] + ',' + c[1] + ',' + c[2], c); // later entries win
  const out = [...seen.values()];
  out.sort((a, b) => a[1] - b[1]);
  return out;
}

// ---------- terrain generation ----------

export function generate(seed) {
  const R = rng(seed);
  const n1 = makeNoise(seed), n2 = makeNoise(seed + 77), n3 = makeNoise(seed + 991);
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const e = n1.fbm(x / 60, z / 60, 5) * 1.8;
    const r = 1 - Math.abs(n2.fbm(x / 38 + 31, z / 38 - 17, 4) * 2);
    const mount = Math.pow(Math.max(0, r), 3) * smooth(0.0, 0.5, e) * 18;
    const d = Math.hypot(x / W - 0.5, z / D - 0.5) * 2;
    let h = 14.5 + e * 10 + mount - Math.pow(Math.max(0, d - 0.35), 2) * 45;
    h = Math.max(2, Math.min(H - 10, Math.round(h)));
    for (let y = 0; y <= h; y++) {
      let t = B.STONE;
      if (h <= SEA + 1) t = y >= h - 2 ? B.SAND : B.STONE;
      else if (h > 31) t = y === h ? B.SNOW : B.STONE;
      else if (h > 25) t = B.STONE;
      else if (y === h) t = B.GRASS;
      else if (y > h - 4) t = B.DIRT;
      vox[idx(x, y, z)] = t;
    }
    height[z * W + x] = h;
  }
  // forests
  for (let z = 3; z < D - 3; z++) for (let x = 3; x < W - 3; x++) {
    const h = height[z * W + x];
    if (vox[idx(x, h, z)] !== B.GRASS && !(h > 25 && h < 31)) continue;
    if (colOcc[z * W + x]) continue;
    const forest = n3.fbm(x / 28, z / 28, 3) * 2;
    const p = 0.012 + Math.max(0, forest) * 0.17;
    if (R() > p) continue;
    let slope = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) slope = Math.max(slope, Math.abs(height[(z + dz) * W + x + dx] - h));
    if (slope > 1) continue;
    let near = false;
    for (let dz = -2; dz <= 2 && !near; dz++) for (let dx = -2; dx <= 2; dx++) if (colOcc[(z + dz) * W + x + dx]) { near = true; break; }
    if (near) continue;
    plantTree(x, z, R, h > 21 || forest > 0.45 ? 'pine' : 'oak');
  }
  worldInfo.baseStructs = structs.length - 1;
  worldInfo.seed = seed;
  markAllDirty();
}

export function markAllDirty() {
  dirty.clear();
  for (let i = 0; i < CX * CZ; i++) dirty.add(i);
}

// ---------- chunk meshing ----------

const FACES = [
  { n: [1, 0, 0], o: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], shade: 0.86 },
  { n: [-1, 0, 0], o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.86 },
  { n: [0, 1, 0], o: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], shade: 1.0 },
  { n: [0, -1, 0], o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.6 },
  { n: [0, 0, 1], o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.93 },
  { n: [0, 0, -1], o: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0], shade: 0.93 },
];
const AO = [1, 0.8, 0.66, 0.52];
const chunkMeshes = [];
let chunkMat;
const seasonU = { uAutumn: { value: 0 }, uSnow: { value: 0 } };
export function setSeasonLook(autumn, snow) { seasonU.uAutumn.value = autumn; seasonU.uSnow.value = snow; }

const solidM = (x, y, z) => {
  if (y < 0) return 1;
  if (x < 0 || x >= W || z < 0 || z >= D || y >= H) return 0;
  return vox[idx(x, y, z)] ? 1 : 0;
};

function buildChunk(c) {
  const cx = c % CX, cz = (c / CX) | 0;
  const x0 = cx * CS, z0 = cz * CS;
  let maxY = 0;
  for (let z = z0; z < z0 + CS; z++) for (let x = x0; x < x0 + CS; x++) maxY = Math.max(maxY, height[z * W + x]);
  const pos = [], nor = [], col = [], tex = [], ind = [];
  let vc = 0;
  const ao = [0, 0, 0, 0];
  for (let y = 0; y <= maxY; y++) for (let z = z0; z < z0 + CS; z++) for (let x = x0; x < x0 + CS; x++) {
    const t = vox[idx(x, y, z)];
    if (!t) continue;
    const def = BLOCK[t];
    const jitter = 0.94 + hash3(x, y, z) * 0.12;
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
      if (solidM(nx, ny, nz)) continue;
      const base = F.n[1] === 1 ? def.top : def.side;
      const k = jitter * F.shade;
      for (let q = 0; q < 4; q++) {
        const su = q === 1 || q === 2 ? 1 : 0, sv = q >= 2 ? 1 : 0;
        const ux = su ? F.u[0] : -F.u[0], uy = su ? F.u[1] : -F.u[1], uz = su ? F.u[2] : -F.u[2];
        const wx = sv ? F.v[0] : -F.v[0], wy = sv ? F.v[1] : -F.v[1], wz = sv ? F.v[2] : -F.v[2];
        const s1 = solidM(nx + ux, ny + uy, nz + uz);
        const s2 = solidM(nx + wx, ny + wy, nz + wz);
        const cc = solidM(nx + ux + wx, ny + uy + wy, nz + uz + wz);
        const occ = s1 && s2 ? 3 : s1 + s2 + cc;
        ao[q] = occ;
        pos.push(
          x + F.o[0] + su * F.u[0] + sv * F.v[0],
          y + F.o[1] + su * F.u[1] + sv * F.v[1],
          z + F.o[2] + su * F.u[2] + sv * F.v[2],
        );
        nor.push(F.n[0], F.n[1], F.n[2]);
        const l = k * AO[occ];
        col.push(base.r * l, base.g * l, base.b * l);
        tex.push(def.tex || 0);
      }
      if (ao[0] + ao[2] > ao[1] + ao[3]) ind.push(vc + 1, vc + 2, vc + 3, vc + 1, vc + 3, vc);
      else ind.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      vc += 4;
    }
  }
  const mesh = chunkMeshes[c];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aTex', new THREE.Float32BufferAttribute(tex, 1));
  geo.setIndex(vc > 65000 ? new THREE.Uint32BufferAttribute(ind, 1) : new THREE.Uint16BufferAttribute(ind, 1));
  geo.computeBoundingSphere();
  mesh.geometry.dispose();
  mesh.geometry = geo;
}

export function initChunks(scene) {
  chunkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // seasons: tint leaves/grass in autumn and frost up-facing surfaces in winter
  chunkMat.onBeforeCompile = (sh) => {
    sh.uniforms.uAutumn = seasonU.uAutumn; sh.uniforms.uSnow = seasonU.uSnow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; attribute float aTex; varying float vTex;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTex = aTex; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vTex; uniform float uAutumn; uniform float uSnow;\nfloat th(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        bool top = vWN.y > 0.5;
        float tu = top ? vWP.x : (abs(vWN.x) > 0.5 ? vWP.z : vWP.x);
        float tv = top ? vWP.z : vWP.y;
        float k = vTex;
        if (k > 0.5 && k < 1.5) { // brick courses with offset joints
          float r = tv * 3.0, row = floor(r), bu = tu * 2.0 + mod(row, 2.0) * 0.5;
          float mortar = 1.0 - step(0.12, fract(r)) * step(0.08, fract(bu));
          diffuseColor.rgb *= mix(0.93 + 0.14 * th(vec2(floor(bu), row)), 0.7, mortar);
        } else if (k > 1.5 && k < 2.5 && !top) { // horizontal planks with butt joints
          float r = tv * 3.0, row = floor(r);
          float seam = step(abs(fract(tu * 0.5 + th(vec2(row, 3.0))) - 0.5), 0.015);
          diffuseColor.rgb *= (0.94 + 0.1 * th(vec2(row, floor(tu * 0.5)))) * (1.0 - 0.2 * step(fract(r), 0.1)) * (1.0 - 0.15 * seam);
        } else if (k > 2.5 && k < 3.5) { // thatch / rough mud streaks
          diffuseColor.rgb *= 0.86 + 0.22 * th(vec2(floor(tu * 6.0), floor(tv * 2.0 + tu)));
        } else if (k > 3.5) { // roof shingles, staggered
          float r = tv * 2.0, row = floor(r), cu = tu * 3.0 + mod(row, 2.0) * 0.5;
          float edge = smoothstep(0.0, 0.2, fract(r));
          diffuseColor.rgb *= (0.76 + 0.24 * edge) * (0.93 + 0.12 * th(vec2(floor(cu), row))) * (1.0 - 0.1 * step(fract(cu), 0.06));
        }
      }
      float gr = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
      float leaf = smoothstep(0.02, 0.1, gr);
      float hsh = fract(sin(dot(floor(vWP.xz * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
      vec3 fall = mix(vec3(0.86, 0.45, 0.1), vec3(0.72, 0.2, 0.08), step(0.7, hsh));
      diffuseColor.rgb = mix(diffuseColor.rgb, fall * (0.7 + 0.5 * dot(diffuseColor.rgb, vec3(0.33))), leaf * uAutumn * 0.85);
      float snowy = smoothstep(0.55, 0.9, vWN.y) * smoothstep(SEA_LVL, SEA_LVL + 0.8, vWP.y) * uSnow;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), snowy * 0.92);`.replaceAll('SEA_LVL', (SEA + 0.6).toFixed(2)));
  };
  for (let c = 0; c < CX * CZ; c++) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), chunkMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    chunkMeshes.push(mesh);
  }
}

export function rebuildDirty(maxN = 10) {
  let n = 0;
  for (const c of dirty) {
    dirty.delete(c);
    buildChunk(c);
    if (++n >= maxN) break;
  }
}

// ---------- raycasting (Amanatides & Woo voxel traversal) ----------

export function raycast(o, d, maxDist = 600) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
  const dx = Math.abs(1 / d.x), dy = Math.abs(1 / d.y), dz = Math.abs(1 / d.z);
  let tx = d.x === 0 ? Infinity : (d.x > 0 ? x + 1 - o.x : o.x - x) * dx;
  let ty = d.y === 0 ? Infinity : (d.y > 0 ? y + 1 - o.y : o.y - y) * dy;
  let tz = d.z === 0 ? Infinity : (d.z > 0 ? z + 1 - o.z : o.z - z) * dz;
  let t = 0, fx = 0, fy = 0, fz = 0;
  while (t <= maxDist) {
    if (inB(x, y, z) && vox[idx(x, y, z)]) return { x, y, z, fx, fy, fz, t };
    if (y < 0 && d.y < 0) return null;
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += dx; fx = -sx; fy = 0; fz = 0; }
    else if (ty < tz) { y += sy; t = ty; ty += dy; fx = 0; fy = -sy; fz = 0; }
    else { z += sz; t = tz; tz += dz; fx = 0; fy = 0; fz = -sz; }
  }
  return null;
}
