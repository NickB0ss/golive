# Brief funcional — A Mesa

Documento do time Arqueologia Funcional (parte Mesa) para o redesign greenfield do GoLive LAN.
Cobre exclusivamente a **Mesa**: a superfície compartilhada dentro de uma sala onde as pessoas põem
janelas de atividade. Outro documento cobre o resto do app (sala, palco de vídeo/Transmissão, lobby,
configurações etc.).

**Como ler este documento.** Ele descreve *o que* a Mesa precisa fazer, para quem, com que dados, sob
que permissões e com que restrições técnicas — nunca *como* ela se parece hoje. Nenhuma cor, fonte,
raio, sombra, posição de controle ou composição de tela é mencionada. Quando um tamanho aparece, é
sempre como restrição funcional de conteúdo (ex.: "este módulo precisa de uma área mínima de X por Y
para continuar jogável"), nunca como descrição do formato de uma janela, barra ou botão. O time de
design é livre para inventar a forma inteira da Mesa a partir daqui.

---

## 1. O que é a Mesa (conceito)

A Mesa é uma **superfície compartilhada por sala**: um espaço bidimensional de tamanho fixo e finito
(hoje modelado como um retângulo de 4800 por 3000 unidades) onde pessoas da sala colocam "janelas" de
atividades (jogos, ferramentas, mídia). O espaço em si — quais janelas existem, onde estão, com que
tamanho e em que estado — é **estado da sala**, igual para todo mundo e mantido pelo servidor da sala.

O que **não** é compartilhado é o **enquadramento**: cada pessoa escolhe, só para si, para onde olha
dentro desse espaço (arrastando o fundo, aproximando/afastando, indo para um ponto específico). Uma
pessoa pode estar olhando o canto onde está o xadrez enquanto outra olha o rádio do outro lado — sem
que isso afete a visão de ninguém. Não existe "seguir o enquadramento do líder": essa possibilidade foi
avaliada e descartada explicitamente.

A Mesa é uma segunda **vista** da sala, ao lado da vista de Transmissão (o palco de vídeo tradicional).
Cada pessoa alterna livremente entre as duas vistas, a qualquer momento, sem afetar a vista de mais
ninguém e sem exigir confirmação. A sala sempre tem uma Mesa (mesmo vazia); quem está jogando na Mesa
continua jogando ainda que todo o resto da sala esteja na Transmissão assistindo vídeo. Não existe "modo
da sala" nem transição de tipo pelo líder — isso foi decisão explícita do produto, corrigindo uma
proposta anterior que unificava as duas vistas em um "tipo de sala" só.

### 1.1 Presença: entrar e sair da Mesa

- Abrir a vista Mesa é uma ação pessoal: a pessoa passa a **ver e enviar** dados da Mesa (posições de
  janela, o que está acontecendo dentro delas, ponteiros de quem mais está olhando). Antes de abrir, ela
  não recebe nada disso — nem estado, nem arrasto de outra pessoa, nem ponteiros — e a interface não
  precisa montar nada da Mesa. Isso é requisito explícito de desempenho: quem está assistindo vídeo na
  Transmissão não paga custo nenhum pela Mesa existir.
- Ao abrir, a pessoa recebe um **retrato completo e atual** da Mesa (todas as janelas, seus estados,
  travas do líder, e quem mais já está com a Mesa aberta). Enquanto o retrato não chega, a Mesa está em
  um estado de carregamento (ver seção 11).
- Ao fechar a vista Mesa (ou trocar para a Transmissão), a pessoa para de receber tudo isso. Se ela
  estava movendo ou redimensionando uma janela, esse controle é liberado automaticamente.
- **Quem está "presente" na Mesa agora** (isto é, com a vista aberta) é informação da sala inteira: todo
  mundo sabe quantas pessoas estão olhando a Mesa e quem são, mesmo quem está na Transmissão (para saber
  que "tem gente jogando"). A contagem de janelas na Mesa (para saber se ela está vazia) também chega a
  quem está na Transmissão, mesmo sem abrir a Mesa.
- Uma pessoa pode ir até o ponteiro de outra pessoa que esteja com a Mesa aberta (uma ação do tipo "ir
  até fulano"), desde que essa pessoa já tenha mexido o ponteiro dentro da Mesa recentemente; senão a
  ação informa que a pessoa ainda não mexeu o ponteiro lá.
- **Queda e retomada de conexão.** Se a conexão da pessoa cai e ela é reconectada dentro da janela de
  retomada da sala, ela é tirada da vista Mesa automaticamente (o que ficou pendente no caminho antigo se
  perdeu) e, assim que a sala confirma a retomada, a interface pede o retrato de novo sozinha — a pessoa
  não precisa reabrir manualmente.
- **Troca de líder de sala (migração).** Se a sala precisa trocar de servidor (o líder caiu), o estado da
  Mesa migra junto (todas as janelas). Depois da migração, quem estava com a Mesa aberta pede o retrato
  de novo automaticamente. Detalhes de o que migra e o que não migra estão na seção 12.

### 1.2 Quem pode fazer o quê, em linhas gerais

- Qualquer pessoa da sala pode abrir a Mesa, olhar, e **jogar/usar** o conteúdo de qualquer janela que já
  esteja lá (dar play num vídeo, jogar uma carta, marcar um item de lista) — isso nunca é bloqueado pelas
  travas do líder.
- O líder da sala tem duas travas independentes sobre a **estrutura** da Mesa (quais janelas existem, onde
  e de que tamanho): uma trava geral ("só o líder mexe na mesa": pôr, tirar, mover e redimensionar
  qualquer janela) e uma trava específica de tamanho ("travar tamanho": só o líder redimensiona). As duas
  podem estar ligadas independentemente uma da outra. Detalhes na seção 5.
- Tirar uma janela de tela ou câmera de alguém da Mesa só pode ser feito pela própria pessoa que está
  transmitindo ou pelo líder — nunca por um terceiro qualquer, mesmo sem trava.

---

## 2. Navegação da vista (o "para onde eu olho")

Cada pessoa tem seu próprio enquadramento dentro do espaço da Mesa: um ponto de referência e um nível de
aproximação. Isso nunca vai para a rede — é local.

Requisitos funcionais:

- **Amplitude de aproximação.** A pessoa pode aproximar (zoom) dentro de uma faixa limitada — hoje de
  20% a 200% do tamanho "real" das unidades da mesa — o suficiente para ver o espaço inteiro de longe ou
  examinar uma janela de perto, mas sem chegar a extremos inúteis.
- **Deslocamento livre**, arrastando o fundo ou pelo teclado (mesmo sem mouse, a pessoa consegue percorrer
  a Mesa inteira). O deslocamento nunca sai dos limites do espaço da Mesa além de uma pequena folga de
  borda (hoje 600 unidades), para nunca "perder-se" fora do mundo.
- **"Ver tudo"**: uma ação que enquadra automaticamente todas as janelas existentes de uma vez, com uma
  margem de respiro, sem passar de um nível de aproximação que faria uma única janela virar tela cheia.
  Com a Mesa vazia, "Ver tudo" enquadra o meio do espaço (onde as primeiras janelas nascem), no tamanho
  real.
- **Focar/centralizar uma janela**: uma ação que leva o enquadramento até uma janela específica, no maior
  nível de aproximação em que ela ainda cabe com folga (útil quando a pessoa quer examinar uma janela
  específica sem procurá-la manualmente).
- **Ir até uma pessoa**: uma ação que leva o enquadramento até onde o ponteiro de outra pessoa está,
  desde que ela tenha mexido o ponteiro na Mesa recentemente.
- **Transições suaves e interrompíveis**: quando o enquadramento muda por uma dessas ações (não por
  arrastar/rolar manual), a mudança não é instantânea — mas quem tem preferência do sistema por menos
  movimento precisa poder pular direto para o resultado final, sem a transição.
- **Referência de posição de conjunto**: a pessoa precisa de uma forma de entender, de relance, onde as
  janelas estão dentro do espaço inteiro da Mesa mesmo quando seu enquadramento atual só mostra uma
  parte dele — e de poder saltar para qualquer ponto a partir dessa referência. Essa referência também
  mostra onde estão os ponteiros de outras pessoas (se a pessoa optou por vê-los) e qual é a porção do
  espaço que ela está enquadrando agora. Essa referência pode ficar oculta ou visível, por preferência da
  própria pessoa, lembrada entre sessões.
- **Teclado, com a Mesa focada (nenhuma janela em particular)**: deslocar o enquadramento nas quatro
  direções; aproximar; afastar; "Ver tudo". Um atalho abre o menu de adicionar janela (ver seção 4.2).
- **Ponteiros de outras pessoas**: enquanto alguém está com a Mesa aberta e mexe o ponteiro dentro dela,
  as outras pessoas também com a Mesa aberta veem esse ponteiro em tempo real (a posição é enviada em
  taxa limitada — não a cada pixel), identificado por quem é. Um ponteiro parado por tempo suficiente
  (hoje 1 segundo) desaparece, para não sujar a tela com ponteiros de gente que só está olhando parada. A
  pessoa pode desligar a exibição dos ponteiros alheios, por preferência sua (isso é uma configuração da
  casca da interface, não da Mesa propriamente, mas a Mesa precisa aceitar essa preferência — ver seção
  13).

---

## 3. Janelas: ciclo de vida e ações

Uma **janela** é a unidade que alguém põe na Mesa: sempre de um **tipo** (vídeo do YouTube, jogo da
velha, nota, etc. — catálogo completo na seção 8), sempre com uma posição e um tamanho dentro do espaço
da Mesa, e sempre com um estado próprio (o que ela guarda: o texto da nota, o tabuleiro do jogo, a fila
do rádio). Uma janela pode ou não ter um "dono" — quem a pôs lá (relevante para permissões e para a
interface mostrar "posto por fulano"); janelas de tela e câmera sempre têm dono (a pessoa que está
transmitindo).

### 3.1 Pôr uma janela na Mesa

- A pessoa escolhe um tipo entre os disponíveis (organizados por categoria — ver seção 8) e a janela
  nasce **inteira**, no tamanho padrão daquele tipo, sem precisar de um segundo passo para redimensionar
  antes de usar.
- A janela nasce **sem sobrepor nenhuma outra**: se o lugar pedido está ocupado, o sistema encontra o
  ponto livre mais próximo daquele lugar automaticamente. Se não houver lugar livre em lugar nenhum do
  espaço (ou a Mesa já está no limite de capacidade — hoje 32 janelas simultâneas), a ação falha e a
  pessoa é avisada por quê.
- Duas origens de "pôr na mesa": pelo menu da própria Mesa (nasce onde a pessoa clicou, ou no meio do
  que ela está enquadrando se veio por atalho de teclado ou por um botão fixo de adicionar), e **de fora
  da Mesa** — por exemplo, "pôr na mesa" um link de vídeo colado no chat da sala, ou uma imagem do chat:
  nesses casos a janela nasce no meio do enquadramento de quem pediu (ou no meio do espaço da Mesa, se
  quem pediu está na Transmissão) e já entra com o conteúdo pronto (o vídeo carregado, a imagem
  definida), sem passo extra.
- Telas e câmeras (ver seção 9) **não** são postas manualmente por ninguém: o próprio sistema as cria
  quando alguém começa a transmitir tela ou câmera, e as remove quando a pessoa para. A tentativa de
  "pôr" uma tela ou câmera manualmente é recusada.
- Ao pôr uma janela pela própria Mesa, o foco de teclado vai automaticamente para a janela recém-criada.

### 3.2 Mover e redimensionar

- Qualquer janela pode ser movida e redimensionada (sujeito às travas do líder — seção 5), tanto por
  arrastar quanto pelo teclado (com a janela em foco: setas movem; um modificador de teclado + setas
  redimensiona; segurar outro modificador aumenta o passo).
- **Nunca há sobreposição entre janelas.** Ao soltar uma janela sobre outra (ou perto o bastante para
  encostar), ela assenta no ponto livre mais próximo daquele em que foi solta, com uma pequena folga
  mínima entre janelas. Se não houver lugar nenhum onde ela caiba, ela volta para onde estava antes do
  arrasto.
- Durante um arrasto, a pessoa vê uma prévia de onde a janela vai assentar quando ela solta — distinta da
  janela sendo arrastada em si — porque o ponto final pode não ser exatamente onde o cursor está (por
  causa do desvio de colisão).
- **Redimensionar respeita um mínimo por tipo de janela** (ver seção 8, coluna de tamanho) e, quando o
  tipo exige, uma proporção fixa entre largura e altura (por exemplo, conteúdo de vídeo mantém 16:9).
  Nenhuma janela pode ficar menor que um piso absoluto (hoje 48 por 48 unidades), mesmo que o tipo não
  declare mínimo próprio.
- Redimensionar também nunca produz sobreposição: o sistema para no maior tamanho que ainda cabe entre
  a janela e suas vizinhas (ou a borda do mundo).
- **Uma pessoa por vez move ou redimensiona uma dada janela.** Ao começar a arrastar ou redimensionar,
  a pessoa "pega a vez" daquela janela por um tempo curto (hoje 5 segundos), renovado enquanto ela
  continua mexendo; se outra pessoa tentar mexer na mesma janela enquanto a vez está com alguém, ela é
  impedida e avisada de quem está com a janela agora. A vez expira sozinha se a pessoa que a tinha cair
  da sala no meio do arrasto. Enquanto uma pessoa está movendo uma janela, as outras que estão olhando a
  Mesa veem, em tempo real, a posição mudando e um aviso de quem está mexendo nela.
- **Tirar da mesa**: remove a janela definitivamente (com o estado dela). Quem pode tirar cada tipo de
  janela está na seção 5.

### 3.3 Tela cheia (pessoal)

- Qualquer janela pode ser posta em tela cheia — uma decisão **pessoal**, que não afeta o que as outras
  pessoas veem. Sair da tela cheia (pelo mesmo comando, ou pela tecla padrão de escape do sistema) volta
  a janela ao lugar exato onde estava no espaço da Mesa, sem perder nenhum estado interno dela (um vídeo
  incorporado, por exemplo, não recarrega).
- Só uma janela por vez pode estar em tela cheia para uma pessoa; entrar em tela cheia em outra janela
  sai da anterior primeiro.
- Sair da tela cheia pelo controle nativo da janela do sistema operacional (não pelo comando da própria
  Mesa) também tem que devolver a janela ao lugar dela.

### 3.4 Ações disponíveis por janela (o "menu da janela")

Toda janela expõe o mesmo conjunto de ações, independente do tipo:

- Pôr em tela cheia / sair da tela cheia.
- Centralizar a janela no enquadramento de quem pediu (sem mexer no enquadramento de mais ninguém).
- Tirar da mesa (quando permitido — seção 5).
- Para janelas de tela/câmera de outra pessoa: acesso ao controle de volume e silenciar daquela pessoa
  (o mesmo controle que existe hoje fora da Mesa, para o tile de vídeo dela).

Essas ações precisam estar disponíveis tanto por um controle dedicado na própria janela quanto por um
menu de contexto (equivalente ao clique com o botão direito) e por teclado — a pessoa nunca deve
depender só do botão direito do mouse para agir sobre uma janela. Um atalho de teclado abre esse menu
com a janela em foco.

### 3.5 Estado "em foco"/ativo

Em todo momento existe **no máximo uma janela "ativa"** por pessoa (a última que ela tocou ou focou pelo
teclado). É essa janela que recebe os atalhos de teclado descritos acima (tela cheia, tirar, focar
conteúdo interno). Quando o foco de teclado chega a uma janela que está fora do enquadramento atual (por
exemplo, navegando com Tab), o enquadramento se ajusta sozinho para trazer essa janela à vista — mas só
quando o foco veio do teclado, não de um clique (clicar numa janela parcialmente fora da vista não deve
mover o enquadramento de ninguém à força).

### 3.6 Conteúdo interno pode pedir foco

Cada tipo de janela pode, opcionalmente, declarar um elemento interno que recebe foco quando a pessoa
aperta a tecla de confirmação padrão (Enter) com a janela em foco — por exemplo, o campo de texto de uma
Nota, ou o campo de resposta de um Quiz.

### 3.7 Interação com o conteúdo nunca move a janela

Arrastar dentro do conteúdo de uma janela (por exemplo: mover uma peça de damas, desenhar no Quadro,
rolar uma lista) nunca deve iniciar o arrasto da janela inteira. Só uma área dedicada da janela, fora do
conteúdo, inicia mover/redimensionar. Isso é particularmente importante nas janelas de tela e câmera, que
também aceitam rabisco por cima (ver seção 9) — os dois gestos não podem se confundir.

---

## 4. Camadas e área segura (o que precisa estar sempre alcançável)

Estes dois pontos são requisitos de **comportamento**, não de aparência: como a interface decide o que
fica clicável/alcançável acima do quê, e como ela reserva espaço para si mesma.

### 4.1 Ordem de alcance (camadas)

Precisa existir uma ordem clara de prioridade de interação — o que responde a clique/toque primeiro
quando elementos coincidem no mesmo ponto:

1. Conteúdo de uma janela (a camada mais "de baixo", exceto o fundo do espaço em si).
2. A janela como um todo (a área que permite mover/redimensionar), acima do conteúdo de janelas vizinhas
   mas nunca sobre o próprio conteúdo que ela contém.
3. A janela **sendo arrastada no momento**, temporariamente acima de todas as outras janelas (só
   enquanto dura o arrasto).
4. Os controles próprios da Mesa (navegação, avisos, indicação de quem está presente) — estes ficam
   sempre acima de qualquer janela, para nunca ficarem inacessíveis com a mesa cheia.
5. Menus de contexto e o popover de referência de posição de conjunto (seção 2), acima dos controles da
   Mesa.
6. Camadas globais do app (diálogos de confirmação, modais) continuam acima de tudo o que é da Mesa —
   a Mesa nunca pode tapar uma confirmação do app.

### 4.2 Área segura

A Mesa precisa saber, a qualquer momento, qual porção da tela está reservada pelos próprios controles
dela (navegação, indicação de presença, avisos) e por controles globais da casca que convivam na mesma
tela (por exemplo, uma barra de ações fixa da sala). Todas as operações que decidem "onde" algo aparece
ou "o que" está visível precisam respeitar essa área reservada, e não a tela inteira:

- Onde uma janela nova nasce (quando não foi pedida por um clique num ponto específico).
- Onde o enquadramento centraliza ao seguir uma pessoa ou focar uma janela.
- O que conta como "visível" para efeito de "Ver tudo" e para a otimização de desempenho da seção 9.4.
- O voo do foco de teclado (seção 3.5).

Essa área muda dinamicamente conforme o que está de fato ocupado na tela naquele momento (a barra de
ações da sala pode não estar sempre visível, por exemplo) — a Mesa precisa recalcular isso quando o
tamanho da janela do app muda ou quando esses elementos aparecem/somem.

---

## 5. Permissões e travas do líder

- **Trava "só o líder mexe na mesa" (`leaderOnly`)**: quando ligada, só o líder pode pôr, tirar, mover ou
  redimensionar qualquer janela. Todo mundo continua podendo **usar** o conteúdo das janelas já
  existentes (jogar, votar, dar play) — a trava nunca bloqueia isso.
- **Trava "travar tamanho" (`lockSize`)**: independente da anterior. Quando ligada, só o líder pode
  redimensionar janelas (pôr, tirar e mover continuam livres, a não ser que a outra trava também esteja
  ligada).
- As duas travas podem ser ligadas e desligadas pelo líder mesmo **sem estar com a Mesa aberta** (a
  partir da vista de Transmissão) — a mudança vale para a sala inteira imediatamente.
- Quando uma ação é bloqueada por trava, a pessoa recebe um aviso identificando qual trava está ativa e
  por isso a ação não é permitida.
- **Tirar tela ou câmera da mesa**: mesmo sem nenhuma trava ligada, só a própria pessoa que está
  transmitindo aquela tela/câmera ou o líder podem tirá-la. Qualquer outra pessoa tentando é recusada com
  um motivo específico.
- Nenhuma trava afeta o enquadramento pessoal (seção 2) nem preferências pessoais (mostrar ponteiros,
  tela cheia individual).

---

## 6. Consistência, sincronização e tratamento de erros (visão geral)

A Mesa é estado compartilhado da sala: toda mudança estrutural (pôr, tirar, mover, redimensionar,
travar) passa por uma validação central (hoje, o servidor da sala) antes de valer para todo mundo — o
que a pessoa vê localmente ao agir é **otimista** (aparece na hora) mas pode ser desfeito se a validação
central recusar.

Requisitos que a experiência precisa cobrir, sem entrar em formato de mensagem:

- **Toda ação pode ser recusada**, com um motivo. Motivos que a própria interface já device saber tratar
  sozinha, sem incomodar a pessoa com texto técnico: sobreposição (a interface tenta o lugar livre mais
  próximo automaticamente, até um número pequeno de tentativas, antes de desistir e avisar), janela que
  sumiu entre o pedido e a resposta (a interface simplesmente esquece o pedido), e "outra pessoa está com
  a vez desta janela" (vira o aviso descrito na seção 3.2, não um erro genérico).
- **Motivos que precisam virar um aviso curto e específico para a pessoa**, cobrindo pelo menos: limite de
  ações por segundo atingido; trava do líder ativa (mexer na estrutura, ou mudar o tamanho); a mesa
  já está no limite de janelas; não há lugar livre em lugar nenhum para o tamanho pedido; a janela
  ficaria pequena ou grande demais; tipo de janela desconhecido pela sala; tentativa de pôr/tirar
  tela ou câmera manualmente; tentativa de tirar uma tela/câmera que não é sua nem do líder; a janela
  cresceu demais em conteúdo (estourou o teto de dados que ela pode guardar); e uma recusa genérica para
  quando a ação em si era inválida para aquele tipo de janela naquele momento.
- **Perda de sincronismo**: se por qualquer motivo a sequência de mudanças que a pessoa está recebendo
  "pula" um passo (uma mensagem se perdeu), a interface pede um retrato inteiro novo sozinha, sem
  intervenção da pessoa, e volta a ficar consistente.
- **Limite de taxa**: existe um teto de quantas ações estruturais por segundo uma pessoa pode mandar (hoje
  20/s) e um teto de tamanho para qualquer retângulo ou ação individual (hoje 8 KB) — isso é para conter
  automação/abuso, não para uso normal, mas a interface precisa de um aviso pronto para quando acontecer.
- **Teto de conteúdo por janela**: cada tipo de janela declara um teto de quantos dados seu estado pode
  ocupar (variando por tipo, de algumas centenas de bytes a 16 KB); passar do teto faz a ação ser
  recusada com um aviso de "a janela ficou cheia demais". Isso limita, por exemplo, quantos itens uma
  lista pode ter ou quantas pessoas um sorteio pode registrar.

---

## 7. Informação secreta (visão por pessoa)

Vários tipos de janela (a maioria dos jogos de carta e de festa — ver seção 8) lidam com informação que
**não pode ser vista por todo mundo igual**: a mão de cartas de cada jogador, a posição da frota de cada
um na Batalha naval, a palavra sendo desenhada, as respostas do Stop antes da correção, a resposta de
cada um no Quiz antes de todos responderem.

Requisitos:

- **O segredo nunca deve estar acessível a quem não deveria vê-lo**, nem por inspeção técnica do
  cliente (ex.: ferramentas de desenvolvedor do navegador). Isso significa que o dado sigiloso não pode
  nem chegar ao dispositivo de quem não pode vê-lo — não é uma questão de "esconder na tela", é uma
  questão de nunca transmitir.
- Cada pessoa recebe sua **própria versão do estado** dessas janelas: o que é dela (a própria mão), o que
  é público (cartas na mesa, contagens de quantas cartas cada um tem, quantas restam no monte), e — muito
  importante — **as informações já resolvidas sobre o que ela pode ou não fazer agora** (que ações estão
  disponíveis, quanto ela pode apostar, se é a vez dela), porque o dispositivo dela não tem acesso ao
  estado inteiro para calcular isso sozinho. Quem decide de verdade continua sendo a validação central.
- **Quem sai da sala definitivamente** libera automaticamente qualquer cadeira/mão que ocupava, em todas
  essas janelas (jogo continua para quem ficou).
- **Prazos por jogada** (ver seção 8): quando um tipo de jogo tem um relógio por decisão, o "estourou o
  tempo" é resolvido por quem controla o tempo da sala, nunca pelo relógio local de cada pessoa — evita
  que um relógio adiantado ou atrasado numa máquina decida a jogada de todo mundo.
- **Migração de sala com jogos de carta em andamento**: quando a sala precisa trocar de servidor no meio
  de uma mão/rodada com informação secreta, essa mão/rodada específica é **cancelada** e qualquer aposta
  em jogo volta para quem apostou; fichas acumuladas e lugares ocupados continuam.

---

## 8. Catálogo de tipos de janela

Cada janela pertence a uma categoria (usada para organizar o menu de "pôr na mesa"): **Assistir e ouvir**,
**Ferramentas**, **Noite de jogo** e **Jogos**. Duas janelas adicionais — Tela e Câmera — não aparecem
nesse menu porque o próprio sistema as cria e remove (seção 9).

Para cada tipo: o que ela faz, quantas pessoas participam, que estados ela passa, o que ela expõe como
"vez"/"status" (o que a barra de identificação da janela — seção 3.4 — precisa mostrar de relance:
placar, de quem é a vez, em que fase o jogo está), se guarda informação secreta por pessoa (seção 7), e
a restrição de tamanho de conteúdo (área mínima de conteúdo para continuar utilizável, e uma área de
conteúdo confortável de referência). Toda janela, além da área de conteúdo, também precisa reservar
espaço — fora dessa área — para identificação (título, quem pôs) e ações (seção 3.4); quanto espaço
exatamente é decisão do design system, não da Mesa.

### 8.1 Assistir e ouvir

| Tipo | O que faz | Participantes | Vez/estado exposto | Segredo | Conteúdo mín. / confortável |
|---|---|---|---|---|---|
| **Vídeo do YouTube** | Um vídeo incorporado, tocando em sincronia para todo mundo que está olhando (posição, play/pausa e velocidade corrigidos automaticamente contra o relógio da sala). Qualquer um troca o vídeo, dá play/pausa ou pula para um ponto. | Toda a sala | Título/posição do vídeo | Não | 320×180 / 640×360, proporção travada 16:9 |
| **Rádio da sala** | Fila colaborativa de músicas (por link de vídeo); toca só o áudio. Qualquer um adiciona à fila; tocar/pausar e reordenar são de todos; pular é de quem pôs a música atual ou do líder; qualquer outra pessoa pode pedir votação para pular (passa com maioria de quem está na sala). Faixas que falham ao carregar são puladas e marcadas. | Toda a sala | Música atual, quem pôs, fila | Não | 280×320 / 360×480, proporção livre |
| **Ao vivo (Twitch)** | Mostra um canal ao vivo de terceiro; não sincroniza nada (é ao vivo — cada pessoa assiste a própria transmissão). Qualquer um troca o canal. | Toda a sala | Canal atual | Não | 320×180 / 640×360, proporção travada 16:9 |
| **Spotify Jam** | Não toca música dentro do app: guarda um link de sessão compartilhada do Spotify; cada pessoa entra nele no próprio Spotify. A janela só guarda o link e quem marcou "entrei". | Toda a sala | Link ativo, quantos entraram | Não | 260×200 / 360×280, proporção livre |

### 8.2 Ferramentas

| Tipo | O que faz | Participantes | Vez/estado exposto | Segredo | Conteúdo mín. / confortável |
|---|---|---|---|---|---|
| **Nota** | Texto compartilhado de até 1000 caracteres; a última edição de qualquer pessoa vale (sem controle de conflito além disso). | Toda a sala | — | Não | 160×120 / 320×240, proporção livre |
| **Lista** | Itens com caixa de marcar (até 40 itens, texto curto cada), com título opcional. Qualquer um adiciona, marca/desmarca, edita texto, apaga, reordena e limpa os já marcados de uma vez. | Toda a sala | Quantos marcados de quantos | Não | 260×240 / 360×440, proporção livre. Lista que cresce rola dentro de si mesma sem fazer a janela crescer. |
| **Imagem** | Fixa uma imagem que já está no histórico do chat da sala. Só guarda uma referência à imagem (não duplica os dados); se a imagem sair do histórico do chat, a janela avisa que não está mais disponível. | Toda a sala | — | Não | 160×160 / 480×360, proporção livre |
| **Galeria** | Mostra em grade as imagens que ainda estão no histórico do chat, cada uma com ação de "pôr na mesa" (cria uma janela de Imagem). Não guarda nenhum estado próprio. | Toda a sala | — | Não | 240×180 / 480×360, proporção livre |
| **Quadro** | Folha em branco onde todo mundo desenha livremente, com as mesmas ferramentas de rabisco usadas em cima de vídeo no resto do app (caneta, texto, desfazer os próprios traços, cor por pessoa). O traço não é o estado desta janela (é alto volume; passa por um canal à parte); o estado só guarda quem criou a folha. "Limpar tudo" é de quem criou ou do líder. | Toda a sala | — | Não | 320×240 / 640×480, proporção livre |
| **Link** | Cola um endereço da internet (só HTTPS, com domínio de verdade — sem endereço de rede local) e um título opcional; mostra e oferece "abrir no navegador" de cada pessoa. Não navega em conjunto, não busca preview automático da página. | Toda a sala | — | Não | 240×150 / 360×200, proporção livre |

### 8.3 Noite de jogo

| Tipo | O que faz | Participantes | Vez/estado exposto | Segredo | Conteúdo mín. / confortável |
|---|---|---|---|---|---|
| **Enquete** | Uma pergunta com 2 a 6 opções; um voto por pessoa (pode trocar ou tirar o voto). Quem criou ou o líder editam a pergunta (só antes de qualquer voto), encerram e reiniciam. | Toda a sala | Contagem por opção, encerrada ou não | Não | 320×280 / 420×400, proporção livre |
| **Placar** | 2 a 4 times, nome editável por time, +1/−1 por time (nunca negativo, teto de 999), zerar, e um "melhor de N" opcional (3 a 21, ímpar) que declara vencedor automaticamente ao bater a meta. | Toda a sala | Placar atual, vencedor da série se houver | Não | 300×180 / 420×240, proporção livre |
| **Cronômetro** | Regressivo (com duração ajustável) ou progressivo; iniciar, pausar, zerar, ajustar tempo, rótulo de texto livre. O tempo mostrado é calculado a partir do relógio da sala, não de mensagens repetidas por segundo. | Toda a sala | Tempo restante/corrido, rodando ou parado | Não | 260×160 / 360×300, proporção livre |
| **Sorteio de times** | Lista de nomes (das pessoas da sala e/ou digitados, até 40), dividida automaticamente em 2 a 8 times ao sortear; "sortear de novo" gera nova divisão. O sorteio em si é decidido de forma centralizada (não local), para todo mundo ver o mesmo resultado. | Toda a sala | Times atuais (se já sorteado) | Não | 340×300 / 480×420, proporção livre |
| **Dados e moeda** | Rola de 1 a 6 dados (4, 6, 8, 10, 12 ou 20 lados) e/ou uma moeda; o resultado é decidido de forma centralizada; histórico das últimas 10 rolagens. | Toda a sala | Última rolagem | Não | 300×240 / 400×320, proporção livre |
| **Roleta** | 2 a 16 opções de texto; ao girar, a fatia sorteada, quantas voltas e onde exatamente para são decididos de forma centralizada, para a roleta girar e parar igual em todas as telas, mesmo para quem chega depois de já ter girado. Editar opções reinicia o giro. | Toda a sala | Última opção sorteada | Não | 360×420 / 640×440, proporção livre. Em conteúdo estreito, a lista de opções pode virar uma lista rolável sem cobrir a parte visual do sorteio. |
| **Sons** | Um mural de sons curtos pré-definidos (10 sons); qualquer pessoa toca um som para a sala inteira ouvir. Limite de um som por pessoa a cada 3 segundos. | Toda a sala | Último som tocado, por quem | Não | 260×220 / 400×300, proporção livre |

### 8.4 Jogos

Jogos de dois lugares fixos ("cadeiras") — Jogo da velha, Lig 4, Damas, Xadrez — compartilham a mesma
regra de participação: duas cadeiras nomeadas, qualquer pessoa senta numa cadeira livre ou levanta da
que ocupa; só quem está sentado joga, e só na sua vez; quem não está sentado assiste. Sentar guarda o
nome de quem sentou (para o resumo do jogo continuar fazendo sentido mesmo que a pessoa saia e volte com
outra identidade de conexão). Quem sai da sala definitivamente libera a cadeira automaticamente, sem
encerrar a partida — outra pessoa pode sentar e continuar dali.

| Tipo | O que faz | Participantes | Vez/estado exposto | Segredo | Conteúdo mín. / confortável |
|---|---|---|---|---|---|
| **Jogo da velha** | Clássico 3×3. Reiniciar é de quem está sentado ou do líder. | 2 (cadeiras) | De quem é a vez, resultado (vitória/empate) | Não | 180×180 / 360×360, proporção travada 1:1 |
| **Lig 4** | Clássico de 7 colunas por 6 linhas, jogando por coluna. | 2 (cadeiras) | De quem é a vez, resultado | Não | 210×180 / 420×360, proporção travada 7:6 |
| **Damas** | Regra brasileira, com captura obrigatória e em sequência. Além de sentar/levantar/reiniciar, tem "desistir" (só quem está sentado, com a partida em andamento). O jogo pode oferecer os lances legais de uma peça para orientar quem vai jogar. | 2 (cadeiras) | De quem é a vez, resultado | Não | 240×240 / 480×480, proporção travada 1:1 |
| **Xadrez** | Regra padrão, incluindo promoção de peão. Sentar/levantar/reiniciar/desistir como Damas. | 2 (cadeiras) | De quem é a vez, resultado | Não | 240×240 / 480×480, proporção travada 1:1 |
| **Batalha naval** | Tabuleiros escondidos: cada pessoa vê o próprio (com os tiros recebidos) e o do adversário só com os tiros já dados (acertou/errou; navio afundado aparece por inteiro; no fim do jogo os dois tabuleiros completos aparecem). Frota de 5 navios (tamanhos 5,4,3,3,2), sorteada ao sentar e disponível para "sortear de novo" antes de começar; "pronto" começa quando os dois confirmam; 60 segundos por tiro — estourou, o tiro sai numa casa sorteada automaticamente; "desistir" e "nova partida" também disponíveis. | 2 (cadeiras) | Fase (posicionando/jogando), de quem é a vez, quantos navios restam de cada lado | Sim | 420×300 / 720×460, proporção livre |
| **Pôquer** (Texas Hold'em sem limite) | 2 a 8 lugares; quem senta recebe 1000 fichas de mentira. Blinds fixos por mão (padrão 10/20; o líder troca entre mãos, entre opções pré-definidas). Botão do dealer gira a cada mão. Rodadas pré-flop/flop/turn/river/showdown, com fase de apostas em cada uma (desistir, passar, pagar, apostar, aumentar, all-in); potes paralelos quando alguém está all-in; showdown revela e resolve a melhor mão de 5 entre as 7 cartas disponíveis, dividindo empates. 30 segundos por decisão — estourou, passa se puder, senão desiste. "Dar as cartas" é um botão que qualquer sentado aperta com pelo menos dois sentados com fichas; quem senta no meio da mão entra na seguinte; quem zera as fichas pode recomprar entre mãos; sair da sala no meio de uma mão desiste dela e libera o lugar. | 2 a 8 (lugares) | Fase da mão, tamanho do pote, de quem é a vez, o que a própria pessoa pode fazer agora (pagar quanto, aumentar mínimo quanto) | Sim | 540×345 / 720×460, proporção travada 720:460 |
| **Blackjack** | 1 a 5 lugares contra a casa (a própria sala representa a banca, ninguém senta como banca); 1000 fichas ao sentar, aposta de 10 a 500. Fase de apostas (20 s depois da primeira aposta, ou quando todos apostaram), depois cartas, seguro quando a banca mostra uma carta alta, cada lugar joga na ordem (pedir carta, parar, dobrar, dividir pares em até 4 mãos — regras clássicas de cassino, banca para em qualquer 17), banca joga por último, pagamento, próxima rodada. 30 segundos por decisão — estourou, para naquela mão. Recompra entre rodadas com zero fichas. | 1 a 5 (lugares) | Fase da rodada, de quem é a vez | Sim | 420×320 / 680×440, proporção livre |
| **Truco** (paulista) | 2 jogadores ou 4 em duplas (parceiros de frente). 3 cartas por pessoa a cada mão; melhor de 3 rodadas vale 1 ponto, com pedido de truco (aceitar, correr ou aumentar: 6, 9, 12), decisão especial na "mão de 11" e "mão de ferro" (11 a 11), carta encoberta permitida a partir da 2ª rodada, jogo até 12 pontos. 30 segundos por decisão — estourou, joga a carta mais fraca (ou corre, se era resposta a um pedido de truco). | 2 ou 4 (cadeiras, em duplas quando 4) | Placar, de quem é a vez, valor da mão em jogo | Sim | 520×330 / 720×460, proporção livre |
| **Oito maluco** | 2 a 8 jogadores; 7 cartas cada com 2 jogadores, 5 com mais. Joga carta do mesmo naipe ou valor da carta de cima; o 8 vale sempre e quem o joga escolhe o naipe seguinte; sem jogada possível, compra até poder jogar (ou até acabar o monte, aí passa). Quem some as cartas primeiro marca os pontos das cartas que sobraram nas mãos alheias; jogo até 100 pontos. 30 segundos por jogada — estourou, compra e passa. | 2 a 8 (cadeiras) | Quantas cartas cada um tem, de quem é a vez | Sim | 420×280 / 640×400, proporção travada 1,6:1 |
| **Dominó** (clássico, 28 peças) | 2 a 4 jogadores; com 4, em duplas (parceiros de frente). 7 peças por pessoa; com 2 ou 3 jogadores, o resto fica num monte escondido (como o baralho dos outros jogos de carta). Quem tem a peça dupla mais alta abre a primeira mão (critério de desempate definido); encaixa peça numa das duas pontas pela mesma numeração; sem peça que encaixe, compra até poder jogar (com monte) ou passa (sem monte, ou com 4 jogadores); mão termina quando alguém fica sem peças ou quando ninguém consegue jogar (nesse caso vence quem tem menos pontos na mão). Jogo até 100 pontos. 30 segundos por jogada — estourou, joga a primeira peça que encaixa (ou compra/passa). | 2 a 4 (cadeiras, em duplas quando 4) | Quantas peças cada um tem, de quem é a vez | Sim | 420×300 / 720×480, proporção livre |
| **Desenha e adivinha** | A vez de desenhar (sobre a mesma superfície do Quadro) gira entre quem entrou na rodada (entrar/sair da rodada é ação livre). Quem desenha escolhe 1 entre 3 palavras sorteadas (só ela vê as opções); 15 segundos para escolher (estourou, entra a primeira das 3); depois, tempo para desenhar. Quem assiste chuta a palavra escrevendo dentro da própria janela (não no chat); acerto pontua pelo tempo restante, quem desenhou ganha pontos por acerto alheio; chute "quase certo" avisa só quem chutou. O jogo acaba quando todos já desenharam duas vezes, com o placar final. | Toda a sala (entrada por rodada) | Quem desenha agora, tempo restante, placar | Sim (a palavra, só para quem desenha) | 460×400 / 720×560, proporção livre |
| **Stop / Adedonha** | Letra sorteada centralmente entre um conjunto sem ambiguidade visual (sem K, W, X, Y); categorias padrão (nome, animal, cor, fruta, cidade/estado/país, objeto, profissão, marca), editáveis por quem criou a janela entre rodadas (até 10 categorias). Cada pessoa escreve escondido; quem termina aperta "Stop", parando todo mundo (teto de 3 minutos por rodada mesmo sem ninguém apertar). Na correção, cada resposta pode ser anulada por votação da maioria de quem participou da rodada; pontuação por resposta: válida e única vale mais, repetida vale menos, vazia ou anulada não vale nada; toda resposta precisa começar com a letra sorteada. | Toda a sala (participação por rodada) | Letra da rodada, fase (escrevendo/corrigindo), tempo restante | Sim (as respostas de cada um, até a correção) | 520×340 / 720×460, proporção livre |
| **Quiz** | Banco de perguntas em português (conhecimentos gerais, jogos, Brasil), 4 alternativas por pergunta, 10 perguntas por partida, 20 segundos por pergunta. A resposta de cada pessoa fica escondida das outras até todos responderem ou o tempo acabar; acerto pontua por rapidez (até um desconto máximo por demora); resposta errada não pontua. Reiniciar é só do líder. Quem entra na sala depois do início da partida assiste até a próxima. | Toda a sala (quem estava presente ao começar a partida) | Número da pergunta/total, quem já respondeu, placar | Sim (a resposta de cada um, até todos responderem) | 360×320 / 560×460, proporção livre |

**Total: 30 tipos no menu de "pôr na mesa"** (4 em Assistir e ouvir, 6 em Ferramentas, 7 em Noite de
jogo, 12 em Jogos, com 1 novo — o Quadro — ainda pendente de mesclar da fase anterior de trabalho) **+ 2
tipos automáticos** (Tela e Câmera — seção 9) **= 32 tipos de janela ao todo.**

### 8.5 Padrão comum de "vez" e status

Toda janela de jogo/atividade com noção de turno ou progresso precisa expor, de forma resumida e sempre
visível mesmo sem abrir/examinar o conteúdo:

- Um texto curto de status (uma linha, cortável se longo) — ex.: placar e de quem é a vez, fase da
  partida, quantas cartas restam.
- Um indicador binário de "é a sua vez **agora**", pessoal (cada pessoa vê o seu próprio, calculado a
  partir do que ela pode ver do estado — nunca vaza quem tem a vez de outra pessoa em jogos secretos além
  do que já é público).
- Quando a janela é removida ou o jogo termina, os dois somem.
- Esse status é responsabilidade do **conteúdo** de cada tipo (não da Mesa em si) atualizar sempre que o
  estado muda — a Mesa só reserva o lugar para isso existir.

---

## 9. Telas e câmeras (mídia ao vivo) dentro da Mesa

- Telas e câmeras compartilhadas por qualquer pessoa da sala aparecem **automaticamente** como janelas
  na Mesa, no lugar livre mais próximo do meio do espaço, no momento em que a pessoa começa a transmitir
  — sem qualquer ação manual de quem transmite ou de quem está olhando a Mesa. Quando a pessoa para de
  transmitir (ou sai da sala), a janela correspondente é removida automaticamente.
- É o **mesmo fluxo de vídeo** que já existe para a Transmissão — a janela da Mesa não é uma cópia nem
  reinicia a transmissão: o mesmo vídeo que está tocando no palco de Transmissão simplesmente passa a
  aparecer também dentro da janela da Mesa (e volta para o palco quando a Mesa é fechada), sem
  reconexão.
- Só a própria pessoa que está transmitindo, ou o líder, podem tirar a tela/câmera de alguém da Mesa; ela
  volta automaticamente na próxima vez que a pessoa for ao vivo de novo.
- **Tamanho de conteúdo**: Tela precisa de no mínimo 160×90 (padrão 640×360), proporção travada 16:9;
  Câmera precisa de no mínimo 120×90 (padrão 320×240), proporção travada 4:3.
- **Rabisco por cima**: telas e câmeras na Mesa aceitam as mesmas ferramentas de desenho por cima do
  vídeo que existem hoje fora da Mesa (o mesmo canal e as mesmas regras de quem pode limpar).
- **Volume**: cada pessoa controla o próprio volume/mudo de cada tela/câmera que está vendo (preferência
  pessoal, não muda para mais ninguém). Tocar/pausar o vídeo em si (quando aplicável) é da sala.
- **Enquanto o vídeo de alguém ainda não chegou tecnicamente** (a pessoa acabou de anunciar que vai
  transmitir, mas o fluxo de vídeo em si ainda não conectou), a janela mostra quem é, esperando.

### 9.1 Otimização por visibilidade (requisito de desempenho, não de aparência)

Este é um requisito técnico explícito de custo de rede, não uma preferência estética:

- Uma janela de tela/câmera só continua **recebendo** vídeo de rede enquanto está de fato visível o
  bastante no enquadramento de pelo menos uma pessoa: precisa estar dentro da área visível e ter um
  tamanho mínimo perceptível na tela (hoje, um piso de 120 pixels de largura na tela de quem olha).
- Sair da área visível (ou ficar pequena demais) só corta o recebimento depois de um tempo de carência
  (hoje 2 segundos) — para não ligar/desligar o envio a cada leve movimento do enquadramento. Voltar a
  ficar visível retoma **na hora**, sem carência.
- Estar em tela cheia conta sempre como "totalmente visível", no maior tamanho possível.
- **A largura em pixels com que a janela aparece na tela de cada pessoa funciona como um teto pessoal de
  qualidade** para o que aquela pessoa especificamente recebe daquele vídeo — quem está vendo pequeno
  não deveria consumir a mesma taxa de quem está vendo em tela cheia. Isso vale tanto para telas quanto
  para câmeras.
- Essa avaliação é feita por enquadramento de **cada pessoa**, individualmente — não existe uma noção de
  "a Mesa toda decide que ninguém está vendo".

---

## 10. Relação com a Transmissão (o palco de vídeo tradicional)

Este ponto é uma clarificação importante de escopo, porque é fácil imaginar errado:

- A Mesa **não é transmitida** para ninguém, não é gravada, e não existe como um "palco" compartilhado.
  Ela não tem uma versão "vista de fora" — para ver a Mesa, a pessoa **abre a própria vista Mesa**.
- Transmissão e Mesa são vistas independentes por pessoa. Não existe combinação das duas numa vista só
  (não há "ver a Mesa dentro do palco da Transmissão", nem o inverso). O conceito de "Ver junto" (somar
  mais de uma tela ao palco de Transmissão ao mesmo tempo) é inteiramente da vista de Transmissão e não
  tem equivalente nem relação com a Mesa.
- Quem está na Transmissão, mesmo sem nunca ter aberto a Mesa, sabe apenas duas coisas sobre ela: quantas
  janelas existem agora (para saber se "tem gente jogando" e valer a pena entrar) e quem está com a Mesa
  aberta agora. Nada além disso atravessa para quem está na Transmissão.
- Voltar da Mesa para a Transmissão nunca pede confirmação nem altera nada na Mesa — é só uma troca de
  vista pessoal.
- A única coisa que fisicamente "atravessa" as duas vistas é o **vídeo em si** de uma tela/câmera que
  está ao vivo (seção 9): o mesmo stream aparece como tile na Transmissão e como janela na Mesa,
  dependendo de qual vista cada pessoa está olhando — mas isso é reaproveitamento técnico, não uma
  ponte funcional entre as duas vistas.

---

## 11. Estados vazios e feedback

- **Mesa vazia**: precisa de um estado reconhecível como tal, com uma indicação de como pôr a primeira
  janela (o mesmo caminho de "adicionar janela" descrito na seção 3.1).
- **Carregando**: entre abrir a vista Mesa e o retrato chegar, existe um estado intermediário de
  carregamento — a pessoa não deveria conseguir interagir com janelas que ainda não existem para ela.
- **Avisos de curta duração**: toda recusa de ação, toda mudança notável feita por outra pessoa (alguém
  pôs/tirou uma janela, alguém travou/destravou a mesa) e certas transições de mídia geram um aviso
  textual breve, substituído pelo próximo se vier antes de sumir sozinho — nunca acumulam em fila.
  Esses avisos também precisam ser anunciados de forma acessível (leitor de tela), não só mostrados.
- **Indicação de trava ativa**: enquanto qualquer uma das travas do líder está ligada, deve haver uma
  indicação persistente (não um aviso que some) do motivo pelo qual mexer na estrutura da mesa está
  bloqueado para quem não é líder.
- **Falha de módulo de conteúdo**: se o conteúdo de um tipo específico de janela falhar ao carregar ou ao
  processar uma atualização (erro de programação, arquivo não encontrado), a Mesa como um todo não pode
  quebrar — só aquela janela fica com uma alternativa (um resumo textual do estado dela, gerado pelo
  próprio tipo, span text) até o conteúdo poder ser tentado de novo.
- **Acessibilidade geral**: todo controle clicável responde também a teclado, com indicação visível de
  foco; a Mesa como região tem um texto de ajuda descrevendo os atalhos básicos de navegação disponível
  a quem usa leitor de tela.

---

## 12. Persistência, capacidade e limites

- **Capacidade do espaço**: hoje um retângulo de 4800×3000 unidades. Isso é finito — em algum momento a
  Mesa pode ficar sem lugar livre para novas janelas mesmo abaixo do limite de contagem, se as
  existentes estiverem grandes/espalhadas.
- **Limite de quantidade**: no máximo 32 janelas simultâneas na Mesa de uma sala.
- **Vão mínimo entre janelas**: as janelas nunca encostam exatamente umas nas outras; existe uma folga
  mínima constante entre quaisquer duas (hoje 16 unidades) usada tanto para nascer quanto para assentar
  depois de mover/redimensionar.
- **A Mesa só existe enquanto a sala existe.** Não há Mesa "salva" fora de uma sala ativa, não há
  histórico de mesas passadas, não há como uma pessoa levar o estado de uma janela de uma sala para
  outra.
- **Migração de servidor da sala** (troca de líder por queda do anterior): o estado inteiro da Mesa
  (todas as janelas, com seus estados) é transferido para o novo servidor. Exceções:
  - Janelas de tela/câmera **não migram**: elas são recriadas automaticamente assim que cada pessoa
    reanuncia que está ao vivo no servidor novo (porque a identidade técnica de quem está transmitindo
    muda na migração).
  - O "dono" de cada janela (quem a pôs) é perdido na migração (vira "sem dono").
  - Janelas de informação secreta em andamento (jogos de carta) têm a mão/rodada atual cancelada, com
    qualquer aposta em jogo devolvida a quem apostou (seção 7); fichas e lugares ocupados continuam.
  - Cadeiras ocupadas por gente que não está mais presente após a migração podem ser tratadas como
    livres pelas regras normais de "quem saiu libera a cadeira".
- **Retomada de conexão** (sem troca de servidor, só a conexão de alguém caiu e voltou dentro da janela
  de tolerância): quem estava sentado num jogo continua sentado; quem estava com a Mesa aberta perde a
  vista automaticamente e pede o retrato de novo ao confirmar a retomada (seção 1.1).

---

## 13. Contrato entre a Mesa e a casca da interface

Esta seção é para quem for desenhar/implementar a casca do app (o que envolve a Mesa, mas não é a Mesa em
si): o que cada lado precisa fornecer ao outro, por nome de responsabilidade — sem prescrever aparência.

### 13.1 O que a casca precisa fornecer à Mesa

- **Um ponto de montagem**: um espaço reservado onde a Mesa existe visualmente enquanto está aberta, ao
  lado de onde a Transmissão existe (as duas nunca aparecem ao mesmo tempo para a mesma pessoa).
- **Envio de mensagens** para a sala (a Mesa nunca fala com a rede diretamente — sempre por uma função
  de envio fornecida pela casca) e recebimento das mensagens da sala relevantes à Mesa (o retrato da
  mesa, mudanças, recusas, quem está presente, ponteiros, o relógio da sala).
- **Identidade de quem está usando o app agora** (o próprio id, se é o líder), **lista de quem está na
  sala** (id e nome de cada um), **nome e cor de identificação de cada pessoa** (a mesma cor usada em
  outras partes do app para identificar a mesma pessoa — ex.: no rabisco), e **imagem de perfil de cada
  um**, quando existir.
- **Quem está com a vista Mesa aberta agora**, para a Mesa poder mostrar presença e repassar rabisco a
  quem acabou de entrar.
- **Acesso ao vídeo já em andamento de uma tela/câmera** (pelo id da pessoa e se é tela ou câmera), e uma
  forma de **devolver** esse vídeo para o palco de Transmissão quando a janela correspondente é
  desmontada — sem recriar a conexão.
- **Acesso ao menu/controle de volume e silenciar** já existente de uma tela/câmera específica, para a
  ação "volume e silenciar" do menu de uma janela de mídia (seção 3.4) poder reaproveitá-lo.
- **Uma forma de recalcular o layout da grade de vídeo tradicional** depois que uma tela/câmera volta
  para lá (ao a Mesa fechar).
- **Um sinal de que a Mesa mudou o que quer assistir** (para a casca acionar a lógica de qualidade/banda
  de vídeo — seção 9.1) e um sinal de mudança de presença/travas (para a casca atualizar indicações fora
  da Mesa, como o seletor de vista).
- **Controle de tela cheia da janela do sistema operacional** (ligar e desligar) e um aviso de quando ele
  muda por fora (ex.: tecla de escape do sistema).
- **Uma preferência de "mostrar ponteiros de outras pessoas"**, lida e alterável de fora da Mesa (é uma
  configuração pessoal, não um dado da sala).
- **Espaço reservado por outros elementos fixos da casca** (ex.: uma barra de ações da sala) para o
  cálculo de área segura (seção 4.2), e um espaço reservado no cabeçalho da sala para a indicação de quem
  está presente na Mesa.

### 13.2 O que a Mesa fornece à casca

- **Abrir / fechar** a vista Mesa, e **se está aberta agora**.
- **Repasse de qualquer mensagem de rede relevante à Mesa** (a casca decide o roteamento; a Mesa diz se
  tratou ou não uma mensagem dada).
- **Reação a mudança de quem está na sala** (entrada/saída de pessoas) e **a mudança de quem virou
  líder**.
- **Leitura e alteração das duas travas do líder**, utilizável mesmo com a Mesa fechada (a partir da
  Transmissão).
- **Ligar/desligar a exibição de ponteiros alheios**, e **ler o estado atual** dessa preferência.
- **Abrir o menu de "adicionar janela"** a partir de um controle fora da própria Mesa (ex.: um botão fixo
  de ação da sala).
- **Para uma tela/câmera específica: a Mesa quer o vídeo dela agora?** e **com que teto de largura?** —
  usado pela casca para decidir o que efetivamente pedir/aceitar de vídeo (seção 9.1). Essa pergunta tem
  resposta diferente conforme a pessoa está ou não com a Mesa aberta e o que está enquadrando.
- **Onde nasceria uma janela de um tipo dado agora**, para o caso de "pôr na mesa" vindo de fora da
  própria Mesa (ex.: do chat da sala).
- **A hora estimada do relógio da sala**, para qualquer parte da casca que precise dela pelo mesmo motivo
  que o conteúdo das janelas precisa (evitar depender do relógio local de cada máquina).

### 13.3 Contrato entre a Mesa e o conteúdo de cada tipo de janela

Isto é interno à Mesa (não à casca do app), mas registrado aqui porque define uma fronteira que o design
system também precisa suportar (seção 14): cada tipo de janela é implementado por uma peça de conteúdo
independente, que recebe da Mesa:

- Um espaço de conteúdo dedicado, do tamanho atual da janela (a Mesa controla o tamanho; o conteúdo se
  adapta a ele).
- Uma função para **agir** (mandar uma ação para a sala em nome daquela janela).
- Uma função para **validar localmente** uma ação antes de mandar (para poder desabilitar controles que
  não fariam sentido agora, sem esperar a resposta da rede) — sabendo que quem decide de fato é sempre a
  validação central.
- Identidade de quem está usando o app, se é líder, e a lista de pessoas da sala; nome e cor de qualquer
  pessoa por id; a hora estimada da sala.
- Duas funções para expor **status curto** e **é a minha vez agora** (seção 8.5).
- Uma forma de **ser avisado quando uma ação dele é recusada**, com o motivo, para mostrar isso perto de
  onde a pessoa agiu, em vez de um aviso genérico da Mesa.
- Para os tipos que usam a superfície de rabisco (Quadro, e telas/câmeras): uma forma de mandar e receber
  operações de traço endereçadas especificamente àquela janela.
- Ganchos de ciclo de vida: iniciar, atualizar (toda vez que o estado daquele tipo muda, ou quando um
  retrato novo da mesa chega), encerrar (soltar handlers, temporizadores, o que precisar).
- Opcionalmente, um alvo de foco de teclado (seção 3.6).

---

## 14. O que a Mesa exige do design system (em termos funcionais)

Sem prescrever nenhuma forma, o design system que vier a sair deste redesign precisa resolver, para cada
um dos ~32 tipos de conteúdo de janela e para a própria Mesa, os seguintes **papéis funcionais** — hoje
implementados como variáveis (tokens) de estilo que o conteúdo de cada tipo de janela consome
diretamente. O novo design system precisa oferecer um equivalente para cada papel (com os nomes que
fizer sentido no novo sistema — os nomes atuais são listados só para rastreabilidade, não como exigência
de continuidade):

- **Superfícies em camadas** (pelo menos 4 níveis de "profundidade" de fundo, do mais recuado ao mais
  elevado) — hoje `--bg`, `--s1`, `--s2`, `--s3`, `--s4` (e um específico para o fundo de vídeo,
  `--video-bg`).
- **Texto em pelo menos 3 níveis de ênfase** (principal, secundário, terciário) — hoje `--tx`, `--tx2`,
  `--tx3` (mais um `--text` genérico) — e o texto que fica **sobre** uma cor de destaque, não sobre o
  fundo — hoje `--on-text`, `--on-act`, `--on-fill`, `--on-line`.
- **Uma cor de ação/destaque** com estado de hover — hoje `--act`, `--act-hover` — usada por qualquer
  botão primário de conteúdo (ex.: apostar, confirmar).
- **Um significado reservado para "ao vivo"** (hoje `--live`) que **não pode ser reaproveitado para mais
  nada** (nem para "é a sua vez", nem para qualquer outro destaque) — essa é uma decisão de produto já
  tomada, não uma preferência de estilo.
- **Semânticas de feedback**: positivo/sucesso (hoje `--good`), atenção (hoje `--warn`, `--warn-dim`),
  erro/perigo (hoje `--danger`, `--danger-dim`, `--danger-soft`).
- **Linhas/bordas em pelo menos 2 pesos** (hoje `--line`, `--line2`).
- **Um indicador de foco de teclado** consistente e reaproveitável por qualquer controle customizado
  dentro do conteúdo (hoje `--ring`).
- **Uma camada de véu/sobreposição em pelo menos 2 intensidades**, mais estados de hover sobre ela (hoje
  `--veil`, `--veil-hover`, `--veil-strong`) e uma família de escurecimento em pelo menos 4 intensidades
  para uso sobre imagem/vídeo (hoje `--scrim-1/2/4/6`).
- **Tipografia**: uma fonte de identidade/título e uma fonte de leitura (hoje `--font-display`,
  `--font-body`), e uma escala de pelo menos 6 tamanhos, do miúdo ao grande (hoje `--fs-micro`,
  `--fs-small`, `--fs-ui`, `--fs-body`, `--fs-lead`, `--fs-hero`).
- **Uma escala de espaçamento** com pelo menos 8 degraus (hoje `--s-05`, `--s-1`, `--s-15`, `--s-2`,
  `--s-3`, `--s-4`, `--s-6`, `--s-7`).
- **Uma escala de arredondamento** com pelo menos 4 papéis distintos (hoje `--r-xs`, `--r-sm`, `--r-md`,
  `--r-full`), atribuídos a diferentes tipos de elemento (detalhe pequeno, item de lista/campo, elemento
  redondo/pílula) — a atribuição exata é do novo sistema, não deste documento.
- **Uma sombra/elevação de pelo menos 1 nível reaproveitável** por cartões e elementos elevados dentro do
  conteúdo (hoje `--shadow-2`).
- **Durações e curvas de animação padronizadas** (pelo menos uma rápida e uma lenta, com uma curva de
  entrada e uma de saída/combinada) — hoje `--dur-fast`, `--dur-slow`, `--ease-in-out`, `--ease-out` —
  reaproveitadas por qualquer transição de estado dentro do conteúdo (ex.: uma carta virando, uma peça se
  movendo).
- **Uma cor de identificação por pessoa**, atribuída de forma estável e reconhecível ao longo de toda a
  sessão (hoje entregue via uma variável local `--who` calculada a partir do id da pessoa), usada para:
  ponteiro de quem está mexendo, indicação de quem está movendo uma janela, iniciais/avatar sem foto,
  votos/nomes em enquete e sorteio, e traços de rabisco. Este é um requisito de **identidade
  consistente**, não uma paleta específica — mas precisa garantir contraste suficiente sobre qualquer
  fundo em que for usada (hoje é usada só em detalhes: contorno, bolinha, nunca como fundo de bloco de
  texto).
- **Alvo mínimo de toque/clique** para qualquer controle dentro do conteúdo de uma janela — hoje um piso
  de 28×28 unidades dentro das janelas da Mesa (menor que o piso do resto do app, porque o espaço de
  conteúdo já é limitado pelo tamanho da janela).
- **Cada módulo de conteúdo precisa de um lugar (dentro da própria área de conteúdo dele, não da barra de
  identificação da janela) para, quando aplicável**: exibir cartas/peças com pelo menos duas densidades
  de tamanho (compacta e confortável, dependendo do tamanho atual da janela), texto de resposta oculta
  até revelar, e listas que precisam rolar de forma contida sem expandir a janela.

O design system também precisa lidar com o requisito, já descrito na seção 8, de que cada tipo de janela
tem uma área mínima de conteúdo abaixo da qual algo secundário pode desaparecer (nunca sobrepor o que
ficou) — ou seja, todo componente usado dentro do conteúdo de uma janela precisa ter uma versão
"compacta" tão funcional quanto a "confortável", só com menos informação simultânea visível.

---

## 15. Fora de escopo hoje (mencionado para não ser reinventado)

Ideias já pesquisadas e conscientemente deixadas de fora da Mesa atual, por motivo técnico/legal (não
por falta de valor) — retomar qualquer uma delas exigiria nova validação, não é uma lacuna deste
documento:

- Tocar música do Spotify **dentro** do app (limite de contas simultâneas e política do próprio Spotify
  contra sincronizar áudio com vídeo). O que existe é o Spotify Jam (seção 8.1), que só compartilha um
  link de sessão.
- "Tocando agora" e "Jogando agora" (mostrar o que cada pessoa está ouvindo/jogando no próprio PC) —
  depende de um componente nativo específico do sistema operacional, ainda não construído.
- "Filme do seu PC" (compartilhar um arquivo de vídeo local sincronizado, diferente de compartilhar a
  tela) — tecnicamente relacionado à árvore de retransmissão de vídeo, não à Mesa em si.
- Navegar em conjunto por uma página da internet (diferente do tipo Link, que só guarda um endereço).
- Jogar xadrez contra o computador (dependência de licença incompatível com o restante do projeto).
- Um canal de vídeo adicional (Kick) — mesma família de "Ao vivo", ainda sem verificação técnica própria.

---

## Resumo para quem for desenhar

- A Mesa é um espaço compartilhado de tamanho fixo; o enquadramento de cada pessoa é individual.
- Janelas nunca se sobrepõem; nascem inteiras e prontas para uso; uma pessoa por vez move uma dada
  janela.
- O líder tem duas travas independentes sobre a estrutura da mesa; usar o conteúdo nunca é travado.
- A maioria dos jogos de carta/festa lida com informação secreta por pessoa — isso é um requisito de
  transporte de dados, não só de exibição.
- Cada um dos 32 tipos de janela tem uma restrição própria de área mínima de conteúdo e, quando
  aplicável, de proporção — a área ao redor disso (identificação, ações) é adicional e livre para o
  design system definir.
- A Mesa não é transmitida a ninguém; é uma vista pessoal, paralela à Transmissão.
