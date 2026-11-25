// Captures README and case-study screenshots from a running Ijar.
import puppeteer from 'puppeteer-core';
const U = (process.argv[2] || 'http://localhost:3100').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
async function shot(name, pin, route, lang, w, h, full = false, pre) {
  const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.goto(U + '/?lang=' + lang, { waitUntil: 'networkidle0' });
  await p.type('#pin', pin); await p.keyboard.press('Enter'); await p.waitForSelector('.top', { timeout: 15000 }); await sleep(400);
  if (route) { await p.evaluate((r) => (location.hash = '#/' + r), route); await sleep(600); }
  if (pre) { await pre(p); await sleep(500); }
  await p.screenshot({ path: `docs/${name}.png`, fullPage: full }); await ctx.close(); console.log(name);
}
const clickText = (p, sel, re) => p.evaluate((sel, re) => { const el = [...document.querySelectorAll(sel)].find((e) => new RegExp(re).test(e.innerText)); el?.click(); return !!el; }, sel, re);
await shot('dashboard-en', '1111', 'dashboard', 'en', 1440, 1000, true);
await shot('units-en', '2222', 'units', 'en', 1440, 1000, true);
await shot('lease-en', '2222', 'arrears', 'en', 1440, 1000, false, async (p) => { await p.click('tr td a'); await sleep(500); });
await shot('payment-en', '3333', 'payments', 'en', 1440, 900, false, async (p) => { await p.click('[data-act=pay]'); await sleep(300); await p.select('#pm-m', 'transfer'); await p.type('#pm-r', 'TR-889120'); });
await shot('arrears-en', '2222', 'arrears', 'en', 1440, 900);
await shot('renewals-en', '2222', 'renewals', 'en', 1440, 900);
await shot('maintenance-en', '2222', 'maintenance', 'en', 1440, 1000, true);
await shot('reports-en', '1111', 'reports', 'en', 1440, 1000, true);
await shot('dashboard-ar', '1111', 'dashboard', 'ar', 1440, 1150, false);
await shot('units-ar', '2222', 'units', 'ar', 1440, 900);
await shot('tenant-ar-mobile', '4444', 'home', 'ar', 390, 1500, false);
await shot('arrears-ar-mobile', '3333', 'arrears', 'ar', 390, 900);
await b.close();
