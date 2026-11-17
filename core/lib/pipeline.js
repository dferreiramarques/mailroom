// Funil de prospeção: frentes (streams) com meta semanal, contactos com estado,
// pitches da semana, follow-ups no prazo, deteção de respostas e fecho automático.
// Nada é enviado daqui: tudo vira rascunho para o utilizador rever.
import crypto from 'node:crypto';
import { COUNTRIES, LANGUAGES, guessCountry, normalizeCountry, resolveLanguage, promptLanguage } from './locale.js';

export const STATUSES = {
  novo: 'Por contactar',
  contactado: 'Contactado',
  followup: 'Follow-up enviado',
  respondeu: 'Respondeu',
  conversa: 'Em conversa',
  concluido: 'Concluído',
  recusou: 'Recusou',
  sem_resposta: 'Sem resposta',
};
const OPEN = new Set(['novo', 'contactado', 'followup', 'respondeu', 'conversa']);
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|sapo|aol|proton|protonmail|gmx|mail)\./i;
const DAY = 864e5;

const now = () => new Date();
const iso = (d = now()) => new Date(d).toISOString();
// Início da semana (segunda-feira, 00:00 local).
function weekStart(d = now()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);
const domainOf = (e = '') => e.split('@')[1]?.toLowerCase() || '';

// Frente monco (desde a 0.8): o Explora3D como porta de entrada para apresentação, formação e consultoria.
const MONCO_AUDIENCE = 'Agrupamentos de escolas públicas do Grande Porto (direção; coordenação TIC / Laboratórios de Educação Digital) e centros de formação de professores (CFAE)';
const MONCO_BRIEF = [
  'Sou o David Ferreira Marques, da monco.io (Porto). Desenvolvi o Explora3D, uma suite gratuita, no navegador, para introduzir a modelação e a impressão 3D a alunos dos 8 aos 14 anos: quatro ferramentas (Area, Volume, Revolve e Voxel) e uma sala de aula integrada, em que o professor lança um desafio por código e acompanha as entregas da turma. Funciona com ou sem impressora e exporta ficheiros STL para as impressoras que as escolas já têm, incluindo as dos Laboratórios de Educação Digital.',
  'Para um agrupamento: proponho uma apresentação de 30 a 45 minutos à equipa docente (presencial ou online), com uma primeira aula preparada em conjunto; depois, se fizer sentido, formação e acompanhamento da implementação.',
  'Para um CFAE: proponho uma ação de curta duração para professores do 1.º ao 3.º ciclo («Do laboratório digital à sala de aula: primeira aula de 3D»), em formato de 3 ou 6 horas.',
  'Credenciais: mais de 15 anos a ensinar design na ESAD; antigo coordenador do Centro de Inovação Carlos Fiolhais.',
  'Pedido: uma conversa de 20 minutos ou marcar a apresentação.',
  'Terminar com uma linha simples a dizer que, se não fizer sentido para eles, não volto a escrever.',
].join('\n');
const MONCO_MATERIALS = 'Vídeo de 2 minutos: https://explora3d.monco.io/#video · Experimentar: https://explora3d.monco.io · Formação e consultoria: https://www.monco.io/spark';

// Atualiza a frente monco guardada enquanto ainda tiver o texto de origem (com [marcadores]); nunca toca em textos editados.
function upgradeStreams(streams) {
  const m = streams?.find((x) => x.id === 'monco');
  if (m && /\[Descrever em 2 frases/.test(m.brief || '')) {
    m.name = 'monco · Explora3D (agrupamentos e CFAE)'; m.audience = MONCO_AUDIENCE; m.brief = MONCO_BRIEF;
    if (!m.materials || /^\[link/.test(m.materials)) m.materials = MONCO_MATERIALS;
  }
  return streams;
}

export function defaultStreams(accounts) {
  const pick = (re) => (accounts.find((a) => re.test(a.address)) || accounts[0] || {}).id || '';
  return [
    {
      id: 'bitnik', name: 'Bitnik · publishers', account: pick(/bitnik/i), weeklyTarget: 10, followUpDays: 7, closeAfterDays: 10, language: 'auto',
      audience: 'Publishers de jogos de tabuleiro',
      brief: 'Sou o David, da bitnikgames, uma pequena editora independente do Porto. Duas propostas, conforme o publisher:\n1) Levar os jogos de tabuleiro deles para online com a plataforma Bitnik (motor partilhado + Studio para protótipos jogáveis), feito à medida, jogo a jogo.\n2) Publicar os meus jogos (ex.: Bulbous, jogo de cartas small-box, 2-5 jogadores, 20 min).\nPedido: uma chamada de 20 minutos ou ver um protótipo jogável.',
      materials: '[link do press kit] [link para um protótipo jogável]',
    },
    {
      id: 'monco', name: 'monco · Explora3D (agrupamentos e CFAE)', account: pick(/monco/i), weeklyTarget: 10, followUpDays: 7, closeAfterDays: 10, language: 'pt-PT',
      audience: MONCO_AUDIENCE,
      brief: MONCO_BRIEF,
      materials: MONCO_MATERIALS,
    },
  ];
}

export function createPipeline({ store, io, accById, accs, ai, getSettings, addDrafts, editDrafts }) {
  // ---------- armazenamento ----------
  const get = async (k, d) => (store.getData ? (await store.getData(k)) ?? d : ((await store.getSettings())?.[`_${k}`] ?? d));
  const set = async (k, v) => (store.getData ? store.setData(k, v) : store.setSettings({ ...(await store.getSettings()), [`_${k}`]: v }));
  let chain = Promise.resolve();
  const tx = (fn) => (chain = chain.then(async () => {
    const st = { streams: upgradeStreams(await get('streams', null)), contacts: withCountry(await get('contacts', [])) };
    if (!st.streams?.length) st.streams = defaultStreams(accs());
    const out = await fn(st);
    await set('streams', st.streams); await set('contacts', st.contacts);
    return out;
  }));
  const read = async () => {
    let streams = upgradeStreams(await get('streams', null));
    if (!streams?.length) streams = defaultStreams(accs());
    return { streams, contacts: withCountry(await get('contacts', [])) };
  };
  // Contactos antigos não tinham país: deduz-se das notas ou do domínio do e-mail.
  function withCountry(list) {
    for (const c of list || []) if (c.country === undefined) c.country = guessCountry(c);
    return list;
  }
  const note = (c, type, text, extra = {}) => { (c.history ||= []).push({ at: iso(), type, text, ...extra }); c.updatedAt = iso(); };

  // ---------- contactos ----------
  function normalizeContact(raw, stream) {
    const email = String(raw.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return {
      id: crypto.randomUUID(), stream, email,
      name: String(raw.name || '').trim(), org: String(raw.org || '').trim(), role: String(raw.role || '').trim(),
      notes: String(raw.notes || '').trim(), lang: raw.lang || '', status: 'novo',
      country: guessCountry(raw),
      createdAt: iso(), updatedAt: iso(), history: [{ at: iso(), type: 'criado', text: raw.source ? `Adicionado (${raw.source})` : 'Adicionado' }],
    };
  }
  async function addContacts(stream, list) {
    return tx((st) => {
      if (!st.streams.some((s) => s.id === stream)) throw Object.assign(new Error('Frente desconhecida'), { status: 400 });
      const added = [], skipped = [];
      for (const raw of list) {
        const c = normalizeContact(raw, stream);
        if (!c) { skipped.push({ ...raw, reason: 'e-mail inválido' }); continue; }
        if (st.contacts.some((x) => x.email === c.email && x.stream === stream)) { skipped.push({ ...raw, reason: 'já existe' }); continue; }
        st.contacts.push(c); added.push(c);
      }
      return { added, skipped };
    });
  }

  // ---------- leitura das caixas: respostas, envios feitos fora da app, fecho ----------
  let lastSync = 0;
  async function sync(force = false) {
    if (!force && Date.now() - lastSync < 60_000) return;
    lastSync = Date.now();
    const { streams, contacts } = await read();
    const open = contacts.filter((c) => OPEN.has(c.status) && c.status !== 'conversa');
    if (!open.length) return;
    const byAccount = {};
    for (const s of streams) if (s.account) (byAccount[s.account] ||= new Set()).add(s.id);
    const mail = {};
    for (const accId of Object.keys(byAccount)) {
      try {
        const acc = accById(accId);
        const [inbox, sent] = await Promise.all([io.list(acc, { folder: 'INBOX', limit: 150 }), io.list(acc, { folder: 'Sent', limit: 150 })]);
        mail[accId] = { inbox, sent };
      } catch { /* conta em baixo: tenta na próxima */ }
    }
    await tx((st) => {
      for (const c of st.contacts) {
        if (!OPEN.has(c.status) || c.status === 'conversa') continue;
        const s = st.streams.find((x) => x.id === c.stream);
        const m = s && mail[s.account];
        if (!m) continue;
        const dom = domainOf(c.email);
        const sameOrg = (a) => a === c.email || (dom && !FREE_MAIL.test(dom) && domainOf(a) === dom);
        // Contactado por fora da app (enviado diretamente do Gmail/webmail)
        if (c.status === 'novo') {
          const out = m.sent.filter((x) => (x.to || []).some((t) => t.address?.toLowerCase() === c.email)).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
          if (out) { c.status = 'contactado'; c.firstContactAt = iso(out.date); c.pitch = { subject: out.subject, messageId: out.messageId }; note(c, 'contactado', `Enviado fora da app: “${out.subject}”`); }
        }
        // Resposta depois do primeiro contacto
        if (['contactado', 'followup'].includes(c.status) && c.firstContactAt) {
          const reply = m.inbox.filter((x) => (x.from || []).some((f) => sameOrg(f.address?.toLowerCase() || '')) && new Date(x.date) > new Date(c.firstContactAt))
            .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
          if (reply) {
            c.status = 'respondeu'; c.lastReplyAt = iso(reply.date);
            c.reply = { subject: reply.subject, snippet: reply.snippet, uid: reply.uid, account: s.account, from: reply.from?.[0]?.address };
            c.nextAction = { text: 'Ler a resposta e decidir o passo seguinte', due: iso() };
            note(c, 'resposta', `Respondeu: “${reply.snippet?.slice(0, 120) || reply.subject}”`);
          }
        }
        // Sem resposta depois do follow-up: fecha
        if (c.status === 'followup' && c.followUpSentAt && now() >= addDays(c.followUpSentAt, s.closeAfterDays ?? 10)) {
          c.status = 'sem_resposta'; c.nextAction = null; note(c, 'fechado', 'Sem resposta ao follow-up: fechado automaticamente');
        }
      }
    });
  }

  // ---------- semana e "hoje" ----------
  function summarize(streams, contacts, drafts) {
    const ws = weekStart();
    const pendingDraft = (c, kind) => drafts.some((d) => d.contactId === c.id && d.kind === kind);
    return streams.map((s) => {
      const cs = contacts.filter((c) => c.stream === s.id);
      const contactedThisWeek = cs.filter((c) => c.firstContactAt && new Date(c.firstContactAt) >= ws).length;
      const pitchDrafts = cs.filter((c) => pendingDraft(c, 'pitch')).length;
      const followDue = cs.filter((c) => c.status === 'contactado' && c.firstContactAt && now() >= addDays(c.firstContactAt, s.followUpDays ?? 7) && !pendingDraft(c, 'followup'));
      const followDrafts = cs.filter((c) => pendingDraft(c, 'followup')).length;
      const replies = cs.filter((c) => c.status === 'respondeu');
      const actions = cs.filter((c) => c.nextAction?.due && OPEN.has(c.status) && new Date(c.nextAction.due) <= addDays(now(), 0.5) && c.status !== 'respondeu');
      const counts = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, cs.filter((c) => c.status === k).length]));
      return {
        id: s.id, weekStart: iso(ws), target: s.weeklyTarget ?? 10, contactedThisWeek, pitchDrafts,
        toPlan: Math.max(0, (s.weeklyTarget ?? 10) - contactedThisWeek - pitchDrafts),
        available: counts.novo - pitchDrafts, followDue: followDue.length, followDrafts,
        replies: replies.length, actions: actions.length, counts,
      };
    });
  }

  async function overview() {
    await sync().catch(() => {});
    const { streams, contacts } = await read();
    const drafts = await store.getDrafts();
    const byId = Object.fromEntries(streams.map((x) => [x.id, x]));
    for (const c of contacts) c.langResolved = resolveLanguage(c, byId[c.stream]);
    return { streams, contacts, statuses: STATUSES, week: summarize(streams, contacts, drafts), countries: Object.fromEntries(Object.entries(COUNTRIES).map(([k, v]) => [k, v.name])), languages: LANGUAGES };
  }

  // ---------- preparar pitches e follow-ups ----------
  async function planWeek(streamId, count) {
    const { streams, contacts } = await read();
    const s = streams.find((x) => x.id === streamId);
    if (!s) throw Object.assign(new Error('Frente desconhecida'), { status: 400 });
    if (!s.account) throw Object.assign(new Error('Escolhe a conta de envio desta frente'), { status: 400 });
    const drafts = await store.getDrafts();
    const sum = summarize(streams, contacts, drafts).find((x) => x.id === streamId);
    const n = Math.min(Number(count) || sum.toPlan, 30);
    const busy = new Set(drafts.filter((d) => d.contactId).map((d) => d.contactId));
    const pick = contacts.filter((c) => c.stream === streamId && c.status === 'novo' && !busy.has(c.id)).slice(0, n);
    if (!pick.length) return [];
    const acc = accById(s.account);
    const brief = `${s.brief}\n\nPúblico: ${s.audience || '—'}\nMateriais a incluir quando fizer sentido: ${s.materials || '—'}`;
    const out = await ai.pitch(await getSettings(), { brief, language: s.language || 'auto', account: acc, contacts: pick.map((c) => ({ name: c.name, email: c.email, org: c.org, role: c.role, notes: c.notes, country: COUNTRIES[c.country]?.name || '', lingua: promptLanguage(resolveLanguage(c, s)) })) });
    const created = [];
    for (const c of pick) {
      const p = out.find((x) => String(x.to || '').toLowerCase() === c.email) || out[pick.indexOf(c)];
      if (!p) continue;
      created.push({
        id: crypto.randomUUID(), createdAt: iso(), source: s.name, kind: 'pitch', stream: s.id, contactId: c.id,
        account: s.account, to: c.email, subject: p.subject, text: p.body, note: p.angulo,
      });
    }
    return addDrafts(created);
  }

  async function prepareFollowups(streamId) {
    const { streams, contacts } = await read();
    const s = streams.find((x) => x.id === streamId);
    if (!s) throw Object.assign(new Error('Frente desconhecida'), { status: 400 });
    const drafts = await store.getDrafts();
    const busy = new Set(drafts.filter((d) => d.kind === 'followup').map((d) => d.contactId));
    const due = contacts.filter((c) => c.stream === streamId && c.status === 'contactado' && c.firstContactAt && now() >= addDays(c.firstContactAt, s.followUpDays ?? 7) && !busy.has(c.id));
    if (!due.length) return [];
    const acc = accById(s.account);
    const out = await ai.followups(await getSettings(), {
      account: acc, language: s.language || 'auto', materials: s.materials,
      items: due.map((c) => ({ email: c.email, name: c.name, org: c.org, notes: c.notes, lingua: promptLanguage(resolveLanguage(c, s)), sentAt: c.firstContactAt, originalSubject: c.pitch?.subject || '', originalText: (c.pitch?.text || '').slice(0, 1500) })),
    });
    const created = [];
    for (const c of due) {
      const f = out.find((x) => String(x.to || '').toLowerCase() === c.email) || out[due.indexOf(c)];
      if (!f) continue;
      const subj = c.pitch?.subject ? (/^re:/i.test(c.pitch.subject) ? c.pitch.subject : `Re: ${c.pitch.subject}`) : f.subject;
      created.push({
        id: crypto.randomUUID(), createdAt: iso(), source: `${s.name} · follow-up`, kind: 'followup', stream: s.id, contactId: c.id,
        account: s.account, to: c.email, subject: subj, text: f.body, note: f.nota || 'Follow-up ao pitch sem resposta',
        inReplyTo: c.pitch?.messageId, references: c.pitch?.messageId ? [c.pitch.messageId] : undefined,
      });
    }
    return addDrafts(created);
  }

  // Chamado depois de cada envio de um rascunho ligado ao funil.
  async function onSent(draft, messageId) {
    if (!draft?.contactId) return;
    await tx((st) => {
      const c = st.contacts.find((x) => x.id === draft.contactId);
      if (!c) return;
      const s = st.streams.find((x) => x.id === c.stream);
      if (draft.kind === 'pitch') {
        c.status = 'contactado'; c.firstContactAt = iso();
        c.pitch = { subject: draft.subject, text: draft.text, messageId };
        c.nextAction = { text: 'Follow-up se não responder', due: iso(addDays(now(), s?.followUpDays ?? 7)) };
        note(c, 'pitch', `Pitch enviado: “${draft.subject}”`);
      } else if (draft.kind === 'followup') {
        c.status = 'followup'; c.followUpSentAt = iso();
        c.nextAction = { text: 'Fechar como sem resposta se não responder', due: iso(addDays(now(), s?.closeAfterDays ?? 10)) };
        note(c, 'followup', 'Follow-up enviado');
      } else note(c, 'email', `E-mail enviado: “${draft.subject}”`);
    });
  }

  // Ligação aos tópicos: estado do funil por endereço.
  async function lookup() {
    const { streams, contacts } = await read();
    const map = new Map();
    for (const c of contacts) {
      const v = { contactId: c.id, stream: c.stream, streamName: streams.find((s) => s.id === c.stream)?.name || c.stream, status: c.status, label: STATUSES[c.status], name: c.name || c.email };
      map.set(c.email, v);
      // Também pela organização (outra pessoa do mesmo domínio), exceto webmails genéricos.
      const dom = domainOf(c.email);
      if (dom && !FREE_MAIL.test(dom) && !map.has('@' + dom)) map.set('@' + dom, v);
    }
    return map;
  }

  return {
    overview, sync, addContacts, planWeek, prepareFollowups, onSent, lookup, read,
    updateStream: (id, patch) => tx((st) => {
      const s = st.streams.find((x) => x.id === id);
      if (!s) throw Object.assign(new Error('Frente desconhecida'), { status: 404 });
      for (const k of ['name', 'account', 'audience', 'brief', 'materials', 'language']) if (k in patch) s[k] = String(patch[k] ?? '');
      for (const k of ['weeklyTarget', 'followUpDays', 'closeAfterDays']) if (k in patch) s[k] = Math.max(0, Math.min(365, Number(patch[k]) || 0));
      return s;
    }),
    updateContact: (id, patch) => tx((st) => {
      const c = st.contacts.find((x) => x.id === id);
      if (!c) throw Object.assign(new Error('Contacto não encontrado'), { status: 404 });
      for (const k of ['name', 'org', 'role', 'notes', 'lang']) if (k in patch) c[k] = String(patch[k] ?? '');
      if ('country' in patch) c.country = normalizeCountry(patch.country);
      if (patch.status && STATUSES[patch.status] && patch.status !== c.status) {
        note(c, 'estado', `${STATUSES[c.status]} → ${STATUSES[patch.status]}`);
        c.status = patch.status;
        if (!OPEN.has(c.status)) c.nextAction = null;
        if (c.status === 'novo') { delete c.firstContactAt; delete c.followUpSentAt; }
      }
      if ('nextAction' in patch) {
        c.nextAction = patch.nextAction?.text ? { text: String(patch.nextAction.text), due: patch.nextAction.due ? iso(patch.nextAction.due) : iso() } : null;
        if (c.nextAction) note(c, 'acao', `Próxima ação: ${c.nextAction.text}`);
      }
      if (patch.log) note(c, 'nota', String(patch.log));
      c.updatedAt = iso();
      return c;
    }),
    removeContact: (id) => tx((st) => { st.contacts = st.contacts.filter((x) => x.id !== id); return { ok: true }; }),
  };
}
