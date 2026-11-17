// @mailroom/core — correio por tópicos com assistente de IA.
// Router Express + web component <mail-room>, para usar sozinho ou dentro de outra plataforma.
//
//   import { createMailModule, fileStore } from '@mailroom/core';
//   const mail = createMailModule({ accounts, ai: { provider: 'anthropic', apiKey }, store: fileStore('./data') });
//   app.use('/mail', requireLogin, mail.router);
//
//   <script type="module" src="/mail/client.js"></script>
//   <mail-room api="/mail"></mail-room>
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as mail from './lib/mail.js';
import * as demo from './lib/demo.js';
import { createAI } from './lib/ai.js';
import { PRESETS, listModels } from './lib/providers.js';
import { buildTopics } from './lib/threads.js';
import { memoryStore, fileStore } from './lib/stores.js';

export { memoryStore, fileStore, PRESETS };

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'client');

export const DEFAULT_SETTINGS = {
  name: 'David Ferreira Marques',
  about: 'Maker, músico, designer e formador no Porto. monco.io: ferramentas e oficinas de educação (3D Monco, Pixel3D, apps com IA para professores). bitnik.games: pequena editora independente de jogos de tabuleiro (Bulbous, print & play).',
  voice: 'Profissional mas acessível, direto ao assunto, sem linguagem de marketing excessiva. Ajusta a formalidade ao contexto: mais curto em follow-ups, mais cuidado em primeiros contactos e comunicações institucionais. Português de Portugal quando escreve em PT.',
};

/**
 * @param {object}   opts
 * @param {Array}    opts.accounts      contas IMAP/SMTP (ver accounts.example.json). Ignorado em demo.
 * @param {object}   [opts.ai]          { provider: 'anthropic'|'openai', apiKey, model, baseURL } por omissão.
 * @param {boolean}  [opts.lockAI]      true = o utilizador não pode mudar o fornecedor nas Definições.
 * @param {object}   [opts.store]       { getDrafts, setDrafts, getSettings, setSettings }. Por omissão: memória.
 * @param {object}   [opts.settings]    definições por omissão (name, about, voice).
 * @param {boolean}  [opts.demo]        usa a caixa fictícia.
 * @param {Function} [opts.auth]        middleware Express aplicado a todas as rotas.
 * @param {Function} [opts.onSend]      callback(account, { to, subject }) após cada envio.
 */
export function createMailModule(opts = {}) {
  // Contas reais (mutáveis quando opts.onAccountsChange existe) e modo demo dinâmico.
  let userAccounts = [...(opts.accounts || [])];
  const isDemo = () => Boolean(opts.demo) || (Boolean(opts.demoWhenEmpty) && userAccounts.length === 0);
  const accs = () => (isDemo() ? demo.demoAccounts : userAccounts);
  const editable = typeof opts.onAccountsChange === 'function';
  const store = opts.store || memoryStore();
  const defaults = { ...DEFAULT_SETTINGS, ...(opts.settings || {}) };
  // compatibilidade com a opção antiga `anthropic: { apiKey, model }`
  const baseAI = opts.ai || (opts.anthropic?.apiKey ? { provider: 'anthropic', ...opts.anthropic } : {});

  const rawSettings = async () => (await store.getSettings()) || {};
  const getSettings = async () => { const s = await rawSettings(); return { ...defaults, name: s.name ?? defaults.name, about: s.about ?? defaults.about, voice: s.voice ?? defaults.voice }; };
  const getDismissed = async () => (await rawSettings()).dismissed || {};
  const lastIncomingId = (t) => { const m = [...t.messages].reverse().find((x) => x.folder === 'INBOX') || t.messages.at(-1); return m.messageId || `${m.folder}-${m.uid}`; };
  const prefs = async () => ({ autoTopics: true, autoSuggest: true, ...((await rawSettings()).prefs || {}) });
  const aiConfig = async () => {
    if (opts.lockAI) return baseAI;
    const saved = (await rawSettings()).ai || {};
    return { ...baseAI, ...Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== '' && v != null)) };
  };
  const ai = createAI(aiConfig);

  const accById = (id) => {
    const a = accs().find((x) => x.id === id);
    if (!a) throw Object.assign(new Error(`Conta desconhecida: ${id}`), { status: 400 });
    return a;
  };

  let chain = Promise.resolve();
  const editDrafts = (fn) => (chain = chain.then(async () => { const d = await store.getDrafts(); const r = await fn(d); await store.setDrafts(r.drafts); return r.value; }));
  const addDrafts = (list) => editDrafts((d) => ({ drafts: [...list, ...d], value: list }));

  const fake = {
        list: async (acc, o) => demo.demoList(acc.id, o),
        get: async (acc, uid, folder) => demo.demoGet(acc.id, uid, folder),
        many: async (acc, refs) => refs.map((r) => demo.demoGet(acc.id, r.uid, r.folder)),
        seen: async (acc, uid, folder, on) => demo.demoSeen(acc.id, uid, on),
        send: async (acc, m) => { console.log('[demo] enviaria:', m.to, m.subject); return { messageId: 'demo' }; },
      };
  const real = {
        list: (acc, o) => mail.listMessages(acc, o),
        get: (acc, uid, folder) => mail.getMessage(acc, uid, folder),
        many: (acc, refs) => mail.getMany(acc, refs),
        seen: (acc, uid, folder, on) => mail.setFlag(acc, uid, folder, '\\Seen', on),
        send: (acc, m) => mail.sendMail(acc, m),
      };
  const io = Object.fromEntries(['list', 'get', 'many', 'seen', 'send'].map((k) => [k, (...a) => (isDemo() ? fake : real)[k](...a)]));

  // Caches de tópicos e resumos (memória, por instância).
  const topicIndex = new Map(); // id -> topic
  const summaryCache = new Map(); // `${id}|${lastMessageId}` -> { title, summary, priority, needsReply }
  const remember = (k, v) => { summaryCache.set(k, v); if (summaryCache.size > 1000) summaryCache.delete(summaryCache.keys().next().value); };

  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));
  if (opts.auth) router.use(opts.auth);

  const asset = (f) => fs.readFileSync(path.join(CLIENT_DIR, f), 'utf8');
  router.get('/client.js', (req, res) => res.type('js').send(asset('mailroom.js')));
  router.get('/client.css', (req, res) => res.type('css').send(asset('mailroom.css')));

  const h = (fn) => async (req, res) => {
    try { res.json(await fn(req, res)); }
    catch (e) { console.error('[mailroom]', e.message); res.status(e.status || 500).json({ error: e.message }); }
  };
  const targetsOf = (account) => (!account || account === 'all' ? accs() : [accById(account)]);

  router.get('/api/status', h(async () => {
    const cfg = await aiConfig();
    return {
      demo: isDemo(), ai: await ai.enabled(), accountsEditable: editable, version: opts.version || '', aiModel: cfg.model || (cfg.provider === 'anthropic' ? PRESETS.anthropic.model : ''),
      accounts: accs().map(({ id, label, address, color }) => ({ id, label, address, color })),
      formats: ai.publishFormats, prefs: await prefs(),
    };
  }));

  // ---------- correio ----------
  router.get('/api/messages', h(async (req) => {
    const { account = 'all', folder = 'INBOX', q = '', limit = 40 } = req.query;
    const targets = targetsOf(account);
    if (req.query.fresh && !isDemo()) targets.forEach((a) => mail.invalidateAccount(a));
    const lists = await Promise.allSettled(targets.map((a) => io.list(a, { folder, query: q, limit: Number(limit) })));
    const errors = [];
    const items = lists.flatMap((r, i) => (r.status === 'fulfilled' ? r.value : (errors.push(`${targets[i].label}: ${r.reason.message}`), [])));
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { items: items.map(({ preview, ...m }) => m), errors };
  }));

  router.get('/api/message/:account/:uid', h(async (req) => {
    const acc = accById(req.params.account);
    const folder = req.query.folder || 'INBOX';
    const m = await io.get(acc, req.params.uid, folder);
    if (req.query.markSeen !== '0' && folder === 'INBOX') io.seen(acc, req.params.uid, folder, true).catch(() => {});
    return m;
  }));

  router.post('/api/message/:account/:uid/seen', h(async (req) => {
    await io.seen(accById(req.params.account), req.params.uid, req.body.folder || 'INBOX', req.body.seen !== false);
    return { ok: true };
  }));

  router.post('/api/send', h(async (req) => {
    const { account, to, cc, bcc, subject, text, inReplyTo, references, draftId } = req.body;
    if (!to || !subject) throw Object.assign(new Error('Falta destinatário ou assunto'), { status: 400 });
    const acc = accById(account);
    const r = await io.send(acc, { to, cc, bcc, subject, text, inReplyTo, references });
    if (draftId) await editDrafts((d) => ({ drafts: d.filter((x) => x.id !== draftId) }));
    opts.onSend?.(acc, { to, subject });
    return { ok: true, ...r };
  }));

  // ---------- tópicos ----------
  router.get('/api/topics', h(async (req) => {
    const { account = 'all', q = '' } = req.query;
    const targets = targetsOf(account);
    if (req.query.fresh && !isDemo()) targets.forEach((a) => mail.invalidateAccount(a));
    const errors = [];
    const load = async (a, folder) => io.list(a, { folder, query: q, limit: 60 }).catch((e) => (errors.push(`${a.label}: ${e.message}`), []));
    const [inbox, sent] = await Promise.all(['INBOX', 'Sent'].map(async (f) => (await Promise.all(targets.map((a) => load(a, f)))).flat()));
    const all = buildTopics(inbox, sent);
    all.forEach((t) => topicIndex.set(t.id, t));
    // Arrumados: escondidos até chegar uma mensagem nova (de outra pessoa) nessa conversa.
    const dismissed = await getDismissed();
    const isDismissed = (t) => dismissed[t.id] && dismissed[t.id] === lastIncomingId(t);
    const showDismissed = req.query.dismissed === '1';
    const dismissedCount = all.filter(isDismissed).length;
    const topics = all.filter((t) => (showDismissed ? isDismissed(t) : !isDismissed(t))).slice(0, Number(req.query.limit || 30));

    const wantAI = req.query.ai !== '0' && (await prefs()).autoTopics;
    const missing = topics.filter((t) => !summaryCache.has(`${t.id}|${t.lastMessageId}`));
    if (wantAI && missing.length) {
      try {
        for (let i = 0; i < missing.length; i += 15) {
          const batch = missing.slice(i, i + 15);
          const out = await ai.topics(await getSettings(), batch.map((t) => ({
            id: t.id, subject: t.subject, people: t.people.map((p) => p.name || p.address), count: t.count, unread: t.unread,
            lastFromOther: t.lastFromOther,
            latest: (t.messages.at(-1).preview || t.messages.at(-1).snippet || '').slice(0, 1200),
            earlier: t.messages.slice(0, -1).slice(-3).map((m) => `${m.folder === 'Sent' ? 'eu' : m.from?.[0]?.name || m.from?.[0]?.address}: ${m.snippet}`),
          })));
          for (const s of out || []) { const t = batch.find((x) => x.id === s.id); if (t) remember(`${t.id}|${t.lastMessageId}`, s); }
        }
      } catch (e) { errors.push(`IA: ${e.message}`); }
    }
    return {
      errors,
      dismissedCount,
      topics: topics.map(({ messages, ...t }) => ({
        ...t,
        ai: summaryCache.get(`${t.id}|${t.lastMessageId}`) || null,
        messages: messages.map(({ preview, ...m }) => m),
      })),
    };
  }));

  // Arrumar / repor um tópico
  router.post('/api/topics/dismiss', h(async (req) => {
    const t = topicIndex.get(req.body.id);
    if (!t) throw Object.assign(new Error('Tópico não encontrado — atualiza a lista'), { status: 404 });
    const cur = await rawSettings();
    const d = { ...(cur.dismissed || {}) };
    if (req.body.undo) delete d[t.id];
    else {
      d[t.id] = lastIncomingId(t);
      // Também marca como lidas as mensagens recebidas da conversa.
      for (const m of t.messages) if (m.folder === 'INBOX' && !m.seen) { io.seen(accById(t.account), m.uid, 'INBOX', true).catch(() => {}); m.seen = true; }
    }
    // Guarda no máximo os 2000 mais recentes.
    const keys = Object.keys(d);
    if (keys.length > 2000) keys.slice(0, keys.length - 2000).forEach((k) => delete d[k]);
    await store.setSettings({ ...cur, dismissed: d });
    return { ok: true };
  }));

  // Conversa completa (modo focado)
  router.get('/api/topic', h(async (req) => {
    const t = topicIndex.get(req.query.id);
    if (!t) throw Object.assign(new Error('Tópico não encontrado — atualiza a lista'), { status: 404 });
    const msgs = await io.many(accById(t.account), t.messages.map((m) => ({ uid: m.uid, folder: m.folder })));
    const last = t.messages.at(-1);
    if (last.folder === 'INBOX') for (const m of t.messages) if (m.folder === 'INBOX' && !m.seen) { io.seen(accById(t.account), m.uid, 'INBOX', true).catch(() => {}); m.seen = true; }
    return { ...t, ai: summaryCache.get(`${t.id}|${t.lastMessageId}`) || null, messages: msgs.map((m) => ({ ...m, folder: m.folder })) };
  }));

  // ---------- rascunhos ----------
  router.get('/api/drafts', h(() => store.getDrafts()));
  router.post('/api/drafts', h(async (req) => (await addDrafts([{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), source: 'manual', ...req.body }]))[0]));
  router.put('/api/drafts/:id', h((req) => editDrafts((d) => {
    const x = d.find((y) => y.id === req.params.id);
    if (!x) throw Object.assign(new Error('Rascunho não encontrado'), { status: 404 });
    Object.assign(x, req.body, { id: x.id });
    return { drafts: d, value: x };
  })));
  router.delete('/api/drafts/:id', h(async (req) => { await editDrafts((d) => ({ drafts: d.filter((x) => x.id !== req.params.id) })); return { ok: true }; }));

  // ---------- definições ----------
  router.get('/api/settings', h(async () => ({ ...(await getSettings()), prefs: await prefs() })));
  router.put('/api/settings', h(async (req) => {
    const { name, about, voice, prefs: p } = req.body;
    const cur = await rawSettings();
    await store.setSettings({ ...cur, name, about, voice, ...(p ? { prefs: { ...(cur.prefs || {}), ...p } } : {}) });
    return { ...(await getSettings()), prefs: await prefs() };
  }));

  // Fornecedor de IA. A chave nunca volta para o browser.
  const aiPublic = async () => {
    const cfg = await aiConfig();
    const saved = (await rawSettings()).ai || {};
    return {
      locked: Boolean(opts.lockAI),
      preset: saved.preset || (cfg.provider === 'anthropic' ? 'anthropic' : cfg.provider ? 'custom' : ''),
      provider: cfg.provider || '', model: cfg.model || '', baseURL: cfg.baseURL || '',
      hasKey: Boolean(cfg.apiKey), keyHint: cfg.apiKey ? `…${cfg.apiKey.slice(-4)}` : '',
      keySource: saved.apiKey ? 'definições' : cfg.apiKey ? 'servidor' : '',
      enabled: await ai.enabled(),
      presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, provider: v.provider, baseURL: v.baseURL, model: v.model }])),
    };
  };
  router.get('/api/ai-settings', h(aiPublic));
  router.put('/api/ai-settings', h(async (req) => {
    if (opts.lockAI) throw Object.assign(new Error('O fornecedor de IA é gerido pela plataforma'), { status: 403 });
    const { preset, provider, model, baseURL, apiKey, clearKey } = req.body;
    if (provider && !['anthropic', 'openai'].includes(provider)) throw Object.assign(new Error('Fornecedor inválido'), { status: 400 });
    if (baseURL && !/^https?:\/\//.test(baseURL)) throw Object.assign(new Error('URL inválido'), { status: 400 });
    const cur = await rawSettings();
    const next = { ...(cur.ai || {}), preset, provider, model, baseURL };
    if (apiKey) next.apiKey = apiKey.trim();
    if (clearKey) delete next.apiKey;
    await store.setSettings({ ...cur, ai: next });
    summaryCache.clear();
    return aiPublic();
  }));
  router.get('/api/ai-settings/models', h(async () => { try { return { models: await listModels(await aiConfig()) }; } catch { return { models: [] }; } }));
  router.post('/api/ai-settings/test', h(async () => {
    try { return await ai.test(); } catch (e) { return { ok: false, error: e.message }; }
  }));

  // ---------- IA ----------
  router.post('/api/ai/summarize', h(async (req) => {
    const acc = accById(req.body.account);
    return ai.summarize(await getSettings(), await io.get(acc, req.body.uid, req.body.folder || 'INBOX'));
  }));
  router.post('/api/ai/replies', h(async (req) => {
    const acc = accById(req.body.account);
    const msg = await io.get(acc, req.body.uid, req.body.folder || 'INBOX');
    const thread = req.body.topicId ? topicIndex.get(req.body.topicId)?.messages || [] : [];
    return ai.replies(await getSettings(), msg, req.body.intent, acc, thread);
  }));
  router.post('/api/ai/research', h(async (req) => {
    const query = String(req.body.query || '').trim().slice(0, 200);
    if (query.length < 2) throw Object.assign(new Error('Seleciona pelo menos 2 caracteres'), { status: 400 });
    const targets = targetsOf(req.body.account);
    const lists = await Promise.all(targets.flatMap((a) => ['INBOX', 'Sent'].map((f) => io.list(a, { folder: f, query, limit: 10 }).catch(() => []))));
    const msgs = lists.flat().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
    const hits = msgs.map((m) => ({
      ref: `${m.account}:${m.folder}:${m.uid}`, account: m.account, folder: m.folder, uid: m.uid,
      from: m.from?.[0]?.name || m.from?.[0]?.address || '', to: m.to?.[0]?.name || m.to?.[0]?.address || '',
      date: String(m.date), subject: m.subject, preview: (m.preview || m.snippet || '').slice(0, 600),
    }));
    const r = await ai.research(await getSettings(), query, hits);
    const byRef = Object.fromEntries(hits.map((x) => [x.ref, x]));
    const ordered = [...(r.refs || []).map((x) => byRef[x]).filter(Boolean), ...hits.filter((x) => !(r.refs || []).includes(x.ref))];
    return { query, ...r, hits: ordered.map(({ preview, ...x }) => x) };
  }));
  router.post('/api/ai/triage', h(async (req) => {
    const lists = await Promise.all(targetsOf(req.body.account).map((a) => io.list(a, { folder: 'INBOX', limit: 40 })));
    const unread = lists.flat().filter((m) => !m.seen).slice(0, 40);
    if (!unread.length) return { resumo: 'Nada por ler.', itens: [] };
    const r = await ai.triage(await getSettings(), unread);
    const byRef = Object.fromEntries(unread.map((m) => [`${m.account}:${m.uid}`, m]));
    r.itens = (r.itens || []).map((i) => ({ ...i, msg: byRef[i.ref] })).filter((i) => i.msg);
    return r;
  }));
  router.post('/api/ai/pitch', h(async (req) => {
    const acc = accById(req.body.account);
    const out = await ai.pitch(await getSettings(), { ...req.body, account: acc });
    const batch = `pitch-${Date.now()}`;
    return addDrafts(out.map((p) => ({
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), source: 'pitch', batch,
      account: acc.id, to: p.to, subject: p.subject, text: p.body, note: p.angulo,
    })));
  }));
  router.post('/api/ai/publish', h(async (req) => ai.publish(await getSettings(), req.body)));

  router.post('/api/ai/agent', async (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    const send = (o) => res.write(JSON.stringify(o) + '\n');
    let created = 0;
    const tools = {
      list_messages: async ({ account, folder = 'INBOX', query = '', since, limit = 30 }) =>
        (await io.list(accById(account), { folder, query, since, limit: Math.min(limit, 50) }))
          .map(({ uid, subject, from, to, date, seen, snippet }) => ({ uid, subject, from, to, date, seen, snippet })),
      read_message: async ({ account, uid, folder = 'INBOX' }) => {
        const m = await io.get(accById(account), uid, folder);
        return { uid: m.uid, subject: m.subject, from: m.from, to: m.to, date: m.date, text: (m.text || '').slice(0, 8000) };
      },
      queue_draft: async ({ account, to, subject, body, in_reply_to_uid, note }) => {
        const acc = accById(account);
        let inReplyTo, references;
        if (in_reply_to_uid) {
          try { const m = await io.get(acc, in_reply_to_uid, 'INBOX'); inReplyTo = m.messageId; references = [...(m.references || []), m.messageId].filter(Boolean); } catch {}
        }
        const [d] = await addDrafts([{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), source: 'agente', account: acc.id, to, subject, text: body, note, inReplyTo, references }]);
        created++;
        send({ type: 'draft', draft: d });
        return { ok: true, queued: true, note: 'Rascunho em fila para revisão. Não foi enviado.' };
      },
    };
    try {
      const r = await ai.runAgent(await getSettings(), req.body.goal || '', { accounts: accs(), tools, onStep: (s) => send({ type: 'step', ...s }) });
      send({ type: 'done', summary: r.summary, drafts: created });
    } catch (e) {
      console.error('[mailroom agent]', e);
      send({ type: 'error', error: e.message });
    }
    res.end();
  });

  // ---------- contas (só quando a app anfitriã permite editar) ----------
  const publicAccount = (a) => ({
    id: a.id, label: a.label, address: a.address, color: a.color, fromName: a.fromName || '', signature: a.signature || '',
    imap: { host: a.imap?.host, port: a.imap?.port, user: a.imap?.user }, smtp: { host: a.smtp?.host, port: a.smtp?.port, user: a.smtp?.user },
    filterTo: a.filterTo || '', appendSent: Boolean(a.appendSent),
  });
  const PALETTE = ['#2f6f4f', '#c2571a', '#3b6fd8', '#8a4fb0', '#b0892f', '#2f8a8a'];
  router.get('/api/accounts', h(() => ({ editable, accounts: userAccounts.map(publicAccount) })));
  if (editable) {
    const changed = async () => { topicIndex.clear(); summaryCache.clear(); await opts.onAccountsChange(userAccounts); };
    router.post('/api/accounts', h(async (req) => {
      const b = req.body || {};
      const address = String(b.address || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw Object.assign(new Error('Endereço de e-mail inválido'), { status: 400 });
      const label = String(b.label || address.split('@')[1]).trim();
      const id = b.id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conta';
      const prev = userAccounts.find((a) => a.id === id);
      const pass = String(b.pass || '').trim() || prev?.imap?.pass;
      const user = String(b.user || address).trim();
      if (!pass) throw Object.assign(new Error('Falta a palavra-passe'), { status: 400 });
      const gmail = b.kind === 'gmail';
      const domain = address.split('@')[1];
      const acc = {
        id, label, address, fromName: String(b.fromName || '').trim() || undefined, signature: String(b.signature || '') || undefined,
        color: prev?.color || PALETTE[userAccounts.length % PALETTE.length],
        imap: gmail ? { host: 'imap.gmail.com', port: 993, secure: true, user, pass: pass.replace(/\s+/g, '') }
          : { host: String(b.imapHost || '').trim(), port: Number(b.imapPort) || 993, secure: true, user, pass },
        smtp: gmail ? { host: 'smtp.gmail.com', port: 465, secure: true, user, pass: pass.replace(/\s+/g, '') }
          : { host: String(b.smtpHost || '').trim(), port: Number(b.smtpPort) || 465, secure: (Number(b.smtpPort) || 465) === 465, user, pass },
        // Gmail com domínio próprio: mostra só o correio desse domínio.
        ...(gmail && !/^(gmail|googlemail)\.com$/.test(domain) ? { filterTo: domain, filterFrom: domain } : {}),
        appendSent: !gmail,
      };
      if (!acc.imap.host || !acc.smtp.host) throw Object.assign(new Error('Faltam os servidores IMAP/SMTP'), { status: 400 });
      // Testa a ligação antes de guardar, para o erro aparecer já.
      mail.invalidateAccount(acc);
      const test = await mail.testAccount(acc);
      if (!test.ok && !b.saveAnyway) return { saved: false, test };
      userAccounts = prev ? userAccounts.map((a) => (a.id === id ? acc : a)) : [...userAccounts, acc];
      await changed();
      return { saved: true, test, account: publicAccount(acc) };
    }));
    router.delete('/api/accounts/:id', h(async (req) => {
      userAccounts = userAccounts.filter((a) => a.id !== req.params.id);
      await changed();
      return { ok: true };
    }));
  }

  // ---------- atualizações (fornecidas pela app anfitriã) ----------
  router.get('/api/update', h(async (req) => (opts.update ? opts.update.check(Boolean(req.query.fresh)) : { available: false })));
  router.get('/api/update/progress', h(() => (opts.update?.progress ? opts.update.progress() : null) || {}));
  router.post('/api/update/apply', h(async () => {
    if (!opts.update) throw Object.assign(new Error('Sem atualizador'), { status: 404 });
    return opts.update.apply();
  }));

  return { router, ai, get accounts() { return accs(); }, isDemo, store };
}
