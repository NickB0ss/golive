# Lobby v2 e acabamento da interface — design

Data: 2026-09-03. Sucede o redesign de 0.4.0
([`2026-09-02-redesign-chat-e-moderacao-design.md`](./2026-09-02-redesign-chat-e-moderacao-design.md)),
não o substitui: a direção visual "Superfície e sinal" (elevação em vez de
cor, acento reservado a "alguém está ao vivo", zero `backdrop-filter`)
continua valendo palavra por palavra. O que muda é **layout, densidade e
acabamento** — nenhuma decisão de paleta ou de motion é reaberta.

## 1. O problema

O 0.4.0 entregou a interface certa com o **enquadramento errado**. Nove
observações de uso, agrupadas em três famílias:

**(a) O lobby não é uma tela de desktop.** É uma coluna de 560px centrada
numa janela de 1280×800. Funciona, mas o app abre parecendo um diálogo que
esqueceram de fechar: 62% da largura é fundo vazio, a lista de salas — a
única parte viva da tela — fica espremida em 560px, e a hierarquia é uma
pilha vertical sem foco. É a primeira coisa que qualquer pessoa vê do app.

**(b) Controles com cara de HTML cru.** O `<input type="checkbox">` nativo
com `accent-color` é o controle mais básico que existe no navegador, e ele
aparece em três lugares (proteger com PIN, compartilhar som, som do
Discord). O `<select>` de qualidade é o segundo. Ao lado de botões de 44px
com ícone, eles denunciam o resto.

**(c) Texto longo quebra o layout.** Nome de janela grande estoura o card do
seletor de fontes; nome de pessoa grande faz nascer uma **barra de rolagem
horizontal** na coluna de membros — e essa barra é a barra nativa do
Chromium, cinza-clara, grossa, desenhada pra um tema claro.

Três pedidos pontuais completam a lista: "anunciar na rede" está enterrado
em Configurações quando a decisão é tomada ao **criar a sala**; o botão
"Criar" não mostra que está criando; o botão "Atualizar" do seletor de
fontes é o único botão de ação do app sem ícone.

E um pedido de organização: as telas compartilhadas ficam "espalhadas" na
grade da sala, sem ordem nem tamanho previsível.

## 2. Princípio que organiza esta passada

> **Uma tela de desktop tem regiões, não uma pilha.**

O lobby de 0.4.0 empilha cinco blocos numa coluna. O lobby v2 divide a
janela em regiões com papéis diferentes — *o que eu faço* à esquerda, *o que
está acontecendo* à direita — porque numa tela larga o olho varre em Z, não
de cima pra baixo. É a mesma lógica que a Sala já usa (palco + coluna), e
usar a mesma lógica nas duas telas é o que faz o app parecer um app.

Corolários que decidem os casos duvidosos abaixo:

1. **Nada de largura elástica infinita.** Regiões têm largura máxima; o que
   sobra vira margem. Um card de sala com 900px de largura não fica melhor,
   fica errado.
2. **Truncar é o último recurso, e nunca em silêncio.** Primeiro `min-width:
   0` pra deixar encolher, depois reticências, e o texto completo sempre
   disponível no `title`.
3. **Barra de rolagem nunca é layout.** Se uma barra horizontal apareceu, o
   layout está errado — a correção é o `min-width: 0` que faltou, não estilizar
   a barra. A barra estilizada é pra rolagem **vertical**, que é legítima.

## 3. Lobby v2 — layout

Três faixas verticais (`grid-template-rows: auto 1fr auto`) e, na do meio,
duas colunas:

```
┌──────────────────────────────────────────────────────────────────┐
│ [GL] GoLive LAN                    v0.4.0    [⟳ atualizar] [⚙]   │  topbar 56px
├───────────────────────────┬──────────────────────────────────────┤
│  COMECE POR AQUI          │  SALAS ABERTAS NA SUA REDE      [⟳]  │
│                           │                                      │
│  Sua tela, na casa        │  ┌────────────────────────────────┐  │
│  dos seus amigos.         │  │ ●  sala do nicolas             │  │
│                           │  │    26.0.0.1 · 3 pessoas  [Entrar] │
│  1080p60 direto de PC     │  ├────────────────────────────────┤  │
│  pra PC pela sua LAN      │  │ 🔒 sala do joão                │  │
│  virtual.                 │  │    26.0.0.5 · 1 pessoa   [Entrar] │
│                           │  └────────────────────────────────┘  │
│  ┌─────────────────────┐  │                                      │
│  │  +   Criar sala     │  │                                      │
│  └─────────────────────┘  │                                      │
│  ┌─────────────────────┐  │                                      │
│  │  ⚯   Entrar por     │  │                                      │
│  │      endereço       │  │                                      │
│  └─────────────────────┘  │                                      │
│                           │                                      │
│  ● Radmin VPN             │                                      │
│    26.0.0.1               │                                      │
├───────────────────────────┴──────────────────────────────────────┤
│ [av] Nicolas                                                 [⚙] │  barra do usuário
└──────────────────────────────────────────────────────────────────┘
        ↑ 380px fixo              ↑ 1fr, até 640px
                 tudo dentro de um container de 1120px
```

### 3.1 Por que duas colunas e não uma mais larga

Alargar a coluna única pra 900px resolveria o vazio e criaria dois problemas:
a lista de salas ficaria com linhas de 900px pra exibir "nome + IP + 3
pessoas" (densidade ridícula), e os dois botões gigantes no topo empurrariam
a lista pra baixo da dobra numa janela de 600px de altura (o `minHeight` da
janela).

Com duas colunas, os dois CTAs ficam **sempre visíveis** independente de
quantas salas a rede tem, e a lista rola sozinha na coluna dela.

### 3.2 Larguras

- Container: `max-width: 1120px`, centralizado, `padding: 0 32px`.
- Coluna de ações: `380px` fixo (`grid-template-columns: 380px minmax(0, 1fr)`).
- Coluna de salas: o resto, com `max-width: 640px` no conteúdo interno — em
  janela maximizada de 1920px a lista não vira uma faixa de 1400px.
- Abaixo de **1040px** de viewport: uma coluna só (`grid-template-columns:
  minmax(0, 1fr)`), ações em cima, salas embaixo. O `minWidth` da janela é
  900px, então este caso existe de verdade.
- Abaixo de **820px** de altura: o parágrafo de apoio do hero some
  (`display: none`), porque numa janela baixa ele é a primeira coisa que
  empurra a lista pra fora.

### 3.3 A coluna de ações

Um painel (`--s1`, borda `--line`, raio `--r-lg`) com quatro partes:

1. **Sobrancelha** — `COMECE POR AQUI`, 11px, caixa alta, `--tx3`. É o rótulo
   da região, o que dá à tela a estrutura que a versão anterior não tinha.
2. **Título** — 26px/1.25, peso 700. Uma frase, não um slogan de marketing.
3. **Parágrafo** — 13px, `--tx2`, 2 linhas. Explica o que o app é pra quem
   abriu pela primeira vez.
4. **Dois botões de largura total**, 56px de altura, empilhados com 10px de
   gap: `Criar sala` (primário, `--act`) e `Entrar por endereço`
   (secundário). Uma primária por tela — a regra de 4.5 da spec anterior.
5. **Rodapé do painel** — o endereço da máquina na rede virtual, separado por
   uma linha. Ponto de status + nome da rede + IP em `tabular-nums`.

### 3.4 O rodapé de rede (novo)

Vem de `network:address` (IPC novo, embrulhando o `pickAddress` que já existe
e já é testado em `src/main/network.test.js`). Três estados:

| `kind` | Ponto | Texto | Por quê |
|---|---|---|---|
| `radmin` / `tailscale` | `--live` | `Radmin VPN` / `Tailscale` + IP | é a rede que o app espera |
| `lan` | `--warn` | `Rede local` + IP | funciona, mas só na mesma casa |
| `null` | `--tx3` | `Sem rede detectada` | criar sala vai falhar ou só servir localhost |

Isto responde à pergunta que hoje só tem resposta **depois** de criar a sala
("qual endereço eu passo pros meus amigos?") e é o tipo de informação que
justifica uma tela de desktop existir.

### 3.5 A coluna de salas

Cabeçalho com o rótulo, um contador (`3`) numa pílula e o botão de atualizar
(já existia, com `.spin`). Abaixo, cards de sala:

- Linha de 64px, `--s1` sobre o fundo, borda, raio `--r-md`, gap de 8px
  entre cards (cards separados, não uma lista com divisórias — o card
  sobrevive melhor ao vazio: com uma sala só, uma lista de uma linha dentro
  de uma moldura parece um erro).
- **Avatar da sala**: quadrado de 40px com a inicial do nome, cor derivada do
  endereço pelo mesmo `avatarColorFor` que a lista de membros usa. Duas salas
  diferentes ficam distinguíveis de relance sem ler.
- **Nome** (14px, 600) + **meta** (12px, `--tx2`): `IP · N pessoas`.
- **Cadeado** quando `protected`, como ícone SVG — não o emoji `🔒` que a
  versão atual usa (regra 4 do checklist de UI: nunca emoji como ícone).
- **Botão `Entrar`** com rótulo textual, não só a seta. Um botão de ícone
  sozinho numa linha de lista é adivinhação; o alvo continua com 36px de
  altura.
- Hover no card inteiro (`--s2`), e o card inteiro é clicável — o botão é o
  reforço visual, não a única porta.
- **Estado vazio**: ícone de antena, "Nenhuma sala aberta na rede agora" e
  uma linha de apoio explicando que quem criou pode ter desligado o anúncio.
  Estado vazio com explicação, não uma frase cinza solta.

### 3.6 A barra do usuário

Continua no rodapé, agora dentro do container de 1120px e com a mesma altura
da topbar. Mantém avatar + nome + engrenagem, todos abrindo Configurações.

## 4. "Anunciar na rede" muda de lugar

**Sai** de `Configurações > Rede`. **Entra** no diálogo de criar sala, como a
segunda de duas opções.

Razão: a pessoa decide se quer a sala visível **no momento em que cria a
sala**; é uma propriedade daquela sala, não uma preferência do app. Enterrada
em Configurações, ela é encontrada por acidente ou nunca.

Consequência: a aba **Rede** de Configurações fica vazia e é **removida** —
Configurações passa a ter Perfil / Voz e Vídeo / Estatísticas. O
`config.network.advertise` continua existindo e persistindo: ele vira o
**valor inicial** da caixa no diálogo, e é regravado a cada criação de sala.
Quem sempre anuncia nunca precisa marcar nada.

Cai junto o que ficou órfão: `discovery:setAdvertise` (IPC), `setAdvertise`
(preload) e `onNetworkChange` (dependência do `ui.settings.open`). O anúncio
já é ligado/desligado pelo `advertise` que viaja no `room:host`, e
`discovery:refresh` preserva o estado atual — nada perde função.

## 5. Diálogo de criar sala

```
┌────────────────────────────────────────────┐
│ Criar sala                                 │
│ Você vira o dono: só você expulsa, bane    │
│ e para transmissão dos outros.             │
│                                            │
│ ┌────────────────────────────────────────┐ │
│ │ [✓] Anunciar a sala na rede            │ │
│ │     Quem estiver na mesma LAN virtual  │ │
│ │     vê a sala na lista, sem endereço.  │ │
│ ├────────────────────────────────────────┤ │
│ │ [ ] Proteger com um PIN                │ │
│ │     PIN de 4 dígitos gerado na hora.   │ │
│ └────────────────────────────────────────┘ │
│                                            │
│              [Cancelar]  [◐ Criando sala…] │
└────────────────────────────────────────────┘
```

O botão "Criar" ganha estado ocupado: `disabled`, spinner girando no lugar do
ícone e rótulo `Criando sala…`. O Cancelar também fica `disabled` enquanto
isso — cancelar no meio do `room:host` não cancelaria coisa nenhuma, e um
botão que finge cancelar é pior que um desabilitado. Se der erro, o estado
volta ao normal e a mensagem aparece no lugar de sempre.

Isto **não** é opcional por estética: subir o servidor embutido inclui pedir
liberação de firewall ao Windows, o que pode demorar segundos e abrir um
prompt de elevação. Hoje, nesse intervalo, o diálogo fica congelado sem
explicação.

## 6. Checkbox — componente, não `<input>`

Estrutura (uma `<label>` envolvendo tudo, então o clique em qualquer ponto
alterna, e o `<input>` real continua sendo o que o teclado e os leitores de
tela enxergam):

```html
<label class="check">
  <input type="checkbox" id="…" />
  <span class="check-box" aria-hidden="true"><svg …/></span>
  <span class="check-text">
    <span class="check-title">Anunciar a sala na rede</span>
    <span class="check-desc">Quem estiver na mesma LAN virtual…</span>
  </span>
</label>
```

- `input` fica `opacity: 0; position: absolute` — **não** `display: none`
  (some da ordem de tabulação) nem `visibility: hidden`.
- `.check-box`: 20×20, raio 6px, borda 1.5px `--line2`, fundo `--s2`.
- Marcado: fundo `--act`, borda `--act`, e o `<svg>` do check entra com
  `opacity 0→1` + `transform: scale(.6)→scale(1)` em `--dur-fast`. As duas
  propriedades animadas são as duas que a spec autoriza.
- Foco: `:focus-visible` no input desenha o anel `--ring` na `.check-box`.
- `.check` inteiro é uma superfície de 44px+ com hover `--s2` e raio
  `--r-sm` — a linha toda é alvo, não os 16px do quadradinho.
- Variante `.check.compact` (sem `.check-desc`) pro seletor de fontes, onde
  as duas opções de áudio não precisam de parágrafo.

Substitui todos os `.check-inline` do app (PIN, anunciar, compartilhar som,
som do Discord, sons do app).

## 7. Barras de rolagem

**Correções de layout primeiro** (a barra horizontal não deve existir):

| Onde | Causa | Correção |
|---|---|---|
| `.peer-list` / `.banned-list` | `li` é flex; nome + coroa + tag de qualidade + selo AO VIVO somam mais que 300px de largura mínima | `min-width: 0` no `li` e `flex: 0 1 auto` no `.peer-name`; `overflow: hidden` no `li` |
| `.chat-messages` | `.chat-author` sem reticências | `min-width: 0` + reticências no `.chat-head` |
| `.picker-grid` | item de grade tem `min-width: auto`, então o card cresce até caber o nome inteiro da janela | `min-width: 0` no `.source-card` |
| `.tile-watchers-list` | `white-space: nowrap` sem largura máxima | reticências + `title` |
| Todas | `overflow-y: auto` com eixo X visível vira `auto` nos dois eixos | `overflow-x: clip` explícito onde a rolagem vertical é intencional |

**Depois** o estilo, global, para as barras verticais que sobram:

- Firefox/padrão: `scrollbar-width: thin; scrollbar-color: <thumb> transparent`.
- WebKit: trilho transparente, polegar `rgba(255,255,255,.13)` com
  `border-radius: 999px` e `border: 3px solid transparent` + `background-clip:
  padding-box` (o truque que dá ao polegar um respiro sem precisar de
  margem). Hover a `.22`.
- Sem seta de canto, sem botão de step, sem hover no trilho.
- A regra antiga específica do `.picker-box` sai — vira o caso geral.

## 8. Seletor de fontes (compartilhar tela)

### 8.1 Tag de qualidade por tela

Cada card de tela ganha uma pílula no canto superior direito da miniatura,
derivada da resolução real do display:

| Altura | Tag |
|---|---|
| ≥ 2160 | `4K` |
| ≥ 1440 | `1440p` |
| ≥ 1080 | `1080p` |
| ≥ 720 | `720p` |
| resto | `SD` |

A pílula é neutra (fundo preto 65%, texto `--tx`, borda `--line2`), **não**
colorida: pela regra do acento, cor na tela quer dizer transmissão. A
resolução exata continua na linha de meta embaixo, pra quem quiser o número.

Janelas não têm resolução (o `desktopCapturer` não devolve tamanho de
janela), então card de janela não ganha pílula — ganha o **ícone do app**,
que passa a ser buscado (`fetchWindowIcons: true`) e desenhado a 16px antes
do nome. Isso resolve metade do problema de "qual dessas cinco janelas do
Chrome é a certa" sem custo perceptível: o ícone vem no mesmo lote que a
miniatura.

### 8.2 Ordem e tamanho fixo

- **Telas primeiro, por nome** (`Tela 1`, `Tela 2`, … — `localeCompare` com
  `numeric: true`, senão `Tela 10` vem antes de `Tela 2`).
- **Janelas em ordem alfabética**, mesma comparação, insensível a caixa.
- Card com tamanho **previsível**: `repeat(auto-fill, minmax(210px, 1fr))`
  com `min-width: 0`, miniatura sempre 16/9 e o corpo de texto com altura
  fixa de duas linhas (nome + meta). Cards de alturas diferentes numa mesma
  linha eram o que dava a sensação de "espalhado".
- Contador por aba: `Telas · 2`, `Janelas · 14`.

### 8.3 Botão de atualizar

Ganha o mesmo ícone de recarregar que o lobby usa, à esquerda do rótulo, e a
mesma animação `.spin` de 600ms no clique. Passa a ser um `.ghost.small`
como os outros botões secundários do app, em vez do estilo próprio que ele
inventava.

### 8.4 Presets de qualidade em chips

O `<select>` nativo vira um grupo de 6 chips (`role="radiogroup"`, setas do
teclado navegam), duas linhas de três:

```
[ 720p 30 ]  [ 720p 60 ]  [ 1080p 30 ]
[ 1080p 60 ] [ 1440p 30 ] [ 1440p 60 ]
   ↑ recomendado
```

O chip selecionado usa elevação + contraste (`--s4` + borda `--line2` + texto
`--tx`), nunca cor — mesma regra do resto. A linha de banda estimada continua
embaixo, inalterada.

## 9. Grade de tiles na sala

Hoje: `repeat(auto-fit, minmax(min(420px, 100%), 1fr))`. Consequência com 3
tiles numa janela de 1280px: duas colunas, o terceiro tile sozinho numa linha
com largura de meia tela — o "espalhado" da observação.

Passa a ser **layout por contagem**: `ui.js` escreve `data-count` na grade a
cada `showTile`/`removeTile`, e o CSS decide as colunas:

| Tiles | Colunas | Observação |
|---|---|---|
| 1 | 1 | `max-width: 1280px`, centralizado — um tile só não vira um painel de 1900px |
| 2 | 2 | |
| 3–4 | 2 | 2×2; com 3, o terceiro fica na coluna da esquerda, previsível |
| 5–6 | 3 | |
| 7+ | 3 | rola verticalmente |

Numa janela estreita tudo cai pra uma coluna. O corte é `@media` na largura
da janela (1100px), não `@container` na largura do palco: `container-type`
criaria um contexto de contenção novo justamente no elemento que hospeda os
`<video>`, e o projeto não usa consultas de contêiner em lugar nenhum. O
limite de 1100px é calculado **com a coluna lateral aberta** (300px), que é o
caso comum.

**Ordem estável**: `order: 0` pros tiles de tela, `order: 1` pros de câmera.
Tela é o conteúdo; câmera é o acompanhamento. Sem isso, a ordem é a de
chegada dos streams, que muda a cada reconexão.

## 10. O que esta spec **não** muda

- Paleta, tokens de motion, regra do acento, veto ao `backdrop-filter`.
- Qualquer coisa de transporte: mesh, árvore, qualidade adaptativa,
  sinalização, moderação, chat — nenhum arquivo dessas camadas é tocado.
- O contrato `root.GoLive.ui` visto pelo `app.js`, exceto: `settings.open`
  perde a dependência `onNetworkChange`, `dialogs.openCreateRoom` passa a
  receber `advertise` inicial e a expor `setCreateRoomBusy`, e
  `picker.open` continua com a mesma assinatura.
- O layout da Sala (palco + coluna de membros/chat). Só a grade de tiles
  dentro do palco muda, e só no `grid-template-columns`.

## 11. Riscos

1. **`fetchWindowIcons: true`** aumenta o custo do `sources:list` na aba de
   janelas. O lote de janelas já é o caro e já roda em paralelo com o de
   telas, sem segurar a abertura do diálogo (F1.6 da spec de 2026-08-23);
   o ícone é um bitmap pequeno por janela contra uma miniatura de 224×126.
   Se medir mal em máquina real, é uma linha pra reverter.
2. **Remover a aba Rede** de Configurações apaga o único lugar onde alguém
   podia desligar o anúncio de uma sala **já criada**. Aceito: o beacon só
   sai enquanto a sala existe, e recriar a sala com a caixa desmarcada é um
   caminho de dois cliques.
3. **Layout por contagem** com 7+ tiles fixa 3 colunas onde o `auto-fit`
   poderia caber 4 numa janela maximizada. Aceito: o teto prático da árvore
   de retransmissão é ~4 pessoas (G6 no `STATUS.md`), então 7+ tiles é um
   cenário que não existe hoje.
