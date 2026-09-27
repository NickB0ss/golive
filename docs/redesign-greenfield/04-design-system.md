# 04 — Design system "Sinal"

## 1. De onde vem: o ícone

O ícone tem três cores e uma ideia.

| No ícone | Valor medido | O que carrega |
|---|---|---|
| Fundo | `#0E0E14` — quase preto, com um fio de azul-violeta | a sala escura, o vazio onde o vídeo aparece |
| Traços e anéis | `#EDEDF2` — giz frio | estrutura: as pessoas e as ligações entre elas |
| Nó sólido | `#FF4D4F` — vermelho-sinal | a fonte: quem está transmitindo agora |

A ideia: **dois anéis vazados ligados a um nó sólido**. É um grafo (pares ligados a uma fonte), é o sinal de
"compartilhar" e é um "play" (›). O vermelho não enfeita — marca a origem do sinal.

Daí saem as três regras da identidade:

1. **Vermelho é ao vivo, e só isso.** Nenhum botão, foco, seleção ou erro usa o vermelho-sinal.
2. **Giz é ação.** A ação principal de cada tela é preenchida de giz com texto em tinta — o mesmo contraste do
   traço sobre o fundo do ícone.
3. **Pessoas são nós.** O estado de uma pessoa é desenhado com a geometria do ícone (seção 6).

Cor derivada: **fio** (`#8C92FF`), a mesma matiz do fundo (≈240°) clareada. É a cor da *sua* atenção: foco de
teclado, o que você está assistindo, o que está selecionado. Faz o papel das ligações do ícone.

## 2. Cor

### Tema padrão "Sinal" (escuro)

| Token | Valor | Uso |
|---|---|---|
| `--c-void` | `#07070B` | atrás do vídeo (palco) |
| `--c-bg` | `#0E0E14` | fundo do app (o do ícone) |
| `--c-raised` | `#15151D` | superfícies fixas: cabeça, barramento, conversa |
| `--c-overlay` | `#1C1C26` | menus, folhas, popovers; hover de linha em superfície fixa |
| `--c-press` | `#262632` | pressionado, campo de texto |
| `--c-line` | `#2A2A36` | fio de separação |
| `--c-line-strong` | `#3D3D4D` | borda de campo, contorno de controle secundário |
| `--c-text` | `#EDEDF2` | texto principal (giz) |
| `--c-text-2` | `#B4B4C3` | texto secundário |
| `--c-text-3` | `#8A8A9E` | metadados, rótulos pequenos (≥4,5:1 até sobre `--c-overlay`) |
| `--c-act` | `#EDEDF2` | preenchimento da ação principal |
| `--c-on-act` | `#0E0E14` | texto sobre a ação principal |
| `--c-act-hover` | `#FFFFFF` | |
| `--c-live` | `#FF4D4F` | ao vivo: nó, selo, contorno de fonte no ar |
| `--c-on-live` | `#0E0E14` | texto sobre o selo ao vivo (tinta sobre vermelho, 5,9:1) |
| `--c-live-soft` | `rgb(255 77 79 / .14)` | fundo de fonte ao vivo |
| `--c-wire` | `#8C92FF` | foco, seleção, "você está assistindo" (7:1 sobre o fundo) |
| `--c-wire-soft` | `rgb(140 146 255 / .16)` | fundo selecionado |
| `--c-ok` | `#43D98C` | conectado, saudável |
| `--c-warn` | `#F5C04A` | atenção (rede instável, encoder em software) |
| `--c-danger` | `#FF8A3D` | erro, ação destrutiva — laranja, para nunca ser confundido com ao vivo |
| `--c-scrim` | `rgb(7 7 11 / .72)` | atrás de folhas e diálogos |

Contraste calculado (WCAG) sobre `--c-bg` / `--c-overlay`: `--c-text` 16,5 / 14,5 · `--c-text-2` 9,4 / 8,3 ·
`--c-text-3` 5,7 / 5,0 (não usar sobre `--c-press`, onde cai a 4,4) · `--c-live` 5,9 / 5,2 · `--c-wire` 7,0 / 6,2 ·
`--c-ok` 10,6 / 9,3 · `--c-warn` 11,5 / 10,1 · `--c-danger` 8,2 / 7,2. Tinta sobre o selo vermelho: 5,9.

Estados de controle derivam dos mesmos tokens: hover sobe uma superfície (`raised → overlay → press`),
pressionado usa `--c-press`, selecionado usa `--c-wire-soft` + texto `--c-text` + marca `--c-wire`, desabilitado
usa `--c-text-3` sem contorno e `cursor: not-allowed`.

### Tema "Sinal claro"

Mesma semântica, invertida: fundo `#F4F4F7`, superfícies `#FFFFFF`/`#EBEBF0`, texto `#0E0E14`, ação preenchida de
tinta `#0E0E14` com texto giz; ao vivo `#C4262B` (5,2:1 como texto sobre o fundo claro; o selo mantém
`#FF4D4F` com texto tinta, 5,9:1), fio `#4B52E0` (5,3), perigo `#B3370A` (5,5), atenção `#8A5300` (5,8), texto
secundário `#4A4A5C` (7,9), metadado `#666678` (5,1). O palco continua escuro
(`--c-void`) nos dois temas: vídeo não se mostra sobre branco.

Os demais temas escolhíveis do sistema de temas passam a ser variações desta mesma estrutura de tokens; a trava
de contraste continua medindo cada combinação.

## 3. Tipografia

Três papéis, três famílias locais (OFL, em `assets/fonts`):

| Papel | Família | Por quê |
|---|---|---|
| Voz | **Sora** 600/700 | geométrica, com `o` e `e` circulares — os anéis do ícone em forma de letra. Nome da sala, títulos de folha, estados vazios. Com moderação. |
| Interface | **Atkinson Hyperlegible Next** 400/700 | feita para leitura difícil: formas de letra que não se confundem (`Il1`, `0O`). A sala é lida de relance, no meio de um jogo, às vezes num segundo monitor. |
| Dados | **Geist Mono** 500 | endereço, PIN, taxa, fps, horas, atalhos. Tudo o que é medida ou código. |

Escala (px / altura de linha):

| Token | Tamanho | Família | Uso |
|---|---|---|---|
| `--t-display` | 28 / 1.15 | Sora 700 | título de tela vazia, boas-vindas |
| `--t-title` | 20 / 1.2 | Sora 600 | título de folha e diálogo, nome da sala na entrada |
| `--t-heading` | 15 / 1.3 | Sora 600 | nome da sala na cabeça, grupos |
| `--t-body` | 14 / 1.45 | Atkinson 400 | texto, mensagens |
| `--t-label` | 13 / 1.3 | Atkinson 700 | botões, nomes em fontes e linhas |
| `--t-meta` | 12 / 1.35 | Atkinson 400 | subtítulos, estado curto |
| `--t-data` | 12 / 1.3 | Geist Mono 500 | números e códigos |
| `--t-tag` | 11 / 1 | Geist Mono 500, caixa alta, +0.06em | selos ("AO VIVO"), rótulos de seção |

## 4. Espaço, grade e densidade

- Unidade 4 px: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 ·
  `--s-10` 40 · `--s-14` 56.
- Controles: 32 px (padrão, desktop denso), 28 px (compacto: dentro de tiles e linhas), 40 px (ação principal
  de tela). Alvo de clique nunca abaixo de 28 × 28.
- Cabeça 44 px (é também a barra de título arrastável). Barramento 72 px. Conversa fixada 340 px.
- Janela mínima de trabalho: 960 × 600. Abaixo de 1180 px de largura a conversa passa de "fixada" para
  "espiando" sozinha.

## 5. Forma, profundidade, movimento

- **Raio**: 6 px controles e linhas · 10 px menus e popovers · 14 px folhas e diálogos · 4 px tiles de vídeo
  (vídeo quer canto quase reto) · círculo só em nós de pessoa. Nada de pílula como enfeite: o único elemento
  arredondado por inteiro é o nó.
- **Profundidade** vem da escada de superfícies (`bg → raised → overlay`), mais um fio de 1 px. Sombra existe só
  para o que flutua: `--elev-float: 0 16px 40px rgb(0 0 0 / .5), 0 0 0 1px var(--c-line)`. Sem blur de fundo.
- **Camadas**: `--z-stage` 0 · `--z-hud` 10 · `--z-chrome` 20 · `--z-peek` 30 · `--z-popover` 40 · `--z-sheet`
  50 · `--z-dialog` 60 · `--z-toast` 70 · `--z-drag` 80.
- **Movimento**: 120 ms micro (hover, pressionar) · 180 ms popover e painel · 240 ms folha. Curva de entrada
  `cubic-bezier(.2,.8,.2,1)`, saída 120 ms `ease-in`. Um único gesto de assinatura: quando você leva uma fonte ao
  palco, o **fio** se desenha do seu nó até a fonte (traço, 200 ms). O nó ao vivo tem um anel que respira (2,4 s).
  `prefers-reduced-motion`: tudo vira troca instantânea, e o anel para.

## 6. Nós — a linguagem de estado das pessoas

Toda pessoa é um nó circular com a inicial (ou a cor escolhida no perfil) dentro:

| Estado | Desenho | Leitura |
|---|---|---|
| Na sala | anel vazado giz | está aqui |
| Assistindo | anel + ponto central fio | está vendo alguma fonte |
| Ao vivo | disco vermelho sólido, texto tinta, anel que respira | transmitindo |
| Pausado | disco vermelho em contorno tracejado | transmissão pausada |
| Câmera | anel com um arco giz de 90° no topo | câmera ligada |
| Na Mesa | anel com um pequeno losango | está na Mesa |
| Líder | marca de coroa de 3 pontos acima do nó | pode moderar |
| Reconectando | anel em tracejado girando | caiu, voltando |

Tamanhos: 16 (aglomerado), 24 (linha), 32 (fonte), 56 (perfil). Todo nó tem `aria-label` com o estado por
extenso — a forma nunca é a única pista.

## 7. Iconografia

Traço de 1,75 px, pontas e junções arredondadas (as do ícone), grade de 20 px, `currentColor`. Um sprite SVG
único (`assets/icons.svg`), referenciado por `<use>`. Ícone sem rótulo sempre tem `aria-label` e dica.

## 8. Componentes

- **Botão**: `primary` (giz cheio), `secondary` (contorno `--c-line-strong`), `quiet` (só texto/ícone, fundo no
  hover), `danger` (texto `--c-danger`, contorno no hover), `live` (usado só por "Transmitir" quando já está
  no ar). Ícone + rótulo por padrão; só ícone dentro de tiles e da cabeça, com dica.
- **Campo**: fundo `--c-press`, contorno `--c-line-strong`, foco com anel de 2 px `--c-wire`. Rótulo acima,
  ajuda abaixo em `--t-meta`, erro abaixo em `--c-danger` com ícone.
- **Segmentado**: trilho `--c-bg`, opção escolhida com `--c-overlay` e texto giz; setas movem, `role=radiogroup`.
- **Controle deslizante** (volume): trilho de 4 px, preenchimento giz, polegar 12 px; roda do mouse ajusta 5%;
  mostra o valor em `--t-data` ao arrastar.
- **Alternância**: 32 × 18, ligado = giz, desligado = contorno.
- **Menu / popover**: `--c-overlay`, raio 10, `--elev-float`, itens 32 px, setas/Home/End/Esc, foco volta a quem
  abriu. Um mecanismo só para todos.
- **Dica**: 500 ms de espera, `--c-press`, `--t-meta`, atalho em `--t-data`.
- **Folha**: entra pela direita sobre a tela atual, com véu; a tela de baixo continua viva (nunca
  `display:none`). Usada por Configurações e perfil.
- **Diálogo**: centrado, raio 14, título `--t-title`, ação principal à direita, Esc/véu cancelam, foco preso.
- **Aviso rápido (toast)**: acima do barramento, centrado; uma linha + uma ação; some em 5 s, pausa no hover.
- **Faixa**: largura inteira sob a cabeça, para estado persistente (atualização pronta, rede caiu).
- **Selo AO VIVO**: retângulo de raio 3, `--c-live` com texto `--c-on-live` em `--t-tag`, ponto tinta à esquerda.
- **Fonte** (item do barramento): nó 32 + nome (`--t-label`) + o que transmite (`--t-meta`) + aglomerado de quem
  assiste. Estados: disponível, no palco (fio embaixo de 2 px + fundo `--c-wire-soft`), ao vivo (nó vermelho),
  pausada, carregando, sem sinal.
- **Tile de vídeo**: vídeo sobre `--c-void`, raio 4. Faixa de informação e controles aparece só com o mouse ou o
  foco dentro do tile e some após 2 s parado; nunca cobre o vídeo sem movimento.
- **Estados vazios**: uma frase do que está acontecendo + uma ação. Desenho, quando houver, é o grafo do ícone
  (anéis e fios), nunca ilustração genérica.
- **Carregando**: esqueleto na forma do conteúdo (linhas de sala, fontes) ou o anel tracejado girando; nada de
  spinner genérico no meio da tela.
- **Erro**: o que aconteceu + como resolver, na voz da interface, sem pedir desculpas.

## 9. Voz

Português do Brasil, frases curtas, verbo no começo, caixa de frase. A ação tem o mesmo nome do começo ao fim:
"Transmitir" → "Você está transmitindo" → "Parar de transmitir". Nada de "Enviar" genérico quando se pode dizer o
que acontece.
