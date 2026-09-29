# Redesign fases 2 e 3 — o app inteiro no Estúdio: plano de implementação

> **Para quem executa:** SUB-SKILL: superpowers:executing-plans. A execução é por **jobs do Codex** despachados pela
> sessão principal (tabela "Jobs" no fim). Passos com `- [ ]`.

**Objetivo:** o GoLive inteiro com a identidade Estúdio e a estrutura nova:

- sala em três colunas;
- palco com barra em cada vídeo;
- lobby em painel de controle;
- Configurações em tela própria;
- seletor de tela numa tela só;
- diálogos e janelas auxiliares restilizados.

**Arquitetura:** a identidade entra como preset `estudio`, padrão, pelos tokens de `style.css` e `theme.js`; as
telas trocam só marcação e CSS, e o JS de cada área muda o mínimo para a estrutura nova. O contrato de ids do
`index.html` é travado por teste antes de qualquer mudança.

**Tecnologia:** Electron 44, JS sem build, `node --test`, ESLint, bancadas Playwright (`PLAYWRIGHT_DIR`, ver a
memória `golive-bancadas-playwright`).

**Spec:** `docs/superpowers/specs/2026-09-27-redesign-app-estudio-design.md` (a seção citada em cada tarefa manda).

## Restrições globais (valem para toda tarefa)

- Português em código, comentários e textos. Assunto de commit sem acento. Linhas com no máximo 120 colunas.
- **Nenhum `id` do `index.html` renomeado ou removido** (teste da tarefa 1). Mover pode.
- Cor só por token. `--live` só para "ao vivo"; `--warn` e `--danger` travados.
- Sem `filter`/`backdrop-filter`. Só `transform` e `opacity` animam, e a animação usa o `transform`, nunca a
  propriedade `scale` avulsa.
- `z-index` só pela escala `--z-*` (teste existente).
- Fonte só local (`assets/fonts/`, CSP `default-src 'self'`).
- Alvo mínimo de 28×28 px. `button { min-height: 44px }` global ganha de `height` menor: declare `min-height`
  explícito.
- Todo botão só de ícone tem `aria-label` e `title`. `:focus-visible` com `var(--ring)` em tudo que é clicável.
- A Mesa da fase 1 não regride: `harness.js checar`, `mesa-real.js`, `leva2-real.js` e `caber.js` (516/0) continuam
  verdes.
- Boot no Electron real antes de cada commit que mexa em `app.js`, `ui.js` ou `index.html` (memória
  `golive-boot-smoke-obrigatorio`; hook em `C:/Users/nicol/AppData/Local/Temp/golive-wt/prompts/boot-hook.js`).
- Comandos: `npm test`, `npm run lint`. Base: 1869 passando, 0 erros de lint. Há um teste de tempo instável que
  falha sob carga; falhou só ele, rode de novo.

## Mapa de arquivos

| Arquivo | Tarefas |
|---|---|
| `src/renderer/assets/fonts/` (+ `LICENSE-FONTS.txt`) | 0 |
| `src/renderer/ids-contrato.test.js` (novo), `ids-contrato.json` (novo) | 1 |
| `src/renderer/theme.js`, `theme.test.js`, `config.js`, `config.test.js` | 1 |
| `src/renderer/style.css` | 1, 2, 3, 5, 6, 7, 8 (em série) |
| `src/renderer/tetorecebido.js` (novo) + `.test.js`, `src/renderer/app.js` (view-state) | 4 |
| `src/renderer/index.html` | 2, 5, 6, 7, 8 (em série) |
| `src/renderer/app.js` (abas, colunas) | 2 |
| `src/renderer/ui.js` | 2 (membros), 3 (tile e menu), 5 (chat), 6 (lobby), 7 (Configurações), 8 (seletor e diálogos) |
| `src/main.js`, `src/renderer/splash.css`, `espiar.html`, `espiar-page.js` | 8 |
| `tools/bancada-sala/` (novo), `tools/bancada-telas/` (novo) | 9 |
| `STATUS.md`, `docs/glossario.md`, `docs/prints/2026-09-2x-estudio/` | 12 |

---

### Tarefa 0: Fontes (sessão principal, antes dos jobs)

- [ ] Baixar da API do Google Fonts (CSS2 com `User-Agent` de navegador para receber `woff2`) os arquivos `latin` e
  `latin-ext` de **Instrument Sans** (eixo de peso 400–700) e **IBM Plex Mono** (500 e 700), para
  `src/renderer/assets/fonts/`, com os nomes `instrumentsans-latin.woff2`, `instrumentsans-latin-ext.woff2`,
  `plexmono-500-latin.woff2`, `plexmono-500-latin-ext.woff2`, `plexmono-700-latin.woff2` e
  `plexmono-700-latin-ext.woff2`.
- [ ] Acrescentar ao `LICENSE-FONTS.txt` os avisos OFL das duas famílias (texto oficial do repositório de cada
  fonte).
- [ ] Commit: `chore(fontes): Instrument Sans e IBM Plex Mono locais (OFL)`.

### Tarefa 1: Identidade Estúdio e trava do contrato de ids

**Arquivos:** `theme.js`, `theme.test.js`, `config.js`, `config.test.js`, `style.css` (topo: `@font-face`, `:root`,
blocos de tema), `ids-contrato.test.js` e `ids-contrato.json` (novos).
**Spec:** 1 e 2.

**Interfaces produzidas** (usadas por todas as tarefas seguintes):

- tokens `--font-body`, `--font-display` e `--font-mono`;
- `--r-lg: 12px` e `--r-md: 10px`;
- `--ring` com anel duplo;
- `--act: #ECEDEF` e `--on-act: #0C0D0F` no `:root`;
- classe utilitária `.rotulo-mono`: Plex Mono 700, caixa alta, `letter-spacing: .12em`, `--tx3`;
- classe `.tally`: pílula `--live` de 3 px de raio, Plex Mono 700 e texto branco.

- [ ] **Contrato de ids primeiro.** Gerar `src/renderer/ids-contrato.json` com todos os `id="..."` do `index.html`
  da `origin/main` de hoje, mais os da fase 1 (`stage-mesa-people`), em ordem alfabética. Criar
  `ids-contrato.test.js`, que falha se algum id da lista sumir do `index.html` e informa quais sumiram. Ids novos
  são permitidos. Rodar: passa.
- [ ] **Testes que falham** em `theme.test.js`:
  - `PRESETS.estudio` existe;
  - `estudio` passa na trava de contraste;
  - o preset declara `onAct: '#0C0D0F'`;
  - no tema personalizado, `onAct` sai da luminância da cor de ação (clara, como `#ECEDEF`, dá texto escuro;
    escura, como `#2B59C3`, dá `#FFFFFF`), e a trava mede com esse `onAct`.

  Em `config.test.js`:
  - config sem tema → `estudio`;
  - `{ theme: { preset: 'marca' } }` sem `act` e sem `themeMigrationEstudio` → `estudio` e marca a flag;
  - com `act` personalizado → continua `marca`;
  - com a flag já `true` → não mexe;
  - `THEME_PRESETS[0] === 'estudio'` e `marca` continua na lista.
- [ ] **Implementar:**
  - `PRESETS.estudio` com as superfícies e cores da spec 2.1, `act: '#ECEDEF'`, `actHover: '#FFFFFF'` e
    `onAct: '#0C0D0F'`;
  - `onAct` opcional nos presets (padrão `#FFFFFF`) e derivado pela luminância relativa (> 0,5 = escuro) no
    personalizado;
  - a trava de contraste passa a usar esse valor;
  - `config.js`: `THEME_PRESETS` com `estudio` primeiro, padrão `estudio`, e a migração nova ao lado da de
    `themeMigration` (linha ~369), com a flag `themeMigrationEstudio`;
  - `style.css`: o `:root` passa a ter os valores do Estúdio, e os do `marca` vão para `:root[data-theme="marca"]`
    no padrão dos outros blocos (conferir como `theme.js` aplica o preset e seguir o mesmo);
  - `@font-face` das duas famílias novas, e Outfit e Work Sans continuam só para o `marca`, via
    `--font-display`/`--font-body` no bloco dele;
  - trocar todo `font-family` solto do arquivo por `var(--font-*)`.
- [ ] **Teste de CSS:** todo `url(...)` de `@font-face` aponta para um arquivo que existe em `assets/fonts/`.
- [ ] **Verificar:** `npm test`, lint, `harness.js checar` e `caber.js` (a Mesa já sai com a cara nova; nada pode
  quebrar). Boot no Electron real.
- [ ] Commit: `feat(tema): identidade Estudio como padrao, onAct pela luminancia e migracao do GoLive`.

### Tarefa 2: Sala em três colunas e presenças

**Arquivos:** `index.html` (dentro de `#room-view`), `app.js` (abas, perto da linha 2835), `ui.js`
(`renderMembers`, `openMemberMenu`, `renderBanned`, `renderWatchGate` na Transmissão), `style.css` (sala).
**Spec:** 3 e 3.1.

**Interfaces produzidas:**

- `#btn-toggle-people` (novo);
- classes `.presenca`, `.presenca-avatar`, `.presenca-nome`, `.presenca-estado`, `.presenca-assistir` e
  `.presencas-secao`;
- `document.body.dataset.pessoas` e `document.body.dataset.chat`, com os valores `aberto` ou `recolhido`.

- [ ] `#room-view` vira grade `pessoas | centro | chat` (232 px, `1fr`, 304 px). O centro contém `#stage-header`,
  `#grid` e o dock. `#people-panel` e `#chat-panel` saem de dentro das abas para as colunas. `#room-side`,
  `.room-tabs`, `#tab-people` e `#tab-chat` continuam no DOM com `hidden`.
- [ ] `app.js`: `selectRoomTab` deixa de esconder painéis. As abas somem, mas as teclas e os `aria-*` não
  quebram (manter a função, só sem efeito visual). `#chat-unread-dot` passa para dentro de `#btn-toggle-side` e
  acende com mensagem nova de outra pessoa enquanto o chat está recolhido.
- [ ] **Recolher:**
  - `#btn-toggle-people` alterna o trilho de 56 px, e `#btn-toggle-side` alterna o chat;
  - regras automáticas por `ResizeObserver` no `#room-view`: abaixo de 1280 px de largura vira trilho; abaixo de
    1100 px o chat recolhe;
  - a escolha manual fica em `localStorage` (`golive.sala.pessoas` e `golive.sala.chat`), com `try/catch` que avisa
    no console, e manda sobre o automático até a pessoa mudar;
  - o recolhimento no layout é instantâneo (sem animar largura).
- [ ] **Presenças** (`renderMembers`): seção "AO VIVO" (quem tem tela ao vivo) e "NA SALA" (o resto, alfabética, você
  por último), com rótulo `.rotulo-mono`.
  - **Linha de 44 px:** avatar de 28 px (anel `--live` se ao vivo), nome, estado curto (vendo / câmera / na Mesa /
    pausado), **Assistir ▶** quando ao vivo e não assistido, e ⋯ que abre `openMemberMenu`.
  - **Assistir** chama o mesmo caminho do "Assistir" do `.tile-gate` de hoje; **Ver junto** fica no ⋯ e no
    Shift+clique e chama o caminho do "+ Ver junto".
  - Clicar na linha põe em foco no palco o tile da pessoa (tela, senão câmera).
  - **Trilho:** só o avatar com anel e `title` com o nome.
  - Os dados de "ao vivo" e "assistindo" vêm dos mesmos lugares que o `renderWatchGate` e o `renderMembers` usam
    hoje. Conferir e reusar; não criar estado novo.
- [ ] Na Transmissão, `renderWatchGate` deixa de pôr o cartão Assistir no `#grid`. Na Mesa, o tile continua como
  está.
- [ ] Banidos: seção recolhível no fim da coluna, só para o líder.
- [ ] **Verificar:** `npm test`, lint, `harness.js checar`, `mesa-real.js`, `leva2-real.js`, boot real e um print
  da sala em 1366×768 e 1440×900 pelo hook.
- [ ] Commit: `feat(sala): tres colunas, presencas e colunas recolhiveis`.

### Tarefa 3: Palco — barra do vídeo, reações, menu e palco vazio

**Arquivos:** `ui.js` (`showTile`, os controles do tile, `openTileMenu`, `openPipPicker` se usado, `renderEmptyGrid`,
`renderPausedOverlay` só no que colidir), `style.css` (tile, menus e popovers), `mesa-view.js` só se a barra do
tile precisar sumir dentro da janela da Mesa.
**Spec:** 4.

**Interfaces consumidas:** `window.GoLive.tetoRecebido` (tarefa 4) para o item de qualidade.
**Interfaces produzidas:**

- `.tile-bar` com `.tile-bar-titulo`, `.tile-bar-dados` e botões `.tile-bar-btn[data-acao=reagir|rabiscar|volume|tela-cheia|menu]`;
- `.popover` (superfície sólida reutilizável: `--s2`, `--elev-3`, raio 12 px), usado por reações, menu do vídeo e
  menus das tarefas 5, 7 e 8;
- `.menu-item`, `.menu-grupo` e `.menu-atalho`.

- [ ] Cada tile de tela ou câmera na Transmissão ganha a `.tile-bar` de 36 px **acima** do vídeo (o vídeo encolhe;
  o cálculo do `gridlayout` inclui os 36 px — conferir `gridlayout.js` e o teste dele, e somar a barra ao
  retângulo do tile com o mesmo cuidado do `chromeH` da Mesa).
  - Conteúdo: tally "AO VIVO" ou "CAM" em mono, nome, dados em mono (resolução, fps, taxa e "N vendo" para quem
    transmite, só se esses dados já existem no tile) e os botões.
  - Saem de cima da imagem: botão de tela cheia do canto, barra de reações, avatar, selo de tipo e rótulo do nome.
  - Na Mesa, a `.tile-bar` fica escondida (a janela já tem `.mesa-bar`), e rabisco e reações continuam como na
    fase 1.
- [ ] **Reações:** o botão abre um `.popover` ancorado com grade de 6×2 (alvos de 32 px), com os emojis de hoje
  (`reactions.js`). Fecha com Esc, clique fora ou depois da escolha. O foco vai para o primeiro emoji e volta ao
  botão ao fechar.
- [ ] **Rabisco:** a paleta aparece dentro do vídeo só com o rabisco ativo, em `.popover` `--s2` com `--elev-2`.
- [ ] **Menu do vídeo** (`openTileMenu` + ⋯ da barra):
  - cabeçalho com o nome em `.rotulo-mono`;
  - **Som:** volume deslizante com % e Silenciar (atalho `M`);
  - **Ver:** Espiar em janela e Pôr na Mesa (quando a ação já existe hoje);
  - **Qualidade que você recebe** ›: submenu Auto, 1080p, 720p e 480p, só em tela de outra pessoa. Desabilitado com
    o motivo quando `tetoRecebido.bloqueado(tileId)` for verdadeiro;
  - **Parar de assistir.**

  Sem "Tela cheia". Teclado: setas navegam, Enter ativa, Esc fecha e → abre o submenu.
- [ ] **Palco vazio** (`renderEmptyGrid`): ícone, "Ninguém em foco" e "Escolha alguém ao vivo na coluna ao lado".
- [ ] **Verificar:** `npm test` (inclusive `gridlayout.test.js`, `mesa-tile.test.js` e `reactions.test.js`), lint,
  harness, `mesa-real.js`, `leva2-real.js`, `caber.js` e boot real.
- [ ] Commit: `feat(palco): barra em cada video, reacoes e menu em popover solido, palco vazio`.

### Tarefa 4: Qualidade que você recebe

**Arquivos:** `src/renderer/tetorecebido.js` (novo) e `tetorecebido.test.js` (novo), `app.js` (cálculo de
`maxWidth` perto da linha 5864 e o registro do script), `index.html` (a tag `<script>`).
**Spec:** 4, item "Qualidade que você recebe".

**Interface produzida** (`window.GoLive.tetoRecebido`):

- `OPCOES = [{ id: 'auto', largura: null }, { id: '1080p', largura: 1920 }, { id: '720p', largura: 1280 },
  { id: '480p', largura: 854 }]`;
- `escolher(tileId, id)` e `escolha(tileId)`, que devolve o `id`;
- `limpar(tileId)`, chamado ao parar de assistir;
- `combinar(escolhaLargura, larguraMesa)`, que devolve o menor não nulo, ou `null`;
- `bloqueado(tileId)` e `definirBloqueio(fn)`: o app injeta a função que diz se aquele tile está sendo repassado
  (`anyFolhaWatching` do tile).

- [ ] **Testes que falham** (`tetorecebido.test.js`):
  - `combinar(null, null) === null`, `combinar(1280, null) === 1280` e `combinar(1920, 900) === 900`;
  - `escolher` com id desconhecido lança erro;
  - `limpar` volta ao `auto`;
  - `bloqueado` usa a função injetada e devolve `false` sem ela.
- [ ] Implementar o módulo no padrão IIFE dos vizinhos (ex.: `peerquality.js`), sem DOM.
- [ ] Em `app.js`, o `maxWidth` do `view-state` passa a ser
  `anyFolhaWatching ? null : tetoRecebido.combinar(larguraDaEscolha, mesaView?.widthFor(...) ?? null)`.
  - Mudar a escolha chama o mesmo envio de `view-state` que a Mesa usa ao redimensionar, e com isso o transmissor
    reage.
  - Parar de assistir chama `limpar`.
  - Injetar `definirBloqueio`.
- [ ] **Verificar:** `npm test` e lint. No `rodar.js`/`mesa-real.js` nada muda. No servidor real com duas páginas
  (roteiro curto no fim do `leva2-real.js`, ou em `tools/bancada-sala`), a escolha 720p faz o `view-state` sair com
  `maxWidth: 1280`.
- [ ] Commit: `feat(transmissao): qualidade que voce recebe, pelo teto que o view-state ja leva`.

### Tarefa 5: Chat, cabeçalho, dock e faixa de título

**Arquivos:** `ui.js` (`appendMessage`, `appendSystemLine`, `appendDaySeparatorIfNeeded`, imagens do chat, compose,
`openEmojiPanel` só no visual), `index.html` (`#stage-header`, dock), `style.css`, `titlebar.js` só se o markup
exigir.
**Spec:** 5 e 6.

- [ ] **Chat:**
  - mensagem em lista, com avatar de 28 px, nome 600, hora em mono `--tx3` e texto;
  - mensagens do mesmo autor em até 5 min agrupam, sem avatar e nome. A regra fica numa função pura exportada para
    teste (`deveAgrupar(anterior, atual)`), com teste;
  - eventos numa linha com `›`, `--tx3` e `--fs-small`;
  - imagens com até 240×180, e "Pôr na mesa" vira chip;
  - compose `--s2` com raio 10 px e os botões dentro; enviar em `--act` quando há texto.
- [ ] **Cabeçalho (48 px):**
  - à esquerda, o ponto da sala, o nome e o endereço e PIN em mono com ⧉;
  - ao centro, o seletor;
  - à direita, os avatares da Mesa, ⋯, `#btn-toggle-people` e `#btn-toggle-side`.

  Ids só mudam de lugar.
- [ ] **Dock:** Compartilhar em `--act` (texto `--on-act`), os outros redondos `--s2` com borda interna, sair em
  `--danger`. `.btn-label` vira dica `.popover` pequena, com atalho em mono.
- [ ] **Faixa de título:** tokens, botões de 46 px e fechar com hover `--danger`.
- [ ] **Verificar:** `npm test` (`chat-day.test.js`, `titlebar.test.js`), lint, harness e boot real.
- [ ] Commit: `feat(sala): chat em lista, cabecalho com endereco mono, dock e faixa no Estudio`.

### Tarefa 6: Lobby em painel de controle

**Arquivos:** `index.html` (`#lobby-view`), `ui.js` (`renderRooms`, `renderNetworkStatus` e o estado vazio), `style.css`.
**Spec:** 7.1.

- [ ] **Barra lateral:** marca; navegação Salas e Configurações (Configurações chama o mesmo `openSettings` de
  hoje); seção REDE com `renderNetworkStatus`; e o perfil no rodapé, que abre Configurações › Perfil.
- [ ] **Principal:**
  - `#update-bar` no topo;
  - cabeçalho "Salas na sua rede" com `#rooms-count` em mono, Entrar por endereço e Criar sala;
  - **lista:** linha de 52 px com nome e cadeado, endereço em mono, até 4 avatares e "+N", e tally "N AO VIVO" ou
    "—". Clique e Enter entram; a sala atual fica marcada; a em espera fica esmaecida com o motivo;
  - **estado vazio:** três nós em `--tx3`, texto e as duas ações.

  `renderRooms` continua com a mesma assinatura.
- [ ] **Verificar:** `npm test`, lint e boot real, com print do lobby com 0 e 3 salas pelo hook (mock de
  `rooms.render`).
- [ ] Commit: `feat(lobby): painel de controle com barra lateral e salas em lista`.

### Tarefa 7: Configurações em tela própria

**Arquivos:** `index.html` (`#settings-modal`), `ui.js` (`openSettings`, `closeSettings` e a navegação das seções;
os painéis de Aparência e de temas só no markup e visual), `app.js` só se alguém depender do comportamento de
modal, `style.css`.
**Spec:** 7.2.

- [ ] `#settings-modal` vira vista de janela inteira abaixo da faixa de título.
  - `openSettings` esconde `#lobby-view`/`#room-view` com `hidden`. A sala **continua conectada e transmitindo**,
    sem desmontar nada; conferir que nenhum `IntersectionObserver` ou `visibilitychange` da sala para vídeo ou
    envio por estar escondida, e, se parar, esconder com `visibility`/posição em vez de `display: none`.
  - `closeSettings` volta para a vista anterior.
  - Esc volta; "‹ Voltar" no topo; tally "VOCÊ ESTÁ AO VIVO" quando se está transmitindo.
- [ ] Lateral de 220 px com Perfil, Aparência, Som (`#settings-voice`) e Estatísticas; o item atual em `--s3` com
  marcador.
- [ ] Conteúdo com máximo de 720 px, grupos `--s1` com raio 12 px, rótulo mono e linhas de 48 px. Aparência com
  cartões de 120×80 mostrando a cor real de cada preset, Estúdio primeiro e anel branco no selecionado.
- [ ] **Verificar:** `npm test` (`theme-grid.test.js`, `themecode.test.js`), lint e boot real. Abrir as
  Configurações com uma transmissão ativa numa sala real (duas páginas no servidor real) e conferir que a outra
  pessoa continua recebendo vídeo, pela contagem de quadros do `rxstats` na outra página.
- [ ] Commit: `feat(config): Configuracoes viram tela propria com secoes na lateral`.

### Tarefa 8: Seletor de tela, diálogos, visualizador, emoji, splash e Espiar

**Arquivos:** `index.html` (`#picker`, diálogos, lightbox, emoji), `ui.js` (`renderPickerGrid` e diálogos só no
markup), `style.css`, `src/main.js` (os três `backgroundColor: '#0A0A0F'` → `'#0C0D0F'`), `splash.css`,
`espiar.html` e `espiar-page.js`.
**Spec:** 7.3, 7.4 e 7.5.

- [ ] **Seletor:** esquerda com o segmentado Telas/Janelas e a grade 16:9 (selecionada com anel e ✓); direita de
  240 px com QUALIDADE (`#picker-quality`), SOM, custo em mono, e Compartilhar e Cancelar sempre visíveis.
- [ ] **Diálogos:** folha de 440 px, `--s1`, raio 12 px e `--elev-3`; campos `--s2` com rótulo acima; ações à
  direita; destrutiva em `--danger`, e nunca o padrão do Enter; foco no primeiro campo ao abrir; Esc e clique fora
  cancelam; véu em `rgba` sólido.
- [ ] **Visualizador de imagem, painel de emoji e menus** (membro, tema, ⋯ da sala): usam `.popover`/`.menu-item`
  da tarefa 3.
- [ ] **Splash e Espiar:** fundo `#0C0D0F` e fontes novas; no Espiar, barra com tally, nome e fechar.
- [ ] **Verificar:** `npm test`, lint e boot real (inclusive abrir o Espiar e o seletor pelo hook).
- [ ] Commit: `feat(app): seletor de tela, dialogos, menus, splash e Espiar no Estudio`.

### Tarefa 9: Bancadas de sala e de telas

**Arquivos:** `tools/bancada-sala/` e `tools/bancada-telas/` (novos), no padrão de `tools/bancada-janelas/leva2-real.js`.
**Spec:** 8.

- [ ] **`tools/bancada-sala/rodar.js`:** servidor real e três pessoas em páginas separadas. Confere:
  - as três colunas em 1440×900 e 1366×768;
  - o trilho e o chat recolhendo nas larguras da spec 3;
  - Assistir pela presença levando a tela ao palco;
  - `elementFromPoint` no centro e nos quatro cantos do vídeo devolvendo o vídeo (exceto com rabisco ativo);
  - reações e menu do vídeo com `background-color` computado opaco;
  - o menu sem "Tela cheia";
  - a qualidade só na tela dos outros e o `view-state` com `maxWidth` 1280 depois de escolher 720p.
- [ ] **`tools/bancada-telas/rodar.js`:** lobby com 0, 3 e 12 salas, Configurações em cada seção, seletor e cada
  diálogo, em 1366×768 e 1440×900, nos temas Estúdio e Papel. Confere:
  - nada rola na horizontal;
  - todo controle visível tem nome acessível e não está coberto;
  - Esc fecha diálogos e volta das Configurações;
  - o foco vai para o primeiro campo ao abrir um diálogo.
- [ ] As duas escrevem prints em `docs/prints/2026-09-2x-estudio/` e saem com código 1 quando falham.
- [ ] Commit: `test(bancada): sala e telas fora da sala no Estudio`.

### Tarefa 10: Boot, passada visual e prints (sessão principal)

- [ ] Boot no Electron real na branch e na `origin/main`: zero erros novos de console.
- [ ] Prints do app real pelo hook em 1440×900 e 1366×768, nos temas Estúdio e Papel:
  - lobby vazio e com salas;
  - sala com tela e duas câmeras;
  - reações abertas;
  - menu do vídeo e submenu de qualidade;
  - presenças com trilho recolhido;
  - Configurações (Aparência);
  - seletor;
  - diálogo de criar sala;
  - Mesa com janelas.

  Olhar cada print. Defeito volta para um job com o print e a medida.
- [ ] Todas as bancadas: `harness.js checar`, `rodar.js`, `mesa-real.js`, `festa-real.js`, `leva2-real.js`, cartas,
  `caber.js`, `bancada-sala` e `bancada-telas`.

### Tarefa 11: Revisão final (Codex terra high, somente leitura)

- [ ] Revisar o diff `feat/redesign-mesa...HEAD` contra a spec e este plano. Prioridades:
  - contrato de ids e comportamento das vistas (Configurações não pode derrubar a transmissão);
  - teto de qualidade e relay;
  - acessibilidade (nomes, foco, teclado nos popovers);
  - camadas;
  - hex fora de token;
  - teste ou bancada afrouxados.
- [ ] A sessão principal confere cada achado antes de corrigir.

### Tarefa 12: Documentação (Codex luna medium)

- [ ] `STATUS.md`: seção do redesign das fases 2 e 3, com números e pendências.
- [ ] `docs/glossario.md`: termos novos visíveis (presença, "Qualidade que você recebe", "Ninguém em foco", nomes da
  navegação do lobby) no formato do arquivo; rodar `glossario.test.js`.
- [ ] Prints finais commitados.

---

## Jobs

Mesma invocação da fase 1:

```
codex exec -m <modelo> -c model_reasoning_effort=<e> -c service_tier=default -s workspace-write -C <worktree>
  -o logs/agentes/<nome>-last.txt - < <prompt>
```

O prompt começa com "implemente direto, sem pedir confirmação; não commite", depois as restrições globais, a tarefa
copiada e `PLAYWRIGHT_DIR`. Máximo de dois jobs ao mesmo tempo.

| Job | Tarefa | Modelo | Effort | Em paralelo com |
|---|---|---|---|---|
| — | 0 | sessão principal | — | — |
| K1 | 1 | `gpt-5.6-terra` | high | K4 |
| K4 | 4 | `gpt-5.6-terra` | high | K1 (arquivos separados: `tetorecebido.js`, `app.js` perto da linha 5864, `<script>`) |
| K2 | 2 | `gpt-5.6-terra` | medium | K9a |
| K9a | 9, parte "sala" (escrever o roteiro contra a spec; rodar depois da 3) | `gpt-5.6-terra` | medium | K2 |
| K3 | 3 | `gpt-5.6-terra` | medium | — |
| K5 | 5 | `gpt-5.6-terra` | medium | K9b |
| K9b | 9, parte "telas" | `gpt-5.6-terra` | medium | K5 |
| K6 | 6 | `gpt-5.6-terra` | medium | — |
| K7 | 7 | `gpt-5.6-terra` | high | — |
| K8 | 8 | `gpt-5.6-terra` | medium | — |
| — | 10 | sessão principal | — | — |
| K11 | 11 | `gpt-5.6-terra` | high, `-s read-only` | — |
| K12 | 12 | `gpt-5.6-luna` | medium | — |

Observações:

- K4 e K2 tocam `app.js` em regiões diferentes, mas **não** rodam juntos. K4 vai com K1.
- **Depois de cada job, a sessão principal:**
  1. roda `git status`;
  2. confere o `-last.txt` e o fim do `.log`, porque sem cota o `codex exec` sai sem relatório;
  3. confere a junção `node_modules`;
  4. revisa o diff de tamanhos e CSS contra a regra, não só o verde do teste;
  5. roda o passo de verificação;
  6. commita com `Co-Authored-By`.
- **Cota:** 12 jobs passam da cota de uma janela (cerca de 9 jobs terra). Esperar o reset (o `.log` diz a hora) e
  retomar com `codex exec resume <id>`, rodado de dentro do worktree, com `-c sandbox_mode="workspace-write"`.
