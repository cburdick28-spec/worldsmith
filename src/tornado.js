// Tornadoes: a swirling funnel that wanders the land for half a minute, flinging people and
// tearing buildings and trees apart (bare ground is left alone).
import { W, D, SEA, vox, owner, idx, set, B, topAt, groundTop } from './world.js';
import { units, damageUnit } from './units.js';
import { nations, nm } from './nations.js';
import { swirlPuff, spawnDebris, dustCloud, fx } from './effects.js';
import { sfx } from './audio.js';
import { log } from './ui.js';

const rand = (a, b) => a + Math.random() * (b - a);
export const tornadoes = [];

export function startTornado(x, z) {
  if (tornadoes.length >= 3) tornadoes.shift();
  tornadoes.push({ x, z, a: rand(0, 6.28), t: 0, dur: rand(26, 40), spin: 0, tick: 0 });
  sfx('roar', x, z, 1.4);
  let best = null, bd = 40;
  for (const n of nations) if (n.alive) for (const h of n.houses) { const d = Math.hypot(h.cx - x, h.cz - z); if (d < bd) { bd = d; best = n; } }
  log(`🌪️ A tornado touches down${best ? ` near ${nm(best)}` : ''}.`);
}

export function updateTornadoes(dt) {
  for (let i = tornadoes.length - 1; i >= 0; i--) {
    const T = tornadoes[i];
    T.t += dt; T.spin += dt * 9;
    if (T.t > T.dur) { tornadoes.splice(i, 1); continue; }
    // wander, bending toward a new heading now and then
    T.a += rand(-1, 1) * dt * 1.2;
    const sp = 3.6;
    T.x += Math.cos(T.a) * sp * dt; T.z += Math.sin(T.a) * sp * dt;
    if (T.x < 6 || T.z < 6 || T.x > W - 6 || T.z > D - 6) { tornadoes.splice(i, 1); continue; }
    const fade = Math.min(1, (T.dur - T.t) / 4, T.t / 2); // grows in, shrinks away
    const gy = Math.max(SEA, groundTop(Math.floor(T.x), Math.floor(T.z)) + 1);
    // funnel: rings of dust that widen with height
    for (let k = 0; k < 14 * dt * 60 / 60 + 3; k++) {
      const h = Math.random() * 14, rad = (0.7 + h * 0.32) * fade, a = Math.random() * 6.28 + T.spin;
      const px = T.x + Math.cos(a) * rad, pz = T.z + Math.sin(a) * rad;
      swirlPuff(px, gy + h, pz, -Math.sin(a) * 5 + Math.cos(T.a) * sp, 2.5, Math.cos(a) * 5 + Math.sin(T.a) * sp, 1);
    }
    fx.shake = Math.max(fx.shake, Math.min(0.5, 0.7 / (1 + 0.04 * 20)));
    T.tick -= dt;
    if (T.tick > 0) continue;
    T.tick = 0.12;
    const R = 4.2 * fade + 0.5;
    // people
    for (const u of units) {
      if (!u.alive || u.held) continue;
      const d = Math.hypot(u.x - T.x, u.z - T.z);
      if (d > R + 1.5) continue;
      if (!u.flying) { u.flying = true; u.vy = rand(9, 15); }
      const ang = Math.atan2(u.z - T.z, u.x - T.x) + 1.4;
      u.vx = Math.cos(ang) * 11; u.vz = Math.sin(ang) * 11;
      damageUnit(u, rand(0.2, 0.8), null, 'tornado');
    }
    // structures and trees: only blocks that belong to something are torn off
    const x0 = Math.floor(T.x - R), x1 = Math.ceil(T.x + R), z0 = Math.floor(T.z - R), z1 = Math.ceil(T.z + R);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x + 0.5 - T.x, z + 0.5 - T.z) > R || Math.random() > 0.55) continue;
      let y = topAt(x, z);
      for (let n = 0; n < 2 && y >= 0; n++, y--) {
        const j = idx(x, y, z), t = vox[j];
        if (!t || !owner[j]) break;
        set(x, y, z, B.AIR);
        const a = Math.atan2(z + 0.5 - T.z, x + 0.5 - T.x) + 1.5;
        spawnDebris(x + 0.5, y + 0.5, z + 0.5, Math.cos(a) * rand(8, 14), rand(8, 16), Math.sin(a) * rand(8, 14), t, 0.3);
      }
    }
    if (Math.random() < 0.3) dustCloud(T.x, gy + 0.3, T.z, 6, R);
  }
}
