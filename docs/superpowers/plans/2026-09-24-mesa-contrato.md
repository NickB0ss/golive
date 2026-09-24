# Contrato da Mesa (para os times trabalharem em paralelo)

Data: 2026-09-24. Deriva de `docs/superpowers/specs/2026-09-24-sala-em-dois-modos-design.md`
(seções 4 e 8). Quando este arquivo e a spec divergirem, a spec manda no
**comportamento** e este arquivo manda nos **nomes e formatos**. Quem precisar
mudar um formato daqui avisa no relatório do time; ninguém muda sozinho.

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
- `createState({ mode, mesa })`, `applyMessage(state, msg)`: aplica uma
  mensagem `mesa` já aceita (com `seq`). Buraco de `seq` → devolve
  `{ needSync: true }`.
- Janela: `{ id, type, owner, x, y, w, h, state }`. Telas e câmeras são
  janelas de tipo `tela` / `camera` com `state = { peerId, kind }`, postas e
  tiradas pelo próprio app quando alguém vai ao vivo ou para.

## 3. Mensagens (sinalização)

| Direção | Mensagem | Guardada |
|---|---|---|
| c→s | `{ type: 'room-mode', mode: 'transmissao'｜'mesa' }` (só líder) | sim |
| s→todos | `{ type: 'room-mode', mode, by }` | |
| c→s | `{ type: 'mesa', op: 'add', win: { type, x, y, w, h } }` | sim |
| c→s | `{ type: 'mesa', op: 'remove', id }` | sim |
| c→s | `{ type: 'mesa', op: 'place', id, x, y, w, h }` (soltar/redimensionar) | sim |
| c→s | `{ type: 'mesa', op: 'act', id, action }` | sim |
| c→s | `{ type: 'mesa', op: 'lock', leaderOnly }` (só líder) | sim |
| s→todos | a mesma mensagem com `seq`, `by` e os valores resolvidos (`add` leva a janela inteira com `id` e `state` inicial; `act` leva a ação já preparada) | |
| s→autor | `{ type: 'mesa-denied', op, id, reason, fix? }` (`fix` = lugar livre mais perto quando a recusa é sobreposição) | |
| c→s / s→c | `{ type: 'mesa-sync' }` → `{ type: 'mesa-sync', mode, mesa: { seq, leaderOnly, windows } }` | |
| c→s | `{ type: 'mesa-grab', id }` / `{ type: 'mesa-release', id }` | não |
| s→todos | `{ type: 'mesa-grab', id, by }` / `{ type: 'mesa-release', id }`; recusa vai como `mesa-denied` com `reason: 'held', holder` | |
| c→s→outros | `{ type: 'mesa-drag', id, x, y, w, h }` (até 20 Hz, renova a vez) | não |
| c→s→outros | `{ type: 'cursor', x, y }` (unidades da mesa, até 20 Hz) | não |
| c→s→c | `{ type: 'time', t0 }` → `{ type: 'time', t0, server }` | não |

`welcome` ganha `mode` e `mesa`. Semente de migração: `initialMode`,
`initialMesa` em `createSignalingServer`, junto de `initialChatHistory`.

## 4. Onde cada time mexe

| Time | Arquivos |
|---|---|
| Protocolo | `server/signaling-core.js`, `src/renderer/mesa.js`, `src/renderer/mesa-modules/index.js`, `src/main.js` (semente), testes do servidor, `docs/glossario.md`, `glossario.test.js` |
| Ferramentas | só arquivos novos em `src/renderer/mesa-modules/` |
| Jogos | só arquivos novos em `src/renderer/mesa-modules/` (+ `src/renderer/vendor/`) |
| Origem local | `src/main.js` (carregar a página), módulo novo em `src/main/`, CSP no `index.html` |

Ninguém mexe no `STATUS.md`: a integração consolida.
