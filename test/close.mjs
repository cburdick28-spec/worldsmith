import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:5173/?seed=99');
await new Promise(r => setTimeout(r, 3000));
await page.click('#begin');
await page.evaluate(async () => {
  const N = await import('/src/nations.js'), U = await import('/src/units.js'), P = await import('/src/powers.js');
  // fast-forward 60 years so towns grow, then look closely at the first capital
  for (let i = 0; i < 4800; i++) { N.updateNations(0.05); U.updateUnits(0.05); }
  P.setTool('inspect');
});
await page.evaluate(() => new Promise(r => setTimeout(r, 2500)));
await page.evaluate(async () => {
  const N = await import('/src/nations.js');
  window.__n = N.nations.find(n => n.alive);
});
// zoom in on that nation by scrolling and focusing
await page.evaluate(async () => {
  const n = window.__n;
  const ev = new WheelEvent('wheel', { deltaY: -900, bubbles: true, cancelable: true });
  document.querySelector('canvas').dispatchEvent(ev);
  const m = await import('/src/main.js').catch(() => null);
});
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'test/close.png' });
console.log('errors:', errs.filter(e => !e.includes('404')).join('\n') || 'none');
await browser.close();
