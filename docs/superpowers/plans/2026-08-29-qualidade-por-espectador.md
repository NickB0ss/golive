# Qualidade adaptativa por destinatário — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa.
> Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** fazer a degradação de qualidade valer **por conexão**, não pela sala
inteira — um espectador com CPU fraca, link ruim ou os dois recebe um preset
menor sozinho, os demais ficam no piso.

**Architecture:** duas funções puras novas (`rxstats.receiveHealth`,
`config.scaleFactorFor`), um módulo puro novo (`peerquality.js`, escada de
histerese por peer no mesmo molde do `autoquality.js`) e um método de fiação em
`mesh.js` (`applyEncodingToPeer`). O laço fecha dentro do `updateStats` que já
roda a cada segundo: cada conexão de saída ganha sua própria escada, cuja saída
entra em `setParameters` + `scaleResolutionDownBy` — sem renegociação, sem tela
preta. `app.js` só fia.

**Tech Stack:** Electron 32, JavaScript sem build step, WebRTC do Chromium,
`node --test`, zero dependências novas.

## Base

Este plano assume a branch **`feat/transmissao-honesta` mesclada em `main`**
(176 testes passando). Ele usa `rxstats.js`, `autoquality.js`, `resetShareState`,
o `applyConstraints` de captura e o campo `sample.limitation` de
`readSenderReport`, todos introduzidos lá. **Não comece antes disso entrar.**

Design completo: `docs/superpowers/specs/2026-08-29-qualidade-por-espectador-design.md`.

## Global Constraints

Valem para **todas** as tarefas. Um reviewer trata violação como defeito.

1. **Comentários em português, sem acentos**, no estilo do arquivo em que você
   mexe: explicam *por que*, não *o quê*. Texto visível ao usuário (a tag do
   painel de membros) usa acentos.
2. **Testes com `node --test`**, sem framework novo. Arquivo de teste ao lado do
   módulo (`x.js` → `x.test.js`); o módulo termina com
   `if (typeof module !== 'undefined') module.exports = api;`.
3. **Nenhuma dependência npm nova**, de produção nem de dev.
4. **`src/renderer/app.js` não tem testes.** Lógica testável vai em módulo puro;
   `app.js` apenas chama. Nunca "teste" `app.js` com mocks improvisados.
5. **Todo módulo novo do renderer** segue o IIFE dos existentes:
   `(function (root) { … root.GoLive.<nome> = api; if (typeof module !== 'undefined') module.exports = api; })(typeof window !== 'undefined' ? window : global);`
   e precisa de uma tag `<script>` em `src/renderer/index.html` **antes** de
   `app.js`.
6. **`npm test` passa inteiro.** A base é **176 testes** (estado de
   `feat/transmissao-honesta`). Nenhum teste existente afrouxado ou deletado. Se
   um teste existente conflita com a tarefa, pare e reporte.
7. **Um commit por tarefa** (ou poucos, coerentes), mensagem no estilo do
   repositório: `feat(escopo): …`, em português, sem acentos, minúsculas depois
   do prefixo.
8. **Não mexa em arquivos fora do escopo da sua tarefa.** Não reformate, não
   renomeie, não "arrume de passagem".
9. **A regra do tema é lei:** cor saturada (`--live`) significa uma coisa só —
   alguém está ao vivo. Degradado é `--warn`. A tag de preset por-peer é
   **neutra** (`--text-2` sobre `--surface-3`): não usa `--warn` nem `--live`.
   Nada de `backdrop-filter`/blur.

## Fora deste plano

SFU, simulcast, dependência nova (próximo degrau, gatilho já escrito em
`Decisões/golive - árvore de retransmissão em vez de SFU no host`). Adaptação de
**captura** por conexão (impossível — um capturador; per-peer só desce a partir
do piso, via `scaleResolutionDownBy` no encoder). Mexer na eleição da árvore
(`tree.js` fica intacta). UI além da tag no painel de membros.

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/renderer/rxstats.js` | `+ receiveHealth(cur, prev, dtMs)` — deriva taxa de travadas, perda % da janela, flag de decoder em software. Puro. | 1 |
| `src/renderer/peerquality.js` (novo) | escada de histerese **por peer**. Puro. `initialState`, `next(state, signals, opts)`, `isBad`, `LIMITS`. | 2 |
| `src/renderer/config.js` | `+ scaleFactorFor(captureWidth, targetWidth)` — helper puro pro `scaleResolutionDownBy`. | 3 |
| `src/renderer/mesh.js` | `+ applyEncodingToPeer(peerId, quality, kind, scaleDownBy)` — uma conexão. | 3 |
| `src/renderer/app.js` | fiação: `view-state` leva/guarda `receiveHealth`; `peerQuality` Map tickado no `updateStats`; `qualityForPeer`; `reapplyAudienceQuality` por-peer; remove a fusão da saúde de relay da escada global (M3). | 4, 5 |
| `src/renderer/ui.js`, `style.css` | tag de preset no `buildMemberRow`. | 6 |
| `src/renderer/index.html` | `<script src="peerquality.js">` antes de `app.js`. | 2 |

---

## Task 1: `rxstats.receiveHealth` — a saúde de recepção derivada

**Problema.** `rxstats.js` (Task 5 da branch anterior) lê um relatório de
`getStats` de entrada e devolve valores **acumulados** (`freezeCount`,
`packetsLost` desde o início). Pra alimentar uma escada, o que importa é a
**taxa** na janela entre duas amostras: travadas por minuto, perda % da janela,
e se o decoder é software. Nenhuma dessas três sai de uma amostra só.

**Files:**
- Modify: `src/renderer/rxstats.js` (nova função + export)
- Test: `src/renderer/rxstats.test.js` (append)

**Interfaces:**
- Consumes: `readReceiverReport(report) -> sample` (já existe), cujo `sample`
  tem `framesDecoded`, `packetsReceived`, `packetsLost`, `freezeCount`,
  `decoder` (string de `decoderImplementation`).
- Produces: `GoLive.rxstats.receiveHealth(cur, prev, dtMs) -> { lossPct, freezeRate, softwareDecoder } | null`.
  `null` quando `prev` é ausente ou nenhum quadro foi decodificado na janela
  (ausência não é diagnóstico).

- [ ] **Passo 1: escrever o teste que falha** — append em `src/renderer/rxstats.test.js`

```js
// ---------- receiveHealth ----------
const { receiveHealth } = require('./rxstats');

const RX = (over = {}) => ({
  framesDecoded: 0, packetsReceived: 0, packetsLost: 0, freezeCount: 0, decoder: '', ...over,
});

test('receiveHealth: sem prev devolve null -- uma amostra nao e uma taxa', () => {
  assert.equal(receiveHealth(RX({ framesDecoded: 100 }), null, 1000), null);
});

test('receiveHealth: nenhum quadro decodificado na janela devolve null', () => {
  const s = RX({ framesDecoded: 100 });
  assert.equal(receiveHealth(s, s, 1000), null);
});

test('receiveHealth: dtMs invalido devolve null', () => {
  const prev = RX({ framesDecoded: 100 });
  const cur = RX({ framesDecoded: 130 });
  assert.equal(receiveHealth(cur, prev, 0), null);
  assert.equal(receiveHealth(cur, prev, -5), null);
});

test('receiveHealth: travadas viram taxa por minuto', () => {
  const prev = RX({ framesDecoded: 100, freezeCount: 2 });
  const cur = RX({ framesDecoded: 130, freezeCount: 5 });
  // 3 travadas em 1s = 180/min
  assert.equal(receiveHealth(cur, prev, 1000).freezeRate, 180);
});

test('receiveHealth: perda e da JANELA, nao acumulada', () => {
  const prev = RX({ framesDecoded: 100, packetsReceived: 9000, packetsLost: 1000 });
  const cur = RX({ framesDecoded: 130, packetsReceived: 9990, packetsLost: 1010 });
  // janela: 10 perdidos de 1000 oferecidos = 1%
  assert.ok(Math.abs(receiveHealth(cur, prev, 1000).lossPct - 1) < 1e-9);
});

test('receiveHealth: contadores que andam pra tras nao viram numero negativo', () => {
  const prev = RX({ framesDecoded: 100, packetsLost: 50, freezeCount: 5 });
  const cur = RX({ framesDecoded: 130, packetsLost: 40, freezeCount: 3 });
  const h = receiveHealth(cur, prev, 1000);
  assert.ok(h.lossPct >= 0);
  assert.ok(h.freezeRate >= 0);
});

test('receiveHealth: decoder em software sinalizado', () => {
  const prev = RX({ framesDecoded: 100 });
  assert.equal(receiveHealth(RX({ framesDecoded: 130, decoder: 'FFmpegVideoDecoder' }), prev, 1000).softwareDecoder, true);
  assert.equal(receiveHealth(RX({ framesDecoded: 130, decoder: 'libvpx' }), prev, 1000).softwareDecoder, true);
  assert.equal(receiveHealth(RX({ framesDecoded: 130, decoder: 'DXVAVideoDecoder' }), prev, 1000).softwareDecoder, false);
  assert.equal(receiveHealth(RX({ framesDecoded: 130, decoder: '' }), prev, 1000).softwareDecoder, false);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/rxstats.test.js
```

Esperado: FALHA com `receiveHealth is not a function`.

- [ ] **Passo 3: implementar** — em `src/renderer/rxstats.js`, **antes** da linha `const api = {`

```js
  // Nomes de decoder de software que o Chromium reporta em
  // decoderImplementation. Hardware costuma ser "DXVA...", "D3D11...",
  // "VideoToolbox", "MediaCodec..." -- a lista de software e mais curta e
  // mais estavel, entao o teste e por inclusao dela.
  const SOFTWARE_DECODERS = ['ffmpeg', 'libvpx', 'dav1d', 'openh264', 'vpxvideodecoder', 'dav1dvideodecoder'];

  function isSoftwareDecoder(impl) {
    const s = String(impl || '').toLowerCase();
    return SOFTWARE_DECODERS.some((n) => s.includes(n));
  }

  /** Deriva a SAUDE DE RECEPCAO da janela entre duas amostras da mesma
   * conexao de entrada. `cur`/`prev` sao retornos de readReceiverReport;
   * `dtMs` o intervalo entre eles.
   *
   * null quando prev e ausente ou nenhum quadro foi decodificado na janela:
   * ausencia nao e diagnostico -- mesmo criterio do autoquality e do
   * tree.js. Os contadores da spec do WebRTC podem andar pra tras (reordem,
   * duplicata), entao todo delta e preso em >= 0. */
  function receiveHealth(cur, prev, dtMs) {
    if (!cur || !prev || !(Number(dtMs) > 0)) return null;
    const framesDelta = (cur.framesDecoded || 0) - (prev.framesDecoded || 0);
    if (framesDelta <= 0) return null;

    const lostDelta = Math.max(0, (cur.packetsLost || 0) - (prev.packetsLost || 0));
    const recvDelta = Math.max(0, (cur.packetsReceived || 0) - (prev.packetsReceived || 0));
    const offered = lostDelta + recvDelta;
    const lossPct = offered ? (lostDelta / offered) * 100 : 0;

    const freezeDelta = Math.max(0, (cur.freezeCount || 0) - (prev.freezeCount || 0));
    const freezeRate = (freezeDelta / dtMs) * 60000;

    return { lossPct, freezeRate, softwareDecoder: isSoftwareDecoder(cur.decoder) };
  }
```

E acrescentar `receiveHealth` ao objeto `api`:

```js
  const api = { readReceiverReport, lossPercent, jitterBufferMs, receiveHealth };
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/renderer/rxstats.test.js
```

Esperado: os testes existentes + 7 novos passando.

- [ ] **Passo 5: verificação**

```bash
npm test
```

Esperado: **183 testes passando** (176 + 7).

- [ ] **Passo 6: commit**

```bash
git add src/renderer/rxstats.js src/renderer/rxstats.test.js
git commit -m "feat(stats): receiveHealth -- taxa de travadas, perda da janela e decoder em software"
```

---

## Task 2: `peerquality.js` — a escada de histerese por peer

**Problema.** A escada da Task 2 da branch anterior (`autoquality.js`) é
**global**: uma saída, aplicada a todos. Precisamos da mesma disciplina
(desce rápido, sobe devagar, teto) mas **por conexão**, com entradas
diferentes: dois sinais que o sender já tem (`limitation === 'bandwidth'`) e um
que chega do espectador (`receiveHealth`).

**Files:**
- Create: `src/renderer/peerquality.js`
- Test: `src/renderer/peerquality.test.js`
- Modify: `src/renderer/index.html` (`<script>`)

**Interfaces:**
- Produces:
  - `GoLive.peerquality.initialState() -> { steps, badRun, goodSinceMs }`
  - `GoLive.peerquality.next(state, signals, opts) -> state`, com
    `signals = { atMs, senderBandwidthLimited, receiveHealth }` e
    `receiveHealth = { lossPct, freezeRate, softwareDecoder } | null`
  - `GoLive.peerquality.isBad(signals, opts) -> boolean`
  - `GoLive.peerquality.LIMITS = { MAX_PEER_STEPS, BAD_SAMPLES_TO_DEGRADE, GOOD_MS_TO_RECOVER, FREEZE_PER_MIN, LOSS_PCT_MAX }`

**Nota de reuso.** `next` é quase idêntico a `autoquality.next` (mesma
semântica da "Opção B — folga contínua observada": `goodSinceMs: null` no
degrau, primeira amostra boa ancora o relógio). Optou-se por manter separado:
entradas diferentes (booleano + `receiveHealth` vs `health` de encode),
limiares diferentes, e `autoquality` tem `worstHealth` que aqui não existe. Um
reviewer que ache que devem fundir deve dizer — o custo de fundir (um `isBad`
parametrizado por política) provavelmente não paga.

- [ ] **Passo 1: escrever o teste que falha** — `src/renderer/peerquality.test.js`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialState, next, isBad, LIMITS } = require('./peerquality');

const OK = { atMs: 0, senderBandwidthLimited: false, receiveHealth: { lossPct: 0, freezeRate: 0, softwareDecoder: false } };
const BW = { ...OK, senderBandwidthLimited: true };
const SW = { ...OK, receiveHealth: { lossPct: 0, freezeRate: 0, softwareDecoder: true } };
const FREEZE = { ...OK, receiveHealth: { lossPct: 0.5, freezeRate: 30, softwareDecoder: false } };
const FREEZE_BY_LOSS = { ...OK, receiveHealth: { lossPct: 8, freezeRate: 30, softwareDecoder: false } };

// Aplica varias amostras, 1s entre elas.
function run(state, signals, startMs = 0) {
  let s = state;
  signals.forEach((sig, i) => { s = next(s, { ...sig, atMs: startMs + i * 1000 }); });
  return s;
}

test('isBad: link limitado por banda e ruim', () => {
  assert.equal(isBad(BW, {}), true);
});

test('isBad: decoder em software do espectador e ruim', () => {
  assert.equal(isBad(SW, {}), true);
});

test('isBad: travar MUITO com perda baixa e ruim (decode nao acompanha)', () => {
  assert.equal(isBad(FREEZE, {}), true);
});

test('isBad: travar com perda ALTA NAO e este caso -- o GCC ja trata banda', () => {
  assert.equal(isBad(FREEZE_BY_LOSS, {}), false);
});

test('isBad: receiveHealth ausente nao e ruim', () => {
  assert.equal(isBad({ ...OK, receiveHealth: null }, {}), false);
});

test('uma amostra ruim isolada nao degrada', () => {
  assert.equal(run(initialState(), [BW]).steps, 0);
});

test('amostras ruins seguidas o bastante descem um degrau e zeram a corrida', () => {
  const s = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(BW));
  assert.equal(s.steps, 1);
  assert.equal(s.badRun, 0);
});

test('uma amostra boa no meio zera a corrida de ruins', () => {
  const s = run(initialState(), [BW, BW, OK, BW, BW]);
  assert.equal(s.steps, 0);
});

test('a escada por peer tem teto', () => {
  const muitas = Array(LIMITS.BAD_SAMPLES_TO_DEGRADE * (LIMITS.MAX_PEER_STEPS + 3)).fill(SW);
  assert.equal(run(initialState(), muitas).steps, LIMITS.MAX_PEER_STEPS);
});

test('so sobe de volta depois da folga continua observada', () => {
  const degradado = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(BW));
  const t0 = LIMITS.BAD_SAMPLES_TO_DEGRADE * 1000;
  // primeira boa ancora o relogio
  const inicio = next(degradado, { ...OK, atMs: t0 });
  assert.equal(inicio.steps, 1);
  const cedo = next(inicio, { ...OK, atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER - 1 });
  assert.equal(cedo.steps, 1);
  const naHora = next(cedo, { ...OK, atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER + 1 });
  assert.equal(naHora.steps, 0);
});

test('uma ruim durante a espera cancela a recuperacao', () => {
  const degradado = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(BW));
  const t0 = LIMITS.BAD_SAMPLES_TO_DEGRADE * 1000;
  let s = next(degradado, { ...OK, atMs: t0 });
  s = next(s, { ...BW, atMs: t0 + 1000 });
  s = next(s, { ...OK, atMs: t0 + 2000 });
  s = next(s, { ...OK, atMs: t0 + 2000 + LIMITS.GOOD_MS_TO_RECOVER - 1 });
  assert.equal(s.steps, 1);
});

test('dois peers com estados separados nao se contaminam', () => {
  let a = initialState();
  let b = initialState();
  a = run(a, Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(BW));
  b = run(b, [OK, OK, OK]);
  assert.equal(a.steps, 1);
  assert.equal(b.steps, 0);
});

test('entrada indefinida nao lanca', () => {
  assert.equal(next(undefined, undefined).steps, 0);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/peerquality.test.js
```

Esperado: FALHA com `Cannot find module './peerquality'`.

- [ ] **Passo 3: escrever o módulo** — `src/renderer/peerquality.js`

```js
'use strict';

(function (root) {
  // Teto de degraus por peer, A PARTIR do piso global. Dois: o piso ja pode
  // ter descido pelo tamanho da sala; mais dois degraus locais chegam num
  // preset que ainda serve pra assistir. Abaixo disso o problema da pessoa
  // e outro (a maquina/link dela nao aguenta nem o minimo).
  const MAX_PEER_STEPS = 2;

  // Amostras ruins SEGUIDAS antes de descer -- ~3s continuos com a janela
  // visivel, um pico isolado nao conta.
  const BAD_SAMPLES_TO_DEGRADE = 3;

  // Folga CONTINUA OBSERVADA antes de subir. Menor que os 30s do autoquality
  // global (20s): a recuperacao por-peer nao afeta a sala, entao arriscar
  // subir cedo custa menos.
  const GOOD_MS_TO_RECOVER = 20000;

  // Travar sem perda de rede = o decode nao acompanha (caso 1). Travar COM
  // perda alta e o caso 2, e o remedio e outro (o GCC ja esta agindo; a
  // resolucao seguir junto vem do sinal senderBandwidthLimited).
  const FREEZE_PER_MIN = 6;
  const LOSS_PCT_MAX = 2;

  const LIMITS = { MAX_PEER_STEPS, BAD_SAMPLES_TO_DEGRADE, GOOD_MS_TO_RECOVER, FREEZE_PER_MIN, LOSS_PCT_MAX };

  /** Ruim = qualquer um dos tres: link limitado por banda, decoder em
   * software do espectador, ou travar muito sem que a rede explique. */
  function isBad(signals, opts) {
    if (!signals) return false;
    if (signals.senderBandwidthLimited === true) return true;
    const rh = signals.receiveHealth;
    if (!rh || typeof rh !== 'object') return false;
    if (rh.softwareDecoder === true) return true;
    const o = opts || {};
    const freezeMax = o.freezePerMin ?? FREEZE_PER_MIN;
    const lossMax = o.lossPctMax ?? LOSS_PCT_MAX;
    return typeof rh.freezeRate === 'number' && typeof rh.lossPct === 'number'
      && rh.freezeRate > freezeMax && rh.lossPct < lossMax;
  }

  function initialState() {
    return { steps: 0, badRun: 0, goodSinceMs: null };
  }

  /** Avanca a escada de UM peer com UMA amostra. Puro: relogio via
   * signals.atMs. Mesma semantica de recuperacao do autoquality (Opcao B):
   * goodSinceMs zera no degrau, a primeira amostra boa ancora o relogio. */
  function next(state, signals, opts) {
    const o = opts || {};
    const maxSteps = o.maxSteps ?? MAX_PEER_STEPS;
    const badToDegrade = o.badSamplesToDegrade ?? BAD_SAMPLES_TO_DEGRADE;
    const goodMsToRecover = o.goodMsToRecover ?? GOOD_MS_TO_RECOVER;

    const prev = state || initialState();
    const atMs = Number(signals?.atMs) || 0;

    if (isBad(signals, o)) {
      const badRun = prev.badRun + 1;
      if (badRun >= badToDegrade && prev.steps < maxSteps) {
        return { steps: prev.steps + 1, badRun: 0, goodSinceMs: null };
      }
      return { steps: prev.steps, badRun, goodSinceMs: null };
    }

    const goodSinceMs = prev.goodSinceMs ?? atMs;
    if (prev.steps > 0 && atMs - goodSinceMs >= goodMsToRecover) {
      return { steps: prev.steps - 1, badRun: 0, goodSinceMs: atMs };
    }
    return { steps: prev.steps, badRun: 0, goodSinceMs };
  }

  const api = { initialState, next, isBad, LIMITS };

  root.GoLive = root.GoLive || {};
  root.GoLive.peerquality = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/renderer/peerquality.test.js
```

Esperado: 13 testes passando.

- [ ] **Passo 5: a tag `<script>`**

Em `src/renderer/index.html`, junto das outras tags de módulo, **antes** de
`app.js` e depois de `autoquality.js`:

```html
<script src="peerquality.js"></script>
```

- [ ] **Passo 6: verificação**

```bash
npm test
```

Esperado: **196 testes passando** (183 + 13).

- [ ] **Passo 7: commit**

```bash
git add src/renderer/peerquality.js src/renderer/peerquality.test.js src/renderer/index.html
git commit -m "feat(qualidade): escada de histerese por espectador"
```

---

## Task 3: `scaleFactorFor` + `applyEncodingToPeer` — aplicar em uma conexão

**Problema.** `mesh.applyEncoding(quality, kind)` varre **todos** os senders
daquele kind e aplica o mesmo `maxBitrate`/`maxFramerate`. Precisamos de uma
versão que resolve **um** peer e que também empurre a resolução pra baixo no
encoder (`scaleResolutionDownBy`), já que `applyConstraints` da captura é comum
a todas as conexões.

**Files:**
- Modify: `src/renderer/config.js` (nova função + export)
- Test: `src/renderer/config.test.js` (append)
- Modify: `src/renderer/mesh.js` (novo método em `createMesh`, export no return)

**Interfaces:**
- Produces: `GoLive.config.scaleFactorFor(captureWidth, targetWidth) -> number`
  em `{1, 1.5, 2, 3, 4}` (nunca escala mais do que a razão pede; 1 quando alvo
  >= captura ou entrada inválida).
- Produces: `mesh.applyEncodingToPeer(peerId, quality, kind, scaleDownBy)` —
  como `applyEncoding` mas uma `outConns[kind]` só, e seta
  `encodings[0].scaleResolutionDownBy = scaleDownBy`.

- [ ] **Passo 1: escrever o teste que falha** — append em `src/renderer/config.test.js`

```js
// ---------- scaleFactorFor ----------
const { scaleFactorFor } = require('./config');

test('scaleFactorFor: alvo igual a captura nao escala', () => {
  assert.equal(scaleFactorFor(1920, 1920), 1);
});

test('scaleFactorFor: alvo maior que a captura nao escala (nunca aumenta)', () => {
  assert.equal(scaleFactorFor(1280, 1920), 1);
});

test('scaleFactorFor: 1920 -> 1280 e 1.5', () => {
  assert.equal(scaleFactorFor(1920, 1280), 1.5);
});

test('scaleFactorFor: 1920 -> 720 arredonda pro degrau mais proximo (3 -> 2.67)', () => {
  assert.equal(scaleFactorFor(1920, 720), 3);
});

test('scaleFactorFor: nunca passa de 4', () => {
  assert.equal(scaleFactorFor(4000, 200), 4);
});

test('scaleFactorFor: entrada invalida devolve 1, nao lanca', () => {
  for (const [c, t] of [[0, 100], [100, 0], [-1, 100], [NaN, 100], ['x', 'y']]) {
    assert.equal(scaleFactorFor(c, t), 1);
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/config.test.js
```

Esperado: FALHA com `scaleFactorFor is not a function`.

- [ ] **Passo 3: implementar em `config.js`** — antes de `const api = {`

```js
  // Degraus "redondos" pro scaleResolutionDownBy. O Chromium aceita
  // fracionario, mas valores redondos evitam artefato de reamostragem. O
  // encode escala DEPOIS da captura, entao a captura continua paga inteira
  // -- quem controla a captura e o piso global (via applyConstraints).
  const SCALE_STEPS = [1, 1.5, 2, 3, 4];

  function scaleFactorFor(captureWidth, targetWidth) {
    const cap = Number(captureWidth);
    const tgt = Number(targetWidth);
    if (!(cap > 0) || !(tgt > 0) || tgt >= cap) return 1;
    const raw = cap / tgt;
    let chosen = SCALE_STEPS[0];
    let best = Infinity;
    for (const s of SCALE_STEPS) {
      const d = Math.abs(s - raw);
      if (d < best) { best = d; chosen = s; }
    }
    return chosen;
  }
```

E no objeto `api`, junto de `videoConstraints`:

```js
    scaleFactorFor,
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/renderer/config.test.js
```

Esperado: os testes existentes + 6 novos passando (config.test.js).

- [ ] **Passo 5: `applyEncodingToPeer` em `mesh.js`**

Em `src/renderer/mesh.js`, logo **depois** da função `applyEncoding` (dentro de
`createMesh`):

```js
    /** Igual a applyEncoding, mas resolve UMA conexao (peerId + kind) e
     * tambem empurra a resolucao pra baixo no encoder via
     * scaleResolutionDownBy -- o piso global controla a captura, esta
     * funcao afina por-espectador a partir dele. `scaleDownBy` vem pronto
     * de quem chama (config.scaleFactorFor), pra este modulo nao depender
     * do config. */
    function applyEncodingToPeer(peerId, quality, kind, scaleDownBy) {
      const pc = peers.get(peerId)?.outConns[kind];
      if (!pc) return;
      for (const sender of pc.getSenders()) {
        if (!sender.track || sender.track.kind !== 'video') continue;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = quality.bitrate;
        params.encodings[0].maxFramerate = quality.fps;
        params.encodings[0].scaleResolutionDownBy = Number(scaleDownBy) > 0 ? Number(scaleDownBy) : 1;
        params.degradationPreference = 'maintain-framerate';
        sender.setParameters(params).catch(() => {});
      }
    }
```

E no objeto que `createMesh` retorna, junto de `applyEncoding`:

```js
      applyEncodingToPeer,
```

- [ ] **Passo 6: verificação**

```bash
npm test
```

Esperado: **202 testes passando** (196 + 6). `mesh.js` não ganha teste — a
lógica de *qual* fator vive em `config.test.js`; o resto é WebRTC puro.

- [ ] **Passo 7: commit**

```bash
git add src/renderer/config.js src/renderer/config.test.js src/renderer/mesh.js
git commit -m "feat(qualidade): scaleFactorFor e applyEncodingToPeer pra afinar uma conexao"
```

---

## Task 4: `receiveHealth` viaja no `view-state`

**Problema.** A `receiveHealth` de cada espectador precisa chegar em quem
transmite pra ele. O canal já existe: todo `view-state` carrega `encodeHealth`
(H2 da branch anterior). Falta calcular a `receiveHealth` no `updateStats` (que
já itera as conexões de entrada), guardar a amostra anterior por conexão pra
derivar a taxa, anexar no `view-state` de saída, e guardar a que chega no peer.

**Files:**
- Modify: `src/renderer/app.js` (`updateStats`, `broadcastViewState`, o envio
  de `view-state` da linha ~1415, `case 'view-state'`, nova
  `normalizeReceiveHealth`)

**Interfaces:**
- Consumes: `rxstats.receiveHealth` (Task 1).
- Produces: `peer.receiveHealth = { lossPct, freezeRate, softwareDecoder } | null`
  guardado por-peer, do mesmo jeito que `peer.encodeHealth`. Consumido pela Task 5.

- [ ] **Passo 1: estado e normalizador**

Perto dos outros `let` de estado em `app.js` (junto de `myEncodeHealth`):

```js
  // receiveHealth mais recente que CADA peer reportou sobre o stream que
  // mandamos pra ele. Chave 'peerId:kind'. Alimenta a escada por-peer
  // (Task 5). Espelha o papel de peer.encodeHealth, mas por-conexao porque
  // um peer pode receber tela e camera com saudes diferentes.
  const rxHealthByPeer = new Map();
  // Amostra anterior de readReceiverReport por 'peerId:kind', pra derivar a
  // taxa da janela (freezeCount e cumulativo).
  const rxPrevSample = new Map();
  let rxPrevAtMs = 0;
```

Junto de `normalizeEncodeHealth`:

```js
  // 'view-state' de cliente antigo nao traz receiveHealth: ausencia (ou
  // lixo) vira null -- o caso neutro da escada por-peer, nunca "saudavel".
  function normalizeReceiveHealth(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return {
      lossPct: num(raw.lossPct),
      freezeRate: num(raw.freezeRate),
      softwareDecoder: raw.softwareDecoder === true,
    };
  }
```

- [ ] **Passo 2: calcular no `updateStats`**

No `updateStats`, dentro do laço `for (const { peerId, kind } of activeMesh.receivingFrom())`,
**depois** de `const sample = rxstats.readReceiverReport(report);` e do
`if (!sample.framesDecoded) continue;`:

```js
      const rxKey = `${peerId}:${kind}`;
      const dt = rxPrevAtMs ? now - rxPrevAtMs : 0;
      const health = rxstats.receiveHealth(sample, rxPrevSample.get(rxKey), dt);
      rxPrevSample.set(rxKey, sample);
      if (health) rxHealthByPeer.set(rxKey, health);
```

E logo **antes** de `renderStats(rows, rxRows);` (fim do `updateStats`):

```js
    rxPrevAtMs = now;
```

Limpeza. Em `resetShareState()` (introduzida na branch anterior), limpar
tudo:

```js
    rxHealthByPeer.clear();
    rxPrevSample.clear();
```

E no handler que trata um peer saindo da sala (procure por onde
`mesh.removePeer` / `renderMembersPanel` são chamados por saída de peer — o
`case` que recebe o id do peer que saiu, aqui chamado `LEFT_ID`), remover só
as chaves daquele peer:

```js
    for (const k of rxHealthByPeer.keys()) if (k.startsWith(LEFT_ID + ':')) rxHealthByPeer.delete(k);
    for (const k of rxPrevSample.keys()) if (k.startsWith(LEFT_ID + ':')) rxPrevSample.delete(k);
```

(substitua `LEFT_ID` pela variável real — provavelmente `msg.id`.)

- [ ] **Passo 3: anexar no `view-state` de saída**

Em `broadcastViewState`, na linha que monta o `send`:

```js
      session.sig.send({
        type: 'view-state', to: peerId, kind, watching,
        encodeHealth: myEncodeHealth,
        receiveHealth: rxHealthByPeer.get(`${peerId}:${kind}`) || null,
      });
```

E no outro envio de `view-state` (o de `isAppVisible()` falso, linha ~1415):

```js
        if (!isAppVisible()) sig.send({
          type: 'view-state', to: msg.from, kind: msg.kind, watching: false,
          encodeHealth: myEncodeHealth,
          receiveHealth: rxHealthByPeer.get(`${msg.from}:${msg.kind}`) || null,
        });
```

- [ ] **Passo 4: guardar o que chega**

No `case 'view-state'`, junto de `vsPeer.encodeHealth = normalizeEncodeHealth(msg.encodeHealth);`:

```js
        if (vsPeer) vsPeer.receiveHealth = normalizeReceiveHealth(msg.receiveHealth);
```

- [ ] **Passo 5: verificação**

```bash
npm test
```

Esperado: **202 testes passando, sem mudança** — esta tarefa é fiação; a
lógica testável (`receiveHealth`) já foi coberta na Task 1.

Verificação manual (2 máquinas): com o DevTools do renderer aberto no
transmissor, `mesh.peers.get('<id>').receiveHealth` tem de virar um objeto
`{ lossPct, freezeRate, softwareDecoder }` poucos segundos depois de o
espectador entrar, e voltar a `null`/parar de atualizar quando ele sai.

- [ ] **Passo 6: commit**

```bash
git add src/renderer/app.js
git commit -m "feat(qualidade): receiveHealth do espectador viaja no view-state"
```

---

## Task 5: `peerQuality` — a escada por-peer fecha o laço

**Problema.** Agora que a `receiveHealth` chega e `applyEncodingToPeer` existe,
falta o laço: uma escada `peerquality` por conexão, tickada no `updateStats`
com os sinais daquele peer, e `reapplyAudienceQuality` passando a aplicar
`qualityForPeer` por conexão em vez de um preset só. E o M3: a escada **global**
para de fundir a saúde dos relays — a saúde ruim de um relay passa a degradar só
a conexão origem→relay, pelo mesmo caminho por-peer.

**Files:**
- Modify: `src/renderer/app.js` (`updateStats`, `qualityFor`/nova
  `qualityForPeer`, `reapplyAudienceQuality`, `flushPendingRelay`,
  `resetShareState`, `case 'peer-left'`)

**Interfaces:**
- Consumes: `peerquality.initialState/next` (Task 2),
  `config.scaleFactorFor` + `mesh.applyEncodingToPeer` (Task 3),
  `peer.receiveHealth` + `rxHealthByPeer` (Task 4), `sample.limitation` de
  `readSenderReport` (branch anterior).
- Produces: `qualityForPeer(peerId, kind) -> quality` (piso global + degraus
  daquele peer). Consumido pela Task 6.

- [ ] **Passo 1: estado**

Adicionar `peerquality` à desestruturação de `window.GoLive` no topo de
`app.js` (a linha `const { config, signaling, mesh: meshModule, ui, sound,
tree, queue, status, autoquality, rxstats } = window.GoLive;` — acrescentar
`, peerquality`).

Junto de `rxHealthByPeer` (Task 4):

```js
  // Escada de degradacao POR CONEXAO. Chave 'peerId:baseKind'. Parte do
  // piso global (qualityFor) e desce mais para quem esta sofrendo sozinho.
  // Zerada ao parar de compartilhar: os degraus descrevem uma conexao, nao
  // a nossa maquina.
  const peerQuality = new Map();
```

- [ ] **Passo 2: `qualityForPeer`**

Logo **depois** de `qualityFor` em `app.js`:

```js
  /** Qualidade efetiva para UM destinatario: o piso global (tamanho da
   * sala + malha degradada + escada automatica global) menos os degraus
   * que a conexao DELE pediu. Nunca sobe acima do piso. `kind` pode ser
   * composto ('screen@<origem>') quando somos relay -- a chave usa o
   * baseKind, porque um filho e um filho independente de quem origina. */
  function qualityForPeer(peerId, kind) {
    const floor = qualityFor(kind);
    const st = peerQuality.get(`${peerId}:${parseKind(kind).baseKind}`);
    const steps = st?.steps || 0;
    if (!steps) return floor;
    return config.qualityFromPreset(config.degradePreset(floor.preset, steps));
  }
```

- [ ] **Passo 3: `reapplyAudienceQuality` por-peer**

**Substituir** o corpo da função por:

```js
  function reapplyAudienceQuality() {
    if (!currentSession) return;
    const mesh = currentSession.mesh;

    if (localStream) {
      const floor = qualityFor('screen');

      // Espectadores diretos: uma escada por conexao.
      for (const peerId of mesh.peers.keys()) {
        const q = qualityForPeer(peerId, 'screen');
        mesh.applyEncodingToPeer(peerId, q, 'screen', config.scaleFactorFor(floor.width, q.width));
      }

      // Se formos relay de alguem: os filhos vivem sob kind composto.
      for (const [sourceId, state] of myRole.screen) {
        if (state.role !== 'relay') continue;
        const ck = mesh.relayKindFor ? mesh.relayKindFor('screen', sourceId) : `screen@${sourceId}`;
        for (const childId of state.filhosIds) {
          const q = qualityForPeer(childId, ck);
          mesh.applyEncodingToPeer(childId, q, ck, config.scaleFactorFor(floor.width, q.width));
        }
      }

      // A CAPTURA continua guiada pelo piso global -- ela e comum a todas as
      // conexoes, entao segue o denominador comum.
      const key = `${floor.width}x${floor.height}@${floor.fps}`;
      const track = localStream.getVideoTracks()[0];
      if (track && track.readyState === 'live' && key !== lastCaptureKey) {
        lastCaptureKey = key;
        track.applyConstraints(config.videoConstraints(floor)).catch((err) => {
          console.error('[qualidade] applyConstraints na captura falhou:', err);
        });
      }
    }

    if (cameraStream) mesh.applyEncoding(qualityFor('camera'), 'camera');
  }
```

(`relayKindFor` está no `api` de `mesh.js` mas não no objeto de `createMesh` —
o fallback `` `screen@${sourceId}` `` cobre isso sem precisar exportá-lo de
novo. Se preferir, adicione `relayKindFor` ao return de `createMesh` e use só
ele.)

- [ ] **Passo 4: tick da escada no `updateStats` + M3**

No `updateStats`, **substituir** o bloco `if (localStream) { … relayHealths …
autoQuality = autoquality.next(…) … }` por:

```js
    if (localStream) {
      // M3: a escada GLOBAL reage so a NOSSA saude de encode. Antes ela
      // fundia a saude dos relays -- mas isso derrubava os espectadores
      // DIRETOS da origem quando era o relay que sofria. Agora a saude
      // ruim de um relay chega como receiveHealth/encodeHealth no
      // view-state DELE e degrada so a conexao origem->relay, pela escada
      // por-peer abaixo.
      const before = autoQuality.steps;
      autoQuality = autoquality.next(autoQuality, {
        atMs: now,
        health: autoquality.worstHealth([myEncodeHealth]),
      });
      if (autoQuality.steps !== before) {
        console.log(`[qualidade] escada global: ${before} -> ${autoQuality.steps} degraus`);
        reapplyAudienceQuality();
      }

      // Escada POR CONEXAO. Sinais: banda (das nossas proprias stats de
      // envio) e a receiveHealth que o peer reportou.
      const limByPeer = new Map();
      for (const r of rows) limByPeer.set(`${r.peerId}:${r.kind}`, r.limitation);

      let anyPeerChanged = false;
      const targets = new Set();
      for (const peerId of activeMesh.peers.keys()) targets.add(`${peerId}:screen`);
      for (const [sourceId, state] of myRole.screen) {
        if (state.role !== 'relay') continue;
        for (const childId of state.filhosIds) targets.add(`${childId}:screen`);
      }

      for (const key of targets) {
        const [peerId] = key.split(':');
        const peer = activeMesh.peers.get(peerId);
        const st = peerQuality.get(key) || peerquality.initialState();
        const nextSt = peerquality.next(st, {
          atMs: now,
          // `limByPeer` so tem chaves 'peerId:screen' e 'peerId:camera' --
          // o laco de senders do updateStats itera ['screen','camera'], nao
          // os kinds compostos de relay. Consequencia: pra um FILHO de
          // relay, senderBandwidthLimited nunca dispara e a adaptacao dele
          // depende so da receiveHealth (CPU + travas). Cobertura completa
          // do filho de relay exige o laco de stats de relay da branch
          // parqueada feat/orcamento-banda-relay; ate la, isto e o que da.
          senderBandwidthLimited: limByPeer.get(`${peerId}:screen`) === 'bandwidth',
          receiveHealth: peer?.receiveHealth || null,
        });
        if (nextSt.steps !== st.steps) {
          anyPeerChanged = true;
          console.log(`[qualidade] escada de ${peer?.name || peerId}: ${st.steps} -> ${nextSt.steps} degraus`);
        }
        peerQuality.set(key, nextSt);
      }
      if (anyPeerChanged) reapplyAudienceQuality();
    }
```

- [ ] **Passo 5: relay usa `qualityForPeer` por filho**

Em `flushPendingRelay`, **substituir** `const quality = qualityFor(kind);` e o
laço por:

```js
    for (const childId of state.filhosIds) {
      if (state.relayed.has(childId)) continue;
      const ok = await session.mesh.relayTo(childId, sourcePeerId, kind, qualityForPeer(childId, kind));
      if (ok) state.relayed.add(childId);
    }
```

(Onde a branch parqueada `feat/orcamento-banda-relay` for mesclada, o preset por
filho passa a ser o **menor** entre `qualityForPeer(childId, kind)` e
`config.qualityForRelay(...)`. Registrar isso como TODO no comentário se aquela
branch ainda não entrou.)

- [ ] **Passo 6: limpeza**

Em `resetShareState()`:

```js
    peerQuality.clear();
```

No mesmo handler de saída de peer usado na Task 4 (junto da limpeza de
`rxHealthByPeer`):

```js
    for (const k of peerQuality.keys()) if (k.startsWith(LEFT_ID + ':')) peerQuality.delete(k);
```

- [ ] **Passo 7: verificação**

```bash
npm test
```

Esperado: **202 testes passando, sem mudança** — fiação. Se algum teste de
`autoquality`/`app`-adjacente quebrar por causa do M3, **pare e reporte**: o M3
é uma reversão deliberada de comportamento e nenhum teste unitário devia
depender da fusão de saúde de relay (ela era feita inline no `app.js`, sem
teste).

Verificação manual — esta tarefa não vale sem ela. 3 máquinas: A transmite,
B e C assistem. Estrangular **só** o C (throttle de CPU "6x slowdown" no
DevTools do C, ou perda de pacote no link do C com Clumsy/`tc`):

1. Em ~3 s: log `[qualidade] escada de C: 0 -> 1 degraus` no console de A.
2. A `resolução` que **C** recebe (aba Estatísticas do C, tabela "Recebendo")
   cai; a que **B** recebe **não muda**.
3. Soltar o estrangulamento do C: em ~20 s sobe de volta, um degrau por vez.
4. Repetir com A como relay (sala de 4, C atrás do relay): o degrau tem de
   valer na conexão relay→C, sem afetar os outros filhos do relay.

- [ ] **Passo 8: commit**

```bash
git add src/renderer/app.js
git commit -m "feat(qualidade): laco fechado por espectador, e a escada global para de fundir a saude dos relays"
```

---

## Task 6: a tag de preset no painel de membros

**Problema.** Quando estamos mandando um preset menor pra alguém, não há sinal
disso na interface de quem transmite. O selo do cabeçalho (Task 1 da branch
anterior) é global. A degradação por-peer aparece como uma tag pequena e neutra
na linha daquele membro.

**Files:**
- Modify: `src/renderer/ui.js` (`buildMemberRow`, `renderMembers`)
- Modify: `src/renderer/app.js` (`renderMembersPanel` passa o mapa de tags)
- Modify: `src/renderer/style.css` (`.member-quality-tag`)

**Interfaces:**
- Consumes: `qualityForPeer` + `peerQuality` (Task 5).
- Produces: `ui.members.render(peers, self, qualityTags)` com
  `qualityTags = Map<peerId, string>` (preset efetivo, ex.: `'720p30'`; ausente
  quando não há degradação).

- [ ] **Passo 1: `buildMemberRow` aceita a tag**

Em `src/renderer/ui.js`, na assinatura de `buildMemberRow`:

```js
  function buildMemberRow({ id, name, avatar, borderClass, live, isSelf, pulsing, qualityTag }) {
```

E no `li.innerHTML`, logo **depois** do `<span class="peer-name">…</span>`:

```js
      ${qualityTag ? `<span class="member-quality-tag" title="Enviando este preset menor porque a conexão dele não está aguentando">${escapeHtml(qualityTag)}</span>` : ''}
```

- [ ] **Passo 2: `renderMembers` recebe e distribui**

Assinatura:

```js
  function renderMembers(peers, self, qualityTags) {
```

Na chamada de `buildMemberRow` do laço `for (const peer of peers.values())`,
acrescentar o prop:

```js
          qualityTag: qualityTags?.get(peer.id) || '',
```

E no export do fim do arquivo, a linha continua `members: { render: renderMembers }`
(a assinatura mudou, o nome não).

- [ ] **Passo 3: `app.js` monta o mapa**

Em `renderMembersPanel`:

```js
  function renderMembersPanel() {
    const session = displaySession();
    const tags = new Map();
    if (session && localStream) {
      for (const peerId of session.mesh.peers.keys()) {
        const st = peerQuality.get(`${peerId}:screen`);
        if (st?.steps > 0) tags.set(peerId, qualityForPeer(peerId, 'screen').preset);
      }
    }
    ui.members.render(session ? session.mesh.peers : new Map(), currentSelfInfo(), tags);
    renderRoomStatus();
  }
```

- [ ] **Passo 4: o CSS**

Em `src/renderer/style.css`, junto das regras de `.peer-name` / linha de membro:

```css
/* Preset menor que estamos mandando pra ESTE espectador porque a conexao
   dele nao esta aguentando. Neutro de proposito -- nao e um alerta nem um
   estado "ao vivo", so um dado. Ver a regra do tema no topo. */
.member-quality-tag {
  font-size: 11px;
  color: var(--text-2);
  background: var(--surface-3);
  border-radius: var(--r-full);
  padding: 1px var(--s-2);
  white-space: nowrap;
  flex: none;
}
```

- [ ] **Passo 5: verificação**

```bash
npm test
```

Esperado: **203 testes passando, sem mudança.**

Manual (continuação do cenário da Task 5): quando a escada do C desce, a linha
do **C** no painel "Na sala" de A ganha a tag `720p30`; a do B não. A tag some
quando o C se recupera.

- [ ] **Passo 6: commit**

```bash
git add src/renderer/ui.js src/renderer/app.js src/renderer/style.css
git commit -m "feat(ui): tag de preset por espectador no painel de membros"
```

---

## Ordem e dependências

```
Task 1 (receiveHealth)  ─┐
Task 2 (peerquality.js) ─┼─> Task 4 (view-state) ─> Task 5 (laco fechado) ─> Task 6 (tag)
Task 3 (scaleFactor +    ┘                                   ^
        applyEncodingToPeer) ──────────────────────────────────┘
```

Tasks 1, 2 e 3 são independentes entre si (podem ir em paralelo). A verificação
manual só vale a partir da Task 5. A Task 6 é cosmética.

## Contagem de testes esperada

| Depois da tarefa | Testes |
|---|---|
| base (`feat/transmissao-honesta` mesclada) | 176 |
| 1 | 183 |
| 2 | 196 |
| 3 | 202 |
| 4, 5, 6 | 202 |
