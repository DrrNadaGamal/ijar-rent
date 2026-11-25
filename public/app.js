import * as L from './logic.js';
import { T } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('ij.' + k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem('ij.' + k, JSON.stringify(v)), del: (k) => localStorage.removeItem('ij.' + k) };
const rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const S = { lang: new URLSearchParams(location.search).get('lang') || LS.get('lang', 'en'), token: LS.get('token', null), me: LS.get('me', null), data: null, modal: null, busy: false, err: '', uq: '', uf: 'all', up: 'all', lq: '', lf: 'all', pq: '', mo: { ded: 0 } };
if (!T[S.lang]) S.lang = 'en';
const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
const t = (k) => get(T[S.lang], k) ?? get(T.en, k) ?? k;
const ar = () => S.lang === 'ar';
const nf = (n, d = 0) => Number(n).toLocaleString(ar() ? 'ar-EG' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (c) => `${nf(c / 100, c % 100 ? 2 : 0)} ${t('cur')}`;
const pct = (x) => nf(Math.round(x * 100)) + '%';
const dt = (k) => (k ? new Date(k + 'T00:00:00Z').toLocaleDateString(ar() ? 'ar-EG' : 'en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '');
const mon = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString(ar() ? 'ar-EG' : 'en-GB', { timeZone: 'UTC', month: 'short', year: '2-digit' });
const nm = (o) => (o ? (ar() ? o.nameAr || o.name : o.name) : '');
const D = () => S.data;
const me = () => S.data?.me || S.me;
const role = () => me()?.role;
const staff = () => role() !== 'tenant';
const canManage = () => role() === 'owner' || role() === 'manager';
const unitOf = (id) => D().units.find((u) => u.id === id);
const propOf = (id) => D().properties.find((p) => p.id === id);
const tenantOf = (id) => D().tenants.find((x) => x.id === id);
const leaseOf = (id) => D().leases.find((l) => l.id === id);
const unitLabel = (id) => { const u = unitOf(id); return u ? `${u.code} · ${nm(propOf(u.propertyId))}` : id; };
const val = (id) => $('#' + id)?.value ?? '';
const AR_DIG = '٠١٢٣٤٥٦٧٨٩';
const norm = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => AR_DIG.indexOf(d)).replace(/٫/g, '.').trim();
const toInt = (s) => { const n = Number(norm(s)); return Number.isFinite(n) && norm(s) !== '' ? n : NaN; };
const toCents = (s) => { const n = parseFloat(norm(s).replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
const toast = (m, bad) => { const el = $('#toast'); el.innerHTML = `<div class="${bad ? 'err' : ''}">${esc(m)}</div>`; clearTimeout(toast.h); toast.h = setTimeout(() => (el.innerHTML = ''), bad ? 5500 : 2600); };
const errText = (m) => { const d = T[S.lang].srv; if (d?.[m]) return d[m]; for (const [re, fn] of T[S.lang].srvRe || []) { const x = re.exec(m); if (x) return fn(...x.slice(1)); } return m; };

// ---------- network ----------
class NetError extends Error {}
async function call(method, body) {
  let r;
  try { r = await fetch('/api/data', { method, headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); } catch { throw new NetError('offline'); }
  let j = {}; try { j = await r.json(); } catch { if (r.status >= 500) throw new NetError('server'); }
  if (r.status === 401 && S.token) { logout(); throw new Error(j.error || t('again')); }
  if (r.status >= 500) throw new NetError('server');
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
async function act(op, okMsg) {
  if (S.busy) return null; S.busy = true;
  try { const j = await call('POST', { op }); const { result, ...v } = j; S.data = v; if (okMsg) toast(okMsg); return result || {}; }
  catch (e) { toast(e instanceof NetError ? t(e.message === 'offline' ? 'offline' : 'err.server') : errText(e.message), true); return null; }
  finally { S.busy = false; }
}
async function refresh() { try { S.data = await call('GET'); S.err = ''; } catch (e) { S.err = e instanceof NetError ? t('offline') : errText(e.message); } }
async function login(pin) {
  try { const j = await call('POST', { op: { type: 'login', pin } }); S.token = j.token; S.me = j.me; LS.set('token', j.token); LS.set('me', j.me); S.err = ''; await refresh(); location.hash = j.me.role === 'tenant' ? '#/home' : '#/dashboard'; render(); }
  catch (e) { S.err = errText(e.message); render(); }
}
function logout() { S.token = null; S.me = null; S.data = null; LS.del('token'); LS.del('me'); S.modal = null; location.hash = ''; render(); }

// ---------- routing ----------
const route = () => (location.hash.replace(/^#\/?/, '') || (role() === 'tenant' ? 'home' : 'dashboard')).split('/')[0];
const NAV = {
  owner: ['dashboard', 'units', 'leases', 'payments', 'arrears', 'renewals', 'maintenance', 'reports', 'audit'],
  manager: ['dashboard', 'units', 'leases', 'payments', 'arrears', 'renewals', 'maintenance', 'reports'],
  accountant: ['dashboard', 'leases', 'payments', 'arrears', 'reports'],
  tenant: ['home', 'ledger', 'requests'],
};

// ---------- small views ----------
const pill = (cls, txt) => `<span class="pill ${cls}">${esc(txt)}</span>`;
const empty = (m) => `<p class="empty">${esc(m || t('none'))}</p>`;
const kpi = (n, l, cls = '', sub = '') => `<div class="card kpi ${cls}"><div class="n">${n}</div><div class="l">${esc(l)}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
const field = (id, label, inner, hint) => `<div class="f"><label for="${id}">${esc(label)}</label>${inner}${hint ? `<small class="muted">${esc(hint)}</small>` : ''}</div>`;
const LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#16253f"/><path d="M10 22 24 10l14 12v16H28V28h-8v10H10z" fill="#f0aa46"/></svg>';
const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const meter = (x, cls = '') => `<div class="meter ${cls}"><i style="width:${Math.max(0, Math.min(100, Math.round(x * 100)))}%"></i></div>`;
const downloadCsv = (name, rows) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.toCsv(rows)], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
const renewedBy = (l) => D().leases.find((x) => x.renewedFrom === l.id && x.state !== 'terminated');
function leaseTag(l) {
  const today = D().today;
  if (l.state === 'active' && L.diffDays(today, l.end) <= 60 && !renewedBy(l)) return pill('off', `${t('ls.expiring')} · ${nf(L.diffDays(today, l.end))} ${t('days')}`);
  if (l.state === 'expired') return pill('bad', t('ls.expired'));
  if (l.state === 'upcoming') return pill('ice', t('ls.upcoming'));
  if (l.state === 'terminated') return pill('gray', t('ls.terminated'));
  return pill('', t('ls.active'));
}
function chargeStatus(c) {
  if (c.voided) return pill('gray', t('ch.waived'));
  const out = L.outstanding(c);
  if (out === 0) return pill('', t('ch.paid'));
  if (c.due > D().today) return pill('gray', t('ch.upcoming'));
  return pill(c.paid > 0 ? 'off' : 'bad', c.paid > 0 ? t('ch.part') : t('ch.overdue'));
}
const chargeName = (c) => `${t('kind.' + c.kind)}${c.kind === 'rent' || c.kind === 'service' || c.kind === 'late' ? ' · ' + mon(c.period) : c.note ? ' · ' + c.note : ''}`;

function shell(inner) {
  const nav = NAV[role()] || []; const r = route(); const m = me();
  return `<header class="top noprint"><a class="brand" href="#/${nav[0]}">${LOGO}<span>${esc(t('appName'))}<small>${esc(nm(D().company) || t('appSub'))}</small></span></a>
  <nav class="nav" aria-label="main">${nav.map((k) => `<a href="#/${k}" class="${r === k ? 'on' : ''}">${esc(t('nav.' + k))}</a>`).join('')}</nav>
  <div class="tools"><span class="pill">${esc(nm(m))} · ${esc(t('role.' + m.role))}</span><button class="btn sm ghost" data-act="lang">${esc(t('other'))}</button><button class="btn sm ghost" data-act="logout">${esc(t('logout'))}</button></div></header>
  <main>${S.err ? `<div class="notice bad" role="alert">${esc(S.err)}</div>` : ''}${inner}<p class="muted small foot noprint">${esc(t('limits'))}${role() === 'owner' ? ` <button class="btn sm" data-act="reset">Reset demo data</button>` : ''}</p></main>`;
}

// ---------- pages ----------
function loginView() {
  return `<div class="login"><div class="logo">${LOGO}<div><h1>${esc(t('appName'))}</h1><p class="sub">${esc(t('appSub'))}</p></div></div>
  <div class="card"><h2>${esc(t('signin'))}</h2><p class="muted small">${esc(t('demoNote'))}</p>
  <div class="demo-users">${L.DEMO_USERS.map((u) => `<button class="btn" data-act="pin" data-pin="${u.pin}"><span>${esc(ar() ? u.labelAr : u.label)}</span><span class="pill gray" dir="ltr">${u.pin}</span></button>`).join('')}</div>
  <form id="pinform" class="row"><label for="pin" class="sr">${esc(t('pin'))}</label><input id="pin" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="${esc(t('pin'))}" dir="ltr"><button class="btn pri">${esc(t('signin'))}</button></form>
  ${S.err ? `<div class="notice bad" role="alert">${esc(S.err)}</div>` : ''}</div>
  <p class="foot"><button class="btn sm" data-act="lang">${esc(t('other'))}</button></p><p class="muted small foot">${esc(t('limits'))}</p></div>`;
}

const remindLink = (row) => {
  const ten = tenantOf(row.tenantId), u = unitOf(row.unitId); if (!ten) return '';
  const msg = T[S.lang].remindMsg(nm(ten), u.code, nf(row.total / 100), t('cur'));
  const done = leaseOf(row.leaseId)?.reminders?.length;
  return `<a class="btn sm" data-act="remind" data-id="${row.leaseId}" data-url="${esc('https://wa.me/' + String(ten.phone).replace(/\D/g, '') + '?text=' + encodeURIComponent(msg))}" href="#/arrears" rel="noopener">${esc(t(done ? 'b.reminded' : 'b.remind'))}${done ? ' · ' + nf(done) : ''}</a>`;
};

function twoBars(series) {
  const max = Math.max(1, ...series.flatMap((x) => [x.billed, x.collected]));
  return `<div class="bars2" role="img" aria-label="${esc(t('chartTitle'))}">${series.map((x) => `<div class="col2" title="${esc(mon(x.month))}: ${esc(money(x.billed))} / ${esc(money(x.collected))}"><div class="pair"><i class="b alt" style="height:${Math.max(1, Math.round((x.billed / max) * 100))}%"></i><i class="b" style="height:${Math.max(1, Math.round((x.collected / max) * 100))}%"></i></div><small>${esc(mon(x.month))}</small></div>`).join('')}</div>
  <div class="leg"><span><i class="alt"></i>${esc(t('billedL'))}</span><span><i></i>${esc(t('collectedL'))}</span></div>`;
}

function dashboard() {
  const d = D(), r = d.reports;
  const agTotal = r.aging.length;
  let h = `<div class="bar"><h1>${esc(t('nav.dashboard'))}</h1><span class="muted">${esc(dt(d.today))}</span></div>`;
  h += `<div class="grid kpis">
  ${kpi(money(r.collectedMonth), t('k.collected'), 'good', `${esc(t('k.of'))} ${money(r.billedMonth)} ${esc(t('k.billed'))} · ${pct(r.collectionRate)} ${esc(t('k.rate'))}`)}
  ${kpi(pct(r.occupancy), t('k.occupancy'), '', `${nf(r.unitsLeased)} / ${nf(r.unitsTotal)} ${esc(t('k.unitsLeased'))}`)}
  ${kpi(money(r.arrears), t('k.arrears'), r.arrears ? 'bad' : 'good', `${nf(agTotal)} ${esc(t('k.tenantsLate'))}`)}
  ${kpi(nf(r.expiring.length), t('k.renewals'), r.expiring.length ? 'warn' : 'good')}
  ${canManage() ? kpi(nf(r.openRequests), t('k.openReq'), r.openRequests ? 'warn' : 'good') : kpi(money(r.depositsHeld), t('k.deposits'))}
  ${kpi(money(r.netMonth), t('k.net'), '', `${esc(t('k.vacancy'))}: ${money(r.vacantLoss)}`)}</div>`;
  h += `<div class="grid two" style="margin-top:1rem"><div class="card"><h2>${esc(t('chartTitle'))}</h2>${twoBars(r.months)}</div>`;
  h += `<div class="card"><div class="bar"><h2>${esc(t('topArrears'))}</h2><span class="sp"></span><a class="btn sm" href="#/arrears">${esc(t('seeAll'))}</a></div>`;
  h += r.aging.length ? `<div class="tw"><table><thead><tr><th>${esc(t('tenant'))}</th><th>${esc(t('unit'))}</th><th class="num">${esc(t('balance'))}</th><th class="num">${esc(t('oldest'))}</th></tr></thead><tbody>${r.aging.slice(0, 5).map((x) => `<tr class="click" data-act="lease" data-id="${x.leaseId}"><td>${esc(nm(tenantOf(x.tenantId)))}</td><td>${esc(unitOf(x.unitId).code)}</td><td class="num">${money(x.total)}</td><td class="num">${pill(x.oldestDays > 30 ? 'bad' : 'off', x.oldestDays ? `${nf(x.oldestDays)} ${t('days')}` : t('today'))}</td></tr>`).join('')}</tbody></table></div>` : empty(t('allClear'));
  h += '</div></div>';
  h += `<div class="grid two" style="margin-top:1rem"><div class="card"><div class="bar"><h2>${esc(t('endingSoon'))}</h2><span class="sp"></span><a class="btn sm" href="#/renewals">${esc(t('seeAll'))}</a></div>`;
  h += r.expiring.length ? `<div class="tw"><table><thead><tr><th>${esc(t('tenant'))}</th><th>${esc(t('unit'))}</th><th>${esc(t('ends'))}</th><th class="num">${esc(t('proposed'))}</th></tr></thead><tbody>${r.expiring.slice(0, 5).map((x) => `<tr class="click" data-act="lease" data-id="${x.leaseId}"><td>${esc(nm(tenantOf(x.tenantId)))}</td><td>${esc(unitOf(x.unitId).code)}</td><td>${esc(dt(x.end))}</td><td class="num">${money(x.proposedRent)}</td></tr>`).join('')}</tbody></table></div>` : empty();
  h += `</div><div class="card"><h2>${esc(t('properties'))}</h2><div class="lines">${r.byProperty.map((p) => { const pr = propOf(p.propertyId); const rate = p.billed ? p.collected / p.billed : 1; return `<div><div class="mrow" style="border:0;padding:.2rem 0"><b>${esc(nm(pr))}</b><span class="muted small">${esc(ar() ? pr.areaAr : pr.area)}</span></div>${meter(p.units ? p.leased / p.units : 0, 'thick')}<div class="small muted" style="margin-top:.2rem">${nf(p.leased)} / ${nf(p.units)} ${esc(t('rep.occupied'))} · ${esc(t('rep.collectedM'))} ${money(p.collected)} · ${esc(t('k.arrears'))} ${money(p.arrears)}</div></div>`; }).join('')}</div></div></div>`;
  return h;
}

function unitStatus(u) {
  const ls = D().leases.filter((l) => l.unitId === u.id);
  const cur = ls.find((l) => l.state === 'active') || ls.find((l) => l.state === 'expired');
  const up = ls.find((l) => l.state === 'upcoming' && !l.renewedFrom);
  return { cur, up, lease: cur || null, ten: cur ? tenantOf(cur.tenantId) : null };
}
function unitsPage() {
  const d = D(), q = S.uq.trim().toLowerCase();
  let rows = d.units.map((u) => ({ u, ...unitStatus(u) }));
  rows = rows.filter(({ u, lease, ten }) => {
    if (S.up !== 'all' && u.propertyId !== S.up) return false;
    const exp = lease && lease.state === 'active' && L.diffDays(d.today, lease.end) <= 60 && !renewedBy(lease);
    if (S.uf === 'vacant' && lease?.state === 'active') return false;
    if (S.uf === 'active' && lease?.state !== 'active') return false;
    if (S.uf === 'expiring' && !exp) return false;
    if (S.uf === 'behind' && !(lease && lease.balance > 0)) return false;
    if (q && ![u.code, ten?.name, ten?.nameAr, ten?.phone].some((x) => String(x || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const chips = ['all', 'active', 'expiring', 'behind', 'vacant'].map((k) => `<button class="chip ${S.uf === k ? 'on' : ''}" data-act="uf" data-f="${k}">${esc(t('f.' + k))}</button>`).join('');
  let h = `<div class="bar"><h1>${esc(t('nav.units'))}</h1><span class="sp"></span>${sel('up', [['all', t('f.allProps')], ...d.properties.map((p) => [p.id, nm(p)])], S.up)}<input id="uq" type="search" placeholder="${esc(t('f.search'))}" value="${esc(S.uq)}" style="min-width:14rem"></div><div class="chips">${chips}</div>`;
  h += rows.length ? `<div class="grid unitgrid">${rows.map(({ u, lease, ten }) => {
    const act = lease?.state === 'active', exp = act && L.diffDays(d.today, lease.end) <= 60 && !renewedBy(lease), beh = lease && lease.balance > 0;
    return `<div class="card ucard ${!act ? 'vac' : beh ? 'beh' : exp ? 'exp' : ''}" data-act="${lease ? 'lease' : 'unitnew'}" data-id="${lease ? lease.id : u.id}" tabindex="0"><h3><span>${esc(u.code)}</span>${act ? leaseTag(lease) : lease ? leaseTag(lease) : pill('gray', t('vacant'))}</h3>
    <div class="muted small">${esc(nm(propOf(u.propertyId)))} · ${esc(t('ut.' + u.type))}${u.m2 ? ' · ' + nf(u.m2) + ' ' + esc(t('m2')) : ''}</div>
    ${lease ? `<p style="margin:.5rem 0 .2rem"><b>${esc(nm(ten))}</b></p><div class="small">${money(lease.currentRent)} ${esc(t('k.perMonth'))} · ${esc(t('ends'))} ${esc(dt(lease.end))}</div><div style="margin-top:.4rem">${lease.balance > 0 ? pill('bad', `${t('youOwe')} ${money(lease.balance)}`) : pill('', t('allPaid'))}</div>` : `<p style="margin:.5rem 0 .2rem">${esc(t('listRent'))}: <b>${money(u.listRent)}</b></p>${canManage() ? `<button class="btn sm pri" data-act="unitnew" data-id="${u.id}">${esc(t('b.newLease'))}</button>` : ''}`}</div>`;
  }).join('')}</div>` : empty();
  return h;
}

function leasesPage() {
  const d = D(), q = S.lq.trim().toLowerCase();
  let rows = d.leases.slice().sort((a, b) => b.start.localeCompare(a.start));
  rows = rows.filter((l) => {
    const ten = tenantOf(l.tenantId), u = unitOf(l.unitId);
    const exp = l.state === 'active' && L.diffDays(d.today, l.end) <= 60 && !renewedBy(l);
    if (S.lf === 'active' && l.state !== 'active') return false;
    if (S.lf === 'expiring' && !exp) return false;
    if (S.lf === 'expired' && l.state !== 'expired') return false;
    if (S.lf === 'upcoming' && l.state !== 'upcoming') return false;
    if (S.lf === 'behind' && !(l.balance > 0)) return false;
    return !q || [u.code, ten?.name, ten?.nameAr, ten?.phone].some((x) => String(x || '').toLowerCase().includes(q));
  });
  const chips = ['all', 'active', 'expiring', 'expired', 'upcoming', 'behind'].map((k) => `<button class="chip ${S.lf === k ? 'on' : ''}" data-act="lf" data-f="${k}">${esc(t('f.' + k))}</button>`).join('');
  let h = `<div class="bar"><h1>${esc(t('nav.leases'))}</h1><span class="sp"></span><input id="lq" type="search" placeholder="${esc(t('f.search'))}" value="${esc(S.lq)}" style="min-width:14rem">${canManage() ? `<button class="btn pri" data-act="unitnew" data-id="">${esc(t('b.newLease'))}</button>` : ''}</div><div class="chips">${chips}</div>`;
  h += !rows.length ? empty() : `<div class="tw"><table><thead><tr><th>${esc(t('tenant'))}</th><th>${esc(t('unit'))}</th><th>${esc(t('period'))}</th><th class="num">${esc(t('rent'))}</th><th>${esc(t('status'))}</th><th class="num">${esc(t('balance'))}</th></tr></thead><tbody id="lrows">${rows.map((l) => `<tr class="click" data-act="lease" data-id="${l.id}"><td><b>${esc(nm(tenantOf(l.tenantId)))}</b></td><td>${esc(unitLabel(l.unitId))}</td><td class="small">${esc(dt(l.start))} → ${esc(dt(l.end))}</td><td class="num">${money(l.currentRent)}</td><td>${leaseTag(l)}</td><td class="num">${l.balance > 0 ? `<span class="neg">${money(l.balance)}</span>` : l.balance < 0 ? pill('ice', money(-l.balance)) : '-'}</td></tr>`).join('')}</tbody></table></div>`;
  return h;
}

function payRows(list, full) {
  return `<div class="tw"><table><thead><tr><th>${esc(t('receipt'))}</th><th>${esc(t('date'))}</th><th>${esc(t('tenant'))}</th><th>${esc(t('unit'))}</th><th>${esc(t('method'))}</th><th class="num">${esc(t('amount'))}</th>${full ? `<th>${esc(t('by'))}</th><th></th>` : '<th></th>'}</tr></thead><tbody>${list.map((p) => {
    const l = leaseOf(p.leaseId); const latestToday = full && p === D().payments.filter((x) => x.leaseId === p.leaseId && !x.voided).at(-1) && L.dayKey(p.ts) === D().today && p.method !== 'deposit' && ['owner', 'accountant'].includes(role());
    return `<tr class="${p.voided ? 'void' : ''}"><td dir="ltr"><b>${esc(p.no)}</b></td><td>${esc(dt(p.date))}</td><td>${esc(nm(tenantOf(p.tenantId)))}</td><td>${esc(unitOf(p.unitId).code)}</td><td>${esc(t('pm.' + p.method))}${p.ref ? ` <span class="muted small" dir="ltr">${esc(p.ref)}</span>` : ''}</td><td class="num">${money(p.amount)}</td>${full ? `<td class="small">${esc(p.by)}</td>` : ''}<td class="acts1">${p.voided ? pill('gray', t('b.void')) : `<button class="btn sm" data-act="rcpt" data-id="${p.id}">${esc(t('b.receipt'))}</button>${latestToday ? `<button class="btn sm danger" data-act="void" data-id="${p.id}">${esc(t('b.void'))}</button>` : ''}`}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function paymentsPage() {
  const d = D(), q = S.pq.trim().toLowerCase();
  const list = d.payments.slice().reverse().filter((p) => !q || [p.no, p.ref, tenantOf(p.tenantId)?.name, tenantOf(p.tenantId)?.nameAr, unitOf(p.unitId)?.code].some((x) => String(x || '').toLowerCase().includes(q)));
  const month = d.payments.filter((p) => !p.voided && p.method !== 'deposit' && p.date.slice(0, 7) === d.today.slice(0, 7)).reduce((a, p) => a + p.amount, 0);
  return `<div class="bar"><h1>${esc(t('nav.payments'))}</h1><span class="muted">${esc(t('k.collected'))}: <b>${money(month)}</b></span><span class="sp"></span><input id="pq" type="search" placeholder="${esc(t('f.search'))}" value="${esc(S.pq)}"><button class="btn" data-act="csv" data-k="payments">${esc(t('b.csv'))}</button><button class="btn pri" data-act="pay" data-id="">${esc(t('b.record'))}</button></div><div id="prows">${list.length ? payRows(list.slice(0, 120), true) : empty()}</div>`;
}

function arrearsPage() {
  const r = D().reports;
  const tot = { d30: 0, d60: 0, d90: 0, d90p: 0 }; r.aging.forEach((x) => { for (const k in tot) tot[k] += x[k]; });
  let h = `<div class="bar"><h1>${esc(t('nav.arrears'))}</h1><span class="muted">${esc(t('total'))}: <b>${money(r.arrears)}</b></span><span class="sp"></span><button class="btn" data-act="csv" data-k="arrears">${esc(t('b.csv'))}</button></div>`;
  h += `<div class="grid kpis">${['d30', 'd60', 'd90', 'd90p'].map((k) => kpi(money(tot[k]), t(k), k === 'd30' ? '' : k === 'd60' ? 'warn' : 'bad')).join('')}</div><div class="tw" style="margin-top:1rem"><table><thead><tr><th>${esc(t('tenant'))}</th><th>${esc(t('unit'))}</th>${['d30', 'd60', 'd90', 'd90p'].map((k) => `<th class="num">${esc(t(k))}</th>`).join('')}<th class="num">${esc(t('total'))}</th><th></th></tr></thead><tbody>`;
  h += r.aging.map((x) => `<tr><td><a href="#/arrears" data-act="lease" data-id="${x.leaseId}"><b>${esc(nm(tenantOf(x.tenantId)))}</b></a></td><td>${esc(unitLabel(x.unitId))}</td>${['d30', 'd60', 'd90', 'd90p'].map((k) => `<td class="num">${x[k] ? money(x[k]) : '-'}</td>`).join('')}<td class="num"><b>${money(x.total)}</b></td><td class="acts1">${remindLink(x)}<button class="btn sm pri" data-act="pay" data-id="${x.leaseId}">${esc(t('b.record'))}</button></td></tr>`).join('');
  return h + `</tbody></table></div>`;
}

function renewalsPage() {
  const r = D().reports;
  let h = `<div class="bar"><h1>${esc(t('nav.renewals'))}</h1></div>`;
  h += !r.expiring.length ? empty() : `<div class="tw"><table><thead><tr><th>${esc(t('tenant'))}</th><th>${esc(t('unit'))}</th><th>${esc(t('ends'))}</th><th class="num">${esc(t('daysLeft'))}</th><th class="num">${esc(t('current'))}</th><th class="num">${esc(t('proposed'))}</th><th></th></tr></thead><tbody>${r.expiring.map((x) => `<tr><td><b>${esc(nm(tenantOf(x.tenantId)))}</b></td><td>${esc(unitLabel(x.unitId))}</td><td>${esc(dt(x.end))}</td><td class="num">${pill(x.daysLeft <= 30 ? 'bad' : 'off', nf(x.daysLeft))}</td><td class="num">${money(x.currentRent)}</td><td class="num">${money(x.proposedRent)} <span class="muted small">(+${nf(x.proposedPct)}%)</span></td><td class="acts1"><button class="btn sm" data-act="lease" data-id="${x.leaseId}">${esc(t('b.details'))}</button>${canManage() ? `<button class="btn sm pri" data-act="renew" data-id="${x.leaseId}">${esc(t('b.renew'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  if (r.holdover.length) h += `<div class="card" style="margin-top:1rem"><h2>${esc(t('holdover'))}</h2>${r.holdover.map((id) => { const l = leaseOf(id); return `<div class="mrow"><span><b>${esc(nm(tenantOf(l.tenantId)))}</b> · ${esc(unitLabel(l.unitId))} · ${esc(t('ends'))} ${esc(dt(l.end))}</span><span class="acts1">${canManage() ? `<button class="btn sm pri" data-act="renew" data-id="${l.id}">${esc(t('b.renew'))}</button><button class="btn sm" data-act="moveout" data-id="${l.id}">${esc(t('b.moveOut'))}</button>` : ''}</span></div>`; }).join('')}</div>`;
  const up = D().leases.filter((l) => l.renewedFrom && l.state === 'upcoming');
  if (up.length) h += `<div class="card" style="margin-top:1rem"><h2>${esc(t('renewalOf'))}</h2>${up.map((l) => `<div class="mrow"><span><b>${esc(nm(tenantOf(l.tenantId)))}</b> · ${esc(unitLabel(l.unitId))} · ${esc(dt(l.start))} → ${esc(dt(l.end))} · ${money(l.rent)}</span>${canManage() ? `<button class="btn sm danger" data-act="cancelrenew" data-id="${l.id}">${esc(t('b.cancelRenewal'))}</button>` : ''}</div>`).join('')}</div>`;
  return h;
}

function reqCard(r) {
  const u = unitOf(r.unitId), ten = tenantOf(r.tenantId);
  const acts = [];
  if (canManage()) {
    if (r.status === 'open') acts.push(`<button class="btn sm pri" data-act="assign" data-id="${r.id}">${esc(t('b.assign'))}</button>`);
    if (r.status === 'assigned') acts.push(`<button class="btn sm pri" data-act="complete" data-id="${r.id}">${esc(t('b.complete'))}</button>`);
  }
  if ((canManage() || role() === 'tenant') && (r.status === 'open' || r.status === 'assigned')) acts.push(`<button class="btn sm" data-act="cancelreq" data-id="${r.id}">${esc(t('b.cancel'))}</button>`);
  return `<div class="card req ${r.priority}"><div class="mc-h"><div><b>${esc(ar() && r.titleAr ? r.titleAr : r.title)}</b><div class="muted small">${esc(u.code)} · ${esc(nm(propOf(u.propertyId)))}${ten && staff() ? ' · ' + esc(nm(ten)) : ''}</div></div>${pill(r.priority === 'urgent' ? 'bad' : r.priority === 'normal' ? 'off' : 'gray', t('pr.' + r.priority))}</div>
  ${r.desc ? `<p class="small">${esc(r.desc)}</p>` : ''}
  ${r.vendor ? `<div class="small muted">${esc(t('vendor'))}: ${esc(r.vendor)}${r.estimate ? ` · ${esc(t('estimate'))} ${money(r.estimate)}` : ''}</div>` : ''}
  ${r.status === 'done' ? `<div class="small muted">${esc(t('cost'))}: ${money(r.cost)} · ${esc(r.chargedTo === 'tenant' ? t('h.tenantPays') : t('h.owner'))}</div>` : ''}
  <div class="small muted">${esc(dt(L.dayKey(r.created)))}${staff() || r.status === 'cancelled' ? '' : ''}${r.status === 'cancelled' ? ' · ' + esc(t('rq.cancelled')) : ''}</div>
  ${acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}</div>`;
}
function kanban(list) {
  const cols = ['open', 'assigned', 'done'];
  return `<div class="kan">${cols.map((c) => { const items = list.filter((r) => r.status === c).sort((a, b) => b.created - a.created); return `<div><h3>${esc(t('reqCol.' + c))} ${pill('gray', nf(items.length))}</h3>${items.length ? items.slice(0, 12).map(reqCard).join('') : empty(t('noOpen'))}</div>`; }).join('')}</div>`;
}
function maintenancePage() {
  return `<div class="bar"><h1>${esc(t('nav.maintenance'))}</h1><span class="sp"></span>${canManage() ? `<button class="btn pri" data-act="newreq">${esc(t('b.newReq'))}</button>` : ''}</div>${kanban(D().requests)}`;
}

function reportsPage() {
  const r = D().reports;
  let h = `<div class="bar"><h1>${esc(t('nav.reports'))}</h1><span class="sp"></span><button class="btn" data-act="csv" data-k="ledger">${esc(t('rep.ledgerCsv'))}</button><button class="btn" data-act="csv" data-k="arrears">${esc(t('rep.arrearsCsv'))}</button></div>`;
  h += `<div class="grid kpis">${kpi(money(r.collectedMonth), t('rep.collectedM'), 'good')}${kpi(pct(r.collectionRate), t('k.rate'))}${kpi(money(r.repairCost), t('rep.repairs'))}${kpi(money(r.netMonth), t('k.net'))}${kpi(money(r.depositsHeld), t('k.deposits'))}${kpi(money(r.vacantLoss), t('k.vacancy'))}</div>`;
  h += `<div class="grid two" style="margin-top:1rem"><div class="card"><h2>${esc(t('rep.months'))}</h2>${twoBars(r.months)}<div class="tw" style="margin-top:.6rem"><table><thead><tr><th></th><th class="num">${esc(t('billedL'))}</th><th class="num">${esc(t('collectedL'))}</th></tr></thead><tbody>${r.months.slice().reverse().map((m) => `<tr><td>${esc(mon(m.month))}</td><td class="num">${money(m.billed)}</td><td class="num">${money(m.collected)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card"><h2>${esc(t('rep.byProp'))}</h2><div class="tw"><table><thead><tr><th>${esc(t('property'))}</th><th class="num">${esc(t('rep.occupied'))}</th><th class="num">${esc(t('rep.billedM'))}</th><th class="num">${esc(t('rep.collectedM'))}</th><th class="num">${esc(t('k.arrears'))}</th></tr></thead><tbody>${r.byProperty.map((p) => `<tr><td><b>${esc(nm(propOf(p.propertyId)))}</b></td><td class="num">${nf(p.leased)} / ${nf(p.units)}</td><td class="num">${money(p.billed)}</td><td class="num">${money(p.collected)}</td><td class="num">${money(p.arrears)}</td></tr>`).join('')}</tbody></table></div>
  <h2 style="margin-top:1rem">${esc(t('rep.aging'))}</h2>${['d30', 'd60', 'd90', 'd90p'].map((k) => { const v = r.aging.reduce((a, x) => a + x[k], 0); return `<div class="agrow"><span>${esc(t(k))}</span>${meter(r.arrears ? v / r.arrears : 0, k === 'd30' ? '' : 'bad')}<b>${money(v)}</b></div>`; }).join('')}</div></div>`;
  return h;
}
function auditPage() {
  const a = D().audit || [];
  return `<div class="bar"><h1>${esc(t('nav.audit'))}</h1></div>${a.length ? `<div class="tw"><table><thead><tr><th>${esc(t('date'))}</th><th>${esc(t('by'))}</th><th></th><th>${esc(t('details'))}</th></tr></thead><tbody>${a.map((x) => `<tr><td class="small">${esc(dt(L.dayKey(x.ts)))} ${esc(new Date(x.ts).toLocaleTimeString('en-GB', { timeZone: L.TZ, hour: '2-digit', minute: '2-digit' }))}</td><td>${esc(x.name)}</td><td>${pill('gray', x.action)}</td><td class="small" dir="ltr">${esc(x.detail)}</td></tr>`).join('')}</tbody></table></div>` : empty()}`;
}

// ---------- tenant portal ----------
function leaseCard(l) {
  const u = unitOf(l.unitId), p = propOf(u.propertyId);
  const next = D().charges.filter((c) => c.leaseId === l.id && L.outstanding(c) > 0).sort((a, b) => a.due.localeCompare(b.due))[0];
  return `<div class="card hero" style="margin-bottom:1rem"><div class="bar"><div><h2>${esc(u.code)} · ${esc(nm(p))}</h2><span class="muted">${esc(ar() ? p.areaAr : p.area)} · ${esc(t('ut.' + u.type))}</span></div><span class="sp"></span>${leaseTag(l)}</div>
  <div class="det"><div><span>${esc(t('current'))}</span><b>${money(l.currentRent)}</b></div><div><span>${esc(t('period'))}</span><b>${esc(dt(l.start))} → ${esc(dt(l.end))}</b></div><div><span>${esc(t('deposit'))}</span><b>${money(l.deposit)}</b></div>${l.serviceFee ? `<div><span>${esc(t('service'))}</span><b>${money(l.serviceFee)}</b></div>` : ''}</div>
  <div class="big-n">${l.balance > 0 ? money(l.balance) : l.balance < 0 ? money(-l.balance) : '0'}</div><div class="l">${esc(l.balance > 0 ? t('youOwe') : l.balance < 0 ? t('inCredit') : t('allPaid'))}${next && l.balance > 0 ? ` · ${esc(t('oldest'))} ${esc(dt(next.due))}` : ''}</div></div>`;
}
function homePage() {
  const d = D(); const ls = d.leases.filter((l) => l.state === 'active' || l.state === 'expired' || l.state === 'upcoming');
  let h = `<div class="bar"><h1>${esc(t('nav.home'))}</h1><span class="muted">${esc(nm(d.tenants[0]))}</span></div>`;
  h += ls.length ? ls.map(leaseCard).join('') : empty(t('tenantNoLease'));
  h += `<div class="grid two"><div class="card"><h2>${esc(t('pay.howTitle'))}</h2><p>${esc(t('pay.how'))}</p></div><div class="card"><div class="bar"><h2>${esc(t('nav.requests'))}</h2><span class="sp"></span><button class="btn pri" data-act="newreq">${esc(t('b.newReq'))}</button></div>${d.requests.filter((r) => r.status === 'open' || r.status === 'assigned').length ? d.requests.filter((r) => r.status === 'open' || r.status === 'assigned').slice(0, 3).map((r) => `<div class="mrow"><span><b>${esc(ar() && r.titleAr ? r.titleAr : r.title)}</b><br><span class="muted small">${esc(dt(L.dayKey(r.created)))}</span></span>${pill(r.status === 'open' ? 'off' : 'ice', t('rq.' + r.status))}</div>`).join('') : empty(t('noOpen'))}</div></div>`;
  return h;
}
function ledgerPage() {
  const d = D();
  const ch = d.charges.slice().sort((a, b) => b.due.localeCompare(a.due));
  let h = `<div class="bar"><h1>${esc(t('nav.ledger'))}</h1></div><div class="card"><h2>${esc(t('ttl.ledger'))}</h2><div class="tw"><table><thead><tr><th>${esc(t('date'))}</th><th></th><th class="num">${esc(t('amount'))}</th><th class="num">${esc(t('paidLabel'))}</th><th>${esc(t('status'))}</th></tr></thead><tbody>${ch.slice(0, 40).map((c) => `<tr><td>${esc(dt(c.due))}</td><td>${esc(chargeName(c))}</td><td class="num">${money(c.amount)}</td><td class="num">${money(Math.min(c.paid, c.amount))}</td><td>${chargeStatus(c)}</td></tr>`).join('')}</tbody></table></div></div>`;
  h += `<div class="card" style="margin-top:1rem"><h2>${esc(t('ttl.pays'))}</h2>${d.payments.length ? payRows(d.payments.slice().reverse().slice(0, 30), false) : empty()}</div>`;
  return h;
}
function requestsPage() {
  return `<div class="bar"><h1>${esc(t('nav.requests'))}</h1><span class="sp"></span><button class="btn pri" data-act="newreq">${esc(t('b.newReq'))}</button></div>${kanban(D().requests)}`;
}

const PAGES = { dashboard, units: unitsPage, leases: leasesPage, payments: paymentsPage, arrears: arrearsPage, renewals: renewalsPage, maintenance: maintenancePage, reports: reportsPage, audit: auditPage, home: homePage, ledger: ledgerPage, requests: requestsPage };

// ---------- modals ----------
const modal = (title, body, wide) => `<div class="modal-bg" data-act="close"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true"><div class="bar noprint"><h2>${esc(title)}</h2><span class="sp"></span><button class="btn sm" data-act="close">${esc(t('b.close'))}</button></div>${body}</div></div>`;
function receiptHtml(p) {
  const ten = tenantOf(p.tenantId), u = unitOf(p.unitId), pr = propOf(u.propertyId), l = leaseOf(p.leaseId);
  return `<div class="receipt printable"><h3>${esc(nm(D().company))}</h3><p class="c muted small">${esc(nm(pr))} · ${esc(ar() ? pr.areaAr : pr.area)}</p><hr>
  <div class="r"><span>${esc(t('receipt'))}</span><b class="rcpt-no" dir="ltr">${esc(p.no)}</b></div><div class="r"><span>${esc(t('date'))}</span><span>${esc(dt(p.date))}</span></div>
  <div class="r"><span>${esc(t('tenant'))}</span><b>${esc(nm(ten))}</b></div><div class="r"><span>${esc(t('unit'))}</span><span>${esc(u.code)}</span></div><div class="r"><span>${esc(t('method'))}</span><span>${esc(t('pm.' + p.method))}${p.ref ? ' · ' + esc(p.ref) : ''}</span></div><hr>
  ${p.allocs.map((a) => { const c = D().charges.find((x) => x.id === a.chargeId); return c ? `<div class="r small"><span>${esc(chargeName(c))}</span><span>${money(a.amount)}</span></div>` : ''; }).join('')}
  ${p.credit ? `<div class="r small"><span>${esc(t('credit'))}</span><span>${money(p.credit)}</span></div>` : ''}
  <div class="r tot"><span>${esc(t('amount'))}</span><span>${money(p.amount)}</span></div>${l ? `<div class="r small muted"><span>${esc(t('balance'))}</span><span>${money(l.balance)}</span></div>` : ''}</div>
  <div class="acts noprint"><button class="btn pri" data-act="print">${esc(t('b.print'))}</button></div>`;
}
const tenantOpts = () => D().tenants.map((x) => [x.id, nm(x)]);
function newLeaseModal(unitId) {
  const d = D(); const free = d.units.filter((u) => !d.leases.some((l) => l.unitId === u.id && l.state !== 'terminated' && l.end >= d.today));
  const u0 = unitId && free.find((u) => u.id === unitId) ? unitId : free[0]?.id;
  return modal(t('ttl.newLease'), `${field('nl-u', t('unit'), sel('nl-u', free.map((u) => [u.id, unitLabel(u.id) + ' · ' + money(u.listRent)]), u0))}
  <div class="seg" role="group"><button data-act="nlt" data-m="old" class="${S.mo.nt !== 'new' ? 'on' : ''}">${esc(t('h.existing'))}</button><button data-act="nlt" data-m="new" class="${S.mo.nt === 'new' ? 'on' : ''}">${esc(t('h.newTenant'))}</button></div>
  ${S.mo.nt === 'new' ? `${field('nl-n', t('name'), '<input id="nl-n" maxlength="60">')}${field('nl-na', t('nameAr'), '<input id="nl-na" maxlength="60" dir="rtl">')}${field('nl-ph', t('phone'), '<input id="nl-ph" inputmode="tel" dir="ltr" placeholder="+20 100 000 0000">')}` : field('nl-t', t('tenant'), sel('nl-t', tenantOpts(), ''))}
  <div class="grid3">${field('nl-s', t('start'), `<input id="nl-s" type="date" value="${d.today}">`)}${field('nl-m', t('months'), '<input id="nl-m" inputmode="numeric" value="12">')}${field('nl-i', t('increase') + ' %', '<input id="nl-i" inputmode="numeric" value="10">')}</div>
  <div class="grid3">${field('nl-r', t('rent') + ' (' + t('cur') + ')', `<input id="nl-r" inputmode="decimal" value="${unitOf(u0) ? unitOf(u0).listRent / 100 : ''}">`)}${field('nl-d', t('deposit') + ' (' + t('cur') + ')', '<input id="nl-d" inputmode="decimal" value="0">', t('h.depHint'))}${field('nl-f', t('service') + ' (' + t('cur') + ')', '<input id="nl-f" inputmode="decimal" value="0">')}</div>
  <div class="acts"><button class="btn pri" data-act="savelease">${esc(t('b.save'))}</button><button class="btn" data-act="close">${esc(t('b.cancel'))}</button></div>`);
}
function payModal(leaseId) {
  const d = D(); const opts = d.leases.filter((l) => l.state === 'active' || l.state === 'expired' || (l.state === 'terminated' && l.balance > 0)).map((l) => [l.id, `${nm(tenantOf(l.tenantId))} · ${unitOf(l.unitId).code}${l.balance > 0 ? ' · ' + money(l.balance) : ''}`]);
  const l0 = leaseId || opts[0]?.[0]; const l = leaseOf(l0);
  return modal(t('ttl.record'), `${field('pm-l', t('lease'), sel('pm-l', opts, l0))}
  <div class="grid3">${field('pm-a', t('amount') + ' (' + t('cur') + ')', `<input id="pm-a" inputmode="decimal" value="${l && l.balance > 0 ? l.balance / 100 : ''}">`)}${field('pm-m', t('method'), sel('pm-m', L.METHODS.map((m) => [m, t('pm.' + m)]), 'cash'))}${field('pm-d', t('date'), `<input id="pm-d" type="date" value="${D().today}" max="${D().today}" min="${L.addDays(D().today, -D().settings.backdateDays)}">`)}</div>
  ${field('pm-r', t('ref'), '<input id="pm-r" maxlength="40" dir="ltr">')}
  <div class="acts"><button class="btn pri" data-act="savepay">${esc(t('b.record'))}</button><button class="btn" data-act="close">${esc(t('b.cancel'))}</button></div>`);
}
function leaseModal(id) {
  const l = leaseOf(id); if (!l) return '';
  const ten = tenantOf(l.tenantId), u = unitOf(l.unitId), p = propOf(u.propertyId), d = D();
  const ch = d.charges.filter((c) => c.leaseId === id).sort((a, b) => b.due.localeCompare(a.due) || b.id.localeCompare(a.id, 'en', { numeric: true }));
  const pays = d.payments.filter((x) => x.leaseId === id).slice().reverse();
  const live = l.state === 'active' || l.state === 'expired';
  const rn = renewedBy(l);
  let h = `<div class="det"><div><span>${esc(t('tenant'))}</span><b>${esc(nm(ten))}</b><div class="small muted" dir="ltr">${esc(ten.phone)}</div></div><div><span>${esc(t('unit'))}</span><b>${esc(u.code)}</b><div class="small muted">${esc(nm(p))}</div></div><div><span>${esc(t('period'))}</span><b>${esc(dt(l.start))} → ${esc(dt(l.end))}</b></div><div><span>${esc(t('current'))}</span><b>${money(l.currentRent)}</b>${l.increasePct ? `<div class="small muted">${esc(t('increase'))} +${nf(l.increasePct)}%</div>` : ''}</div><div><span>${esc(t('deposit'))}</span><b>${money(l.deposit)}</b><div class="small muted">${esc(l.depositStatus === 'held' ? t('depHeld') : l.depositStatus === 'transferred' ? t('depTransferred') : t('depSettled'))}</div></div><div><span>${esc(t('balance'))}</span><b class="${l.balance > 0 ? 'neg' : ''}">${money(Math.abs(l.balance))}</b><div class="small muted">${l.balance < 0 ? esc(t('inCredit')) : ''}</div></div></div><div style="margin-bottom:.6rem">${leaseTag(l)}${rn ? ' ' + pill('ice', t('renewalOf') + ' · ' + dt(rn.start)) : ''}</div>`;
  if (l.settlement) { const s = l.settlement; h += `<div class="notice"><b>${esc(t('ttl.moveOut'))}</b>: ${esc(dt(s.date))}<br>${esc(t('deposit'))} ${money(s.deposit)}${s.deductions.map((x) => ` − ${esc(x.reason)} ${money(x.amount)}`).join('')}${s.appliedToArrears ? ` − ${esc(t('h.applied'))} ${money(s.appliedToArrears)}` : ''}${s.creditRefund ? ` + ${esc(t('h.refundCredit'))} ${money(s.creditRefund)}` : ''}<br><b>${esc(t('h.refund'))}: ${money(s.refund)}</b>${s.remainingBalance ? ` · ${esc(t('h.remaining'))}: ${money(s.remainingBalance)}` : ''}</div>`; }
  const acts = [];
  if (role() !== 'tenant' && (live || l.balance > 0)) acts.push(`<button class="btn pri" data-act="pay" data-id="${id}">${esc(t('b.record'))}</button>`);
  if (canManage() && live) acts.push(`<button class="btn" data-act="addcharge" data-id="${id}">${esc(t('b.addCharge'))}</button>`);
  if (canManage() && live && !rn) acts.push(`<button class="btn" data-act="renew" data-id="${id}">${esc(t('b.renew'))}</button>`);
  if (canManage() && live && !rn && l.depositStatus === 'held') acts.push(`<button class="btn danger" data-act="moveout" data-id="${id}">${esc(t('b.moveOut'))}</button>`);
  if (l.balance > 0) { const row = { leaseId: id, tenantId: l.tenantId, unitId: l.unitId, total: l.balance }; acts.push(remindLink(row)); }
  if (acts.length) h += `<div class="acts" style="margin:0 0 1rem">${acts.join('')}</div>`;
  h += `<h3>${esc(t('ttl.ledger'))}</h3><div class="tw"><table><thead><tr><th>${esc(t('date'))}</th><th></th><th class="num">${esc(t('amount'))}</th><th class="num">${esc(t('paidLabel'))}</th><th>${esc(t('status'))}</th><th></th></tr></thead><tbody>${ch.slice(0, 30).map((c) => `<tr class="${c.voided ? 'void' : ''}"><td>${esc(dt(c.due))}</td><td>${esc(chargeName(c))}</td><td class="num">${money(c.amount)}</td><td class="num">${money(Math.min(c.paid, c.amount))}</td><td>${chargeStatus(c)}</td><td>${c.kind === 'late' && !c.voided && c.paid === 0 && canManage() ? `<button class="btn sm" data-act="waive" data-id="${c.id}">${esc(t('b.waive'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  h += `<h3 style="margin-top:1rem">${esc(t('ttl.pays'))}</h3>${pays.length ? payRows(pays, false) : empty()}`;
  return modal(t('ttl.leaseOf') + ' ' + l.id.toUpperCase(), h, true);
}
function renewModal(id) {
  const l = leaseOf(id), r = D().reports.expiring.find((x) => x.leaseId === id); const cur = L.rentAt(l, l.months - 1);
  const p0 = r ? r.proposedPct : D().settings.renewalPct;
  return modal(t('ttl.renew'), `<p class="muted">${esc(nm(tenantOf(l.tenantId)))} · ${esc(unitLabel(l.unitId))} · ${esc(t('current'))} ${money(cur)}</p><p class="small">${esc(t('h.renewHint'))}</p>
  <div class="grid3">${field('rn-m', t('months'), '<input id="rn-m" inputmode="numeric" value="12">')}${field('rn-p', t('increase') + ' %', `<input id="rn-p" inputmode="numeric" value="${p0}">`)}</div><p>${esc(t('proposed'))}: <b id="rn-new">${money(Math.round((cur * (1 + p0 / 100)) / 100) * 100)}</b></p>
  <div class="acts"><button class="btn pri" data-act="saverenew" data-id="${id}">${esc(t('b.renew'))}</button><button class="btn" data-act="close">${esc(t('b.cancel'))}</button></div>`);
}
function moveModal(id) {
  const l = leaseOf(id); const n = S.mo.ded || 1;
  return modal(t('ttl.moveOut'), `<p class="muted">${esc(nm(tenantOf(l.tenantId)))} · ${esc(unitLabel(l.unitId))} · ${esc(t('deposit'))} ${money(l.deposit)} · ${esc(t('balance'))} ${money(l.balance)}</p><p class="small">${esc(t('h.moveHint'))}</p>
  ${field('mo-d', t('date'), `<input id="mo-d" type="date" value="${l.end < D().today ? l.end : D().today}" min="${l.start}" max="${l.end}">`)}
  <h3>${esc(t('h.deduct'))}</h3>${Array.from({ length: n }, (_, i) => `<div class="ded"><input id="mo-r${i}" placeholder="${esc(t('h.reason'))}" maxlength="60"><input id="mo-a${i}" inputmode="decimal" placeholder="${esc(t('cur'))}"></div>`).join('')}
  ${n < 3 ? `<button class="btn sm" data-act="addded">${esc(t('h.addDed'))}</button>` : ''}
  <label class="chk"><input type="checkbox" id="mo-ar" ${l.balance > 0 ? 'checked' : ''}> ${esc(t('h.arrearsHint'))}</label><div class="notice" id="mo-prev" data-id="${id}"></div>
  <div class="acts"><button class="btn danger" data-act="savemove" data-id="${id}">${esc(t('b.moveOut'))}</button><button class="btn" data-act="close">${esc(t('b.cancel'))}</button></div>`);
}
function moPreview() {
  const el = $('#mo-prev'); if (!el) return; const l = leaseOf(el.dataset.id);
  const n = S.mo.ded || 1; let ded = 0; for (let i = 0; i < n; i++) ded += toCents(val('mo-a' + i));
  const out = Math.max(0, l.balance); const applied = $('#mo-ar')?.checked ? Math.max(0, Math.min(out, l.deposit - ded)) : 0;
  const refund = l.deposit - ded - applied + Math.max(0, -l.balance);
  el.innerHTML = `${esc(t('h.applied'))}: <b>${money(applied)}</b> · ${esc(t('h.refund'))}: <b class="${refund < 0 ? 'neg' : ''}">${money(refund)}</b> · ${esc(t('h.remaining'))}: <b>${money(out - applied)}</b>`;
}
function reqModal() {
  const isT = role() === 'tenant';
  const units = isT ? D().leases.filter((l) => l.state === 'active').map((l) => [l.unitId, unitLabel(l.unitId)]) : D().units.map((u) => [u.id, unitLabel(u.id)]);
  return modal(t('ttl.newReq'), `${field('rq-u', t('unit'), sel('rq-u', units, units[0]?.[0]))}${field('rq-t', t('title'), '<input id="rq-t" maxlength="80">')}${field('rq-d', t('details'), '<textarea id="rq-d" rows="3" maxlength="500"></textarea>')}${field('rq-p', t('priority'), sel('rq-p', ['low', 'normal', 'urgent'].map((k) => [k, t('pr.' + k)]), 'normal'))}
  <div class="acts"><button class="btn pri" data-act="savereq">${esc(t('b.send'))}</button><button class="btn" data-act="close">${esc(t('b.cancel'))}</button></div>`);
}
function assignModal(id) {
  const r = D().requests.find((x) => x.id === id);
  return modal(t('ttl.assign'), `<p><b>${esc(r.title)}</b> · ${esc(unitLabel(r.unitId))}</p>${field('as-v', t('vendor'), `<input id="as-v" maxlength="60" value="${esc(r.vendor)}">`)}${field('as-e', t('estimate') + ' (' + t('cur') + ')', `<input id="as-e" inputmode="decimal" value="${r.estimate ? r.estimate / 100 : ''}">`)}
  <div class="acts"><button class="btn pri" data-act="saveassign" data-id="${id}">${esc(t('b.assign'))}</button><button class="btn" data-act="close">${esc(t('b.cancel'))}</button></div>`);
}
function completeModal(id) {
  const r = D().requests.find((x) => x.id === id);
  return modal(t('ttl.complete'), `<p><b>${esc(r.title)}</b> · ${esc(r.vendor)}${r.estimate ? ' · ' + esc(t('estimate')) + ' ' + money(r.estimate) : ''}</p>${field('cp-c', t('cost') + ' (' + t('cur') + ')', `<input id="cp-c" inputmode="decimal" value="${r.estimate ? r.estimate / 100 : ''}">`, role() === 'manager' ? `${money(D().settings.managerRepairLimit)}` : '')}${field('cp-w', t('h.chargedTo'), sel('cp-w', [['owner', t('h.owner')], ['tenant', t('h.tenantPays')]], 'owner'))}
  <div class="acts"><button class="btn pri" data-act="savecomplete" data-id="${id}">${esc(t('b.complete'))}</button><button class="btn" data-act="close">${esc(t('b.cancel'))}</button></div>`);
}
function chargeModal(id) {
  return modal(t('ttl.charge'), `${field('ac-a', t('amount') + ' (' + t('cur') + ')', '<input id="ac-a" inputmode="decimal">')}${field('ac-n', t('note'), '<input id="ac-n" maxlength="80">')}<div class="acts"><button class="btn pri" data-act="savecharge" data-id="${id}">${esc(t('b.save'))}</button><button class="btn" data-act="close">${esc(t('b.cancel'))}</button></div>`);
}
function modalHtml() {
  const m = S.modal; if (!m) return '';
  if (m.type === 'lease') return leaseModal(m.id);
  if (m.type === 'newlease') return newLeaseModal(m.unitId);
  if (m.type === 'pay') return payModal(m.id);
  if (m.type === 'renew') return renewModal(m.id);
  if (m.type === 'moveout') return moveModal(m.id);
  if (m.type === 'newreq') return reqModal();
  if (m.type === 'assign') return assignModal(m.id);
  if (m.type === 'complete') return completeModal(m.id);
  if (m.type === 'charge') return chargeModal(m.id);
  if (m.type === 'receipt') return modal(t('ttl.receipt'), receiptHtml(m.pay));
  return '';
}
function render() {
  document.documentElement.lang = S.lang; document.documentElement.dir = T[S.lang].dir; document.title = t('appName') + ' | ' + t('appSub');
  const app = $('#app');
  if (!S.token || !S.data) { app.innerHTML = loginView(); $('#pin')?.focus(); return; }
  const r = route(); const nav = NAV[role()] || []; if (!nav.includes(r)) { location.hash = '#/' + nav[0]; return; }
  const ae = document.activeElement, keep = ae && ['uq', 'lq', 'pq'].includes(ae.id) ? { id: ae.id, pos: ae.selectionStart } : null;
  app.innerHTML = shell(PAGES[r]()) + modalHtml();
  if (keep) { const el = $('#' + keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.pos, keep.pos); } catch {} } }
  if (S.modal?.type === 'moveout') moPreview();
}

// ---------- actions ----------
const open = (m) => { S.modal = m; S.mo = { ded: 1 }; render(); };
const done = (r) => { if (r) { S.modal = null; render(); } return r; };
const H = {
  pin: (d) => login(d.pin), lang: () => { S.lang = S.lang === 'en' ? 'ar' : 'en'; LS.set('lang', S.lang); render(); }, logout, close: () => { S.modal = null; render(); }, print: () => window.print(),
  reset: async () => { if (!confirm('Reset all demo data to the starting set?')) return; if (await act({ type: 'reset' }, t('msgs.saved'))) render(); },
  uf: (d) => { S.uf = d.f; render(); }, lf: (d) => { S.lf = d.f; render(); },
  lease: (d) => open({ type: 'lease', id: d.id }), unitnew: (d) => open({ type: 'newlease', unitId: d.id }),
  nlt: (d) => { S.mo.nt = d.m; render(); }, addded: () => { const keep = {}; document.querySelectorAll('#mo-d,[id^=mo-r],[id^=mo-a]').forEach((e) => (keep[e.id] = e.value)); const ar2 = $('#mo-ar').checked; S.mo.ded = Math.min(3, S.mo.ded + 1); render(); for (const k in keep) if ($('#' + k)) $('#' + k).value = keep[k]; $('#mo-ar').checked = ar2; moPreview(); },
  pay: (d) => open({ type: 'pay', id: d.id || null }),
  savepay: async () => { const r = await act({ type: 'recordPayment', leaseId: val('pm-l'), amount: toCents(val('pm-a')), method: val('pm-m'), date: val('pm-d'), ref: val('pm-r') }, t('msgs.paymentOk')); if (r) { const p = D().payments.find((x) => x.id === r.paymentId); S.modal = { type: 'receipt', pay: p }; render(); } },
  rcpt: (d) => { const p = D().payments.find((x) => x.id === d.id); if (p) { S.modal = { type: 'receipt', pay: p }; render(); } },
  void: async (d) => { if (!confirm(ar() ? 'إلغاء هذه الدفعة؟' : 'Void this payment?')) return; if (await act({ type: 'voidPayment', paymentId: d.id }, t('msgs.voided'))) render(); },
  savelease: async () => { const nt = S.mo.nt === 'new'; const op = { type: 'addLease', key: S.mo.key || (S.mo.key = rid()), unitId: val('nl-u'), start: val('nl-s'), months: toInt(val('nl-m')), increasePct: toInt(val('nl-i')), rent: toCents(val('nl-r')), deposit: toCents(val('nl-d')), serviceFee: toCents(val('nl-f')) }; if (nt) op.newTenant = { name: val('nl-n'), nameAr: val('nl-na'), phone: val('nl-ph') }; else op.tenantId = val('nl-t'); const r = await act(op, t('msgs.leaseOk')); if (r) { S.modal = { type: 'lease', id: r.leaseId }; render(); } },
  renew: (d) => open({ type: 'renew', id: d.id }),
  saverenew: async (d) => { const r = await act({ type: 'renewLease', key: rid(), leaseId: d.id, months: toInt(val('rn-m')), increasePct: toInt(val('rn-p')) }, t('msgs.renewOk')); if (r) { S.modal = { type: 'lease', id: r.leaseId }; render(); } },
  cancelrenew: async (d) => { if (!confirm(t('b.cancelRenewal') + '?')) return; if (await act({ type: 'cancelRenewal', leaseId: d.id }, t('msgs.cancelled'))) render(); },
  moveout: (d) => open({ type: 'moveout', id: d.id }),
  savemove: async (d) => { const ded = []; for (let i = 0; i < S.mo.ded; i++) { const a = toCents(val('mo-a' + i)), r = val('mo-r' + i).trim(); if (a || r) ded.push({ reason: r, amount: a }); } const r = await act({ type: 'terminate', leaseId: d.id, date: val('mo-d'), deductions: ded, applyArrears: $('#mo-ar').checked }, t('msgs.moveOk')); if (r) { S.modal = { type: 'lease', id: d.id }; render(); } },
  addcharge: (d) => open({ type: 'charge', id: d.id }),
  savecharge: async (d) => { const r = await act({ type: 'addCharge', key: rid(), leaseId: d.id, amount: toCents(val('ac-a')), note: val('ac-n') }, t('msgs.chargeOk')); if (r) { S.modal = { type: 'lease', id: d.id }; render(); } },
  waive: async (d) => { const reason = prompt(t('h.reason'), ar() ? 'مراعاة ظرف' : 'Goodwill'); if (reason === null) return; if (await act({ type: 'waiveFee', chargeId: d.id, reason }, t('msgs.waived'))) render(); },
  remind: (d, el) => { window.open(el.dataset.url, '_blank', 'noopener'); act({ type: 'logReminder', leaseId: d.id }, t('msgs.logged')).then(() => render()); },
  newreq: () => open({ type: 'newreq' }),
  savereq: async () => { const r = await act({ type: 'submitRequest', key: rid(), unitId: val('rq-u'), title: val('rq-t'), desc: val('rq-d'), priority: val('rq-p') }, t('msgs.reqOk')); done(r); },
  assign: (d) => open({ type: 'assign', id: d.id }),
  saveassign: async (d) => { done(await act({ type: 'assignRequest', id: d.id, vendor: val('as-v'), estimate: toCents(val('as-e')) }, t('msgs.assigned'))); },
  complete: (d) => open({ type: 'complete', id: d.id }),
  savecomplete: async (d) => { done(await act({ type: 'completeRequest', id: d.id, cost: toCents(val('cp-c')), chargedTo: val('cp-w') }, t('msgs.done'))); },
  cancelreq: async (d) => { if (!confirm(t('b.cancel') + '?')) return; if (await act({ type: 'cancelRequest', id: d.id }, t('msgs.cancelled'))) render(); },
  csv: (d) => {
    const v = D(), today = v.today;
    if (d.k === 'payments') downloadCsv('payments.csv', [['Receipt', 'Date', 'Tenant', 'Unit', 'Method', 'Reference', 'Amount EGP', 'Voided'], ...v.payments.map((p) => [p.no, p.date, tenantOf(p.tenantId)?.name, unitOf(p.unitId)?.code, p.method, p.ref, p.amount / 100, p.voided ? 'yes' : ''])]);
    if (d.k === 'arrears') downloadCsv('arrears.csv', [['Tenant', 'Phone', 'Unit', '1-30', '31-60', '61-90', '90+', 'Total EGP', 'Oldest days'], ...v.reports.aging.map((x) => [tenantOf(x.tenantId)?.name, tenantOf(x.tenantId)?.phone, unitOf(x.unitId)?.code, x.d30 / 100, x.d60 / 100, x.d90 / 100, x.d90p / 100, x.total / 100, x.oldestDays])]);
    if (d.k === 'ledger') downloadCsv('ledger.csv', [['Lease', 'Tenant', 'Unit', 'Type', 'Period', 'Due', 'Amount EGP', 'Paid EGP', 'Voided'], ...v.charges.map((c) => { const l = leaseOf(c.leaseId); return [c.leaseId, tenantOf(l.tenantId)?.name, unitOf(l.unitId)?.code, c.kind, c.period, c.due, c.amount / 100, c.paid / 100, c.voided ? 'yes' : '']; })]);
    void today;
  },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.classList.contains('modal-bg') && e.target !== el) return;
  const f = H[el.dataset.act]; if (!f) return;
  if ((el.tagName === 'TR' || el.classList.contains('ucard')) && e.target.closest('button,a')) { if (!e.target.closest('[data-act]') || e.target.closest('[data-act]') === el) return; }
  if (el.tagName !== 'A' || el.dataset.act === 'remind' || el.dataset.act === 'lease') e.preventDefault();
  f(el.dataset, el, e);
});
document.addEventListener('submit', (e) => { if (e.target.id === 'pinform') { e.preventDefault(); login(val('pin').trim()); } });
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'uq' || id === 'lq' || id === 'pq') { S[id] = e.target.value; render(); }
  else if (id === 'rn-p') { const l = leaseOf(S.modal.id); const p = toInt(e.target.value); if (Number.isFinite(p) && l) $('#rn-new').textContent = money(Math.round((L.rentAt(l, l.months - 1) * (1 + p / 100)) / 100) * 100); }
  else if (id && (id.startsWith('mo-a') || id === 'mo-ar')) moPreview();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'up') { S.up = e.target.value; render(); }
  else if (e.target.id === 'mo-ar') moPreview();
  else if (e.target.id === 'nl-u') { const u = unitOf(e.target.value); if (u) $('#nl-r').value = u.listRent / 100; }
  else if (e.target.id === 'pm-l') { const l = leaseOf(e.target.value); if (l) $('#pm-a').value = l.balance > 0 ? l.balance / 100 : ''; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.modal) { S.modal = null; render(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('ucard')) { e.preventDefault(); e.target.click(); }
});
window.addEventListener('hashchange', () => { S.modal = null; render(); });
(async function init() { if (S.token) await refresh(); if (S.err && !S.data) { S.token = null; } render(); })();
