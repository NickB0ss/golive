# A sala vira mesa: telas, câmeras, jogos e vídeo que todo mundo mexe

Data: 2026-09-24. Plano de redesign (estrutura + visual + produto). Nada
implementado ainda.

Pedido, em duas partes:

1. "Um redesign total, mudando a estrutura. Esse foi um dos melhores designs
   que tivemos."
2. "Dentro da sala, algo tipo um fundo interativo: mexer a posição das telas e
   das câmeras, mudar o tamanho, adicionar jogos como xadrez e Akinator, pôr um
   YouTube sincronizado em vez do compartilhamento de tela. Tudo acontecendo
   para todo mundo, bem interativo, com várias opções do que fazer."

A segunda parte muda o que o app é. Hoje o GoLive é "compartilhar a tela com os
amigos". Depois dela passa a ser **o lugar onde os amigos ficam juntos**, e
compartilhar tela vira uma entre várias coisas que dá para pôr na mesa.

---

## 0. Tese

**A sala é uma mesa.** Uma superfície que todos veem igual, com as coisas em
cima dela: a tela do Rafa, a câmera da Bia, um tabuleiro de xadrez, um vídeo do
YouTube. Qualquer pessoa pode arrastar, redimensionar, pôr e tirar coisas, e
todo mundo vê a mudança na hora. Os ponteiros dos amigos andam pela mesa, cada
um com a sua cor.

O que faz isso caber no GoLive, e não num app qualquer de "watch party":

- **Tudo é P2P na LAN virtual.** O estado da mesa mora no servidor de
  sinalização embutido de quem criou a sala, como o histórico do chat já mora.
  Nada de conta nem nuvem.
- **Ver um vídeo junto custa quase nada de rede.** O YouTube sincronizado não
  passa vídeo pela rede da sala: cada PC toca o próprio stream e a sala só
  troca "play, pause, posição", alguns bytes. É o oposto do compartilhamento de
  tela, que é a coisa mais cara que o app faz. No Radmin a menos de 10 Mbps,
  assistir junto passa a funcionar onde compartilhar não funcionava.
- **O tamanho de cada tela na mesa vira dado de qualidade.** Tela pequena na
  mesa pede camada menor a quem transmite (`peerquality.js`), e tela
  minimizada solta o encoder (`view-state {watching:false}`). A mesa dá à
  escada de qualidade um sinal que hoje ela não tem.

---

## 1. O que não muda

Decisões anteriores que seguem valendo:

- **Marca**: tema `marca` (neutros violeta, ação `#5B4BE8`), Outfit + Work
  Sans locais, os sete presets e o tema próprio com código.
- **`--live` significa só "alguém está ao vivo".** Nenhuma cor de pessoa,
  jogo ou destaque novo usa vermelho (ver §6.2, paleta de pessoas).
- **Nada de `backdrop-filter` nem `filter` sobre conteúdo vivo.** Só
  `transform` e `opacity` animam. Na mesa isso pesa mais: são vários vídeos e
  iframes numa superfície só, na mesma GPU que o jogo e o encoder.
- **Cor só por token**, piso de 11 px, foco visível, `css-rules.test.js`.
- **Trava de versão**: a sala inteira na mesma versão. Isso libera mudar o
  protocolo sem manter compatibilidade.
- **Contrato com o JS**: ids do `index.html` que continuam fazendo sentido
  continuam existindo. O palco (`#grid`, `.grid-main`, `.grid-strip`) é
  substituído por inteiro (ver §8); essa é a quebra de contrato desta vez, e é
  intencional.
- **Glossário**: "sala", "líder da sala", "transmissão", "tela", "assistir",
  "rabisco", "Sair da sala", "pessoa". Termos novos em §9.

---

## 2. Modelo da mesa

### 2.1 Um mundo fixo, não um canvas infinito

A mesa tem **tamanho lógico fixo de 1600 × 900 unidades (16:9)**. Cada
cliente escala o mundo inteiro para caber no espaço que tem (um `transform:
scale()` no contêiner), com faixa nas bordas quando a proporção da janela não
bate.

Por que não um canvas infinito com pan e zoom (estilo Figma ou Miro):

- **"O que eu vejo é o que você vê."** Com mundo fixo, "o xadrez está no canto
  de cima à direita" é verdade na tela de todo mundo. Num canvas infinito cada
  um olha para um pedaço diferente e a conversa vira "cadê o vídeo?".
- **Posição normalizada já é o padrão do projeto.** O rabisco guarda
  coordenadas 0..1 sobre o conteúdo do vídeo para cair no mesmo pixel em
  janela, tela cheia e recepção degradada. A mesa aplica a mesma ideia a um
  nível acima.
- É mais barato: não há viewport por pessoa para sincronizar.

O que é **local**, por pessoa, sem afetar os outros:

- **Foco**: duplo clique num item (ou `Enter` com ele focado) abre o item
  sozinho ocupando a mesa, só para você. `Esc` volta. É o "tela cheia" de hoje,
  reaproveitado.
- **Volume** de cada tela e do YouTube.
- **Coluna lateral** aberta ou fechada (a mesa só reescala).

### 2.2 Itens

Tudo em cima da mesa é um **item**:

```
item = {
  id,          // gerado pelo servidor
  type,        // 'screen' | 'camera' | 'youtube' | 'chess' | 'board' | ...
  x, y, w, h,  // unidades do mundo, inteiros, dentro de 0..1600 × 0..900
  z,           // ordem de empilhamento
  owner,       // quem pôs (ou o dono da tela/câmera)
  locked,      // travado: só owner e líder mexem
  props,       // específico do tipo: videoId, estado do jogo, ...
}
```

- **Telas e câmeras entram sozinhas.** Quem liga a câmera ou vai ao vivo ganha
  um item novo, posicionado pelo "Organizar" (§2.4) no primeiro espaço livre.
  Quem desliga perde o item. É o que a grade faz hoje, só que agora dá para
  mover depois.
- **Atividades** (jogos, vídeo, ferramentas) entram pela gaveta "Adicionar à
  mesa" (§5.3) e saem pelo menu do item.
- **Tamanho mínimo** por tipo (tela 240 × 135, xadrez 320 × 360, nota 160 ×
  120). **Proporção travada** em tela, câmera e vídeo; livre nas ferramentas.
- **Encaixe**: a borda de um item encaixa numa grade de 8 unidades e nas bordas
  dos vizinhos, com guias finas em `--act` durante o arraste. `Alt` desliga o
  encaixe.

### 2.3 Quem pode mexer

- **Padrão da sala: todo mundo mexe.** O pedido foi "algo que acontece para
  todos". Numa sala de amigos, travar por padrão só adiciona atrito.
- **O líder pode trocar para "Só o líder arruma a mesa"** (menu do cabeçalho).
  Quem não pode mexer vê o cursor normal, sem alça.
- **Travar um item** (menu do item): só quem pôs e o líder mexem nele.
- A regra vale **no servidor**, não só na interface, como a do rabisco
  (`annotate.opAllowed`).

### 2.4 Organizar

Um botão no dock pega todos os itens e distribui de novo, sem sobreposição.
Tem três arranjos:

- **Palco**: a tela mais importante grande, o resto numa faixa. É o
  `gridlayout.js` de hoje, só que devolvendo retângulos do mundo em vez de
  classes. O teste dele continua valendo.
- **Grade**: tudo do mesmo tamanho.
- **Lado a lado**: dois itens dividindo a mesa (xadrez + câmera do adversário,
  vídeo + chat de câmeras).

"Organizar" é uma operação da mesa como outra qualquer: acontece para todos e
anima (FLIP em `transform`, 240 ms).

---

## 3. Sincronização

### 3.1 Onde mora o estado

No **servidor de sinalização embutido** (`server/signaling-core.js`), igual ao
`chatHistory`:

- O `welcome` passa a levar `mesa: { seq, mode, items }`. Quem entra na sala
  recebe a mesa pronta, sem pedir a ninguém.
- Na migração de sala, `initialMesa` entra junto de `initialChatHistory` e
  `initialBans` como semente do servidor novo (`src/main.js:1081`). Uma queda do
  líder não apaga o xadrez no meio.
- Cada operação aceita ganha um `seq` crescente e é repassada a todos com ele.
  O cliente aplica na ordem do `seq`. Se receber um buraco (seq 41 depois do
  39), pede o retrato de novo (`mesa-sync`), como o `annotate-sync`.

### 3.2 Dois canais: mudança e movimento

Arrastar gera dezenas de posições por segundo, e gravar cada uma no estado
seria um desperdício. Então há dois canais:

| Canal | Quando | Guardado? | Frequência |
|---|---|---|---|
| `mesa` (operação) | soltar, redimensionar, pôr, tirar, travar, jogada, play/pause | **sim**, com `seq` | por ação |
| `mesa-drag` (movimento) | durante o arraste | **não**, descartável como o laser | até 20 Hz |
| `cursor` (presença) | mouse sobre a mesa | **não** | até 20 Hz, some em 1 s parado |

`mesa-drag` e `cursor` seguem o laser (`laser.js`): função pura que decide
quando pode sair, último ponto por pessoa, tempo de vida pelo relógio de quem
desenha. Cabem com folga no limite do servidor (300 mensagens/s por pessoa).

Quem recebe um `mesa-drag` desenha o item sendo levado com interpolação de
~50 ms, para não pular. Quando chega o `mesa` do soltar, a posição final
vale.

### 3.3 Duas pessoas pegando o mesmo item

Pegar um item pede a vez ao servidor (`grab`). O servidor dá a vez por 5 s,
renovada a cada movimento. Enquanto alguém segura, a operação de outra pessoa
naquele item é recusada, e ela vê na alça: "Bia está movendo". Sem vez ninguém
briga pelo mesmo item, e o item nunca fica tremendo entre duas posições.

### 3.4 Atividades: estado do tipo, regra compartilhada

Cada atividade é um módulo **puro** no padrão UMD que o projeto já usa
(`annotate.js`, `laser.js`), carregado **no renderer e no servidor**:

```
atividade = {
  type, label, icon, defaultSize, minSize, aspect,
  init(options)            -> props iniciais
  validate(props, action, from, room) -> bool   // roda no servidor
  reduce(props, action, from)        -> props   // roda nos dois lados
  view(el, props, api)                           // só no renderer
}
```

- O servidor roda `validate` e `reduce` e só repassa o que passou. Jogada
  ilegal de xadrez, voto duplicado ou play de quem não pode nem sai.
- `reduce` é determinístico. Os clientes aplicam a mesma função na mesma ordem
  e chegam ao mesmo estado; o retrato do `welcome` resolve quem chega depois.
- Teste é `node --test` puro no reducer, sem DOM, como o resto do projeto.

---

## 4. Atividades

### 4.1 Primeira leva

| Atividade | O que é | Por que entra agora |
|---|---|---|
| **YouTube junto** | Vídeo sincronizado, com fila | Pedido explícito; é o maior ganho de rede (§0) |
| **Xadrez** | Duas pessoas jogam, o resto assiste e comenta | Pedido explícito |
| **Quadro** | Folha em branco para rabiscar junto | Reaproveita o rabisco inteiro (`annotate.js`) sobre uma superfície sem vídeo |
| **Desenha e adivinha** | Uma pessoa desenha no Quadro, as outras chutam no chat | Junta Quadro + chat; o jogo de grupo mais pedido em app de amigos |
| **Dados e sorteio** | Dados, cara ou coroa, sortear uma pessoa da sala | Pequeno; resolve "quem escolhe o próximo jogo" |
| **Enquete** | Uma pergunta, opções, voto com o avatar de quem votou | Pequeno; decide o filme sem briga no chat |

### 4.2 Segunda leva

Jogo da velha, Lig 4, "Quem sou eu?" (cada pessoa recebe um personagem que só
os outros veem), nota adesiva, cronômetro, placar.

### 4.3 Sobre o Akinator

**O Akinator não tem API pública.** As bibliotecas que existem raspam o site
deles, quebram quando o site muda e esbarram nos termos de uso. Uma atividade
que para de funcionar sem aviso no meio de uma sala é pior do que não ter a
atividade.

Duas opções, a decidir:

- **"Adivinha quem" do grupo, feito aqui (recomendado).** Uma pessoa pensa num
  personagem e as outras perguntam com botões de sim/não/talvez, com contador
  de perguntas. É o espírito do Akinator com gente no lugar do robô, e roda
  offline na LAN.
- **"Site junto", mais tarde.** Um item que abre a mesma página para todo
  mundo, sem sincronizar cliques. Serve para o Akinator e para qualquer outro
  site, mas cada pessoa joga o seu, e isso é outro projeto (isolamento de
  `<webview>`, CSP, navegação).

### 4.4 YouTube junto, em detalhe

**Colocar**: colar um link do YouTube no chat mostra "Assistir junto na mesa"
logo abaixo da mensagem. O vídeo também pode entrar pela gaveta, colando o
link.

**Estado** (no item): `{ videoId, playing, pos, at, rate: 1, queue: [] }`,
onde `pos` é a posição em segundos no instante `at` (relógio do servidor).

**Relógio**: cada cliente mede a diferença do próprio relógio para o do
servidor com uma mensagem nova `time` (ida e volta, a de menor atraso entre 5
ao entrar, refeita a cada 60 s). O `probe` que já existe não serve: ele é de
antes do `join` e fecha a conexão. A posição esperada é
`pos + (agora_servidor − at)`.

**Correção de deriva** (a cada 1 s, só com o vídeo tocando):
- menos de 0,3 s de diferença: nada;
- entre 0,3 e 1,5 s: `playbackRate` 1,05 ou 0,95 até alcançar (imperceptível);
- mais de 1,5 s: salto (`seekTo`).

**Anúncio e carregamento**: não dá para pular anúncio nem para sincronizar
anúncio. Quem cai num anúncio ou fica carregando aparece com um selo no item
("Leo: carregando…"). Por padrão o vídeo segue e a pessoa alcança sozinha
depois. Um interruptor "Esperar todo mundo" (desligado por padrão) pausa para
todos enquanto alguém carrega.

**Quem controla**: todo mundo, a não ser que o item esteja travado. Play,
pause e salto são operações `mesa` normais, com `seq`.

**Técnica** (spike obrigatório antes de implementar, §10):
- O player entra como `<iframe>` de `youtube-nocookie.com/embed/…?enablejsapi=1`
  e é comandado **por `postMessage`**, sem carregar o script da IFrame API na
  página. Carregar script remoto na janela principal daria a código de fora
  acesso a `window.golive` (criar sala, firewall). Com o iframe, o código do
  YouTube fica em outra origem e só conversa por mensagem.
- CSP: `frame-src https://www.youtube-nocookie.com` e nada além disso.
  `script-src` continua `'self'`.
- A página sai de `file://` (`win.loadFile`), e o player do YouTube recusa
  embed sem `Referer` (erro 153). Há duas saídas a testar no spike: servir o
  renderer por um protocolo próprio (`app://golive/`) ou pôr `Referer` só nos
  pedidos a domínios do YouTube via `session.webRequest`.
- Cada PC precisa de internet para o YouTube. Sem internet, o item diz isso no
  lugar do player ("Sem internet neste PC — o vídeo continua para os outros").

**Custo em quem joga**: um player do YouTube decodificando vídeo compete pela
GPU com o jogo de quem transmite. O item tem "Só o som" no menu, que esconde o
iframe localmente e mantém o áudio sincronizado.

### 4.5 Xadrez, em detalhe

- **Sentar**: duas cadeiras ("Jogar de brancas", "Jogar de pretas"). O resto
  assiste, e qualquer um pode trocar de lugar quando uma cadeira vaga.
- **Regras**: validação completa no reducer (xeque, roque, en passant,
  promoção, empate por afogamento ou repetição). Recomendação: vendorizar o
  `chess.js` (BSD-2) em `src/renderer/vendor/` em vez de escrever um validador.
  São ~1 500 linhas testadas, sem dependência, e seguem a regra do projeto de
  não carregar nada da rede.
- **Relógio** opcional (5 + 3, 10 + 0, sem relógio), com dígitos tabulares.
- **Visual**: tabuleiro nos tokens (casas em `--s3`/`--s4`, destaque do último
  lance em `--act` a 30 %), peças em SVG local. Quem joga de pretas vê o
  tabuleiro virado; quem assiste vê do lado das brancas.
- Arrastar peça e clicar origem → destino funcionam. Pelo teclado, as setas
  andam pelas casas e `Enter` escolhe.

---

## 5. Estrutura nova

### 5.1 Sala

```
┌─ faixa de título (32) ────────────────────────────────────── ⚠ ─ □ ✕ ┐
│ ● CS de sexta          26.114.8.33 ⧉  PIN 482913   (R)(B)(L)+2  ⋯  ⟩ │ cabeçalho 48
│┌────────────────────────── MESA ─────────────────────────┐┌─────────┐│
││ ┌───────────────────────────┐   ┌──────────┐  ↖ Bia     ││ Pessoas ││
││ │ ● AO VIVO  Tela do Rafa   │   │ ♞ Xadrez │            ││  · Chat ││
││ │                           │   │ Rafa×Leo │            ││─────────││
││ │                           │   │          │            ││ Rafa:   ││
││ │                           │   └──────────┘            ││ bora    ││
││ └───────────────────────────┘   ┌──────┐┌──────┐        ││         ││
││ ┌───────────────┐    ↖ Leo      │ Bia  ││ Leo  │        ││         ││
││ │ ▶ YouTube     │               └──────┘└──────┘        ││         ││
││ └───────────────┘                                       ││ [ ... ] ││
│└─────────────────────────────────────────────────────────┘└─────────┘│
│      [▣ Compartilhar tela] [◉] [◫] │ [+ Adicionar à mesa] [⊞ ▾] │ [⚙] [⏻]  │ dock
└──────────────────────────────────────────────────────────────────────┘
```

- **Cabeçalho de 48 px**, sem fundo. Status e nome à esquerda; endereço e PIN
  como chips; **pilha de avatares** de quem está na sala (clicar abre a aba
  Pessoas; `+N` quando não cabem); `⋯` com as opções da sala ("Só o líder
  arruma a mesa", fundo da mesa); recolher coluna.
- **Mesa** ocupa o resto, com `--r-lg` e um fundo próprio (§6.1). O mundo 16:9
  escala para caber e centraliza.
- **Dock** na base, fora da mesa e no fluxo do layout, como hoje. Três grupos:
  1. o que sai de você: Compartilhar tela (pílula com rótulo, secundária),
     câmera, pausar e trocar quando ao vivo;
  2. a mesa: **Adicionar à mesa** (pílula com rótulo e a **única primária** da
     tela: é a porta de entrada de tudo, compartilhar tela incluído) e
     **Organizar** (com a escolha de arranjo num menu);
  3. Configurações e Sair da sala.
- **Coluna lateral**: continua com as abas Pessoas e Chat, 320 px. A mesa
  reescala quando ela abre ou fecha. Abaixo de 1100 px de largura a coluna
  começa fechada.
- **Interface some com o mouse parado** (`.room-idle`): cabeçalho, dock, alças
  dos itens e cursores alheios parados. Os itens em si ficam.

### 5.2 Anatomia de um item

```
┌────────────────────────────────────────┐
│ ⠿ ♞ Xadrez · Rafa × Leo        (R) ⋯ ✕ │  alça: aparece no hover/foco
├────────────────────────────────────────┤
│                                        │
│              conteúdo                  │
│                                        │
└───────────────────────────────────────◢┘  canto de redimensionar
```

- **Alça** de 32 px no topo, sobreposta ao conteúdo e visível só no hover ou
  no foco (com o mouse parado some também). Leva: pegador, ícone e título do
  tipo, avatar de quem pôs, `⋯` (Travar, Trazer para frente, Tirar da mesa,
  opções do tipo) e `✕` (Tirar da mesa). Sem alça o vídeo fica limpo, que é o
  que já se faz com os controles do tile.
- **Arrastar pela alça**, não pelo conteúdo. O conteúdo é do item: no xadrez é
  onde se move peça, no quadro é onde se rabisca, no YouTube é o player.
- **Redimensionar** pelo canto inferior direito (alvo de 24 px; o traço
  desenhado é menor) e pelas bordas.
- **Pegar levanta o item**: sombra `--shadow-2` → `--shadow-3` e `scale(1.015)`,
  e ele vai para cima de tudo. Soltar assenta (160 ms, desaceleração).
- **Item de outra pessoa sendo levado**: contorno na cor dela e o nome na alça
  ("Bia está movendo").
- Telas mantêm tudo que já existe no tile: "ao vivo", olho de quem assiste,
  reações, rabisco, pausa, chip de saúde. Só mudam de moldura.

### 5.3 Gaveta "Adicionar à mesa"

Um painel que sobe do botão do dock (animação saindo do gatilho), com três
grupos em grade de cartões (ícone + nome + uma linha do que é):

- **Assistir junto**: YouTube.
- **Jogos**: Xadrez, Desenha e adivinha, Adivinha quem; depois Velha, Lig 4.
- **Ferramentas**: Quadro, Enquete, Dados e sorteio; depois Nota e
  Cronômetro.

Escolher põe o item no primeiro espaço livre da mesa, com a entrada animada
saindo da gaveta. O item novo recebe o foco. Atividades que pedem algo antes
(link do vídeo, pergunta da enquete) abrem um passo curto dentro da gaveta, sem
modal por cima.

### 5.4 Mesa vazia

Sala sem nada é a primeira coisa que quem cria vê. Em vez do palco vazio de
hoje, a mesa vazia mostra **três sugestões grandes** no meio: "Compartilhar
tela", "Assistir um vídeo junto", "Jogar xadrez". São atalhos para a gaveta,
com a linha "Tudo que você puser aqui aparece para todo mundo da sala."

### 5.5 Lobby

O lobby fica na casca da 0.16.0 (barra lateral + cards). Muda:

- **O card da sala conta o que está rolando.** O beacon UDP ganha um resumo
  curto da mesa (`["screen","youtube","chess"]`, 3 pessoas ao vivo), e o card
  mostra ícones e uma linha: "Xadrez · YouTube · 1 tela ao vivo". Entrar deixa
  de ser às cegas.
- **Salas recentes** (buraco nº 3 da auditoria de produto): as últimas 5 salas
  em que você entrou ficam salvas com nome e endereço. Resolve o Tailscale, que
  não repassa broadcast e deixa a lista da rede vazia para sempre.

### 5.6 Configurações, diálogos, seletor de fonte

Sem mudança estrutural. O seletor de fonte perde a pergunta "Rabisco" (o
rabisco vira opção do item da tela, no `⋯`, ligável a qualquer momento pelo
dono da tela).

---

## 6. Direção visual

A marca fica. O que muda é que a sala ganha um **material**, a mesa, e
**presença**, as mãos dos amigos.

### 6.1 A mesa

- Token novo `--mesa`: um passo acima do `--bg` (no `marca`, `#0D0D14`), com
  uma **grade de pontos** em `--line` a cada 32 unidades, desenhada uma vez
  por `radial-gradient` estático. Dá a sensação de superfície, e os pontos são
  a mesma grade do encaixe, então explicam o encaixe sem texto.
- **Fundo da mesa** escolhido pelo líder, para todos: Pontos (padrão), Liso,
  Feltro (um tom do `--act` bem escuro, derivado por `color-mix`) e Papel
  quadriculado. São todos estáticos. Nada animado nem de vídeo no fundo, pela
  regra da GPU.
- Cada tema define o seu `--mesa`; a trava de contraste passa a medir `--tx2`
  sobre `--mesa`.

### 6.2 Assinatura: os ponteiros dos amigos

O que faz esta mesa ser lembrada: **ver a mão de cada amigo andando por ela**.
Uma seta pequena com um chip de nome, na cor da pessoa, seguindo o mouse dela
com interpolação. Parou por 1 s, esmaece; saiu da mesa, some.

- A cor da pessoa vem de `annotate.colorFor` (a mesma do rabisco), então a
  mesma pessoa tem a mesma cor no cursor, no rabisco, no contorno do item que
  ela leva e no voto da enquete. Uma cor, uma pessoa, em todo o app.
- **A paleta de pessoas não pode ter vermelho perto do `--live`.** A `PALETTE`
  do `annotate.js` já não tem vermelho (verde, azul, âmbar, rosa, violeta,
  ciano, laranja, gelo). Dois vizinhos precisam de cuidado: o âmbar `#FBBF24`
  fica perto do `--warn`, e o violeta `#A78BFA` perto do `--act`, que é a cor
  das guias de encaixe. Por isso o contorno de "Bia está movendo" usa sempre o
  nome junto, nunca só a cor, e as guias são tracejadas. O texto do chip do
  ponteiro é escuro sobre a cor da pessoa; conferir ≥ 4,5:1 nas oito.
- Ligável em Configurações > Aparência ("Mostrar o ponteiro de quem está na
  sala"). Ligado por padrão.

### 6.3 Tipografia

- Outfit no título da alça, no nome da sala e nos nomes das atividades na
  gaveta.
- Work Sans no resto.
- `font-variant-numeric: tabular-nums` em relógio de xadrez, tempo do vídeo,
  placar e contagem de votos. Não entra fonte nova.
- A escala `--fs-*` (acabamento P3) continua a única fonte de tamanho.

### 6.4 Movimento

Durações e curvas só pelos tokens que já existem (`--dur-fast/base/slow`,
`--ease-enter/out/move/in-out`). Um token novo só se a tabela abaixo pedir uma
duração que nenhum deles cobre.

| Momento | Como | Duração |
|---|---|---|
| Item entra | `scale(.96)` → 1 + opacidade, saindo da gaveta | 180 ms, desacelera |
| Item sai | opacidade + `scale(.98)` | 120 ms, acelera |
| Pegar / soltar | sombra + `scale(1.015)` | 120 / 160 ms |
| Organizar | FLIP em `transform` | 240 ms |
| Arraste alheio | interpolação linear até o último ponto | 50 ms |
| Ponteiro alheio parado | esmaece a 0,4 e some | 1 s / 3 s |

Com `prefers-reduced-motion`: sem escala, sem FLIP, troca direta. Os ponteiros
continuam aparecendo, sem suavização.

### 6.5 Acessibilidade específica da mesa

- **Todo arrastar tem alternativa de teclado.** Item focado: setas movem 8
  unidades (Shift, 40); `Alt`+setas redimensionam; `Delete` tira da mesa (com
  desfazer por 5 s no aviso); `Enter` foca/expande; `Esc` volta.
- A mesa é uma região com `aria-label="Mesa da sala"`; cada item é um `group`
  com nome ("Xadrez, de Rafa, travado"). A ordem de tabulação segue a ordem de
  leitura (de cima para baixo, da esquerda para a direita), não o `z`.
- Mudanças de outras pessoas **não roubam o foco** e são anunciadas numa região
  `aria-live` educada, em frase inteira e agrupadas ("Bia pôs um Xadrez na
  mesa"). Arrastes alheios não são anunciados.
- Foco nunca fica escondido atrás de outro item: o item focado sobe no `z`
  local enquanto tiver foco.

---

## 7. Qualidade e desempenho

- **Tamanho na mesa vira pedido de qualidade.** O tamanho em pixels na tela de
  quem assiste (unidades × escala local) entra no `peerquality` como teto: não
  há por que mandar 1080p para uma tela de 400 px. Quem transmite passa a
  gastar menos encoder numa mesa cheia.
- **Item fora de vista não consome.** Tela coberta 100 % por outro item ou com
  o foco local em outro item manda `watching:false` depois de 2 s (histerese,
  para arrastar por cima não derrubar o encoder).
- **Uma camada de composição por item**, não por vídeo: `will-change:
  transform` só durante o arraste e retirado ao soltar.
- **Iframes do YouTube**: no máximo um tocando com imagem por cliente. Um
  segundo vídeo na mesa entra pausado, com "Tocar este" (uma sala com dois
  vídeos tocando juntos é barulho, não recurso).
- Orçamento a medir no laboratório: mesa com 2 telas, 3 câmeras, YouTube e
  xadrez a 1366 × 768 sem cair quadro no tile principal.

---

## 8. Plano de implementação

Cada fase termina num estado lançável, com `npm test`, `npm run lint`, prints
do app real e roteiro de teste manual.

### Fase 0 — Spikes e decisões (curta)

1. **YouTube no Electron**: embed a partir de `file://`, erro 153, `Referer`
   por `webRequest` × protocolo próprio, comando por `postMessage`, anúncios.
   Sai daqui um "funciona / não funciona / funciona com X".
2. **Mesa com vídeos escalados**: 5 `<video>` + 1 iframe num contêiner com
   `transform: scale()`, arrastando, medindo quadros no Chromium do app.
3. **Glossário**: aprovar os termos da §9 e pôr no `glossario.test.js`.

### Fase 1 — A mesa, com o que já existe

- `src/renderer/mesa.js` (puro, UMD): modelo, operações, validação de geometria
  e permissão, reducer, `seq`. Testado sem DOM.
- `server/signaling-core.js`: `mesa`, `mesa-drag`, `cursor`, `grab`; `mesa`
  no `welcome`; `initialMesa` na migração; testes e2e (entrar depois, migrar
  com a mesa montada, duas pessoas pegando o mesmo item).
- `src/renderer/mesa-view.js`: mundo escalado, itens, alça, arrastar,
  redimensionar, encaixe e guias, foco local, teclado, `aria-live`.
- Telas e câmeras viram itens. `ui.showTile` passa a montar o tile **dentro**
  de um item em vez de `.grid-main`/`.grid-strip`; tudo que vive no tile
  (reações, rabisco, olho, pausa, saúde) continua lá. O `gridlayout.js` vira o
  arranjo "Palco" do Organizar.
- Ponteiros dos amigos.
- Laboratório: cenário novo `mesa-migracao` (líder cai com a mesa montada).

Esta fase já entrega metade do pedido (mexer posição e tamanho das telas e
câmeras, para todos) sem nenhuma atividade nova.

### Fase 2 — A casca nova da sala

- Cabeçalho de 48 px com pilha de avatares e menu da sala.
- Dock em três grupos, gaveta "Adicionar à mesa", Organizar com menu.
- Mesa vazia com sugestões. Fundo da mesa e `--mesa` nos sete presets.
- Coluna lateral que começa fechada abaixo de 1100 px.
- Rabisco sai do seletor de fonte e vai para o `⋯` da tela.

### Fase 3 — YouTube junto

- Módulo `atividades/youtube.js` (reducer + validação) e a view com o player
  por `postMessage`.
- Relógio do servidor pela mensagem `time`, correção de deriva, selo de carregando,
  "Esperar todo mundo", "Só o som", fila.
- "Assistir junto na mesa" em link colado no chat.
- CSP e `Referer`/protocolo conforme o spike.

### Fase 4 — Jogos e ferramentas

- Registro de atividades (`atividades/index.js`) carregado nos dois lados.
- Xadrez (com `chess.js` vendorizado), Quadro, Desenha e adivinha, Dados e
  sorteio, Enquete.
- Depois: Adivinha quem, Velha, Lig 4, Nota, Cronômetro.

### Fase 5 — Lobby e acabamento

- Resumo da mesa no beacon e nos cards; salas recentes.
- Revisão de contraste de `--mesa` e da paleta de pessoas em todos os temas;
  passada de acessibilidade com Playwright (teclado de ponta a ponta na mesa).

---

## 9. Glossário novo

| Conceito | Termo | Nunca use |
|---|---|---|
| A superfície compartilhada da sala | **mesa** | palco, canvas, quadro |
| Qualquer coisa em cima da mesa | **item** (só no código); na interface, o nome do próprio item | widget, janela, card |
| Jogo, vídeo ou ferramenta posto pela gaveta | **atividade** | app, plugin |
| Pôr / tirar | **Adicionar à mesa** / **Tirar da mesa** | inserir, remover, fechar |
| Redistribuir tudo | **Organizar** | auto-layout, reorganizar |
| Ver um item sozinho, só para você | **Focar** / **Voltar à mesa** | maximizar |
| O vídeo sincronizado | **Assistir junto** | watch party, sincronizar |

"Quadro" fica para a ferramenta de rabiscar em folha branca; por isso não pode
nomear a mesa. "Quadro" como imagem de vídeo segue só no texto técnico
(`STATUS.md`), nunca na interface.

---

## 10. Riscos

| Risco | Tamanho | Resposta |
|---|---|---|
| YouTube recusa embed a partir de `file://` | alto | Spike na fase 0; protocolo próprio ou `Referer` por domínio |
| Anúncios dessincronizam | médio | Selo "carregando", alcança sozinho; "Esperar todo mundo" opcional |
| `ui.js` (4 400 linhas) acoplado ao palco | alto | Fase 1 só troca onde o tile mora; tudo de dentro do tile fica igual |
| GPU de quem joga com mesa cheia | médio | Tamanho vira teto de qualidade; um vídeo com imagem por vez; "Só o som" |
| Brigas de arraste | baixo | Vez por item no servidor (§3.3) |
| Estado grande demais para o `welcome` | baixo | Teto de 24 itens por mesa e de tamanho de `props` por tipo, validado no servidor |
| Akinator | — | Fora; "Adivinha quem" do grupo (§4.3) |

---

## 11. Decisões em aberto (para o Nicolas)

1. **Quem mexe por padrão**: todo mundo (recomendado) ou só o líder?
2. **Akinator**: trocar por "Adivinha quem" do grupo agora e deixar "Site
   junto" para depois?
3. **Ordem das fases 3 e 4**: YouTube antes do xadrez (recomendado: maior
   ganho e o spike já estará feito) ou o contrário?
4. **Mundo fixo 16:9** (recomendado) ou canvas infinito com zoom?

## Verificação (por fase)

`npm test`, `npm run lint`, prints do app real (Playwright com a API
`window.golive` simulada, e o hook `--require` no Electron) a 1440 × 900,
1366 × 768 e 900 × 600, tema Papel incluído; laboratório com o cenário da mesa;
roteiro manual com 2+ PCs reais antes de lançar cada fase.
