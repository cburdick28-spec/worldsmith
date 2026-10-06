// Glory: a running score for every nation (people, houses, buildings, wonders, vassals, coin, fighting).
import { nations, game, nm } from './nations.js';
import { civics } from './buildings.js';
import { units } from './units.js';
import { log } from './ui.js';

const WONDERS = new Set(['worldtree', 'ziggurat', 'spire']);
let lastYear = -1, leader = null;

export function glory(n) {
  let g = n.units.size * 2 + n.houses.length * 5 + Math.floor(n.gold / 12) + n.trips * 2;
  for (const c of civics) if (!c.dead && c.nation === n) g += WONDERS.has(c.type) ? 60 : 7;
  for (const m of nations) if (m.alive && m.liege === n) g += 25;
  for (const u of n.units) g += u.kills * 1.5 + (u.hero ? 15 : 0);
  return Math.round(g);
}

export function ranking() {
  return nations.filter(n => n.alive).map(n => ({ n, g: glory(n) })).sort((a, b) => b.g - a.g);
}

export function updateGlory() {
  if (game.year === lastYear) return;
  lastYear = game.year;
  if (game.year % 25 !== 0 || game.year === 0) return;
  const r = ranking();
  if (!r.length) return;
  if (leader !== r[0].n) log(`🏆 Year ${game.year}: ${nm(r[0].n)} is the greatest power in the land (glory ${r[0].g}).`);
  else log(`🏆 Year ${game.year}: ${nm(r[0].n)} still holds the world's regard (glory ${r[0].g}).`);
  leader = r[0].n;
}
