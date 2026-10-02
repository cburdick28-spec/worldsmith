// Headless smoke test: loads the game, runs it, uses a few powers, screenshots.
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:5173/?seed=1234';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 4000));
await page.click('#begin');
await page.keyboard.down('Digit4'); await page.keyboard.up('Digit4');
await page.screenshot({ path: 'test/shot1.png' });
// set 4x speed and let the world run
await page.click('[data-speed="4"]');
for (let i = 0; i < 6; i++) {
  await new Promise(r => setTimeout(r, 10000));
  const st = await page.evaluate(async () => { const U = await import('/src/units.js'); const N = await import('/src/nations.js'); return { year: N.game.year, units: U.units.length, houses: N.nations.map(n => n.houses.length), wars: N.nations.map(n => n.enemies.length) }; });
  console.log(JSON.stringify(st));
}
await page.screenshot({ path: 'test/shot2.png' });
// meteor at center
await page.keyboard.press('Digit2');
await page.mouse.click(700, 450);
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: 'test/shot3.png' });
// grab and throw
await page.keyboard.press('Digit1');
await page.mouse.move(600, 420);
await page.mouse.down();
for (let i = 0; i < 20; i++) { await page.mouse.move(600 + i * 15, 420 - i * 3); await new Promise(r => setTimeout(r, 30)); }
await page.mouse.up();
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: 'test/shot4.png' });
// lightning + fire + possess
await page.keyboard.press('Digit3'); await page.mouse.click(760, 480);
await page.keyboard.press('Digit4'); await page.mouse.click(640, 380);
await page.keyboard.press('Digit5'); await page.mouse.move(820, 520); await page.mouse.down(); await new Promise(r => setTimeout(r, 800)); await page.mouse.up();
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'test/shot5.png' });
const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
console.log('fps (swiftshader)', fps);
const possessed = await page.evaluate(async () => {
  const U = await import('/src/units.js');
  const u = U.units.find(u => u.alive);
  return u ? u.name : null;
});
console.log('sample unit', possessed);
const state = await page.evaluate(() => ({
  year: document.getElementById('year').textContent,
  pop: document.getElementById('pop').textContent,
  nations: [...document.querySelectorAll('.nation')].map(n => n.innerText.replace(/\n/g, ' | ')),
  log: [...document.querySelectorAll('.entry')].slice(0, 12).map(e => e.innerText),
}));
console.log(JSON.stringify(state, null, 2));
console.log('ERRORS:\n' + (errors.join('\n') || 'none'));
await browser.close();
