// Bandits and escorts. Goblin hordes (and any starving nation) send raiders to lie in wait on a
// caravan's road; nations send a soldier along with their caravans once the roads turn dangerous.
import { units, spawnUnit, setState } from './units.js';
import { nations, rel, nm } from './nations.js';
import { warMult } from './economy.js';
import { nearInn } from './infra.js';
import { onRoadXZ } from './roads.js';
import { W, D, SEA, groundTop } from './world.js';
import { log } from './ui.js';
import { rand, pick } from './noise.js';

export const raidStats = { raids: 0, loot: 0, repelled: 0 };
let raidT = rand(18, 28);

const raidersAlive = () => units.some(u => u.alive && u.role === 'raider');

// Where to wait: ahead of the caravan on its way to the destination, preferably on a road.
function ambushPoint(c) {
  const t = c.trade;
  const dx = t.gx - c.x, dz = t.gz - c.z, d = Math.hypot(dx, dz);
  if (d < 26) return null;
  const lead = Math.min(d * 0.5, 24);
  const px = c.x + dx / d * lead, pz = c.z + dz / d * lead;
  let best = null, bs = Infinity;
  for (let k = 0; k < 30; k++) {
    const x = Math.floor(px + rand(-4, 4)), z = Math.floor(pz + rand(-4, 4));
    if (x < 3 || z < 3 || x >= W - 3 || z >= D - 3 || groundTop(x, z) <= SEA) continue;
    if (nearInn(x, z, 14)) continue;
    const s = Math.hypot(x - px, z - pz) - (onRoadXZ(x, z) ? 3 : 0);
    if (s < bs) { bs = s; best = { x: x + 0.5, z: z + 0.5 }; }
  }
  return best;
}

export function updateRaids(dt) {
  raidT -= dt;
  if (raidT > 0) return;
  raidT = rand(16, 30) / Math.max(0.6, warMult());
  const caravans = units.filter(u => u.alive && u.role === 'caravan' && u.trade);
  if (!caravans.length) return;
  for (const n of nations) {
    if (!n.alive || n.houses.length < 2 || n.units.size < 9) continue;
    const bent = n.race === 'goblin' ? 0.7 : n.starving ? 0.6 : 0;
    if (Math.random() > bent * warMult()) continue;
    let gang = 0;
    for (const u of n.units) if (u.role === 'raider') gang++;
    if (gang) continue;
    let prey = null, bd = 90;
    for (const c of caravans) {
      if (c.nation === n || c.trade.dest === n || n.allies.includes(c.nation)) continue;
      const d = Math.hypot(c.x - n.capital.x, c.z - n.capital.z);
      if (d < bd) { bd = d; prey = c; }
    }
    if (!prey) continue;
    const spot = ambushPoint(prey);
    if (!spot) continue;
    const pool = [...n.units].filter(u => u.alive && !u.possessed && u.age >= 16 && (u.role === 'villager' || u.role === 'soldier') && (u.state === 'idle' || u.state === 'goto'));
    if (pool.length < 3) continue;
    const k = Math.min(3, 2 + (Math.random() < 0.4 ? 1 : 0));
    for (let i = 0; i < k; i++) {
      const u = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      u.role = 'raider';
      u.raid = { x: spot.x + rand(-1.5, 1.5), z: spot.z + rand(-1.5, 1.5), t: 45, phase: 'go', scan: 0.5 };
      setState(u, 'raid');
    }
    raidStats.raids++;
    log(`🏴‍☠️ Bandits from ${nm(n)} lie in wait on the road to ${nm(prey.trade.dest)}.`);
    return;
  }
}

// The nation protects its caravan with one fighter whenever bandits are about or the age is warlike.
export function assignEscort(caravan) {
  const n = caravan.nation;
  if (!raidersAlive() && warMult() < 1.25) return;
  if (Math.random() > 0.85) return;
  let pick1 = null;
  for (const u of n.units) {
    if (!u.alive || u.possessed || (u.role !== 'soldier' && u.role !== 'villager') || u.age < 16) continue;
    if (u.state !== 'idle' && u.state !== 'goto') continue;
    if (!pick1 || (u.role === 'soldier' && pick1.role !== 'soldier')) pick1 = u;
  }
  if (!pick1 || n.units.size < 6) return;
  pick1.role = 'escort';
  pick1.escortOf = caravan;
  setState(pick1, 'escort');
}
