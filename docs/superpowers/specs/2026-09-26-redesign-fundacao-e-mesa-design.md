# Redesign, fase 1 — fundação visual e a Mesa

Data: 2026-09-26. Base: `main` com o PR #84 (acabamento da Mesa e as sete janelas novas).

Pedido do Nicolas: "re-design profissional adaptado para as novas mudanças… uma NOVA cara do aplicativo".
Problemas que ele apontou: os botões de fechar e maximizar ficam sobre as janelas da Mesa e atrapalham os
botões de dentro; algumas janelas deveriam nascer do tamanho certo (a roleta mostra só as opções); e é
preciso escolher melhor o que fica sobreposto.

## 0. Decisões desta conversa

| Assunto | Escolha | Descartado |
|---|---|---|
| Alcance | o app todo, em três fases, com a Mesa primeiro | só a Mesa; tudo num PR |
| Moldura da janela | barra de título fixa acima do conteúdo (A) | aba de pasta (B); controles flutuando, como hoje (C) |
| Casca com a Mesa | controles com lugar fixo e área segura (seção 3) | — |
| Forma | "Macio": raios grandes, pílulas, sombra projetada (B) | "Preciso": raio de 6 a 8 px sem sombra (A) |
| Base | branch a partir da `main` depois do merge do #84 | empilhar sobre `feat/mesa-acabamento` |

Mockups: `C:\Users\nicol\AppData\Local\Temp\golive-brainstorm\.superpowers\brainstorm\` (`moldura.html`,
`casca.html`, `identidade.html`).

## 1. Diagnóstico (código do #84)

1. **Controles sobre o conteúdo.** `.mesa-handle` (28 px de altura, `z-index: 4`) e `.mesa-ctrls` (avatar, ⤢, ✕)
   ficam em `position: absolute` sobre o topo do `.mesa-win-body`. Cobrem o placar do Truco e o status do Oito e,
   em "Ver tudo", os controles do topo do pôquer, do blackjack, do oito e do dominó (risco anotado na passagem
   de 26/09). O HIG pede o contrário: a janela tem um *frame* acima do corpo (`windows.md › macOS window anatomy`),
   e os controles de janela não podem sobrepor os itens do conteúdo (`windows.md › Tablet (iPadOS)`).
2. **Tamanho de nascimento nunca foi conferido com o conteúdo.** A roleta nasce com 440×520, e o CSS só mostra roda
   e opções lado a lado a partir de 560 px (`@container mj (max-width: 559px)`). Abaixo disso, `.mj-rol-painel`
   passa a `position: absolute; inset: 0` e cobre a roda. Nenhum teste mede se uma janela cabe no tamanho padrão.
3. **Camadas sem regra.** São 43 `z-index` em `style.css` e 6 em `mesa-janelas.css`, com valores 1 a 9, 50, 60, 70
   e alguns tokens `--z-*`. O mapa (190×120, sempre aberto), o zoom, os avatares no canto do canvas, a nota de
   trava e os avisos disputam o mesmo espaço e ficam por cima das janelas.

## 2. O que não muda

Estas decisões anteriores continuam valendo (vault: `golive - acento reservado…`, `casca de app…`,
`tema escolhível…`):

- Paleta da logo (tema `marca`) e as fontes Outfit + Work Sans.
- `--live` (vermelho) só significa "alguém está ao vivo".
- Nada de `filter` nem `backdrop-filter`. Só `transform` e `opacity` animam.
- Cor sempre por token. O contrato de temas tem `--live`, `--warn` e `--danger` travados e a trava de contraste
  reprova antes de aplicar.
- Todo `id` do `index.html` sobrevive. Mover pode, renomear não.
- Na Transmissão não existe nada da Mesa no DOM, e o dock fica no fluxo do layout.

## 3. Fundação (vale para o app todo)

### 3.1 Forma "Macio"

Os tokens de raio já existem (`--r-xs` 6, `--r-sm` 10, `--r-md` 14, `--r-lg` 18, `--r-full`). O que muda é o papel
de cada um:

| Papel | Token |
|---|---|
| Janela da Mesa, cartão, diálogo, popover | `--r-lg` |
| Linha de lista, campo, item de menu | `--r-md` |
| Botão com texto, dock, segmentado, pílula de estado | `--r-full` |
| Botão só de ícone | `50%` (redondo) |
| Detalhe interno pequeno (tecla, chip de 20 px) | `--r-xs` |

Espaçamento sobe um degrau dentro de janela e cartão: `--s-3` de respiro na borda, em vez de `--s-2`.

### 3.2 Profundidade por sombra

Três tokens novos por tema, cada um um `box-shadow` com um reflexo de 1 px no topo (`inset 0 1px 0`):

| Token | Uso |
|---|---|
| `--elev-1` | cartão, item elevado |
| `--elev-2` | janela da Mesa, dock, pílula de controles |
| `--elev-3` | janela ativa e janela sendo arrastada, menu, popover |

- A sombra é estática. No arrasto só o `transform` muda, então ela é pintada uma vez.
- No tema claro Papel, a sombra fica mais leve e a borda de 1 px (`--line2`) volta, para a borda não sumir no
  fundo claro.
- A trava de contraste de `theme.js` não mede sombra. Temas personalizados herdam os valores do preset de base.

### 3.3 Camadas nomeadas

Escala única em `style.css`, do fundo para a frente:

`--z-canvas` < `--z-win` < `--z-win-drag` < `--z-mesa-hud` < `--z-dock` < `--z-toast` < `--z-popover` <
`--z-modal` < `--z-modal-popover` < `--z-dialog` < `--z-titlebar`

- Os tokens que já existem (`--z-popover`, `--z-toast`, `--z-modal`, `--z-modal-popover`, `--z-titlebar`,
  `--z-dialog`) entram nessa ordem. `--z-dialog` continua acima do popover do modal (confirmações abertas de dentro dele).
- Dentro de um componente com contexto de empilhamento próprio (`isolation: isolate`), vale `z-index` 0, 1 ou 2
  local, com comentário.
- **Teste** em `css-rules.test.js`: `z-index` numérico acima de 2 fora dos blocos de token reprova. Todo token
  `--z-*` usado precisa estar definido na escala.

### 3.4 Ícones e alvos

- Um só conjunto SVG de traço 1,75 px, com tamanhos 16, 20 e 24. Os ícones que já existem em `ICON`
  (`mesa-view.js`) e no `index.html` seguem o mesmo traço. Nenhum emoji serve de ícone de controle.
- Todo botão só de ícone tem `aria-label` e `title`.
- Alvo mínimo de 28×28 px dentro das janelas da Mesa (piso de desktop do HIG, `accessibility.md`) e de 36 a 44 px
  na casca e no dock.
- Todo elemento clicável tem hover sem mudança de tamanho e `:focus-visible` com `var(--ring)`.

## 4. A Mesa

### 4.1 Moldura: barra de título

Estrutura nova de `makeWin` (`mesa-view.js`):

```
.mesa-win  (role=group, aria-label="<título>, posta por <nome>")
├── .mesa-bar            36 px, arrastar por aqui
│   ├── .mesa-bar-title  título (≤ 15 caracteres; Outfit 600)
│   ├── .mesa-bar-status estado curto (setStatus), --tx2, com reticências
│   ├── .mesa-bar-turn   pílula "Sua vez" (hidden por padrão)
│   ├── .mesa-avatar     quem pôs
│   └── botões ⋯ ⤢ ✕     28×28, redondos
├── .mesa-win-body       o conteúdo; nada por cima dele
└── .mesa-resize × 5     bordas (sem mudança)
```

- **Somem `.mesa-handle` e `.mesa-ctrls`.** A regra `.room-idle .mesa-ctrls { opacity: 0 }` sai. A barra é
  moldura, fica sempre visível e não depende do hover.
- **Arrastar só pela barra.** `onWinDown` passa a começar o arrasto apenas quando o alvo está em `.mesa-bar` e fora
  dos botões dela. O corpo é todo do conteúdo, o que resolve também o conflito com o rabisco nas telas.
  O teclado não muda: setas movem, Alt+setas redimensionam, F põe em tela cheia, Delete tira da mesa e
  Shift+F10 abre o menu.
- **⋯ abre o menu da janela** (`openMenuAt` com `winId`, ancorado no botão), o mesmo do botão direito.
  Todas as ações da janela ficam alcançáveis sem botão direito.
- **Título.** `titleOf(win)` continua sendo a fonte. Tela e câmera usam "Tela de Leo" e "Câmera de Caio", com a
  pílula AO VIVO antes do nome (a mesma `.mesa-live-pill`). O `.mesa-win-label` de hoje sai do corpo da mídia.
- **`api.setStatus(texto)`** entra em `makeApi`. O texto tem no máximo 60 caracteres, é cortado com reticências
  pelo CSS e vai para `textContent`, nunca para HTML. Chamar com `''` limpa. O status é local de cada pessoa:
  cada uma vê o próprio (a `view` secreta já é por pessoa).
- **`api.setTurn(boolean)`** entra em `makeApi`. Com `true`, a barra mostra a pílula "Sua vez" em cor de ação
  (`--act`/`--on-text`, nunca `--live`) e a região `.mesa-live` anuncia "Sua vez no <título>" uma vez por
  mudança de `false` para `true`. É o elemento de assinatura: com a mesa cheia, você acha de relance onde precisa
  jogar.
- **Janela ativa.** A última janela com foco ou toque recebe `.is-active`, com `--elev-3` e título em `--tx`. As
  outras ficam com título em `--tx2`. É o estado "key window" do HIG (`windows.md › macOS window states`).
- **Travas do líder** (`no-edit`, `no-resize`): os botões ficam `disabled` com o motivo em `title` (vindo de
  `lockReason()`), e a barra usa `cursor: not-allowed`. O ✕ continua escondido quando `!canRemove(win)`.
- **Tela cheia.** A barra continua no topo, e o ⤢ vira ⤡ com o rótulo "Sair da tela cheia".
- **Janela de outra pessoa sendo movida.** O `.mesa-moving` ("Bia está movendo") passa para a área de status da
  barra, sem nada por cima do corpo.

### 4.2 Tamanho: o `size` mede o conteúdo

- Em cada módulo, `size.w`, `size.h`, `size.minW`, `size.minH` e `size.aspect` passam a descrever o **corpo**.
- `mesa-modules/index.js` exporta `BAR_H = 36` e, ao normalizar o módulo, deriva `outer`:
  `{ w, h: h + BAR_H, minW, minH: minH + BAR_H, aspect, chromeH: BAR_H }`.
  O servidor (`signaling-core.js`: `checkRect` e a colocação de tela e câmera) e o app passam a usar `mod.outer`
  onde hoje usam `mod.size` para retângulos. `mesa.js › checkRect` fica como está e recebe o `outer`.
- `mesa-vista.js › resizeRect` e `keyRect` ganham `chromeH` (padrão 0): com `aspect`, a proporção vale para
  `h - chromeH`. Tela e câmera ficam 16:9 e 4:3 no corpo.
- Tela e câmera, postas pelo servidor em `index.js` (as linhas com `size` 640×360 e 320×240), seguem a mesma regra.
- **Compatibilidade.** O estado da Mesa vive só enquanto a sala existe, e a trava de versão impede clientes de
  versões diferentes na mesma sala. Não há migração de retângulos salvos.

### 4.3 Regra de tamanho, medida por teste

- **No tamanho padrão**, todo o conteúdo aparece: sem rolagem no corpo, nenhum painel cobrindo outro, nenhum
  controle cortado.
- **No tamanho mínimo**, aparece o essencial. O secundário some por `@container`, nunca por sobreposição.
  Painel em `position: absolute` sobre o conteúdo é proibido nas janelas; menus e popovers da própria janela
  (que abrem por clique e fecham com Esc) são a exceção.
- **Teto:** o padrão de qualquer janela, com a barra, cabe na área segura de 1366×768 com a coluna lateral aberta.
  O teste usa 1000×620 como teto.
- **Roleta:** o conteúdo padrão passa a 640×440, com roda e opções lado a lado; o mínimo fica em 360×420. Abaixo
  de 560 px de largura, a roda fica em cima e as opções numa lista rolável embaixo. O botão `.mj-rol-alternar` e
  o painel que cobre a roda saem.
- Os 31 outros tipos são ajustados pelo que o teste acusar (seção 6), sem lista escrita à mão aqui: a
  medida decide.

**Teste "caber"** — `tools/bancada-janelas/caber.js`, no padrão das bancadas atuais (Playwright,
`PLAYWRIGHT_DIR`). Para cada um dos 30 tipos de `MODULE_NAMES` e para tela e câmera (32 ao todo), nos temas padrão e Papel, no tamanho padrão e no mínimo,
com o estado inicial e com um estado cheio de exemplo (roleta com 8 opções, pôquer com 5 lugares, lista com 12
itens, …), ele confere:

1. `body.scrollHeight <= body.clientHeight + 1` e o mesmo na largura. No padrão, isso vale também para todo
   descendente com `overflow: auto` (nada de rolagem escondida). No mínimo, lista rolável é permitida.
2. Nenhum elemento visível tem caixa fora da caixa do corpo.
3. Para cada `button`, `input`, `select` e `[role=button]` visível, `document.elementFromPoint` no centro devolve
   o próprio elemento ou um descendente dele.
4. O padrão com a barra cabe em 1000×620.

Sai com código diferente de 0 quando falha e grava prints dos casos que falharam em `docs/prints/<data>-caber/`.

### 4.4 Área segura e controles da Mesa

- **Pílula de navegação**, embaixo à esquerda (`--z-mesa-hud`): − · % · + · Ver tudo · Mapa. O mapa deixa de
  ficar sempre aberto e vira popover acima da pílula, com o estado aberto/fechado lembrado em `localStorage`.
- **Avatares de quem está na Mesa** (`.mesa-people`) saem do canvas e vão para o cabeçalho do palco, ao lado do
  seletor Transmissão/Mesa. Só aparecem com a vista Mesa aberta. Clicar num avatar continua levando até o ponteiro
  daquela pessoa.
- **Avisos** (`.mesa-toast`) e a **nota de trava** (`.mesa-lock-note`) vão para uma fila centralizada logo acima do
  dock (`--z-toast`), com no máximo dois avisos visíveis ao mesmo tempo.
- **Área segura.** `measure()` calcula, pelas caixas reais da pílula e da fila de avisos, as margens
  `{top, right, bottom, left}` do canvas. `V.viewCenter`, "Ver tudo" (`fit`), `addWindow`, `spot` ("Pôr na mesa")
  e o voo do foco pelo Tab passam a usar o retângulo seguro, não a seção inteira.
- As janelas continuam sem se sobrepor (`M.nearestFree`). Só a janela arrastada sobe para `--z-win-drag`.

## 5. Fases 2 e 3 (esboço; cada uma terá spec própria)

- **Fase 2 — casca da sala:** cabeçalho do palco (nome, seletor, avatares, ações), dock na forma Macio, coluna
  Pessoas/Chat, tiles da Transmissão, cartão "Assistir" que ainda corta na tira de miniaturas, faixa de título do
  app.
- **Fase 3 — lobby e o resto:** lobby (barra lateral, cards de sala), Configurações, diálogos (criar sala, PIN,
  seletor de fonte), splash e Espiar.

Ambas usam só os tokens da seção 3. Se precisarem de token novo, ele entra na fundação primeiro.

## 6. Como o trabalho se divide

A sessão principal (Claude) coordena, escreve os prompts com o padrão de qualidade explícito, integra, commita,
roda o app real e faz a passada visual. Jobs do Codex com `-c service_tier=default`, **no máximo dois ao mesmo
tempo**, e nunca dois no mesmo arquivo (`mesa-view.js`, `style.css` e `mesa-janelas.css` só aceitam um job por
vez). Todo prompt diz "implemente direto, sem pedir confirmação; não commite", lista os arquivos a preservar e
exige: linhas de no máximo 120 colunas, um teste por regra, português em código e comentários.

| # | Etapa | Executor | Depende de |
|---|---|---|---|
| 1 | Tokens de forma, `--elev-*`, escala `--z-*`, migração dos `z-index` e o teste | Codex `gpt-5.6-terra` medium | — |
| 2 | Moldura (4.1) e tamanho do conteúdo (4.2), incluindo o servidor e os testes de `index.js`, `mesa-vista.js` e `signaling-core` | Codex `gpt-5.6-terra` high | 1 |
| 3 | Teste "caber" (4.3), só em `tools/` | Codex `gpt-5.6-terra` medium | em paralelo com a 2 |
| 4 | Área segura e controles da Mesa (4.4) | Codex `gpt-5.6-terra` medium | 2 |
| 5a | Janelas de cartas e jogos passando no "caber", com `setStatus`/`setTurn` | Codex `gpt-5.6-terra` medium | 3, 4 |
| 5b | Janelas de noite, ferramentas e assistir passando no "caber" (inclui a roleta) | Codex `gpt-5.6-terra` medium | 5a |
| 6 | Revisão final do PR, sandbox `read-only` | Codex `gpt-5.6-terra` high | 5b |
| 7 | `STATUS.md`, glossário e prints | Codex `gpt-5.6-luna` medium | 6 |

- Subagente Claude: no máximo um, Sonnet, só se a passada visual passar do que a sessão principal consegue fazer.
- Depois de todo job: `git status`, confirmar que o `-o …-last.txt` existe e ler o fim do `.log`. O `codex exec`
  pode sair com código 0 ou 1 sem cota, e implementação parcial não entra.

## 7. Verificação antes do PR

- `npm test` e `npm run lint`: nenhum erro novo.
- Bancadas: `harness.js checar`, `rodar.js`, `mesa-real.js`, `festa-real.js`, `leva2-real.js`, `poquer-rodar.js`,
  `rodar-blackjack.js` e o novo `caber.js` (32 de 32).
- Boot no Electron real (hook `--require` com `--user-data-dir`), coletando `console-message` e `did-fail-load`
  da janela de `index.html`: zero erros novos contra a `main`.
- Prints do app real em 1440×900 e 1366×768, nos temas padrão e Papel: Mesa vazia, Mesa com tela, câmera e cinco
  janelas, roleta recém-posta, truco com "Sua vez", "Ver tudo", menu ⋯ aberto, trava do líder ativa e tela cheia.
- Teclado: Tab chega em toda barra e em todo botão dela. O `:focus-visible` aparece e Shift+F10 abre o menu.

## Fora de escopo

Protocolo da Mesa além de `size`/`outer`, regras dos jogos, desempenho de mídia, as fases 2 e 3 e dependências
novas.
