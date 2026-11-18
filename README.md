# mailroom

Correio organizado por **tópicos**, não por mensagens. Quando abres a caixa, cada conversa aparece como um cartão:

- **um título** escrito pela IA que diz do que se trata e o que está em jogo
- **um resumo curto** do estado da conversa e do que falta fazer
- **o contexto**: quantas mensagens tem a conversa, quantos e-mails já trocaste antes com essa pessoa e desde quando, e se está à espera de resposta tua

Em cada cartão podes:

- **Ler e responder**: o cartão abre com a última mensagem e uma resposta sugerida. Podes alternar entre sugestões, pedir outra ("aceito, mas só em fevereiro") ou **Limpar** e escrever do zero.
- **Conversa completa**: o modo focado mostra a conversa inteira em leitura limpa, com a resposta no fim.
- **Arrumar** (`e`): o tópico sai da vista e fica lido; volta sozinho se chegar uma mensagem nova nessa conversa. Os arrumados ficam numa lista própria, de onde se podem repor.
- **Mudar de vista** (`v`, ou o seletor no topo): passas para a vista clássica com lista e leitor. As pastas, os rascunhos e os workflows continuam lá.

**Funil de prospeção**: frentes contínuas (por omissão *Bitnik · publishers* e *monco · escolas e colégios*), cada uma com meta semanal de contactos novos, follow-up automático no prazo e fecho como "sem resposta" quando o follow-up também fica sem resposta.

- Cada contacto tem estado (por contactar → contactado → follow-up → respondeu → em conversa → concluído/recusou/sem resposta), próxima ação com data e histórico.
- *Preparar os pitches da semana* escreve um e-mail por contacto a partir do briefing da frente e das notas da pessoa; *Preparar follow-ups* responde no mesmo fio do pitch original. Tudo fica como rascunho para reveres e enviares.
- O mailroom lê as caixas e deteta sozinho respostas (também de outra pessoa da mesma organização) e envios feitos fora da app.
- **Precisa de ti** junta as respostas por tratar e as próximas ações do dia; os cartões dos tópicos mostram o estado no funil, e qualquer pessoa de um tópico pode entrar no funil com *＋ Funil*.
- Anexos (por ex. o press kit) nos rascunhos e no compositor.

**Pesquisa rápida**: seleciona uma palavra ou expressão num e-mail, carrega no botão direito e escolhe *Pesquisar e resumir com IA*. O mailroom procura em todas as caixas e resume o que sabe sobre isso: factos, pessoas e e-mails relacionados. Se o modelo acrescentar contexto geral, aparece separado do que vem dos teus e-mails.

Também tem **triagem**, **pitch** (e-mails personalizados em lote), **publicação** (um briefing → versões para e-mail, newsletter, blog e redes) e um **agente** que pesquisa as caixas e prepara rascunhos.

**Nada é enviado sem ti.** A IA só cria rascunhos. Enviar pede sempre dois cliques, e o envio em lote só manda rascunhos marcados como revistos.

## Instalar (Windows)

Descarrega o `mailroom-setup-X.Y.Z.exe` da [última versão](https://github.com/dferreiramarques/mailroom/releases/latest) e corre-o. Instala só para o teu utilizador, sem pedir permissões de administrador.

- A app abre na sua própria janela e fica na bandeja do sistema: fechar a janela não a encerra, para continuar a avisar de correio novo. Para sair, usa *Sair* no menu da bandeja, onde também podes ligar *Abrir ao iniciar o computador*.
- Em **Definições** adicionas as contas de correio e o fornecedor de IA. Sem contas, mostra uma caixa de demonstração.
- Contas, rascunhos e definições ficam em `%APPDATA%\mailroom`, só no teu computador.
- **Atualizações**: a app consulta as Releases deste repositório. Havendo versão nova, aparece *Atualizar para vX* na barra lateral; um clique descarrega, instala e reinicia.
- O instalador não é assinado: o SmartScreen pode avisar na primeira vez (*Mais informações → Executar mesmo assim*).

Por dentro, a app de desktop corre o mesmo servidor numa porta local aleatória, acessível só à própria janela (cada arranque gera um token).

**Publicar uma versão:** muda a `version` no `package.json`, faz commit e push; depois, em *Actions → release → Run workflow* (ou publicando uma tag `vX.Y.Z`), o GitHub gera o instalador e cria a Release.

Para desenvolvimento: `npm run app` abre a app de desktop a partir do código.

## Experimentar já

```bash
npm install
npm run demo        # http://localhost:4321 — caixa fictícia, IA simulada
```

## Ligar às tuas caixas

1. `npm start`
2. Em **Definições → Contas**, adiciona as tuas caixas (ou copia `accounts.example.json` para `accounts.json` e preenche à mão).
3. Em **Definições → Inteligência artificial**, escolhe o fornecedor, o modelo e a chave, e carrega em *Testar ligação*.

### Fornecedores de IA

| Fornecedor | Notas |
|---|---|
| Anthropic (Claude) | só a chave; modelo por omissão `claude-sonnet-5-5` |
| Groq | chave grátis em console.groq.com, sem cartão; copia o nome do modelo da consola |
| OpenAI | chave + modelo |
| OpenRouter | chave + modelo; dá acesso a muitos modelos com uma só chave |
| Google Gemini | usa o endpoint compatível com OpenAI; chave do Google AI Studio |
| Ollama / LM Studio | local, sem chave; nada sai do teu computador |
| Outro compatível com OpenAI | URL + chave + modelo (Mistral, Groq, Azure…) |

A chave fica guardada no servidor (`data/settings.json`) e nunca volta para o browser. Também a podes definir no `.env` (ver `.env.example`).

### Gmail com domínio próprio (ex.: monco.io reencaminhado)

A conta lê o Gmail por IMAP e filtra pelo destinatário (`"filterTo": "monco.io"`). Precisas de:

- IMAP ativo no Gmail
- uma *palavra-passe de app* do Google, usada em `imap.pass` e `smtp.pass`
- o domínio configurado no Gmail em **Enviar e-mail como**, para enviares como esse endereço

Com o Gmail, usa `appendSent: false`. Noutros fornecedores (cPanel, Zoho, Migadu…) usa os dados IMAP/SMTP deles e `appendSent: true`.

## Caixa de saída

Os envios em lote (revisão do funil, rascunhos revistos) vão para a **caixa de saída** e saem pelo servidor do mailroom, em segundo plano:

- A fila fica em `data/outbox.json`. Mudar de ecrã ou fechar a app não perde nada: ao reabrir, continua de onde parou. Sair com envios pendentes pede confirmação, e a atualização automática espera que a fila esvazie.
- O rascunho só desaparece quando o envio é confirmado. Se falhar (servidor em baixo, destinatário recusado), fica com o motivo e pode tentar-se de novo; falhas de rede tentam outra vez sozinhas (1, 5 e 15 min).
- Cada envio leva um Message-ID escolhido antes de sair. Se a app parar a meio de um envio, procura-o nos Enviados antes de repetir, para não mandar o mesmo e-mail duas vezes.
- Os pitches do funil saem pela ordem da revisão, espaçados 20 a 60 s ao acaso (configurável na caixa de saída). Respostas e mensagens novas saem logo.

Avisos de devolução (Mailer-Daemon) depois de um pitch ou follow-up passam o contacto para «Devolvido», com o motivo, e o assistente não sugere respostas a remetentes automáticos.

## Calendário e projetos

Em **Agenda → Calendário**: vistas de dia, 3 dias, semana (com fim de semana) e mês, e por baixo uma linha do tempo de projetos com milestones (◆) e deadlines (⚑).

Fontes (ligam-se em **Definições → Calendários**):

- **mailroom**: eventos e projetos guardados só neste computador (`data/events.json`, `data/projects.json`).
- **CalDAV** (ex.: Spacemail, `https://caldav.spacemail.com/`): usa a palavra-passe da conta de correio.
- **Google Calendar**: pela API, com uma autorização OAuth própria (o Google já não aceita palavras-passe em CalDAV). Cria um cliente OAuth do tipo *App para computador* na Google Cloud, ativa a Calendar API e publica o ecrã de consentimento (em teste, a ligação expira ao fim de 7 dias). O regresso da autorização é em `/oauth/google`.
- **Funil**: pitches enviados, respostas e follow-ups, só de leitura.

Os eventos podem ser criados e editados em qualquer calendário com escrita, e a partir de um e-mail («Criar evento»). Um evento marcado como milestone ou deadline, e ligado a um projeto, aparece na linha do tempo. Noutros calendários, o tipo fica em `CATEGORIES` (CalDAV) ou nas propriedades privadas do evento (Google). Numa série recorrente do CalDAV, as horas mudam-se no calendário de origem.

Atalhos no calendário: `t` hoje, `n` novo evento, `←` `→` período anterior ou seguinte, `Esc` fecha o editor.

## Privacidade

- Por omissão a app escuta só em `127.0.0.1`. Alojada na internet, só arranca com `APP_PASSWORD` definida.
- Os e-mails não ficam guardados: a cache é de 60 s, em memória, e os resumos dos tópicos também ficam só em memória.
- No disco ficam os rascunhos, as definições, o funil e o calendário local (`data/*.json`); com o Google ligado, também a autorização (em `data/calendar.json`).
- O texto que a IA resume é enviado ao fornecedor que escolheste. Com o Ollama, fica tudo no teu computador.
- O HTML dos e-mails abre numa iframe sandbox, sem scripts e sem imagens remotas.

## Alojar no Railway

O mesmo repositório corre no teu computador e no Railway, sem alterações.

1. No Railway: **New Project → Deploy from GitHub repo** e escolhe este repositório. O Railway deteta o Node e corre `npm start`.
2. Em **Variables**, define:

   | variável | valor |
   |---|---|
   | `APP_PASSWORD` | obrigatória; o browser pede-a ao abrir (o utilizador pode ser qualquer um) |
   | `ACCOUNTS_JSON` | o conteúdo do teu `accounts.json`, numa linha (`node -e "console.log(JSON.stringify(require('./accounts.json')))"`) |
   | `ANTHROPIC_API_KEY` | ou `AI_PROVIDER=openai` + `AI_API_KEY` + `AI_BASE_URL` + `AI_MODEL` |
   | `DATA_DIR` | `/data` |

3. Em **Settings → Volumes**, cria um Volume montado em `/data`. Sem ele, os rascunhos e as definições guardadas na app perdem-se a cada deploy.
4. Em **Settings → Networking**, gera um domínio. Opcionalmente, define o *healthcheck path* como `/healthz`.

Cada `git push` faz um novo deploy. Mantém o repositório **privado**: não tem segredos lá dentro, mas é a ferramenta do teu correio.

Se a app estiver alojada (Railway, Render ou Fly) e faltar `APP_PASSWORD`, recusa arrancar, para nunca ficar aberta por engano.

## Atalhos

`v` mudar de vista · `e` arrumar tópico · `/` pesquisar · `c` nova mensagem · `Esc` fechar
Vista clássica: `j`/`k` navegar · `r` responder · `s` resumir · `g` sugerir respostas

## Integrar noutras plataformas

O mailroom é um produto independente. O núcleo (`core/`, pacote `@mailroom/core`) é um router Express mais o web component `<mail-room>`, por isso entra noutra app com duas linhas. Ver `core/README.md` e o exemplo de um Studio em `examples/bitnik-platform.js`:

```bash
node examples/bitnik-platform.js   # http://127.0.0.1:4400/studio
```

## Estrutura

```
electron/main.js             app de desktop: janela, bandeja, avisos, atualizações
server.js                    servidor (sozinho com `npm start`, ou dentro da app de desktop)
public/index.html            página que só embebe <mail-room>
core/index.js                createMailModule(): API, tópicos, rascunhos, IA, agente
core/lib/threads.js          agrupamento em tópicos (Message-ID, assunto, pessoa) e histórico
core/lib/providers.js        fornecedores de IA: Anthropic e compatíveis com OpenAI
core/lib/ai.js               prompts, workflows e ciclo do agente
core/lib/mail.js             IMAP (imapflow) e SMTP (nodemailer)
core/lib/stores.js           armazenamento: memória ou ficheiros
core/lib/demo.js             caixa fictícia
core/client/                 web component <mail-room> (JS + CSS, sem dependências)
examples/bitnik-platform.js  exemplo de integração
```
