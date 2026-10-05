// Minimap: live terrain colours, territory borders per nation, capitals, the camera's focus and
// click-to-jump. Redrawn a few times a second from the voxel world.
import { W, D, SEA, BLOCK, vox, idx, topAt } from './world.js';
import { nations } from './nations.js';
import { units } from './units.js';
import { infra } from './infra.js';
import { dragons } from './dragons.js';

const REACH = 15; // how far a house claims land around it
let canvas, ctx, img, godCam, T = 0, show = true;
const ownerGrid = new Int16Array(W * D);
const distGrid = new Float32Array(W * D);

export function initMinimap(cam) {
  godCam = cam;
  canvas = document.getElementById('mm');
  ctx = canvas.getContext('2d');
  img = ctx.createImageData(W, D);
  const jump = e => {
    const r = canvas.getBoundingClientRect();
    godCam.focus((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * D);
  };
  let down = false;
  canvas.addEventListener('pointerdown', e => { down = true; canvas.setPointerCapture(e.pointerId); jump(e); });
  canvas.addEventListener('pointermove', e => { if (down) jump(e); });
  canvas.addEventListener('pointerup', () => { down = false; });
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyM' && e.target.tagName !== 'INPUT') {
      show = !show;
      document.getElementById('minimap').style.display = show ? '' : 'none';
    }
  });
  T = 0;
  draw();
}

function territory() {
  ownerGrid.fill(0);
  distGrid.fill(1e9);
  for (const n of nations) {
    if (!n.alive) continue;
    for (const h of [...n.houses, ...n.sites]) {
      const x0 = Math.max(0, Math.floor(h.cx - REACH)), x1 = Math.min(W - 1, Math.ceil(h.cx + REACH));
      const z0 = Math.max(0, Math.floor(h.cz - REACH)), z1 = Math.min(D - 1, Math.ceil(h.cz + REACH));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - h.cx, z + 0.5 - h.cz);
        if (d > REACH) continue;
        const c = z * W + x;
        if (d < distGrid[c]) { distGrid[c] = d; ownerGrid[c] = n.id; }
      }
    }
  }
}

const hex = new Map();
const rgb = css => {
  let v = hex.get(css);
  if (!v) { v = [parseInt(css.slice(1, 3), 16), parseInt(css.slice(3, 5), 16), parseInt(css.slice(5, 7), 16)]; hex.set(css, v); }
  return v;
};

function draw() {
  territory();
  const d = img.data;
  const col = new Map(nations.map(n => [n.id, rgb(n.css)]));
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const c = z * W + x, p = c * 4;
    const y = topAt(x, z);
    let r, g, b;
    if (y < SEA) {
      const k = Math.max(0.35, 1 - (SEA - y) * 0.08);
      r = 40 * k; g = 105 * k; b = 175 * k;
    } else {
      const t = vox[idx(x, y, z)], c0 = BLOCK[t] ? BLOCK[t].top : null;
      const sh = 0.7 + Math.min(1, y / 34) * 0.45;
      r = (c0 ? c0.r : 0.5) * 255 * sh; g = (c0 ? c0.g : 0.5) * 255 * sh; b = (c0 ? c0.b : 0.5) * 255 * sh;
    }
    const o = ownerGrid[c];
    if (o) {
      const nc = col.get(o);
      if (nc) {
        const edge = x === 0 || z === 0 || x === W - 1 || z === D - 1 || ownerGrid[c - 1] !== o || ownerGrid[c + 1] !== o || ownerGrid[c - W] !== o || ownerGrid[c + W] !== o;
        const a = edge ? 0.9 : 0.28;
        r += (nc[0] - r) * a; g += (nc[1] - g) * a; b += (nc[2] - b) * a;
      }
    }
    d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // capitals, inns, bridges
  for (const n of nations) {
    if (!n.alive) continue;
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.floor(n.capital.x) - 2, Math.floor(n.capital.z) - 2, 5, 5);
    ctx.fillStyle = n.css;
    ctx.fillRect(Math.floor(n.capital.x) - 1, Math.floor(n.capital.z) - 1, 3, 3);
  }
  ctx.fillStyle = '#ffd26a';
  for (const i of infra.inns) if (!i.dead) ctx.fillRect(Math.floor(i.cx) - 1, Math.floor(i.cz) - 1, 3, 3);
  ctx.fillStyle = '#d9a766';
  for (const b of infra.bridges) if (!b.dead) ctx.fillRect(Math.floor(b.cx) - 1, Math.floor(b.cz) - 1, 3, 2);
  ctx.fillStyle = '#ff5a1a';
  for (const d of dragons) if (!d.dead) { ctx.fillRect(Math.floor(d.x) - 2, Math.floor(d.z) - 2, 5, 5); }
  // fighting
  ctx.fillStyle = '#ff3b30';
  for (const u of units) if (u.alive && u.state === 'fight') ctx.fillRect(Math.floor(u.x), Math.floor(u.z), 2, 2);
}

export function updateMinimap(dt) {
  if (!show || !ctx) return;
  T -= dt;
  if (T <= 0) { T = 1.2; draw(); }
  // camera marker overlay is drawn on a second pass so it follows smoothly
  overlay();
}

function overlay() {
  const c = document.getElementById('mm-cam');
  if (!c) return;
  c.style.left = `${godCam.target.x / W * 100}%`;
  c.style.top = `${godCam.target.z / D * 100}%`;
}
