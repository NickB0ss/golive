# Chat, aviso de atualização e limpeza da tela cheia — design

Data: 2026-09-15

## Contexto

Sete pedidos do usuário, na ordem em que vieram:

1. O texto "Escreva pra sala…" não está centralizado no aplicativo.
2. "Queria que planejasse melhor a forma que é exibida quando chega
   atualização no aplicativo."
3. "Quero um botão para expandir as reações da tela."
4. "Corrija que algumas coisas estão aparecendo quando abro a tela cheia de
   algum usuário, por exemplo, o texto do botão 'Compartilhar tela' aparece
   quando eu abro a tela cheia de alguém, sendo que era para ele estar
   escondido."
5. "Arrume completamente o chat se ainda não houver arrumado (…) e melhore o
   div de input, tudo."
6. "As notificações dentro da sala, de tela pausada, tela retomada, essas
   coisas, devem aparecer no canto inferior esquerdo." E: "confira que as
   informações da tela devem desaparecer quando o mouse ta parado quando a
   tela está cheia."
7. "Na câmera embaixo, fica aparecendo as reações na mini câmera (…) quero
   que só apareça o botão das reações se tiver em tela cheia." E: "as reações
   que aparecem devem se tornar proporcionais ao tamanho da tela que está
   sendo mostrado para os outros usuários."

8. "Acrescente também a possibilidade de criar uma predefinição
   personalizada, e ficar salvo, e poder mandar para o amigo o código da
   predefinição."

Tudo aqui é interface do renderer. Nenhuma mensagem de sinalização muda,
nenhum campo novo trafega na rede, `server/signaling-core.js` não é tocado —
inclusive o código de tema da frente 8, que é copiado e colado por fora do
app, não transmitido por ele.

## Decisões

1. **A faixa de atualização substitui os outros dois avisos, não se soma a
   eles.** Hoje "há atualização" é dito em três lugares: um botão de 32px /
   fonte 11px espremido no painel de usuário do rodapé da barra lateral, um
   toast quando a busca é manual, e o `#update-banner` fixo no canto inferior
   direito para o progresso. O botão pequeno e o banner do canto saem; fica
   uma faixa só, que troca de estado no lugar. Três lugares dizendo a mesma
   coisa foi exatamente o que gerou o pedido, e o do canto inferior direito é
   o que ninguém vê — o mesmo motivo que a decisão 10 da spec de 2026-09-12
   já tinha registrado para tirar dele o botão de ação.
2. **A faixa mora dentro do `#lobby-view`.** Mesma razão da decisão 9 da spec
   de 2026-09-12: `#lobby-view` e `#room-view` já se alternam por `.hidden`,
   então "não aparece dentro da sala" sai de graça, sem nenhuma lógica de
   "está numa sala? esconde".
3. **Nada de atualização aparece dentro da sala** — escolha explícita do
   usuário, e é o que a decisão registrada no vault
   (`golive - atualização silenciosa sem consentimento nem instalador`) já
   fixava. Preço aceito conscientemente: quem clicar em "Atualizar agora" e
   entrar numa sala no mesmo instante não vê progresso nenhum até voltar ao
   lobby. O download continua, a `update-policy` já o transforma em "pronto",
   e a faixa mostra o estado certo na volta.
4. **Tela cheia se resolve escondendo a casca, não subindo o z-index.** O
   tile em tela cheia tem `z-index: 50`, empatado com `--z-popover` (os
   rótulos do dock) e abaixo do painel de emoji (70), do toast e do banner
   (1000+). Subir o tile só moveria a fila: o próximo elemento com camada
   alta voltaria a vazar. A casca da sala passa a ser escondida de verdade.
5. **`visibility: hidden`, não `display: none`.** `visibility` mata pintura e
   clique de todos os descendentes independentemente do z-index deles, e
   **preserva o layout** — o que importa aqui, porque tirar o dock e o
   cabeçalho do fluxo faria a grade atrás recalcular tamanho de tile
   (`gridlayout`) para um layout que ninguém está vendo.
6. **Reações dimensionadas por JS, não por container query.**
   `container-type` no `.tile` funcionaria (o menu do tile e o seletor de PiP
   moram no `document.body`, então não seriam capturados), mas traz
   `contain: layout` e um contexto de empilhamento novo em cima de um
   elemento com sete camadas internas — risco desproporcional para um emoji
   que vive 1,4 s. `spawnReactionPop` já decide a posição horizontal em JS;
   decidir o tamanho ali é uma linha, sem efeito colateral de layout.
7. **Um critério só para a tira de miniaturas.** O cromo some da miniatura e
   volta ao maximizar — vale para reação, selo de audiência, barra de rabisco
   e botão de parar de assistir, não só para a reação. Uma regra por elemento
   seria quatro verdades sobre a mesma pergunta ("cabe em 104px?").
8. **Ids preservados onde o JS os usa.** `#btn-update-available` continua com
   esse id mesmo mudando de lugar e de rótulo — a regra do projeto (spec
   2026-09-15, "Contrato") é mover pode, renomear não. Os ids do
   `#update-banner` desaparecem junto com o elemento, e todas as referências
   a eles em `app.js` saem na mesma mudança.
9. **O código de tema é copiado e colado por fora do app, não transmitido por
   ele.** Nada de mensagem nova de sinalização, nada de "mandar tema pra
   sala". A pessoa copia um texto e manda pelo Discord, que é onde ela já
   está. Isso mantém a promessa de que nenhuma frente desta spec toca no
   protocolo, e evita o pior caso óbvio: alguém empurrar tema para a tela dos
   outros no meio de uma transmissão.
10. **A trava semântica sobrevive por construção, não por checagem.** O
    código carrega só temperatura, claridade e cor de ação. `--live`,
    `--warn` e `--danger` não têm como ser escritos por ele — não existe
    campo. É a mesma garantia que a spec de 2026-09-03 impôs no CSS, agora
    herdada de graça pelo formato do código.
11. **O tema personalizado reaproveita a forma legada, sem migração.** Usar
    um tema salvo grava `{ preset: 'custom', base, act }` em `config.theme`
    — exatamente a forma que `tokensFor` e `config.loadTheme` já leem e que
    a spec de 2026-09-03 deixou viva de propósito. Nenhum config existente
    precisa ser convertido, e quem tiver um `custom` legado em disco
    simplesmente volta a ter controle sobre ele.

## Descartado

- **Modal de atualização ao voltar pro lobby.** Interrompe quem não pediu
  nada; contraria o "nada interrompe quem está usando" que o fluxo inteiro de
  atualização já segue.
- **Manter o `#update-banner` só para o progresso.** Reintroduziria o canto
  inferior direito que a decisão 1 remove, e apareceria dentro da sala — onde
  a decisão 3 diz que nada aparece.
- **Reação só em tela cheia em todo tile.** Na prática desliga o recurso: a
  maior parte do tempo de uso é na grade, e obrigar a maximizar antes de
  reagir custa mais que a distração que evita.
- **Bolhas de mensagem por autor no chat, destaque de menção, editar e apagar
  mensagem.** Nada disso foi pedido e o chat não tem apagar por decisão
  anterior (spec 2026-09-04, seção 6.1).
- **Empurrar o `.tile.fullscreen` para uma camada acima de tudo.** Ver
  decisão 4.
- **Mandar o tema pela sala** ("aplicar meu tema em todo mundo", ou um botão
  de enviar o código no chat). Vira uma mensagem nova de protocolo e um jeito
  de mexer na tela dos outros no meio de uma transmissão. Ver decisão 9.
- **Base64 no código de tema.** Diferencia maiúscula de minúscula e usa `+`,
  `/` e `=` — ruim para um código que vai ser colado no Discord e às vezes
  ditado em voz alta. Ver 8.3.
- **Carregar o nome dentro do código.** Faria o código variar de tamanho e
  obrigaria o app a aceitar texto arbitrário de fora como rótulo de
  interface, por um ganho pequeno: quem importa está justamente escolhendo
  adotar o tema, e nomear é parte disso.
- **Tema por sala ou por perfil sincronizado.** Aparência é local à máquina;
  nada disso foi pedido.

---

## Frente 1 — Chat

### 1.1 Caixa de escrever (`.chat-compose`)

**O desalinhamento (pedido 1).** `.chat-compose` alinha por baixo
(`align-items: flex-end`), porque a caixa cresce para cima quando a mensagem
passa de uma linha. O errado não é o alinhamento: é a caixa do `<textarea>`
ser mais baixa que a dos botões. Com `rows="1"`, `font-size: 12.5px` e
`line-height: 1.4`, o textarea mede ~21,5px (17,5 de linha + 2+2 de padding
padrão do navegador) contra 28px dos `.chat-compose-btn`. Coladas pela base,
o texto fica ~3px abaixo do centro dos ícones.

Correção: `padding: 5px 0; min-height: 28px` no textarea (17,5 + 10 = 27,5 ≈
28). Duas caixas de mesma altura alinhadas pela base ficam centralizadas
entre si. Uma regra, sem tocar no `flex`.

**Botão de enviar (novo).** Hoje só existe Enter — nem afordância, nem alvo
de clique. Entra um `#btn-chat-send` depois do botão de emoji, ícone de avião
no mesmo traço Lucide dos outros, `aria-label="Enviar mensagem"`. Nasce
apagado (`--tx3`, `disabled`) e acende em `--act` quando há texto ou anexo.
Enter continua funcionando igual.

**A caixa não cresce (achado durante o planejamento).** O `max-height: 88px`
do `.chat-compose textarea` é **regra morta**: o campo é `rows="1"` e nada em
JS ajusta a altura, então ele nunca passa de uma linha — uma mensagem longa
vira uma fresta que rola por dentro, sem que a pessoa consiga ver o que
escreveu. O `align-items: flex-end` da caixa, que existe para acomodar o
crescimento, também nunca faz efeito hoje.

Entra o auto-resize que estava faltando: a cada `input`, `height` volta a
`auto` e vai para `scrollHeight`, limitado pelo `max-height` que já está lá.
Isso torna o `flex-end` verdadeiro e dá sentido ao `max-height`.

**E aí a pílula passa a deformar.** Com a caixa crescendo de verdade, o
`border-radius: var(--r-full)` da sala vira cápsula de 88px e os cantos comem
o texto. Por isso o raio cai para `var(--r-md)` quando há mais de uma linha,
por uma classe `.is-multiline` que o próprio auto-resize pendura. As duas
mudanças andam juntas: sem o auto-resize a segunda não teria motivo, e com
ele ela é obrigatória.

**O contador que empurra.** `#chat-input-count` é `flex: none` dentro do
flex: quando aparece, rouba largura do textarea e a caixa pula. Sai do fluxo
— `position: absolute`, ancorado acima da borda direita da caixa — e só
aparece dos 450 caracteres em diante, virando `--warn` no limite.

**Colar acima de 500.** Hoje o `maxlength` corta calado. O aviso passa a ser
o próprio contador virando `--warn` ao bater no limite — e ele fica logo
acima do campo, exatamente onde a pessoa está olhando. Sem toast: `showToast`
mora em `app.js` e não em `ui.js`, e abrir uma dependência nova entre os dois
módulos por um aviso deste tamanho não se paga.

**Descoberta do Shift+Enter.** `aria-describedby` no campo apontando para uma
dica visualmente escondida ("Enter envia, Shift+Enter quebra linha").

**Rolagem própria.** `overflow-y: auto` explícito no textarea, para a barra
seguir o mesmo estilo da lista quando a mensagem passa dos 88px.

### 1.2 Lista de mensagens (`.chat-messages`)

**O autoscroll sequestrado.** `appendEntry` faz
`chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight` em toda entrada
(`ui.js:2354`). Quem subiu para reler é arrancado de volta pela próxima
mensagem. Passa a descer só se a pessoa já estava a ≤48px do fim; se não
estava, aparece um botão `#chat-jump-new` ancorado no rodapé da lista
("↓ Novas mensagens") que desce ao clique e some ao chegar no fim.
`setHistory` continua descendo sempre — ali a lista está sendo montada do
zero.

**Ritmo.** `gap: 2px` uniforme não distingue linha do mesmo autor de bloco de
autor novo. Passa a 8px entre blocos (`.chat-line:not(.grouped)` ganha
`margin-top`) e 2px dentro do bloco.

**Hora nas agrupadas.** A calha do avatar (28px) fica vazia nas linhas
agrupadas. Passa a receber a hora em `--tx3`, alinhada à direita, visível só
no `:hover`/`:focus-within` da linha. Custo de layout zero — a calha já está
reservada.

**Separador de dia.** Quando a data muda entre duas entradas, entra uma linha
`.chat-day` ("Hoje", "Ontem", ou "14 de setembro"). `ui.js` guarda um
`lastChatDayKey` ao lado do `lastChatAuthorId` que já existe; `setHistory`
zera os dois.

**Estado vazio.** Lista sem nenhuma entrada mostra "Ninguém falou ainda." em
`--tx3`, centralizado.

---

## Frente 2 — Faixa de atualização no lobby

### Marcação

Primeiro filho de `.lobby-main`, acima de `.lobby-rooms`:

```html
<section id="update-bar" class="update-bar hidden" role="status">
  <svg class="update-bar-icon" …><!-- seta de download, traço Lucide --></svg>
  <div class="update-bar-text">
    <strong id="update-bar-title"></strong>
    <span id="update-bar-sub"></span>
  </div>
  <div id="update-bar-progress" class="update-bar-progress hidden">
    <div id="update-bar-fill" class="update-bar-fill"></div>
  </div>
  <button id="btn-update-available" class="primary update-bar-action" type="button"></button>
</section>
```

`#btn-update-available` mantém o id (decisão 8) e perde o `.update-dot` e o
`.small`. O `#update-banner` inteiro sai do `index.html`, junto de
`#update-banner-text`, `#update-progress` e `#update-progress-fill`.

### Estados

| Estado | Título | Subtítulo | Barra | Botão |
|---|---|---|---|---|
| disponível | "Atualização 0.17.0 disponível" | "Reinicia rápido e volta sozinho." | — | "Atualizar agora" |
| baixando | "Baixando atualização…" | "0.17.0 — 42%" | determinada | apagado (disabled) |
| pronta | "Atualização pronta" | "0.17.0 — instala ao reiniciar." | — | "Reiniciar e instalar" |

A faixa some (`.hidden`) em `not-available` e nos erros, que continuam só
como toast — os textos de `UPDATE_ERROR_TEXT` não mudam.

### Cor

`--act` no botão, nunca `--live` (regra do vault: o acento é reservado a
"alguém está ao vivo"). A barra de progresso usa `--tx` sobre `--s3`, igual à
barra que sai. O `.update-dot` em `--warn` desaparece junto com o botão
antigo — não há mais o que sinalizar por pontinho quando a faixa inteira é o
sinal. Isso também evita o problema de contraste de `--warn` no tema claro
registrado no vault.

### `app.js`

`showUpdateBanner` e `showUpdateAvailable`/`hideUpdateAvailable` viram uma
função só, `renderUpdateBar(estado, { version, progress })`. O `switch` de
`onUpdateStatus` fica com a mesma forma; só muda para onde escreve.
`#btn-check-update` e os toasts de busca manual não mudam.

---

## Frente 3 — Reações recolhidas num botão

`.tile-react-bar` nasce fechada: um botão redondo de rosto sorridente no
canto inferior direito do tile, `aria-expanded="false"`. Clicar abre a
fileira dos seis emojis deslizando para a esquerda.

- Enquanto fechada, os seis botões ficam `inert` — não recebem foco de Tab
  nem clique, e somem do leitor de tela.
- Fecha com `Escape`, clique fora, ou ~3s sem uso. **Não** fecha no primeiro
  emoji: o limitador de rajada de `reactions.js` existe justamente porque
  mandar vários seguidos é o uso normal.
- A animação de abrir é `transform`/`opacity` (nunca `width`), 200ms, cortada
  por `prefers-reduced-motion` pelo bloco global que já existe no topo do
  CSS.

`reactions.js` não muda: a lista fechada de seis continua a mesma, e o
protocolo também.

---

## Frente 4 — Tela cheia

### 4.1 O vazamento (pedido 4)

Hoje a única coisa escondida em tela cheia é a barra de título
(`body:has(.tile.fullscreen) .titlebar`). A sala inteira continua desenhada
embaixo, e o tile tem `z-index: 50` — empatado com os rótulos do dock
(`--z-popover: 50`, e eles vêm depois no DOM, então ganham o empate) e abaixo
do painel de emoji (70), do toast (1001) e do banner (1000). O texto
"Compartilhar tela" é o `.btn-label` do botão principal, que é
`position: static; opacity: 1` — ele é rótulo de verdade, não dica.

Correção (decisões 4 e 5):

```css
body:has(.tile.fullscreen) .stage-header,
body:has(.tile.fullscreen) .control-bar,
body:has(.tile.fullscreen) .room-side { visibility: hidden; }
```

Junto: `toggleTileFullscreen` fecha o painel de emoji ao entrar (ele é
`position: fixed` no `body`, fora do alcance do seletor acima). O
`#update-banner` sumindo na frente 2 elimina o outro vazamento de camada
alta. O toast continua por cima de propósito — é informação transitória, e a
frente 5 o coloca no canto certo.

### 4.2 Auditoria da ociosidade (pedido 6)

O mecanismo existente está correto e não muda: um timer só de 3s (`IDLE_MS`,
`ui.js:119`) alimenta `body.room-idle` e `.tile.idle`, reagindo a `mousemove`,
`mousedown`, `keydown` e `focusin`, e `canGoIdle()` impede sumiço numa sala
vazia. Conferido item a item:

**Some hoje, corretamente:** nome do tile, avatar, selo de tipo, selo de
audiência, botão de tela cheia, botão de parar de assistir, botões das
miniaturas PiP, botão de adicionar PiP, cursor — e, por `body.room-idle`, o
cabeçalho da sala, o dock e a barra de rabisco.

**Não some e passa a sumir:** a barra de reação. Ela nunca teve regra de
ociosidade; nasce com uma nesta spec, na mesma forma dos outros
(`opacity: 0; pointer-events: none`).

**Fica de propósito, e por quê:** as miniaturas PiP, o canvas de rabisco e os
emojis que sobem (`.tile-react-pops`) são conteúdo, não cromo — uma reação
que chega com o mouse parado precisa aparecer, ou o recurso só funciona para
quem está mexendo no mouse. O véu de pausa (`.tile-paused`) e o card "está ao
vivo" (`.tile-gate`) são estado — escondê-los deixaria uma tela preta sem
explicação, que é pior que o cromo.

Note a assimetria deliberada: o **botão** de reagir some (é cromo), os
**emojis** que chegam ficam (são conteúdo). É a mesma divisão que separa a
barra de rabisco do rabisco desenhado.

---

## Frente 5 — Notificações no canto inferior esquerdo

`#toast` é `right: 16px; bottom: 16px`. Dentro da sala isso cai **em cima da
caixa de escrever do chat** — é ali que "Transmissão pausada", "Transmissão
retomada", "Fonte trocada sem interromper a transmissão" e os avisos de
moderação aparecem hoje.

```css
body:has(#room-view:not(.hidden)) .toast { left: 16px; right: auto; }
```

No lobby continua à direita. Em tela cheia o canto inferior esquerdo é o mais
vazio do vídeo: o dock é central, o selo de audiência fica em cima à esquerda
e os botões em cima à direita. O toast some sozinho em 4s, então não entra na
regra de ociosidade — some por conta própria antes.

A animação de entrada (`translateY(12px)` + `@starting-style`) continua
valendo; só o eixo horizontal muda.

---

## Frente 6 — Tira de miniaturas limpa

As miniaturas do layout `spotlight` ganham `data-slot="strip"` em `ui.js` e
ficam com 104–148px de altura. Nelas o cromo não cabe: quatro overlays
disputam a mesma área de um selo.

```css
.grid-strip .tile:not(.fullscreen) .tile-react-bar,
.grid-strip .tile:not(.fullscreen) .tile-watchers,
.grid-strip .tile:not(.fullscreen) .tile-annot-bar,
.grid-strip .tile:not(.fullscreen) .tile-unwatch-btn { display: none; }
```

`:not(.fullscreen)` é obrigatório e é a razão de a regra ser escrita assim: a
câmera da tira também vira tela cheia, e ao maximizar tudo volta — que é
exatamente o pedido. A miniatura fica com o rótulo do nome e o botão de tela
cheia, que é o que dá para fazer com ela.

`display: none` aqui (e não `visibility`) porque não há layout a preservar:
são overlays absolutos sobre o vídeo.

O que sai é o **botão** de reagir, não a reação: `.tile-react-pops` continua
na miniatura, então um emoji mandado por outra pessoa ainda sobe ali — em
tamanho proporcional, pela frente 7. Some a forma de reagir naquele tile,
não a de ver que reagiram.

---

## Frente 7 — Reações proporcionais ao tile

`.tile-react-pop` é `font-size: clamp(24px, 5vw, 48px)` hoje. `vw` é a
largura da **janela**, não do tile: numa grade de seis o emoji sai
desproporcional, e na tira ele é maior que a miniatura inteira.

`spawnReactionPop` passa a medir o tile e escrever o tamanho junto da posição
horizontal que já escreve:

```js
const w = tile.clientWidth || 0;
if (w) el.style.fontSize = `${Math.round(Math.min(72, Math.max(14, w * 0.12)))}px`;
```

12% da largura do tile, entre 14 e 72px. O `clamp()` do CSS fica como
fallback para quando a medida vier 0 (tile ainda não medido). Redimensionar a
janela no meio da animação não reajusta o emoji — irrelevante: ele vive 1,4 s
(`reactions.TTL_MS`).

Aproximação assumida: mede-se a caixa do tile, não a área útil do vídeo
dentro dela. Quando a proporção da fonte difere de 16/9 o vídeo fica com
tarjas e o emoji é dimensionado pela caixa, não pela imagem. A diferença é
pequena e a alternativa (ler `videoWidth`/`videoHeight` e recalcular a caixa
contida) custa mais do que entrega.

---

## Frente 8 — Tema personalizado, salvo e compartilhável

### 8.1 O que já existe

O motor do tema personalizado está inteiro em `theme.js` e testado. O que foi
removido numa passada anterior foram os **controles**, não a capacidade:

- `deriveSurfaces({temp, level})` deriva as dez superfícies a partir de dois
  números de 0 a 1 (temperatura e claridade).
- `tokensFor` já aceita a forma `{ preset: 'custom', base: {temp, level}, act }`
  e a documenta como "config já salvo em disco tem, e continua abrindo igual".
- `config.loadTheme` já valida essa forma, com faixa e tipo.
- `validate()` já devolve `{ ok, failures, nearestAct }` e a interface já sabe
  desenhar o aviso com o botão "usar #xxxxxx".

Ou seja: reexpor os controles é ligar de volta um caminho vivo, não escrever
um motor. O que é genuinamente novo é **guardar vários** e **compartilhar**.

### 8.2 Guardar vários (`config.themes`)

Hoje o config guarda **um** tema (`config.theme`). Entra uma lista ao lado:

```js
themes: [ { id, name, base: { temp, level }, act } ]
```

- `id`: string curta gerada localmente, só para casar o cartão com a entrada.
- `name`: rótulo dado pela pessoa, 1–24 caracteres depois de aparado.
- Teto de **12** temas salvos. Um arquivo de config precisa ter tamanho
  limitado, e doze cartões já enchem a aba.
- `config.js` ganha `loadCustomThemes(incoming)` no mesmo estilo do
  `loadTheme` que já existe: valida forma, tipo e faixa, descarta entrada
  torta **item a item** (uma entrada corrompida não derruba a lista inteira),
  corta no teto, e cai em `[]` sem lançar.
- `config.theme` não muda de forma. Usar um tema salvo grava
  `{ preset: 'custom', base, act }` ali — exatamente a forma legada que
  `tokensFor` já lê. Nada de migração.

### 8.3 O código compartilhável

Módulo puro novo, `src/renderer/themecode.js`, no padrão de `reactions.js`:
sem DOM, sem rede, `encode(tema) -> string` e `decode(texto) -> tema | null`.

**Carga útil: 7 bytes.**

| byte | conteúdo |
|---|---|
| 0 | versão do formato |
| 1 | `temp` quantizado em 0–255 |
| 2 | `level` quantizado em 0–255 |
| 3–5 | `act` (r, g, b) |
| 6 | checksum dos seis anteriores |

**Alfabeto: base32 de Crockford**, que dá 12 caracteres, apresentados como
`GL-XXXX-XXXX-XXXX`. Escolhido em cima de base64 porque o código vai ser
colado no Discord e às vezes **ditado**: Crockford não diferencia maiúscula
de minúscula, não usa `+`, `/` nem `=`, e remove `I`, `L`, `O` e `U` do
alfabeto justamente para não confundir com `1`, `0` e com palavrão acidental.
Na decodificação, `I` e `L` são lidos como `1` e `O` como `0`, então quem
digitou errado por confusão visual ainda acerta.

**O checksum não é segurança, é ergonomia:** rejeita um caractere trocado
antes de a pessoa ver um tema aleatório e achar que o amigo tem péssimo
gosto. A **versão** permite mudar o formato depois sem aplicar um código
velho com significado novo.

**O nome não viaja no código.** Duas razões: manter o código curto e de
tamanho fixo (ditável, cabe numa linha), e não deixar o app aceitar texto
arbitrário de fora como rótulo de interface. Quem importa dá o nome, com o
campo já preenchido com "Tema importado".

### 8.4 O que o código NÃO pode fazer

Esta é a decisão que importa. O código carrega **três coisas**: `temp`,
`level` e `act`. Ele não tem como escrever `--live`, `--warn`, `--danger` nem
nenhum outro token semântico — a trava da spec de 2026-09-03 continua valendo
**por construção**, não por checagem que alguém possa esquecer de rodar.

Os três campos que ele carrega são tratados como entrada não confiável:
`temp` e `level` passam pelo `clamp01` que `deriveSurfaces` já aplica, e
`act` sai de três bytes, então é hex válido por construção. Um código de
tamanho errado, com caractere fora do alfabeto, checksum quebrado ou versão
desconhecida devolve `null` — `decode` nunca lança e nunca devolve meio tema.

Na importação, `validate()` roda e, se reprovar contraste ou distância de
matiz, mostra o mesmo aviso com o botão "usar #xxxxxx" que os controles já
mostram. Não recusa: o app inteiro é aplica-e-avisa, e recusar o tema de um
amigo sem oferecer o conserto seria pior.

### 8.5 Interface (aba Aparência)

Abaixo da grade de cartões fixos, uma seção "Meus temas":

- Os temas salvos como cartões, no mesmo desenho dos fixos, cada um com um
  menu `⋮`: **Renomear**, **Copiar código**, **Apagar** (com a confirmação
  que o app já tem).
- **"Criar tema"** abre os dois controles de superfície (temperatura,
  claridade) junto do seletor de acento que já existe, com prévia ao vivo —
  que é o comportamento que `applyCustomThemeFromControls` já tem, aplicando
  a cada `input` e não só a cada `change`, porque arrastar e ver é o único
  jeito de avaliar um tema (spec 2026-09-03, seção 5.6). Salvar pede o nome.
- **"Usar código"** abre um campo de colar. Ao colar um código válido, o tema
  é aplicado na hora como prévia e aparece "Salvar como…"; um código inválido
  mostra "Esse código não parece certo." e não muda nada na tela.
- Copiar um código usa a confirmação no lugar (`.copied-flash`, motion #4)
  que o endereço da sala já usa — o botão vira "Copiado" onde o dedo está, em
  vez de um toast no canto.

Trocar para um cartão fixo continua zerando o acento próprio, como hoje.

### 8.6 Testes

`src/renderer/themecode.test.js`, `node --test`, sem DOM:

- ida e volta preserva `act` exatamente e `temp`/`level` dentro do erro de
  quantização (≤ 1/255);
- checksum trocado, versão desconhecida, tamanho errado e caractere fora do
  alfabeto devolvem `null`;
- `I`/`L`/`O` são lidos como `1`/`1`/`0`;
- minúsculas e hifens em posição diferente decodificam igual;
- valores fora de faixa na entrada de `encode` são clampados, não lançam.

`config.test.js` ganha: lista ausente vira `[]`; entrada torta é descartada
item a item sem derrubar as boas; o teto de 12 corta; nome fora de 1–24 é
rejeitado.

---

## Testes

`src/renderer/css-rules.test.js` ganha três testes, no mesmo estilo dos que
já existem (leitura do `style.css` com o helper `declarations()`):

1. **Todo overlay do tile some com o mouse parado.** Varre os seletores
   `.tile-*` com `position: absolute` e exige que cada um seja escondido por
   `.tile.fullscreen.idle` **ou** por `body.room-idle` — as duas são
   alcances do mesmo timer, e a barra de rabisco usa a segunda. É o que
   impede a próxima barra pendurada no tile de nascer sem sumiço — a lição já
   registrada no vault de que regra de design sem teste volta a ser quebrada.

   A lista de exceções fica declarada e comentada no teste, em três grupos,
   porque cada um é dispensado por um motivo diferente:

   | Exceção | Por que não some |
   |---|---|
   | `.tile-annot-canvas`, `.tile-react-pops`, `.tile-react-pop`, `.pip-strip` | conteúdo, não cromo — um rabisco ou uma reação que chega com o mouse parado **precisa** aparecer |
   | `.tile-paused`, `.tile-paused-shot`, `.tile-gate` | estado — sumir deixaria uma tela preta sem explicação |
   | `.tile-watchers-panel` | descendente de `.tile-watchers`, que já tem a regra; some junto por herança de `opacity` |
2. **A casca da sala é escondida em tela cheia.** Exige as três regras de
   `visibility: hidden` sob `body:has(.tile.fullscreen)`.
3. **O banner do canto não voltou.** Exige que `#update-banner` não exista
   mais no CSS nem no `index.html`.

`src/renderer/reactions.test.js` não muda (nada da lógica pura muda).

Validação manual, porque é o que um teste de CSS não alcança: abrir tela
cheia e conferir que nenhum rótulo do dock aparece; parar o mouse 3s e
conferir que some tudo menos vídeo, PiP e véu de pausa; pausar e retomar a
transmissão e ver o aviso nascer no canto inferior esquerdo, longe do chat;
rolar o chat para cima e receber mensagem sem ser arrancado do lugar.

## Fora de escopo

Assinatura de código, canal de release, changelog no app (herdado da spec de
2026-09-12). Qualquer mudança em `server/`, no protocolo de sinalização ou na
trava de versão de sala. A lista fechada de seis emojis de reação permanece
como está — expandi-la seria mexer no que trafega na rede.
