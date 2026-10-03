# Rework das janelas da Mesa — design

Data: 2026-10-01 · Branch: `feat/janelas-rework` (a partir de `75f0457`)

## Objetivo

As 30 janelas que se põem na Mesa ficam mais usáveis, mais bonitas e **menos cruas**: hoje são caixas escuras
iguais, com espaço morto, texto em escalas diferentes, botões com ícone empilhado sobre o rótulo, título repetido
no corpo, quatro desenhos diferentes de "Sentar" e estados vazios feitos só de uma frase solta. Direção escolhida
pelo Nicolas: **mais rico** (mais cor, profundidade e personalidade), entregue em **fundação + levas**.

Prints do estado de partida (tamanho padrão, tema Sinal) foram tirados da bancada em 2026-10-01; a comparação
antes/depois de cada leva usa o mesmo roteiro.

## Fora de escopo

- Protocolo, servidor e módulos de estado (`server/`, `src/renderer/mesa-modules/`). Nada de `size` novo: uma
  janela que não cabe é conserto de layout, não de tamanho.
- A caixa da janela de tela/câmera (vídeo) e a Vista (`mesa-view.js`), exceto o chip da barra (seção 3).
- Comportamento de jogo. Toda ação, permissão e mensagem continua igual; muda só como aparece.

## 1. Assinatura: cada janela é um material sobre a mesa

A raiz de todo conteúdo (`.mj`) ganha `data-superficie`. A tabela mora em um lugar só,
`GoLive.mesaJanelasComum.SUPERFICIES`, e o `base()` aplica o atributo — nenhum tipo escolhe o seu na mão.

| Superfície | Tipos |
|---|---|
| `feltro` | poquer, blackjack, truco, oito, domino, dados, roleta |
| `tabuleiro` | velha, lig4, damas, xadrez, batalha |
| `papel` | nota, lista, enquete, sorteio, stop, quiz |
| `lousa` | placar, cronometro, quadro, desenha |
| `palco` | youtube, aovivo, radio, imagem, galeria, jam, link, sons |

Regras de cor (valem para todas):

- Só gradientes CSS e `box-shadow`. Nada de imagem, `filter`, `backdrop-filter` nem SVG com `feTurbulence`.
- As constantes de material (verde do feltro, madeira, ardósia, creme do papel) são declaradas **uma vez**, como
  custom properties no topo da folha base das janelas, com nome `--mj-mat-*`. Em nenhum outro lugar aparece hex
  novo.
- **Ilhas escuras** (`feltro`, `lousa`, `palco`) ficam escuras em todos os temas, como o vídeo. Dentro delas a
  raiz `.mj` redefine as primitivas de tema para a versão escura: `--tx`, `--tx2`, `--tx3`, `--s2`, `--s3`, `--s4`,
  `--line`, `--line2`, `--act`, `--act-hover`, `--on-act`, `color-scheme: dark`, e repõe as variantes de tom
  escuro da semântica (`--wire`, `--ok`, `--warn`, `--danger`, com os valores de `:root` em `sinal/tokens.css`).
  Assim, todo filho que já usa os tokens funciona sem exceção por tipo. Texto normal fica com contraste ≥ 4,5:1
  sobre o material; `--tx3` nas ilhas é `rgba(237, 237, 242, 0.66)` ou mais claro.
- **Seguem o tema** (`tabuleiro`, `papel`): misturam a constante do material às primitivas do tema por
  `color-mix(in oklab, …)`, então no Papel saem claros e no Sinal saem escuros.
- O vermelho continua sendo só "ao vivo". A cor de uma pessoa (`--mj-cor`) continua só em detalhe.

Valores de partida (ajuste fino permitido na leva 0, desde que respeite as regras acima):

| Material | Receita |
|---|---|
| feltro | `radial-gradient(ellipse 120% 90% at 50% 30%, #1D513C, #133A2B 70%, #0F2F23)` + sombra interna suave nas bordas |
| lousa | base `#1B2228`, mancha de giz `radial-gradient(ellipse at 30% 15%, rgba(237,237,242,.05), transparent 60%)` |
| palco | `var(--void)` |
| tabuleiro | moldura `color-mix(in oklab, #7A5233 40%, var(--s2))` com veio `repeating-linear-gradient(100deg, transparent 0 7px, rgba(0,0,0,.05) 7px 8px)`; casa clara `color-mix(in oklab, #D9B98C 30%, var(--s3))`; casa escura `color-mix(in oklab, #5B3B22 35%, var(--s1))` |
| papel | fundo `color-mix(in oklab, var(--s1) 88%, #E9DFC8 12%)`; pauta `repeating-linear-gradient(to bottom, transparent 0 27px, var(--line) 27px 28px)` só nas áreas de escrita |

Peças, cartas e pedras ganham volume com um brilho (`radial-gradient` em 35% 30%) e sombra de contato
(`0 2px 0 rgba(0,0,0,.35), 0 4px 8px rgba(0,0,0,.25)`).

## 2. Componentes comuns (em `mesa-janelas/comum.js`)

### `cadeiras({ aoSentar, aoLevantar }) → { node, sync(lugares) }`

Um desenho único de lugar à mesa para todo jogo com assentos. `lugar`:
`{ peer, nome, cor, peca, vez, eu, motivoSentar, motivoLevantar }`, onde `peer === null` é lugar livre, `peca` é
`{ texto }` (X, O, naipe), `{ cor }` (cor da peça) ou `null`, e `motivo*` segue o contrato do `ligado()`
(`true` ou o motivo em texto).

- Ocupado: avatar de 24 px com a inicial e anel de 2 px na cor da pessoa, nome (o próprio vira "Você") e a peça.
- Livre: círculo tracejado com "+" e o rótulo "Sentar"; o lugar inteiro é o botão.
- Vez: anel e brilho no `--wire`, e o lugar fica em destaque. É o "Sua vez" dentro do jogo; o da barra continua.
- `sync` atualiza no lugar, sem recriar botões (o foco não pode cair, como no `campoLocal`).
- Abaixo de 280 px de largura do container: só avatar e peça, com o nome no `title`.

### `vazio({ icone, titulo, texto, acao }) → node`

Estado vazio que convida a agir: glifo de traço de 40 px num círculo de 72 px em `--s2`, título em
`--t-heading`, uma frase em `--tx2` com no máximo 36ch, e **uma** ação (`acao` é um botão ou um formulário, como
o campo de link das janelas de mídia). Centralizado no espaço livre. Substitui os textos soltos de lista, galeria,
imagem, youtube, aovivo, radio, link, jam, desenha, truco, domino e roleta.

### `acoes({ principal, secundarias }) → node`

Barra de ações no rodapé (`margin-top: auto`, filete `--line` em cima): secundárias à esquerda em `mj-fantasma`,
principal à direita em `mj-pri`. Ícone **sempre ao lado** do rótulo. Abaixo de 280 px de container, as secundárias
ficam só com ícone (o rótulo vai para `aria-label` e `title`).

### Novos ícones

O mapa `ICONES` ganha só o que as levas usarem (ex.: `link`, `musica`, `imagem`, `cartas`, `tabuleiro`, `lousa`),
sempre em traço de 24×24, no mesmo estilo dos atuais.

## 3. Regras que valem para os 30 tipos

- **Botões**: `.mj-btn` com ícone e rótulo na mesma linha, em todos os tipos. A causa do empilhamento é achada e
  corrigida na base, não remendada por tipo.
- **Escala**: só `--fs-*`/`--t-*`, nunca abaixo de 12 px em texto lido. Números de placar, cronômetro e pontos em
  Sora (`--font-display`); dados tabulares em `--font-data`.
- **Título**: nenhum conteúdo repete o título que já está na barra da janela ("Oito maluco", "Quiz", "Pôquer").
  Informação de estado (rodada, blinds, pergunta 1 de 10) fica numa linha de estado, em `--t-meta`.
- **Frase redundante**: some o rodapé "Cadeiras livres: sente-se para jogar" quando as cadeiras já dizem isso, e
  some uma de duas frases que dizem a mesma coisa ("Nada na lista ainda" + "Lista vazia").
- **Barra da janela** (`sinal/mesa.css`): `.mesa-type` vira um chip de 20 px com o fundo do material da janela
  (`.mesa-win:has(.mj[data-superficie=…])`). Nada mais muda na barra.
- **Movimento**: só `transform`/`opacity`, ≤ 300 ms, e desligado por `prefers-reduced-motion`. Um momento por
  família, só onde ainda não existe: carta vira (`rotateY`) ao ser revelada; peça assenta (sobe 6 px e cai com
  escala 1,08 → 1) ao ser jogada; número da lousa troca deslizando. As animações que já existem ficam.
- **Acessibilidade**: tudo que era botão continua botão, com o mesmo `aria-label`; foco visível no `--wire`.

## 4. Levas

| Leva | Arquivos | O que entra |
|---|---|---|
| 0 Fundação | `mesa-janelas.css` → `mesa-janelas.css` (só `@import`) + `mesa-janelas/css/*.css`; `comum.js`; `sinal/mesa.css` | divisão do CSS (só mover), materiais, ilhas escuras, `cadeiras`/`vazio`/`acoes`, conserto do botão empilhado, chip da barra |
| 1 Ferramentas | nota, lista, enquete, placar, cronometro, sorteio, dados, roleta, quadro, sons | superfície aplicada; vazio, ações, escala; lousa com números em giz |
| 2 Tabuleiros | tabuleiro, velha, lig4, damas, xadrez, batalha | `cadeiras` no lugar das pílulas; madeira, casas e peças com volume; mar da batalha |
| 3 Cartas e festa | cartas, poquer, blackjack, truco, oito, domino, stop, quiz, desenha | `cadeiras` em volta da mesa de feltro; vazio de truco e dominó; título repetido; carta que vira |
| 4 Mídia | youtube, aovivo, radio, imagem, galeria, jam, link | `vazio` com o formulário de link; palco escuro com o conteúdo como protagonista |

A divisão do CSS: `mesa-janelas.css` continua sendo o único arquivo que os carregadores conhecem (`index.html`,
`mesa-view.js`, `tools/midia/main.js`, bancada) e passa a ter só `@import` de `mesa-janelas/css/base.css` e de uma
folha por família (`ferramentas`, `tabuleiros`, `cartas`, `festa`, `midia`, `movimento`). `css-rules.test.js` e
`tools/sinal-prints/classes-orfas.js` passam a ler todas as folhas. Com isso as levas 1–4 editam folhas
diferentes e podem correr duas a duas.

## 5. Validação de cada leva

1. `node --test` inteiro verde.
2. `node tools/bancada-janelas/caber.js <tipos da leva>` sem falha, **sem** mudar `size`.
3. `node tools/bancada-janelas/rodar.js --sem-prints <tipos>` sem falha (quando o tipo está no roteiro).
4. Prints antes/depois dos tipos da leva, nos temas Sinal e Papel, olhados por mim antes da leva seguinte.
5. Boot no Electron real coletando erros de console (o `node --test` não carrega o renderer).
6. Uma revisão `gpt-5.6-terra` high, read-only, por leva, contra esta spec.

`PLAYWRIGHT_DIR=C:/Users/nicol/Desktop/portfolio-nubinho/node_modules/playwright`. As bancadas regravam PNGs em
`docs/prints/`; eles não entram nos commits das levas.
