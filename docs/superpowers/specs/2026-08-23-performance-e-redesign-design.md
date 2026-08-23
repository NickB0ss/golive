# Performance de transmissão e redesign da interface — design

Data: 2026-08-23

Duas frentes independentes, na mesma spec porque uma restringe a outra: o
redesign não pode custar GPU, já que GPU é exatamente o recurso disputado
com o encoder de vídeo e com o jogo.

- **Parte I — Performance.** Por que o PC de quem transmite trava quando o
  jogo é pesado, e o que fazer. Fase 1 são correções pontuais sem risco;
  fase 2 muda a topologia de malha pra árvore.
- **Parte II — Redesign.** Direção visual, tokens, sistema de motion e
  componente por componente.

Decisões travadas com o autor antes desta spec:

| Decisão | Escolha | Por quê |
|---|---|---|
| Direção visual | Superfícies opacas + acento vivo, **sem blur** | `backdrop-filter` é trabalho de GPU contínuo por camada; conflita com o objetivo da Parte I |
| Layout | Manter grid de 3 colunas, refinar | Risco baixo, familiaridade preservada, redesign vira quase 100% CSS |
| Topologia | Árvore de retransmissão (fase 2) | Resolve encode **e** upload de quem transmite, sem dependência nova; SFU fica registrado como caminho futuro |

---

# Parte I — Performance

## 0. Antes de tudo: isto é leitura de código, não medição

Nada abaixo foi medido no PC que trava. O diagnóstico vem de ler o código e
de como o Chromium se comporta. **O primeiro item a implementar é a
instrumentação**, porque é ela que diz qual hipótese é a verdadeira — e
algumas se anulam (se o encoder de hardware já estiver ativo e com folga, a
fase 2 fica muito menos urgente).

## 1. Diagnóstico: quem paga o quê hoje

Dois custos escalam com o número de espectadores, e têm sintomas diferentes:

| Custo | Escala | Sintoma | É o que trava o jogo? |
|---|---|---|---|
| **Encode** (GPU/CPU) | 1 por espectador | engasgo, stutter, queda de FPS no jogo | ✅ sim |
| **Upload** (banda) | 1 por espectador | imagem borrada, bitrate despenca | ❌ não |

Upload saturado faz o GCC do Chromium **baixar o bitrate** — a imagem
piora, mas o jogo não trava. Travamento é disputa por GPU ou CPU. Logo, a
prioridade é o encode.

### Por que o encode é N e não 1

[`mesh.js:156`](../../../src/renderer/mesh.js:156) — `offerTo` cria uma
`RTCPeerConnection` por peer e por `kind`, e faz `addTransceiver(track)` em
cada uma. Cada `RTCRtpSender` no Chromium instancia **seu próprio encoder**.
Não há API — nem no spec do WebRTC nem no Chromium — pra compartilhar um
encoder entre `RTCPeerConnection`s. Com 3 espectadores, o PC de quem
transmite roda 3 encodes de 1080p60 simultâneos a partir da mesma captura.

Duas consequências, e a segunda é a pior:

1. **Custo direto.** 3× o trabalho de encoder.
2. **Queda silenciosa pra software.** NVENC em placa GeForce tem limite de
   sessões simultâneas (historicamente 3, hoje 5–8 conforme driver e
   modelo). Estourado o limite, o Chromium **não avisa**: cai pro encoder de
   software (OpenH264/libvpx) sem erro visível. Aí um encode de 1080p60 em
   x264 come vários núcleos e o jogo engasga de verdade. Este é o candidato
   mais provável pro sintoma relatado.

Hoje o app **não tem como saber** se isso acontece:
[`app.js:1010`](../../../src/renderer/app.js:1010) lê
`qualityLimitationReason` mas nunca lê `encoderImplementation`.

### Outros custos que somam, em ordem de suspeita

| # | Onde | O quê | Custo |
|---|---|---|---|
| 1 | [`mesh.js:156`](../../../src/renderer/mesh.js:156) | N encoders, possível queda silenciosa pra software | alto |
| 2 | [`main.js:16`](../../../src/main.js:16) | Caminho de captura pode ser GDI/BitBlt em vez de WGC | alto para captura de **janela** |
| 3 | [`app.js:880`](../../../src/renderer/app.js:880) | Prévia local `<video>` de 1080p60 pintando o tempo todo, com o jogo por cima | médio |
| 4 | [`main.js:20`](../../../src/main.js:20) | `disable-renderer-backgrounding` faz o renderer nunca desacelerar, mesmo oculto | médio |
| 5 | [`app.js:676`](../../../src/renderer/app.js:676) | `INCLUDE_LIST_POLL_MS = 2000` → 2 varreduras completas da tabela de processos a cada 2s | médio, em picos |
| 6 | [`main.js:186`](../../../src/main.js:186) | `sources:list` captura + codifica PNG de toda janela aberta, no instante em que a pessoa vai transmitir | pico pontual |
| 7 | [`app.js:996`](../../../src/renderer/app.js:996) | `getStats()` por peer + reescrita de `innerHTML` a cada 1s | baixo |

---

## F1.1 — Instrumentar antes de mexer

**Hoje** [`updateStats`](../../../src/renderer/app.js:1005) coleta
`framesPerSecond`, `bytesSent`, `frameWidth/Height`,
`qualityLimitationReason`, `currentRoundTripTime` e `codec`.

**Passa a coletar também**, de `outbound-rtp` e `media-source`:

| Campo | De onde | Pra quê |
|---|---|---|
| `encoderImplementation` | `outbound-rtp` | **o campo mais importante desta spec** |
| `powerEfficientEncoder` | `outbound-rtp` | confirma encoder de hardware (booleano, mais direto que a string acima) |
| `totalEncodeTime` / `framesEncoded` | `outbound-rtp` | ms de encode por frame — o número que diz se sobra folga |
| `framesSent` vs `framesEncoded` | `outbound-rtp` | frames descartados no envio |
| `framesPerSecond` | `media-source` | fps que a **captura** entrega, distinto do fps que sai |

Como ler `encoderImplementation`:

| Valor | Significa |
|---|---|
| `"ExternalEncoder"`, `"NvCodec…"`, `"MediaFoundationVideoEncodeAccelerator"`, ou qualquer nome de fornecedor | hardware ✅ |
| `"OpenH264"`, `"libvpx"`, `"SimulcastEncoderAdapter (libvpx…)"` | **software** ❌ |

`totalEncodeTime / framesEncoded` dá o ms médio por frame. A 60 fps o
orçamento é 16,6 ms **para todos os encodes somados**. Três senders a 4 ms
cada são 12 ms — apertado. Um sender a 14 ms já estourou.

**Separar por peer.** Hoje `updateStats` agrega tudo (`fps = Math.max(...)`,
`bytes += ...`). Pra diagnóstico de encode é preciso ver **por sender**,
porque a degradação costuma atingir um só.

**Onde mexe:**

- [`app.js`](../../../src/renderer/app.js) `updateStats`: coletar por peer
  em vez de agregar; a aba de Estatísticas mostra uma linha por peer.
- [`ui.js`](../../../src/renderer/ui.js) `setStatsHtml`: tabela por peer,
  mais um bloco de resumo no topo.
- Aviso novo em `#stage-warning` quando `encoderImplementation` indicar
  software **e** houver mais de um sender ativo:
  *"Encoder em software — o vídeo está sendo codificado pela CPU. Reduza a
  qualidade ou o número de espectadores."*

**Critério de aceite:** com 1, 2 e 3 espectadores, a aba de Estatísticas
mostra encoder e ms/frame por peer, e o aviso aparece quando cai pra
software.

---

## F1.2 — Caminho de captura: WGC em vez de GDI

**Hoje** [`main.js:16-21`](../../../src/main.js:16) liga
`WebRtcAllowH264Send`, `PlatformHEVCEncoderSupport`,
`force_high_performance_gpu`, `disable-background-timer-throttling` e
`disable-renderer-backgrounding`. Nenhuma flag toca no **capturador**.

No Windows o Chromium tem três caminhos de captura, com custos bem
diferentes:

| Caminho | Usado para | Custo | Captura jogo em fullscreen exclusivo? |
|---|---|---|---|
| **DXGI Desktop Duplication** | tela inteira | baixo, GPU-side | sim |
| **GDI / BitBlt / PrintWindow** | janela | **alto, CPU-side**, força composição da janela | não (tela preta) |
| **WGC** (Windows.Graphics.Capture) | tela ou janela | baixo, GPU-side | sim |

Consequência prática: **compartilhar a janela do jogo é o caminho lento**,
compartilhar a tela inteira é o rápido. Se o amigo escolhe "Janelas → o
jogo" no picker, ele cai em GDI.

### O que fazer

**a) Ligar WGC.** As features de WGC no Chromium são separadas para tela e
janela. Nomes prováveis no Chromium 128 (Electron 32.3.3):
`AllowWgcScreenCapturer`, `AllowWgcWindowCapturer`, e a mais antiga
`AllowWgcDesktopCapturer`.

> ⚠️ **Não confiar nesses nomes sem verificar.** Eles mudaram de nome e de
> granularidade entre versões do Chromium, e uma feature inexistente em
> `--enable-features` é **silenciosamente ignorada** — parece que
> funcionou. Verificação obrigatória, nesta ordem:
>
> 1. Rodar com `--enable-logging --v=1` e procurar no log qual capturador
>    foi instanciado (`WgcCapturerWin` vs `ScreenCapturerWinGdi` /
>    `WindowCapturerWinGdi`).
> 2. Teste comportamental decisivo: compartilhar uma **janela de jogo em
>    fullscreen exclusivo**. GDI devolve preto; WGC devolve imagem.
> 3. Se ambos falharem, procurar os nomes correntes em
>    `content/public/common/content_features.cc` na tag do Chromium 128.

**b) Cuidado com `appendSwitch('enable-features', …)`.** Chamar duas vezes
**não soma** — a segunda sobrescreve a primeira. Hoje só há uma chamada, o
bug está latente. Ao adicionar WGC, tudo tem que ir numa lista única:

```js
const ENABLED_FEATURES = [
  'WebRtcAllowH264Send',
  'AllowWgcScreenCapturer',
  'AllowWgcWindowCapturer',
];
app.commandLine.appendSwitch('enable-features', ENABLED_FEATURES.join(','));
```

**c) Remover `PlatformHEVCEncoderSupport`.** O codec está travado em H.264
([`config.js:25`](../../../src/renderer/config.js:25)) e `preferCodec` só
pede `video/H264`. A flag de HEVC não faz nada aqui. Tirar reduz superfície
sem custo. *(Se um dia houver preset HEVC, ela volta junto.)*

**d) Guiar a escolha no picker.** Na aba "Janelas"
([`index.html:120`](../../../src/renderer/index.html:120)), uma linha de
ajuda: *"Pra jogos, prefira compartilhar a tela inteira — capturar só a
janela é mais pesado e não funciona em fullscreen exclusivo."* Custo: uma
frase. Benefício: pode resolver o caso do amigo sozinho.

**e) `WgcRequireBorder`.** O WGC desenha uma borda em volta do que está
sendo capturado (exigência do Windows). Em versões recentes dá pra
suprimir. Verificar o comportamento antes de decidir; registrar aqui o que
for descoberto.

---

## F1.3 — Encode sob demanda

**Ideia:** ninguém deve pagar encode por um espectador que não está
olhando. Hoje, se três pessoas estão na sala e duas minimizaram o GoLive pra
jogar, quem transmite ainda roda três encodes.

### Sinal do lado do espectador

Um espectador declara que **não** está assistindo quando:

| Condição | Como detectar |
|---|---|
| Janela minimizada | `win.on('minimize')` / `win.on('restore')` no main, via IPC |
| Janela totalmente ocluída | evento de oclusão do `webContents` — verificar disponibilidade no Electron 32; sem ele, cair só em minimize |
| Documento oculto | `document.visibilityState` no renderer |
| Tile fechado pela pessoa | `ui.grid.removeTile` disparado pelo menu do tile |

Volta a assistir na transição inversa. O estado é por-`kind` (tela e câmera
são conexões separadas — ver [`mesh.js:101`](../../../src/renderer/mesh.js:101)),
mas na prática minimizar mata os dois.

> `disable-renderer-backgrounding` ([`main.js:21`](../../../src/main.js:21))
> mantém o renderer em velocidade cheia mesmo oculto — então
> `visibilitychange` continua disparando normalmente e timers não são
> desacelerados. É o que queremos aqui (o sinal precisa sair rápido), mas
> ver F1.4.

### Protocolo

Mensagem nova no [`signaling-core.js`](../../../server/signaling-core.js).
O `switch` hoje trata `join`, `offer`, `answer`, `ice`, `broadcast-state` e
ignora o resto. Basta somar `view-state` ao mesmo `case` de encaminhamento
direto que já serve `offer`/`answer`/`ice`:

```js
case 'offer':
case 'answer':
case 'ice':
case 'view-state':
case 'tree': {           // 'tree' entra na fase 2, ver F2
  const target = peers.get(String(msg.to));
  if (!target) return;
  send(target.ws, { ...msg, from: id });
  break;
}
```

Formato:
`{ type: 'view-state', to: <id do transmissor>, kind: 'screen'|'camera', watching: boolean }`.
O espectador manda pra **cada** transmissor de quem tem um tile.

### Ação do lado de quem transmite

Em [`mesh.js`](../../../src/renderer/mesh.js), função nova:

```js
// Liga/desliga o encode pra um peer específico sem derrubar a conexão.
// replaceTrack(null) libera o encoder na hora e NÃO exige renegociação --
// a PeerConnection, o ICE e o DTLS continuam de pé, então religar é
// instantâneo (nada de esperar handshake de novo).
function setPeerDemand(peerId, kind, wanted, track) {
  const pc = peers.get(peerId)?.outConns[kind];
  if (!pc) return;
  for (const sender of pc.getSenders()) {
    const isVideoSlot = sender.track?.kind === 'video' || (!sender.track && wanted);
    if (isVideoSlot) sender.replaceTrack(wanted ? track : null).catch(() => {});
  }
}
```

Pontos de atenção:

- **Usar `replaceTrack(null)`, não `pc.close()`.** Fechar obriga
  ICE + DTLS + SDP de novo ao voltar (segundos). `replaceTrack(null)` libera
  o encoder e volta em um frame.
- **Não mexer no áudio.** Só a track de vídeo suspende — quem minimizou
  provavelmente ainda quer ouvir, e encode de áudio é irrelevante perto do
  de vídeo.
- **Ao religar, garantir keyframe.** O receptor precisa de um keyframe pra
  voltar a decodificar. O Chromium normalmente pede via PLI sozinho ao ver o
  fluxo voltar; se na prática ficar tela cinza, forçar mexendo em
  `scaleResolutionDownBy` via `setParameters` (dispara reconfiguração de
  encoder) ou com uma renegociação curta.
- **Estado inicial.** Peer sem `view-state` recebido conta como
  **assistindo** (padrão seguro).
- **Feedback visível.** No painel de membros
  ([`ui.js:573`](../../../src/renderer/ui.js:573)), quem está suspenso
  aparece esmaecido com *"não está assistindo"*. Sem isso, o comportamento
  vira bug fantasma ("por que o fulano tá com tela preta?").

### Interação com a fase 2

Com a árvore, **demanda propaga pra cima, não um hop só**: um relay só pode
suspender se *nenhum* descendente estiver assistindo. Ver F2.

**Critério de aceite:** com 2 espectadores, minimizar o GoLive num deles faz
o número de senders de vídeo ativos cair de 2 pra 1 nas estatísticas do
transmissor, e `totalEncodeTime` para de crescer pra aquele peer. Restaurar
traz vídeo de volta em menos de 1s, sem renegociação.

---

## F1.4 — Não pintar o que ninguém está vendo

**Hoje** [`main.js:20-21`](../../../src/main.js:20):

```js
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
```

Isso mantém o **renderer** em velocidade cheia com o jogo por cima: ele
continua compondo a prévia local de 1080p60, os tiles dos outros, o dot de
"ao vivo" — na mesma GPU que o jogo e o encoder disputam.

> **Premissa a verificar antes de mexer:** a captura do `getDisplayMedia` e o
> encode do WebRTC **não** rodam no renderer — vivem no processo de
> browser/GPU. Se isso se confirmar, desacelerar a pintura do renderer
> **não** afeta o que sai pros espectadores. Essa premissa é a base do item
> inteiro. Verificação: suspender a pintura e confirmar, nas estatísticas do
> espectador, que o `framesPerSecond` de entrada não muda. Se mudar, este
> item cai.

### O que fazer

**a) Pausar a prévia local quando a janela está oculta.**
[`app.js:880`](../../../src/renderer/app.js:880) mostra
`ui.grid.showTile('me', 'Você (prévia)', localStream, …)`. Em
`visibilitychange` (ou no evento de minimize vindo do main), `video.pause()`
em todos os `<video>` — inclusive os dos outros peers. Ao voltar, `play()`.

Um `<video>` pausado deixa de compor frames. A `MediaStreamTrack` por trás
continua viva e sendo enviada — pausar o elemento é parada de **exibição**,
não de captura.

**b) Trocar a prévia por um card estático.** A prévia é útil por dois
segundos ("estou compartilhando a coisa certa?") e depois é só custo — ainda
mais por ser uma imagem da própria tela dentro da própria tela. Proposta: a
prévia local vira um card compacto com miniatura congelada e
*"ao vivo · 1920×1080 · 60 fps"*, mais um botão "ver prévia" que liga o
vídeo ao vivo sob demanda.

**c) Desacelerar `updateStats` quando oculto.** De 1s pra 5s enquanto a
janela não estiver visível.

**d) Não remover as flags de background.** Elas provavelmente foram postas
por um motivo real (WebSocket de sinalização e timers de ICE não podem
congelar). O ganho vem de parar a **pintura**, que é específica e
reversível — não de deixar o Chromium desacelerar tudo.

**Critério de aceite:** com transmissão ativa e a janela minimizada, o uso de
GPU do processo do GoLive cai de forma mensurável (Gerenciador de Tarefas →
GPU, ou `chrome://gpu`), e o espectador não vê mudança em fps nem em
resolução.

---

## F1.5 — Custo periódico da captura de áudio por processo

**Hoje** [`app.js:676-713`](../../../src/renderer/app.js:676), no modo
"lista de inclusão" (compartilhar a **tela inteira** com "incluir Discord"
**desmarcado** — o caminho padrão), a cada 2 segundos:

```js
const [renderPids, processes, ownPid, discordPid] = await Promise.all([
  window.golive.listAudioRenderPids(),
  window.golive.listProcessNames(),   // varre a tabela de processos inteira
  window.golive.getOwnPid(),          // constante durante a execução
  window.golive.findDiscordPid(),     // varre a tabela de processos de novo
]);
```

São **duas varreduras completas da tabela de processos do Windows a cada 2
segundos**, no processo principal, durante o jogo. Mais dois IPCs cujo
resultado nunca muda.

### O que fazer

| Problema | Correção |
|---|---|
| `getOwnPid()` a cada ciclo | Cachear. O comentário em [`app.js:727`](../../../src/renderer/app.js:727) diz que é cacheado, mas o poll chama `window.golive.getOwnPid()` direto — o cache existe e não está sendo usado aqui. |
| `findDiscordPid()` a cada 2s | Cachear com validade longa (30s). Discord reiniciar no meio de uma transmissão é raro; e se acontecer, 30s de atraso é aceitável. |
| Duas varreduras separadas | `listAudioRenderPids` + `listProcessNames` viram **uma** chamada nativa que devolve os dois de um snapshot só. Mexe em [`native/src/addon.cc`](../../../native/src/addon.cc) e `audio_sessions.*`. |
| Intervalo de 2s | Subir pra 5s. O que o poll detecta é "um app começou a tocar som" — 5s de atraso pra um som novo entrar na mistura é imperceptível num jogo. |

Ordem de custo/benefício: cachear os dois PIDs e subir pro 5s é praticamente
grátis e já corta a maior parte do trabalho. Unificar a chamada nativa é
opcional e exige `npm run build:native`.

**Critério de aceite:** com transmissão de tela inteira ativa, o número de
varreduras de processo por minuto cai de 60 pra 12, e nada muda no áudio que
os espectadores ouvem.

---

## F1.6 — Pico do seletor de fontes

**Hoje** [`main.js:186`](../../../src/main.js:186) `sources:list` captura e
codifica em PNG uma miniatura de **cada janela aberta**. Já está otimizado
(224×126, `fetchWindowIcons: false`, busca em duas etapas) — mas roda no
instante exato em que a pessoa vai transmitir, ou seja, com o jogo aberto.

Melhorias baratas, em ordem:

1. **Não recarregar ao trocar de aba** dentro da mesma abertura do picker.
   (Verificar se já é o caso.)
2. **Botão de atualizar explícito** em vez de recarregar sozinho.
3. **Miniaturas sob demanda:** listar nome e ícone primeiro, e capturar a
   miniatura só de quem entra no viewport (`IntersectionObserver` sobre
   `.source-card`), com uma segunda chamada IPC por id.

O item 3 é o que resolve de verdade e é o mais caro. Fazer 1 e 2 primeiro e
medir.

---

## F2 — Árvore de retransmissão

A mudança estrutural. **Fazer só depois da fase 1 estar medida**, porque a
fase 1 pode já resolver o sintoma.

### O princípio

```
malha (hoje):          árvore (proposta):

  A ─┬─→ B               A ──→ B ─┬─→ C
     ├─→ C                        └─→ D
     └─→ D

  A: 3 encodes           A: 1 encode, 1 upload   ← o gamer
     3 uploads           B: 1 decode + 2 encodes ← GPU ociosa
```

Quem transmite (**origem**) manda **uma** cópia. Um espectador (**relay**)
recebe e repassa. Os demais (**folhas**) recebem do relay.

O relay está só assistindo — GPU e upload ociosos. A origem é quem está
jogando. A árvore move o custo de quem não tem folga pra quem tem.

### O preço, declarado

| Custo | Detalhe |
|---|---|
| **Recodificação no relay** | O Chromium **não** repassa frames codificados. Uma track remota adicionada a outra `RTCPeerConnection` é decodificada e recodificada. Perda geracional de H.264 a 12 Mbps por uma geração é pequena, mas não é zero. *(Existe proposta no W3C pra passagem direta via `RTCRtpScriptTransform`; não está implementada — não contar com ela.)* |
| **Latência** | +1 hop por nível: encode + rede + decode. Ordem de 50–150 ms por nível. |
| **Qualidade limitada pelo pior link acima** | Se o link A→B degradar, C e D herdam. O escopo do dano é a sub-árvore, não a sala. |
| **Relay sai da sala** | Filhos ficam sem vídeo até a árvore se reconstruir. Precisa de recuperação rápida (abaixo). |

O que a árvore **não** custa, e um SFU custaria: congestion control e
keyframes continuam de graça, porque cada hop é uma `RTCPeerConnection`
normal do Chromium, com GCC e PLI completos.

### Papéis e escolha do relay

A **origem manda na árvore**. Ela já conhece todos os peers (`mesh.peers`) e
o estado `live` de cada um, então calcula a topologia sozinha e distribui os
papéis. Nada de eleição distribuída.

```js
const FANOUT_ORIGEM = 1;    // a origem manda pra UM só -- ela é quem está jogando
const FANOUT_RELAY = 2;     // cada relay atende no máximo 2
const PROFUNDIDADE_MAX = 2; // origem → relay → folha. Nada mais fundo.
```

`PROFUNDIDADE_MAX = 2` é o freio de latência **e** a garantia contra ciclo:
com profundidade máxima 2 e a árvore recalculada só pela origem, não há como
um nó virar ancestral de si mesmo.

Critérios pra eleger relay, em ordem:

1. **Não pode estar transmitindo** (nem tela nem câmera) — quem transmite já
   é origem de outra árvore.
2. **Não pode estar suspenso** por F1.3 (quem minimizou não é candidato).
3. **Melhor RTT medido** com a origem
   (`candidate-pair.currentRoundTripTime`, que o `getStats` já coleta).
4. Desempate: quem entrou na sala há mais tempo (estabilidade).

Se **nenhum** candidato passa, a árvore degrada pra malha direta. Malha é
sempre o fallback, nunca um erro.

### Protocolo

Mensagem `tree`, encaminhada pelo mesmo `case` de F1.3. A origem manda a
cada nó a sua atribuição:

```
{ type: 'tree', to: <peerId>, kind: 'screen',
  origem: <id da origem>,
  paiId: <de quem receber>,   // === origem quando é filho direto
  filhos: [<id>, ...],        // vazio quando é folha
  epoch: <int>                // incrementa a cada recálculo
}
```

`epoch` impede atribuição velha de sobrescrever a nova quando duas mensagens
cruzam. Regra: **ignorar `tree` com `epoch` menor que o último visto pra
aquela origem.** Mesmo padrão do `currentSession !== session` que o app já
usa em todo callback assíncrono.

### mesh.js

Função nova, ao lado de `offerTo`:

```js
// Repassa uma track JÁ RECEBIDA (de inConns[kind]) pra um peer abaixo na
// árvore. O Chromium recodifica -- não é passagem direta -- então isto
// custa 1 decode + 1 encode no relay. Ver a spec de 2026-08-23.
async function relayTo(childId, sourcePeerId, kind, quality) {
  const inbound = peers.get(sourcePeerId)?.inStreams?.[kind];
  if (!inbound) return;
  await offerTo(childId, inbound, quality, kind);
}
```

Pra isso, `makeConnection` no ramo `dir === 'in'`
([`mesh.js:108`](../../../src/renderer/mesh.js:108)) precisa **guardar** o
stream recebido, não só entregá-lo ao `onTrack`:

```js
pc.addEventListener('track', (event) => {
  const peer = peers.get(peerId);
  if (peer) (peer.inStreams ||= {})[kind] = event.streams[0];   // ← novo
  onTrack(peerId, peer ? peer.name : peerId, event.streams[0], kind);
});
```

No relay, antes de repassar: aplicar `contentHint = 'motion'` na track
retransmitida (herança do hint da origem não é garantida) e os mesmos
`maxBitrate`/`maxFramerate` do preset — **sem escalonar pra baixo a cada
nível**, senão a qualidade cai em cascata.

### Recuperação

| Evento | Reação |
|---|---|
| Relay sai da sala (`peer-left`) | Origem detecta, incrementa `epoch`, **primeiro** conecta os órfãos direto (malha), **depois** recalcula a árvore. Vídeo volta rápido; otimização vem em seguida. |
| Relay começa a transmitir | Deixa de ser elegível. Origem recalcula. |
| Relay minimiza (F1.3) | **Não** suspende o encode dele — tem descendentes assistindo. Suspende só a própria *exibição*. |
| Conexão origem→relay em `failed` | Origem cai pra malha direta com todos e tenta a árvore de novo depois de 10s. |
| `TREE_ENABLED` desligado | Comportamento idêntico ao de hoje. |

### Demanda propaga pra cima

A regra de F1.3 muda com a árvore. Um nó só pode ser suspenso pela origem se
**ele e toda a sua sub-árvore** não estiverem assistindo. Como a origem é
dona da topologia, ela tem essa informação: agrega o `view-state` de cada nó
com o dos descendentes antes de decidir. Um relay que minimizou mas tem duas
folhas assistindo continua recebendo e repassando.

### Interruptor

`TREE_ENABLED` em [`config.js`](../../../src/renderer/config.js), **padrão
desligado** até estar medido, exposto em Configurações → Rede como
*"Retransmissão em cadeia (experimental) — reduz o custo pra quem transmite,
às custas de um pouco de latência pra quem assiste."*

### Como validar

1. Sala de 4. Ligar a árvore. Nas estatísticas da origem: **1** sender de
   vídeo ativo, não 3.
2. `totalEncodeTime / framesEncoded` na origem cai proporcionalmente.
3. `encoderImplementation` na origem permanece hardware (com 1 sessão, isso
   é praticamente garantido).
4. No relay: 1 decoder + 2 encoders ativos.
5. Matar o relay (fechar o app). Cronometrar até o vídeo voltar nas folhas.
   Meta: < 3s.
6. Comparar lado a lado, no mesmo instante e num jogo com movimento, a
   imagem de uma folha (2 gerações) com a de um filho direto (1 geração). Se
   a diferença for visível a olho nu, revisar o bitrate do relay.

---

## Caminho futuro: SFU no processo do host

Registrado porque foi avaliado e **descartado por ora**, com os motivos —
pra não ser reavaliado do zero daqui a seis meses.

**A ideia:** o host (que já roda o servidor de sinalização embutido, ver
[`signaling-core.js`](../../../server/signaling-core.js)) passa a encaminhar
pacotes RTP sem decodificar. Origem faz 1 encode; qualidade intacta;
latência mínima. Implementação candidata: `werift` (WebRTC em TypeScript
puro para Node).

**Por que não agora:**

| # | Desvantagem |
|---|---|
| 1 | Não resolve o **upload**, e pode não resolver nada: quem cria a sala normalmente é quem transmite. Com host = origem, o upload continua N× no mesmo PC — e o [README](../../../README.md) identifica upload como o gargalo do projeto no Brasil. |
| 2 | **Ponto único de falha, e é regressão.** Hoje o host cair mantém o vídeo (conexões P2P diretas; só a sinalização morre). Com SFU, o host cair derruba o vídeo de todo mundo. |
| 3 | **+1 hop pra todos, e o pior link contamina a sala.** Hoje, se o Radmin cai pro relay dele entre dois peers, só aquele par sofre. Com SFU, um link ruim até o host atinge todos. |
| 4 | **Congestion control não vem pronto** — e é o miolo de um SFU. O laço do GCC quebra: a origem negocia banda com o host, não com o espectador. Sem encaminhar TWCC/REMB de volta, a origem manda 12 Mbps satisfeita enquanto o espectador fraco perde pacotes. Junto vêm encaminhamento de PLI/FIR e, pra valer, simulcast. |
| 5 | **werift é uma pilha WebRTC inteira em TS puro** (ICE/DTLS/SCTP/SRTP) contra libwebrtc em C++. Interop com Chromium sobre o adaptador virtual do Radmin é território onde o bug é nosso pra debugar sozinho. |
| 6 | **JS single-thread no processo do host.** ~5.000 pacotes/s pra 1080p60 com 3 espectadores. Viável, mas pressão de GC é real — e se o host também joga, trocamos um problema de GPU por um de CPU. |
| 7 | Some com a dieta de dependências do projeto (hoje: `ws`, `electron-updater`, `node-addon-api`). |

**Quando reconsiderar:** salas de 5+ pessoas, host com upload gordo que não
joga, e disposição pra manter congestion control próprio.

---

# Parte II — Redesign

## 2. A ideia que organiza tudo: cor é sinal, não decoração

O app é uma janela pra tela de outra pessoa. Tudo que não é o vídeo deveria
recuar.

O tema de hoje é um clone do Discord: `--accent: #5865f2` aparece em botão
primário, aba ativa, item selecionado, borda de card, `accent-color` de
input, hover de scrollbar. A cor está em toda parte, então não significa
nada.

**A regra do redesign:**

> O acento é reservado a **uma** coisa: *alguém está ao vivo*. Nada mais na
> interface usa cor saturada em estado normal.

Consequências, e é aqui que a coisa fica única:

- Qualquer cor na tela quer dizer transmissão. A sala é legível de relance,
  sem ler texto nenhum.
- Botão primário, aba ativa, item selecionado passam a se distinguir por
  **elevação e contraste**, não por cor. É mais difícil de fazer bem e é
  exatamente por isso que não parece template.
- Satisfaz de graça a regra de "acento em no máximo 10–15% da tela".

Nome de trabalho da direção: **Superfície e sinal**.

### O que sai

| Padrão de hoje | Por quê sai |
|---|---|
| `--accent` em botão primário, aba, seleção, scrollbar | Dilui o único significado que a cor deveria ter |
| 4 cores semânticas (`good`/`warn`/`bad`/`accent`) | `good` e `accent` dizem a mesma coisa: "funcionando, há sinal". Viram uma. |
| `--radius: 8px` para tudo | Um raio único para pílula, card e modal achata a hierarquia |
| `filter: brightness(1.15)` como hover universal | Clareia texto e ícone junto com o fundo; some com o contraste |
| Sombra única `0 4px 16px rgba(0,0,0,.4)` | Uma sombra só não constrói eixo de elevação |

---

## 3. Tokens

Substituem o bloco `:root` de
[`style.css:3`](../../../src/renderer/style.css:3).

### Superfícies — elevação por luminosidade, não por sombra

Sem blur, sem gradiente. Cada nível é um passo de luminosidade.

```css
:root {
  /* Superfícies: 0 é o mais fundo, 4 é o mais próximo do usuário */
  --surface-0: #0d0f13;   /* fundo da janela, atrás de tudo */
  --surface-1: #14171d;   /* colunas laterais */
  --surface-2: #1b1f27;   /* cards, linhas de lista, campos */
  --surface-3: #232833;   /* hover */
  --surface-4: #2d3340;   /* pressionado, selecionado */
  --surface-modal: #171b22;

  /* Texto */
  --text-1: #eef1f6;      /* principal */
  --text-2: #9aa4b5;      /* secundário, rótulos */
  --text-3: #616b7d;      /* terciário, desabilitado */

  /* Linhas: alpha sobre a superfície, não cor fixa -- funciona em qualquer nível */
  --line-subtle: rgba(255, 255, 255, 0.06);
  --line:        rgba(255, 255, 255, 0.10);
  --line-strong: rgba(255, 255, 255, 0.16);
}
```

O `--surface-0` mais escuro que qualquer nível de hoje (`#0d0f13` vs
`#1e1f22`) é o que dá o "suavizado": com o fundo mais fundo, os passos de
elevação ficam legíveis sem precisar de sombra pesada.

### Semântica — três cores, uma delas com um único significado

```css
:root {
  --live:   #39d8ff;   /* ao vivo. E SÓ ao vivo. */
  --warn:   #f5b544;   /* degradado: encoder em software, banda insuficiente */
  --danger: #ff5d5d;   /* quebrado, e ações destrutivas */

  /* Versões de fundo, para faixas de aviso */
  --live-dim:   rgba(57, 216, 255, 0.14);
  --warn-dim:   rgba(245, 181, 68, 0.13);
  --danger-dim: rgba(255, 93, 93, 0.13);
}
```

Por que ciano e não o roxo de hoje: `#5865f2` é Discord, `#9146ff` é Twitch,
vermelho é YouTube. Um ciano vivo não pertence a nenhum concorrente, salta
contra neutros frios num painel escuro, e coexiste sem ambiguidade com
âmbar (aviso) e vermelho (erro) — que é justamente o problema que um acento
verde ou coral teria.

**`good` foi absorvido por `--live`.** Onde hoje há um dot verde de
"conectado", passa a haver o mesmo dot em `--live` — porque conectado e ao
vivo são a mesma afirmação: há sinal.

### Raio, espaço, sombra, foco

```css
:root {
  --r-xs: 6px;    /* badges, dots, ícones pequenos */
  --r-sm: 10px;   /* botões, campos, linhas de lista */
  --r-md: 14px;   /* cards, tiles */
  --r-lg: 18px;   /* modais, painéis */
  --r-full: 999px;

  --s-1: 4px;  --s-2: 8px;   --s-3: 12px;
  --s-4: 16px; --s-5: 24px;  --s-6: 32px;  --s-7: 48px;

  /* Sombra dupla: contato curto + difusão longa. Uma só não constrói eixo. */
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.40);
  --shadow-2: 0 1px 2px rgba(0, 0, 0, 0.30), 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-3: 0 1px 3px rgba(0, 0, 0, 0.40), 0 16px 48px rgba(0, 0, 0, 0.50);

  /* Anel de foco: duplo, com o offset na cor da superfície de baixo */
  --ring: 0 0 0 2px var(--surface-0), 0 0 0 4px var(--live);
}
```

Raio progressivo (10 → 14 → 18) é metade do "suavizado". O outro metade é a
sombra dupla: a camada curta ancora o elemento, a longa dá a maciez.

### Tipografia

Continua `"Segoe UI"` — é nativa do Windows, não custa download, não muda o
CSP e não tem FOUT. O ganho vem da escala, não da fonte.

| Papel | Tamanho / peso / tracking | Onde |
|---|---|---|
| `--type-display` | 22px / 700 / -0.02em | título de modal |
| `--type-title` | 15px / 650 / -0.01em | nome de sala, nome no tile |
| `--type-body` | 13.5px / 450 / 0 | corpo geral |
| `--type-label` | 11px / 600 / 0.08em / uppercase | "Salas na rede", "Na sala" |
| `--type-meta` | 12px / 450 | metadados, contagem de peers |
| `--type-mono` | 12px / 450, `ui-monospace` | endereços IP |

**Detalhe que importa mais do que parece:** todo número que atualiza sozinho
(estatísticas, contagem de peers, Mbps) recebe
`font-variant-numeric: tabular-nums`. Sem isso, o `4` e o `1` têm larguras
diferentes e o painel treme a cada segundo. É uma linha de CSS e é a
diferença entre parecer feito e parecer acabado.

---

## 4. Sistema de motion

Escrito com a skill `ui-animation`. Regras que valem para tudo abaixo:

- **Só `transform` e `opacity`** para movimento. Cor e opacidade também são
  aceitáveis para estado. Nunca `width`/`height`/`top`/`left`.
- **Nunca `transition: all`.** Listar as propriedades.
- **Nunca animar ação iniciada por teclado** (atalhos, Tab, setas) —
  repetem o tempo todo e a animação faz parecer lento.
- **CSS transitions, não keyframes**, para tudo que possa ser interrompido:
  keyframes recomeçam do zero quando interrompidos, transitions re-miram.
  Keyframes só para sequências predeterminadas (o pulso de "ao vivo").
- **Alta frequência inverte a assimetria:** hover e popover entram em
  **0 ms** e saem em 100–150 ms. Só interação rara entra devagar.
- **`will-change` ligado durante o movimento e removido depois.** Promoção
  permanente em muitos elementos é pior que nenhuma.

### Tokens de motion

```css
:root {
  /* Curvas. Nada de ease-in em UI: começa lento e parece que atrasou. */
  --ease-enter:  cubic-bezier(0.22, 1, 0.36, 1);   /* entradas, hover com transform */
  --ease-move:   cubic-bezier(0.25, 1, 0.5, 1);    /* deslizes, indicadores, painéis */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);   /* saídas de superfície, estilo iOS */

  --t-press: 120ms;   /* feedback de toque */
  --t-hover: 140ms;   /* transform de hover */
  --t-tint:  200ms;   /* cor e opacidade de hover */
  --t-pop:   180ms;   /* badges, troca de ícone, troca de texto */
  --t-move:  240ms;   /* indicador deslizante, tile entrando */
  --t-modal: 260ms;   /* modal abrindo */
  --t-exit:  150ms;   /* qualquer saída */
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --t-press: 0ms; --t-hover: 0ms; --t-pop: 0ms;
    --t-move: 0ms;  --t-modal: 0ms; --t-exit: 0ms;
  }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Zerar as durações **nos tokens** faz todo componente herdar o caminho
reduzido sem precisar de uma regra por componente. O bloco `*` é a rede de
segurança para o que escapar.

### Onde animar

| # | Elemento | Hoje | Passa a ser | Prop | Duração / curva | Propósito |
|---|---|---|---|---|---|---|
| 1 | `.icon-btn`, `button` no `:active` | nada | `scale(0.96)` | `transform` | **0 ms** entrando, `--t-press` voltando | feedback |
| 2 | `.room-row`, `.peer-list li` hover | `filter: brightness` | `background: --surface-3` | `background-color` | **0 ms** entrando, `--t-tint` saindo | alta frequência: imediato |
| 3 | `.room-connect` ao conectar | troca de `innerHTML` seca | troca de ícone com crossfade + `scale(0.8→1)` | `opacity`, `transform` | `--t-pop` / `--ease-enter` | confirmação no lugar |
| 4 | `#btn-copy-address` | nada | vira **"Copiado ✓"** no próprio botão, segura 1,4 s, volta | `opacity`, `transform` | `--t-pop` / `--ease-enter` | confirmar onde o dedo está, não num toast no canto |
| 5 | `.modal` (picker, configurações) | `display: none` | overlay `opacity 0→1`; caixa `scale(0.96→1)` + `translateY(8px→0)` | `opacity`, `transform` | `--t-modal` / `--ease-enter`; saída `--t-exit` / `--ease-drawer` | orientação |
| 6 | `.tile` entrando na grid | aparece seco | `opacity 0→1` + `scale(0.97→1)` via `@starting-style` | `opacity`, `transform` | `--t-move` / `--ease-enter` | orientação: alguém ficou ao vivo |
| 7 | `.tile` saindo | some seco | `opacity 1→0` + `scale(1→0.98)` | `opacity`, `transform` | `--t-exit` | continuidade |
| 8 | `.picker-tab.active` / `.settings-cat.active` | `border-bottom` por aba | **um** indicador que desliza entre as abas | `transform` | `--t-move` / `--ease-move` | continuidade direcional |
| 9 | `.source-card.selected` | `border-color` | anel `box-shadow 0→2px` + badge de check com pop-in | `box-shadow`, `transform` | `--t-hover` / `--t-pop` | feedback |
| 10 | dot de **ao vivo** | estático | **o momento-assinatura** — ver abaixo | `opacity`, `transform` | 2,4 s `ease-in-out` infinite | sinal |
| 11 | `.update-banner` | `display: none` | entra do canto: `translateY(12px→0)` + fade | `opacity`, `transform` | `--t-modal` / `--ease-enter` | toast legítimo: sem origem na tela |
| 12 | `#stage-warning`, `.warn-box` | `display: none` | `grid-template-rows: 0fr → 1fr` + fade do conteúdo | `grid-template-rows`, `opacity` | `--t-move` / `--ease-move` | abre altura sem animar `height` |
| 13 | `.pip-thumb` arrastando | posição direta | **sem easing durante o arrasto**; ao soltar, assenta | `transform` | 380 ms / `--ease-enter`, **sem overshoot** | manipulação direta |
| 14 | tile → fullscreen | corte seco | `document.startViewTransition()` — o tile cresce até a tela | — | `--t-modal` | continuidade: a maior de todas |

### #10 — o pulso de "ao vivo"

É o único elemento com animação em laço no app inteiro, e é de propósito:
delight escala inversamente com frequência, e este é o estado mais raro e
mais importante da interface.

Um anel em `--live` que respira em volta do dot, num keyframe de 2,4 s. O
dot em si não se mexe — só o anel expande e desvanece. É calmo, não pisca, e
não compete com o vídeo.

Três exigências não-negociáveis:

1. **`transform` e `opacity` só.** Nada de `box-shadow` animado.
2. **Pausa quando a janela está oculta** (`visibilitychange` → `animation-play-state: paused`).
   Animação em laço queima GPU mesmo invisível — e é a Parte I desta mesma
   spec que diz isso.
3. **Só um por vez na tela.** Se três pessoas estão ao vivo, o anel fica
   apenas no tile em foco; nos outros, o dot é sólido e estático. Três
   pulsos dessincronizados viram ruído.

### #14 — View Transitions

`document.startViewTransition()` existe no Chromium 128 (Electron 32.3.3),
então dá pra usar sem polyfill e sem biblioteca. É o que dá o "design
recente" a custo quase zero: o tile cresce até virar fullscreen em vez de
cortar.

```js
function toggleTileFullscreen(tile, id) {
  if (!document.startViewTransition) return aplicar();  // fallback: comportamento de hoje
  document.startViewTransition(() => aplicar());
}
```

O elemento recebe `view-transition-name: tile-<id>` enquanto a transição
roda, e perde depois (dois elementos com o mesmo nome ao mesmo tempo abortam
a transição).

> ⚠️ Verificar com **vídeo tocando**: view transitions tiram um snapshot do
> elemento, e `<video>` pode piscar ou congelar um frame na captura. Se
> piscar, a alternativa é animar `transform` do tile do retângulo de origem
> até o de destino com a técnica FLIP. Testar antes de fechar a decisão.

### Candidatos rejeitados

Registrados com o motivo, pra não voltarem em revisão:

| Candidato | Por que não |
|---|---|
| Números das estatísticas com rolagem de odômetro | Atualizam 1×/s sozinhos. Movimento sem ação do usuário desorienta; `tabular-nums` resolve o problema real, que é o tremor. |
| Stagger na lista de salas | A lista muda sozinha (beacons UDP). Animar na montagem sem gatilho do usuário é a definição do anti-padrão. |
| Transição de página entre "sem sala" e "em sala" | O layout persiste; só o conteúdo do palco troca. Uma transição aqui inventaria uma navegação que não existe. |
| `backdrop-filter` no overlay do modal | Custo de GPU contínuo. É a decisão de abertura desta spec. Overlay é `rgba(0,0,0,.55)` opaco e pronto. |
| Hover animado na scrollbar | Alta frequência, propósito zero. |

**Maior alavancagem entre todos:** o #14 (tile → fullscreen). É a transição
mais dramática do app, acontece várias vezes por sessão, e hoje é um corte
seco.

---

## 5. Componente por componente

Ordem de construção: tokens → componentes-base → compostos → telas → estados.

### 5.1 Base

**Botões.** Três níveis, distinguidos por **superfície**, não por cor:

| Nível | Fundo | Borda | Texto | Onde |
|---|---|---|---|---|
| primário | `--surface-4` | `--line-strong` | `--text-1` | "Ir ao vivo", "Conectar" |
| ghost | transparente | `--line` | `--text-1` | "Copiar", "Cancelar" |
| sutil | transparente | nenhuma | `--text-2` | ícones da barra |
| destrutivo | transparente | `--line` | `--danger` no hover | "Desconectar" |

Todos: `--r-sm`, `:active` com `scale(0.96)`, `:focus-visible` com `--ring`.
Hover troca a superfície um nível pra cima — nunca `filter: brightness`, que
clareia o texto junto e derruba o contraste.

O destrutivo ser ghost com texto vermelho (e não fundo vermelho) é o que
libera o vermelho para significar "quebrado" sem competir com um botão que
está sempre visível na tela.

**Campos.** `--surface-2`, borda `--line`, `--r-sm`. No foco: `--ring`
substitui a troca de `border-color` de hoje. `accent-color` de checkbox e
range passa a `--live`.

**Dot de status.** `--r-full`, 8px. Estados: `--live` sólido (conectado ou
ao vivo), `--warn`, `--danger`, `--text-3` (offline). Com anel pulsante só
no caso #10.

### 5.2 Coluna de salas

- Marca (`.app-brand`): badge deixa de ser `--accent` sólido. Vira
  `--surface-3` com a inicial em `--text-1`. A marca não é sinal.
- `.rooms-title` / `.members-title`: `--type-label`, `--text-2`. O padrão de
  hoje já está certo, só reancorado nos tokens.
- `.room-row`: `--r-sm`, `--s-3` de padding, hover `--surface-3` com **0 ms**
  de entrada. Estado ativo é `--surface-4` mais uma barra de 3px em `--live`
  à esquerda — o único uso de acento na coluna, e ele significa "esta sala
  tem alguém ao vivo".
- `#room-list-live .room-name::before { content: '● ' }` sai. O dot vira
  elemento de verdade, herdando o componente de status.
- Vazio: hoje é `<li class="muted">` com estilo inline. Vira um bloco
  centralizado com ícone esmaecido e uma frase — *"Nenhuma sala na rede.
  Crie uma ou entre por endereço."*
- `.user-panel`: fixo no fim da coluna, `--surface-2`, borda superior
  `--line-subtle`.

### 5.3 Palco

- `.stage-header`: altura fixa, `--s-4` de padding. Nome em `--type-title`,
  endereço em `--type-mono` `--text-2`.
- `.grid`: `--s-3` de gap, tiles em `--r-md`.
- `.tile`: `--surface-2`, `--shadow-1` em repouso, `--shadow-2` no hover ou
  em foco. Sem borda — a sombra e a superfície bastam.
- `.tile-label`: hoje só aparece no hover. Continua, mas ganha um scrim
  (gradiente de `transparent` a `rgba(0,0,0,.6)`) atrás do texto, senão nome
  claro sobre cena clara some.
- Prévia local: o card compacto de F1.4-b, com o dot de ao vivo e um botão
  "ver prévia".
- Vazio: *"Entre ou crie uma sala pra começar."* ganha ilustração leve em
  SVG de uma linha e uma ação primária embaixo.

### 5.4 Membros

- `.peer-list li`: `--r-sm`, hover `--surface-3`.
- Avatar mantém o anel colorido de hoje, mas com a paleta nova: `--live`
  quando ao vivo, `--warn` degradado, sem anel no estado normal.
- **Estado novo (de F1.3):** quem não está assistindo aparece com o avatar a
  55% de opacidade e *"não está assistindo"* em `--type-meta` `--text-3`.

### 5.5 Modais

- Overlay `rgba(0,0,0,.55)`, **sem blur**.
- Caixa: `--surface-modal`, `--r-lg`, `--shadow-3`, borda `--line-subtle`.
- Entrada e saída do #5. `transform-origin: center` (modal fica no centro;
  só popover ancora no gatilho).
- `Esc` fecha. Foco vai pro primeiro elemento interativo na abertura e volta
  pro gatilho no fechamento — hoje não há gestão de foco nenhuma.
- Configurações: nav vertical com o indicador deslizante do #8.
- Picker: abas com o mesmo indicador, na horizontal.

### 5.6 Acessibilidade

Corrigido junto porque é barato agora e caro depois:

- `:focus-visible` com `--ring` em **todo** interativo. Hoje só `input` e
  `select` têm estilo de foco; botão nenhum tem.
- Contraste: `--text-2` (`#9aa4b5`) sobre `--surface-1` (`#14171d`) passa
  AA para corpo. `--text-3` é só para texto desabilitado e decorativo —
  **nunca** para informação.
- Hover atrás de `@media (hover: hover) and (pointer: fine)`.
- `prefers-reduced-motion` pelos tokens, mais o bloco `*`.
- Alvos de toque com no mínimo 32×32 — `.icon-btn-inline` de hoje tem 22px.

---

## 6. Matriz de arquivos

| Arquivo | F1.1 stats | F1.2 WGC | F1.3 demanda | F1.4 pintura | F1.5 áudio | F1.6 picker | F2 árvore | Redesign |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `src/main.js` | | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `src/preload.js` | | | ✓ | ✓ | ✓ | ✓ | | |
| `src/renderer/app.js` | ✓ | | ✓ | ✓ | ✓ | | ✓ | ✓ |
| `src/renderer/mesh.js` | ✓ | | ✓ | | | | ✓ | |
| `src/renderer/ui.js` | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| `src/renderer/config.js` | | | | | ✓ | | ✓ | |
| `src/renderer/style.css` | ✓ | | ✓ | ✓ | | ✓ | | ✓ |
| `src/renderer/index.html` | | ✓ | | ✓ | | | | ✓ |
| `server/signaling-core.js` | | | ✓ | | | | ✓ | |
| `native/src/*` | | | | | ✓ (opcional) | | | |

Testes que acompanham: `config.test.js` (flag `TREE_ENABLED`, migração),
`mesh.test.js` (`setPeerDemand`, cálculo da árvore, `epoch`, fallback pra
malha), `signaling-core.test.js` (encaminhamento de `view-state` e `tree`).

---

## 7. Ordem sugerida

**Fase 1 — medir e colher o barato** (nesta ordem, cada uma entrega sozinha)

1. **F1.1** instrumentação. Primeiro porque é o que diz se o resto é
   necessário.
2. **F1.2 c/d** remover flag de HEVC + dica do picker. Minutos, e (d) pode
   resolver o caso do amigo sozinho.
3. **F1.5** cachear PIDs e subir o intervalo. Barato, isolado.
4. **F1.2 a/b** ligar WGC e consolidar `enable-features`. Precisa da
   verificação de nomes.
5. **F1.4** pausar a pintura. Precisa validar a premissa antes.
6. **F1.3** encode sob demanda. Maior ganho da fase 1 e o único que mexe no
   protocolo.

**➜ Medir de novo aqui.** Se o travamento sumiu, a fase 2 vira opcional.

**Redesign — pode correr em paralelo** (não colide com a fase 1: quase tudo
é `style.css`)

7. Tokens (§3). Substituir `:root`, migrar os nomes antigos por aliases pra
   nada quebrar de uma vez.
8. Motion (§4). Tokens + os itens 1, 2, 5.
9. Componentes-base (§5.1) e coluna de salas (§5.2).
10. Palco e membros (§5.3, §5.4) — inclui o estado "não está assistindo" de
    F1.3.
11. Modais (§5.5), indicador deslizante (#8), confirmação no lugar (#4).
12. Assinatura: pulso de ao vivo (#10) e view transition (#14).
13. Acessibilidade (§5.6).

**Fase 2**

14. **F2** árvore, atrás de `TREE_ENABLED` desligado por padrão.

---

## 8. Como verificar

Nenhuma afirmação de "ficou melhor" sem número ao lado.

| O quê | Como | Meta |
|---|---|---|
| Encoder de hardware | Estatísticas → `encoderImplementation` com 3 espectadores | não pode ser software |
| Custo de encode | `totalEncodeTime / framesEncoded` | soma < 16,6 ms a 60 fps |
| Capturador em uso | `--enable-logging --v=1`, ou compartilhar jogo em fullscreen exclusivo | WGC, não GDI |
| Encode sob demanda | minimizar num espectador → contar senders ativos | cai de N pra N−1 |
| Pintura ociosa | Gerenciador de Tarefas → GPU, janela minimizada com transmissão ativa | queda mensurável, sem mudança no fps do espectador |
| Árvore | senders de vídeo na origem, sala de 4 | 1, não 3 |
| Recuperação da árvore | matar o relay, cronometrar | vídeo volta em < 3s |
| Motion | Animations panel a 10%; DevTools → Rendering → emular `prefers-reduced-motion` | nenhuma propriedade de layout animada; todo caminho reduzido existe |
| Regressão de motion | `grep -nE "transition:\s*all\|transition:.*(width\|height\|top\|left)" src/renderer/style.css` | zero resultado |
| Contraste | DevTools → Elements → Accessibility, em `--text-2` sobre `--surface-1` e sobre `--surface-2` | AA para corpo |
| Foco | percorrer a interface só com Tab | todo interativo mostra o anel |

---

## 9. Fora de escopo, levantado de passagem

- **`iceTransportPolicy: 'all'` com STUN público**
  ([`mesh.js:10`](../../../src/renderer/mesh.js:10)): o comentário explica a
  decisão, mas vale registrar que isso vaza o IP público dos participantes
  pro Google. Num app cuja proposta é "ninguém no meio", merece pelo menos
  ser uma opção desligável.
- **Trocar nome/avatar com sessão ativa não repropaga pros peers** — já
  registrado na spec de 2026-08-23 (§4), continua aberto.
- **"Compartilhar som" não avisa quando o addon nativo não existe** na
  máquina — cai pro loopback de sistema em silêncio. Já registrado, continua
  aberto. Com o redesign, o lugar natural pro aviso é abaixo da checkbox no
  picker.
- **Sem gestão de foco nos modais hoje** — coberto em §5.5, mas vale notar
  que é um bug de acessibilidade preexistente, não algo que o redesign
  introduz.
- **`sound.js` toca entrada/saída sem controle de volume nem mudo** — se a
  sala tiver rotatividade durante um jogo, vira incômodo.
