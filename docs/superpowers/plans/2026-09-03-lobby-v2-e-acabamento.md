# Lobby v2 e acabamento da interface — plano de implementação

**Spec:** [`2026-09-03-lobby-v2-e-acabamento-design.md`](../specs/2026-09-03-lobby-v2-e-acabamento-design.md)

**Objetivo:** reescrever a primeira tela (lobby) como uma tela de desktop de
duas colunas, mover "anunciar na rede" pro diálogo de criar sala, e fechar
sete pontos de acabamento (checkbox, progresso do criar, estouro de nome,
barra de rolagem, tag de qualidade, ícone do atualizar, ordem da grade).

**Restrição global:** nenhuma camada de transporte é tocada. `mesh.js`,
`tree.js`, `autoquality.js`, `peerquality.js`, `rxstats.js`, `encode*.js`,
`server/` e `src/main/discovery.js` ficam byte a byte iguais. `npm test` e
`npm run lint` verdes ao fim de cada task.

## Mapa de arquivos

| Arquivo | Ação | O quê |
|---|---|---|
| `src/main.js` | modificar | `network:address` novo; `fetchWindowIcons: true` + `appIcon` em `sources:list`; remove `discovery:setAdvertise` |
| `src/preload.js` | modificar | `getNetworkAddress()` novo; remove `setAdvertise` |
| `src/renderer/index.html` | modificar | lobby v2, diálogo de criar sala, checkboxes, chips de qualidade, aba Rede fora |
| `src/renderer/style.css` | modificar | lobby v2, `.check`, scrollbars, `.source-card`, `.quality-chip`, grade por contagem, correções de estouro |
| `src/renderer/ui.js` | modificar | render do lobby, `openCreateRoom` com advertise + busy, ordenação/ícone/tag do picker, chips, `data-count` da grade |
| `src/renderer/app.js` | modificar | passa/persiste `advertise`, consome `getNetworkAddress`, remove `onNetworkChange` |

## Tasks

**Estado: concluído em 2026-09-03**, commits `30cbc99` (levantamento inteiro),
`3d7f4d1` (folga vertical da grade + diálogo de criar sala enxuto) e `cbc4b03`
(spec/STATUS alinhados ao que ficou implementado), na branch
`claude/redesign-connection-page-k64yy3`.

- [x] **1. Ponte de rede + fonte das janelas** (`main.js`, `preload.js`) —
  IPC `network:address` devolvendo `pickAddress()`; `sources:list` passa a
  pedir ícone de janela e a devolver `appIcon` (data URL ou `null`) e
  `height` do display; `discovery:setAdvertise` e `setAdvertise` saem.
- [x] **2. Fundação de CSS** (`style.css`) — scrollbars globais, componente
  `.check`, correções de `min-width: 0`/`overflow-x` das cinco listas da
  tabela §7 da spec.
- [x] **3. Lobby v2** (`index.html`, `style.css`, `ui.js`, `app.js`) —
  topbar, coluna de ações com rodapé de rede, coluna de salas com cards,
  barra do usuário, breakpoints de 1040px/820px.
- [x] **4. Criar sala** (`index.html`, `ui.js`, `app.js`) — opção "anunciar"
  no diálogo com estado inicial do config, estado ocupado do botão, aba
  Rede removida de Configurações, `onNetworkChange` removido.
- [x] **5. Seletor de fontes** (`index.html`, `style.css`, `ui.js`) — tag de
  qualidade, ícone do app na janela, ordenação, contadores por aba, ícone
  no botão atualizar, chips de preset.
- [x] **6. Grade da sala** (`style.css`, `ui.js`) — `data-count` + colunas
  por contagem + `order` por tipo de tile.
- [x] **7. Verificação** — `npm run lint` (0 erros, os mesmos 10 avisos
  `require-atomic-updates` de antes), `npm test` (286 passando), varredura de
  CSS/IDs órfãos (só `.dialog-hint` e `#room-list-live .dot` sobraram, ambos
  removidos), `STATUS.md` e `README.md` atualizados.

## Ajustes depois da primeira revisão

Duas coisas que a spec não previu e a revisão pegou (`3d7f4d1`):

- **Folga vertical da grade.** As trilhas eram `1fr`, então a altura do palco
  era dividida igualmente entre as linhas — e como três tiles 16/9 lado a
  lado são sempre mais largos que altos, a folga sobrava multiplicada por
  linha: um vão entre as fileiras **e** outro embaixo. Viraram `min-content`
  com `align-content: safe center`. O tile único fica em `1fr` (é a trilha de
  altura definida que faz o `max-height: 100%` valer).
- **Diálogo de criar sala.** Tinha parágrafo de abertura, moldura em volta das
  opções e duas linhas de apoio por opção — meia tela pra duas perguntas de
  sim/não. Passou a título + duas opções de uma linha + botões (variantes
  `.check-group.bare` e `.check.tight`), com o foco abrindo no "Criar".

## O que ficou de fora

Nada do escopo do plano. Duas coisas que dependem da sua máquina:

- **Verificação com o Electron rodando.** Tudo foi conferido com o renderer
  real carregado em Chromium headless (`window.golive` dublado): lobby
  cheio/vazio, 900×620, os diálogos, sala com 1/3/5 tiles. Zero `pageerror`
  e zero overflow horizontal medido por `scrollWidth > clientWidth`. O que
  **não** dá pra fazer aqui é `npm start`: o container não tem display e o
  addon nativo de áudio não compila fora do Windows.
- **Custo do `fetchWindowIcons: true`** com a máquina cheia de janelas. É uma
  linha pra reverter em `src/main.js` se a abertura do seletor pesar.
