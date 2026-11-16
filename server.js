// mailroom — app autónoma. Usa o mesmo módulo que se integra na plataforma Bitnik.
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMailModule, fileStore } from './core/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Contas: variável ACCOUNTS_JSON (Railway e afins) ou ficheiro accounts.json (local).
function loadAccounts() {
  if (process.env.ACCOUNTS_JSON) {
    try { return JSON.parse(process.env.ACCOUNTS_JSON); }
    catch (e) { console.error('ACCOUNTS_JSON não é JSON válido:', e.message); process.exit(1); }
  }
  const file = path.join(__dirname, 'accounts.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
const accounts = loadAccounts();
const demo = process.env.DEMO === '1' || !accounts;
// Onde ficam rascunhos e definições. No Railway, aponta DATA_DIR para um Volume.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const mail = createMailModule({
  demo,
  accounts: demo ? [] : accounts,
  // Fornecedor por omissão vindo do .env; pode ser mudado nas Definições da app.
  ai: process.env.AI_PROVIDER === 'openai'
    ? { provider: 'openai', apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL, baseURL: process.env.AI_BASE_URL }
    : { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY, model: process.env.AI_MODEL || process.env.ANTHROPIC_MODEL },
  store: fileStore(DATA_DIR),
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

// Palavra-passe opcional (obrigatória se publicares a app fora do teu computador).
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const [, b64 = ''] = (req.headers.authorization || '').split(' ');
    const [, pass = ''] = Buffer.from(b64, 'base64').toString().split(':');
    const a = Buffer.from(pass), b = Buffer.from(process.env.APP_PASSWORD);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    res.set('WWW-Authenticate', 'Basic realm="mailroom"').status(401).end('Autenticação necessária');
  });
}

app.use('/mail', mail.router);
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || (process.env.APP_PASSWORD ? '0.0.0.0' : '127.0.0.1');
app.listen(PORT, HOST, async () => {
  console.log(`mailroom em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(demo ? '→ modo demo (sem accounts.json)' : `→ contas: ${mail.accounts.map((a) => a.label).join(', ')}`);
  console.log((await mail.ai.enabled()) ? '→ IA ativa' : '→ IA simulada (configura um fornecedor nas Definições ou no .env)');
});
