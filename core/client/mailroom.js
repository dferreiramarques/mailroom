// <mail-room> — cliente do mailroom (@mailroom/core). JS puro, sem dependências.
// Vista por tópicos (cartões) e vista clássica de caixa de correio.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const who = (list = []) => list.map((a) => a.name || a.address).join(', ') || '—';
const whoFull = (list = []) => list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
// DOMParser cria um documento inerte: nada do HTML do e-mail é carregado ou executado.
const stripTags = (h = '') => { const d = new DOMParser().parseFromString(h, 'text/html'); d.querySelectorAll('style,script').forEach((x) => x.remove()); return (d.body?.textContent || '').replace(/\n{3,}/g, '\n\n'); };
const textOf = (m) => m.text || stripTags(m.html);
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

function when(d) {
  const date = new Date(d), now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  if (now - date < 6 * 864e5) return date.toLocaleDateString('pt-PT', { weekday: 'short' });
  return date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
}
function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 3600) return `há ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) return `há ${Math.round(s / 86400)} dias`;
  return new Date(d).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
}
const monthYear = (d) => new Date(d).toLocaleDateString('pt-PT', { month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
// Separa o texto novo do texto citado ("> …", "Em … escreveu:")
function splitQuote(t = '') {
  const m = t.match(/\n(?:>.*|On .+wrote:|Em .+escreveu:|-{2,} ?Original Message|De: .+\n(?:Enviad|Sent))/);
  return m ? [t.slice(0, m.index).trimEnd(), t.slice(m.index).trim()] : [t, ''];
}

const SHELL = `
<div class="app" data-mode="topics">
  <nav class="rail" aria-label="Navegação">
    <div class="brand">mailroom</div>
    <div class="switch" role="tablist" aria-label="Vista">
      <button role="tab" data-mode="topics">Tópicos</button>
      <button role="tab" data-mode="classic">Caixa</button>
    </div>
    <div class="group"><div class="group-label">Caixas</div><div id="accountNav"></div></div>
    <div class="group">
      <div class="group-label">Pastas</div>
      <button class="nav" data-folder="INBOX">Entrada</button>
      <button class="nav" data-folder="Sent">Enviados</button>
      <button class="nav" data-view="drafts">Rascunhos <span class="count" id="draftCount"></span></button>
    </div>
    <div class="group">
      <div class="group-label">Assistente</div>
      <button class="nav" data-view="triage">Triagem</button>
      <button class="nav" data-view="pitch">Pitch</button>
      <button class="nav" data-view="publish">Publicação</button>
      <button class="nav" data-view="agent">Agente</button>
    </div>
    <div class="rail-foot">
      <button class="nav update" id="updateBtn" hidden></button>
      <button class="nav" data-view="settings">Definições</button>
      <div id="modeBadge" class="mode"></div>
    </div>
  </nav>
  <section class="list" aria-label="Mensagens">
    <header class="list-head">
      <input id="search" type="search" placeholder="Pesquisar  /" aria-label="Pesquisar" />
      <button class="icon" id="composeBtn" title="Nova mensagem (c)" aria-label="Nova mensagem">＋</button>
      <button class="icon" id="refreshBtn" title="Atualizar" aria-label="Atualizar">↻</button>
    </header>
    <div id="listErrors" class="errors"></div>
    <ul id="messageList" class="messages"></ul>
  </section>
  <main class="reader" id="reader" tabindex="-1"></main>
</div>`;

function mount(root, host, base) {
  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => [...el.querySelectorAll(s)];
  const app = () => $('.app');

  // Tema: o atributo `theme` do anfitrião manda; senão, a escolha do utilizador (claro por omissão).
  const hostTheme = host.getAttribute('theme');
  const applyTheme = (t) => { if (hostTheme) return; if (t === 'auto') host.removeAttribute('theme'); else host.setAttribute('theme', t); };
  applyTheme(ls.get('mailroom.theme') || 'light');

  const state = {
    status: null, account: host.getAttribute('account') || 'all', folder: 'INBOX', view: 'topics',
    mode: host.getAttribute('mode') || ls.get('mailroom.mode') || 'topics',
    items: [], index: -1, current: null, drafts: [], query: '', topicQuery: '',
    topics: [], topicErrors: [], open: new Set(), threads: new Map(), suggestions: new Map(),
  };

  async function api(path, opts = {}) {
    const r = await fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    app().append(t);
    setTimeout(() => t.remove(), 2600);
  }
  const emit = (name, detail) => host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  const acc = (id) => state.status.accounts.find((a) => a.id === id) || { label: id, color: '#999' };
  const spin = (label) => `<span class="spinner" aria-hidden="true"></span> <span class="muted">${esc(label)}</span>`;
  const dot = (id) => `<span class="dot" style="display:inline-block;background:${esc(acc(id).color)}" title="${esc(acc(id).label)}"></span>`;

  // =====================================================================
  // Navegação e modo
  // =====================================================================
  function renderNav() {
    const s = state.status;
    $('#accountNav').innerHTML = [
      `<button class="nav" data-account="all" data-short="Tudo"><span class="dot" style="background:var(--muted)"></span>Tudo</button>`,
      ...s.accounts.map((a) => `<button class="nav" data-account="${esc(a.id)}" data-short="${esc(a.label.slice(0, 4))}"><span class="dot" style="background:${esc(a.color || '#999')}"></span>${esc(a.label)}</button>`),
    ].join('');
    $$('.nav').forEach((b) => (b.dataset.short ??= b.textContent.trim().slice(0, 4)));
    renderBadge();
    highlightNav();
  }
  function renderBadge() {
    const s = state.status;
    $('#modeBadge').textContent = [s.version ? `v${s.version}` : null, s.demo ? 'Modo demo' : null, s.ai ? `IA: ${s.aiModel || 'ativa'}` : 'IA simulada'].filter(Boolean).join(' · ');
  }
  function highlightNav() {
    $$('.nav').forEach((b) => {
      const on = (b.dataset.account && b.dataset.account === state.account)
        || (b.dataset.folder && state.view === 'mail' && b.dataset.folder === state.folder)
        || (b.dataset.view && b.dataset.view === state.view);
      b.classList.toggle('active', Boolean(on));
    });
    $$('.switch button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === state.mode); b.setAttribute('aria-selected', b.dataset.mode === state.mode); });
    $('#draftCount').textContent = state.drafts.length || '';
  }
  function setMode(mode) {
    state.mode = mode;
    ls.set('mailroom.mode', mode);
    app().dataset.mode = mode;
    closeFocus();
    if (mode === 'topics') { state.view = 'topics'; app().classList.remove('reading'); loadTopics(); }
    else { state.view = 'mail'; loadList(); $('#reader').innerHTML = `<div class="empty">Escolhe uma mensagem.<br /><span class="muted">j / k para navegar · r responder · s resumir · c nova</span></div>`; }
    highlightNav();
    emit('mode-change', { mode });
  }

  root.addEventListener('click', (e) => {
    const sw = e.target.closest('.switch button');
    if (sw) return setMode(sw.dataset.mode);
    const b = e.target.closest('.nav');
    if (!b || b.id === 'updateBtn') return;
    if (b.dataset.account) {
      state.account = b.dataset.account;
      if (state.mode === 'topics') { closeFocus(); state.view = 'topics'; loadTopics(); }
      else if (state.view === 'drafts') renderDraftList();
      else { state.view = 'mail'; loadList(); }
    }
    if (b.dataset.folder) {
      if (state.mode !== 'classic') { state.mode = 'classic'; ls.set('mailroom.mode', 'classic'); app().dataset.mode = 'classic'; }
      state.folder = b.dataset.folder; state.view = 'mail'; loadList();
    }
    if (b.dataset.view) openView(b.dataset.view);
    highlightNav();
  });

  // =====================================================================
  // Vista por tópicos
  // =====================================================================
  async function loadTopics(fresh = false) {
    state.view = 'topics';
    highlightNav();
    const reader = $('#reader');
    if (!$('.board', reader)) reader.innerHTML = `<div class="board"><div class="board-head"></div><div id="topicList">${spin('A ler as caixas e a resumir os tópicos…')}</div></div>`;
    renderBoardHead(true);
    try {
      const q = new URLSearchParams({ account: state.account, q: state.topicQuery });
      if (fresh) q.set('fresh', '1');
      const r = await api(`/api/topics?${q}`);
      state.topics = r.topics; state.topicErrors = r.errors;
      renderTopics();
    } catch (e) {
      $('#topicList').innerHTML = `<p class="muted">Não consegui carregar: ${esc(e.message)}</p>`;
    }
    renderBoardHead(false);
  }

  function renderBoardHead(loading) {
    const head = $('.board-head'); if (!head) return;
    const n = state.topics.length, unread = state.topics.filter((t) => t.unread).length, waiting = state.topics.filter((t) => t.ai?.needsReply ?? t.lastFromOther).length;
    const label = state.account === 'all' ? 'Todas as caixas' : acc(state.account).label;
    head.innerHTML = `<h1>${esc(label)}</h1>
      <span class="muted">${loading ? spin('a atualizar') : `${n} conversas · ${unread} por ler · ${waiting} à espera de resposta`}</span>
      <span class="grow"></span>
      <input type="search" id="topicSearch" placeholder="Pesquisar tópicos  /" value="${esc(state.topicQuery)}" aria-label="Pesquisar tópicos" />
      <button class="icon" data-t="compose" title="Nova mensagem (c)" aria-label="Nova mensagem">＋</button>
      <button class="icon" data-t="refresh" title="Atualizar" aria-label="Atualizar">↻</button>`;
  }

  function topicCard(t) {
    const person = t.people[0] || {};
    const title = t.ai?.title || t.subject.replace(/^(re|fwd?):\s*/i, '');
    const summary = t.ai?.summary || t.messages.at(-1)?.snippet || '';
    const prio = t.ai?.priority;
    const waiting = t.ai ? t.ai.needsReply : t.lastFromOther;
    const foot = [
      t.count > 1 ? `${t.count} mensagens nesta conversa` : 'Mensagem única',
      t.history?.count > 0 ? `${t.history.count} e-mail${t.history.count > 1 ? 's' : ''} anteriores com ${esc(person.name?.split(' ')[0] || person.address)} desde ${monthYear(t.history.since)}` : t.count === 1 ? 'Primeiro contacto' : '',
      waiting ? `<span class="wait">↩ aguarda a tua resposta</span>` : !t.lastFromOther ? `↗ última mensagem foi tua, ${ago(t.lastDate)}` : '',
    ].filter(Boolean);
    return `<article class="topic ${t.unread ? 'unread' : ''} ${state.open.has(t.id) ? 'open' : ''}" data-id="${esc(t.id)}">
      <div class="t-head" data-t="toggle" role="button" tabindex="0" aria-expanded="${state.open.has(t.id)}">
        <div class="t-meta">${t.unread ? '<span class="new">nova</span>' : ''}${dot(t.account)} <span>${esc(acc(t.account).label)}</span><span>·</span><span>${esc(who(t.people))}</span><span>·</span><span>${ago(t.lastDate)}</span>${prio ? `<span class="pill ${esc(prio)}">${esc(prio)}</span>` : ''}</div>
        <h2 class="t-title selectable">${esc(title)}</h2>
        <p class="t-summary selectable">${esc(summary)}</p>
        <div class="t-foot">${foot.map((f) => `<span>${f}</span>`).join('')}</div>
      </div>
      ${state.open.has(t.id) ? `<div class="t-body" id="body-${cssId(t.id)}">${spin('A abrir a conversa…')}</div>` : `<div class="t-actions" style="padding:0 22px 16px"><button class="btn" data-t="toggle">Ler e responder</button><button class="btn" data-t="focus">Conversa completa</button></div>`}
    </article>`;
  }
  const cssId = (id) => id.replace(/[^a-z0-9]/gi, '_');

  function renderTopics() {
    const list = $('#topicList'); if (!list) return;
    const errs = state.topicErrors.length ? `<div class="errors" style="border:0;padding:0 0 12px">${esc(state.topicErrors.join(' · '))}</div>` : '';
    list.innerHTML = errs + (state.topics.length ? state.topics.map(topicCard).join('') : `<p class="muted">${state.topicQuery ? 'Nenhum tópico encontrado.' : 'Caixa limpa. Nada por tratar.'}</p>`);
    for (const id of state.open) fillTopicBody(id);
  }
  const topicById = (id) => state.topics.find((t) => t.id === id);

  async function getThread(id) {
    if (!state.threads.has(id)) state.threads.set(id, api(`/api/topic?id=${encodeURIComponent(id)}`).catch((e) => { state.threads.delete(id); throw e; }));
    return state.threads.get(id);
  }

  async function fillTopicBody(id) {
    const box = $(`#body-${cssId(id)}`); if (!box) return;
    try {
      const th = await getThread(id);
      const t = topicById(id);
      if (t?.unread) { t.unread = false; $(`.topic[data-id="${CSS.escape(id)}"]`)?.classList.remove('unread'); renderBoardHead(false); }
      const last = th.messages.at(-1);
      const [fresh, quoted] = splitQuote(textOf(last));
      box.innerHTML = `
        <div class="t-msg-head"><b>${last.folder === 'Sent' ? 'Tu' : esc(who(last.from))}</b> · ${new Date(last.date).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' })}${th.messages.length > 1 ? ` · <a href="#" data-t="focus">ver as ${th.messages.length} mensagens</a>` : ''}</div>
        <div class="t-text selectable">${esc(fresh)}</div>
        ${quoted ? `<button class="f-quote-toggle" data-t="quote">mostrar texto citado</button><div class="t-text f-quote selectable" hidden>${esc(quoted)}</div>` : ''}
        ${replyBox(th, `rb-${cssId(id)}`)}`;
      wireReplyBox(box, th);
    } catch (e) { box.innerHTML = `<p class="muted">Não consegui abrir: ${esc(e.message)}</p>`; }
  }

  // ---------- caixa de resposta (cartão e modo focado) ----------
  const lastIncoming = (th) => [...th.messages].reverse().find((m) => m.folder !== 'Sent') || th.messages.at(-1);
  function replyBox(th, key) {
    const target = lastIncoming(th);
    const mineLast = th.messages.at(-1).folder === 'Sent';
    const to = (target.replyTo?.length ? target.replyTo : target.from).map((a) => a.address).join(', ');
    return `<div class="replybox" data-key="${esc(key)}">
      <div class="rb-to">Para ${esc(mineLast ? th.messages.at(-1).to.map((a) => a.address).join(', ') : to)} · de ${esc(acc(th.account).label)}</div>
      <div class="rb-tabs"></div>
      <textarea class="rb-text" aria-label="Resposta" placeholder="Escreve a tua resposta…"></textarea>
      <div class="rb-foot">
        <button class="btn primary" data-r="send">Enviar</button>
        <button class="btn" data-r="clear" title="Limpar e escrever do zero">Limpar</button>
        <button class="btn" data-r="draft">Guardar rascunho</button>
        <span class="grow"></span>
        <label><input type="checkbox" data-r="quote" checked /> citar mensagem</label>
        <button class="btn" data-r="compose" title="Abrir no compositor completo (Cc, Bcc, assunto)">⤢</button>
      </div>
    </div>`;
  }

  function wireReplyBox(scope, th) {
    const box = $('.replybox', scope); if (!box) return;
    const ta = $('.rb-text', box), tabs = $('.rb-tabs', box);
    const target = lastIncoming(th);
    const mineLast = th.messages.at(-1).folder === 'Sent';
    const key = th.id;

    const renderTabs = (list, active = 0, loading = false) => {
      tabs.innerHTML = loading ? `<span style="padding:4px 8px">${spin('A preparar sugestão…')}</span>`
        : (list || []).map((s, i) => `<button class="rb-tab ${i === active ? 'on' : ''}" data-i="${i}">${esc(s.label)}</button>`).join('')
          + `<input class="rb-intent" placeholder="${list ? 'ou diz o que queres responder ↵' : 'Sugerir resposta: diz a intenção ↵ (ou Enter)'}" aria-label="Intenção da resposta" />`;
      $$('.rb-tab', tabs).forEach((b) => (b.onclick = () => { ta.value = list[b.dataset.i].body; renderTabs(list, Number(b.dataset.i)); }));
      $('.rb-intent', tabs)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); suggestFor(e.target.value); } });
    };
    async function suggestFor(intent = '') {
      renderTabs(null, 0, true);
      try {
        const list = await api('/api/ai/replies', { method: 'POST', body: { account: th.account, uid: (mineLast ? th.messages.at(-1) : target).uid, folder: (mineLast ? th.messages.at(-1) : target).folder, topicId: th.id, intent: intent || (mineLast ? 'follow-up curto e cordial, a retomar o pedido anterior' : '') } });
        state.suggestions.set(key, list);
        ta.value = list[0]?.body || '';
        renderTabs(list, 0);
      } catch (e) { renderTabs(null); toast('Sugestão falhou: ' + e.message); }
    }
    const cached = state.suggestions.get(key);
    if (cached) { ta.value = cached[0]?.body || ''; renderTabs(cached); }
    else if (state.status.prefs?.autoSuggest !== false && !mineLast) suggestFor();
    else renderTabs(null);

    const recipients = () => (mineLast ? th.messages.at(-1).to : (target.replyTo?.length ? target.replyTo : target.from)).map((a) => a.address).join(', ');
    const payload = () => {
      const quote = $('[data-r="quote"]', box).checked
        ? `\n\nEm ${new Date(target.date).toLocaleString('pt-PT')}, ${whoFull(target.from)} escreveu:\n` + splitQuote(textOf(target))[0].split('\n').slice(0, 40).map((l) => '> ' + l).join('\n') : '';
      const ref = mineLast ? th.messages.at(-1) : target;
      return {
        account: th.account, to: recipients(),
        subject: /^re:/i.test(ref.subject) ? ref.subject : `Re: ${ref.subject}`,
        text: ta.value + quote, inReplyTo: ref.messageId, references: [...(ref.references || []), ref.messageId].filter(Boolean),
      };
    };
    let armed = null;
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-r]'); if (!b || b.type === 'checkbox') return;
      const act = b.dataset.r;
      if (act === 'clear') { ta.value = ''; $$('.rb-tab', tabs).forEach((x) => x.classList.remove('on')); ta.focus(); }
      if (act === 'compose') compose({ ...payload(), text: ta.value + (payload().text.slice(ta.value.length)) });
      if (act === 'draft') { await api('/api/drafts', { method: 'POST', body: { ...payload(), source: 'tópico' } }); await refreshDrafts(); toast('Rascunho guardado'); }
      if (act === 'send') {
        if (!ta.value.trim()) return toast('A resposta está vazia');
        if (!armed) { b.textContent = 'Confirmar envio'; armed = setTimeout(() => { armed = null; b.textContent = 'Enviar'; }, 4000); return; }
        clearTimeout(armed); armed = null; b.disabled = true; b.innerHTML = spin('A enviar…');
        try {
          const p = payload();
          await api('/api/send', { method: 'POST', body: p });
          emit('mail-sent', { account: p.account, to: p.to, subject: p.subject });
          toast('Enviado');
          state.suggestions.delete(key); state.threads.delete(th.id); state.open.delete(th.id);
          closeFocus(); loadTopics(true);
        } catch (err) { b.disabled = false; b.textContent = 'Enviar'; toast('Erro: ' + err.message); }
      }
    });
  }

  // ---------- modo focado ----------
  function closeFocus() { $('.focus')?.remove(); }
  async function openFocus(id, single) {
    closeFocus();
    const f = document.createElement('div');
    f.className = 'focus'; f.tabIndex = -1;
    f.innerHTML = `<div class="focus-inner">${spin('A abrir…')}</div>`;
    app().append(f); f.focus();
    try {
      const th = single || (await getThread(id));
      const t = topicById(id) || th;
      const title = t.ai?.title || th.subject.replace(/^(re|fwd?):\s*/i, '');
      $('.focus-inner', f).innerHTML = `
        <div class="focus-bar">${dot(th.account)} ${esc(acc(th.account).label)} · ${th.messages.length} mensage${th.messages.length > 1 ? 'ns' : 'm'}<span class="grow"></span>
          <button class="btn" data-f="toggle">Ver na caixa</button><button class="close" data-f="close" aria-label="Fechar (Esc)" title="Fechar (Esc)">×</button></div>
        <h1 class="selectable">${esc(title)}</h1>
        <div class="sub selectable">${esc(t.ai?.summary || th.subject)}</div>
        ${th.messages.map((m) => { const [fresh, quoted] = splitQuote(textOf(m)); return `
          <section class="f-msg ${m.folder === 'Sent' ? 'mine' : ''}">
            <div class="t-msg-head"><b>${m.folder === 'Sent' ? 'Tu' : esc(who(m.from))}</b> ${m.folder === 'Sent' ? `para ${esc(who(m.to))}` : `<span class="muted">${esc(m.from?.[0]?.address || '')}</span>`} · ${new Date(m.date).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            <div class="t-text selectable">${esc(fresh)}</div>
            ${quoted ? `<button class="f-quote-toggle" data-t="quote">mostrar texto citado</button><div class="t-text f-quote selectable" hidden>${esc(quoted)}</div>` : ''}
            ${m.attachments?.length ? `<div class="attach">Anexos: ${m.attachments.map((x) => esc(x.filename || 'sem nome')).join(', ')}</div>` : ''}
          </section>`; }).join('')}
        ${replyBox(th, `focus-${cssId(th.id)}`)}`;
      wireReplyBox(f, th);
      f.addEventListener('click', (e) => {
        const b = e.target.closest('[data-f]');
        if (b?.dataset.f === 'close') closeFocus();
        if (b?.dataset.f === 'toggle') { const last = th.messages.at(-1); setMode('classic'); openMessage({ account: th.account, uid: last.uid, folder: last.folder }); }
      });
    } catch (e) { $('.focus-inner', f).innerHTML = `<button class="close" data-f="close">×</button><p>Não consegui abrir: ${esc(e.message)}</p>`; f.onclick = (e) => e.target.closest('[data-f=close]') && closeFocus(); }
  }

  $('#reader').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.t-head')) { e.preventDefault(); toggleTopic(e.target.closest('.topic').dataset.id); }
  });
  function toggleTopic(id) {
    if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
    const el = $(`.topic[data-id="${CSS.escape(id)}"]`);
    el.outerHTML = topicCard(topicById(id));
    if (state.open.has(id)) fillTopicBody(id);
  }

  // Cliques dentro do quadro de tópicos e do modo focado
  root.addEventListener('click', (e) => {
    const q = e.target.closest('[data-t="quote"]');
    if (q) { const nx = q.nextElementSibling; nx.hidden = !nx.hidden; q.textContent = nx.hidden ? 'mostrar texto citado' : 'esconder texto citado'; return; }
    const b = e.target.closest('[data-t]');
    if (!b || !b.closest('.board, .focus')) return;
    const id = b.closest('.topic')?.dataset.id;
    if (b.dataset.t === 'toggle') { if (window.getSelection?.().toString() || root.getSelection?.()?.toString()) return; toggleTopic(id); }
    if (b.dataset.t === 'focus') { e.preventDefault(); openFocus(id); }
    if (b.dataset.t === 'refresh') { state.threads.clear(); loadTopics(true); }
    if (b.dataset.t === 'compose') compose();
  });
  let tSearch;
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'topicSearch') return;
    clearTimeout(tSearch);
    tSearch = setTimeout(() => { state.topicQuery = e.target.value.trim(); loadTopics(); }, 400);
  });

  // =====================================================================
  // Pesquisa rápida com IA (botão direito sobre texto selecionado)
  // =====================================================================
  const selectionText = () => ((root.getSelection ? root.getSelection() : document.getSelection())?.toString() || '').trim().replace(/\s+/g, ' ');
  function closeCtx() { if ($('.ctx')) { $('.ctx').remove(); host.focus({ preventScroll: true }); } }
  // Esc fecha sobreposições mesmo quando o foco saiu do componente.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.composedPath().includes(host)) return;
    if ($('.ctx')) closeCtx(); else if ($('.research')) $('.research').remove(); else if ($('.focus')) closeFocus();
  });
  root.addEventListener('contextmenu', (e) => {
    const sel = selectionText();
    if (sel.length < 2 || sel.length > 200 || !e.target.closest('.selectable, .body, textarea')) return;
    e.preventDefault();
    closeCtx();
    const m = document.createElement('div');
    m.className = 'ctx'; m.setAttribute('role', 'menu');
    m.innerHTML = `<div class="ctx-q">“${esc(sel)}”</div>
      <button role="menuitem" data-c="research">Pesquisar e resumir com IA</button>
      <button role="menuitem" data-c="search">Procurar tópicos com este termo</button>
      <button role="menuitem" data-c="copy">Copiar</button>`;
    m.style.left = Math.min(e.clientX, innerWidth - 260) + 'px';
    m.style.top = Math.min(e.clientY, innerHeight - 160) + 'px';
    app().append(m);
    $('button', m).focus();
    m.onclick = async (ev) => {
      const c = ev.target.closest('[data-c]')?.dataset.c; if (!c) return;
      closeCtx();
      if (c === 'research') research(sel);
      if (c === 'copy') { await navigator.clipboard?.writeText(sel); toast('Copiado'); }
      if (c === 'search') { closeFocus(); if (state.mode !== 'topics') setMode('topics'); state.topicQuery = sel; $('#reader').innerHTML = ''; loadTopics(); }
    };
  });
  root.addEventListener('mousedown', (e) => { if (!e.target.closest('.ctx')) closeCtx(); });

  async function research(query) {
    $('.research')?.remove();
    const p = document.createElement('aside');
    p.className = 'research'; p.setAttribute('aria-label', 'Pesquisa com IA');
    p.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><span class="muted" style="font-size:13px">Pesquisa rápida</span><button class="close" aria-label="Fechar">×</button></div>
      <h2>“${esc(query)}”</h2><div class="r-body">${spin('A procurar nas caixas e a resumir…')}</div>`;
    app().append(p);
    $('.close', p).onclick = () => p.remove();
    $('.close', p).focus();
    try {
      const r = await api('/api/ai/research', { method: 'POST', body: { query, account: state.account } });
      $('.r-body', p).innerHTML = `
        <p>${esc(r.summary)}</p>
        ${r.facts?.length ? `<h3>Nos teus e-mails</h3><ul>${r.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        ${r.people?.length ? `<h3>Pessoas</h3><p>${r.people.map(esc).join(' · ')}</p>` : ''}
        ${r.general ? `<h3>Contexto geral</h3><div class="general">${esc(r.general)}<div class="muted" style="margin-top:4px;font-size:12px">Conhecimento geral do modelo, não vem dos teus e-mails.</div></div>` : ''}
        <h3>E-mails relacionados (${r.hits.length})</h3>
        ${r.hits.length ? r.hits.map((h, i) => `<button class="hit" data-h="${i}"><div class="hit-s">${esc(h.subject)}</div><div class="hit-m">${dot(h.account)} ${h.folder === 'Sent' ? `tu → ${esc(h.to)}` : esc(h.from)} · ${when(h.date)}</div></button>`).join('') : '<p class="muted">Nenhum.</p>'}`;
      $$('.hit', p).forEach((b) => (b.onclick = () => openHit(r.hits[b.dataset.h])));
    } catch (e) { $('.r-body', p).innerHTML = `<p>Erro: ${esc(e.message)}</p>`; }
  }
  async function openHit(h) {
    const t = state.topics.find((x) => x.account === h.account && x.messages.some((m) => m.uid === h.uid && m.folder === h.folder));
    if (t) return openFocus(t.id);
    const m = await api(`/api/message/${h.account}/${h.uid}?folder=${h.folder}&markSeen=0`);
    openFocus(null, { id: `single:${h.account}:${h.folder}:${h.uid}`, account: h.account, subject: m.subject, messages: [{ ...m, folder: h.folder }] });
  }

  // =====================================================================
  // Vista clássica
  // =====================================================================
  async function loadList(fresh = false) {
    highlightNav();
    const ul = $('#messageList');
    if (state.view === 'drafts') return renderDraftList();
    ul.innerHTML = `<li class="list-empty">${spin('A carregar…')}</li>`;
    try {
      const q = new URLSearchParams({ account: state.account, folder: state.folder, q: state.query });
      if (fresh) q.set('fresh', '1');
      const r = await api(`/api/messages?${q}`);
      state.items = r.items;
      $('#listErrors').textContent = r.errors.join(' · ');
      state.index = -1;
      renderList();
    } catch (e) { ul.innerHTML = `<li class="list-empty">Não consegui carregar: ${esc(e.message)}</li>`; }
  }
  function renderList() {
    const ul = $('#messageList');
    if (!state.items.length) { ul.innerHTML = `<li class="list-empty">${state.query ? 'Nada encontrado.' : 'Caixa vazia.'}</li>`; return; }
    ul.innerHTML = state.items.map((m, i) => {
      const person = m.folder === 'Sent' ? `Para: ${who(m.to)}` : who(m.from);
      return `<li class="msg ${m.seen ? '' : 'unread'} ${i === state.index ? 'active' : ''}" data-i="${i}">
        <span class="dot" style="background:${esc(acc(m.account).color)}" title="${esc(acc(m.account).label)}"></span>
        <span class="who">${esc(person)}</span><span class="when">${when(m.date)}</span>
        <span class="subj">${esc(m.subject)}</span><span class="snip">${esc(m.snippet)}</span></li>`;
    }).join('');
  }
  $('#messageList').addEventListener('click', (e) => {
    const li = e.target.closest('.msg'); if (!li) return;
    if (state.view === 'drafts') return openDraft(state.drafts.find((d) => d.id === li.dataset.id));
    select(Number(li.dataset.i));
  });
  function select(i) {
    if (state.mode !== 'classic' || i < 0 || i >= state.items.length) return;
    state.index = i; renderList();
    $(`.msg[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    openMessage(state.items[i]);
  }
  async function openMessage(item) {
    app().classList.add('reading');
    const reader = $('#reader');
    reader.innerHTML = `<div class="pane">${spin('A abrir…')}</div>`;
    try {
      const m = await api(`/api/message/${item.account}/${item.uid}?folder=${item.folder || state.folder}`);
      m.folder = item.folder || state.folder;
      state.current = m;
      const it = state.items.find((x) => x.uid === m.uid && x.account === m.account && x.folder === m.folder);
      if (it) { it.seen = true; renderList(); }
      renderMessage(m);
    } catch (e) { reader.innerHTML = `<div class="pane">Não consegui abrir: ${esc(e.message)}</div>`; }
  }
  const backBtn = () => `<button type="button" class="btn back" data-act="back">← Voltar</button>`;
  function renderMessage(m) {
    $('#reader').innerHTML = `<article class="pane">
      ${backBtn()}
      <h1 class="selectable">${esc(m.subject)}</h1>
      <div class="meta">
        <span><b>${esc(who(m.from))}</b> ${esc(m.from?.[0]?.address || '')}</span>
        <span>para ${esc(who(m.to))}${m.cc?.length ? ` · cc ${esc(who(m.cc))}` : ''}</span>
        <span>${new Date(m.date).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <span>${dot(m.account)} ${esc(acc(m.account).label)}</span>
      </div>
      <div class="actions">
        <button class="btn primary" data-act="reply">Responder<kbd>r</kbd></button>
        <button class="btn" data-act="summary">Resumir<kbd>s</kbd></button>
        <button class="btn" data-act="suggest">Sugerir respostas<kbd>g</kbd></button>
        ${m.html ? `<button class="btn" data-act="html">Ver original</button>` : ''}
        <button class="btn" data-act="unread">Marcar por ler</button>
      </div>
      <div id="aiBox"></div>
      <div id="bodyBox" class="body">${esc(textOf(m))}</div>
      ${m.attachments?.length ? `<div class="attach">Anexos: ${m.attachments.map((x) => esc(x.filename || 'sem nome')).join(', ')}</div>` : ''}
    </article>`;
  }
  $('#reader').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') return app().classList.remove('reading');
    if (act === 'reply') reply();
    if (act === 'summary') summarize();
    if (act === 'suggest') suggest();
    if (act === 'html') showHtml(b);
    if (act === 'unread') markUnread();
  });
  function showHtml(btn) {
    const m = state.current, box = $('#bodyBox');
    if (box.dataset.mode === 'html') { box.dataset.mode = ''; box.className = 'body'; box.textContent = textOf(m); btn.textContent = 'Ver original'; return; }
    // Sandbox sem scripts; imagens remotas bloqueadas (evita pixels de rastreio).
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:">`;
    box.dataset.mode = 'html'; box.className = '';
    box.innerHTML = `<iframe class="htmlframe" sandbox="" style="height:70vh"></iframe><div class="hint" style="margin-top:6px">Imagens remotas bloqueadas.</div>`;
    $('iframe', box).srcdoc = csp + m.html;
    btn.textContent = 'Ver texto';
  }
  async function markUnread() {
    const m = state.current;
    await api(`/api/message/${m.account}/${m.uid}/seen`, { method: 'POST', body: { seen: false, folder: m.folder } });
    const it = state.items.find((x) => x.uid === m.uid && x.account === m.account);
    if (it) it.seen = false;
    renderList(); toast('Marcada por ler');
  }
  async function summarize() {
    const m = state.current; if (!m || state.mode !== 'classic') return;
    const box = $('#aiBox');
    box.innerHTML = `<div class="ai">${spin('A resumir…')}</div>`;
    try {
      const r = await api('/api/ai/summarize', { method: 'POST', body: { account: m.account, uid: m.uid, folder: m.folder } });
      box.innerHTML = `<div class="ai selectable">
        <div class="ai-label">Resumo <span class="pill ${esc(r.prioridade)}">${esc(r.prioridade || '')}</span>${r.prazo ? `<span class="pill">prazo: ${esc(r.prazo)}</span>` : ''}</div>
        <div>${esc(r.resumo)}</div>
        ${r.pedidos?.length ? `<ul>${r.pedidos.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        ${r.acao ? `<div style="margin-top:8px"><span class="muted">Próximo passo:</span> ${esc(r.acao)}</div>` : ''}</div>`;
    } catch (e) { box.innerHTML = `<div class="ai">Erro: ${esc(e.message)}</div>`; }
  }
  async function suggest(intent = '') {
    const m = state.current; if (!m || state.mode !== 'classic') return;
    const box = $('#aiBox');
    box.innerHTML = `<div class="ai">${spin('A preparar respostas…')}</div>`;
    try {
      const list = await api('/api/ai/replies', { method: 'POST', body: { account: m.account, uid: m.uid, folder: m.folder, intent } });
      box.innerHTML = `<div class="ai"><div class="ai-label">Sugestões de resposta</div>
        ${list.map((s, i) => `<div class="suggestion"><div class="s-head"><b>${esc(s.label)}</b><button class="btn" data-use="${i}">Usar</button></div><div class="s-body">${esc(s.body)}</div></div>`).join('')}
        <form class="intent"><input name="intent" placeholder="Ou diz o que queres responder… (ex.: aceito, mas só em fevereiro)" value="${esc(intent)}" aria-label="Intenção da resposta" /><button class="btn">Gerar</button></form></div>`;
      $$('[data-use]', box).forEach((b) => (b.onclick = () => reply(list[b.dataset.use].body)));
      $('.intent', box).onsubmit = (e) => { e.preventDefault(); suggest(e.target.intent.value); };
    } catch (e) { box.innerHTML = `<div class="ai">Erro: ${esc(e.message)}</div>`; }
  }
  function reply(body = '') {
    const m = state.current; if (!m || state.mode !== 'classic') return;
    const target = m.folder === 'Sent' ? m.to : (m.replyTo?.length ? m.replyTo : m.from);
    const quote = `\n\nEm ${new Date(m.date).toLocaleString('pt-PT')}, ${whoFull(m.from)} escreveu:\n` + textOf(m).split('\n').slice(0, 40).map((l) => '> ' + l).join('\n');
    compose({ account: m.account, to: target.map((a) => a.address).join(', '), subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, text: body + quote, inReplyTo: m.messageId, references: [...(m.references || []), m.messageId].filter(Boolean) });
  }

  // ---------- compor ----------
  function compose(d = {}) {
    closeFocus();
    app().classList.add('reading');
    const accounts = state.status.accounts;
    const defAcc = d.account || (state.account !== 'all' ? state.account : accounts[0]?.id);
    $('#reader').innerHTML = `<form class="pane" id="composeForm">
      ${backBtn()}
      <h1>${d.draftId ? 'Rascunho' : d.inReplyTo ? 'Resposta' : 'Nova mensagem'}</h1>
      ${d.note ? `<div class="ai"><div class="ai-label">Nota do assistente</div>${esc(d.note)}</div>` : ''}
      <div class="row">
        <div class="field" style="max-width:220px"><label for="cFrom">De</label><select id="cFrom" name="account">${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === defAcc ? 'selected' : ''}>${esc(a.address)}</option>`).join('')}</select></div>
        <div class="field"><label for="cTo">Para</label><input id="cTo" name="to" value="${esc(d.to || '')}" required /></div>
      </div>
      <div class="row">
        <div class="field"><label for="cCc">Cc</label><input id="cCc" name="cc" value="${esc(d.cc || '')}" /></div>
        <div class="field"><label for="cBcc">Bcc</label><input id="cBcc" name="bcc" value="${esc(d.bcc || '')}" /></div>
      </div>
      <div class="field"><label for="cSubj">Assunto</label><input id="cSubj" name="subject" value="${esc(d.subject || '')}" required /></div>
      <div class="field"><label for="cText">Mensagem</label><textarea id="cText" name="text" class="tall">${esc(d.text || '')}</textarea></div>
      ${d.draftId ? `<label class="checks" style="margin-bottom:14px"><input type="checkbox" name="reviewed" ${d.reviewed ? 'checked' : ''}/> Revisto e pronto a enviar</label>` : ''}
      <div class="actions">
        <button class="btn primary" type="submit" id="sendBtn">Enviar</button>
        <button class="btn" type="button" id="saveDraft">Guardar rascunho</button>
        ${d.draftId ? `<button class="btn danger" type="button" id="delDraft">Apagar rascunho</button>` : ''}
        ${state.mode === 'topics' ? `<button class="btn" type="button" id="backTopics">Voltar aos tópicos</button>` : ''}
      </div>
    </form>`;
    const f = $('#composeForm');
    const val = () => ({ ...Object.fromEntries(new FormData(f)), reviewed: f.reviewed?.checked || false, inReplyTo: d.inReplyTo, references: d.references, draftId: d.draftId });
    let armed = null;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('#sendBtn');
      if (!armed) { btn.textContent = `Confirmar envio para ${val().to.split(',').length} destinatário(s)`; armed = setTimeout(() => { armed = null; btn.textContent = 'Enviar'; }, 4000); return; }
      clearTimeout(armed); armed = null;
      btn.disabled = true; btn.innerHTML = spin('A enviar…');
      try {
        const v = val();
        await api('/api/send', { method: 'POST', body: v });
        emit('mail-sent', { account: v.account, to: v.to, subject: v.subject });
        toast('Enviado');
        await refreshDrafts();
        if (state.view === 'drafts') { renderDraftList(); renderDraftsHome(); }
        else if (state.mode === 'topics') loadTopics(true);
        else $('#reader').innerHTML = `<div class="empty">Enviado.</div>`;
      } catch (err) { btn.disabled = false; btn.textContent = 'Enviar'; toast('Erro: ' + err.message); }
    };
    $('#saveDraft').onclick = async () => {
      const v = val();
      const body = { account: v.account, to: v.to, cc: v.cc, bcc: v.bcc, subject: v.subject, text: v.text, reviewed: v.reviewed, inReplyTo: v.inReplyTo, references: v.references };
      if (d.draftId) await api(`/api/drafts/${d.draftId}`, { method: 'PUT', body });
      else { const nd = await api('/api/drafts', { method: 'POST', body }); d.draftId = nd.id; }
      await refreshDrafts(); if (state.view === 'drafts') renderDraftList();
      toast('Rascunho guardado');
    };
    if (d.draftId) $('#delDraft').onclick = async () => { await api(`/api/drafts/${d.draftId}`, { method: 'DELETE' }); await refreshDrafts(); renderDraftList(); renderDraftsHome(); toast('Rascunho apagado'); };
    $('#backTopics')?.addEventListener('click', () => { $('#reader').innerHTML = ''; loadTopics(); });
    (d.to ? $('#cText') : $('#cTo')).focus();
    if (d.to && d.text && !d.draftId) $('#cText').setSelectionRange(0, 0);
  }

  // ---------- rascunhos ----------
  async function refreshDrafts() { state.drafts = await api('/api/drafts'); highlightNav(); }
  function renderDraftList() {
    const list = state.drafts.filter((d) => state.account === 'all' || d.account === state.account);
    $('#listErrors').textContent = '';
    $('#messageList').innerHTML = list.length
      ? list.map((d) => `<li class="msg" data-id="${d.id}">
          <span class="dot" style="background:${esc(acc(d.account).color)}"></span>
          <span class="who">Para: ${esc(d.to || '—')}</span><span class="when">${when(d.createdAt)}</span>
          <span class="subj">${esc(d.subject || '(sem assunto)')}</span>
          <span class="snip">${d.reviewed ? '<span class="tag" style="margin:0 6px 0 0">revisto</span>' : ''}${d.source && d.source !== 'manual' ? `<span class="tag" style="margin:0 6px 0 0">${esc(d.source)}</span>` : ''}${esc((d.text || '').slice(0, 140))}</span></li>`).join('')
      : `<li class="list-empty">Sem rascunhos.</li>`;
  }
  const openDraft = (d) => d && compose({ ...d, draftId: d.id });
  function renderDraftsHome() {
    const reviewed = state.drafts.filter((d) => d.reviewed);
    $('#reader').innerHTML = `<div class="pane"><h1>Rascunhos</h1>
      <p class="muted">Tudo o que o assistente prepara fica aqui. Nada sai sem tu enviares. Abre cada rascunho, ajusta e marca “Revisto”.</p>
      <div class="actions"><button class="btn primary" id="sendReviewed" ${reviewed.length ? '' : 'disabled'}>Enviar ${reviewed.length} revisto(s)</button></div>
      <div id="batchLog" class="log" hidden></div></div>`;
    $('#sendReviewed').onclick = async (e) => {
      const btn = e.target;
      if (!btn.dataset.armed) { btn.dataset.armed = 1; btn.textContent = `Confirmar: enviar ${reviewed.length} e-mail(s) agora`; return; }
      btn.disabled = true;
      const log = $('#batchLog'); log.hidden = false;
      for (const d of reviewed) {
        try { await api('/api/send', { method: 'POST', body: { ...d, draftId: d.id } }); log.insertAdjacentHTML('beforeend', `<div>✓ ${esc(d.to)} — ${esc(d.subject)}</div>`); }
        catch (err) { log.insertAdjacentHTML('beforeend', `<div>✗ ${esc(d.to)} — ${esc(err.message)}</div>`); }
        await new Promise((r) => setTimeout(r, 1500));
      }
      await refreshDrafts(); renderDraftList(); btn.textContent = 'Concluído';
    };
  }

  // =====================================================================
  // Vistas do assistente
  // =====================================================================
  function openView(view) {
    closeFocus();
    state.view = view;
    if (view === 'drafts' && state.mode !== 'classic') { state.mode = 'classic'; ls.set('mailroom.mode', 'classic'); app().dataset.mode = 'classic'; }
    highlightNav();
    app().classList.add('reading');
    if (view === 'drafts') { renderDraftList(); renderDraftsHome(); return; }
    if (state.mode === 'classic' && !state.items.length) loadList();
    ({ triage: viewTriage, pitch: viewPitch, publish: viewPublish, agent: viewAgent, settings: viewSettings })[view]?.();
  }

  async function viewTriage() {
    $('#reader').innerHTML = `<div class="pane">${backBtn()}<h1>Triagem</h1><div id="tri">${spin('A ler as mensagens por ler…')}</div></div>`;
    try {
      const r = await api('/api/ai/triage', { method: 'POST', body: { account: state.account } });
      $('#tri').innerHTML = `<p>${esc(r.resumo)}</p>` + (r.itens || []).map((i) => `
        <div class="card" data-ref="${esc(i.ref)}" style="cursor:pointer">
          <div class="c-head"><span>${dot(i.msg.account)} ${esc(who(i.msg.from))}</span><span class="pill ${esc(i.prioridade)}">${esc(i.prioridade)}</span></div>
          <div class="c-title">${esc(i.msg.subject)}</div><div class="muted">${esc(i.acao)}</div></div>`).join('');
      $$('#tri .card').forEach((c) => (c.onclick = () => {
        const it = r.itens.find((x) => x.ref === c.dataset.ref).msg;
        if (state.mode === 'topics') { const t = state.topics.find((x) => x.messages.some((m) => m.uid === it.uid && m.folder === 'INBOX' && x.account === it.account)); if (t) return openFocus(t.id); }
        state.view = 'mail'; state.folder = 'INBOX'; if (state.mode !== 'classic') setMode('classic'); highlightNav();
        openMessage({ ...it, folder: 'INBOX' });
      }));
    } catch (e) { $('#tri').textContent = 'Erro: ' + e.message; }
  }

  function accountSelect(name = 'account') {
    const def = state.account !== 'all' ? state.account : state.status.accounts[0]?.id;
    return `<select name="${name}" id="${name}">${state.status.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === def ? 'selected' : ''}>${esc(a.address)}</option>`).join('')}</select>`;
  }
  function parseContacts(text) {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const email = (line.match(/[^\s,;<>"]+@[^\s,;<>"]+\.[a-z]{2,}/i) || [])[0];
      if (!email) return null;
      const [before, after = ''] = line.split(email);
      const clean = (s) => s.replace(/^[\s,;\t<>"-]+|[\s,;\t<>"-]+$/g, '');
      const parts = clean(after).split(/[;\t]|,(?=\s*\S)/).map(clean).filter(Boolean);
      return { name: clean(before), email, org: parts.length > 1 ? parts[0] : '', notes: parts.length > 1 ? parts.slice(1).join('; ') : parts[0] || '' };
    }).filter(Boolean);
  }

  function viewPitch() {
    $('#reader').innerHTML = `<form class="pane" id="pitchForm">
      ${backBtn()}<h1>Pitch</h1>
      <p class="muted">Descreve o que queres propor e cola os contactos. O assistente escreve um e-mail personalizado por pessoa e deixa-os nos Rascunhos para reveres.</p>
      <div class="row">
        <div class="field"><label for="account">Enviar de</label>${accountSelect()}</div>
        <div class="field"><label for="lang">Língua</label><select id="lang" name="language"><option value="auto">Automática por contacto</option><option value="pt-PT">Português</option><option value="en">Inglês</option></select></div>
      </div>
      <div class="chips">
        <button type="button" class="chip" data-brief="Proponho uma cópia de review do Bulbous, jogo de cartas small-box da bitnikgames (2-5 jogadores, 20 min). Posso enviar print & play ou cópia física. Pedido: confirmar interesse e morada.">Review do Bulbous</button>
        <button type="button" class="chip" data-brief="Proponho a oficina de modelação 3D com o 3D Monco (browser, sem instalação) para turmas do 2.º/3.º ciclo. Sessões de 90 min, levo o plano de aula. Pedido: marcar uma chamada de 15 min.">Oficina 3D para escolas</button>
      </div>
      <div class="field"><label for="brief">Briefing</label><textarea id="brief" name="brief" required placeholder="O que é, porque interessa, o que pedes no fim."></textarea></div>
      <div class="field"><label for="contacts">Contactos — um por linha</label><textarea id="contacts" name="contacts" required placeholder="Ana Lopes, ana@revista.pt; Tabletop Mag; escreveu sobre jogos small-box em outubro&#10;Tom Becker <tom@blog.example>; reviews de party games"></textarea></div>
      <div class="hint" id="contactsHint">Nome, e-mail; organização; notas sobre a pessoa (quanto mais concretas, melhor o pitch).</div>
      <div class="actions"><button class="btn primary">Preparar rascunhos</button></div>
      <div id="pitchOut"></div></form>`;
    const f = $('#pitchForm');
    $$('.chip', f).forEach((c) => (c.onclick = () => (f.brief.value = c.dataset.brief)));
    f.contacts.oninput = () => { $('#contactsHint').textContent = `${parseContacts(f.contacts.value).length} contacto(s) reconhecido(s).`; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const contacts = parseContacts(f.contacts.value);
      if (!contacts.length) return toast('Não encontrei e-mails nos contactos');
      if (contacts.length > 30) return toast('Máximo 30 contactos de cada vez');
      $('#pitchOut').innerHTML = spin(`A escrever ${contacts.length} pitch(es)…`);
      try {
        const drafts = await api('/api/ai/pitch', { method: 'POST', body: { account: f.account.value, language: f.language.value, brief: f.brief.value, contacts } });
        await refreshDrafts();
        $('#pitchOut').innerHTML = `<h2>${drafts.length} rascunho(s) criados</h2>` + drafts.map((d) => `
          <div class="card"><div class="c-head"><span>Para ${esc(d.to)}</span><button type="button" class="btn" data-open="${d.id}">Rever</button></div>
          <div class="c-title">${esc(d.subject)}</div><div class="muted" style="margin-bottom:6px">${esc(d.note || '')}</div><div class="c-body">${esc(d.text)}</div></div>`).join('');
        $$('[data-open]').forEach((b) => (b.onclick = () => { openView('drafts'); openDraft(state.drafts.find((d) => d.id === b.dataset.open)); }));
      } catch (err) { $('#pitchOut').textContent = 'Erro: ' + err.message; }
    };
  }

  const FORMAT_LABEL = { email: 'E-mail', newsletter: 'Newsletter', blog: 'Blog', linkedin: 'LinkedIn', instagram: 'Instagram', bluesky: 'Bluesky / Mastodon' };
  function viewPublish() {
    $('#reader').innerHTML = `<form class="pane" id="pubForm">
      ${backBtn()}<h1>Publicação</h1>
      <p class="muted">Um anúncio, várias versões: cada canal com o seu tamanho e ritmo. Copia o que precisares ou passa o e-mail para rascunho.</p>
      <div class="field"><label for="pbrief">Briefing</label><textarea id="pbrief" name="brief" required placeholder="Ex.: novo print & play do Bulbous com margens para A4; grátis até ao fim do mês; link [loja]."></textarea></div>
      <div class="field"><label>Formatos</label><div class="checks">${state.status.formats.map((f) => `<label><input type="checkbox" name="fmt" value="${f}" ${['email', 'linkedin', 'instagram'].includes(f) ? 'checked' : ''}/> ${FORMAT_LABEL[f] || f}</label>`).join('')}</div></div>
      <div class="row">
        <div class="field"><label for="plang">Língua</label><select id="plang" name="language"><option value="pt-PT">Português</option><option value="en">Inglês</option><option value="pt-PT e en (duas versões)">PT + EN</option></select></div>
        <div class="field"><label for="account">Conta (para o e-mail)</label>${accountSelect()}</div>
      </div>
      <div class="actions"><button class="btn primary">Gerar versões</button></div>
      <div id="pubOut"></div></form>`;
    const f = $('#pubForm');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const formats = $$('input[name=fmt]:checked', f).map((x) => x.value);
      if (!formats.length) return toast('Escolhe pelo menos um formato');
      $('#pubOut').innerHTML = spin('A escrever…');
      try {
        const out = await api('/api/ai/publish', { method: 'POST', body: { brief: f.brief.value, formats, language: f.language.value } });
        $('#pubOut').innerHTML = out.map((o, i) => `
          <div class="card"><div class="c-head"><span>${esc(FORMAT_LABEL[o.format] || o.format)} · ${(o.body || '').length} caracteres</span>
            <span><button type="button" class="btn" data-copy="${i}">Copiar</button>${['email', 'newsletter'].includes(o.format) ? ` <button type="button" class="btn" data-draft="${i}">Para rascunho</button>` : ''}</span></div>
            ${o.subject ? `<div class="c-title">${esc(o.subject)}</div>` : ''}<div class="c-body selectable">${esc(o.body)}</div></div>`).join('');
        $$('[data-copy]').forEach((b) => (b.onclick = async () => { const o = out[b.dataset.copy]; await navigator.clipboard.writeText((o.subject ? o.subject + '\n\n' : '') + o.body); toast('Copiado'); }));
        $$('[data-draft]').forEach((b) => (b.onclick = async () => {
          const o = out[b.dataset.draft];
          await api('/api/drafts', { method: 'POST', body: { account: f.account.value, to: '', subject: o.subject || '', text: o.body, source: 'publicação', note: 'Põe os destinatários em Bcc para envios a uma lista.' } });
          await refreshDrafts(); toast('Rascunho criado');
        }));
      } catch (err) { $('#pubOut').textContent = 'Erro: ' + err.message; }
    };
  }

  function viewAgent() {
    $('#reader').innerHTML = `<form class="pane" id="agentForm">
      ${backBtn()}<h1>Agente</h1>
      <p class="muted">Dá-lhe um objetivo. Ele pesquisa e lê as tuas caixas e prepara rascunhos — nunca envia nada.</p>
      <div class="chips">
        <button type="button" class="chip">Vê os pitches que enviei nas últimas 3 semanas pelo bitnik.games que ainda não tiveram resposta e prepara follow-ups curtos.</button>
        <button type="button" class="chip">Encontra pedidos de oficinas ou formação no monco.io deste mês e prepara respostas com as minhas datas por confirmar.</button>
        <button type="button" class="chip">Responde a quem perguntou sobre problemas com o print & play, com um pedido de desculpa e a solução por preencher.</button>
      </div>
      <div class="field"><label for="goal">Objetivo</label><textarea id="goal" name="goal" required></textarea></div>
      <div class="actions"><button class="btn primary" id="runAgent">Executar</button></div>
      <div id="agentLog" class="log" hidden></div><div id="agentOut"></div></form>`;
    const f = $('#agentForm');
    $$('.chip', f).forEach((c) => (c.onclick = () => (f.goal.value = c.textContent)));
    const label = { list_messages: 'pesquisar', read_message: 'ler', queue_draft: 'rascunho' };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const log = $('#agentLog'), out = $('#agentOut');
      log.hidden = false; log.innerHTML = ''; out.innerHTML = spin('A trabalhar…');
      $('#runAgent').disabled = true;
      try {
        const r = await fetch(base + '/api/ai/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: f.goal.value }) });
        const reader = r.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n'); buf = lines.pop();
          for (const line of lines.filter(Boolean)) {
            const ev = JSON.parse(line);
            if (ev.type === 'step') log.insertAdjacentHTML('beforeend', `<div>→ ${label[ev.tool] || ev.tool} ${esc(Object.values(ev.input || {}).filter((v) => typeof v === 'string' && v.length < 60).join(' · '))}</div>`);
            if (ev.type === 'draft') log.insertAdjacentHTML('beforeend', `<div>✎ rascunho para ${esc(ev.draft.to)}: ${esc(ev.draft.subject)}</div>`);
            if (ev.type === 'done') out.innerHTML = `<div class="ai"><div class="ai-label">Resultado</div><div style="white-space:pre-wrap">${esc(ev.summary)}</div>${ev.drafts ? `<div class="actions" style="margin:10px 0 0"><button type="button" class="btn primary" id="toDrafts">Rever ${ev.drafts} rascunho(s)</button></div>` : ''}</div>`;
            if (ev.type === 'error') out.innerHTML = `<div class="ai">Erro: ${esc(ev.error)}</div>`;
          }
        }
        await refreshDrafts();
        const t = $('#toDrafts'); if (t) t.onclick = () => openView('drafts');
      } catch (err) { out.textContent = 'Erro: ' + err.message; }
      $('#runAgent').disabled = false;
    };
  }

  // ---------- definições ----------
  async function viewSettings() {
    const [s, a] = await Promise.all([api('/api/settings'), api('/api/ai-settings')]);
    const presetOpts = Object.entries(a.presets).map(([k, v]) => `<option value="${k}" ${k === a.preset ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
    $('#reader').innerHTML = `<div class="pane">
      ${backBtn()}<h1>Definições</h1>

      <h2>Inteligência artificial</h2>
      <p class="muted" style="margin-top:0">Usada nos resumos dos tópicos, sugestões de resposta, pesquisa rápida e workflows.</p>
      ${a.locked ? `<div class="card">Gerido pela plataforma: <b>${esc(a.provider)}</b> ${esc(a.model)}</div>` : `
      <form id="aiForm">
        <div class="row">
          <div class="field"><label for="aiPreset">Fornecedor</label><select id="aiPreset" name="preset"><option value="">— nenhum (simulado) —</option>${presetOpts}</select></div>
          <div class="field"><label for="aiModel">Modelo</label><input id="aiModel" name="model" list="aiModels" value="${esc(a.model)}" placeholder="escolhe da lista ou escreve o nome" autocomplete="off" /><datalist id="aiModels"></datalist></div>
        </div>
        <div class="field" id="baseField"><label for="aiBase">URL da API</label><input id="aiBase" name="baseURL" value="${esc(a.baseURL)}" placeholder="https://…/v1" /></div>
        <div class="field"><label for="aiKey">Chave da API</label><input id="aiKey" name="apiKey" type="password" autocomplete="off" placeholder="${a.hasKey ? `guardada (${esc(a.keyHint)}, origem: ${esc(a.keySource)}) — escreve para substituir` : 'cola aqui a chave'}" /></div>
        <p class="hint">A chave fica no servidor desta app e nunca é enviada para o browser. ${a.keySource === 'definições' ? '<a href="#" id="forgetKey">Esquecer chave guardada</a>' : ''}</p>
        <div id="aiStatus" class="status-line ${a.enabled ? 'ok' : ''}">${a.enabled ? `Ativo${a.model ? ` · ${esc(a.model)}` : ''}` : 'Sem fornecedor: as funções de IA estão em modo simulado.'}</div>
        <div class="actions"><button class="btn primary">Guardar</button><button class="btn" type="button" id="aiTest">Testar ligação</button></div>
      </form>`}

      ${hostTheme ? '' : `<h2>Aparência</h2>
      <div class="field" style="max-width:260px"><label for="pTheme">Tema</label><select id="pTheme"><option value="light">Claro</option><option value="dark">Escuro</option><option value="auto">Igual ao sistema</option></select></div>`}

      <h2>Comportamento</h2>
      <label class="toggle"><input type="checkbox" id="pTopics" ${s.prefs.autoTopics ? 'checked' : ''}/> Resumir tópicos automaticamente ao abrir</label>
      <label class="toggle"><input type="checkbox" id="pSuggest" ${s.prefs.autoSuggest ? 'checked' : ''}/> Sugerir resposta ao abrir um tópico</label>

      <form id="setForm">
        <h2>Sobre ti</h2>
        <p class="muted" style="margin-top:0">O que o assistente sabe sobre ti quando escreve.</p>
        <div class="field"><label for="sname">Nome</label><input id="sname" name="name" value="${esc(s.name)}" /></div>
        <div class="field"><label for="sabout">Sobre ti e os teus projetos</label><textarea id="sabout" name="about">${esc(s.about)}</textarea></div>
        <div class="field"><label for="svoice">Voz e tom</label><textarea id="svoice" name="voice">${esc(s.voice)}</textarea></div>
        <div class="actions"><button class="btn primary">Guardar</button></div>
      </form>

      <h2 id="accountsTitle">Contas</h2>
      <div id="accountsBox"></div>

      <h2>Versão</h2>
      <div id="versionBox" class="muted">${spin('A verificar atualizações…')}</div>
    </div>`;
    renderAccounts();
    renderVersion(true);

    $('#setForm').onsubmit = async (e) => { e.preventDefault(); await api('/api/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Guardado'); };
    const savePrefs = async () => {
      const r = await api('/api/settings', { method: 'PUT', body: { ...s, prefs: { autoTopics: $('#pTopics').checked, autoSuggest: $('#pSuggest').checked } } });
      state.status.prefs = r.prefs; toast('Guardado');
    };
    $('#pTopics').onchange = savePrefs; $('#pSuggest').onchange = savePrefs;
    const th = $('#pTheme');
    if (th) { th.value = ls.get('mailroom.theme') || 'light'; th.onchange = () => { ls.set('mailroom.theme', th.value); applyTheme(th.value); }; }

    const f = $('#aiForm'); if (!f) return;
    const syncPreset = (apply) => {
      const p = a.presets[f.preset.value];
      $('#baseField').hidden = !p || p.provider !== 'openai';
      if (apply && p) { f.baseURL.value = p.baseURL; if (!f.model.value || Object.values(a.presets).some((x) => x.model === f.model.value)) f.model.value = p.model; }
    };
    syncPreset(false);
    f.preset.onchange = () => syncPreset(true);
    // Modelos disponíveis no fornecedor guardado (precisa da chave já guardada).
    const loadModels = async () => { try { const r = await api('/api/ai-settings/models'); $('#aiModels').innerHTML = r.models.map((m) => `<option value="${esc(m)}"></option>`).join(''); } catch {} };
    loadModels();
    const status = (cls, text) => { const el = $('#aiStatus'); el.className = `status-line ${cls}`; el.textContent = text; };
    const save = async (extra = {}) => {
      const p = a.presets[f.preset.value];
      const r = await api('/api/ai-settings', { method: 'PUT', body: { preset: f.preset.value, provider: p?.provider || '', model: f.model.value.trim(), baseURL: p?.provider === 'openai' ? f.baseURL.value.trim() : '', apiKey: f.apiKey.value, ...extra } });
      f.apiKey.value = '';
      f.apiKey.placeholder = r.hasKey ? `guardada (${r.keyHint}, origem: ${r.keySource}) — escreve para substituir` : 'cola aqui a chave';
      state.status = await api('/api/status'); renderBadge();
      state.topics.forEach((t) => (t.ai = null));
      status(r.enabled ? 'ok' : 'err', r.enabled ? `Guardado · ativo${r.model ? ` · ${r.model}` : ''}` : `Guardado, mas falta ${!r.hasKey && !/localhost|127\.0\.0\.1/.test(r.baseURL) ? 'a chave' : !r.model ? 'o nome do modelo' : 'o URL da API'}.`);
      loadModels();
      return r;
    };
    f.onsubmit = async (e) => { e.preventDefault(); try { await save(); } catch (err) { status('err', err.message); } };
    $('#aiTest').onclick = async () => {
      status('', ''); $('#aiStatus').innerHTML = spin('A testar…');
      try {
        if (f.apiKey.value || f.model.value) await save();
        const r = await api('/api/ai-settings/test', { method: 'POST' });
        status(r.ok ? 'ok' : 'err', r.ok ? `Ligação OK · ${r.model} · ${r.ms} ms` : `Falhou: ${r.error}`);
      } catch (err) { status('err', err.message); }
    };
    $('#forgetKey')?.addEventListener('click', async (e) => { e.preventDefault(); await save({ clearKey: true }); toast('Chave apagada'); viewSettings(); });
  }

  // ---------- contas ----------
  async function renderAccounts() {
    const box = $('#accountsBox'); if (!box) return;
    const r = await api('/api/accounts');
    const list = r.accounts.map((x) => `<div class="card"><div class="c-head" style="margin:0"><span><span class="dot" style="display:inline-block;background:${esc(x.color)}"></span> <b style="color:var(--ink)">${esc(x.label)}</b> ${esc(x.address)} · ${esc(x.imap.host || '')}${x.filterTo ? ` · só correio para @${esc(x.filterTo)}` : ''}</span>${r.editable ? `<button class="btn danger" data-del="${esc(x.id)}">Remover</button>` : ''}</div></div>`).join('');
    if (!r.editable) { box.innerHTML = list + `<p class="hint">As contas são geridas no servidor (ACCOUNTS_JSON ou pela plataforma onde o mailroom está integrado).</p>`; return; }
    box.innerHTML = (list || `<p class="muted">Ainda não há contas: estás a ver a caixa de demonstração.</p>`) + `
      <form id="accForm" class="card">
        <div class="c-title">Adicionar conta</div>
        <div class="row">
          <div class="field"><label for="aKind">Tipo</label><select id="aKind" name="kind"><option value="gmail">Gmail (incl. domínio próprio reencaminhado)</option><option value="imap">Outro (IMAP/SMTP)</option></select></div>
          <div class="field"><label for="aAddr">Endereço de e-mail</label><input id="aAddr" name="address" type="email" required placeholder="david@monco.io" /></div>
        </div>
        <div class="row">
          <div class="field"><label for="aUser">Utilizador de início de sessão</label><input id="aUser" name="user" placeholder="a tua conta @gmail.com" /></div>
          <div class="field"><label for="aPass" id="aPassLabel">Palavra-passe de app</label><input id="aPass" name="pass" type="password" autocomplete="off" required /></div>
        </div>
        <div class="row" id="aServers" hidden>
          <div class="field"><label for="aImap">Servidor IMAP</label><input id="aImap" name="imapHost" placeholder="imap.exemplo.com" /></div>
          <div class="field" style="max-width:110px"><label for="aImapP">Porta</label><input id="aImapP" name="imapPort" value="993" /></div>
          <div class="field"><label for="aSmtp">Servidor SMTP</label><input id="aSmtp" name="smtpHost" placeholder="smtp.exemplo.com" /></div>
          <div class="field" style="max-width:110px"><label for="aSmtpP">Porta</label><input id="aSmtpP" name="smtpPort" value="465" /></div>
        </div>
        <div class="row">
          <div class="field"><label for="aName">Nome do remetente</label><input id="aName" name="fromName" placeholder="David Ferreira Marques" /></div>
          <div class="field"><label for="aLabel">Nome da caixa</label><input id="aLabel" name="label" placeholder="monco.io" /></div>
        </div>
        <p class="hint" id="aHint">No Gmail usa uma palavra-passe de app (myaccount.google.com/apppasswords), não a palavra-passe normal. Com um domínio próprio, a caixa mostra só o correio desse domínio.</p>
        <div id="accStatus" class="status-line"></div>
        <div class="actions" style="margin:0"><button class="btn primary">Testar e guardar</button></div>
      </form>
      <p class="hint">As palavras-passe ficam guardadas só neste computador.</p>`;
    const f = $('#accForm');
    const sync = () => {
      const gm = f.kind.value === 'gmail';
      $('#aServers').hidden = gm; $('#aHint').hidden = !gm;
      $('#aPassLabel').textContent = gm ? 'Palavra-passe de app' : 'Palavra-passe';
      f.user.placeholder = gm ? 'a tua conta @gmail.com' : 'igual ao endereço, se vazio';
    };
    f.kind.onchange = sync; sync();
    const st = (cls, html) => { const el = $('#accStatus'); el.className = `status-line ${cls}`; el.innerHTML = html; };
    const submit = async (saveAnyway) => {
      st('', spin('A testar a ligação…'));
      try {
        const r2 = await api('/api/accounts', { method: 'POST', body: { ...Object.fromEntries(new FormData(f)), saveAnyway } });
        if (!r2.saved) { st('err', `${r2.test.error.split(' · ').map(esc).join('<br>')}<br><a href="#" id="saveAnyway">Guardar mesmo assim</a>`); $('#saveAnyway').onclick = (e) => { e.preventDefault(); submit(true); }; return; }
        toast(r2.test.ok ? 'Conta ligada' : 'Conta guardada (sem ligação)');
        await accountsChanged();
      } catch (e) { st('err', esc(e.message)); }
    };
    f.onsubmit = (e) => { e.preventDefault(); submit(false); };
    $$('[data-del]', box).forEach((b) => (b.onclick = async () => {
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirmar remoção'; return; }
      await api(`/api/accounts/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
      toast('Conta removida'); await accountsChanged();
    }));
  }
  async function accountsChanged() {
    state.status = await api('/api/status');
    state.account = 'all'; state.topics = []; state.items = []; state.threads.clear(); state.suggestions.clear(); state.open.clear();
    renderNav(); renderAccounts();
  }

  // ---------- atualizações ----------
  async function checkUpdate(fresh = false) {
    try { state.update = await api(`/api/update${fresh ? '?fresh=1' : ''}`); } catch { state.update = null; }
    const b = $('#updateBtn'), u = state.update;
    b.hidden = !u?.available;
    if (u?.available) b.textContent = `Atualizar para v${u.latest}`;
    return u;
  }
  async function applyUpdate(btn) {
    const u = state.update; if (!u?.available) return;
    if (!u.canApply) { window.open(u.url, '_blank', 'noopener'); return; }
    if (!btn.dataset.armed) { btn.dataset.armed = 1; btn.textContent = `Confirmar: instalar v${u.latest}`; setTimeout(() => { delete btn.dataset.armed; if (state.update?.available) btn.textContent = `Atualizar para v${u.latest}`; }, 5000); return; }
    btn.disabled = true; btn.innerHTML = spin('A descarregar…');
    try {
      const r = await api('/api/update/apply', { method: 'POST' });
      btn.textContent = r.restart === 'auto' ? `A instalar v${r.version}…` : `v${r.version} instalada — fecha e volta a abrir`;
      toast(r.restart === 'auto' ? 'A instalar. O mailroom reinicia sozinho.' : 'Atualização instalada. Fecha o mailroom e abre-o outra vez.');
    } catch (e) { btn.disabled = false; btn.textContent = 'Atualização falhou — abrir página'; state.update.canApply = false; toast('Erro: ' + e.message); }
  }
  $('#updateBtn').onclick = (e) => applyUpdate(e.currentTarget);
  async function renderVersion(fresh) {
    const box = $('#versionBox'); if (!box) return;
    const u = await checkUpdate(fresh);
    if (!$('#versionBox')) return;
    const cur = u?.current || state.status.version || '?';
    box.innerHTML = u?.available
      ? `<div class="card"><div class="c-title">Há uma versão nova: v${esc(u.latest)} <span class="muted">(tens a v${esc(cur)})</span></div>${u.notes ? `<div class="c-body muted" style="margin-bottom:10px">${esc(u.notes)}</div>` : ''}<div class="actions" style="margin:0"><button class="btn primary" id="updNow">${u.canApply ? 'Atualizar agora' : 'Abrir página da versão'}</button></div>${u.packaged ? '' : '<p class="hint" style="margin:10px 0 0">Instalação a partir do código: <code>git pull && npm install</code>.</p>'}</div>`
      : `<span>mailroom v${esc(cur)} · ${u?.error ? esc(u.error) : u?.latest ? 'está atualizado' : 'ainda não há versões publicadas'}</span> <button class="btn" id="updCheck">Verificar agora</button>`;
    $('#updNow')?.addEventListener('click', (e) => applyUpdate(e.currentTarget));
    $('#updCheck')?.addEventListener('click', () => { box.innerHTML = spin('A verificar…'); renderVersion(true); });
  }

  // =====================================================================
  // Teclado
  // =====================================================================
  host.addEventListener('keydown', (e) => {
    const tgt = e.composedPath()[0];
    if (e.key === 'Escape') {
      if ($('.ctx')) return closeCtx();
      if ($('.research')) return $('.research').remove();
      if ($('.focus')) return closeFocus();
    }
    if (tgt.closest?.('input, textarea, select')) { if (e.key === 'Escape') tgt.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === '/') { e.preventDefault(); (state.mode === 'topics' ? $('#topicSearch') : $('#search'))?.focus(); return; }
    if (k === 'c') return compose();
    if (k === 'v') return setMode(state.mode === 'topics' ? 'classic' : 'topics');
    if (state.mode === 'classic') {
      if (k === 'j') select(state.index + 1);
      else if (k === 'k') select(Math.max(0, state.index - 1));
      else if (k === 'r') reply();
      else if (k === 's') summarize();
      else if (k === 'g') suggest();
    }
  });

  let searchT;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { state.query = e.target.value.trim(); state.view = 'mail'; loadList(); }, 350);
  });
  $('#composeBtn').onclick = () => compose();
  $('#refreshBtn').onclick = () => loadList(true);

  // =====================================================================
  // Arranque
  // =====================================================================
  (async () => {
    app().dataset.mode = state.mode;
    try { state.status = await api('/api/status'); }
    catch (e) { $('#reader').innerHTML = `<div class="empty">Não consegui ligar ao mailroom em ${esc(base)}.<br><span class="muted">${esc(e.message)}</span></div>`; return; }
    renderNav();
    await refreshDrafts();
    if (state.mode === 'topics') loadTopics(); else { state.view = 'mail'; loadList(); $('#reader').innerHTML = `<div class="empty">Escolhe uma mensagem.<br /><span class="muted">j / k para navegar · r responder · s resumir · c nova · v mudar de vista</span></div>`; }
    highlightNav();
    emit('mail-ready', { accounts: state.status.accounts, mode: state.mode });
    checkUpdate();
  })();

  return { compose, refresh: () => (state.mode === 'topics' ? loadTopics(true) : loadList(true)), openView, setMode, research };
}

class MailRoom extends HTMLElement {
  static get observedAttributes() { return ['brand']; }
  connectedCallback() {
    if (this.shadowRoot) return;
    const base = (this.getAttribute('api') || '/mail').replace(/\/$/, '');
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<link rel="stylesheet" href="${base}/client.css">${SHELL}`;
    root.querySelector('.brand').textContent = this.getAttribute('brand') || 'mailroom';
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    this._api = mount(root, this, base);
  }
  attributeChangedCallback(name, _, v) { if (name === 'brand' && this.shadowRoot) this.shadowRoot.querySelector('.brand').textContent = v || 'mailroom'; }
  /** Abre o compositor preenchido: el.compose({ account, to, subject, text }) */
  compose(d) { this._api?.compose(d); }
  refresh() { this._api?.refresh(); }
  /** 'topics' | 'classic' */
  setMode(m) { this._api?.setMode(m); }
  /** 'triage' | 'pitch' | 'publish' | 'agent' | 'drafts' | 'settings' */
  open(view) { this._api?.openView(view); }
  /** Pesquisa rápida com IA sobre um termo */
  research(q) { this._api?.research(q); }
}
if (!customElements.get('mail-room')) customElements.define('mail-room', MailRoom);
// Nome antigo, mantido por compatibilidade.
if (!customElements.get('bitnik-mail')) customElements.define('bitnik-mail', class extends MailRoom {});
