# GoLive LAN

Compartilhamento de tela em 1080p60 entre amigos, direto de PC pra PC pela sua
LAN virtual (Radmin VPN ou Tailscale). Sem servidor na nuvem, sem conta, sem
ninguém no meio olhando a transmissão.

Feito porque o Go Live do Discord foi suspenso no Brasil em agosto de 2026.

---

## Antes de tudo: teste a sua rede

Esta é a parte que decide se o projeto vai funcionar, e vem antes de instalar
qualquer coisa.

O app não tem servidor de mídia. Quem transmite manda uma cópia do vídeo pra
cada espectador. Isso significa que o **upload de quem transmite** é o teto de
tudo:

| Espectadores | Upload necessário (1080p60 a 12 Mbps) |
|---|---|
| 1 | ~12 Mbps |
| 2 | ~24 Mbps |
| 3 | ~36 Mbps |
| 5 | ~60 Mbps |

Isso é por transmissor: com duas pessoas transmitindo ao mesmo tempo, o
**download de cada espectador** também dobra (uma cópia de cada
transmissão chegando).

Boa parte dos planos de fibra no Brasil entrega upload bem menor que o
download. Confira o seu antes de convidar meia dúzia de gente.

O segundo problema é o Radmin em si. Ele tenta conexão direta entre os peers,
mas quando não consegue (CGNAT, NAT simétrico — comum em operadora brasileira)
cai pra um relay dele, e aí a banda despenca pra alguns Mbps. O teste abaixo
mostra qual dos dois casos é o seu:

```powershell
# Na máquina de quem vai transmitir:
cd tools
.\testar-radmin.ps1 -Modo servidor

# Na máquina de um amigo:
cd tools
.\testar-radmin.ps1 -Modo cliente -Alvo 26.x.x.x -Espectadores 3
```

Ele mede latência, jitter, perda de pacote e banda real nos dois sentidos, e
te diz em qual faixa de qualidade você cabe. Precisa do `iperf3.exe`
(<https://iperf.fr/iperf-download.php>) dentro da pasta `tools/` — sem ele, só
o teste de latência roda.

**Se der abaixo de 10 Mbps:** instale o [Tailscale](https://tailscale.com) no
lugar do Radmin e rode o teste de novo. É WireGuard, faz P2P direto em muito
mais situações, e é gratuito até 100 dispositivos. Quase nada no app muda — só
o IP que vocês digitam (Tailscale usa a faixa `100.x.x.x`). A diferença é que
o Tailscale não repassa broadcast, então **as salas não aparecem sozinhas na
lista**: o app avisa isso na tela inicial; entre pelo endereço de quem criou a
sala.

---

## Instalação

**Usuários finais:** já está pronto na aba "Gerar o instalador pros amigos". Se você baixou o arquivo `.exe`, é só clicar para instalar — sem terminal, sem Node.

**Desenvolvedores / CLI de sinalização:** para buildar do código ou rodar o servidor de sinalização em standalone (em `server/signaling.js`), precisa do [Node.js 18+](https://nodejs.org):

```bash
npm install
```

## Como usar

**1. Alguém da turma clica em "Criar sala"**, na barra lateral da tela
inicial do GoLive. Um diálogo pergunta se a sala deve ser **anunciada na
rede** (ligado por padrão), qual o **nome da sala** (o padrão é "Sala de
<seu nome>") e se deve ser **protegida por um PIN** de 6 dígitos.
Confirmando, o app sobe o servidor de sinalização embutido, libera a porta no
firewall (pode pedir uma confirmação do Windows na primeira vez) e
mostra o endereço no cabeçalho da sala, com um botão de copiar ao lado.

Sem terminal, sem instalar Node à parte, sem digitar porta.

**2. Todo mundo mais abre o GoLive.** Se a sala foi criada com "Anunciar a
sala na rede" marcado, ela aparece sozinha em "Salas na sua rede", no
painel principal — é só clicar no botão **Entrar** do card. Se não, cola o
endereço em "Entrar por endereço" (`26.x.x.x` — a porta é opcional, assume
`:9000`) e clica em Conectar. O nome exibido pros outros é o apelido definido
no perfil (avatar e nome no painel do usuário, no rodapé da barra lateral —
clique pra editar).

**Todo mundo na sala precisa estar na mesma versão do GoLive.** A sala só
aceita quem estiver exatamente na versão de quem a criou — as salas da rede
que estão noutra versão aparecem apagadas na lista, com um selo dizendo qual
lado precisa atualizar, e o botão de buscar atualização fica no painel do
usuário, no rodapé da barra lateral.

O cartão **Sua rede**, na barra lateral, mostra o **endereço desta máquina** na rede
virtual antes mesmo de existir uma sala — é o endereço que os seus amigos vão
digitar.

Quem quiser transmitir clica em **Compartilhar tela**, no dock da sala (a
barra de botões embaixo do vídeo), escolhe monitor ou janela, e pronto. Mais de uma pessoa pode transmitir ao mesmo tempo na
mesma sala.

Duplo clique em qualquer vídeo expande pra tela cheia. **Clique com o botão
direito** em cima de uma tela pra **silenciar** aquela pessoa ou mexer no
volume dela (é só pra você — ninguém fica sabendo).

**Você assiste uma tela por vez.** Com uma pessoa transmitindo, nada muda: a
tela dela abre sozinha. Quando aparece uma segunda, ela chega como um card
com o nome e dois botões — *"Assistir"* troca a tela que você está vendo,
*"+ Ver junto"* põe as duas na grade ao mesmo tempo (e a terceira, e a
quarta, se você quiser). Pra largar uma delas, o ícone de olho cortado no
canto do vídeo. Não é só arrumação da tela: a tela que você não pediu **não é
codificada** na máquina de quem transmite — é um encoder de 1080p60 a menos
rodando lá, ao lado do jogo. A câmera fica de fora dessa conta: ela aparece
sempre.

**O olho no canto de cima à esquerda** de cada vídeo diz quantas pessoas
estão assistindo aquela tela; passe o mouse nele pra ver quem são.

**Pra deixar a turma rabiscar na sua tela**, marque *"Deixar a sala rabiscar
na minha tela"* no diálogo de compartilhar, **antes** de ir ao vivo. Uma
barrinha aparece embaixo do vídeo; o primeiro botão dela liga e desliga a
caneta, e aí vêm caneta e texto, cada pessoa com a sua cor. Você desfaz e
apaga **os seus** rabiscos — ninguém apaga o traço de outro.

Quem é **dono da tela** não rabisca na própria tela: a barra dele tem um
botão só e pequeno, *"Apagar tudo"*, que limpa a lousa inteira. Em compensação, é na
tela dele que a coisa acontece de verdade — **compartilhando uma tela
inteira, os rabiscos aparecem por cima da tela real**, não só dentro do
GoLive, e sem atrapalhar o mouse nem entrar na transmissão (ninguém vê o
traço duplicado). Compartilhando uma **janela** específica isso não rola: o
rabisco fica dentro do app, e o GoLive avisa.

Sai do ar junto com a transmissão. A escolha fica lembrada pra próxima vez,
e **não dá pra ligar no meio** — pare e compartilhe de novo.

Com o **mouse parado por 3 segundos**, o cabeçalho, o dock e a
barra de rabisco somem pra não atrapalhar o vídeo. Na tela cheia some junto o
que fica em cima do vídeo — nome, botão de tela cheia, botão de reação — e o
próprio cursor. Voltam no primeiro movimento (ou no `Tab`, se você estiver de
teclado).

**No chat** dá pra mandar imagem (botão de clipe, `Ctrl+V` ou arrastando em
cima da aba Chat) — ela é reduzida automaticamente e aparece como miniatura,
que abre em tela cheia no clique. O botão de carinha ao lado abre os emoji,
com busca em português e os que você mais usa na frente.

A coluna da direita tem duas abas, **Pessoas** e **Chat**. Mensagem nova de
outra pessoa com a aba Pessoas aberta acende um ponto na aba Chat.

**Quem criou a sala pode passar a liderança** pra outra pessoa: `⋮` ao lado
do nome dela → *"Passar a liderança"*. Quem recebe passa a poder parar
transmissões, expulsar e banir; quem passou deixa de poder. Se o novo líder
sair da sala, a liderança volta sozinha pra quem criou.

**Pra pausar a transmissão** sem parar de compartilhar, use o botão de pausa
no dock ou o atalho global **`Ctrl+Alt+P`** — ele funciona mesmo com o jogo
em tela cheia por cima, sem precisar dar alt-tab. Os espectadores veem
"Transmissão pausada" sobre o último quadro borrado, não um quadro
congelado sem explicação; o mesmo atalho retoma. Os botões de compartilhar
tela e câmera também mudam de rótulo e cor quando ligados ("Parar de
compartilhar", "Desligar câmera"), pra não ter dúvida do que um clique vai
fazer.

**Se quem criou a sala sair normalmente, a sala continua.** Ela passa sozinha
pra outra pessoa da sala, que sobe o servidor, e todo mundo reconecta nela sem
derrubar o vídeo. Se o PC de quem criou travar ou perder energia sem avisar,
os sobreviventes esperam a reconexão desistir (até uns 2 minutos) e procuram o
sucessor direto pelo IP dele na rede virtual, sem depender de broadcast — então
isso também vale no Tailscale. Esse caminho da queda abrupta ainda não foi
testado com PCs reais.

## Gerar o instalador pros amigos

Pra ninguém precisar instalar Node:

```bash
npm run dist
```

Sai um instalador em `dist/GoLive-LAN-Setup-<versão>.exe`. Ele cria atalho
na Área de Trabalho e no Menu Iniciar, e desinstala normalmente pelo painel
do Windows. Quem só quer transmitir/assistir não precisa mais de Node — o
servidor de sinalização agora sobe embutido no próprio app quando alguém
clica em **Criar sala** (ver "Como usar" acima).

---

## Configurações de qualidade

Não há aba "Transmissão" no modal de Configurações. As categorias são
**Perfil**, **Aparência**, **Voz e Vídeo** e **Estatísticas** — nenhuma delas
tem controle de bitrate, codec ou áudio do sistema. (O anúncio da sala na
rede também não mora mais lá: virou uma opção do diálogo de criar sala.)

**Aparência** troca a cor do app: sete predefinições prontas (a primeira,
"GoLive", é o padrão, com as cores da logo e do site; "Papel" é a única
clara), e você pode trocar a **cor de ação** (botão
principal, foco do teclado, seleção) por cima de qualquer uma delas. A troca
é ao vivo, sem botão "aplicar", e o app reprova uma cor que deixaria algum
texto ilegível. Dois controles — **temperatura** e **contraste** — montam as
superfícies do seu jeito, e o que sair dali dá pra **salvar com nome** (até
12 temas). Os temas salvos ficam: "Voltar ao padrão" troca o tema em uso, não
apaga a coleção. Cada um tem um **código curto** (`GL-XXXX-XXXX-XXXX`) que vai
pra área de transferência num clique — o amigo cola o código e já vê a prévia
antes de salvar. O código carrega só as superfícies e o acento: `--live`,
`--warn` e `--danger` (os sinais de "ao vivo", "atenção" e "perigo") não mudam
em nenhum tema, nem por código de fora.

A qualidade é escolhida **no diálogo de compartilhar** (botão "Compartilhar
tela" → "O que você quer compartilhar?"), em dois controles — **Resolução**
e **Fluidez** — que formam quatro presets fechados: `720p · 30 fps` até `1080p · 60 fps` (12 Mbps), este último como
padrão. Cada preset é um pacote fechado de resolução + fps + bitrate — sem
sliders soltos. Ao lado, uma linha mostra o upload que aquele preset exige
por espectador.

- **Codec** — a tela é sempre codificada em **H.264**, normalmente no encoder
  de hardware da GPU (NVENC/AMF/QuickSync — a escolha final é do
  Chromium/Windows). Não há opção de VP9 nem AV1. A câmera usa VP8.
- **Áudio** — no mesmo diálogo, a caixa "Compartilhar som" captura o som que
  sai da placa (loopback do Windows, não o microfone). Quando o componente
  nativo de áudio está presente, aparece também "Incluir o som do Discord
  também". O Windows não oferece captura de áudio por aplicativo isolado, então
  o loopback de sistema pega tudo que sai do dispositivo de saída padrão — o
  Discord, o navegador, tudo. Pra isolar só o jogo, mande o Discord pra outra
  saída pelo mixer de volume do Windows (ou um cabo de áudio virtual). O áudio
  vai **em estéreo**: o SDP é reescrito nos dois lados pra declarar
  `stereo=1` e um bitrate Opus explícito, senão o WebRTC entrega mono por
  padrão.

**O preset que você marca é um teto, não uma promessa.** A medição do próprio
projeto mostrou 4 espectadores a 1080p60 quebrando o NVENC sem jogo nenhum
aberto. Por isso o app desce sozinho quando a sala ou a máquina não aguentam,
e volta a subir quando sobra folga — um degrau de cada vez. Dois gatilhos:

- **tamanho da sala** — o encode desce um degrau (1080p60 → 1080p30) assim que
  a sala chega a **3 pessoas** e volta ao preset quando ela encolhe;
- **telemetria de encode** — o laço fechado olha o tempo por quadro e se o
  encoder caiu pra software; quando aperta, desce mais um degrau, baixando
  também a **captura** (`applyConstraints`), não só o teto do bitrate.

Ninguém escolhe nada e não há botão pra isso.

**A queda para malha degrada de propósito.** A árvore de retransmissão
(abaixo) cai para malha direta quando não sobra nenhum relay elegível. Nesse
modo a origem volta a pagar um encoder por espectador, então o preset desce
**mais um degrau** e aparece um aviso ("baixei a qualidade pra sala
aguentar") — malha em qualidade cheia derrete o encoder, o jitter derruba
mais links e a malha se realimenta. Ao voltar a ter relay, o encode sobe
sozinho, sem aviso.

O painel de estatísticas (Configurações > **Estatísticas**) mostra fps real,
resolução, banda e latência a cada segundo. O campo **Limitado por** é o mais
útil pra diagnóstico: ele diz se quem está te segurando é a rede, a CPU ou o
encoder. Nessa mesma aba fica o botão **Abrir pasta de logs** — um arquivo por
sessão (os últimos 8 são mantidos), pra mandar pra quem for investigar um
problema.

**Atualização.** Ao abrir, uma tela de carregamento procura versão nova antes
de liberar o app: se houver, baixa e instala sozinha, sem perguntar, e o app
reabre já atualizado; sem internet, ela desiste em poucos segundos e abre o
app normalmente. Com o app aberto, nada instala sozinho: quando sai uma versão
nova, aparece uma **faixa no topo do lobby** com a versão, o que fazer e em
que pé está o download; o botão baixa e, quando o pacote já veio, muda pra
"Reiniciar e instalar". Dentro de uma sala não aparece nada disso. O botão de
**buscar atualizações** fica no painel do usuário, no rodapé da barra lateral.

---

## O que fizemos pra segurar os 60 fps

Compartilhamento de tela em WebRTC entrega 30 fps por padrão, mesmo pedindo
60. Três ajustes resolvem, e todos estão no código:

- `contentHint = 'motion'` — avisa o encoder que é vídeo em movimento, não um
  slide parado. Ele vai numa track que sai de um relay por canvas
  (`screenrelay.js`), não na track crua da captura: na crua ele derrubava o
  encoder de hardware do Windows em silêncio (corrigido na 0.11.0).
- `degradationPreference` — a tela usa `maintain-resolution`, com a resolução
  escolhida pelo app para cada espectador; a câmera usa `maintain-framerate`.
- `maxFramerate` e `maxBitrate` explícitos no `sendEncodings`, mais um
  `applyConstraints` de reforço na track, porque alguns caminhos de captura
  ignoram as constraints iniciais e entregam 30 fps caladamente.

E quando mesmo assim não segura: o app tem uma **escada automática de
qualidade em laço fechado**. Ele lê a telemetria do encoder (o tempo por
quadro e o encoder em software) e, se ele está apertado, desce um degrau —
baixando também a
própria **captura** via `applyConstraints`, não só o teto do bitrate. Quando a
folga volta, ele sobe de novo, um degrau de cada vez. Ninguém escolhe nada, e
não há botão pra isso: o preset que você marcou é só o ponto de partida.

---

## Se der problema

**"Não consegui conectar"** — quem criou a sala precisa estar com o GoLive
aberto: ao clicar em "Criar sala" o app sobe o servidor embutido e tenta
liberar a porta no firewall sozinho (a porta pode cair em qualquer valor
entre 9000 e 9010, mostrado no cabeçalho da sala). Se a liberação
automática falhar, aparece um aviso acima da grade de vídeo com um botão
**"Permitir acesso à rede"**, que re-dispara o pedido de elevação do Windows
pra mesma porta da sala. Só se essa tentativa também falhar é que o comando
manual do `netsh` aparece como texto, pra rodar como administrador na máquina
que criou a sala. Se você já resolveu a porta por fora — ou se todo mundo
entra por endereço direto e o aviso deixou de dizer alguma coisa —, o **`×`
no canto do aviso** o dispensa pelo resto da sessão. Um aviso *novo* (o
encoder caindo pra software, por exemplo) volta a aparecer normalmente.

**"Essa sala está na versão X e você está na Y"** — a sala recusa quem não
está na mesma versão do app (o protocolo de sinalização e a árvore de
retransmissão mudam entre releases, e uma sala com versões misturadas quebra
de um jeito que parece problema de rede). Use o botão de buscar atualização
no painel do usuário, no rodapé da barra lateral; se a versão mais nova for a **sua**, quem criou a sala é
que precisa atualizar.

**Conecta, aparece o peer, mas o vídeo não vem** — é ICE não fechando. O
Radmin às vezes bloqueia UDP entre peers; teste um `ping 26.x.x.x` primeiro.

**fps travado em 30** — abra as estatísticas e veja o campo "Limitado por". Se
for `CPU`, troque o codec pra H.264. Se for `banda`, baixe o bitrate ou a
resolução.

**Sem áudio** — o loopback só funciona no Windows, e só captura o áudio da
máquina inteira. Se você usa saída de áudio exclusiva (modo WASAPI exclusivo
em alguns players/DACs), o loopback vem mudo.

---

## Limites conhecidos

### A árvore de retransmissão

Desde a v0.1.5 a transmissão **não é malha pura**. Existe uma árvore de
retransmissão, **sempre ligada** — `cfg.network.tree` é forçado em `true` no
carregamento do config e não há interruptor na UI. Ela tem exatamente um
nível: **origem → relay → folha**. A origem manda pra até **dois** relays
(`FANOUT_ORIGEM = 2`); cada relay atende no máximo **dois** filhos
(`FANOUT_RELAY = 2`); a profundidade não passa de **2** — por construção: um
relay sempre pendura na origem e uma folha nunca tem filho, o que é o freio de
latência e a garantia contra ciclo. O segundo relay só abre quando o primeiro
não cobre a sala (a partir de 4 espectadores).

O relay é escolhido pela **saúde de encode** do candidato (encoder em software
é penalizado, `msPerFrame` acima do orçamento de 60 fps é penalidade), com RTT
só como desempate — o gargalo medido é o encoder do relay, não a rede.

**O teto real é ~7 pessoas** (origem + 6 espectadores, que cabem exatamente
como 2 relays + 4 folhas, com 2 encoders na origem). Quem sobra vira `direct`
e recebe oferta direta da origem — ou seja, volta a custar um encoder na
origem por espectador, que é exatamente o problema que a árvore existe pra
resolver. Com 8 espectadores: 2 relays + 4 folhas + 2 diretos = 4 encoders na
origem.

### Se a turma crescer além disso

O caminho é trocar a árvore por um SFU (mediasoup ou o
[MediaMTX](https://github.com/bluenviron/mediamtx), que é bem mais simples):
quem transmite manda **uma** cópia pro SFU, e o SFU replica pros outros. O
upload de quem transmite passa a ser fixo, independente da plateia — mas aí
alguém precisa hospedar o SFU numa máquina com upload folgado, ou numa VPS.
Essa decisão está registrada como adiada — ver `STATUS.md`.

### Se o host cai

O servidor de sinalização mora no processo de quem criou a sala. Se essa
pessoa fecha o app normalmente, a sinalização cai e, desde a 0.14.0, a sala
passa pro sucessor e os outros reconectam nela. Se o PC trava ou perde energia
sem avisar, os sobreviventes tentam reconectar por até uns 2 minutos e depois
procuram o sucessor direto pelo IP (a mesma porta da sala), um de cada vez e
com prazos contados a partir da queda, pra a sala não se partir. O anúncio UDP
da migração virou só um atalho, e é assinado com um segredo que só quem está
na sala conhece. Os vídeos podem continuar enquanto isso, mas esse caminho
ainda não foi testado com PCs reais.
