# Seletor de qualidade em dois eixos — design

Data: 2026-09-03. Sucede a passada de acabamento
([`2026-09-03-lobby-v2-e-acabamento-design.md`](./2026-09-03-lobby-v2-e-acabamento-design.md)),
que trocou o `<select>` nativo de qualidade por seis chips. Os chips
resolveram o problema errado. A direção visual "Superfície e sinal"
(elevação em vez de cor, acento reservado a "alguém está ao vivo", zero
`backdrop-filter`, só `transform`/`opacity` animados) continua valendo
palavra por palavra — nada de paleta ou de motion é reaberto aqui.

## 1. O problema

O diálogo de compartilhar mostra a qualidade como **seis botões quadrados
numa grade de três colunas**:

```
[ 720p  30 fps ] [ 720p  60 fps ] [ 1080p 30 fps ]
[  MAIS LEVE   ] [              ] [              ]

[ 1080p 60 fps ] [ 1440p 30 fps ] [ 1440p 60 fps ]
[   PADRÃO     ] [              ] [ EXIGE BANDA  ]
```

Três defeitos, e o terceiro é o que estraga os outros dois:

**(a) É muito quadrado.** Seis retângulos de 56px de altura ocupam duas
fileiras inteiras do diálogo, entre a grade de fontes (que já é uma grade de
cards) e o bloco de áudio. A mesma forma repetida três vezes na tela faz o
diálogo parecer uma sopa de caixas: nada é hierarquia, tudo é caixa.

**(b) Tem coisa demais pra ler.** Cada chip carrega até três fragmentos —
resolução, fps e uma tag. São **até 18 pedaços de texto** pra tomar uma
decisão de duas variáveis. E as tags não ajudam a comparar: "mais leve",
"padrão" e "exige banda" são três escalas diferentes (custo, recomendação,
requisito) impressas lado a lado como se fossem a mesma.

**(c) A ordem não fecha.** Os presets são uma sequência crescente de custo,
mas a grade de três colunas quebra essa sequência no lugar errado: `1080p`
aparece no fim da primeira fileira **e** no começo da segunda. Quem lê em Z
vê `720p, 720p, 1080p` / `1080p, 1440p, 1440p` — a mesma resolução dos dois
lados da quebra de linha, e nenhuma pista de que a segunda fileira é "mais
cara" que a primeira. É por isso que o controle parece não ter ordem: ele
tem, mas o layout a esconde.

## 2. O que os dados realmente são

Os seis presets não são uma lista de seis coisas. São uma **matriz 3×2**:

|            | 30 fps  | 60 fps  |
|------------|---------|---------|
| **720p**   | 2,5 Mbps| 4 Mbps  |
| **1080p**  | 6 Mbps  | 12 Mbps |
| **1440p**  | 10 Mbps | 18 Mbps |

Toda combinação existe — não há célula morta. E os dois eixos são
ortogonais e significam coisas diferentes pra quem assiste: resolução é
*quanto detalhe*, fps é *quanto movimento*. Uma lista de seis achata isso e
força a pessoa a redescobrir a matriz de cabeça, chip por chip.

> **Princípio desta passada: um controle por variável.**
>
> Quando os dados têm dois eixos, o controle tem dois eixos. A pessoa
> escolhe *detalhe* e *movimento* separadamente, e o app diz o preço da
> combinação — em vez de a pessoa procurar o preço numa grade de seis.

## 3. A decisão

Dois **controles segmentados** empilhados, rótulo à esquerda, e **uma linha
de resumo** embaixo:

```
QUALIDADE

  Resolução   [  720p  ][ 1080p ][ 1440p ]
  Fluidez     [ 30 fps ][ 60 fps ]

  1080p · 60 fps — ≈12 Mbps por espectador · padrão
```

O que isso troca, item por item contra a seção 1:

- **(a)** Seis caixas viram duas trilhas. A economia é de **forma**, não de
  altura: o bloco cai só de 120px pra 112px, porque os 44px de alvo mínimo
  valem no arquivo inteiro (ver o comentário do seletor `button` no CSS) e
  esta passada não vai abrir uma exceção. O que muda é que as trilhas não
  têm a forma de card, então param de competir com a grade de fontes logo
  acima, e são largas só o quanto o conteúdo pede em vez de ocuparem as três
  colunas inteiras.
- **(b)** Cinco alvos com **um** fragmento de texto cada (`720p`, `1080p`,
  `1440p`, `30 fps`, `60 fps`), em vez de seis alvos com até três. Cinco
  pedaços de texto contra dezoito.
- **(c)** Cada eixo é uma linha só, sempre do mais barato pro mais caro, da
  esquerda pra direita. Não há quebra de linha pra esconder a ordem, e a
  direção "pra direita custa mais" vale nos dois eixos igualmente.

### 3.1 Por que não um slider de seis passos

Foi a alternativa óbvia e ela está errada: **a escada de custo não é
monotônica no bitrate**. `1440p30` custa 10 Mbps e `1080p60` custa 12 — um
slider ordenado por preço colocaria `1440p30` *antes* de `1080p60`, e
"aumentar a qualidade" passaria a **baixar a resolução**. É a mesma
armadilha que `config.js` já documenta na `QUALITY_DEGRADE_CHAIN` (a cadeia
é escrita à mão exatamente porque ordenar por bitrate não serve). Um eixo
único só funciona se existir uma ordem única, e aqui não existe.

### 3.2 O que acontece com as três tags

Somem dos alvos e viram **um** sufixo na linha de resumo, que já existe e já
diz o custo. A linha passa a ser a única coisa que se lê pra saber o preço:

| Preset    | Linha de resumo                                                        |
|-----------|------------------------------------------------------------------------|
| `720p30`  | `≈2,5 Mbps por espectador enquanto você estiver transmitindo · o mais leve` |
| `1080p60` | `≈12 Mbps por espectador enquanto você estiver transmitindo · padrão`  |
| `1440p60` | `≈18 Mbps por espectador enquanto você estiver transmitindo · exige bastante upload` |
| resto     | `≈X Mbps por espectador enquanto você estiver transmitindo`            |

Um número exato para a combinação escolhida é mais honesto que três
adjetivos vagos espalhados pela grade — e é coerente com o resto do app,
que prefere dizer o número a dizer "rápido/lento".

A linha ganha `aria-live="polite"`: quem navega por teclado ou leitor de
tela ouve o preço mudar ao mover a seta, em vez de precisar procurá-lo.

### 3.3 Semântica e teclado

Cada trilha é um `role="radiogroup"` próprio (`aria-labelledby` apontando
pro rótulo visível), com *roving tabindex*: um só segmento tabulável por
grupo, setas movendo dentro do grupo, `Tab` movendo entre os grupos.

**As setas param nas pontas, não dão a volta.** O controle antigo era um
radiogroup de seis com wrap: da última opção a seta voltava pra primeira.
Numa escada ordenada isso é uma mentira — de `1440p` pra direita não existe
"mais", e pular pra `720p` desfaz justamente a ordem que esta passada foi
criada pra estabelecer. `Home`/`End` continuam levando às pontas de uma vez.

### 3.4 Estado selecionado

Um **polegar deslizante** dentro da trilha (`--s4` sobre `--s2`, borda
`--line2`), a mesma leitura de "selecionado por elevação e contraste, nunca
por cor" que a nav de Configurações e as abas do seletor de fontes já usam.
O deslize é `transform: translateX()` puro sobre uma grade de colunas
iguais — sem medir nada em JS, sem animar layout, e desligado sozinho pelo
bloco global de `prefers-reduced-motion`.

## 4. Fronteiras

O que **não** muda:

- A tabela `QUALITY_PRESETS`, os bitrates, `QUALITY_DEGRADE_CHAIN`,
  `audienceSteps`, `qualityForAudience` e `qualityForRelay` — byte a byte.
  Este é um redesenho de **entrada**, não da adaptação.
- O contrato de `ui.picker.open({ quality, onQualityChange })`. `app.js` não
  é tocado: continua recebendo o mesmo objeto de qualidade no mesmo
  callback.
- O significado do controle: continua sendo um **teto**. O app segue
  descendo sozinho por tamanho de sala e telemetria de encode.
- Configurações, chat, lobby, grade da sala, transporte.
