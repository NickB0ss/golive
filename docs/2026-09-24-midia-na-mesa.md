# Mídia na Mesa — YouTube junto, Rádio da sala e Ao vivo (time Mídia)

Data: 2026-09-24
Spec: `docs/superpowers/specs/2026-09-24-sala-em-dois-modos-design.md`, seções
4.5 e 5. Contrato: `docs/superpowers/plans/2026-09-24-mesa-contrato.md`,
seções 1 e 6. Pesquisa: `docs/2026-09-24-pesquisa-janelas-da-mesa.md`, 1.3,
2 e 7. Origem local: `docs/2026-09-24-spike-origem-local.md`.
Roteiro no PC real: `docs/testes/2026-09-24-roteiro-youtube-na-mesa.md`,
seção 5.

## Resumo

- Três tipos de janela no grupo **assistir**, no começo do menu:
  `youtube` ("Vídeo do YouTube"), `radio` ("Rádio da sala"), `aovivo`
  ("Ao vivo (Twitch)"). Kick ficou de fora (seção 6).
- **Nenhum script do YouTube ou da Twitch na página.** O player é um
  `<iframe>` de `youtube-nocookie.com` comandado por `postMessage`
  (`src/renderer/ytplayer.js`), com as mensagens conferidas por origem **e**
  por `event.source`.
- Sincronia pelo relógio da sala: a sala guarda `{ videoId, playing, pos, at }`
  com `at` na hora do servidor (posta pelo `prepare`); cada PC calcula o alvo
  com `positionAt(estado, serverNow())` e corrige o próprio player
  (`src/renderer/mesa-sync-media.js`).
- Um só vídeo com imagem tocando por PC (`GoLive.mesaMidia`); o segundo
  entra em espera com a capa e **"Tocar este"**.
- Medido de ponta a ponta com o servidor de sinalização real, dois "PCs" em
  Electron 44 headless e um **YouTube/Twitch falsos** (`tools/midia/`):
  23 verificações, 3 rodadas seguidas limpas. O que falta provar é só o
  que depende do YouTube de verdade (seção 5).

## 1. Arquivos

| Arquivo | O quê |
|---|---|
| `src/renderer/mesa-modules/midialinks.js` | Apoio (fora dos tipos, em `HELPER_NAMES`): lê links do YouTube e da Twitch sem rede, `positionAt`, `formatPos` |
| `src/renderer/mesa-modules/youtube.js` | Módulo puro do vídeo |
| `src/renderer/mesa-modules/radio.js` | Módulo puro do rádio |
| `src/renderer/mesa-modules/aovivo.js` | Módulo puro do ao vivo |
| `src/renderer/ytplayer.js` | Player por `postMessage` (`GoLive.ytplayer`) |
| `src/renderer/mesa-sync-media.js` | Deriva pura + `createSync` (`GoLive.mesaSyncMedia`) |
| `src/renderer/mesa-midia.js` | Coordenador "um vídeo por PC" (`GoLive.mesaMidia`) |
| `src/renderer/mesa-janelas/{youtube,radio,aovivo}.js` | Conteúdos (`mount(el, api)`) |
| `src/renderer/mesa-janelas.css` | Seção "Midia" (prefixo `.mjm-`) |
| `src/main/linksexternos.js` | Quais janelas novas dos players vão para o navegador |
| `tools/midia/` | Bancada: YouTube/Twitch falsos + 2 PCs + servidor real |

**Carregamento no renderer.** A Vista carrega `mesa-janelas/<tipo>.js` e
`mesa-janelas.css` sozinha. `ytplayer.js`, `mesa-sync-media.js` e
`mesa-midia.js` **não têm tag**: o primeiro conteúdo de mídia que monta
injeta cada um uma vez (promessa em `GoLive.mesaMidiaCarga`) e mostra
"Carregando…" enquanto isso. Quem nunca abre um vídeo não paga por eles.
Os **módulos puros** precisam de tag no `index.html` (o registro do
renderer só conhece o que chegou por `<script>`), depois de
`mesa-modules/cadeiras.js` e antes de `mesa-modules/index.js`:

```html
<script src="mesa-modules/midialinks.js"></script>
<script src="mesa-modules/youtube.js"></script>
<script src="mesa-modules/radio.js"></script>
<script src="mesa-modules/aovivo.js"></script>
```

(`midialinks.js` antes dos três; a ordem do menu vem de `MODULE_NAMES`.)

## 2. Os módulos

### `youtube` — 640×360, aspect 16/9, 256 bytes

Estado `{ videoId, playing, pos, at, rate: 1 }`.

| Ação | Efeito |
|---|---|
| `load { url \| videoId }` | Põe o vídeo **tocando** do `t=`/`start=` do link |
| `play { pos? }` | Volta a tocar (de `pos` ou de onde parou) |
| `pause { pos? }` | Pausa em `pos` (a do player de quem clicou, se estiver a menos de 2 s do alvo) ou na do relógio |
| `seek { pos }` | Pula; tocando continua tocando |
| `ended { videoId?, pos? }` | Acabou; idempotente, ignora o fim de outro vídeo |

Links aceitos: `youtube.com/watch?v=`, `m.`, `music.youtube.com`,
`youtu.be/`, `shorts/`, `embed/`, `live/`, `youtube-nocookie.com/embed/`, id
cru de 11 caracteres; `t=90`, `t=1m30s`, `start=`, `#t=`. O `prepare` só
carimba `at = ctx.now` (a hora do cliente é descartada); o `reduce` sem `at`
não mexe em nada.

### `radio` — 360×480 livre, 16 KB

Estado `{ current, queue (≤ 50), playing, pos, at, rate, votes, failed (≤ 3), seq }`,
itens `{ id: 'r<n>', videoId, title, by, name, start? }`.

| Ação | Quem | Efeito |
|---|---|---|
| `add { url }` | todos | Na fila; sem nada tocando, já toca. `name` vem da sala (`prepare`), não do cliente |
| `remove { id }` | quem pôs ou líder | Tirar a atual avança |
| `move { id, to }` | todos | Reordena a fila |
| `play` / `pause { pos? }` | todos | Como no vídeo |
| `skip` | quem pôs a atual ou líder | Avança |
| `vote-skip` | todos (1 voto) | O `prepare` põe `need` = maioria de `ctx.peers` e `keep` = votos de quem ainda está na sala; bateu, avança |
| `failed { videoId, id? }` | cada PC | O player recusou (101/150/100/2): avança e marca em `failed` |
| `ended { videoId, id? }` | cada PC | Só avança se for a atual (por `id`: a mesma música duas vezes seguidas não é pulada) |
| `title { id, title }` | cada PC | O player contou o título; só preenche vazio (**acréscimo** ao pedido) |

`validate` roda no estado atual com `ctx = { from, isLeader }` para desligar
botões; `reduce` só lê `{ from, isLeader }` e o que veio na ação.

### `aovivo` — 640×360, aspect 16/9, 128 bytes

`{ channel }` (`^[A-Za-z0-9_]{3,25}$`, guardado em minúsculas);
`set { url | channel }` aceita `twitch.tv/<canal>`, `m.`, `@canal` e
`player.twitch.tv/?channel=`; `clear` volta ao campo. Sem `prepare`, sem
relógio. `playerUrl(canal, parent)` monta o endereço com `parent=localhost`.

## 3. Player, deriva e coordenador

### `ytplayer.js`

- Iframe: `https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&origin=http%3A%2F%2Flocalhost&playsinline=1&controls=0&rel=0[&start=N]`.
- Atributos **medidos com o falso** (seção 4):
  `sandbox="allow-scripts allow-same-origin allow-popups"`,
  `allow="autoplay; encrypted-media"`,
  `referrerpolicy="strict-origin-when-cross-origin"`, `tabindex=-1` (os
  controles são os do app). Sem câmera, microfone, captura, tela cheia.
- Protocolo: repete `{"event":"listening","id":1,"channel":"widget"}` a cada
  250 ms (e no `load` do iframe) até `initialDelivery`/`onReady`; então manda
  `addEventListener` para `onStateChange`, `onError` e
  `onPlaybackRateChange` (como a IFrame API faz; sem isso o player real não
  manda esses eventos). Comandos: `playVideo`, `pauseVideo`,
  `seekTo [s, true]`, `setPlaybackRate [r]`, `mute`, `unMute`,
  `setVolume [0..100]`, `loadVideoById [id, s]`.
- Posição: a do último `infoDelivery`, extrapolada pela velocidade enquanto
  toca (no máximo 2 s sem notícia).
- Erros: 101/150 "O dono deste vídeo não deixa tocar fora do YouTube.";
  100 "removido ou privado"; 152/153 "O YouTube recusou o player deste app";
  sem `onReady` em 15 s: "Sem internet: o YouTube não carregou neste PC."
  (com botão "Tentar de novo" e nova tentativa no evento `online`).

### Deriva (`mesa-sync-media.js`)

A cada 250 ms: erro = alvo − posição.

- `|erro| < 0,3 s`: nada.
- `0,3–1,5 s`: `setPlaybackRate(1,05)` atrás, `0,95` adiantado. **Histerese**:
  só volta a 1 quando o erro cruza o zero ou cai abaixo de 0,05 s.
- `> 1,5 s`: `seekTo(alvo)`, e 1,2 s sem olhar (o player demora a reportar).
- Play/pause do estado da sala com 1 s entre repetições; carregando
  (buffering), nada.
- **Player que não aceita 1,05** (a IFrame API avisa que arredonda para uma
  velocidade da lista): 2 s depois de pedir e ele ainda em 1, a faixa do meio
  passa a saltar, só acima de 0,6 s.
- Depois de `loadVideoById` (que já toca sozinho), 1 s sem comandos; depois
  de um erro de vídeo, nada de insistir naquele item (seção 4, achado 3).

### Um vídeo por PC (`mesa-midia.js`)

Duas vagas: `image` (YouTube e Twitch) e `audio` (Rádio). O primeiro de cada
vaga fica ativo; o seguinte fica em espera **sem iframe** (só a capa de
`i.ytimg.com`, ou o nome do canal) com "Tocar este"; tomar a vez manda o
anterior para a espera; tirar o ativo promove o mais antigo em espera. O
estado da sala continua andando: quem volta entra no ponto certo.

### Conteúdos

- **Vídeo**: campo para colar quando vazio; controles do app por cima do
  vídeo (aparecem com o mouse ou o foco): tocar/pausar e barra de posição
  valem para a sala; mudo e volume são só seus (`localStorage`
  `golive-mesa-volume`); "Trocar". Recusa aparece numa nota abaixo da alça.
- **Rádio**: capa `https://i.ytimg.com/vi/<id>/hqdefault.jpg`, título, "posta
  por", tocar/pausar, **Pular** (quem pôs ou líder) ou **Votar para pular
  (n/maioria)**, fila com ↑ ↓ ×, "Pôr na fila", aviso da última recusada. O
  iframe fica dentro da janela, 160×90, invisível e sem clique (só áudio).
  Volume próprio (`golive-mesa-volume-radio`).
- **Ao vivo**: `player.twitch.tv/?channel=<c>&parent=<location.hostname>&autoplay=true&muted=false`,
  `sandbox="allow-scripts allow-same-origin allow-popups"`, `allow="autoplay"`;
  controles do próprio player; "Trocar canal".
- Tudo com respiro de 30 px no topo para a alça de 28 px da Vista (o vídeo
  fica inteiro por baixo dela).

### `main.js`: logo e título abrem no navegador

`setWindowOpenHandler` da janela principal chama
`linkParaNavegador(details)` antes da regra da Espiar: se o destino é
`https://www.youtube.com/`, `https://youtu.be/` ou `https://www.twitch.tv/`
(sem usuário, senha ou porta) **e** o `referrer` é a origem de um dos players
(`https://www.youtube-nocookie.com` ou `https://player.twitch.tv`), faz
`shell.openExternal` e nega a janela. Todo o resto continua negado.

### CSP

Só `img-src` ganhou `https://i.ytimg.com` (a capa). Sem isso a capa do
Rádio e a da espera ficam em branco. `frame-src` continua com os dois hosts
do spike; nenhum `script-src`.

## 4. O que foi medido aqui

Ambiente: container Linux, Electron **44.4.3** (Chromium 152) sob Xvfb.

```
xvfb-run -a npx electron --no-sandbox tools/midia/main.js
```

(`--no-sandbox` só porque aqui roda como root.) A bancada sobe o
`signaling-core` real numa porta aleatória, o YouTube/Twitch/i.ytimg falsos
por HTTPS próprio (`--host-resolver-rules` + `--no-proxy-server`, como o
spike), e duas janelas pela origem `http://localhost` sem porta, cada uma um
"PC": entra na sala, acerta o relógio por `time` (menor ida e volta de 5) e
monta os conteúdos reais. O embed falso fala o protocolo do widget como o
real, responde para o `origin=` da URL, dá 153 sem `Referer` e 150 no vídeo
"bloqueado"; tem ganchos para acelerar o relógio do vídeo, pular sozinho e
arredondar a velocidade. Relatório em JSON no `/tmp`.

| Medida | Resultado |
|---|---|
| Relógio pela mensagem `time` | ida e volta de 0,5–0,8 ms (mesma máquina) |
| `load` no A → os dois tocando a menos de 0,3 s do alvo | 210–430 ms |
| 5 s tocando, erro de cada PC | máx. 0,06–0,25 s (fica o atraso do "carregando" depois do salto inicial; abaixo de 0,3 s não se corrige, pela spec) |
| Pausa pelo botão do B → A pausado | ~105 ms; posições dos dois a 0,006 s uma da outra |
| Salto para 1:00 pelo B → os dois lá | ~100 ms |
| Vídeo do B 3% mais rápido, 25 s | erro máx. 0,30 s, mediana 0,15 s; 2 trocas de velocidade (0,95 → 1), **0 saltos**; A intocado (0,006 s) |
| B 1 s atrasado | 1,05 até cruzar (~19 s), volta a 1; 0 saltos; erro final 0,04 s |
| B 4 s atrasado | visto em ~150–210 ms, corrigido em ~280–400 ms com **1** `seekTo` |
| Player que arredonda 1,05 para 1 | `setPlaybackRate(1.05)`, `setPlaybackRate(1)`, `seekTo` → erro final 0,002 s |
| Segundo YouTube no mesmo PC | espera, capa, **sem iframe**; "Tocar este" troca; tirar o ativo devolve a vez ao outro já no ponto da sala; 1 iframe do YouTube por PC |
| Rádio: música de 8 s → vídeo com embed bloqueado → outra de 8 s | toca a 1ª (título preenchido pelo player), pula a bloqueada e marca, toca a 3ª, para no fim; um voto de 2 não pula |
| Capa `i.ytimg.com` com a CSP do app | carrega |
| Twitch com `parent=localhost` | aceito (o falso confere `parent` contra `ancestorOrigins`) |
| Clique no logo do YouTube / Twitch | `referrer` = `https://www.youtube-nocookie.com/` / `https://player.twitch.tv/`, `disposition` `foreground-tab`; a decisão devolve a URL para o navegador |
| `Referer` do pedido do embed | `http://localhost/` |
| Player que nunca responde | "Sem internet: o YouTube não carregou neste PC." no lugar do player (15 s) |

**Sandbox** (iframes soltos com o mesmo embed):

| `sandbox` | Origem das mensagens do player | Clique no logo chega ao main |
|---|---|---|
| `allow-scripts allow-same-origin allow-popups` | `https://www.youtube-nocookie.com` | sim |
| `allow-scripts allow-popups` | `"null"` (não dá para conferir quem fala) | — |
| `allow-scripts allow-same-origin` | `https://www.youtube-nocookie.com` | **não** (o Chromium barra antes) |

Então o mínimo é `allow-scripts allow-same-origin allow-popups`.
`allow-popups-to-escape-sandbox` não faz falta: a janela nunca é criada (o
main a nega e abre o navegador).

**Achados que viraram correção** (a bancada pegou os três):

1. O campo `type="url"` barrava o envio de id cru ou de link sem `https://`
   (validação nativa do formulário): virou texto com `inputmode="url"`.
2. O `ended` atrasado do player de um PC chegava depois de a sala avançar e
   pulava a música seguinte. Cada PC agora só avisa o fim da música que ele
   carregou, se o player conta esse `videoId` e já tocou 1,5 s.
3. Um segundo erro 150 (do `play` da deriva logo depois do `loadVideoById`)
   marcava a música seguinte como recusada. A deriva agora espera 1 s depois
   de carregar e não insiste num item recusado.

## 5. O que falta provar com o YouTube e a Twitch reais

O proxy daqui recusa os domínios reais; tudo acima é contra o falso. No PC
do dono (roteiro, seção 5):

1. `GOLIVE_MIDIA_REAL=1 npx electron tools/midia/main.js` — a mesma bancada
   sem o falso: sincronia, pausa e salto com o player de verdade (as partes
   que dependem dos ganchos do falso ficam de fora).
2. O player real aceita o `sandbox` acima (se não tocar com ele, testar sem
   o atributo e anotar).
3. O player real manda `onStateChange`/`onError` depois do
   `addEventListener`, e `infoDelivery` com `currentTime` (a cada quanto?).
4. `setPlaybackRate(1.05)` pega ou é arredondado (a deriva cai para salto
   sozinha; anotar qual).
5. Quanto demora o "carregando" depois de um `seekTo` (o falso: 150 ms). Se
   for muito, calibrar `seekLead` em `mesa-sync-media.js`.
6. Vídeo com embed bloqueado dá 101/150 (não 153) e o Rádio pula.
7. Twitch toca com `parent=localhost` fora de desenvolvimento.
8. Logo do YouTube abre o navegador padrão no Windows.

## 6. Kick

Ficou de fora. O embed (`player.kick.com/<canal>`) é um iframe sem script na
página, mas não tem documentação pública nem API de `postMessage`, pediria
mais um host no `frame-src` (e na lista do `linksexternos.js`), e não deu
para medir nada dele daqui. Entra depois de um spike no PC real, como a
Twitch.

## 7. Integração

- `index.html`: as 4 tags da seção 1 (módulos puros). Nada para os
  conteúdos, o CSS ou `ytplayer.js`/`mesa-sync-media.js`/`mesa-midia.js`.
- `mesa-janelas.css`: aqui o arquivo só tem a seção "Midia"; juntar com a do
  time Janelas.
- `main.js`: o bloco do `linkParaNavegador` no `setWindowOpenHandler` da
  janela principal.
- CSP: `img-src` + `https://i.ytimg.com` (já no `index.html` e no teste de
  `origem.test.js`).
