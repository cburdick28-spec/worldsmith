import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message + e.stack)); page.on('console', m => m.type() === 'error' && !m.text().includes('404') && errs.push(m.text()));
await page.goto('http://localhost:5173/?seed=7');
await new Promise(r => setTimeout(r, 3000));
await page.click('#begin');
await page.click('[data-speed="10"]');
await page.click('[data-pros="50"]');
await page.keyboard.press('KeyG');
await page.mouse.click(700, 450);
const before = await page.evaluate(async () => (await import('/src/nations.js')).nations.map(n => n.wood));
await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
const btns = await page.$$('[data-act="people"]');
if (btns[0]) { const b = await btns[0].boundingBox(); await page.mouse.click(b.x + 5, b.y + 5); }
const wb = await page.$('[data-act="wood"]');
if (wb) { const b = await wb.boundingBox(); await page.mouse.click(b.x + 5, b.y + 5); }
await new Promise(r => setTimeout(r, 20000));
const st = await page.evaluate(async () => { const N = await import('/src/nations.js'), U = await import('/src/units.js'); return { year: N.game.year, P: N.game.prosperity, units: U.units.length, paths: U.pathStats, wood: N.nations.map(n => n.wood), houses: N.nations.map(n => n.houses.length) }; });
console.log('wood before gifts', before);
console.log(JSON.stringify(st));
await page.screenshot({ path: 'test/crazy.png' });
console.log('errors:', errs.join('\n') || 'none');
await browser.close();
