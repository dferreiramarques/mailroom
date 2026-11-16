// mailroom — servidor da app. Corre sozinho (npm start, alojado) ou dentro da app de desktop (electron/main.js).
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMailModule, fileStore } from './core/index.js';
import { createUpdater } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'dferreiramarques/mailroom';
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;

// Onde ficam contas, rascunhos e definições.
//  - app de desktop: pasta de dados do utilizador, passada em DATA_DIR
//  - código-fonte: ./data · alojado: DATA_DIR (um Volume)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Contas: ACCOUNTS_JSON (alojamento; só leitura) ou ficheiro (editável na app).
const fromEnv = Boolean(process.env.ACCOUNTS_JSON);
const legacyFile = path.join(__dirname, 'accounts.json');
const accountsFile = !process.env.DATA_DIR && fs.existsSync(legacyFile) ? legacyFile : path.join(DATA_DIR, 'accounts.json');
function loadAccounts() {
  try {
    if (fromEnv) return JSON.parse(process.env.ACCOUNTS_JSON);
    return fs.existsSync(accountsFile) ? JSON.parse(fs.readFileSync(accountsFile, 'utf8')) : [];
  } catch (e) { console.error(`Contas inválidas (${fromEnv ? 'ACCOUNTS_JSON' : accountsFile}):`, e.message); process.exit(1); }
}

const mail = createMailModule({
  version: VERSION,
  demo: process.env.DEMO === '1',
  demoWhenEmpty: true,
  accounts: process.env.DEMO === '1' ? [] : loadAccounts(),
  onAccountsChange: fromEnv ? undefined : (list) => fs.writeFileSync(accountsFile, JSON.stringify(list, null, 2), { mode: 0o600 }),
  // Fornecedor por omissão vindo do ambiente; pode ser mudado nas Definições da app.
  ai: process.env.AI_PROVIDER === 'openai'
    ? { provider: 'openai', apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL, baseURL: process.env.AI_BASE_URL }
    : { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY, model: process.env.AI_MODEL || process.env.ANTHROPIC_MODEL },
  store: fileStore(DATA_DIR),
  // A app de desktop fornece o seu próprio atualizador.
  update: globalThis.__mailroomUpdate || createUpdater({ repo: REPO, version: VERSION }),
});

const app = express();
app.set('trust proxy', 1);

// Verificação de saúde para o alojamento (não expõe dados).
app.get('/healthz', (req, res) => res.send('ok'));

// Num alojamento público, sem palavra-passe, recusa arrancar.
const hosted = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RENDER || process.env.FLY_APP_NAME);
if (hosted && !process.env.APP_PASSWORD) {
  console.error('APP_PASSWORD é obrigatória quando a app está alojada na internet. Define-a nas variáveis do serviço.');
  process.exit(1);
}
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const [, b64 = ''] = (req.headers.authorization || '').split(' ');
    const [, pass = ''] = Buffer.from(b64, 'base64').toString().split(':');
    const a = Buffer.from(pass), b = Buffer.from(process.env.APP_PASSWORD);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    res.set('WWW-Authenticate', 'Basic realm="mailroom"').status(401).end('Autenticação necessária');
  });
}

// Dentro da app de desktop, só a própria janela pode falar com o servidor local.
if (process.env.MAILROOM_TOKEN) {
  app.use((req, res, next) => (req.get('x-mailroom-token') === process.env.MAILROOM_TOKEN ? next() : res.status(403).end('Acesso só pela app mailroom')));
}

app.use('/mail', mail.router);
const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
app.get('/', (req, res) => res.type('html').send(indexHtml));

const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || (process.env.APP_PASSWORD ? '0.0.0.0' : '127.0.0.1');
const url = `http://localhost:${PORT}`;

/** Resolve quando o servidor está a aceitar ligações. */
export const ready = new Promise((resolve, reject) => {
  const server = app.listen(PORT, HOST, async () => {
    console.log(`mailroom ${VERSION} em ${url}`);
    console.log(mail.isDemo() ? '→ modo demo: adiciona uma conta em Definições' : `→ contas: ${mail.accounts.map((a) => a.label).join(', ')}`);
    console.log((await mail.ai.enabled()) ? '→ IA ativa' : '→ IA simulada: configura um fornecedor em Definições');
    console.log(`→ dados em ${DATA_DIR}`);
    resolve({ port: PORT, version: VERSION, dataDir: DATA_DIR });
  });
  server.on('error', (e) => {
    if (globalThis.__mailroomUpdate) return reject(e); // a app de desktop trata do erro
    console.error(e.code === 'EADDRINUSE' ? `A porta ${PORT} já está em uso (o mailroom já está a correr?).` : e);
    process.exit(1);
  });
});
