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
- **Temas de cor** (Configurações > Aparência): sete predefinições
  (GoLive — o padrão, com as cores da logo —, Superfície e sinal, Meia-noite,
  Carvão, Âmbar quente, Floresta, Papel — a única clara), cada uma com a **cor de ação** trocável por cima, e trava
  de contraste que reprova combinações ilegíveis antes de aplicar.
  `--live`/`--warn`/`--danger` ficam travados em todo tema, e as superfícies
  também: só o acento é escolha da pessoa.
- **Rabisco e escrita na tela de quem transmite** (opt-in no diálogo de
  compartilhar, decidido antes de ir ao vivo). Dois papéis, espelho um do
  outro: **quem assiste rabisca** (caneta, texto, desfazer e apagar os
  seus), **quem é dono da tela não rabisca nela** e tem um botão só —
  apagar tudo, numa pilha discreta (é botão de emergência pendurado sobre a
  própria tela a transmissão inteira, não ferramenta de uso contínuo). A
  regra vale no depósito (`annotate.opAllowed`), não só na interface. Uma cor
  por pessoa derivada do id de conexão, trocável no seletor da barra — a cor
  escolhida viaja no `begin`/`text` e é validada como `#rrggbb` nas duas
  pontas. A superfície é `'<dono>:<kind>'` dos dois lados do fio, inclusive
  no servidor (`surfaceOwner`).
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
- **Assistir uma tela por vez**, com "+ Ver junto" pra empilhar as que se
  quiser (sem teto). A primeira tela que sobe é escolhida sozinha, então numa
  sala com um só transmissor nada muda. A tela não escolhida vira um card com
  avatar, nome e os dois botões — e um `view-state {watching:false}`, que faz
  quem transmite **soltar o encoder daquele espectador**. Só telas: a câmera
  fica sempre visível.
- **Quem está assistindo** é um olho com o número no canto superior esquerdo
  do tile; a lista de nomes abre com o mouse parado no olho. A lista é a
  **união** do que a origem e cada relay reportam (`origin` na mensagem
  `watchers`), e o `looking` do `view-state` separa "meus olhos estão nisto"
  de "continue mandando, tem gente atrás de mim".
- Painel de estatísticas mostra os dois lados: o que sai e o que está
  **sendo recebido**.
- Atualização via GitHub Releases, disparada pelo usuário (não baixa sozinha).
- Log em arquivo por sessão (Configurações > Estatísticas > "Abrir pasta de
  logs").

## Versão atual

`0.18.1` (no `package.json`). Electron `^32`
(fora de suporte — ver backlog), `electron-builder` na `^26`.
Testes: `node --test` → **923 testes, 923 passando, 0 falhando**. `npm run lint` → 0
erros, 9 avisos
`require-atomic-updates` (falsos positivos em `let` de módulo reatribuído
após `await`).
`npm audit --omit=dev` → **0**. `npm audit` completo → **2 altas**, ambas de
desenvolvimento, na cadeia do Electron/electron-builder (`electron` e
`extract-zip`). Branches mescladas no remoto ainda não apagadas: **25**.

### Frente 0 (auditoria 2026-09-18)

Esta branch corrige o P0-1 (`logger.js`), o P0-2 (`firewall.js`, incluindo
comando manual seguro), o P0-3 (validação completa de data URL de imagem no
cliente e nas duas cópias do servidor, mais `escapeHtml`), o P0-5 (hook
`beforeBuild` que exige o `.node`), o P0-6 (remoção do `@media` 1040px morto),
`js-yaml` e o CI: `.github/workflows/ci.yml` substitui `test.yml`, com matriz
Node 20/22, portão de `npm audit --omit=dev` e job `empacotar` que confere o
addon nativo no pacote. O CI ficou vermelho de 05/09 (execução #61) até esta
correção por causa do `require('electron')` no topo de `src/main/logger.js`.

### Frente A1 (auditoria 2026-09-18)

O relay reconstrói links que caem, a árvore considera a carga de cada relay,
há época de compartilhamento e histerese de qualidade, o PIN tem seis dígitos
com limite por IP e os guardas de origem estão fechados (repasse só do pai
atual, `tree` só de origem ao vivo). Nada disso foi testado com 2+ PCs reais.

### Frente B1 (auditoria 2026-09-18)

O nome da sala passa a ser escolhido por quem cria e viaja na sessão, a tela
fica acordada enquanto há sala, os defeitos K/L/M/N/O foram fechados e o
glossário ganhou teste. Nada disso foi testado com 2+ PCs reais.

### Frente B2 (auditoria 2026-09-18)

Entraram a saúde da recepção por pessoa, com histerese e culpado visível, e o
medidor de som sobre o `AudioContext` existente. Nada disso foi testado com 2+ PCs reais.

### Frente B3 (auditoria 2026-09-18)

Nota (2026-09-20): Amigos salvos foi removida a pedido; `probe` permanece apenas para migracao de sala.

Entraram amigos salvos, sonda dirigida pela sinalização e o aviso de que no
Tailscale as salas não aparecem sozinhas. Nada disso foi testado com 2+ PCs reais.

### Frente A2 (auditoria 2026-09-18)

A migração não depende mais de broadcast: sobreviventes conectam diretamente
ao sucessor, o beacon de migração é autenticado, há prazo absoluto para a
sucessão e o sucessor continua sondando enquanto aguarda o firewall. **Nada disso foi testado com 2+ PCs reais** -- a migração
abrupta, o Tailscale e o caminho elevado do firewall só fecham com máquinas de
verdade, e é o que falta antes do release.

### Incidente do renderer (PRs #62/#63)

O #62 introduziu um `ReferenceError` de TDZ em `watchedScreens`; o #63 corrigiu
a declaração antes do primeiro uso. `node --test` não carrega `app.js`: a suíte
ficou verde, e o erro só apareceu abrindo o app real. A regra nova é rodar o
app antes de mesclar mudança no renderer.

## Próximos passos

- **noite de teste com 2+ PCs reais** -- o passo que falta antes do release,
  e o teste que mais importa e derrubar o PC do lider de verdade, de
  preferencia no Tailscale (e o que a Frente A2 mudou);
- subir a versao e lancar (a tag dispara o `release.yml`, que sobe os
  artefatos num rascunho; publicar continua sendo clique manual);
- Frente C, o que sobrou: D1 (quebrar o `app.js`) e fanout 2 na origem;
- acabamento P3 (fontes e espacamentos sem token, Espiar ignorando o tema,
  Tab em campo invisivel, sala sem h1) e o resto da P2 da Frente B (selo de
  sala achada por sonda, aviso de amigo fora do ar).

Feitos em 2026-09-19: `release.yml` criado, 25 branches mescladas apagadas do
remoto e os 2 releases-rascunho orfaos removidos.

## Lançado na 0.19.0 (2026-09-20)

Duas coisas nesta versão: o que o log de uma sessão real ainda deixava
quebrado depois da 0.18.1, e a subida do Electron, parada havia dezoito meses.

**A tela que ficava preta e não voltava.** A 0.18.1 acertou a causa (alternar
com o jogo por cima suspendia o encoder), mas deixava o pior caso de pé: um
tile que já tinha mostrado imagem e congelava nunca pedia reconexão -- só o
que nunca mostrou nada pedia. Agora o vigia cura o tile congelado, e só quando
nada chega de verdade: se a imagem está parada mas os bytes continuam subindo
(alguém compartilhando algo estático), ele não mexe. Alternar a cada 3 s também
parou de derrubar a transmissão: a carência vira 12 s depois de três piscadas
em 12 s, e o relógio do vigia pausa em vez de zerar. Um pedido de reconexão por
vez, por pessoa, para a origem pausando não virar enxurrada.

**O som que saía atrasado.** A fila do lado C++, antes do teto de 120 ms que a
0.18.1 colocou, era ilimitada. Agora tem teto de 200 ms, descarta o mais antigo
e conta no log. E a etapa final saiu da thread de tempo real: a conversão que
rodava amostra por amostra (1.984 iterações por bloco, até cinco capturas ao
mesmo tempo) virou cópia em bloco, medida de 8,55 µs para 3,50 µs por bloco.

**Electron 32 → 44.** As três armadilhas do plano, fechadas: o log do renderer
continua legível (a assinatura mudou na 35 e viraria lixo em silêncio), as
flags de WGC e H264 chegam intactas -- conferido rodando, com `appendSwitch`;
`appendArgument`, que era a hipótese do plano, apagaria as features sem avisar
-- e o addon compila em C++20. O app valida as flags em tempo de execução e
grava erro se alguma não chegar. `npm audit` completo: 2 altas -> **0**.

**Segurança e desempenho.** Nenhuma janela bloqueava navegação; agora todas
bloqueiam, e a captura de tela só é aceita da janela principal. O painel de
estatísticas era remontado no DOM a cada segundo, aberto ou não, disputando o
main thread com os 60 quadros por segundo do repasse -- fechado, agora não
toca no DOM. O chat ganhou teto de 200 mensagens na tela, com as imagens
dentro. Sete regras do lint entraram com zero ocorrência.

**O que não foi testado.** A subida do Electron e as correções de rede e áudio
entraram na mesma versão. Nada disto rodou com 2+ PCs reais -- e é justamente
captura de tela, reconexão e áudio. O roteiro do passo 7 do plano do Electron
(WGC vivo num jogo em tela cheia, encode em hardware, ICE com o IP da VPN,
áudio por processo, sala de 3+ por 15 min com queda de VPN provocada) vale
antes de publicar.

## Lançado na 0.18.1 (2026-09-19)

Correção dos três defeitos que um log de sessão real de 90 minutos expôs:
a transmissão que parava sozinha, a tela do outro que ficava preta para
sempre depois de gente entrar e sair, e o som que saía atrasado.

**Os dois primeiros tinham a mesma causa: a visibilidade da janela mandava
no encode sem nenhuma histerese.** Este app roda com o jogo por cima --
alternar é o uso normal, não a exceção. O log registrou 70 mudanças de
visibilidade em 90 minutos, 27 delas a menos de 2 s uma da outra, com
janelas de `watching=true` de 0,40 a 1,30 s. Um keyframe de tela 1080p
depois do `replaceTrack` demora mais que isso: cada olhada religava a track
e a arrancava antes do primeiro quadro pintar, e o tile nunca pintava.
A autocura que existe exatamente para esse caso (`stallwatch.js`) também
não disparava nenhuma vez -- a mesma piscada zerava o cronômetro de 6 s a
cada meio segundo. O log inteiro não tem um único `reoffer`.

Agora a visibilidade passa por uma carência assimétrica (`viewhold.js`):
ficar visível vale na hora, ficar oculto só vale depois de 2,5 s. A pintura
continua no sinal cru -- parar de desenhar com a janela coberta é economia
de GPU deliberada (F1.4) e segue valendo.

**O latch silencioso do `setPeerDemand`.** `replaceTrack` é assíncrono e a
rejeição dele morria num `.catch(() => {})`, com o estado já gravado como
sucesso. Um religar que falhava deixava o sender sem track para sempre: a
suspensão seguinte não achava sender de vídeo, salvava uma lista vazia, e o
religar seguinte não tinha mais em quem devolver a track. Tela preta
permanente, sem uma linha de log. Agora as trocas são serializadas por
`{peer, kind}`, a falha avisa e preserva os senders para a próxima
tentativa, e `closeOut` larga os senders de uma pc fechada.

**O som atrasado.** O buffer do `pcm-injector-worklet` tratava 2 s de
capacidade como folga generosa; numa fila produtor/consumidor com relógios
independentes (WASAPI e o `AudioContext` nunca batem), folga é latência. O
consumo é rígido -- 128 amostras por quantum -- e nada pulava para frente,
então o atraso de qualquer soluço nunca voltava. Agora o backlog tem teto
de 120 ms: passou disso, descarta o mais velho e segue do mais novo.

**O que o próximo log vai ter e este não tinha:** `[visibilidade]` com a
fonte da mudança e a contagem de piscadas, `[diag] audio nativo` com atraso
e quadros cortados, e a linha `[assistir] demanda` contando o estado real --
ela chamava `describeOut` no mesmo tique da troca e imprimia sempre o estado
anterior, invertido em 100% das 60 transições.

Fica de fora: a fila ilimitada do `loopback_capture.cc` (`maxQueueSize = 0`)
e o áudio remoto roteado por Web Audio em `ui.js`, que quebra o lip-sync do
WebRTC -- esse é troca de arquitetura, não ajuste.

## Lançado na 0.18.0 (2026-09-19)

A auditoria multi-time de 18/09 virou seis levas de trabalho
(`docs/2026-09-18-auditoria-multi-time.md`). Nada aqui é funcionalidade nova
pedida por uso: é o que estava quebrado, o que o app media e não contava, e o
laço que ninguém fechava.

**A rede que se conserta sozinha.** O link do relay para quem assiste, quando
caía, não era reconstruído por ninguém: a tela sumia para uma pessoa só e nada
a trazia de volta. Agora o relay tenta de novo (1 s, 2 s, 4 s), a conexão
morta é fechada, e quem ficou sem imagem pede uma nova oferta. Duas pessoas
transmitindo deixam de eleger a mesma máquina como relay: a carga de cada uma
entra na conta da árvore. A qualidade, que descia com cuidado e subia sem
nenhum, agora espera 10 s de sala estável antes de voltar um degrau.

**A sala não se parte mais quando o líder cai.** Os sobreviventes deixam de
depender do aviso por broadcast (que o Tailscale não repassa) e conectam
direto no endereço do sucessor; todos contam o mesmo prazo desde a queda, e só
um assume por vez. Se o sucessor ficar preso no aviso do firewall, ele cede a
sala a quem assumiu e derruba o servidor atrasado. O aviso de migração passou
a ser assinado, então ex-membro ou banido não desvia mais a sala.

**O app conta o que sabe.** Cada tile mostra a saúde da recepção (ok, atenção,
ruim) com o culpado provável, e quem transmite vê quem está travando. O
medidor de som mostra que está saindo áudio e avisa quando o áudio ligado está
mudo. A sala tem nome escolhido por quem cria, e a tela não apaga mais durante
a sessão.

**Achar a sala no Tailscale.** O endereço de quem você já visitou fica salvo

Nota (2026-09-20): Amigos salvos foi removida a pedido; no Tailscale, entre pelo endereco de quem criou a sala.
em Amigos salvos, e o app pergunta direto a cada um se há sala aberta, pela
mesma porta da sinalização. A tela inicial avisa que ali as salas não aparecem
sozinhas.

**Segurança e entrega.** O PIN foi para 6 dígitos com bloqueio por IP; a regra
de firewall deixou de ser montada com o caminho do executável cru; a imagem do
chat é validada por inteiro; o `npm run dist` falha se o áudio nativo não foi
compilado. O CI voltou a existir de verdade (Node 20 e 22, portão de
vulnerabilidade de produção e um job que confere o addon dentro do pacote) e o
`release.yml` monta o rascunho do release a partir da tag.

**O que não foi testado.** Nada disto rodou com 2+ PCs reais. A migração
abrupta, o Tailscale e o caminho elevado do firewall só fecham com máquinas de
verdade — e é o que falta antes de publicar.

## Lançado na 0.17.0 (2026-09-17)

Oito frentes de interface numa branch só (`feat/chat-atualizacao-tela-cheia`),
todas saídas de pedidos de uso: o chat, a forma de avisar que existe
atualização, o que vaza na tela cheia, as reações, e um tema montado pela
pessoa que dá pra mandar pro amigo por um código. **Lançado sem teste em PCs
reais** — `npm test`/lint, revisões de código (Codex terra) e uma auditoria no
app real pelo hook `--require`, que clica pela interface, mede o DOM e tira
prints. Nada muda no protocolo nem no formato da sala: dá pra estar numa sala
com quem ainda está na 0.16.0.

### Chat

- **O texto "Escreva pra sala…" ficava acima dos ícones.** A regra global
  `button { min-height: 44px }` ganhava do `height: 28px` dos botões da caixa,
  então o campo e os ícones nunca alinhavam. Agora os botões da caixa levam
  `min-height: 0` e o centro dos dois bate (medido no app: 0px de diferença).
- **A caixa cresce com a mensagem.** O `max-height: 88px` era CSS morto: nada
  mexia na altura do `textarea`. Agora `autoResizeInput()` acompanha o texto
  até 88px e depois rola por dentro; a caixa arredondada vira um retângulo
  quando passa de uma linha.
- **Botão de enviar**, junto com o Enter de sempre. Fica apagado com o campo
  vazio e enquanto o chat está offline — antes dava pra mandar pelo teclado
  mesmo desligado. A dica do Shift+Enter e o contador saíram de dentro do
  fluxo do campo.
- **Quem está lendo o histórico não é mais arrancado de volta pro fim.** Só
  desce sozinho quem já estava a menos de 48px do fim; pros outros aparece
  "Novas mensagens" logo acima da caixa.
- **Separador de dia ("Ontem", "Hoje") e estado vazio.** O separador também
  quebra o agrupamento por autor, senão a mensagem das 00:01 herdava o nome e
  o avatar da mensagem das 23:59.

### Atualização

- **Uma faixa no topo do lobby no lugar do botão pequeno e do banner do
  canto.** Diz a versão, o que fazer e em que pé está o download; o botão
  muda de "Baixar" pra "Reiniciar e instalar" quando o pacote já veio.
- **Dentro da sala não aparece nada de atualização** — a faixa vive no lobby
  e some junto com ele.
- **O estado "já baixado" não mente mais.** O processo principal manda um
  `available` sintético pra pacote que já está no disco; sem o `ready: true`
  a faixa dizia "Atualizar agora" e o clique reinstalava e reiniciava.

### Tela cheia e reações

- **Nada da sala vaza mais por cima da tela cheia** — o rótulo do botão
  "Compartilhar tela" era o mais visível. Em vez de disputar `z-index`, a
  casca da sala inteira fica escondida (`visibility`), o que preserva o
  layout e não faz o `gridlayout` recalcular.
- **Com o mouse parado some tudo**: rótulo, botão de tela cheia, barra de
  reações e o próprio cursor. Menus e o seletor de PiP fecham junto. Um teste
  novo exige regra de ociosidade pra todo overlay novo do tile.
- **As reações viraram um botão que abre a barra**, em vez de a barra ficar
  sempre aberta em cima da miniatura da câmera. Nas miniaturas da tira ela
  nem aparece.
- **O emoji da reação acompanha o tamanho do tile** (12% da largura, entre 14
  e 72px), em vez de sair do mesmo tamanho numa miniatura e na tela cheia.
- **Os avisos da sala** (tela pausada, tela retomada) foram pro canto
  inferior esquerdo, longe da caixa do chat.

### Tema próprio, com código pra mandar pro amigo

- **Dá pra montar o tema nos controles da aba Aparência e salvar com nome**
  (até 12 temas). Os temas salvos sobrevivem ao "Voltar ao padrão" e a fechar
  o app.
- **Cada tema tem um código curto** (`GL-XXXX-XXXX-XXXX`) que vai pra área de
  transferência. Colar um código de amigo já mostra a prévia antes de salvar;
  código inválido não mexe em nada.
- **O código carrega só as superfícies** — temperatura, contraste e a cor de
  ação. As cores de estado (o verde do "ao vivo", o amarelo e o vermelho) não
  entram por construção, então um código de fora não consegue apagar o aviso
  de perigo.

### Defeitos que só a auditoria no app real pegou

As revisões de código acharam erro de lógica e de API, mas nenhum destes
quatro — todos de desenho, camada ou ciclo de vida do DOM:

- O texto do campo do chat continuava desalinhado depois da correção, por
  causa do `min-height: 44px` global.
- Uma correção tinha posto o "Novas mensagens" dentro de `#chat-messages`,
  que o `setHistory()` limpa com `innerHTML = ''` — quebrava o chat em toda
  entrada de sala.
- O menu do tema e o diálogo de dar nome abriam **por trás** da janela de
  Configurações (`--z-popover` 50 contra `--z-modal` 1000).

Daí o token novo `--z-modal-popover`, aplicado só quando a âncora está dentro
de um modal.

**Aceito sem mexer:** o aviso fica numa camada acima da faixa de título
(`--z-toast` 10000 contra `--z-titlebar` 9999). Na prática não se encontram —
o aviso fica preso no rodapé, a faixa tem 32px e a janela tem `minHeight: 600`.

**Falta testar com gente:** a atualização com duas versões publicadas de
verdade, e o código de tema indo de uma máquina pra outra.

## Lançado na 0.16.0 (2026-09-15)

Duas frentes do mesmo dia, juntas em `feat/integracao-2026-09-15`: a correção
de um log real ("tive que sair e entrar da sala", branch
`fix/retomada-e-espiar`) e o redesign com as cores da logo e estrutura de app
(branch `feat/redesign-marca`). **Lançado sem teste em PCs reais** — só
`npm test`/lint, prints do app real pelo hook `--require` e revisões de
código (Codex terra, high). Todo mundo da sala precisa estar na 0.16.0.

### Correções

Tiradas do log de quem assiste de 2026-09-15 (0.15.0): "tive que sair e entrar
da sala".

- **A tela não voltava depois de uma queda curta da sinalização.** Sequência
  do log: `close 1006` → sessão órfã → uma tentativa sem handshake em 8 s (a
  rota até o host caiu por ~10 s na LAN virtual) → `sessao retomada` em 12 s →
  `recoverUnstable` fecha a conexão de **entrada** da tela, que tinha ficado no
  meio de SDP/ICE. Nada a reabria: o `onPeerState` só recupera saída, e quem
  transmite, ao receber `peer-resumed`, via a própria saída `stable/connected` e
  respondia "nada a re-ofertar". O stallwatch não dispara porque aquela tela já
  tinha mostrado quadro. Agora cada entrada fechada na retomada vira um pedido
  `reoffer` para quem a serve (origem ou relay), a mesma mensagem da autocura
  (`resume.reofferRequests`). Os pedidos saem espaçados em 600 ms (o servidor
  aceita 2 `reoffer`/s por peer, em janela fixa) e, como espaçar não garante a
  chegada, cada um se repete a cada 8 s, até 3 vezes, enquanto a entrada não
  volta — e para assim que ela volta, sem derrubar uma saída que outro caminho
  já refez (`reofferStillNeeded`). O `peer-resumed` zera a carência de 15 s do
  `reoffer` daquele peer no emissor, senão uma autocura pedida antes da queda
  barraria o pedido da retomada. Achados de duas rodadas de revisão do Codex
  (terra, high). A queda de
  rede em si é do ambiente (Radmin/Wi-Fi); o app só pode voltar sozinho, e
  agora volta.
- **Abrir a janela Espiar lançava `uncaughtException` no main.** O listener de
  `did-create-window` tinha um `_event` a mais (no Electron 32 a assinatura é
  `(window, details)`), então `details` chegava `undefined`: a janela abria, mas
  o nível "sempre no topo sobre jogo", a posição lembrada e o controle de janela
  única nunca eram aplicados. Reproduzido e confirmado corrigido no app real pelo
  hook de screenshot (`--require`).


### Redesign "Marca" — cores

Spec: `docs/superpowers/specs/2026-09-15-redesign-marca-design.md`. O app passa
a ter a cara da logo e do site (`golive-website`), em vez de parecer outro
produto.

- **Tema padrão novo "GoLive" (`marca`)**: neutros com tom violeta
  (`#0A0A0F` → `#292936`), texto na cor do traço da logo (`#EDEDF2`), ação
  violeta `#5B4BE8` (branco sobre ela 5,81:1). Passa pela mesma trava de
  contraste dos outros temas. "Superfície e sinal" continua escolhível.
  Config antigo com `signal` e sem cor de ação própria migra uma vez só
  (`themeMigration`); escolha feita depois nunca é desfeita.
- **Fontes da marca, locais**: Outfit (títulos, nome da sala, rótulos de
  seção) e Work Sans (corpo), `.woff2` em `src/renderer/assets/fonts/` com a
  licença OFL. Splash e Espiar também — o CSP do splash ganhou `font-src
  'self'` (sem ele as fontes eram recusadas em silêncio).
- **Acabamento**: foco visível por `--ring`, Configurações com cabeçalho e o
  fechar fora da área que rola, placeholder e borda do chat legíveis, rótulos
  de seção num estilo só.
- **Aparência**: o card "GoLive" vem primeiro e marcado. A lista de cards é um
  array fixo em `ui.js` que tinha ficado sem `marca`; `theme.test.js` agora
  cobra que todo preset esteja nela.

- **Texto do botão primário ilegível em quatro temas (vinha da 0.15.0)**:
  preset puro não escrevia `--on-act`, então valia o `#fff` do `:root` —
  Meia-noite 3,21:1, Floresta 2,99:1, Carvão 2,54:1, Âmbar 2,28:1. A trava
  aprovava porque `validate` deriva o texto certo sozinho; o `apply` é que não
  o aplicava. Agora todo preset escreve o `onAct` de `deriveAction` (5,68–8,00:1),
  com teste por preset. Achado da revisão do Codex (terra, high).
- A busca de emoji ganhou anel de foco na linha inteira (o campo zerava o
  próprio e não tinha substituto).

### Estrutura de app

Spec: `docs/superpowers/specs/2026-09-15-estrutura-de-app-design.md`. Pedido
depois das cores: "mudar a estrutura, posicionamento de botões, cara de app
moderno" e, na sequência, "o posicionamento e o tamanho das coisas dentro da
sala". Nenhum id sumiu (o JS usa ~130); só `btn-room-settings-dock`, criado e
removido no caminho.

- **Lobby em casca**: a faixa do topo virou barra lateral fixa (marca, "Criar
  sala", "Entrar por endereço", cartão "Sua rede") com o painel do usuário
  preso ao rodapé (avatar, nome, atualizar, configurações). Salas em grade de
  cards no painel principal; o texto de apresentação mora no estado vazio.
- **Sala**: cabeçalho de 56 px (nome, "N pessoas", chips de endereço e PIN,
  copiar com ✓ e aviso em `aria-live`); palco com menos margem; palco vazio
  desenhado; **dock** centralizado no fluxo do layout (nunca por cima dos
  tiles) — "Compartilhar tela" com rótulo, câmera/pausar/trocar/configurações
  redondos de 48 px com a dica saindo do próprio `.btn-label`, "Sair" redondo
  em `--danger`. Coluna lateral de 320 px com abas **Pessoas · N / Chat** e
  ponto de não lido (só mensagem de outra pessoa; reinicia ao trocar de sala,
  não numa retomada).
- **Diálogos e Configurações**: rodapé de ações padronizado; ícones na
  navegação de Configurações. Escala de `z-index` em tokens.
- **Defeitos pegos no caminho**: o estilo novo do palco vazio pegava a classe
  `.empty` de qualquer elemento e transformou o contador de salas do lobby numa
  bolha com ícone (mesma classe de bug da 0.12.0) — agora é `.grid > .empty`,
  com teste que reprova `.empty` sem escopo; rótulos do dock escondidos com
  `display:none` a 900 px deixavam "Compartilhar tela" sem nome acessível;
  `aria-label` fixo em câmera/pausa mascarava o estado ("Desligar câmera",
  "Retomar"). Três rodadas de revisão do Codex (terra, high).
- Medido no tamanho mínimo da janela (900x600) com o dock cheio e a coluna
  aberta: dock em 68–504 px dentro de um palco de 8–564 px.

Conferido com prints do app real (hook `--require`) a 1440x900, 1366x768 e
900x600, tema Papel incluído. Testes da versão: ver "Versão atual".

## Lançado na 0.15.0 (2026-09-14)

Passada só de design, a partir de uma auditoria com screenshots do app real
(sala simulada com streams de canvas; **não testado em sala real entre PCs**).
Nenhuma mudança de protocolo, mídia ou sinalização — mas a trava de versão
vale igual: a sala inteira precisa estar na 0.15.0.

- **Palco em destaque.** Com uma tela assistida e mais alguém na grade
  (câmera, ou tela ainda não assistida), a tela ocupa o palco em 16:9 pela
  altura disponível e o resto vai para uma tira de 148px embaixo, centralizada
  e com rolagem horizontal. Duas ou mais telas assistidas dividem o palco em
  colunas. Sem tela assistida, ou com um tile só, a grade por contagem de
  antes. A decisão é pura (`src/renderer/gridlayout.js`, testada); `ui.js`
  move os tiles entre `.grid-main` e `.grid-strip` e recalcula em todo ponto
  que muda a composição (tile novo ou removido, assistir/parar, troca de kind).
  Câmera da tira em tela cheia não herda a altura da tira.
- **Configurações dentro da sala.** Engrenagem no cabeçalho da sala. Antes o
  único gatilho morava no topo do lobby, que some ao entrar, e a aba
  Estatísticas ficava inalcançável justamente durante a sessão.
- **Estatísticas fora da sala** dizem que aparecem durante a sessão, em vez
  de uma aba vazia; `ui.js` guarda a última leitura e a reaplica quando a aba
  é remontada.
- **Rodapé fixo no seletor de fonte.** Cancelar / Ir ao vivo ficavam abaixo
  da dobra em 1440×900 e 1366×768.
- **Emoji que era ícone virou SVG:** o cadeado do PIN no cabeçalho (o card de
  sala já usava SVG) e a coroa do dono.
- **Tipografia.** A pilha de fontes declarava `'Inter'`, que nunca foi
  empacotada (a CSP só aceita `'self'`): virou `'Segoe UI Variable Text',
  'Segoe UI', system-ui`, a fonte que de fato aparecia. Nenhum texto abaixo de
  11px (eram 13 regras entre 8 e 10,5px). Placeholder do PIN com fonte e
  espaçamento normais. "Readmitir" e o rótulo das estatísticas saíram de
  `--act`/`--muted` para `--tx3`, que passa 4,5:1 em 11px.
- **Tema Papel:** o corpo das mensagens do chat usava `--tx-soft`, que só
  existia no tema escuro (#D3D7DD) e ficava quase invisível no claro; o Papel
  ganhou o próprio `--tx-soft`.
- **Guarda de CSS** (`src/renderer/css-rules.test.js`): falha com fonte abaixo
  de 11px, `backdrop-filter` ou cor literal fora dos blocos `:root` (exceção
  documentada: o hover do fechar da barra de título). Provado vermelho com as
  três violações injetadas.

## Lançado na 0.14.0 (2026-09-12)

Seis frentes de 2026-09-12 mais o hotfix 0.13.1 (bloco no fim desta seção).
Specs e planos em `docs/superpowers/specs/` e `docs/superpowers/plans/`
(`2026-09-12-*`); roteiro de teste manual em
`docs/testes/2026-09-12-roteiro-teste-novidades.md`; pesquisa sobre o
compartilhamento em `docs/2026-09-12-pesquisa-compartilhamento-de-tela.md`.
**Lançado sem teste em PCs reais** — só `npm test`/lint e quatro rodadas de
revisão de código; o roteiro é a validação pendente.

- **Tela de carregamento com atualização automática** (`src/splash/`,
  `src/main/boot.js`, `src/main/update-policy.js`). Na abertura, antes da
  janela principal, o app checa a atualização (limite de ~5 s) e, se houver,
  baixa e instala sozinho, sem perguntar; sem rede, com erro ou download
  travado, libera o app. Com o app aberto: checagem a cada 60 min e botão
  "Atualizar" no lobby (cor de ação e um ponto `--warn`), escondido dentro da
  sala. Download manual que termina com a pessoa numa sala só instala no
  próximo clique, já fora dela (IPC `room:active`). Substitui a decisão de
  2026-08-26 ("nada instalado sem o usuário mandar"): aquele fluxo baixava
  escondido e instalava ao fechar; este é visível e acontece antes de existir
  sala.
- **Transferência de sala (F3).** Host que sai avisa a sala
  (`room-migrating`, com PIN, banidos, chat e novo dono) e o sucessor — menor
  id sobrevivente, sem votação (`src/renderer/succession.js`) — sobe o
  servidor com esse estado e anuncia um beacon UDP de migração; os outros
  reconectam nele sem derrubar as conexões P2P de vídeo. Na queda do host, o
  mesmo caminho dispara quando a reconexão se esgota, com espera escalonada
  por posição (se o 1º sucessor falhar, o 2º assume). Limites: na queda, a
  lista de banidos se perde e a liderança de uma terceira pessoa (nem host nem
  sucessor) vai para o sucessor.
- **Trocar a fonte ao vivo.** Botão "Trocar" durante a transmissão: troca a
  entrada do relay de canvas e a track de saída continua a mesma (sem
  renegociar, sem clique de quem assiste). O som acompanha a fonte nova; sem
  PID/addon a troca segue **sem som** e avisa — nunca com o som do sistema
  inteiro (`src/renderer/sourceswap.js`).
- **Pausa vale para todo sender novo** (P1 da avaliação de 2026-09-07): toda
  criação de sender de tela passa por `offerOwnStreamTo()`, que já nasce
  pausado — reeleição do relay, entrada tardia, reconexão e troca de fonte.
- **Ponteiro laser e reações** sobre a tela (`laser.js`, `reactions.js`): no
  tile de quem assiste e na tela real de quem transmite, só com "Deixar a
  sala rabiscar". Mensagens `laser`/`reaction` validadas campo a campo e com
  limite no servidor (laser 30/s; reação: rajada de 5, depois 1 a cada 300 ms).
- **Notificação "fulano ficou ao vivo"** do Windows com o app fora de foco
  (interruptor em Configurações, ligado por padrão; sem repetir em rajada nem
  ao entrar numa sala com gente já ao vivo) e **janela espiar** sempre no topo
  (botão direito no tile → "Espiar"; `window.open` controlado pelo main, uma
  janela por vez, posição lembrada). Jogo em tela cheia exclusiva não deixa
  nada por cima.
- **Verificação de sons.** Quem dispara qual som saiu do `app.js` para
  `soundevents.js` (testado); cada tentativa grava no log
  `[som] <nome>: tocou | pulado (motivo) | NAO tocou (motivo)`, e "tocou" só
  depois de o AudioContext estar `running`. O 2º blip do chat é agendado no
  próprio áudio (não atrasa com a janela oculta). "Testar sons" e "Últimos
  sons" em Configurações > Voz e Vídeo. O chat continua sem som com a janela
  em foco (decisão antiga, agora visível no diagnóstico).

Protocolo novo: `laser`, `reaction`, `room-migrating`, `welcome.roomId` /
`welcome.hostId`, beacon UDP `golive-room-migrate`. IPC novo: `room:active`,
`room:migrate-beacon:start|stop`, `overlay:fx` e a janela espiar.

**Hotfix 0.13.1 — tela preta ao passar a assistir outra tela.** Investigação,
evidência e hipóteses descartadas em
`docs/superpowers/specs/2026-09-12-tela-preta-ao-assistir-design.md`; roteiro
em `docs/testes/2026-09-12-roteiro-tela-preta.md`.

- **Renegociação reaproveita o canal existente** (`mesh.js`,
  `negotiateOffer`). Antes empilhava um transceiver de vídeo por
  renegociação; provado no Chromium 128 do app que o receptor fica com duas
  tracks na mesma stream e o `<video>` preso na velha — tela preta com os
  dados chegando. Afeta com certeza a câmera (desligar/religar).
- **Detector de tela assistida sem imagem + autocura** (`stallwatch.js`):
  tela que nunca exibiu quadro desde que passou a ser assistida, por 6 s,
  pede a quem a serve (origem ou relay) pra refazer só aquela conexão
  (mensagem nova `reoffer`), no máximo 3 vezes. Tela parada de conteúdo
  estático não dispara. Timer próprio: quem só assiste não roda o loop de
  estatísticas.
- **Log `[assistir]`** do lado de quem assiste e de quem serve (antes não
  existia nenhum): intenção, `view-state` enviado, demanda aplicada com o
  estado dos canais de vídeo, pedido e resultado da autocura.
- **Revisão 1 — `reoffer` seguro:** servidor valida `to`/kind estrito,
  reconstrói só os campos do protocolo e limita a 2/s; cliente aceita origem
  composta conhecida e mantém histórico com teto.
- **Revisão 2 — estado por sessão:** teardown limpa detector de stall e os
  caches de reoferta/view-state, sem tentativas herdadas entre salas.
- **Revisão 3 — oferta confirmada:** mesh expõe negociação em voo, `offerTo`/
  `relayTo` retornam sucesso real e o relay libera filho reservado se não sair
  oferta.
- **Revisão 4 — câmera serializada:** remover track e religar usam a mesma
  guarda; a nova oferta aguarda `stable` depois da resposta pendente.
- **Não provado:** qual caminho renegocia uma conexão de *tela* viva no uso
  real — por isso a autocura e o log; o roteiro diz o que mandar.
- **Captura instável de jogo:** o transmissor detecta três `mute` em 20 s ou
  um `mute` contínuo de 3 s, avisa no palco com orientação para usar janela
  sem borda e só remove o aviso após 15 s estáveis. Tela cheia exclusiva e
  proteção anti-captura são limites do jogo/Windows, não corrigíveis pelo app.
- **Beacon ao fechar a sala:** o anúncio UDP para antes de o servidor embutido
  ser invalidado; o callback de pares também tolera servidor ausente e a
  descoberta interrompe um anúncio cujo callback falhe.

## Lançado na 0.13.0 (2026-09-11)

Correções das queixas de dois usuários em 08–10/09 ("cai da sala sozinho" e
"tela mal otimizada"). Diagnóstico e planos em `logs/agentes/plano-desconexao.md`
e `logs/agentes/plano-tela.md`; roteiro de teste do repasse em
`docs/testes/2026-09-11-roteiro-teste-repasse.md`.

- **Retomada de sessão.** Queda de rede (close 1006, ou o heartbeat derrubando
  o socket) não tira mais a pessoa da sala na hora: o servidor segura a vaga
  por 20 s. Quem volta com `clientId` + `resumeToken` (rotativo, só dele,
  comparado em tempo constante) recupera o MESMO id, e o cliente adota as PCs
  da sessão órfã em vez de renegociar tudo (`src/renderer/resume.js`). Quem
  ficou recebe `peer-resumed` e re-oferta só as saídas que se perderam. Frame
  de close de verdade (1000/1001/1005 do Desconectar) continua saindo na hora.
  Carência do ICE `disconnected`: 5 → 15 s.
- **Membro fantasma.** Reconexão com token válido substitui o socket velho
  (antes ele ficava 25–50 s na sala). `clientId` sozinho não expulsa
  ninguém: ele aparece na lista de bans do dono, então não é segredo.
- **Reconexão.** Timeout de handshake de 8 s (antes o SYN do Windows levava
  ~21 s por tentativa) e backoff com teto de 15 s por ~2 min, em 7
  tentativas (`src/renderer/reconnect.js`).
- **Desligamento do Windows com sala aberta.** `session-end` fecha o
  servidor embutido e manda `room-closed`; os clientes voltam ao lobby com
  "O host encerrou a sala" em vez de ~100 s de "Reconectando".
- **Diagnóstico.** Log do servidor embutido no arquivo do host (entrada,
  saída com code, heartbeat, suspensão/retomada), `[signaling]` no renderer
  (tentativa, welcome, órfã), `powerMonitor`, `crashReporter` local sem
  upload (conta os `.dmp` no boot).
- **Tela sem cair pro OpenH264.** Causa: o H.264 de hardware do Chromium 128
  recusa altura ≤ 359 e dimensão ímpar. Agora: escala da escada por
  espectador só 1/2/4 (acabou o 853x480); tela em `maintain-resolution` com a
  resolução escolhida pelo app por espectador (tetos 1080/720/540/360,
  nativa quando há banda, histerese pela banda estimada —
  `src/renderer/screenres.js`); canvas sempre par; teto de bitrate
  `min(preset, max(800 kbps, 1,2 × banda))`.
- **Escada global** mede o orçamento de encode pelo fps de cada sender (um
  sender de 30 fps não derruba mais a captura de 60 fps de todos).
- **Presets "1440p" removidos.** O mesmo H.264 de hardware satura em
  1920x1088: a captura acabava sempre limitada a 1080p, e a opção prometia
  pixels que nunca chegavam a existir. Restam 720p/1080p × 30/60fps; config
  antigo com um preset 1440p salvo migra pro mais próximo (`closestPreset`,
  já existente).
- **Telemetria honesta.** `enc=desconhecido` em vez de "hardware",
  `alvoKbps` por espectador, `escala=`/`res=`/`bwe=` do valor aplicado,
  rejeição de `setParameters` no log.
- **Servidor mais duro com cliente hostil.** O rebroadcast de `watchers`
  refaz cada item pela tabela de peers da sala (id desconhecido some, nome e
  avatar vêm do `join`) e tem teto de 20 msg/s por peer — antes um item
  gigante era replicado pra sala inteira pelo PC de quem hospeda.
- **Pendente:** repasse via canvas (P4) aguarda o teste manual do roteiro;
  chat enviado durante os 20 s de suspensão não reaparece pra quem voltou.

## Já lançado (em release com tag)

- **0.12.7** — **a faixa de título ficou sem marca nenhuma.** Tirado também o
  ícone (SVG) que sobrava à esquerda depois da 0.12.6. Agora a faixa é só
  área de arrasto + os três botões de janela.

- **0.12.6** — **a faixa de título perdeu o texto "GoLive LAN".** Ficava
  repetido com o cabeçalho do lobby logo abaixo. Sobra só a marca (SVG) à
  esquerda + área de arrasto + os três botões. Ajuste visual isolado.

- **0.12.5** — **controles de janela próprios, estilo Discord.** No Windows a
  janela perde a barra de título nativa (`titleBarStyle: 'hidden'`) e ganha
  uma faixa própria de 32px no topo: marca à esquerda, área de arrasto, e os
  botões de minimizar / maximizar-restaurar / fechar à direita (fechar fica
  vermelho no hover, o ícone do maximizar alterna com o estado). macOS/Linux
  seguem com a barra nativa. F11 não alterna mais o fullscreen nativo (o app
  tem o próprio, via tile em tela cheia). IPC novo em `window.golive.win`,
  módulo `src/renderer/titlebar.js`. Só janela: nenhuma mudança de protocolo.
  PR #49.

- **0.12.4** — **o app ganhou marca própria.** A mesma do site: dois pares
  de espectadores ligados ao nó de origem. Substitui o badge de texto "GL"
  na barra do lobby (SVG inline, traços em `var(--tx)`, nó de origem em
  `var(--live)` — o mesmo pacto do site) e a prévia de tema em
  Configurações > Aparência. O app enfim tem ícone próprio
  (`src/renderer/assets/icon.{svg,png,ico}`, a marca sobre um quadrado
  escuro): `BrowserWindow({icon})` cobre o `npm start`, `build.win.icon`
  cobre o `.exe` e o instalador NSIS — antes os dois usavam o ícone padrão
  do Electron. Só visual: nenhuma mudança de protocolo, sinalização ou
  árvore. PR #48.

- **0.12.3** — **parar de assistir uma tela ou câmera pelo menu de botão
  direito, e rabisco órfão some com quem sai.** (1) O menu de contexto do
  tile ganhou "Parar de assistir esta tela/câmera" (e "Assistir câmera"
  quando já se optou sair). Antes só dava pra largar uma tela assistindo
  duas ou mais, e câmera não tinha como desligar. Largar a última tela
  agora chega a zero e liga `autoWatchSuppressed` — a auto-escolha para de
  repor uma tela até o usuário pedir de novo. Câmera virou opt-out
  (`unwatchedCameras`): o `view-state {watching:false}` que sai daí faz
  quem transmite soltar o encoder daquele espectador, pelo mesmo caminho
  que a tela já usava. (2) Quando um peer sai da sala, `annotate`
  `dropAuthor` apaga o que ele rabiscou na tela de todo mundo que ficou —
  a tela dele já morria com o tile, mas o traço nas telas dos outros
  ficava órfão. Cada cliente processa o `peer-left` sozinho; nenhuma
  mensagem de rede nova. Se o traço apagado estava na tela real de quem
  compartilha, a janela de overlay recarrega o snapshot já podado.
  Spec: `docs/superpowers/specs/2026-09-06-parar-de-assistir-e-rabisco-orfao-design.md`.

- **0.12.2** — **tela preta ao entrar numa sala com repasse (F2) — e não
  saía nem reiniciando o compartilhamento.** Ao processar uma `offer` da
  origem, `flushPendingRelay` disparava duas vezes com os mesmos
  argumentos — de dentro do `onTrack` (que o Chromium chama *durante* o
  `setRemoteDescription`, antes da promise resolver) e de novo no fim do
  `case 'offer'` — e a guarda contra repasse duplicado (`state.relayed`)
  era lida antes do `await` e só escrita depois, então as duas passavam e
  repassavam pro MESMO filho. Dois `offerTo` concorrentes na mesma conexão
  chamam `addTransceiver` duas vezes (dois encoders pro mesmo espectador,
  esgotando o encoder de hardware) e produzem duas SDP com contagem
  diferente de m-line; aplicada fora de ordem, a menor levava
  `InvalidAccessError` e a conexão ficava aberta e meio negociada pra
  sempre — sem tratamento de erro em `offerTo`, o `connectionstatechange`
  nunca chegava em `failed` e nenhuma recuperação rodava. `mesh.js` agora
  recusa uma segunda negociação de saída enquanto a primeira está em voo
  (por peer+kind), e a que falha derruba a conexão e pede recuperação como
  `handleOffer`/`handleAnswer` já faziam; `flushPendingRelay` reserva o
  filho antes do `await`, não depois. De brinde, a linha de diagnóstico de
  encode agora marca `(repasse de #N)` quando o sender é um relay — sem
  isso, depurar exigiu cruzar 3 logs de 2 máquinas.

- **0.12.1** — **os sons voltam a sair quando a janela está em segundo
  plano**. `sound.js` criava um `AudioContext` uma vez e nunca o retomava:
  o Chromium suspende esse contexto sempre que a janela do GoLive fica
  minimizada ou oculta, e é exatamente aí que o som de chat (só toca fora
  de foco, por design) e o de "alguém foi live" (feito pra quem está no
  jogo) precisam soar — o oscilador era agendado num relógio parado e nada
  saía. `tone()` agora faz `ctx.resume()` quando o estado é `suspended`,
  o mesmo remédio que `ui.js` já aplicava no contexto de playback dos
  tiles. Junto veio um som novo, `playPeerStoppedSound` (espelho
  descendente do "foi live"), que toca pra sala inteira quando qualquer
  tela sai do ar — antes só existia som quando o dono da sala forçava
  alguém a parar, nunca quando a pessoa parava sozinha.

- **0.12.0** — **o rabisco volta a sair da máquina, e a audiência para de
  mentir**. Quatro frentes, três delas bugs que não faziam barulho nenhum.

  **(1) Rabiscar não funcionava — de novo, e o servidor era o culpado.**
  Na 0.11.0 a chave da lousa virou `'<dono>:<kind>'` (`surfaceKey`, pra tela
  e câmera da mesma pessoa serem duas superfícies), e o `case 'annotate'` do
  servidor continuou fazendo `peers.get(String(msg.surface))`. `peers.get('7:screen')`
  não acha ninguém, e a op caía no `return` que existe pra barrar "tela de
  quem não está na sala": **toda** op de rabisco era descartada em silêncio.
  Os testes do servidor mandavam o id cru como superfície, então nenhum deles
  passava pela chave real. `surfaceOwner` no servidor é o espelho do
  `parseSurface` do cliente — sufixo desconhecido devolve a chave inteira como
  dono, senão inventar um corte ali aprovaria superfície forjada.
  **(2) A cor escolhida não viajava.** `sanitizeAnnotateOp` reconstrói a op
  campo a campo e `color` (também nova na 0.11.0) não estava na lista: quem
  desenhava via a própria cor, a sala via a cor derivada do id. Mesma classe
  do bug do `annotate` no `broadcast-state` (0.10.2) — reconstruir campo a
  campo é o que barra lixo e é o que faz campo novo sumir calado.
  **(3) "Quem está assistindo" quase nunca aparecia inteiro**, por dois
  motivos independentes. O primeiro é de uma linha: `showTile` fazia
  `gridEl.querySelector('.empty')?.remove()` pra tirar o cartão de sala
  vazia, e esse seletor varria a subárvore — o primeiro `.empty` que ele
  achava era o `.tile-watchers` sem audiência de um tile já existente, e ele
  **apagava o elemento inteiro**. Bastava um segundo tile aparecer pra matar
  o overlay do primeiro. Agora é `:scope > .empty`, e o estado do overlay se
  chama `is-empty`, pra colisão não voltar por outro caminho. O segundo é de
  topologia: com a árvore de retransmissão ligada (fanout 1 na origem), quem
  serve uma folha é o **relay**, e a origem só contava quem ela mesma servia
  — numa sala de três já faltava alguém. A mensagem `watchers` ganhou
  `origin` (de quem é a tela, separado de `from`, que é quem está contando),
  cada nó anuncia o pedaço que serve, e o cliente **funde por tile**. O
  `looking` novo no `view-state` completa: um relay que repassa uma tela que
  ele mesmo não escolheu assistir continua mandando `watching: true` (tem
  gente atrás dele) e some da lista.
  **(4) Assistir uma tela por vez.** Ver todas ao mesmo tempo nunca foi
  escolha de ninguém — era o que sobrava de não haver escolha, e cada tela é
  um decode aqui e um encoder inteiro na máquina de quem transmite. Agora a
  primeira tela é escolhida sozinha (o caso de um transmissor só não muda em
  nada) e "+ Ver junto" empilha as outras. A economia sai pelo caminho que já
  existia pra janela minimizada (`setPeerDemand`, F1.3), agora com duas
  causas em vez de uma.
  Junto: o **"Apagar tudo"** de quem é dono da tela encolheu pela metade (a
  regra base de `button` põe `min-height: 44px`, que ganha de `height` — sem
  zerar, o botão não encolhia, só o conteúdo dentro dele), e o **aviso do
  palco ganhou um X**: o de firewall ficava a sessão inteira na frente da
  sala mesmo pra quem já tinha liberado a porta na mão. A dispensa vale pra
  aquele texto, não pro elemento, então um aviso novo (o encoder caindo pra
  software) volta a aparecer.

- **0.11.0** — a tela volta a codificar em **hardware**. Uma track de
  `getDisplayMedia` com `contentHint='motion'` derrubava o encoder de
  hardware em silêncio (`HW.Status=16`, zero quadros) e tudo caía no
  OpenH264; o relay por canvas do `screenrelay.js` mantém o hint numa track
  que o MediaFoundation aceita — **28,7% → 12,8% de CPU** com 3
  espectadores, mesmo framerate. Junto: log síncrono com marca de
  encerramento (crash deixava de deixar rastro), dump do `chrome://gpu` que
  não sai mais calado, negociação que falha derrubando a conexão em vez de
  virar zumbi, escada de qualidade com orçamento proporcional ao fps e
  carência pra sender novo, `scrollbar-gutter` matando a tremedeira da grade
  com 3+ transmitindo, tiles de fundo parando de pintar em tela cheia, e
  rabisco na câmera com cor escolhida por quem desenha.

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

## Backlog técnico

Fonte única: **`docs/2026-08-27-auditoria-de-fragilidade.md`**. O que não foi
feito e não está explicitamente fora de escopo (abaixo): **C5, F3, G6, H5,
H6** e o resto do **B2**.

Sobre o **B2**: a premissa da auditoria ("14 vulnerabilidades, todas na cadeia
do `node-gyp@9`") não vale mais. Com o `node-gyp` da raiz na 11, o
`electron-builder` na 26 e `js-yaml` em **4.3.2**, o `npm audit` completo
continua com **2 altas de dev** — o `electron@32` e o `extract-zip` dele.
`npm audit --omit=dev` está em **0**: a produção chegou a ficar em **1 alta**
(`js-yaml`, via `electron-updater`) de algum ponto até esta correção. Zerar as
duas altas restantes exige subir `electron 32 → 44`, o que é o item **B1** e
precisa do app rodando.

**F3** (queda abrupta do host ainda pode partir a sala) e **G6** (teto de ~4
pessoas) são "confirmado, por desenho" — limites conhecidos, não bugs. A
migração graciosa de F3 funciona desde a 0.14.0. **B3** (sala sem autenticação)
saiu dessa lista de vez: núcleo, protocolo e UI (caixa, campo de PIN, cadeado
na lista, selo no cabeçalho) foram lançados na 0.4.0.

**C4** (`dist/` de 1,2 GB) é higiene de disco local. **C5** (branches
obsoletas) segue aberto: **25 branches mescladas no remoto** ainda não foram
apagadas (entre elas `claude/backlog-pos-leyjak`,
`claude/planejamentos-futuros-projeto-leyjak` e
`claude/redesign-discord-style`).

## Fora de escopo (adiado de propósito)

Precisam de verificação manual rodando o app, ou de esforço de dias.

| Item | O que é | Por que ficou de fora |
|---|---|---|
| **B1** | Subir Electron (32 → 44) | Meio dia + verificação manual; flags de WGC e assinatura do `console-message` mudam entre versões e precisam de teste no app rodando. Fecha as 2 altas de dev que sobram no `npm audit`. |
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
