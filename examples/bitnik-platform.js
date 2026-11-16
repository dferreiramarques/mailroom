// Exemplo de integração: o mailroom dentro de outra plataforma Express
// (aqui, o Studio da Bitnik). O mailroom é um produto independente; isto é só um cliente. Correr: node examples/bitnik-platform.js
import express from 'express';
import { createMailModule, fileStore } from '../core/index.js';

const app = express();

// 1) A tua autenticação. Aqui é um exemplo; usa a sessão real da plataforma.
const requireStudioUser = (req, res, next) => {
  // if (!req.session?.user?.isAdmin) return res.status(401).json({ error: 'Sem sessão' });
  next();
};

// 2) Uma instância por publisher/cliente: contas, chave e definições próprias.
const bitnikMail = createMailModule({
  demo: !process.env.BITNIK_ACCOUNTS,
  accounts: process.env.BITNIK_ACCOUNTS ? JSON.parse(process.env.BITNIK_ACCOUNTS) : [],
  // Fornecedor de IA gerido pela plataforma (o utilizador não o pode mudar).
  ai: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  lockAI: Boolean(process.env.ANTHROPIC_API_KEY),
  store: fileStore('./data/mail-bitnik'),
  settings: {
    name: 'David · bitnikgames',
    about: 'bitnikgames: pequena editora independente de jogos de tabuleiro do Porto (Bulbous, Capivaras, Nine Oils, Praia das Percebes). Print & play, cópias de review, feiras.',
  },
  auth: requireStudioUser,
  onSend: (account, msg) => console.log(`[studio] enviado de ${account.address} para ${msg.to}`),
});

// 3) Montar onde quiseres.
app.use('/studio/mail', bitnikMail.router);

// 4) Página do Studio com o componente embebido num painel.
app.get('/studio', (req, res) => res.send(`<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><title>Bitnik Studio</title>
<script type="module" src="/studio/mail/client.js"></script>
<style>
  body { margin: 0; font-family: system-ui; display: grid; grid-template-columns: 220px 1fr; height: 100vh; background: #f6efe4; }
  aside { background: #c2571a; color: #fff; padding: 20px; }
  aside a { display: block; color: #fff; text-decoration: none; padding: 6px 0; opacity: .85; }
  aside a.on { opacity: 1; font-weight: 600; }
  main { padding: 20px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  mail-room { flex: 1; border: 1px solid #e3d6c3; border-radius: 10px; overflow: hidden; }
</style></head>
<body>
  <aside><b>Bitnik Studio</b><br><br>
    <a href="#">Jogos</a><a href="#">Forge</a><a href="#">Mesas</a><a class="on" href="#">Correio</a></aside>
  <main>
    <div><button id="pitchBulbous">Pitch do Bulbous a reviewers</button> <button id="research">Pesquisar “Bulbous” nas caixas</button></div>
    <mail-room api="/studio/mail" brand="Correio" account="bitnik" theme="light"></mail-room>
  </main>
  <script type="module">
    const mail = document.querySelector('mail-room');
    document.getElementById('pitchBulbous').onclick = () => mail.open('pitch');
    document.getElementById('research').onclick = () => mail.research('Bulbous');
    mail.addEventListener('mail-sent', (e) => console.log('enviado', e.detail));
  </script>
</body></html>`));

app.listen(4400, '127.0.0.1', () => console.log('Studio em http://127.0.0.1:4400/studio'));
