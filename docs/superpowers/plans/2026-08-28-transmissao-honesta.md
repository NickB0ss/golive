# Transmissão honesta — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa.
> Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** fazer o app dizer a verdade sobre a própria transmissão e reagir a
ela — estado visível no cabeçalho, degradação em laço fechado com a
telemetria que já é coletada, degradação que também vale na captura, áudio
em estéreo, latência menor e um jeito de pausar sem sair do jogo.

**Architecture:** toda lógica nova nasce em módulo puro do renderer
(`status.js`, `autoquality.js`, `rxstats.js`, funções novas em `mesh.js`),
com teste em `node --test`; `app.js` só chama. O laço de qualidade fecha
dentro do `updateStats` que já roda a cada segundo: ele passa a alimentar
uma escada com histerese, cuja saída entra no `qualityFor` existente como
degraus adicionais — o mesmo caminho por onde a degradação por tamanho de
sala já passa. Nenhuma renegociação nova: `setParameters` e
`applyConstraints` mudam o encode e a captura com a conexão de pé.

**Tech Stack:** Electron 32, JavaScript sem build step, WebRTC do Chromium,
`node --test`, zero dependências novas.

## Global Constraints

Valem para **todas** as tarefas. Um reviewer deve tratar violação como
defeito.

1. **Comentários em português, sem acentos**, no estilo do arquivo em que
   você está mexendo: explicam *por que*, não *o quê*. Texto visível ao
   usuário (UI, toasts, rótulos) **usa** acentos normalmente.
2. **Testes com `node --test`**, sem framework novo. Arquivo de teste ao
   lado do módulo (`x.js` → `x.test.js`), e o módulo termina com
   `if (typeof module !== 'undefined') module.exports = api;`.
3. **Nenhuma dependência npm nova.** Nem de produção, nem de dev.
4. **`src/renderer/app.js` não tem testes** (DOM + WebRTC puro, sem
   harness). Lógica nova testável vai em módulo separado e `app.js` apenas
   chama. Nunca "teste" `app.js` com mocks improvisados.
5. **Todo módulo novo do renderer** segue o IIFE dos existentes:
   `(function (root) { … root.GoLive.<nome> = api; if (typeof module !== 'undefined') module.exports = api; })(typeof window !== 'undefined' ? window : global);`
   e precisa de uma tag `<script>` em `src/renderer/index.html` **antes**
   de `app.js`.
6. **`npm test` tem de passar inteiro** — a base deste plano é **136
   testes passando**. Nenhum teste existente pode ser afrouxado ou
   deletado para uma mudança passar. Se um teste existente conflita com a
   tarefa, pare e reporte.
7. **Um commit por tarefa** (ou poucos, coerentes), mensagem no estilo do
   repositório: `feat(escopo): …`, `fix(escopo): …`, `docs: …`, em
   português, sem acentos, minúsculas depois do prefixo.
8. **Não mexa em arquivos fora do escopo da sua tarefa.** Não reformate,
   não renomeie, não "arrume de passagem".
9. **A regra do tema é lei:** cor saturada (`--live`) significa uma coisa
   só — alguém está ao vivo. Degradado é `--warn`, quebrado é `--danger`.
   Nada de `backdrop-filter`/blur em lugar nenhum. Ver
   `Decisões/golive - acento reservado a ao vivo, sem blur no redesign`.

## Fora deste plano

Cada um destes pede seu próprio plano e **não** deve ser encostado aqui:
transferência de sala quando o host cai (F3), clipes e print do tile,
janela espectadora sempre no topo, notificação nativa de "fulano ficou ao
vivo", acessibilidade/ARIA (F1), subir o Electron (B1), extrair a
orquestração de `app.js` (D1).

Fica de fora também, mas por dúvida e não por escopo: trocar o
`contentHint = 'motion'` por `'detail'` quando a fonte é uma **janela**
(`src/renderer/app.js:1796` e `src/renderer/mesh.js:467`). `'motion'` está
certo para jogo e errado para texto, e o app já sabe distinguir
(`isWindowSource`) — mas ninguém compartilha só um tipo de coisa, e
compartilhar a *janela* de um jogo é comum. Trocar por heurística de tipo de
fonte pode piorar o caso principal para melhorar o secundário. Se virar
tarefa um dia, o critério tem de ser medido (fps de captura observado), não
adivinhado pela origem da fonte.

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/renderer/status.js` (novo) | derivar `{ level, label }` do cabeçalho a partir do estado da sala. Puro. | 1 |
| `src/renderer/autoquality.js` (novo) | escada de degradação com histerese + pior saúde de encode da sala. Puro. | 2 |
| `src/renderer/rxstats.js` (novo) | ler um relatório `getStats` de **recepção** e derivar perda, congelamentos e buffer. Puro. | 5 |
| `src/renderer/mesh.js` | `withOpusParams` (novo, puro), `inStatsFor` (novo), `jitterBufferTarget` no `track` | 4, 5, 6 |
| `src/renderer/app.js` | fiação: chama os módulos, decide quando | 1–7 |
| `src/renderer/ui.js` | `stageHeader.setStatus`, tabela de recepção nas Estatísticas | 1, 5 |
| `src/renderer/index.html` | selo no cabeçalho, botão de pausa, `<script>` dos módulos novos | 1, 5, 7 |
| `src/renderer/style.css` | estados do ponto, selo, botão de pausa | 1, 7 |
| `src/main.js`, `src/preload.js` | atalho global e o IPC dele | 7 |

---

## Task 1: o cabeçalho diz o estado da sala

**Problema.** O `#stage-status-dot` (`src/renderer/index.html:79`) é pintado
de `background: var(--live)` numa regra estática (`src/renderer/style.css:541`)
e **nenhuma linha de JS toca nele** — fica ciano por você estar numa sala,
mesmo sem ninguém transmitindo. É o único elemento da interface que gasta o
acento sem significar transmissão, contra a regra do próprio tema. E o outro
lado do problema: os estados degradados que a branch de robustez criou
(preset caído pelo tamanho da sala, malha degradada, sessão órfã
reconectando) só aparecem como toast de alguns segundos — quem chega meio
minuto depois não tem como saber por que está em 1080p30.

**Files:**
- Create: `src/renderer/status.js`
- Test: `src/renderer/status.test.js`
- Modify: `src/renderer/index.html` (selo + `<script>`), `src/renderer/style.css:541`,
  `src/renderer/ui.js:794` (`setStageHeader`), `src/renderer/app.js`

**Interfaces:**
- Produces: `GoLive.status.roomStatus(state) -> { level, label }`, com
  `level` em `'offline' | 'idle' | 'live' | 'degraded' | 'reconnecting'` e
  `label` string (vazia quando não há nada a dizer). Entrada:
  `{ inRoom, reconnecting, weAreLive, anyoneLive, presetDegraded, meshFallback, softwareEncoder, effectivePreset }`.
- Produces: `ui.stageHeader.setStatus({ level, label })`.
- Consumido por: Task 2 (que passa a alimentar `presetDegraded` também com
  os degraus automáticos) e Task 7 (que usa `renderRoomStatus`).

### Parte A — o módulo puro

- [ ] **Passo 1: escrever o teste que falha** — `src/renderer/status.test.js`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomStatus } = require('./status');

const BASE = {
  inRoom: true,
  reconnecting: false,
  weAreLive: false,
  anyoneLive: false,
  presetDegraded: false,
  meshFallback: false,
  softwareEncoder: false,
  effectivePreset: '1080p60',
};

test('sem sala nao ha estado nenhum -- o ponto fica apagado', () => {
  assert.deepEqual(roomStatus({ ...BASE, inRoom: false }), { level: 'offline', label: '' });
});

test('na sala com ninguem transmitindo o acento NAO acende', () => {
  assert.equal(roomStatus(BASE).level, 'idle');
});

test('alguem ao vivo em qualidade cheia acende o acento, sem rotulo', () => {
  assert.deepEqual(roomStatus({ ...BASE, anyoneLive: true }), { level: 'live', label: '' });
});

test('reconectando vence qualquer outro estado', () => {
  const s = roomStatus({ ...BASE, reconnecting: true, anyoneLive: true, weAreLive: true, softwareEncoder: true });
  assert.equal(s.level, 'reconnecting');
  assert.match(s.label, /reconectando/i);
});

test('degradacao so conta quando quem transmite somos NOS', () => {
  // Assistindo alguem cujo encoder sofre: nao temos como saber, e nao e o
  // nosso problema de qualidade -- continua 'live'.
  const s = roomStatus({ ...BASE, anyoneLive: true, weAreLive: false, softwareEncoder: true, presetDegraded: true });
  assert.equal(s.level, 'live');
});

test('transmitindo degradado vira nivel degraded com preset e motivo', () => {
  const s = roomStatus({ ...BASE, anyoneLive: true, weAreLive: true, presetDegraded: true, effectivePreset: '1080p30' });
  assert.equal(s.level, 'degraded');
  assert.equal(s.label, '1080p30 · sala cheia');
});

test('precedencia dos motivos: encoder vence malha, malha vence sala', () => {
  const live = { ...BASE, anyoneLive: true, weAreLive: true, effectivePreset: '720p30' };
  assert.match(roomStatus({ ...live, softwareEncoder: true, meshFallback: true, presetDegraded: true }).label, /encoder/);
  assert.match(roomStatus({ ...live, meshFallback: true, presetDegraded: true }).label, /retransmissor/);
  assert.match(roomStatus({ ...live, presetDegraded: true }).label, /sala cheia/);
});

test('transmitindo sem degradacao nenhuma nao inventa rotulo', () => {
  assert.deepEqual(roomStatus({ ...BASE, anyoneLive: true, weAreLive: true }), { level: 'live', label: '' });
});

test('entrada indefinida nao lanca -- isto roda no caminho de render', () => {
  assert.equal(roomStatus(undefined).level, 'offline');
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/status.test.js
```

Esperado: FALHA com `Cannot find module './status'`.

- [ ] **Passo 3: escrever o módulo** — `src/renderer/status.js`

```js
'use strict';

(function (root) {
  // Rotulos sao texto de UI, entao levam acento -- ao contrario dos
  // comentarios deste arquivo.
  const REASON_LABELS = {
    encoder: 'encoder em software',
    malha: 'sem retransmissor',
    sala: 'sala cheia',
  };

  // Precedencia: encoder em software e a causa mais grave (a imagem esta
  // sendo codificada pela CPU agora); malha degradada vem antes do tamanho
  // da sala porque ela JA embute o degrau do tamanho da sala -- ver
  // qualityFor em app.js.
  function degradeReason(state) {
    if (state.softwareEncoder) return 'encoder';
    if (state.meshFallback) return 'malha';
    if (state.presetDegraded) return 'sala';
    return null;
  }

  /** Estado do cabecalho da sala, derivado. Nao toca no DOM: quem chama
   * decide o que fazer com { level, label }.
   *
   *   'offline'      -- sem sessao nenhuma
   *   'reconnecting' -- sinalizacao caida com a midia viva (H1)
   *   'degraded'     -- NOS estamos transmitindo abaixo do preset escolhido
   *   'live'         -- alguem esta ao vivo, sem degradacao conhecida
   *   'idle'         -- na sala, ninguem transmitindo
   *
   * A regra do tema mora aqui: o acento (--live) so pode ser pintado em
   * 'live'. 'degraded' e --warn, 'reconnecting' e --warn pulsando, e
   * 'idle'/'offline' sao neutros -- estar numa sala nao e transmissao.
   *
   * Degradacao so e reportada quando weAreLive: a saude de encode de quem
   * transmite PRA NOS nao chega ate aqui, e chutar seria pior que calar.
   */
  function roomStatus(state) {
    const s = state || {};
    if (!s.inRoom) return { level: 'offline', label: '' };
    if (s.reconnecting) return { level: 'reconnecting', label: 'reconectando…' };
    if (!s.anyoneLive) return { level: 'idle', label: '' };

    const reason = s.weAreLive ? degradeReason(s) : null;
    if (!reason) return { level: 'live', label: '' };

    const preset = s.effectivePreset ? `${s.effectivePreset} · ` : '';
    return { level: 'degraded', label: `${preset}${REASON_LABELS[reason]}` };
  }

  const api = { roomStatus, degradeReason, REASON_LABELS };

  root.GoLive = root.GoLive || {};
  root.GoLive.status = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/renderer/status.test.js
```

Esperado: 9 testes passando.

### Parte B — o cabeçalho

- [ ] **Passo 5: o selo no HTML**

Em `src/renderer/index.html`, dentro de `#stage-header`, logo **depois** de
`<span id="stage-room-address">`:

```html
<span id="stage-status-badge" class="stage-status-badge hidden"></span>
```

E o script novo, **antes** de `app.js` (a ordem importa, `app.js` lê
`GoLive.status` na carga):

```html
<script src="status.js"></script>
```

- [ ] **Passo 6: os estados no CSS**

Em `src/renderer/style.css`, **substituir** a linha 541 inteira por:

```css
/* O ponto e um indicador de ESTADO, nao decoracao: ele so recebe o acento
   quando alguem esta de fato ao vivo. Ver a regra do tema no topo do
   arquivo -- antes disto ele era pintado de --live fixo e ficava aceso por
   voce estar numa sala. */
.stage-status-dot {
  width: 8px; height: 8px; border-radius: var(--r-full);
  background: var(--text-3); flex: none;
  transition: background var(--t-tint) var(--ease-move);
}
.stage-status-dot[data-level="live"] { background: var(--live); }
.stage-status-dot[data-level="degraded"] { background: var(--warn); }
.stage-status-dot[data-level="reconnecting"] {
  background: var(--warn);
  animation: status-dot-pulse 1.4s var(--ease-move) infinite;
}

/* prefers-reduced-motion ja e tratado pelo bloco global do topo do arquivo
   (animation-duration e iteration-count forcados), entao nao ha regra extra
   aqui. */
@keyframes status-dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.stage-status-badge {
  font-size: 12px;
  color: var(--warn);
  background: var(--warn-dim);
  border-radius: var(--r-full);
  padding: 2px var(--s-2);
  white-space: nowrap;
}
```

- [ ] **Passo 7: a API do cabeçalho em `ui.js`**

Em `src/renderer/ui.js`, junto de `stageRoomAddressEl` (linha ~792):

```js
  const stageStatusDotEl = $('stage-status-dot');
  const stageStatusBadgeEl = $('stage-status-badge');

  // Recebe o { level, label } ja derivado por status.js -- esta funcao nao
  // decide nada, so pinta. data-level e o que o CSS le.
  function setStageStatus({ level, label }) {
    stageStatusDotEl.dataset.level = level || 'offline';
    stageStatusBadgeEl.textContent = label || '';
    stageStatusBadgeEl.classList.toggle('hidden', !label);
  }
```

E exportar no objeto do fim do arquivo (linha ~1246):

```js
    stageHeader: { set: setStageHeader, clear: clearStageHeader, setStatus: setStageStatus },
```

- [ ] **Passo 8: a fiação em `app.js`**

Perto do topo, junto dos outros atalhos de módulo:

```js
  const status = window.GoLive.status;
```

Uma função nova, logo **depois** de `renderMembersPanel` (linha ~766):

```js
  /** Traduz o estado espalhado do app pro { level, label } do cabecalho.
   * Ponto unico: qualquer coisa que mude transmissao, sala ou qualidade
   * termina chamando isto. */
  function renderRoomStatus() {
    const session = displaySession();
    const live = Boolean(localStream)
      || Array.from(session?.mesh.peers.values() ?? []).some((p) => p.live);
    const effective = qualityFor('screen');
    ui.stageHeader.setStatus(status.roomStatus({
      inRoom: Boolean(session),
      // orphanSession so existe quando a sinalizacao caiu com a midia
      // viva -- e exatamente o estado "reconectando" (H1).
      reconnecting: Boolean(orphanSession),
      weAreLive: Boolean(localStream),
      anyoneLive: live,
      presetDegraded: effective.preset !== cfg.quality.preset,
      meshFallback: Boolean(meshFallback.screen),
      softwareEncoder: Boolean(myEncodeHealth?.softwareEncoder),
      effectivePreset: effective.preset,
    }));
  }
```

Chamar `renderRoomStatus()` em quatro lugares:

1. na última linha de `renderMembersPanel()` — cobre `peer-joined`,
   `peer-left`, `broadcast-state`, `startShare` e `stopShare`, que já
   chamam essa função;
2. no fim de `updateStats()`, depois de `updateEncoderWarning(rows)` — é o
   que faz o selo reagir a encoder em software;
3. no fim de `setMeshFallback()`;
4. onde a sessão órfã é criada e onde ela é descartada (H1), para o estado
   "reconectando" aparecer e sumir.

- [ ] **Passo 9: verificação**

```bash
npm test
```

Esperado: **145 testes passando** (136 + 9).

Verificação manual (a única que prova o item, porque `app.js` não tem
harness):

1. `npm start`, criar uma sala, **não** compartilhar nada → o ponto tem de
   estar **cinza**, sem selo. (Antes desta tarefa ele ficava ciano.)
2. Compartilhar a tela → ponto **ciano**, sem selo.
3. Com 3+ pessoas na sala → ponto **âmbar** e selo `1080p30 · sala cheia`,
   e o selo **permanece** (não some como o toast).
4. Fechar o app do host → ponto âmbar **pulsando** com `reconectando…`
   enquanto os vídeos continuam.

- [ ] **Passo 10: commit**

```bash
git add src/renderer/status.js src/renderer/status.test.js src/renderer/index.html src/renderer/style.css src/renderer/ui.js src/renderer/app.js
git commit -m "feat(ui): ponto de status dirigido por estado e selo permanente de degradacao"
```

---

## Task 2: laço fechado — a qualidade reage à telemetria

**Problema.** O H4 entregou metade do que a auditoria pedia. A qualidade cai
com o **tamanho da sala** (`config.audienceSteps`, `src/renderer/config.js:82`),
mas `qualityLimitationReason: "cpu"` e encoder em software continuam virando
**texto** (`updateEncoderWarning`, `src/renderer/app.js:2553`) — exatamente o
que a auditoria criticou. A contagem de espectadores é um proxy cego para os
dois casos que quebraram em produção: a máquina fraca e o jogo pesado.

E com a árvore ligada, **a origem é o pior lugar para medir**: ela roda 1
encoder e parece saudável enquanto o relay, que roda 2, derrete. Por isso o
gatilho é a pior saúde entre a **nossa** e a dos **relays** — que o app já
recebe: `peer.encodeHealth` é gravado no `view-state` (`src/renderer/app.js:1395`)
e hoje só serve para eleger relay (`src/renderer/tree.js:28`).

**Files:**
- Create: `src/renderer/autoquality.js`
- Test: `src/renderer/autoquality.test.js`
- Modify: `src/renderer/index.html` (`<script>`), `src/renderer/app.js`
  (`qualityFor`, `updateStats`, `stopShare`)

**Interfaces:**
- Consumes: `GoLive.config.degradePreset(preset, steps)` e
  `GoLive.config.qualityForAudience(preset, viewers)` (já existem);
  `renderRoomStatus()` da Task 1.
- Produces:
  - `GoLive.autoquality.initialState() -> { steps, badRun, goodSinceMs }`
  - `GoLive.autoquality.next(state, sample, opts) -> state` com
    `sample = { atMs, health }` e `health = { softwareEncoder, msPerFrame } | null`
  - `GoLive.autoquality.worstHealth(list) -> health | null`
  - `GoLive.autoquality.LIMITS = { MAX_AUTO_STEPS, BAD_SAMPLES_TO_DEGRADE, GOOD_MS_TO_RECOVER, BUDGET_MS_60 }`

- [ ] **Passo 1: escrever o teste que falha** — `src/renderer/autoquality.test.js`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialState, next, worstHealth, LIMITS } = require('./autoquality');

const OK = { softwareEncoder: false, msPerFrame: 4 };
const RUIM = { softwareEncoder: false, msPerFrame: 40 };
const SOFTWARE = { softwareEncoder: true, msPerFrame: 2 };

// Aplica varias amostras em sequencia, 1s entre elas (a cadencia real do
// updateStats com a janela visivel).
function run(state, healths, startMs = 0) {
  let s = state;
  healths.forEach((health, i) => {
    s = next(s, { atMs: startMs + i * 1000, health });
  });
  return s;
}

test('uma amostra ruim isolada nao degrada -- picos acontecem', () => {
  assert.equal(run(initialState(), [RUIM]).steps, 0);
});

test('amostras ruins seguidas o bastante descem um degrau e zeram a corrida', () => {
  const s = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(RUIM));
  assert.equal(s.steps, 1);
  assert.equal(s.badRun, 0);
});

test('uma amostra boa no meio zera a corrida de ruins', () => {
  const s = run(initialState(), [RUIM, RUIM, OK, RUIM, RUIM]);
  assert.equal(s.steps, 0);
});

test('encoder em software e ruim mesmo com msPerFrame baixo', () => {
  assert.equal(run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(SOFTWARE)).steps, 1);
});

test('saude ausente nao conta como ruim -- ausencia nao e diagnostico', () => {
  assert.equal(run(initialState(), [null, null, null, null, null]).steps, 0);
});

test('a escada tem teto', () => {
  const muitas = Array(LIMITS.BAD_SAMPLES_TO_DEGRADE * (LIMITS.MAX_AUTO_STEPS + 3)).fill(RUIM);
  assert.equal(run(initialState(), muitas).steps, LIMITS.MAX_AUTO_STEPS);
});

test('so sobe de volta depois da folga continua inteira', () => {
  const degradado = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(RUIM));
  const t0 = LIMITS.BAD_SAMPLES_TO_DEGRADE * 1000;

  const cedo = next(degradado, { atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER - 1, health: OK });
  assert.equal(cedo.steps, 1, 'nao pode subir antes da folga completa');

  const naHora = next(cedo, { atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER + 1, health: OK });
  assert.equal(naHora.steps, 0);
});

test('uma amostra ruim durante a espera cancela a recuperacao', () => {
  const degradado = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(RUIM));
  const t0 = LIMITS.BAD_SAMPLES_TO_DEGRADE * 1000;

  let s = next(degradado, { atMs: t0 + 1000, health: OK });
  s = next(s, { atMs: t0 + 2000, health: RUIM });
  s = next(s, { atMs: t0 + 3000, health: OK });
  // A folga recomecou do zero em t0+3000, entao no instante em que teria
  // subido pela contagem antiga ela ainda nao pode subir.
  s = next(s, { atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER + 1000, health: OK });
  assert.equal(s.steps, 1);
});

test('worstHealth: software vence qualquer msPerFrame', () => {
  assert.equal(worstHealth([OK, SOFTWARE, RUIM]).softwareEncoder, true);
});

test('worstHealth: sem software, vence o maior msPerFrame', () => {
  assert.equal(worstHealth([OK, RUIM]).msPerFrame, 40);
});

test('worstHealth: lista vazia ou so de nulos devolve null', () => {
  assert.equal(worstHealth([]), null);
  assert.equal(worstHealth([null, null]), null);
});

test('worstHealth ignora entradas invalidas sem lancar', () => {
  assert.equal(worstHealth([null, undefined, OK]).msPerFrame, 4);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/autoquality.test.js
```

Esperado: FALHA com `Cannot find module './autoquality'`.

- [ ] **Passo 3: escrever o módulo** — `src/renderer/autoquality.js`

```js
'use strict';

(function (root) {
  // Teto de degraus que a telemetria pode pedir sozinha. Dois degraus a
  // partir de 1080p60 chegam em 720p30 (ver QUALITY_DEGRADE_CHAIN em
  // config.js); abaixo disso a imagem deixa de servir pro que o app existe,
  // e o problema passou a ser outro -- maquina que nao aguenta transmitir.
  const MAX_AUTO_STEPS = 2;

  // Amostras ruins SEGUIDAS antes de descer. updateStats roda a cada 1s com
  // a janela visivel: sao ~3s de sofrimento continuo, nao um pico isolado
  // (um alt-tab ou uma tela de carregamento produzem picos o tempo todo).
  const BAD_SAMPLES_TO_DEGRADE = 3;

  // Folga CONTINUA antes de subir de volta. Assimetrico de proposito:
  // descer e barato e reversivel; subir cedo demais recria o regime que
  // quebrou e a escada vira um oscilador.
  const GOOD_MS_TO_RECOVER = 30000;

  // Orcamento de encode por quadro a 60fps, somando todos os senders --
  // mesmo numero que a aba Estatisticas ja usa como limiar.
  const BUDGET_MS_60 = 16.6;

  const LIMITS = { MAX_AUTO_STEPS, BAD_SAMPLES_TO_DEGRADE, GOOD_MS_TO_RECOVER, BUDGET_MS_60 };

  /** Saude ausente NAO e ruim: quem nao reportou nada nao esta acusado.
   * Mesmo criterio neutro que tree.js usa pra eleger relay. */
  function isBad(health, budgetMs) {
    if (!health) return false;
    if (health.softwareEncoder === true) return true;
    return typeof health.msPerFrame === 'number' && health.msPerFrame > budgetMs;
  }

  /** Pior saude de uma lista (a nossa + a dos relays). Encoder em software e
   * pior que qualquer msPerFrame: e um degrau de categoria, nao de grau. */
  function worstHealth(list) {
    let worst = null;
    for (const h of list || []) {
      if (!h || typeof h !== 'object') continue;
      if (!worst) {
        worst = { softwareEncoder: h.softwareEncoder === true, msPerFrame: h.msPerFrame ?? null };
        continue;
      }
      worst.softwareEncoder = worst.softwareEncoder || h.softwareEncoder === true;
      if (typeof h.msPerFrame === 'number' && (worst.msPerFrame == null || h.msPerFrame > worst.msPerFrame)) {
        worst.msPerFrame = h.msPerFrame;
      }
    }
    return worst;
  }

  function initialState() {
    return { steps: 0, badRun: 0, goodSinceMs: null };
  }

  /** Avanca a escada com UMA amostra. Puro: mesma entrada, mesma saida --
   * o relogio entra por sample.atMs, nao por Date.now(). */
  function next(state, sample, opts) {
    const o = opts || {};
    const budgetMs = o.budgetMs ?? BUDGET_MS_60;
    const maxSteps = o.maxSteps ?? MAX_AUTO_STEPS;
    const badToDegrade = o.badSamplesToDegrade ?? BAD_SAMPLES_TO_DEGRADE;
    const goodMsToRecover = o.goodMsToRecover ?? GOOD_MS_TO_RECOVER;

    const prev = state || initialState();
    const atMs = Number(sample?.atMs) || 0;

    if (isBad(sample?.health, budgetMs)) {
      const badRun = prev.badRun + 1;
      // goodSinceMs zera: a folga tem de ser CONTINUA pra valer.
      if (badRun >= badToDegrade && prev.steps < maxSteps) {
        return { steps: prev.steps + 1, badRun: 0, goodSinceMs: null };
      }
      return { steps: prev.steps, badRun, goodSinceMs: null };
    }

    const goodSinceMs = prev.goodSinceMs ?? atMs;
    if (prev.steps > 0 && atMs - goodSinceMs >= goodMsToRecover) {
      // Sobe UM degrau e reinicia a contagem: recuperar dois degraus leva
      // dois periodos de folga, pelo mesmo motivo de nao subir com pressa.
      return { steps: prev.steps - 1, badRun: 0, goodSinceMs: atMs };
    }
    return { steps: prev.steps, badRun: 0, goodSinceMs };
  }

  const api = { initialState, next, worstHealth, isBad, LIMITS };

  root.GoLive = root.GoLive || {};
  root.GoLive.autoquality = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/renderer/autoquality.test.js
```

Esperado: 12 testes passando.

- [ ] **Passo 5: ligar no `app.js`**

`<script src="autoquality.js"></script>` em `index.html`, antes de `app.js`.
E em `app.js`:

```js
  const autoquality = window.GoLive.autoquality;

  // Escada de degradacao automatica da TELA, alimentada pela telemetria de
  // encode em updateStats. Zerada ao parar de compartilhar: os degraus
  // descrevem uma transmissao especifica, nao a maquina.
  let autoQuality = autoquality.initialState();
```

**Substituir** o corpo de `qualityFor` (linha ~243) por:

```js
  function qualityFor(kind) {
    const baseKind = parseKind(kind).baseKind;
    if (baseKind === 'camera') return { ...cfg.camera, codec: 'video/VP8' };

    const effective = config.qualityForAudience(cfg.quality.preset, audienceSize());
    // Dois degraus somam sobre o que o tamanho da sala ja pediu:
    //  - malha degradada (H3): a origem paga N encoders em vez de 1;
    //  - escada automatica: a telemetria disse que nao esta dando conta.
    // degradePreset para no piso e nunca lanca, entao isto e seguro no
    // caminho de encode.
    const extraSteps = (meshFallback[baseKind] ? 1 : 0) + autoQuality.steps;
    if (!extraSteps) return effective;
    return config.qualityFromPreset(config.degradePreset(effective.preset, extraSteps));
  }
```

- [ ] **Passo 6: fechar o laço no `updateStats`**

Em `app.js`, logo **depois** da linha `myEncodeHealth = summarizeOwnEncodeHealth(rows);`:

```js
    // Laco fechado (a metade do H4 que faltava). O gatilho e a PIOR saude
    // entre a nossa e a dos relays: com a arvore ligada a origem roda 1
    // encoder e parece saudavel enquanto o relay, que roda 2, derrete.
    if (localStream) {
      const relayHealths = [];
      for (const [peerId, assignment] of originTree.screen.assignments) {
        if (assignment.role !== 'relay') continue;
        const health = activeMesh.peers.get(peerId)?.encodeHealth;
        if (health) relayHealths.push(health);
      }
      const before = autoQuality.steps;
      autoQuality = autoquality.next(autoQuality, {
        atMs: now,
        health: autoquality.worstHealth([myEncodeHealth, ...relayHealths]),
      });
      if (autoQuality.steps !== before) {
        console.log(`[qualidade] escada automatica: ${before} -> ${autoQuality.steps} degraus`);
        reapplyAudienceQuality();
      }
    }
```

`reapplyAudienceQuality()` já reaplica `qualityFor` nas conexões abertas via
`setParameters` — nada de renegociação nem de tela preta.

- [ ] **Passo 7: zerar ao parar**

Em `stopShare()`, junto de `stopStatsLoop()`:

```js
    autoQuality = autoquality.initialState();
```

- [ ] **Passo 8: verificação**

```bash
npm test
```

Esperado: **157 testes passando** (145 + 12).

Verificação manual — esta tarefa não vale sem ela:

1. `npm start`, compartilhar 1080p60, abrir Configurações > Estatísticas.
2. Forçar o encoder a sofrer: abrir um jogo pesado, **ou** compartilhar com
   3+ espectadores, até a linha `encoder` mostrar `software (CPU)` ou o
   `ms/quadro` passar de 16,6.
3. Em ~3 s a linha de log `[qualidade] escada automatica: 0 -> 1 degraus`
   tem de aparecer (Configurações > Estatísticas > "Abrir pasta de logs"),
   a `resolução` no painel tem de cair, e o selo da Task 1 tem de aparecer
   dizendo `encoder em software`.
4. Fechar o jogo e esperar 30 s de folga: a escada sobe um degrau de volta,
   uma vez só.

- [ ] **Passo 9: commit**

```bash
git add src/renderer/autoquality.js src/renderer/autoquality.test.js src/renderer/index.html src/renderer/app.js
git commit -m "feat(qualidade): escada automatica alimentada pela telemetria de encode da sala"
```

---

## Task 3: a degradação vale também na captura

**Problema.** `reapplyAudienceQuality` (`src/renderer/app.js:266`) mexe só em
`maxBitrate`/`maxFramerate` via `setParameters`. O comentário logo acima
registra a limitação como consciente: o `getDisplayMedia` continua entregando
1920x1080@60, e cada encoder recebe 60 quadros por segundo para jogar fora o
que não cabe. O custo de captura e de escala fica pago por inteiro, justo na
máquina que já está sem sobra. `applyConstraints` reconfigura o capturador
sem renegociação e sem tela preta — o app já faz isso uma vez, na captura
(`src/renderer/app.js:1797`).

**Files:**
- Modify: `src/renderer/app.js` (`reapplyAudienceQuality` e o comentário
  acima dela, `startShare`, `stopShare`)

**Interfaces:**
- Consumes: `config.videoConstraints(quality)` e `qualityFor('screen')`
  (com os degraus da Task 2 já embutidos).

- [ ] **Passo 1: substituir a função e o comentário**

Trocar o comentário "Limitacao consciente: o preset de CAPTURA
(getDisplayMedia) nao muda no meio da transmissao…" e a função inteira por:

```js
  /** Reaplica o teto de encode E o formato da captura nas conexoes abertas
   * daquele kind. `applyEncoding` mexe em maxBitrate/maxFramerate via
   * setParameters; `applyConstraints` reconfigura o proprio capturador --
   * os dois sem renegociacao e sem tela preta.
   *
   * Sem a parte da captura, degradar so fazia o encoder DESCARTAR quadros
   * que a captura continuava produzindo a 1080p60: o custo de capturar e
   * escalar ficava pago inteiro, na maquina que ja nao esta dando conta.
   *
   * lastCaptureKey existe porque recomputeTree chama isto varias vezes por
   * evento de sala, e reconfigurar o capturador com o MESMO formato pode
   * custar um solavanco de imagem a toa. */
  let lastCaptureKey = '';

  function reapplyAudienceQuality() {
    if (!currentSession) return;
    if (localStream) {
      const quality = qualityFor('screen');
      currentSession.mesh.applyEncoding(quality, 'screen');

      const key = `${quality.width}x${quality.height}@${quality.fps}`;
      const track = localStream.getVideoTracks()[0];
      if (track && track.readyState === 'live' && key !== lastCaptureKey) {
        lastCaptureKey = key;
        track.applyConstraints(config.videoConstraints(quality)).catch((err) => {
          // Falhar aqui nao e fatal: o teto de encode ja foi aplicado acima
          // e a transmissao segue -- so nao economizamos a captura.
          console.error('[qualidade] applyConstraints na captura falhou:', err);
        });
      }
    }
    if (cameraStream) currentSession.mesh.applyEncoding(qualityFor('camera'), 'camera');
  }
```

- [ ] **Passo 2: manter a chave em dia**

Em `startShare`, logo depois de `localStream = stream;` (o `getDisplayMedia`
acabou de aplicar esse formato — registrar isso evita um `applyConstraints`
redundante no primeiro recálculo da árvore):

```js
      lastCaptureKey = `${cfg.quality.width}x${cfg.quality.height}@${cfg.quality.fps}`;
```

Em `stopShare()`, junto da linha que zera `autoQuality`:

```js
    lastCaptureKey = '';
```

- [ ] **Passo 3: verificação**

```bash
npm test
```

Esperado: **157 testes passando**, sem mudança — esta tarefa é fiação de
WebRTC, sem lógica nova testável (a lógica de *qual* formato usar já é
coberta por `config.test.js`).

Verificação manual, que é o que prova a tarefa:

1. `npm start`, compartilhar 1080p60 com 1 espectador. Em Configurações >
   Estatísticas, a linha `resolução` mostra `1920x1080`.
2. Fazer a sala passar de 3 pessoas.
3. A `resolução` continua `1920x1080` mas o **fps cai para 30** (o degrau
   de 1080p60 é 1080p30 — só o fps muda). Descer mais um degrau (jogo
   pesado, Task 2) tem de levar a `1280x720`.
4. **Olhar a prévia local no momento da troca**: um solavanco curto é
   esperado; se piscar preto por mais de um quadro, reportar — nesse caso a
   troca de formato deve acontecer só quando a resolução muda, não quando
   só o fps muda.

- [ ] **Passo 4: commit**

```bash
git add src/renderer/app.js
git commit -m "fix(qualidade): degradar tambem a captura, nao so o teto de encode"
```

---

## Task 4: áudio em estéreo, com bitrate declarado

**Problema.** Em `offerTo` (`src/renderer/mesh.js:311`) a track de áudio entra
sem `sendEncodings`, e o SDP só é editado na seção de **vídeo** —
`withStartBitrate` casa `m=video` e ignora o resto (`src/renderer/mesh.js:84`).
Sem `stereo=1;sprop-stereo=1;maxaveragebitrate=…` no fmtp do Opus, o Chromium
manda mono no padrão, mesmo com a captura nativa entregando estéreo de
verdade (`src/renderer/pcm-injector-worklet.js:23`). Para um app que existe
para assistir amigo jogar, som achatado em mono é das coisas mais
perceptíveis — e a folha paga isso duas vezes, porque `relayTo` repassa a
stream inteira e o áudio é transcodificado Opus→Opus no relay.

Estéreo se negocia dos **dois** lados: só editar a oferta não basta, a
resposta (`handleOffer`, `src/renderer/mesh.js:341`, que hoje manda o
`createAnswer` cru) também precisa declarar.

**Files:**
- Modify: `src/renderer/mesh.js` (nova `withOpusParams`, uso em `offerTo` e
  `handleOffer`, export)
- Test: `src/renderer/mesh.test.js`

**Interfaces:**
- Produces: `GoLive.mesh.withOpusParams(sdp, { maxAverageBitrate }) -> sdp`.
  Idempotente: chamar duas vezes não duplica parâmetro.

- [ ] **Passo 1: escrever os testes que falham**

Acrescentar ao fim de `src/renderer/mesh.test.js`. O `SDP` de exemplo do topo
do arquivo já tem uma seção de áudio com opus e fmtp — reaproveitar. Incluir
`withOpusParams` na desestruturação do `require('./mesh')` no topo do
arquivo, junto de `withStartBitrate`.

```js
// Opus sem linha a=fmtp: o Chromium normalmente manda uma, mas nada na
// spec obriga -- e o caminho de CRIAR a linha precisa de teste igual.
const SDP_SEM_FMTP_OPUS = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=rtpmap:96 VP8/90000',
].join('\r\n');

test('opus: estereo e bitrate entram no fmtp existente', () => {
  const out = withOpusParams(SDP, { maxAverageBitrate: 160000 });
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=160000/);
});

test('opus: cria o fmtp logo depois do rtpmap quando nao existe', () => {
  const out = withOpusParams(SDP_SEM_FMTP_OPUS, { maxAverageBitrate: 160000 }).split('\r\n');
  const i = out.indexOf('a=rtpmap:111 opus/48000/2');
  assert.equal(out[i + 1], 'a=fmtp:111 stereo=1;sprop-stereo=1;maxaveragebitrate=160000');
});

test('opus: nao toca na secao de video', () => {
  const out = withOpusParams(SDP, { maxAverageBitrate: 160000 });
  assert.match(out, /a=fmtp:98 level-asymmetry-allowed=1;profile-level-id=42e01f(\r\n|$)/);
  assert.doesNotMatch(out, /a=fmtp:9[68] .*stereo/);
});

test('opus: idempotente -- duas passadas nao duplicam parametro', () => {
  const uma = withOpusParams(SDP, { maxAverageBitrate: 160000 });
  const duas = withOpusParams(uma, { maxAverageBitrate: 160000 });
  assert.equal(uma, duas);
});

test('opus: sdp sem opus volta identico', () => {
  const semOpus = SDP.replace('a=rtpmap:111 opus/48000/2', 'a=rtpmap:111 PCMU/8000');
  assert.equal(withOpusParams(semOpus, { maxAverageBitrate: 160000 }), semOpus);
});

test('opus: preserva a quebra de linha do sdp original', () => {
  assert.ok(withOpusParams(SDP, {}).includes('\r\n'));
  assert.ok(!withOpusParams(SDP.replace(/\r\n/g, '\n'), {}).includes('\r'));
});

test('opus: convive com o start bitrate de video na mesma sdp', () => {
  const out = withOpusParams(withStartBitrate(SDP, 6000), {});
  assert.match(out, /a=fmtp:98 .*x-google-start-bitrate=6000/);
  assert.match(out, /a=fmtp:111 .*stereo=1/);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/mesh.test.js
```

Esperado: FALHA com `withOpusParams is not a function`.

- [ ] **Passo 3: implementar**

Em `src/renderer/mesh.js`, logo **depois** de `withStartBitrate` (a estrutura
é deliberadamente a mesma: uma passada para descobrir payloads, outra para
reescrever):

```js
  // Bitrate medio de audio, em bits/s. 160 kbps e transparente o bastante
  // pra som de jogo e musica em estereo, e e ruido perto dos 12 Mbps de
  // video do preset de topo.
  const OPUS_MAX_AVERAGE_BITRATE = 160000;

  // O Chromium so manda Opus em estereo se o fmtp declarar -- e declarar
  // vale pros DOIS lados: `stereo` diz o que aceitamos receber,
  // `sprop-stereo` diz o que vamos mandar. Sem isto o audio sai mono no
  // padrao, mesmo com a captura nativa entregando estereo de verdade
  // (ver pcm-injector-worklet.js). Como relayTo repassa a stream inteira,
  // a folha paga o mono duas vezes: ha um transcode Opus->Opus no relay.
  //
  // Idempotente de proposito: a mesma SDP pode passar por aqui duas vezes
  // e nao pode acumular parametro.
  function withOpusParams(sdp, opts) {
    if (!sdp) return sdp;
    const maxAverageBitrate = opts?.maxAverageBitrate ?? OPUS_MAX_AVERAGE_BITRATE;
    const wanted = [
      ['stereo', '1'],
      ['sprop-stereo', '1'],
      ['maxaveragebitrate', String(maxAverageBitrate)],
    ];

    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);

    // Primeira passada: quais payloads sao opus, e quais ja tem a=fmtp.
    const opusPts = new Set();
    const withFmtp = new Set();
    let inAudio = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inAudio = line.startsWith('m=audio');
      if (!inAudio) continue;
      const rtpmap = /^a=rtpmap:(\d+) opus\//i.exec(line);
      if (rtpmap) opusPts.add(rtpmap[1]);
      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp) withFmtp.add(fmtp[1]);
    }
    if (!opusPts.size) return sdp;

    const out = [];
    inAudio = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inAudio = line.startsWith('m=audio');
      if (!inAudio) {
        out.push(line);
        continue;
      }

      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp && opusPts.has(fmtp[1])) {
        let updated = line;
        for (const [key, value] of wanted) {
          if (!new RegExp(`[; ]${key}=`, 'i').test(updated)) updated += `;${key}=${value}`;
        }
        out.push(updated);
        continue;
      }

      out.push(line);

      const rtpmap = /^a=rtpmap:(\d+) opus\//i.exec(line);
      if (rtpmap && !withFmtp.has(rtpmap[1])) {
        out.push(`a=fmtp:${rtpmap[1]} ${wanted.map(([k, v]) => `${k}=${v}`).join(';')}`);
      }
    }

    return out.join(eol);
  }
```

Exportar na linha do `api` (fim do arquivo):

```js
  const api = { createMesh, withStartBitrate, withOpusParams, startBitrateKbps, relayKindFor, parseKind, RTC_CONFIG };
```

- [ ] **Passo 4: usar nos dois lados da negociação**

Em `offerTo`, trocar o `setLocalDescription` por:

```js
      const offer = await pc.createOffer();
      await pc.setLocalDescription({
        type: offer.type,
        sdp: withOpusParams(withStartBitrate(offer.sdp, startBitrateKbps(quality.bitrate))),
      });
```

Em `handleOffer`, trocar o `setLocalDescription(answer)` por:

```js
      const answer = await pc.createAnswer();
      // Estereo se negocia dos dois lados: sem declarar aqui tambem, o par
      // cai pra mono mesmo com a oferta pedindo estereo.
      await pc.setLocalDescription({ type: answer.type, sdp: withOpusParams(answer.sdp) });
```

- [ ] **Passo 5: rodar e ver passar**

```bash
npm test
```

Esperado: **164 testes passando** (157 + 7).

Verificação manual — é o que confirma a premissa, que hoje é só leitura de
código:

1. Duas máquinas na sala, compartilhando tela **com som**.
2. Tocar algo com separação estéreo clara (jogo com som posicional, ou
   música) e confirmar que o espectador ouve os dois canais diferentes.
   Depois da Task 5 dá para conferir a linha de áudio no painel de
   recepção; antes dela, o teste possível é auditivo.
3. Registrar o resultado na nota
   `Decisões/golive - degradar em laço fechado, e o estado no cabeçalho` —
   ela está "em aberto" justamente esperando esta medida.

- [ ] **Passo 6: commit**

```bash
git add src/renderer/mesh.js src/renderer/mesh.test.js
git commit -m "feat(audio): opus em estereo com bitrate declarado nos dois lados da sdp"
```

---

## Task 5: estatísticas do lado de quem recebe

**Problema.** `getStats` só é lido para `outbound-rtp` (`readSenderReport`,
`src/renderer/app.js:2362`). Não existe **uma linha** de `inbound-rtp` no
projeto inteiro. Quem reclama de travamento é o espectador — e é justamente
de quem não há dado nenhum, então "é a minha internet ou é ele?" não tem
resposta. Esta tarefa também é a ferramenta de medição da Task 6.

**Files:**
- Create: `src/renderer/rxstats.js`
- Test: `src/renderer/rxstats.test.js`
- Modify: `src/renderer/mesh.js` (`inStatsFor`), `src/renderer/index.html`
  (`<script>`), `src/renderer/app.js` (coleta e render)

**Interfaces:**
- Produces:
  - `GoLive.rxstats.readReceiverReport(report) -> sample`, com
    `sample = { fps, width, height, packetsLost, packetsReceived, freezeCount, framesDecoded, jitterBufferDelay, jitterBufferEmittedCount, decoder, codec }`
  - `GoLive.rxstats.lossPercent(sample) -> number | null`
  - `GoLive.rxstats.jitterBufferMs(sample) -> number | null`
- Produces: `mesh.inStatsFor(peerId, kind) -> Promise<RTCStatsReport | null>`
- `report` é qualquer objeto com `forEach` — `RTCStatsReport` tem, e um
  `Array` também, que é como os testes o simulam.

- [ ] **Passo 1: escrever o teste que falha** — `src/renderer/rxstats.test.js`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readReceiverReport, lossPercent, jitterBufferMs } = require('./rxstats');

// RTCStatsReport e um Map-like com forEach -- um Array serve de duble.
const REPORT = [
  { type: 'inbound-rtp', kind: 'video', framesPerSecond: 58, frameWidth: 1920, frameHeight: 1080,
    packetsReceived: 10000, packetsLost: 25, freezeCount: 2, framesDecoded: 3400,
    jitterBufferDelay: 6.4, jitterBufferEmittedCount: 3400, decoderImplementation: 'ExternalDecoder' },
  { type: 'inbound-rtp', kind: 'audio', packetsReceived: 5000, packetsLost: 1 },
  { type: 'codec', mimeType: 'video/H264' },
  { type: 'outbound-rtp', kind: 'video', framesPerSecond: 12 },
];

test('le so o inbound-rtp de video', () => {
  const s = readReceiverReport(REPORT);
  assert.equal(s.fps, 58);
  assert.equal(s.width, 1920);
  assert.equal(s.framesDecoded, 3400);
  assert.equal(s.decoder, 'ExternalDecoder');
  assert.equal(s.codec, 'H264');
});

test('nao confunde audio nem outbound com o video recebido', () => {
  const s = readReceiverReport(REPORT);
  assert.equal(s.packetsReceived, 10000, 'o audio nao pode somar aqui');
});

test('perda em porcentagem do total oferecido', () => {
  const s = readReceiverReport(REPORT);
  // 25 perdidos de 10025 oferecidos
  assert.ok(Math.abs(lossPercent(s) - 0.2494) < 0.001);
});

test('perda e null quando nada chegou -- zero por cento seria mentira', () => {
  assert.equal(lossPercent(readReceiverReport([])), null);
});

test('buffer de jitter em ms por quadro emitido', () => {
  // 6.4s / 3400 quadros = ~1.88ms
  assert.ok(Math.abs(jitterBufferMs(readReceiverReport(REPORT)) - 1.882) < 0.01);
});

test('buffer e null sem quadro emitido, nao zero', () => {
  assert.equal(jitterBufferMs(readReceiverReport([])), null);
});

test('relatorio vazio nao lanca', () => {
  const s = readReceiverReport([]);
  assert.equal(s.fps, 0);
  assert.equal(s.freezeCount, 0);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/rxstats.test.js
```

Esperado: FALHA com `Cannot find module './rxstats'`.

- [ ] **Passo 3: escrever o módulo** — `src/renderer/rxstats.js`

```js
'use strict';

(function (root) {
  /** Le um relatorio de getStats de UMA conexao de ENTRADA e devolve os
   * campos que respondem a pergunta do espectador: "esta travando pra mim,
   * e a culpa e de quem?".
   *
   * Espelha readSenderReport (app.js), do outro lado do fio. Aqui vive num
   * modulo separado, e nao em app.js, porque app.js nao tem harness de
   * teste -- ver a restricao 4 do plano. */
  function readReceiverReport(report) {
    const sample = {
      fps: 0,
      width: 0,
      height: 0,
      packetsReceived: 0,
      packetsLost: 0,
      freezeCount: 0,
      framesDecoded: 0,
      // Acumulados desde o inicio da conexao: a RAZAO entre os dois e que
      // tem significado (segundos de buffer por quadro emitido).
      jitterBufferDelay: 0,
      jitterBufferEmittedCount: 0,
      decoder: '',
      codec: '',
    };

    report.forEach((stat) => {
      if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
        sample.fps = Math.max(sample.fps, stat.framesPerSecond || 0);
        sample.width = stat.frameWidth || sample.width;
        sample.height = stat.frameHeight || sample.height;
        sample.packetsReceived += stat.packetsReceived || 0;
        sample.packetsLost += stat.packetsLost || 0;
        sample.freezeCount += stat.freezeCount || 0;
        sample.framesDecoded += stat.framesDecoded || 0;
        sample.jitterBufferDelay += stat.jitterBufferDelay || 0;
        sample.jitterBufferEmittedCount += stat.jitterBufferEmittedCount || 0;
        if (stat.decoderImplementation) sample.decoder = stat.decoderImplementation;
      }
      if (stat.type === 'codec' && stat.mimeType?.startsWith('video/')) {
        sample.codec = stat.mimeType.split('/')[1];
      }
    });

    return sample;
  }

  /** Perda sobre o total OFERECIDO (recebidos + perdidos). null quando nada
   * chegou: dizer "0% de perda" pra uma conexao muda seria mentira. */
  function lossPercent(sample) {
    const offered = (sample?.packetsReceived || 0) + (sample?.packetsLost || 0);
    if (!offered) return null;
    return ((sample.packetsLost || 0) / offered) * 100;
  }

  /** Quanto tempo o quadro medio esperou no buffer, em ms. E a latencia que
   * o app pode reduzir sozinho -- ver jitterBufferTarget em mesh.js. */
  function jitterBufferMs(sample) {
    if (!sample?.jitterBufferEmittedCount) return null;
    return (sample.jitterBufferDelay / sample.jitterBufferEmittedCount) * 1000;
  }

  const api = { readReceiverReport, lossPercent, jitterBufferMs };

  root.GoLive = root.GoLive || {};
  root.GoLive.rxstats = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/renderer/rxstats.test.js
```

Esperado: 7 testes passando.

- [ ] **Passo 5: acesso às conexões de entrada**

Em `src/renderer/mesh.js`, ao lado de `statsFor`:

```js
    /** Igual a statsFor, mas da conexao de ENTRADA daquele kind -- e por
     * onde o espectador enxerga a propria recepcao. */
    async function inStatsFor(peerId, kind = 'screen') {
      const pc = peers.get(peerId)?.inConns[kind];
      if (!pc || pc.connectionState !== 'connected') return null;
      return pc.getStats();
    }
```

e acrescentar `inStatsFor` ao objeto devolvido por `createMesh`.

- [ ] **Passo 6: coletar e mostrar**

`<script src="rxstats.js"></script>` em `index.html`, antes de `app.js`.
Em `app.js`, `const rxstats = window.GoLive.rxstats;` junto dos outros
módulos, e dentro de `updateStats`, **antes** de `renderStats(rows)`:

```js
    // Do outro lado do fio: o que estamos RECEBENDO. receivingFrom ja
    // enumera os pares (peerId, kind) das conexoes de entrada.
    const rxRows = [];
    for (const { peerId, kind } of activeMesh.receivingFrom()) {
      if (currentSession !== session) return;
      const report = await activeMesh.inStatsFor(peerId, kind);
      if (!report) continue;
      const sample = rxstats.readReceiverReport(report);
      if (!sample.framesDecoded) continue;
      rxRows.push({
        peerId,
        kind,
        name: activeMesh.peers.get(peerId)?.name || `#${peerId}`,
        ...sample,
        loss: rxstats.lossPercent(sample),
        bufferMs: rxstats.jitterBufferMs(sample),
      });
    }
```

e passar `rxRows` para o render: `renderStats(rows, rxRows)`. Em
`renderStats`, depois da tabela existente, acrescentar uma segunda quando
`rxRows.length`:

```js
    const rxHtml = !rxRows.length ? '' : `
      <h4 class="stats-subtitle">Recebendo</h4>
      <table class="stats-table">
        <tr><th>de</th><th>fps</th><th>resolução</th><th>perda</th><th>travadas</th><th>buffer</th></tr>
        ${rxRows.map((r) => `
          <tr>
            <td>${esc(r.name)}</td>
            <td>${r.fps}</td>
            <td>${r.width}x${r.height}</td>
            <td class="${r.loss != null && r.loss > 1 ? 'warn-text' : ''}">${r.loss != null ? `${r.loss.toFixed(2)}%` : '-'}</td>
            <td class="${r.freezeCount > 0 ? 'warn-text' : ''}">${r.freezeCount}</td>
            <td>${r.bufferMs != null ? `${r.bufferMs.toFixed(0)} ms` : '-'}</td>
          </tr>`).join('')}
      </table>`;
```

concatenando `rxHtml` no `setStatsHtml` existente. Reaproveite as classes de
tabela que a aba já usa — não invente estilo novo.

- [ ] **Passo 7: verificação**

```bash
npm test
```

Esperado: **171 testes passando** (164 + 7).

Manual: duas máquinas, uma compartilhando. Na **espectadora**, abrir
Configurações > Estatísticas: a seção "Recebendo" tem de listar uma linha
com fps, resolução, perda, travadas e buffer. **Anotar o valor de `buffer`
em ms** — é a linha de base da Task 6.

- [ ] **Passo 8: commit**

```bash
git add src/renderer/rxstats.js src/renderer/rxstats.test.js src/renderer/mesh.js src/renderer/index.html src/renderer/app.js
git commit -m "feat(stats): painel do lado de quem recebe (perda, travadas, buffer)"
```

---

## Task 6: buffer de jitter menor — a latência que a árvore paga em dobro

**Problema.** Nada no renderer toca `jitterBufferTarget`. Numa LAN virtual o
Chromium mantém o buffer dimensionado para internet aberta, e com a árvore a
folha paga esse atraso **duas vezes** (origem→relay→folha), somado ao
decode+encode do relay. Para comentar o que a pessoa está jogando, isso se
sente.

**Files:**
- Modify: `src/renderer/mesh.js` (`makeConnection`, listener de `track`)

**Interfaces:**
- Consumes: a tabela "Recebendo" da Task 5, que é como se mede o efeito.

- [ ] **Passo 1: aplicar no receptor**

Em `src/renderer/mesh.js`, junto das outras constantes do topo:

```js
  // Alvo de buffer de jitter dos receptores, em ms. O padrao do Chromium e
  // dimensionado pra internet aberta e custa ~100-200ms por hop -- com a
  // arvore, a folha paga isso DUAS vezes (origem->relay->folha). Isto e um
  // ALVO, nao um teto: se a rede exigir, o Chromium sobe sozinho.
  const JITTER_BUFFER_TARGET_MS = 50;
```

e dentro do listener de `track` (`dir === 'in'`, linha ~198), antes do
`onTrack`:

```js
          // Nem toda versao do Chromium expoe isto; sem a propriedade, o
          // padrao continua valendo e nada quebra.
          try {
            if (event.receiver && 'jitterBufferTarget' in event.receiver) {
              event.receiver.jitterBufferTarget = JITTER_BUFFER_TARGET_MS;
            }
          } catch {
            /* receptor ja fechado, ou propriedade somente-leitura nesta versao */
          }
```

- [ ] **Passo 2: verificação**

```bash
npm test
```

Esperado: **171 testes passando**, sem mudança.

Manual, comparando com a linha de base anotada na Task 5:

1. Mesma sala, mesma dupla de máquinas, mesmo preset.
2. Na espectadora, Configurações > Estatísticas > "Recebendo": o `buffer`
   tem de cair em relação ao valor anotado.
3. Confirmar que `travadas` (freezeCount) **não** subiu — se subir, o alvo
   está agressivo demais para essa rede e o valor tem de ir para 100 ms.
4. Testar também numa **folha** (sala de 4, atrás de um relay), que é onde
   o ganho deveria ser maior.
5. Registrar os dois números na nota
   `Decisões/golive - degradar em laço fechado, e o estado no cabeçalho`.

- [ ] **Passo 3: commit**

```bash
git add src/renderer/mesh.js
git commit -m "perf(latencia): alvo de buffer de jitter menor nos receptores"
```

---

## Task 7: pausar a transmissão, com atalho global

**Problema.** Hoje só existe "parar de compartilhar", que fecha tudo e obriga
a escolher a fonte de novo. Não há como esconder a tela por dez segundos para
digitar uma senha ou ler uma mensagem. E quem transmite está com o jogo em
fullscreen por cima: **o app não registra nenhum `globalShortcut`**, então
não existe forma de operar o GoLive sem alt-tab.

A máquina para pausar já está escrita e testada: `setPeerDemand`
(`src/renderer/mesh.js:490`) faz `replaceTrack(null)`, libera o encoder na
hora, não exige renegociação e religa custando um quadro — é o encode sob
demanda do F1.3.

**Files:**
- Modify: `src/main.js` (registrar/desregistrar o atalho),
  `src/preload.js` (ponte), `src/renderer/app.js` (pausa e o gate do
  `view-state`), `src/renderer/index.html` (botão),
  `src/renderer/style.css` (só se o estado pausado precisar de `--warn`)

**Interfaces:**
- Consumes: `mesh.setPeerDemand(peerId, kind, wanted, track)`,
  `parseKind(kind)` e `renderRoomStatus()` (Task 1).
- Produces: IPC `shortcut:toggle-pause` do main para o renderer, exposto
  como `window.golive.onShortcut(callback)`.

- [ ] **Passo 1: o atalho no processo principal**

Em `src/main.js`, acrescentar `globalShortcut` ao require do topo, e dentro
de `app.whenReady().then(() => { … })`:

```js
  // Quem transmite passa a maior parte do tempo com o jogo em fullscreen por
  // cima: sem atalho global nao existe como pausar a transmissao sem
  // alt-tab, que em fullscreen exclusivo custa um engasgo. Falha de registro
  // (outro app ja tomou a combinacao) nao pode derrubar a inicializacao --
  // so vira log, e o botao da UI continua valendo.
  const atalhoOk = globalShortcut.register('Control+Alt+P', () => {
    if (win && !win.isDestroyed()) win.webContents.send('shortcut:toggle-pause');
  });
  if (!atalhoOk) logger.error('atalho global Control+Alt+P nao pode ser registrado');
```

e um handler novo de ciclo de vida, junto do `window-all-closed`:

```js
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
```

- [ ] **Passo 2: a ponte no preload**

Em `src/preload.js`, dentro do objeto exposto:

```js
  /** Atalhos globais disparados pelo processo principal (funcionam com a
   * janela atras do jogo). Hoje so 'toggle-pause'. */
  onShortcut: (callback) =>
    ipcRenderer.on('shortcut:toggle-pause', () => callback('toggle-pause')),
```

- [ ] **Passo 3: pausar e religar no renderer**

Em `src/renderer/app.js`, junto das outras variáveis de estado:

```js
  // Pausa da transmissao: a tela continua capturada e as conexoes de pe, so
  // param de receber quadro. Diferente de parar de compartilhar, que fecha
  // tudo e obriga a escolher a fonte de novo.
  let sharePaused = false;
```

e as funções:

```js
  function setSharePaused(paused) {
    if (!localStream || sharePaused === paused) return;
    sharePaused = paused;
    const track = localStream.getVideoTracks()[0] || null;
    const session = currentSession || orphanSession;
    for (const peerId of session?.mesh.peers.keys() ?? []) {
      // `!paused` como demanda: religar entrega a track de volta pros
      // MESMOS senders que foram suspensos (ver setPeerDemand).
      session.mesh.setPeerDemand(peerId, 'screen', !paused, track);
    }
    $('btn-pause-share').classList.toggle('active', paused);
    showToast(paused ? 'Transmissão pausada — ninguém está vendo sua tela.' : 'Transmissão retomada.');
    renderMembersPanel();
    renderRoomStatus();
  }

  $('btn-pause-share').addEventListener('click', () => setSharePaused(!sharePaused));
  window.golive.onShortcut(() => setSharePaused(!sharePaused));
```

**E o gate no `view-state`** — sem isto, o primeiro espectador que avisar
"estou assistindo" religa a tela que você acabou de pausar. No
`case 'view-state'` (`src/renderer/app.js:1389`), antes do `setPeerDemand`:

```js
        // Pausa manual manda mais que a demanda do espectador: enquanto
        // pausado, 'watching: true' nao pode religar o encode da tela.
        const wanted = Boolean(msg.watching)
          && !(sharePaused && parseKind(msg.kind).baseKind === 'screen');
```

usando `wanted` no lugar de `Boolean(msg.watching)` na chamada de
`mesh.setPeerDemand`.

Em `stopShare()`, junto de `autoQuality = autoquality.initialState();`:

```js
    sharePaused = false;
    $('btn-pause-share').classList.remove('active');
    $('btn-pause-share').classList.add('hidden');
```

e em `startShare`, junto de `$('btn-toggle-share').classList.add('active')`:

```js
      $('btn-pause-share').classList.remove('hidden');
```

- [ ] **Passo 4: o botão**

Em `src/renderer/index.html`, dentro de `.user-panel-actions`, **antes** de
`#btn-toggle-share`:

```html
<button id="btn-pause-share" class="icon-btn hidden" title="Pausar transmissão (Ctrl+Alt+P)" type="button">
  <svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="4" height="14" rx="1"/><rect x="13" y="5" width="4" height="14" rx="1"/></svg>
</button>
```

O CSS de `.icon-btn` e `.icon-btn.active` já existe — não crie regra nova a
menos que o botão pausado precise de `--warn`, e nesse caso use o token, não
uma cor solta.

- [ ] **Passo 5: verificação**

```bash
npm test
```

Esperado: **171 testes passando**, sem mudança — não há lógica nova pura
nesta tarefa; o `setPeerDemand` que ela usa já é coberto por `mesh.test.js`.

Manual, com duas máquinas:

1. Compartilhar a tela e confirmar que o espectador vê.
2. Clicar em pausar → o espectador vê o último quadro congelar (não a janela
   sumir), e o `saída total` da aba Estatísticas do transmissor tem de cair
   para perto de zero.
3. Despausar → volta em ~1 quadro, **sem** tela preta longa. Se houver
   segundos de preto, houve renegociação e algo está errado.
4. Com o jogo em fullscreen por cima, apertar **Ctrl+Alt+P** duas vezes e
   confirmar pelo espectador que pausou e voltou, sem alt-tab.
5. Pausado, pedir para o espectador minimizar e restaurar a janela (isso
   dispara `view-state`): a tela **não pode** voltar sozinha.

- [ ] **Passo 6: commit**

```bash
git add src/main.js src/preload.js src/renderer/app.js src/renderer/index.html src/renderer/style.css
git commit -m "feat(transmissao): pausar sem parar de compartilhar, com atalho global"
```

---

## Task 8: documentação em dia

**Problema.** Três desencontros: `STATUS.md` diz "Versão atual `0.1.8`"
enquanto `package.json` está em `0.1.10`; o item **F4** da auditoria de
2026-08-27 afirma que o redesign não foi implementado, quando ele foi
mesclado quatro dias antes dela (commit `51fc1f7`) — e uma auditoria errada é
pior que uma auditoria faltando, porque parece verificada; e o README não
menciona nada do que este plano acrescenta.

**Files:**
- Modify: `STATUS.md`, `docs/2026-08-27-auditoria-de-fragilidade.md`,
  `README.md`

- [ ] **Passo 1: `STATUS.md`**

- Trocar a versão para a do `package.json` (`0.1.10`).
- Mover A1–A7, B4/B5, C1, G4, H1–H4 de "Mesclado nesta branch, aguardando o
  próximo release" para "Já lançado" — o PR #17 foi mesclado.
- Atualizar a contagem de testes para a final deste plano.
- Trocar a seção "Em andamento" pela referência a este plano.

- [ ] **Passo 2: corrigir o F4 na auditoria**

Não reescrever o item — o documento é datado e vale como registro histórico.
Acrescentar **abaixo** dele, no mesmo estilo da correção que o commit
`8aa7444` já adicionou a esse arquivo:

```markdown
> **Correção (2026-08-28):** este item está errado. O redesign foi
> implementado e mesclado em 2026-08-23, commit `51fc1f7`, **quatro dias
> antes** desta auditoria — `src/renderer/style.css` abre declarando a
> direção "Superfície e sinal" e usa os tokens dela em 63 lugares. O erro
> veio de provar o item citando a nota do vault em vez de abrir o arquivo,
> que foi o método usado nos outros 41 achados. O que **de fato** faltava
> era menor e mais específico: o `#stage-status-dot` gastava o acento sem
> significar transmissão, e não havia estado visível pra transmissão
> degradada — os dois tratados na Task 1 de
> `docs/superpowers/plans/2026-08-28-transmissao-honesta.md`.
```

- [ ] **Passo 3: `README.md`**

- Em "O que fizemos pra segurar os 60 fps": acrescentar a escada automática
  (Task 2) e a degradação de captura (Task 3), com a explicação de que
  ninguém escolhe nada.
- Em "Configurações de qualidade": dizer que o preset escolhido é um **teto**,
  que o app desce sozinho quando a sala ou a máquina não aguentam, e que ele
  volta a subir quando sobra folga.
- Nova linha em "Como usar": pausar a transmissão, com o atalho
  `Ctrl+Alt+P` funcionando com o jogo por cima.
- Onde o README falar de áudio, registrar que agora ele é negociado em
  estéreo com bitrate declarado.

- [ ] **Passo 4: verificação**

```bash
npm test
```

```bash
grep -n "0.1.10" STATUS.md
```

Ler `STATUS.md` inteiro como se fosse a primeira vez: em 30 segundos ele tem
de dizer o que o app faz hoje, em que versão está e o que vem a seguir.

- [ ] **Passo 5: commit**

```bash
git add STATUS.md README.md docs/2026-08-27-auditoria-de-fragilidade.md
git commit -m "docs: status e readme em dia, correcao do item f4 da auditoria"
```

---

## Ordem e dependências

```
Task 1 (cabeçalho) ──┬─> Task 2 (laço fechado) ──> Task 3 (captura)
                     │
                     └─> Task 7 (pausa, usa renderRoomStatus)

Task 4 (opus)         independente das outras

Task 5 (stats rx) ───────> Task 6 (jitter buffer)   -- a 6 precisa da 5 pra medir

Task 8 (docs)             por último, com o resto mesclado
```

Se o tempo for curto, a ordem de valor é **1 → 2 → 4 → 5 → 6 → 3 → 7**: a
Task 1 conserta uma incoerência do próprio tema e dá cara visível a toda a
robustez já construída; a Task 2 é o maior ganho funcional; a Task 4 é a
mudança mais barata que o usuário percebe na hora.

## Contagem de testes esperada

| Depois da tarefa | Testes |
|---|---|
| base | 136 |
| 1 | 145 |
| 2 | 157 |
| 3 | 157 |
| 4 | 164 |
| 5 | 171 |
| 6, 7, 8 | 171 |
