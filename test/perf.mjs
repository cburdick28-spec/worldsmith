import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('ERR', e.message, e.stack));
await page.goto('http://localhost:5173/?seed=99');
await new Promise(r => setTimeout(r, 3000));
const out = await page.evaluate(async () => {
  const U = await import('/src/units.js'), N = await import('/src/nations.js'), E = await import('/src/effects.js'), Wd = await import('/src/world.js');
  const P = await import('/src/powers.js');
  P.setSpeed(0); // stop the live loop from advancing; we step manually
  const t = {};
  const time = (k, f) => { const a = performance.now(); f(); t[k] = (t[k] || 0) + performance.now() - a; };
  // simulate 400 sim-seconds in 0.05 steps
  for (let i = 0; i < 8000; i++) {
    time('nations', () => N.updateNations(0.05));
    time('units', () => U.updateUnits(0.05));
    time('effects', () => E.updateEffects(0.05));
    time('mesh', () => Wd.rebuildDirty(14));
    if (i === 4000) { E.launchMeteor(80, 20, 80); E.igniteArea(70, 18, 70, 5, 1); }
  }
  for (const k in t) t[k] = +(t[k] / 8000).toFixed(3);
  return { msPerStep: t, year: N.game.year, units: U.units.length, nations: N.nations.map(n => `${n.name}: alive=${n.alive} pop=${n.units.size} houses=${n.houses.length} wood=${n.wood} enemies=${n.enemies.length}`),
    log: [...document.querySelectorAll('.entry')].map(e => e.innerText).slice(0, 25) };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
