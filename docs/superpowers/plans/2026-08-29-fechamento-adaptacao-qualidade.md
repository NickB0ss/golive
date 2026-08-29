# Fechamento da adaptação de qualidade — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans`, tarefa a tarefa. Passos com
> checkbox (`- [ ]`).

**Goal:** fazer a adaptação de qualidade da 0.2.0 funcionar num relay puro
(sem isso a Task 5.5 é código morto), fechar os achados dos reviews, e
integrar reconciliada a branch `feat/orcamento-banda-relay`.

**Architecture:** lógica testável em módulo puro (`autoquality.js`,
`peerquality.js`, `config.js`); `app.js` só fia; `mesh.js` é fiação WebRTC. O
laço fecha no `updateStats`, que passa a rodar também num relay puro.

**Tech Stack:** Electron 32, JavaScript sem build step, `node --test`, zero
dependências novas.

**Base:** `main` na 0.2.0 (commit da tag `v0.2.0`), **202 testes**. Branch de
trabalho nova a partir de `main`.

Design: `docs/superpowers/specs/2026-08-29-fechamento-adaptacao-qualidade-design.md`.

## Global Constraints

1. **Comentários em português sem acentos**, no estilo do arquivo, explicam
   *por que*. Texto de UI (rótulos, colunas, subtítulo) usa acentos.
2. **Testes `node --test`**, ao lado do módulo; módulo termina com
   `if (typeof module !== 'undefined') module.exports = api;`.
3. **Nenhuma dependência npm nova.**
4. **`src/renderer/app.js` não tem testes.** Lógica testável vai em módulo
   puro; `app.js` apenas chama.
5. **`npm test` passa inteiro.** Base **202**. Nenhum teste **afrouxado**.
   Testes que colidem com uma mudança **deliberada** de semântica (Task 7:
   gatilho por tempo em vez de contagem) são **reescritos** para a semântica
   nova — isso não é afrouxar; mantenha a cobertura equivalente ou maior.
6. **Um commit por tarefa**, `feat(escopo): …` / `fix(escopo): …` em
   português, minúsculas depois do prefixo, sem acentos.
7. **Não mexa fora do escopo da tarefa.** Não reformate.
8. **A regra do tema é lei.** As colunas novas do painel e o subtítulo são
   neutros (`--text-2`/`--muted` sobre `--surface-3`), nunca `--warn`/`--live`.

## Fora deste plano

`feat/orcamento-banda-relay` deixa de existir (conteúdo entra aqui,
reconciliado) — **não mescle a branch**, este plano reescreve o conteúdo
dela. Não mexe na eleição da árvore (`tree.js`). SFU/encode-once seguem
parqueados. F3, D1, B1 têm planos próprios.

## Estrutura de arquivos

| Arquivo | Mudança | Tarefa |
|---|---|---|
| `src/renderer/config.js` + test | `+ qualityForRelay` | 1 |
| `src/renderer/mesh.js` + test | `startBitrateKbps` 1/4 (cap 2500); `setDegradationPreference` tela=`balanced` | 2 |
| `src/renderer/autoquality.js` + test, `peerquality.js` + test | gatilho de degradação por **tempo contínuo**, não contagem de amostras | 3 |
| `src/renderer/app.js` | `isRelaying` substitui `isRelayingScreen`; `syncStatsLoop`; loop roda no relay puro | 4 |
| `src/renderer/app.js` | laço de stats de filho de relay em `updateStats` | 5 |
| `src/renderer/app.js` | `myAvailableBps`; piso do filho de relay = `min(qualityFor, qualityForRelay)` | 6 |
| `src/renderer/app.js` | `readSenderReport` + `renderStats`: banda disponível, perda de rede | 7 |
| `src/renderer/app.js` | tick da escada pula quando pausado / sem sender rows | 8 |
| `src/renderer/peerquality.js` + test | `+ peerEncodeSaturated` no `isBad` | 9 |
| `src/renderer/app.js` + `style.css` | TTL do `rxHealthByPeer`; `rxPrevAtMs` zera; `applyLiveQuality`→`reapplyAudienceQuality`; `.stats-subtitle` | 10 |
| `src/renderer/rxstats.js` + test | `lossPercent` clampa negativo | 10 |

## Ordem e dependências

```
1 ─┐
2  ├─> 4 (syncStatsLoop, DESBLOQUEIA) ─> 5 (stats relay-child) ─> 6 (reconciliar piso) ─> 7 (painel)
3 ─┘
8 ─> 9 ─> 10
```

1, 2, 3, 8 independentes. A verificação manual (3 máquinas, uma relay pura)
só vale da 6 em diante.

---

## Task 1: `config.qualityForRelay`

**Problema.** A árvore tira N encodes da origem, mas o relay passa a **subir
uma cópia por filho**. Hoje ele reusa o preset da origem — com 2 filhos,
tenta subir o dobro do que ela sobe, satura o próprio uplink, e a fila que
isso cria no caminho do feedback derruba o congestion control **da origem**
junto. Falta uma função que diga qual preset o relay pode usar por filho
dado o orçamento de uplink dele.

**Files:**
- Modify: `src/renderer/config.js` (nova função + export)
- Test: `src/renderer/config.test.js` (append)

**Interfaces:**
- Consumes: `qualityFromPreset`, `degradePreset` (já existem).
- Produces: `GoLive.config.qualityForRelay(preset, childCount, availableBps) -> quality`.
  Nunca sobe acima de `preset`. Sem `availableBps` válido, cai na regra
  determinística (bitrate do preset / nº filhos). Para no piso da cadeia.

- [ ] **Passo 1: escrever o teste que falha** — append em `src/renderer/config.test.js`

```js
// ---------- qualityForRelay ----------
const { qualityForRelay } = require('./config');

test('qualityForRelay: sem filhos devolve o preset da origem', () => {
  assert.equal(qualityForRelay('1080p60', 0).preset, '1080p60');
});

test('qualityForRelay: sem banda medida, divide o bitrate do preset pelos filhos', () => {
  // 1080p60 = 12 Mbps; 2 filhos -> orcamento 6 Mbps/filho -> 1080p30 (6 Mbps)
  assert.equal(qualityForRelay('1080p60', 2).preset, '1080p30');
  // 3 filhos -> 4 Mbps/filho -> nao cabe 1080p30, desce a cadeia -> 720p30
  assert.equal(qualityForRelay('1080p60', 3).preset, '720p30');
});

test('qualityForRelay: com banda medida, usa 80% dela dividida pelos filhos', () => {
  // 10 Mbps medidos * 0.8 = 8 Mbps; 2 filhos -> 4 Mbps/filho -> 720p30 (2.5 Mbps cabe, 1080p30 nao)
  assert.equal(qualityForRelay('1080p60', 2, 10_000_000).preset, '720p30');
  // banda de sobra: 100 Mbps, 2 filhos -> 40 Mbps/filho -> nao passa do preset da origem
  assert.equal(qualityForRelay('1080p60', 2, 100_000_000).preset, '1080p60');
});

test('qualityForRelay: nunca sobe acima do preset da origem', () => {
  assert.equal(qualityForRelay('720p30', 1, 100_000_000).preset, '720p30');
});

test('qualityForRelay: banda invalida cai na regra deterministica', () => {
  for (const bad of [0, -1, NaN, Infinity, 'x', null, undefined]) {
    assert.equal(qualityForRelay('1080p60', 2, bad).preset, '1080p30');
  }
});

test('qualityForRelay: para no piso da cadeia mesmo com orcamento minusculo', () => {
  assert.equal(qualityForRelay('1080p60', 2, 1000).preset, '720p30');
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/config.test.js
```

Esperado: FALHA com `qualityForRelay is not a function`.

- [ ] **Passo 3: implementar** — em `src/renderer/config.js`, **antes** de `const api = {`

```js
  // Folga sobre a banda medida. Mirar 100% do que o congestion control diz
  // que cabe e pedir pra saturar: sobra zero pro audio, pro RTCP, pro
  // trafego do resto da maquina e pra qualquer variacao do link -- e link
  // saturado vira fila, que vira atraso, que faz o proprio GCC desabar.
  const RELAY_BANDWIDTH_HEADROOM = 0.8;

  /** Qualidade que um RELAY deve usar pra re-codificar pra CADA filho.
   *
   * Duas regras, nesta ordem:
   *  - com banda medida (availableBps, do availableOutgoingBitrate), o
   *    orcamento por filho e a banda com folga dividida pelo numero de
   *    filhos;
   *  - sem medida (primeiro repasse, antes de existir amostra), o orcamento
   *    e o bitrate do proprio preset dividido pelos filhos: "ninguem na
   *    arvore sobe, no total, mais do que a origem sobe".
   *
   * Nunca devolve preset ACIMA do que a origem mandou, e para no piso da
   * cadeia mesmo quando nem o piso cabe (abaixo dele quem trata e o
   * congestion control). */
  function qualityForRelay(preset, childCount, availableBps) {
    const base = qualityFromPreset(preset);
    const filhos = Number(childCount) || 0;
    if (filhos <= 0) return base;

    const medida = typeof availableBps === 'number' && Number.isFinite(availableBps) && availableBps > 0
      ? availableBps * RELAY_BANDWIDTH_HEADROOM
      : null;
    const orcamento = (medida ?? base.bitrate) / filhos;

    let atual = base.preset;
    while (qualityFromPreset(atual).bitrate > orcamento) {
      const proximo = degradePreset(atual, 1);
      if (proximo === atual) break; // piso da cadeia
      atual = proximo;
    }
    return qualityFromPreset(atual);
  }
```

E no objeto `api`, junto de `qualityForAudience`:

```js
    qualityForRelay,
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/renderer/config.test.js
```

Esperado: os existentes + 6 novos passando.

- [ ] **Passo 5: verificação**

```bash
npm test
```

Esperado: **208 passando** (202 + 6).

- [ ] **Passo 6: commit**

```bash
git add src/renderer/config.js src/renderer/config.test.js
git commit -m "feat(arvore): qualityForRelay -- orcamento de uplink do relay por filho"
```

---

## Task 2: `mesh.js` — rajada inicial menor, tela em `balanced`

**Problema.** Dois ajustes que a medição real (2026-08-23, 320x200@57fps com
0 Mbps de saída útil numa VPN saturada) pediu:
1. `startBitrateKbps` chuta **metade** do teto (cap 10 Mbps). Numa VPN de LAN
   virtual o teto real de banda fica bem abaixo do preset; a rajada inicial
   vira perda e o GCC desaba, e recuperar disso é lento. Cai pra **1/4**,
   cap **2500 kbps**.
2. `degradationPreference` da tela é `'maintain-framerate'` — sob banda
   severamente restrita o único jeito de obedecer é destruir a resolução.
   Pra assistir alguém jogar, 720p a 25fps vale mais que 320x200 a 57fps.
   Tela vira `'balanced'`; câmera fica `'maintain-framerate'` (rosto
   travando incomoda mais).

**Files:**
- Modify: `src/renderer/mesh.js`
- Test: `src/renderer/mesh.test.js`

**Interfaces:** nenhuma nova. `startBitrateKbps(maxBitrateBps)` muda o
resultado; `setDegradationPreference(sender)` passa a derivar a preferência
do `kind` do closure.

- [ ] **Passo 1: reescrever o teste de `startBitrateKbps`**

Em `src/renderer/mesh.test.js`, **substituir** o teste
`'start bitrate e metade do teto, preso entre 300 kbps e 10 Mbps'` por:

```js
test('start bitrate e um quarto do teto, preso entre 300 kbps e 2500 kbps', () => {
  assert.equal(startBitrateKbps(12_000_000), 2500); // 3000 estourado pro teto
  assert.equal(startBitrateKbps(2_000_000), 500);
  assert.equal(startBitrateKbps(40_000_000), 2500); // teto
  assert.equal(startBitrateKbps(100_000), 300); // piso
  assert.equal(startBitrateKbps(undefined), 300);
});

test('start bitrate nunca fura 2500 kbps mesmo com preset de topo (12 Mbps)', () => {
  // Rajada inicial grande em tunel de VPN vira perda e derruba o GCC.
  assert.ok(startBitrateKbps(12_000_000) <= 2500);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/mesh.test.js
```

Esperado: FALHA (o teste antigo esperava 6000).

- [ ] **Passo 3: `startBitrateKbps`**

Em `src/renderer/mesh.js`, **substituir** a função (linha ~83) e o comentário
acima dela por:

```js
  // Um quarto do teto, dentro de limites sensatos. Comecar em ~300 kbps
  // (padrao do Chromium) deixa os primeiros segundos borrados; comecar no
  // maximo faz a rajada inicial virar perda e derrubar o GCC. O custo dos
  // dois lados NAO e simetrico: subir a estimativa e rapido, um colapso de
  // congestion control por rajada inicial demora muito mais -- e em VPN de
  // LAN virtual (Radmin/Tailscale) o teto de banda real fica bem abaixo do
  // preset escolhido. Por isso 1/4, e o teto superior caiu de 10000 pra
  // 2500: mesmo com presets de topo (12 Mbps) a rajada fica pequena o
  // bastante pra nao afogar um tunel de VPN.
  function startBitrateKbps(maxBitrateBps) {
    const quarter = Math.round((maxBitrateBps || 0) / 4000);
    return Math.min(Math.max(quarter, 300), 2500);
  }
```

- [ ] **Passo 4: `setDegradationPreference` — tela em `balanced`**

Em `src/renderer/mesh.js`, `setDegradationPreference` (linha ~469) está dentro
de `makeConnection(peerId, dir, kind)`, então `kind` está no closure.
**Substituir** a assinatura e o corpo por:

```js
    function setDegradationPreference(sender) {
      if (!sender) return;
      // Tela em 'balanced': sob banda severamente restrita (VPN saturada)
      // 'maintain-framerate' so obedece destruindo a resolucao. Camera fica
      // 'maintain-framerate' -- rosto travando incomoda mais que perder
      // nitidez. parseKind cobre o kind de repasse (screen@<origem>).
      const pref = parseKind(kind).baseKind === 'screen' ? 'balanced' : 'maintain-framerate';
      try {
        const params = sender.getParameters();
        params.degradationPreference = pref;
        sender.setParameters(params).catch(() => {});
      } catch {
        /* sender pode ter sido fechado no meio da negociacao */
      }
    }
```

A chamada em `offerTo` (`setDegradationPreference(transceiver.sender)`, linha
~414) não muda — ela já não passava `pref`.

Verificar se `applyEncoding` / `applyEncodingToPeer` também setam
`params.degradationPreference = 'maintain-framerate'` fixo — se sim, trocar
por: `parseKind(kind).baseKind === 'screen' ? 'balanced' : 'maintain-framerate'`
(as duas recebem `kind`).

- [ ] **Passo 5: rodar e ver passar**

```bash
npm test
```

Esperado: **211 passando** (208 + 1 novo teste da Task 2; o outro é
substituição). Se o número não bater, conferir se um teste antigo de
`degradationPreference` existe e precisa de ajuste.

- [ ] **Passo 6: commit**

```bash
git add src/renderer/mesh.js src/renderer/mesh.test.js
git commit -m "fix(transmissao): rajada inicial menor e tela em balanced pra VPN saturada"
```

---

## Task 3: gatilho de degradação por **tempo contínuo**

**Problema.** `autoquality.next` e `peerquality.next` descem um degrau depois
de `BAD_SAMPLES_TO_DEGRADE = 3` **amostras** ruins seguidas. `updateStats`
roda a cada 1 s com a janela visível **mas a cada 5 s escondida** — e a
janela escondida é exatamente o caso-alvo (jogando em fullscreen). 3 amostras
a 5 s = **15 s** de reação em vez de 3. O lado da recuperação já é por tempo
(`GOOD_MS_TO_RECOVER`); o de descer também tem de ser.

**Files:**
- Modify: `src/renderer/autoquality.js`, `src/renderer/peerquality.js`
- Test: `src/renderer/autoquality.test.js`, `src/renderer/peerquality.test.js`

**Interfaces:**
- `initialState()` passa a devolver `{ steps, badSinceMs, goodSinceMs }`
  (`badRun` some).
- `LIMITS` renomeia `BAD_SAMPLES_TO_DEGRADE` → `BAD_MS_TO_DEGRADE` (3000).
- `next()` mesma assinatura; semântica de descer vira: `badSinceMs` marca
  quando a corrida ruim atual começou; desce quando
  `atMs - badSinceMs >= BAD_MS_TO_DEGRADE`.

### Parte A — `autoquality.js`

- [ ] **Passo 1: reescrever os testes que dependem de contagem**

Em `src/renderer/autoquality.test.js`, os testes que usam
`LIMITS.BAD_SAMPLES_TO_DEGRADE` ou `Array(N).fill(RUIM)` ou checam
`state.badRun` precisam virar testes de tempo. Padrão do helper novo:

```js
// Aplica amostras 1s entre elas (helper existente `run` fica igual).
// Pra checar o gatilho por tempo, aplique amostras ruins ate cruzar
// BAD_MS_TO_DEGRADE:

test('sofrimento continuo por BAD_MS_TO_DEGRADE desce um degrau', () => {
  let s = initialState();
  s = next(s, { atMs: 0, health: RUIM });
  s = next(s, { atMs: LIMITS.BAD_MS_TO_DEGRADE - 1, health: RUIM });
  assert.equal(s.steps, 0, 'antes de completar o tempo, nao desce');
  s = next(s, { atMs: LIMITS.BAD_MS_TO_DEGRADE + 1, health: RUIM });
  assert.equal(s.steps, 1);
});

test('uma amostra boa no meio reinicia o relogio de sofrimento', () => {
  let s = initialState();
  s = next(s, { atMs: 0, health: RUIM });
  s = next(s, { atMs: 2000, health: OK });          // zera badSinceMs
  s = next(s, { atMs: 3000, health: RUIM });        // recomeca
  s = next(s, { atMs: 3000 + LIMITS.BAD_MS_TO_DEGRADE - 1, health: RUIM });
  assert.equal(s.steps, 0);
});

test('poll lento (5s escondido) ainda desce em ~BAD_MS_TO_DEGRADE, nao em 3 amostras', () => {
  let s = initialState();
  s = next(s, { atMs: 0, health: RUIM });
  s = next(s, { atMs: 5000, health: RUIM }); // so 2 amostras, mas 5s > 3s
  assert.equal(s.steps, 1);
});
```

Mantenha os testes que já são por tempo (recuperação, teto, `worstHealth`,
`isBad`, entrada indefinida) — só os de contagem mudam.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/autoquality.test.js
```

- [ ] **Passo 3: reescrever `next` e `initialState`**

Em `src/renderer/autoquality.js`:

```js
  // Tempo CONTINUO de sofrimento antes de descer -- nao contagem de
  // amostras. updateStats roda a cada 1s visivel mas 5s escondido (jogando
  // em fullscreen), entao contar amostras dava 15s de reacao no caso que
  // mais importa. Simetrico com GOOD_MS_TO_RECOVER.
  const BAD_MS_TO_DEGRADE = 3000;

  const LIMITS = { MAX_AUTO_STEPS, BAD_MS_TO_DEGRADE, GOOD_MS_TO_RECOVER, BUDGET_MS_60 };

  function initialState() {
    return { steps: 0, badSinceMs: null, goodSinceMs: null };
  }

  function next(state, sample, opts) {
    const o = opts || {};
    const budgetMs = o.budgetMs ?? BUDGET_MS_60;
    const maxSteps = o.maxSteps ?? MAX_AUTO_STEPS;
    const badMsToDegrade = o.badMsToDegrade ?? BAD_MS_TO_DEGRADE;
    const goodMsToRecover = o.goodMsToRecover ?? GOOD_MS_TO_RECOVER;

    const prev = state || initialState();
    const atMs = Number(sample?.atMs) || 0;

    if (isBad(sample?.health, budgetMs)) {
      const badSinceMs = prev.badSinceMs ?? atMs;
      if (prev.steps < maxSteps && atMs - badSinceMs >= badMsToDegrade) {
        // Desce um degrau e reinicia o relogio de sofrimento -- descer dois
        // degraus leva dois periodos.
        return { steps: prev.steps + 1, badSinceMs: atMs, goodSinceMs: null };
      }
      return { steps: prev.steps, badSinceMs, goodSinceMs: null };
    }

    const goodSinceMs = prev.goodSinceMs ?? atMs;
    if (prev.steps > 0 && atMs - goodSinceMs >= goodMsToRecover) {
      return { steps: prev.steps - 1, badSinceMs: null, goodSinceMs: atMs };
    }
    return { steps: prev.steps, badSinceMs: null, goodSinceMs };
  }
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/renderer/autoquality.test.js
```

### Parte B — `peerquality.js` (mesma mudança)

- [ ] **Passo 5: reescrever os testes de contagem** em `src/renderer/peerquality.test.js`

Os testes que usam `Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(BW)` ou checam
`state.badRun` viram testes de tempo (mesmo padrão da Parte A, sinais
`BW`/`SW`/`FREEZE`):

```js
test('sofrimento continuo por BAD_MS_TO_DEGRADE desce um degrau', () => {
  let s = initialState();
  s = next(s, { ...BW, atMs: 0 });
  s = next(s, { ...BW, atMs: LIMITS.BAD_MS_TO_DEGRADE - 1 });
  assert.equal(s.steps, 0);
  s = next(s, { ...BW, atMs: LIMITS.BAD_MS_TO_DEGRADE + 1 });
  assert.equal(s.steps, 1);
});

test('uma amostra boa no meio reinicia o relogio de sofrimento', () => {
  let s = initialState();
  s = next(s, { ...BW, atMs: 0 });
  s = next(s, { ...OK, atMs: 2000 });
  s = next(s, { ...BW, atMs: 3000 });
  s = next(s, { ...BW, atMs: 3000 + LIMITS.BAD_MS_TO_DEGRADE - 1 });
  assert.equal(s.steps, 0);
});

test('poll lento (5s) ainda desce em ~BAD_MS_TO_DEGRADE, nao em 3 amostras', () => {
  let s = initialState();
  s = next(s, { ...BW, atMs: 0 });
  s = next(s, { ...BW, atMs: 5000 });
  assert.equal(s.steps, 1);
});
```

Os testes de recuperação, teto e `isBad` já são por tempo — não mudam.

- [ ] **Passo 6: reescrever `next`/`initialState`/`LIMITS`** em `src/renderer/peerquality.js`

```js
  // Tempo CONTINUO de sofrimento antes de descer -- nao contagem de
  // amostras (updateStats roda a cada 1s visivel mas 5s escondido).
  // Simetrico com GOOD_MS_TO_RECOVER.
  const BAD_MS_TO_DEGRADE = 3000;

  const LIMITS = { MAX_PEER_STEPS, BAD_MS_TO_DEGRADE, GOOD_MS_TO_RECOVER, FREEZE_PER_MIN, LOSS_PCT_MAX };

  function initialState() {
    return { steps: 0, badSinceMs: null, goodSinceMs: null };
  }

  function next(state, signals, opts) {
    const o = opts || {};
    const maxSteps = o.maxSteps ?? MAX_PEER_STEPS;
    const badMsToDegrade = o.badMsToDegrade ?? BAD_MS_TO_DEGRADE;
    const goodMsToRecover = o.goodMsToRecover ?? GOOD_MS_TO_RECOVER;

    const prev = state || initialState();
    const atMs = Number(signals?.atMs) || 0;

    if (isBad(signals, o)) {
      const badSinceMs = prev.badSinceMs ?? atMs;
      if (prev.steps < maxSteps && atMs - badSinceMs >= badMsToDegrade) {
        return { steps: prev.steps + 1, badSinceMs: atMs, goodSinceMs: null };
      }
      return { steps: prev.steps, badSinceMs, goodSinceMs: null };
    }

    const goodSinceMs = prev.goodSinceMs ?? atMs;
    if (prev.steps > 0 && atMs - goodSinceMs >= goodMsToRecover) {
      return { steps: prev.steps - 1, badSinceMs: null, goodSinceMs: atMs };
    }
    return { steps: prev.steps, badSinceMs: null, goodSinceMs };
  }
```

(`MAX_PEER_STEPS`, `GOOD_MS_TO_RECOVER`, `FREEZE_PER_MIN`, `LOSS_PCT_MAX` e o
corpo de `isBad` ficam como estão.)

- [ ] **Passo 7: verificação**

```bash
npm test
```

Esperado: **~217 passando**. Nenhum teste de recuperação, teto ou `isBad`
mudou de contagem — só os de descida.

- [ ] **Passo 8: ajustar os chamadores** — `src/renderer/app.js` lê
  `autoQuality.steps` e `peerQuality.get(key).steps` (esses não mudam). Mas
  qualquer lugar que leia `.badRun` tem de ser trocado — grep por `badRun` em
  `app.js` (não deve haver nenhum; se houver, é bug). O `initialState()` das
  duas continua sendo chamado sem argumento.

- [ ] **Passo 9: commit**

```bash
git add src/renderer/autoquality.js src/renderer/autoquality.test.js src/renderer/peerquality.js src/renderer/peerquality.test.js
git commit -m "fix(qualidade): escada desce por tempo continuo de sofrimento, nao por contagem de amostras"
```

---

## Task 4: `syncStatsLoop` — `updateStats` roda num relay puro

**Problema.** `startStatsLoop` só é chamado quando `localStream ||
cameraStream`. Um nó que é **só relay** nunca liga o loop, então
**`updateStats` nunca roda nele** — e a Task 5.5 da 0.2.0 (escada por-filho
num relay puro), a cadência do `broadcastViewState` e o cálculo de
`receiveHealth` estão todos dentro de `updateStats`. A Task 5.5 é código
morto sem isto.

**Files:**
- Modify: `src/renderer/app.js`

**Interfaces:**
- Substitui `isRelayingScreen()` (Task 5.5, só screen) por `isRelaying()`
  (todos os KINDS).
- Produces: `syncStatsLoop()` — liga o loop se preciso, desliga se não.

- [ ] **Passo 1: `isRelaying` substitui `isRelayingScreen`**

Em `src/renderer/app.js`, **substituir** `function isRelayingScreen()`
(linha ~310) por:

```js
  /** Estamos repassando video pra alguem agora? Um relay paga 2 encodes e
   * um decode sem necessariamente transmitir nada proprio -- entao ainda
   * precisa do loop de estatisticas ligado. */
  function isRelaying() {
    for (const kind of KINDS) {
      for (const state of myRole[kind].values()) {
        if (state.role === 'relay' && state.filhosIds.length) return true;
      }
    }
    return false;
  }
```

E trocar as duas ocorrências de `isRelayingScreen()` (linhas ~861 e ~2726)
por `isRelaying()`. Grep pra garantir que não sobrou nenhuma.

- [ ] **Passo 2: `syncStatsLoop`**

Logo depois de `isRelaying`, ou junto de `startStatsLoop`/`stopStatsLoop`:

```js
  /** Liga o loop de estatisticas se ele ja nao estiver rodando, e desliga
   * quando nao ha mais nada nosso sendo codificado (nem transmissao propria,
   * nem repasse de relay).
   *
   * Ate aqui o loop so subia com localStream/cameraStream -- quem era SO
   * relay nunca media nada: nao reportava saude de encode (a eleicao do H2
   * recebia null), nao rodava a escada por-filho (Task 5.5), nao mandava
   * cadencia de view-state. startStatsLoop chama stopStatsLoop antes (zera
   * statsPrev), entao a guarda por statsTimer evita apagar a amostra
   * anterior a cada 'tree' recebida. */
  function syncStatsLoop() {
    const precisa = Boolean(localStream) || Boolean(cameraStream) || isRelaying();
    if (precisa && !statsTimer) startStatsLoop();
    else if (!precisa && statsTimer) stopStatsLoop();
  }
```

- [ ] **Passo 3: chamar `syncStatsLoop` na mudança de papel de relay**

No `case 'tree'` (linha ~1584), logo **depois** de
`state.role = filhosIds.length ? 'relay' : …;` (linha ~1621) e **antes** do
`if (state.role === 'relay') await flushPendingRelay(...)`:

```js
        // Virar (ou deixar de ser) relay muda se ha algo nosso codificando
        // -- o loop de estatisticas e quem mede isso.
        syncStatsLoop();
```

- [ ] **Passo 4: `stopShare` não mata o loop se ainda formos relay**

Em `stopShare()`, **trocar** `stopStatsLoop();` por:

```js
    // syncStatsLoop, nao stopStatsLoop: parar de compartilhar nao quer dizer
    // parar de codificar -- este no pode seguir sendo relay de outra pessoa.
    syncStatsLoop();
```

(o `resetShareState()` que vem logo depois continua.)

- [ ] **Passo 5: `updateStats` — não fazer `return` cedo se somos só relay**

`updateStats` começa com `const session = currentSession; if (!session?.mesh)
return;`. Isso está OK pra relay puro (temos `currentSession`). Conferir que
nenhum `return` intermediário depende de `localStream`. O bloco da escada
global (`if (localStream) { autoQuality … }`) já é guardado; a escada
por-peer já é `if (localStream || isRelaying())`. Nada mais a mudar aqui.

- [ ] **Passo 6: verificação**

```bash
npm test
```

Esperado: **~217, sem mudança** — fiação.

```bash
node --check src/renderer/app.js
```

Verificação manual (sala de 4, B é relay puro pra C e D): abrir
Configurações > Estatísticas **no B** — a aba não pode estar vazia; tem de
mostrar linhas de envio pros filhos. (A Task 5 completa isso; aqui basta o
loop estar rodando — confirme pelo log `[stats]` ou pela aba atualizando.)

- [ ] **Passo 7: commit**

```bash
git add src/renderer/app.js
git commit -m "fix(arvore): loop de estatisticas roda num relay puro (syncStatsLoop)"
```

---

## Task 5: laço de stats de filho de relay em `updateStats`

**Problema.** O laço de senders do `updateStats` itera `['screen', 'camera']`
— nunca os kinds compostos `screen@<origem>`. Num relay puro o painel de
Estatísticas fica **vazio**, `myEncodeHealth` sobe `null` pra origem (a
eleição do H2 decide no escuro sobre quem paga os 2 encodes), e o
`limByPeer` da escada por-peer nunca tem chave `screen@x` — o
`senderBandwidthLimited` do filho de relay nunca dispara (achado do review
da Task 5).

**Files:**
- Modify: `src/renderer/app.js` (`updateStats`)

**Interfaces:**
- Consumes: `mesh.statsFor(peerId, kind)` já aceita kind composto;
  `readSenderReport`, `deriveRates` (já existem).
- Produces: `rows` passa a incluir linhas de filho de relay, com
  `kind = 'screen@<origem>'`.

- [ ] **Passo 1: acrescentar o laço**

Em `updateStats`, **depois** do laço `for (const [peerId, peer] of
activeMesh.peers) { for (const kind of ['screen', 'camera']) … }` e **antes**
do `if (currentSession !== session) return;` que precede
`myEncodeHealth = summarizeOwnEncodeHealth(rows);`:

```js
    // Repasses. As conexoes de relay usam kind COMPOSTO ('screen@<origem>'),
    // que o laco acima -- fixo em ['screen','camera'] -- nunca consultava.
    // Sem isto o painel de um relay puro fica vazio, myEncodeHealth sobe
    // null pra origem, e o senderBandwidthLimited do filho de relay nunca
    // dispara.
    for (const kind of KINDS) {
      for (const [sourceId, state] of myRole[kind]) {
        if (state.role !== 'relay') continue;
        const childKind = relayKindFor(kind, sourceId);
        for (const childId of state.filhosIds) {
          if (currentSession !== session) return;
          const report = await activeMesh.statsFor(childId, childKind);
          if (!report) continue;
          const sample = readSenderReport(report);
          if (!sample.framesEncoded && !sample.bytesSent) continue;
          const rates = deriveRates(`${childId}:${childKind}`, sample, now);
          const childName = activeMesh.peers.get(childId)?.name || `#${childId}`;
          rows.push({ peerId: childId, kind: childKind, name: childName, ...sample, ...rates });
        }
      }
    }
```

- [ ] **Passo 2: a escada por-peer passa a ver o kind composto no `limByPeer`**

Na construção do `limByPeer` (`for (const r of rows) limByPeer.set(...)`), as
chaves `screen@x` agora aparecem. **Trocar** a linha do
`senderBandwidthLimited` no `peerquality.next({...})` por uma que também
olhe o kind composto daquele filho:

```js
          senderBandwidthLimited: limByPeer.get(`${peerId}:screen`) === 'bandwidth'
            || [...limByPeer].some(([k, v]) => k.startsWith(`${peerId}:screen@`) && v === 'bandwidth'),
```

E **apagar** o comentário antigo que dizia que isso "depende da branch
parqueada" — agora é coberto.

- [ ] **Passo 3: verificação**

```bash
npm test
```

Esperado: **~217, sem mudança.**

```bash
node --check src/renderer/app.js
```

Verificação manual (sala de 4, B relay puro): a aba Estatísticas do B mostra
uma linha por filho (C e D); o selo de "encoder em software" do B funciona; e
estrangular o link do C (Clumsy) faz o log `[qualidade] escada de C` aparecer
**no B** por `senderBandwidthLimited`, não só por travas.

- [ ] **Passo 4: commit**

```bash
git add src/renderer/app.js
git commit -m "feat(stats): updateStats mede os repasses do relay, e o filho de relay ganha o sinal de banda"
```

---

## Task 6: reconciliar — piso do filho de relay = `min(qualityFor, qualityForRelay)`

**Problema.** `qualityForPeer(childId, ck)` parte de `qualityFor(ck)` (o piso
global: tamanho da sala + malha + escada global). Falta o limitador de
**uplink do relay** (`qualityForRelay`): o relay sobe uma cópia por filho, e
sem esse teto ele tenta subir o dobro/triplo e afoga o próprio link,
derrubando o GCC da origem junto.

**Files:**
- Modify: `src/renderer/app.js` (`myAvailableBps`, `qualityForPeer`)

**Interfaces:**
- Consumes: `config.qualityForRelay` (Task 1), `myRole` (pra saber quantos
  filhos), `rows` com `availableBps` (Task 7 preenche; até a Task 7 rodar,
  `myAvailableBps` fica `null` e cai na regra determinística — funciona).

- [ ] **Passo 1: `myAvailableBps`**

Junto de `myEncodeHealth` (linha ~157):

```js
  // Menor availableOutgoingBitrate visto entre os nossos senders, em bits/s
  // (null enquanto nao ha amostra). E o orcamento de UPLINK deste no --
  // usado pra limitar o preset de repasse (config.qualityForRelay).
  let myAvailableBps = null;
```

Em `updateStats`, depois do `myEncodeHealth = summarizeOwnEncodeHealth(rows);`:

```js
    // Menor availableBps entre os senders: todos dividem o mesmo uplink,
    // entao a estimativa mais apertada e a que descreve o que sobra.
    const bws = rows.filter((r) => r.availableBps != null).map((r) => r.availableBps);
    myAvailableBps = bws.length ? Math.min(...bws) : null;
```

(o campo `r.availableBps` vem da Task 7; antes dela `bws` fica vazio e
`myAvailableBps` = `null`.)

- [ ] **Passo 2: `qualityForPeer` aplica o teto do relay pra filho de relay**

Em `src/renderer/app.js`, `qualityForPeer(peerId, kind)`. **Substituir** por:

```js
  /** Qualidade efetiva para UM destinatario: o piso menos os degraus que a
   * conexao DELE pediu. Pra um FILHO de relay, o piso e o MENOR entre o piso
   * global e o teto de uplink do relay (config.qualityForRelay) -- o relay
   * sobe uma copia por filho e nao pode passar do proprio orcamento. */
  function qualityForPeer(peerId, kind) {
    const { baseKind, sourceId } = parseKind(kind);
    let floor = qualityFor(kind);

    if (sourceId) {
      // kind composto -> somos relay desta origem. Limita pelo uplink.
      const state = myRole[baseKind].get(sourceId);
      const filhos = state?.filhosIds.length || 1;
      const relayCap = config.qualityForRelay(floor.preset, filhos, myAvailableBps);
      // menor preset entre os dois (comparar pelo bitrate da cadeia)
      if (relayCap.bitrate < floor.bitrate) floor = relayCap;
    }

    const st = peerQuality.get(`${peerId}:${baseKind}`);
    const steps = st?.steps || 0;
    if (!steps) return floor;
    return config.qualityFromPreset(config.degradePreset(floor.preset, steps));
  }
```

- [ ] **Passo 3: verificação**

```bash
npm test
```

Esperado: **~217, sem mudança.**

```bash
node --check src/renderer/app.js
```

Verificação manual (sala de 4, B relay puro pra C e D, os dois com PC bom):
a resolução que C e D recebem do B já sai **abaixo** do que a origem manda
(o relay divide o uplink por 2), sem ninguém estar sofrendo. Estrangular o C
faz **só o C** descer mais.

- [ ] **Passo 4: commit**

```bash
git add src/renderer/app.js
git commit -m "feat(arvore): o filho de relay respeita o orcamento de uplink do relay"
```

---

## Task 7: painel — banda disponível e perda de rede

**Problema.** O painel de Estatísticas não mostra `availableOutgoingBitrate`
(o número que separa gargalo de banda de gargalo de encode) nem a perda de
pacote **real da rede** (`remote-inbound-rtp`, distinta dos quadros
descartados no encode que a tabela já mostra como "perdidos").

**Files:**
- Modify: `src/renderer/app.js` (`readSenderReport`, `renderStats`)

- [ ] **Passo 1: `readSenderReport` — três campos novos**

No objeto `sample` de `readSenderReport`, junto de `rtt: null`:

```js
      // "sem amostra" != "0 bits disponiveis" -- e o numero que separa
      // gargalo de banda de gargalo de encode.
      availableBps: null,
      // Perda REAL da rede (remote-inbound-rtp), distinta dos quadros
      // descartados no encode que a tabela ja mostra.
      packetsLostNet: null,
      fractionLost: null,
```

No `report.forEach`:

```js
      if (stat.type === 'candidate-pair' && stat.nominated && stat.availableOutgoingBitrate != null) {
        sample.availableBps = Math.max(sample.availableBps ?? 0, stat.availableOutgoingBitrate);
      }
      // remote-inbound-rtp e o eco RTCP do outro lado -- pode faltar num
      // intervalo isolado sem significar "sem perda".
      if (stat.type === 'remote-inbound-rtp' && stat.kind === 'video') {
        if (stat.packetsLost != null) sample.packetsLostNet = stat.packetsLost;
        if (stat.fractionLost != null) sample.fractionLost = stat.fractionLost;
      }
```

- [ ] **Passo 2: `renderStats` — coluna e linha do resumo**

No `summary` (o bloco `.stat`), acrescentar:

```js
      <div class="stat"><span>banda disponível</span><b class="${
        minAvailableBps != null && minAvailableBps < targetBitrate ? 'warn-text' : ''
      }">${minAvailableBps != null ? `${(minAvailableBps / 1_000_000).toFixed(1)} Mbps` : '-'}</b></div>
```

com, antes do `summary`:

```js
    const bwRows = rows.filter((r) => r.availableBps != null);
    const minAvailableBps = bwRows.length ? Math.min(...bwRows.map((r) => r.availableBps)) : null;
    const targetBitrate = qualityFor(rows[0].kind).bitrate;
```

Na `<thead>` da tabela, entre `rtt` e `perdidos`:

```html
<th>perda rede</th>
```

E na linha (`body.map`):

```js
          <td class="${r.fractionLost != null && r.fractionLost > 0.01 ? 'warn-text' : ''}">${
            r.fractionLost != null ? `${(r.fractionLost * 100).toFixed(2)}%` : '-'
          }</td>
```

- [ ] **Passo 3: verificação**

```bash
npm test
```

Esperado: **~217, sem mudança.**

```bash
node --check src/renderer/app.js
```

Manual: a aba Estatísticas mostra "banda disponível" no resumo e uma coluna
"perda rede" por sender.

- [ ] **Passo 4: commit**

```bash
git add src/renderer/app.js
git commit -m "feat(stats): banda disponivel e perda de rede real no painel"
```

---

## Task 8: o tick da escada pula quando pausado / sem encode

**Problema.** `peerquality.next` / `autoquality.next` são chamados a cada
`updateStats`. Enquanto `sharePaused`, nada é codificado — `myEncodeHealth`
é `null`, não há linha de sender — e cada tick conta como **folga observada**:
~30 s de pausa "recupera" um degrau de graça, anulando a Opção B que foi
escolhida de propósito. Idem quando o loop reinicia (reconexão) com
`goodSinceMs` velho.

**Files:**
- Modify: `src/renderer/app.js` (`updateStats`)

- [ ] **Passo 1: pular a escada global quando pausado**

No `updateStats`, o bloco `if (localStream) { … autoQuality = autoquality.next
… }`. **Trocar** a condição por `if (localStream && !sharePaused) {`.

- [ ] **Passo 2: pular o tick por-peer de um peer sem encode**

No laço `for (const key of targets)` da escada por-peer, no começo do corpo:

```js
        const [peerId] = key.split(':');
        // Pausado ou sem nenhuma linha de sender pra este peer: nao ha
        // encode acontecendo, entao nao ha "folga observada" -- pular o
        // tick preserva o estado (nem sobe nem desce).
        const hasSenderRow = rows.some((r) => r.peerId === peerId);
        if (sharePaused || !hasSenderRow) continue;
```

(colocar **antes** de `const st = peerQuality.get(key) …`.)

- [ ] **Passo 3: verificação**

Não há Passo 3 de código. O conserto é só Passos 1 e 2: a semântica "Opção B"
das escadas (`goodSinceMs = prev.goodSinceMs ?? atMs`) já ancora o relógio de
recuperação no **primeiro tick bom observado**. Pular os ticks "pausado / sem
encode" (Passos 1 e 2) garante que o primeiro tick que conta como folga é um
com encode de verdade. Nada a zerar em `startStatsLoop`.

```bash
npm test
```

Esperado: **~217, sem mudança.**

Manual: compartilhar, forçar 1 degrau automático, **pausar** 40 s, despausar
→ a escada **não** subiu durante a pausa (log sem `[qualidade] escada … -> 0`
enquanto pausado).

- [ ] **Passo 5: commit**

```bash
git add src/renderer/app.js
git commit -m "fix(qualidade): a escada nao ganha folga de recuperacao enquanto pausado ou sem encode"
```

---

## Task 9: `peerquality.isBad` ganha `peerEncodeSaturated`

**Problema.** O M3 (0.2.0) tirou a saúde de encode dos relays da escada
**global**. A ideia era que a saúde ruim do relay chegasse pela escada
**por-peer** — mas `peerquality.isBad` só lê `senderBandwidthLimited` e
`receiveHealth`, **não** `encodeHealth`. Um relay afogando o encoder mas
decodificando em hardware não move qualidade nenhuma hoje (só a eleição da
árvore reage). Agora que a Task 5 faz `myEncodeHealth` subir de verdade do
relay, dá pra fechar isso.

**Files:**
- Modify: `src/renderer/peerquality.js`
- Test: `src/renderer/peerquality.test.js`

**Interfaces:**
- `next`/`isBad` aceitam `signals.peerEncodeSaturated` (boolean). `true` =
  ruim.

- [ ] **Passo 1: teste**

Em `src/renderer/peerquality.test.js`:

```js
test('isBad: encoder saturado do peer (relay afogado) e ruim', () => {
  assert.equal(isBad({ ...OK, peerEncodeSaturated: true }, {}), true);
});

test('peerEncodeSaturated continuo desce um degrau', () => {
  let s = initialState();
  s = next(s, { atMs: 0, peerEncodeSaturated: true });
  s = next(s, { atMs: LIMITS.BAD_MS_TO_DEGRADE + 1, peerEncodeSaturated: true });
  assert.equal(s.steps, 1);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/renderer/peerquality.test.js
```

- [ ] **Passo 3: implementar** — em `isBad`, logo depois do
  `if (signals.senderBandwidthLimited === true) return true;`:

```js
    if (signals.peerEncodeSaturated === true) return true;
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/renderer/peerquality.test.js
```

- [ ] **Passo 5: fiar em `app.js`**

No `peerquality.next({...})` do `updateStats`, acrescentar o sinal —
derivado do `encodeHealth` que o peer reportou (a escala é a mesma do
`autoquality.isBad`):

```js
          peerEncodeSaturated: autoquality.isBad(peer?.encodeHealth, autoquality.LIMITS.BUDGET_MS_60),
```

(`autoquality.isBad` já é exportado e trata `null` como não-ruim.)

- [ ] **Passo 6: verificação**

```bash
npm test
```

Esperado: **~219** (217 + 2).

- [ ] **Passo 7: commit**

```bash
git add src/renderer/peerquality.js src/renderer/peerquality.test.js src/renderer/app.js
git commit -m "feat(qualidade): relay com encoder saturado degrada a conexao que servimos a ele"
```

---

## Task 10: TTL do `rxHealthByPeer` + menores

**Problema.** Vários fechamentos pequenos:
1. `rxHealthByPeer` fica com o último valor se um stream congela de vez
   (`framesDelta <= 0` → `receiveHealth` devolve `null` → o valor velho
   fica). `isBad(stale-good)` = não-ruim → o timer de recuperação acumula e
   o peer "recupera" a um preset maior **enquanto está travado**.
2. `rxPrevAtMs` não zera em `startStatsLoop`/`resetShareState` (fica órfão do
   `rxPrevSample` que zera).
3. `applyLiveQuality` faz `applyEncoding(qualityFor('screen'), 'screen')` —
   ignora a escada por-peer e não atualiza `lastCaptureKey`.
4. `<h4>Recebendo</h4>` sem estilo.
5. `rxstats.lossPercent` não clampa `packetsLost` negativo.

**Files:**
- Modify: `src/renderer/app.js`, `src/renderer/style.css`, `src/renderer/rxstats.js`
- Test: `src/renderer/rxstats.test.js`

- [ ] **Passo 1: TTL no `peer.receiveHealth`**

O que o tick da escada lê é `peer.receiveHealth[baseKind]` — o que o outro
lado nos **reportou** sobre como recebe nosso stream. Um stream congelado
para de reportar (`receiveHealth` vira `null` no lado dele), mas o último
valor bom fica guardado aqui e `isBad(stale-good)` = não-ruim → o timer de
recuperação acumula e a escada "recupera" um peer travado.

Conserto: carimbar a hora ao guardar, e tratar como ausente se velho demais
(`RX_HEALTH_TTL_MS` = 6000 — ~1 janela de poll escondido + folga).

No `case 'view-state'` (a linha que hoje faz
`(vsPeer.receiveHealth ||= {})[parseKind(msg.kind).baseKind] = normalizeReceiveHealth(msg.receiveHealth)`):

```js
        if (vsPeer) {
          const rh = normalizeReceiveHealth(msg.receiveHealth);
          (vsPeer.receiveHealth ||= {})[parseKind(msg.kind).baseKind] =
            rh ? { ...rh, atMs: Date.now() } : null;
        }
```

No tick do `updateStats`:

```js
          receiveHealth: freshReceiveHealth(peer, 'screen'),
```

com um helper:

```js
  const RX_HEALTH_TTL_MS = 6000;
  /** receiveHealth do peer pra um baseKind, ou null se velha demais -- um
   * stream congelado para de reportar, e o valor velho faria a escada
   * "recuperar" um peer travado. */
  function freshReceiveHealth(peer, baseKind) {
    const e = peer?.receiveHealth?.[baseKind];
    if (!e || Date.now() - e.atMs > RX_HEALTH_TTL_MS) return null;
    const { atMs, ...rh } = e;
    return rh;
  }
```

- [ ] **Passo 2: `rxPrevAtMs` zera**

Em `startStatsLoop()` (junto de `statsPrev.clear()`) e em `resetShareState()`
(junto de `rxPrevSample.clear()`):

```js
    rxPrevAtMs = 0;
```

- [ ] **Passo 3: `applyLiveQuality` usa `reapplyAudienceQuality`**

Em `applyLiveQuality`, **trocar**
`currentSession?.mesh?.applyEncoding(qualityFor('screen'), 'screen');` por:

```js
    reapplyAudienceQuality();
```

(idempotente, já cuida da captura via `lastCaptureKey` e das conexões
por-peer.)

- [ ] **Passo 4: `.stats-subtitle`**

Em `src/renderer/style.css`, junto das regras `.stats-table`:

```css
/* Subtitulo "Recebendo" da segunda tabela do painel. Neutro -- e um
   rotulo, nao um alerta. */
.stats-subtitle {
  font-size: 12px;
  font-weight: 650;
  color: var(--text-2);
  margin: var(--s-3) 0 var(--s-1);
}
```

E em `renderStats`, garantir que o `<h4>` da seção "Recebendo" tem
`class="stats-subtitle"`.

- [ ] **Passo 5: `lossPercent` clampa negativo**

Teste em `src/renderer/rxstats.test.js`:

```js
test('lossPercent: packetsLost negativo (reordem/duplicata) nao vira porcentagem negativa', () => {
  assert.equal(lossPercent({ packetsReceived: 100, packetsLost: -5 }), 0);
});
```

Em `rxstats.js`, `lossPercent`:

```js
  function lossPercent(sample) {
    const lost = Math.max(0, sample?.packetsLost || 0);
    const offered = (sample?.packetsReceived || 0) + lost;
    if (!offered) return null;
    return (lost / offered) * 100;
  }
```

- [ ] **Passo 6: verificação**

```bash
npm test
```

Esperado: **~220** (219 + 1).

```bash
node --check src/renderer/app.js
```

- [ ] **Passo 7: commit**

```bash
git add src/renderer/app.js src/renderer/style.css src/renderer/rxstats.js src/renderer/rxstats.test.js
git commit -m "fix(qualidade): ttl no receiveHealth, applyLiveQuality via reapply, e menores"
```

---

## Depois de todas: apagar a branch parqueada

```bash
git branch -D feat/orcamento-banda-relay
git push origin --delete feat/orcamento-banda-relay
```

O conteúdo dela vive agora, reconciliado, nas Tasks 1, 2, 5, 6, 7.

## Verificação manual final (o que os testes não cobrem)

Sala de 4: **A** compartilha 1080p60, **B** é relay puro pra **C** e **D**.

1. Aba Estatísticas do **B** não está vazia — linha por filho, "banda disponível".
2. C e D recebem já **abaixo** de 1080p60 (B divide o uplink por 2) sem ninguém sofrer.
3. Estrangular CPU do C (DevTools 6x) → em ~3 s `[qualidade] escada de C` **no B**; resolução do C cai, do D não.
4. Estrangular link do C (Clumsy, 5% perda) → escada do C desce por `senderBandwidthLimited` (Task 5).
5. Minimizar a janela do **A** enquanto o encoder dele sofre → a escada global desce em ~3 s (não 15).
6. **A** pausa 40 s → nada "recupera" durante a pausa.
7. Soltar tudo → cada escada sobe de volta, um degrau por vez, ~20 s.

## Contagem de testes esperada

| Depois da | Testes |
|---|---|
| base (0.2.0) | 202 |
| 1 | 208 |
| 2 | 211 |
| 3 | ~217 (reescrita, não só adição) |
| 4, 5, 6, 7, 8 | ~217 (fiação) |
| 9 | ~219 |
| 10 | ~220 |
