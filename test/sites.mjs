import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:5173/?seed=1234');
await new Promise(r => setTimeout(r, 3000));
const out = await page.evaluate(async () => {
  const N = await import('/src/nations.js');
  const Wd = await import('/src/world.js');
  let land = 0, mid = 0;
  for (let z = 0; z < Wd.D; z++) for (let x = 0; x < Wd.W; x++) { const h = Wd.topAt(x, z); if (h > Wd.SEA) land++; if (h >= Wd.SEA + 2 && h <= 24) mid++; }
  const W=Wd.W,D=Wd.D,SEA=Wd.SEA,topAt=Wd.groundTop; const c=[]; for (let z=16;z<D-16;z+=4) for (let x=16;x<W-16;x+=4){const h=topAt(x,z); if(h<SEA+2||h>24) continue; let mn=99,mx=-1,ok=true; for(let dz=-4;dz<=4&&ok;dz+=2) for(let dx=-4;dx<=4;dx+=2){const hh=topAt(x+dx,z+dz); if(hh<SEA+1){ok=false;break} mn=Math.min(mn,hh);mx=Math.max(mx,hh);} if(ok&&mx-mn<=3) c.push([x,z]);} return { cands: c.length, sample: c.filter((_,i)=>i%7==0), caps: N.nations.map(n => [n.name, Math.round(n.capital.x), Math.round(n.capital.z)]), land, mid };
});
console.log(JSON.stringify(out));
await browser.close();
