# Spike — origem local para YouTube e Twitch na Mesa (fase 0)

Data: 2026-09-24
Pedido: `docs/superpowers/plans/2026-09-24-sala-em-dois-tipos-passagem.md`
("Próximo passo", item 3) e spec `2026-09-24-sala-em-dois-modos-design.md`,
seção 4.5.
Roteiro manual: `docs/testes/2026-09-24-roteiro-youtube-na-mesa.md`.

## Resumo

- A janela principal e a Espiar passam a abrir por **`http://localhost`**,
  servido pelo próprio processo com `protocol.handle('http')`, **sem abrir
  porta nenhuma** (`src/main/origem.js`). Splash e rabisco não mudam.
- Para o iframe do YouTube/Twitch, essa página é indistinguível de um site
  em localhost: manda `Referer`, `document.referrer`, `ancestorOrigins` e
  origem de `postMessage` = `http://localhost`. Com `file://` não vai nada
  disso.
- O `localStorage` (a chave `golive`: nome, tema, configurações, `clientId`)
  é copiado **uma vez** do `file://` para a origem nova, antes de a janela
  carregar. Testado de ponta a ponta no app real, inclusive empacotado em
  asar.
- Reserva: `GOLIVE_ORIGEM=file` abre como antes (e copia os dados de volta).
- **Não deu para medir o YouTube e a Twitch de verdade aqui**: o proxy do
  container recusa `www.youtube-nocookie.com` e `player.twitch.tv` (403 de
  política). Falta rodar `tools/spike-youtube` no PC do dono (5 minutos,
  roteiro seção 2).

## 1. O que foi medido

Ambiente: container Linux, Electron **44.4.3** (Chromium 152) sob Xvfb.
O Electron roda aqui headless (`xvfb-run`); o Chromium do Playwright não fez
falta.

`curl https://www.youtube-nocookie.com/embed/...` → `CONNECT tunnel failed,
response 403` (idem `player.twitch.tv`, `developers.google.com`). Então a
medição foi do **lado do Electron**: um servidor HTTPS falso no lugar do
YouTube e da Twitch (`--host-resolver-rules=MAP www.youtube-nocookie.com
127.0.0.1:<porta>`, certificado próprio) registrando o que chega em cada
pedido e o que a página do embed enxerga, e respondendo ao protocolo de
`postMessage` do widget (`listening` → `onReady`; `command/playVideo` →
`infoDelivery`). A página de teste tinha a CSP do `index.html` mais
`frame-src https://www.youtube-nocookie.com https://player.twitch.tv`.

| Página servida por | `Referer` no pedido do embed | `document.referrer` no embed | `ancestorOrigins` | `origin=` que a página manda | `postMessage` nos dois sentidos | `parent` da Twitch |
|---|---|---|---|---|---|---|
| a) `file://` | **nenhum** | vazio | `file://` | `file://` | ida chega com origem `"null"`; volta só com `'*'` | sem host: **falha** |
| b1) servidor real `http://127.0.0.1:<p>` | `http://127.0.0.1:<p>/` | idem | idem | idem | ok | `127.0.0.1` |
| b2) servidor real `http://localhost:<p>` | `http://localhost:<p>/` | idem | idem | idem | ok | `localhost` ok |
| c1) `app://golive` (privilegiado) | **nenhum** | vazio | `app://golive` | `app://golive` | ok | `golive` |
| c2) `app://golive` + `Referer` injetado (`webRequest`) | o injetado | **vazio** | `app://golive` | `app://golive` | ok | `golive` |
| c3) `file://` + `Referer` injetado | o injetado | **vazio** | `file://` | `file://` | origem `"null"` | falha |
| **d) `http://localhost` interceptado, sem socket** | **`http://localhost/`** | **idem** | **`http://localhost`** | **idem** | **ok** | **`localhost` ok** |

Nas sete: `isSecureContext` verdadeiro, `AudioWorkletNode` e
`getDisplayMedia` presentes, WebSocket `ws://127.0.0.1` abre, um iframe fora
da lista (`https://www.youtube.com/embed/...`) é barrado pela CSP
(`ERR_BLOCKED_BY_CSP`), e o iframe não enxerga o `window` da página.

Achados:

1. **`file://` não tem saída**: não manda `Referer`, e a origem opaca
   (`"null"`) quebra a volta do `postMessage` e o `parent` da Twitch.
2. **Injetar `Referer` por `session.webRequest.onBeforeSendHeaders`
   funciona no Electron 44** (relatos antigos — electron#33092, Electron 17 —
   diziam que o cabeçalho era ignorado). Mas só o cabeçalho muda: dentro do
   embed `document.referrer` fica vazio e `ancestorOrigins` mostra
   `app://golive`. Se o player do YouTube conferir isso no JavaScript, o 153
   continua. O caso Tauri (tauri#14422) é exatamente esse: origem
   `tauri://localhost` dá 153; servir por `http://localhost` resolve.
3. **Interceptar `http://localhost` com `protocol.handle` dá o mesmo
   resultado de um servidor HTTP de verdade** em todos os sinais, sem porta
   aberta. Pedidos `http` para qualquer outro host seguem para a rede
   (`net.fetch(..., { bypassCustomProtocolHandlers: true })`, conferido com
   um servidor em `127.0.0.1`).
4. No app real (lab, `npm run lab -- sala-basica`, 4 instâncias): sala,
   transmissão, relay da árvore e sinalização `ws://` funcionam iguais na
   origem nova.

O que **não** foi medido: a resposta do YouTube real (tocar × erro 153), a
Twitch real, e Windows. Ver seção 5.

## 2. A saída escolhida e por quê

**`http://localhost` sem porta, interceptado por `protocol.handle('http')`
na sessão padrão.** Comparação:

| Critério | (a) servidor HTTP em `127.0.0.1:<porta>` | (b) `app://golive` + `Referer` injetado | **(d) `http://localhost` interceptado** |
|---|---|---|---|
| YouTube vê um site normal | sim | só o cabeçalho; `document.referrer`/`ancestorOrigins` não | **sim** |
| Twitch `parent` | `localhost` (forum: aceito) ou IP | `golive` (host inventado, não documentado) | **`localhost`** |
| Origem estável (`localStorage`) | porta aleatória muda a origem a cada abertura; porta fixa pode estar ocupada, e aí não há como ler a origem antiga | sim | **sim, para sempre** |
| Superfície | porta aberta: qualquer processo local e DNS rebinding alcançam | nenhuma | **nenhuma** |
| asar | lê por `fs` | lê por `fs` | **lê por `fs` (conferido)** |
| Custo | servidor, portas, `Host` | esquema privilegiado + filtro de cabeçalho | **um handler** |

(b) seria a aposta se (d) não existisse; ela depende de o YouTube aceitar
só o cabeçalho, o que ninguém mostrou funcionando. (a) tem o problema da
origem: com porta fixa ocupada por outro programa, a origem muda e o
`localStorage` da anterior só é legível carregando uma página nela — que
seria a do outro programa.

### Como está implementado (`src/main/origem.js`)

- `instalarOrigemLocal`: `protocol.handle('http')` na sessão padrão.
  Pedido para `http://localhost` (sem porta) → arquivo de `src/renderer`;
  qualquer outro → rede, como antes. Fica ligado também no modo `file`
  (a migração de volta precisa ler a origem local).
- `resolverCaminho` + `dentroDaRaiz`: só `GET`/`HEAD`; recusa `..` (também
  `%2e%2e`), `%2f`, `%5c`, barra invertida, `%00`, `:` (letra de unidade),
  segmento vazio ou oculto, `*.test.js`, extensão fora de
  `.html .js .css .woff2 .png .svg .ico`, HTML fora de
  `index.html`/`espiar.html`/`vazia.html`, pasta, e symlink que sai da raiz
  (`realpath`). Tudo o mais é 404.
- Cabeçalhos: `Content-Type` certo, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store` (a origem não muda mais entre versões; sem isso
  um arquivo velho poderia sobreviver à atualização),
  `Referrer-Policy: strict-origin-when-cross-origin` (o padrão, explícito).
  No HTML, `Content-Security-Policy: frame-ancestors 'none'` e
  `X-Frame-Options: DENY` (só restringem; a CSP do `<meta>` continua inteira).
- CSP do `index.html`: a mesma, mais só
  `frame-src https://www.youtube-nocookie.com https://player.twitch.tv`.
  Nada de `script-src` novo: nenhum script do YouTube na página.
- `navigation.js`: sem mudança de regra — ele já compara a URL inteira, que
  inclui esquema, host e porta. Testes novos cobrem a origem nova
  (`http://localhost:8080/...`, `http://127.0.0.1/...`, `?` de formulário,
  o player tentando tomar a janela).
- `main.js`: `mainUrl` e `spyUrl` vêm de `urlDaPagina`; `createWindow`
  espera a migração antes do `loadURL`. A Espiar abre por
  `window.open('espiar.html')` relativo, então segue a origem sozinha.

### Migração do `localStorage`

- Chaves que o app guarda hoje: só `golive` (`app.js`, via `config.js`).
  A migração copia **todas** as chaves, para não depender disso.
- `userData/origem.json` guarda a última origem usada. Sem o arquivo
  (versão anterior) a origem anterior é `file://`. Se a origem do modo
  atual é outra, uma janela escondida (sem preload, sandbox) abre
  `vazia.html` na origem anterior, lê tudo, abre na atual, substitui tudo e
  **confere** o que ficou; depois `flushStorageData()` e grava o registro.
- Roda durante a splash (a checagem de atualização leva mais que isso);
  `createWindow` espera por ela. Prazo de 8 s.
- Falha (prazo, erro, conferência): o app abre mesmo assim, o registro não
  avança e a cópia é tentada de novo na próxima abertura. A origem antiga
  nunca é apagada.
- Origem anterior vazia (instalação nova) não apaga o destino.
- Testado: `node --test` com um `BrowserWindow` falso que roda os scripts de
  verdade, e de ponta a ponta no app real (Xvfb + driver do lab): `file`
  com tema Papel e nome → padrão (migra, tema e nome aparecem, `clientId`
  igual, Espiar abre em `http://localhost/espiar.html`) → padrão de novo
  (não migra, muda o tema) → `GOLIVE_ORIGEM=file` (volta com o tema novo)
  → padrão (volta de novo). O mesmo rodando de um `app.asar` gerado pelo
  `electron-builder --linux dir`, e o binário empacotado abrindo
  `http://localhost/index.html` depois da splash.

## 3. Para o time da Mesa (fase 3)

- Iframe: `https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&origin=http%3A%2F%2Flocalhost`
  (use `location.origin`). Comando: `postMessage(JSON.stringify({event:'command', func, args, id, channel:'widget'}), 'https://www.youtube-nocookie.com')`.
  Escuta: `event.origin === 'https://www.youtube-nocookie.com'`; repetir
  `{"event":"listening"}` até o `onReady`, como a IFrame API faz.
- Twitch: `https://player.twitch.tv/?channel=<c>&parent=localhost`.
- `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"` no
  iframe e **nada de `camera`/`microphone`/`display-capture`**: o app não
  tem `setPermissionRequestHandler`, e o padrão do Electron concede tudo que
  a Permissions Policy deixar passar. Vale considerar um handler que só
  concede à origem do app quando a Mesa entrar.
- Clicar no logo do YouTube tenta abrir janela nova: o
  `setWindowOpenHandler` da principal recusa tudo que não é a Espiar. Se a
  Mesa quiser abrir no navegador, é ali (`shell.openExternal` com lista de
  hosts), não no renderer.
- A CSP só libera esses dois hosts. Kick ou outro player = nova linha no
  `frame-src` e no teste de CSP de `src/main/origem.test.js`.

## 4. Riscos que sobram

| Risco | Tamanho | Resposta |
|---|---|---|
| O YouTube real recusar `http://localhost` como embedder | baixo: é o que o caso Tauri e quem desenvolve em localhost usam | Rodar `tools/spike-youtube` no PC (roteiro, seção 2). Se falhar, a próxima tentativa é somar o `Referer` injetado (achado 2) |
| Twitch não aceitar `parent=localhost` fora de desenvolvimento | baixo/médio | Mesmo spike. Se falhar, não há domínio para oferecer sem servidor público |
| Algum programa/antivírus do Windows interferir | muito baixo: nada é aberto na rede | — |
| Algo do app que dependa de `file://` e o lab não cobre (ex.: colar arquivo no chat, overlay pedindo arquivo da janela principal) | baixo | Roteiro, seção 3 |
| Voltar para uma versão antiga do app | aceito | Ela abre por `file://` com os dados de antes da atualização (não apagados). Voltando à nova, o registro já diz `http://localhost` e não copia de novo: o que mudou na versão antiga fica lá |
| Migração falhar no PC do dono | baixo | Abre com config padrão naquela vez, log `origem: migracao ... falhou`, tenta de novo na próxima; `GOLIVE_ORIGEM=file` como reserva |

## 5. O que falta provar no PC real

1. `npx electron tools/spike-youtube/main.js`: A (`file://`) dá 153 e
   B (`http://localhost`) toca; Twitch com `parent=localhost` toca.
2. Atualizar da 0.21 para a versão com esta mudança e ver nome, tema e
   configurações preservados (roteiro, seção 1).
3. A lista da seção 3 do roteiro com 2 PCs (Windows, WGC, NVENC — o que o
   lab não cobre).
