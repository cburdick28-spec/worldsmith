// Technology tiers: every nation earns knowledge each year from its houses, civic buildings and
// wonders. Crossing a threshold advances it a tier: faster growth and building, more housing, and
// new civic buildings unlocked (see `tier` on each blueprint in buildings.js).
import { nations, game, nm } from './nations.js';
import { civicsOf, TYPES } from './buildings.js';
import { log } from './ui.js';
import { sfx } from './audio.js';

export const TIERS = [
  { name: 'Tribal', icon: '🪨', at: 0 },
  { name: 'Village', icon: '🛖', at: 40 },
  { name: 'Town', icon: '🏘️', at: 110 },
  { name: 'Kingdom', icon: '🏰', at: 220 },
  { name: 'Empire', icon: '🏛️', at: 380 },
  { name: 'Modern', icon: '✈️', at: 600 },
];
export const MAX_TIER = TIERS.length - 1;

export const tierOf = n => n.tier || 0;
export const growthMult = n => 1 + 0.12 * tierOf(n);

const UNLOCKS = {
  1: 'markets, windmills and watchtowers',
  2: 'forges, barracks and temples',
  3: 'wonders of the age',
  4: 'grand wonders and swifter growth',
  5: 'airports: flights, air trade and overseas colonies',
};

let lastYear = -1;

export function knowledgeGain(n) {
  const civ = civicsOf(n);
  let g = 1.5 + n.houses.length * 0.4 + civ.length * 1.5;
  for (const s of civ) if (TYPES[s.type].wonder) g += 6;
  if (n.liege) g *= 0.8;
  return g;
}

function tierFor(tech) {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (tech >= TIERS[i].at) t = i;
  return t;
}

export function updateTech() {
  if (game.year === lastYear) return;
  const first = lastYear < 0;
  lastYear = game.year;
  if (first) {
    for (const n of nations) if (n.alive && n.tech === undefined) { n.tech = 0; n.tier = 0; }
    return;
  }
  for (const n of nations) {
    if (!n.alive) continue;
    if (n.tech === undefined) { n.tech = 0; n.tier = 0; }
    n.tech += knowledgeGain(n);
    const t = tierFor(n.tech);
    if (t > n.tier) {
      n.tier = t;
      const T = TIERS[t];
      n.gold += 10 * t; n.stone += 6 * t; n.wood += 12 * t;
      log(`${T.icon} ${nm(n)} reaches the <b>${T.name}</b> tier: unlocks ${UNLOCKS[t]}.`);
      sfx('chime', n.capital.x, n.capital.z, 0.8);
    }
  }
}

export function resetTech() { lastYear = -1; }
