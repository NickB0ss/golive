# Anotações na tela, liderança e chat rico — design

Data: 2026-09-04. Sucede a 0.8.0
([`2026-09-03-estado-visivel-e-temas-design.md`](./2026-09-03-estado-visivel-e-temas-design.md)).
A direção visual "Superfície e sinal" continua valendo palavra por palavra:
elevação em vez de cor, acento reservado a "alguém está ao vivo", zero
`backdrop-filter`. Nada de paleta é reaberto aqui — com **uma exceção
declarada e delimitada** (§5.3): a tinta das anotações é saturada por
natureza, e vive num plano que só existe enquanto alguém está desenhando.

## 1. Os cinco pedidos

Cinco observações de uso, duas de correção e três de recurso novo:

1. **"Parar transmissão" aparece pra quem não está transmitindo.** O menu ⋮
   do membro mostra os três poderes de moderação de uma vez, sem olhar o
   estado da pessoa. Pedir pra parar uma transmissão que não existe é um
   item que não faz nada.
2. **"Silenciar" está no lugar errado.** No ⋮ do membro ele fica ao lado de
   expulsar e banir — três ações que vão pro servidor e valem pra sala
   inteira — quando ele é **local**, só meu, e só faz sentido sobre **uma
   tela**. O botão direito sobre o tile já tem o mute e o volume; é ali que
   ele mora.
3. **Não dá pra passar a liderança.** Quem criou a sala é dono até a sala
   morrer. Se a pessoa vai sair, ou só não quer moderar, não há saída.
4. **Não dá pra mandar imagem no chat.** Print de erro, mapa, meme — tudo
   sai do app.
5. **Não dá pra rabiscar na tela de quem está compartilhando.** É o gesto
   natural de "ali, esse botão" — hoje se resolve com "no canto de baixo, à
   esquerda, mais pra cima… isso".

E um pedido de conforto: **emoji no chat**, com um botão que os mostra.

## 2. Princípio que organiza esta passada

> **Cada ação mora onde está o seu objeto.**

O ⋮ do membro é sobre a **pessoa** na sala: moderar. O botão direito é sobre
**aquela tela**: silenciar, volume, rabiscar. O chat é sobre a **conversa**:
texto, imagem, emoji. A correção 2 é esse princípio aplicado; a 1 é o mesmo
princípio na dimensão do tempo (uma ação sobre um objeto que não existe
agora não aparece agora).

Corolários que decidem os casos duvidosos abaixo:

1. **Menu sem item não abre.** Quem não é dono não tem nada a fazer com
   outra pessoa — então o ⋮ nem é desenhado, em vez de abrir um menu com
   uma linha inútil ou desabilitada.
2. **Desenhar na tela de alguém é permissão de quem transmite, não de quem
   assiste.** Por isso é opt-in, e no momento em que a transmissão começa —
   a mesma lógica que pôs "anunciar na rede" no diálogo de criar sala.
3. **O que é local não vira mensagem.** Mute é `GainNode`; anotação é
   mensagem. A fronteira já existe no app e não se move.

## 3. Correção 1 e 2 — o menu ⋮ e o menu do tile

### 3.1 O que sai e o que fica

| Item | Antes (⋮ do membro) | Depois |
|---|---|---|
| Silenciar / Reativar som | sempre | **sai** — vive no botão direito do tile |
| Parar transmissão | dono, sempre | dono, **só quando a pessoa está ao vivo** |
| Expulsar da sala | dono | dono |
| Banir da sala | dono | dono |
| Passar a liderança | — | **novo**, dono, alvo ainda não é dono (§4) |

Quem não é dono não vê mais nenhum item — então `buildMemberRow` **não
desenha o botão ⋮**. O menu deixa de existir pra quem não pode nada, em vez
de abrir vazio.

`live` passa a viajar até `openMemberMenu` (hoje ele para em
`buildMemberRow`, que só usa pra acender o anel do avatar). O menu é montado
no clique, então lê o estado do instante em que abre — não precisa reagir a
alguém ficar ao vivo com o menu aberto (o menu fecha no primeiro clique
fora, e a janela de erro é de segundos).

### 3.2 O menu do tile ganha um cabeçalho

Tirar "Silenciar" do ⋮ só é honesto se o lugar novo for descobrível. O menu
de contexto do tile (que já tem mute + volume) ganha uma linha de título com
**o nome de quem está naquele tile**, com o avatar. Não é decoração: é o que
responde "silenciar quem?" antes do clique, e é o que faz o menu parecer o
menu **daquela pessoa**, que é exatamente o que o item que saiu do ⋮ era.

Nada mais muda ali: `getOrCreateAudioState` + `GainNode` por tile, sem
passar pelo servidor, como sempre foi. O caminho de código passa a ser o
mesmo dos dois lados (`setMuted`/`isMuted`), sem leitura direta de
`state.muted` no menu.

## 4. Passar a liderança

### 4.1 Modelo

Hoje "dono" é derivado de uma coisa só: o `ownerToken` que o `main.js` gera
por sala e entrega **só** ao renderer de quem a criou. O token continua
sendo a raiz da autoridade — o que muda é que ele deixa de ser a **única**
fonte.

O servidor passa a guardar dois fatos por peer e um por sala:

- `peer.tokenHolder` — apresentou o `ownerToken` válido no `join`. Não muda
  nunca depois disso.
- `peer.owner` — é o dono **agora**. É o que `moderate` checa.
- `transferredTo` (sala) — `clientId` de quem recebeu a liderança, ou `null`
  se ela nunca saiu do host.

Regra de quem é dono ao entrar:

```
owner = transferredTo ? (clientId === transferredTo) : tokenHolder
```

Isso resolve sozinho o caso feio: o host passa a liderança, sai e volta. Ele
volta como `tokenHolder` (o token dele continua válido) mas **não** como
dono — `transferredTo` aponta pra outra pessoa. Duas coroas na sala é um
estado que não chega a existir.

### 4.2 Quando o líder sai

Um líder que não é o host pode simplesmente fechar o app. A sala continua
viva (o servidor roda no processo do host), e ficaria **sem dono** — ninguém
podendo moderar, banir ou desfazer um ban, com a sala aberta pra rede.

Regra: **a liderança volta pra casa**. No `close` de um peer que era dono
com `transferredTo` preenchido, o servidor zera `transferredTo`, promove o
`tokenHolder` que estiver na sala (se estiver) e anuncia. Se o host não
estiver lá, a sala fica sem dono até ele voltar — o que já é verdade hoje
quando o dono cai.

### 4.3 Protocolo

Cliente → servidor, na mensagem `moderate` que já existe:

```json
{ "type": "moderate", "action": "transfer-owner", "target": "<peerId>" }
```

Servidor → sala inteira, mensagem nova:

```json
{ "type": "owner-changed", "id": "<peerId>", "name": "<nome>" }
```

`id` é sempre quem é dono **agora** (ou ausente, quando a sala ficou sem
dono). Quem recebe compara com o próprio `myId`. O novo dono recebe, na
sequência, o `banned-list` — a lista de banidos é ferramenta de dono, e ela
migra junto. O dono anterior recebe a lista **vazia**, que é o que faz a
seção "Banidos" sumir da coluna dele.

Uma linha de sistema entra no histórico do chat: `transfer-owner`, redigida
como *"fulano passou a liderança para beltrano"*, ícone de coroa. Fica no
mesmo ring buffer de 50 das outras.

### 4.4 UI

Item no ⋮, texto **"Passar a liderança"**, ícone de coroa, sem tom de
perigo (não é destrutivo — é uma delegação). Diálogo de confirmação, porque
é irreversível pelo lado de quem passa:

> **Passar a liderança para *fulano*?**
> *Fulano* passa a poder parar transmissões, expulsar e banir. Você deixa de
> poder — só *fulano* pode devolver.

Foco no Cancelar, igual ao diálogo de banir. O diálogo de banir e este são o
mesmo componente a partir de agora (`openConfirm({ title, text, confirmLabel,
tone })`), com `openBan` virando uma chamada dele — dois diálogos de
confirmação divergindo em detalhe de foco e de estilo é dívida nascendo.

## 5. Anotações na tela compartilhada

### 5.1 A permissão vem antes

A anotação aparece **na tela de alguém**. Quem decide se isso pode acontecer
é quem está transmitindo, e a decisão é tomada onde a transmissão nasce: uma
caixa no diálogo de compartilhar, ao lado das de áudio.

> ☐ **Deixar a sala rabiscar na minha tela**
> Todo mundo pode desenhar e escrever por cima. Só aparece pra quem está na sala.

Desmarcada por padrão; a escolha é lembrada (`config.annotations.allow`),
igual "anunciar na rede". Não é uma configuração global escondida em
Configurações — é uma propriedade **daquela transmissão**, decidida no
momento em que ela começa. Mesmo raciocínio que tirou "anunciar" das
Configurações na 0.5.0.

Consequência deliberada: **não dá pra ligar no meio da transmissão.** Parar
e compartilhar de novo é o caminho. Ligar depois exigiria um segundo
controle, na barra ou no tile, pra uma decisão que se toma uma vez.

O estado viaja no `broadcast-state` que já existe, num campo novo:

```json
{ "type": "broadcast-state", "live": true, "paused": false, "annotate": true }
```

Peer em versão antiga não manda o campo → `undefined` → falso. (A trava de
versão da 0.6.0 já impede sala com versões misturadas; isso é cinto e
suspensório.)

### 5.2 O que dá pra fazer

Dois instrumentos, o mínimo que cobre "rabiscos e escritas":

- **Caneta** — traço livre. Arrasta, solta, virou um traço.
- **Texto** — clica, digita, `Enter` fecha (`Esc` cancela). Uma linha.

Mais três ações: **desfazer** (tira o último item *meu*), **limpar os meus**
e — só pra quem é dono da tela — **limpar tudo**. Ninguém apaga o traço de
outra pessoa; o dono da tela apaga a lousa inteira, que é diferente.

Nada expira sozinho. Um rabisco que some depois de N segundos é um rabisco
que a pessoa perdeu no meio da frase; quem desenhou fecha quando quiser.

### 5.3 A cor é a identidade

Cada pessoa tem **uma** cor de pincel, igual pra todo mundo que olha. A cor
sai do id de conexão (que o servidor atribui em sequência: `1`, `2`, `3`…),
indexando uma paleta de oito tintas — então numa sala real (~4-6 pessoas)
ninguém repete cor, e todos os clientes derivam a mesma tabela sem trocar
uma mensagem sobre isso.

Esta é a exceção à regra do acento: **tinta de anotação é saturada**, e mais
de uma cor saturada aparece ao mesmo tempo. Ela é legítima porque vive num
plano que só existe **enquanto alguém desenha**, por cima de vídeo, e
porque a cor ali não está classificando estado de app nenhum — está dizendo
*quem*. A regra "saturado = alguém está ao vivo" continua valendo pra
interface; o canvas não é interface, é conteúdo.

A paleta não inclui o `--live` do tema (vermelho), pra não haver traço com a
cor que significa "ao vivo" em cima de um vídeo ao vivo.

### 5.4 Coordenadas

O `<video>` do tile é `object-fit: contain` — o conteúdo tem letterbox, e a
caixa do vídeo **não** é a caixa do tile. Todo ponto é normalizado em `0..1`
sobre a **caixa de conteúdo** (calculada do `videoWidth`/`videoHeight` e do
retângulo do elemento), com 3 casas decimais.

O que isso compra: o mesmo rabisco cai no mesmo pixel em quem está em
janela, em quem está em fullscreen e em quem recebe a tela degradada pra
720p. E o canvas pode ser redimensionado à vontade — ele é redesenhado da
lista de itens, nunca é a fonte da verdade.

### 5.5 Protocolo

Duas mensagens novas. A primeira é broadcast, como o chat:

```json
{ "type": "annotate", "surface": "<peerId da tela>", "op": "...", ... }
```

`surface` é o **dono da tela** (não quem desenha; `from` é carimbado pelo
servidor). Ops:

| op | campos | o que faz |
|---|---|---|
| `begin` | `id`, `x`, `y`, `width` | abre um traço |
| `points` | `id`, `points: [[x,y]…]` | acrescenta pontos (lote) |
| `end` | `id` | fecha o traço |
| `text` | `id`, `x`, `y`, `text`, `size` | insere uma escrita |
| `undo` | — | tira o último item **de quem mandou** |
| `clear` | `scope: "mine" \| "all"` | limpa |

A cor **não** viaja: ela é derivada de `from` nos dois lados. Um cliente não
consegue desenhar com a cor de outro.

`clear` com `scope: "all"` só é aceito de quem é o dono da superfície —
checado no cliente que renderiza, do mesmo jeito cooperativo que o resto
(o servidor não guarda estado de anotação nenhum, e não vai passar a
guardar: ele é um repassador).

Os pontos são enviados **em lote**, um `points` por quadro de animação
(≈60ms na prática, com coalescência) — não uma mensagem por `pointermove`.
Um traço de 3 segundos vira ~50 mensagens, não ~180.

A segunda mensagem é roteada (como `offer`/`answer`), e existe só pra quem
chega no meio:

```json
{ "type": "annotate-sync", "to": "<peerId>", "surface": "...", "items": [...] }
```

Quem transmite com anotação ligada manda o estado inteiro pro peer que
acabou de entrar. Sem isso, quem entra no meio de uma explicação vê a tela
limpa enquanto todo mundo discute uma seta.

### 5.6 Tetos

Tudo com teto, porque tudo isso é entrada de rede:

| Coisa | Teto | Por quê |
|---|---|---|
| itens por superfície | 400 | mais que isso ninguém lê; o mais antigo sai |
| pontos por traço | 2000 | um traço de ~30s contínuos |
| pontos por mensagem | 200 | lote de um quadro, com folga |
| texto | 120 caracteres | é rótulo, não parágrafo |
| mensagens `annotate`/s por peer | 60 | 3× o lote por quadro |

O limitador de `annotate` é **separado** do de sinalização (300/s) e do de
chat (5/s): estourar o de anotação não pode fechar o socket de quem está
desenhando rápido, e desenhar não pode consumir a cota de ICE de uma
renegociação acontecendo ao mesmo tempo.

### 5.7 Interface no tile

Um botão de lápis nasce no tile (ao lado do de fullscreen) **só** quando
aquela superfície aceita anotação. Clicar liga o modo de desenho **local** —
o canvas passa a receber ponteiro, e uma barrinha aparece embaixo:

```
┌───────────────────────────────────────────┐
│                                           │
│           (vídeo + canvas)                │
│                                           │
│        ┌──────────────────────────┐       │
│        │ ✏ │ T │ ↺ │ 🗑 │ ● │ ✕ │       │
│        └──────────────────────────┘       │
└───────────────────────────────────────────┘
```

`●` é a bolinha da **sua** cor — não é um seletor, é a legenda de quem você
é na lousa. `✕` desliga o modo (o desenho continua lá).

Com o modo desligado, o canvas é `pointer-events: none` — o duplo clique pra
fullscreen, o botão direito do mute e o arrasto do PiP continuam funcionando
exatamente como antes. Essa é a razão de o modo ser explícito em vez de
"sempre desenhando": o tile já tem quatro gestos, e roubar o arrasto de
todos eles pra caneta seria pior que um clique a mais.

## 6. Imagens no chat

### 6.1 Três formas de anexar

Botão de clipe, `Ctrl+V` com imagem na área de transferência, e arrastar em
cima da coluna do chat. As três caem no mesmo lugar: uma **prévia** acima do
campo de texto, com um `×` pra desistir. Sai com o `Enter` que já manda a
mensagem — e pode ir com legenda, se houver texto no campo.

Prévia antes de mandar, e não envio direto, porque colar imagem por engano é
comum e chat não tem apagar.

### 6.2 Tamanho

Imagem grande não é generosidade: o servidor de sinalização roda no **PC de
quem criou a sala**, e o histórico de 50 mensagens vive na memória dele.

- Reduzida no cliente: no máximo 1280px no maior lado, JPEG 0,82.
- Se ainda passar de 200 KB, reencoda mais barato (0,7 → 0,6 → 1024px →
  800px), nessa ordem, até caber.
- GIF **não** passa por canvas (perderia a animação) — vai como está, e é
  recusado com aviso se passar de 200 KB.
- Teto de 200 KB (caracteres do data URL) checado **de novo no servidor**.
  O `maxPayload` de 512 KB do socket continua sendo o teto duro.

### 6.3 Memória do host

50 mensagens × 200 KB seria 10 MB de imagem pendurados no processo de quem
hospeda, pra quem entrar depois ver prints de meia hora atrás.

Regra: o histórico guarda no máximo **8 imagens**. Ao entrar a nona, a
mensagem-imagem mais antiga sai do histórico inteira (o texto dela também) —
teto real de ~1,6 MB. Quem estava na sala continua vendo tudo o que chegou:
o corte é só no que se conta pra quem chega depois.

Rajada: além do limitador de 5 msg/s do chat, no máximo **3 imagens a cada
5 segundos** por pessoa.

### 6.4 Exibição

Miniatura de até 240px de largura na linha do chat, cantos arredondados,
proporção preservada (as dimensões viajam na mensagem, então a linha não
"pula" quando a imagem carrega). Clique abre em tela cheia sobre um véu,
`Esc`/clique fecha. Sem download, sem menu — é uma conversa, não um gerenciador de arquivos.

O CSP já permite `img-src 'self' data: blob:`. Nada muda ali.

## 7. Emoji

Botão de rosto no compose, ao lado do clipe. Abre um painel ancorado acima
do campo com:

- **Recentes** (até 24, guardados no config local),
- oito categorias com âncoras, ~380 emoji no total,
- **busca** por palavra-chave em português ("coracao", "risada", "festa").

Inserção **no cursor** (não no fim), o painel continua aberto pra mandar
três seguidos, `Esc` fecha, e o foco volta pro campo.

Os dados vivem num módulo próprio (`emoji.js`) com a busca como função pura
e testada — a lista é dado, e dado grande no meio da UI é como `ui.js`
chegou a 2100 linhas.

Emoji é texto Unicode: não muda o protocolo, não muda o teto de 500
caracteres, não precisa de nada no servidor.

## 8. O que este documento não faz

- **Anotação sobre câmera.** Só tela. Rabiscar no rosto de alguém não é o
  caso de uso, e o tile de câmera é pequeno demais pra caber a barra.
- **Ligar anotação no meio da transmissão.** §5.1.
- **Persistir anotação entre transmissões.** Parou de compartilhar, a lousa
  morre com a tela.
- **Arquivo qualquer no chat.** Só imagem. Um repassador de arquivos na
  memória do host é outra feature, com outros problemas (vírus, disco, nome
  de arquivo).
- **Emoji personalizado / reação em mensagem.** Precisa de identidade de
  mensagem e de UI de hover; fica pra depois.
