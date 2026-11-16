// Agrupa mensagens (Entrada + Enviados) em tópicos/conversas.
// 1) pela cadeia Message-ID / In-Reply-To; 2) por assunto normalizado + pessoa.

export const normSubject = (s = '') => s.replace(/^(\s*(re|fw|fwd|enc|res|aw|tr)\s*(\[\d+\])?\s*:\s*)+/i, '').trim().toLowerCase();
const other = (m) => (m.folder === 'Sent' ? m.to?.[0] : m.from?.[0]) || { address: '' };

export function buildTopics(inbox, sent) {
  const all = [...inbox, ...sent];
  const parent = all.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  const byId = new Map();
  all.forEach((m, i) => m.messageId && byId.set(`${m.account}|${m.messageId}`, i));
  const bySubj = new Map();
  all.forEach((m, i) => {
    const p = m.inReplyTo && byId.get(`${m.account}|${m.inReplyTo}`);
    if (p !== undefined && p !== null) union(i, p);
    const k = `${m.account}|${normSubject(m.subject)}|${other(m).address.toLowerCase()}`;
    if (normSubject(m.subject).length > 3) {
      if (bySubj.has(k)) union(i, bySubj.get(k)); else bySubj.set(k, i);
    }
  });

  const groups = new Map();
  all.forEach((m, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(m); });

  // Histórico por pessoa (em todas as conversas carregadas).
  const byPerson = new Map();
  for (const m of all) {
    const a = other(m).address.toLowerCase();
    if (!a) continue;
    const e = byPerson.get(a) || { count: 0, since: m.date };
    e.count++; if (new Date(m.date) < new Date(e.since)) e.since = m.date;
    byPerson.set(a, e);
  }

  const topics = [];
  for (const msgs of groups.values()) {
    if (!msgs.some((m) => m.folder === 'INBOX')) continue; // só conversas com algo recebido
    msgs.sort((a, b) => new Date(a.date) - new Date(b.date));
    const last = msgs[msgs.length - 1];
    const root = msgs[0];
    const people = [];
    for (const m of msgs) { const o = other(m); if (o.address && !people.some((p) => p.address === o.address)) people.push(o); }
    const main = people[0]?.address?.toLowerCase();
    const hist = main ? byPerson.get(main) : null;
    topics.push({
      id: `${root.account}:${(root.messageId || `${root.folder}-${root.uid}`).replace(/[<>]/g, '')}`,
      account: root.account,
      subject: last.subject,
      people,
      count: msgs.length,
      lastDate: last.date,
      lastMessageId: last.messageId || `${last.folder}-${last.uid}`,
      unread: msgs.some((m) => m.folder === 'INBOX' && !m.seen),
      lastFromOther: last.folder === 'INBOX',
      history: hist ? { count: hist.count - msgs.length, since: hist.since } : { count: 0, since: null },
      messages: msgs.map(({ uid, folder, from, to, date, seen, snippet, subject, preview, messageId }) => ({ uid, folder, from, to, date, seen, snippet, subject, preview, messageId })),
    });
  }
  return topics.sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
}
