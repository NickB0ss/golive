# Relatório 5 — Produto e Novas Funcionalidades

Auditoria multi-time do GoLive LAN. Base: `main` na `0.16.0`, 733 testes,
3 dependências de produção. Leitura de `STATUS.md` inteiro, `README.md`,
`docs/2026-08-27-auditoria-de-fragilidade.md`, quatro planos e seis specs de
`docs/superpowers/`, e a leitura dos fluxos em `src/renderer/app.js`,
`ui.js`, `config.js`, `screenrelay.js`, `src/main.js`, `src/main/discovery.js`
e `server/signaling-core.js`.

---

## Resumo executivo

O produto está numa posição rara: o transporte está resolvido (árvore, escada
de qualidade, retomada de sessão, migração de sala) e a interface passou por
duas passadas de design seguidas. O que falta agora não é mais nenhuma dessas
duas coisas — é **conversa**. O app mede muita coisa e não conta quase nada:
sabe que a imagem de alguém está travando (`rxstats.js`), sabe quanta banda
sobra (`availableOutgoingBitrate`), sabe se o som que ele está mandando é
silêncio, sabe que na rede da pessoa a lista de salas nunca vai funcionar — e
tudo isso ou fica numa tabela dentro de Configurações > Estatísticas, ou não
sai do código.

**A maior oportunidade** é a janela de overlay que já existe sobre a tela real
de quem compartilha. Hoje ela serve a um recurso opt-in (rabisco) e fica
desligada o resto do tempo. Ela é o único caminho do app para a pessoa que
está **jogando** — que é o usuário principal — e está ociosa.

**O maior buraco** é entrar na sala. O título da sala é o seu próprio nome
(`app.js:1574`), a descoberta depende de broadcast UDP que as duas VPNs
recomendadas pelo próprio README não repassam (`discovery.js:44-47`), e nada
fica salvo em disco. No Tailscale — o plano B oficial do README — a lista de
salas está vazia para sempre e a pessoa redigita o IP toda vez.

---

## Buracos nos fluxos de hoje

Observados lendo o código, não supostos. Os que eu não consegui provar estão
marcados **[não verificado]**.

### 1. O nome da sala é o seu próprio nome

`src/renderer/app.js:1574` monta o cabeçalho com
`name: \`sala de ${name || 'anônimo'}\``, e `name` é o `cfg.name` **de quem
está olhando**. Quem entra na sala do Nicolas vê "sala de Fulano" — o próprio
nome. Enquanto isso o card do lobby mostra o nome certo, porque o beacon
carrega o nome do host (`src/main.js:940-957`, `hostedRoomName`). O `welcome`
(`server/signaling-core.js:780-787`) não carrega nome de sala nenhum, então o
cliente não teria como acertar mesmo querendo. É a primeira coisa que aparece
depois de entrar, em 56px de cabeçalho, e está errada desde sempre.

### 2. A descoberta não funciona na rede que o README manda usar — e o app sabe

`src/main/discovery.js:44-47`, comentário do próprio projeto:
*"VPNs tipo Radmin/Tailscale que nao repassam broadcast mas nao fazem mal em
tentar"*. O Radmin emula L2 e repassa; o Tailscale é L3 e não repassa. O
README manda trocar pro Tailscale quando o Radmin dá menos de 10 Mbps — e
quem troca perde a lista de salas inteira, sem nenhuma explicação na tela.

`src/main/network.js:10` **classifica** o endereço como `tailscale`, e
`ui.js:1991` (`renderNetworkStatus`) desenha "Tailscale" com bolinha neutra.
O app tem o diagnóstico na mão e escolhe não dizer.

### 3. Nada de sala fica salvo, então o endereço é redigitado toda vez

`src/renderer/app.js:282` e `ui.js:1976`: *"nao ha historico local salvo em
disco"*. Foi decisão consciente em 2026-08-23
(`docs/superpowers/specs/2026-08-23-qualidade-pip-perfil-audio-design.md`,
seção 3). O comentário de `app.js:1000` ainda fala de "Recentes" — ficou
órfão. Combinado com o buraco 2, o fluxo de entrar numa sala no Tailscale é:
pedir o IP no Discord → digitar → errar → pedir de novo.

### 4. O app mede a saúde de quem recebe e não mostra pra ninguém

`src/renderer/rxstats.js` calcula congelamentos, perda, fps e buffer do lado
de quem assiste. Isso viaja de volta pra quem transmite no `view-state`
(`app.js:4358`) e é guardado em `peer.receiveHealth` (`app.js:2995`). O uso é
**só** alimentar a escada de qualidade (`app.js:5093-5153`). Na tela, aparece
apenas como tabela agregada em Configurações > Estatísticas (`app.js:5229`).

Resultado concreto: quem está com a imagem travando vê a imagem travando e não
tem ideia se a culpa é da rede dele, da rede do outro ou do encoder — a única
saída documentada no README é "abra as estatísticas e veja o campo Limitado
por". E quem transmite **não sabe** que o Fulano está recebendo mal, embora o
dado esteja no objeto `peer` dele. O único sinal existente é a tag de preset
degradado no painel de membros (`app.js:1351-1380`), que só acende quando a
escada já desceu.

### 5. A banda só é medida depois que já deu errado

`availableOutgoingBitrate` é lido em `app.js:4947` e só existe quando já há
sender ativo. O diálogo de compartilhar diz o custo da escolha
("12 Mbps por espectador", `ui.js` `bandwidthLineHtml`) e nunca diz se você
**tem**. A resposta oficial pra essa pergunta está fora do app: `tools/
testar-radmin.ps1` + baixar `iperf3.exe` à mão, rodando PowerShell nas duas
máquinas. É o passo 1 do README — "Antes de tudo: teste a sua rede" — e é a
única parte do produto que ainda exige terminal, justo no app cujo argumento
de venda é "sem terminal, sem instalar Node à parte".

### 6. Não há como saber se o som está saindo

`startShare` (`app.js:3338-3500`) monta três estratégias de áudio diferentes
(loopback do Electron, captura nativa por PID com exclusão, lista de
inclusão) e em nenhum momento olha se aquele grafo está produzindo amostra
diferente de zero. O README já documenta dois casos mudos (WASAPI exclusivo,
addon nativo ausente). O ciclo de descoberta hoje é: ir ao vivo → alguém
digitar "tá sem som" no chat → parar → tentar de novo.

### 7. Quem está jogando não recebe nada do app

A janela de overlay sobre a tela real (`src/main/overlay.js`,
`src/renderer/overlay.html`) existe, é click-through, sempre no topo e fica
**fora da captura** (`setContentProtection`). Mas só sobe quando
`shareAnnotations` é verdadeiro (`app.js:2147`: `if (!shareAnnotations)
return;`), ou seja, só quando a pessoa marcou "Deixar a sala rabiscar".

Então, jogando em tela cheia: chat, "fulano entrou", "ninguém está
assistindo", "sua captura ficou instável", "o encoder caiu pra software" —
tudo isso acontece dentro da janela do app, atrás do jogo. A única coisa que
atravessa é `Ctrl+Alt+P` (`main.js:598`), que é uma via de mão única (você
manda, o app não responde). O app tem um canal de saída para a tela real e
usa esse canal para um recurso opcional.

### 8. Toda captura é a fonte inteira

`screenrelay.js:159`: `ctx.drawImage(frame, 0, 0, canvas.width,
canvas.height)`. Sempre o quadro todo. Numa ultrawide 3440x1440 ou numa 4K, o
teto de 1080p é gasto com a barra de tarefas, o segundo monitor no mesmo
quadro e o Discord aberto do lado — e não existe jeito de mostrar só a área
do jogo, nem de tirar da transmissão uma conversa privada que está num canto
da tela.

### 9. Fora da sala, o app é cego

`formatBeacon` (`discovery.js:62`) carrega nome, porta, endereço, contagem de
pessoas, cadeado e versão. Não carrega **se alguém está ao vivo**, porque o
servidor nem guarda isso: `case 'broadcast-state'`
(`signaling-core.js:1023`) só repassa e esquece, e `getPeerCount`
(`signaling-core.js:1197`) devolve `peers.size` e nada mais.

E `maybeNotifyLive` (`app.js:4252`) só dispara dentro do `case
'broadcast-state'` — ou seja, você só é avisado de que alguém ficou ao vivo
se **já estiver na sala**. A notificação de 0.14.0 resolve "estou na sala mas
com o jogo por cima"; não resolve "não estou na sala". Como não há bandeja
nem nada que segure o app aberto, o normal é o app estar fechado.

### 10. Nada segura o Windows acordado

`grep powerSaveBlocker src/main.js` → zero ocorrências. Quem só assiste fica
40 minutos sem tocar em mouse nem teclado; o protetor de tela e a suspensão
do Windows entram e derrubam a sessão. O `powerMonitor` é registrado
(`main.js:796-799`) só para **logar** `suspend`/`resume` — o app observa isso
acontecer e não faz nada a respeito. **[não verificado]** que aconteça no uso
real; o que está verificado é que nada impede.

### 11. Menores, mas registrados

- **Sair da sala sendo host não avisa nada.** `app.js:2321`, `btn-disconnect`
  chama `leaveRoom()` direto. Com gente na sala, a F3 migra e ninguém sente;
  sozinho, a sala morre. Sem confirmação em nenhum dos dois casos.
- **O README mente na seção mais assustadora.** O último bloco,
  "Se o host cai, a sala morre", diz *"não há transferência de sala: esgotado
  o retry, a sessão acaba pra todo mundo"* — contradiz a F3, lançada na
  0.14.0, e contradiz o próprio README dez parágrafos acima ("Se quem criou a
  sala sair, a sala continua"). É o que lê quem está decidindo se instala.
- **Chat mandado durante os 20 s de suspensão some** pra quem voltou — já
  registrado como pendente no STATUS (0.13.0).

---

## Propostas

Ordenadas por valor/custo. Formato dos planos de `docs/superpowers/plans/`.

---

### P1 — Sala com nome (e o nome viaja)

**Uma frase:** a sala passa a ter um nome escolhido por quem a cria, e esse
nome é o mesmo no card do lobby, no cabeçalho e depois de uma migração.

**O problema que resolve.** Buraco 1: `app.js:1574` escreve o seu próprio
nome no cabeçalho da sala de outra pessoa. Hoje o nome da sala é um dado que
existe em três lugares e é diferente em cada um: `hostedRoomName`
(`main.js:952`, o nome do host, vai pro beacon), o texto do cabeçalho
(`app.js:1574`, o nome de quem olha) e nada no `welcome`.

**Como funciona.**

- Diálogo "Criar sala" ganha um campo de texto no topo, acima das duas caixas
  existentes. Placeholder e valor inicial: `sala de <cfg.name>` (o
  comportamento de hoje vira o padrão, então quem não digita nada não perde
  nada). Máximo 40 caracteres, mesmo teto do `room` no `join`. Última escolha
  lembrada em `cfg.network.lastRoomName`, mesmo padrão de
  `cfg.network.advertise`.
- **Fio:** `room:host` (`main.js:1024`) ganha `roomName` no payload;
  `createSignalingServer` (`signaling-core.js:323`) ganha o parâmetro
  `roomName` (default `null`), guardado numa constante da sala igual ao
  `stableRoomId`. O `welcome` (os dois pontos: entrada nova em `:786` e
  retomada em `:766`) ganha `roomName`. `room-migrating` ganha `roomName` ao
  lado do `pin`/`bans`/`chat` que já carrega, e o sucessor o repassa em
  `room:host` — exatamente o caminho que o PIN já percorre
  (`app.js:1047-1070`, `becomeMigrationHost`).
- **Guardado onde:** em lugar nenhum de disco além do `lastRoomName` do
  config. O nome é da sala, morre com ela.
- **Quando dá errado:** `welcome` sem `roomName` (servidor de versão antiga —
  não acontece, a trava de versão garante, mas o código não depende disso)
  cai no texto de hoje. Nome vazio depois do `slice(0,40)` e do `trim` cai em
  `sala de <nome do host>`, montado no servidor com o `name` do peer host.

**Arquivos que mudam.** `server/signaling-core.js`, `src/main.js`,
`src/preload.js`, `src/renderer/app.js` (só o `case 'welcome'` e o
`becomeMigrationHost`), `src/renderer/ui.js` (diálogo de criar sala),
`src/renderer/index.html`, `src/renderer/config.js` (+ teste),
`src/main/discovery.js` (o beacon passa a anunciar o `roomName` no lugar do
`hostedRoomName`).

**Custo** meio dia · **Risco** baixo (um campo novo em três mensagens já
existentes; o servidor reconstrói campo a campo, então é acrescentar à lista,
com o mesmo cuidado do bug do `color` na 0.12.0) · **Depende de** nada.

**Por que agora.** É o menor diff da lista e conserta a coisa mais visível
que está errada. E não foi feito antes porque nunca houve um "nome de sala" —
o campo `room` do `join` é sempre a string `'geral'` (`app.js:1568`), o que
significa que a sala nunca teve identidade própria no protocolo; só ganhou
uma na 0.14.0, com o `roomId`, que é opaco.

---

### P2 — Amigos salvos e sonda dirigida (a descoberta que funciona no Tailscale)

**Uma frase:** uma lista local de endereços de amigos que o app **consulta**
de verdade a cada refresh, em vez de depender de broadcast UDP que a VPN não
repassa.

**O problema que resolve.** Buracos 2 e 3. No Tailscale, "Salas na sua rede"
está vazia para sempre e o app não diz por quê. Sem histórico, o endereço é
redigitado a cada sessão.

**Resposta à recusa anterior.** "Salas recentes" foi removido de propósito em
2026-08-23 (`specs/2026-08-23-qualidade-pip-perfil-audio-design.md`, §3), com
a regra *"Nada de sala fica salvo em disco"*. O motivo real era honestidade:
uma sala salva é um bookmark morto, que diz "sala do Nicolas" sem ter ideia
se aquilo existe. **Esta proposta não reabre aquilo.** O que fica salvo não é
sala, é **endereço de máquina** — e a lista nunca é exibida a partir do que
está em disco: cada entrada só aparece com o estado que a sonda acabou de
trazer ("aberta agora, 3 pessoas, 1 ao vivo" / "fora do ar" / "versão 0.15.0,
atualize"). O bookmark morto continua proibido; o que entra é um **segundo
canal de descoberta**, o que funciona onde o broadcast não chega.

**Como funciona.**

- **A sonda é uma mensagem de sinalização, não um pacote UDP novo.** Esse é o
  ponto que faz a proposta caber: o servidor embutido já escuta em 9000-9010 e
  a regra de firewall já foi criada pra porta dele
  (`main.js:1055`, `ensureFirewallRule`). Uma sonda UDP numa porta nova
  (41235) precisaria de uma segunda regra e cairia no mesmo problema do
  broadcast. Então:
  - Mensagem nova `probe` no `signaling-core.js`, tratada **antes** do
    `join` (é o único tipo aceito de um socket que não entrou). Resposta
    `probe-ok { roomName, peers, live, protected, appVersion, roomId }`
    seguida de `ws.close(1000, 'probe')`. Sem PIN, sem lista de peers, sem
    nomes: só o que o beacon já publica hoje em broadcast, mais o `live`.
  - O limitador de taxa que já existe (`MAX_MSGS_PER_SECOND`) cobre isso; o
    socket é fechado na resposta, então não há estado a vazar. Banido recebe
    `probe-ok` normalmente — ele já sabe que a sala existe.
- **Cliente:** módulo novo `src/renderer/knownhosts.js` (puro, testável):
  normalizar endereço, deduplicar por host+porta, teto de 20, ordenar por
  último sucesso. `cfg.knownHosts: [{ address, label, lastSeenAt }]` em
  `config.js`, validado item a item como o `emojiRecents` já é.
- **Quando entra na lista:** automaticamente, toda vez que um `welcome`
  chega numa sala à qual se entrou por endereço (é a prova de que aquele
  endereço serviu). E manualmente, por um "+" na barra lateral.
- **A sonda no main:** IPC novo `probe:rooms` recebendo a lista de
  endereços; para cada um, tenta a porta declarada e, se não houver porta,
  9000..9010 em série com timeout de 800 ms por tentativa. Devolve a lista de
  respostas. Roda no refresh manual e a cada 15 s enquanto o lobby está
  visível. 20 endereços × 1 porta = 20 sockets curtos; o caso ruim (endereço
  sem porta) é 11 tentativas seriais, ~9 s, e por isso a porta é gravada no
  primeiro sucesso.
- **Na tela:** a lista "Salas na sua rede" ganha as entradas sondadas, com o
  mesmo card (`fillRoomList`, `ui.js:1902`) e um selinho discreto diferenciando
  "na rede" de "salvo". Entrada que não respondeu aparece apagada com
  "fora do ar", igual à sala incompatível já aparece hoje.
- **E o aviso que falta:** `renderNetworkStatus` (`ui.js:1991`), quando
  `info.kind === 'tailscale'`, passa a dizer em uma linha: *"No Tailscale as
  salas não aparecem sozinhas — salve o endereço dos seus amigos."* O app
  para de fingir que a lista vazia é normal.
- **Quando dá errado:** sonda que estoura o timeout não remove nada da lista
  (a máquina pode estar desligada); depois de 30 dias sem sucesso a entrada
  some sozinha. Endereço malformado é descartado no `load` do config.

**Arquivos que mudam.** `server/signaling-core.js` (+ testes),
`src/renderer/knownhosts.js` (novo + teste), `src/renderer/config.js`
(+ teste), `src/main.js` (IPC + a sonda), `src/main/probe.js` (novo, puro:
qual porta tentar, em que ordem, com que timeout — sem `require('electron')`,
mesmo padrão de `spywin.js`), `src/preload.js`, `src/renderer/app.js`,
`src/renderer/ui.js`, `src/renderer/index.html`, `src/renderer/style.css`.

**Custo** 2 dias · **Risco** médio (mensagem nova no servidor; a sonda serial
não pode segurar o lobby — tem que ser assíncrona e cancelável) ·
**Depende de** P1 (o `roomName` é o que a sonda devolve; sem ele a sonda
devolveria o nome do host, que é o que o beacon já faz).

**Por que agora.** O Tailscale deixou de ser hipótese: o README manda usar
quando o Radmin relaya, e o Radmin relaya em CGNAT, que é o padrão da
operadora brasileira. Metade do público provável do app não tem descoberta
nenhuma hoje. Não foi feito antes porque em 2026-08 a única rede considerada
era a do Radmin, onde o broadcast funciona.

---

### P3 — Painel na tela real (o app fala com quem está jogando)

**Uma frase:** a janela de overlay sobre o monitor compartilhado passa a
subir sempre, e além do rabisco mostra um painel discreto com o estado da
transmissão e as últimas linhas do chat.

**O problema que resolve.** Buraco 7. Jogando em tela cheia, o transmissor
não sabe se está pausado, quantas pessoas estão vendo, se alguém entrou, se a
captura travou, nem o que escreveram no chat. Tem que dar alt-tab — que é
exatamente o que o `Ctrl+Alt+P` global existe pra evitar (`main.js:598`), o
que prova que o problema já foi reconhecido pela metade.

**Como funciona.**

- **Ciclo de vida desacoplado.** Hoje `startAnnotOverlay` (`app.js:2145`)
  desiste se `!shareAnnotations`. Passa a subir sempre que a fonte for uma
  tela inteira (`overlay.isScreenSource`); `shareAnnotations` deixa de decidir
  **se** a janela existe e passa a decidir apenas **o que ela desenha** — o
  filtro que `pushToAnnotOverlay` (`app.js:2181`) já faz continua igual.
  Compartilhando janela, nada muda (sem overlay, com o aviso de hoje).
- **O que aparece:** uma faixa de ~28px no canto superior direito do monitor
  compartilhado, fundo semi-transparente, sem sombra, sem animação: ponto
  `--live`/`--warn`, `N assistindo`, preset efetivo (`1080p30`) e o selo
  `PAUSADO` quando for o caso. Abaixo dela, no máximo 3 linhas de chat, cada
  uma sumindo em 8 s. Eventos do app (entrou, saiu, ficou ao vivo, captura
  instável, encoder em software) entram como linha na mesma pilha.
- **Fio:** **nenhuma mensagem nova.** Tudo já chega no `app.js` — o chat no
  `case 'chat'` (`:2837`), a audiência em `mergeWatchers` (`:4413`), o
  preset em `qualityFor`, a pausa em `setSharePaused` (`:3907`), o aviso de
  captura em `handleCaptureTransition` (`:3827`). O canal para o overlay
  também já existe: `overlay:fx` (`main.js:1261`). Ganha um irmão
  `overlay:hud` com um payload só (`{ live, paused, watchers, preset, lines }`),
  porque misturar HUD com o canal de efeitos efêmeros repetiria o erro que a
  spec de 2026-09-12 documentou ao separar `overlay:op` de `overlay:fx`.
- **Decisão pura em módulo novo:** `src/renderer/hud.js` — o que entra na
  pilha, quanto tempo cada linha vive, que linhas são engolidas em rajada
  (mesma classe de decisão de `livenotify.shouldNotify` e
  `soundevents.soundForEvent`, e testável pelo mesmo motivo).
- **Guardado onde:** nada. Interruptor em Configurações > Voz e Vídeo
  ("Mostrar o painel na tela enquanto transmito", ligado), em
  `cfg.hudEnabled`, mesmo padrão de `liveNotifyEnabled`.
- **Quando dá errado:** o CSP de `overlay.html` é `default-src 'none';
  script-src 'self'; style-src 'unsafe-inline'` — sem `img-src` e sem
  `font-src`. Então: **texto desenhado no canvas** com fonte do sistema, sem
  avatar e sem ícone. (Adicionar `font-src 'self'` para usar Outfit/Work Sans
  é possível — foi o que o splash precisou na 0.16.0 — mas não é o menor
  caminho e não vale na primeira versão.)
  **Jogo em tela cheia exclusiva não deixa nada por cima** — é o mesmo limite
  já documentado na 0.14.0 pra janela Espiar, e tem que ser dito na dica do
  interruptor, não descoberto pelo usuário. Em janela sem borda funciona, que
  é justamente o modo que o app já recomenda no aviso de captura instável.
  E `setContentProtection` é obrigatório: sem ele, o painel entra na captura
  e a sala inteira vê o chat duplicado.

**Arquivos que mudam.** `src/renderer/hud.js` (novo + teste),
`src/renderer/overlay.html`, `src/renderer/overlay.js`,
`src/preload-overlay.js`, `src/main.js` (o `overlay:hud` e a condição de
subida), `src/main/overlay.js`, `src/renderer/app.js`, `src/renderer/ui.js`
(interruptor), `src/renderer/config.js` (+ teste).

**Custo** 2-3 dias · **Risco** médio-alto (a janela passa a existir em muito
mais sessões do que hoje; qualquer bug dela vira bug de toda transmissão de
tela inteira. O `setContentProtection` é a linha de defesa e precisa de teste
em PC real, não só `npm test`) · **Depende de** nada.

**Por que agora.** Porque o alvo declarado do produto é "gente jogando junto",
e hoje o app inteiro vive numa janela que essa pessoa não está olhando. Não
foi feito antes porque a janela de overlay só nasceu na 0.10.0, e nasceu
amarrada a um recurso (rabisco) em vez de nascer como canal.

---

### P4 — Saúde por pessoa, visível dos dois lados

**Uma frase:** o app passa a dizer, no tile e na linha do membro, quem está
recebendo mal e de quem é a culpa — usando dado que já atravessa o fio.

**O problema que resolve.** Buraco 4. `rxstats.js` mede, `view-state`
transporta (`app.js:4358`), `peer.receiveHealth` guarda (`app.js:2995`), e
nada disso vira pixel fora da tabela de Configurações (`app.js:5229`).

**Como funciona.**

- **Lado de quem assiste:** um chip no canto inferior do tile quando a própria
  `receiveHealth` daquele tile passa do limite (congelamento na janela, ou
  perda > 2%, ou fps abaixo de metade do declarado). Texto curto e com
  culpado: *"travando — a rede entre vocês"* ou *"travando — a máquina dele
  está apertada"*. Some sozinho depois de 10 s estáveis, mesma histerese que
  `capturewatch.js` já usa pro aviso de captura (20 s de janela, 15 s pra
  limpar).
- **De quem é a culpa** — isso exige um campo novo, e é o único: quem
  transmite já sabe o próprio `qualityLimitationReason`
  (`app.js:4930`, `sample.limitation`) e o próprio `encoder`. Hoje isso morre
  na máquina dele. O `broadcast-state` (`signaling-core.js:1023`) ganha
  `limit: 'bandwidth'|'cpu'|'other'|null`, sanitizado como enum fechado no
  servidor — **e tem que ser acrescentado à reconstrução campo a campo**, que
  é exatamente onde `annotate` sumiu calado na 0.10.2 e `color` na 0.12.0.
  Com `limit` em mãos, o cliente cruza: travando + o outro lado limitado por
  banda = culpa da saída dele; travando + o outro lado sem limite = culpa da
  sua entrada.
- **Lado de quem transmite:** a linha do membro (`ui.js:2162`,
  `buildMemberRow`) ganha um segundo chip ao lado da tag de preset degradado
  que já existe — `travando`, em `--warn`. Sem número, sem tabela: quem quer
  número abre Estatísticas.
- **Decisão pura:** `src/renderer/health.js` — `verdict(receiveHealth,
  senderLimit)` devolve `{ level, blame, text }`. Testável sem DOM, e é onde
  mora a histerese (o dado oscila a cada segundo; um chip piscando é pior que
  chip nenhum).
- **Quando dá errado:** `receiveHealth` velha demais já é descartada por
  `freshReceiveHealth` (`app.js:268`) — reaproveitar, não reescrever. Sem
  `limit` (cliente que não mandou), o texto vira o genérico "travando" sem
  culpado, em vez de chutar.

**Arquivos que mudam.** `src/renderer/health.js` (novo + teste),
`server/signaling-core.js` (+ teste do campo novo),
`src/renderer/app.js`, `src/renderer/ui.js`, `src/renderer/style.css`.

**Custo** 1 dia · **Risco** baixo · **Depende de** nada.

**Por que agora.** Porque as queixas que geraram a 0.13.0 inteira ("cai da
sala sozinho", "tela mal otimizada") foram diagnosticadas lendo log de
arquivo, cruzando duas máquinas. O dado que responderia na hora já estava
viajando desde a 0.2.0 — só nunca subiu pra tela.

---

### P5 — Não deixar o Windows matar a sessão

**Uma frase:** `powerSaveBlocker` enquanto há vídeo correndo, e nada mais.

**O problema que resolve.** Buraco 10. Zero ocorrências de `powerSaveBlocker`
em `src/main.js`. Quem assiste não toca no teclado; o protetor de tela e a
suspensão entram e derrubam tudo. O `powerMonitor` já está lá
(`main.js:796-799`) — registrando o desastre no log.

**Como funciona.**

- IPC `power:keep-awake(on)` no `preload`. No main, `powerSaveBlocker.start(
  'prevent-display-sleep')` guardando o id, e `stop` no desligar. Um bloqueio
  por vez, idempotente.
- **Quem liga:** o renderer, em um ponto só —
  `renderRoomStatus` (`app.js:1396`) já é chamado em toda transição de sala,
  transmissão e qualidade. Regra: ligado enquanto houver sessão E (transmitindo
  OU algum tile de vídeo assistido). Espectador que largou todas as telas
  (`autoWatchSuppressed`) não segura a máquina acordada.
- **Decisão pura:** `src/main/awake.js` — `shouldKeepAwake({ inRoom, sharing,
  watching })`. É pequeno demais pra virar módulo? É, mas `main.js` não tem
  teste e essa regra tem três entradas e dois casos de borda.
- **Quando dá errado:** `powerSaveBlocker.start` que falha não derruba nada
  (best-effort, só log). `prevent-display-sleep`, não
  `prevent-app-suspension`: a intenção é o monitor e o protetor de tela, não
  impedir a pessoa de suspender a máquina de propósito. E o bloqueio cai
  junto com a sessão — inclusive no `teardownSession`, senão um erro deixa a
  máquina acordada pra sempre.

**Arquivos que mudam.** `src/main/awake.js` (novo + teste), `src/main.js`,
`src/preload.js`, `src/renderer/app.js`.

**Custo** 3-4 horas · **Risco** muito baixo · **Depende de** nada.

**Por que agora.** É a melhor relação valor/custo da lista e não precisa de
teste em sala real pra ter certeza de que não piora nada. Não foi feito antes
porque nunca apareceu num log — e não apareceria: a máquina que dorme não
escreve log dizendo que dormiu.

---

### P6 — Ao vivo agora, fora da sala

**Uma frase:** o beacon e a sonda passam a dizer quantas pessoas estão
transmitindo naquela sala, e o app avisa mesmo com a janela minimizada.

**O problema que resolve.** Buraco 9. Da lista do lobby não dá pra distinguir
uma sala com três pessoas conversando de uma sala com o Fulano mostrando o
jogo. E a notificação de "ficou ao vivo" (0.14.0) só existe pra quem já está
dentro.

**Como funciona.**

- **Servidor:** no `case 'broadcast-state'` (`signaling-core.js:1023`),
  gravar `me.live = Boolean(msg.live)` no peer (o servidor já tem o objeto na
  mão e hoje só repassa). Novo `getLiveCount()` ao lado de `getPeerCount`
  (`:1197`). Zerar no `removePeer`/`suspendPeer`, senão um peer que caiu fica
  "ao vivo" pra sempre.
- **Beacon:** `formatBeacon`/`parseBeacon` (`discovery.js:62/82`) ganham
  `live` (inteiro, teto 64, ausente = desconhecido, nunca 0 — a diferença
  entre "sei que é zero" e "não sei" é a mesma que o projeto já faz em
  `availableBps`). `advertiseHostedRoom` (`main.js:951`) passa
  `getLiveCount`. O `probe-ok` da P2 carrega o mesmo campo.
- **Card do lobby:** ponto `--live` e "Fulano ao vivo" / "2 ao vivo" no lugar
  de "3 pessoas" quando `live > 0`. `fillRoomList` (`ui.js:1902`) já tem o
  slot de `room-meta`.
- **Notificação do lobby:** reusar `livenotify.js` inteiro — `createTracker`
  por sessão de lobby, chave = endereço da sala em vez de peerId, mesma
  carência e mesmo cooldown de 30 s. Dispara quando uma sala passa de
  `live: 0` pra `live > 0` e o app não está em foco. O interruptor é o mesmo
  (`cfg.liveNotifyEnabled`) — não inventar um segundo.
- **Bandeja, que é o que torna isso útil:** hoje fechar a janela fecha o app
  (`window-all-closed` → `close({migrate:true})`), então o caso normal é o
  app fechado e a notificação nunca acontece. `Tray` com ícone, menu de duas
  linhas (Abrir / Sair) e `close` minimizando pra bandeja **só quando não há
  sala ativa** — fechar a janela com sala no ar continua encerrando a sala,
  porque mudar isso mudaria o significado do botão vermelho no meio de uma
  transmissão. Interruptor em Configurações, desligado por padrão: ficar
  residente é escolha, não padrão.
- **Quando dá errado:** beacon de versão antiga sem `live` → o card mostra
  "N pessoas" como hoje. `Tray` que falha ao criar (raro, mas acontece em
  sessão sem shell) → log e segue sem bandeja.

**Arquivos que mudam.** `server/signaling-core.js` (+ teste),
`src/main/discovery.js` (+ teste de format/parse), `src/main.js` (Tray +
`advertiseHostedRoom`), `src/renderer/ui.js`, `src/renderer/app.js`,
`src/renderer/config.js` (+ teste), `src/renderer/assets/` (nada novo — o
`.ico` existente serve).

**Custo** 1,5 dia · **Risco** médio (a bandeja mexe no ciclo de vida do app,
que é justamente onde mora a trava de instância única da 0.10.3 e o
`session-end` da 0.13.0 — os dois têm que continuar valendo) · **Depende de**
P2 pra funcionar no Tailscale (no Radmin funciona só com o beacon).

**Por que agora.** Porque o gatilho de uso do produto é social: alguém começa
a jogar e mostra. Hoje esse gatilho depende de mandar mensagem no Discord
pedindo pra abrir o GoLive. Não foi feito antes porque a notificação de
0.14.0 resolveu o caso mais fácil (dentro da sala) e ninguém subiu um degrau.

---

### P7 — Medidor de som

**Uma frase:** uma barrinha de nível ao lado do botão de pausa enquanto se
transmite com som, e um aviso quando o áudio compartilhado está mudo há muito
tempo.

**O problema que resolve.** Buraco 6. Três caminhos de áudio diferentes
(`app.js:3348-3400`), dois modos de falha documentados no README, e nenhuma
verificação de que sai amostra. O app tem o `MediaStream` na mão.

**Como funciona.**

- Um `AnalyserNode` no mesmo `AudioContext` que já existe pra captura
  (`getPcmAudioContext`, `app.js:3155`), pendurado no destino final antes da
  track ir pro `mesh`. `getByteTimeDomainData` a cada 100 ms, pico e RMS.
- **Na tela:** quatro barrinhas de 3px no dock, coladas no botão de pausa, que
  acendem com o nível. Zero texto quando está tudo bem.
- **Aviso:** silêncio absoluto (pico == 128 em todas as amostras) por 20 s
  seguidos com `shareSound` ligado → uma linha no aviso do palco
  (`renderHostWarning`, `app.js:1128`, que já é o lugar de aviso somável e
  dispensável): *"Estou compartilhando som, mas não sai áudio nenhum. Se você
  usa saída exclusiva (WASAPI), o loopback vem mudo."* Dispensável pelo `×`
  que já existe.
- **Decisão pura:** `src/renderer/audiometer.js` — `level(samples)` e
  `silenceVerdict(history, nowMs)`. O Analyser fica no `app.js`, a regra fica
  no módulo, mesma divisão de `capturewatch.js`.
- **Quando dá errado:** `AudioContext` suspenso (janela minimizada) devolve
  silêncio falso — o `sound.js` já aprendeu isso na 0.12.1; o veredicto só
  conta tempo enquanto `ctx.state === 'running'`. Sem som compartilhado, nada
  disso existe.

**Arquivos que mudam.** `src/renderer/audiometer.js` (novo + teste),
`src/renderer/app.js`, `src/renderer/ui.js`, `src/renderer/index.html`,
`src/renderer/style.css`.

**Custo** 1 dia · **Risco** baixo · **Depende de** nada.

**Por que agora.** Porque o áudio é a parte do app com mais caminhos
alternativos (addon nativo presente/ausente, janela/tela, Discord
incluído/excluído) e a única sem nenhuma verificação. Não foi feito antes
porque cada caminho foi construído separado e ninguém olhou o conjunto.

---

### P8 — Recorte da fonte ("mostrar só um pedaço")

**Uma frase:** escolher um retângulo da tela pra transmitir, em vez de sempre
o monitor inteiro.

**O problema que resolve.** Buraco 8. Numa 3440x1440, o teto de 1080p é gasto
com barra de tarefas, papel de parede e o Discord aberto no canto; e não há
como tirar da transmissão uma conversa que está num pedaço da tela.

**Como funciona.**

- **É quase de graça, e essa é a razão de estar aqui.** `screenrelay.js:159`
  já redesenha cada quadro num canvas — é literalmente `drawImage(frame, 0, 0,
  w, h)` virando `drawImage(frame, sx, sy, sw, sh, 0, 0, cw, ch)`. O relay
  ganha `setCrop(rect | null)`; o canvas passa a ter o tamanho do recorte
  (arredondado pra par, regra que `evenCanvasDimension` já aplica). A track
  de saída é a mesma, então **não há renegociação** — é o mesmo argumento que
  fez "trocar a fonte ao vivo" caber na 0.14.0
  (`specs/2026-09-12-trocar-fonte-ao-vivo-design.md`).
- **Na tela:** depois de escolher uma tela no diálogo de compartilhar, um
  botão "Recortar" abre a miniatura em tamanho grande com um retângulo
  arrastável, com trava opcional de 16:9. O recorte é lembrado por
  `display_id` em `cfg.crops`, não por índice de fonte (o `<n>` de
  `screen:<n>:0` não é estável — a spec de 2026-09-05 já registrou isso).
  Enquanto transmite, o botão "Trocar" ganha um irmão "Recortar" que muda o
  retângulo ao vivo.
- **Fio:** nada. O espectador recebe um vídeo de outra proporção e o
  `gridlayout` já lida com isso.
- **O detalhe que não é opcional:** as coordenadas de rabisco são
  normalizadas sobre a caixa de conteúdo do vídeo, e a janela de overlay
  (`src/main/overlay.js`, `boundsFor`) hoje cobre o **monitor inteiro**. Com
  recorte, o overlay tem que cobrir o retângulo, não o display — senão cada
  traço aparece no lugar errado na tela real. `boundsFor` passa a receber o
  recorte e devolver a interseção. Sem isso, a P8 quebra a 0.10.0.
- **Decisão pura:** `src/renderer/croprect.js` — normalizar, prender dentro
  do quadro, arredondar pra par, recusar retângulo menor que 320px de largura
  (abaixo disso o H.264 de hardware do Chromium 128 já recusou altura ≤ 359,
  ver 0.13.0 — não repetir o erro por outro caminho).
- **Quando dá errado:** monitor que muda de resolução com o recorte salvo →
  `croprect` prende no novo quadro. Recorte inválido → sem recorte, tela
  inteira, e o botão volta ao estado neutro.

**Arquivos que mudam.** `src/renderer/croprect.js` (novo + teste),
`src/renderer/screenrelay.js` (+ teste), `src/main/overlay.js` (+ teste),
`src/main.js`, `src/renderer/app.js`, `src/renderer/ui.js`,
`src/renderer/index.html`, `src/renderer/style.css`,
`src/renderer/config.js` (+ teste).

**Custo** 1,5-2 dias · **Risco** médio (mexe no caminho mais quente do app —
o relay de canvas é o que segurou os 60 fps na 0.11.0 — e no
posicionamento do overlay) · **Depende de** nada, mas convive mal com a P3
se as duas forem na mesma release sem revisão entre elas.

**Nota técnica:** a API de plataforma pra isso (**Region Capture**,
`CropTarget.fromElement` + `track.cropTo`) **não serve** — ela só recorta
captura da própria aba, não captura de tela. Confirmado na especificação do
W3C e na documentação do Chrome. O canvas que já está lá é o caminho certo.

---

### P9 — Ensaio de banda (o `iperf3` que sai do README e entra no app)

**Uma frase:** um botão na sala que mede a banda real até cada pessoa em 8
segundos e diz em que preset a sala cabe.

**O problema que resolve.** Buraco 5. O passo 1 do README — *"Esta é a parte
que decide se o projeto vai funcionar"* — é um script PowerShell que exige
baixar `iperf3.exe` à mão e rodar em duas máquinas. É o único pedaço do
produto que ainda pede terminal.

**Como funciona.**

- **Fase 1 (barata, pode ir sozinha):** o veredicto dos primeiros 10 s. O app
  já lê `availableOutgoingBitrate` por conexão (`app.js:4947`) assim que a
  transmissão sobe. Hoje isso alimenta a escada em silêncio. Passa a, uma vez
  por transmissão, comparar a soma com o que o preset escolhido pede e, se
  não couber, dizer no aviso do palco: *"Medi ~18 Mbps de subida pros seus 3
  espectadores; 1080p60 pede ~36. Já baixei pra 1080p30."* Zero protocolo
  novo, e transforma a degradação silenciosa (que hoje só aparece como selo)
  numa frase que explica.
- **Fase 2 (o ensaio de verdade):** botão "Testar a sala" no dock, disponível
  **sem estar transmitindo**. Abre uma `RTCPeerConnection` por peer com um
  único `RTCDataChannel` (`ordered: false, maxRetransmits: 0`), manda padding
  de 64 KB em rajada por 8 s com controle de fila
  (`bufferedAmountLowThreshold`), e lê `availableOutgoingBitrate` +
  `bytesSent` do `getStats`. Resultado: uma linha por pessoa
  (`Fulano — 42 Mbps · 9 ms` / `Beltrano — 6 Mbps · 180 ms — o Radmin está
  relayando`) e uma conclusão (*"cabe em 1080p30 com 3 pessoas"*).
- **Fio:** `offer`/`answer`/`ice` já existentes, com um `kind` novo `probe`
  (`isKnownKind`, `app.js:354`, precisa aceitá-lo; o servidor valida `kind`
  estrito no `reoffer`, `signaling-core.js:76` — o mesmo rigor vale aqui).
  Mensagem nova `probe-run { to, phase }` só pra combinar início e fim.
  **Este é o primeiro `RTCDataChannel` do projeto** — `grep createDataChannel
  src/renderer/*.js` hoje devolve zero.
- **Guardado onde:** o último resultado por peer em memória, exibido no
  painel de membros até a sessão acabar. Nada em disco.
- **Quando dá errado:** teste só roda com a sinalização viva e com no mínimo
  um peer; recusa (com o motivo) se alguém já estiver transmitindo — 8 s de
  padding em cima de uma transmissão viva é exatamente o que não se deve
  fazer. Peer que não abre o canal em 5 s aparece como "não consegui medir",
  que já é informação (ICE não fecha — a linha do README sobre UDP bloqueado
  pelo Radmin).

**Arquivos que mudam.** `src/renderer/bwtest.js` (novo + teste da parte pura:
agenda, cálculo de taxa, veredicto preset↔pessoas), `src/renderer/mesh.js`,
`src/renderer/app.js`, `src/renderer/ui.js`, `server/signaling-core.js`
(+ teste), `src/renderer/index.html`, `src/renderer/style.css`.

**Custo** 2 dias (fase 1: 3 horas; fase 2: o resto) · **Risco** médio-alto
(superfície de transporte nova: um `RTCPeerConnection` que não é de mídia, com
ciclo de vida próprio, dentro de um `mesh` que hoje só conhece `screen` e
`camera` — é onde mora o histórico de bugs do projeto) · **Depende de** nada.

**Por que agora.** Porque a pergunta "vai dar 1080p60 com 4 pessoas?" é a
primeira que o grupo faz e a única que o app não responde. Não foi feito antes
porque a resposta foi terceirizada pro `iperf3` num momento em que o app ainda
nem tinha servidor embutido.

---

### P10 — Clipe dos últimos 30 segundos

**Uma frase:** `Ctrl+Alt+C` salva em disco os últimos 30 segundos da tela que
você está assistindo, e a sala fica sabendo.

**O problema que resolve.** Não é buraco de fluxo, é a coisa que acontece o
tempo todo no uso real e que o app não faz: "clipa isso". Hoje a resposta é
alt-tab pro ShadowPlay ou pro OBS — o que significa que o momento se perde,
porque o ShadowPlay grava a **sua** tela, e o que aconteceu estava na tela do
outro.

**Como funciona.**

- `MediaRecorder` sobre a `MediaStream` de entrada do tile assistido, com
  `timeslice` de 1 s e um anel de 30 chunks em memória. A 12 Mbps são ~45 MB —
  teto conhecido e constante, que é o que torna isso seguro (a diferença
  entre isto e "gravar a sessão", que está na lista das descartadas).
- Disparo por `globalShortcut` (funciona com o jogo por cima, mesma mecânica
  do `Ctrl+Alt+P`, `main.js:598`) e por item no menu de botão direito do tile
  (`ui.js:1767`, que já tem "Espiar" e "Parar de assistir"). Salva em
  `Vídeos/GoLive/<nome>-<hora>.webm` via IPC, e mostra um toast com "Abrir
  pasta" (o `shell.openPath` de `logs:openFolder`, `main.js:1265`, já existe).
- **Consentimento, que é a parte que não pode ser esquecida:** o clipe é local
  e nunca sai da máquina, mas ele é a tela de outra pessoa. Então **não
  existe clipe silencioso**: sai uma linha de sistema no chat
  (`pushSystemLine`, `signaling-core.js:416`, com um `event` novo `clip`, que
  já é o mecanismo de "fulano parou a transmissão de fulano"), visível pra
  sala inteira, inclusive pra quem é dono da tela.
- **Fio:** `moderate`-style não; uma mensagem nova `clip { surface }`, roteada
  pelo servidor só como linha de sistema, com limitador próprio (1 a cada 10 s
  por peer, na mesma família do `createBurstLimiter` das reações).
- **Quando dá errado:** `MediaRecorder.isTypeSupported('video/webm;codecs=h264')`
  falso → cai pra VP8, que re-encoda em software e custa CPU; se também não
  der, o botão fica desabilitado com a razão no title, em vez de gravar algo
  que não abre. Anel zerado ao trocar de tela assistida (senão o clipe mistura
  duas telas). Sem tile assistido, atalho não faz nada.

**Arquivos que mudam.** `src/renderer/clip.js` (novo + teste da parte pura:
anel, corte, nome de arquivo), `src/renderer/app.js`, `src/renderer/ui.js`,
`src/main.js` (atalho + gravação em disco), `src/preload.js`,
`server/signaling-core.js` (+ teste da linha de sistema).

**Custo** 1,5-2 dias · **Risco** médio (memória: 45 MB por tile assistido, e
"+ Ver junto" não tem teto — o anel tem que existir só pro tile em foco) ·
**Depende de** nada, mas fica melhor depois da B1 (Electron 44 traz container
MP4 no `MediaRecorder`, que abre em qualquer lugar sem conversão; no
Chromium 128 do Electron 32 só há `webm`).

**Por que agora.** Porque é a única proposta desta lista que não corrige nada
— existe pra o app ser bom, não pra ele parar de ser ruim. Depois de três
releases seguidas de conserto e redesign, uma release precisa entregar algo
que a pessoa conta pro amigo.

---

## Ideias que eu considerei e descartei

**1. SFU (mediasoup / MediaMTX).** Descartado duas vezes, e a condição escrita
pra reabrir — "salas de 5+ com um host de upload gordo que não joga"
(auditoria, H6) — continua não acontecendo. Exige alguém hospedando, o que
quebra "sem servidor, sem infraestrutura paga". **Nada nesta auditoria mexe
nisso.**

**2. Encode-once com WebCodecs (H5).** A auditoria já o pôs como plano B. Eu
vou além: não é só caro, foi **medido e não funciona nesta build** —
`screenrelay.js:60` registra *"WebCodecs: nao alcanca o hardware a 1080p neste
build, e em software perde"*. Quem reabrir isso tem que refazer a medição no
Electron 44 primeiro, e mesmo dando certo continua sem congestion control,
sem jitter buffer, sem PLI e sem sincronia A/V — que é a objeção séria. Fora.

**3. Aumentar o teto de 4 pessoas aprofundando a árvore.**
`PROFUNDIDADE_MAX = 2` (`tree.js:12`) não é um número tímido, é o freio de
latência e a garantia contra ciclo. Um terceiro nível troca a única coisa que
funciona bem hoje (o espectador está no máximo a um salto da origem) por um
número que ninguém pediu — o uso real é "um grupo de amigos", e grupo de
amigos jogando junto tem 3 a 5 pessoas. G6 é "confirmado, por desenho" e
continua sendo.

**4. Chat de voz / push-to-talk dentro do app.** O pipeline de áudio inteiro
existe pra **excluir** o próprio GoLive do loopback e pra **incluir** o
Discord (`app.js:3348-3400`) — isso é prova, no código, de que o grupo está no
Discord falando enquanto usa o GoLive. Construir voz aqui significa AEC,
jitter buffer, seleção de dispositivo, supressão de ruído — semanas — pra
competir com a ferramenta que já está aberta na outra tela. O Go Live foi
suspenso; a voz do Discord, não.

**5. Controle remoto (mouse e teclado, tipo Parsec).** Tecnicamente cabe no
transporte. Mas a autorização da sala é cooperativa e o PIN, nas palavras do
próprio STATUS, *"não é cripto"*. Dar controle de teclado remoto num canal
sem autenticação criptográfica é a única coisa nesta lista que pode terminar
com a máquina de alguém comprometida. Não com este modelo de segurança, e
mudar o modelo de segurança é outro produto.

**6. Gravar a sessão inteira em disco.** Diferente do clipe de 30 s: uma
sessão de 3 horas a 12 Mbps são ~16 GB, e o app não tem nenhuma história
sobre espaço em disco, rotação ou aviso de disco cheio (o log de sessão
guarda 8 arquivos justamente por isso). O anel limitado da P10 é seguro
porque o pior caso é constante e conhecido; a gravação contínua não tem pior
caso.

**7. Salas públicas / lista de salas na internet / contas.** Precisa de
servidor, de moderação e de identidade. Quebra os três princípios de uma vez.
Fora de discussão, registrado aqui pra não voltar.

**8. Framework de UI (React/Vue/Svelte) ou Tailwind.** A interface é DOM à mão
com um `ui.js` de 3.637 linhas e uma guarda de CSS (`css-rules.test.js`) que
reprova fonte abaixo de 11px e cor literal fora do `:root`. Migrar custaria
semanas, jogaria fora essa guarda, e o problema do app não é produtividade de
UI — as duas últimas releases foram redesigns inteiros feitos sem framework
nenhum.

**9. Reescrever o seletor de qualidade / mexer nos presets.** Passou por
redesign na 0.7.0 (dois eixos) e por poda na 0.13.0 (1440p removido porque
prometia pixels que não existiam). Está certo. A qualidade que falta não é
mais escolha, é **informação** — que é a P9.

**10. Layout de tiles configurável (arrastar, fixar, grade manual).** A
0.15.0 acabou de fechar isso com `gridlayout.js` decidindo palco + tira, puro
e testado. Dar controle manual por cima significa duas fontes de verdade pro
layout, e a primeira reclamação viraria "meu tile sumiu".

---

## Ferramentas e APIs

O `package.json` tem 3 dependências de produção (`electron-updater`,
`node-addon-api`, `ws`) e isso é um ativo, não uma limitação. **A conclusão
desta seção é que quase tudo que vale a pena está na plataforma, não no npm.**

### Recomendadas

| API | O que destrava | Peso | Plano B |
|---|---|---|---|
| **`powerSaveBlocker`** (Electron) | P5. Sessão de 40 min sem tocar no teclado deixa de morrer. | Zero — Electron já instalado, 6 linhas. | Não chamar. Não há regressão possível. |
| **`Tray` + `app.setLoginItemSettings`** | P6. O app pode ficar residente pra receber "fulano ficou ao vivo". | Baixo em código, **médio em ciclo de vida**: convive com a trava de instância única (0.10.3) e com o `session-end` (0.13.0). | Sem bandeja: a notificação do lobby só funciona com a janela aberta e minimizada. Metade do ganho, zero risco. |
| **`RTCDataChannel`** | P9, e no futuro chat que sobrevive à queda do host e transferência de arquivo. Hoje o projeto tem **zero** data channels. | Zero dependência, **mas é superfície de transporte nova**: uma `RTCPeerConnection` que não é de mídia, com ciclo de vida próprio dentro do `mesh`. | Medir só até o host, pela `WebSocket` de sinalização que já existe. Mede você→host, não você→cada peer: honesto, mas responde metade da pergunta. |
| **`MediaRecorder`** | P10. Clipe local sem OBS. | Zero. Checar `isTypeSupported('video/webm;codecs=h264')` em runtime — no Chromium 128 do Electron 32 o container MP4 ainda não está lá; ele chega com a B1. | VP8 (re-encode em software, caro) ou botão desabilitado com o motivo no `title`. Nunca gravar algo que não abre. |
| **`AnalyserNode`** (Web Audio, já carregado) | P7. Saber se sai som. | Zero — o `AudioContext` já existe (`app.js:3155`). | Nenhum necessário. |
| **`systemPreferences.getMediaAccessStatus('camera')`** | Mensagem de erro de verdade quando a privacidade do Windows bloqueia a webcam. Hoje `startCamera` (`app.js:3983`) mostra o erro cru do `getUserMedia`. | Zero, 3 linhas no `main.js`. | A mensagem genérica de hoje. |
| **`globalShortcut`** (mais atalhos) | P10 (`Ctrl+Alt+C`) e esconder/mostrar o painel da P3. O `main.js:598` já checa o retorno do `register`. | Zero. **Cuidado real:** combinação comum colide com o jogo; escolher combinações raras e logar a falha, como já é feito. | Só o item no menu de contexto. |
| **Subir pro Electron 44 (B1)** | Além de fechar as 2 vulnerabilidades restantes: `MediaRecorder` com MP4, Chromium 5 anos mais novo no caminho de encode — e é onde a medição de WebCodecs teria de ser refeita, se um dia. **44.3.0 é a estável de 2026-09-09.** | Meio dia + verificação manual, como o STATUS já registra. | Ficar no 32. Custa a P10 sair em `.webm`. |

### Avaliadas e recusadas

- **Region Capture (`CropTarget` / `track.cropTo`)** — recusada por fato, não
  por gosto: só recorta captura da **própria aba**, não captura de tela. Não
  serve pra P8. `ElementCapture`, idem. O canvas de `screenrelay.js` continua
  sendo o caminho.
- **`chrome.desktopCapture`** — é API de extensão do Chrome; no Electron o
  equivalente é o `desktopCapturer` + `setDisplayMediaRequestHandler`, que já
  está em uso (`main.js:840-861`). Nada a fazer.
- **`safeStorage`** — não há segredo a guardar. O `ownerToken` nunca sai da
  máquina e morre com a sala; o PIN, por decisão explícita, "não é cripto";
  o `clientId` aparece na lista de banidos do dono, então nem é segredo.
  Criptografar config seria teatro.
- **`utilityProcess`** — a ideia boa: tirar o servidor de sinalização do
  processo main. O argumento existe — `sources:list` codifica um PNG por
  janela (G5 da auditoria) **no mesmo processo** que serve o heartbeat do
  WebSocket, e isso acontece no instante exato em que alguém vai transmitir.
  Mas é refatoração de infraestrutura sem bug aberto pra mostrar, e a
  auditoria já tem um item desses parado (D1). Fica registrado, não proposto.
- **Jump List / Thumbnail Toolbar do Windows** — pausar pela miniatura da
  barra de tarefas é inútil pra quem está em tela cheia, que é o caso de uso.
  O `Ctrl+Alt+P` já resolve melhor. `win.setOverlayIcon` (bolinha "ao vivo" no
  ícone da barra) é o único do grupo que vale, e é cosmético.
- **`net` do Electron** — o `electron-updater` já cuida do feed. Nada a ganhar.
- **`bufferutil` / `utf-8-validate`** (aceleradores nativos do `ws`) — o
  tráfego de sinalização é ocioso quase o tempo todo (teto de 300 msg/s por
  socket, `signaling-core.js:37`). Ganho zero, e mais um build nativo num app
  que já briga com um (`binding.gyp`, `patch-clangcl-toolset.js`). Não.
- **`electron-store`, `electron-log`, `nanoid`, `qrcode`** — cada um substitui
  15 linhas que já existem e funcionam (`config.js`, `src/main/logger.js`,
  `crypto.randomUUID`). Somar dependência pra isso é perder o ativo sem
  comprar nada.

---

## Roadmap 0.17 / 0.18 / 0.19

O app força todo mundo a atualizar junto. Então cada release tem que valer a
interrupção — e a ordem abaixo é ditada por isso, não pelo que é mais
divertido de fazer.

### 0.17 — "Entrar na sala deixa de depender de sorte"

**Entra:** P1 (nome da sala) · P2 (amigos salvos + sonda + o aviso do
Tailscale) · P6 (ao vivo no beacon, notificação do lobby, bandeja) ·
P5 (`powerSaveBlocker`).

**Por que primeiro.** É a release mais barata e a que conserta o que está mais
visivelmente errado. O cabeçalho com o seu próprio nome é a primeira coisa que
alguém vê depois de entrar. E, acima de tudo: hoje **metade do público
provável não tem descoberta nenhuma** — o Tailscale é o plano B oficial do
README e é onde o broadcast não chega. Uma release que só serve pra quem está
no Radmin está deixando gente de fora sem saber.

Tem outro motivo, e é sobre risco: as três últimas releases saíram **sem teste
em PCs reais** (STATUS diz isso em 0.14.0, 0.15.0 e 0.16.0). Uma release cujo
maior risco é uma mensagem nova no servidor e uma bandeja é uma release que
aguenta ser lançada assim. As duas seguintes não são.

### 0.18 — "O app fala com quem está jogando"

**Entra:** P3 (painel na tela real) · P4 (saúde por pessoa) · P7 (medidor de
som).

**Por que segundo.** Tema único: tudo que o app sabe e não conta passa a ser
dito, e é dito onde a pessoa está olhando — não numa tabela em Configurações.
As três se reforçam: o painel da P3 é a superfície onde o veredicto da P4 e o
aviso da P7 aparecem pra quem está em tela cheia.

Depois da 0.17 e não antes porque a P3 muda quando a janela de overlay sobe —
de "só com rabisco ligado" pra "toda tela inteira" — e isso multiplica o
número de sessões em que aquela janela existe. É a mudança desta lista que
mais precisa de um roteiro de teste manual em PCs reais, incluindo a
confirmação de que o `setContentProtection` segura (se falhar, a sala inteira
vê o chat duplicado dentro do vídeo). Merece a release inteira de atenção.

### 0.19 — "Você escolhe o que mostra, e guarda o que aconteceu"

**Entra:** P8 (recorte) · P9 (ensaio de banda) · P10 (clipe de 30 s).
**Junto, como pré-requisito:** B1 (Electron 32 → 44).

**Por que por último.** As três são as de maior risco técnico e são as únicas
que não consertam nada — são melhoria de produto, e melhoria de produto vem
depois de o produto contar a verdade. P8 mexe no caminho mais quente do app (o
relay de canvas que segurou os 60 fps na 0.11.0) e no posicionamento do
overlay que a 0.18 acabou de reformar; P9 abre a primeira superfície de
`RTCDataChannel` do projeto; P10 quer o `MediaRecorder` com MP4, que só existe
com a B1.

E a B1 entra aqui porque esta é a primeira release que **ganha alguma coisa**
com ela, em vez de só fechar duas linhas do `npm audit`. Subir Electron numa
release que precisa dele é mais fácil de justificar — e de testar — do que
subir Electron numa release que não precisa.

---

## Um item que não é proposta, mas tem que ser dito

O README, no último bloco ("Se o host cai, a sala morre"), afirma que *"não há
transferência de sala: esgotado o retry, a sessão acaba pra todo mundo"*.
Isso deixou de ser verdade na 0.14.0 (F3), e o próprio README diz o contrário
dez parágrafos acima. É o parágrafo mais assustador do documento e é o que lê
quem está decidindo se instala. Custa cinco minutos e não precisa de release.
