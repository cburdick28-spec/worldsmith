// Sea serpents: they surface in deep water, hunt swimmers and anyone on the shoreline, and can be
// driven off (or killed) by meteors and lightning.
import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, WATER_Y, height } from './world.js';
import { units, damageUnit } from './units.js';
import { nations, game, nm } from './nations.js';
import { splash, blastHooks } from './effects.js';
import { sfx } from './audio.js';
import { log } from './ui.js';

const rand = (a, b) => a + Math.random() * (b - a);
export const serpents = [];
const NSEG = 11;
let scene, spawnT = 25;

const matBody = new THREE.MeshLambertMaterial({ color: '#2f8f7a' });
const matBelly = new THREE.MeshLambertMaterial({ color: '#d8e8a0' });
const matEye = new THREE.MeshBasicMaterial({ color: '#ffd23a' });
const matFin = new THREE.MeshLambertMaterial({ color: '#1d5f56' });

export function initMonsters(s) {
  scene = s;
  blastHooks.push((x, y, z, r) => {
    for (const m of serpents) {
      if (m.dead) continue;
      const d = Math.hypot(m.pts[0].x - x, m.pts[0].z - z);
      if (d < r + 5 && y < SEA + 8) hurt(m, 12 + r * 6, 'a falling star');
    }
  });
}

const deepAt = (x, z, need = 3) => {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (cx < 3 || cz < 3 || cx >= W - 3 || cz >= D - 3) return false;
  return height[cz * W + cx] < SEA - need;
};

function build() {
  const g = new THREE.Group(), segs = [];
  for (let i = 0; i < NSEG; i++) {
    const k = i === 0 ? 1.25 : 1 - i / (NSEG + 2);
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5 * k + 0.4, 1.3 * k + 0.4, 1.5 * k + 0.4), i % 3 === 2 ? matBelly : matBody);
    m.castShadow = true;
    g.add(m); segs.push(m);
    if (i > 0 && i < NSEG - 2) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7 * k + 0.3, 0.9 * k), matFin); f.position.y = 0.8 * k; m.add(f); }
  }
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), matEye), e2 = e1.clone();
  e1.position.set(0.55, 0.35, 0.55); e2.position.set(0.55, 0.35, -0.55);
  segs[0].add(e1, e2);
  scene.add(g);
  return { g, segs };
}

function spawn() {
  for (let k = 0; k < 80; k++) {
    const x = rand(15, W - 15), z = rand(15, D - 15);
    if (!deepAt(x, z, 4)) continue;
    let ring = true;
    for (let a = 0; a < 6.28 && ring; a += 0.8) if (!deepAt(x + Math.cos(a) * 6, z + Math.sin(a) * 6, 2)) ring = false;
    if (!ring) continue;
    let near = null, nd = 70;
    for (const n of nations) if (n.alive) for (const h of n.houses) { const d = Math.hypot(h.cx - x, h.cz - z); if (d < nd) { nd = d; near = n; } }
    if (!near) continue;
    const mesh = build();
    const a = rand(0, 6.28), pts = [];
    for (let i = 0; i < NSEG * 6; i++) pts.push({ x: x - Math.cos(a) * i * 0.28, z: z - Math.sin(a) * i * 0.28 });
    serpents.push({ ...mesh, pts, a, hp: 45, life: rand(45, 80), t: 0, bite: 0, target: null, dead: false, sink: 0 });
    log(`🐍 A sea serpent rises off the coast of ${nm(near)}!`);
    sfx('roar', x, z, 1.2);
    return;
  }
}

function hurt(m, dmg, what) {
  m.hp -= dmg;
  splash(m.pts[0].x, m.pts[0].z, 25);
  if (m.hp <= 0 && !m.dead) { m.dead = true; m.sink = 0; log(`🐍 The sea serpent is slain by ${what}.`); }
}

function remove(m) { scene.remove(m.g); m.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

export function updateMonsters(dt, time) {
  if (!scene) return;
  if (dt > 0) {
    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = rand(25, 55);
      if (game.year >= 20 && serpents.length < 2 && Math.random() < 0.3) spawn();
    }
  }
  for (let i = serpents.length - 1; i >= 0; i--) {
    const m = serpents[i], head = m.pts[0];
    if (dt > 0) {
      m.t += dt; m.bite -= dt;
      if (m.dead) { m.sink += dt; if (m.sink > 3) { remove(m); serpents.splice(i, 1); continue; } }
      else if (m.t > m.life) { m.sink += dt; if (m.sink > 3) { remove(m); serpents.splice(i, 1); continue; } }
      else {
        // pick the nearest victim: a swimmer or someone at the water's edge
        let best = null, bd = 18 * 18;
        for (const u of units) {
          if (!u.alive || u.held || u.flying) continue;
          if (!(u.swim > 0) && !(deepAt(u.x + 2, u.z, 0) || deepAt(u.x - 2, u.z, 0) || deepAt(u.x, u.z + 2, 0) || deepAt(u.x, u.z - 2, 0))) continue;
          const d = (u.x - head.x) ** 2 + (u.z - head.z) ** 2;
          if (d < bd) { bd = d; best = u; }
        }
        m.target = best;
        if (best) {
          const want = Math.atan2(best.z - head.z, best.x - head.x);
          let dA = want - m.a; while (dA > Math.PI) dA -= 6.283; while (dA < -Math.PI) dA += 6.283;
          m.a += Math.max(-1, Math.min(1, dA)) * dt * 2.2;
        } else m.a += Math.sin(m.t * 0.5 + i) * dt * 0.9;
        const sp = best ? 4.4 : 2.4;
        let nx = head.x + Math.cos(m.a) * sp * dt, nz = head.z + Math.sin(m.a) * sp * dt;
        if (!deepAt(nx, nz, 1)) { m.a += 2.2 * dt + 0.6; nx = head.x; nz = head.z; } // turn away from the shallows
        if (nx !== head.x || nz !== head.z) {
          if (Math.hypot(nx - m.pts[1].x, nz - m.pts[1].z) > 0.28) m.pts.unshift({ x: nx, z: nz }), m.pts.pop();
          else { head.x = nx; head.z = nz; }
        }
        if (best && m.bite <= 0 && Math.hypot(best.x - head.x, best.z - head.z) < 3.4) {
          m.bite = 1.4;
          damageUnit(best, rand(7, 12), null, 'serpent');
          splash(best.x, best.z, 18);
          sfx('splash', best.x, best.z, 1);
        }
      }
    }
    // pose the body along its trail, humping in and out of the water
    const dive = m.dead ? Math.min(1, m.sink / 2.5) : m.t > m.life ? Math.min(1, m.sink / 2.5) : 0;
    for (let s = 0; s < NSEG; s++) {
      const p = m.pts[Math.min(m.pts.length - 1, s * 6)], q = m.pts[Math.min(m.pts.length - 1, s * 6 + 3)];
      const hump = Math.sin(time * 1.8 - s * 0.9) * 0.55;
      m.segs[s].position.set(p.x, WATER_Y + hump + (s === 0 ? 0.45 : 0.1) - dive * 3.2, p.z);
      m.segs[s].rotation.y = -Math.atan2(p.z - q.z, p.x - q.x);
    }
    // segment meshes live in the group, which stays at the origin
  }
}
