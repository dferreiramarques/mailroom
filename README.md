# mailroom

Correio organizado por **tópicos**, não por mensagens. Quando abres a caixa, cada conversa aparece como um cartão:

- **um título** escrito pela IA que diz do que se trata e o que está em jogo
- **um resumo curto** do estado da conversa e do que falta fazer
- **o contexto**: quantas mensagens tem a conversa, quantos e-mails já trocaste antes com essa pessoa e desde quando, e se está à espera de resposta tua

Em cada cartão podes:

- **Ler e responder**: o cartão abre com a última mensagem e uma resposta sugerida. Podes alternar entre sugestões, pedir outra ("aceito, mas só em fevereiro") ou **Limpar** e escrever do zero.
- **Conversa completa**: o modo focado mostra a conversa inteira em leitura limpa, com a resposta no fim.
- **Mudar de vista** (`v`, ou o seletor no topo): passas para a vista clássica com lista e leitor. As pastas, os rascunhos e os workflows continuam lá.

**Pesquisa rápida**: seleciona uma palavra ou expressão num e-mail, carrega no botão direito e escolhe *Pesquisar e resumir com IA*. O mailroom procura em todas as caixas e resume o que sabe sobre isso: factos, pessoas e e-mails relacionados. Se o modelo acrescentar contexto geral, aparece separado do que vem dos teus e-mails.

Também tem **triagem**, **pitch** (e-mails personalizados em lote), **publicação** (um briefing → versões para e-mail, newsletter, blog e redes) e um **agente** que pesquisa as caixas e prepara rascunhos.

**Nada é enviado sem ti.** A IA só cria rascunhos. Enviar pede sempre dois cliques, e o envio em lote só manda rascunhos marcados como revistos.

## Instalar (executável)

Descarrega o executável da [última versão](https://github.com/dferreiramarques/mailroom/releases/latest) e abre-o. Não precisa de Node nem de instalação.

- Abre o browser em `http://localhost:4321`. Deixa a janela preta aberta enquanto usas a app; fecha-a para sair.
- Em **Definições** adicionas as contas de correio e o fornecedor de IA. Sem contas, mostra uma caixa de demonstração.
- Contas, rascunhos e definições ficam em `%APPDATA%\mailroom` (Windows) ou `~/.config/mailroom` (Linux), só no teu computador.
- **Atualizações**: ao abrir, a app consulta as Releases deste repositório. Se houver versão nova, aparece *Atualizar para vX* na barra lateral; um clique descarrega e substitui o executável, e basta reabrir.
- O executável não é assinado: no Windows, o SmartScreen pode avisar na primeira vez (*Mais informações → Executar mesmo assim*).

Para gerar os executáveis: `npm run build` (Windows) ou `npm run build:all`. Para publicar uma versão: muda a `version` no `package.json`, faz commit e `git tag vX.Y.Z && git push --tags`; o GitHub Actions cria a Release.

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

## Privacidade

- Por omissão a app escuta só em `127.0.0.1`. Alojada na internet, só arranca com `APP_PASSWORD` definida.
- Os e-mails não ficam guardados: a cache é de 60 s, em memória, e os resumos dos tópicos também ficam só em memória.
- No disco ficam apenas `data/drafts.json` e `data/settings.json`.
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

`v` mudar de vista · `/` pesquisar · `c` nova mensagem · `Esc` fechar
Vista clássica: `j`/`k` navegar · `r` responder · `s` resumir · `g` sugerir respostas

## Integrar noutras plataformas

O mailroom é um produto independente. O núcleo (`core/`, pacote `@mailroom/core`) é um router Express mais o web component `<mail-room>`, por isso entra noutra app com duas linhas. Ver `core/README.md` e o exemplo de um Studio em `examples/bitnik-platform.js`:

```bash
node examples/bitnik-platform.js   # http://127.0.0.1:4400/studio
```

## Estrutura

```
server.js                    app autónoma (usa o core)
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
