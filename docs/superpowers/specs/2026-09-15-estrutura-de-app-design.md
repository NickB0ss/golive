# Estrutura de app — casca, dock e cards

Data: 2026-09-15. Continuação de `2026-09-15-redesign-marca-design.md` (as cores
aprovadas ficam). Pedido: "mudar a estrutura, em questão de div e posicionamento
de botões, com cara de aplicativo moderno".

## Problema

A estrutura ainda é de página: no lobby, uma barra no topo com perfil e ícones
soltos à direita, um cartão de texto à esquerda e uma lista à direita. Na sala,
duas faixas de borda a borda (cabeçalho e barra de controles) com os botões
colados à esquerda e o "Sair" no canto oposto. Apps de comunicação modernos
(Discord, Slack, Linear, Meet) organizam em **casca**: navegação e identidade
numa coluna fixa, conteúdo no painel principal, controles de chamada num **dock
central**, painéis como superfícies com canto arredondado e respiro entre eles.

## O que não muda

- Todas as regras da spec anterior e do topo do `style.css`: `--live` só para
  "ao vivo", nenhum `backdrop-filter`/`filter` sobre conteúdo vivo, só
  `transform`/`opacity` animam (a transição de largura da coluna lateral já
  existia e fica), cores só por token.
- **Contrato com o JS**: todo `id` do `index.html` continua existindo com o mesmo
  papel (o `app.js`/`ui.js` usam ~130 deles), e as classes que o JS consulta ou
  alterna (`.hidden`, `.room-idle`, `.room-side.collapsed`, `.control-btn`,
  `.is-on`, `.btn-label`, `.btn-spinner`, `.icon-on/.icon-off`, `.settings-cat`,
  `.picker-tab`, `.tile*`, `.grid-main/.grid-strip`, `.empty`). Mover de lugar
  pode; renomear ou remover não.
- O sumiço da interface com o mouse parado (`.room-idle`) continua cobrindo
  cabeçalho, dock e barra do rabisco, por `opacity`, sem reflow.

## 1. Lobby: casca com barra lateral

Duas colunas ocupando a janela abaixo da faixa de título:

**Barra lateral (264 px, `--s1`, borda direita `--line`)**, de cima para baixo:
1. Marca: logo 28 px + "GoLive LAN" (Outfit) + `#app-version` como chip.
2. Ações, largura total, 44 px: `#btn-create-room` (primário) e
   `#btn-join-address` (secundário). `#lobby-error` logo abaixo.
3. Bloco "Sua rede": rótulo de seção + `.lobby-net` como cartão `--s2`.
4. Espaço flexível.
5. **Painel do usuário** preso ao rodapé (como o do Discord), num cartão `--s2`:
   `#user-panel-avatar` + `#user-panel-name` à esquerda; à direita, botões de
   ícone `#btn-update-available` (compacto, só quando visível),
   `#btn-check-update` e `#btn-open-settings`.

A `.lobby-topbar` deixa de existir como faixa; o que ela tinha mora na barra
lateral.

**Painel principal** (`--bg`, rola sozinho):
- Cabeçalho de página: título "Salas na sua rede" (Outfit ~22 px) com
  `#rooms-count` como chip, uma linha de subtítulo em `--tx2` e
  `#btn-refresh-discovery` à direita.
- `#room-list-live` vira **grade de cards** (`repeat(auto-fill, minmax(260px, 1fr))`):
  avatar grande, nome (+ cadeado), endereço e pessoas, selo de versão quando
  houver, e o "Entrar" ocupando a base do card. Card inteiro com hover de
  superfície, sem mudar de tamanho.
- **Estado vazio** centralizado no painel: a logo com o brilho da cor de ação, o
  título "Sua tela, na casa dos seus amigos.", o texto de apoio atual e a
  indicação de que dá para criar uma sala ou entrar por endereço pela barra
  lateral. O cartão "Comece por aqui" some: o texto dele vive aqui.

## 2. Sala: painéis, cabeçalho fino e dock

- A sala ganha respiro: palco e coluna lateral separados por um vão de 8 px
  sobre `--bg`. A coluna lateral vira painel `--s1` com `--r-lg` e margem, não
  uma faixa colada na borda.
- **Cabeçalho do palco** fino e sem faixa de fundo: status + nome da sala à
  esquerda; endereço e PIN como chips; `#btn-copy-address` como botão pequeno com
  ícone; `#btn-toggle-side` à direita. `#btn-room-settings` sai daqui.
- **Dock**: `.control-bar` vira uma pílula centralizada na base do palco
  (`--s1`, `--line2`, `--shadow-2`, `--r-full`), **no fluxo do layout** — nunca
  por cima da grade, para não cobrir tile nenhum. Ordem: compartilhar tela,
  câmera, pausar, trocar | separador | `#btn-room-settings` (ícone) |
  `#btn-disconnect` com ícone de saída e tom de perigo (`--danger-dim` /
  `--danger-soft`, não `--live`). Botões com 44 px de altura, ícone + rótulo.
- **Coluna lateral**: títulos de seção num estilo só; lista de membros compacta;
  chat ocupando o resto, com o campo de escrever como uma barra arredondada na
  base.

## 3. Diálogos e Configurações

- Diálogos (criar, entrar, confirmar, seletor de fonte): mesma anatomia —
  cabeçalho com título, corpo, rodapé com as ações à direita separado por
  `--line`.
- Configurações: cada `.settings-cat` ganha um ícone SVG (perfil, aparência,
  voz e vídeo, estatísticas) antes do rótulo.

## 4. Camadas

Uma escala de `z-index` em tokens (dock/cabeçalho < popovers e menus < modal <
toast < faixa de título), substituindo os números soltos sem mudar a ordem de
empilhamento atual.

## 5. Sala, segunda passada (pedido depois dos prints da primeira)

"Algo poderia mudar também: posicionamento, tamanho, as coisas no geral dentro
da sala."

- **Cabeçalho de 56 px** alinhado ao palco: ponto de status + nome da sala
  (Outfit ~16 px) com uma segunda linha "N pessoas" em `--tx2`; à direita os
  chips de endereço e PIN, o copiar e o recolher coluna.
- **Copiar endereço**: botão de ícone; ao copiar, o ícone vira um ✓ por ~1,5 s e
  "Endereço copiado" é anunciado numa região `aria-live` (não só troca de
  `aria-label`). Nada de `--live` nisso.
- **Palco**: menos margem em volta da grade (o vídeo é o conteúdo), tile
  principal com `--r-lg`; a faixa de câmeras (`.grid-strip`) mais baixa e
  discreta. Só CSS — a distribuição dos tiles continua sendo do `ui.js`.
- **Palco vazio**: o `.empty` da grade vira um estado desenhado (ícone de tela em
  `--tx3`, a frase atual como título e uma linha dizendo que "Compartilhar tela"
  fica no dock). Texto real, ícone `aria-hidden`.
- **Dock no estilo de chamada**: câmera, pausar, trocar e configurações viram
  botões redondos de 48 px só com ícone; o `.btn-label` deles continua no DOM
  (o JS escreve o estado nele) e aparece como dica flutuante acima do botão no
  hover e no foco — assim a dica acompanha o estado sem JS novo, e o leitor de
  tela continua lendo o nome. "Compartilhar tela" continua pílula com rótulo
  (é a ação principal). "Sair da sala" vira botão redondo `--danger` com ícone
  e a mesma dica. O dock inteiro cabe no menor tamanho de janela com a coluna
  aberta, sem cortar.
- **Coluna lateral com abas**: controle segmentado "Pessoas · N" / "Chat" no
  topo; cada aba ocupa a altura toda (lista de membros e banidos numa, chat na
  outra). Chat é a aba padrão. Mensagem nova com a aba Pessoas aberta acende um
  ponto na aba Chat (neutro, não `--live`), apagado ao abrir o chat. Abas com
  `role="tablist"`/`tab`/`tabpanel`, setas do teclado e `aria-selected`.
- Largura da coluna: 320 px.

## 6. Correções da revisão da primeira passada

- "Sair da sala" legível em todo tema (Papel dava 1,87:1): ≥ 4,5:1 medido nos
  sete presets.
- Engrenagem do dock com alvo de 44 px (agora 48 px, pelo item acima).
- `#btn-room-settings` passa a ser o botão do dock (o id se move; o
  `btn-room-settings-dock` e o listener paralelo saem).
- `#btn-toggle-side` com `aria-label` que acompanha o estado.
- Lobby: `#rooms-count` colado ao título e sem esticar no estado vazio; cards de
  sala sem o vão entre as informações e o "Entrar", com endereço e pessoas em
  linhas separadas em vez de cortar com reticências.

## Verificação

`npm test`, `npm run lint` e prints do app real a 1440x900 e 1366x768: lobby com
e sem salas, criar sala, entrar com PIN, Configurações, sala com tela e câmera,
coluna recolhida, sala vazia, seletor de fonte, tema Papel.
