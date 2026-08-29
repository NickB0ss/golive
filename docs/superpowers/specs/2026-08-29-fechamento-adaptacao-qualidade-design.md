# Fechamento da adaptação de qualidade — design

**Goal:** fazer a adaptação de qualidade da 0.2.0 funcionar de verdade —
ligar o loop de estatísticas num relay puro (sem isso a Task 5.5 é código
morto), fechar os buracos que os reviews acharam, e integrar a branch
parqueada `feat/orcamento-banda-relay` (orçamento de banda do relay), que é
uma implementação **complementar** da mesma frente.

**Architecture:** toda lógica nova continua em módulo puro (`autoquality.js`,
`peerquality.js`, `config.js`) com teste `node --test`; `app.js` só fia. As
mudanças de `mesh.js` são fiação de WebRTC. O laço fecha dentro do
`updateStats`, que passa a rodar também num relay puro.

**Tech Stack:** Electron 32, JavaScript sem build step, `node --test`, zero
dependências novas.

## Contexto

A 0.2.0 (`feat/transmissao-honesta` + `feat/qualidade-por-espectador`,
mescladas) entregou a adaptação de qualidade por conexão. Os reviews de
branch inteira deixaram achados ledgerados, e uma revisão posterior do
código de `main` achou o mais grave:

**`updateStats` não roda num relay puro.** `startStatsLoop` só é chamado
quando `localStream || cameraStream` (`startShare`, `startCamera`, o
`welcome` de reconexão). Um nó que é **só relay** de outra pessoa nunca liga
o loop. Consequência: a Task 5.5 (escada por-filho num relay puro), a
cadência de 1 s do `broadcastViewState` e o cálculo de `receiveHealth` — tudo
dentro de `updateStats` — não acontece nesse nó. A Task 5.5 passou no review
porque o review checou a lógica assumindo que `updateStats` roda; não roda.

A branch `feat/orcamento-banda-relay` já tem o conserto (`syncStatsLoop`) e
mais três coisas complementares. Ela é **implementação concorrente de parte
da qualidade relay→filho**, então precisa ser reconciliada, não só mesclada.

## As duas implementações de qualidade relay→filho

| | `qualidade-por-espectador` (na 0.2.0) | `orcamento-banda-relay` (parqueada) |
|---|---|---|
| pergunta que responde | "dado o CPU/link **deste filho**, quanto menos que o teto ele recebe?" | "dado meu **uplink** e N filhos, qual o teto que dá pra empurrar pra **todos** sem saturar meu link?" |
| função | `qualityForPeer(childId, ck)` (escada de histerese por `receiveHealth`) | `config.qualityForRelay(originPreset, N, myAvailableBps)` (determinística) |
| aplica | `applyEncodingToPeer` por filho, com `scaleResolutionDownBy` | `applyEncoding` por childKind (um preset pra todos os filhos de uma origem) |
| gatilho | `receiveHealth` (CPU + travas) reportada pelo filho | `myAvailableBps` (do `availableOutgoingBitrate`) |

**São complementares.** O teto do `qualityForRelay` é o **piso** dos filhos
daquele relay; `qualityForPeer` desce a partir dele por filho.

## Decisões de reconciliação

1. **`qualityForPeer` para filho de relay parte de `min(qualityFor(ck),
   qualityForRelay(...))`**, não só de `qualityFor(ck)`. O `qualityForRelay`
   entra como um limitador do piso, do lado da origem do cálculo.

2. **`rebudgetRelays` não vem como função separada.** `reapplyAudienceQuality`
   já recomputa por filho a cada chamada; a mudança é só *o que* significa
   "piso" pra um filho de relay (decisão 1). Uma função a menos.

3. **`relayPresetApplied`** (cache "não chama `setParameters` se o preset não
   mudou") — **fica de fora por ora.** `reapplyAudienceQuality` chama
   `applyEncodingToPeer` toda vez sem esse guard, e `setParameters` com
   params iguais é barato. Se sala crescer, vira um dirty-check. Ledgerado.

4. **`syncStatsLoop` + `isRelaying` vêm da branch parqueada.** `isRelaying`
   (checa todos os KINDS) generaliza o `isRelayingScreen` que a Task 5.5
   criou — **substituir** `isRelayingScreen` por `isRelaying` (um só). Os
   sites que hoje chamam `startStatsLoop()` na mudança de papel de relay e o
   `stopShare` passam a chamar `syncStatsLoop()`.

5. **O laço de stats de filho de relay** (o `for kind of KINDS / for
   sourceId,state of myRole[kind] / for childId` que chama
   `statsFor(childId, childKind)`) vem da branch parqueada. Ele preenche
   `rows` com dados de envio dos kinds compostos — que é o que dá ao
   `limByPeer` as chaves `screen@x` e **fecha o buraco do
   `senderBandwidthLimited` pro filho de relay** (achado do review da Task 5).

6. **`readSenderReport` ganha `availableBps`, `packetsLost`, `fractionLost`**
   e o painel de Estatísticas ganha "banda disponível" e "perda rede" (da
   branch parqueada, quase verbatim).

7. **`mesh.js`: `startBitrateKbps` cai pra 1/4 do teto (cap 2500)** e
   **`degradationPreference` da tela vira `'balanced'`** (da branch
   parqueada). São melhorias independentes. **Corrigir o bug da branch:**
   o `setDegradationPreference` dela redeclara o parâmetro `pref` com `const
   pref` no corpo — `SyntaxError`. Tirar o parâmetro, derivar de `kind` do
   closure.

## Os achados de review a fechar (section 2)

| Achado | Conserto |
|---|---|
| Escada de auto-qualidade reage em ~15 s com a janela escondida (poll de 5 s), = jogando em fullscreen | `autoquality.next` e `peerquality.next` passam a contar **tempo contínuo de sofrimento** (`atMs`), não amostras — mesmo padrão do lado da recuperação |
| Relógio de recuperação ganha crédito enquanto pausado / sem encode | O tick da escada global e o da por-peer **pulam** quando `sharePaused` ou quando não há linha de sender pra aquele kind |
| M3 tirou o lever de "relay com encoder saturado, decode em hardware" | `peerquality.isBad` ganha `peerEncodeSaturated`, derivado de `peer.encodeHealth` (que a decisão 5 faz subir de verdade do relay) |
| `rxHealthByPeer` fica com valor velho se um stream congela de vez → peer "recupera" travado | TTL: entrada mais velha que N janelas de amostra é tratada como ausente (`null`) |
| `applyLiveQuality` não atualiza `lastCaptureKey` → um `applyConstraints` redundante | `applyLiveQuality` chama `reapplyAudienceQuality()` (idempotente, já cuida da captura) |
| `<h4>Recebendo</h4>` sem estilo | uma regra `.stats-subtitle` |
| `lossPercent` não clampa `packetsLost` negativo | `Math.max(0, …)` |
| `rxPrevAtMs` não zera em `startStatsLoop`/`resetShareState` | zerar junto de `rxPrevSample` |

## Global Constraints

1. Comentários em português sem acentos, no estilo do arquivo, explicam *por
   que*. Texto de UI usa acentos.
2. Testes `node --test`, ao lado do módulo, `module.exports` no fim.
3. Nenhuma dependência nova.
4. `app.js` não tem testes. Lógica testável em módulo puro.
5. `npm test` passa inteiro. Base: **202** (`main` na 0.2.0). Nenhum teste
   afrouxado.
6. Um commit por tarefa, `feat(escopo): …` / `fix(escopo): …` em português
   sem acentos.
7. A regra do tema é lei. As colunas e o subtítulo do painel são neutros.

## Estrutura de arquivos

| Arquivo | Mudança | Tarefa |
|---|---|---|
| `src/renderer/config.js` | `+ qualityForRelay` (da branch parqueada) | 1 |
| `src/renderer/mesh.js` | `startBitrateKbps` 1/4 cap 2500; `setDegradationPreference` tela=`balanced` (bug corrigido) | 2 |
| `src/renderer/app.js` | `syncStatsLoop`/`isRelaying` substitui `isRelayingScreen`; `startStatsLoop`→`syncStatsLoop` nos sites de relay | 3 |
| `src/renderer/app.js` | laço de stats de filho de relay em `updateStats` | 4 |
| `src/renderer/app.js` | `myAvailableBps`; `qualityForPeer` piso = `min(qualityFor, qualityForRelay)` pra filho de relay | 5 |
| `src/renderer/app.js` | `readSenderReport` + `renderStats`: banda disponível, perda de rede | 6 |
| `src/renderer/autoquality.js`, `peerquality.js` | gatilho de degradação por **tempo contínuo**, não contagem de amostras | 7 |
| `src/renderer/app.js` | tick pula quando pausado / sem encode | 8 |
| `src/renderer/peerquality.js` | `+ peerEncodeSaturated` no `isBad` | 9 |
| `src/renderer/app.js` | TTL do `rxHealthByPeer`; `rxPrevAtMs` zera; `applyLiveQuality`→`reapplyAudienceQuality`; `lossPercent` clamp; `.stats-subtitle` | 10 |

## Ordem e dependências

```
1 (qualityForRelay) ─┐
2 (mesh bitrate)      ├─> 3 (syncStatsLoop) ─> 4 (stats relay-child) ─> 5 (reconciliar piso)
                      │                          │
7 (gatilho por tempo) ┘                          └─> 6 (painel)
8 (pula tick pausado) ───────────────────────────────> 9 (peerEncodeSaturated) ─> 10 (TTL + minors)
```

1, 2, 7 independentes. 3 é o desbloqueio (faz `updateStats` rodar no relay
puro). A verificação manual (3 máquinas, uma relay pura) só vale da 5 em
diante.

## Fora deste plano

`feat/orcamento-banda-relay` deixa de existir depois deste plano (o conteúdo
dela entra reconciliado). Não mexe na eleição da árvore. Não mexe em
topologia (SFU/encode-once seguem parqueados). F3, D1, B1 têm planos
próprios.

## Contagem de testes esperada

| Depois da tarefa | Testes |
|---|---|
| base (0.2.0) | 202 |
| 1 | ~210 |
| 2 | ~213 |
| 7 | ~219 |
| 9 | ~222 |
| 3, 4, 5, 6, 8, 10 | ~222 (fiação) |
