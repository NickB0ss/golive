# Contrato da Mesa (para os times trabalharem em paralelo)

Data: 2026-09-24. Deriva de `docs/superpowers/specs/2026-09-24-sala-em-dois-modos-design.md`
(seções 4 e 8). Quando este arquivo e a spec divergirem, a spec manda no
**comportamento** e este arquivo manda nos **nomes e formatos**. Quem precisar
mudar um formato daqui avisa no relatório do time; ninguém muda sozinho.

## 0. Decisões do Nicolas (2026-09-24, depois da spec) — mandam sobre a spec

1. **Não existe troca de tipo pelo líder.** Transmissão e Mesa são **vistas**:
   cada pessoa alterna na própria tela, quando quiser, sem afetar ninguém. A
   Transmissão mostra só as telas (o app de hoje); a Mesa mostra a mesa. A
   mesa da sala sempre existe; quem está jogando continua jogando mesmo que
   outros estejam na Transmissão. Nada de `room-mode`, nada de "o líder mudou a
   sala". O seletor `Transmissão | Mesa` no topo é de cada um, para todos.
2. **Otimização é requisito**: quem está na vista Transmissão não recebe
   nada da Mesa (nem estado, nem arraste, nem ponteiro) e não monta nada dela
   no DOM. Entrar na Mesa pede o retrato (`mesa-view on` → `mesa-sync`).
3. **Duas travas do líder, independentes**: `leaderOnly` ("Só o líder mexe na
   mesa": pôr, tirar, mover e redimensionar) e `lockSize` ("Travar tamanho":
   só o líder redimensiona). Com qualquer trava, todos continuam usando as
   janelas (jogar, dar play).
4. **Jogos de 2 pessoas com cadeiras** (seção 1).
5. **Sem "seguir a vista do líder"**: cada um vê o que quiser na mesa.
6. Voltar para a Transmissão nunca pergunta nada nem mexe na mesa.

## 1. Módulo de janela (`src/renderer/mesa-modules/<tipo>.js`)

Puro, sem DOM, sem relógio, sem `Math.random`. Padrão UMD do projeto (ver
`src/renderer/laser.js`): registra em `root.GoLive.mesaModules[<tipo>]` e
exporta por `module.exports`. Carregado no renderer **e** no servidor.

```js
{
  type: 'placar',                 // id estável, minúsculo, sem acento
  title: 'Placar',                // rótulo do menu "Adicionar janela"
  group: 'assistir' | 'jogos' | 'noite' | 'ferramentas',
  size: { w, h, minW, minH, aspect },   // unidades da mesa; aspect = w/h ou null (livre)
  maxStateBytes: 4096,            // teto do JSON do estado
  init(ctx) -> state,             // ctx: { now, peers, by, random }
  prepare?(state, action, ctx) -> action,   // SÓ no servidor: põe sorte e hora na ação
  validate(state, action, ctx) -> true | 'motivo',
  reduce(state, action, ctx) -> novoState,  // puro, sem mutar o anterior
  view?(state, peerId) -> state,  // opcional, depois: informação escondida (cartas)
}
```

- `ctx = { from, isLeader, now, peers: [{ id, name }], random }`.
  `random()` e `now` só existem no servidor (`prepare`, `init`). Quem precisa de
  sorte (dados, sorteio, roleta) ou de hora (cronômetro) grava o resultado na
  ação em `prepare`; `reduce` só lê o que veio na ação. Assim todos os clientes
  chegam ao mesmo estado aplicando a mesma ação.
- `validate` roda no servidor antes de aceitar. O cliente pode chamar para
  desligar botões, mas quem decide é o servidor.
- Estado sempre serializável em JSON. `maxStateBytes` é conferido pelo
  servidor depois do `reduce`; passou do teto, a ação é recusada.
- Jogos de 2 pessoas usam **cadeiras**: `seats: [peerId|null, peerId|null]`,
  ações `{ kind: 'sit', seat }` / `{ kind: 'stand' }`; só quem está sentado
  e na vez joga; o resto assiste.
- Testes em `src/renderer/mesa-modules/<tipo>.test.js` com `node --test`.

## 2. Modelo puro (`src/renderer/mesa.js`)

Usado pelo renderer e pelo servidor. Constantes: `WORLD = { w: 4800, h: 3000 }`,
`OVERSCROLL = 600`, `GAP = 16`, `MAX_WINDOWS = 32`, `GRAB_MS = 5000`.

- `overlaps(a, b, gap)`, `nearestFree(windows, rect, { gap, ignoreId })`:
  lugar livre mais perto, dentro do mundo.
- `createState({ mesa })`, `applyMessage(state, msg)`: aplica uma
  mensagem `mesa` já aceita (com `seq`). Buraco de `seq` → devolve
  `{ needSync: true }`.
- Janela: `{ id, type, owner, x, y, w, h, state }`. Telas e câmeras são
  janelas de tipo `tela` / `camera` com `state = { peerId, kind }`, postas e
  tiradas **pelo servidor** quando alguém vai ao vivo ou para (seção 5).

## 3. Mensagens (sinalização)

| Direção | Mensagem | Guardada |
|---|---|---|
| c→s | `{ type: 'mesa-view', on: true｜false }` (a pessoa entrou/saiu da vista Mesa) | não |
| s→c | ao `on: true`: `{ type: 'mesa-sync', mesa: { seq, leaderOnly, lockSize, windows } }`; daí em diante recebe `mesa`, `mesa-grab`, `mesa-drag`, `cursor` | |
| s→todos | `{ type: 'mesa-viewers', peers: [id...] }` (quem está na Mesa, para os avatares) | |
| c→s | `{ type: 'mesa', op: 'add', win: { type, x, y, w, h } }` | sim |
| c→s | `{ type: 'mesa', op: 'remove', id }` | sim |
| c→s | `{ type: 'mesa', op: 'place', id, x, y, w, h }` (soltar/redimensionar) | sim |
| c→s | `{ type: 'mesa', op: 'act', id, action }` | sim |
| c→s | `{ type: 'mesa', op: 'lock', leaderOnly?, lockSize? }` (só líder) | sim |
| s→quem está na Mesa | a mesma mensagem com `seq`, `by` e os valores resolvidos (`add` leva a janela inteira com `id` e `state` inicial; `act` leva a ação já preparada) | |
| s→autor | `{ type: 'mesa-denied', op, id, reason, fix? }` (`fix` = lugar livre mais perto quando a recusa é sobreposição) | |
| c→s / s→c | `{ type: 'mesa-sync' }` → `{ type: 'mesa-sync', mesa: { seq, leaderOnly, lockSize, windows } }` (buraco de `seq`) | |
| c→s | `{ type: 'mesa-grab', id }` / `{ type: 'mesa-release', id }` | não |
| s→quem está na Mesa | `{ type: 'mesa-grab', id, by }` / `{ type: 'mesa-release', id }`; recusa vai como `mesa-denied` com `reason: 'held', holder` | |
| c→s→outros na Mesa | `{ type: 'mesa-drag', id, x, y, w, h }` (até 20 Hz, renova a vez) | não |
| c→s→outros na Mesa | `{ type: 'cursor', x, y }` (unidades da mesa, até 20 Hz) | não |
| c→s→c | `{ type: 'time', t0 }` → `{ type: 'time', t0, server }` | não |

`welcome` **não** leva a mesa (quem está na Transmissão não paga por ela);
leva só `mesaCount` (quantas janelas há, para o seletor mostrar que a mesa
não está vazia) e `mesaViewers` (o mesmo `[id...]` do `mesa-viewers`, para
quem entra depois). Semente de migração: `initialMesa` em `createSignalingServer`,
junto de `initialChatHistory`. A vista de cada um é do cliente: depois da
migração, quem estava na Mesa manda `mesa-view on` de novo.

## 4. Onde cada time mexe

| Time | Arquivos |
|---|---|
| Protocolo | `server/signaling-core.js`, `src/renderer/mesa.js`, `src/renderer/mesa-modules/index.js`, `src/main.js` (semente), testes do servidor, `docs/glossario.md`, `glossario.test.js` |
| Ferramentas | só arquivos novos em `src/renderer/mesa-modules/` |
| Jogos | só arquivos novos em `src/renderer/mesa-modules/` (+ `src/renderer/vendor/`) |
| Origem local | `src/main.js` (carregar a página), módulo novo em `src/main/`, CSP no `index.html` |

Ninguém mexe no `STATUS.md`: a integração consolida.

## 5. Como o time Protocolo implementou (2026-09-24)

Acréscimos e decisões; nenhum nome ou formato acima mudou de sentido.

**Registro dos módulos** (`mesa-modules/index.js`): API em
`GoLive.mesaRegistry` (`get`, `list`, `addable`, `register`); o mapa cru
continua em `GoLive.mesaModules`. Tipo novo = arquivo `<tipo>.js` + nome em
`MODULE_NAMES` (o teste reprova arquivo fora da lista) + `<script>` no
`index.html`. Arquivo ausente é pulado; arquivo que quebra vai para
`loadErrors` sem derrubar o servidor. `maxStateBytes` tem teto de 16 KB.
`tela` e `camera` são embutidos com `media: true` e sem `act`; `addable()`
já os deixa fora do menu. `nota` é o exemplo de ponta a ponta:
`act { kind: 'set', text }`, último que salva vence, 1 000 caracteres.

**Ordem no servidor para `act`**: `validate(state, action, ctx)` na ação
**como o cliente mandou** (o cliente chama o mesmo `validate` para desligar
botões, sem `prepare`) → `prepare` (se houver) → `reduce`. O `ctx` do
`reduce` é só `{ from, isLeader }`, igual no servidor e nos clientes (hora e
sorte vêm dentro da ação). Por isso o eco de `act` leva também `isLeader`.
`validate`/`prepare`/`reduce`/`init` que lançam viram recusa `error`.

**Tela e câmera: quem põe e tira é o servidor.** Ele já vê o
`broadcast-state` e o `camera-state` de todo mundo, inclusive de quem está na
vista Transmissão, e é o único que vê quem saiu. Na transição para ao vivo
(ou câmera ligada) o servidor faz `add` da janela no lugar livre mais perto
do meio da mesa; ao parar, desligar ou sair, faz `remove` (com `by` = a
própria pessoa). Repetir o `broadcast-state` (pausa, limite) não põe outra.
O cliente não pede `add` de `tela`/`camera` (recusa `auto`). Tirar da mesa a
tela de alguém só a própria pessoa ou o líder (`not-yours`); ela volta na
próxima vez que a pessoa for ao vivo.

**Travas**: `leaderOnly` bloqueia `add`/`remove`/`place` e `mesa-grab` de
quem não é líder (`locked`); `lockSize` bloqueia `place` de quem não é líder
que mude `w`/`h` (`size-locked`). `act` sempre passa. O eco de `lock` leva as
duas travas resolvidas.

**Quem recebe**: `mesa`, `mesa-grab`, `mesa-release`, `mesa-drag`, `cursor`
só para quem está na vista Mesa. `mesa` é aceito de qualquer um (quem está
na Transmissão não recebe o eco; a recusa sempre volta). `mesa-grab`,
`mesa-drag` e `cursor` de quem não está na Mesa são recusados
(`not-viewing`) ou ignorados. `mesa-drag` só passa de quem tem a vez e a
renova; o repasse leva `by`. `cursor` repassado leva `from` (como o laser).
Fechar a Mesa (`mesa-view off`) ou sair solta as vezes da pessoa (com
`mesa-release` para quem está na Mesa).

**Recusas** (`mesa-denied.reason`): `rate` (mais de 20 operações/s),
`bad-request`, `unknown-type`, `auto`, `locked`, `size-locked`,
`leader-only`, `not-yours`, `not-found`, `held` (+ `holder`), `full`,
`bad-rect`, `too-small`, `too-big` (retângulo ou ação > 8 KB),
`out-of-world` (+ `fix`), `overlap` (+ `fix`), `no-space`, `no-act`,
`invalid` (+ `detail`, o motivo do `validate`), `state-too-big`, `error`,
`not-viewing`. O servidor recusa só sobreposição de verdade (vão 0); o
`fix` já vem com o vão de 16.

**Retomada** (mesma sala, socket caiu): o que foi para o socket morto se
perdeu, então o servidor tira a pessoa da vista Mesa ao retomar. Depois de
**qualquer** `welcome` (inclusive `resumed`), quem estava na Mesa manda
`mesa-view on` de novo.

**Migração**: `room-migrating` ganha `mesa` (o retrato + `idFloor`). O
sucessor passa `initialMesa: msg.mesa` no `hostRoom` (o `main.js` já repassa;
**falta o `app.js`** guardar `msg.mesa` no `room-migrating` e pô-lo no seed de
`becomeMigrationHost`, como faz com `chat`). A semente perde `tela`/`camera`
(os ids mudam; o servidor novo as põe de volta quando cada um reanuncia o
`broadcast-state`) e o `owner` de cada janela vira `null`. O servidor novo
dá ids a partir de `idFloor` (ou do maior id visto no chat/janelas), para a
cadeira de quem saiu não virar de quem entrou. Módulo com cadeiras: quem não
está em `ctx.peers` pode ser tratado como ausente.

**Modelo puro, extras**: `normRect`, `checkRect`, `sanitizeMesa`, `snapshot`,
`createGrabs` (`take`/`set`/`renew`/`release`/`holder`/`dropPeer`/`list`,
com `now` por parâmetro; o cliente apaga "Bia está movendo" `GRAB_MS` depois
do último `mesa-grab`/`mesa-drag`), `shouldEmit(last, now, hz = 20)`,
`normCursor`, `normDragRect`, `createPointerStore` (último ponto por pessoa,
some em 1 s). `applyMessage` também aceita `mesa-sync` e devolve sempre
`{ state, needSync }` (`stale: true` para `seq` já visto).

**Acréscimos do time Vista (2026-09-24)**, sem mudar nada acima:

- `{ type: 'mesa-count', count }` vai para a **sala inteira** quando a
  quantidade de janelas muda (add/remove; mover e agir não mandam). É o que
  mantém o seletor de vista de quem está na Transmissão depois do `welcome`.
- `mesa-sync` ganha `grabs: [{ id, by }]` (as vezes em andamento), **fora**
  de `mesa`: não é estado da sala, não migra, não tem `seq`.
- `{ type: 'mesa-ack', op, id, seq }` vai **só ao autor** de uma operação
  aceita quando ele **não** está na vista Mesa (quem está já recebe o eco).
  `id` é o da janela nova no `add`.

## 6. Conteúdo das janelas (fronteira entre os times Vista e Janelas)

A **Vista** (`src/renderer/mesa-view.js`) cuida da mesa: área, grade, andar,
zoom, mapa, a caixa de cada janela (mover, redimensionar, tela cheia, tirar,
contorno, alça), menu do botão direito, ponteiros e rede. O **conteúdo** de
cada tipo com estado mora em `src/renderer/mesa-janelas/<tipo>.js` e se
registra em `GoLive.mesaJanelas[<tipo>]`:

```js
{
  type: 'placar',
  mount(el, api) -> { update(state, meta), destroy(), focus?() },
}
```

- `el`: um `<div>` vazio que a Vista criou dentro da caixa da janela, já no
  tamanho certo (a Vista mantém o tamanho; o conteúdo se ajusta com CSS,
  `container queries` se quiser). O conteúdo nunca sai de `el`.
- `api`:
  - `act(action)`: manda `{ type: 'mesa', op: 'act', id, action }`.
  - `validate(action)`: o `validate` do módulo no estado atual, para
    desligar botões (`true` ou motivo).
  - `me()`: id da pessoa; `isLeader()`; `peers()`: `[{ id, name }]` da sala.
  - `nameOf(peerId)`, `colorFor(peerId)` (a cor da pessoa, a mesma do
    rabisco).
  - `serverNow()`: hora do servidor estimada pela mensagem `time`.
  - `onDenied(fn)`: recusas de `act` desta janela (`reason`, `detail`), para
    mostrar o motivo perto de onde se clicou.
- `update(state, meta)`: chamado ao montar e a cada `act` aplicado;
  `meta = { by, isLeader }` da última ação (ou `null` ao montar). Nada de
  refazer o DOM inteiro a cada `update` quando der para mexer só no que mudou.
- `destroy()`: solta timers, ouvintes e `requestAnimationFrame`.
- Interação: tudo que é clicável responde a teclado (`button` de verdade,
  foco visível). Arrastar dentro do conteúdo (ex.: peça de damas) não pode
  mover a janela: a Vista só arrasta pela alça nas janelas com conteúdo.
- Visual: só tokens de `style.css` (cores, `--fs-*`, `--s-*`, `--r-*`);
  a cor de uma pessoa só em detalhes (bolinha, contorno), nunca como fundo de
  texto. `--live` nunca. CSS do conteúdo em `src/renderer/mesa-janelas.css`.
- Tipo sem conteúdo registrado: a Vista mostra o `summary(state)` do módulo.

**Como a Vista implementou (time Vista, 2026-09-24).** A `api` acima ficou
exatamente como está; só estes detalhes a mais:

- **Carregamento**: `mesa-janelas/<tipo>.js` e `mesa-janelas.css` **não têm
  tag no `index.html`** (a origem local confere que todo arquivo citado lá
  existe). A Vista cria um `<script src="mesa-janelas/<tipo>.js">` por nome de
  `MODULE_NAMES` (e por tipo que `addable()` listar) na **primeira vez que a
  Mesa abre**, mais o `<link>` do CSS. Arquivo ausente é pulado. Se o
  conteúdo chegar depois de a janela já estar na mesa, a Vista troca o resumo
  pelo `mount`. Então: o arquivo tem de se chamar exatamente `<tipo>.js` e o
  tipo tem de estar no registro.
- `mount` é chamado **uma vez por janela** e logo depois vem
  `update(state, null)`; depois, `update(state, { by, isLeader })` a cada
  `act` aplicado e `update(state, null)` a cada retrato novo (`mesa-sync`).
- `el` tem a classe `mesa-content`, `position: absolute; inset: 0`,
  `container-type: size` e `overflow: hidden`. Nas janelas com conteúdo a
  alça ocupa os **28 px de cima** (sobre o conteúdo, `z-index` 4): deixe um
  respiro no topo (o protótipo usa ~30 px). Os controles da janela (avatar,
  Tela cheia, Tirar) aparecem no canto de cima à direita com o mouse em cima.
- **Tela cheia** não tira `el` do lugar (um iframe não recarrega): a janela
  passa a `position: fixed; inset: 0` e `el` cresce; só `container queries`.
- `focus()` (opcional) é chamado quando a pessoa aperta Enter com a janela
  focada.
- `validate(action)` roda com `ctx = { from, isLeader, now: serverNow(),
  peers }`. `peers()` inclui a própria pessoa.
- Roda do mouse dentro do conteúdo: se algum ancestral dentro de `el` rola
  (`overflow-y: auto|scroll`) e ainda tem para onde, a roda rola ele; senão
  aproxima a mesa.
- `serverNow()`: 5 idas e voltas de `time` ao abrir a Mesa, fica a de menor
  atraso, refeita a cada 60 s; antes da primeira medida devolve `Date.now()`.

## 7. Jogos (time Jogos, 2026-09-24)

`velha`, `lig4`, `damas`, `xadrez`, todos com cadeiras. A lógica comum das
cadeiras está em `mesa-modules/cadeiras.js` (`GoLive.mesaCadeiras`), que
**não é tipo de janela** (`HELPER_NAMES` no registro). No renderer a ordem
dos `<script>` é: `vendor/chess.js`, `mesa-modules/cadeiras.js`, os módulos,
`mesa-modules/index.js`. No Node os jogos carregam o que precisam sozinhos.

| Jogo | Tamanho (aspect) | Ações |
|---|---|---|
| velha | 360×360 (1) | `sit {seat}`, `stand`, `reset`, `move {cell: 0..8}` |
| lig4 | 420×360 (7/6) | `sit`, `stand`, `reset`, `move {col: 0..6}` |
| damas | 480×480 (1) | `sit`, `stand`, `reset`, `resign`, `move {path: [[l,c],...]}`; `legalMoves(state)` |
| xadrez | 480×480 (1) | `sit`, `stand`, `reset`, `resign`, `move {from, to, promotion?}` |

Todos exportam `dropPeer(state, peerId)` e `summary(state, peers?)`; o estado
guarda `names` junto de `seats`.

## 8. Informação escondida (cartas, palavras secretas) — 2026-09-25

Jogos em que cada pessoa só pode ver parte do estado (mão do pôquer, baralho,
palavra do "Desenha e adivinha", respostas do Stop antes de revelar). Quem
abre as ferramentas de desenvolvedor não pode ver o que não é dele: o
segredo **nunca sai do servidor**.

### Módulo

Além da seção 1, o módulo exporta:

```js
{
  secret: true,
  view(state, peerId) -> estadoVisivel,   // peerId null = quem só assiste
  migrate?(state) -> estadoSemSegredo,    // ver "Migração"
  timeoutAt?(state) -> number|null,       // hora do servidor em que alguém "estoura"
}
```

- `view` devolve o que **aquela** pessoa pode ver: as cartas dela, as
  públicas, contagens (quantas cartas cada um tem, quantas restam no
  baralho), e o que a interface precisa para desligar botões **já
  calculado** (ex.: `me: { canCheck, toCall, minRaise, actions: [...] }`),
  porque o cliente não tem o estado inteiro para rodar `validate`.
- `init`, `prepare` e `reduce` continuam como na seção 1 e rodam **só no
  servidor** para módulos `secret`. Sorte (embaralhar) em `init`/`prepare`
  com `ctx.random`; o baralho embaralhado fica no estado do servidor.
- Tempo esgotado: a interface manda `{ kind: 'timeout' }` quando o relógio
  da sala (`api.serverNow()`) passa de `timeoutAt(state)`; o servidor aceita
  só se `ctx.now` (hora dele) já passou do prazo, e o `reduce` aplica o que o
  jogo define (ex.: pôquer: mesa ou desiste; blackjack: para). Qualquer
  pessoa na Mesa pode mandar; o primeiro que chega vale.
- Apoio: `mesa-modules/baralho.js` (`GoLive.mesaBaralho`): cartas "As", "Td",
  "7c"; `newDeck(n)`, `shuffle(cards, random)`, `draw`, `rankIndex`,
  `cardName`, `isRed`. Carrega antes dos módulos (tag no `index.html`).

### Servidor

- Para janela `secret`, o eco de `add` e de `act` **não leva a ação**: leva
  o estado já filtrado, um por pessoa na Mesa:
  `{ type: 'mesa', op: 'state', id, seq, by, state: view(state, peerId) }`.
  Todos recebem o mesmo `seq` (cada um com o seu `state`).
- `mesa-sync` passa cada janela `secret` por `view(state, destinatário)`.
- Recusa de `act` volta só ao autor, como hoje.
- `maxStateBytes` vale para o estado inteiro do servidor.

### Cliente (`mesa.js` / `mesa-view.js`)

- `applyMessage` aceita `op: 'state'`: troca o `state` da janela, sem
  `reduce`. O conteúdo recebe `update(state, meta)` igual aos outros.
- `api.validate` de janela `secret` devolve `true` (quem decide é o
  servidor; a interface usa o `me` que veio na `view`).

### Quem sai da sala (vale para TODOS os módulos com `dropPeer`)

O servidor chama `dropPeer(state, peerId)` de cada janela quando alguém sai
de vez (depois da janela de retomada), e, se o estado mudou, manda
`{ type: 'mesa', op: 'drop', id, seq, peer }` (clientes aplicam o mesmo
`dropPeer`) — ou `op: 'state'` com a `view`, se a janela for `secret`.

### Migração

O retrato que vai no `room-migrating` passa por `migrate(state)` (ou, sem
ele, por `view(state, null)`): o servidor novo não pode receber segredo
(o retrato vai para todos). Regra dos jogos de cartas: **a mão em andamento
é cancelada e as apostas voltam** para quem apostou; as fichas e as
cadeiras ficam.

### Como o time Segredo implementou (2026-09-26)

O que mudou em relação ao texto acima, e o que os times de cartas usam:

- **Assinatura**: `view(state, peerId, ctx)`, com `ctx = { peers: [{ id, name }] }`
  (quem está na sala agora). `peerId` é o id de quem recebe (sentado ou só
  assistindo); `null` só na migração sem `migrate`. `init`/`prepare`
  continuam com `ctx.peers` como na seção 1. O registro confere: `secret`
  booleano, `secret: true` exige `view`; `migrate`, `timeoutAt` e
  `dropPeer`, se existirem, são funções. O módulo conferido ganha
  `secret: false|true`.
- **Eco de `add` de janela secret**: continua `op: 'add'` (o cliente precisa
  de `id`, `type` e retângulo), mas `win.state` é a `view` de quem recebe.
  O de `act` é, para cada pessoa na Mesa, com o mesmo `seq`:
  `{ type: 'mesa', op: 'state', id, seq, by, isLeader, state }` — **sem**
  `action` (o `prepare` pode ter posto carta dada nela). `mesa-ack` não
  muda.
- **`timeout`**: o servidor confere **antes** do `validate` do módulo, para
  qualquer módulo: sem `timeoutAt` ou prazo `null` → `invalid` com
  `detail: 'Sem prazo'`; `Date.now()` do servidor menor que o prazo →
  `mesa-denied` com **`reason: 'early', at: <prazo>`**. Depois passa pelo
  `validate` e pelo `prepare` como toda ação (o `prepare` recebe
  `ctx.now` e `ctx.random`: é onde o jogo decide o que o tempo esgotado
  faz). O conteúdo **não mostra** a recusa `early` (outra pessoa mandou
  antes, ou o relógio dela está adiantado): a batalha filtra no
  `onDenied`, e manda de novo 2 s depois se o prazo não mudou. Para não
  chover `timeout`, a batalha manda na hora só pelo adversário de quem
  estourou; os outros esperam 3 s a mais.
- **Quem sai de vez**: vale para **todo** módulo com `dropPeer`. O servidor
  chama no único caminho de saída (`removePeer`: close limpo, fim da janela
  de retomada, expulsão, fantasma do mesmo `clientId`), depois do
  `peer-left`. Quem cai (1006) e volta dentro da janela de retomada
  continua sentado. Estado igual (JSON) não manda nada. Não secret:
  `{ type: 'mesa', op: 'drop', id, seq, by: peer, peer }`, e o
  `applyMessage` chama o mesmo `dropPeer(state, peer)` (sem `dropPeer`, ou
  se ele lançar, o cliente pede sync). Secret: `op: 'state'` com a `view`
  de cada um e também `peer`.
- **`mesa-sync`**: cada janela secret vai com a `view` de quem pediu.
- **Migração**: `room-migrating.mesa` passa cada janela secret por
  `migrate(state)` (sem ele, `view(state, null, { peers: [] })`); se lançar,
  a janela **não migra**. O resultado tem de ser um estado inteiro válido
  para o `reduce` do servidor novo (ele é a semente). Os ids das pessoas
  mudam na migração: trate cadeira de quem não está em `ctx.peers` como
  livre no `validate` e na `view` (a batalha faz assim).
- **Teto**: `maxStateBytes` confere o estado inteiro do servidor (depois do
  `init`, do `reduce` e do `dropPeer`), não a `view`.
- **Cliente**: `applyMessage` aplica `op: 'state'` (troca o estado, sem
  `reduce`) e `op: 'drop'`; a Vista chama `update(state, { by, isLeader })`
  nos dois, igual ao `act`. `api.validate` de janela secret devolve
  `true`; a interface liga os botões pelo que veio pronto na `view`.
  A moldura dos tabuleiros (`tabuleiro.js`) aceita `opts.pode(action)`
  para isso.
- **Prova**: `batalha` ("Batalha naval", grupo `jogos`, 720×460, aspecto
  livre). Estado inteiro com `fleets` (5 navios: 5, 4, 3, 3, 2, retos, sem
  se encostar, sorteados no `prepare` ao sentar, em "Sortear de novo" e em
  "Nova partida"), `ready`, `shots`, `turn`, `deadline` (60 s por tiro;
  estourou, o tiro sai numa casa sorteada), `result`. A `view` tem
  `boards[i] = { shots: [[casa, acertou]], ships (os do dono; os
  afundados; todos no fim), left, hasFleet }` e `me = { seat, can: { sit:
  [a, b], stand, shuffle, ready, fire, resign, reset } }`. O teste
  `server/signaling-mesa-segredo-e2e.test.js` confere, mensagem por
  mensagem, que o socket de quem não é dono nunca recebe um navio que não
  afundou (ecos, `mesa-sync`, `room-migrating`).

## 9. Regras clássicas dos jogos de cartas (decididas em 2026-09-25)

Pedido do Nicolas: "decida as regras utilizando padrão clássico". Sempre
**fichas de mentira** (nada de dinheiro, nada de loja). Todos `secret: true`
(seção 8).

### Pôquer — Texas Hold'em sem limite (`poquer`, título "Pôquer")

- 2 a 8 cadeiras (`seats` com 8 posições). Quem senta recebe **1 000
  fichas**. Blinds **10/20**, fixos (o líder pode trocar entre mãos:
  5/10, 10/20, 25/50, 50/100).
- **Botão do dealer** gira a cada mão. Mano a mano: quem está no botão paga o
  small blind e fala primeiro no pré-flop, e por último depois.
- Rodadas: pré-flop, flop (3), turn (1), river (1), showdown. Queima uma
  carta antes de cada rodada comunitária.
- Ações: desistir, passar, pagar, apostar, aumentar, all-in. Aposta mínima =
  big blind; aumento mínimo = o maior aumento da rodada. All-in menor que um
  aumento completo **não reabre** a ação para quem já agiu.
- **Potes paralelos** quando alguém está all-in. No showdown todas as mãos
  que chegaram são mostradas; melhor jogo de 5 entre as 7 cartas. Empate
  divide o pote; a ficha que sobra vai para o primeiro à esquerda do botão.
  Se todos desistem, quem sobrou leva sem mostrar.
- Ordem das mãos: carta alta, par, dois pares, trinca, sequência (A-2-3-4-5
  vale; a mais baixa), flush, full house, quadra, straight flush (royal é o
  maior).
- Tempo: **30 s** por decisão; estourou, passa se puder, senão desiste.
- Nova mão: botão "Dar as cartas", que qualquer um sentado aperta com 2+
  sentados com fichas. Quem senta no meio da mão entra na próxima. Quem
  zerou pode pedir **recompra** (volta a 1 000) entre mãos. Quem sai da sala
  no meio da mão desiste dela e libera a cadeira.

### Blackjack — regras de cassino (`blackjack`, título "Blackjack")

- A **banca é o app** (o servidor joga por ela). 1 a 5 lugares. Quem senta
  recebe **1 000 fichas**; aposta de **10 a 500**.
- **Sapato de 6 baralhos**, embaralhado de novo quando passa de 75 % (carta
  de corte).
- A banca recebe uma carta aberta e uma fechada, e **confere o blackjack**
  (olha a fechada) quando a aberta é ás ou vale 10.
- Banca **para em todo 17, inclusive o 17 macio** (S17). Blackjack paga
  **3:2**; vitória comum 1:1; empate devolve a aposta.
- **Seguro** quando a banca mostra ás: até metade da aposta, paga 2:1.
- **Dobrar** em quaisquer duas primeiras cartas, inclusive depois de
  dividir. **Dividir** pares (mesmo valor, ex.: J e K) até 4 mãos; ases
  divididos recebem uma carta só cada e não se dividem de novo; 21 depois de
  dividir não é blackjack. Sem rendição.
- Rodada: apostas (20 s depois da primeira aposta, ou quando todos
  apostaram) → cartas → seguro, se houver → cada lugar joga na ordem →
  banca joga → pagamento → próxima rodada. Tempo de **30 s** por decisão;
  estourou, para (e sem aposta, fica fora da rodada).
- Recompra (volta a 1 000) com zero fichas, entre rodadas.
