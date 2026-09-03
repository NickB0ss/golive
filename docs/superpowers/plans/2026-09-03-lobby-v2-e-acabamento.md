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

- [ ] **1. Ponte de rede + fonte das janelas** (`main.js`, `preload.js`) —
  IPC `network:address` devolvendo `pickAddress()`; `sources:list` passa a
  pedir ícone de janela e a devolver `appIcon` (data URL ou `null`) e
  `height` do display; `discovery:setAdvertise` e `setAdvertise` saem.
- [ ] **2. Fundação de CSS** (`style.css`) — scrollbars globais, componente
  `.check`, correções de `min-width: 0`/`overflow-x` das cinco listas da
  tabela §7 da spec.
- [ ] **3. Lobby v2** (`index.html`, `style.css`, `ui.js`, `app.js`) —
  topbar, coluna de ações com rodapé de rede, coluna de salas com cards,
  barra do usuário, breakpoints de 1040px/820px.
- [ ] **4. Criar sala** (`index.html`, `ui.js`, `app.js`) — opção "anunciar"
  no diálogo com estado inicial do config, estado ocupado do botão, aba
  Rede removida de Configurações, `onNetworkChange` removido.
- [ ] **5. Seletor de fontes** (`index.html`, `style.css`, `ui.js`) — tag de
  qualidade, ícone do app na janela, ordenação, contadores por aba, ícone
  no botão atualizar, chips de preset.
- [ ] **6. Grade da sala** (`style.css`, `ui.js`) — `data-count` + colunas
  por contagem + `order` por tipo de tile.
- [ ] **7. Verificação** — `npm run lint`, `npm test`, varredura de CSS/IDs
  órfãos, `STATUS.md` atualizado.
