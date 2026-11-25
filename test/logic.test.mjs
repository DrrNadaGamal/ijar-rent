import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../public/logic.js';

const NOW = Date.UTC(2026, 10, 25, 9, 0); // 25 Nov 2026
const at = (key, h = 9) => L.dayTs(key) + (h - 9) * 3600e3;
const owner = { id: 'o', name: 'Owner', role: 'owner' }, mgr = { id: 'm', name: 'Mgr', role: 'manager' }, acc = { id: 'a', name: 'Acc', role: 'accountant' };
const ten = (tenantId) => ({ id: 'tt', name: 'Tenant', role: 'tenant', tenantId });
function mini(now = NOW) {
  return {
    resetAt: now, counters: { c: 0, p: 0, l: 0, t: 0, r: 0, receipt: 0 }, keys: [], audit: [], settings: { ...L.DEFAULTS }, company: {},
    properties: [{ id: 'pr1', name: 'P', nameAr: 'ب' }], units: [{ id: 'u1', propertyId: 'pr1', code: '1A', listRent: 500000 }, { id: 'u2', propertyId: 'pr1', code: '1B', listRent: 600000 }],
    tenants: [{ id: 't1', name: 'Ali', nameAr: 'علي', phone: '+201000000001' }, { id: 't2', name: 'Sara', nameAr: 'سارة', phone: '+201000000002' }],
    leases: [], charges: [], payments: [], requests: [],
  };
}
const op = (s, user, o, now = NOW) => L.applyOp(s, o, { user, now });
const lease = (s, extra = {}, now) => { const st = extra.start || '2026-09-01'; now = now ?? (L.diffDays(st, L.dayKey(NOW)) > 30 ? at(st) : NOW); const r = op(s, owner, { type: 'addLease', unitId: 'u1', tenantId: 't1', start: '2026-09-01', months: 12, rent: 500000, deposit: 1000000, increasePct: 10, serviceFee: 0, ...extra }, now); return s.leases.find((l) => l.id === r.leaseId); };
const bad = (fn, cls, re) => assert.throws(fn, (e) => e instanceof cls && (!re || re.test(e.message)));

test('dates: Cairo day key, month end clamping, diff', () => {
  assert.equal(L.dayKey(Date.UTC(2026, 10, 25, 22, 30)), '2026-11-26'); // 00:30 in Cairo
  assert.equal(L.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(L.addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(L.addMonths('2026-03-15', -4), '2025-11-15');
  assert.equal(L.diffDays('2026-11-01', '2026-11-25'), 24);
  assert.equal(L.leaseEnd('2026-09-01', 12), '2027-08-31');
});

test('billing: one rent charge per month that has become due, idempotent', () => {
  const s = mini(); const l = lease(s); L.normalize(s, NOW); L.normalize(s, NOW);
  const rent = s.charges.filter((c) => c.kind === 'rent');
  assert.deepEqual(rent.map((c) => c.due), ['2026-09-01', '2026-10-01', '2026-11-01']);
  assert.equal(L.leaseBalance(s, l.id) >= 1500000, true);
});
test('billing: nothing is billed before the due date or after the lease end', () => {
  const s = mini(); const l = lease(s, { start: '2026-11-28', months: 1 }); L.normalize(s, NOW); assert.equal(s.charges.length, 0);
  L.normalize(s, at('2027-03-01')); assert.equal(s.charges.filter((c) => c.kind === 'rent' && c.leaseId === l.id).length, 1);
});
test('yearly increase applies from month 13 and rounds to whole pounds', () => {
  const l = { rent: 777700, increasePct: 10 };
  assert.equal(L.rentAt(l, 11), 777700); assert.equal(L.rentAt(l, 12), 855500); assert.equal(L.rentAt(l, 24), 941000);
});
test('service fee creates a second charge each month', () => {
  const s = mini(); lease(s, { serviceFee: 30000 }); L.normalize(s, NOW);
  assert.equal(s.charges.filter((c) => c.kind === 'service').length, 3);
});
test('late fee: none inside grace, one 5% fee after, never twice', () => {
  const s = mini(); const l = lease(s, { start: '2026-11-20', months: 12 });
  L.normalize(s, at('2026-11-20')); L.normalize(s, at('2026-11-25')); assert.equal(s.charges.filter((c) => c.kind === 'late').length, 0);
  L.normalize(s, at('2026-11-26')); L.normalize(s, at('2026-12-10'));
  const fees = s.charges.filter((c) => c.kind === 'late'); assert.equal(fees.length, 1); assert.equal(fees[0].amount, 25000); assert.equal(fees[0].due, '2026-11-26');
  void l;
});
test('late fee: not charged when the rent is paid inside the grace period', () => {
  const s = mini(); const l = lease(s, { start: '2026-11-20' }); L.normalize(s, at('2026-11-20'));
  op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 500000, method: 'cash' }, at('2026-11-24'));
  L.normalize(s, at('2026-12-15')); assert.equal(s.charges.filter((c) => c.kind === 'late').length, 0);
});
test('backdated lease does not get retroactive late fees', () => {
  const s = mini(); lease(s, { start: '2026-11-01' }); L.normalize(s, NOW);
  assert.equal(s.charges.filter((c) => c.kind === 'late').length, 0);
});
test('payment is allocated oldest charge first, partial payments keep the rest open', () => {
  const s = mini(); const l = lease(s); L.normalize(s, NOW);
  const r = op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 700000, method: 'cash' });
  const [c1, c2] = s.charges.filter((c) => c.kind === 'rent' && c.leaseId === l.id);
  assert.equal(c1.paid, 500000); assert.equal(c2.paid, 200000); assert.equal(r.no, 'R-00001');
  assert.equal(L.outstanding(c2), 300000);
});
test('overpayment becomes credit and is used on the next charge', () => {
  const s = mini(); const l = lease(s, { start: '2026-10-01' }); L.normalize(s, NOW);
  const r = op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 1500000, method: 'cash' });
  assert.equal(r.credit, 500000); assert.equal(l.credit, 500000); assert.equal(L.leaseBalance(s, l.id), -500000);
  L.normalize(s, at('2026-12-01')); assert.equal(l.credit, 0); assert.equal(L.leaseBalance(s, l.id), 0);
});
test('payment validation: amount, method, reference, date window', () => {
  const s = mini(); const l = lease(s); L.normalize(s, NOW);
  const pay = (o) => () => op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 100000, method: 'cash', ...o });
  bad(pay({ amount: 0 }), L.UserError); bad(pay({ amount: 10.5 }), L.UserError); bad(pay({ amount: '1000' }), L.UserError);
  bad(pay({ method: 'bitcoin' }), L.UserError); bad(pay({ method: 'cheque' }), L.UserError, /reference/i);
  bad(pay({ date: '2026-11-26' }), L.UserError); bad(pay({ date: '2026-11-01' }), L.UserError); pay({ date: '2026-11-20' })();
});
test('permissions: only owner, manager and accountant can take payments; tenant cannot', () => {
  const s = mini(); const l = lease(s); L.normalize(s, NOW);
  bad(() => op(s, ten('t1'), { type: 'recordPayment', leaseId: l.id, amount: 100, method: 'cash' }), L.PermError);
  bad(() => op(s, acc, { type: 'addLease', unitId: 'u2', tenantId: 't2', start: '2026-11-25', months: 12, rent: 500000 }), L.PermError);
  bad(() => op(s, mgr, { type: 'voidPayment', paymentId: 'p1' }), L.PermError);
});
test('void: latest payment of the day restores the charges, receipt number is not reused', () => {
  const s = mini(); const l = lease(s); L.normalize(s, NOW);
  op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 500000, method: 'cash' });
  const r2 = op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 300000, method: 'cash' });
  bad(() => op(s, acc, { type: 'voidPayment', paymentId: 'p1' }), L.UserError, /latest/);
  const before = L.leaseBalance(s, l.id);
  op(s, acc, { type: 'voidPayment', paymentId: r2.paymentId }); assert.equal(L.leaseBalance(s, l.id), before + 300000);
  bad(() => op(s, acc, { type: 'voidPayment', paymentId: r2.paymentId }), L.UserError, /already/);
  assert.equal(op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 1, method: 'cash' }).no, 'R-00003');
});
test('void is refused the next day and when its credit was already used', () => {
  const s = mini(); const l = lease(s, { start: '2026-10-01' }); L.normalize(s, NOW);
  const p = op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 1500000, method: 'cash' });
  bad(() => op(s, acc, { type: 'voidPayment', paymentId: p.paymentId }, at('2026-11-26')), L.UserError, /today/);
  L.normalize(s, at('2026-12-01')); // credit consumed by December rent
  bad(() => op(s, acc, { type: 'voidPayment', paymentId: p.paymentId }, at('2026-12-01')), L.UserError, /today/);
});
test('lease rules: overlap, deposit cap, increase cap, term, start window', () => {
  const s = mini(); lease(s);
  bad(() => lease(s, { start: '2027-03-01', months: 6 }), L.UserError, /already has a lease/);
  bad(() => lease(s, { unitId: 'u2', deposit: 1600000 }), L.UserError, /Deposit/);
  bad(() => lease(s, { unitId: 'u2', increasePct: 16 }), L.UserError);
  bad(() => lease(s, { unitId: 'u2', months: 61 }), L.UserError);
  bad(() => lease(s, { unitId: 'u2', start: '2026-10-01' }, NOW), L.UserError, /past/);
  bad(() => lease(s, { unitId: 'u2', start: '2027-06-01' }), L.UserError, /ahead/);
  bad(() => lease(s, { unitId: 'u2', start: '2026-02-30' }), L.UserError);
  bad(() => lease(s, { unitId: 'nope' }), L.UserError);
  bad(() => lease(s, { unitId: 'u2', tenantId: 'zzz' }), L.UserError, /tenant/i);
});
test('a lease can start the day after another ends (stacking) but not the same day', () => {
  const s = mini(); lease(s, { start: '2026-11-01', months: 1 });
  lease(s, { start: '2026-12-01', months: 6 });
  bad(() => lease(s, { start: '2026-11-30', months: 6 }), L.UserError);
});
test('new tenant is validated and created with the lease; duplicate key is ignored', () => {
  const s = mini();
  bad(() => op(s, owner, { type: 'addLease', unitId: 'u2', newTenant: { name: 'X', phone: '12' }, start: '2026-11-25', months: 12, rent: 500000 }), L.UserError);
  const base = { type: 'addLease', unitId: 'u2', newTenant: { name: 'Nour Adel', nameAr: 'نور عادل', phone: '+20 100 123 4567' }, start: '2026-11-25', months: 12, rent: 500000, key: 'k1' };
  const r = op(s, owner, base); assert.equal(s.tenants.at(-1).phone, '+201001234567'); assert.ok(r.leaseId);
  assert.equal(op(s, owner, base).duplicate, true); assert.equal(s.leases.length, 1); assert.equal(s.tenants.length, 3);
});
test('failed validation does not burn the idempotency key', () => {
  const s = mini(); bad(() => lease(s, { rent: 1, key: 'kk' }), L.UserError); assert.ok(lease(s, { key: 'kk' }).id);
});
test('renewal: opens 60 days before end, stacks from the next day, carries the deposit, once only', () => {
  const s = mini(); const l = lease(s, { start: '2026-03-10', months: 12 });
  bad(() => op(s, mgr, { type: 'renewLease', leaseId: l.id, months: 12, increasePct: 10 }), L.UserError, /60 days/);
  const now = at('2027-01-15');
  const r = op(s, mgr, { type: 'renewLease', leaseId: l.id, months: 12, increasePct: 10 }, now);
  const n = s.leases.find((x) => x.id === r.leaseId);
  assert.equal(n.start, '2027-03-10'); assert.equal(n.rent, 550000); assert.equal(l.depositStatus, 'transferred'); assert.equal(n.deposit, l.deposit);
  bad(() => op(s, mgr, { type: 'renewLease', leaseId: l.id, months: 12, increasePct: 10 }, now), L.UserError, /already/);
  op(s, mgr, { type: 'cancelRenewal', leaseId: n.id }, now); assert.equal(l.depositStatus, 'held'); assert.equal(s.leases.length, 1);
});
test('renewal rent is based on the rent after the yearly increase', () => {
  const s = mini(); const l = lease(s, { start: '2026-02-01', months: 24, increasePct: 10 }, at('2026-02-01'));
  const r = op(s, owner, { type: 'renewLease', leaseId: l.id, months: 12, increasePct: 5 }, at('2028-01-05'));
  assert.equal(s.leases.find((x) => x.id === r.leaseId).rent, 577500); // 5,000 x 1.10 x 1.05
});
test('move-out: deductions, arrears taken from the deposit, refund maths, later charges cancelled', () => {
  const s = mini(); const l = lease(s, { start: '2026-09-01', months: 12, deposit: 1000000 }); L.normalize(s, NOW);
  op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 500000, method: 'cash' });
  const out = L.leaseBalance(s, l.id);
  const r = op(s, mgr, { type: 'terminate', leaseId: l.id, date: '2026-11-30', deductions: [{ reason: 'Wall repainting', amount: 200000 }], applyArrears: true });
  assert.equal(r.settlement.appliedToArrears, Math.min(out, 800000)); assert.equal(r.settlement.refund, 1000000 - 200000 - r.settlement.appliedToArrears);
  assert.equal(l.status, 'terminated'); assert.equal(l.end, '2026-11-30');
  L.normalize(s, at('2027-03-01')); assert.equal(s.charges.filter((c) => c.leaseId === l.id && c.kind === 'rent').length, 3);
  bad(() => op(s, mgr, { type: 'terminate', leaseId: l.id, date: '2026-11-30', deductions: [] }), L.UserError);
});
test('move-out validation: deductions above deposit, bad date, paid future charge, receipts for deposit use', () => {
  const s = mini(); const l = lease(s); L.normalize(s, NOW);
  bad(() => op(s, mgr, { type: 'terminate', leaseId: l.id, date: '2026-11-30', deductions: [{ reason: 'x', amount: 1 }] }), L.UserError);
  bad(() => op(s, mgr, { type: 'terminate', leaseId: l.id, date: '2026-11-30', deductions: [{ reason: 'Damage', amount: 1000001 }] }), L.UserError, /more than the deposit/);
  bad(() => op(s, mgr, { type: 'terminate', leaseId: l.id, date: '2027-02-01', deductions: [] }), L.UserError);
  bad(() => op(s, mgr, { type: 'terminate', leaseId: l.id, date: '2026-08-01', deductions: [] }), L.UserError);
  op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 9000000, method: 'cash' });
  s.charges.push({ id: 'cx', leaseId: l.id, kind: 'rent', idx: 3, period: '2026-12', due: '2026-12-01', amount: 500000, paid: 500000 });
  bad(() => op(s, mgr, { type: 'terminate', leaseId: l.id, date: '2026-11-30', deductions: [] }), L.UserError, /already paid/);
});
test('waiving a late fee: reason required, only unpaid late fees, removes it from the balance', () => {
  const s = mini(); const l = lease(s, { start: '2026-11-20' }); L.normalize(s, NOW); L.normalize(s, at('2026-11-26'));
  const fee = s.charges.find((c) => c.kind === 'late'); const bal = L.leaseBalance(s, l.id);
  bad(() => op(s, acc, { type: 'waiveFee', chargeId: fee.id, reason: 'ok ok' }), L.PermError);
  bad(() => op(s, mgr, { type: 'waiveFee', chargeId: fee.id, reason: 'x' }), L.UserError);
  bad(() => op(s, mgr, { type: 'waiveFee', chargeId: s.charges[0].id, reason: 'Not a fee' }), L.UserError, /late fees/);
  op(s, mgr, { type: 'waiveFee', chargeId: fee.id, reason: 'Bank holiday delay' }, at('2026-11-26')); assert.equal(L.leaseBalance(s, l.id), bal - fee.amount);
});
test('aging buckets split overdue amounts by days past due', () => {
  const s = mini(); const l = lease(s, { start: '2026-08-15' }, at('2026-08-15')); L.normalize(s, NOW);
  const row = L.aging(s, L.dayKey(NOW)).find((r) => r.leaseId === l.id);
  assert.equal(row.d30 + row.d60 + row.d90 + row.d90p, row.total - 0); assert.ok(row.d90 > 0 && row.d30 > 0); assert.equal(row.oldestDays, 102 - 0 > 90 ? row.oldestDays : 0);
});
test('maintenance: tenant requests only for own unit, caps open requests, staff flow, repair charged to tenant', () => {
  const s = mini(); const l = lease(s, { start: '2026-11-01' }); L.normalize(s, NOW);
  const r = op(s, ten('t1'), { type: 'submitRequest', unitId: 'u2', title: 'Leaking tap', priority: 'normal' });
  assert.equal(s.requests[0].unitId, 'u1'); // forced to the tenant's own unit
  bad(() => op(s, ten('t2'), { type: 'cancelRequest', id: r.requestId }), L.PermError);
  bad(() => op(s, ten('t2'), { type: 'submitRequest', unitId: 'u1', title: 'Hello', priority: 'low' }), L.UserError, /no active lease/);
  bad(() => op(s, mgr, { type: 'completeRequest', id: r.requestId, cost: 1000 }), L.UserError, /vendor/i);
  op(s, mgr, { type: 'assignRequest', id: r.requestId, vendor: 'Bright Plumbing', estimate: 20000 });
  bad(() => op(s, mgr, { type: 'completeRequest', id: r.requestId, cost: 600000, chargedTo: 'owner' }), L.UserError, /owner/);
  const bal = L.leaseBalance(s, l.id);
  const c = op(s, owner, { type: 'completeRequest', id: r.requestId, cost: 45000, chargedTo: 'tenant' });
  assert.ok(c.chargeId); assert.equal(L.leaseBalance(s, l.id), bal + 45000);
  for (let i = 0; i < 5; i++) op(s, ten('t1'), { type: 'submitRequest', unitId: 'u1', title: 'Issue ' + i, priority: 'low' });
  bad(() => op(s, ten('t1'), { type: 'submitRequest', unitId: 'u1', title: 'One more', priority: 'low' }), L.UserError, /5 open/);
});
test('tenant view shows only own lease, charges, payments and hides staff data', () => {
  const s = L.seed(NOW); const u = s.users.find((x) => x.role === 'tenant'); L.normalize(s, NOW);
  const v = L.view(s, u, NOW);
  assert.ok(v.leases.length >= 1 && v.leases.every((l) => l.tenantId === 't1'));
  assert.equal(v.tenants.length, 1); assert.equal(v.reports, undefined); assert.equal(v.audit, undefined);
  assert.ok(v.payments.every((p) => v.leases.some((l) => l.id === p.leaseId) && p.by === undefined));
  assert.ok(v.requests.every((r) => r.tenantId === 't1' && r.vendor === ''));
  assert.ok(!JSON.stringify(v).includes('"phone":"+2010') || v.tenants[0].phone);
});
test('owner sees the audit trail; accountant and manager do not', () => {
  const s = L.seed(NOW);
  assert.ok(Array.isArray(L.view(s, s.users[0], NOW).audit)); assert.equal(L.view(s, s.users[2], NOW).audit, undefined); assert.equal(L.view(s, s.users[1], NOW).audit, undefined);
});
test('seed: consistent ledger, payments never exceed what was billed plus credit', () => {
  const s = L.seed(NOW); L.normalize(s, NOW);
  assert.ok(s.leases.length >= 25 && s.tenants.length >= 25 && s.units.length === 30);
  const paid = s.payments.reduce((a, p) => a + p.amount, 0), allocated = s.charges.reduce((a, c) => a + c.paid, 0);
  assert.equal(paid, allocated + s.leases.reduce((a, l) => a + l.credit, 0));
  for (const c of s.charges) assert.ok(c.paid >= 0 && c.paid <= c.amount, c.id);
  const nums = s.payments.map((p) => p.no); assert.equal(new Set(nums).size, nums.length);
  const r = L.reports(s, NOW); assert.ok(r.arrears > 0 && r.aging.length >= 3 && r.expiring.length >= 2 && r.openRequests >= 3 && r.occupancy > 0.8 && r.occupancy < 1);
});
test('reports: collection rate, occupancy, vacancy loss and repairs net out', () => {
  const s = mini(); const l = lease(s, { start: '2026-11-01' }); L.normalize(s, NOW);
  op(s, acc, { type: 'recordPayment', leaseId: l.id, amount: 250000, method: 'cash' });
  const r = L.reports(s, NOW);
  assert.equal(r.billedMonth, 500000); assert.equal(r.collectionRate, 0.5); assert.equal(r.occupancy, 0.5); assert.equal(r.vacantLoss, 600000); assert.equal(r.collectedMonth, 250000);
  const q = op(s, mgr, { type: 'submitRequest', unitId: 'u1', title: 'Fix socket', priority: 'low' });
  op(s, mgr, { type: 'assignRequest', id: q.requestId, vendor: 'Spark Electric' }); op(s, mgr, { type: 'completeRequest', id: q.requestId, cost: 50000, chargedTo: 'owner' });
  assert.equal(L.reports(s, NOW).netMonth, 200000);
});
test('expiring list proposes the renewal rent', () => {
  const s = mini(); lease(s, { start: '2026-01-10', months: 12 }, at('2026-01-10')); L.normalize(s, at('2026-12-01'));
  const e = L.reports(s, at('2026-12-01')).expiring[0]; assert.equal(e.daysLeft, 39); assert.equal(e.proposedRent, 550000);
});
test('unknown or hostile operations are rejected', () => {
  const s = mini();
  for (const o of [null, {}, { type: 'constructor' }, { type: '__proto__' }, { type: 'toString' }, 'x']) bad(() => op(s, owner, o), L.UserError, /Unknown/);
});
test('csv neutralises formulas and quotes special characters', () => {
  assert.equal(L.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"'); assert.equal(L.csvCell('+1'), "'+1"); assert.equal(L.csvCell('a,b'), '"a,b"'); assert.equal(L.csvCell(null), '');
  assert.ok(L.toCsv([['a', 'b']]).startsWith('\ufeff'));
});
test('text fields are bounded', () => {
  const s = mini(); lease(s, { start: '2026-11-01' }); L.normalize(s, NOW);
  bad(() => op(s, mgr, { type: 'submitRequest', unitId: 'u1', title: 'x'.repeat(81), priority: 'low' }), L.UserError);
  bad(() => op(s, mgr, { type: 'submitRequest', unitId: 'u1', title: 'OK title', desc: 'y'.repeat(501), priority: 'low' }), L.UserError);
  bad(() => op(s, mgr, { type: 'submitRequest', unitId: 'u1', title: 'OK title', priority: 'huge' }), L.UserError);
});
