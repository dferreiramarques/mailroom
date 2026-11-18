// Calendário do mailroom: junta várias fontes num só formato de evento.
//   local    — eventos e projetos guardados no próprio mailroom (store)
//   caldav   — calendários CalDAV de uma conta (ex.: Spacemail), com a palavra-passe da conta de correio
//   google   — Google Calendar, pela API com OAuth (o Google já não aceita palavras-passe em CalDAV)
//   funnel   — datas do funil de prospeção (follow-ups, respostas, pitches enviados), só de leitura
// Cada evento tem `kind`: 'event' | 'milestone' | 'deadline', e pode ter `projectId`, para a vista de projetos.
import crypto from 'node:crypto';
import ICAL from 'ical.js';
import { XMLParser } from 'fast-xml-parser';

const DAY = 864e5;
const KINDS = new Set(['event', 'milestone', 'deadline']);
const PALETTE = ['#3b6fd8', '#2f9e6e', '#c2410c', '#8b5cf6', '#d97706', '#0e7490', '#be185d', '#4d7c0f'];

// ---------- identificadores ----------
// O id de um evento diz de onde veio, para editar e apagar no sítio certo.
const encId = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const decId = (id) => { try { return JSON.parse(Buffer.from(String(id), 'base64url').toString('utf8')); } catch { throw Object.assign(new Error('Evento desconhecido'), { status: 400 }); } };

// ---------- datas ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const toIcalUtc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const addDaysStr = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };

function normalizeInput(b) {
  const title = String(b.title || '').trim() || '(sem título)';
  const allDay = Boolean(b.allDay);
  let start = b.start, end = b.end;
  if (allDay) {
    start = String(start || '').slice(0, 10);
    if (!isDateOnly(start)) throw Object.assign(new Error('Data de início inválida'), { status: 400 });
    end = isDateOnly(String(end || '').slice(0, 10)) ? String(end).slice(0, 10) : addDaysStr(start, 1);
    if (end <= start) end = addDaysStr(start, 1); // fim exclusivo, como no iCalendar
  } else {
    const s = new Date(start), e = new Date(end || new Date(new Date(start).getTime() + 3600e3));
    if (Number.isNaN(+s)) throw Object.assign(new Error('Hora de início inválida'), { status: 400 });
    start = s.toISOString(); end = (Number.isNaN(+e) || e <= s ? new Date(s.getTime() + 3600e3) : e).toISOString();
  }
  return {
    title, allDay, start, end,
    location: String(b.location || '').trim(), notes: String(b.notes || ''),
    kind: KINDS.has(b.kind) ? b.kind : 'event',
    projectId: b.projectId ? String(b.projectId) : '',
    ref: b.ref ? String(b.ref).slice(0, 500) : '', // ligação a um e-mail (account:folder:uid)
  };
}

// ---------- iCalendar ----------
function registerTimezones(comp) {
  for (const tz of comp.getAllSubcomponents('vtimezone')) {
    try { const id = tz.getFirstPropertyValue('tzid'); if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz); } catch { /* fuso estranho: usa a hora tal como vem */ }
  }
}
const timeOut = (t) => (t.isDate ? ymd(new Date(t.year, t.month - 1, t.day)) : t.toJSDate().toISOString());

/** Ocorrências de um ficheiro .ics entre from e to (recorrências expandidas). */
export function parseIcs(text, from, to, base = {}) {
  const out = [];
  let comp;
  try { comp = new ICAL.Component(ICAL.parse(text)); } catch { return out; }
  registerTimezones(comp);
  const vevents = comp.getAllSubcomponents('vevent');
  const masters = vevents.filter((v) => !v.hasProperty('recurrence-id'));
  const exceptions = vevents.filter((v) => v.hasProperty('recurrence-id'));
  for (const v of masters) {
    const ev = new ICAL.Event(v);
    for (const x of exceptions) if (x.getFirstPropertyValue('uid') === ev.uid) { try { ev.relateException(x); } catch { /* exceção sem par */ } }
    const meta = (item) => {
      const c = item.component;
      const cats = c.getAllProperties('categories').flatMap((p) => p.getValues()).map((s) => String(s).toLowerCase());
      const xk = c.getFirstPropertyValue('x-mailroom-kind');
      const kind = KINDS.has(xk) ? xk : cats.includes('milestone') ? 'milestone' : cats.includes('deadline') ? 'deadline' : /^\s*(milestone|marco)\s*[:·-]/i.test(item.summary || '') ? 'milestone' : /^\s*(deadline|prazo)\s*[:·-]/i.test(item.summary || '') ? 'deadline' : 'event';
      return { title: item.summary || '(sem título)', location: item.location || '', notes: item.description || '', kind, projectId: c.getFirstPropertyValue('x-mailroom-project') || '', ref: c.getFirstPropertyValue('x-mailroom-ref') || '' };
    };
    const push = (startT, endT, item, recurring) => {
      const start = timeOut(startT), end = endT ? timeOut(endT) : startT.isDate ? addDaysStr(start, 1) : start;
      const s = startT.isDate ? new Date(`${start}T00:00:00`) : new Date(start), e = startT.isDate ? new Date(`${end}T00:00:00`) : new Date(end);
      if (e < from || s > to) return;
      out.push({ ...base, uid: ev.uid, allDay: startT.isDate, start, end, recurring, ...meta(item) });
    };
    if (ev.isRecurring()) {
      const it = ev.iterator();
      let next, n = 0;
      while ((next = it.next()) && n++ < 1000) {
        const det = ev.getOccurrenceDetails(next);
        if (det.startDate.toJSDate() > to) break;
        push(det.startDate, det.endDate, det.item, true);
      }
    } else push(ev.startDate, ev.endDate, ev, false);
  }
  return out;
}

/** Cria um VCALENDAR novo, ou altera o existente (sem mexer nas horas de uma série recorrente). */
export function buildIcs(e, existing) {
  let comp, v;
  if (existing) {
    comp = new ICAL.Component(ICAL.parse(existing));
    v = comp.getAllSubcomponents('vevent').find((x) => !x.hasProperty('recurrence-id'));
  }
  if (!comp || !v) {
    comp = new ICAL.Component(['vcalendar', [], []]);
    comp.updatePropertyWithValue('prodid', '-//monco//mailroom//PT');
    comp.updatePropertyWithValue('version', '2.0');
    v = new ICAL.Component('vevent');
    v.updatePropertyWithValue('uid', e.uid || `${crypto.randomUUID()}@mailroom`);
    comp.addSubcomponent(v);
  }
  const set = (name, val) => { v.removeAllProperties(name); if (val) v.updatePropertyWithValue(name, val); };
  set('summary', e.title); set('location', e.location); set('description', e.notes);
  v.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
  const recurring = v.hasProperty('rrule');
  if (!recurring) {
    v.removeAllProperties('dtstart'); v.removeAllProperties('dtend'); v.removeAllProperties('duration');
    if (e.allDay) {
      v.addProperty(new ICAL.Property(['dtstart', { value: 'date' }, 'date', e.start]));
      v.addProperty(new ICAL.Property(['dtend', { value: 'date' }, 'date', e.end]));
    } else {
      v.addProperty(new ICAL.Property(['dtstart', {}, 'date-time', ICAL.Time.fromJSDate(new Date(e.start), true).toString()]));
      v.addProperty(new ICAL.Property(['dtend', {}, 'date-time', ICAL.Time.fromJSDate(new Date(e.end), true).toString()]));
    }
  }
  // Tipo e projeto: CATEGORIES (que outras apps mostram) e propriedades próprias.
  v.removeAllProperties('categories');
  if (e.kind && e.kind !== 'event') { const p = new ICAL.Property('categories'); p.setValues([e.kind]); v.addProperty(p); }
  set('x-mailroom-kind', e.kind && e.kind !== 'event' ? e.kind : '');
  set('x-mailroom-project', e.projectId);
  set('x-mailroom-ref', e.ref);
  return { ics: comp.toString(), uid: v.getFirstPropertyValue('uid'), recurring };
}

// ---------- CalDAV ----------
const xml = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const textOf = (x) => (x == null ? '' : typeof x === 'object' ? String(x['#text'] ?? '') : String(x));

async function dav(url, { method = 'PROPFIND', depth, body, user, pass, headers = {} } = {}) {
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
      ...(body ? { 'Content-Type': method === 'PUT' ? 'text/calendar; charset=utf-8' : 'application/xml; charset=utf-8' } : {}),
      ...(depth != null ? { Depth: String(depth) } : {}),
      ...headers,
    },
    body, redirect: 'follow', signal: AbortSignal.timeout(20000),
  });
  if (r.status === 401) throw Object.assign(new Error('O servidor de calendário recusou o utilizador ou a palavra-passe'), { status: 400 });
  return r;
}
function responses(text) {
  const doc = xml.parse(text);
  return arr(doc?.multistatus?.response).map((r) => {
    const okProps = arr(r.propstat).filter((p) => /\s200\s/.test(` ${textOf(p.status)} `)).map((p) => p.prop || {});
    return { href: textOf(r.href), prop: Object.assign({}, ...okProps) };
  });
}
const hrefOf = (x) => textOf(arr(x?.href)[0] ?? x);

/** Encontra os calendários de uma conta CalDAV. */
export async function caldavDiscover(base, user, pass) {
  const abs = (h, b) => new URL(h, b).toString();
  const find = async (url, props, depth = 0) => {
    const r = await dav(url, { depth, user, pass, body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop>${props}</d:prop></d:propfind>` });
    if (r.status >= 400) throw Object.assign(new Error(`O servidor respondeu ${r.status} em ${url}`), { status: 400 });
    return { list: responses(await r.text()), url: r.url || url };
  };
  let principal;
  for (const u of [base, abs('/.well-known/caldav', base)]) {
    try {
      const { list, url } = await find(u, '<d:current-user-principal/>');
      const h = hrefOf(list.find((x) => x.prop['current-user-principal'])?.prop['current-user-principal']);
      if (h) { principal = abs(h, url); break; }
    } catch (e) { if (/recusou/.test(e.message)) throw e; }
  }
  if (!principal) throw Object.assign(new Error('Não encontrei o calendário neste endereço. Confirma o endereço CalDAV.'), { status: 400 });
  const { list: pl, url: purl } = await find(principal, '<c:calendar-home-set/>');
  const home = abs(hrefOf(pl[0]?.prop['calendar-home-set']) || principal, purl);
  const { list, url: hurl } = await find(home, '<d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/>', 1);
  return list.filter((x) => x.prop.resourcetype && 'calendar' in x.prop.resourcetype).filter((x) => {
    const comps = arr(x.prop['supported-calendar-component-set']?.comp).map((c) => c['@_name']);
    return !comps.length || comps.includes('VEVENT');
  }).map((x, i) => ({
    href: abs(x.href, hurl),
    name: textOf(x.prop.displayname) || `Calendário ${i + 1}`,
    color: (textOf(x.prop['calendar-color']).match(/^#[0-9a-f]{6}/i) || [PALETTE[i % PALETTE.length]])[0],
    enabled: true,
  }));
}

async function caldavRange(cal, user, pass, from, to) {
  const body = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${toIcalUtc(from)}" end="${toIcalUtc(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const r = await dav(cal.href, { method: 'REPORT', depth: 1, body, user, pass });
  if (r.status >= 400) throw new Error(`${cal.name}: o servidor respondeu ${r.status}`);
  return responses(await r.text()).filter((x) => x.prop['calendar-data']).map((x) => ({
    href: new URL(x.href, cal.href).toString(), etag: textOf(x.prop.getetag), ics: textOf(x.prop['calendar-data']),
  }));
}

// ---------- Google ----------
const G_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const G_TOKEN = 'https://oauth2.googleapis.com/token';
const G_API = 'https://www.googleapis.com/calendar/v3';
const G_SCOPE = 'https://www.googleapis.com/auth/calendar';

function fromGoogle(g) {
  const allDay = Boolean(g.start?.date);
  const p = g.extendedProperties?.private || {};
  const kind = KINDS.has(p.mailroomKind) ? p.mailroomKind : /^\s*(milestone|marco)\s*[:·-]/i.test(g.summary || '') ? 'milestone' : /^\s*(deadline|prazo)\s*[:·-]/i.test(g.summary || '') ? 'deadline' : 'event';
  return {
    title: g.summary || '(sem título)', allDay,
    start: allDay ? g.start.date : new Date(g.start?.dateTime).toISOString(),
    end: allDay ? g.end?.date || addDaysStr(g.start.date, 1) : new Date(g.end?.dateTime || g.start?.dateTime).toISOString(),
    location: g.location || '', notes: g.description || '', kind, projectId: p.mailroomProject || '', ref: p.mailroomRef || '',
    recurring: Boolean(g.recurringEventId), url: g.htmlLink || '',
  };
}
function toGoogle(e) {
  return {
    summary: e.title, location: e.location || '', description: e.notes || '',
    start: e.allDay ? { date: e.start, dateTime: null } : { dateTime: e.start, date: null },
    end: e.allDay ? { date: e.end, dateTime: null } : { dateTime: e.end, date: null },
    extendedProperties: { private: { mailroomKind: e.kind || 'event', mailroomProject: e.projectId || '', mailroomRef: e.ref || '' } },
  };
}

// ---------- módulo ----------
/**
 * @param {object} o
 * @param {object} o.store         getData/setData
 * @param {Function} o.accs        contas de correio atuais
 * @param {Function} o.funnel      () => pipeline.overview()
 * @param {Function} o.isDemo
 */
export function createCalendar({ store, accs, funnel, isDemo }) {
  const getCfg = async () => ({ caldav: {}, google: null, defaultTarget: 'local', hidden: [], ...((await store.getData('calendar')) || {}) });
  let chain = Promise.resolve();
  const editCfg = (fn) => (chain = chain.then(async () => { const c = await getCfg(); const v = await fn(c); await store.setData('calendar', c); return v; }));
  const getLocal = async () => (await store.getData('events')) || [];
  const editLocal = (fn) => (chain = chain.then(async () => { const l = await getLocal(); const v = await fn(l); await store.setData('events', l); return v; }));
  const getProjects = async () => (await store.getData('projects')) || [];
  const editProjects = (fn) => (chain = chain.then(async () => { const l = await getProjects(); const v = await fn(l); await store.setData('projects', l); return v; }));

  // Cache curta por fonte e intervalo: a vista muda muito de semana para semana.
  const cache = new Map();
  const cached = async (key, ms, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.v;
    const v = await fn(); cache.set(key, { at: Date.now(), v });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return v;
  };
  const invalidate = (prefix = '') => { for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k); };

  const accFor = (id) => {
    const a = accs().find((x) => x.id === id);
    if (!a) throw Object.assign(new Error(`Conta desconhecida: ${id}`), { status: 400 });
    return a;
  };
  const davCreds = (a, c) => ({ user: c?.user || a.imap?.user || a.address, pass: a.imap?.pass });
  // Endereço CalDAV provável a partir do servidor de correio.
  const guessDav = (a) => {
    const h = a.imap?.host || '';
    if (/spacemail\.com$/i.test(h)) return 'https://caldav.spacemail.com/';
    if (/gmail\.com$/i.test(h)) return '';
    return h ? `https://${h}:2080/` : ''; // cPanel (cpdavd)
  };

  // ----- Google OAuth -----
  const pending = new Map(); // state -> { verifier, redirect, at }
  let refreshing = null; // vários calendários a carregar ao mesmo tempo partilham a mesma renovação
  async function gToken(cfg) {
    const g = cfg.google;
    if (!g?.tokens?.refresh_token) throw Object.assign(new Error('O Google Calendar não está ligado'), { status: 400 });
    if (g.tokens.access_token && g.tokens.expiry > Date.now() + 60e3) return g.tokens.access_token;
    return (refreshing ||= gRefresh(g).finally(() => { refreshing = null; }));
  }
  async function gRefresh(g) {
    const r = await fetch(G_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret || '', refresh_token: g.tokens.refresh_token, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(`Google: ${j.error_description || j.error || r.status}. Volta a ligar a conta nas Definições.`), { status: 400 });
    await editCfg((c) => { c.google.tokens = { ...c.google.tokens, access_token: j.access_token, expiry: Date.now() + (j.expires_in || 3600) * 1000 }; });
    return j.access_token;
  }
  async function gFetch(path, init = {}) {
    const cfg = await getCfg();
    const token = await gToken(cfg);
    const r = await fetch(`${G_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`Google: ${j.error?.message || r.status}`), { status: r.status === 404 ? 404 : 400 });
    return j;
  }
  async function gCalendars() {
    const j = await gFetch('/users/me/calendarList?minAccessRole=reader&maxResults=250');
    return (j.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor || '#3b6fd8', primary: Boolean(c.primary), writable: ['owner', 'writer'].includes(c.accessRole), enabled: Boolean(c.primary || c.selected) }));
  }

  // ----- fontes -----
  function sourcesOf(cfg) {
    const list = [{ key: 'local', type: 'local', name: 'mailroom', color: '#77736c', writable: true }];
    for (const [accId, c] of Object.entries(cfg.caldav || {})) {
      const a = accs().find((x) => x.id === accId); if (!a) continue;
      for (const cal of c.calendars || []) list.push({ key: `caldav:${accId}:${cal.href}`, type: 'caldav', account: accId, href: cal.href, name: `${cal.name} · ${a.address}`, color: cal.color, writable: true, enabled: cal.enabled !== false });
    }
    for (const cal of cfg.google?.calendars || []) list.push({ key: `google:${cal.id}`, type: 'google', calId: cal.id, name: `${cal.name} · Google`, color: cal.color, writable: cal.writable, enabled: cal.enabled !== false });
    list.push({ key: 'funnel', type: 'funnel', name: 'Funil', color: '#b4441c', writable: false });
    return list;
  }

  function funnelItems(ov, from, to) {
    const out = [];
    const streams = Object.fromEntries((ov.streams || []).map((s) => [s.id, s]));
    const groups = new Map();
    const add = (stream, day, kind, label, who) => {
      const k = `${stream}|${day}|${kind}`;
      if (!groups.has(k)) groups.set(k, { stream, day, kind, label, who: [] });
      groups.get(k).who.push(who);
    };
    for (const c of ov.contacts || []) {
      const who = c.name || c.org || c.email;
      if (c.nextAction?.due && ['contactado', 'followup', 'respondeu', 'conversa'].includes(c.status)) add(c.stream, ymd(new Date(c.nextAction.due)), 'deadline', 'Follow-up', who);
      if (c.lastReplyAt) add(c.stream, ymd(new Date(c.lastReplyAt)), 'milestone', 'Resposta', who);
      if (c.firstContactAt) add(c.stream, ymd(new Date(c.firstContactAt)), 'event', 'Pitch', who);
    }
    for (const g of groups.values()) {
      const d = new Date(`${g.day}T12:00:00`);
      if (d < from || d > to) continue;
      const sname = streams[g.stream]?.name || g.stream;
      const n = g.who.length;
      const title = n === 1 ? `${g.label}: ${g.who[0]}` : `${n} ${g.label === 'Pitch' ? 'pitches' : g.label === 'Resposta' ? 'respostas' : 'follow-ups'}`;
      out.push({
        id: encId({ s: 'funnel', e: `${g.stream}|${g.day}|${g.kind}` }), source: 'funnel', readonly: true,
        title: `${title} · ${sname.split('·')[0].trim()}`, allDay: true, start: g.day, end: addDaysStr(g.day, 1),
        kind: g.kind, funnelId: g.stream, notes: n > 1 ? g.who.join(', ') : '', location: '', projectId: '',
      });
    }
    return out;
  }

  async function events(fromS, toS) {
    const from = new Date(fromS), to = new Date(toS);
    if (Number.isNaN(+from) || Number.isNaN(+to) || to - from > 400 * DAY) throw Object.assign(new Error('Intervalo inválido'), { status: 400 });
    const cfg = await getCfg();
    const errors = [];
    const out = [];
    // local
    for (const e of await getLocal()) {
      const s = e.allDay ? new Date(`${e.start}T00:00:00`) : new Date(e.start), en = e.allDay ? new Date(`${e.end}T00:00:00`) : new Date(e.end);
      if (en < from || s > to) continue;
      out.push({ ...e, id: encId({ s: 'local', e: e.id }), source: 'local' });
    }
    const jobs = [];
    // CalDAV
    if (!isDemo()) for (const [accId, c] of Object.entries(cfg.caldav || {})) {
      const a = accs().find((x) => x.id === accId); if (!a) continue;
      const { user, pass } = davCreds(a, c);
      for (const cal of (c.calendars || []).filter((x) => x.enabled !== false)) {
        const key = `caldav:${accId}:${cal.href}`;
        jobs.push(cached(`${key}|${fromS}|${toS}`, 60e3, () => caldavRange(cal, user, pass, from, to)).then((items) => {
          for (const it of items) for (const ev of parseIcs(it.ics, from, to)) {
            out.push({ ...ev, id: encId({ s: 'caldav', a: accId, c: cal.href, h: it.href }), etag: it.etag, source: key, calendar: cal.name, color: cal.color, readonly: false });
          }
        }).catch((e) => errors.push(`${cal.name} (${a.address}): ${e.message}`)));
      }
    }
    // Google
    if (!isDemo() && cfg.google?.tokens?.refresh_token) for (const cal of (cfg.google.calendars || []).filter((x) => x.enabled !== false)) {
      const key = `google:${cal.id}`;
      const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' });
      jobs.push(cached(`${key}|${fromS}|${toS}`, 60e3, () => gFetch(`/calendars/${encodeURIComponent(cal.id)}/events?${q}`)).then((j) => {
        for (const g of j.items || []) if (g.status !== 'cancelled') out.push({ ...fromGoogle(g), id: encId({ s: 'google', c: cal.id, e: g.id }), source: key, calendar: cal.name, color: cal.color, readonly: !cal.writable });
      }).catch((e) => errors.push(`Google · ${cal.name}: ${e.message}`)));
    }
    // funil
    jobs.push(Promise.resolve().then(async () => out.push(...funnelItems(await funnel(), from, to))).catch((e) => errors.push(`Funil: ${e.message}`)));
    await Promise.all(jobs);
    const hidden = new Set(cfg.hidden || []);
    out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    return { events: out.filter((e) => !hidden.has(e.source)), errors, sources: sourcesOf(cfg).map((s) => ({ ...s, hidden: hidden.has(s.key) })), defaultTarget: cfg.defaultTarget };
  }

  // ----- escrita -----
  async function create(body) {
    const e = normalizeInput(body);
    const cfg = await getCfg();
    const target = String(body.target || cfg.defaultTarget || 'local');
    if (target === 'local') {
      return editLocal((l) => { const ev = { id: crypto.randomUUID(), ...e, createdAt: new Date().toISOString() }; l.push(ev); return { ...ev, id: encId({ s: 'local', e: ev.id }), source: 'local' }; });
    }
    if (target.startsWith('caldav:')) {
      const [, accId, ...rest] = target.split(':'); const href = rest.join(':');
      const a = accFor(accId); const c = cfg.caldav?.[accId];
      if (!c?.calendars?.some((x) => x.href === href)) throw Object.assign(new Error('Calendário desconhecido'), { status: 400 });
      const { ics, uid } = buildIcs(e);
      const url = new URL(`${encodeURIComponent(uid)}.ics`, href.endsWith('/') ? href : `${href}/`).toString();
      const r = await dav(url, { method: 'PUT', body: ics, ...davCreds(a, c), headers: { 'If-None-Match': '*' } });
      if (r.status >= 300) throw Object.assign(new Error(`O servidor de calendário respondeu ${r.status}`), { status: 400 });
      invalidate(`caldav:${accId}:${href}`);
      return { ok: true };
    }
    if (target.startsWith('google:')) {
      const calId = target.slice(7);
      await gFetch(`/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', body: JSON.stringify(toGoogle(e)) });
      invalidate(`google:${calId}`);
      return { ok: true };
    }
    throw Object.assign(new Error('Destino desconhecido'), { status: 400 });
  }

  async function update(id, body) {
    const ref = decId(id);
    if (ref.s === 'funnel') throw Object.assign(new Error('As datas do funil mudam-se no Funil'), { status: 400 });
    const e = normalizeInput(body);
    if (ref.s === 'local') return editLocal((l) => { const x = l.find((y) => y.id === ref.e); if (!x) throw Object.assign(new Error('Evento não encontrado'), { status: 404 }); Object.assign(x, e, { updatedAt: new Date().toISOString() }); return { ok: true }; });
    const cfg = await getCfg();
    if (ref.s === 'caldav') {
      const a = accFor(ref.a); const creds = davCreds(a, cfg.caldav?.[ref.a]);
      const g = await dav(ref.h, { method: 'GET', ...creds });
      if (g.status >= 300) throw Object.assign(new Error(`Não consegui ler o evento (${g.status})`), { status: 400 });
      const { ics, recurring } = buildIcs(e, await g.text());
      const etag = g.headers.get('etag');
      const r = await dav(ref.h, { method: 'PUT', body: ics, ...creds, headers: etag ? { 'If-Match': etag } : {} });
      if (r.status === 412) throw Object.assign(new Error('O evento foi alterado noutro sítio. Atualiza e tenta de novo.'), { status: 409 });
      if (r.status >= 300) throw Object.assign(new Error(`O servidor de calendário respondeu ${r.status}`), { status: 400 });
      invalidate(`caldav:${ref.a}:${ref.c}`);
      return { ok: true, recurring };
    }
    if (ref.s === 'google') {
      await gFetch(`/calendars/${encodeURIComponent(ref.c)}/events/${encodeURIComponent(ref.e)}`, { method: 'PATCH', body: JSON.stringify(toGoogle(e)) });
      invalidate(`google:${ref.c}`);
      return { ok: true };
    }
    throw Object.assign(new Error('Evento desconhecido'), { status: 400 });
  }

  async function remove(id) {
    const ref = decId(id);
    if (ref.s === 'funnel') throw Object.assign(new Error('As datas do funil mudam-se no Funil'), { status: 400 });
    if (ref.s === 'local') return editLocal((l) => { const i = l.findIndex((y) => y.id === ref.e); if (i >= 0) l.splice(i, 1); return { ok: true }; });
    const cfg = await getCfg();
    if (ref.s === 'caldav') {
      const r = await dav(ref.h, { method: 'DELETE', ...davCreds(accFor(ref.a), cfg.caldav?.[ref.a]) });
      if (r.status >= 300 && r.status !== 404) throw Object.assign(new Error(`O servidor de calendário respondeu ${r.status}`), { status: 400 });
      invalidate(`caldav:${ref.a}:${ref.c}`);
      return { ok: true };
    }
    if (ref.s === 'google') {
      await gFetch(`/calendars/${encodeURIComponent(ref.c)}/events/${encodeURIComponent(ref.e)}`, { method: 'DELETE' }).catch((e) => { if (e.status !== 404) throw e; });
      invalidate(`google:${ref.c}`);
      return { ok: true };
    }
    throw Object.assign(new Error('Evento desconhecido'), { status: 400 });
  }

  // ----- configuração -----
  async function publicConfig(redirect) {
    const cfg = await getCfg();
    return {
      defaultTarget: cfg.defaultTarget, hidden: cfg.hidden || [],
      sources: sourcesOf(cfg),
      caldav: accs().filter((a) => !/gmail\.com$/i.test(a.imap?.host || '')).map((a) => ({
        account: a.id, address: a.address, guess: guessDav(a),
        url: cfg.caldav?.[a.id]?.url || '', calendars: cfg.caldav?.[a.id]?.calendars || [], connected: Boolean(cfg.caldav?.[a.id]),
      })),
      google: { clientId: cfg.google?.clientId || '', hasSecret: Boolean(cfg.google?.clientSecret), connected: Boolean(cfg.google?.tokens?.refresh_token), email: cfg.google?.email || '', calendars: cfg.google?.calendars || [], redirect },
    };
  }
  async function setConfig(b) {
    await editCfg((c) => {
      if (typeof b.defaultTarget === 'string') c.defaultTarget = b.defaultTarget;
      if (Array.isArray(b.hidden)) c.hidden = b.hidden.map(String).slice(0, 100);
      if (b.google) {
        c.google ||= {};
        if (typeof b.google.clientId === 'string') c.google.clientId = b.google.clientId.trim();
        if (typeof b.google.clientSecret === 'string' && b.google.clientSecret.trim()) c.google.clientSecret = b.google.clientSecret.trim();
        if (Array.isArray(b.google.enabled)) for (const cal of c.google.calendars || []) cal.enabled = b.google.enabled.includes(cal.id);
      }
    });
    invalidate();
    return { ok: true };
  }
  async function connectCaldav(accId, url) {
    const a = accFor(accId);
    const u = String(url || guessDav(a)).trim();
    if (!/^https?:\/\//.test(u)) throw Object.assign(new Error('Indica o endereço CalDAV (começa por https://)'), { status: 400 });
    const calendars = await caldavDiscover(u, a.imap?.user || a.address, a.imap?.pass);
    if (!calendars.length) throw Object.assign(new Error('A conta não tem calendários de eventos'), { status: 400 });
    await editCfg((c) => {
      const prev = c.caldav?.[accId]?.calendars || [];
      c.caldav = { ...(c.caldav || {}), [accId]: { url: u, calendars: calendars.map((x) => ({ ...x, enabled: prev.find((p) => p.href === x.href)?.enabled ?? true })) } };
      if (c.defaultTarget === 'local' && calendars[0]) c.defaultTarget = `caldav:${accId}:${calendars[0].href}`;
    });
    invalidate(`caldav:${accId}`);
    return { ok: true, calendars };
  }
  async function setCaldavEnabled(accId, hrefs) {
    await editCfg((c) => { for (const cal of c.caldav?.[accId]?.calendars || []) cal.enabled = hrefs.includes(cal.href); });
    invalidate(`caldav:${accId}`);
    return { ok: true };
  }
  async function disconnectCaldav(accId) {
    await editCfg((c) => { delete c.caldav?.[accId]; if (String(c.defaultTarget).startsWith(`caldav:${accId}:`)) c.defaultTarget = 'local'; });
    invalidate(`caldav:${accId}`);
    return { ok: true };
  }
  async function googleAuthUrl(redirect) {
    const cfg = await getCfg();
    if (!cfg.google?.clientId) throw Object.assign(new Error('Falta o ID de cliente do Google'), { status: 400 });
    const state = crypto.randomBytes(16).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    pending.set(state, { verifier, redirect, at: Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60e3) pending.delete(k);
    const q = new URLSearchParams({ client_id: cfg.google.clientId, redirect_uri: redirect, response_type: 'code', scope: `${G_SCOPE} openid email`, access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state });
    return { url: `${G_AUTH}?${q}` };
  }
  async function googleCallback({ code, state, error }) {
    if (error) throw new Error(`O Google recusou: ${error}`);
    const p = pending.get(state); pending.delete(state);
    if (!p) throw new Error('O pedido expirou. Volta a carregar em «Ligar ao Google».');
    const cfg = await getCfg();
    const r = await fetch(G_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret || '', redirect_uri: p.redirect, grant_type: 'authorization_code', code_verifier: p.verifier }), signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) throw new Error(`Google: ${j.error_description || j.error || 'sem autorização de acesso offline'}`);
    let email = '';
    try { email = JSON.parse(Buffer.from(String(j.id_token || '').split('.')[1] || '', 'base64url').toString()).email || ''; } catch { /* sem e-mail */ }
    await editCfg((c) => { c.google.tokens = { access_token: j.access_token, refresh_token: j.refresh_token, expiry: Date.now() + (j.expires_in || 3600) * 1000 }; c.google.email = email; });
    const cals = await gCalendars();
    await editCfg((c) => { c.google.calendars = cals; if (c.defaultTarget === 'local') { const prim = cals.find((x) => x.primary && x.writable); if (prim) c.defaultTarget = `google:${prim.id}`; } });
    invalidate('google:');
    return { email, calendars: cals.length };
  }
  async function googleRefreshCalendars() {
    const cals = await gCalendars();
    await editCfg((c) => { const prev = c.google.calendars || []; c.google.calendars = cals.map((x) => ({ ...x, enabled: prev.find((p) => p.id === x.id)?.enabled ?? x.enabled })); });
    invalidate('google:');
    return { ok: true };
  }
  async function disconnectGoogle() {
    await editCfg((c) => { if (c.google) { delete c.google.tokens; c.google.calendars = []; c.google.email = ''; } if (String(c.defaultTarget).startsWith('google:')) c.defaultTarget = 'local'; });
    invalidate('google:');
    return { ok: true };
  }

  // ----- projetos -----
  const cleanProject = (b) => ({
    name: String(b.name || '').trim().slice(0, 120) || 'Projeto sem nome',
    color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : PALETTE[Math.floor(Math.random() * PALETTE.length)],
    start: isDateOnly(b.start) ? b.start : '', end: isDateOnly(b.end) ? b.end : '',
    notes: String(b.notes || '').slice(0, 4000), done: Boolean(b.done),
  });
  const projects = {
    list: getProjects,
    create: (b) => editProjects((l) => { const p = { id: crypto.randomUUID(), ...cleanProject(b), createdAt: new Date().toISOString() }; l.push(p); return p; }),
    update: (id, b) => editProjects((l) => { const p = l.find((x) => x.id === id); if (!p) throw Object.assign(new Error('Projeto não encontrado'), { status: 404 }); Object.assign(p, cleanProject({ ...p, ...b })); return p; }),
    remove: async (id) => {
      await editProjects((l) => { const i = l.findIndex((x) => x.id === id); if (i >= 0) l.splice(i, 1); });
      // Os marcos locais do projeto vão com ele; os de outros calendários ficam, sem projeto.
      await editLocal((l) => { for (let i = l.length - 1; i >= 0; i--) if (l[i].projectId === id) l.splice(i, 1); });
      return { ok: true };
    },
  };

  return { events, create, update, remove, publicConfig, setConfig, connectCaldav, setCaldavEnabled, disconnectCaldav, googleAuthUrl, googleCallback, googleRefreshCalendars, disconnectGoogle, projects };
}
