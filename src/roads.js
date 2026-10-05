// Roads: nobody builds them. Foot traffic wears a column down until it is paved, and the
// pathfinder and walking speed then prefer paved columns, which draws more traffic.
import { W, D, SEA, B, vox, owner, height, idx, set, colOcc } from './world.js';

const PAVE_AT = 4;       // trample (roughly seconds of walking) before a column is paved
const DECAY_EVERY = 4;   // sim seconds between fading sweeps over unpaved wear
const DECAY = 0.85;      // wear multiplier per sweep
export const ROAD_COST = 0.55;  // A* step cost on a road (1 = open ground)
export const ROAD_SPEED = 1.3;  // walking speed multiplier on a road
const PAVABLE = new Set([B.GRASS, B.DIRT, B.SAND]);

export const roads = new Uint8Array(W * D);
export const roadStats = { tiles: 0 };
const wear = new Map();
export const traffic = new Map(); // paved column -> how much foot traffic it carries (drives waystations)
let decayT = 0;

// True if column c currently has a road on top. Self-heals when the ground was since
// destroyed or reshaped (meteors, terraforming), so stale flags never steer units.
export function onRoadCol(c) {
  if (!roads[c]) return false;
  const y = height[c];
  if (y >= 0 && vox[idx(c % W, y, (c / W) | 0)] === B.ROAD) return true;
  roads[c] = 0;
  roadStats.tiles--;
  return false;
}

export const onRoadXZ = (x, z) => onRoadCol(Math.floor(z) * W + Math.floor(x));

function pave(x, z, c) {
  const y = height[c];
  if (y <= SEA || colOcc[c]) return;
  const i = idx(x, y, z);
  if (owner[i] || !PAVABLE.has(vox[i])) return;
  if (set(x, y, z, B.ROAD)) { roads[c] = 1; roadStats.tiles++; }
}

export function trample(x, z, amount) {
  if (x < 1 || z < 1 || x >= W - 1 || z >= D - 1) return;
  const c = z * W + x;
  if (roads[c]) { traffic.set(c, (traffic.get(c) || 0) + amount); return; }
  const w = (wear.get(c) || 0) + amount;
  if (w >= PAVE_AT) { wear.delete(c); pave(x, z, c); } else wear.set(c, w);
}

export function updateRoads(dt) {
  decayT += dt;
  if (decayT < DECAY_EVERY) return;
  decayT = 0;
  for (const [c, w] of traffic) { const t = w * 0.97; if (t < 0.5 || !roads[c]) traffic.delete(c); else traffic.set(c, t); }
  for (const [c, w] of wear) {
    const n = w * DECAY;
    if (n < 0.15) wear.delete(c); else wear.set(c, n);
  }
}
