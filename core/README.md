# @mailroom/core

O núcleo do mailroom, para usar dentro de outras plataformas. Tem duas partes:

- **Servidor**: `createMailModule()` devolve um `router` Express com a API (tópicos, correio, rascunhos, IA, agente). Também serve o próprio cliente.
- **Cliente**: o web component `<mail-room>`. É JS puro, sem dependências, e usa Shadow DOM, por isso não choca com o CSS da plataforma que o recebe.

## Integrar em 3 passos

```bash
npm install ../mailroom/core
```

```js
import { createMailModule, fileStore } from '@mailroom/core';

const mail = createMailModule({
  accounts,                                            // contas IMAP/SMTP
  ai: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  store: fileStore('./data/mail'),                     // ou um adaptador de BD
  auth: requireLogin,                                  // a sessão da tua plataforma
});
app.use('/mail', mail.router);
```

```html
<script type="module" src="/mail/client.js"></script>
<mail-room api="/mail"></mail-room>
```

## Opções de `createMailModule`

| opção | o quê |
|---|---|
| `accounts` | contas: `id`, `label`, `address`, `color`, `signature`, `imap`, `smtp`, `filterTo`, `filterFrom`, `appendSent` |
| `ai` | fornecedor por omissão: `{ provider: 'anthropic' \| 'openai', apiKey, model, baseURL }`. `openai` serve qualquer API compatível (OpenAI, OpenRouter, Gemini, Ollama…) |
| `lockAI` | `true` = a plataforma gere a IA e o utilizador não a pode mudar nas Definições |
| `store` | `memoryStore()` (por omissão), `fileStore(dir)` ou um adaptador `{ getDrafts, setDrafts, getSettings, setSettings }` |
| `settings` | contexto e voz por omissão (`name`, `about`, `voice`) |
| `auth` | middleware aplicado a todas as rotas, incluindo `client.js` |
| `onSend` | `(account, { to, subject }) => {}` depois de cada envio |
| `demo` | `true` para usar a caixa fictícia |

Devolve `{ router, ai, accounts, store }`.

O módulo não traz login próprio. **Passa sempre `auth`** numa plataforma com vários utilizadores.

### Vários clientes

Cria uma instância por cliente, cada uma com contas, IA e store próprios, e monta-as em caminhos diferentes:

```js
for (const t of tenants) app.use(`/t/${t.slug}/mail`, tenantAuth(t), createMailModule(t.mailConfig).router);
```

As caches (correio e resumos) são separadas por instância e por endereço de conta.

## `<mail-room>`

| atributo | o quê |
|---|---|
| `api` | caminho onde o router está montado (por omissão `/mail`) |
| `brand` | título no topo da barra lateral (sem este atributo, não aparece título) |
| `account` | conta selecionada ao abrir |
| `mode` | `topics` (por omissão) ou `classic`. Sem este atributo, o componente lembra a última escolha do utilizador |
| `theme` | `light` ou `dark`. Sem este atributo, segue o sistema |

**Métodos**

```js
el.setMode('classic');                                // 'topics' | 'classic'
el.open('pitch');                                     // 'triage' | 'pitch' | 'publish' | 'agent' | 'drafts' | 'settings'
el.compose({ account, to, subject, text });
el.research('Bulbous');                               // pesquisa rápida com IA
el.refresh();
```

**Eventos**: `mail-ready`, `mail-sent` (`detail: { account, to, subject }`) e `mode-change` (`detail: { mode }`).

**Cores**: muda as variáveis CSS a partir da página:

```css
mail-room { --accent: #c2571a; --bg: #fffaf3; --line: #ecdcc6; }
```

Variáveis disponíveis: `--bg`, `--panel`, `--ink`, `--muted`, `--line`, `--soft`, `--accent`, `--focus`, `--warn`, `--radius`.

`<bitnik-mail>` continua a funcionar como nome alternativo.

## API (resumo)

| método e rota | o quê |
|---|---|
| `GET /api/topics?account=&q=` | tópicos com resumo da IA, contagens e histórico |
| `GET /api/topic?id=` | conversa completa |
| `POST /api/ai/research` `{ query }` | pesquisa nas caixas + resumo |
| `POST /api/ai/replies` `{ account, uid, folder, topicId?, intent? }` | 3 sugestões de resposta, com o contexto da conversa |
| `GET` / `PUT /api/ai-settings` · `POST /api/ai-settings/test` | fornecedor de IA (a chave nunca é devolvida) |
| `GET /api/messages`, `GET /api/message/:acc/:uid`, `POST /api/send` | vista clássica e envio |
| `/api/drafts`, `/api/ai/{summarize,triage,pitch,publish,agent}` | rascunhos e workflows |

## Segurança

- O agente só pesquisa, lê e cria rascunhos. Não tem ferramenta de envio.
- O conteúdo dos e-mails é tratado nos prompts como dado, não como instruções.
- O HTML é mostrado numa sandbox sem scripts nem imagens remotas, e o texto é extraído sem executar nada.
- A chave da IA fica só no servidor.
