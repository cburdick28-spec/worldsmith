// Heroes: in wartime (and now and then in peace) an exceptional fighter rises in a nation: tougher,
// stronger, crowned in gold. A fallen hero is mourned in the chronicle.
import { units } from './units.js';
import { nations, game, nm } from './nations.js';
import { sfx } from './audio.js';
import { log } from './ui.js';

const TITLES = ['the Bold', 'Ironhand', 'the Unbroken', 'Stormcaller', 'the Wolf', 'Dragonbane', 'the Steadfast', 'Oathkeeper', 'the Red', 'Gravewalker'];
const pick = a => a[Math.floor(Math.random() * a.length)];
let lastYear = -1;

// stat changes only (used on promotion and again after a load)
export function applyHeroStats(u) {
  if (u.heroStats) return;
  u.heroStats = true;
  u.maxHp = Math.round(u.maxHp * 3); u.hp = u.maxHp;
  u.st = { ...u.st, dmg: [u.st.dmg[0] * 1.8, u.st.dmg[1] * 1.8], scale: u.st.scale * 1.2, speed: u.st.speed * 1.08 };
  u.maxAge += 40;
}

export function makeHero(u, title) {
  u.hero = title;
  u.role = 'soldier';
  u.name = `${u.name} ${title}`;
  applyHeroStats(u);
  return u;
}

export const heroOf = n => { for (const u of n.units) if (u.hero && u.alive) return u; return null; };

function yearly() {
  for (const n of nations) {
    if (!n.alive || n.units.size < 16 || heroOf(n)) continue;
    const war = n.enemies.length > 0;
    if (Math.random() > (war ? 0.3 : n.units.size >= 25 ? 0.03 : 0)) continue;
    let best = null;
    for (const u of n.units) {
      if (!u.alive || u.possessed || u.role === 'king' || u.role === 'caravan' || u.role === 'raider' || u.age < 18 || u.age > 55) continue;
      const score = (u.role === 'soldier' ? 3 : 0) + u.kills * 2 + Math.random() * 3;
      if (!best || score > best.score) best = { u, score };
    }
    if (!best) continue;
    makeHero(best.u, pick(TITLES));
    log(`🦸 A hero arises: ${best.u.name}, champion of ${nm(n)}!`);
    sfx('horn', best.u.x, best.u.z, 1);
  }
}

export function updateHeroes() {
  if (game.year === lastYear) return;
  if (lastYear >= 0) yearly();
  lastYear = game.year;
}

export function heroFell(u) {
  if (!u.hero) return;
  log(`💀 The hero ${u.name} of ${nm(u.nation)} has fallen${u.kills ? `, having felled ${u.kills}` : ''}.`);
}
