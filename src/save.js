// Save and load: a snapshot is the seed plus everything that diverged from it, gzipped and
// base64-encoded so it fits in localStorage, can be exported as a file and re-imported.
import { W, D, H, B, vox, owner, height, colOcc, structs, worldInfo, idx, markAllDirty } from './world.js';
import { units, spawnUnit, setState, setNextUnitId, getNextUnitId } from './units.js';
import { nations, snapshotNations, restoreNations, game } from './nations.js';
import { roads, roadStats } from './roads.js';
import { infra } from './infra.js';
import { snapshotVolcanoes, restoreVolcanoes } from './disasters.js';

const VERSION = 1;

// ---- byte helpers ----

function rle(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const v = bytes[i];
    let run = 1;
    while (i + run < bytes.length && bytes[i + run] === v) run++;
    let r = run;
    out.push(v);
    while (r >= 128) { out.push((r & 127) | 128); r >>= 7; }
    out.push(r);
    i += run;
  }
  return Uint8Array.from(out);
}

function unrle(data, size) {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < data.length;) {
    const v = data[i++];
    let run = 0, shift = 0, b;
    do { b = data[i++]; run |= (b & 127) << shift; shift += 7; } while (b & 128);
    out.fill(v, o, o + run);
    o += run;
  }
  return out;
}

const toB64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

// ---- snapshot ----

export function makeSnapshot(cam) {
  const base = worldInfo.baseStructs;
  const deadTrees = [];
  for (let i = 1; i <= base; i++) if (structs[i].dead) deadTrees.push(i);
  const extra = [];
  for (let i = base + 1; i < structs.length; i++) {
    const s = structs[i];
    const o = {};
    for (const k of Object.keys(s)) {
      if (k === 'builders' || k === 'claimedBy') continue;
      o[k] = k === 'nation' ? (s.nation ? s.nation.id : null) : s[k];
    }
    extra.push(o);
  }
  return {
    v: VERSION, seed: worldInfo.seed, base,
    vox: toB64(rle(vox)), deadTrees, extra,
    nations: snapshotNations(),
    units: units.filter(u => u.alive).map(u => ({
      id: u.id, nid: u.nation.id, role: u.role, name: u.name, age: u.age, maxAge: u.maxAge, hp: u.hp,
      x: u.x, y: u.y, z: u.z, face: u.face, kills: u.kills,
      king: u.nation.king === u,
      trade: u.trade ? { dest: u.trade.dest.id, gx: u.trade.gx, gz: u.trade.gz, cargo: u.trade.cargo, good: u.trade.good, sx: u.trade.sx, sz: u.trade.sz } : null,
      raid: u.raid || null, escortOf: u.escortOf ? u.escortOf.id : null,
    })),
    nextUnitId: getNextUnitId(),
    volcanoes: snapshotVolcanoes(),
    cam: cam || null,
  };
}

export async function encodeSnapshot(snap) {
  if (typeof CompressionStream === 'undefined') return 'raw:' + btoa(unescape(encodeURIComponent(JSON.stringify(snap))));
  const bytes = new TextEncoder().encode(JSON.stringify(snap));
  return 'gz:' + toB64(await pipe(bytes, new CompressionStream('gzip')));
}

export async function decodeSnapshot(str) {
  if (str.startsWith('raw:')) return JSON.parse(decodeURIComponent(escape(atob(str.slice(4)))));
  if (!str.startsWith('gz:')) throw new Error('Not a Worldsmith save');
  const bytes = await pipe(fromB64(str.slice(3)), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---- restore (after generate(seed) has produced the baseline world) ----

export function restoreSnapshot(snap) {
  if (snap.v !== VERSION) throw new Error('Unsupported save version');
  vox.set(unrle(fromB64(snap.vox), vox.length));
  // structures: baseline trees come from generate(); everything after is stored in full
  structs.length = snap.base + 1;
  for (const id of snap.deadTrees) structs[id].dead = true;
  for (const o of snap.extra) {
    const s = { ...o, builders: new Set() };
    structs.push(s);
  }
  // ownership, footprints and column heights are derived from the voxels and structures
  owner.fill(0);
  colOcc.fill(0);
  for (let i = 1; i < structs.length; i++) {
    const s = structs[i];
    s.alive = 0;
    if (s.dead) continue;
    for (let k = 0; k < s.placed; k++) {
      const [x, y, z, t] = s.plan[k];
      const j = idx(x, y, z);
      const same = vox[j] === t || (s.kind === 'farm' && (vox[j] === B.WHEAT || vox[j] === B.WHEAT_RIPE));
      if (same && !owner[j]) { owner[j] = s.id; s.alive++; }
    }
    for (const c of s.foot) colOcc[c] = s.id;
  }
  roads.fill(0); roadStats.tiles = 0;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    let y = H - 1;
    while (y >= 0 && !vox[idx(x, y, z)]) y--;
    const c = z * W + x;
    height[c] = y;
    if (y >= 0 && vox[idx(x, y, z)] === B.ROAD) { roads[c] = 1; roadStats.tiles++; }
  }
  markAllDirty();

  units.length = 0;
  restoreNations(snap.nations);
  const byId = new Map();
  for (const d of snap.units) {
    const n = nations.find(m => m.id === d.nid);
    if (!n) continue;
    const u = spawnUnit(n, d.x, d.z, { role: d.role, age: d.age, y: d.y + 1 });
    Object.assign(u, { id: d.id, name: d.name, maxAge: d.maxAge, hp: d.hp, x: d.x, y: d.y, z: d.z, face: d.face, kills: d.kills });
    byId.set(d.id, u);
    if (d.king) n.king = u;
    if (d.trade) { const dest = nations.find(m => m.id === d.trade.dest); if (dest) u.trade = { ...d.trade, dest }; }
    if (d.raid) u.raid = d.raid;
  }
  setNextUnitId(snap.nextUnitId);
  for (const d of snap.units) {
    const u = byId.get(d.id);
    if (!u) continue;
    if (d.escortOf) u.escortOf = byId.get(d.escortOf) || null;
    if (u.role === 'caravan' && u.trade) setState(u, 'trade');
    else if (u.role === 'caravan') u.role = 'villager';
    else if (u.role === 'raider' && u.raid) setState(u, 'raid');
    else if (u.role === 'raider') u.role = 'villager';
    else if (u.role === 'escort' && u.escortOf) setState(u, 'escort');
    else if (u.role === 'escort') u.role = 'villager';
  }
  for (const n of nations) if (n.alive && (!n.king || !n.king.alive)) n.king = null;
  infra.bridges = structs.filter(s => s && s.kind === 'bridge' && !s.dead);
  infra.inns = structs.filter(s => s && s.kind === 'inn' && !s.dead);
  infra.blocked.clear();
  restoreVolcanoes(snap.volcanoes || []);
}

// ---- storage ----

const KEY = 'worldsmith-save';

export async function saveToStorage(cam) {
  const enc = await encodeSnapshot(makeSnapshot(cam));
  localStorage.setItem(KEY, enc);
  return enc;
}
export const hasSave = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
export const readSave = () => localStorage.getItem(KEY);

// Loading reloads the page and restores the snapshot during start-up, so every system begins clean.
export function queueLoad(enc) {
  sessionStorage.setItem('ws-pending', enc);
  location.reload();
}
export function takePendingLoad() {
  try {
    const enc = sessionStorage.getItem('ws-pending');
    if (enc) sessionStorage.removeItem('ws-pending');
    return enc;
  } catch { return null; }
}
