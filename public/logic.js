// Ijar business rules. Pure functions shared by the browser and the API. Money is integer piasters (100 = 1 EGP).
export const TZ = 'Africa/Cairo';
export const ROLES = { owner: 'owner', manager: 'manager', accountant: 'accountant', tenant: 'tenant' };
export const STAFF = ['owner', 'manager', 'accountant'];
export const METHODS = ['cash', 'transfer', 'cheque', 'instapay'];
export const DEMO_USERS = [
  { pin: '1111', label: 'Owner (Mr. Hossam)', labelAr: 'المالك (أ. حسام)' },
  { pin: '2222', label: 'Property manager (Eng. Rana)', labelAr: 'مديرة العقارات (م. رنا)' },
  { pin: '3333', label: 'Accountant (Mr. Wael)', labelAr: 'المحاسب (أ. وائل)' },
  { pin: '4444', label: 'Tenant portal (Karim Fathy)', labelAr: 'بوابة المستأجر (كريم فتحي)' },
];
export const DEFAULTS = { graceDays: 5, lateFeePct: 5, renewalPct: 10, maxIncreasePct: 15, managerRepairLimit: 500000, maxDepositMonths: 3, backdateDays: 7 };

export class UserError extends Error {}
export class PermError extends Error {}

// ---------- dates (Cairo calendar days as 'YYYY-MM-DD') ----------
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (ts) => fmt.format(ts);
const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const toKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (k, n) => toKey(parse(k) + n * 864e5);
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export function addMonths(k, n) {
  const [y, m, d] = k.split('-').map(Number); const t = (y * 12 + (m - 1)) + n; const yy = Math.floor(t / 12), mm = (t % 12 + 12) % 12;
  const dim = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
}
export const monthOf = (k) => k.slice(0, 7);
export const dayTs = (k) => parse(k) + 9 * 3600e3;
const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && toKey(parse(k)) === k;
const roundEgp = (c) => Math.round(c / 100) * 100;

// ---------- validation ----------
const str = (v, min, max, label) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw new UserError(`${label} must be ${min === max ? min : `${min} to ${max}`} characters`);
  return s;
};
const intIn = (v, min, max, label) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new UserError(`${label} must be a whole number from ${min} to ${max}`);
  return v;
};
const need = (user, roles) => { if (!roles.includes(user.role)) throw new PermError('You do not have permission to do this'); };
export const egp = (c) => c / 100;

// ---------- lease maths ----------
export const rentAt = (lease, i) => roundEgp(lease.rent * Math.pow(1 + lease.increasePct / 100, Math.floor(i / 12)));
export const leaseEnd = (start, months) => addDays(addMonths(start, months), -1);
export function leaseState(l, today) {
  if (l.status === 'terminated') return 'terminated';
  if (today < l.start) return 'upcoming';
  if (today > l.end) return 'expired';
  return 'active';
}
export const outstanding = (c) => (c.voided ? 0 : Math.max(0, c.amount - c.paid));
export function leaseCharges(s, id) { return s.charges.filter((c) => c.leaseId === id); }
export function leaseBalance(s, id) { const l = s.leases.find((x) => x.id === id); return leaseCharges(s, id).reduce((a, c) => a + outstanding(c), 0) - (l ? l.credit : 0); }
const settings = (s) => ({ ...DEFAULTS, ...(s.settings || {}) });
const nextId = (s, p) => `${p}${++s.counters[p]}`;
const audit = (s, user, now, action, detail) => { s.audit.unshift({ ts: now, userId: user.id, name: user.name, action, detail: String(detail).slice(0, 200) }); if (s.audit.length > 300) s.audit.length = 300; };

function applyCredit(l, c) {
  const out = outstanding(c);
  if (l.credit > 0 && out > 0) { const u = Math.min(l.credit, out); c.paid += u; c.creditUsed = (c.creditUsed || 0) + u; l.credit -= u; }
}

// Bills every lease month that has become due and adds one late fee per unpaid charge once the grace period has passed.
// Safe to call repeatedly: it only adds what is missing.
export function normalize(s, now) {
  const today = dayKey(now), cfg = settings(s);
  for (const l of s.leases) {
    if (l.status === 'terminated' && !l.billedOnce) continue;
    const n = l.months;
    for (let i = 0; i < n; i++) {
      const due = addMonths(l.start, i);
      if (due > today || due > l.end) break;
      if (s.charges.some((c) => c.leaseId === l.id && c.idx === i && c.kind === 'rent')) continue;
      const feeDone = addDays(due, cfg.graceDays) < today;
      const rent = { id: nextId(s, 'c'), leaseId: l.id, kind: 'rent', idx: i, period: monthOf(due), due, amount: rentAt(l, i), paid: 0, feeDone };
      s.charges.push(rent); applyCredit(l, rent);
      if (l.serviceFee > 0) { const sv = { id: nextId(s, 'c'), leaseId: l.id, kind: 'service', idx: i, period: monthOf(due), due, amount: l.serviceFee, paid: 0, feeDone }; s.charges.push(sv); applyCredit(l, sv); }
    }
  }
  for (const c of [...s.charges]) {
    if ((c.kind !== 'rent' && c.kind !== 'service') || c.voided || c.feeDone) continue;
    if (addDays(c.due, cfg.graceDays) >= today) continue;
    c.feeDone = true;
    const unpaid = outstanding(c);
    if (unpaid <= 0 || cfg.lateFeePct <= 0) continue;
    const l = s.leases.find((x) => x.id === c.leaseId);
    const fee = { id: nextId(s, 'c'), leaseId: c.leaseId, kind: 'late', period: c.period, due: addDays(c.due, cfg.graceDays + 1), amount: Math.round((c.amount * cfg.lateFeePct) / 100), paid: 0, lateOf: c.id, feeDone: true };
    s.charges.push(fee); if (l) applyCredit(l, fee);
  }
  return s;
}

// ---------- payments ----------
function postPayment(s, p) {
  const l = s.leases.find((x) => x.id === p.leaseId);
  const open = leaseCharges(s, l.id).filter((c) => outstanding(c) > 0).sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  let left = p.amount; const allocs = [];
  for (const c of open) { if (left <= 0) break; const a = Math.min(left, outstanding(c)); c.paid += a; left -= a; allocs.push({ chargeId: c.id, amount: a }); }
  if (left > 0) l.credit += left;
  const pay = { id: nextId(s, 'p'), no: 'R-' + String(++s.counters.receipt).padStart(5, '0'), leaseId: l.id, unitId: l.unitId, tenantId: l.tenantId, ts: p.ts, date: p.date, amount: p.amount, method: p.method, ref: p.ref || '', allocs, credit: left, by: p.by, voided: false };
  s.payments.push(pay);
  return pay;
}

function recordPayment(s, op, ctx) {
  need(ctx.user, ['owner', 'manager', 'accountant']);
  const l = s.leases.find((x) => x.id === op.leaseId); if (!l) throw new UserError('Lease not found');
  const today = dayKey(ctx.now), cfg = settings(s);
  const amount = intIn(op.amount, 1, 100000000, 'Amount');
  if (!METHODS.includes(op.method)) throw new UserError('Choose a payment method');
  const date = op.date ? op.date : today;
  if (!isKey(date) || date > today || diffDays(date, today) > cfg.backdateDays) throw new UserError(`Payment date must be today or up to ${cfg.backdateDays} days back`);
  const ref = op.ref ? str(op.ref, 1, 40, 'Reference') : '';
  if ((op.method === 'cheque' || op.method === 'transfer' || op.method === 'instapay') && !ref) throw new UserError('Enter the cheque number or transfer reference');
  const pay = postPayment(s, { leaseId: l.id, amount, method: op.method, ref, date, ts: ctx.now, by: ctx.user.name });
  audit(s, ctx.user, ctx.now, 'payment', `${pay.no} ${egp(amount)} EGP ${op.method} lease ${l.id}`);
  return { paymentId: pay.id, no: pay.no, credit: pay.credit };
}

function voidPayment(s, op, ctx) {
  need(ctx.user, ['owner', 'accountant']);
  const p = s.payments.find((x) => x.id === op.paymentId); if (!p) throw new UserError('Payment not found');
  if (p.voided) throw new UserError('Payment is already voided');
  if (p.method === 'deposit') throw new UserError('Deposit settlements cannot be voided');
  if (dayKey(p.ts) !== dayKey(ctx.now)) throw new UserError('Only payments taken today can be voided');
  const latest = s.payments.filter((x) => x.leaseId === p.leaseId && !x.voided).at(-1);
  if (latest.id !== p.id) throw new UserError('Only the latest payment of a lease can be voided');
  const l = s.leases.find((x) => x.id === p.leaseId);
  if (l.credit < p.credit) throw new UserError('Credit from this payment was already applied to a newer charge');
  for (const a of p.allocs) { const c = s.charges.find((x) => x.id === a.chargeId); c.paid -= a.amount; }
  l.credit -= p.credit; p.voided = true;
  audit(s, ctx.user, ctx.now, 'void', `${p.no} ${egp(p.amount)} EGP`);
  return {};
}

// ---------- leases ----------
const overlaps = (a0, a1, b0, b1) => a0 <= b1 && a1 >= b0;
function unitFree(s, unitId, start, end, ignoreId) {
  return !s.leases.some((l) => l.id !== ignoreId && l.unitId === unitId && l.status !== 'terminated' && overlaps(start, end, l.start, l.end));
}
function newLease(s, o) {
  const id = nextId(s, 'l');
  const l = { id, unitId: o.unitId, tenantId: o.tenantId, start: o.start, months: o.months, end: leaseEnd(o.start, o.months), rent: o.rent, increasePct: o.increasePct, serviceFee: o.serviceFee, deposit: o.deposit, depositStatus: 'held', credit: 0, status: 'signed', renewedFrom: o.renewedFrom || null, reminders: [], settlement: null };
  s.leases.push(l); return l;
}
function rememberKey(s, key) {
  if (!key) return false;
  if (s.keys.includes(key)) return true;
  s.keys.push(key); if (s.keys.length > 200) s.keys.shift(); return false;
}
const cleanPhone = (p) => { const d = String(p || '').replace(/[\s\-()]/g, ''); if (!/^\+?\d{8,15}$/.test(d)) throw new UserError('Phone must be 8 to 15 digits'); return d; };

function addLease(s, op, ctx) {
  need(ctx.user, ['owner', 'manager']);
  const today = dayKey(ctx.now), cfg = settings(s);
  const unit = s.units.find((u) => u.id === op.unitId); if (!unit) throw new UserError('Unit not found');
  if (!isKey(op.start)) throw new UserError('Enter a start date');
  if (diffDays(op.start, today) > 30) throw new UserError('Start date cannot be more than 30 days in the past');
  if (diffDays(today, op.start) > 120) throw new UserError('Start date cannot be more than 120 days ahead');
  const months = intIn(op.months, 1, 60, 'Months');
  const rent = intIn(op.rent, 100000, 100000000, 'Monthly rent');
  const deposit = intIn(op.deposit ?? 0, 0, 300000000, 'Deposit');
  if (deposit > rent * cfg.maxDepositMonths) throw new UserError(`Deposit cannot be more than ${cfg.maxDepositMonths} months of rent`);
  const increasePct = intIn(op.increasePct ?? 0, 0, cfg.maxIncreasePct, 'Yearly increase');
  const serviceFee = intIn(op.serviceFee ?? 0, 0, 100000000, 'Service fee');
  const end = leaseEnd(op.start, months);
  if (!unitFree(s, unit.id, op.start, end)) throw new UserError('This unit already has a lease in that period');
  let tenantId = op.tenantId, nt = null;
  if (op.newTenant && typeof op.newTenant === 'object') nt = { name: str(op.newTenant.name, 2, 60, 'Tenant name'), nameAr: str(op.newTenant.nameAr || op.newTenant.name, 2, 60, 'Arabic name'), phone: cleanPhone(op.newTenant.phone) };
  else if (!s.tenants.some((t) => t.id === tenantId)) throw new UserError('Choose a tenant');
  if (rememberKey(s, op.key)) return { duplicate: true };
  if (nt) { const t = { id: nextId(s, 't'), ...nt, since: today }; s.tenants.push(t); tenantId = t.id; }
  const l = newLease(s, { unitId: unit.id, tenantId, start: op.start, months, rent, deposit, increasePct, serviceFee });
  audit(s, ctx.user, ctx.now, 'lease', `${l.id} unit ${unit.code} ${egp(rent)} EGP x ${months}`);
  return { leaseId: l.id };
}

function renewLease(s, op, ctx) {
  need(ctx.user, ['owner', 'manager']);
  const today = dayKey(ctx.now), cfg = settings(s);
  const l = s.leases.find((x) => x.id === op.leaseId); if (!l) throw new UserError('Lease not found');
  const st = leaseState(l, today);
  if (st === 'terminated' || st === 'upcoming') throw new UserError('Only an active or just-expired lease can be renewed');
  if (st === 'expired' && diffDays(l.end, today) > 30) throw new UserError('This lease ended more than 30 days ago. Create a new lease instead');
  if (diffDays(today, l.end) > 60) throw new UserError('Renewal opens 60 days before the lease ends');
  if (s.leases.some((x) => x.renewedFrom === l.id && x.status !== 'terminated')) throw new UserError('This lease is already renewed');
  const months = intIn(op.months, 1, 60, 'Months');
  const pct = intIn(op.increasePct, 0, cfg.maxIncreasePct, 'Increase');
  if (rememberKey(s, op.key)) return { duplicate: true };
  const start = addDays(l.end, 1);
  const rent = roundEgp(rentAt(l, l.months - 1) * (1 + pct / 100));
  const n = newLease(s, { unitId: l.unitId, tenantId: l.tenantId, start, months, rent, deposit: l.deposit, increasePct: l.increasePct, serviceFee: l.serviceFee, renewedFrom: l.id });
  if (l.depositStatus === 'held') l.depositStatus = 'transferred';
  audit(s, ctx.user, ctx.now, 'renew', `${l.id} -> ${n.id} ${egp(rent)} EGP`);
  return { leaseId: n.id, rent };
}

function cancelRenewal(s, op, ctx) {
  need(ctx.user, ['owner', 'manager']);
  const today = dayKey(ctx.now);
  const n = s.leases.find((x) => x.id === op.leaseId); if (!n || !n.renewedFrom) throw new UserError('Renewal not found');
  if (leaseState(n, today) !== 'upcoming') throw new UserError('Only a renewal that has not started can be cancelled');
  const old = s.leases.find((x) => x.id === n.renewedFrom);
  s.leases = s.leases.filter((x) => x.id !== n.id);
  if (old && old.depositStatus === 'transferred') old.depositStatus = 'held';
  audit(s, ctx.user, ctx.now, 'cancel-renewal', n.id);
  return {};
}

function terminate(s, op, ctx) {
  need(ctx.user, ['owner', 'manager']);
  const today = dayKey(ctx.now);
  const l = s.leases.find((x) => x.id === op.leaseId); if (!l) throw new UserError('Lease not found');
  const st = leaseState(l, today);
  if (st !== 'active' && st !== 'expired') throw new UserError('Only an active or expired lease can be ended');
  if (s.leases.some((x) => x.renewedFrom === l.id && x.status !== 'terminated')) throw new UserError('Cancel the renewal first');
  if (!isKey(op.date) || op.date < l.start || op.date > addDays(today, 30)) throw new UserError('Move-out date must be inside the lease and within 30 days from today');
  if (op.date > l.end) throw new UserError('Move-out date is after the lease end');
  if (l.depositStatus !== 'held') throw new UserError('The deposit was already settled or moved to a renewal');
  const ded = Array.isArray(op.deductions) ? op.deductions : [];
  if (ded.length > 5) throw new UserError('At most 5 deductions');
  const deductions = ded.map((d) => ({ reason: str(d.reason, 2, 60, 'Deduction reason'), amount: intIn(d.amount, 1, 300000000, 'Deduction') }));
  const dedTotal = deductions.reduce((a, d) => a + d.amount, 0);
  if (dedTotal > l.deposit) throw new UserError('Deductions cannot be more than the deposit');
  const paidAfter = leaseCharges(s, l.id).find((c) => !c.voided && c.due > op.date && c.paid > 0);
  if (paidAfter) throw new UserError('A charge after the move-out date is already paid. Choose a later date');
  for (const c of leaseCharges(s, l.id)) if (!c.voided && c.due > op.date) c.voided = true;
  l.status = 'terminated'; l.end = op.date;
  let applied = 0;
  if (op.applyArrears) {
    const out = leaseCharges(s, l.id).reduce((a, c) => a + outstanding(c), 0);
    applied = Math.min(out, l.deposit - dedTotal);
    if (applied > 0) postPayment(s, { leaseId: l.id, amount: applied, method: 'deposit', ref: 'deposit', date: today, ts: ctx.now, by: ctx.user.name });
  }
  const creditBack = l.credit; l.credit = 0;
  l.depositStatus = 'settled';
  l.settlement = { date: op.date, deposit: l.deposit, deductions, appliedToArrears: applied, creditRefund: creditBack, refund: l.deposit - dedTotal - applied + creditBack, remainingBalance: leaseCharges(s, l.id).reduce((a, c) => a + outstanding(c), 0) };
  audit(s, ctx.user, ctx.now, 'move-out', `${l.id} ${op.date} refund ${egp(l.settlement.refund)} EGP`);
  return { settlement: l.settlement };
}

function waiveFee(s, op, ctx) {
  need(ctx.user, ['owner', 'manager']);
  const c = s.charges.find((x) => x.id === op.chargeId); if (!c || c.kind !== 'late') throw new UserError('Only late fees can be waived');
  if (c.voided) throw new UserError('Already waived');
  if (c.paid > 0) throw new UserError('This fee is already paid or partly paid');
  const reason = str(op.reason, 3, 80, 'Reason');
  c.voided = true; c.waivedReason = reason;
  audit(s, ctx.user, ctx.now, 'waive', `${c.id} ${egp(c.amount)} EGP: ${reason}`);
  return {};
}

function addCharge(s, op, ctx) {
  need(ctx.user, ['owner', 'manager']);
  const l = s.leases.find((x) => x.id === op.leaseId); if (!l) throw new UserError('Lease not found');
  if (leaseState(l, dayKey(ctx.now)) === 'upcoming') throw new UserError('The lease has not started');
  const amount = intIn(op.amount, 100, 10000000, 'Amount'), note = str(op.note, 3, 80, 'Note');
  if (rememberKey(s, op.key)) return { duplicate: true };
  const today = dayKey(ctx.now);
  const c = { id: nextId(s, 'c'), leaseId: l.id, kind: 'other', period: monthOf(today), due: today, amount, paid: 0, note, feeDone: true };
  s.charges.push(c); applyCredit(l, c);
  audit(s, ctx.user, ctx.now, 'charge', `${l.id} ${egp(amount)} EGP ${note}`);
  return { chargeId: c.id };
}

function logReminder(s, op, ctx) {
  need(ctx.user, ['owner', 'manager', 'accountant']);
  const l = s.leases.find((x) => x.id === op.leaseId); if (!l) throw new UserError('Lease not found');
  l.reminders.push({ ts: ctx.now, by: ctx.user.name, channel: 'whatsapp' }); if (l.reminders.length > 10) l.reminders.shift();
  audit(s, ctx.user, ctx.now, 'reminder', `lease ${l.id}`);
  return {};
}

// ---------- maintenance ----------
function tenantUnits(s, tenantId, today) {
  return s.leases.filter((l) => l.tenantId === tenantId && leaseState(l, today) === 'active').map((l) => l.unitId);
}
function submitRequest(s, op, ctx) {
  const today = dayKey(ctx.now);
  let unitId = op.unitId, tenantId = null;
  if (ctx.user.role === 'tenant') {
    const mine = tenantUnits(s, ctx.user.tenantId, today);
    if (!mine.length) throw new UserError('You have no active lease');
    unitId = mine.includes(unitId) ? unitId : mine[0]; tenantId = ctx.user.tenantId;
  } else {
    need(ctx.user, ['owner', 'manager']);
    const l = s.leases.find((x) => x.unitId === unitId && leaseState(x, today) === 'active'); tenantId = l ? l.tenantId : null;
  }
  if (!s.units.some((u) => u.id === unitId)) throw new UserError('Unit not found');
  const title = str(op.title, 3, 80, 'Title'), desc = op.desc ? str(op.desc, 1, 500, 'Description') : '';
  if (!['low', 'normal', 'urgent'].includes(op.priority)) throw new UserError('Choose a priority');
  if (s.requests.filter((r) => r.tenantId === tenantId && tenantId && (r.status === 'open' || r.status === 'assigned')).length >= 5) throw new UserError('You already have 5 open requests');
  if (rememberKey(s, op.key)) return { duplicate: true };
  const r = { id: nextId(s, 'r'), unitId, tenantId, title, desc, priority: op.priority, status: 'open', vendor: '', estimate: 0, cost: 0, chargedTo: null, created: ctx.now, done: null };
  s.requests.push(r); audit(s, ctx.user, ctx.now, 'request', `${r.id} unit ${unitId} ${title}`);
  return { requestId: r.id };
}
function assignRequest(s, op, ctx) {
  need(ctx.user, ['owner', 'manager']);
  const r = s.requests.find((x) => x.id === op.id); if (!r) throw new UserError('Request not found');
  if (r.status !== 'open' && r.status !== 'assigned') throw new UserError('This request is closed');
  r.vendor = str(op.vendor, 2, 60, 'Vendor'); r.estimate = intIn(op.estimate ?? 0, 0, 100000000, 'Estimate'); r.status = 'assigned';
  audit(s, ctx.user, ctx.now, 'assign', `${r.id} ${r.vendor}`); return {};
}
function completeRequest(s, op, ctx) {
  need(ctx.user, ['owner', 'manager']);
  const r = s.requests.find((x) => x.id === op.id); if (!r) throw new UserError('Request not found');
  if (r.status !== 'assigned') throw new UserError('Assign a vendor first');
  const cost = intIn(op.cost, 0, 100000000, 'Cost');
  if (ctx.user.role === 'manager' && cost > settings(s).managerRepairLimit) throw new UserError(`Repairs above ${egp(settings(s).managerRepairLimit)} EGP need the owner`);
  const chargedTo = op.chargedTo === 'tenant' ? 'tenant' : 'owner';
  let charge = null;
  if (chargedTo === 'tenant') {
    if (cost <= 0) throw new UserError('Enter the cost to charge the tenant');
    const l = s.leases.find((x) => x.unitId === r.unitId && leaseState(x, dayKey(ctx.now)) === 'active');
    if (!l) throw new UserError('No active lease on this unit to charge');
    charge = { id: nextId(s, 'c'), leaseId: l.id, kind: 'repair', period: monthOf(dayKey(ctx.now)), due: dayKey(ctx.now), amount: cost, paid: 0, note: r.title, feeDone: true, requestId: r.id };
    s.charges.push(charge); applyCredit(l, charge);
  }
  r.cost = cost; r.chargedTo = chargedTo; r.status = 'done'; r.done = ctx.now;
  audit(s, ctx.user, ctx.now, 'repair-done', `${r.id} ${egp(cost)} EGP to ${chargedTo}`);
  return { chargeId: charge?.id || null };
}
function cancelRequest(s, op, ctx) {
  const r = s.requests.find((x) => x.id === op.id); if (!r) throw new UserError('Request not found');
  if (ctx.user.role === 'tenant') { if (r.tenantId !== ctx.user.tenantId) throw new PermError('You do not have permission to do this'); } else need(ctx.user, ['owner', 'manager']);
  if (r.status !== 'open' && r.status !== 'assigned') throw new UserError('This request is closed');
  r.status = 'cancelled'; audit(s, ctx.user, ctx.now, 'request-cancel', r.id); return {};
}

const OPS = { recordPayment, voidPayment, addLease, renewLease, cancelRenewal, terminate, waiveFee, addCharge, logReminder, submitRequest, assignRequest, completeRequest, cancelRequest };
export function applyOp(s, op, ctx) {
  const fn = op && typeof op === 'object' ? OPS[op.type] : null;
  if (!fn || !Object.prototype.hasOwnProperty.call(OPS, op.type)) throw new UserError('Unknown action');
  if (typeof op.key === 'string' && s.keys.includes(op.key)) return { duplicate: true };
  return fn(s, op, ctx);
}

// ---------- reports ----------
export function aging(s, today) {
  const rows = [];
  for (const l of s.leases) {
    const open = leaseCharges(s, l.id).filter((c) => outstanding(c) > 0 && c.due <= today);
    const total = open.reduce((a, c) => a + outstanding(c), 0);
    if (total <= 0) continue;
    const b = { d30: 0, d60: 0, d90: 0, d90p: 0 };
    let oldest = 0;
    for (const c of open) { const d = diffDays(c.due, today); oldest = Math.max(oldest, d); const k = d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'd90p'; b[k] += outstanding(c); }
    rows.push({ leaseId: l.id, unitId: l.unitId, tenantId: l.tenantId, total, credit: l.credit, oldestDays: oldest, ...b });
  }
  return rows.sort((a, b) => b.oldestDays - a.oldestDays || b.total - a.total);
}

export function reports(s, now) {
  const today = dayKey(now), cfg = settings(s), month = monthOf(today);
  const live = s.leases.filter((l) => leaseState(l, today) === 'active');
  const unitsLeased = new Set(live.map((l) => l.unitId));
  const billable = s.charges.filter((c) => !c.voided && (c.kind === 'rent' || c.kind === 'service'));
  const billedMonth = billable.filter((c) => c.period === month).reduce((a, c) => a + c.amount, 0);
  const paidOfBilled = billable.filter((c) => c.period === month).reduce((a, c) => a + Math.min(c.paid, c.amount), 0);
  const pays = s.payments.filter((p) => !p.voided && p.method !== 'deposit');
  const collected = (m) => pays.filter((p) => monthOf(p.date) === m).reduce((a, p) => a + p.amount, 0);
  const months = [];
  for (let i = 5; i >= 0; i--) { const m = monthOf(addMonths(today.slice(0, 8) + '01', -i)); months.push({ month: m, billed: billable.filter((c) => c.period === m).reduce((a, c) => a + c.amount, 0), collected: collected(m) }); }
  const ag = aging(s, today);
  const arrears = ag.reduce((a, r) => a + r.total, 0);
  const vacant = s.units.filter((u) => !unitsLeased.has(u.id));
  const repairCost = s.requests.filter((r) => r.status === 'done' && r.chargedTo === 'owner' && dayKey(r.done) >= month + '-01').reduce((a, r) => a + r.cost, 0);
  const expiring = live.filter((l) => diffDays(today, l.end) <= 60 && !s.leases.some((x) => x.renewedFrom === l.id && x.status !== 'terminated'))
    .map((l) => { const cur = rentAt(l, l.months - 1); const pct = l.increasePct || cfg.renewalPct; return { leaseId: l.id, unitId: l.unitId, tenantId: l.tenantId, end: l.end, daysLeft: diffDays(today, l.end), currentRent: cur, proposedPct: pct, proposedRent: roundEgp(cur * (1 + pct / 100)) }; })
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const holdover = s.leases.filter((l) => leaseState(l, today) === 'expired' && !s.leases.some((x) => x.renewedFrom === l.id && x.status !== 'terminated')).map((l) => l.id);
  const byProperty = s.properties.map((p) => {
    const us = s.units.filter((u) => u.propertyId === p.id), ids = new Set(us.map((u) => u.id));
    const ls = live.filter((l) => ids.has(l.unitId));
    const ch = billable.filter((c) => c.period === month && ids.has(s.leases.find((l) => l.id === c.leaseId)?.unitId));
    const pc = pays.filter((x) => monthOf(x.date) === month && ids.has(x.unitId)).reduce((a, x) => a + x.amount, 0);
    const arr = ag.filter((r) => ids.has(r.unitId)).reduce((a, r) => a + r.total, 0);
    return { propertyId: p.id, units: us.length, leased: ls.length, billed: ch.reduce((a, c) => a + c.amount, 0), collected: pc, arrears: arr };
  });
  return {
    today, month, billedMonth, paidOfBilled, collectedMonth: collected(month), collectionRate: billedMonth ? paidOfBilled / billedMonth : 1,
    occupancy: s.units.length ? live.length / s.units.length : 0, unitsTotal: s.units.length, unitsLeased: unitsLeased.size,
    vacantLoss: vacant.reduce((a, u) => a + u.listRent, 0), vacant: vacant.map((u) => u.id),
    arrears, aging: ag, months, expiring, holdover, byProperty, repairCost, netMonth: collected(month) - repairCost,
    openRequests: s.requests.filter((r) => r.status === 'open' || r.status === 'assigned').length,
    activeLeases: live.length, depositsHeld: s.leases.filter((l) => l.depositStatus === 'held' && l.status !== 'terminated').reduce((a, l) => a + l.deposit, 0),
  };
}

export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = (rows) => '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

// ---------- what each user may see ----------
export function view(s, user, now) {
  const today = dayKey(now);
  const decorate = (l) => ({ ...l, state: leaseState(l, today), balance: leaseBalance(s, l.id), currentRent: rentAt(l, Math.min(l.months - 1, Math.max(0, diffDays(l.start, today) >= 0 ? monthsBetween(l.start, today) : 0))) });
  const base = { me: { id: user.id, name: user.name, nameAr: user.nameAr, role: user.role, tenantId: user.tenantId || null }, now, today, settings: settings(s), company: s.company, resetAt: s.resetAt };
  if (user.role === 'tenant') {
    const ls = s.leases.filter((l) => l.tenantId === user.tenantId).map(decorate);
    const ids = new Set(ls.map((l) => l.id)), uids = new Set(ls.map((l) => l.unitId));
    const units = s.units.filter((u) => uids.has(u.id));
    return { ...base, tenants: s.tenants.filter((t) => t.id === user.tenantId), leases: ls, units, properties: s.properties.filter((p) => units.some((u) => u.propertyId === p.id)),
      charges: s.charges.filter((c) => ids.has(c.leaseId) && !c.voided), payments: s.payments.filter((p) => ids.has(p.leaseId) && !p.voided).map(({ by, ...p }) => p),
      requests: s.requests.filter((r) => r.tenantId === user.tenantId).map(({ vendor, estimate, ...r }) => ({ ...r, vendor: '' })) };
  }
  const out = { ...base, properties: s.properties, units: s.units, tenants: s.tenants, leases: s.leases.map(decorate), charges: s.charges, payments: s.payments, requests: s.requests, reports: reports(s, now) };
  if (user.role === 'owner') out.audit = s.audit;
  return out;
}
export function monthsBetween(start, today) {
  const [y1, m1, d1] = start.split('-').map(Number), [y2, m2, d2] = today.split('-').map(Number);
  let m = (y2 - y1) * 12 + (m2 - m1); if (d2 < d1) m--; return Math.max(0, m);
}

// ---------- demo data ----------
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PEOPLE = [
  ['Karim Fathy', 'كريم فتحي'], ['Mona Adel', 'منى عادل'], ['Tamer Saleh', 'تامر صالح'], ['Nour El-Din Hassan', 'نور الدين حسن'], ['Heba Mostafa', 'هبة مصطفى'], ['Omar Zaki', 'عمر زكي'],
  ['Salma Ragab', 'سلمى رجب'], ['Youssef Nabil', 'يوسف نبيل'], ['Dina Samir', 'دينا سمير'], ['Ahmed Lotfy', 'أحمد لطفي'], ['Reem Farouk', 'ريم فاروق'], ['Mahmoud Ezzat', 'محمود عزت'],
  ['Laila Hegazy', 'ليلى حجازي'], ['Hany Shawky', 'هاني شوقي'], ['Yasmin Tarek', 'ياسمين طارق'], ['Sherif Anwar', 'شريف أنور'], ['Aya Mansour', 'آية منصور'], ['Walid Gaber', 'وليد جابر'],
  ['Nadine Fouad', 'نادين فؤاد'], ['Khaled Abbas', 'خالد عباس'], ['Rasha Diab', 'رشا دياب'], ['Mina Gerges', 'مينا جرجس'], ['Fatma Sayed', 'فاطمة سيد'], ['Sameh Wagdy', 'سامح وجدي'],
];
export function seed(now = Date.now()) {
  const R = rng(20260);
  const today = dayKey(now);
  const s = {
    resetAt: now, counters: { c: 0, p: 0, l: 0, t: 0, r: 0, receipt: 0 }, keys: [], audit: [], settings: { ...DEFAULTS },
    company: { name: 'Al Amal Property Management', nameAr: 'الأمل لإدارة العقارات' },
    users: [
      { id: 'u-owner', pin: '1111', name: 'Hossam Barakat', nameAr: 'حسام بركات', role: 'owner' },
      { id: 'u-mgr', pin: '2222', name: 'Rana Idris', nameAr: 'رنا إدريس', role: 'manager' },
      { id: 'u-acc', pin: '3333', name: 'Wael Fekry', nameAr: 'وائل فكري', role: 'accountant' },
      { id: 'u-ten', pin: '4444', name: 'Karim Fathy', nameAr: 'كريم فتحي', role: 'tenant', tenantId: 't1' },
    ],
    properties: [
      { id: 'pr1', name: 'Nile View Residence', nameAr: 'نايل فيو ريزيدنس', area: 'Maadi, Cairo', areaAr: 'المعادي، القاهرة', kind: 'residential' },
      { id: 'pr2', name: 'Zahraa Tower', nameAr: 'برج الزهراء', area: 'Nasr City, Cairo', areaAr: 'مدينة نصر، القاهرة', kind: 'residential' },
      { id: 'pr3', name: 'Heliopolis Arcade', nameAr: 'أركيد مصر الجديدة', area: 'Heliopolis, Cairo', areaAr: 'مصر الجديدة، القاهرة', kind: 'commercial' },
    ],
    units: [], tenants: [], leases: [], charges: [], payments: [], requests: [],
  };
  const addUnit = (propertyId, code, type, floor, rooms, m2, listRent) => s.units.push({ id: 'un' + (s.units.length + 1), propertyId, code, type, floor, rooms, m2, listRent });
  const rentsA = [6500, 7200, 8500, 9800, 11000, 12500];
  for (let i = 0; i < 12; i++) addUnit('pr1', `${Math.floor(i / 3) + 1}0${(i % 3) + 1}`, 'apartment', Math.floor(i / 3) + 1, 2 + (i % 3 === 2 ? 1 : 0), 95 + (i % 3) * 20, rentsA[i % 6] * 100);
  for (let i = 0; i < 10; i++) addUnit('pr2', `${Math.floor(i / 2) + 1}${i % 2 ? 'B' : 'A'}`, 'apartment', Math.floor(i / 2) + 1, 2 + (i % 2), 85 + (i % 2) * 25, (4500 + (i % 5) * 1100 + (i % 2) * 800) * 100);
  const shop = [[18000, 55], [24000, 70], [15500, 45], [30000, 90], [21000, 60], [12500, 40], [27500, 80], [19000, 50]];
  for (let i = 0; i < 8; i++) addUnit('pr3', `S-${i + 1}`, i === 7 ? 'office' : 'shop', 0, 0, shop[i][1], shop[i][0] * 100);
  // 24 leases; a few units stay vacant. [unitIndex, monthsAgoStarted, termMonths, behaviour]
  const plan = [
    [0, 10, 12, 'good'], [1, 7, 12, 'late'], [2, 3, 12, 'good'], [3, 11, 12, 'good'], [4, 5, 12, 'arrears'], [5, 9, 12, 'good'], [6, 14, 24, 'good'], [7, 2, 12, 'good'], [8, 8, 12, 'late'], [9, 6, 12, 'good'], [10, 4, 6, 'good'],
    [12, 10, 12, 'good'], [13, 7, 12, 'late'], [14, 11, 12, 'good'], [15, 4, 12, 'good'], [16, 1, 12, 'good'], [17, 9, 12, 'arrears'], [18, 5, 12, 'good'], [19, 11, 12, 'late'],
    [22, 11, 12, 'good'], [23, 8, 12, 'good'], [24, 6, 12, 'late'], [25, 3, 12, 'good'], [26, 10, 12, 'good'], [27, 7, 12, 'good'], [28, 9, 12, 'arrears'],
  ];
  const tenantFor = (i) => { const [en, ar] = PEOPLE[i % PEOPLE.length]; return { id: 't' + (i + 1), name: en, nameAr: ar, phone: '+2010' + String(10000000 + Math.floor(R() * 89999999)), since: today }; };
  const planned = [];
  plan.forEach(([ui, ago, term, beh], i) => {
    const t = tenantFor(i); s.tenants.push(t); s.counters.t = i + 1;
    const u = s.units[ui];
    let start = addMonths(today, -ago); start = addDays(start, Math.floor(R() * 20) - 8);
    // keep one lease ending within a month so "expiring" has real examples
    if (i === 10) start = addDays(addMonths(today, -5), -4);
    if (i === 3) start = addDays(addMonths(today, -11), 12);
    const rent = roundEgp(u.listRent * (0.92 + R() * 0.1));
    const months = term;
    const l = newLease(s, { unitId: u.id, tenantId: t.id, start, months, rent, deposit: u.type === 'apartment' ? rent * 2 : rent * 3, increasePct: u.type === 'apartment' ? 10 : 8, serviceFee: u.type === 'apartment' ? 25000 + Math.floor(R() * 4) * 5000 : 0, });
    l.status = 'signed'; l.billedOnce = false;
    planned.push({ l, beh, delay: beh === 'good' ? [0, 2] : beh === 'late' ? [4, 12] : [0, 3] });
  });
  // one lease that ended 12 days ago and was not renewed (holdover)
  { const u = s.units[11], t = tenantFor(30); s.tenants.push(t); s.counters.t++;
    const l = newLease(s, { unitId: u.id, tenantId: t.id, start: addDays(addMonths(today, -12), -12), months: 12, rent: roundEgp(u.listRent * 0.95), deposit: u.listRent * 2, increasePct: 10, serviceFee: 25000 }); planned.push({ l, beh: 'good', delay: [0, 3] }); }
  // simulate day by day with the real billing and payment code so history is consistent
  const first = planned.reduce((m, p) => (p.l.start < m ? p.l.start : m), today);
  const plans = new Map(); const rngDelay = rng(77);
  const days = diffDays(first, today);
  for (let d = 0; d <= days; d++) {
    const day = addDays(first, d); const ts = Math.min(dayTs(day), now);
    normalize(s, ts);
    for (const { l, beh, delay } of planned) {
      if (l.start > day) continue;
      for (const c of s.charges) {
        if (c.leaseId !== l.id || c.kind !== 'rent' || outstanding(c) <= 0) continue;
        if (!plans.has(c.id)) plans.set(c.id, delay[0] + Math.floor(rngDelay() * (delay[1] - delay[0] + 1)));
        const payDay = addDays(c.due, plans.get(c.id));
        const recent = diffDays(c.due, today) < 75; // arrears tenants stop paying about two and a half months ago
        if (beh === 'arrears' && recent) continue;
        if (payDay !== day) continue;
        const tot = leaseCharges(s, l.id).filter((x) => outstanding(x) > 0 && x.due <= day).reduce((a, x) => a + outstanding(x), 0);
        const part = beh === 'late' && R() < 0.2 ? roundEgp(tot * 0.6) : tot;
        if (part > 0) postPayment(s, { leaseId: l.id, amount: part, method: METHODS[Math.floor(R() * 4)], ref: '', date: day, ts, by: 'Wael Fekry' });
      }
    }
  }
  for (const p of s.payments) if (p.method !== 'cash') p.ref = (p.method === 'cheque' ? 'CH-' : p.method === 'instapay' ? 'IP-' : 'TR-') + String(100000 + Math.floor(R() * 899999));
  // maintenance requests across statuses
  const TITLE_AR = { 'Kitchen tap is leaking': 'الحنفية في المطبخ بتنقط', 'Air conditioner not cooling': 'التكييف لا يبرّد', 'Hallway light is broken': 'إضاءة الممر معطلة', 'Water heater replaced': 'تم تغيير السخان', 'Door lock replaced after lost keys': 'تغيير كالون الباب بعد ضياع المفاتيح', 'Shutter motor not working': 'موتور الرول لا يعمل' };
  const mk = (unitId, title, priority, status, extra = {}) => {
    const l = s.leases.find((x) => x.unitId === unitId && leaseState(x, today) === 'active');
    s.requests.push({ id: nextId(s, 'r'), unitId, tenantId: l ? l.tenantId : null, title, desc: '', priority, status, vendor: '', estimate: 0, cost: 0, chargedTo: null, created: now - (extra.age || 3) * 864e5, done: null, titleAr: TITLE_AR[title] || '', ...extra });
  };
  mk('un1', 'Kitchen tap is leaking', 'normal', 'open', { desc: 'Dripping under the sink since Sunday.', age: 2 });
  mk('un2', 'Air conditioner not cooling', 'urgent', 'assigned', { vendor: 'Cool Zone Services', estimate: 120000, age: 4 });
  mk('un14', 'Hallway light is broken', 'low', 'open', { age: 6 });
  mk('un6', 'Water heater replaced', 'normal', 'done', { vendor: 'Bright Plumbing', estimate: 350000, cost: 340000, chargedTo: 'owner', done: now - 9 * 864e5, age: 14 });
  mk('un4', 'Door lock replaced after lost keys', 'normal', 'done', { vendor: 'Safe Lock', estimate: 60000, cost: 55000, chargedTo: 'tenant', done: now - 20 * 864e5, age: 24 });
  mk('un24', 'Shutter motor not working', 'urgent', 'assigned', { vendor: 'Metro Shutters', estimate: 480000, age: 3 });
  s.audit.length = 0;
  return s;
}
