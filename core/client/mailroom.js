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
  if (s < 86400 * 30) { const d = Math.round(s / 86400); return `há ${d} dia${d > 1 ? 's' : ''}`; }
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
      <div class="group-label">Agenda</div>
      <button class="nav" data-view="calendar">Calendário</button>
    </div>
    <div class="group">
      <div class="group-label">Prospeção</div>
      <button class="nav" data-view="funnel">Funil <span class="count" id="funnelCount"></span></button>
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

  // Tipo de letra: Inter (a do Nimble UI kit) por omissão, e uma seleção do Google Fonts.
  // `w` = pesos pedidos; se o Google recusar, pede-se só a família (o browser sintetiza o negrito).
  const FONTS = {
    Inter: { label: 'Inter (Nimble UI)', w: '400;500;600;700' },
    Lexend: { w: '400;500;600;700' },
    'Hanken Grotesk': { w: '400;500;600;700' },
    Figtree: { w: '400;500;600;700' },
    'Rethink Sans': { w: '400;500;600;700' },
    Sono: { w: '400;500;600;700' },
    'Overpass Mono': { w: '400;500;600;700', mono: true },
    Podkova: { w: '400;500;600;700', serif: true },
    Solway: { w: '400;500;700', serif: true },
    'Redaction 20': { w: '400;700', serif: true },
    system: { label: 'Do sistema (sem descarregar)' },
  };
  const DEFAULT_FONT = 'Inter';
  const applyFont = (name) => {
    const f = FONTS[name] ? name : DEFAULT_FONT;
    if (f === 'system') { host.style.removeProperty('--font'); return; }
    const id = 'mailroom-font-' + f.replace(/\s/g, '-');
    // @font-face não funciona dentro do Shadow DOM: a folha vai para o <head> da página.
    if (!document.getElementById(id)) {
      const fam = encodeURIComponent(f).replace(/%20/g, '+');
      const l = document.createElement('link');
      l.id = id; l.rel = 'stylesheet';
      l.href = `https://fonts.googleapis.com/css2?family=${fam}:wght@${FONTS[f].w}&display=swap`;
      l.onerror = () => { if (!l.dataset.retry) { l.dataset.retry = 1; l.href = `https://fonts.googleapis.com/css2?family=${fam}&display=swap`; } };
      document.head.append(l);
    }
    const fallback = FONTS[f].mono ? 'ui-monospace, monospace' : FONTS[f].serif ? 'Georgia, serif' : 'ui-sans-serif, system-ui, sans-serif';
    host.style.setProperty('--font', `"${f}", ${fallback}`);
  };
  // Escolhas antigas (Roboto, Poppins…) passam para a nova omissão.
  if (ls.get('mailroom.font') && !FONTS[ls.get('mailroom.font')]) ls.set('mailroom.font', DEFAULT_FONT);
  applyFont(ls.get('mailroom.font') || DEFAULT_FONT);

  const state = {
    status: null, account: host.getAttribute('account') || 'all', folder: 'INBOX', view: 'topics',
    mode: host.getAttribute('mode') || ls.get('mailroom.mode') || 'topics',
    items: [], index: -1, current: null, drafts: [], query: '', topicQuery: '',
    topics: [], topicErrors: [], dismissedCount: 0, showDismissed: false, open: new Set(), threads: new Map(), suggestions: new Map(),
  };

  async function api(path, opts = {}) {
    const r = await fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }
  function toast(text, action) {
    $$('.toast').forEach((x) => x.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    if (action) {
      const b = document.createElement('button');
      b.className = 'toast-btn'; b.textContent = action.label;
      b.onclick = () => { t.remove(); action.run(); };
      t.append(' ', b);
    }
    app().append(t);
    setTimeout(() => t.remove(), action ? 6000 : 2600);
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
    app()?.toggleAttribute('data-wide', state.view === 'calendar'); // o calendário usa a largura toda
  }
  // Painel de leitura vazio: números da caixa, botão de nova mensagem e atalhos.
  const SHORTCUTS = [['j', 'k', 'Seguinte / anterior'], ['r', 'Responder'], ['s', 'Resumir com IA'], ['g', 'Sugerir respostas'], ['c', 'Nova mensagem'], ['/', 'Pesquisar'], ['v', 'Mudar de vista'], ['Esc', 'Fechar / sair do campo']];
  const kbd = (k) => `<kbd class="key">${esc(k)}</kbd>`;
  async function readerHome() {
    const reader = $('#reader');
    const where = `${state.account === 'all' ? 'Todas as caixas' : acc(state.account).label} · ${state.folder === 'Sent' ? 'Enviados' : 'Entrada'}`;
    const token = (readerHome.t = (readerHome.t || 0) + 1);
    reader.innerHTML = `<div class="home">
      <p class="home-where">${esc(where)}</p>
      <div class="stats" aria-live="polite">${['Mensagens', 'Lidas', 'Por ler'].map((l) => `<div class="stat"><b>…</b><span>${l}</span></div>`).join('')}</div>
      <button class="btn primary big" data-act="new">Nova mensagem ${kbd('c')}</button>
      <ul class="keys">${SHORTCUTS.map((x) => `<li>${x.slice(0, -1).map(kbd).join(' ')}<span>${esc(x.at(-1))}</span></li>`).join('')}</ul>
    </div>`;
    try {
      const st = await api(`/api/stats?${new URLSearchParams({ account: state.account, folder: state.folder })}`);
      if (token !== readerHome.t || !$('.home', reader)) return;
      const n = (v) => Number(v).toLocaleString('pt-PT');
      $('.stats', reader).innerHTML = [[st.total, 'Mensagens'], [st.read, 'Lidas'], [st.unread, 'Por ler']]
        .map(([v, l]) => `<div class="stat ${l === 'Por ler' && v ? 'hot' : ''}"><b>${n(v)}</b><span>${l}</span></div>`).join('')
        + (st.partial ? '<p class="hint">Algumas caixas não responderam; os números estão incompletos.</p>' : '');
    } catch { if (token === readerHome.t) $('.stats', reader)?.remove(); }
  }
  // Põe o foco do teclado na lista, para j/k funcionarem logo depois de escolher a caixa.
  // Só mexe no foco se ninguém estiver a escrever: a lista pode chegar segundos depois (IMAP lento, correio novo)
  // e não pode tirar o cursor do «Para» de uma mensagem que entretanto se abriu.
  function busyTyping() {
    const el = root.activeElement;
    return !!(el && (el.closest('input, textarea, select, [contenteditable="true"]') || el.closest('.focus, .ctx, .research, .modal, .cal-ed'))) || !!$('#composeForm');
  }
  function focusList() { if (busyTyping()) return; const ul = $('#messageList'); ul.tabIndex = -1; ul.focus({ preventScroll: true }); }

  function setMode(mode) {
    state.mode = mode;
    ls.set('mailroom.mode', mode);
    app().dataset.mode = mode;
    closeFocus();
    if (mode === 'topics') { state.view = 'topics'; app().classList.remove('reading'); loadTopics(); }
    else { state.view = 'mail'; loadList(); readerHome(); }
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
      else { state.view = 'mail'; app().classList.remove('reading'); readerHome(); loadList().then(focusList); }
    }
    if (b.dataset.folder) {
      if (state.mode !== 'classic') { state.mode = 'classic'; ls.set('mailroom.mode', 'classic'); app().dataset.mode = 'classic'; }
      state.folder = b.dataset.folder; state.view = 'mail'; app().classList.remove('reading'); readerHome(); loadList().then(focusList);
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
      if (state.showDismissed) q.set('dismissed', '1');
      if (fresh) q.set('fresh', '1');
      const r = await api(`/api/topics?${q}`);
      state.topics = r.topics; state.topicErrors = r.errors; state.dismissedCount = r.dismissedCount || 0;
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
    const dz = state.dismissedCount;
    head.innerHTML = `<h1>${esc(label)}${state.showDismissed ? ' · arrumados' : ''}</h1>
      <span class="muted">${loading ? spin('a atualizar') : state.showDismissed ? `${n} arrumados` : `${n} conversas · ${unread} por ler · ${waiting} à espera de resposta`}</span>
      ${loading ? '' : state.showDismissed ? `<button class="linkbtn" data-t="showDismissed">← voltar aos tópicos</button>` : dz ? `<button class="linkbtn" data-t="showDismissed">${dz} arrumado${dz > 1 ? 's' : ''}</button>` : ''}
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
        <div class="t-meta">${t.unread ? '<span class="new">nova</span>' : ''}${dot(t.account)} <span>${esc(acc(t.account).label)}</span><span>·</span><span>${esc(who(t.people))}</span><span>·</span><span>${ago(t.lastDate)}</span>${prio ? `<span class="pill ${esc(prio)}">${esc(prio)}</span>` : ''}${t.funnel ? `<span class="pill funnel" title="${esc(t.funnel.streamName)}">${esc(t.funnel.streamName.split(' · ')[0])} · ${esc(t.funnel.label)}</span>` : ''}</div>
        <h2 class="t-title selectable">${esc(title)}</h2>
        <p class="t-summary selectable">${esc(summary)}</p>
        <div class="t-foot">${foot.map((f) => `<span>${f}</span>`).join('')}</div>
      </div>
      ${state.open.has(t.id) ? `<div class="t-body" id="body-${cssId(t.id)}">${spin('A abrir a conversa…')}</div>` : `<div class="t-actions" style="padding:0 22px 16px"><button class="btn" data-t="toggle">Ler e responder</button><button class="btn" data-t="focus">Conversa completa</button><span class="grow"></span>${state.showDismissed ? `<button class="btn" data-t="undismiss">Repor</button>` : `<button class="btn" data-t="dismiss" title="Arrumar (e) — volta se chegar mensagem nova">Arrumar</button>`}</div>`}
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
  function closeFocus() { $('.focus')?.remove(); state.focusId = null; }
  async function openFocus(id, single) {
    closeFocus();
    state.focusId = topicById(id) ? id : null;
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
          ${topicById(id)?.funnel ? `<button class="btn" data-f="funnel">Ver no funil</button>` : topicById(id) ? `<button class="btn" data-f="addFunnel">＋ Funil</button>` : ''}
          ${topicById(id) && !state.showDismissed ? `<button class="btn" data-f="dismiss">Arrumar</button>` : ''}<button class="btn" data-f="toggle">Ver na caixa</button><button class="close" data-f="close" aria-label="Fechar (Esc)" title="Fechar (Esc)">×</button></div>
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
        if (b?.dataset.f === 'dismiss') { closeFocus(); dismissTopic(id); }
        if (b?.dataset.f === 'funnel') { const t = topicById(id); closeFocus(); openView('funnel'); state.funnelStream = t.funnel.stream; state.funnelOpen = t.funnel.contactId; }
        if (b?.dataset.f === 'addFunnel') addToFunnelMenu(b, topicById(id));
        if (b?.dataset.f === 'toggle') { const last = th.messages.at(-1); setMode('classic'); openMessage({ account: th.account, uid: last.uid, folder: last.folder }); }
      });
    } catch (e) { $('.focus-inner', f).innerHTML = `<button class="close" data-f="close">×</button><p>Não consegui abrir: ${esc(e.message)}</p>`; f.onclick = (e) => e.target.closest('[data-f=close]') && closeFocus(); }
  }

  $('#reader').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.t-head')) { e.preventDefault(); toggleTopic(e.target.closest('.topic').dataset.id); }
  });
  async function dismissTopic(id, undo = false) {
    const el = $(`.topic[data-id="${CSS.escape(id)}"]`);
    const t = topicById(id);
    if (!t) return;
    el?.classList.add('leaving');
    try {
      await api('/api/topics/dismiss', { method: 'POST', body: { id, undo } });
      state.topics = state.topics.filter((x) => x.id !== id);
      state.open.delete(id);
      state.dismissedCount += undo ? -1 : 1;
      setTimeout(() => { el?.remove(); renderBoardHead(false); if (!state.topics.length) renderTopics(); }, 160);
      if (!undo) toast('Tópico arrumado', { label: 'Desfazer', run: async () => { await api('/api/topics/dismiss', { method: 'POST', body: { id, undo: true } }); loadTopics(); } });
      else toast('Tópico reposto');
    } catch (e) { el?.classList.remove('leaving'); toast('Erro: ' + e.message); }
  }

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
    if (b.dataset.t === 'dismiss') dismissTopic(id);
    if (b.dataset.t === 'undismiss') dismissTopic(id, true);
    if (b.dataset.t === 'showDismissed') { state.showDismissed = !state.showDismissed; state.open.clear(); $('#reader').innerHTML = ''; loadTopics(); }
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
        <button class="btn" data-act="event">Criar evento</button>
      </div>
      <div id="aiBox"></div>
      <div id="bodyBox" class="body">${esc(textOf(m))}</div>
      ${m.attachments?.length ? `<div class="attach">Anexos: ${m.attachments.map((x) => esc(x.filename || 'sem nome')).join(', ')}</div>` : ''}
    </article>`;
  }
  $('#reader').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') { app().classList.remove('reading'); if (state.mode === 'classic') { readerHome(); focusList(); } return; }
    if (act === 'new') return compose();
    if (act === 'reply') reply();
    if (act === 'summary') summarize();
    if (act === 'suggest') suggest();
    if (act === 'html') showHtml(b);
    if (act === 'unread') markUnread();
    if (act === 'event') eventFromMessage();
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
      <div class="compose-head"><h1>${d.draftId ? 'Rascunho' : d.inReplyTo ? 'Resposta' : 'Nova mensagem'}</h1><button type="button" class="close" id="cClose" aria-label="Fechar (Esc)" title="Fechar (Esc) — o que escreveste fica nos rascunhos">×</button></div>
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
      <div class="attachbox">
        <div id="attList" class="att-list"></div>
        <label class="btn att-add">📎 Anexar ficheiros<input type="file" id="attInput" multiple hidden /></label>
        <span class="hint" style="margin:0">Até 20 MB no total.</span>
      </div>
      ${d.draftId ? `<label class="checks" style="margin-bottom:14px"><input type="checkbox" name="reviewed" ${d.reviewed ? 'checked' : ''}/> Revisto e pronto a enviar</label>` : ''}
      <div class="actions">
        <button class="btn primary" type="submit" id="sendBtn">Enviar</button>
        <button class="btn" type="button" id="saveDraft">Guardar rascunho</button>
        ${d.draftId ? `<button class="btn danger" type="button" id="delDraft">Apagar rascunho</button>` : ''}
        ${state.mode === 'topics' ? `<button class="btn" type="button" id="backTopics">Voltar aos tópicos</button>` : ''}
      </div>
    </form>`;
    const f = $('#composeForm');
    // Anexos: lidos para base64 no browser e guardados com o rascunho.
    let atts = [...(d.attachments || [])];
    const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const renderAtts = () => {
      $('#attList').innerHTML = atts.map((a, i) => `<span class="att">${esc(a.filename)} <span class="muted">${fmtSize(a.size || 0)}</span><button type="button" class="att-x" data-rm="${i}" aria-label="Remover ${esc(a.filename)}">×</button></span>`).join('');
      $$('[data-rm]', $('#attList')).forEach((b) => (b.onclick = () => { atts.splice(Number(b.dataset.rm), 1); renderAtts(); }));
    };
    renderAtts();
    $('#attInput').onchange = async (e) => {
      // Guarda a referência já: dentro do Shadow DOM, e.target deixa de existir depois do primeiro await.
      const input = e.currentTarget;
      for (const file of [...input.files]) {
        const total = atts.reduce((n, a) => n + (a.size || 0), 0) + file.size;
        if (total > 20 * 1048576) { toast(`“${file.name}” ultrapassa os 20 MB no total`); continue; }
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
        atts.push({ filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size, data });
      }
      input.value = ''; renderAtts();
    };
    const val = () => ({ ...Object.fromEntries(new FormData(f)), reviewed: f.reviewed?.checked || false, inReplyTo: d.inReplyTo, references: d.references, draftId: d.draftId, attachments: atts });
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
      const body = { account: v.account, to: v.to, cc: v.cc, bcc: v.bcc, subject: v.subject, text: v.text, reviewed: v.reviewed, inReplyTo: v.inReplyTo, references: v.references, attachments: atts };
      if (d.draftId) await api(`/api/drafts/${d.draftId}`, { method: 'PUT', body });
      else { const nd = await api('/api/drafts', { method: 'POST', body }); d.draftId = nd.id; }
      await refreshDrafts(); if (state.view === 'drafts') renderDraftList();
      toast('Rascunho guardado');
    };
    if (d.draftId) $('#delDraft').onclick = async () => { await api(`/api/drafts/${d.draftId}`, { method: 'DELETE' }); await refreshDrafts(); renderDraftList(); renderDraftsHome(); toast('Rascunho apagado'); };
    $('#backTopics')?.addEventListener('click', () => { $('#reader').innerHTML = ''; loadTopics(); });
    // Fechar: o que já foi escrito não se perde, vai para os rascunhos.
    const closeCompose = async () => {
      const v = val();
      const changed = ['to', 'cc', 'bcc', 'subject', 'text'].some((k) => (v[k] || '') !== (d[k] || '')) || atts.length !== (d.attachments || []).length;
      if (changed && (v.to || v.subject || v.text || atts.length)) { try { await $('#saveDraft').onclick(); } catch (err) { toast('Não consegui guardar o rascunho: ' + err.message); return; } }
      state.closeCompose = null;
      if (state.view === 'drafts') { renderDraftList(); renderDraftsHome(); }
      else if (state.mode === 'topics') { $('#reader').innerHTML = ''; app().classList.remove('reading'); loadTopics(); }
      else { app().classList.remove('reading'); readerHome(); focusList(); }
    };
    state.closeCompose = closeCompose;
    $('#cClose').onclick = closeCompose;
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
    ({ calendar: viewCalendar, funnel: viewFunnel, triage: viewTriage, pitch: viewPitch, publish: viewPublish, agent: viewAgent, settings: viewSettings })[view]?.();
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

  // =====================================================================
  // Funil de prospeção
  // =====================================================================
  const STATUS_ORDER = ['respondeu', 'conversa', 'novo', 'contactado', 'followup', 'concluido', 'recusou', 'sem_resposta'];
  const CLOSED = new Set(['concluido', 'recusou', 'sem_resposta']);
  const dayFmt = (d) => new Date(d).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
  const dueLabel = (d) => {
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
    return days < 0 ? `<span class="late">atrasado ${-days} dia${days < -1 ? 's' : ''}</span>` : days === 0 ? '<b>hoje</b>' : days === 1 ? 'amanhã' : dayFmt(d);
  };

  async function refreshFunnelCount() {
    try {
      const r = await api('/api/pipeline');
      const n = r.week.reduce((a, w) => a + w.replies + w.followDue + w.actions, 0);
      $('#funnelCount').textContent = n || '';
      return r;
    } catch { return null; }
  }

  // Criar um funil: só o essencial; o briefing e as metas afinam-se depois nas definições.
  function newStreamForm(r) {
    const first = !r.streams.length;
    $('#fBody').innerHTML = `
      <section class="card">
        <h2 style="margin-top:0">${first ? 'Cria o teu primeiro funil' : 'Novo funil'}</h2>
        <p class="muted">Um funil é uma frente de prospeção: um público, uma conta de onde saem os e-mails e um briefing que a IA usa para escrever os pitches.</p>
        <form id="nsForm">
          <div class="row">
            <div class="field"><label for="nsName">Nome</label><input id="nsName" name="name" required placeholder="ex.: Bitnik · lojas de jogos" /></div>
            <div class="field"><label for="nsAcc">Enviar de</label><select id="nsAcc" name="account">${state.status.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.address)}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label for="nsAud">Público</label><input id="nsAud" name="audience" placeholder="ex.: lojas de jogos de tabuleiro em Portugal e Espanha" /></div>
          <div class="field"><label for="nsLang">Língua dos e-mails</label><select id="nsLang" name="language">${[['auto', 'A do país de cada contacto'], ...Object.entries(r.languages || {})].map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
          <div class="actions" style="margin:0"><button class="btn primary">Criar funil</button>${first ? '' : '<button type="button" class="btn" id="nsCancel">Cancelar</button>'}</div>
        </form>
        ${state.status.accounts.length ? '' : '<p class="hint">Ainda não há contas de correio: adiciona uma em Definições para poderes enviar.</p>'}
      </section>`;
    $('#nsName').focus();
    $('#nsCancel')?.addEventListener('click', () => { state.funnelNew = false; viewFunnel(); });
    $('#nsForm').onsubmit = async (e) => {
      e.preventDefault();
      const s = await api('/api/pipeline/streams', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      state.funnelNew = false; state.funnelStream = s.id; state.funnelSettingsOpen = true;
      toast('Funil criado — completa o briefing nas definições');
      viewFunnel();
    };
  }

  async function viewFunnel(opts = {}) {
    const reader = $('#reader');
    if (!$('#funnelPane')) reader.innerHTML = `<div class="pane wide" id="funnelPane">${backBtn()}<h1>Funil</h1><div id="fBody">${spin('A ler as caixas…')}</div></div>`;
    let r;
    try { r = await api(`/api/pipeline${opts.sync ? '?sync=1' : ''}`); } catch (e) { $('#fBody').innerHTML = `<p>Erro: ${esc(e.message)}</p>`; return; }
    state.pipeline = r;
    $('#funnelCount').textContent = r.week.reduce((a, w) => a + w.replies + w.followDue + w.actions, 0) || '';
    if (state.funnelNew || !r.streams.length) return newStreamForm(r);
    if (!state.funnelStream || !r.streams.some((x) => x.id === state.funnelStream)) state.funnelStream = r.streams[0]?.id;
    const s = r.streams.find((x) => x.id === state.funnelStream);
    const w = r.week.find((x) => x.id === s.id);
    const cs = r.contacts.filter((c) => c.stream === s.id);
    const drafts = state.drafts.filter((d) => d.stream === s.id);
    const filter = state.funnelFilter || 'abertos';
    const shown = cs.filter((c) => (filter === 'todos' ? true : filter === 'abertos' ? !CLOSED.has(c.status) : filter === 'fechados' ? CLOSED.has(c.status) : c.status === filter))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || new Date(a.nextAction?.due || a.createdAt) - new Date(b.nextAction?.due || b.createdAt));
    const attention = cs.filter((c) => c.status === 'respondeu' || (c.nextAction?.due && !CLOSED.has(c.status) && c.status !== 'contactado' && c.status !== 'followup' && new Date(c.nextAction.due) <= new Date(Date.now() + 12 * 36e5)));
    const pct = Math.min(100, Math.round((w.contactedThisWeek / Math.max(1, w.target)) * 100));
    const planLabel = w.toPlan === 0 ? (w.pitchDrafts ? `${w.pitchDrafts} pitch(es) à espera de revisão` : 'Meta da semana cumprida')
      : w.available <= 0 ? 'Sem contactos por contactar — adiciona mais em baixo'
      : `Preparar ${Math.min(w.toPlan, w.available)} pitch${Math.min(w.toPlan, w.available) > 1 ? 'es' : ''} da semana`;

    $('#fBody').innerHTML = `
      <div class="seg-row"><div class="seg" role="tablist">${r.streams.map((x) => { const wx = r.week.find((y) => y.id === x.id); const n = wx.replies + wx.followDue + wx.actions; return `<button role="tab" data-stream="${esc(x.id)}" class="${x.id === s.id ? 'on' : ''}">${esc(x.name)}${n ? ` <span class="badge">${n}</span>` : ''}</button>`; }).join('')}</div><button class="btn" data-fx="newStream">+ Novo funil</button></div>

      <section class="card week">
        <div class="week-head">
          <div><div class="muted" style="font-size:13px">Semana de ${dayFmt(w.weekStart)}</div><div class="week-num"><b>${w.contactedThisWeek}</b> / ${w.target} contactados</div></div>
          <div class="week-stats">
            <span><b>${w.counts.novo}</b> por contactar</span>
            <span><b>${w.counts.contactado + w.counts.followup}</b> à espera de resposta</span>
            <span><b>${w.counts.respondeu + w.counts.conversa}</b> em conversa</span>
          </div>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="actions" style="margin:12px 0 0">
          <button class="btn primary" data-fx="plan" ${w.toPlan && w.available > 0 ? '' : 'disabled'}>${planLabel}</button>
          <button class="btn" data-fx="follow" ${w.followDue ? '' : 'disabled'}>${w.followDue ? `Preparar ${w.followDue} follow-up${w.followDue > 1 ? 's' : ''}` : w.followDrafts ? `${w.followDrafts} follow-up(s) à espera de revisão` : 'Sem follow-ups no prazo'}</button>
          ${drafts.length ? `<button class="btn" data-fx="review">Rever e enviar (${drafts.length})</button>` : ''}
          <span class="grow"></span>
          <button class="icon" data-fx="sync" title="Verificar respostas agora" aria-label="Verificar respostas agora">↻</button>
        </div>
        <div id="fOut"></div>
      </section>

      ${attention.length ? `<h2>Precisa de ti</h2>${attention.map((c) => `
        <div class="card attn" data-cid="${esc(c.id)}">
          <div class="c-head"><span><b style="color:var(--ink)">${esc(c.name || c.email)}</b>${c.org ? ` · ${esc(c.org)}` : ''}</span><span class="pill st-${esc(c.status)}">${esc(r.statuses[c.status])}</span></div>
          ${c.status === 'respondeu' && c.reply ? `<div class="c-body selectable">“${esc(c.reply.snippet || c.reply.subject)}”</div>` : ''}
          ${c.nextAction ? `<div class="muted" style="margin-top:6px">Próxima ação: ${esc(c.nextAction.text)} · ${dueLabel(c.nextAction.due)}</div>` : ''}
          <div class="actions" style="margin:10px 0 0">
            ${c.reply?.uid ? `<button class="btn primary" data-fx="openReply" data-cid="${esc(c.id)}">Ler e responder</button>` : ''}
            ${c.status === 'respondeu' ? `<button class="btn" data-fx="status" data-to="conversa" data-cid="${esc(c.id)}">Em conversa</button>` : ''}
            <button class="btn" data-fx="status" data-to="concluido" data-cid="${esc(c.id)}">Concluído</button>
            <button class="btn" data-fx="status" data-to="recusou" data-cid="${esc(c.id)}">Recusou</button>
            <button class="btn" data-fx="contact" data-cid="${esc(c.id)}">Detalhes</button>
          </div>
        </div>`).join('')}` : ''}

      <h2>Contactos <span class="muted" style="font-weight:400">${cs.length}</span></h2>
      <div class="chips">${[['abertos', 'Abertos'], ['novo', 'Por contactar'], ['contactado', 'Contactados'], ['followup', 'Follow-up'], ['respondeu', 'Responderam'], ['conversa', 'Em conversa'], ['fechados', 'Fechados'], ['todos', 'Todos']]
        .map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-ff="${k}">${l}</button>`).join('')}</div>
      ${shown.length ? `<div class="ctable">${shown.map((c) => `
        <button class="crow" data-fx="contact" data-cid="${esc(c.id)}">
          <span class="cname"><b>${esc(c.name || c.email)}</b><span class="muted">${esc([c.org, c.email].filter(Boolean).join(' · '))}</span></span>
          <span class="muted cloc" title="${esc([r.countries?.[c.country] || 'País desconhecido', 'escreve em ' + (r.languages?.[c.langResolved] || c.langResolved)].join(' · '))}">${esc(c.country || '—')} · ${esc(String(c.langResolved || '').split('-')[0].toUpperCase())}</span>
          <span class="pill st-${esc(c.status)}">${esc(r.statuses[c.status])}</span>
          <span class="cnext muted">${c.nextAction && !CLOSED.has(c.status) ? `${esc(c.nextAction.text)} · ${dueLabel(c.nextAction.due)}` : c.firstContactAt ? `contactado ${dayFmt(c.firstContactAt)}` : ''}${drafts.some((d) => d.contactId === c.id) ? ' · <span class="tag">rascunho</span>' : ''}</span>
        </button>`).join('')}</div>` : `<p class="muted">${cs.length ? 'Nenhum contacto neste filtro.' : 'Ainda não há contactos neste funil. Adiciona os primeiros em baixo.'}</p>`}

      <details class="card" ${cs.length ? '' : 'open'}>
        <summary><b>Adicionar contactos</b></summary>
        <form id="addForm" style="margin-top:12px">
          <div class="field"><label for="addList">Um por linha: nome, e-mail; organização; notas</label>
          <textarea id="addList" required placeholder="Ana Lopes, ana@editora.pt; Editora Exemplo; publica party games e quer versões digitais&#10;Direção, direcao@colegio.pt; Colégio Exemplo; tem clube de robótica"></textarea></div>
          <div class="hint" id="addHint">As notas ajudam a IA a escolher o ângulo de cada pitch. O país vem das notas (ex.: «ES», «Alemanha») ou do domínio do e-mail; podes corrigi-lo em cada contacto.</div>
          <div class="actions" style="margin:0"><button class="btn primary">Adicionar a ${esc(s.name)}</button></div>
        </form>
      </details>

      <details class="card" ${state.funnelSettingsOpen ? 'open' : ''}>
        <summary><b>Definições deste funil</b> <span class="muted">· meta ${s.weeklyTarget}/semana · follow-up ao fim de ${s.followUpDays} dias · fecha ${s.closeAfterDays} dias depois</span></summary>
        <form id="streamForm" style="margin-top:12px">
          <div class="row">
            <div class="field"><label for="sfName">Nome</label><input id="sfName" name="name" value="${esc(s.name)}" /></div>
            <div class="field"><label for="sfAcc">Enviar de</label><select id="sfAcc" name="account">${state.status.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === s.account ? 'selected' : ''}>${esc(a.address)}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label for="sfAud">Público</label><input id="sfAud" name="audience" value="${esc(s.audience || '')}" /></div>
          <div class="field"><label for="sfBrief">Briefing do pitch</label><textarea id="sfBrief" name="brief" class="tall" style="min-height:180px">${esc(s.brief || '')}</textarea></div>
          <p class="hint">Preenche os [marcadores]. A IA não inventa factos: o que não estiver aqui ou nas notas do contacto não entra no e-mail.</p>
          <div class="field"><label for="sfMat">Materiais (links a usar nos e-mails)</label><input id="sfMat" name="materials" value="${esc(s.materials || '')}" /></div>
          <div class="row">
            <div class="field"><label for="sfLang">Língua</label><select id="sfLang" name="language">${[['auto', 'A do país de cada contacto'], ...Object.entries(r.languages || { 'pt-PT': 'Português', en: 'Inglês' })].map(([v, l]) => `<option value="${v}" ${v === s.language ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
            <div class="field"><label for="sfT">Contactos novos por semana</label><input id="sfT" name="weeklyTarget" type="number" min="0" max="100" value="${s.weeklyTarget}" /></div>
            <div class="field"><label for="sfF">Follow-up ao fim de (dias)</label><input id="sfF" name="followUpDays" type="number" min="1" max="60" value="${s.followUpDays}" /></div>
            <div class="field"><label for="sfC">Fechar sem resposta (dias após o follow-up)</label><input id="sfC" name="closeAfterDays" type="number" min="1" max="90" value="${s.closeAfterDays}" /></div>
          </div>
          <div class="actions" style="margin:0"><button class="btn primary">Guardar</button><span class="grow"></span><button type="button" class="btn danger" id="delStream">Apagar funil</button></div>
          <p class="hint" style="margin-top:8px">Apagar remove o funil, os seus ${cs.length} contacto(s) e os rascunhos por enviar. Os e-mails já enviados ficam na caixa de correio.</p>
        </form>
      </details>`;
    state.funnelSettingsOpen = false;

    const pane = $('#funnelPane');
    pane.onclick = async (e) => {
      const tab = e.target.closest('[data-stream]');
      if (tab) { state.funnelStream = tab.dataset.stream; return viewFunnel(); }
      const ff = e.target.closest('[data-ff]');
      if (ff) { state.funnelFilter = ff.dataset.ff; return viewFunnel(); }
      const b = e.target.closest('[data-fx]'); if (!b) return;
      const fx = b.dataset.fx, cid = b.dataset.cid;
      if (fx === 'sync') { b.disabled = true; return viewFunnel({ sync: true }); }
      if (fx === 'newStream') { state.funnelNew = true; return viewFunnel(); }
      if (fx === 'contact') return openContact(cid);
      if (fx === 'status') { await api(`/api/pipeline/contacts/${cid}`, { method: 'PUT', body: { status: b.dataset.to } }); toast(`Marcado: ${r.statuses[b.dataset.to]}`); return viewFunnel(); }
      if (fx === 'openReply') { const c = r.contacts.find((x) => x.id === cid); return openHit({ account: c.reply.account, uid: c.reply.uid, folder: 'INBOX' }); }
      if (fx === 'review') return reviewDrafts(s);
      if (fx === 'plan' || fx === 'follow') {
        b.disabled = true; b.innerHTML = spin(fx === 'plan' ? 'A escrever os pitches…' : 'A escrever os follow-ups…');
        try {
          const made = await api(`/api/pipeline/${fx === 'plan' ? 'plan' : 'followups'}`, { method: 'POST', body: { stream: s.id } });
          await refreshDrafts();
          toast(`${made.length} rascunho(s) prontos para rever`);
          await viewFunnel();
          if (made.length) reviewDrafts(s);
        } catch (err) { toast('Erro: ' + err.message); viewFunnel(); }
      }
    };
    const af = $('#addForm');
    af.addList.oninput = () => {
      const v = af.addList.value, n = parseContacts(v).length;
      const emails = (v.match(/[^\s,;<>"]+@[^\s,;<>"]+\.[a-z]{2,}/gi) || []).length;
      $('#addHint').textContent = `${n} contacto(s) reconhecido(s).` + (emails > n ? ` Há ${emails} e-mails no texto: algumas linhas parecem coladas umas às outras — põe um contacto por linha (copia do texto simples, não da pré-visualização).` : '');
    };
    af.onsubmit = async (e) => {
      e.preventDefault();
      const list = parseContacts(af.addList.value);
      if (!list.length) return toast('Não encontrei e-mails');
      const res = await api('/api/pipeline/contacts', { method: 'POST', body: { stream: s.id, contacts: list } });
      toast(`${res.added.length} adicionado(s)${res.skipped.length ? ` · ${res.skipped.length} ignorado(s) (${[...new Set(res.skipped.map((x) => x.reason))].join(', ')})` : ''}`);
      viewFunnel();
    };
    let delArmed = null;
    $('#delStream').onclick = async (e) => {
      const btn = e.currentTarget;
      if (!delArmed) { btn.textContent = `Confirmar: apagar «${s.name}»`; delArmed = setTimeout(() => { delArmed = null; btn.textContent = 'Apagar funil'; }, 4000); return; }
      clearTimeout(delArmed); btn.disabled = true;
      const res = await api(`/api/pipeline/streams/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      toast(`Funil apagado · ${res.contacts} contacto(s)${res.drafts ? ` · ${res.drafts} rascunho(s)` : ''}`);
      state.funnelStream = null; state.drafts = state.drafts.filter((d) => d.stream !== s.id); viewFunnel();
    };
    $('#streamForm').onsubmit = async (e) => {
      e.preventDefault();
      await api(`/api/pipeline/streams/${s.id}`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      toast('Frente guardada'); viewFunnel();
    };
    if (state.funnelOpen) { const id = state.funnelOpen; state.funnelOpen = null; openContact(id); }
  }

  // Revisão rápida dos rascunhos de uma frente, sem sair do funil.
  function reviewDrafts(s) {
    const ds = state.drafts.filter((d) => d.stream === s.id);
    const out = $('#fOut'); if (!out) return;
    if (!ds.length) { out.innerHTML = ''; return; }
    out.innerHTML = `<div class="review">
      <div class="c-head" style="margin:14px 0 8px"><b style="color:var(--ink)">${ds.length} rascunho(s) por rever</b><span><button class="btn" data-rv="all">Marcar todos como revistos</button> <button class="btn primary" data-rv="send">Enviar revistos</button></span></div>
      ${ds.map((d) => `<div class="card rv" data-did="${esc(d.id)}">
        <div class="c-head"><span>${d.kind === 'followup' ? 'Follow-up' : 'Pitch'} para <b style="color:var(--ink)">${esc(d.to)}</b>${d.attachments?.length ? ` · 📎 ${d.attachments.length}` : ''}</span>
          <span><label class="checks" style="display:inline-flex;gap:5px"><input type="checkbox" data-rv="ok" ${d.reviewed ? 'checked' : ''}/> revisto</label> <button class="btn" data-rv="edit">Editar</button> <button class="btn danger" data-rv="del">Descartar</button></span></div>
        <div class="c-title">${esc(d.subject)}</div>
        ${d.note ? `<div class="muted" style="margin-bottom:6px;font-size:13px">${esc(d.note)}</div>` : ''}
        <div class="c-body selectable">${esc(d.text)}</div>
      </div>`).join('')}
      <div id="rvLog" class="log" hidden></div>
    </div>`;
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    out.onclick = async (e) => {
      const b = e.target.closest('[data-rv]'); if (!b) return;
      const card = b.closest('[data-did]'); const d = card && state.drafts.find((x) => x.id === card.dataset.did);
      if (b.dataset.rv === 'ok') { await api(`/api/drafts/${d.id}`, { method: 'PUT', body: { reviewed: b.checked } }); d.reviewed = b.checked; return; }
      if (b.dataset.rv === 'edit') return compose({ ...d, draftId: d.id });
      if (b.dataset.rv === 'del') { await api(`/api/drafts/${d.id}`, { method: 'DELETE' }); await refreshDrafts(); return reviewDrafts(s); }
      if (b.dataset.rv === 'all') { for (const x of ds) { await api(`/api/drafts/${x.id}`, { method: 'PUT', body: { reviewed: true } }); x.reviewed = true; } $$('[data-rv=ok]', out).forEach((c) => (c.checked = true)); return; }
      if (b.dataset.rv === 'send') {
        const ok = state.drafts.filter((x) => x.stream === s.id && x.reviewed);
        if (!ok.length) return toast('Marca primeiro os rascunhos revistos');
        if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = `Confirmar: enviar ${ok.length} agora`; return; }
        b.disabled = true;
        const log = $('#rvLog'); log.hidden = false;
        for (const x of ok) {
          try { await api('/api/send', { method: 'POST', body: { ...x, draftId: x.id } }); log.insertAdjacentHTML('beforeend', `<div>✓ ${esc(x.to)} — ${esc(x.subject)}</div>`); }
          catch (err) { log.insertAdjacentHTML('beforeend', `<div>✗ ${esc(x.to)} — ${esc(err.message)}</div>`); }
          await new Promise((res) => setTimeout(res, 1500));
        }
        await refreshDrafts();
        toast('Envio concluído'); viewFunnel();
      }
    };
  }

  // Ficha do contacto (painel lateral): notas, estado, próxima ação e histórico.
  function openContact(cid) {
    const r = state.pipeline; const c = r?.contacts.find((x) => x.id === cid); if (!c) return;
    $('.research')?.remove();
    const p = document.createElement('aside');
    p.className = 'research'; p.setAttribute('aria-label', 'Contacto');
    const due = c.nextAction?.due ? new Date(c.nextAction.due).toISOString().slice(0, 10) : '';
    p.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><span class="muted" style="font-size:13px">${esc(r.streams.find((x) => x.id === c.stream)?.name || '')}</span><button class="close" aria-label="Fechar">×</button></div>
      <h2>${esc(c.name || c.email)}</h2>
      <form id="cForm">
        <div class="field"><label>Estado</label><select name="status">${Object.entries(r.statuses).map(([k, l]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>Nome</label><input name="name" value="${esc(c.name)}" /></div>
        <div class="field"><label>E-mail</label><input value="${esc(c.email)}" disabled /></div>
        <div class="field"><label>Organização</label><input name="org" value="${esc(c.org)}" /></div>
        <div class="row">
          <div class="field"><label>País</label><select name="country"><option value="">Desconhecido</option>${Object.entries(r.countries || {}).sort((a, b) => a[1].localeCompare(b[1], 'pt')).map(([k, l]) => `<option value="${k}" ${k === c.country ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="field"><label>Língua do e-mail</label><select name="lang"><option value="">Auto · ${esc(r.languages?.[c.langResolved] || c.langResolved || '')}</option>${Object.entries(r.languages || {}).map(([k, l]) => `<option value="${k}" ${k === c.lang ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Notas (usadas pela IA)</label><textarea name="notes">${esc(c.notes)}</textarea></div>
        <div class="field"><label>Próxima ação</label><input name="naText" value="${esc(c.nextAction?.text || '')}" placeholder="ex.: enviar protótipo jogável" /></div>
        <div class="field"><label>Até</label><input name="naDue" type="date" value="${due}" /></div>
        <div class="actions" style="margin:0"><button class="btn primary">Guardar</button><button type="button" class="btn" id="cMail">Escrever e-mail</button><span class="grow"></span><button type="button" class="btn danger" id="cDel">Remover</button></div>
      </form>
      <h3>Histórico</h3>
      <ul class="hist">${[...(c.history || [])].reverse().map((h) => `<li><span class="muted">${dayFmt(h.at)}</span> ${esc(h.text)}</li>`).join('')}</ul>`;
    app().append(p);
    $('.close', p).onclick = () => p.remove();
    $('.close', p).focus();
    const f = $('#cForm', p);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      await api(`/api/pipeline/contacts/${c.id}`, { method: 'PUT', body: { status: v.status, name: v.name, org: v.org, notes: v.notes, country: v.country, lang: v.lang, nextAction: v.naText ? { text: v.naText, due: v.naDue || null } : null } });
      toast('Contacto guardado'); p.remove(); viewFunnel();
    };
    $('#cMail', p).onclick = () => { const s = r.streams.find((x) => x.id === c.stream); p.remove(); compose({ account: s?.account, to: c.email }); };
    $('#cDel', p).onclick = async (e) => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirmar remoção'; return; }
      await api(`/api/pipeline/contacts/${c.id}`, { method: 'DELETE' }); toast('Contacto removido'); p.remove(); viewFunnel();
    };
  }

  // A partir de um tópico: pôr a pessoa no funil.
  async function addToFunnelMenu(btn, t) {
    $('.ctx')?.remove();
    const r = state.pipeline || (await api('/api/pipeline'));
    const person = t.people[0] || {};
    const m = document.createElement('div');
    m.className = 'ctx'; m.setAttribute('role', 'menu');
    m.innerHTML = `<div class="ctx-q">Adicionar ${esc(person.name || person.address)} a:</div>${r.streams.map((s) => `<button role="menuitem" data-s="${esc(s.id)}">${esc(s.name)}</button>`).join('')}`;
    const rect = btn.getBoundingClientRect();
    m.style.left = Math.min(rect.left, innerWidth - 260) + 'px'; m.style.top = rect.bottom + 6 + 'px';
    app().append(m); $('button', m).focus();
    m.onclick = async (e) => {
      const sid = e.target.closest('[data-s]')?.dataset.s; if (!sid) return;
      m.remove();
      const res = await api('/api/pipeline/contacts', { method: 'POST', body: { stream: sid, contacts: [{ name: person.name, email: person.address, notes: `Do tópico: ${t.ai?.title || t.subject}`, source: 'do correio' }] } });
      if (res.added.length) {
        // Se a conversa já teve envio, o funil deteta-o na próxima verificação.
        await api('/api/pipeline?sync=1');
        toast(`Adicionado ao funil`); t.funnel = { stream: sid, label: 'no funil', streamName: r.streams.find((x) => x.id === sid).name };
      } else toast(res.skipped[0]?.reason === 'já existe' ? 'Já está nesse funil' : 'Não consegui adicionar');
    };
  }

  // ---------- definições ----------
  async function viewSettings() {
    const [s, a] = await Promise.all([api('/api/settings'), api('/api/ai-settings')]);
    const presetOpts = Object.entries(a.presets).map(([k, v]) => `<option value="${k}" ${k === a.preset ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
    $('#reader').innerHTML = `<div class="pane">
      ${backBtn()}<h1>Definições</h1>

      <h2>Atualizações</h2>
      <div id="versionBox" class="muted">${spin('A verificar atualizações…')}</div>

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
      <div class="row" style="max-width:560px">
        <div class="field"><label for="pTheme">Tema</label><select id="pTheme"><option value="light">Claro</option><option value="dark">Escuro</option><option value="auto">Igual ao sistema</option></select></div>
        <div class="field"><label for="pFont">Tipo de letra</label><select id="pFont">${Object.entries(FONTS).map(([k, v]) => `<option value="${esc(k)}">${esc(v.label || k)}</option>`).join('')}</select></div>
      </div>
      <p class="hint">As fontes vêm do Google Fonts (a Inter incluída), descarregadas na primeira vez que a app as usa. Sem internet, usa a letra do sistema.</p>`}

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

      <h2 id="calSettingsTitle">Calendários</h2>
      <div id="calBox">${spin('A carregar…')}</div>

      <h2 id="accountsTitle">Contas</h2>
      <div id="accountsBox"></div>
    </div>`;
    renderAccounts();
    renderCalSettings();
    renderVersion(true);

    $('#setForm').onsubmit = async (e) => { e.preventDefault(); await api('/api/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Guardado'); };
    const savePrefs = async () => {
      const r = await api('/api/settings', { method: 'PUT', body: { ...s, prefs: { autoTopics: $('#pTopics').checked, autoSuggest: $('#pSuggest').checked } } });
      state.status.prefs = r.prefs; toast('Guardado');
    };
    $('#pTopics').onchange = savePrefs; $('#pSuggest').onchange = savePrefs;
    const th = $('#pTheme');
    if (th) { th.value = ls.get('mailroom.theme') || 'light'; th.onchange = () => { ls.set('mailroom.theme', th.value); applyTheme(th.value); }; }
    const fo = $('#pFont');
    if (fo) { fo.value = ls.get('mailroom.font') || DEFAULT_FONT; fo.onchange = () => { ls.set('mailroom.font', fo.value); applyFont(fo.value); }; }

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

  // =====================================================================
  // Calendário: dia, 3 dias, semana, mês; por baixo, projetos (milestones e deadlines)
  // =====================================================================
  const CAL_VIEWS = { day: ['Dia', 1], three: ['3 dias', 3], week: ['Semana', 7], month: ['Mês', 42] };
  const HOUR_PX = 48;
  const PM_DAYS = 70;
  const KIND_LABEL = { event: 'Evento', milestone: 'Milestone', deadline: 'Deadline' };
  const KIND_ICON = { event: '', milestone: '◆', deadline: '⚑' };
  const pad2 = (n) => String(n).padStart(2, '0');
  // Datas em português, sem depender da língua do sistema (o Chromium nem sempre traz a de PT).
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const DIAS_LONGOS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
  const wd = (d) => (d.getDay() + 6) % 7;
  const dMes = (d) => `${d.getDate()} ${MES[d.getMonth()]}`;
  const ymdOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const mondayOf = (d) => plusDays(dayStart(d), -((new Date(d).getDay() + 6) % 7));
  const fromYmd = (s) => new Date(`${s}T00:00:00`);
  const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  // Início e fim de um evento como datas locais (os de dia inteiro vêm como AAAA-MM-DD, fim exclusivo).
  const evStart = (e) => (e.allDay ? fromYmd(e.start) : new Date(e.start));
  const evEnd = (e) => (e.allDay ? fromYmd(e.end) : new Date(e.end));
  state.cal = { view: ls.get('mailroom.calView') || 'week', date: dayStart(new Date()), events: [], sources: [], errors: [], projects: [], loading: false, defaultTarget: 'local' };

  function calRange() {
    const c = state.cal;
    if (c.view === 'month') { const first = new Date(c.date.getFullYear(), c.date.getMonth(), 1); const s = mondayOf(first); return [s, plusDays(s, 42)]; }
    if (c.view === 'week') { const s = mondayOf(c.date); return [s, plusDays(s, 7)]; }
    const n = CAL_VIEWS[c.view][1]; return [dayStart(c.date), plusDays(c.date, n)];
  }
  const pmRange = () => { const s = plusDays(mondayOf(state.cal.date), -7); return [s, plusDays(s, PM_DAYS)]; };
  function calTitle() {
    const c = state.cal, [s, e] = calRange();
    const d = c.date;
    if (c.view === 'month') return `${MESES[d.getMonth()][0].toUpperCase()}${MESES[d.getMonth()].slice(1)} ${d.getFullYear()}`;
    if (c.view === 'day') return `${DIAS_LONGOS[wd(d)]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    const last = plusDays(e, -1);
    const same = s.getMonth() === last.getMonth();
    return `${s.getDate()}${same ? '' : ` ${MES[s.getMonth()]}`} – ${last.getDate()} ${MES[last.getMonth()]} ${last.getFullYear()}`;
  }

  async function viewCalendar() {
    app().toggleAttribute('data-wide', true);
    $('#reader').innerHTML = `<div class="cal">
      <header class="cal-head">
        <div class="cal-nav">
          <button class="btn" data-c="today" title="Hoje (t)">Hoje</button>
          <button class="icon" data-c="prev" aria-label="Anterior (←)" title="Anterior (←)">‹</button>
          <button class="icon" data-c="next" aria-label="Seguinte (→)" title="Seguinte (→)">›</button>
          <h1 id="calTitle"></h1>
        </div>
        <div class="seg cal-seg" role="tablist">${Object.entries(CAL_VIEWS).map(([k, [l]]) => `<button role="tab" data-cv="${k}">${l}</button>`).join('')}</div>
        <button class="btn primary" data-c="new" title="Novo evento (n)">Novo evento</button>
      </header>
      <div class="cal-sources" id="calSources"></div>
      <div class="errors" id="calErrors"></div>
      <div id="calBody" class="cal-body">${spin('A carregar o calendário…')}</div>
      <section class="pm" aria-label="Projetos">
        <div class="pm-head"><h2>Projetos</h2><span class="muted" id="pmRange"></span><span class="grow"></span><button class="btn" data-c="newProject">Novo projeto</button></div>
        <div id="pmBody"></div>
      </section>
    </div>`;
    await loadCalendar();
  }

  async function loadCalendar() {
    const c = state.cal;
    const [a, b] = calRange(), [pa, pb] = pmRange();
    const from = new Date(Math.min(a, pa)), to = new Date(Math.max(b, pb));
    const token = (loadCalendar.t = (loadCalendar.t || 0) + 1);
    $('#calTitle') && ($('#calTitle').textContent = calTitle());
    $$('[data-cv]').forEach((x) => x.classList.toggle('on', x.dataset.cv === c.view));
    try {
      const [r, projects] = await Promise.all([api(`/api/calendar/events?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })}`), api('/api/projects')]);
      if (token !== loadCalendar.t || !$('.cal')) return;
      Object.assign(c, { events: r.events, sources: r.sources, errors: r.errors, defaultTarget: r.defaultTarget, projects });
    } catch (e) { if ($('#calBody')) $('#calBody').innerHTML = `<p class="muted">Não consegui carregar o calendário: ${esc(e.message)}</p>`; return; }
    renderCalendar();
  }

  function renderCalendar() {
    const c = state.cal;
    if (!$('.cal')) return;
    $('#calTitle').textContent = calTitle();
    $$('[data-cv]').forEach((x) => x.classList.toggle('on', x.dataset.cv === c.view));
    $('#calSources').innerHTML = c.sources.map((s) => `<button class="src ${s.hidden ? 'off' : ''}" data-src="${esc(s.key)}" style="--c:${esc(s.color)}" title="${s.hidden ? 'Mostrar' : 'Esconder'}"><span class="sw"></span>${esc(s.name)}</button>`).join('')
      + `<button class="src link" data-c="settings">Ligar calendários…</button>`;
    $('#calErrors').textContent = c.errors.join(' · ');
    const [s, e] = calRange();
    const evs = c.events.filter((x) => evEnd(x) > s && evStart(x) < e);
    $('#calBody').innerHTML = c.view === 'month' ? monthGrid(s, evs) : timeGrid(s, CAL_VIEWS[c.view][1], evs);
    if (c.view !== 'month') { const sc = $('.tg-scroll'); if (sc && !sc.dataset.set) { sc.scrollTop = 7.5 * HOUR_PX; sc.dataset.set = 1; } }
    renderPM();
  }

  const chip = (e, withTime) => `<button class="ev k-${esc(e.kind)} ${e.readonly ? 'ro' : ''}" data-ev="${esc(e.id)}" style="--c:${esc(e.color || srcColor(e.source))}" title="${esc(e.title)}${e.calendar ? ` · ${esc(e.calendar)}` : ''}">${KIND_ICON[e.kind] ? `<i>${KIND_ICON[e.kind]}</i>` : ''}${withTime && !e.allDay ? `<span class="t">${hhmm(evStart(e))}</span>` : ''}${esc(e.title)}</button>`;
  const srcColor = (key) => state.cal.sources.find((x) => x.key === key)?.color || '#77736c';

  function timeGrid(start, n, evs) {
    const days = Array.from({ length: n }, (_, i) => plusDays(start, i));
    const today = ymdOf(new Date());
    const allDay = (d) => evs.filter((e) => (e.allDay || evEnd(e) - evStart(e) >= 864e5) && evStart(e) < plusDays(d, 1) && evEnd(e) > d);
    const timed = (d) => evs.filter((e) => !e.allDay && evEnd(e) - evStart(e) < 864e5 && evStart(e) < plusDays(d, 1) && evEnd(e) > d);
    const col = (d) => {
      // Sobreposições: cada grupo de eventos que se tocam divide a largura em colunas.
      const list = timed(d).map((e) => {
        const s0 = Math.max(evStart(e), d), e0 = Math.min(evEnd(e), plusDays(d, 1));
        return { e, top: (s0 - d) / 60000, bot: Math.max((e0 - d) / 60000, (s0 - d) / 60000 + 20) };
      }).sort((a, b) => a.top - b.top || b.bot - a.bot);
      let group = [], groupEnd = -1; const out = [];
      const flush = () => { const cols = []; for (const it of group) { let k = cols.findIndex((end) => end <= it.top); if (k < 0) { k = cols.length; cols.push(0); } cols[k] = it.bot; it.col = k; } for (const it of group) it.ncol = cols.length; out.push(...group); group = []; };
      for (const it of list) { if (it.top >= groupEnd && group.length) flush(); group.push(it); groupEnd = Math.max(groupEnd, it.bot); }
      if (group.length) flush();
      return out.map(({ e, top, bot, col: k, ncol }) => `<button class="tev k-${esc(e.kind)} ${e.readonly ? 'ro' : ''} ${bot - top < 50 ? 'short' : ''}" data-ev="${esc(e.id)}" style="--c:${esc(e.color || srcColor(e.source))};top:${top * HOUR_PX / 60}px;height:${Math.max(18, (bot - top) * HOUR_PX / 60 - 2)}px;left:calc(${(k / ncol) * 100}% + 2px);width:calc(${100 / ncol}% - 4px)" title="${esc(e.title)}"><span class="t">${hhmm(evStart(e))}<span class="te">–${hhmm(evEnd(e))}</span></span><b>${KIND_ICON[e.kind] ? `${KIND_ICON[e.kind]} ` : ''}${esc(e.title)}</b>${e.location ? `<span class="loc">${esc(e.location)}</span>` : ''}</button>`).join('');
    };
    const now = new Date();
    const nowLine = days.some((d) => ymdOf(d) === today) ? `<div class="tg-now" style="top:${(now - dayStart(now)) / 60000 * HOUR_PX / 60}px;grid-column:${days.findIndex((d) => ymdOf(d) === today) + 2}"></div>` : '';
    return `<div class="tg" style="--days:${n}">
      <div class="tg-head"><div></div>${days.map((d) => `<button class="tg-dh ${ymdOf(d) === today ? 'today' : ''}" data-goto="${ymdOf(d)}"><span>${DIAS[wd(d)]}</span><b>${d.getDate()}</b></button>`).join('')}</div>
      <div class="tg-allday"><div class="tg-lbl">dia</div>${days.map((d) => `<div class="tg-ad" data-day="${ymdOf(d)}">${allDay(d).map((e) => chip(e)).join('')}</div>`).join('')}</div>
      <div class="tg-scroll"><div class="tg-body">
        <div class="tg-hours">${Array.from({ length: 24 }, (_, h) => `<span style="top:${h * HOUR_PX}px">${h ? `${pad2(h)}:00` : ''}</span>`).join('')}</div>
        ${days.map((d) => `<div class="tg-col ${ymdOf(d) === today ? 'today' : ''}" data-day="${ymdOf(d)}">${col(d)}</div>`).join('')}
        ${nowLine}
      </div></div>
    </div>`;
  }

  function monthGrid(start, evs) {
    const month = state.cal.date.getMonth(), today = ymdOf(new Date());
    const cells = Array.from({ length: 42 }, (_, i) => plusDays(start, i));
    const heads = cells.slice(0, 7).map((d) => `<div>${DIAS[wd(d)]}</div>`).join('');
    return `<div class="mg"><div class="mg-head">${heads}</div><div class="mg-grid">${cells.map((d) => {
      const list = evs.filter((e) => evStart(e) < plusDays(d, 1) && evEnd(e) > d).sort((a, b) => (b.allDay - a.allDay) || (evStart(a) - evStart(b)));
      const more = list.length - 4;
      return `<div class="mg-cell ${d.getMonth() !== month ? 'other' : ''} ${ymdOf(d) === today ? 'today' : ''}" data-day="${ymdOf(d)}">
        <button class="mg-num" data-goto="${ymdOf(d)}">${d.getDate()}</button>
        ${list.slice(0, more > 0 ? 3 : 4).map((e) => chip(e, true)).join('')}${more > 0 ? `<button class="mg-more" data-goto="${ymdOf(d)}">+${more + 1} mais</button>` : ''}
      </div>`;
    }).join('')}</div></div>`;
  }

  // ---------- projetos ----------
  function renderPM() {
    const c = state.cal, [s, e] = pmRange();
    const pos = (d) => Math.max(0, Math.min(100, ((d - s) / (e - s)) * 100));
    $('#pmRange').textContent = `${dMes(s)} – ${dMes(plusDays(e, -1))} ${plusDays(e, -1).getFullYear()}`;
    const inRange = (x) => evEnd(x) > s && evStart(x) < e;
    const marker = (x) => `<button class="pm-mk k-${esc(x.kind)}" data-ev="${esc(x.id)}" style="left:${pos(evStart(x))}%;--c:${esc(x.color || srcColor(x.source))}" title="${esc(KIND_LABEL[x.kind])} · ${esc(x.title)} · ${dMes(evStart(x))}">${x.kind === 'event' ? '•' : KIND_ICON[x.kind]}</button>`;
    const bar = (a, b, color, label) => (a && b && b > s && a < e ? `<div class="pm-bar" style="left:${pos(a)}%;width:${Math.max(0.6, pos(b) - pos(a))}%;--c:${esc(color)}" title="${esc(label)}"></div>` : '');
    const scale = [];
    for (let d = new Date(s); d < e; d = plusDays(d, 7)) scale.push(`<span style="left:${pos(d)}%">${dMes(d)}</span>`);
    const todayX = pos(new Date());
    const row = (label, track, extra = '') => `<div class="pm-row ${extra}"><div class="pm-label">${label}</div><div class="pm-track"><i class="pm-today" style="left:${todayX}%"></i>${track}</div></div>`;
    const rows = [];
    // 1. projetos criados no mailroom
    for (const p of c.projects) {
      const items = c.events.filter((x) => x.projectId === p.id);
      const ds = items.map(evStart);
      const a = p.start ? fromYmd(p.start) : ds.length ? new Date(Math.min(...ds)) : null;
      const b = p.end ? plusDays(fromYmd(p.end), 1) : ds.length ? plusDays(dayStart(new Date(Math.max(...ds))), 1) : null;
      rows.push(row(`<button class="pm-name" data-proj="${esc(p.id)}"><span class="sw" style="--c:${esc(p.color)}"></span>${esc(p.name)}${p.done ? ' <span class="muted">· concluído</span>' : ''}</button><button class="pm-add" data-additem="${esc(p.id)}" title="Novo milestone ou deadline" aria-label="Novo marco em ${esc(p.name)}">＋</button>`,
        bar(a, b, p.color, `${p.name}${p.start ? ` · ${p.start}` : ''}${p.end ? ` → ${p.end}` : ''}`) + items.filter(inRange).map(marker).join(''), p.done ? 'done' : ''));
    }
    // 2. marcos de calendários sem projeto
    const loose = c.events.filter((x) => !x.projectId && x.source !== 'funnel' && x.kind !== 'event' && inRange(x));
    if (loose.length) rows.push(row('<span class="pm-name static"><span class="sw" style="--c:#77736c"></span>Calendários</span>', loose.map(marker).join('')));
    // 3. funis
    const streams = new Map();
    for (const x of c.events.filter((y) => y.source === 'funnel' && inRange(y))) (streams.get(x.funnelId) || streams.set(x.funnelId, []).get(x.funnelId)).push(x);
    for (const [id, items] of streams) {
      const name = (items[0].title.split(' · ').at(-1) || id);
      const ds = items.map(evStart);
      rows.push(row(`<button class="pm-name" data-funnel="${esc(id)}"><span class="sw" style="--c:#b4441c"></span>Funil · ${esc(name)}</button>`,
        bar(new Date(Math.min(...ds)), plusDays(new Date(Math.max(...ds)), 1), '#b4441c', `Funil ${name}`) + items.map(marker).join(''), 'funnel'));
    }
    $('#pmBody').innerHTML = rows.length
      ? `<div class="pm-grid">${row('', scale.join(''), 'pm-scale')}${rows.join('')}</div><p class="hint">◆ milestone · ⚑ deadline · • pitch enviado. Carrega num marco para o abrir; no ＋ de um projeto para lhe juntar um marco.</p>`
      : `<div class="card">Ainda não há projetos nem marcos neste período. Cria um projeto para acompanhar milestones e deadlines, ou marca um evento do calendário como milestone ou deadline.</div>`;
  }

  // ---------- editor de eventos ----------
  function writableTargets() { return state.cal.sources.filter((s) => s.writable && s.type !== 'funnel' && s.enabled !== false); }
  function eventEditor(ev = {}, isNew = !ev.id) {
    $('.cal-ed')?.remove();
    const c = state.cal;
    const allDay = Boolean(ev.allDay);
    const s = ev.start ? evStart(ev) : (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
    const e = ev.end ? evEnd(ev) : new Date(s.getTime() + 3600e3);
    const endShown = allDay ? plusDays(e, -1) : e; // no ecrã, o último dia é inclusivo
    const locked = !isNew && ev.source?.startsWith('caldav:') && ev.recurring;
    const targets = writableTargets();
    const target = ev.target || (targets.some((t) => t.key === c.defaultTarget) ? c.defaultTarget : 'local');
    const p = document.createElement('div');
    p.className = 'cal-ed'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', isNew ? 'Novo evento' : 'Evento');
    p.innerHTML = `<form class="cal-ed-in" id="evForm">
      <div class="compose-head"><h1>${ev.readonly ? esc(KIND_LABEL[ev.kind || 'event']) : `${isNew ? 'Novo' : 'Editar'} ${esc(KIND_LABEL[ev.kind || 'event']).toLowerCase()}`}</h1><button type="button" class="close" data-x aria-label="Fechar (Esc)" title="Fechar (Esc)">×</button></div>
      ${ev.readonly ? `<p class="hint">${ev.source === 'funnel' ? 'Data do funil: muda-se no Funil.' : 'Este calendário é só de leitura.'}</p>` : ''}
      <div class="field"><label for="evTitle">Título</label><input id="evTitle" name="title" value="${esc(ev.title || '')}" required ${ev.readonly ? 'readonly' : ''} /></div>
      <div class="seg ev-kind" role="radiogroup" aria-label="Tipo">${Object.entries(KIND_LABEL).map(([k, l]) => `<button type="button" data-kind="${k}" class="${(ev.kind || 'event') === k ? 'on' : ''}" ${ev.readonly ? 'disabled' : ''}>${KIND_ICON[k] ? `${KIND_ICON[k]} ` : ''}${l}</button>`).join('')}</div>
      <label class="checks"><input type="checkbox" name="allDay" ${allDay ? 'checked' : ''} ${ev.readonly || locked ? 'disabled' : ''}/> Dia inteiro</label>
      <div class="row">
        <div class="field"><label for="evSD">Início</label><input id="evSD" type="date" name="sd" value="${ymdOf(s)}" ${ev.readonly || locked ? 'disabled' : ''}/></div>
        <div class="field time"><label for="evST">Hora</label><input id="evST" type="time" name="st" value="${hhmm(s)}" ${ev.readonly || locked ? 'disabled' : ''}/></div>
      </div>
      <div class="row">
        <div class="field"><label for="evED">Fim</label><input id="evED" type="date" name="ed" value="${ymdOf(endShown)}" ${ev.readonly || locked ? 'disabled' : ''}/></div>
        <div class="field time"><label for="evET">Hora</label><input id="evET" type="time" name="et" value="${hhmm(e)}" ${ev.readonly || locked ? 'disabled' : ''}/></div>
      </div>
      ${locked ? '<p class="hint">Evento de uma série: as datas e horas mudam-se no calendário de origem. Aqui podes mudar o título, o tipo, o projeto, o local e as notas da série.</p>' : ''}
      <div class="row">
        <div class="field"><label for="evTarget">Calendário</label>${isNew
          ? `<select id="evTarget" name="target">${targets.map((t) => `<option value="${esc(t.key)}" ${t.key === target ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`
          : `<input id="evTarget" value="${esc(ev.calendar || c.sources.find((x) => x.key === ev.source)?.name || ev.source)}" disabled />`}</div>
        <div class="field"><label for="evProj">Projeto</label><select id="evProj" name="projectId" ${ev.readonly ? 'disabled' : ''}><option value="">— nenhum —</option>${c.projects.map((x) => `<option value="${esc(x.id)}" ${x.id === ev.projectId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="evLoc">Local</label><input id="evLoc" name="location" value="${esc(ev.location || '')}" ${ev.readonly ? 'readonly' : ''}/></div>
      <div class="field"><label for="evNotes">Notas</label><textarea id="evNotes" name="notes" ${ev.readonly ? 'readonly' : ''}>${esc(ev.notes || '')}</textarea></div>
      ${ev.ref ? '<p><a href="#" data-openref>Abrir o e-mail de origem</a></p>' : ''}
      ${ev.url ? `<p><a href="${esc(ev.url)}" target="_blank" rel="noopener">Abrir no Google Calendar</a></p>` : ''}
      <div id="evStatus" class="status-line"></div>
      <div class="actions">
        ${ev.readonly ? (ev.source === 'funnel' ? '<button type="button" class="btn primary" data-funnel>Abrir o Funil</button>' : '') : `<button class="btn primary">${isNew ? 'Criar' : 'Guardar'}</button>`}
        ${!isNew && !ev.readonly ? '<button type="button" class="btn danger" data-del>Apagar</button>' : ''}
        <button type="button" class="btn" data-x>Fechar</button>
      </div>
    </form>`;
    app().append(p);
    const f = $('#evForm', p);
    let kind = ev.kind || 'event';
    const syncAllDay = () => { const ad = f.allDay.checked; $$('.field.time', p).forEach((x) => (x.hidden = ad)); };
    f.allDay.onchange = syncAllDay; syncAllDay();
    $$('[data-kind]', p).forEach((b) => (b.onclick = () => {
      kind = b.dataset.kind; $$('[data-kind]', p).forEach((x) => x.classList.toggle('on', x === b));
      if (kind !== 'event' && isNew && !f.allDay.checked) { f.allDay.checked = true; syncAllDay(); } // marcos costumam ser de dia inteiro
      $('h1', p).textContent = `${isNew ? 'Novo' : 'Editar'} ${KIND_LABEL[kind].toLowerCase()}`;
    }));
    // Mudar o início puxa o fim, mantendo a duração.
    const dur = e - s;
    f.sd.onchange = () => { if (!f.sd.value) return; const ns = new Date(`${f.sd.value}T${f.st.value || '09:00'}`); const ne = new Date(ns.getTime() + dur); f.ed.value = ymdOf(f.allDay.checked ? plusDays(ne, -1) : ne); if (!f.allDay.checked) f.et.value = hhmm(ne); };
    f.st.onchange = f.sd.onchange;
    const close = () => { p.remove(); host.focus({ preventScroll: true }); };
    state.closeEditor = close;
    $$('[data-x]', p).forEach((b) => (b.onclick = close));
    $('[data-funnel]', p)?.addEventListener('click', () => { close(); openView('funnel'); });
    $('[data-openref]', p)?.addEventListener('click', (x) => { x.preventDefault(); const [account, folder, uid] = String(ev.ref).split(':'); close(); state.view = 'mail'; app().removeAttribute('data-wide'); if (state.mode !== 'classic') setMode('classic'); highlightNav(); openMessage({ account, folder, uid: Number(uid) }); });
    const st = (cls, html) => { const el = $('#evStatus', p); el.className = `status-line ${cls}`; el.innerHTML = html; };
    f.onsubmit = async (x) => {
      x.preventDefault();
      const ad = f.allDay.checked;
      const body = {
        title: f.title.value, kind, allDay: ad, location: f.location.value, notes: f.notes.value, projectId: f.projectId.value, ref: ev.ref || '',
        start: ad ? f.sd.value : new Date(`${f.sd.value}T${f.st.value || '00:00'}`).toISOString(),
        end: ad ? ymdOf(plusDays(fromYmd(f.ed.value || f.sd.value), 1)) : new Date(`${f.ed.value || f.sd.value}T${f.et.value || '00:00'}`).toISOString(),
      };
      if (locked) { body.start = ev.start; body.end = ev.end; body.allDay = ev.allDay; }
      st('', spin('A guardar…'));
      try {
        if (isNew) await api('/api/calendar/events', { method: 'POST', body: { ...body, target: f.target.value } });
        else await api(`/api/calendar/events/${encodeURIComponent(ev.id)}`, { method: 'PUT', body });
        close(); toast(isNew ? 'Evento criado' : 'Evento guardado');
        if ($('.cal')) loadCalendar();
      } catch (err) { st('err', esc(err.message)); }
    };
    $('[data-del]', p)?.addEventListener('click', async (x) => {
      const b = x.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirmar: apagar'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Apagar'; } }, 4000); return; }
      try { await api(`/api/calendar/events/${encodeURIComponent(ev.id)}`, { method: 'DELETE' }); close(); toast('Evento apagado'); if ($('.cal')) loadCalendar(); }
      catch (err) { st('err', esc(err.message)); }
    });
    (ev.readonly ? $('[data-x]', p) : f.title).focus();
  }

  function projectEditor(pr = {}) {
    $('.cal-ed')?.remove();
    const isNew = !pr.id;
    const p = document.createElement('div');
    p.className = 'cal-ed'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', isNew ? 'Novo projeto' : 'Projeto');
    p.innerHTML = `<form class="cal-ed-in" id="prForm">
      <div class="compose-head"><h1>${isNew ? 'Novo projeto' : 'Projeto'}</h1><button type="button" class="close" data-x aria-label="Fechar (Esc)">×</button></div>
      <div class="row"><div class="field"><label for="prName">Nome</label><input id="prName" name="name" value="${esc(pr.name || '')}" required /></div>
        <div class="field" style="max-width:90px"><label for="prColor">Cor</label><input id="prColor" type="color" name="color" value="${esc(pr.color || '#3b6fd8')}" /></div></div>
      <div class="row"><div class="field"><label for="prStart">Início</label><input id="prStart" type="date" name="start" value="${esc(pr.start || '')}" /></div>
        <div class="field"><label for="prEnd">Fim</label><input id="prEnd" type="date" name="end" value="${esc(pr.end || '')}" /></div></div>
      <div class="field"><label for="prNotes">Notas</label><textarea id="prNotes" name="notes">${esc(pr.notes || '')}</textarea></div>
      ${isNew ? '' : `<label class="checks"><input type="checkbox" name="done" ${pr.done ? 'checked' : ''}/> Concluído</label>`}
      <p class="hint">Os milestones e deadlines de um projeto são eventos do calendário com o projeto escolhido. Podem estar no calendário do mailroom, no Spacemail ou no Google.</p>
      <div id="prStatus" class="status-line"></div>
      <div class="actions"><button class="btn primary">${isNew ? 'Criar' : 'Guardar'}</button>${isNew ? '' : '<button type="button" class="btn" data-additem>Novo marco</button><button type="button" class="btn danger" data-del>Apagar projeto</button>'}<button type="button" class="btn" data-x>Fechar</button></div>
    </form>`;
    app().append(p);
    const f = $('#prForm', p);
    const close = () => { p.remove(); host.focus({ preventScroll: true }); };
    state.closeEditor = close;
    $$('[data-x]', p).forEach((b) => (b.onclick = close));
    f.onsubmit = async (x) => {
      x.preventDefault();
      const body = { name: f.name.value, color: f.color.value, start: f.start.value, end: f.end.value, notes: f.notes.value, done: f.done?.checked || false };
      try { if (isNew) await api('/api/projects', { method: 'POST', body }); else await api(`/api/projects/${pr.id}`, { method: 'PUT', body }); close(); toast(isNew ? 'Projeto criado' : 'Projeto guardado'); loadCalendar(); }
      catch (err) { $('#prStatus', p).className = 'status-line err'; $('#prStatus', p).textContent = err.message; }
    };
    $('[data-additem]', p)?.addEventListener('click', () => { close(); newMilestone(pr.id); });
    $('[data-del]', p)?.addEventListener('click', async (x) => {
      const b = x.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirmar: apagar o projeto e os marcos do mailroom'; return; }
      await api(`/api/projects/${pr.id}`, { method: 'DELETE' }); close(); toast('Projeto apagado'); loadCalendar();
    });
    f.name.focus();
  }
  const newMilestone = (projectId) => { const d = ymdOf(new Date()); eventEditor({ kind: 'milestone', allDay: true, start: d, end: ymdOf(plusDays(new Date(), 1)), projectId, target: 'local' }); };

  // Criar um evento a partir do e-mail aberto.
  function eventFromMessage() {
    const m = state.current; if (!m) return;
    const open = () => eventEditor({
      title: m.subject || '', notes: `De: ${whoFull(m.from)}\n${new Date(m.date).toLocaleString('pt-PT')}\n\n${textOf(m).slice(0, 600)}`,
      ref: `${m.account}:${m.folder}:${m.uid}`,
    }, true);
    if (state.cal.sources.length) open();
    else Promise.all([api('/api/calendar/events?' + new URLSearchParams({ from: new Date().toISOString(), to: plusDays(new Date(), 1).toISOString() })), api('/api/projects')])
      .then(([r, pr]) => { Object.assign(state.cal, { sources: r.sources, defaultTarget: r.defaultTarget, projects: pr }); open(); }).catch((e) => toast('Erro: ' + e.message));
  }

  // ---------- interação ----------
  $('#reader').addEventListener('click', async (e) => {
    if (!e.target.closest('.cal')) return;
    const c = state.cal;
    const go = (fn) => { fn(); ls.set('mailroom.calView', c.view); loadCalendar(); };
    const step = c.view === 'month' ? 0 : CAL_VIEWS[c.view][1];
    const cmd = e.target.closest('[data-c]')?.dataset.c;
    if (cmd === 'today') return go(() => { c.date = dayStart(new Date()); });
    if (cmd === 'prev') return go(() => { c.date = c.view === 'month' ? new Date(c.date.getFullYear(), c.date.getMonth() - 1, 1) : plusDays(c.date, -step); });
    if (cmd === 'next') return go(() => { c.date = c.view === 'month' ? new Date(c.date.getFullYear(), c.date.getMonth() + 1, 1) : plusDays(c.date, step); });
    if (cmd === 'new') return eventEditor({}, true);
    if (cmd === 'newProject') return projectEditor();
    if (cmd === 'settings') { openView('settings'); setTimeout(() => $('#calSettingsTitle')?.scrollIntoView({ block: 'start' }), 300); return; }
    const cv = e.target.closest('[data-cv]')?.dataset.cv;
    if (cv) return go(() => { c.view = cv; });
    const goto = e.target.closest('[data-goto]')?.dataset.goto;
    if (goto) return go(() => { c.date = fromYmd(goto); c.view = 'day'; });
    const src = e.target.closest('[data-src]')?.dataset.src;
    if (src) {
      const hidden = c.sources.filter((s) => s.hidden).map((s) => s.key);
      const next = hidden.includes(src) ? hidden.filter((k) => k !== src) : [...hidden, src];
      await api('/api/calendar/config', { method: 'PUT', body: { hidden: next } }); return loadCalendar();
    }
    const evId = e.target.closest('[data-ev]')?.dataset.ev;
    if (evId) { const ev = c.events.find((x) => x.id === evId); if (ev) eventEditor(ev, false); return; }
    const pid = e.target.closest('[data-proj]')?.dataset.proj;
    if (pid) return projectEditor(c.projects.find((x) => x.id === pid));
    const addItem = e.target.closest('[data-additem]')?.dataset.additem;
    if (addItem) return newMilestone(addItem);
    if (e.target.closest('[data-funnel]')) return openView('funnel');
    // Clicar num espaço vazio cria um evento ali.
    const colEl = e.target.closest('.tg-col');
    if (colEl) {
      const y = e.clientY - colEl.getBoundingClientRect().top;
      const mins = Math.max(0, Math.min(23 * 60 + 30, Math.floor((y / HOUR_PX) * 2) * 30));
      const s = new Date(`${colEl.dataset.day}T${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`);
      return eventEditor({ start: s.toISOString(), end: new Date(s.getTime() + 3600e3).toISOString() }, true);
    }
    const dayEl = e.target.closest('.tg-ad, .mg-cell');
    if (dayEl) return eventEditor({ allDay: true, start: dayEl.dataset.day, end: ymdOf(plusDays(fromYmd(dayEl.dataset.day), 1)) }, true);
  });

  // ---------- definições: calendários ----------
  async function renderCalSettings() {
    const box = $('#calBox'); if (!box) return;
    let cfg;
    try { cfg = await api('/api/calendar/config'); } catch (e) { box.textContent = 'Erro: ' + e.message; return; }
    const targets = cfg.sources.filter((s) => s.writable && s.type !== 'funnel');
    box.innerHTML = `
      <div class="card">
        <div class="c-title">Calendário por omissão</div>
        <div class="field" style="margin:0"><select id="calDefault">${targets.map((t) => `<option value="${esc(t.key)}" ${t.key === cfg.defaultTarget ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        <p class="hint" style="margin:8px 0 0">Onde ficam os eventos novos, se não escolheres outro.</p>
      </div>
      ${cfg.caldav.map((a) => `<div class="card" data-dav="${esc(a.account)}">
        <div class="c-title">${esc(a.address)} <span class="muted" style="font-weight:400">· CalDAV</span></div>
        ${a.connected ? `<div class="checks-col">${a.calendars.map((c) => `<label class="checks"><input type="checkbox" value="${esc(c.href)}" ${c.enabled !== false ? 'checked' : ''}/> <span class="sw" style="--c:${esc(c.color)}"></span>${esc(c.name)}</label>`).join('')}</div>` : ''}
        <div class="row" style="align-items:flex-end"><div class="field" style="margin:0"><label>Endereço CalDAV</label><input name="url" value="${esc(a.url || a.guess)}" placeholder="https://caldav.exemplo.com/" /></div>
          <button class="btn ${a.connected ? '' : 'primary'}" data-davgo>${a.connected ? 'Procurar outra vez' : 'Ligar calendário'}</button>${a.connected ? '<button class="btn danger" data-davoff>Desligar</button>' : ''}</div>
        <div class="status-line" data-davst></div>
        <p class="hint" style="margin:6px 0 0">Usa a mesma palavra-passe da conta de correio. No Spacemail o endereço é https://caldav.spacemail.com/.</p>
      </div>`).join('')}
      <div class="card" id="gCard">
        <div class="c-title">Google Calendar ${cfg.google.connected ? `<span class="muted" style="font-weight:400">· ligado${cfg.google.email ? ` (${esc(cfg.google.email)})` : ''}</span>` : ''}</div>
        ${cfg.google.connected ? `<div class="checks-col">${cfg.google.calendars.map((c) => `<label class="checks"><input type="checkbox" value="${esc(c.id)}" ${c.enabled !== false ? 'checked' : ''}/> <span class="sw" style="--c:${esc(c.color)}"></span>${esc(c.name)}${c.writable ? '' : ' <span class="muted">(só leitura)</span>'}</label>`).join('')}</div>
          <div class="actions" style="margin:8px 0 0"><button class="btn" data-grefresh>Atualizar lista</button><button class="btn danger" data-goff>Desligar</button></div>` : `
          <p class="muted" style="margin-top:0">O Google só deixa apps externas usar o calendário com uma autorização própria (OAuth). Faz-se uma vez:</p>
          <ol class="steps">
            <li>Em <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a>, cria um projeto (ex.: «mailroom»).</li>
            <li>Ativa a <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener">Google Calendar API</a>.</li>
            <li>Em <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener">Google Auth Platform</a>, configura o ecrã de consentimento como <b>Externo</b>, junta o teu e-mail como utilizador de teste e, em «Público», carrega em <b>Publicar app</b> (sem isso, a ligação expira ao fim de 7 dias).</li>
            <li>Em «Clientes», cria um cliente OAuth do tipo <b>App para computador</b> e copia o ID e o segredo para aqui.</li>
          </ol>
          <div class="row"><div class="field"><label for="gId">ID de cliente</label><input id="gId" value="${esc(cfg.google.clientId)}" placeholder="…apps.googleusercontent.com" /></div>
            <div class="field"><label for="gSecret">Segredo do cliente</label><input id="gSecret" type="password" autocomplete="off" placeholder="${cfg.google.hasSecret ? 'guardado — escreve para substituir' : 'GOCSPX-…'}" /></div></div>
          <div class="actions" style="margin:0"><button class="btn primary" data-gconnect>Ligar ao Google</button></div>
          <p class="hint">Abre o browser para autorizares. O mailroom só pede acesso ao calendário.</p>`}
        <div class="status-line" id="gStatus"></div>
      </div>`;
    $('#calDefault').onchange = async (e) => { await api('/api/calendar/config', { method: 'PUT', body: { defaultTarget: e.target.value } }); toast('Guardado'); };
    $$('[data-dav]', box).forEach((card) => {
      const accId = card.dataset.dav;
      const st = (cls, html) => { const el = $('[data-davst]', card); el.className = `status-line ${cls}`; el.innerHTML = html; };
      $('[data-davgo]', card).onclick = async () => {
        st('', spin('A procurar calendários…'));
        try { const r = await api(`/api/calendar/caldav/${encodeURIComponent(accId)}`, { method: 'POST', body: { url: $('[name=url]', card).value } }); toast(`${r.calendars.length} calendário(s) ligados`); renderCalSettings(); }
        catch (e) { st('err', esc(e.message)); }
      };
      $('[data-davoff]', card)?.addEventListener('click', async () => { await api(`/api/calendar/caldav/${encodeURIComponent(accId)}`, { method: 'DELETE' }); renderCalSettings(); });
      $$('input[type=checkbox]', card).forEach((x) => (x.onchange = async () => {
        await api(`/api/calendar/caldav/${encodeURIComponent(accId)}`, { method: 'PUT', body: { enabled: $$('input[type=checkbox]:checked', card).map((y) => y.value) } }); toast('Guardado');
      }));
    });
    const g = $('#gCard');
    const gst = (cls, html) => { const el = $('#gStatus'); el.className = `status-line ${cls}`; el.innerHTML = html; };
    $('[data-gconnect]', g)?.addEventListener('click', async () => {
      try {
        await api('/api/calendar/config', { method: 'PUT', body: { google: { clientId: $('#gId').value, clientSecret: $('#gSecret').value } } });
        const r = await api('/api/calendar/google/auth', { method: 'POST' });
        window.open(r.url, '_blank', 'noopener');
        gst('', `${spin('À espera da autorização no browser…')} <button class="btn" type="button" id="gDone">Já autorizei</button>`);
        // Verifica sozinho durante uns minutos; o botão serve para quem volta antes.
        let n = 0;
        const poll = setInterval(async () => { if (!$('#gCard') || ++n > 90) return clearInterval(poll); const c2 = await api('/api/calendar/config').catch(() => null); if (c2?.google.connected) { clearInterval(poll); toast('Google Calendar ligado'); renderCalSettings(); } }, 2000);
        $('#gDone').onclick = () => renderCalSettings();
      } catch (e) { gst('err', esc(e.message)); }
    });
    $('[data-grefresh]', g)?.addEventListener('click', async () => { try { await api('/api/calendar/google/refresh', { method: 'POST' }); renderCalSettings(); } catch (e) { gst('err', esc(e.message)); } });
    $('[data-goff]', g)?.addEventListener('click', async () => { await api('/api/calendar/google', { method: 'DELETE' }); renderCalSettings(); });
    $$('.checks-col input[type=checkbox]', g).forEach((x) => (x.onchange = async () => {
      await api('/api/calendar/config', { method: 'PUT', body: { google: { enabled: $$('.checks-col input:checked', g).map((y) => y.value) } } }); toast('Guardado');
    }));
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
        if (!r2.saved) {
          const sug = r2.test.suggestHost;
          st('err', `${r2.test.error.split(' · ').map(esc).join('<br>')}${sug ? `<br><span style="color:var(--ink)">O certificado deste servidor é de <b>${esc(sug)}</b>.</span> <button type="button" class="btn" id="useHost">Usar ${esc(sug)}</button>` : ''}<br><a href="#" id="saveAnyway">Guardar mesmo assim</a>`);
          $('#useHost')?.addEventListener('click', () => { f.imapHost.value = sug; f.smtpHost.value = sug; submit(false); }); $('#saveAnyway').onclick = (e) => { e.preventDefault(); submit(true); }; return; }
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
    if (!btn.dataset.armed) {
      btn.dataset.armed = 1; btn.textContent = `Confirmar: instalar v${u.latest}`;
      setTimeout(() => { if (btn.isConnected && !btn.disabled) { delete btn.dataset.armed; btn.textContent = btn.id === 'updateBtn' ? `Atualizar para v${u.latest}` : `Descarregar e instalar v${u.latest}`; } }, 5000);
      return;
    }
    // Mostra o progresso nos dois sítios (barra lateral e Definições).
    const show = (text) => { [$('#updateBtn'), $('#updNow')].forEach((b) => { if (b) { b.disabled = true; b.textContent = text; } }); const bar = $('#updBar'); if (bar) bar.hidden = false; };
    show('A descarregar… 0%');
    const timer = setInterval(async () => {
      try {
        const p = await api('/api/update/progress');
        if (p.phase === 'download') { show(`A descarregar… ${p.percent}%`); const f = $('#updBarFill'); if (f) f.style.width = p.percent + '%'; }
        if (p.phase === 'install') { show('A instalar… a app vai reiniciar'); const f = $('#updBarFill'); if (f) f.style.width = '100%'; }
      } catch { /* a app está a reiniciar */ }
    }, 500);
    try {
      const r = await api('/api/update/apply', { method: 'POST' });
      if (r.restart !== 'auto') { clearInterval(timer); show(`v${r.version} instalada — fecha e volta a abrir`); toast('Atualização instalada. Fecha o mailroom e abre-o outra vez.'); }
      else toast('A instalar. O mailroom reinicia sozinho.');
    } catch (e) {
      clearInterval(timer);
      [$('#updateBtn'), $('#updNow')].forEach((b) => { if (b) { b.disabled = false; delete b.dataset.armed; b.textContent = 'Tentar outra vez'; } });
      const bar = $('#updBar'); if (bar) bar.hidden = true;
      toast('Erro: ' + e.message);
    }
  }
  $('#updateBtn').onclick = (e) => applyUpdate(e.currentTarget);
  async function renderVersion(fresh) {
    const box = $('#versionBox'); if (!box) return;
    box.innerHTML = spin('A verificar atualizações…');
    const u = await checkUpdate(fresh);
    if (!$('#versionBox')) return;
    const cur = u?.current || state.status.version || '?';
    const when = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    if (u?.available) {
      box.innerHTML = `<div class="card">
        <div class="c-title">Há uma versão nova: v${esc(u.latest)} <span class="muted" style="font-weight:400">(tens a v${esc(cur)})</span></div>
        ${u.notes ? `<div class="c-body muted" style="margin-bottom:10px">${esc(u.notes)}</div>` : ''}
        <div class="progress" id="updBar" hidden><div id="updBarFill"></div></div>
        <div class="actions" style="margin:0">
          <button class="btn primary" id="updNow">${u.canApply ? `Descarregar e instalar v${esc(u.latest)}` : 'Abrir página da versão'}</button>
          <a class="btn" href="${esc(u.url)}" target="_blank" rel="noopener">Ver no GitHub</a>
        </div>
        ${u.packaged ? '<p class="hint" style="margin:10px 0 0">A app fecha, instala e volta a abrir sozinha. As tuas contas e definições mantêm-se.</p>' : '<p class="hint" style="margin:10px 0 0">Instalação a partir do código: <code>git pull && npm install</code>.</p>'}
      </div>`;
    } else {
      const msg = u?.error ? `<span style="color:var(--warn)">${esc(u.error)}</span>` : u?.latest ? 'Tens a versão mais recente.' : 'Ainda não há versões publicadas.';
      box.innerHTML = `<div class="card"><div class="c-head" style="margin:0;gap:12px;flex-wrap:wrap">
        <span><b style="color:var(--ink)">mailroom v${esc(cur)}</b> · ${msg} <span class="muted">Verificado às ${when}.</span></span>
        <span><button class="btn" id="updCheck">Verificar agora</button> <a class="btn" href="${esc(u?.url || 'https://github.com/dferreiramarques/mailroom/releases')}" target="_blank" rel="noopener">Versões</a></span>
      </div></div>`;
    }
    $('#updNow')?.addEventListener('click', (e) => applyUpdate(e.currentTarget));
    $('#updCheck')?.addEventListener('click', () => renderVersion(true));
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
      if ($('.cal-ed') && !tgt.closest?.('input, textarea, select')) return state.closeEditor?.();
      if ($('#composeForm') && state.closeCompose && !tgt.closest?.('input, textarea, select')) return state.closeCompose();
    }
    if (tgt.closest?.('input, textarea, select')) { if (e.key === 'Escape') { tgt.blur(); host.focus({ preventScroll: true }); } return; } // o foco fica na app, para o Esc seguinte e os atalhos funcionarem
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (state.view === 'calendar' && !$('.cal-ed')) {
      const cal = { t: 'today', n: 'new', ArrowLeft: 'prev', ArrowRight: 'next' }[k];
      if (cal) { e.preventDefault(); $(`.cal [data-c="${cal}"]`)?.click(); return; }
    }
    if (k === '/') { e.preventDefault(); (state.mode === 'topics' ? $('#topicSearch') : $('#search'))?.focus(); return; }
    // preventDefault: sem ele, a tecla chega ao campo que acabou de receber o foco (o «c» aparecia no Para).
    if (k === 'c') { e.preventDefault(); return compose(); }
    if (k === 'v') { e.preventDefault(); return setMode(state.mode === 'topics' ? 'classic' : 'topics'); }
    if (k === 'e' && state.mode === 'topics' && !state.showDismissed) {
      const id = ($('.focus') ? state.focusId : null) || tgt.closest?.('.topic')?.dataset.id || [...state.open].at(-1);
      if (id) { closeFocus(); return dismissTopic(id); }
    }
    if (state.mode === 'classic') {
      const run = { j: () => select(state.index + 1), k: () => select(Math.max(0, state.index - 1)), r: reply, s: summarize, g: suggest }[k];
      if (run) { e.preventDefault(); run(); }
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
    if (state.mode === 'topics') loadTopics(); else { state.view = 'mail'; loadList(); readerHome(); }
    highlightNav();
    emit('mail-ready', { accounts: state.status.accounts, mode: state.mode });
    refreshFunnelCount(); setInterval(refreshFunnelCount, 5 * 60_000);
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
    root.querySelector('.brand').textContent = this.getAttribute('brand') || '';
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    this._api = mount(root, this, base);
  }
  attributeChangedCallback(name, _, v) { if (name === 'brand' && this.shadowRoot) this.shadowRoot.querySelector('.brand').textContent = v || ''; }
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
