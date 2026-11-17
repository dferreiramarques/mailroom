// Acesso às caixas de correio: IMAP para ler, SMTP para enviar.
// Nada é guardado em disco — só uma pequena cache em memória.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

const cache = new Map(); // key -> { at, value }
const TTL = 60_000;

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = fn();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}
const ck = (acc) => acc.address || acc.id;
export const invalidateAccount = (acc) => invalidate(`${ck(acc)}:list:`);
export function invalidate(prefix) {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

async function withClient(acc, fn) {
  const client = new ImapFlow({
    host: acc.imap.host,
    port: acc.imap.port ?? 993,
    secure: acc.imap.secure ?? true,
    auth: { user: acc.imap.user, pass: acc.imap.pass },
    logger: false,
    connectionTimeout: 15000,
  });
  // Sem isto, um erro de rede emitido fora de um pedido derrubava o processo.
  client.on('error', () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function resolveFolder(client, acc, folder) {
  if (folder === 'INBOX' || !folder) return 'INBOX';
  if (folder === 'Sent') {
    if (acc.sentFolder) return acc.sentFolder;
    const list = await client.list();
    const sent = list.find((b) => b.specialUse === '\\Sent');
    return sent ? sent.path : 'Sent';
  }
  return folder;
}

function addr(a) {
  if (!a) return [];
  return a.map((x) => ({ name: x.name || '', address: x.address || '' }));
}

// Critério IMAP: filtro por destinatário (útil quando vários domínios
// chegam à mesma caixa Gmail por reencaminhamento).
function baseCriteria(acc, folder, extra = {}) {
  const c = { ...extra };
  if (acc.filterTo && folder === 'INBOX') c.to = acc.filterTo;
  if (acc.filterFrom && folder === 'Sent') c.from = acc.filterFrom;
  return Object.keys(c).length ? c : { all: true };
}

export function listMessages(acc, { folder = 'INBOX', limit = 40, query = '', since } = {}) {
  const key = `${ck(acc)}:list:${folder}:${limit}:${query}:${since || ''}`;
  return cached(key, () =>
    withClient(acc, async (client) => {
      const path = await resolveFolder(client, acc, folder);
      const lock = await client.getMailboxLock(path);
      try {
        const extra = {};
        if (query) extra.or = [{ subject: query }, { from: query }, { to: query }, { body: query }];
        if (since) extra.since = new Date(since);
        let uids = await client.search(baseCriteria(acc, folder, extra), { uid: true });
        uids = (uids || []).sort((a, b) => b - a).slice(0, limit);
        if (!uids.length) return [];
        const out = [];
        for await (const m of client.fetch(uids, { envelope: true, flags: true, uid: true, bodyStructure: false, source: { start: 0, maxLength: 16384 } }, { uid: true })) {
          let snippet = '', preview = '';
          try {
            const parsed = await simpleParser(m.source);
            // Corta o texto citado ("> ...") para o resumo ver só a parte nova.
            const fresh = (parsed.text || '').split(/\n(?:>|On .+wrote:|Em .+escreveu:)/)[0];
            preview = fresh.trim().slice(0, 1500);
            snippet = fresh.replace(/\s+/g, ' ').trim().slice(0, 160);
          } catch {}
          out.push({
            account: acc.id,
            folder,
            uid: m.uid,
            subject: m.envelope.subject || '(sem assunto)',
            from: addr(m.envelope.from),
            to: addr(m.envelope.to),
            date: m.envelope.date,
            messageId: m.envelope.messageId,
            inReplyTo: m.envelope.inReplyTo,
            seen: m.flags?.has('\\Seen') ?? true,
            flagged: m.flags?.has('\\Flagged') ?? false,
            snippet,
            preview,
          });
        }
        return out.sort((a, b) => new Date(b.date) - new Date(a.date));
      } finally {
        lock.release();
      }
    })
  );
}

export function getMessage(acc, uid, folder = 'INBOX') {
  return cached(`${ck(acc)}:msg:${folder}:${uid}`, () =>
    withClient(acc, async (client) => {
      const path = await resolveFolder(client, acc, folder);
      const lock = await client.getMailboxLock(path);
      try {
        const m = await client.fetchOne(String(uid), { source: true, flags: true, uid: true }, { uid: true });
        if (!m) throw new Error('Mensagem não encontrada');
        const p = await simpleParser(m.source);
        return {
          account: acc.id,
          folder,
          uid: m.uid,
          subject: p.subject || '(sem assunto)',
          from: p.from?.value ? addr(p.from.value) : [],
          to: p.to?.value ? addr(p.to.value) : [],
          cc: p.cc?.value ? addr(p.cc.value) : [],
          replyTo: p.replyTo?.value ? addr(p.replyTo.value) : [],
          date: p.date,
          messageId: p.messageId,
          references: [].concat(p.references || []),
          text: p.text || '',
          html: p.html || '',
          attachments: (p.attachments || []).map((a) => ({ filename: a.filename, size: a.size, contentType: a.contentType })),
        };
      } finally {
        lock.release();
      }
    })
  );
}

export async function setFlag(acc, uid, folder, flag, on) {
  await withClient(acc, async (client) => {
    const path = await resolveFolder(client, acc, folder);
    const lock = await client.getMailboxLock(path);
    try {
      if (on) await client.messageFlagsAdd(String(uid), [flag], { uid: true });
      else await client.messageFlagsRemove(String(uid), [flag], { uid: true });
    } finally {
      lock.release();
    }
  });
  invalidate(`${ck(acc)}:list:`);
}

export async function sendMail(acc, { to, cc, bcc, subject, text, inReplyTo, references }) {
  const transport = nodemailer.createTransport({
    host: acc.smtp.host,
    port: acc.smtp.port ?? 465,
    secure: acc.smtp.secure ?? (acc.smtp.port ?? 465) === 465,
    auth: { user: acc.smtp.user, pass: acc.smtp.pass },
  });
  const mail = {
    from: acc.fromName ? `"${acc.fromName}" <${acc.address}>` : acc.address,
    to, cc, bcc, subject, text,
    inReplyTo: inReplyTo || undefined,
    references: references?.length ? references : inReplyTo ? [inReplyTo] : undefined,
  };
  const info = await transport.sendMail(mail);

  // O Gmail guarda automaticamente nos Enviados; outros servidores não.
  if (acc.appendSent) {
    try {
      const raw = await new Promise((res, rej) => {
        nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({ ...mail, messageId: info.messageId }, (e, r) => (e ? rej(e) : res(r.message)));
      });
      await withClient(acc, async (client) => {
        const path = await resolveFolder(client, acc, 'Sent');
        await client.append(path, raw, ['\\Seen']);
      });
    } catch (e) {
      console.warn('[enviados] não foi possível guardar cópia:', e.message);
    }
  }
  invalidate(`${ck(acc)}:list:Sent`);
  return { messageId: info.messageId };
}

// Várias mensagens numa só ligação (usado no modo de conversa focada).
export async function getMany(acc, refs) {
  const out = [];
  const missing = [];
  for (const r of refs) {
    const hit = cache.get(`${ck(acc)}:msg:${r.folder}:${r.uid}`);
    if (hit && Date.now() - hit.at < TTL) out.push(hit.value); else missing.push(r);
  }
  if (missing.length) {
    await withClient(acc, async (client) => {
      for (const folder of [...new Set(missing.map((r) => r.folder))]) {
        const path = await resolveFolder(client, acc, folder);
        const lock = await client.getMailboxLock(path);
        try {
          for (const r of missing.filter((x) => x.folder === folder)) {
            const m = await client.fetchOne(String(r.uid), { source: true, uid: true }, { uid: true });
            if (!m) continue;
            const p = await simpleParser(m.source);
            const v = {
              account: acc.id, folder, uid: m.uid, subject: p.subject || '(sem assunto)',
              from: p.from?.value ? addr(p.from.value) : [], to: p.to?.value ? addr(p.to.value) : [],
              cc: p.cc?.value ? addr(p.cc.value) : [], replyTo: p.replyTo?.value ? addr(p.replyTo.value) : [],
              date: p.date, messageId: p.messageId, references: [].concat(p.references || []),
              text: p.text || '', html: p.html || '',
              attachments: (p.attachments || []).map((a) => ({ filename: a.filename, size: a.size, contentType: a.contentType })),
            };
            cache.set(`${ck(acc)}:msg:${folder}:${r.uid}`, { at: Date.now(), value: Promise.resolve(v) });
            out.push(v);
          }
        } finally { lock.release(); }
      }
    });
  }
  return (await Promise.all(out)).sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Testa IMAP e SMTP separadamente e devolve mensagens que se percebem.
export function explainError(e, kind, host, port) {
  const code = e?.code || e?.cause?.code || '';
  const text = [e?.responseText, e?.response, e?.message].filter(Boolean).join(' ');
  if (e?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|\b535\b|EAUTH/i.test(text + code))
    return `${kind}: utilizador ou palavra-passe errados.`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN/.test(text)) return `${kind}: o servidor "${host}" não existe. Confirma o nome.`;
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(text)) return `${kind}: ${host} recusou a ligação na porta ${port}. Confirma a porta.`;
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' && /timeout/i.test(text) || /timed? ?out/i.test(text)) return `${kind}: ${host}:${port} não respondeu. Confirma o servidor e a porta (ou se uma firewall bloqueia).`;
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|altnames/i.test(code + text)) return `${kind}: o certificado de segurança de ${host} não é válido para esse nome. Experimenta o nome de servidor que o cPanel indica (por ex. mail.dominio ou o nome do servidor de alojamento).`;
  if (/wrong version number|EPROTO/i.test(code + text)) return `${kind}: a porta ${port} não usa ligação segura direta. Usa 993 (IMAP) e 465 (SMTP).`;
  return `${kind}: ${text || code || 'erro desconhecido'}`;
}

export async function testAccount(acc) {
  const errors = [];
  try {
    await withClient(acc, async (client) => { await client.mailboxOpen('INBOX', { readOnly: true }); });
  } catch (e) { errors.push(explainError(e, 'Receber (IMAP)', acc.imap.host, acc.imap.port ?? 993)); }
  try {
    const port = acc.smtp.port ?? 465;
    const t = nodemailer.createTransport({
      host: acc.smtp.host, port, secure: acc.smtp.secure ?? port === 465,
      auth: { user: acc.smtp.user, pass: acc.smtp.pass }, connectionTimeout: 15000, greetingTimeout: 15000,
    });
    await t.verify();
    t.close();
  } catch (e) { errors.push(explainError(e, 'Enviar (SMTP)', acc.smtp.host, acc.smtp.port ?? 465)); }
  return errors.length ? { ok: false, error: errors.join(' · ') } : { ok: true };
}
