# Relatório 2 — Interface, Layout e Experiência

Auditoria de leitura + medição real. Tudo que está marcado com número foi
conferido renderizando `index.html` no Chromium (Playwright, `/opt/pw-browsers`)
e medindo o DOM, ou calculado com a própria `theme.contrast()` do projeto.
O que não deu pra confirmar está marcado **[não verificado]**.

## Resumo executivo

A interface está bem acima da média pra um app de uma pessoa só: cor é 100%
tokenizada (795 `var()` contra 4 literais fora de `:root`, e há teste que
segura isso), o foco de teclado existe, a tablist da coluna direita tem roving
tabindex e setas, o estado ocioso pensa em `:focus-within`, e quase toda lista
tem estado vazio. O CSS é dos mais bem comentados que se vê.

O problema não é falta de cuidado — é **sedimentação**. O `style.css` cresceu
por camadas empilhadas no fim do arquivo em vez de edição no lugar: 53
seletores estão escritos mais de uma vez (`.control-bar` ×4, `.lobby`,
`.stage-header`, `.room-side`, `.grid-main` ×3). Sobrou CSS de um lobby que não
existe mais — e uma media query dele ainda dispara e **quebra o lobby de hoje**.

Os três piores, em ordem:

1. **O lobby quebra em qualquer janela ≤1040px** — inclusive no `minWidth: 900`
   que o próprio app define. Os dois botões principais viram duas colunas
   espremidas numa barra lateral de 232px, "Entrar por endereço" quebra em 3
   linhas dentro de um botão de altura fixa 44px, e o par **vaza 38px pra fora
   da barra lateral**, por cima da borda, na coluna das salas.
2. **A lista de pessoas mostra 4 de 20.** `max-height: 176px` num painel de
   704px: 888px de conteúdo numa janela de 176px, com meia tela preta embaixo.
   O cabeçalho ao lado diz "Pessoas · 20".
3. **Os dois botões mais usados da sala perdem o anel de foco justamente quando
   estão ligados.** "Parar de compartilhar" e "Desligar câmera" ficam com
   `outline: 0` e sem anel — zero indicação de teclado.

**Qual é o tamanho mínimo de janela em que a interface funciona?** Hoje:
**1041×600**. Abaixo disso o lobby está quebrado. A sala sobrevive em 900×600
(medido). `src/main.js:354-355` promete 900×600 — a promessa não se cumpre.
Apagando 19 linhas de CSS morto (A1) o mínimo passa a ser os 900×600 anunciados.

Sobre o **F1** do `STATUS.md` ("acessibilidade fora de escopo por falta de
harness"): **não se sustenta mais**. O Playwright com Chromium já está neste
ambiente, e foi com ele que os itens A1, A2, A3 e A4 foram confirmados em
minutos. Mais: `aria-live` nos avisos (A8) e o anel de foco (A3) são consertos
de 1 a 3 linhas que não precisam de harness nenhum.

---

## A. Defeitos

### A1 — Lobby vaza pra fora da barra lateral em janela ≤1040px
**`src/renderer/style.css:734-752`** (a regra culpada é a `:748`)

**O que acontece na tela.** `@media (max-width: 1040px)` contém
`.lobby-actions { display: grid; grid-template-columns: 1fr 1fr; }`. Essa media
query foi escrita pro lobby ANTERIOR (o de duas faixas com `.lobby-body`); o
lobby de hoje é a barra lateral de `style.css:2715-2739`. Das 7 regras do
bloco, 6 miram classes que não existem mais no HTML — só a `.lobby-actions`
ainda pega, e ela vence a `:593` (`display: flex; flex-direction: column`) por
ordem de origem, e a `:2732` só mexe em `margin`.

Medido em 900×700: `.lobby-actions` fica com caixa de 199px e conteúdo de
237px (99px + 130px + 8px de gap). "Entrar por endereço" recebe 130px, quebra
em 3 linhas e pede 47px de altura dentro de um botão travado em 44px
(`style.css:2733`). A barra lateral inteira (`.lobby-sidebar`, sem `overflow`)
estoura 22px e os botões atravessam a borda direita, por cima da coluna das
salas. Confirmado por screenshot.

**Como reproduzir.** Abrir o app → arrastar a borda da janela até ≤1040px de
largura (ou já abrir em 900, o mínimo permitido) → olhar os dois botões no topo
da barra lateral.

**Conserto.** Apagar as linhas 734-752 inteiras. As outras 6 regras do bloco já
são inertes: `.lobby-bounds`, `.lobby-body`, `.lobby-title`, `.lobby-lede` são
classes mortas; `.user-panel-name { max-width: 120px }` perde pra `:2737`
(especificidade maior); `.lobby-rooms`/`.room-list` já são cobertas por `:2740`
e `:2749`. Se quiser manter algo pra janela estreita, o bloco certo é o
`@media (max-width: 900px)` da `:2833`, que já ajusta `.lobby`.

Custo baixo (19 linhas apagadas) · Risco baixo (nada mais depende delas) ·
**Prioridade P0** — é o mínimo de janela que o app anuncia.

### A2 — A lista de pessoas mostra 4 de 20 e deixa meia tela preta
**`src/renderer/style.css:895-898`**

**O que acontece na tela.** `.peer-list, .banned-list { max-height: 176px }`
com linhas de 44px (`:899-903`) = 4 nomes visíveis. O `#people-panel` que a
contém tem `overflow-y: auto` (`:2815`) e mede 704px em 1280×800 / 504px em
900×600. Medido com 20 pessoas: `scrollHeight` 888px dentro de `clientHeight`
176px, e 528px de preto embaixo. A barra de rolagem é fina e translúcida
(`:406-416`), então nem sinaliza bem que tem mais gente. É rolagem aninhada
dentro de rolagem — as duas brigam.

**Como reproduzir.** Entrar numa sala com mais de 4 pessoas → aba "Pessoas".
O contador da aba diz o número certo; a lista mostra 4.

**Conserto.** Tirar o `max-height: 176px` e deixar `.peer-list` usar a altura
do painel (`flex: 1; min-height: 0`), com o `overflow-y: auto` só no
`.peer-list` (tirando do `#people-panel`, `:2815`, pra não haver duas rolagens).
`.banned-list` pode manter um teto próprio, porque ela divide o painel — mas
aí o teto tem de ser dela, não das duas.

Custo baixo · Risco baixo · **Prioridade P1**

### A3 — Botão ligado perde o anel de foco por inteiro
**`src/renderer/style.css:312`** contra **`:816`**, **`:1857`**, **`:1998`**

**O que acontece na tela.** A regra de foco é
`:where(button, …):focus-visible { outline: 0; box-shadow: var(--ring); }`.
`:where()` tem especificidade **zero**, então a regra vale (0,1,0) — qualquer
classe de estado que escreva `box-shadow` ganha dela. E como ela também zera o
`outline`, o que sobra é nada. Três casos confirmados no navegador:

| elemento | linha | `box-shadow` com foco | `outline` |
|---|---|---|---|
| `#btn-toggle-share` / `#btn-toggle-camera` com `.is-on` | `:816` | só o `inset 0 0 0 1px` | `0px none` |
| `.source-card.selected` (diálogo de compartilhar) | `:1998` | só o anel branco de seleção | `0px` |
| `.theme-preset-card.active` (Aparência) | `:1857` | só o anel de 1px de `--act` | `0px` |

O pior é o primeiro: enquanto você está transmitindo, "Parar de compartilhar" é
o botão que mais importa, e é exatamente nesse estado que ele fica sem foco.

**Como reproduzir.** Entrar numa sala → clicar em "Compartilhar tela" → Tab até
o botão. Nada muda visualmente.

**Conserto.** Trocar `:where(...)` por uma lista normal (`button:focus-visible,
.icon-btn-inline:focus-visible, …`), que já sobe pra (0,2,0) e empata/vence por
ordem — ou, mais robusto, usar `outline: 2px solid var(--act); outline-offset:
2px` em vez de `box-shadow`, já que `outline` não colide com `box-shadow`
nenhum. O `.sound-check button:focus-visible` (`:2930`) já usa esse padrão —
vale uniformizar por ele.

Custo baixo · Risco baixo · **Prioridade P1**

### A4 — O toast cobre o campo de chat (e cobre o banner de atualização)
**`src/renderer/style.css:433-437`** e **`:463`**

**O que acontece na tela.** `.update-banner, .toast { position: fixed; right:
16px; bottom: 16px; }`. Na sala, esse canto é ocupado pela `.room-side` (320px,
`:2808`) e pelo `.chat-compose`, que fica no rodapé dela (`:2775`, `margin-top:
auto`). Sobreposições medidas, iguais em 1280×800 e 900×600:

- toast × `.chat-compose`: **220×20px**
- toast × `#chat-input`: 140×10px
- toast × `#btn-chat-attach` ("Enviar imagem"): 28×10px
- toast × `#btn-chat-emoji`: 28×10px
- toast × `#update-banner`: **202×41px** — o toast tapa o banner inteiro,
  inclusive a barra de progresso do download
- banner × `.chat-compose`: 193×32px

O comentário da `:461-463` já sabe que os dois competem, mas a solução foi
`z-index` — e eles estão no mesmo canto, então o de cima simplesmente apaga o
de baixo. Durante o download de uma atualização, qualquer toast some com o
progresso.

**Como reproduzir.** Entrar numa sala → disparar qualquer toast (copiar
endereço, buscar atualização, alguém vira líder) → tentar clicar no clipe ou no
emoji do chat nos ~4s seguintes.

**Conserto.** Duas coisas: (1) empilhar de verdade — pôr os dois num
`.notify-stack { position: fixed; right: 16px; bottom: 16px; display: flex;
flex-direction: column-reverse; gap: var(--s-2); }` e tirar o `position: fixed`
de cada um, assim o toast entra ACIMA do banner em vez de em cima dele; (2) na
sala, subir a pilha pra `bottom: calc(16px + <altura do compose>)`, ou mais
simples: ancorar a pilha no `.stage` (esquerda) em vez do canto direito, já que
a coluna direita é a única parte da sala com controles no rodapé.

Custo médio · Risco baixo · **Prioridade P1**

### A5 — Não dá pra saber de quem é cada tela sem passar o mouse
**`src/renderer/style.css:1270`** e **`:1273`**

**O que acontece na tela.** `.tile-label { opacity: 0 }` e só
`.tile:hover .tile-label { opacity: 1 }`. Numa grade de 2 a 4 telas, em repouso
todas são retângulos pretos idênticos. A única pista de identidade é o avatar
de 32px no canto inferior direito (`:1282`) — uma inicial. Com dois "Amigo"
começando com a mesma letra, empata.

Isso é *hover-only* pra informação primária: quem chega numa sala com 3 telas
tem de varrer o mouse pra descobrir o que está vendo, e num toque/teclado não
descobre.

**Como reproduzir.** Entrar numa sala com 2+ pessoas transmitindo → tirar o
mouse da grade → tentar dizer qual tela é de quem.

**Conserto.** Deixar o rótulo sempre visível num estado discreto e reforçar no
hover: `opacity: .78` em repouso, `1` no hover, e trocar o gradiente de
`padding: 28px 12px 10px` por uma pílula compacta no canto inferior esquerdo
(o gradiente de 28px existe porque o rótulo só aparecia no hover; sempre
visível, ele pesa). O `.room-idle` (`:854-860`) já dá o mecanismo pra sumir com
ele depois de 3s parado, o que resolve a objeção de "tapa o vídeo".

Custo baixo · Risco baixo · **Prioridade P1**

### A6 — "Conectando…" aparece em vermelho, e "Conectar" não tem estado ocupado
**`src/renderer/app.js:1466`**, **`app.js:989`**, **`index.html:67`**

**O que acontece na tela.** `joinRoom()` faz
`showLobbyError('Conectando…')` — e `#lobby-error` é
`<p class="error" role="alert">` (`index.html:67`), com
`.error { color: var(--danger) }` (`style.css:336`). Ou seja: a mensagem de
progresso é pintada de vermelho de erro e anunciada como alerta, igualzinha a
"Não consegui conectar: endereço inválido."

Pior: `handleJoinConnect` (`app.js:981-992`) fecha o diálogo na hora
(`:989`) e chama `joinRoom` sem esperar. `#btn-connect` (`ui.js:2099-2101`) não
ganha spinner, não desabilita, não troca de rótulo — dá pra clicar várias
vezes. O irmão dele, `#btn-create-room-confirm`, tem tudo isso
(`ui.js:2025-2034`: spinner, `disabled`, "Criando sala…", e ainda desliga as
caixas de seleção).

**Como reproduzir.** Lobby → "Entrar por endereço" → digitar um IP que não
responde → "Conectar". O diálogo some, aparece um texto vermelho na barra
lateral, e você espera o timeout do socket sem mais nada na tela.

**Conserto.** (1) Separar o canal: um `#lobby-status` neutro
(`color: var(--tx2)`, `role="status"`) pro "Conectando…", e deixar
`#lobby-error` só pra erro. (2) Reaproveitar o padrão do "Criar sala": manter o
diálogo aberto com o botão ocupado até o `onOpen`/`onError`, usando a mesma
`.btn-spinner` que já existe no HTML dos outros botões.

Custo médio · Risco baixo · **Prioridade P1**

### A7 — Nome de sala e selo de estado quebram em duas linhas no cabeçalho
**`src/renderer/style.css:794`/`:2764`/`:2780`** (nome) e **`:798`/`:2765`** (selo)

**O que acontece na tela.** Nenhum dos dois tem `white-space: nowrap` nem
`text-overflow: ellipsis`. Medido em 900×600 com o nome "Sexta-feira de
Counter-Strike com a galera toda" (46 caracteres): o nome quebra em 2 linhas,
empurra "20 pessoas" pra baixo e o `.stage-header` (min-height 56px) cresce; o
selo "Qualidade reduzida" vira um blob arredondado de 2 linhas.

É inconsistente com o resto: `.room-name` no lobby (`:664-667`),
`.peer-name` (`:920-923`), `.chat-author` (`:979-982`) e `.source-name`
(`:2016`) todos truncam direito.

**Como reproduzir.** Criar sala com nome longo (o nome vem do perfil da pessoa)
→ janela em 900px → olhar o cabeçalho.

**Conserto.** `.stage-room-name { white-space: nowrap; overflow: hidden;
text-overflow: ellipsis; }` (o `.stage-title-group` já tem `min-width: 0`, então
o truncamento pega) e `.stage-status-badge, .stage-room-pin { white-space:
nowrap; }`. Pôr o nome completo no `title`, como as outras telas já fazem.

Custo baixo · Risco baixo · **Prioridade P2**

### A8 — Avisos que aparecem sozinhos não são anunciados
**`src/renderer/index.html:194`** (`#stage-warning`), **`:39`** (`#toast`),
**`:163`** (`#setup-error`)

**O que acontece na tela.** Nada — esse é o ponto. `#stage-warning` é o
elemento que recebe "Reconectando…", "encoder em software", o bloco de firewall
e o aviso de endereço (`app.js:1128-1184`), e não tem `role="status"` nem
`aria-live`. `#toast` idem (`app.js:957-965`). Os dois mudam de conteúdo sem
ação da pessoa, que é exatamente o caso de `aria-live`.

O projeto já sabe fazer: `#copy-address-status` (`:189`) e `#chat-messages`
(`:246`) têm `aria-live="polite"`, o véu de pausa ganha `role="status"` em
`ui.js:558`, e a página do Espiar tem `role="status"` (`espiar.html:29`).
Faltou nos dois que mais importam.

Bônus na mesma linha: `#setup-error` (`:163`) é o único dos três `<p
class="error">` sem `role="alert"` — `#lobby-error` (`:67`) e
`#create-room-error` (`:140`) têm.

**Como reproduzir.** Com leitor de tela ligado, pausar a transmissão / perder a
conexão / copiar o endereço. O primeiro é anunciado (o véu tem role), os outros
não.

**Conserto.** `role="status"` em `#stage-warning` e `#toast` (o `polite` é o
padrão de `status`), e `role="alert"` em `#setup-error`. Três atributos.

Custo baixo · Risco baixo · **Prioridade P2**

### A9 — `--z-modal` está morto: `.modal` declara `z-index` duas vezes
**`src/renderer/style.css:1742`** e **`:1746`**

**O que acontece na tela.** No mesmo bloco `.modal`, a linha 1742 diz
`z-index: var(--z-modal)` (1000) e a 1746 diz `z-index: 100`. A segunda ganha.
Resultado: todo diálogo (Configurações, Criar sala, Entrar, Confirmar,
Compartilhar, lightbox) fica em 100, e `.toast` (1001) e `.update-banner`
(1000) ficam **acima de qualquer modal**.

Hoje isso quase não aparece porque a `.modal-box` é centrada e o toast fica no
canto, então em 1280×800 e 900×600 eles não se cruzam (medido). Mas o token
está mentindo, e a próxima camada que confiar nele erra.

O `css-rules.test.js:72-81` chama esse teste de "camadas por tokens", mas só
verifica que os cinco tokens **existem** no arquivo — não que sejam usados.
5 dos 26 `z-index` do arquivo usam token.

**Como reproduzir.** Não dá pra ver hoje; é dívida. **[não verificado na tela]**

**Conserto.** Apagar a linha 1746. E, no teste, trocar a asserção de
"o token existe" por "nenhum `z-index` literal acima de 10 fora do `:root`" —
que é o que a intenção original queria dizer.

Custo baixo · Risco baixo · **Prioridade P2**

### A10 — A explicação de "sala em outra versão" fica ilegível (e invisível no tema Papel)
**`src/renderer/style.css:683`**

**O que acontece na tela.** `.room-row.incompatible { opacity: .62 }` apaga o
card inteiro — inclusive o texto que é a **única** explicação de por que o botão
"Entrar" está morto. Calculado com a `theme.contrast()` do projeto, a nota de
versão (`--tx2` a 62% sobre `--s1`) dá:

| tema | nota de versão | selo `--warn` |
|---|---|---|
| GoLive (padrão) | 3,62:1 | 4,59:1 |
| Superfície e sinal | 3,37:1 | 4,47:1 |
| Meia-noite | 3,56:1 | 4,56:1 |
| Carvão | 3,48:1 | 4,48:1 |
| Âmbar quente | 3,70:1 | 4,51:1 |
| Floresta | 3,93:1 | 4,52:1 |
| **Papel** | 3,37:1 | **1,40:1** |

Abaixo de 4,5:1 nos sete temas, e no Papel o selo de versão (amarelo sobre
quase-branco a 62%) fica praticamente invisível.

A trava de contraste do `theme.js` (`validate`, `:417-477`) não pega isso: ela
cobre `--tx` sobre bg/s1..s4, `--tx3` sobre s1/s2, `--on-act` sobre `--act`,
`--live`/`--danger` sobre s1 e a distância de matiz. **Nada sobre `--tx2`, e
nada sobre estados com `opacity` reduzida.** (Na prática `--tx2` está seguro
hoje porque as 7 predefinições o mantêm entre `--tx` e `--tx3` — mas isso é
coincidência, não regra.)

**Como reproduzir.** Ter na rede uma sala aberta por alguém em outra versão →
olhar o card apagado, principalmente no tema Papel.

**Conserto.** Tirar o `opacity` do card e apagar seletivamente: `opacity: .55`
só na `.room-badge` e na `.room-name`, deixando `.room-version` e
`.room-version-note` em opacidade cheia (é justamente o texto que a pessoa
precisa ler). No Papel, o `.room-version` precisa de fundo próprio — trocar
`background: var(--warn-dim)` por `var(--s3)` com `color` escuro, ou usar
`color-mix` contra `--s1`.

Custo baixo · Risco baixo · **Prioridade P2**

### A11 — O chat vazio é um retângulo em branco
**`src/renderer/ui.js:2363-2367`**

**O que acontece na tela.** `setHistory([])` faz
`chatMessagesEl.innerHTML = ''` e pronto. O chat é a aba que abre por padrão
(`index.html:232`, `aria-selected="true"`), então a primeira coisa que se vê ao
entrar numa sala nova é uma coluna vazia de ~600px com um campo de texto
embaixo.

É o único lugar do app sem estado vazio. Todos os outros têm, e são bons:
salas (`ui.js:1907-1910`, com ícone, título e dica), grade
(`index.html:196` + `style.css:2792-2794`), pessoas (`ui.js:2195`), emoji
(`nenhum emoji com esse nome`), fontes (`nenhuma tela encontrada`),
estatísticas, recentes de emoji, e o PiP picker.

**Como reproduzir.** Criar uma sala → olhar a aba Chat.

**Conserto.** Um `.chat-empty` no mesmo molde do `.rooms-empty`: ícone de balão,
"Ninguém falou ainda." e uma linha de convite ("Escreva pra sala — todo mundo
que estiver aqui vê."). O `.chat-messages` já é `display: flex; flex-direction:
column` (`:967`), então basta `justify-content: center` quando vazio
(`.chat-messages:empty` não serve porque o filho é injetado; usar uma classe).

Custo baixo · Risco baixo · **Prioridade P2**

### A12 — O selo "AO VIVO" muda de lugar dependendo de quem está olhando
**`src/renderer/style.css:931`** e **`:936`**

**O que acontece na tela.** `.peer-live-badge { margin-left: auto }` e
`.member-menu-btn { margin-left: auto }` estão na mesma linha flex
(`ui.js:2169-2182`). Dois `margin-left: auto` **dividem** o espaço livre em vez
de um deles absorver tudo. Medido numa coluna de 320px:

- peer ao vivo que você PODE moderar (você é dono): 102px antes do selo,
  17px entre o selo e o `⋮`, 8px depois do `⋮`
- peer ao vivo que você NÃO pode moderar: selo colado na direita (8px)

Então o mesmo selo aparece em duas posições diferentes na mesma lista, e muda
de lugar no instante em que a liderança é passada.

**Como reproduzir.** Estar numa sala como dono, com duas pessoas ao vivo, e
comparar a linha delas com a sua própria (que nunca tem `⋮`).

**Conserto.** Tirar o `margin-left: auto` do `.peer-live-badge` e pôr um
`.peer-spacer { flex: 1 }` — ou, mais barato, deixar o `auto` só no primeiro
item que deve encostar na direita e dar `margin-left: var(--s-1)` ao `⋮`.

Custo baixo · Risco baixo · **Prioridade P2**

### A13 — `hidden` não funciona na faixa de título (só morde fora do Windows)
**`src/renderer/style.css:2671`** vs **`src/renderer/index.html:14`**

**O que acontece na tela.** `#titlebar` nasce com o atributo `hidden`, e
`titlebar.js:10` só o remove no `win32`. Mas `.titlebar { display: flex }`
(`:2671`) vence o `display: none` que o `hidden` traz do navegador. Fora do
Windows a faixa renderiza — 32px, `position: fixed`, `z-index: 9999` — e como o
`titlebar.js` também não adiciona `has-titlebar`, o `padding-top: 32px`
compensatório (`:2705-2708`) não entra. A faixa cobre a marca "GoLive LAN" e o
título "Salas na sua rede". Confirmado no render.

O projeto já conhece essa armadilha: `:2817` tem
`#chat-panel[hidden], #people-panel[hidden] { display: none; }` exatamente pra
isso. Faltou pra `.titlebar`.

**Como reproduzir.** `npm start` em Linux/macOS. O build só publica `--win`
(`package.json`, `build.win`), então **isso não atinge quem instala** — só quem
desenvolve fora do Windows.

**Conserto.** `.titlebar[hidden] { display: none; }` — uma linha. Ou trocar o
padrão pra classe `.hidden`, que já é `display: none !important` (`:280`).

Custo baixo · Risco baixo · **Prioridade P3**

### A14 — O Tab passa por um campo de arquivo invisível
**`src/renderer/index.html:266`**

**O que acontece na tela.** `<input id="chat-file" type="file"
class="visually-hidden">`. `.visually-hidden` (`:281-284`) esconde mas **mantém
focável**. Confirmado: na ordem de tabulação da sala, depois de
`#btn-chat-emoji` vem `#chat-file`, que recebe o anel de foco dentro de uma
caixa de 1×1px recortada — ou seja, o foco some da tela por um Tab.

O botão real é o `#btn-chat-attach` (`:260`), que já abre o seletor.

**Como reproduzir.** Entrar numa sala → Tab até o emoji → Tab de novo. O foco
não aparece em lugar nenhum.

**Conserto.** `tabindex="-1"` no `#chat-file`. Uma palavra.

Custo baixo · Risco baixo · **Prioridade P3**

### A15 — A janela "Espiar" ignora o tema escolhido
**`src/renderer/espiar.html:10`**

**O que acontece na tela.** A página do Espiar declara a própria paleta
literal: `--spy-bg: #0A0A0F; --spy-fg: #EDEDF2; --spy-muted: #A3A3B8;
--spy-control: #16161F; --spy-hover: #292936` — que é a predefinição GoLive
padrão, cravada. O `espiar-page.js` (22 linhas) não recebe tema nenhum. Quem
escolheu "Papel" (o único claro) abre o Espiar e ganha a única janela escura do
app.

A `splash.css:10-14` faz a mesma cópia, mas ali o comentário justifica (a splash
aparece antes do config carregar) e é defensável.

**Como reproduzir.** Configurações > Aparência > Papel → numa sala, abrir
"Espiar" num tile.

**Conserto.** O `preload` do Espiar (`src/espiar-preload.js`) passar os 5
valores do tema atual e o `espiar-page.js` escrever em
`document.documentElement.style`. Alternativa mais barata: derivar as cinco
variáveis de `--tx`/`--bg` do tema salvo no config, lendo no boot da janela.

Custo médio · Risco baixo · **Prioridade P3**

### A16 — A tela da sala não tem `h1`
**`src/renderer/index.html:103`** (único h1) e **`:236`**

**O que acontece na tela.** O `h1` "Salas na sua rede" está no lobby, que fica
`display: none` dentro de uma sala. Na sala, o primeiro título é
`h2.members-title` ("Na sala", `visually-hidden`), e o nome da sala é um
`<span>` (`:177`). Quem navega por títulos entra numa tela que começa no nível
2 e não tem como saber em que sala está.

**Conserto.** Trocar o `<span id="stage-room-name">` por
`<h1 id="stage-room-name" class="stage-room-name">`. O CSS da `:2780` já define
`font-size`/`line-height`, só falta zerar `margin`.

Custo baixo · Risco baixo · **Prioridade P3**

### A17 — Duas navegações por abas no mesmo app, com cuidados diferentes
**`src/renderer/index.html:315-320`** + **`ui.js:2681-2689`** vs
**`index.html:230-233`** + **`app.js:2219-2242`**

**O que acontece na tela.** As abas da coluna direita (Pessoas/Chat) têm o
padrão completo: `role="tablist"`, `role="tab"`, `aria-controls`,
`aria-selected` sincronizado, roving `tabIndex`, setas + Home/End. Exemplar.

A nav de Configurações (Perfil / Aparência / Voz e Vídeo / Estatísticas) é
`<nav>` com quatro `<button class="settings-cat">` e um toggle de classe
`.active` — sem `aria-selected`, sem `aria-current`, sem `role`, sem setas. As
quatro `<section class="settings-pane">` não têm `aria-labelledby`. Visualmente
as duas se comportam igual; pro teclado e pro leitor de tela, não.

**Conserto.** Copiar o `selectRoomTab` de `app.js:2220-2228` pro
`settingsCatButtons.forEach` de `ui.js:2681`. É o mesmo código, com outros ids.

Custo baixo · Risco baixo · **Prioridade P3**

### A18 — CSS morto de um lobby que não existe mais
**`src/renderer/style.css:517-598`**, **`:2763`**, **`index.html:186`**

Nove classes com zero uso em HTML ou JS (varredura programática sobre
`index.html` + os 12 módulos de renderer):
`.lobby-bounds` (`:517`), `.lobby-topbar` (`:524`), `.lobby-topbar-inner`
(`:525`), `.lobby-body` (`:551`), `.lobby-start` + `::before` (`:565`, `:576`),
`.lobby-brand-mark` (`:584`), `.lobby-eyebrow` (`:586`), `.lobby-title`
(`:590`), `.lobby-lede` (`:591`). ~80 linhas, mais o comentário de 12 linhas
(`:493-504`) que descreve um layout que não é mais o de hoje — o que torna o
arquivo ativamente enganoso pra quem voltar em um mês.

Mais dois restos: `.stage-header #btn-room-settings { display: none }`
(`:2763`) mira um botão que mora na barra de controles, não no cabeçalho — a
regra nunca casa; e `<button class="room-settings-header">` (`index.html:186`)
está permanentemente `display: none` (`:2783`), um botão "Configurações"
duplicado que só ocupa DOM.

Custo baixo · Risco baixo (nada referencia) · **Prioridade P3** — mas é o que
criou o A1, então vale junto com ele.

---

## B. Melhorias de design

### B1 — Achatar as camadas do `style.css`
**`src/renderer/style.css`, arquivo inteiro**

53 seletores estão escritos mais de uma vez: `.control-bar` ×4 (`:804`, `:2767`,
`:2796` e o `@media` de `:2837`), `.lobby` ×3, `.stage-header` ×3 (`:785`,
`:2762`, `:2778`), `.room-side` ×3, `.grid-main` ×3, `.control-btn-end` ×3 —
esse último com duas aparências conflitantes: `:2770` pinta um botão discreto
(`--danger-dim` com texto `--danger-soft`) e `:2805` pinta um botão vermelho
cheio. Só olhando o arquivo não dá pra saber qual vale (é o segundo).

**Proposta concreta.** Uma passada única: pra cada um dos 53, apagar as versões
antigas e deixar a declaração final no lugar onde o componente é definido.
Começar pelos 8 de ×3 e ×4 — resolvem metade do ruído. Depois disso, adotar a
regra "um seletor, um bloco" e ganhar dela um teste: `css-rules.test.js` já sabe
parsear o arquivo (`declarations()`, `:10-41`); um teste novo que reprove
seletor repetido custa ~15 linhas e trava a regressão.

**O que muda pra quem usa.** Nada, hoje. Mas é o que impede o próximo A1 —
uma camada nova que dispara sobre uma estrutura que ela não conhece.

Custo alto · Risco médio (é onde um pixel pode mudar) · **Prioridade P2**

### B2 — Escala tipográfica: 132 declarações, zero tokens
**`src/renderer/style.css`, 132 ocorrências de `font-size`**

Medido: **nenhuma** usa `var()`. A escala real em uso tem 19 tamanhos:
`11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 17, 18, 19, 20, 22, 26, 28`
px, mais `0.85em` (×4) e `0.92em` (×1). Os meios-pixels (`11.5`, `12.5`,
`13.5`, `14.5`) são a assinatura de "cada componente inventou o seu".

Os pesos também: `400, 550, 600, 650, 700` — cinco, com `550` (×2) e `650`
(×7) sendo pesos de fonte variável que ninguém mais do arquivo usa.

**Proposta concreta.** Seis papéis, não dezenove tamanhos:

```css
--fs-micro:  11px;   /* selo, contador, hora do chat, rótulo de eixo */
--fs-small:  12px;   /* metadado, descrição de caixa, dica */
--fs-body:   13px;   /* corpo: chat, lista, item de menu */
--fs-ui:   13.5px;   /* rótulo de botão — o valor que a regra base já usa */
--fs-lead:   16px;   /* nome da sala, título de card */
--fs-title:  22px;   /* h1 da tela ("Salas na sua rede") */
--fw-regular: 400; --fw-medium: 600; --fw-bold: 700;
```

`14/14.5/15` colapsam em `--fs-lead` ou `--fs-ui`; `17/18/19/20` (só em títulos
de modal) colapsam em um `--fs-modal: 18px`; `26/28` só existem no lobby morto
(A18) e na splash. `550` e `650` viram `600`.

**O que muda pra quem usa.** Uma tela mais afinada: hoje "Criar sala" (13.5px),
"Entrar" do card (12.5px) e "Assistir" (`.small`, `0.85em` ≈ 11.5px) são três
tamanhos pro mesmo tipo de ação, e a diferença lê como descuido, não como
hierarquia.

Custo médio · Risco médio · **Prioridade P2**

### B3 — Escala de espaçamento: existe, mas cobre menos da metade
**`src/renderer/style.css`, 284 declarações de espaçamento**

125 usam `var(--s-N)`, **159 usam px na mão**. Dos 190 valores px encontrados,
**128 estão fora** da escala 4/8/12/16/24/32/48 que o `:root:116-117` define:
`6px`(26), `2px`(21), `5px`(19), `10px`(17), `7px`(13), `3px`(10), `9px`(7),
`14px`(7), `18px`(4), `11px`(2), `20px`, `26px`, `28px`.

**Proposta concreta.** Duas coisas. (1) Aceitar que uma escala de 7 degraus não
cobre micro-ajuste e criar dois degraus abaixo: `--s-0: 2px` e `--s-05: 6px`
(os dois valores fora-de-escala mais usados, 21 e 26 ocorrências). Isso já
absorve 47 dos 128. (2) Arredondar o resto pro degrau vizinho: `5px→4`,
`7px→8`, `9px→8`, `10px→8 ou 12`, `14px→12 ou 16`, `18px→16`, `11px→12`. São
81 valores, mudança visual sub-pixel na maioria.

**O que muda pra quem usa.** Ritmo. Hoje o `gap` entre um avatar e um nome é
`var(--s-2)` (8px) na lista de membros e `9px` no chat (`:969`) e `7px` na
linha de sistema (`:987`) — três valores pro mesmo par visual, na mesma coluna
de 320px.

Custo médio · Risco baixo · **Prioridade P3**

### B4 — Raios e durações: 15 valores que já têm token
**`src/renderer/style.css`**

Raio: 93 usos de `var(--r-*)` contra 30 na mão — mas dos 30, a maioria é
legítima (`50%` ×10 pra círculo, `inherit` ×2, `0` ×3). Os que sobram já têm
token exato: `6px` ×6 é `--r-xs`, `999px` ×2 é `--r-full`. Restam `3px` ×3,
`2px` ×2, `7px` ×2 sem par — proposta: `--r-2xs: 3px` e mandar o `2px` e o
`7px` pro vizinho.

Duração: 49 usos de token contra 26 literais, e os literais quase repetem
tokens existentes — `0.25s` ×10 (o fade do fullscreen) contra
`--dur-slow: 240ms`, e `0.12s` ×2 contra `--dur-fast: 120ms`. Proposta: trocar
os 12 pelos tokens. Os que restam são legítimos (`1.4s` da reação, `1.6s` do
pulso, `1.1s` da barra indeterminada, `600ms`/`700ms` dos spinners) e merecem
um degrau próprio: `--dur-ambient: 1.4s`.

**O que muda pra quem usa.** Movimento coerente: hoje o rótulo do tile some em
180ms (`--t-tint`) e o do fullscreen em 250ms, sem razão.

Custo baixo · Risco baixo · **Prioridade P3**

### B5 — Estender a trava de contraste ao que ela não olha
**`src/renderer/theme.js:417-477`**

A `validate()` de hoje cobre 5 checagens e é bem argumentada (o comentário de
`:449-457` sobre por que `--warn` fica de fora é correto). O que não cobre:

1. **`--tx2`** — nenhuma checagem. Está seguro por acidente (as 7 predefinições
   mantêm `tx2` entre `tx` e `tx3`), não por regra. Uma linha no laço de `:432`
   já resolve: incluir `s.tx2` junto de `s.tx3`.
2. **`--tx3` sobre `--s3`/`--s4`** — só `s1` e `s2` são checados. Calculado:
   `tx3/s3` fica em 4,27–5,05 (abaixo de 4,5 em 4 dos 7 temas) e `tx3/s4` em
   3,58–3,96 (abaixo em todos). Na prática o único par real é
   `.banned-readmit` (`--tx3`, `:958`) no hover (`--s3`, `:962`) — 11px a
   4,3:1. Pequeno, mas é o tipo de coisa que a trava existe pra pegar.
3. **Estados com `opacity`** — é aí que mora o A10, e é o buraco que mais
   importa. Proposta: uma checagem 6 que, dado o conjunto de opacidades que o
   CSS usa em estado (`.62` do card incompatível, `.5` do `button:disabled`,
   `.45` do checkbox desabilitado), compõe a cor contra a superfície e checa
   com um piso menor (3:1 — informação secundária, não corpo de texto).

Calculado hoje, `button:disabled` com rótulo `--tx` sobre `--s3` dá 4,13–4,56
nos temas escuros e **3,04:1 no Papel** — que é o "Ir ao vivo" desligado
enquanto você não escolheu uma tela. Não é violação de WCAG (controle
desabilitado é isento), mas no Papel é genuinamente difícil de ler.

**O que muda pra quem usa.** A trava deixa de garantir só o acento e passa a
garantir o texto que explica as coisas.

Custo médio · Risco baixo · **Prioridade P2**

### B6 — Lista de pessoas com busca quando a sala cresce
**`src/renderer/style.css:895`**, **`ui.js:2192-2234`**

Depois do conserto do A2 a lista fica utilizável, mas com 20 pessoas ainda é
uma coluna de 880px de rolagem. O `STATUS.md` diz que o teto prático da árvore
é ~4 pessoas — mas a sala aceita mais, e a lista é onde a moderação acontece.

**Proposta concreta.** Um campo de busca `hidden` que aparece a partir de 12
membros, no mesmo molde do `.emoji-search` (`index.html:277-281`), que já
existe e já funciona. E ordenar: ao vivo primeiro, depois dono, depois o resto
por nome — hoje a ordem é a de chegada (`peers.values()`, `ui.js:2219`), então
quem está transmitindo pode estar em 17º.

**O que muda pra quem usa.** Achar quem você quer silenciar ou expulsar sem
rolar; e ver de relance quem está ao vivo sem caçar o selo.

Custo médio · Risco baixo · **Prioridade P3**

### B7 — Glossário: uma coisa, um nome
Ver a tabela de **Inconsistências de vocabulário** abaixo. A proposta é um
arquivo `docs/glossario.md` com 8 linhas e uma checagem de lint barata: um
teste que varre `ui.js`/`app.js`/`index.html` atrás dos termos proibidos
("host", "anfitrião", "espectador", "anotação") em string visível. ~20 linhas,
e trava a regressão que já aconteceu quatro vezes com a mesma palavra.

**O que muda pra quem usa.** Hoje a pessoa vê "Dono da sala" no ícone,
"Passar a liderança" no menu, "Você é o líder da sala agora" no toast e
"O host encerrou a sala" no erro — e tem de deduzir que são a mesma pessoa.

Custo baixo · Risco baixo · **Prioridade P2**

### B8 — Convenção de texto pros estados vazios
Os estados vazios existem quase todos (bom), mas em dois registros:

| com maiúscula e ponto | minúscula, sem ponto |
|---|---|
| "Ninguém transmitindo ainda." (`app.js:616`) | "você não está em nenhuma sala" (`ui.js:2195`) |
| "Sua tela, na casa dos seus amigos." (`ui.js:1909`) | "ninguém mais pra mostrar" (`ui.js:1696`) |
| "Entre ou crie uma sala pra começar." (`index.html:196`) | "nenhuma tela encontrada" (`ui.js:3321`) |
| "Compartilhar tela fica no dock abaixo." (`style.css:2794`) | "nenhum emoji com esse nome" |

**Proposta.** Frase com maiúscula e ponto final, sempre — é o registro que o
resto do app usa (todos os erros, todas as dicas, todos os títulos de caixa).
E nos três da direita, aproveitar pra dar uma saída: "Nenhuma tela encontrada.
Toque em Atualizar." em vez de só constatar.

Custo baixo · Risco zero · **Prioridade P3**

### B9 — Arquivo único de tokens
Hoje as cores vivem em três lugares: `style.css:36-201` (o `:root` + 6 blocos
de predefinição), `theme.js:PRESETS` (os mesmos valores, em JS, pra validação e
pra aplicação), e cópias literais em `espiar.html:10` e `splash.css:10-14`.

**Proposta concreta.** `theme.js` já é a fonte de verdade computável (tem
`PRESETS`, `deriveAction`, `validate`, `contrast`). O passo que falta é fazer
`style.css` e as duas páginas isoladas **derivarem** dela em vez de repetirem:
um `scripts/gen-tokens.js` que lê `theme.js` e escreve o bloco `:root` +
`:root[data-theme]` do `style.css`, mais um teste que falha se o CSS commitado
divergir do gerado (~30 linhas, no mesmo estilo do `css-rules.test.js`). Isso
mata o A15 de raiz e impede que uma predefinição nova entre em um lugar e não
no outro.

**O que muda pra quem usa.** O tema vale no app inteiro, incluindo a janela
Espiar.

Custo médio · Risco baixo · **Prioridade P3**

---

## Mapa de z-index

Existe uma escala nomeada no `:root` (`style.css:110-114`), mas **só 5 dos 26
`z-index` do arquivo a usam**. O resto é número cru.

### Camadas globais

| z | token | onde | linha |
|---|---|---|---|
| 9999 | `--z-titlebar` | `.titlebar` | `:2670` |
| 1001 | `--z-toast` | `.toast` | `:463` |
| 1000 | `--z-modal` | `.update-banner` | `:435` |
| **100** | *(cru — sobrescreve o token na mesma regra)* | `.modal` | `:1746` **← A9** |
| 70 | cru | `.emoji-panel` | `:2491` |
| 60 | cru | `.pip-picker` | `:1568` |
| 60 | cru | `.tile-menu` | `:1707` |
| 50 | `--z-popover` | `.member-menu` | `:943` |
| 50 | `--z-popover` | `.control-bar .btn-label` | `:2799` |
| **50** | **cru** | `.tile.fullscreen` | `:1274` |
| -1 | cru | `.lobby-start::before` *(classe morta)* | `:580` |

### Dentro do tile (contexto próprio, `.tile { position: relative }`)

| z | elemento | linha |
|---|---|---|
| 7 | `.tile-watchers` (olho + contagem) | `:1373` |
| 6 | `.tile-gate` (card "Assistir") | `:1631` |
| 6 | `.annot-text-input` | `:2413` |
| 5 | `.tile-annot-bar` | `:2338` |
| 5 | `.tile-react-bar` | `:2846` |
| 4 | `.tile-react-pops` | `:2880` |
| 3 | `.tile-annot-canvas` | `:2321` |
| 2 | `.tile-paused` (véu "Transmissão pausada") | `:1334` |
| 2 | `.tile-unwatch-btn` | `:1697` |
| 2 | `.tile.fullscreen .pip-strip` | `:1487` |
| 1 | `.tile-avatar`, `.tile-kind-badge`, `.tile-paused-shot` | `:1289`, `:1307`, `:1329` |
| auto | `.tile-label` *(fica embaixo de tudo acima)* | `:1261` |

### Colisões

1. **`.modal` em 100, não em 1000** (`:1742` + `:1746`) — duas declarações no
   mesmo bloco; a segunda ganha e `--z-modal` fica morto. Consequência: toast
   (1001) e banner (1000) ficam acima de qualquer diálogo. Hoje não aparece
   porque a caixa do modal é centrada e os dois ficam no canto (medido em
   1280×800 e 900×600: não se cruzam). É dívida, não sintoma. → **A9**

2. **`.tile.fullscreen` em 50 cru empata com `--z-popover` (50)** (`:1274`).
   Quem ganha o empate é a ordem do DOM: `#member-menu` (`index.html:273`) vem
   depois de `#room-view`, então o menu de moderação fica por cima — por sorte,
   não por regra. Proposta: `--z-fullscreen: 40` e mover o tile pra baixo do
   popover explicitamente.

3. **`.pip-picker` e `.tile-menu` empatam em 60** (`:1568`, `:1707`). Os dois
   são menus flutuantes que podem estar abertos ao mesmo tempo (o PiP picker
   abre de dentro de um tile em fullscreen; o tile-menu abre por botão direito).
   Empate resolvido por ordem de DOM. **[não verificado que aconteça na prática]**

4. **O véu de pausa (2) fica ABAIXO do canvas de rabisco (3), da barra de
   reação (5), do gate (6) e do olho (7).** Então, com a transmissão pausada, os
   traços que já estavam na tela continuam desenhados **por cima** do cartão
   "Transmissão pausada". Não achei limpeza de canvas no `setPaused`
   (`ui.js:573`) nem no `renderPausedOverlay` (`:523-572`).
   **[não verificado na tela]** — pra confirmar: rabiscar numa tela e pausar.
   Se confirmar, o conserto é subir `.tile-paused` pra 8.

5. **Não há colisão real hoje entre a faixa de título (9999) e o fullscreen**:
   `body:has(.tile.fullscreen) .titlebar { display: none }` (`:2710`) resolve.
   Bem pensado.

**Proposta de escala completa** (substitui os 21 números crus):

```css
--z-base:        0;   /* fluxo */
--z-tile-media:  1;   /* avatar, selo de tipo, bitmap borrado */
--z-tile-veil:   2;   /* véu de pausa, botão de parar de assistir */
--z-tile-ink:    3;   /* canvas de rabisco + laser */
--z-tile-pops:   4;   /* reações subindo */
--z-tile-bar:    5;   /* barra de rabisco, barra de reação */
--z-tile-gate:   6;   /* card "Assistir", entrada de texto do rabisco */
--z-tile-meta:   7;   /* olho de quem está assistindo (acima do gate, de propósito) */
--z-fullscreen: 40;   /* tile em tela cheia — abaixo de qualquer popover */
--z-popover:    50;   /* menu de membro, tooltip da dock */
--z-menu:       60;   /* menu de tile, seletor de PiP */
--z-panel:      70;   /* painel de emoji */
--z-modal:    1000;   /* diálogos */
--z-toast:    1001;   /* toast + banner (mesma pilha, ver A4) */
--z-titlebar: 9999;
```

E o teste correspondente, no lugar do `css-rules.test.js:72-81` de hoje: em vez
de checar que os tokens existem, reprovar qualquer `z-index` literal maior que
0 fora do bloco `:root`.

---

## Inconsistências de vocabulário

Todas conferidas como **texto visível** (rótulo, `title`, `aria-label`, toast ou
mensagem de erro) — comentários de código foram descartados.

| Termo usado | Onde (arquivo:linha) | Termo sugerido |
|---|---|---|
| **Dono da sala** | `ui.js:2175` (`title` + `aria-label` da coroa) | **Dono da sala** — é o mais claro e já é o que aparece no ícone |
| Passar a **liderança** | `ui.js:2141` (menu), `:3547`, `:3549` (confirmação) | Passar o comando da sala *(ou "Tornar dono da sala")* |
| Você é o **líder** da sala agora. | `app.js:2916` (toast) | Você é o dono da sala agora. |
| O **host** encerrou a sala. | `app.js:1685` (erro no lobby) | Quem criou a sala encerrou. |
| **Anfitrião** sumiu. / **Anfitrião** saiu. | `app.js:1811`, `:2801` (erro no lobby) | O dono da sala saiu. |
| por **espectador** | `ui.js:2762` (linha de custo do diálogo de qualidade) | por pessoa assistindo |
| número de **espectadores** | `app.js:5334` (aviso de encoder em software) | número de pessoas assistindo |
| **quem está assistindo** / Ninguém está vendo | `style.css:1354` (comentário), `ui.js` (véu de pausa) | manter — é o registro certo |
| **Anotações** (título da seção) | `index.html:377` | **Rabisco** — palavra que o app usa em todo o resto |
| Deixar a sala **rabiscar** | `index.html:387`, `ui.js:1282`, `:1295-1296` | manter |
| **Desconectar** (citado no texto) | `app.js:1816`, `:1826` | **Sair da sala** — é o rótulo real do botão (`index.html:224`) |
| **Prévia** / **Você (prévia)** | `ui.js:2927`, tile local | manter — mas hoje convive com "Câmera" sem prefixo |

**As três que mais custam.** (1) O papel de dono tem **quatro** nomes
("dono", "líder", "host", "anfitrião"), e três deles aparecem em mensagens de
erro — o momento em que a pessoa menos quer decifrar sinônimo. (2) "Anotações"
é o título de uma seção cujo único conteúdo fala de "rabiscar": a palavra do
título não reaparece em lugar nenhum da interface. (3) `app.js:1816` e `:1826`
mandam a pessoa "usar Desconectar" — botão que não existe; o botão se chama
"Sair da sala".

**Sugestão de glossário** (8 linhas, `docs/glossario.md`):
`sala` · `dono da sala` · `transmissão` (o que sai) · `tela` (o que se vê) ·
`assistir` / `quem está assistindo` (nunca "espectador") · `rabisco` (nunca
"anotação") · `sair da sala` (nunca "desconectar") · `pessoa` (nunca "membro",
"participante" ou "peer").

---

## Ferramentas de interface que valeriam a pena

Avaliado pelo que este projeto é: um Electron de uma pessoa só, com 733 testes
em `node --test`, sem build step no renderer, sem bundler, sem framework.

### Vale muito

**1. Um teste de layout com Playwright — não regressão visual, medição.**
Foi assim que A1, A2, A3 e A4 saíram, e o ambiente já tem tudo (Chromium em
`/opt/pw-browsers`). O que funciona bem aqui é **não** comparar screenshots
(frágil, precisa de baseline binária no git, quebra a cada mudança de fonte),
e sim **afirmar números**: carregar `index.html`, bloquear os `<script>`
(eles precisam do bridge do Electron), injetar markup representativo e testar
invariantes:

- nenhum elemento com `scrollWidth > clientWidth` quando `overflow: visible`
- nenhum elemento passando da largura da viewport em 900, 1040 e 1280px
- nenhuma sobreposição entre o `#toast` e um elemento clicável
- todo `button` e `input` visível tem indicador de foco (`outline` OU um
  `box-shadow` com anel) — pega o A3 e qualquer reincidência

Custo: ~120 linhas e o Playwright como devDependency. É o maior retorno da
lista e derruba o "falta harness" do F1 sozinho.

**2. axe-core dentro desse mesmo teste.**
Uma vez que a página está carregada no Playwright, `axe.run()` são 3 linhas a
mais. Pega automaticamente: `aria-live` faltando, `label` sem `for`, ordem de
títulos (A16), `aria-selected` ausente na nav de Configurações (A17), contraste
calculado no DOM real (A10). Vale — mas com uma ressalva honesta: rodar com
`disableRules` pro que não se aplica a app de desktop (alvo de toque de 44px, o
próprio CSS já argumenta em `:1385-1389` por que o olho de audiência não
precisa), senão vira ruído e o teste é ignorado.

**3. Um arquivo único de tokens gerado do `theme.js`.** Ver B9. Não é
ferramenta de terceiro, é 30 linhas de script + 15 de teste, no estilo que o
projeto já usa. Resolve o A15 e impede divergência entre CSS e JS.

### Vale, com moderação

**4. stylelint.**
O que pegaria aqui de verdade: `declaration-block-no-duplicate-properties`
(acha o A9 sozinho), `no-duplicate-selectors` (acha os 53 do B1), e
`declaration-property-value-allowed-list` pra travar espaçamento e raio nos
tokens (B3, B4). O que NÃO vale: o preset `stylelint-config-standard` inteiro,
que vai reclamar de centenas de coisas estilísticas num arquivo de 2956 linhas
que já tem convenção própria e comentada. Proposta: `stylelint` com config
mínima, 4 regras, `--max-warnings 0`. Vale a pena porque duas das quatro pegam
defeitos reais deste relatório.

### Não vale

**5. Regressão visual por screenshot.**
Já está disponível (Playwright), mas é a pior relação custo/benefício aqui:
exige baselines binários versionados, quebra com qualquer mudança de
antialiasing entre máquinas, e num app com **sete temas** o número de baselines
explode (7 temas × 5 telas × 2 tamanhos = 70 imagens). Pra uma pessoa só, o
custo de manutenção supera o que ele pega — e o que ele pegaria bem (A1, A7) o
teste de medição do item 1 já pega, com mensagem de erro legível em vez de
"5.2% dos pixels mudaram".

**6. Validação de HTML no CI.**
O `index.html` já foi validado nesta auditoria (parser próprio: 117 ids, zero
duplicado, zero `<div>` desbalanceada, zero `<button>` aninhado, todo `<label>`
com `for` ou envolvendo o controle — as quatro páginas passaram). O HTML
estático do projeto é bom e quase não muda. E o validador não veria o que
importa: 90% da interface é montada por `innerHTML` em `ui.js`. Um validador de
CI passaria verde num app quebrado. Se um dia valer, o lugar certo é dentro do
teste do item 1 — validar o DOM **depois** do `ui.js` rodar, não o arquivo.

---

## O que não deu pra confirmar

- **Véu de pausa por baixo do rabisco** (colisão 4 do mapa de z-index).
  Precisa de duas máquinas: rabiscar numa tela e pausar.
- **Empate `.pip-picker` / `.tile-menu` em 60** — não achei um caminho em que os
  dois abram juntos, mas nada no código impede.
- **Toast por cima de modal** (A9) — o `z-index` está errado, mas nas duas
  resoluções medidas as caixas não se cruzam. Em janela muito larga
  (>1600px) a `.picker-box` (`width: min(920px, 92vw)`) fica centrada e o toast
  no canto continua não cruzando. Provavelmente nunca aparece — é dívida.
- **Conteúdo do modal de Configurações** e do painel de Estatísticas foram
  lidos no CSS e no `ui.js:2900-3010`, mas não renderizados com dados reais
  (dependem de IPC). As medidas de caixa (`settings-box`
  `min(880px,90vw) × min(600px,85vh)` = 810×510 em 900×600) cabem, mas o
  conteúdo interno não foi medido.
