// Connected-component labels for the world: land masses get positive ids, bodies of water negative.
import { W, D, SEA, height } from './world.js';

const label = new Int32Array(W * D);
let stamp = -1e9, landCount = 0;
const stack = new Int32Array(W * D), sizes = new Map();

function fill(start, id, land) {
  let sp = 0, count = 1;
  stack[sp++] = start; label[start] = id;
  while (sp) {
    const i = stack[--sp], x = i % W, z = (i / W) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = z + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
      const j = nz * W + nx;
      if (label[j] !== 0 || (height[j] >= SEA) !== land) continue;
      label[j] = id; stack[sp++] = j; count++;
    }
  }
  sizes.set(id, count);
}

export function refreshLandmass(force = false) {
  const now = performance.now();
  if (!force && now - stamp < 20000) return;
  stamp = now;
  label.fill(0); sizes.clear();
  let l = 0, w = 0;
  for (let i = 0; i < W * D; i++) {
    if (label[i] !== 0) continue;
    if (height[i] >= SEA) fill(i, ++l, true); else fill(i, -(++w), false);
  }
  landCount = l;
}

export function compAt(x, z) {
  refreshLandmass();
  x = Math.floor(x); z = Math.floor(z);
  return x < 0 || z < 0 || x >= W || z >= D ? 0 : label[z * W + x];
}
export const isWaterAt = (x, z) => height[Math.floor(z) * W + Math.floor(x)] < SEA;
export const compSize = id => sizes.get(id) || 0;
