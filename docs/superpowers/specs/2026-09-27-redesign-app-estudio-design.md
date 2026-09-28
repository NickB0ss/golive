# Redesign, fases 2 e 3 — o app inteiro na identidade "Estúdio"

Data: 2026-09-27. Base: branch `feat/redesign-mesa` (PR #85, fase 1). Branch: `feat/redesign-sala`, com as fases 2 e 3 juntas
num lançamento só, com o app inteiro novo.

Pedido do Nicolas: "trazer uma cara nova ao aplicativo, sem utilizar o atual como referência", com "grandes
mudanças, a nível de não parecer o mesmo aplicativo". Incômodos citados: o painel de reações abre sem nada atrás, e
o menu do botão direito na transmissão não agrada.

## 0. Decisões desta conversa

| Assunto | Escolha | Descartado |
|---|---|---|
| Estrutura da sala | três colunas: pessoas, palco e chat | faixa de presenças no topo; palco imersivo com ilhas por cima |
| Palco | cada vídeo com barra de 36 px, nada flutuando sobre a imagem | — |
| Menu do vídeo | sem "Tela cheia"; "Qualidade que você recebe" só no vídeo dos outros | qualidade da própria tela no menu |
| Câmeras | no palco, junto da tela assistida, cada uma com a sua barra | na coluna de pessoas; faixa sobre o palco |
| Cabeçalho | endereço e PIN pequenos no topo, em fonte mono | botão "Convidar" com painel |
| Chat | lista com avatar, mensagens seguidas agrupadas | balões |
| Lobby | painel de controle: barra lateral (Salas, Configurações, rede, perfil), salas em lista | vitrine de cartões |
| Configurações | tela própria do app, seções na lateral, "‹ Voltar" | modal maior |
| Escolher o que compartilhar | tudo numa tela: miniaturas, qualidade, som e Compartilhar | dois passos |
| Site | fora deste plano | junto |
| Identidade | **Estúdio**: grafite neutro, interface monocromática, vermelho só no tally | "Noite de jogo" (escuro quente, menta); "Luz do dia" (claro, azul) |

Mockups: `C:\Users\nicol\AppData\Local\Temp\golive-brainstorm\.superpowers\brainstorm\2752-1790481844\content\`
(`sala-layout.html`, `palco.html`, `cameras.html`, `identidade-sala.html`, `app-inteiro.html`).

## 1. O que muda de decisões anteriores

- **Tema padrão.** O "GoLive" (`marca`), com a identidade do site (violeta `#5B4BE8`, Outfit + Work Sans, de
  2026-09-15), deixa de ser o padrão. O novo padrão é `estudio`. O `marca` continua na lista de Aparência. O site
  pode seguir a identidade nova depois; isso fica fora desta fase.
- **Forma "Macio" da fase 1.** As pílulas continuam em botões, dock e segmentados. Janelas da Mesa, painéis e
  cartões passam de 18 px para 12 px de raio, que é o traço do Estúdio.
- **Continua valendo:**
  - vermelho `--live` só para "ao vivo";
  - `--warn` e `--danger` travados;
  - trava de contraste dos temas;
  - nada de `filter`/`backdrop-filter`;
  - só `transform` e `opacity` animam;
  - nenhum `id` do `index.html` renomeado ou removido;
  - dock e colunas no fluxo do layout, nunca por cima do vídeo;
  - o cálculo de grade do palco (`gridlayout`);
  - a Mesa da fase 1 (barra, área segura, "caber").

## 2. Identidade "Estúdio"

**Tese:** o GoLive é uma ferramenta de transmissão entre amigos. A interface é a mesa de controle, em grafite, sem
cor. A única cor da tela é a luz vermelha de "no ar", o *tally* das câmeras de TV. Tudo o que é técnico (endereço,
PIN, resolução, taxa, hora, atalhos) aparece em fonte mono, como num painel de estúdio.

### 2.1 Cor (preset `estudio`, escuro)

| Token | Valor | Papel | Contraste medido |
|---|---|---|---|
| `--bg` | `#0C0D0F` | fundo da janela | — |
| `--s1` | `#131518` | colunas, painéis | — |
| `--s2` | `#1A1D21` | barras, itens, campos | — |
| `--s3` | `#23272C` | hover, selecionado | — |
| `--s4` | `#2E3339` | ativo, trilhos | — |
| `--tx` | `#ECEDEF` | texto | 16,60:1 sobre `--bg` |
| `--tx2` | `#A4ABB4` | texto secundário | 7,30:1 sobre `--s2` |
| `--tx3` | `#8B929C` | rótulos, eventos | 5,83:1 sobre `--s1` |
| `--line` / `--line2` | `rgba(236,237,239,.06)` / `.10` | divisórias e borda interna | — |
| `--act` / `--act-hover` | `#ECEDEF` / `#FFFFFF` | botão principal (fundo claro) | — |
| `--on-act` | `#0C0D0F` | texto sobre `--act` | 16,60:1 |
| `--on-text` | `#ECEDEF`, sublinhado | link e texto de ação | 16,60:1 |
| `--ring` | `0 0 0 2px #0C0D0F, 0 0 0 4px #ECEDEF` | foco | — |
| `--live` | `#FF4D4F` (travado) | tally, anel de quem está ao vivo | 5,95:1 sobre `--bg` |

- Selecionado (segmentado, item de menu, presença em foco): fundo `--s3` com marcador branco de 2 px à esquerda
  (lista) ou fundo `--s4` (segmentado). Nunca por cor.
- "Sua vez", da fase 1: pílula `--act` com `--on-act`.
- `theme.js`: o preset declara `onAct`. A trava de contraste passa a medir `on-act`/`act` com o `onAct` do preset
  (hoje supõe branco sobre a cor de ação), tanto nos presets quanto no tema personalizado derivado. Tema
  personalizado com ação escura continua com texto branco, e ação clara passa a ter texto escuro, escolhido pela
  luminância.
- **Migração, uma vez só:** quem está com `preset: 'marca'` e sem ação personalizada vai para `estudio`. Uma escolha
  feita depois nunca é desfeita (mesmo mecanismo da migração de 2026-09-15). O Papel continua sendo o claro. Os
  tokens `--elev-*` e o raio valem para todos os presets.

### 2.2 Tipografia

- **Instrument Sans** (400, 600 e 700; OFL): corpo, controles e títulos. Títulos em 700 com `letter-spacing: -.01em`.
- **IBM Plex Mono** (500; OFL):
  - endereço e PIN;
  - resolução, fps e taxa na barra do vídeo;
  - hora no chat;
  - contadores;
  - teclas de atalho nos menus;
  - rótulos de seção em caixa alta (`letter-spacing: .12em`, `--tx3`).
- Os `.woff2` (latin e latin-ext) ficam em `src/renderer/assets/fonts/`, com `LICENSE-FONTS.txt` atualizado. Outfit
  e Work Sans saem do `@font-face` padrão, mas o preset `marca` continua usando-as, e por isso os arquivos ficam.
- A escala `--fs-*` e o piso de 11 px continuam. Nenhum peso Light ou Thin (HIG, `typography.md`).

### 2.3 Forma e profundidade

- **Raios:**
  - `--r-lg` = 12 px: janela, painel, cartão, popover;
  - `--r-md` = 10 px: item, campo;
  - `--r-full`: botão com texto, dock, segmentado;
  - redondo: botão só de ícone;
  - 3 px: o tally.
- **Planos:** superfícies no mesmo plano têm só a borda interna `inset 0 0 0 1px var(--line2)`. Sombra (`--elev-2`
  e `--elev-3`) só no que flutua: menu, popover, janela arrastada e dock.
- **Tally:** pílula `--live` de 3 px de raio, "AO VIVO" em Plex Mono 700 e caixa alta, texto branco. O texto
  continua "AO VIVO", o termo do glossário. Quem está ao vivo ganha um anel de 1,5 px `--live` em volta do avatar,
  separado por 2 px de `--bg`.
- **Ícones:** conjunto SVG único, traço 1,75 px, 16/20/24.

## 3. A sala em três colunas

```
┌ sala de Ana  26.114.8.201:5000 ⧉ · PIN 4821 │ [Transmissão|Mesa] │ ⋯ ◧ ◨ ┐
├────────────┬──────────────────────────────────────┬──────────────┤
│ AO VIVO    │ ┌AO VIVO Bia  1080p60 · 12 Mb/s ☺✎🔊⤢⋯┐│ CHAT         │
│ ◉ Leo  [▶] │ │                                      ││ C Caio 21:03 │
│ ◉ Bia vendo│ │           tela assistida             ││   bora de CS?│
│ NA SALA    │ └──────────────────────────────────────┘│ › Duda entrou│
│ ○ Caio  ◉  │ ┌CAM Caio──────┐┌CAM Duda─────┐         │              │
│ ○ Você     │ └──────────────┘└─────────────┘         │ [escreva…]   │
├────────────┴─────── dock ───────────────────────────┴──────────────┤
```

- `#room-view` vira uma grade de três colunas: `#people-panel` (esquerda, 232 px), palco (`#grid` + dock) e
  `#chat-panel` (direita, 304 px). Os dois painéis saem de dentro das abas. `#room-side`, `.room-tabs`,
  `#tab-people` e `#tab-chat` ficam no DOM, sem aparecer, e o JS que alterna abas deixa de esconder os painéis.
- **Recolher:**
  - a coluna de pessoas vira um trilho de avatares de 56 px, por um botão novo `#btn-toggle-people` no cabeçalho;
  - o chat some pelo `#btn-toggle-side`, que já existe;
  - com a sala abaixo de 1280 px de largura, a coluna de pessoas vira trilho sozinha; abaixo de 1100 px, o chat
    recolhe sozinho;
  - a escolha manual fica em `localStorage` (com `try/catch` e aviso no console) e vale até a pessoa mudar;
  - ponto de não lido no `#btn-toggle-side` quando o chat está recolhido (o `#chat-unread-dot` passa para lá).
- A vista Mesa usa as mesmas colunas. Os avatares da Mesa no cabeçalho (fase 1) continuam.

### 3.1 Presença (coluna de pessoas)

- Duas seções: **"AO VIVO"** (quem transmite tela) e **"NA SALA"** (o resto, em ordem alfabética, você por último).
  O rótulo da seção é mono e caixa alta.
- **Linha de presença (44 px):**
  - avatar de 28 px (anel `--live` se ao vivo);
  - nome;
  - estado curto em `--tx3`: "vendo", "câmera", "na Mesa", "pausado";
  - à direita, **Assistir ▶** (botão `--act`, pequeno) quando a pessoa está ao vivo e você não a assiste; "vendo"
    quando assiste;
  - clicar na linha leva a tela ou a câmera dela ao palco;
  - **Assistir** troca o que está no palco pela tela dessa pessoa (o "Assistir" de hoje), e **Ver junto** soma a
    tela ao palco (o "+ Ver junto" de hoje). Ver junto fica no ⋯ da presença e no Shift+clique em Assistir;
  - ⋯ na linha, no hover e no foco, abre o menu de pessoa que já existe (volume, moderação e liderança), restilizado
    como o menu do vídeo.
- **Trilho recolhido:** só avatares com anel e dica com o nome. Clique faz o mesmo que na linha.
- O cartão "Assistir"/"Ver junto" (`.tile-gate`) sai do palco da Transmissão: quem está ao vivo e não é assistido
  aparece só na coluna. A Mesa continua usando o tile como hoje.
- Banidos (`#banned-section`) viram uma seção recolhível no fim da coluna, só para o líder.

## 4. O palco

- Telas assistidas e câmeras dividem o `#grid` (cálculo de grade atual). Cada tile ganha uma **barra de 36 px**
  acima da imagem, com a mesma estrutura da janela da Mesa:
  - tally "AO VIVO" (telas) ou "CAM" em mono (câmeras);
  - nome;
  - dados em mono (`1080p60 · 12 Mb/s`, e "3 vendo" para quem transmite);
  - botões de 28 px: reagir, rabiscar (quando se pode), volume, tela cheia e ⋯.

  Somem de cima da imagem: botão de tela cheia do canto, barra de reações, avatar, selo de tipo e rótulo do nome.
- **Paleta do rabisco:** aparece dentro do vídeo só enquanto a pessoa desenha, num painel sólido `--s2` com
  `--elev-2`. É uma ferramenta ativa, não um enfeite.
- **Reações:** o botão da barra abre um popover sólido (`--s2`, `--elev-3`, raio 12 px) ancorado nele, com grade de
  6×2 alvos de 32 px, fechando com Esc, clique fora ou depois de escolher. É o painel de hoje que abre "sem nada
  atrás".
- **Menu do vídeo** (botão direito ou ⋯), popover igual ao das reações:
  - cabeçalho com o nome da tela ou câmera, em `--tx3` mono caixa alta;
  - **Som:** volume (controle deslizante dentro do menu, com %) e Silenciar, com o atalho `M`;
  - **Ver:** Espiar em janela e Pôr na Mesa;
  - **Qualidade que você recebe** ›: Auto, 1080p, 720p e 480p, só em tela de outra pessoa;
  - **Parar de assistir.**

  Grupos separados por divisória `--line`. Não tem "Tela cheia". Itens com 36 px de altura, atalhos à direita em mono
  `--tx3`.
- **Qualidade que você recebe:** o espectador escolhe um teto de resolução para aquela tela. O `view-state` já
  leva `maxWidth`, hoje só da largura da janela da Mesa (`app.js`, `mesaView?.widthFor`), e o transmissor já
  o aplica. O teto enviado passa a ser o menor entre a escolha (Auto sem teto; 1080p = 1920; 720p = 1280;
  480p = 854) e o da Mesa. Não há protocolo novo. Quando você repassa aquela tela para outras pessoas (relay
  com filhos, `anyFolhaWatching`), o teto não vale, e o item aparece desabilitado com o motivo "Você repassa esta
  tela para outras pessoas". A escolha vale enquanto a pessoa assiste.
- **Palco vazio:** ícone, "Ninguém em foco" e "Escolha alguém ao vivo na coluna ao lado", centralizados em `--tx2`.
  Não fica um retângulo preto.

## 5. Chat (coluna da direita)

- **Lista com avatar:** avatar de 28 px, nome em 600, hora em mono `--tx3` e texto. Mensagens seguidas do mesmo
  autor em até 5 min agrupam, sem repetir avatar e nome.
- **Eventos** ("entrou", "saiu", "virou líder"): uma linha com `›` e texto em `--tx3`, tamanho `--fs-small`
  (nunca abaixo de 11 px), com hora em mono.
- **Imagens:** até 240 px de largura e 180 px de altura. "Pôr na mesa" vira um chip abaixo.
- **Campo de escrita:** `--s2` com raio 10 px e os botões de anexo, emoji e enviar dentro dele. O botão de enviar usa
  `--act` quando há texto.

## 6. Cabeçalho, dock e faixa de título

- **Cabeçalho (48 px):**
  - à esquerda: tally da sala (ponto `--live` se alguém está ao vivo), nome em Instrument Sans 700, endereço e PIN
    em Plex Mono `--tx2` e ⧉ copiar;
  - ao centro: o seletor Transmissão/Mesa;
  - à direita: avatares da Mesa (só na vista Mesa), ⋯ opções da sala, ◧ recolher pessoas e ◨ recolher chat.
- **Dock:** mesmas funções e ids. Compartilhar em `--act` (claro, texto escuro), os outros redondos em `--s2` com
  borda interna, e sair em `--danger`. Os `.btn-label` (dicas) viram popover `--s3` com texto mono para o atalho.
- **Faixa de título do app:** só troca para os tokens novos. O comportamento não muda.

## 7. Fora da sala

### 7.1 Lobby (painel de controle)

- `#lobby-view` vira duas colunas: barra lateral de 232 px (`.lobby-sidebar`) e área principal.
- **Barra lateral:**
  - marca: a logo em 20 px e "GoLive" em Instrument Sans 700;
  - navegação: **Salas** e **Configurações**, com o item atual em `--s3` e marcador branco;
  - embaixo, a seção **REDE** (rótulo mono): nome da rede (Radmin, ZeroTier…) e IP em mono, com o estado atual de
    `renderNetworkStatus`;
  - no rodapé, o seu perfil: avatar e nome, e o clique abre Configurações › Perfil.
- **Área principal:**
  - a faixa de atualização (`#update-bar`) no topo, com o mesmo comportamento e o visual Estúdio;
  - o cabeçalho "Salas na sua rede", com a contagem em mono, **Entrar por endereço** (secundário) e **Criar sala**
    (`--act`);
  - a lista de salas: uma linha de 52 px por sala, com nome (e cadeado se tiver PIN), endereço em mono, avatares de
    quem está (até 4, e "+N") e tally "N AO VIVO" ou "—". Clicar entra, e Enter no foco também;
  - a sala em que você já está fica marcada. A sala em espera (`isOnCooldown`) aparece esmaecida, com o motivo;
  - **estado vazio:** o desenho dos três nós em `--tx3`, "Nenhuma sala na sua rede ainda" e as duas ações. Sem rede
    ou com erro, a mensagem de `renderNetworkStatus` aparece no mesmo lugar, dizendo o que fazer.
- Os ids de hoje (`#rooms-count`, `#update-bar`, os botões de criar e entrar e a lista) só mudam de lugar.

### 7.2 Configurações (tela própria)

- `#settings-modal` deixa de ser modal e vira uma vista que ocupa a janela inteira abaixo da faixa de título, no
  lugar do lobby ou da sala. O id e as seções continuam.
- **Topo:** "‹ Voltar" (Esc também volta), o título da seção e, quando você está ao vivo, um tally "VOCÊ ESTÁ AO
  VIVO". A transmissão continua com as Configurações abertas; a sala não sai do DOM, só fica escondida.
- **Lateral de 220 px** com as seções que já existem: Perfil, Aparência, Som (hoje "Voz"; o id `#settings-voice`
  continua) e Estatísticas. Nenhuma seção nova.
- **Conteúdo:** coluna de até 720 px. Cada grupo é um bloco `--s1` com raio 12 px, rótulo mono em caixa alta acima e
  linhas de 48 px (rótulo à esquerda, controle à direita), como os Ajustes do macOS.
- **Aparência:** os presets em cartões de 120×80 que mostram a cor real do tema, com Estúdio primeiro e o selecionado
  com anel branco de 2 px. Temas personalizados e código de tema continuam como hoje.
- `openSettings`/`closeSettings` passam a mostrar e esconder a vista. Quem chamava (lobby, dock e ⋯ da sala)
  continua chamando igual.

### 7.3 Escolher o que compartilhar (`#picker`)

- Continua um diálogo, porque é uma escolha rápida e modal por natureza, com 880×560 no máximo.
- **Esquerda:** segmentado Telas/Janelas e a grade de miniaturas 16:9 com o nome embaixo. A selecionada tem anel
  branco de 2 px e marca ✓.
- **Direita (240 px):**
  - **QUALIDADE:** os dois eixos de hoje (`#picker-quality`), como segmentados;
  - **SOM:** a opção de hoje;
  - custo estimado em mono (≈ 12 Mb/s);
  - **Compartilhar** (`--act`) sempre visível embaixo, e Cancelar.
- Os ids e o fluxo de `picker.open` não mudam.

### 7.4 Diálogos, visualizador e painéis

- **Criar sala, Entrar, confirmação e texto** (`.modal`, `.dialog-box`):
  - folha centralizada de 440 px, `--s1`, raio 12 px e `--elev-3`;
  - título em Instrument Sans 700 e campos `--s2` com rótulo acima;
  - ações à direita, com a principal em `--act`. A destrutiva usa `--danger` e nunca é o padrão do Enter;
  - fundo da página escurecido com `rgba` sólido, sem blur. Esc e clique fora cancelam.
- **Visualizador de imagem:** fundo `--bg` a 92%, imagem centralizada e botões em pílula `--s2` no topo à direita.
- **Painel de emoji do chat:** o mesmo popover sólido das reações (`--s2`, `--elev-3`, raio 12 px), com as abas em
  mono.
- **Menus** (membro, tema e "⋯" da sala): o mesmo componente do menu do vídeo (seção 4).

### 7.5 Faixa de título, splash e Espiar

- **Faixa de título** (`titlebar.js`): altura e comportamento iguais, com fundo `--bg`, texto `--tx2` e botões de
  janela de 46 px no padrão do Windows (fechar com hover `--danger`).
- **Splash e Espiar** (`espiar.html` e o `backgroundColor` das janelas no main): fundo `#0C0D0F` e as fontes novas.
  No Espiar, a barra do vídeo segue a seção 4, só com tally, nome e fechar.
- O site continua fora deste plano.

## 8. Verificação

- `npm test` e `npm run lint`. Testes novos:
  - o preset `estudio` passa na trava de contraste;
  - migração `marca` → `estudio` uma vez só;
  - `on-act` escolhido pela luminância no tema personalizado;
  - `@font-face` só com arquivos locais que existem;
  - nenhum id do `index.html` perdido (conferido contra a `origin/main`).
- Bancadas atuais sem regressão: `harness.js checar`, `rodar.js`, `mesa-real.js`, `festa-real.js`,
  `leva2-real.js`, cartas e `caber.js`.
- Bancada nova de sala (`tools/bancada-sala/`), no servidor real com três pessoas em páginas separadas. Ela confere:
  - as três colunas em 1440×900 e 1366×768;
  - o trilho e o chat recolhendo sozinhos nas larguras da seção 3;
  - Assistir pela presença levando a tela ao palco;
  - que nada no palco fica por cima da imagem (`elementFromPoint` no centro e nos cantos do vídeo devolve o vídeo),
    exceto a paleta com o rabisco ativo;
  - o painel de reações e o menu do vídeo com fundo sólido (cor de fundo computada não transparente);
  - o menu sem "Tela cheia";
  - a qualidade só na tela dos outros.
- Bancada de telas fora da sala (`tools/bancada-telas/`): monta o lobby com 0, 3 e 12 salas, as Configurações
  em cada seção, o seletor de tela e cada diálogo, em 1366×768 e 1440×900, nos temas Estúdio e Papel. Ela
  confere que nada rola na horizontal, que todo botão e campo visível tem nome acessível e não está coberto
  (`elementFromPoint`), que o Esc fecha diálogos e volta das Configurações, e que o foco vai para o primeiro
  campo ao abrir um diálogo.
- Boot no Electron real sem erros de console, e prints do app real em 1440×900 e 1366×768 nos temas Estúdio e Papel.

## 9. Como o trabalho se divide

A sessão principal coordena, integra, commita, roda o app real e faz a passada visual. Jobs do Codex, com no máximo
dois ao mesmo tempo e nunca dois no mesmo arquivo:

| Etapa | Executor |
|---|---|
| Identidade: preset, fontes, tokens de raio e foco, `theme.js` com `onAct` e migração | `gpt-5.6-terra` high |
| Três colunas, recolher e presenças (`index.html`, `ui.js` na parte de membros, CSS) | `gpt-5.6-terra` medium |
| Palco: barra do tile, reações, menu do vídeo e palco vazio | `gpt-5.6-terra` medium |
| Qualidade que você recebe (se o caminho existir) | `gpt-5.6-terra` high |
| Chat, cabeçalho, dock e faixa de título | `gpt-5.6-terra` medium |
| Lobby em painel de controle | `gpt-5.6-terra` medium |
| Configurações em tela própria | `gpt-5.6-terra` high (muda a navegação entre vistas) |
| Seletor de tela, diálogos, visualizador, emoji, splash e Espiar | `gpt-5.6-terra` medium |
| Bancada de telas fora da sala | `gpt-5.6-terra` medium |
| Bancada de sala | `gpt-5.6-terra` medium |
| Revisão final, sandbox `read-only` | `gpt-5.6-terra` high |
| STATUS, glossário e prints | `gpt-5.6-luna` medium |
