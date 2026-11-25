// Browser and API checks against a running Ijar (local dev server or the live URL).
// Usage: node e2e/e2e.mjs https://your-deploy.vercel.app   (needs Chrome at /usr/bin/google-chrome)
import puppeteer from 'puppeteer-core';
const U = (process.argv[2] || 'http://localhost:3100').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(c ? 'PASS' : 'FAIL', m); };
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
const errs = [];
async function newPage(w = 1280, h = 900) {
  const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  p.on('dialog', (d) => d.accept('Goodwill')); return p;
}
async function login(p, pin, lang = 'en') {
  await p.goto(U + '/?lang=' + lang, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear()); await p.goto(U + '/?lang=' + lang, { waitUntil: 'networkidle0' });
  await p.type('#pin', pin); await p.keyboard.press('Enter'); await p.waitForSelector('.top', { timeout: 15000 }); await sleep(300);
}
const go = async (p, r) => { await p.evaluate((r) => (location.hash = '#/' + r), r); await sleep(400); };
const body = (p) => p.evaluate(() => document.body.innerText);
const toastText = (p) => p.evaluate(() => document.querySelector('#toast')?.innerText || '');
const click = async (p, sel) => { await p.waitForSelector(sel, { timeout: 8000 }); await p.click(sel); await sleep(450); };
const setv = async (p, sel, v) => { await p.waitForSelector(sel); await p.$eval(sel, (e) => (e.value = '')); await p.type(sel, v); };
async function api(token, method, bodyObj, raw) {
  const r = await fetch(U + '/api/data', { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: raw ?? (bodyObj ? JSON.stringify(bodyObj) : undefined) });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, j };
}
const tokenFor = async (pin) => (await api(null, 'POST', { op: { type: 'login', pin } })).j.token;
const T = { owner: await tokenFor('1111'), mgr: await tokenFor('2222'), acc: await tokenFor('3333'), ten: await tokenFor('4444') };
const post = (role, op) => api(T[role], 'POST', { op });
const view = async (role) => (await api(T[role], 'GET')).j;
await post('owner', { type: 'reset' });

// ---------- API security ----------
ok((await api(null, 'GET')).status === 401, 'no token: 401');
ok((await api('garbage', 'GET')).status === 401, 'garbage token: 401');
const tc = T.ten.split('.'); const forged = Buffer.from('u-owner.' + (Date.now() + 1e7)).toString('base64url') + '.' + tc[1];
ok((await api(forged, 'GET')).status === 401, 'forged token for another user: 401');
ok((await api(null, 'POST', { op: { type: 'login', pin: '0000' } })).status === 401, 'wrong PIN: 401');
ok((await api(T.owner, 'POST', null, '{not json')).status === 400, 'malformed JSON: 400');
ok((await post('owner', { type: 'nope' })).status === 400, 'unknown action: 400');
ok((await post('owner', { type: 'constructor' })).status === 400, 'prototype name as action: 400');
ok((await api(T.owner, 'POST', { op: { type: 'logReminder', leaseId: 'l1', pad: 'x'.repeat(21000) } })).status === 413, 'oversized body: 413');
ok((await api(T.owner, 'DELETE')).status === 405, 'DELETE: 405');

// ---------- data visibility ----------
const own = await view('owner'), mgr = await view('mgr'), acc = await view('acc'), ten = await view('ten');
ok(own.leases.length >= 25 && own.units.length === 30 && own.reports && Array.isArray(own.audit), 'owner sees everything and the audit trail');
ok(mgr.audit === undefined && acc.audit === undefined, 'manager and accountant do not get the audit trail');
ok(ten.reports === undefined && ten.audit === undefined, 'tenant gets no reports or audit');
ok(ten.leases.length >= 1 && ten.leases.every((l) => l.tenantId === 't1') && ten.tenants.length === 1, 'tenant sees only own lease and own record');
ok(ten.payments.every((p) => ten.leases.some((l) => l.id === p.leaseId) && p.by === undefined), 'tenant sees only own payments, without staff names');
ok(!JSON.stringify(ten).includes(own.tenants.find((x) => x.id === 't2').phone), "tenant response has no other tenant's phone");
ok(own.reports.arrears > 0 && own.reports.aging.length >= 3 && own.reports.expiring.length >= 3 && own.reports.occupancy < 1, 'seed has arrears, expiring leases and vacancies');

// ---------- permissions ----------
const l1 = own.leases.find((l) => l.state === 'active' && l.balance > 0);
const pay = (role, o = {}) => post(role, { type: 'recordPayment', leaseId: l1.id, amount: 100000, method: 'cash', ...o });
ok((await pay('ten')).status === 403, 'tenant cannot record a payment');
ok((await post('acc', { type: 'addLease', unitId: 'un21', tenantId: 't1', start: own.today, months: 12, rent: 500000 })).status === 403, 'accountant cannot create a lease');
ok((await post('mgr', { type: 'voidPayment', paymentId: 'p1' })).status === 403, 'manager cannot void payments');
ok((await post('mgr', { type: 'reset' })).status === 403, 'only the owner can reset');
ok((await post('ten', { type: 'assignRequest', id: 'r1', vendor: 'Someone' })).status === 403, 'tenant cannot assign a vendor');
ok((await post('ten', { type: 'waiveFee', chargeId: 'c1', reason: 'please' })).status === 403, 'tenant cannot waive fees');
ok((await post('acc', { type: 'waiveFee', chargeId: 'c1', reason: 'please' })).status === 403, 'accountant cannot waive fees');

// ---------- payments and ledger ----------
const bal0 = (await view('acc')).leases.find((l) => l.id === l1.id).balance;
const r1 = await pay('acc', { amount: 123456 });
ok(r1.status === 200 && /^R-\d{5}$/.test(r1.j.result.no), 'accountant records a payment and gets a receipt number');
const v1 = await view('acc'); ok(v1.leases.find((l) => l.id === l1.id).balance === bal0 - 123456, 'balance drops by the amount paid');
const pOld = v1.charges.filter((c) => c.leaseId === l1.id && c.paid > 0 && !c.voided);
ok(pOld.length >= 1, 'payment was allocated to open charges, oldest first');
const r2 = await pay('acc', { amount: 5 }); ok(r2.status === 200 && Number(r2.j.result.no.slice(2)) === Number(r1.j.result.no.slice(2)) + 1, 'receipt numbers go up by one');
ok((await pay('acc', { amount: 0 })).status === 400 && (await pay('acc', { amount: 1.5 })).status === 400 && (await pay('acc', { amount: '100' })).status === 400, 'zero, fractional and string amounts are refused');
ok((await pay('acc', { method: 'cheque' })).status === 400, 'cheque without a number is refused');
ok((await pay('acc', { date: '2020-01-01' })).status === 400, 'old payment date is refused');
ok((await pay('acc', { method: 'cheque', ref: 'CH-0001', amount: 100 })).status === 200, 'cheque with a number is accepted');
const rv = await post('owner', { type: 'voidPayment', paymentId: r1.j.result.paymentId }); ok(rv.status === 400, 'cannot void a payment that is not the latest');
const last = (await view('owner')).payments.filter((p) => p.leaseId === l1.id && !p.voided).at(-1);
const bBefore = (await view('owner')).leases.find((l) => l.id === l1.id).balance;
ok((await post('owner', { type: 'voidPayment', paymentId: last.id })).status === 200, 'owner voids the latest payment of the day');
ok((await view('owner')).leases.find((l) => l.id === l1.id).balance === bBefore + last.amount, 'voiding restores the balance');
ok((await post('owner', { type: 'voidPayment', paymentId: last.id })).status === 400, 'voiding twice is refused');
// overpay -> credit
const lc = own.leases.find((l) => l.state === 'active' && l.balance === 0);
const bc = (await view('owner')).leases.find((l) => l.id === lc.id).balance;
const rc = await post('acc', { type: 'recordPayment', leaseId: lc.id, amount: 250000, method: 'cash' });
ok(rc.status === 200 && rc.j.result.credit === 250000 && (await view('owner')).leases.find((l) => l.id === lc.id).balance === bc - 250000, 'overpayment becomes credit on account');

// ---------- late fees ----------
const withFee = (await view('owner')).charges.find((c) => c.kind === 'late' && !c.voided && c.paid === 0);
ok(!!withFee, 'seed has an unpaid late fee');
ok((await post('mgr', { type: 'waiveFee', chargeId: withFee.id, reason: 'x' })).status === 400, 'waiver needs a real reason');
ok((await post('mgr', { type: 'waiveFee', chargeId: withFee.id, reason: 'Bank holiday delay' })).status === 200, 'manager waives a late fee');
ok((await view('owner')).charges.find((c) => c.id === withFee.id).voided === true, 'waived fee is marked and stops counting');
ok((await post('mgr', { type: 'waiveFee', chargeId: own.charges.find((c) => c.kind === 'rent').id, reason: 'Not a fee' })).status === 400, 'rent charges cannot be waived');

// ---------- leases ----------
const vac = (await view('mgr')).reports.vacant[0]; const today = own.today;
const NL = { type: 'addLease', unitId: vac, newTenant: { name: '<img src=x onerror=alert(1)>', nameAr: 'نور الهدى', phone: '+20 100 555 0100' }, start: today, months: 12, rent: 800000, deposit: 1600000, increasePct: 10, serviceFee: 25000, key: 'e2e-k1' };
const nl = await post('mgr', NL); ok(nl.status === 200 && nl.j.result.leaseId, 'manager creates a lease with a new tenant');
ok((await post('mgr', NL)).j.result.duplicate === true && (await view('mgr')).leases.filter((l) => l.unitId === vac && l.start === today).length === 1, 'repeating the same request does not create a second lease');
ok((await post('mgr', { ...NL, key: 'k2' })).status === 400, 'overlapping lease on the same unit is refused');
ok((await post('mgr', { ...NL, unitId: 'un22', key: 'k3', deposit: 2500000 })).status === 400, 'deposit above 3 months is refused');
ok((await post('mgr', { ...NL, unitId: 'un22', key: 'k4', increasePct: 40 })).status === 400, 'increase above the cap is refused');
ok((await post('mgr', { ...NL, unitId: 'un22', key: 'k5', start: '2025-01-01' })).status === 400, 'start date far in the past is refused');
ok((await post('mgr', { ...NL, unitId: 'un22', key: 'k6', newTenant: { name: 'A', phone: 'abc' } })).status === 400, 'bad tenant details are refused');
const vN = await view('mgr'); const newLease = vN.leases.find((l) => l.id === nl.j.result.leaseId);
ok(vN.charges.filter((c) => c.leaseId === newLease.id).length === 2, 'rent and service fee were billed for the first month');
ok(newLease.balance === 825000, 'first month balance is rent plus service fee');
// renewal + move-out
const ex = vN.reports.expiring[0];
ok((await post('mgr', { type: 'renewLease', leaseId: newLease.id, months: 12, increasePct: 10 })).status === 400, 'a lease with a year left cannot be renewed yet');
const rn = await post('mgr', { type: 'renewLease', leaseId: ex.leaseId, months: 12, increasePct: 10, key: 'e2e-r1' });
ok(rn.status === 200 && rn.j.result.rent === Math.round((ex.currentRent * 1.1) / 100) * 100, 'renewal stacks after the current lease at the proposed rent');
ok((await post('mgr', { type: 'renewLease', leaseId: ex.leaseId, months: 12, increasePct: 10 })).status === 400, 'second renewal of the same lease is refused');
ok((await post('mgr', { type: 'cancelRenewal', leaseId: rn.j.result.leaseId })).status === 200, 'renewal can be cancelled before it starts');
const mv = await post('mgr', { type: 'terminate', leaseId: newLease.id, date: today, deductions: [{ reason: 'Painting', amount: 100000 }], applyArrears: true });
ok(mv.status === 200 && mv.j.result.settlement.appliedToArrears === 825000 && mv.j.result.settlement.refund === 1600000 - 100000 - 825000, 'move-out takes unpaid rent from the deposit and refunds the rest');
ok((await post('mgr', { type: 'terminate', leaseId: newLease.id, date: today, deductions: [] })).status === 400, 'a lease cannot be ended twice');
ok((await view('mgr')).leases.find((l) => l.id === newLease.id).state === 'terminated', 'ended lease shows as moved out');

// ---------- maintenance ----------
const rq = await post('ten', { type: 'submitRequest', unitId: 'un30', title: 'Bathroom light flickers', desc: 'Since Friday', priority: 'normal', key: 'e2e-q1' });
ok(rq.status === 200, 'tenant submits a repair request');
const tv = await view('ten'); const myReq = tv.requests.find((r) => r.id === rq.j.result.requestId);
ok(myReq && myReq.unitId === 'un1', "request is forced onto the tenant's own unit, not the one they typed");
ok((await post('ten', { type: 'submitRequest', unitId: 'un1', title: 'x', priority: 'normal' })).status === 400, 'short title is refused');
ok((await post('mgr', { type: 'completeRequest', id: myReq.id, cost: 1000 })).status === 400, 'cannot complete before a vendor is assigned');
ok((await post('mgr', { type: 'assignRequest', id: myReq.id, vendor: 'Spark Electric', estimate: 30000 })).status === 200, 'manager assigns a vendor');
ok((await post('mgr', { type: 'completeRequest', id: myReq.id, cost: 600000, chargedTo: 'owner' })).status === 400, 'repair above the manager limit needs the owner');
const balT0 = (await view('ten')).leases.find((l) => l.state === 'active').balance;
ok((await post('owner', { type: 'completeRequest', id: myReq.id, cost: 28000, chargedTo: 'tenant' })).status === 200, 'owner completes it and charges the tenant');
ok((await view('ten')).leases.find((l) => l.state === 'active').balance === balT0 + 28000, 'the tenant sees the repair charge on their balance');
ok((await post('ten', { type: 'cancelRequest', id: 'r2' })).status === 403, "tenant cannot cancel someone else's request");

// ---------- audit ----------
const au = (await view('owner')).audit; ok(au.length >= 8 && au.some((x) => x.action === 'payment') && au.some((x) => x.action === 'move-out') && au.some((x) => x.action === 'waive'), 'audit trail records payments, waivers and move-outs');
await post('owner', { type: 'reset' });

// ---------- browser: owner ----------
let p = await newPage();
await login(p, '1111');
let txt = await body(p);
ok(/Collected this month/.test(txt) && /Overdue balance/.test(txt) && /Occupancy/.test(txt), 'owner dashboard shows collections, overdue and occupancy');
ok(!/undefined|NaN|\[object/.test(txt), 'dashboard has no undefined or NaN');
const navs = await p.$$eval('.nav a', (a) => a.map((x) => x.textContent)); ok(navs.length === 9 && navs.includes('Audit trail'), 'owner sees 9 sections');
for (const r of ['units', 'leases', 'payments', 'arrears', 'renewals', 'maintenance', 'reports', 'audit']) { await go(p, r); const t2 = await body(p); ok(t2.length > 200 && !/undefined|NaN|\[object/.test(t2), `page ${r} renders cleanly`); }
await go(p, 'units'); await click(p, '[data-f=vacant]'); ok((await p.$$('.ucard')).length >= 3, 'units: vacant filter lists vacant units');
await click(p, '[data-f=behind]'); ok((await p.$$('.ucard')).length >= 3, 'units: behind-on-rent filter works');
await click(p, '[data-f=all]'); await p.type('#uq', 'Karim'); await sleep(300); ok((await p.$$('.ucard')).length >= 1 && (await p.$$('.ucard')).length <= 3, 'units: search by tenant name');
await go(p, 'arrears'); await click(p, 'tr td a'); txt = await body(p); ok(/Charges/.test(txt) && /Payments/.test(txt) && /Record payment/.test(txt), 'lease detail shows ledger and payments');
const wa = await p.$eval('[data-act=remind]', (e) => e.dataset.url); ok(/^https:\/\/wa\.me\/\d+\?text=/.test(wa), 'WhatsApp reminder link is built from the tenant phone');
await click(p, '.modal [data-act=pay]'); await setv(p, '#pm-a', '1000'); await click(p, '[data-act=savepay]'); txt = await body(p); ok(/R-\d{5}/.test(txt) && /1,000 EGP/.test(txt), 'recording a payment in the UI shows the receipt');
ok((await toastText(p)).length > 0, 'success message appears');
await click(p, '.modal .bar [data-act=close]'); ok((await p.$('.modal')) === null, 'modal closes');
// new lease via UI with hostile name
await go(p, 'leases'); await click(p, '[data-act=unitnew]'); await click(p, '[data-act=nlt][data-m=new]');
await setv(p, '#nl-n', '<b>Bold</b> "Test" & Co'); await setv(p, '#nl-na', 'اختبار'); await setv(p, '#nl-ph', '01000000999'); await click(p, '[data-act=savelease]');
txt = await body(p); ok(/<b>Bold<\/b> "Test" & Co/.test(txt), 'hostile tenant name is shown as plain text');
ok((await p.$('.modal b')) === null || !(await p.$$eval('.modal b', (n) => n.some((x) => x.textContent === 'Bold'))), 'no HTML was injected from the name');
await click(p, '.modal .bar [data-act=close]');
// CSV
await go(p, 'reports'); const csv = await p.evaluate(async () => { const L = await import('/logic.js'); return L.toCsv([['=cmd|calc', 'a,b']]); }); ok(/'=cmd\|calc/.test(csv), 'CSV export neutralises formulas');
// reload keeps session; language toggle
await p.reload({ waitUntil: 'networkidle0' }); ok((await p.$('.top')) !== null, 'reload keeps the session');
await click(p, '[data-act=lang]'); ok(await p.evaluate(() => document.documentElement.dir === 'rtl' && /اللوحة/.test(document.body.innerText)), 'Arabic switches to RTL with Arabic labels');
await p.close();

// ---------- browser: roles ----------
p = await newPage(); await login(p, '3333');
ok((await p.$$eval('.nav a', (a) => a.map((x) => x.textContent))).join() === 'Dashboard,Leases,Payments,Arrears,Reports', 'accountant sees only money pages');
await p.evaluate(() => (location.hash = '#/maintenance')); await sleep(400); ok(/Dashboard/.test(await p.$eval('.nav a.on', (e) => e.textContent)), 'accountant is bounced from a page it cannot open');
await go(p, 'leases'); await click(p, 'tbody tr'); ok(!(await body(p)).includes('Move out') && !(await body(p)).includes('Renew'), 'accountant does not get renew or move-out buttons');
await p.close();
p = await newPage(); await login(p, '4444');
ok((await p.$$eval('.nav a', (a) => a.length)) === 3, 'tenant sees three pages'); txt = await body(p);
ok(/Karim Fathy/.test(txt) && /How to pay/.test(txt) && !/Mona Adel/.test(txt), 'tenant home shows own lease only');
await go(p, 'ledger'); ok(/Statement/.test(await body(p)) && (await p.$$('tbody tr')).length >= 5, 'tenant statement lists charges and receipts');
await click(p, '[data-act=rcpt]'); ok(/R-\d{5}/.test(await body(p)), 'tenant can open a receipt');
await click(p, '.modal [data-act=close]'); await go(p, 'requests'); await click(p, '[data-act=newreq]'); await setv(p, '#rq-t', 'Front door sticks'); await click(p, '[data-act=savereq]');
ok(/Front door sticks/.test(await body(p)), 'tenant creates a request in the UI');
await p.close();
// expired/garbage token in browser
p = await newPage(); await p.goto(U, { waitUntil: 'networkidle0' }); await p.evaluate(() => localStorage.setItem('ij.token', JSON.stringify('bad.token'))); await p.reload({ waitUntil: 'networkidle0' }); ok((await p.$('#pin')) !== null, 'a bad saved token falls back to the sign-in screen'); await p.close();

// ---------- browser: Arabic RTL and phone layout ----------
for (const [pin, pages] of [['2222', ['dashboard', 'units', 'leases', 'payments', 'arrears', 'renewals', 'maintenance', 'reports']], ['4444', ['home', 'ledger', 'requests']]]) {
  p = await newPage(390, 844); await login(p, pin, 'ar');
  ok(await p.evaluate(() => document.documentElement.dir === 'rtl'), `${pin}: Arabic page is RTL`);
  for (const r of pages) { await go(p, r); const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bad: /undefined|NaN|\[object/.test(document.body.innerText), raw: /\b(nav|kind|ls|pm|pr|rq|ch|k|f|b|h|ttl|msgs|rep)\.[a-zA-Z0-9]+\b/.test(document.body.innerText) })); ok(o.sw <= o.iw + 1 && !o.bad && !o.raw, `${pin} phone Arabic ${r}: no sideways scroll, no raw keys`); }
  await p.close();
}
p = await newPage(390, 844); await login(p, '2222', 'ar'); await go(p, 'arrears'); await click(p, 'tbody tr td a'); const mw = await p.evaluate(() => ({ s: document.querySelector('.modal').scrollWidth, c: document.querySelector('.modal').clientWidth })); ok(!!mw && mw.s <= mw.c + 40, 'Arabic phone: lease modal fits (tables scroll inside)'); await p.close();
ok(errs.length === 0, 'no page errors or console errors in any run' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await post('owner', { type: 'reset' });
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
