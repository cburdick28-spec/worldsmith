// Regions and borders: every region of the Earth map has fixed borders. The nation with the most
// houses in a region controls it, which earns knowledge and coin. Borders are drawn as glowing
// curtains in the world (coloured by whoever controls each side) and as lines on the minimap.
import * as THREE from '../vendor/three.module.js';
import { W, D, topAt } from './world.js';
import { earth, BIOME_NAME } from './earth.js';
import { nations, game, nm } from './nations.js';
import { log } from './ui.js';
import { sfx } from './audio.js';

let lastYear = -1;
let edges = [], mesh = null, posAttr = null, colAttr = null, visible = true;
export const regionStats = { claimed: 0 };

const NEUTRAL = new THREE.Color('#e9eef5'), CONTESTED = new THREE.Color('#ff6b4a');
const nationById = id => nations.find(n => n.id === id && n.alive) || null;
export const regionsOf = n => n.regionCount || 0;

// ---------- control ----------

export function updateRegions() {
  if (!earth.active || game.year === lastYear) return;
  lastYear = game.year;
  const counts = new Map();
  for (const n of nations) {
    if (!n.alive) continue;
    for (const h of n.houses) {
      const rid = earth.region[Math.floor(h.cz) * W + Math.floor(h.cx)];
      if (!rid) continue;
      let m = counts.get(rid);
      if (!m) { m = new Map(); counts.set(rid, m); }
      m.set(n.id, (m.get(n.id) || 0) + 1);
    }
  }
  for (const n of nations) n.regionCount = 0;
  let claimed = 0;
  for (const r of earth.regions) {
    const m = counts.get(r.id);
    let best = 0, bc = 0;
    if (m) for (const [nid, c] of m) if (c > bc || (c === bc && nid === r.owner)) { best = nid; bc = c; }
    const prev = r.owner;
    if (best !== prev) {
      const nb = best ? nationById(best) : null, np = prev ? nationById(prev) : null;
      if (nb && np) log(`🚩 <b>${r.name}</b> passes from ${nm(np)} to ${nm(nb)}.`);
      else if (nb) log(`🚩 ${nm(nb)} claims <b>${r.name}</b>.`);
      if (nb) sfx('chime', r.cx, r.cz, 0.5);
      r.owner = best;
    }
    r.houses = bc;
    const o = r.owner ? nationById(r.owner) : null;
    if (o) { o.regionCount++; o.gold += 1.5; claimed++; }
  }
  regionStats.claimed = claimed;
  refreshBorders();
}

// ---------- border curtains ----------

export function initBorders(scene) {
  if (!earth.active) return;
  edges = [];
  const R = earth.region;
  for (let z = 0; z < D - 1; z++) for (let x = 0; x < W - 1; x++) {
    const a = R[z * W + x];
    if (!a) continue;
    const r = R[z * W + x + 1], d = R[(z + 1) * W + x];
    if (r && r !== a) edges.push({ x0: x + 1, z0: z, x1: x + 1, z1: z + 1, a, b: r, ca: z * W + x, cb: z * W + x + 1 });
    if (d && d !== a) edges.push({ x0: x, z0: z + 1, x1: x + 1, z1: z + 1, a, b: d, ca: z * W + x, cb: (z + 1) * W + x });
  }
  const n = edges.length;
  // per edge: a vertical curtain (4 verts) and a flat ribbon on the ground (4 verts)
  const pos = new Float32Array(n * 24), col = new Float32Array(n * 32), idx = new Uint32Array(n * 12);
  for (let i = 0; i < n; i++) {
    const v = i * 8;
    idx.set([v, v + 1, v + 2, v, v + 2, v + 3, v + 4, v + 5, v + 6, v + 4, v + 6, v + 7], i * 12);
  }
  const g = new THREE.BufferGeometry();
  posAttr = new THREE.BufferAttribute(pos, 3); colAttr = new THREE.BufferAttribute(col, 4);
  posAttr.setUsage(THREE.DynamicDrawUsage); colAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', posAttr); g.setAttribute('color', colAttr); g.setIndex(new THREE.BufferAttribute(idx, 1));
  mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  scene.add(mesh);
  refreshBorders(true);
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyO' && e.target.tagName !== 'INPUT') { visible = !visible; mesh.visible = visible; }
  });
}

function tint(rid, out) {
  const r = earth.regions[rid - 1], o = r && r.owner ? nationById(r.owner) : null;
  return o ? out.copy(o.color) : null;
}
const ca = new THREE.Color(), cb = new THREE.Color();

function refreshBorders(geometryToo = true) {
  if (!mesh) return;
  const pos = posAttr.array, col = colAttr.array;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (geometryToo) {
      const ta = topAt(e.ca % W, (e.ca / W) | 0), tb = topAt(e.cb % W, (e.cb / W) | 0);
      const y0 = Math.min(ta, tb) + 1.02, y1 = Math.max(ta, tb) + 4.5, yr = Math.max(ta, tb) + 1.06;
      const p = i * 24;
      pos[p] = e.x0; pos[p + 1] = y0; pos[p + 2] = e.z0;
      pos[p + 3] = e.x1; pos[p + 4] = y0; pos[p + 5] = e.z1;
      pos[p + 6] = e.x1; pos[p + 7] = y1; pos[p + 8] = e.z1;
      pos[p + 9] = e.x0; pos[p + 10] = y1; pos[p + 11] = e.z0;
      // ribbon: the edge widened by half a voxel each side (perpendicular to it)
      const dx = e.x1 - e.x0, dz = e.z1 - e.z0, px = -dz * 0.5, pz = dx * 0.5;
      pos[p + 12] = e.x0 - px; pos[p + 13] = yr; pos[p + 14] = e.z0 - pz;
      pos[p + 15] = e.x1 - px; pos[p + 16] = yr; pos[p + 17] = e.z1 - pz;
      pos[p + 18] = e.x1 + px; pos[p + 19] = yr; pos[p + 20] = e.z1 + pz;
      pos[p + 21] = e.x0 + px; pos[p + 22] = yr; pos[p + 23] = e.z0 + pz;
    }
    const A = tint(e.a, ca), B = tint(e.b, cb);
    let c, al = 0.5, rib = 0.55;
    if (A && B) { c = A === B || A.equals(B) ? A : CONTESTED; al = 0.7; rib = 0.9; }
    else if (A || B) { c = A || B; al = 0.62; rib = 0.8; }
    else { c = NEUTRAL; al = 0.3; rib = 0.5; }
    const q = i * 32;
    for (let k = 0; k < 8; k++) { col[q + k * 4] = c.r; col[q + k * 4 + 1] = c.g; col[q + k * 4 + 2] = c.b; }
    col[q + 3] = col[q + 7] = al; col[q + 11] = col[q + 15] = 0;
    col[q + 19] = col[q + 23] = col[q + 27] = col[q + 31] = rib;
  }
  if (geometryToo) posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
}

// ---------- HUD ----------

let lastLabel = '';
export function updateRegionHUD(x, z) {
  const el = document.getElementById('region');
  if (!el || !earth.active) return;
  const rid = earth.region[Math.floor(z) * W + Math.floor(x)];
  let txt;
  if (!rid) txt = '🌊 Open sea';
  else {
    const r = earth.regions[rid - 1], o = r.owner ? nationById(r.owner) : null;
    txt = `📍 ${r.name} · ${BIOME_NAME[r.biome]} · ${o ? o.name : 'unclaimed'}`;
  }
  if (txt !== lastLabel) { el.textContent = txt; lastLabel = txt; }
}
