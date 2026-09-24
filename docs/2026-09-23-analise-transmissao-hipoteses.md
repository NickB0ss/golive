# Análise da transmissão, hipóteses e o que considerar

Data: 2026-09-23. Base: 0.19.0 (Electron 44 / Chromium 152), `main` em
`cd851b4`. Fontes: leitura do código de mídia (`mesh.js`, `screenrelay.js`,
`tree.js`, `autoquality.js`, `peerquality.js`, `screenres.js`,
`stallwatch.js`, `signaling*.js`, `main.js`), os cinco logs de sessão de
2026-09-21 (três na 0.18.1, dois na 0.19.0), as notas de decisão do vault,
e o app rodando num Xvfb (Linux, sem GPU) para a revisão de interface.

Cada afirmação leva uma etiqueta:

- **[log]** — está escrito num dos cinco logs;
- **[código]** — está no código, com arquivo e linha;
- **[fonte]** — documentação pública (links no fim);
- **[inferência]** — conclusão minha, ainda sem medida;
- **[a medir]** — só fecha com o app rodando em PCs reais.

Nada aqui foi medido em sala real de 2+ PCs.

---

## Em 30 segundos

1. **Não troque a linguagem do app.** O que quebra a transmissão não é
   JavaScript: o JS só orquestra. Captura, encode, decode e rede rodam no
   C++ do Chromium e na GPU. Reescrever a interface em Rust, C# ou Tauri
   custa meses e não muda nenhum quadro que chega no amigo. O que vale
   reavaliar é **a camada de mídia** (seção 5).
2. **A subida para o Electron 44 mudou premissas que sustentam a arquitetura
   atual, e os seus próprios logs provam isso.** No Chromium 128, o H.264 de
   hardware anunciava no máximo **1080p a 30 fps**. No 152 ele anuncia
   **1080p até 121 fps**, aceita quadros a partir de **146x50** (antes a
   altura mínima era 360) e ainda traz **HEVC por hardware**. [log] Várias
   decisões foram tomadas medindo o 128: o relay de canvas, "WebCodecs não
   alcança o hardware", `maintain-resolution` e a escada só com potências
   de 2. Todas precisam ser medidas de novo.
3. **Hipótese central (H1):** o "teto de 4 pessoas" e a regra "a partir de 3
   espectadores desce pra 1080p30" nasceram de uma medição feita **com o bug
   do `contentHint` ativo**. Em 2026-08-23, os 4 senders caíram pra
   software **todos juntos**, sem jogo aberto. Um limite de sessões do NVENC
   derrubaria só as sessões excedentes. E o limite no seu driver é 8.
   [inferência forte] Se isso se confirmar, a árvore deixa de ser necessária
   por causa de encoder e passa a servir só para aliviar upload.
4. **O repasse (relay) provavelmente ainda codifica em software.** `relayTo`
   põe `contentHint='motion'` na track recebida crua (`mesh.js:868`), a
   mesma combinação que derrubava o hardware na captura. O log de 08/09
   mostrou 96,4% de OpenH264 no repasse, e o "canvas no repasse" (P4)
   continua pendente. É provavelmente a maior perda de qualidade de quem
   é folha hoje (720p30 recodificado em CPU). [código + histórico]
5. **A queda de 21/09 às 23:45 UTC (20:45 em Brasília)** não tem como ser
   atribuída ao app pelo log de quem assistia. O mesmo log mostra a
   **internet desta máquina instável** nos 10 minutos anteriores: a checagem
   de atualização estourou 21 s duas vezes e levou 63 s numa terceira.
   [log] Falta o log de quem transmitia ("amador de kids") para fechar.
6. **Primeiro uma noite de medição (seção 4), depois os consertos baratos,
   só então o spike de SFU local.** A ordem está na seção 7.

---

## 1. O que os cinco logs de 2026-09-21 mostram

| # | Achado | Onde | Leitura |
|---|---|---|---|
| L1 | Chromium 128: `Encode h264 ... 1920x1088 pixels, and/or 30.000 fps` em todos os perfis | log 0.18.1 `7fe4eafe`, linhas 101-106 | O H.264 de hardware anunciava no máximo 30 fps a 1080p. Casa com dois achados antigos: WebCodecs não pegava hardware a 1080p60 (`screenrelay.js:60`), e o encoder caía pra software com `'motion'` na captura crua. [inferência] |
| L2 | Chromium 152: `Encode h264 ... 146x50 to 1920x1080, and/or 121.000 fps`, 4K a 30 fps, e `Encode hevc main ... 121 fps` | log 0.19.0 `764dce0d`, linhas 102-117 | O teto de 30 fps sumiu e a altura mínima caiu de 360 pra 50. HEVC em hardware apareceu. |
| L3 | `Uncaught (in promise) InvalidStateError: Transition was aborted because of invalid state`, 7 s depois de entrar na sala | `764dce0d`, linha 138 | É o `startViewTransition` da tela cheia (`ui.js:320`): ninguém trata `transition.ready`. `apply()` chama `setFullScreen`, e isso redimensiona a janela no meio da transição, o que a aborta. Não quebra nada visível, mas é uma promessa rejeitada solta, a pendência "verificar se pisca" do vault tem aqui a primeira evidência, e o erro vai continuar poluindo o log. |
| L4 | 23:45:17 o vigia acusa tela congelada "com demanda ativa" (tentativa 1); 23:45:36 WebSocket fecha `1006`; 23:45:45 a nova tentativa fica sem handshake em 8 s; 23:45:46 você sai | `764dce0d`, linhas 139-144 | O vídeo e a sinalização morreram juntos, e a primeira tentativa de autocura foi feita num socket que já estava morto. O cliente levou ~25 s pra perceber que o socket tinha caído: o ping do servidor é de 25 s (`signaling-core.js:487`) e o cliente não tem vigia próprio. |
| L5 | `update: checking` sem resposta em 22 s (23:35) e 16 s (23:37); `ERR_CONNECTION_TIMED_OUT` às 23:36:53 e 23:41:39; `not-available` só depois de **63 s** (23:42:59); às 00:42 levou 1,2 s | logs `0fbd9c4e`, `7fe4eafe`, `3dced1d5`, `49de6728`, `764dce0d` | Entre 23:35 e 23:43 esta máquina estava com dificuldade de falar com a internet. Radmin e Tailscale andam por cima dela. **Hipótese H9.** [inferência] |
| L6 | Duas RTX 3060 com LUIDs diferentes (GPU0 ativa, GPU1 igual) + Microsoft Basic Render Driver; no 128, o workaround "multiple GPUs" desligava o AV1 por hardware | todos os logs, linhas 81-84 | Já aparecia na pesquisa de 12/09 junto com a falha do DXGI. Um adaptador "fantasma" pode mudar a escolha de adaptador do WGC e do encoder. **Hipótese H12.** |
| L7 | `documento=hidden efetivo=false assistindo=true` 2 s depois de abrir, com a janela visível | `7fe4eafe`, linha 128 | É a oclusão nativa do Windows (outra janela cobrindo). É por desenho, mas confirma que "oculto" é o estado normal de uso. |

---

## 2. Hipóteses

Ordenadas por **(chance de ser verdade × impacto na transmissão) ÷ custo
de testar**. "Se confirmar" diz o que muda no código.

### A. Premissas que o Electron 44 pode ter derrubado

**H1 — O teto de ~4 pessoas foi medido com o bug do `contentHint` ativo, não
com o NVENC saturado.** *Confiança: alta.*
- Evidência: a nota de decisão do vault (2026-08-23) registra "sem jogo
  nenhum aberto, 4 espectadores, OpenH264 em **todos** os 4 senders". O bug
  só foi achado em 05/09: captura crua + `'motion'` → OpenH264 mesmo com um
  espectador só (tabela em `screenrelay.js:15-18`). Com o relay de canvas,
  3 espectadores a 1080p60 rodaram em hardware a 8,1 ms/quadro e 12,7% de
  CPU (`screenrelay.js:32-35`). O limite de sessões do NVENC em GeForce é
  **8 por sistema** desde o driver 551.23 [fonte]. O seu é o
  32.0.16.1088, ou seja, o 610.88 [log]. Se fosse limite de sessão, só as
  excedentes cairiam pra software.
- Como testar: M3.
- Se confirmar: `audienceSteps` (`config.js:123`) pode sair, ou passar a
  valer só a partir de 6 ou mais. A árvore deixa de ser obrigatória:
  passa a entrar só quando o **upload** da origem não comporta N × bitrate.
  Espectador direto recebe 1080p60 da origem, em vez de 720p30 recodificado
  num relay (a conta da auditoria de 18/09, seção "Furar o teto de 4").

**H2 — O relay recodifica em software.** *Confiança: alta.*
- Evidência: `relayTo` aplica `contentHint='motion'` na track **recebida**
  (`mesh.js:868`) e a manda crua pro encoder. É o mesmo padrão que o canvas
  existe pra evitar. A pesquisa de 12/09 mediu 96,4% de OpenH264 no repasse.
  O "repasse via canvas (P4)" segue pendente (`STATUS.md`, 0.13.x).
- Como testar: M2 (linhas `[diag] ... (repasse de #N) enc=...` no log de
  quem é relay).
- Se confirmar: passar a entrada do `relayTo` pelo `screenrelay.create` (a
  track de saída é que vai para o `offerTo`). No Chromium 152 pode nem ser
  preciso; M1 responde isso.

**H3 — No Chromium 152 o relay de canvas pode ter deixado de ser
necessário.** *Confiança: média.*
- Evidência: L1/L2. O canvas contornava um encoder que, no 128, recusava
  60 fps a 1080p. Ele custa uma cópia de GPU por quadro e um laço
  `read → drawImage → requestFrame` na **thread principal do renderer**
  (`screenrelay.js:132-172`), disputando com chat, DOM e estatísticas. O
  STATUS de 0.19.0 já registrou um caso disso: o painel de stats remontado a
  cada segundo.
- Como testar: M1 (captura crua + `'motion'` no 152: `enc=` hardware ou
  OpenH264? `msFrame` e fps de saída).
- Se confirmar: desligar o relay atrás de uma checagem (primeiro quadro em
  hardware → segue cru; senão, canvas). Se **não** confirmar: considerar mover
  o laço para um Worker (`MediaStreamTrackProcessor` + `OffscreenCanvas` +
  `VideoTrackGenerator`) e medir se o hardware continua aceitando.

**H4 — `maintain-resolution` faz uma queda de banda virar engasgo.**
*Confiança: média.*
- Evidência: a escolha (`mesh.js:703`) e a escada só com potências de 2 e
  altura mínima de 360 (`config.js:406`, `screenres.js:30`) existem porque o
  H.264 de hardware do **128** recusava altura ≤ 359 e dimensão ímpar. O 152
  aceita a partir de 146x50 [log L2]. Com `maintain-resolution`, numa queda
  de banda da VPN o WebRTC segura 1080p e **corta quadros**. A escada
  própria (`screenres.js`) só desce a resolução depois de 5 s
  (`DOWN_HOLD_MS`). Nesses 5 s o jogo "trava".
- Como testar: M6 (limitar banda a 4 Mbps com clumsy/NetLimiter e comparar
  `framesPerSecond` e `freezeCount` do receptor com `balanced` e com
  `maintain-resolution`).
- Se confirmar: `balanced` para tela de jogo, e a escada própria vira só
  teto (cuidado: são dois laços de controle; a decisão de 28/08 descartou
  empilhar laços por risco de oscilação, então medir antes).

**H5 — WebCodecs com hardware voltou a ser viável.** *Confiança: média.*
- Evidência: a própria auditoria de 18/09 deixou escrito "reabre só se um
  Electron novo trouxer `VideoEncoder` com `prefer-hardware` funcionando de
  verdade". L2 sugere que agora traz.
- Como testar: M4 (uma linha no console, abaixo).
- Se confirmar: não é pra adotar WebCodecs como transporte (as objeções de
  controle de congestionamento, jitter buffer e sincronia A/V continuam de
  pé). Serve como plano B do encode-once, se o SFU local (H14) não andar.

**H6 — HEVC (H.265) no WebRTC cortaria ~25-40% da banda na mesma
qualidade.** *Confiança: média no ganho, baixa na estabilidade.*
- Evidência: o Chrome liga H.265 no WebRTC por padrão desde a 136 [fonte],
  e o 152 anuncia HEVC por hardware nesta máquina [log L2]. Numa VPN
  apertada, banda é o recurso mais escasso.
- Cuidados: o Chrome **não tem decoder HEVC em software**. Um amigo sem
  decode HEVC por hardware não veria nada, então tem que haver fallback. A
  negociação resolve isso sozinha se `setCodecPreferences` listar
  `[H265, H264]` e o outro lado não anunciar H265. O relay precisaria de
  encode e decode HEVC. AV1 não entra: a RTX 3060 (Ampere) só decodifica AV1.
- Como testar: M5.

### B. Rede e VPN

**H7 — A rota escolhida pelo ICE é invisível, e é ela que decide a
qualidade.** *Confiança: alta de que falta; média de que importa.*
- Evidência: o app coleta candidatos da VPN (host 26.x/100.x) **e** srflx
  via STUN do Google (`mesh.js:11`). O ICE do Chromium prefere o par host
  (prioridade de tipo 126 contra 100 do srflx): se o Radmin estiver
  **relayando** (CGNAT dos dois lados), o vídeo vai pelo relay lento do
  Radmin mesmo que o caminho direto pela internet funcionasse. Hoje nada no
  log ou na interface diz qual rota cada conexão usa.
- Como testar: M5. Logar o `candidate-pair` nominado (IP local/remoto,
  tipo, `currentRoundTripTime`, `availableOutgoingBitrate`) ao conectar e a
  cada mudança.
- Se confirmar que o Radmin relaya: primeiro recomendar Tailscale, depois
  pensar em preferir o srflx, reescrevendo a prioridade do candidato antes
  de enviar (arriscado; só com medida).

**H8 — Sem fallback TCP, "o Radmin bloqueou UDP" é tela preta
permanente.** *Confiança: alta.*
- Evidência: sem TURN (`mesh.js:13`). Entre dois Chromium, ICE-TCP não fecha
  (o Chrome não abre candidato TCP passivo). O README já cita "o Radmin às
  vezes bloqueia UDP".
- Se confirmar: TURN sobre TCP embutido no host da sala (há implementações
  em Node) como última rota, ou o SFU local (H14), que aceita ICE-TCP.

**H9 — A queda das 23:45 foi da sua conexão, não do app nem do host.**
*Confiança: média.*
- Evidência: L5. Checagens de atualização estourando 21 s ou levando 63 s
  entre 23:35 e 23:43, e depois voltando a 1,2 s.
- Como testar: pedir o log do "amador de kids" do mesmo minuto (arquivo
  `golive-2026-09-21T2*` em `%APPDATA%\golive-lan\logs`). Se o lado dele
  não mostra queda de sinalização pros outros peers, o problema foi daqui.
  Numa próxima sessão, deixar um `ping -t` pro IP 26.x do host rodando ao
  lado.
- Consequência para o app: ver H10. O app precisa **dizer** "perdemos
  contato com o PC de X" em vez de deixar um quadro parado.

### C. Robustez e observabilidade

**H10 — O vigia de congelamento não sabe distinguir rede morta de
encoder parado de decoder travado.** *Confiança: alta.*
- Evidência: L4. O `stallwatch` usa só "quadros exibidos". Na 23:45 ele
  pediu `reoffer` por um socket morto e ninguém soube do quê.
- Proposta: no momento do congelamento, gravar os deltas de
  `inbound-rtp` (`bytesReceived`, `packetsReceived`, `packetsLost`,
  `framesDecoded`, `keyFramesDecoded`, `pliCount`, `nackCount`,
  `freezeCount`) e do `candidate-pair` (`state`, `bytesReceived`,
  `lastPacketReceivedTimestamp`, `responsesReceived`), e classificar:
  - 0 bytes → **rede**: "sem contato com X";
  - bytes chegando e 0 quadros decodificados → **decoder ou keyframe**: PLI;
  - só RTCP chegando → **origem parou de codificar**.

  Mostrar isso no aviso do tile e no log. Custo: ~1 dia.

**H11 — O cliente demora ~25 s pra perceber que a sinalização morreu.**
*Confiança: alta.*
- Evidência: L4 e o ping de 25 s do servidor, que o cliente nem enxerga (o
  navegador responde pong sozinho).
- Proposta: o servidor manda um `{type:'hb'}` a cada 5 s e o cliente fecha
  e reconecta se passar 12-15 s sem nenhuma mensagem. A reconexão e a
  migração começam 10-15 s mais cedo. Custo: horas.

**H12 — O adaptador RTX 3060 duplicado atrapalha a captura.**
*Confiança: baixa.*
- Evidência: L6 e o `Cannot initialize any DxgiOutputDuplicator` da pesquisa
  de 12/09. Hoje o app depende 100% do WGC.
- Como testar: Gerenciador de Dispositivos → Exibir dispositivos ocultos;
  `dxdiag`; checar se há driver de tela virtual (Parsec VDD, Sunshine, IDD),
  Hyper-V ou GPU-P instalado. Se for um fantasma, uma reinstalação limpa
  (DDU) pode devolver o DXGI como fallback de captura.

**H13 — Um "quase-down" do ICE vira reconstrução completa da conexão.**
*Confiança: média.*
- Evidência: não há `restartIce` em lugar nenhum [código]. Em
  `disconnected` o app espera 15 s (`networktiming.js`) e depois derruba a
  PC e re-oferta do zero: ICE, DTLS e SDP de novo, mais keyframe.
- Proposta: em `disconnected` por mais de ~3 s, o lado que oferta chama
  `pc.restartIce()` e renegocia na mesma PC. É o caminho padrão quando a
  interface da VPN troca de rota (Radmin reconectando). Custo: 1-2 dias,
  com cuidado com a máquina de negociação existente (`negotiating`,
  `renegotiate`).

**H16 — O alvo de 50 ms do jitter buffer está calibrado para latência,
não para fluidez.** *Confiança: baixa.*
- Evidência: `mesh.js:42-46` parte de "o padrão do Chromium custa
  ~100-200 ms por hop", o que o vault registra como nunca medido. O
  `jitterBufferTarget` só influencia o buffer [fonte]. Numa VPN com jitter,
  um alvo baixo troca atraso por congelamento, e para quem assiste o jogo
  do amigo 80 ms a mais incomodam menos que um engasgo.
- Como testar: junto com M6, comparar `freezeCount` e
  `jitterBufferDelay / jitterBufferEmittedCount` com o alvo em 50 e em
  100 ms.

### D. Arquitetura

**H14 — Um SFU local em cada transmissor responde às seis objeções que
derrubaram o "SFU no host".** *Confiança: média; é a aposta de médio
prazo.*

A ideia: quem transmite roda um SFU **dentro do próprio app** (mediasoup,
com worker em C++, ou um sidecar em Go com Pion). O renderer manda **uma**
cópia pro SFU pelo loopback, e o SFU repassa pacotes RTP para cada
espectador, **sem recodificar**. Um relay vira um SFU que encaminha para os
filhos (em mediasoup, `pipeToRouter` entre máquinas), também sem
recodificar. Não é o "SFU no host" que foi descartado em 23/08: cada
transmissor é dono do próprio.

| Objeção de 23/08 ao SFU no host | SFU local por transmissor |
|---|---|
| 1. Não resolve upload | Igual à malha na origem; o relay-SFU mantém o alívio de upload da árvore |
| 2. Ponto único de falha do vídeo | O SFU morre junto com a própria transmissão; nenhum ponto novo |
| 3. +1 hop para todos | O hop da origem é loopback (~0 ms); no relay, repassar pacote é **mais rápido** que decodificar + recodificar |
| 4. Controle de congestionamento não vem pronto | O mediasoup estima banda por espectador (transport-cc), guarda pacotes para NACK, agrega PLI e escolhe a camada de simulcast por espectador |
| 5. `werift` imaturo | mediasoup é C++/libuv maduro, com worker pré-compilado para Windows desde a 3.12 [fonte] |
| 6. Dependência nova | Continua sendo verdade: é o preço |

Ganhos: encoders na origem = 1 (ou 2-3 com simulcast), **independente de
quantos assistem**. Relay com 0 encoders (sai a eleição por saúde de
encode). Fim da perda geracional e do 720p30 nas folhas. Sincronia A/V
preservada (hoje o relay também transcodifica o Opus). ICE-TCP como
fallback (H8). "Não está assistindo" vira `consumer.pause()`, o que
aposenta boa parte do `setPeerDemand`/`replaceTrack(null)`.

Custos e riscos: empacotar o worker e abrir uma porta UDP no firewall (o app
já tem esse fluxo para a sinalização); reescrever a orquestração de mídia
do `app.js` (é também uma grande simplificação: some a árvore com
recodificação, a demanda por sender e parte da migração de mídia); e
confirmar se o Chromium faz **simulcast H.264 em hardware** (spike). Sem
simulcast, um espectador fraco fica com perda e NACK, porque o SFU não
recodifica.

Spike sugerido (3-5 dias): mediasoup no processo principal, um transmissor
e 3 espectadores numa LAN, medir encoders (`nvidia-smi`), latência
ponta-a-ponta e congelamentos. Critério: **se o spike não entregar 1080p60
em hardware para 4 espectadores com menos congelamento que a árvore
atual, fica na gaveta.**

**H15 — O que mais trava o projeto hoje é não conseguir testar 2+ PCs.**
*Confiança: alta.*
- Evidência: "Nada disso foi testado com 2+ PCs reais" aparece em todas as
  frentes do STATUS; o incidente do TDZ em `app.js` (PRs #62/#63) passou por
  923 testes verdes.
- Proposta: um **laboratório automatizado**: 3-4 instâncias do Electron na
  mesma máquina Linux (Xvfb, `--user-data-dir` separado, uma track de canvas
  no lugar da captura), cada uma num network namespace com `tc netem`
  (perda de 2%, jitter de 30 ms, banda de 8 Mbps, queda de 10 s). Roda no
  CI do GitHub (ubuntu tem `sudo`). Não testa o NVENC, mas testa **toda a
  orquestração**: árvore, migração, retomada, demanda, vigia de
  congelamento. É onde mora a maioria dos bugs de "tela preta" do histórico.
  Viabilidade: nesta análise o app subiu no Xvfb deste contêiner, criou
  sala, abriu o seletor de fonte e tirou prints pelo `--require`.

---

## 3. Trocar a linguagem?

| Opção | O que muda na transmissão | Esforço | Recomendação |
|---|---|---|---|
| **Manter Electron + JS** (UI, sinalização, orquestração) | Nada por si só; os ganhos vêm das hipóteses acima | — | **Sim.** A base é madura, tem 923 testes e o Chromium entrega captura WGC, encoder de hardware e WebRTC de graça |
| Reescrever a UI em **Tauri/Rust, C#/WPF+WebView2 ou Flutter** | Nenhum. WebView2 é Chromium, com **menos** controle (flags, `setDisplayMediaRequestHandler`), e o addon de áudio e o servidor `ws` seriam reescritos | Meses | **Não** |
| **SFU local** (mediasoup C++ via Node, ou Pion em Go) só para a mídia | Encode único, repasse sem recodificar, controle de banda por espectador, TCP de reserva | 2-4 semanas + spike | **Sim, depois das medições** (H14). Go/Pion tem a vantagem de compilar para Windows a partir do Linux, sem MSVC, o que evita a dor de build nativo que o projeto já tem |
| **Pipeline nativo** em Rust/C++ (WGC/DXGI → NVENC/AMF/QSV direto na textura → transporte próprio com FEC), no estilo Sunshine/Moonlight/Parsec | Latência mínima e controle total do encoder | Meses | Só se a meta virar "latência de jogo remoto". Para assistir o jogo do amigo, é esforço demais para o ganho |

Resumo: **a linguagem certa para cada camada já está quase certa.** Se
alguma parte for sair do JavaScript, que seja a mídia, e só depois do spike.

---

## 4. Roteiro de medição (uma noite, 2-3 PCs, na 0.19.0)

Tudo aqui usa o que o app já loga. Os logs ficam em Configurações >
Estatísticas > "Abrir pasta de logs". Cada item diz o que procurar.

- **M1 — captura crua no 152 (H3).** Build de teste com o relay desligado
  (a linha `screenRelay = track ? screenrelay.create(...)` em `app.js`
  trocada por `null`). Transmitir 1080p60 para 1 pessoa, 60 s. Procurar
  `[diag] tela->... enc=` e `msFrame=`. `enc` de hardware e fps perto de 60
  → o canvas pode sair.
- **M2 — encoder do relay (H2).** Sala de 4, na versão normal. No log de
  quem virou relay: `[diag] tela->X (repasse de #N) enc=... SOFTWARE(CPU)`
  ou `hardware`.
- **M3 — N encoders diretos em hardware (H1).** Build de teste com a árvore
  desligada (forçar `tree:false` em `config.load`). 1080p60 para 3, 4, 5 e
  6 espectadores (dá pra usar duas instâncias do app por PC, cada uma com
  seu `--user-data-dir`). Na máquina que transmite, em outro terminal:
  `nvidia-smi encodersessions` (mostra cada sessão NVENC com fps e
  latência). Anotar em que N aparece `SOFTWARE(CPU)` ou o fps cai.
  **É a medida mais importante da noite.**
- **M4 — WebCodecs (H5).** No DevTools do app (Ctrl+Shift+I):
  ```js
  await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1920, height: 1080,
    framerate: 60, bitrate: 12e6, hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime' })
  ```
  Repetir com `codec: 'hvc1.1.6.L123.00'`.
- **M5 — rota e codec (H6, H7).** Em `chrome://webrtc-internals` (abrir
  numa janela do app, ou logar o `getStats`): par de candidatos nominado
  (IP 26.x/100.x = VPN; outro = srflx), `currentRoundTripTime`,
  `availableOutgoingBitrate`, `codecId`. Um RTT alto para a mesma cidade
  (>40 ms) sugere o Radmin relayando.
- **M6 — `balanced` contra `maintain-resolution` (H4).** Limitar a banda de
  quem assiste a 4 Mbps (clumsy ou NetLimiter) e comparar `freezeCount` e o
  fps recebido no painel de Estatísticas, 2 min cada.

---

## 5. Consertos baratos que não dependem de medição

| # | O quê | Onde | Custo |
|---|---|---|---|
| C1 | Tratar a rejeição da transição de tela cheia (`transition.ready.catch`) e não chamar `setFullScreen` **dentro** do callback da transição (ou pular a transição quando a janela muda de tamanho) | `ui.js:317-323` | 1 h |
| C2 | Vigia de vida da sinalização no cliente (H11) | `signaling-core.js`, `signaling.js` | 3-4 h |
| C3 | Log de congelamento com diagnóstico (H10) e rota nominada (H7) | `app.js` (`checkStalledTiles`), `rxstats.js` | 1 dia |
| C4 | Canvas no repasse (P4), se M2 mostrar software | `mesh.js:859-870` | 0,5-1 dia |
| C5 | `restartIce` antes de derrubar a PC (H13) | `mesh.js` / `app.js` | 1-2 dias |
| C6 | `.titlebar[hidden] { display: none }`: o `display: flex` da `.titlebar` vence o atributo `hidden`, então a faixa aparece em macOS/Linux e antes do `titlebar.js` rodar no Windows (a mesma armadilha já documentada para `.warn-center` em `style.css:2731`) | `style.css:2718` | 5 min |
| C7 | Mensagem da grade vazia dentro da sala (ver design, D1) | `index.html:217`, `app.js:757` | 1 h |

**Andamento (2026-09-23):** C1, C2, C3, C5, C6 e C7 implementados, junto
com D1, D2, D3, D5 e D6 da seção 6 (ver `STATUS.md`, "Consertos da análise
de 23/09"). C4 espera o M2. No C5 o reinício saiu com 1 s, não 3 s: medido,
o Chromium 152 só declara `disconnected` 6,5 s depois do último pacote.
O laboratório da H15 também está feito (`npm run lab`, `tools/lab/`).

---

## 6. Design (revisão com o app rodando)

Prints tirados na 0.19.0 a 1440x900, tema padrão "GoLive", com a faixa de
título do Windows simulada. Critérios: acessibilidade, interação, estados
vazios, consistência de ícones e feedback de erro.

- **D1 — A sala vazia manda você "entrar ou criar uma sala".** Dentro da
  sala, com "Sala de anônimo · 1 pessoa" no cabeçalho, a grade diz *"Entre
  ou crie uma sala pra começar"*. O texto certo (`emptyMessage()` → "Ninguém
  transmitindo ainda.") só é aplicado quando um tile é **removido**
  (`ui.js:830`); ao entrar, fica o texto estático do HTML. Além de corrigir,
  o estado vazio deveria ter ação: botão "Compartilhar tela", e "a tela de
  quem ficar ao vivo aparece aqui sozinha".
- **D2 — Dois ícones para "Configurações".** O dock da sala usa um sol
  (parece "brilho"); o painel do usuário no lobby usa a engrenagem. Mesma
  ação, dois símbolos. Usar a engrenagem nos dois.
- **D3 — "Ir ao vivo" desabilitado sem dizer por quê.** Com um monitor só,
  o card não vem selecionado e o botão fica apagado. Pré-selecionar a
  única tela (é o caso comum) e, quando desabilitado, dizer "Escolha uma
  tela ou janela".
- **D4 — O custo da qualidade não conversa com a rede real.** A linha
  "≈12 Mbps por pessoa assistindo" é boa, mas quem decide é o upload, que o
  app não sabe. Com um **teste de rede dentro do app** (mandar 5-10 s de
  dados por `RTCDataChannel` pra cada pessoa da sala e medir vazão, perda e
  RTT), a linha vira "seu upload medido: 18 Mbps → cabe 1 pessoa em
  1080p60, 3 em 720p30". Isso substitui o `testar-radmin.ps1` + `iperf3`
  do README (fricção alta, quase ninguém roda) e alimenta a eleição do
  relay, que hoje ignora upload (`tree.js:126`).
- **D5 — Falha de transmissão explicada, não congelada.** Com H10, o tile
  mostra "Sem contato com o PC de X, tentando de novo" ou "X parou de
  enviar imagem". Um quadro parado sem explicação é o que faz a pessoa sair
  e entrar da sala.
- **D6 — Nome da fonte em inglês.** O card do seletor mostra "Entire
  screen" (nome do `desktopCapturer`). Trocar por "Monitor 1 (principal)".
- **D7 — Transição de tela cheia** (C1): com a transição sendo abortada
  pelo redimensionamento, ela provavelmente nem aparece. Ou se resolve a
  ordem, ou se troca por FLIP (a pendência do vault já previa isso).

O que está bom e vale manter: um CTA primário por tela, foco visível,
rótulos acessíveis nos botões só de ícone do dock, a linha de custo no
seletor de qualidade, e a central de avisos com ícone por severidade (a
informação não depende só da cor).

---

## 7. Ordem sugerida

1. **Noite de medição** (seção 4). M3 e M2 decidem quase todo o resto.
2. **Consertos baratos** C1, C2, C6 e C7 (meio dia), depois C3 (1 dia). C3
   paga a próxima investigação sozinho.
3. Conforme as medidas:
   - H1 confirmada → tirar `audienceSteps` e usar a árvore só por upload;
     eleger o relay por **upload medido** (D4), não só por saúde de encode;
   - H2 confirmada → C4;
   - H3 confirmada → relay de canvas atrás de checagem;
   - H6 promissora → HEVC com fallback, atrás de uma checagem de decode no
     `join`.
4. **Laboratório automatizado** (H15), antes de qualquer mudança de
   topologia.
5. **Spike do SFU local** (H14), com o critério de gaveta escrito acima.

## 8. O que considerar

- **Regra do projeto:** mudança no renderer só entra depois de rodar o app
  (incidente #62/#63). Isso vale em dobro para C1, C3 e C5.
- **Não empilhar laços de controle às cegas** (decisão de 28/08). H4 e H14
  mexem em quem manda na qualidade; medir antes.
- **Todo mundo da sala na mesma versão** ajuda: mudança de protocolo (H10,
  H11, H14) pode entrar sem compatibilidade retroativa.
- **Upload continua sendo o teto físico.** Nada aqui cria banda: SFU,
  HEVC e árvore só a usam melhor. Para 5+ pessoas em 1080p60, alguém
  precisa de ~50-60 Mbps de upload real na VPN.
- **O que este documento não viu:** logs de quem transmitia (os cinco são
  de quem assistia ou abriu o app), logs do relay, e o NVENC de verdade.
  Ele não tem nenhum `[diag] tela->`.

## Fontes

- NVENC com 8 sessões simultâneas em GeForce (driver 551.23+):
  [VideoCardz](https://videocardz.com/newz/nvdia-geforce-gpus-now-support-up-to-8-concurrent-nvenc-encoding-sessions),
  [NVENC Application Note 12.2](https://docs.nvidia.com/video-technologies/video-codec-sdk/12.2/nvenc-application-note/index.html)
- H.265 no WebRTC do Chrome, ligado por padrão desde a 136:
  [chromestatus](https://chromestatus.com/feature/5153479456456704),
  [Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/3h8lL8a377c/m/_vnatJetAQAJ),
  [vdo.ninja/h265](https://vdo.ninja/h265)
- `jitterBufferTarget` é uma meta que "influencia" o buffer dentro dos
  limites do navegador (base da H16):
  [MDN](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget),
  [Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/bReU8otUmdk)
- mediasoup com worker pré-compilado:
  [anúncio da 3.12](https://mediasoup.discourse.group/t/mediasoup-3-12-0-released-with-prebuilt-worker/5247),
  [instalação](https://mediasoup.org/documentation/v3/mediasoup/installation/)
