# Estado visível e temas de cor — plano de implementação

**Spec:** [`2026-09-03-estado-visivel-e-temas-design.md`](../specs/2026-09-03-estado-visivel-e-temas-design.md)

**Objetivo:** três frentes com o mesmo defeito de raiz — estado que o app
conhece e não mostra. (A) os toggles de tela e câmera passam a ter rótulo,
ícone e forma diferentes quando ligados; (B) a pausa vira estado de
protocolo e aparece como overlay "Transmissão pausada" sobre o último
quadro borrado na tela de quem assiste; (C) a paleta vira escolha, com seis
predefinições e um tema personalizado com trava de contraste.

**Restrição global:** nenhuma camada de transporte, adaptação ou topologia
é tocada. `mesh.js`, `tree.js`, `autoquality.js`, `peerquality.js`,
`rxstats.js`, `encode*.js`, `src/main/*` e `native/` ficam byte a byte
iguais. De `server/signaling-core.js` sai **um** campo repassado. `npm test`
e `npm run lint` verdes ao fim de cada task.

## Mapa de arquivos

| Arquivo | Ação | O quê |
|---|---|---|
| `src/renderer/index.html` | modificar | ícones OFF/ON nos toggles, `aria-pressed`, spinner da câmera, aba "Aparência" |
| `src/renderer/style.css` | modificar | `.control-btn.is-on`/`.loading`, `.tile-paused`, tokens novos, 6 blocos `:root[data-theme]`, tokenização das ~28 cores cruas |
| `src/renderer/ui.js` | modificar | `setToggleState()`, `grid.setPaused()`, pane de Aparência |
| `src/renderer/theme.js` | **criar** | presets, derivação da rampa, contraste, `apply()` — testável sob `node --test` |
| `src/renderer/theme.test.js` | **criar** | derivação, contraste (piso de cada par), distância de matiz, ida e volta do serialize |
| `src/renderer/config.js` | modificar | `cfg.theme` em `DEFAULTS`, `load()` e `serialize()` |
| `src/renderer/config.test.js` | modificar | tema ausente/inválido/custom no round-trip |
| `src/renderer/app.js` | modificar | chamadas de `setToggleState`, `paused` no `broadcast-state`, aplicar tema no boot, deps da aba |
| `server/signaling-core.js` | modificar | `paused: Boolean(msg.paused)` no rebroadcast |
| `server/signaling-core.test.js` | modificar | o campo atravessa; ausente vira `false` |
| `src/main.js` | modificar | `backgroundColor` do tema salvo |
| `STATUS.md`, `README.md` | modificar | as três frentes |

## Ordem

A → B → C não é arbitrária: A é só apresentação e valida a barra de
controle antes de B mexer nela; B fecha um estado que já existe; C é o
maior e o que mais se beneficia de o resto estar estável (a varredura de
cores cruas precisa acontecer depois de `.is-on` e `.tile-paused` já
existirem, senão eles entram com cor crua e a varredura passa por cima).

---

## Frente A — o botão que sabe o que está acontecendo

- [ ] **A1. Marcação dos toggles** (`index.html`) — cada toggle carrega os
  dois ícones inline (`.icon-off` / `.icon-on`, o não-ativo com `hidden`) e
  um `<span class="btn-label">`, mais `aria-pressed="false"`. O botão de
  pausa ganha o mesmo par (duas barras ⇄ triângulo). Os `id`s não mudam —
  `app.js` continua achando tudo por `$()`.

- [ ] **A2. Estados em CSS** (`style.css`) — `.control-btn.is-on` com
  `--on-fill`/`--on-line`/`--on-text` (§3.2 da spec), `.control-btn.loading`
  com spinner girando no lugar do ícone, e a troca de ícone por
  `[hidden]`. Transição de 150ms em `background-color`/`color` apenas — sem
  animação contínua em estado ligado. `prefers-reduced-motion` zera a
  transição e para o spinner num traço estático.

- [ ] **A3. `ui.setToggleState(id, state)`** (`ui.js`) — assinatura
  `('share'|'camera'|'pause', 'off'|'loading'|'on')`. Uma função, uma
  tabela de rótulos, um lugar. Ela é quem escreve rótulo, troca ícone,
  liga/desliga `is-on`/`loading`, `aria-pressed`, `aria-busy` e `disabled`.
  Nenhuma outra parte do código volta a mexer em `classList` desses botões.

- [ ] **A4. Trocar as chamadas** (`app.js`) — as 9 linhas de
  `classList.add/remove('active'|'loading')` viram `ui.setToggleState(...)`:
  `startShare` → `('share','on')`, `stopShare`/`resetShareState` →
  `('share','off')`, `startCamera` → `('camera','loading')` e
  `('camera','on')`, `stopCamera` → `('camera','off')`,
  `setSharePaused` → `('pause', paused ? 'on' : 'off')`. O
  `#btn-pause-share.active` do CSS sai (vira `.is-on`, com o mesmo âmbar).

- [ ] **A5. Conferir no app rodando** — os três estados de cada botão, o
  spinner da câmera com webcam real (é o único jeito de ver a janela de
  1-2s), foco visível em todos, e `aria-pressed` no leitor de tela.

## Frente B — "Transmissão pausada" na tela de quem assiste

- [ ] **B1. `paused` no protocolo** (`server/signaling-core.js`) — o
  rebroadcast de `broadcast-state` passa a carregar
  `paused: Boolean(msg.paused)`, ao lado do `live` que já vai. Uma linha.

- [ ] **B2. Teste do protocolo** (`server/signaling-core.test.js`) — o
  campo atravessa pra sala inteira; `paused` ausente chega como `false`;
  valor não-booleano é coagido (o servidor nunca confia no cliente — mesma
  postura do fuzz de frame não-objeto).

- [ ] **B3. Emitir dos dois lados** (`app.js`) — `setSharePaused()` manda
  `{ type:'broadcast-state', live:true, paused }`; o `startShare` manda
  `paused:false` explícito; e o reenvio do `peer-joined` (linha ~1726)
  passa a mandar `paused: sharePaused`, que é o que resolve "entrei durante
  a pausa" sem código novo. O `enforceSharePauseFor` continua exatamente
  como está — a pausa de mídia não muda.

- [ ] **B4. `grid.setPaused(tileId, paused, opts)`** (`ui.js`) — liga o
  overlay num tile:
  - `paused: true` → se `video.videoWidth > 0`, cria um `<canvas>` de 320px
    de largura mantendo o aspecto, `drawImage` do quadro atual, insere como
    `.tile-paused-shot`; depois `video.pause()` e `video.hidden = true`.
    Sem quadro disponível, pula o canvas e vai direto pro véu.
  - insere `.tile-paused` com o glifo de pausa e as duas linhas de texto
    (`role="status"`, pra o leitor de tela anunciar sem roubar foco).
  - `paused: false` → remove canvas e overlay, `video.hidden = false`,
    `applyPainting(video)` (não `play()` direto — quem manda em tocar ou não
    é o estado de visibilidade da janela, que já existe).
  - o texto vem por `opts`: `{ title, subtitle }`, pra o tile local dizer
    "Você pausou — ninguém está vendo".

  `showTile` passa a reaplicar o overlay se o tile for recriado durante uma
  pausa — mesmo padrão do `renderTileWatchers`, que já resolve esse caso
  pra a lista de espectadores.

- [ ] **B5. Overlay em CSS** (`style.css`) — `.tile-paused-shot`
  (`filter: blur(20px)`, `transform: scale(1.1)` pra o borrão não deixar
  borda transparente, `object-fit: cover`), `.tile-paused` (véu de token +
  coluna centrada). **Nenhuma animação e nenhum `transform` vivo no
  elemento borrado** — é o que mantém a garantia da §4.3 da spec. Entrada
  do overlay: `opacity` 180ms, no véu, não no canvas.

- [ ] **B6. Ligar no handler** (`app.js`) — `case 'broadcast-state'` grava
  `peer.paused = Boolean(msg.paused)` e chama
  `ui.grid.setPaused(msg.id, peer.paused, ...)` com o nome do peer.
  `setSharePaused` chama pro tile `'me'` com o texto local. `stopShare` e
  `resetShareState` limpam. `renderMembersPanel` mostra "pausado" na linha
  do peer (a lista já sabe desenhar `live`).

- [ ] **B7. Conferir com dois clientes** — pausar e retomar com um
  espectador direto e um atrás de relay; entrar numa sala com a pausa já
  ativa; pausar antes do primeiro quadro chegar (caminho degradado);
  pausar, sair da sala e voltar; e conferir no painel de estatísticas que a
  GPU **não** subiu com o overlay ativo.

## Frente C — temas de cor

- [ ] **C1. Tokenizar o que sobrou** (`style.css`) — as ~28 cores cruas da
  tabela §5.5 da spec viram tokens (`--scrim-1/2/3`, `--on-act`,
  `--video-bg`, `--veil`, variantes `-hover`/`-soft` de `--live`/`--danger`,
  derivados de `--act`/`--warn`). Critério de saída: `grep -nE
  '#[0-9a-fA-F]{3,8}|rgba?\(' src/renderer/style.css` só acusa linhas
  dentro dos blocos `:root`. Nenhuma cor **muda** nesta task — é
  substituição um-pra-um, e a tela tem de ficar pixel a pixel igual.

- [ ] **C2. `theme.js`** (criar) — módulo puro, no padrão IIFE + rodapé
  `module.exports` que `config.js` já usa (roda no renderer e sob
  `node --test`):
  - `PRESETS`: os seis conjuntos da §5.2, cada um um objeto de tokens;
  - `deriveSurfaces({ temp, level })`: a rampa inteira a partir de dois
    números, com os degraus de luminosidade da rampa atual;
  - `deriveAction(hex)`: `--act-hover`, `--on-fill`, `--on-line`,
    `--on-text`, `--on-act` a partir de um acento;
  - `contrast(a, b)`: razão WCAG;
  - `validate(tokens)`: os cinco pisos da §5.4 + a distância de matiz de
    40° pro `--live`; devolve `{ ok, failures[], nearest }`;
  - `tokensFor(themeCfg)`: preset ou custom → objeto de tokens;
  - `apply(themeCfg, doc)`: `data-theme` no `<html>` e, no custom, as
    variáveis derivadas via `style.setProperty`.

  Os tokens **semânticos** (`--live`, `--warn`, `--danger` e os `-dim`)
  não são parametrizáveis por `theme.js` — não existe caminho de código que
  os escreva a partir da escolha do usuário. É a §5.1 aplicada por
  construção, não por convenção.

- [ ] **C3. `theme.test.js`** (criar) — a derivação é monotônica (nível
  maior nunca produz superfície mais escura); todo preset passa nos cinco
  pisos de contraste (isto é o teste que impede um preset novo entrar
  quebrado); um acento vermelho é reprovado pela distância de matiz e
  `nearest` devolve um que passa; acento claro demais troca `--on-act` pro
  texto escuro em vez de reprovar; entrada inválida (hex torto, número fora
  de faixa) cai no padrão sem lançar.

- [ ] **C4. `cfg.theme`** (`config.js` + `config.test.js`) — `DEFAULTS.theme
  = { preset: 'signal' }`; `load()` aceita `{ preset }` conhecido ou
  `{ preset:'custom', base:{temp,level}, act:'#rrggbb' }` validado, e cai no
  padrão em qualquer outra coisa; `serialize()` grava. Config antigo sem
  `theme` abre no tema de hoje.

- [ ] **C5. Presets em CSS** (`style.css`) — seis blocos
  `:root[data-theme="..."]` redefinindo **só** superfície e ação. O bloco
  `:root` de hoje continua sendo o padrão (`signal`), pra que nenhum tema
  precise existir pra o app abrir certo.

- [ ] **C6. Aba Aparência** (`index.html` + `ui.js` + `style.css`) — a
  quarta categoria entra na nav de Configurações (o indicador deslizante já
  se adapta, `syncSettingsIndicator` mede o botão ativo). O pane tem a
  grade de cartões de preset — cada cartão desenha a **rampa** da paleta em
  faixas, com o acento como um traço, e não um quadrado colorido com nome —
  e o bloco "Personalizar" com os dois sliders e o campo de cor. Cada
  controle tem `<label>` visível. Troca ao vivo no `input`, sem botão
  aplicar. Reprovação da trava aparece como texto abaixo do controle
  (`aria-describedby`), com a cor sugerida clicável.

- [ ] **C7. Aplicar no boot** (`app.js` + `src/main.js`) — `theme.apply(cfg.theme)`
  antes do primeiro render, e `deps.onThemeChange` gravando no config. No
  main, `backgroundColor` do `BrowserWindow` passa a vir do tema salvo (lido
  do mesmo storage), pra o tema claro não abrir com flash escuro.

- [ ] **C8. Conferir tela a tela com "Papel" ativo** — lobby, diálogos de
  criar/entrar, sala com tiles, fullscreen, PiP, seletor de fonte,
  configurações inteiras, chat, menu de moderação, banner de atualização,
  toast, overlay de pausa da Frente B. É o tema claro que revela cor crua
  esquecida; é por isso que ele existe.

## Fechamento

- [ ] **F1. `STATUS.md` e `README.md`** — as três frentes em "O que o app
  faz hoje", contagem de testes atualizada.
- [ ] **F2. Vault** — nota nova de decisão sobre o contrato de temas
  (superfície e ação livres, semântica travada) e a seção na nota
  `golive - acento reservado a ao vivo, sem blur no redesign` registrando
  por que o blur estático do overlay de pausa **não** reabre aquela
  decisão.
- [ ] **F3. Release** — versão `0.8.0` (muda protocolo com campo novo, e a
  sala já trava por versão; nada aqui é retrocompatível por acidente).
