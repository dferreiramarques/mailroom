// mailroom — app de desktop. Arranca o servidor dentro do próprio processo,
// numa porta local aleatória protegida por um token, e mostra-o numa janela.
import { app, BrowserWindow, Menu, Tray, Notification, shell, nativeImage, session, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = crypto.randomBytes(24).toString('hex');
const isDev = !app.isPackaged;
let win = null, tray = null, base = '', quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());
app.setAppUserModelId('io.monco.mailroom');

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// ---------- atualizações (electron-updater, Releases do GitHub) ----------
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
let lastUpdate = null;
const updater = {
  async check() {
    const current = app.getVersion();
    const out = { current, latest: null, available: false, packaged: true, canApply: false, url: 'https://github.com/dferreiramarques/mailroom/releases/latest' };
    if (isDev) return out;
    try {
      const r = await autoUpdater.checkForUpdates();
      const info = r?.updateInfo;
      if (info) {
        out.latest = info.version;
        out.available = Boolean(r.isUpdateAvailable ?? info.version !== current);
        out.canApply = out.available;
        out.notes = typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]+>/g, '').slice(0, 800) : '';
      }
    } catch (e) { out.error = 'Não consegui verificar atualizações'; console.error('[update]', e.message); }
    lastUpdate = out;
    return out;
  },
  async apply() {
    if (!lastUpdate?.available) throw Object.assign(new Error('Não há atualização para aplicar'), { status: 400 });
    await autoUpdater.downloadUpdate();
    setTimeout(() => { quitting = true; autoUpdater.quitAndInstall(true, true); }, 1500);
    return { ok: true, version: lastUpdate.latest, restart: 'auto' };
  },
};
globalThis.__mailroomUpdate = updater;

// ---------- janela ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 420, minHeight: 520,
    title: 'mailroom', backgroundColor: '#fbfaf8', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(base);
  // Ligações externas abrem no browser do sistema; a janela nunca sai da app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(base)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  // Menu de contexto básico nos campos de texto (a app trata do seu próprio menu sobre texto selecionado).
  win.webContents.on('context-menu', (e, p) => {
    if (!p.isEditable) return;
    Menu.buildFromTemplate([
      ...p.dictionarySuggestions.slice(0, 4).map((s) => ({ label: s, click: () => win.webContents.replaceMisspelling(s) })),
      ...(p.dictionarySuggestions.length ? [{ type: 'separator' }] : []),
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' },
    ]).popup();
  });
  // Fechar a janela deixa a app na bandeja, para continuar a avisar de correio novo.
  win.on('close', (e) => { if (!quitting && tray) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}
function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  } catch { tray = null; return; }
  tray.setToolTip('mailroom');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Abrir mailroom', click: showWindow },
    { type: 'separator' },
    ...(process.platform === 'linux' ? [] : [{
      label: 'Abrir ao iniciar o computador', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }); tray.setContextMenu(menu()); },
    }]),
    { label: 'Abrir pasta de dados', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', showWindow);
}

// ---------- avisos de correio novo ----------
const seen = new Set();
let seeded = false;
async function pollMail() {
  try {
    const get = (p) => fetch(`${base}/mail/api/${p}`, { headers: { 'x-mailroom-token': TOKEN } }).then((r) => r.json());
    const status = await get('status');
    if (status.demo) return;
    const { items = [] } = await get('messages?account=all&folder=INBOX&limit=25&fresh=1');
    const fresh = items.filter((m) => !m.seen && !seen.has(`${m.account}:${m.uid}`));
    items.forEach((m) => seen.add(`${m.account}:${m.uid}`));
    if (seeded && fresh.length && Notification.isSupported() && !(win?.isFocused())) {
      const first = fresh[0];
      const n = new Notification({
        title: fresh.length === 1 ? (first.from?.[0]?.name || first.from?.[0]?.address || 'Correio novo') : `${fresh.length} mensagens novas`,
        body: fresh.length === 1 ? first.subject : fresh.slice(0, 3).map((m) => m.subject).join('\n'),
        icon: path.join(__dirname, 'icon.png'),
      });
      n.on('click', () => { showWindow(); win?.webContents.reload(); });
      n.show();
    }
    seeded = true;
  } catch { /* sem rede: tenta na próxima */ }
}

// ---------- arranque ----------
app.whenReady().then(async () => {
  try {
    const port = Number(process.env.MAILROOM_PORT) || (await freePort());
    process.env.PORT = String(port);
    process.env.HOST = '127.0.0.1';
    process.env.MAILROOM_TOKEN = TOKEN;
    process.env.DATA_DIR = process.env.DATA_DIR || app.getPath('userData');
    base = `http://127.0.0.1:${port}`;
    // Só os pedidos feitos por esta app levam o token.
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${base}/*`] }, (details, cb) => {
      cb({ requestHeaders: { ...details.requestHeaders, 'x-mailroom-token': TOKEN } });
    });
    const { ready } = await import('../server.js');
    await ready;
  } catch (e) {
    dialog.showErrorBox('mailroom', `Não consegui arrancar: ${e.message}`);
    app.exit(1); return;
  }
  createTray();
  if (!process.argv.includes('--hidden') || !tray) createWindow();
  pollMail();
  setInterval(pollMail, 3 * 60_000);
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('activate', showWindow);
