// The Earth map. Real Natural Earth coastlines, country borders, mountain ranges and deserts are
// baked into assets/earth.bin by tools/build-earth.mjs (720x288 cells, half a degree each). Regions
// are unions of whole real countries (big countries are split), so every border is a real one.
import { makeNoise } from './noise.js';

export const LON0 = -180, LAT0 = 80, STEP = 0.5; // must match tools/build-earth.mjs

export const BIOME = { t: 0, d: 1, a: 2, r: 3, b: 4, s: 5, m: 6 };
export const BIOME_NAME = ['temperate', 'desert', 'arctic', 'tropical', 'boreal', 'steppe', 'alpine'];

export const earth = {
  active: false,
  data: null,       // { W, D, flags, region, relief, names } once loaded
  region: null,     // Uint8Array(W*D): region id (1-based) per column, 0 = sea
  biome: null,      // Uint8Array(W*D): biome code per column
  regions: [],      // { id, name, biome, area, cx, cz, owner, houses }
  W: 0, D: 0,
};

export const regionAt = (x, z) => (earth.region && x >= 0 && z >= 0 && x < earth.W && z < earth.D ? earth.region[(z | 0) * earth.W + (x | 0)] : 0);
export const regionOf = (x, z) => earth.regions[regionAt(x, z) - 1] || null;
export const lonLat = (x, z) => ({ lon: LON0 + (x + 0.5) * STEP, lat: LAT0 - (z + 0.5) * STEP });

// Fetches and unpacks the baked map. Resolves false if it cannot be loaded (the game then falls
// back to the random island generator).
export async function loadEarth(url = 'assets/earth.bin') {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const dv = new DataView(buf.buffer);
    if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'WSE1') return false;
    const W = dv.getUint16(4, true), D = dv.getUint16(6, true), nReg = dv.getUint16(8, true), metaLen = dv.getUint32(10, true);
    const names = JSON.parse(new TextDecoder().decode(buf.subarray(16, 16 + metaLen)));
    const o = 16 + metaLen, n = W * D;
    earth.data = { W, D, nReg, names, flags: buf.subarray(o, o + n), region: buf.subarray(o + n, o + 2 * n), relief: buf.subarray(o + 2 * n, o + 3 * n) };
    return true;
  } catch (e) { console.warn('Earth map unavailable:', e); return false; }
}

// Distance transform (chamfer): for every cell the distance to the nearest cell where `isSrc` is true.
function distance(W, D, isSrc) {
  const BIG = 1e5, out = new Float32Array(W * D);
  for (let i = 0; i < W * D; i++) out[i] = isSrc(i) ? 0 : BIG;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x; let v = out[i];
    if (x > 0) v = Math.min(v, out[i - 1] + 1);
    if (z > 0) { v = Math.min(v, out[i - W] + 1); if (x > 0) v = Math.min(v, out[i - W - 1] + 1.4); if (x < W - 1) v = Math.min(v, out[i - W + 1] + 1.4); }
    out[i] = v;
  }
  for (let z = D - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) {
    const i = z * W + x; let v = out[i];
    if (x < W - 1) v = Math.min(v, out[i + 1] + 1);
    if (z < D - 1) { v = Math.min(v, out[i + W] + 1); if (x < W - 1) v = Math.min(v, out[i + W + 1] + 1.4); if (x > 0) v = Math.min(v, out[i + W - 1] + 1.4); }
    out[i] = v;
  }
  return out;
}

// Turns the baked map into voxel heights. Returns { h, biome, land }.
export function buildEarth(W, D, SEA, H, seed) {
  const E = earth.data;
  if (!E || E.W !== W || E.D !== D) throw new Error('Earth map data does not match the world size');
  const n1 = makeNoise(seed), n2 = makeNoise(seed + 31), n3 = makeNoise(seed + 977);
  const land = new Uint8Array(W * D), biome = new Uint8Array(W * D);
  for (let i = 0; i < W * D; i++) { land[i] = E.flags[i] & 1; biome[i] = (E.flags[i] >> 1) & 7; }
  const dLand = distance(W, D, i => land[i] === 0); // land: steps to the sea
  const dSea = distance(W, D, i => land[i] === 1);  // sea: steps to land

  const h = new Uint8Array(W * D);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x;
    const nn = n1.fbm(x / 20, z / 20, 4), ns = n2.fbm(x / 7, z / 7, 2);
    if (land[i]) {
      const dl = dLand[i];
      if (dl <= 1.01) { h[i] = SEA + 1; continue; }
      const rel = E.relief[i];
      const ridged = 1 - Math.abs(n3.fbm(x / 9, z / 9, 3)) * 2; // craggy ridges inside mountain footprints
      const inland = Math.min(dl - 1, 14);
      const v = SEA + 1 + inland * 0.3 + (nn * 3.6 + 1.2) * Math.min(1, dl / 7) + ns * 0.8 + rel * (0.75 + 0.5 * ridged) * Math.min(1, dl / 3);
      h[i] = Math.max(SEA + 2, Math.min(H - 6, Math.round(v)));
    } else {
      const ds = Math.min(dSea[i], 14);
      h[i] = Math.max(3, Math.round(SEA - 1 - ds * 0.75 + nn * 1.4));
    }
  }

  // regions
  const names = E.names;
  const regions = names.map((name, k) => ({ id: k + 1, name, biome: 0, area: 0, cx: 0, cz: 0, owner: 0, houses: 0 }));
  const bcount = regions.map(() => new Int32Array(7));
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x, rid = land[i] ? E.region[i] : 0;
    if (!rid) continue;
    const r = regions[rid - 1];
    r.area++; r.cx += x; r.cz += z; bcount[rid - 1][biome[i]]++;
  }
  regions.forEach((r, k) => {
    if (r.area) { r.cx /= r.area; r.cz /= r.area; }
    let b = 0; for (let j = 1; j < 7; j++) if (bcount[k][j] > bcount[k][b]) b = j;
    r.biome = b;
  });
  const region = new Uint8Array(W * D);
  for (let i = 0; i < W * D; i++) region[i] = land[i] ? E.region[i] : 0;
  earth.active = true; earth.W = W; earth.D = D; earth.region = region; earth.biome = biome; earth.regions = regions;
  return { h, biome, land };
}
