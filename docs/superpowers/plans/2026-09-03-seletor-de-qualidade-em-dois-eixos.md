# Seletor de qualidade em dois eixos — plano de implementação

**Spec:** [`2026-09-03-seletor-de-qualidade-em-dois-eixos-design.md`](../specs/2026-09-03-seletor-de-qualidade-em-dois-eixos-design.md)

**Objetivo:** trocar os seis chips quadrados de preset por dois controles
segmentados (Resolução × Fluidez) com uma linha de resumo, resolvendo os
três defeitos da seção 1 da spec: forma repetida demais, texto demais pra
ler, e ordem escondida pela quebra de linha da grade.

**Restrição global:** nenhuma camada de transporte nem de adaptação é
tocada. `mesh.js`, `tree.js`, `autoquality.js`, `peerquality.js`,
`rxstats.js`, `encode*.js`, `server/`, `src/main/` e `app.js` ficam byte a
byte iguais — a tabela de presets, a cadeia de degradação e as funções
`qualityFor*` de `config.js` também. `npm test` e `npm run lint` verdes ao
fim de cada task.

## Mapa de arquivos

| Arquivo | Ação | O quê |
|---|---|---|
| `src/renderer/config.js` | modificar | `QUALITY_RESOLUTIONS`, `QUALITY_FPS`, `presetFor()`, `presetAxes()` — só adição, nada existente muda |
| `src/renderer/config.test.js` | modificar | cobertura dos dois eixos, incluindo o invariante "produto cartesiano == `QUALITY_PRESET_ORDER`" |
| `src/renderer/index.html` | modificar | `#picker-quality` vira container das duas trilhas; `aria-live` na linha de resumo |
| `src/renderer/style.css` | modificar | `.quality-axis`/`.quality-seg` entram, `.quality-chip*` saem |
| `src/renderer/ui.js` | modificar | render das trilhas, seleção por eixo, teclado com clamp, sufixo da linha de resumo |

## Tasks

**Estado: concluído em 2026-09-03**, na branch
`claude/quality-selection-ui-ux-mso19o`. Verificado renderizando
`index.html` no Chromium com a ponte do preload stubada: abertura, clique
nos dois eixos, setas com clamp nas pontas, `Home`/`End`, roving tabindex e
`aria-checked` conferidos, e `onQualityChange` disparando uma vez por
mudança real (nenhuma vez nas pontas).

Dois acertos que a verificação no navegador revelou, fora do plano original:
a linha de custo escrevia `2.5 Mbps` com ponto decimal no meio de uma frase
em português (virou vírgula), e seta parada na ponta chamava
`onQualityChange` com o mesmo preset — o que dispararia `applyLiveQuality()`
no `app.js` pra renegociar o encoder e chegar no mesmo lugar, com a
transmissão no ar.

- [x] **1. Eixos em `config.js`** — `QUALITY_RESOLUTIONS = ['720p','1080p','1440p']`
  e `QUALITY_FPS = [30, 60]` explícitos; `presetFor(res, fps)` devolvendo
  preset válido (padrão pra combinação desconhecida) e `presetAxes(preset)`
  derivando os eixos da própria `QUALITY_PRESETS` (altura → `${h}p`), pra que
  não exista um segundo lugar onde a resolução possa divergir da tabela.
  Nenhuma função existente muda.

- [x] **2. Testes dos eixos** (`config.test.js`) — ida e volta
  `presetAxes → presetFor` pra todo preset; produto cartesiano dos dois eixos
  batendo exatamente com `QUALITY_PRESET_ORDER` (o que prova que a matriz não
  tem célula morta nem preset órfão); entradas inválidas caindo no padrão.

- [x] **3. Marcação** (`index.html`) — `#picker-quality` passa de
  `.quality-chips[role=radiogroup]` pra `.quality-axes` (sem role: quem tem
  `role=radiogroup` agora é cada trilha, montada por `ui.js`);
  `#picker-quality-bandwidth` ganha `aria-live="polite"`.

- [x] **4. Trilhas** (`style.css`) — `.quality-axis` (rótulo + trilha),
  `.quality-seg` (grade de colunas iguais, polegar em `::before` deslizando
  por `translateX(calc(var(--seg-index) * 100%))`), `.quality-seg-opt`.
  As regras `.quality-chip*` saem inteiras.

- [x] **5. Render e seleção** (`ui.js`) — `QUALITY_PRESET_SPLIT` sai; as duas
  trilhas são montadas a partir de `QUALITY_RESOLUTIONS`/`QUALITY_FPS`;
  `syncQualityAxes(preset)` posiciona os dois polegares e o roving tabindex;
  clique e setas com clamp nas pontas (mais `Home`/`End`); linha de resumo
  com o sufixo da tabela §3.2 da spec. `openPicker` mantém a mesma assinatura.

- [x] **6. Verificação** — `npm test` e `npm run lint` verdes; conferir na
  janela que as duas trilhas cabem sem estourar o `.picker-box` e que o
  polegar não pisca ao abrir o diálogo.
