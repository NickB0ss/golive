# Trocar de tela/janela sem parar a transmissão — plano

Spec: `docs/superpowers/specs/2026-09-12-trocar-fonte-ao-vivo-design.md`
(leia primeiro — tem o raciocínio completo, este arquivo é só a lista de
tarefas).

## Regras globais (repetidas do brief comum, valem pra toda tarefa aqui)

1. Comentário de código em português **sem acentos**; texto de UI **com**
   acentos.
2. Módulo puro novo = IIFE + `module.exports` no fim, teste `node --test`
   ao lado (`x.js` → `x.test.js`).
3. `app.js` sem teste — só chama os módulos.
4. Nenhuma dependência nova.
5. `npm test` tem que continuar em 581 passando (mais os testes novos);
   `npm run lint` sem novo erro.
6. Não mexa em nada fora do escopo abaixo. Não formate, não renomeie.
7. Não faça commit.

## Tarefa 1 — `screenrelay.js`: trocar a entrada sem trocar a saída

Arquivo: `src/renderer/screenrelay.js`.

- Adicionar `swapSource(newTrack)` ao objeto devolvido por `create()`.
  Cria um leitor novo (`new g.MediaStreamTrackProcessor({ track: newTrack }).readable.getReader()`)
  — se falhar (track inválida/encerrada), devolve `false` e NÃO mexe em
  nada do que já está rodando. Se der certo: guarda o leitor antigo numa
  variável local, reatribui a variável de closure `leitor` pro novo, e SÓ
  DEPOIS cancela o antigo (`leitorAntigo.cancel()`).
- O laço `while (vivo) { ... }` precisa de uma flag (`trocando`, por
  exemplo) setada por `swapSource` antes do cancelamento: quando o
  `leitor.read()` do laço volta com erro OU `done` por causa desse
  cancelamento (comportamento do `cancel()` num reader com leitura em
  voo), o laço consome a flag (zera ela) e faz `continue` em vez de
  `break` — senão o relay inteiro para no meio da troca.
- `swapSource` devolve `true` quando aceitou a troca.
- Não mude a lógica de redimensionamento do canvas (já lê
  `frame.displayWidth/displayHeight` a cada quadro, já serve pra fonte
  nova sem alteração).
- Teste em `screenrelay.test.js` (arquivo já existe? confira; se não
  existir, crie do zero seguindo o padrão de mocks que os outros testes de
  módulos do renderer usam pra `MediaStreamTrackProcessor`/canvas/
  `captureStream`). Cobrir: `swapSource` com track válida troca sem
  encerrar o `stop()`/track de saída; `swapSource` com track inválida
  devolve `false` e o relay antigo continua entregando quadros da fonte
  velha; dois `swapSource` em sequência rápida (a segunda chamada troca de
  novo antes do laço processar o cancelamento da primeira) não trava o
  laço nem derruba `vivo`.

## Tarefa 2 — `src/renderer/sourceswap.js` (novo módulo puro)

Ver a spec, seção "sourceswap.js", pra assinatura exata de cada função.
Resumo:

- `decideAudioStrategy({ shareSound, isWindowSource, includeDiscord, windowPid, ownPid })`
  → espelha a decisão que já existe em `app.js` `startShare` (linhas perto
  de 2861-2886 na `main` — confira o número exato no worktree, pode ter
  mudado): sem som → `{ mode: 'none' }`; janela sem PID ou tela sem PID
  próprio → `{ mode: 'system-loopback' }`; janela com PID →
  `{ mode: 'process', basePid: windowPid, baseExclude: false }`; tela com
  PID próprio e Discord incluído → `{ mode: 'process', basePid: ownPid,
  baseExclude: true }`; tela com PID próprio sem Discord →
  `{ mode: 'include-list' }`.
- `wantsSeparateDiscordCapture({ isWindowSource, includeDiscord, discordPid, basePid })`
  → `true` só quando `isWindowSource && includeDiscord && discordPid &&
  discordPid !== basePid` (mesma regra do `startShare`).
- `planSwap({ fromSourceId, toSourceId })` → `{ fromIsWindow, toIsWindow,
  overlayShouldReopen }` (`overlayShouldReopen = toIsWindow === false`;
  ambos os `isWindow` vêm de `sourceId.startsWith('window:')`).

Teste (`sourceswap.test.js`) cobrindo cada combinação relevante de
`decideAudioStrategy` (pelo menos as 5 listadas acima) e
`wantsSeparateDiscordCapture` (os 2 casos: soma e não soma) e `planSwap`
(tela→tela, tela→janela, janela→tela, janela→janela).

Lembrete do IIFE (repo já tem o padrão em qualquer módulo do renderer,
copie a forma de `status.js` ou `screenrelay.js`) + tag `<script>` nova em
`src/renderer/index.html` **antes** de `app.js` (a ordem dos scripts
existentes já é alfabética-ish por dependência; coloque perto de
`screenrelay.js`/`mesh.js`).

## Tarefa 3 — `src/renderer/mesh.js`: `replaceLocalTrack`

Adicionar ao objeto que a factory de `mesh.js` devolve (perto de
`setPeerDemand`, mesma área de código):

```js
function replaceLocalTrack(kind, matchKind, track) {
  let tocados = 0;
  for (const peer of peers.values()) {
    const pc = peer.outConns[kind];
    if (!pc) continue;
    if (matchKind === 'video' && peer.suspended?.[kind]) continue;
    const sender = pc.getSenders().find((s) => s.track?.kind === matchKind);
    if (!sender) continue;
    sender.replaceTrack(track || null).catch(() => {});
    tocados += 1;
  }
  return tocados;
}
```

(ajuste conforme o estilo real do arquivo — comentário em português sem
acento explicando POR QUE pula peer suspenso em vídeo, citando P1 da
avaliação). Exportar no `api` que a factory devolve. Cobrir em
`mesh.test.js` (arquivo já existe, use os mocks de `RTCPeerConnection` que
já estão lá): substituir vídeo num peer normal; pular vídeo num peer
suspenso (sender continua com `track === null` depois da chamada);
substituir áudio incondicionalmente mesmo com o peer suspenso em vídeo.

## Tarefa 4 — `src/renderer/app.js`: função `swapShare` + fiação

Sem teste (regra do repo). Mudança pontual, sem tocar no `startShare`
existente.

1. Variáveis de módulo novas perto de `sharePaused`/`screenRelay`:
   `let swapping = false;` e `let currentSourceId = null;`.
2. Em `startShare`, uma linha só: guardar `currentSourceId = sourceId;`
   (não mude mais nada da função). Em `resetShareState`, zerar
   `currentSourceId = null;` e esconder o botão novo
   (`$('btn-swap-share').classList.add('hidden')`).
3. Em `startShare`, depois que a transmissão sobe com sucesso (perto de
   `$('btn-pause-share').classList.remove('hidden')`), mostrar também o
   botão de trocar: `$('btn-swap-share').classList.remove('hidden')`.
4. `async function swapShare(newSourceId, shareSound, includeDiscord)`
   implementando os 9 passos da spec (seção `app.js`). Reaproveite
   `ensurePcmWorklet`, `startNativeProcessAudioNode`,
   `startIncludeListCapture`, `getOwnPidCached` (já existem, não
   duplique). Use `sourceswap.decideAudioStrategy` /
   `sourceswap.wantsSeparateDiscordCapture` / `sourceswap.planSwap` em vez
   de reescrever a lógica inline.
   - Falha em qualquer ponto ANTES de tocar em `localStream` → toast e
     `return` limpo, nada a desfazer.
   - Falha DEPOIS de já ter trocado o vídeo (ex.: áudio falhou) → o vídeo
     já trocado FICA (não há por que desfazer uma troca de vídeo que deu
     certo só porque o áudio falhou); só o áudio mantém a fonte antiga.
   - `swapping` no `finally`, mesmo padrão de `sharing` no `startShare`.
5. Botão novo com listener:
   `$('btn-swap-share').addEventListener('click', () => { if (!localStream || swapping) return; ui.picker.open({ mode: 'swap', onGoLive: swapShare, nativeAudioAvailable: await isNativeAudioAvailable(), quality: cfg.quality, allowAnnotations: shareAnnotations }); })`
   — confira a assinatura exata que `openPicker` passa a aceitar na tarefa
   6; ajuste os nomes dos campos conforme o que for implementado lá (a
   chamada de `startShare` logo acima no arquivo é o modelo).

## Tarefa 5 — `src/renderer/ui.js`: `annotations.clearSurface` + modo do seletor

- Uma função nova `clearAnnotSurface(tileId)` que chama
  `emitAnnotOp(tileId, { op: 'clear', scope: 'all' })` (a função
  `emitAnnotOp` já existe no arquivo, só falta expor uma entrada pública).
  Adicionar `clearSurface: clearAnnotSurface` no objeto `annotations` que
  o módulo devolve (perto de `render: ...`).
- `openPicker`: aceitar um campo `mode` (`'start'` por padrão, novo valor
  `'swap'`). Quando `'swap'`:
  - Trocar o texto do `<h2>` do diálogo ("O que você quer compartilhar?"
    → algo como "Trocar para qual fonte?") e o texto do botão
    `#btn-go-live` ("Ir ao vivo" → "Trocar"). Restaurar os textos padrão
    quando `mode !== 'swap'` (o diálogo é reaproveitado, os textos ficam
    escritos no DOM entre uma abertura e outra).
  - Esconder a seção "Qualidade" (o `<h3>Qualidade</h3>` e os elementos
    logo abaixo dele até antes de `<h3>Áudio</h3>` — confira os ids exatos
    em `index.html`: `#picker-quality`, `#picker-quality-bandwidth`, e o
    próprio `<h3>` — dê uma classe/id no contêiner se for mais limpo que
    esconder um por um) e a seção "Anotações" (o `<h3>Anotações</h3>` +
    `.check-group.bare` logo abaixo). Mostrar de novo quando
    `mode !== 'swap'`.
  - Travar a checkbox de som: `shareSoundEl.disabled = mode === 'swap'`.
    O valor inicial dela em modo troca deve refletir o estado ATUAL da
    transmissão, não sempre `true` — `openPicker` precisa receber esse
    estado (campo novo, ex.: `currentShareSound`) de quem chama
    (`swapShare`'s caller em `app.js`, tarefa 4) em vez de resetar pra
    `checked = true` como faz hoje.
  - `#allow-annotations` não precisa de tratamento especial além de estar
    dentro da seção escondida — o valor que `onGoLive` recebe pra esse
    campo é ignorado por `swapShare` (assinatura de 3 argumentos, não 4).

Sem teste (é `ui.js`, sem harness — mesma regra de `app.js`).

## Tarefa 6 — `index.html` / `style.css`: botão "Trocar"

- Botão novo em `index.html`, dentro de `.control-bar`, logo depois do
  `#btn-pause-share` (antes do `#btn-disconnect`):
  ```html
  <button id="btn-swap-share" class="secondary control-btn hidden" type="button" aria-label="Trocar de tela ou janela">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
    <span class="btn-label">Trocar</span>
  </button>
  ```
  (ícone de duas setas circulares — troca/reload; ajuste o path se achar
  um SVG mais limpo, mantendo o mesmo `viewBox`/atributos dos outros
  ícones do control-bar pra ficar do mesmo tamanho).
- `#picker-quality`/seções escondíveis: se a tarefa 5 usar um wrapper novo
  (`<div id="picker-quality-section">` etc.) em vez de esconder elemento
  por elemento, adicione esse wrapper aqui — sem mudar o HTML de dentro.
- `style.css`: só se o botão precisar de ajuste que `.secondary.control-btn`
  não cobre (não deveria precisar — é a mesma classe do botão de
  Pausar/Câmera). Se precisar de algo, vai num bloco novo no FIM do
  arquivo com comentário de cabeçalho "troca de fonte ao vivo".

## Ordem de execução sugerida

1 e 2 são independentes (podem ir juntas num commit do Codex). 3 depende
só de `mesh.js` (independente de 1/2). 4 depende de 1, 2 e 3 prontos.
5 e 6 podem ir em paralelo com 4 (interfaces conhecidas pela spec), mas
revise a integração no fim — os nomes de campo que `app.js` passa pro
`openPicker` (tarefa 4/5) têm que bater.

## Critério de pronto

- `npm test`: 581 + os testes novos, todos passando.
- `npm run lint`: 0 erros (9 avisos pré-existentes tudo bem, nenhum novo
  aviso introduzido pelas mudanças).
- Diff restrito aos arquivos desta lista + os dois specs/plans. Nenhuma
  linha tocada em `startShare` além da adição de 1 linha
  (`currentSourceId = sourceId`) e da linha que mostra o botão novo.
- Roteiro de teste manual da spec (seção final) documentado no relatório,
  mesmo sem poder rodar (sem 2 PCs nesta sessão) — dizer explicitamente
  que não foi executado.
