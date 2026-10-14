// Offline build step for the Earth map (not needed at runtime):
//   node tools/build-earth.mjs /path/to/natural-earth-vector/geojson assets/earth.bin
// Rasterises Natural Earth 1:50m data onto the game's 720x288 grid (0.5 degrees per cell) and writes
// one small gzipped file: land flags + biome, region ids, and mountain relief. Regions are unions of
// whole real countries (big countries are split between several seeds), so borders follow reality.
import fs from 'fs';
import zlib from 'zlib';

const [, , SRC, OUT] = process.argv;
if (!SRC || !OUT) { console.error('usage: node tools/build-earth.mjs <natural-earth geojson dir> <out file>'); process.exit(1); }

const W = 720, D = 288, LON0 = -180, LAT0 = 80, STEP = 0.5; // must match src/earth.js
const SS = 2; // supersampling per axis
const load = f => JSON.parse(fs.readFileSync(`${SRC}/${f}.geojson`, 'utf8'));

// ---------- scanline polygon fill (even-odd within a polygon) ----------
function polysOf(geom) { return geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []; }

// calls fill(row, colStart, colEnd) for every span of grid pixels whose centre lies inside the geometry
function fillGeom(geom, step, gw, gh, fill) {
  for (const poly of polysOf(geom)) {
    const edges = [];
    let minLat = 1e9, maxLat = -1e9;
    for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1] : [x1, y1, x0, y0]);
      minLat = Math.min(minLat, y0, y1); maxLat = Math.max(maxLat, y0, y1);
    }
    if (!edges.length) continue;
    const r0 = Math.max(0, Math.floor((LAT0 - maxLat) / step - 0.5)), r1 = Math.min(gh - 1, Math.ceil((LAT0 - minLat) / step - 0.5));
    for (let r = r0; r <= r1; r++) {
      const lat = LAT0 - (r + 0.5) * step;
      const xs = [];
      for (const [x0, y0, x1, y1] of edges) if (lat >= y0 && lat < y1) xs.push(x0 + (x1 - x0) * (lat - y0) / (y1 - y0));
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - LON0) / step - 0.5)), c1 = Math.min(gw - 1, Math.floor((xs[k + 1] - LON0) / step - 0.5));
        if (c1 >= c0) fill(r, c0, c1);
      }
    }
  }
}

// ---------- land, countries, lakes at supersampled resolution ----------
const gw = W * SS, gh = D * SS, sstep = STEP / SS;
const landS = new Uint8Array(gw * gh), lakeS = new Uint8Array(gw * gh), countryS = new Uint8Array(gw * gh);
const land = load('ne_50m_land'), countries = load('ne_50m_admin_0_countries'), lakes = load('ne_50m_lakes');
for (const f of land.features) fillGeom(f.geometry, sstep, gw, gh, (r, a, b) => landS.fill(1, r * gw + a, r * gw + b + 1));
const cnames = [''];
countries.features.forEach((f, i) => {
  const id = i + 1;
  cnames[id] = f.properties.ADMIN || f.properties.NAME;
  fillGeom(f.geometry, sstep, gw, gh, (r, a, b) => countryS.fill(id, r * gw + a, r * gw + b + 1));
});
for (const f of lakes.features) fillGeom(f.geometry, sstep, gw, gh, (r, a, b) => lakeS.fill(1, r * gw + a, r * gw + b + 1));

// ---------- downsample to cells ----------
const isLand = new Uint8Array(W * D), country = new Uint8Array(W * D);
for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
  let l = 0; const votes = new Map();
  for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
    const p = (z * SS + j) * gw + x * SS + i;
    if ((landS[p] || countryS[p]) && !lakeS[p]) { l++; const c = countryS[p]; if (c) votes.set(c, (votes.get(c) || 0) + 1); }
  }
  if (l * 2 >= SS * SS) {
    isLand[z * W + x] = 1;
    let best = 0, bv = 0; for (const [c, v] of votes) if (v > bv) { bv = v; best = c; }
    country[z * W + x] = best;
  }
}
// land with no country (small islands, border slivers): borrow the nearest country within 4 cells
for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
  const i = z * W + x;
  if (!isLand[i] || country[i]) continue;
  let bd = 99, bc = 0;
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const xx = x + dx, zz = z + dz;
    if (xx < 0 || zz < 0 || xx >= W || zz >= D || !country[zz * W + xx]) continue;
    const d = dx * dx + dz * dz; if (d < bd) { bd = d; bc = country[zz * W + xx]; }
  }
  country[i] = bc;
}

// ---------- cell-level rasters (relief, deserts, tundra) ----------
const rawRegions = load('ne_50m_geography_regions_polys');
const PEAK_BY_NAME = [['HIMALAY', 27], ['TIBET', 15], ['ANDES', 21], ['ROCKY', 17], ['ALPS', 18], ['KARAKORAM', 25], ['HINDU KUSH', 21], ['PAMIR', 23], ['TIAN SHAN', 19], ['KUNLUN', 18],
  ['CAUCASUS', 18], ['ALTAY', 15], ['ZAGROS', 13], ['ATLAS', 13], ['URAL', 10], ['APPALACH', 10], ['CASCADE', 14], ['COAST MOUNTAINS', 14], ['ALASKA RANGE', 17], ['BROOKS', 11],
  ['ETHIOPIAN', 16], ['GREAT DIVIDING', 10], ['KHINGAN', 9], ['STANOVOY', 10], ['ANNAMITIQUE', 9], ['MONGOLIAN PLATEAU', 8], ['BRAZILIAN', 7], ['DECCAN', 6], ['SIBERIAN PLATEAU', 7]];
const relT = new Float32Array(W * D), desert = new Uint8Array(W * D), tundra = new Uint8Array(W * D);
for (const f of rawRegions.features) {
  const p = f.properties, cls = p.FEATURECLA, nm = (p.NAME || '').toUpperCase();
  if (nm.includes('ANTARCTIC') || nm.includes('POLAR') || nm.includes('DOME') || nm.includes('ELLSWORTH') || nm.includes('PENSACOLA') || nm.includes('MAUD') || nm.includes('ROCKEFELLER') || nm.includes('HOLLICK') || nm.includes('TALOS') || nm.includes('AMERICAN HIGHLAND')) continue;
  let peak = 0;
  if (cls === 'Range/mtn') peak = 9 + Math.max(0, 3 - (p.SCALERANK || 3)) * 1.5;
  else if (cls === 'Plateau') peak = 5;
  else if (cls === 'Foothills') peak = 3;
  for (const [k, v] of PEAK_BY_NAME) if (nm.includes(k)) { peak = Math.max(peak, v); break; }
  if (peak) fillGeom(f.geometry, STEP, W, D, (r, a, b) => { for (let c = a; c <= b; c++) relT[r * W + c] = Math.max(relT[r * W + c], peak); });
  if (cls === 'Desert') fillGeom(f.geometry, STEP, W, D, (r, a, b) => desert.fill(1, r * W + a, r * W + b + 1));
  if (cls === 'Tundra') fillGeom(f.geometry, STEP, W, D, (r, a, b) => tundra.fill(1, r * W + a, r * W + b + 1));
}
// soften the range footprints
function blur(src, rad, passes) {
  let a = Float32Array.from(src), b = new Float32Array(a.length);
  for (let ps = 0; ps < passes; ps++) {
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let d = -rad; d <= rad; d++) { const xx = x + d; if (xx >= 0 && xx < W) { s += a[z * W + xx]; n++; } } b[z * W + x] = s / n; }
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let d = -rad; d <= rad; d++) { const zz = z + d; if (zz >= 0 && zz < D) { s += b[zz * W + x]; n++; } } a[z * W + x] = s / n; }
  }
  return a;
}
const relief = blur(relT, 2, 2);
// individual famous peaks
for (const f of load('ne_50m_geography_regions_elevation_points').features) {
  const e = f.properties.elevation; if (!e || f.properties.featurecla !== 'mountain') continue;
  const [lon, lat] = f.geometry.coordinates;
  const cx = (lon - LON0) / STEP, cz = (LAT0 - lat) / STEP, h = e / 8848 * 20;
  for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
    const x = Math.floor(cx) + dx, z = Math.floor(cz) + dz;
    if (x < 0 || z < 0 || x >= W || z >= D) continue;
    const k = Math.max(0, 1 - Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / 5);
    relief[z * W + x] = Math.max(relief[z * W + x], h * k * k);
  }
}

// ---------- biomes ----------
// codes match src/earth.js: 0 temperate 1 desert 2 arctic 3 tropical 4 boreal 5 steppe 6 alpine
const dSea = new Float32Array(W * D);
{ // chamfer distance to sea for continentality
  for (let i = 0; i < W * D; i++) dSea[i] = isLand[i] ? 1e5 : 0;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) { const i = z * W + x; let v = dSea[i]; if (x > 0) v = Math.min(v, dSea[i - 1] + 1); if (z > 0) v = Math.min(v, dSea[i - W] + 1); dSea[i] = v; }
  for (let z = D - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) { const i = z * W + x; let v = dSea[i]; if (x < W - 1) v = Math.min(v, dSea[i + 1] + 1); if (z < D - 1) v = Math.min(v, dSea[i + W] + 1); dSea[i] = v; }
}
const biome = new Uint8Array(W * D);
for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
  const i = z * W + x, lat = LAT0 - (z + 0.5) * STEP, lon = LON0 + (x + 0.5) * STEP;
  let b = 0, al = Math.abs(lat);
  if (al <= 15) b = 3;
  else if (lat >= 57 && lat < 66) b = 4;
  else if (lat >= 66 || lat <= -56) b = 2;
  else if (dSea[i] > 30 && al > 34 && al < 56) b = 5; // continental interiors
  if (lat > 12 && lat < 23 && lon > -18 && lon < 40) b = 1;  // Sahel edge dries out
  if (lat >= -38 && lat <= -48 && lon > -76 && lon < -62) b = 5;
  if (tundra[i]) b = 2;
  if (desert[i]) b = 1;
  if (relief[i] > 14) b = 6;
  biome[i] = b;
}

// ---------- regions ----------
// seeds: name, lon, lat. A country containing seeds is split between them; a country without one
// joins the nearest seed (same country, else same landmass, else anywhere).
const SEEDS = `
Alaska,-152,64.5|Yukon,-135,64|British Columbia,-124.5,54.5|Alberta,-113,54|Prairies,-101,54|Ontario,-86,50.5|Quebec,-72,51.5|Nunavut,-95,68.5
West Coast,-121,40.5|Mountain West,-111,43|Southwest,-110,34|Great Plains,-98,40|Texas,-99,31|Midwest,-88.5,42|Deep South,-86,33|Northeast,-74,42
Mexico,-102,24|Central America,-87,14|Cuba,-79,21.8|Hispaniola,-71,19|Greenland,-42,73|Iceland,-19,65
Colombia,-73.5,4|Venezuela,-66,7.5|Peru,-75,-9|Bolivia,-64.5,-17|Amazonia,-62,-5|Northeast Brazil,-42,-8|Southeast Brazil,-48,-19.5|Chile,-71,-34|Pampas,-63,-33|Patagonia,-68.5,-46
Iberia,-4,40|France,2.5,47|Great Britain,-2,53|Ireland,-8,53.2|Germany,10.5,51|Poland,19.5,52|Norway,9,61.5|Sweden,16,62.5|Finland,26,63.5|Italy,12.5,42.5|Balkans,20.5,44.5|Romania,25,46|Ukraine,32,49|Baltics,25,57|Belarus,28,53.5|Turkey,35,39
Caucasus,44.5,41.5|Western Russia,40,56|Northern Russia,50,65|Volga,46,50|Urals,60,58|Western Siberia,75,62|Central Siberia,100,62|Yakutia,130,64|Russian Far East,140,52|Chukotka,168,66
Kazakhstan West,58,48|Kazakhstan East,72,48|Turan,63,40.5|Afghanistan,66,34|Pakistan,70,29.5|Iran,54,32|Mesopotamia,44,33|Levant,37,34|Arabia,45,24|Oman,56,20|Yemen,47,15.5
Mongolia,103,46.5|Xinjiang,84,42|Tibet,88,32.5|Inner Mongolia,110,42|North China,114,36.5|East China,118,31|South China,111,25|Sichuan,104,30|Manchuria,126,46|Korea,127.5,37
Japan,137.5,36|Hokkaido,142.8,43.3|Taiwan,121,23.7|North India,78,27.5|South India,77.5,15|Bengal,88,23.5|Myanmar,96,21|Thailand,101,15|Vietnam,106,16|Malaysia,102.5,4|Philippines,122.5,13
Sumatra,101,-0.5|Java,110.5,-7.4|Borneo,114,0.5|Sulawesi,121,-2|New Guinea,141,-5.5
Morocco,-6,32|Algeria,3,28|Libya,17,27|Egypt,30,26.5|Sudan,30,16|Ethiopia,40,8|Kenya,37.5,0.5|Tanzania,35,-6|Sahel,-3,16|Chad,18,15|Nigeria,8,9|Ghana,-1,7.5|Cameroon,13,5|Congo,23,-3|Angola,17,-12|Zambia,27,-14|Namibia,17,-22|South Africa,25,-30|Madagascar,47,-19
Western Australia,120,-26|Northern Territory,133,-20|Queensland,145,-22.5|South Australia,135,-30|Southeast Australia,146,-34|North Island,175.5,-38|South Island,170.5,-44
`.trim().split(/[|\n]/).filter(Boolean).map(s => { const p = s.split(','); return { name: p[0], lon: +p[1], lat: +p[2] }; });

// landmasses (8-connected components of land)
const mass = new Int16Array(W * D);
let nMass = 0;
for (let s = 0; s < W * D; s++) {
  if (!isLand[s] || mass[s]) continue;
  nMass++;
  const q = [s]; mass[s] = nMass;
  while (q.length) {
    const i = q.pop(), x = i % W, z = (i / W) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= W || zz >= D) continue;
      const j = zz * W + xx;
      if (isLand[j] && !mass[j]) { mass[j] = nMass; q.push(j); }
    }
  }
}
for (const s of SEEDS) {
  let x = Math.round((s.lon - LON0) / STEP - 0.5), z = Math.round((LAT0 - s.lat) / STEP - 0.5);
  if (!isLand[z * W + x]) { // nudge a seed that fell in the sea
    let bd = 1e9, bx = x, bz = z;
    for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= W || zz >= D || !isLand[zz * W + xx]) continue;
      const d = dx * dx + dz * dz; if (d < bd) { bd = d; bx = xx; bz = zz; }
    }
    if (bd === 1e9) { console.warn('seed in the sea, dropped:', s.name); s.drop = true; continue; }
    x = bx; z = bz;
  }
  s.x = x; s.z = z; s.country = country[z * W + x]; s.mass = mass[z * W + x];
}
const seeds = SEEDS.filter(s => !s.drop);

// units: (country, landmass) pairs
const units = new Map();
for (let i = 0; i < W * D; i++) {
  if (!isLand[i]) continue;
  const k = country[i] * 4096 + mass[i];
  let u = units.get(k);
  if (!u) { u = { country: country[i], mass: mass[i], cells: [], sx: 0, sz: 0 }; units.set(k, u); }
  u.cells.push(i); u.sx += i % W; u.sz += (i / W) | 0;
}
const region = new Uint8Array(W * D);
const regionOfSeed = new Map(seeds.map((s, k) => [s, k + 1]));
const orphans = [];
for (const u of units.values()) {
  const inside = seeds.filter(s => s.country === u.country && s.mass === u.mass);
  const cx = u.sx / u.cells.length, cz = u.sz / u.cells.length;
  if (inside.length) {
    for (const i of u.cells) {
      const x = i % W, z = (i / W) | 0;
      let best = null, bd = 1e12;
      for (const s of inside) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
      region[i] = regionOfSeed.get(best);
    }
    continue;
  }
  let pool = seeds.filter(s => s.country === u.country);
  if (!pool.length) pool = seeds.filter(s => s.mass === u.mass);
  if (!pool.length) pool = seeds;
  let best = null, bd = 1e12;
  for (const s of pool) { const d = (s.x - cx) ** 2 + (s.z - cz) ** 2; if (d < bd) { bd = d; best = s; } }
  // a big unit far from every seed becomes a region of its own, named for the country
  if (u.cells.length > 120 && bd > 55 * 55) { orphans.push({ name: cnames[u.country], cells: u.cells }); continue; }
  for (const i of u.cells) region[i] = regionOfSeed.get(best);
}
const regionNames = seeds.map(s => s.name);
for (const o of orphans) { regionNames.push(o.name); for (const i of o.cells) region[i] = regionNames.length; }
if (regionNames.length > 250) throw new Error('too many regions');
// regions that ended up empty keep their id but have no cells: fine (runtime skips area 0)

// ---------- write ----------
const flags = new Uint8Array(W * D);
for (let i = 0; i < W * D; i++) flags[i] = isLand[i] ? 1 | (biome[i] << 1) : 0;
const rel = new Uint8Array(W * D);
for (let i = 0; i < W * D; i++) rel[i] = isLand[i] ? Math.max(0, Math.min(60, Math.round(relief[i]))) : 0;
const meta = Buffer.from(JSON.stringify(regionNames));
const head = Buffer.alloc(16);
head.write('WSE1', 0, 'latin1'); head.writeUInt16LE(W, 4); head.writeUInt16LE(D, 6); head.writeUInt16LE(regionNames.length, 8); head.writeUInt32LE(meta.length, 10);
const bin = zlib.gzipSync(Buffer.concat([head, meta, Buffer.from(flags), Buffer.from(region), Buffer.from(rel)]), { level: 9 });
fs.mkdirSync(OUT.replace(/[^/]+$/, '') || '.', { recursive: true });
fs.writeFileSync(OUT, bin);

const area = new Int32Array(regionNames.length + 1);
for (let i = 0; i < W * D; i++) area[region[i]]++;
console.log(`wrote ${OUT}: ${bin.length} bytes, ${regionNames.length} regions, ${isLand.reduce((a, b) => a + b, 0)} land cells`);
console.log('smallest:', regionNames.map((n, k) => [n, area[k + 1]]).sort((a, b) => a[1] - b[1]).slice(0, 10).map(x => x.join(':')).join(', '));
console.log('largest:', regionNames.map((n, k) => [n, area[k + 1]]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x.join(':')).join(', '));
// debug preview
if (process.env.PREVIEW) {
  const rgb = Buffer.alloc(W * D * 3);
  for (let i = 0; i < W * D; i++) {
    const r = region[i];
    let c;
    if (!isLand[i]) c = [25, 70, 140];
    else { const hr = (r * 67) % 255, hg = (r * 131) % 255, hb = (r * 199) % 255, k = 0.55 + rel[i] / 70; c = [hr * k, hg * k, hb * k]; if (biome[i] === 1) c = [c[0] * 0.6 + 100, c[1] * 0.6 + 80, c[2] * 0.5 + 20]; }
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  fs.writeFileSync(process.env.PREVIEW, rgb);
}
