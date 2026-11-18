// Caixa de saída: os envios em lote (revisão do funil, rascunhos revistos) passam por aqui.
// - A fila fica guardada em disco: fechar a app ou mudar de ecrã não perde nada; ao reabrir, continua.
// - O rascunho só desaparece quando o envio é confirmado; se falhar, fica com o motivo e pode tentar-se de novo.
// - Cada envio leva um Message-ID escolhido antes de sair. Se a app parar a meio de um envio, procura-se
//   esse Message-ID nos Enviados antes de tentar outra vez, para nunca mandar o mesmo e-mail duas vezes.
// - Os pitches de prospeção saem espaçados (20 a 60 s, ao acaso), como faria uma pessoa.
import crypto from 'node:crypto';

const PENDING = new Set(['queued', 'sending', 'unknown']);
const KEEP_DAYS = 30;

export function createOutbox({ store, editDrafts, accById, deliver, findSent, prefs, isDemo, onChange = () => {} }) {
  const load = async () => ({ jobs: [], lastSent: {}, ...((await store.getData('outbox')) || {}) });
  let chain = Promise.resolve();
  const edit = (fn) => (chain = chain.then(async () => { const d = await load(); const v = await fn(d); await store.setData('outbox', d); return v; }));
  // Os rascunhos mudam-se sempre pela mesma fila de escrita do resto da app.
  const editDraft = (id, fn) => editDrafts((all) => { const d = all.find((x) => x.id === id); if (d) fn(d); return { drafts: all, value: null }; });
  const spacing = async () => { const p = (await prefs()).outboxSpacing || {}; return { on: p.on !== false, min: Math.max(5, Number(p.min) || 20), max: Math.max(5, Number(p.max) || 60) }; };

  // Quando pode sair este trabalho? (respeita o espaçamento por conta)
  const readyAt = (job, d) => {
    let t = new Date(job.notBefore || 0).getTime();
    if (job.spaced) t = Math.max(t, new Date(d.lastSent[job.account] || 0).getTime() + (job.gap || 0) * 1000);
    return t;
  };
  // Hora prevista de cada trabalho em fila, simulando a ordem de saída.
  function withEta(d) {
    const last = { ...d.lastSent };
    let clock = Date.now();
    const order = [...d.jobs].sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const eta = new Map();
    for (const j of order) {
      if (j.status !== 'queued') continue;
      let t = Math.max(clock, new Date(j.notBefore || 0).getTime());
      if (j.spaced) t = Math.max(t, new Date(last[j.account] || 0).getTime() + (j.gap || 0) * 1000);
      last[j.account] = new Date(t + 3000).toISOString(); clock = t + 3000;
      eta.set(j.id, new Date(t).toISOString());
    }
    return d.jobs.map((j) => (eta.has(j.id) ? { ...j, eta: eta.get(j.id) } : j));
  }

  async function enqueue(draftIds, opts = {}) {
    const drafts = await store.getDrafts();
    const sp = await spacing();
    const batch = crypto.randomUUID();
    const added = [];
    await edit((d) => {
      let seq = Math.max(0, ...d.jobs.map((j) => j.seq || 0));
      for (const id of draftIds) {
        const dr = drafts.find((x) => x.id === id);
        if (!dr) continue;
        if (d.jobs.some((j) => j.draftId === id && PENDING.has(j.status))) continue; // já está na fila
        const acc = accById(dr.account);
        const domain = (acc.address || 'mailroom.local').split('@')[1] || 'mailroom.local';
        const spaced = opts.spaced ?? Boolean(dr.stream); // prospeção: espaçado; o resto: logo
        const job = {
          id: crypto.randomUUID(), batch, draftId: id, account: dr.account, to: dr.to, subject: dr.subject, stream: dr.stream || '',
          kind: dr.kind || '', status: 'queued', attempts: 0, createdAt: new Date().toISOString(), seq: ++seq, // sai pela ordem da revisão
          messageId: `<${crypto.randomUUID()}@${domain}>`,
          spaced: spaced && sp.on, gap: spaced && sp.on ? Math.round(sp.min + Math.random() * Math.max(0, sp.max - sp.min)) : 2,
        };
        d.jobs.push(job); added.push(job);
      }
    });
    await editDrafts((all) => { for (const j of added) { const x = all.find((y) => y.id === j.draftId); if (x) { x.queued = j.id; delete x.sendError; } } return { drafts: all, value: null }; });
    kick();
    return { batch, queued: added.length, skipped: draftIds.length - added.length };
  }

  // ----- o trabalhador -----
  let running = false, timer = null, recovered = false;
  const kick = (ms = 0) => { clearTimeout(timer); timer = setTimeout(() => tick().catch((e) => console.error('[saída]', e.message)), ms); timer.unref?.(); };
  const transient = (e) => {
    if (e.code === 'EAUTH' || e.responseCode === 535) return false;
    if (e.responseCode) return e.responseCode < 500;
    return ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'ECONNREFUSED', 'EPROTOCOL', 'ENOTFOUND'].includes(e.code) || /timeout|ECONN|socket/i.test(e.message);
  };
  const humanError = (e) => {
    if (e.code === 'EAUTH' || e.responseCode === 535) return 'O servidor recusou o utilizador ou a palavra-passe da conta';
    if (e.responseCode >= 550 && e.responseCode < 560) return `O servidor recusou o destinatário (${e.responseCode}): ${String(e.response || e.message).slice(0, 160)}`;
    return String(e.message || e).slice(0, 240);
  };

  // Trabalhos que estavam «a enviar» quando a app parou: confirma nos Enviados antes de repetir.
  async function recover() {
    const d = await load();
    const stuck = d.jobs.filter((j) => j.status === 'sending' || j.status === 'unknown');
    for (const j of stuck) {
      let sent = null;
      if (isDemo()) sent = false;
      else { try { sent = await findSent(accById(j.account), j.messageId); } catch { sent = null; } }
      await edit((x) => {
        const y = x.jobs.find((k) => k.id === j.id); if (!y) return;
        if (sent === true) { y.status = 'sent'; y.sentAt = y.sentAt || new Date().toISOString(); y.note = 'Confirmado nos Enviados depois de a app ter parado'; }
        else if (sent === false) { y.status = 'queued'; y.notBefore = new Date().toISOString(); }
        else { y.status = 'unknown'; y.checks = (y.checks || 0) + 1; if (y.checks >= 5) { y.status = 'failed'; y.error = 'Não foi possível confirmar se saiu. Vê nos Enviados antes de tentar de novo.'; } }
      });
      if (sent === true) await editDrafts((all) => ({ drafts: all.filter((x) => x.id !== j.draftId), value: null }));
      if (sent === null) { const y = (await load()).jobs.find((k) => k.id === j.id); if (y?.status === 'failed') await editDraft(j.draftId, (dr) => { delete dr.queued; dr.sendError = y.error; }); }
    }
    return stuck.some((j) => j.status === 'unknown');
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      if (!recovered) { recovered = true; if (await recover()) kick(60_000); }
      for (;;) {
        const d = await load();
        if (d.jobs.some((j) => j.status === 'unknown')) { await recover(); }
        const queued = d.jobs.filter((j) => j.status === 'queued');
        if (!queued.length) break;
        const now = Date.now();
        // Sai sempre pela ordem da revisão; o espaçamento só decide quando. Os que esperam nova tentativa não atrasam os outros.
        const eligible = queued.filter((j) => new Date(j.notBefore || 0).getTime() <= now).sort((a, b) => (a.seq || 0) - (b.seq || 0));
        if (!eligible.length) { kick(Math.min(Math.min(...queued.map((j) => new Date(j.notBefore).getTime())) - now, 60_000)); break; }
        const j = eligible[0];
        const at = readyAt(j, d);
        if (at > now) { kick(Math.min(at - now, 60_000)); break; }
        await edit((x) => { const y = x.jobs.find((k) => k.id === j.id); y.status = 'sending'; y.attempts++; y.startedAt = new Date().toISOString(); });
        onChange();
        const draft = (await store.getDrafts()).find((x) => x.id === j.draftId);
        if (!draft) {
          await edit((x) => { const y = x.jobs.find((k) => k.id === j.id); y.status = 'cancelled'; y.error = 'O rascunho foi apagado antes de sair'; });
          continue;
        }
        try {
          await deliver({ ...draft, draftId: draft.id, messageId: j.messageId });
          await edit((x) => { const y = x.jobs.find((k) => k.id === j.id); y.status = 'sent'; y.sentAt = new Date().toISOString(); delete y.error; x.lastSent[j.account] = y.sentAt; });
        } catch (e) {
          const again = transient(e) && j.attempts + 1 < 4;
          const msg = humanError(e);
          await edit((x) => {
            const y = x.jobs.find((k) => k.id === j.id);
            y.error = msg;
            if (again) { y.status = 'queued'; y.notBefore = new Date(Date.now() + [60, 300, 900][Math.min(2, y.attempts - 1)] * 1000).toISOString(); }
            else y.status = 'failed';
          });
          if (!again) await editDraft(j.draftId, (dr) => { delete dr.queued; dr.sendError = msg; });
        }
        onChange();
      }
      // Limpa o histórico antigo.
      await edit((x) => { const cut = Date.now() - KEEP_DAYS * 864e5; x.jobs = x.jobs.filter((j) => PENDING.has(j.status) || j.status === 'failed' || new Date(j.sentAt || j.createdAt).getTime() > cut).slice(-500); });
    } finally { running = false; }
  }

  async function status() {
    const d = await load();
    const jobs = withEta(d);
    const pending = jobs.filter((j) => PENDING.has(j.status));
    return {
      jobs: jobs.slice().reverse(),
      pending: pending.length,
      sending: jobs.find((j) => j.status === 'sending') || null,
      failed: jobs.filter((j) => j.status === 'failed').length,
      until: pending.map((j) => j.eta).filter(Boolean).sort().at(-1) || null,
      spacing: await spacing(),
    };
  }
  async function cancel(id) {
    let draftId = null;
    await edit((d) => { const j = d.jobs.find((x) => x.id === id); if (!j) return; if (j.status === 'sending') throw Object.assign(new Error('Este já está a sair'), { status: 409 }); if (j.status === 'queued' || j.status === 'failed') { j.status = 'cancelled'; draftId = j.draftId; } });
    if (draftId) await editDraft(draftId, (dr) => { delete dr.queued; });
    return { ok: true };
  }
  async function retry(id) {
    let draftId = null;
    await edit((d) => { const j = d.jobs.find((x) => x.id === id); if (!j || j.status !== 'failed') return; j.status = 'queued'; j.attempts = 0; j.checks = 0; delete j.error; j.notBefore = new Date().toISOString(); draftId = j.draftId; });
    if (draftId) await editDraft(draftId, (dr) => { dr.queued = id; delete dr.sendError; });
    kick();
    return { ok: true };
  }
  const busy = async () => (await load()).jobs.some((j) => PENDING.has(j.status));

  kick(1500); // ao arrancar, retoma o que ficou por enviar
  return { enqueue, status, cancel, retry, busy, kick };
}
