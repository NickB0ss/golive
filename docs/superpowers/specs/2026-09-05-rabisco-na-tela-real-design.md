# Rabisco na tela real, papéis na lousa e a interface que sai da frente — design

Segunda passada sobre a anotação da 0.9.0, depois do primeiro uso de
verdade. Três bugs, quatro decisões de interface e o recurso que tinha
ficado pela metade.

Continuação de `2026-09-04-anotacoes-lideranca-e-chat-rico-design.md` —
onde aquele documento e este discordarem, vale este.

## 1. Os oito pedidos

| # | Pedido | Natureza |
|---|---|---|
| 1 | Não poder mudar temperatura e claridade do fundo | decisão |
| 2 | Círculo de carregamento infinito no botão da câmera | bug |
| 3 | Rabisco tem de aparecer na tela real de quem compartilha | recurso |
| 4 | Só quem assiste rabisca; quem compartilha só apaga tudo | decisão |
| 5 | Cada um apaga só os seus, e o ícone de desfazer está errado | bug + decisão |
| 6 | O liga/desliga do rabisco deve virar um ícone na barra | decisão |
| 7 | Não dá pra escrever texto na tela | bug |
| 8 | O `✕` da barra é irrelevante | decisão |
| 9 | A barra deve sumir com o mouse parado, junto com o resto | decisão |

## 2. O princípio que organiza esta passada

**A lousa tem dois papéis, e eles são o espelho um do outro.** A 0.9.0
tratava todo mundo como o mesmo participante: qualquer um desenhava,
qualquer um apagava tudo, e o dono da tela era só mais um com um botão a
mais. Isso é o que fazia a lousa virar bagunça.

Agora:

- **Quem assiste rabisca.** É a razão de a anotação existir: a sala escreve
  na tela de alguém pra apontar uma coisa.
- **Quem é dono da tela não rabisca nela.** Ele já tem o cursor dele ali; um
  traço dele no meio dos outros só confunde de quem é o quê. O que ele tem é
  **apagar tudo** — o "chega" do dono, que é diferente de apagar os seus.

Essa regra é uma função, `annotate.opAllowed(surfaceId, from, op)`, chamada
de dentro do `apply` do depósito. Não é checagem de interface: `apply` é o
único caminho tanto pro que nasce no app quanto pro que chega pela rede,
então checar ali vale pros dois de uma vez — do mesmo jeito cooperativo do
resto do protocolo (o servidor de sinalização não guarda estado de anotação
nenhum, e não vai passar a guardar). Na 0.9.0 "limpar tudo" era garantido só
pelo `canClearAll` da interface, o que é o mesmo que não ser garantido.

## 3. O rabisco na tela real

### 3.1 O problema

O rabisco só existia **dentro do app**. Quem estava compartilhando não via
nada na tela de verdade — que é justamente onde a conversa está acontecendo.
"Olha ali aquele botão" ficava sem o "ali", a não ser que a pessoa
alt-tabasse pro GoLive, que é o oposto do que ela está fazendo.

### 3.2 A solução: uma janela transparente sobre o monitor

Uma `BrowserWindow` esticada sobre o monitor compartilhado, desenhando as
mesmas ops que o app já recebe. **Três propriedades a fazem funcionar, e
nenhuma é opcional:**

| Propriedade | Chamada | Por quê |
|---|---|---|
| Click-through | `setIgnoreMouseEvents(true)` | O requisito mais duro. Sem isso a janela come **todo** clique da tela de quem compartilha — um overlay que rouba o mouse transforma a tela da pessoa num quadro morto. |
| Sempre por cima | `setAlwaysOnTop(true, 'screen-saver')` | O nível comum fica abaixo de jogo em fullscreen sem borda, que é metade do uso deste app. |
| Fora da captura | `setContentProtection(true)` | Sem isso o overlay entra na própria captura e quem assiste vê cada traço **duas** vezes: o local, no canvas do tile, e o de volta, queimado no vídeo. No Windows 10 2004+ vira `WDA_EXCLUDEFROMCAPTURE`, que some com a janela pro capturador sem pintar nada por cima dela. |

Mais três, menores: `focusable: false` (a janela nunca rouba o Alt+Tab de
quem está compartilhando), `skipTaskbar` e `backgroundThrottling: false` (o
Chromium hibernando o renderer pararia o `requestAnimationFrame` que desenha
o traço).

### 3.3 Só tela inteira

Compartilhamento de **janela** não ganha overlay. O retângulo de uma janela
muda quando a pessoa move, redimensiona ou minimiza, e não há como
acompanhar isso de forma confiável no Windows. Um overlay que erra o lugar é
pior que overlay nenhum: o traço apontaria pro canto errado da tela com toda
a confiança do mundo.

Nesse caso o rabisco fica dentro do app, como sempre foi, e **a pessoa é
avisada** — senão ela fica achando que os amigos rabiscam no vazio.

### 3.4 Qual monitor cobrir

O `<n>` de `screen:<n>:0` **não** é o id de display do Electron — no Windows
é um índice interno do capturador. Quem casa os dois é o campo `display_id`
que o próprio `desktopCapturer` devolve, e que o seletor de tela já usava pra
mostrar a resolução de cada monitor.

O índice `sourceId -> displayId` é montado na própria listagem
(`sources:list`), onde as duas listas já estão na mão: sai de graça e não
inventa correspondência nenhuma. A parte que decide vive em
`src/main/overlay.js`, pura e testada — `main.js` importa `electron` e não
pode ser carregado pelo `node --test`, o mesmo motivo que já tirou
`thumbs.js` de lá.

Monitor que sumiu entre a escolha e o ao vivo (desligado, notebook
desencaixado da dock) devolve `null`: não há o que cobrir, a transmissão
segue sem overlay e a pessoa é avisada.

### 3.5 Coordenadas

Aqui o conteúdo capturado **é** o monitor inteiro, então o retângulo de
conteúdo é a tela toda — sem letterbox pra descontar, ao contrário do tile
dentro do app, onde o `<video>` é `object-fit: contain`. O mesmo `toPx` do
`annotate.js` cai no pixel certo com um retângulo trivial, e é isso que
garante que o traço aterrisse onde quem desenhou viu.

### 3.6 O que trafega

As **ops**, não a lousa. Um traço de 3 segundos manda ~50 mensagens de lote;
mandar a lista inteira a cada ponto seriam 50 cópias de uma lousa de até 400
itens. A janela tem o próprio `annotate.createStore()`, alimentado pelas
mesmas ops — e portanto sujeito à mesma `opAllowed`.

`overlay:start` só resolve **depois** do `loadFile`: `webContents.send` não
enfileira, então um `overlay:load` mandado antes de o script rodar sumiria
com a lousa que já existia (o caso de reconectar sem parar de transmitir).

## 4. A barra de ferramentas

### 4.1 O que sai

- **O lápis do canto do tile** (`.tile-annot-btn`). Era ele que abria a
  barra; escondido no canto, com `opacity: 0` até o hover, ninguém achava.
- **O `✕`**. Desligar é o toggle. Sair sem desligar não precisava de botão.

### 4.2 O que fica

A barra é **sempre visível** na tela anotável (sujeita ao sumiço da seção 5),
e o liga/desliga mora nela. Duas barras, porque são dois papéis:

```
quem assiste   [✎/✎̸] │ [✎] [T] │ [↩] [🗑] │ ●
quem compartilha                    [🗑 Apagar tudo]
```

- O toggle usa o par `.icon-off`/`.icon-on` (lápis / lápis cortado) com
  `aria-pressed` e `aria-label` que troca — estado **anunciado**, não só
  colorido.
- Ele é o **único** botão com preenchimento cheio (`--act`). A ferramenta
  escolhida ganhou um preenchimento discreto: dois cheios lado a lado
  competiam sem dizer qual dos dois manda.
- Com o toggle desligado, caneta e texto ficam **desabilitadas, nunca
  removidas** — a barra não pode mudar de largura ao ligar.
- A barra do dono tem rótulo por extenso. Sozinho, um ícone de lixeira não
  diz o que apaga.

### 4.3 O ícone de desfazer

Era o `rotate-ccw` do Feather — um arco de quase 360°, que lê como
"recarregar". Virou meio círculo com a seta pra trás:

```
<path d="M4 10h10a5 5 0 0 1 0 10h-3"/><polyline points="8 6 4 10 8 14"/>
```

## 5. A interface sai da frente

O sumiço por ociosidade só existia dentro do fullscreen de um tile. Passa a
valer na sala inteira: depois de 3s parado somem o cabeçalho da sala, a
barra de controles e a barra de ferramentas, e o cursor junto.

**Um timer só** pros dois alcances (`body.room-idle` e a `.idle` do tile em
fullscreen) — é uma nocão de "parado". Dois timers dariam duas verdades sobre
a mesma coisa, e a chance de a barra sumir enquanto o nome do tile continua lá.

Três decisões:

1. **Só entra em ocioso com tile na grade.** Numa sala vazia a barra de baixo
   é a única saída ("Compartilhar tela", "Sair da sala"): escondê-la ali
   seria deixar a pessoa numa tela preta sem porta.
2. **`opacity`, nunca `display`/`height`.** Sumir não pode reflowar a grade e
   fazer o vídeo pular de tamanho.
3. **O teclado acorda a interface.** `focusin` e `keydown` entram junto com o
   `mousemove`, e `:focus-within` cancela o sumiço de cada barra: quem anda
   de Tab nunca pousa o foco num botão apagado.

Sair é mais lento que voltar — aparecer responde a um gesto da pessoa e tem
de parecer instantâneo; sumir é o app se retirando.

## 6. Os dois bugs de DOM

### 6.1 `hidden` não funciona em `<svg>`

O botão da câmera nascia com um círculo de carregamento girando pra sempre,
e os três toggles (tela, câmera, pausa) mostravam os dois ícones empilhados.

`hidden` é um atributo de `HTMLElement`. **Não existe em `SVGElement`** —
`'hidden' in SVGElement.prototype === false`. Logo `svg.hidden = x` só criava
uma propriedade solta no objeto, que nunca virava atributo. E o atributo
`hidden` escrito no próprio markup **também não esconde um `<svg>`** no
Chromium: a regra `[hidden]` da folha do navegador não vence o display do
elemento SVG. Verificado com `getComputedStyle`, que devolve `display: block`
com o atributo presente.

Resultado: o `.btn-spinner`, que tem `animation: spin infinite`, estava
visível desde a abertura do app.

A correção é a classe `.hidden` (`display: none !important`), que vale em
qualquer namespace — o mesmo padrão que `setCreateRoomBusy` já usava no botão
de criar sala, e que por isso nunca teve o problema.

Como cinto e suspensório, `getUserMedia` ganhou teto de 15s. Ela normalmente
rejeita quando algo dá errado, mas com driver travado ou webcam presa por
outro app ela não volta nunca — e aí o `finally` que devolve o botão ao
estado real também não roda. A captura que chegar atrasada é parada, pra a
luzinha da webcam não ficar acesa servindo ninguém.

### 6.2 O campo de texto sumia no mesmo clique

O campo era focado dentro do `pointerdown`, e a ação padrão do `mousedown`
seguinte manda o foco pro elemento clicado — o canvas, que não é focável,
então o foco ia pro body. O listener de `blur` chamava `commit()`, que
removia o campo vazio: a caixa abria e sumia antes de dar pra digitar uma
letra.

Três medidas, que cobrem o problema por qualquer um dos caminhos possíveis:

1. `event.preventDefault()` no `pointerdown` do ramo de texto.
2. Focar no quadro seguinte, não dentro do `pointerdown`.
3. Pendurar o listener de `blur` só **depois** do primeiro `focus` de
   verdade. Um blur que chegue antes disso não é a pessoa desistindo — é o
   navegador tirando o foco de um campo que ela ainda nem viu.

## 7. O tema

Personalizar superfície produzia combinações que ninguém quer. Os dois
sliders (temperatura do cinza, claridade do fundo) saem.

O que sobra em Configurações > Aparência é a escolha que faz sentido: uma das
seis predefinições, com a **cor de ação** trocável por cima. A forma do tema
salvo passa a ser `{ preset, act }`; `apply` escreve inline **só** as
variáveis de ação, e as cinco superfícies continuam vindo do bloco CSS do
`data-theme`, que segue sendo a única fonte da verdade delas.

Efeito colateral bem-vindo: trocar de acento não tira mais o cartão da
predefinição do estado marcado. Antes, mexer em qualquer controle de
"Personalizar" significava sair de todos os presets, porque qualquer mexida
mudava as superfícies. Agora não muda — então o cartão fica. Trocar de
predefinição, por outro lado, zera o acento próprio: cada preset foi
desenhado com o seu.

`{ preset:'custom', base:{temp,level}, act }` continua sendo lido, e
`deriveSurfaces` fica onde está: ninguém perde o tema que já tinha salvo em
disco num update.

## 8. O que este documento não faz

- **Não deixa ligar anotação no meio da transmissão.** Continua sendo uma
  propriedade daquela transmissão, decidida no diálogo de compartilhar. O
  toggle da barra é do espectador, e é local: ele arma a caneta de quem
  assiste, não a permissão de quem compartilha.
- **Não põe overlay em compartilhamento de janela.** Ver 3.3.
- **Não muda o protocolo.** `annotate` e `annotate-sync` continuam iguais; o
  que mudou foi quem tem permissão de emitir o quê, e isso é checado no
  cliente que renderiza, como o resto.
- **Não mexe na paleta nem nos tetos** da spec de 2026-09-04 (seções 5.3 e
  5.6).
