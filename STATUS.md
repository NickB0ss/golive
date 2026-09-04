# STATUS — GoLive LAN

Pra quem voltou ao projeto depois de um mês. Leitura de 30 segundos.
Para o passo a passo de uso e a instalação, ver `README.md`.

## O que o app faz hoje

Compartilhamento de tela em até 1080p60 entre amigos numa LAN virtual (Radmin
VPN / Tailscale). Sem servidor na nuvem, sem conta. Quem cria a sala sobe um
servidor de sinalização embutido no próprio processo; a mídia é P2P.

- Descoberta de salas na rede por beacon UDP (opcional, ligada por padrão).
- **Sala só aceita quem está na mesma versão do app.** O `join` carrega a
  `appVersion`; o servidor de sinalização de quem criou a sala recusa
  qualquer versão diferente (`join-denied`, motivo `version`, com as duas
  versões na resposta). A versão viaja também no beacon UDP, então a lista de
  salas da rede já marca a sala incompatível e desliga o botão antes do
  clique. Direção do aviso vem de `src/renderer/version.js` (quem tem de
  atualizar: você ou quem criou a sala).
- PIN opcional de 4 dígitos na sala (opt-in em "Criar sala"): corta o
  entrar-por-acidente numa rede compartilhada. Não é cripto.
- Liberação de porta no firewall do Windows automática, com botão
  "Permitir acesso à rede" quando a elevação falha.
- Áudio de sistema por loopback; áudio por processo (incluir só o Discord)
  quando o addon nativo está compilado.
- Árvore de retransmissão **sempre ligada** (origem → relay → folha,
  fanout 1/2, profundidade 2). Teto prático ~4 pessoas.
- Qualidade escolhida em **dois eixos** no diálogo de compartilhar
  (Resolução × Fluidez, um controle segmentado cada, em vez dos seis chips
  numa grade de três colunas): os presets são uma matriz 3×2 sem célula
  morta, e o controle passou a ter a forma dos dados. A linha embaixo diz o
  custo exato da combinação escolhida. O que se escolhe ali é
  só um **teto**: o app desce sozinho pelo tamanho da sala **e** pela
  telemetria de encode (tempo por quadro, encoder em software), degradando a própria captura
  via `applyConstraints`, não só o teto do encode — e volta a subir quando
  sobra folga. Um degrau extra quando cai pra malha.
- Áudio negociado em **estéreo** (Opus, bitrate declarado no SDP dos dois
  lados).
- Pausar a transmissão a qualquer momento, com atalho global `Ctrl+Alt+P`
  que funciona com o jogo por cima. **Quem assiste vê "Transmissão pausada"
  sobre o último quadro borrado** (um bitmap estático de 320px, não
  `backdrop-filter` — o `<video>` fica pausado e escondido enquanto dura),
  em vez de um quadro congelado sem explicação. O próprio tile de quem
  pausou mostra "Você pausou — ninguém está vendo".
- Botões de **compartilhar tela e câmera mostram o próprio estado**: rótulo,
  ícone e preenchimento mudam ao ligar (`Parar de compartilhar` / `Desligar
  câmera`), e a câmera tem um estado de carregando enquanto o driver abre.
- **Temas de cor** (Configurações > Aparência): seis predefinições
  (Superfície e sinal, Meia-noite, Carvão, Âmbar quente, Floresta, Papel —
  a única clara), cada uma com a **cor de ação** trocável por cima, e trava
  de contraste que reprova combinações ilegíveis antes de aplicar.
  `--live`/`--warn`/`--danger` ficam travados em todo tema, e as superfícies
  também: só o acento é escolha da pessoa.
- **Rabisco e escrita na tela de quem transmite** (opt-in no diálogo de
  compartilhar, decidido antes de ir ao vivo). Dois papéis, espelho um do
  outro: **quem assiste rabisca** (caneta, texto, desfazer e apagar os
  seus), **quem é dono da tela não rabisca nela** e tem um botão só —
  apagar tudo. A regra vale no depósito (`annotate.opAllowed`), não só na
  interface. Uma cor fixa por pessoa, derivada do id de conexão.
  Coordenadas normalizadas sobre a caixa de conteúdo do vídeo (não a do
  tile), então o mesmo rabisco cai no mesmo pixel em janela, em fullscreen
  e em quem recebe degradado. Repassado pela sinalização (`annotate`
  broadcast + `annotate-sync` roteado pra quem chega depois); o servidor
  não guarda estado nenhum.
- **O rabisco aparece na tela REAL de quem compartilha**: uma janela
  transparente, click-through, sempre por cima e **fora da própria captura**
  (`setContentProtection`, senão quem assiste vê cada traço duas vezes),
  esticada sobre o monitor compartilhado. Só pra compartilhamento de tela
  inteira — o retângulo de uma janela muda quando a pessoa a move, e um
  overlay que erra o lugar é pior que overlay nenhum; nesse caso o rabisco
  fica dentro do app e a pessoa é avisada.
- **A interface sai da frente do vídeo** depois de 3s de mouse parado:
  cabeçalho, barra de controles, barra de ferramentas e o cursor somem, e
  voltam no primeiro movimento, tecla ou foco. Não acontece em sala vazia —
  ali a barra de baixo é a única saída.
- **Imagem no chat**: clipe, `Ctrl+V` ou arrastar. Reduzida no cliente até
  caber em 200 KB, miniatura de 240px na linha, tela cheia no clique. O
  histórico do host guarda no máximo 8 imagens.
- **Emoji no chat** com busca em português, oito categorias e recentes.
- **Passar a liderança da sala** pelo `⋮` do membro. Volta sozinha pra quem
  criou a sala se o líder sair; o host que reconecta depois de passar não
  vira dono de novo.
- Painel de estatísticas mostra os dois lados: o que sai e o que está
  **sendo recebido**.
- Atualização via GitHub Releases, disparada pelo usuário (não baixa sozinha).
- Log em arquivo por sessão (Configurações > Estatísticas > "Abrir pasta de
  logs").

## Versão atual

`0.10.3` (`package.json`). Electron `^32` (fora de suporte — ver backlog),
`electron-builder` na `^26`.
Testes: `npm test` → **462 passando**. `npm run lint` → 0 erros, 10 avisos
`require-atomic-updates` (falsos positivos em `let` de módulo reatribuído
após `await`).

## Já lançado (em release com tag)

- **0.2.0** — qualidade adaptativa **por espectador**: escada de histerese por
  conexão, `receiveHealth` do espectador viajando no view-state, e a escada
  global parando de fundir a saúde dos relays.
- **0.3.0** — fechamento da adaptação: orçamento de uplink do relay por filho,
  loop de estatísticas rodando também num relay puro, banda disponível e perda
  real no painel.
- **0.3.1 – 0.3.4** — correções da escada: saúde de encode é só da tela (a
  câmera não contamina mais), a escada não vai ao piso só porque o codec é de
  software, e instrumentação do encode no log em arquivo.
- **0.4.0** ([PR #28](https://github.com/NickB0ss/golive/pull/28))
  — redesign completo da interface: dois estados explícitos, **Lobby** (criar,
  entrar por endereço, salas da rede, perfil) e **Sala** (palco + coluna de
  membros/banidos/chat recolhível), diálogos próprios de criar/entrar/banir,
  paleta índigo/vermelho/âmbar (`--act:#4F46E5` / `--live:#FF4D4F` /
  `--warn:#F5B544`); o selo de PIN no cabeçalho fecha a passada visual do B3.
  Grade de tiles, fullscreen, PiP e diálogo de compartilhar portados sem
  mudança de comportamento. **Chat de texto** com histórico de 50 (texto +
  linhas de sistema no mesmo ring buffer) guardado no servidor de sinalização,
  agrupado por autor, 5 msg/s e 500 caracteres por mensagem. **Moderação pelo
  dono** — `ownerToken` gerado por sala que nunca sai da máquina, autorização
  só no servidor; **parar transmissão** (pedido, socket segue aberto),
  **expulsar** (1008, pode reentrar) e **banir** (barra por `clientId` + IP,
  loopback de fora; confirmação com foco no Cancelar; lista "Banidos" com
  "Readmitir"). O bloqueio é cooperativo (sinalização + clientes), não é
  garantia criptográfica. **Quatro sons novos** (chat, ao vivo, transmissão
  parada, removido) + interruptor mestre em Configurações. Conhecido: o menu ⋮
  de membro ainda não navega por teclado (item **F1**, adiado). Chegou junto,
  já mesclado antes desta versão ([PR #26](https://github.com/NickB0ss/golive/pull/26)):
  a dívida das 10 promessas soltas do ESLint paga (viraram `.catch()` ou
  `void` comentado, nunca `await` — mudaria ordem de execução), um frame de
  sinalização que não é objeto (`JSON.parse('null')`) parando de derrubar o
  host, teto de 64 em `watchers`/`kind` do rebroadcast, testes de invariantes
  de `computeTree` sob 1000 salas aleatórias e fuzz de 200 frames tortos, e
  `electron-builder` 25 → 26 (`npm audit` de 15 pra 2 vulnerabilidades).
- **0.5.0** ([PR #30](https://github.com/NickB0ss/golive/pull/30)) — replaneja
  o lobby do zero como layout de desktop: três faixas (topbar / corpo / barra
  do usuário) com duas colunas — ações à esquerda (380px fixos: hero, os dois
  CTAs, e o **endereço desta máquina na rede virtual**, que antes só aparecia
  depois de criar a sala) e salas descobertas à direita em cards com avatar
  por endereço, cadeado SVG e estado vazio explicado. Empilha abaixo de
  1040px de janela. **"Anunciar na rede" saiu de Configurações** e virou
  opção do diálogo de criar sala — é propriedade da sala, decidida na hora de
  criá-la; a aba Rede de Configurações foi removida. Botão **"Criar" com
  progresso** (spinner + "Criando sala…", confirmar/cancelar desabilitados
  enquanto o firewall do Windows pode estar pedindo elevação). **Checkbox
  virou componente** (caixa desenhada, título + descrição, linha inteira
  clicável — o `<input>` real segue lá, só `opacity: 0`, pro teclado e pro
  leitor de tela). **Nome longo não estoura mais nem cria barra horizontal**
  — causa raiz era a regra base de `button` trazendo `align-items: center`,
  que num container coluna é o eixo horizontal e impedia os filhos de
  esticar até a largura do card. Diálogo de compartilhar com **tag de
  qualidade por tela** (`4K`/`1440p`/`1080p`/`720p`), ícone do app por
  janela, ordenação determinística, contador por aba e presets em chips no
  lugar do `<select>` nativo. **Grade de tiles por contagem** (1 / 2 / 3–4 /
  5–6 / 7+) com trilhas `min-content` + `align-content: safe center`, em vez
  de `auto-fit` (que deixava tile órfão ocupando meia tela) e de `1fr` (que
  empilhava toda a folga vertical numa fileira só). Barra de rolagem com
  estilo global fino e escuro. Nenhum arquivo de transporte tocado.
- **0.6.0** ([PR #32](https://github.com/NickB0ss/golive/pull/32))
  — **trava de versão de sala**: a sala recusa quem não está exatamente na
  versão de quem a criou (`join-denied {reason:'version'}` + close 1008,
  checado logo depois do ban e antes do PIN; a versão viaja no beacon UDP,
  então o card da sala incompatível já aparece apagado, sem clique e com selo).
  Protocolo de sinalização, formato da árvore de retransmissão e negociação
  P2P mudam entre releases sem acordo de compatibilidade — sala com versões
  misturadas quebrava parecendo problema de rede. **Barra única no topo do
  lobby** — era topbar + barra do usuário no rodapé, com dois botões de
  Configurações; virou uma faixa só de borda a borda (marca à esquerda;
  perfil, buscar atualização e Configurações à direita). `#btn-open-settings-2`
  e a classe `.icon-btn` (sem elemento) saíram. Novo `src/renderer/version.js`
  (parte pura: comparar + redigir o aviso), +15 testes.
- **0.7.0** ([PR #34](https://github.com/NickB0ss/golive/pull/34)) — **seletor de
  qualidade em dois eixos** no diálogo de compartilhar: os seis chips eram uma
  matriz 3×2 (resolução × fps) achatada numa lista que quebrava no meio do
  1080p; viraram dois controles segmentados, um por eixo, sempre do mais barato
  pro mais caro da esquerda pra direita. As três tags ("mais leve" / "padrão" /
  "exige banda") saíram dos alvos e viraram sufixo na linha de resumo, ao lado
  do número exato da combinação. Não virou slider porque a escada de custo não
  é monotônica (1440p30 = 10 Mbps, 1080p60 = 12). `presetFor`/`presetAxes` em
  `config.js` ao lado da tabela que indexam, com teste de produto cartesiano
  garantindo sincronia; radiogroup por eixo com roving tabindex e `aria-live`
  na linha de custo. +5 testes.
  **É a primeira release `latest` da linha do redesign** — quem estava na 0.3.4
  recebe de uma vez tudo de 0.4.0 a 0.7.0 (interface nova, chat, moderação,
  trava de versão, seletor de qualidade).
- **0.8.0** ([PR #36](https://github.com/NickB0ss/golive/pull/36)) — **estado
  visível nos toggles**: os botões de compartilhar tela e câmera mudam rótulo,
  ícone e preenchimento quando ligados ("Parar de compartilhar" / "Desligar
  câmera"), com estado de carregando enquanto o driver da câmera abre. **Overlay
  de "Transmissão pausada"** pra quem assiste — bitmap estático de 320px do
  último quadro borrado (o `<video>` fica pausado e escondido), no lugar de um
  quadro congelado sem explicação; quem pausou vê "Você pausou — ninguém está
  vendo". **Temas de cor** em Configurações > Aparência: seis predefinições
  (Superfície e sinal, Meia-noite, Carvão, Âmbar quente, Floresta, Papel — a
  única clara) mais um tema personalizado (dois sliders + cor de ação — os
  sliders saíram depois, na 0.10.0), com
  trava de contraste que reprova combinações ilegíveis antes de aplicar;
  `--live`/`--warn`/`--danger` ficam travados em todo tema. +29 testes.
- **0.9.0** — **anotação na tela, liderança e chat rico**
  (`docs/superpowers/specs/2026-09-04-anotacoes-lideranca-e-chat-rico-design.md`).
  **Rabisco e escrita** por cima da tela de quem transmite, opt-in no
  diálogo de compartilhar: caneta + texto, cor por pessoa derivada do id de
  conexão, desfazer/limpar, e "limpar tudo" só pra quem é dono da tela.
  `annotate.js` (paleta, letterbox, depósito de itens) é puro e testado; o
  canvas por tile só recebe ponteiro no modo de desenho, então os quatro
  gestos que o tile já tinha continuam intactos. **Imagem no chat** com
  redução no cliente por uma escada de reencode (qualidade antes de
  resolução), teto de 200 KB checado dos dois lados e no máximo 8 imagens
  no histórico do host — 50×200 KB seriam 10 MB pendurados no PC de quem
  hospeda. **Emoji** com ~380 entradas, busca por prefixo em português e
  recentes no config. **Passar a liderança** (`transfer-owner`): o
  `ownerToken` continua sendo a raiz da autoridade, mas `transferredTo`
  passa a decidir quem é dono no join — é o que impede duas coroas quando o
  host reconecta depois de passar; se o líder sai, ela volta pra casa.
  **Menu ⋮ do membro limpo**: "Silenciar" saiu (é local e é sobre uma tela
  — mora no botão direito do tile, que ganhou cabeçalho com nome e avatar),
  "Parar transmissão" só aparece pra quem está ao vivo, e quem não é dono
  não vê mais o botão ⋮. Diálogo de confirmação virou um só (banir e passar
  liderança). **Aparência ficou visual**: prévia ao vivo de um pedaço de
  sala montada com os próprios tokens do tema, cartões de predefinição
  viraram miniaturas do app (a rampa de 5 faixas lia como retângulo vazio
  num tema escuro), dica embaixo de cada controle e botão **Voltar ao
  padrão**. Dois bugs corrigidos no caminho: **`theme.apply` não apagava as
  variáveis inline do tema personalizado** ao voltar pra um preset, então o
  app ficava preso no último custom até reiniciar; e o **botão da câmera
  ficava com o spinner girando pra sempre** quando a sessão terminava (ou
  qualquer coisa falhava) enquanto o driver abria — o estado do botão agora
  é decidido num `finally` a partir da captura real, e uma captura que
  termina depois do teardown é descartada em vez de acender a webcam sem
  dono. +81 testes.
- **0.10.0** — **rabisco na tela real, papéis na lousa e a interface que sai
  da frente**
  (`docs/superpowers/specs/2026-09-05-rabisco-na-tela-real-design.md`).
  O rabisco passa a aparecer **na tela de verdade** de quem compartilha, por
  uma janela transparente click-through sobre o monitor compartilhado, fora
  da própria captura (`setContentProtection`); só pra tela inteira, e
  `src/main/overlay.js` decide qual monitor cobrir pelo `display_id` do
  desktopCapturer (o `<n>` de `screen:<n>:0` não é o id de display).
  A lousa ganha **papéis**: quem assiste rabisca, quem é dono da tela só
  apaga tudo — garantido em `annotate.opAllowed`, dentro do `apply`, não na
  interface. A barra de ferramentas fica sempre visível e ganha o
  **liga/desliga** (o lápis do canto do tile e o `✕` saíram), com o ícone de
  desfazer virando meio círculo com seta em vez do arco de quase 360°.
  Três bugs: **o spinner da câmera girava desde o boot** (`hidden` não
  existe em `SVGElement` e o atributo também não esconde um `<svg>` no
  Chromium — a classe `.hidden` resolve, e de quebra os três toggles voltam
  a trocar de ícone); **não dava pra escrever texto** (o campo era focado
  dentro do `pointerdown` e o `mousedown` seguinte roubava o foco, disparando
  o `blur` que o apagava); e os **sliders de temperatura e claridade** saem
  do tema — sobra a predefinição com a cor de ação por cima. A interface da
  sala passa a sumir com o mouse parado, com um timer só pros dois alcances
  e o teclado sempre acordando as barras.
- **0.10.1** — **a busca por atualização volta a funcionar**. A v0.10.0 subiu
  no GitHub só com o `.exe`: sem `latest.yml` e sem `.blockmap`. Como o
  `electron-updater` sempre lê o `latest.yml` do release **mais novo**, o 404
  ali derrubou a atualização de **todo mundo**, em qualquer versão anterior —
  daí o "Não consegui verificar a atualização" que todos viam. Três frentes:
  (a) `build.artifactName` fixa o nome em `GoLive-LAN-Setup-<versão>.exe`, sem
  espaço — o site do GitHub troca espaço por `.` no upload e o
  `electron-updater` procura com `-`, então um nome com espaço quebrava o
  download mesmo com o `latest.yml` no lugar; (b) `src/main/updater.js` passa
  a classificar o erro num **código** (`release-incompleto`, `sem-rede`,
  `limite`, `sem-release`, `feed-quebrado`) que o renderer traduz num toast
  que diz o que houve, em vez do genérico que escondia a causa — o código vai
  também pro log; (c) `scripts/check-release.js` (`npm run release:check`)
  confere um release **antes** de publicar: exige `.exe`, `.blockmap` e
  `latest.yml`, recusa rascunho e checa se o `latest.yml` aponta pra assets
  que existem de verdade, comparando os nomes normalizados. +16 testes.
- **0.10.2** — **o rabisco volta a funcionar de ponta a ponta**. Dois bugs
  independentes, cada um cortando uma metade do recurso, e nenhum deles
  fazendo barulho no caminho.
  **(1) Quem assiste nunca via a barra de ferramentas.** O servidor
  reconstrói o `broadcast-state` campo a campo e a lista não incluía o
  `annotate` — o único jeito de quem assiste descobrir que pode rabiscar
  naquela tela. Quem transmite mandava o campo certo, o servidor o
  descartava em silêncio, e do outro lado `msg.annotate` chegava `undefined`
  → `peer.annotate = false` → sem ferramenta, sem erro, sem pista.
  **(2) Quem compartilhava a tela inteira era avisado de que estava
  "compartilhando uma janela"** e ficava sem o rabisco na tela real. O
  diálogo pede as fontes em **duas chamadas paralelas** (`['screen']` e
  `['window']`) pra que as janelas, que são caras de enumerar, não segurem a
  lista de telas — mas o main **atribuía** o índice fonte→display a cada
  chamada, e a listagem de janelas indexa vazio. Como as janelas quase
  sempre chegam por último, elas apagavam o casamento que a listagem de
  telas tinha acabado de descobrir: não era um bug intermitente, era quase
  certo. `mergeSourceDisplays` soma em vez de trocar, então a ordem deixa de
  importar. Confirmado numa sonda com o Electron de verdade nesta máquina: o
  `display_id` do Windows sempre casou com o `getAllDisplays()` — antes o
  índice terminava com 0 entradas, agora termina com as 2 telas. +7 testes.
- **0.1.x** — F2 (árvore sempre ligada), A1–A7, B4/B5, C1–C3, C6, G4, H1–H4.
  Detalhe por item na auditoria e no histórico do git.

## Na branch, ainda não lançado

- **0.10.3** — **só dá pra abrir uma instância do GoLive por máquina**. Antes
  cada `npm start`/atalho abria um processo novo, cada um tentando subir
  servidor de sinalização, escuta UDP de descoberta e atalho global
  (`Ctrl+Alt+P`) próprios — receita pra sala fantasma e comportamento
  duplicado, sem aviso nenhum. `app.requestSingleInstanceLock()` roda como a
  primeira coisa do `main.js`, antes de qualquer `commandLine.appendSwitch`;
  se a trava já está com outro processo, este só sai (`app.quit()` e
  `return`). `second-instance` traz a janela existente pra frente
  (restaurando se estiver minimizada) em vez de deixar o SO abrir outra.
  Confirmado rodando `npm start` duas vezes em sequência e conferindo a
  árvore de processos: os 5 `electron.exe` continuam todos filhos do PID da
  primeira instância — a segunda tentativa não cria processo nenhum.

## Backlog técnico

Fonte única: **`docs/2026-08-27-auditoria-de-fragilidade.md`**. O que não foi
feito e não está explicitamente fora de escopo (abaixo): **C5, F3, G6, H5,
H6** e o resto do **B2**.

Sobre o **B2**: a premissa da auditoria ("14 vulnerabilidades, todas na cadeia
do `node-gyp@9`") não vale mais. Com o `node-gyp` da raiz na 11 **e o
`electron-builder` na 26**, `npm audit` cai a **2** — e as 2 são o
`electron@32` (e o `extract-zip` dele). Zerar exige subir `electron 32 → 44`,
o que é o item **B1** e precisa do app rodando. `npm audit --omit=dev`
sempre esteve em **0**: nada disso alcança quem usa o app.

**F3** (host cai, sala morre) e **G6** (teto de ~4 pessoas) são "confirmado,
por desenho" — limites conhecidos, não bugs. **B3** (sala sem autenticação)
saiu dessa lista de vez: núcleo, protocolo e UI (caixa, campo de PIN, cadeado
na lista, selo no cabeçalho) foram lançados na 0.4.0.

**C4** (`dist/` de 1,2 GB) é higiene de disco local. **C5** (branches
obsoletas) segue aberto: `claude/backlog-pos-leyjak`,
`claude/planejamentos-futuros-projeto-leyjak` e `claude/redesign-discord-style`
já estão inteiramente mescladas na `main` e só precisam ser apagadas do
remoto.

## Fora de escopo (adiado de propósito)

Precisam de verificação manual rodando o app, ou de esforço de dias.

| Item | O que é | Por que ficou de fora |
|---|---|---|
| **B1** | Subir Electron (32 → 44) | Meio dia + verificação manual; flags de WGC e assinatura do `console-message` mudam entre versões e precisam de teste no app rodando. Fecha as 2 vulnerabilidades que sobram no `npm audit`. |
| **`npm run dist` pós-`electron-builder@26`** | Rodar um build completo | O 26 muda default de scripts de pacote e nomes de artefato; não dá pra validar sem gerar o instalador. |
| **D1** | Extrair de `app.js` um módulo puro de orquestração de sessão/árvore | 1–2 dias de refatoração; ganho a prazo, não corrige bug aberto. |
| **G1–G3** | Áudio nativo em C++ (batching do IPC, cancelamento do `Stop()`, leak no `NonBlockingCall`) | Mexe em C++ nativo; só testável rodando o app com captura real. |
| **B6** | Assinatura de código do instalador | Escolha consciente (app entre amigos); custa certificado e processo. |
| **F1** | Acessibilidade (ARIA, `:focus-visible`) | Escopo de produto, não de robustez; sem harness pra validar. |

**F4** saiu desta tabela: o redesign "Superfície e sinal" já estava mesclado
desde 2026-08-23 (commit `51fc1f7`) — a auditoria de 2026-08-27 o listou como
"nada implementado" por engano (correção registrada no próprio arquivo). O que
restava era o mau uso do acento no ponto de status e a falta de estado visível
pra transmissão degradada, ambos feitos na Task 1 da branch
`feat/transmissao-honesta`.

Também adiado, registrado na auditoria (H5/H6): **SFU** e **encode-once
(WebCodecs)**. Plano B se, depois de H1–H4, a sala de 4 ainda quebrar.
