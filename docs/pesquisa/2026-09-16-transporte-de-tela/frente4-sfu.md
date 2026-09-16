# FRENTE 4 — SFU / Servidor de mídia e onde hospedar

Pesquisa: 2026-09-16. Alvo: GoLive LAN v0.16.0 (Electron/Windows, 1080p60, H.264 por
hardware, 3–6 amigos, sem monetização).

> **Nota de método.** O proxy de rede desta sessão bloqueia acesso direto a vários
> domínios de fornecedor (`developers.cloudflare.com`, `livekit.io`, `fly.io`,
> `hetzner.com`, `docs.oracle.com`, `mediasoup.org`, `bloggeek.me`…). Os números abaixo
> vêm de busca web com citação da URL original, ou de fontes secundárias recentes quando
> a primária estava bloqueada. Onde não consegui confirmar, está marcado
> **[não verificado]**. Os únicos dados que li direto da fonte primária foram o
> registro npm do mediasoup e as páginas GitHub de mediasoup/MediaMTX.

---

## 0. Resposta curta

**Sim, um SFU é viável de graça — e a resposta que eu não esperava é o Cloudflare
Realtime SFU: US$ 0,05/GB com 1.000 GB/mês grátis.** O cenário real do GoLive
(1 transmissor + 4 espectadores, 12 Mbps, 10 h/mês) consome **216 GB/mês**, ou seja
**21,6% da franquia gratuita**. Custo: **US$ 0,00**. Cabem ~46 horas de transmissão por
mês antes de qualquer cobrança.

E há um efeito colateral que vale mais que o SFU em si: **um SFU com IP público
substitui, de uma só vez, a VPN (Radmin/Tailscale), o TURN que o projeto não tem, e a
árvore de retransmissão caseira.** As três dores 1, 2 e 5 do briefing morrem juntas.

O preço: quebra literal da promessa "sem servidor na nuvem, sem ninguém no meio" —
**a menos que se implemente E2EE por Encoded Transform**, que é tecnicamente possível
hoje no Chromium e tem implementação de referência aberta (Cloudflare Orange Meets, MLS).

---

## 1. A conta de banda (a base de tudo)

### 1.1 Aritmética

```
12 Mbps = 12.000.000 bits/s ÷ 8 = 1,5 MB/s
1,5 MB/s × 3.600 s      = 5.400 MB/h = 5,4 GB/h   por fluxo de vídeo
```

Áudio Opus estéreo (~128–256 kbps) adiciona ~0,06–0,11 GB/h — desprezível (~2%).
Overhead de RTP/SRTP/UDP/IP adiciona ~5–8% sobre o payload. **Use 5,4 GB/h como número
de trabalho e some ~7% para a fatura real** (≈ 5,8 GB/h).

### 1.2 O SFU: 1 entra, N saem

| Papel | Fluxos | Banda instantânea | Volume/hora |
|---|---|---|---|
| Transmissor → SFU (ingress) | 1 | 12 Mbps ↑ | 5,4 GB |
| SFU → 4 espectadores (egress) | 4 | **48 Mbps ↓** | **21,6 GB** |
| Total atravessando o SFU | 5 | 60 Mbps | 27,0 GB |

Quase todo provedor cobra **só o egress** (Cloudflare cobra "data egress"; LiveKit
tornou upstream gratuito e só mede downstream —
[livekit.com/blog/towards-a-future-aligned-pricing-model](https://livekit.com/blog/towards-a-future-aligned-pricing-model)).
Então o número que importa é **21,6 GB/hora**.

### 1.3 Volume mensal por cenário

| Cenário | Espectadores | h/mês | Egress/mês | Ingress/mês |
|---|---|---|---|---|
| Briefing ("5 pessoas, 10h/mês") | 4 | 10 | **216 GB** | 54 GB |
| 3h/semana (4 semanas) | 4 | 12 | 259,2 GB | 64,8 GB |
| 3h/semana (52/12 = 4,33 sem.) | 4 | 13 | **280,8 GB** | 70,2 GB |
| Sala de 6 (5 espectadores) | 5 | 13 | 351 GB | 70,2 GB |
| Uso pesado (2h/dia útil) | 4 | 40 | 864 GB | 216 GB |
| Se cair para 1080p30 @ 6 Mbps | 4 | 13 | 140,4 GB | 35,1 GB |

Guarde estes três: **216 GB**, **280,8 GB**, **864 GB**.

### 1.4 Em quantas horas cada free tier acaba

Horas de sala 1+4 a 12 Mbps que cabem em cada franquia gratuita:

| Serviço | Franquia grátis/mês | Horas 1+4 @12 Mbps | Cobre 10 h/mês? | Cobre 13 h/mês? |
|---|---|---|---|---|
| **Cloudflare Realtime SFU** | 1.000 GB egress | **46,3 h** | ✅ sobra 78% | ✅ sobra 72% |
| **Daily.co** | 10.000 participant-min | **33,3 h** | ✅ sobra 70% | ✅ sobra 61% |
| **Cloudflare RealtimeKit** | grátis em beta (ilimitado hoje) | — | ✅ | ✅ |
| **Agora** | 10.000 min "Standard" | ~33 h se 1080p60 contar 1× **[não verificado — 1080p consome múltiplo]** | ⚠️ | ⚠️ |
| **Stream.io (GetStream)** | US$ 100/mês de crédito | 11–55 h conforme faixa de resolução **[não verificado]** | ✅ provável | ✅ provável |
| **LiveKit Cloud (Build)** | 50 GB egress | **2,3 h** | ❌ acaba no 1º dia | ❌ |
| **Whereby Embedded** | 2.000 min (plano de US$ 6,99) | 6,7 h | ❌ | ❌ |
| **Oracle Cloud Always Free** | 10 TB egress | **463 h** | ✅ usa 2,1% | ✅ usa 2,8% |
| **Vultr** | 2 TB egress (pool) | 92,6 h | ✅ | ✅ |
| **Hetzner EU** | 20 TB | 926 h | ✅ | ✅ |
| **Hetzner US** | 1 TB | 46,3 h | ✅ | ✅ |
| **AWS** | 100 GB/mês | 4,6 h | ❌ | ❌ |

Fontes dos números de franquia na seção 3 e 4.

---

## 2. SFUs open source

### 2.1 Confirmação central: SFU **não transcodifica**

> "The SFU forwards streams to subscribers without decoding or re-encoding them, it
> reads RTP packet headers, makes a forwarding decision, and sends the packet. (…) The
> per-packet work is an SRTP decrypt, a header rewrite, an SRTP encrypt, and a socket
> write (…) That is why SFU capacity is usually bounded by network interface throughput
> and packet rate long before it is bounded by processor time."
> — [real-time-media-architecture.com/media-server-architecture/selective-forwarding-unit-design/](https://www.real-time-media-architecture.com/media-server-architecture/selective-forwarding-unit-design/),
> [adhdecode.com/protocol-deep-dives/webrtc-protocol/webrtc-sfu-selective-forwarding-unit/](https://adhdecode.com/protocol-deep-dives/webrtc-protocol/webrtc-sfu-selective-forwarding-unit/)

Consequência prática para o GoLive: **o H.264 que a NVENC/AMF/QuickSync produz passa
intacto**. O SFU não precisa saber decodificar H.264, não paga royalty de codec, e não
gasta GPU. MediaMTX declara o mesmo explicitamente: "MediaMTX itself does not perform
transcoding. It passes through the encoded media as-is to avoid quality loss and CPU
overhead" ([bluenviron/mediamtx discussion #3985](https://github.com/bluenviron/mediamtx/discussions/3985)).

### 2.2 CPU por fluxo repassado — números concretos

- mediasoup: **~500 consumers por core**; um worker é um subprocesso C++ de uma thread
  (libuv). "A Worker represents a mediasoup C++ subprocess that runs in a single CPU
  core." ([mediasoup.org/documentation/v3/scalability/](https://mediasoup.org/documentation/v3/scalability/),
  citado via busca — domínio bloqueado aqui)
- Benchmark real reportado no fórum do mediasoup: **6 participantes, 1 vídeo + 1 áudio
  cada a 700 kbps, consumindo 5+5 → 20% de UM core**
  ([mediasoup.discourse.group/t/ballpark-calculation-of-cpu-usage-per-stream/671](https://mediasoup.discourse.group/t/ballpark-calculation-of-cpu-usage-per-stream/671))
- Jitsi Videobridge: **1.000 streams de vídeo a 550 Mbps com 20% de CPU**
  ([jitsi.org/jitsi-videobridge-performance-evaluation/](https://jitsi.org/jitsi-videobridge-performance-evaluation/))
- Ressalva do próprio mediasoup: workers são single-thread e "does not scale well for
  broadcasting scenarios (a few media producers and many consumers)" — irrelevante para
  4–5 consumers, relevante se algum dia virar 200 espectadores.

**Estimativa para o caso GoLive:** 12 Mbps ≈ 1.250 pacotes/s por fluxo (payload ~1.200 B).
Entra 1.250 pps, saem 5.000 pps. Comparado ao benchmark de 550 Mbps/20% do JVB, nossos
60 Mbps totais ficam em **ordem de 2–5% de um core moderno**. Qualquer VPS de 1 vCPU
sobra. **O gargalo é 100% banda, zero CPU.**

### 2.3 Tabela comparativa

| Projeto | Linguagem | Licença | Embutir em Electron/Node | Simulcast/SVC | H.264 passthrough | Veredito p/ GoLive |
|---|---|---|---|---|---|---|
| **mediasoup** | data plane C++, control plane **Node.js** | **ISC** (confirmado no `package.json` npm) | **É um módulo npm.** `mediasoup@3.27.1`, publicado **2026-09-16**, `engines: node >=22` (lido de registry.npmjs.org). Roda um subprocesso C++ à parte | Simulcast + SVC em VP8/VP9/H.264/AV1 | Sim (só encaminha) | **Melhor encaixe técnico.** É literalmente `npm i mediasoup` dentro do processo que já existe |
| **MediaMTX** | Go, binário único zero-dependência | **MIT** | Binário externo (spawn), não é módulo Node | Não é SFU WebRTC pleno; é gateway multi-protocolo (WHIP/WHEP/RTSP/RTMP/SRT/LL-HLS) | Sim, passthrough explícito | Bom para 1→N (WHIP publica, WHEP assiste). Mais simples que mediasoup, menos controle de camadas |
| **LiveKit (OSS)** | Go (sobre Pion) | **Apache 2.0** | Binário Go stateless + Redis se replicado. Portas 7880 (WS), 7881 (TCP fallback), UDP 7882 ou faixa 50000-60000 | Simulcast por padrão em VP8/H.264; SVC automático em VP9/AV1 | Sim | Plataforma completa (SDKs, salas, gravação). Mais peso operacional, mas "pilhas incluídas" |
| **Janus** | C | GPLv3 (com exceções) **[não verificado]** | Processo separado, plugins em C | Sim | Sim | Barreira de linguagem; melhor quando o núcleo é SIP/PBX. Não é o caso |
| **Jitsi Videobridge** | Kotlin/Java (JVM) | Apache 2.0 **[não verificado]** | Processo JVM separado | Sim | Sim | Excelente performance, mas arrastar uma JVM para dentro de um app Electron de amigos é exagero |
| **Pion** | Go (biblioteca) | MIT **[não verificado]** | Você escreve o SFU | Você implementa | Sim | Só faz sentido se quiser controle total |
| **ion-sfu** | Go (sobre Pion) | MIT **[não verificado]** | Binário | Sim | Sim | **Status de manutenção em 2026 não confirmado** — aparece em listas, mas não achei atividade recente. Risco |
| **Galène** | Go | **[licença não verificada]** | Binário | Simulcast sim | Sim | Release estável **1.0 em 2025-08-09** ([Wikipedia](https://en.wikipedia.org/wiki/Galene_(software))). SFU minimalista, "lightweight", bom para auto-hospedagem doméstica |
| **Owncast / SRT** | Go / paradigma broadcast | — | — | — | — | **Paradigma errado.** É HLS/broadcast assíncrono; latência de segundos. SRT sozinho é ponto-a-ponto, não replica |
| **Millicast / Dolby OptiView** | proprietário gerenciado | — | — | — | — | **Fora.** Preço histórico começava em **US$ 495/mês** com 500 GB ([techcrunch, 2022](https://techcrunch.com/2022/02/03/dolby-acquires-low-latency-streaming-platform-millicast)); preço 2026 não publicado |

Fontes da comparação:
[forasoft.com — SFU comparison](https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion),
[bloggeek.me — Best OSS WebRTC media servers 2026](https://bloggeek.me/webrtc-tools/media-servers-oss/),
[github.com/versatica/mediasoup](https://github.com/versatica/mediasoup),
[github.com/bluenviron/mediamtx](https://github.com/bluenviron/mediamtx),
[sheerbit.com — Self-Hosted LiveKit 2026](https://sheerbit.com/self-hosted-livekit-complete-deployment-guide/).

### 2.4 Por que "mediasoup é módulo Node" importa tanto aqui

O GoLive **já** tem um processo Node (o main do Electron) que **já** sobe um servidor `ws`
de sinalização na porta 9000-9010 e **já** pede regra de firewall. Adicionar mediasoup é:

```
npm i mediasoup        →  spawn de 1 worker C++  →  createRouter/createWebRtcTransport
```

…dentro do mesmo processo, com a mesma regra de firewall, sem instalar nada a mais para o
usuário. **Nenhum outro SFU da lista tem esse encaixe.** Isso viabiliza a opção 5
("um amigo hospeda") sem pedir a ninguém que instale um servidor — o próprio GoLive
**é** o servidor.

⚠️ **Pendência de verificação importante:** mediasoup 3.x baixa binário pré-compilado do
worker ou exige compilar com Python + MSVC no Windows? Se exigir toolchain, isso mata o
"zero atrito" e obriga a empacotar o binário do worker no instalador. **[não verificado —
não consegui confirmar; é o primeiro item a testar num spike]**

---

## 3. Free tiers gerenciados — o caminho de menor esforço

### 3.1 Tabela mestre

Cenário: 1 transmissor + 4 espectadores, 12 Mbps, **10 h/mês** (216 GB egress /
3.000 participant-minutes).

| Serviço | Free tier (2026) | Custo do cenário real | Modelo de cobrança | Fonte |
|---|---|---|---|---|
| **Cloudflare Realtime SFU** | **1.000 GB/mês** (compartilhado com TURN) | **US$ 0,00** (216 de 1.000 GB) | **US$ 0,05/GB** de egress | [developers.cloudflare.com/realtime/sfu/pricing](https://developers.cloudflare.com/realtime/sfu/pricing) |
| **Cloudflare RealtimeKit** (ex-Dyte) | **Grátis durante o beta** (sem cobrança) | **US$ 0,00** hoje; **US$ 6,00/mês** no GA | US$ 0,002/participant-min A/V; US$ 0,0005 áudio | [cloudflare.com/products/realtime](https://www.cloudflare.com/products/realtime/) |
| **Daily.co** | **10.000 participant-min/mês** | **US$ 0,00** (3.000 de 10.000) | US$ 0,004/participant-min depois | [daily.co/pricing/video-sdk](https://www.daily.co/pricing/video-sdk/) |
| **Stream.io (GetStream)** | **US$ 100/mês de crédito** | provavelmente **US$ 0,00** | US$ 0,0015/participant-min (faixa US$ 0,30–12 por 1k conforme resolução) | [getstream.io/video/pricing](https://getstream.io/video/pricing/) |
| **Agora** | **10.000 min "Standard"/mês** | **US$ 0,00 a ~US$ 20** conforme multiplicador de Full HD | US$ 3,99/1k min HD; Full HD consome mais da franquia | [docs.agora.io/en/video-calling/overview/pricing](https://docs.agora.io/en/video-calling/overview/pricing) |
| **LiveKit Cloud (Build)** | **5.000 min + 50 GB + 100 participantes simultâneos, US$ 0/mês** | **~US$ 19,92/mês** (166 GB acima da franquia) + taxa de plano | **US$ 0,12/GB** downstream; upstream grátis; conexão US$ 0,0005/min | [livekit.com/pricing](https://livekit.com/pricing), [blog](https://livekit.com/blog/towards-a-future-aligned-pricing-model) |
| **Whereby Embedded** | 2.000 min no plano de **US$ 6,99/mês** | **~US$ 11,00/mês** | US$ 0,004/min adicional | [whereby.com/information/embedded/pricing](https://whereby.com/information/embedded/pricing) |
| **100ms** | **Sem plano gratuito público em 2026**; preço sob cotação | desconhecido | — | [spotsaas.com/product/100ms-video-sdk/pricing](https://www.spotsaas.com/product/100ms-video-sdk/pricing) |
| **Twilio Video** | **NÃO foi descontinuado** — ver 3.3 | preço 2026 **[não verificado]** | — | [twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product](https://www.twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product) |
| **Dyte** | **Não existe mais como produto independente** — ver 3.4 | — | — | — |
| **Janus as a service** (Meetecho) | Nenhum free tier público encontrado | — | — | **[não verificado]** |
| **Dolby OptiView / Millicast** | Sem free tier; a partir de US$ 495/mês (2022) | proibitivo | — | [techcrunch](https://techcrunch.com/2022/02/03/dolby-acquires-low-latency-streaming-platform-millicast) |

### 3.2 Cloudflare Realtime SFU — por que é a melhor resposta

Os números confirmados por múltiplas fontes convergentes:

> "The SFU is a low-level media server billed at **$0.05 per GB of egress with a
> 1,000 GB per month free tier**, and TURN is free when used together with the Realtime
> SFU. (…) The free tier includes usage from **both SFU and TURN**, not two independent
> free tiers."
> — [developers.cloudflare.com/realtime/sfu/pricing](https://developers.cloudflare.com/realtime/sfu/pricing),
> [cipher.co.th — Cloudflare Realtime media services (2026)](https://www.cipher.co.th/en/blogs/cloudflare-realtime-media-services/)

> "Traffic between Cloudflare Realtime TURN and Cloudflare Realtime SFU (…) does not get
> double charged."
> — [developers.cloudflare.com/realtime/turn/faq](https://developers.cloudflare.com/realtime/turn/faq/)

Codecs: **"H264, H265, VP8, VP9 and AV1 for video, and Opus plus G.711 PCM for audio"**
([developers.cloudflare.com/realtime/realtimekit/recording-guide/configure-codecs](https://developers.cloudflare.com/realtime/realtimekit/recording-guide/configure-codecs/)).
**H.264 está lá** — o pipeline NVENC atual passa direto.

Limites: "Up to 64 tracks can be added with a single API call (…) there's **no upper limit
to the number of tracks a session can contain**, with the practical limit governed by your
connection's bandwidth"
([developers.cloudflare.com/realtime/sfu/limits](https://developers.cloudflare.com/realtime/sfu/limits/)).

**Curva de custo do Cloudflare SFU (sala 1+4 @12 Mbps):**

| Horas/mês | Egress | Acima da franquia | Custo |
|---|---|---|---|
| 10 | 216 GB | — | **US$ 0,00** |
| 13 | 281 GB | — | **US$ 0,00** |
| 30 | 648 GB | — | **US$ 0,00** |
| 46,3 | 1.000 GB | — | **US$ 0,00** ← limite |
| 60 | 1.296 GB | 296 GB | US$ 14,80 |
| 100 | 2.160 GB | 1.160 GB | US$ 58,00 |

Custo marginal acima da franquia: **US$ 1,08 por hora de transmissão** (21,6 GB × 0,05).

**Ressalvas honestas do Cloudflare:**
1. É uma **API de baixo nível** (push/pull de tracks via HTTP + PeerConnection), não um
   SDK de salas. Isso é *bom* para o GoLive: a sinalização `ws` que já existe continua
   existindo; troca-se a malha P2P por `pushTrack`/`pullTrack`.
2. Precisa de **App ID + secret da Cloudflare**. Embutir secret num app desktop
   distribuído é inseguro — o padrão é um endpoint mínimo que emita token (um Cloudflare
   Worker no free tier resolve). **Isso significa que alguém precisa de uma conta
   Cloudflare.** Quebra parcialmente o "sem conta".
3. Se estourar 1 TB, **alguém paga**. Se não houver cartão na conta, o comportamento
   (bloqueio vs. cobrança) **[não verificado]**.
4. Não achei confirmação de que o **ingress é gratuito** (só "egress" aparece no preço).
   **[não verificado]** — se ingress contasse, o consumo subiria de 216 para 270 GB, ainda
   dentro da franquia.
5. **Não achei sobretaxa regional para o Brasil** no changelog de preços; a busca por
   `2025-07-28-br-pricing` retornou entrada sobre Browser Rendering, não sobre Realtime.
   **[não verificado se há surcharge para tráfego BR]** — este é um risco a checar.

### 3.3 Twilio Video: **não foi descontinuado** (confirmado)

Twilio anunciou EOL em março/2024 para **5 de dezembro de 2026**, e **reverteu a decisão
em outubro/2024**. Segue produto autônomo suportado, aceitando novas contas em 2026.
Fontes: [twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product](https://www.twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product),
[bloggeek.me — Twilio Programmable Video is back from the dead](https://bloggeek.me/twilio-programmable-video-back/),
[help.twilio.com/articles/24158233644443 — EOL Extension](https://help.twilio.com/articles/24158233644443).
Não encontrei preço 2026 nem free tier **[não verificado]**.

### 3.4 Dyte: comprado pela Cloudflare

Dyte foi **adquirido pela Cloudflare em 18/04/2025** e transformado em **RealtimeKit**.
Não existe mais como fornecedor independente.
Fontes: [blog.cloudflare.com/introducing-cloudflare-realtime-and-realtimekit](https://blog.cloudflare.com/introducing-cloudflare-realtime-and-realtimekit/),
[cloudflare.com/products/realtime](https://www.cloudflare.com/products/realtime/).
RealtimeKit está **em beta e gratuito**; no GA cobrará **US$ 0,002/participant-min**
A/V → 3.000 min = **US$ 6,00/mês** no cenário real.

### 3.5 LiveKit Cloud: o free tier que não serve

**50 GB de banda = 2 horas e 18 minutos** de uma sala 1+4 a 12 Mbps. Acaba na primeira
sessão. A estrutura de preço do LiveKit (US$ 0,12/GB) é **2,4× a do Cloudflare** e não tem
franquia útil para vídeo de alta taxa. LiveKit é excelente **auto-hospedado** (Apache 2.0,
binário Go) — só não como nuvem gratuita.

---

## 4. Hospedagem própria barata

Requisito de rede: **~60 Mbps sustentados** (48 saindo + 12 entrando) e **216–281 GB de
egress/mês**. Requisito de CPU: irrisório (seção 2.2).

### 4.1 Oracle Cloud Always Free — a promessa e as letras miúdas

**O que ainda vale em 2026:**
- **10 TB/mês de egress gratuito**, tráfego de entrada não medido
  ([docs.oracle.com — Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
  [itprotutorials.com](https://itprotutorials.com/oracle-cloud-free-tier-a-surprisingly-generous-playground-that-keeps-on-giving/))
- 216 GB = **2,1% da franquia**. Cabem **463 horas/mês** de transmissão.

**⚠️ Mas: o Always Free encolheu pela metade em 2026.**
Em **15 de junho de 2026** a Oracle reduziu silenciosamente o Ampere A1 de
**4 OCPU/24 GB para 2 OCPU/12 GB** (de 3.000 para 1.500 OCPU-horas e de 18.000 para
9.000 GB-horas por mês), **sem blog post, sem aviso no console**. Instâncias acima do novo
limite foram paradas e desabilitadas; a Oracle mandou e-mail avisando que instâncias acima
do limite **em ou após 18 de agosto de 2026 seriam terminadas**.
Fontes: [InfoQ — Oracle Quietly Halves Free Tier Ampere A1 Compute Limits](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/),
[linuxiac.com](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/),
[terminalbytes.com](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026/).

Para um SFU, 2 OCPU ARM ainda é **10× o necessário**. O problema não é CPU — é
**confiabilidade da promessa**.

**⚠️ Risco de "reclaim" por ociosidade — este é o risco real:**
> "Idle Always Free compute instances may be reclaimed by Oracle. Oracle will deem
> (…) compute instances as idle if, during a 7-day period, the CPU utilization for the
> 95th percentile is **less than 20%**."
> — [docs.oracle.com — Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Um SFU que roda 3 horas por semana e usa 3% de CPU nesse tempo é **o retrato do perfil que
a Oracle considera ocioso**. Isso não é hipotético: é a política escrita. Contornar isso
exige gerar carga artificial, o que é feio e desperdiça energia. **Este é o furo do
plano Oracle.**

**⚠️ Disponibilidade em São Paulo:**
A região existe: **`sa-saopaulo-1`, chave `GRU`, 1 availability domain**
([docs.cloud.oracle.com — New region in Sao Paulo, Brazil](https://docs.cloud.oracle.com/iaas/releasenotes/changes/43a4df66-4557-469b-95f9-60cd4bf496a6/)).
Mas há relatos de **"Out of host capacity" persistente para A1.Flex em `sa-saopaulo-1`**,
inclusive um caso de 3 dias de tentativas automatizadas (relatado em 23/03/2026)
([community.oracle.com — Cannot upgrade Free Tier to PAYG A1.Flex out of capacity in sa-saopaulo-1](https://community.oracle.com/customerconnect/discussion/949983/cannot-upgrade-free-tier-to-payg-a1-flex-out-of-capacity-in-sa-saopaulo-1-for-3-days)).
Plano B: as **2 VMs AMD micro** (`VM.Standard.E2.1.Micro`) do Always Free, que costumam ter
capacidade — e para um SFU, 1 GB de RAM e 1/8 OCPU podem bastar, já que o gargalo é rede.
**[não verificado se a franquia de 10 TB é por conta ou por região]**

**Cartão brasileiro:** a Oracle aceita cartão de crédito e débito que funcione como
crédito, mas **não aceita débito com PIN, virtuais, de uso único ou pré-pagos**, e faz uma
pré-autorização temporária
([oracle.com/cloud/free/faq](https://www.oracle.com/cloud/free/faq/)). Há relatos
frequentes de "Error Processing Transaction"/"credit card declined" no cadastro, mas **não
achei evidência de problema específico com cartões brasileiros em 2026**
**[não verificado]**.

**Veredito Oracle:** custo US$ 0, latência ótima (GRU), mas **três riscos empilhados**
(capacidade A1 em GRU, redução unilateral da franquia em jun/2026, política de reclaim por
ociosidade que nosso perfil de uso dispara). É uma fundação instável para um app que
precisa "simplesmente funcionar" para leigos.

### 4.2 Tabela de hospedagem própria — custo e latência

Cenário: 216 GB egress/mês (10 h). Câmbio usado: **US$ 1 ≈ R$ 5,40 [não verificado]**.

| Provedor | DC útil p/ BR | Tráfego incluído | Custo do cenário | Latência estimada BR ida-volta | Nota |
|---|---|---|---|---|---|
| **Oracle Always Free** | **São Paulo (GRU)** | **10 TB/mês** | **US$ 0,00** | **~10–30 ms** | Melhor preço absoluto; riscos da 4.1 |
| **OVHcloud VPS Brasil** | **São Paulo** | **Ilimitado**, até 3 Gbps | **~US$ 6,50/mês** (~R$ 35) | **~10–30 ms** | *"unlimited traffic and bandwidth of up to 3 Gbps at no extra cost"* — [ovhcloud.com/en/vps/vps-brasil](https://www.ovhcloud.com/en/vps/vps-brasil/). Preço exato da região BR **[não verificado]** |
| **Magalu Cloud** | **Brasil** | pago por GiB | VM + **R$ 20,10/mês** de egress (201 GiB × R$ 0,10) ≈ **US$ 3,70 só de banda** | **~5–20 ms** | [magalu.cloud/precos/network](https://magalu.cloud/precos/network/) — R$ 0,10/GiB saída, entrada grátis |
| **Locaweb Cloud** | **Brasil** | egress **grátis** (alegado) | VM a partir de **R$ 20/mês** | **~5–20 ms** | [locaweb.com.br/locaweb-cloud](https://www.locaweb.com.br/locaweb-cloud/) — "tráfego de saída sem custos adicionais" **[fonte secundária, não verificado na página oficial]** |
| **Vultr** | São Paulo **[não verificado]** | **2 TB/mês** pooled, egress; ingress grátis | **~US$ 5–6/mês** (só a VM) | ~10–30 ms se BR | Overage **US$ 0,01/GB** — [docs.vultr.com — bandwidth overage rate](https://docs.vultr.com/support/platform/billing/what-is-the-bandwidth-overage-rate) |
| **DigitalOcean** | sem DC no Brasil **[não verificado]** | 1 TB/droplet, pooled | ~US$ 6/mês | ~120 ms (NYC/Miami) | Overage **US$ 0,01/GiB** |
| **Hetzner US** (Ashburn/Hillsboro) | EUA | **1 TB/mês** | **€ 4,99/mês** (CPX11) | **~115–130 ms** | Overage **€ 1,00/TB**. US caiu de 20 TB para 1 TB em dez/2024 — [betterstack.com/community/guides/web-servers/hetzner-cloud-review](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/) |
| **Hetzner EU** (Falkenstein/Nuremberg/Helsinki) | Europa | **20 TB/mês** | **€ 4,99/mês** | **~180–220 ms** ❌ | Banda linda, latência **inviável** (ver 4.3) |
| **Contabo** | Munique, Nuremberg, NY, Seattle, St. Louis, Singapura, Londres — **sem BR** | **32 TB/mês**, porta 200 Mbit/s | **€ 3,60–4,50/mês** | ~120 ms (NY) | [contabo.com/en/vps-b](https://contabo.com/en/vps-b/); 200 Mbit/s é suficiente p/ 60 Mbps |
| **RackNerd** | EUA | vários TB | ~US$ 12–30/**ano** | ~120–160 ms | **[detalhes não verificados]** |
| **Fly.io** | **GRU (São Paulo)** existe | 0 | **US$ 4,32/mês** se GRU custar US$ 0,02/GB; **US$ 25,92** se estiver na faixa alta (US$ 0,12/GB) | ~10–30 ms | US$ 0,02/GB em NA/EU, "higher rates in some other regions", até US$ 0,12/GB em África/Índia — [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/). **Preço de GRU [não verificado]** |
| **Railway / Render** | sem BR | — | Railway ~US$ 0,05/GB; Render US$ 0,10/GB após 100 GB **[ambos não verificados]** | alta | PaaS costuma não expor faixa UDP — **provavelmente incompatível com WebRTC** |

### 4.3 Por que Hetzner Europa está fora (apesar dos 20 TB)

O SFU **dobra o caminho da mídia**: transmissor (BR) → SFU → espectador (BR). Se o SFU
está na Alemanha, cada quadro cruza o Atlântico **duas vezes**.

O melhor cabo BR↔Europa (EllaLink) entrega **menos de 60 ms de RTT entre Portugal e
Brasil** ([digital-strategy.ec.europa.eu — EllaLink](https://digital-strategy.ec.europa.eu/en/library/ellalink-connectivity-between-europe-and-latin-america)),
mas o caminho real São Paulo↔Falkenstein passa dos 180 ms RTT na prática
**[não verificado por medição]**. Isso adiciona ~**180–200 ms só de rede** ao
glass-to-glass, contra o orçamento de 200 ms do briefing. **Reprovado.**

Hetzner US (~115–130 ms RTT) adiciona ~120 ms — come mais da metade do orçamento. Aceitável
só como último recurso.

**Um SFU em São Paulo adiciona ~20–50 ms** ao caminho direto. É o único arranjo que preserva
a sensação de "jogar junto".

### 4.4 O susto AWS/GCP/Azure

AWS cobra **US$ 0,09/GB** nas primeiras 10 TB (100 GB/mês grátis), **mas a região
São Paulo é a mais cara do mundo: US$ 0,15/GB**
([egresscost.com/aws/data-transfer-pricing](https://egresscost.com/aws/data-transfer-pricing/),
[leanopstech.com/blog/aws-data-transfer-pricing-2026](https://leanopstech.com/blog/aws-data-transfer-pricing-2026/)).

**Custo por HORA de transmissão (só egress, sem contar a EC2):**

| Provedor / região | US$/GB | 21,6 GB/hora | 10 h/mês | 13 h/mês | 40 h/mês |
|---|---|---|---|---|---|
| **AWS São Paulo** | **0,15** | **US$ 3,24/h** | **US$ 17,40** | **US$ 27,12** | **US$ 114,60** |
| AWS us-east-1 | 0,09 | US$ 1,94/h | US$ 10,44 | US$ 16,27 | US$ 68,76 |
| Azure | ~0,087 | US$ 1,88/h | ~US$ 10,10 | ~US$ 15,73 | ~US$ 66,45 |
| GCP | ~0,085–0,12 | US$ 1,84–2,59/h | ~US$ 10–14 | ~US$ 15–22 | ~US$ 65–92 |
| **Cloudflare Realtime SFU** | **0,05** (1 TB grátis) | US$ 1,08/h | **US$ 0,00** | **US$ 0,00** | **US$ 0,00** |
| **Oracle Always Free** | **0,00** (10 TB grátis) | US$ 0,00 | **US$ 0,00** | **US$ 0,00** | **US$ 0,00** |
| **OVH VPS BR** | ilimitado | — | US$ 6,50 | US$ 6,50 | US$ 6,50 |

Em reais, AWS São Paulo a 40 h/mês: **≈ R$ 619/mês** para cinco amigos assistirem tela um
do outro. Isso é 250× o "de graça ou quase" do briefing. **AWS/GCP/Azure estão descartados
por definição.** (Os 100 GB/mês grátis da AWS somem em **4,6 horas**.)

### 4.5 Ranking final de hospedagem

| # | Opção | US$/mês (10 h) | Latência BR | Esforço | Risco |
|---|---|---|---|---|---|
| 1 | **Cloudflare Realtime SFU** (gerenciado) | **0,00** | **melhor** (anycast, PoPs no BR) | **baixo** (API HTTP) | conta Cloudflare; surcharge BR não verificado |
| 2 | **OVHcloud VPS Brasil** | **6,50** | ótima | médio (você opera) | preço da região não confirmado |
| 3 | **Oracle Always Free GRU** | **0,00** | ótima | médio-alto | **reclaim por ociosidade + capacidade A1 + franquia cortada em 2026** |
| 4 | **Daily.co free** (gerenciado) | **0,00** | boa | **muito baixo** (SDK) | limites de 1080p60 em screen share **[não verificado]** |
| 5 | **Magalu Cloud** | ~3,70 (banda) + VM | **excelente** (BR) | médio | provedor novo |
| 6 | **Vultr São Paulo** | ~5,50 | ótima se BR | médio | presença BR não confirmada |
| 7 | **Fly.io GRU** | 4,32–25,92 | ótima | médio | preço de egress GRU não confirmado |
| 8 | **Contabo / Hetzner US** | ~4–5 | ruim (~120 ms) | médio | latência come metade do orçamento |
| 9 | Hetzner EU | ~5 | **inviável** (~200 ms) | médio | ❌ |
| 10 | LiveKit Cloud | ~20–70 | boa | baixo | caro |
| 11 | AWS/GCP/Azure | 10–115 | ótima (GRU) | alto | ❌ custo |

---

## 5. A opção sem nuvem: um amigo hospeda o SFU

### 5.1 A conta de banda muda de dono — e isso é o ponto

Hoje o **transmissor** (o cara que está jogando) paga 12 Mbps × N de upload. Com um SFU
doméstico, o transmissor sobe **12 Mbps fixos** e quem paga os 48 Mbps de saída é **a casa
do amigo que não está jogando**. Separar "quem joga" de "quem serve" é o ganho estrutural.

### 5.2 O upload brasileiro melhorou — e isso viabiliza a ideia

| Operadora / plano | Download | **Upload** | Cabe 48 Mbps? |
|---|---|---|---|
| Claro Fibra 350 Mega | 350 | **150 Mbps** | ✅ sobra 3× |
| Claro Fibra 600 Mega | 600 | **250 Mbps** | ✅ sobra 5× |
| Claro Fibra 1 Giga | 1000 | **500 Mbps** | ✅ |
| Vivo Fibra 600 Mbps | 600 | **300 Mbps** | ✅ |
| Vivo Fibra 1 Giga | 1000 | **500 Mbps** | ✅ |
| Vivo Fibra 2,5 Gbps | 2500 | **2500 Mbps (simétrico)** | ✅ |

Fontes: [claro.com.br/internet/banda-larga/fibra-otica](https://www.claro.com.br/internet/banda-larga/fibra-otica),
[vivo.com.br — internet residencial](https://vivo.com.br/para-voce/produtos-e-servicos/para-casa/internet),
[minhaconexao.com.br — Vivo Fibra ou Claro Fibra](https://www.minhaconexao.com.br/planos/internet-banda-larga/vivo-fibra-ou-claro-fibra).
Os valores exatos de upload por plano vieram de comparativos secundários (melhorplano.net,
cidadeinternet.com.br) e **não foram conferidos nas páginas oficiais das operadoras**
**[parcialmente não verificado]** — a conclusão ("há planos brasileiros comuns com
150–500 Mbps de upload") é robusta mesmo com margem nos números.

**Conclusão: banda não é mais o obstáculo.** Num grupo de 5 amigos, é bem provável que
pelo menos um tenha 150+ Mbps de upload.

### 5.3 O obstáculo real: alcançabilidade (e é o mesmo muro da Frente 3)

O SFU precisa de uma **porta UDP publicamente alcançável**. E:

> "CGNAT (…) putting you behind a second layer of NAT at the ISP level (…) **port
> forwarding cannot work in that situation, no matter how you configure your router.**"
> — [stackademic.com — CGNAT for self-hosters](https://stackademic.com/blog/cgnat-for-self-hosters-how-to-know-port-forwarding-is-not-your-problem)

Detecção: WAN do roteador em `100.64.0.0/10`. E o escape usual não serve:

> "The free tier of Cloudflare Tunnel covers HTTP/HTTPS (…) **non-HTTP traffic (raw TCP,
> UDP) requires the paid tier or is not supported at all.**"
> — [oneuptime.com/blog/post/2026-03-20-cgnat-workaround-port-forwarding](https://oneuptime.com/blog/post/2026-03-20-cgnat-workaround-port-forwarding/view)

Ou seja: **a opção "amigo hospeda" só funciona se esse amigo tiver IPv4 público real
(ou IPv6 fim-a-fim funcionando para todos)** — exatamente a condição que a Frente 3 está
investigando e que Vivo/Claro/Oi/Tim frequentemente não dão.

### 5.4 Vale a pena?

| | Amigo hospeda | Cloudflare SFU |
|---|---|---|
| Custo | R$ 0 | R$ 0 (até 46 h/mês) |
| Latência | **melhor possível** (intra-BR, mesma cidade às vezes) | ótima |
| Privacidade | **só um amigo vê** (socialmente aceitável) | empresa americana no meio |
| Alcançabilidade | **depende de IPv4 público / sem CGNAT** ❌ | sempre funciona |
| Atrito p/ leigo | precisa configurar port-forward | zero |
| Disponibilidade | só quando aquele amigo está online | 24/7 |
| Conta em serviço | nenhuma | uma (Cloudflare) |

**Veredito:** é um **plano B excelente e um plano A ruim**. Implemente como *opção*
("hospedar a sala neste PC"), com detecção automática de alcançabilidade e queda para o
SFU na nuvem quando o port-forward falhar. O ganho de ter **mediasoup como módulo npm** é
justamente esse: o mesmo binário do GoLive vira o SFU, sem instalar nada.

---

## 6. Ganho colateral do SFU (o que se ganha além da banda)

### 6.1 Upload do transmissor: fixo, independente da plateia

| Espectadores | **Hoje** (árvore/malha) | **Com SFU** | Redução |
|---|---|---|---|
| 1 | 12 Mbps ↑ | 12 Mbps ↑ | 0% |
| 2 | 24 Mbps ↑ | 12 Mbps ↑ | 50% |
| 3 | 36 Mbps ↑ (o teto atual) | 12 Mbps ↑ | **67%** |
| 4 | 48 Mbps ↑ | 12 Mbps ↑ | **75%** |
| 5 | 60 Mbps ↑ (inviável) | 12 Mbps ↑ | **80%** |
| 10 | 120 Mbps ↑ (impossível) | **12 Mbps ↑** | **90%** |

**O teto de ~4 pessoas deixa de existir.** Com SFU, o custo marginal do 5º, 8º ou 15º
espectador para o transmissor é **zero**.

### 6.2 Encode-once: quantos NVENC a menos

Hoje, cada espectador extra custa um encoder na origem. O limite de sessões NVENC
simultâneas em GeForce é **8**, desde o Game Ready Driver **551.23 (24/01/2024)** —
antes eram 5 (mar/2023), 3 (abr/2020) e 2 originalmente
([videocardz.com](https://videocardz.com/newz/nvdia-geforce-gpus-now-support-up-to-8-concurrent-nvenc-encoding-sessions),
[tomshardware.com](https://www.tomshardware.com/news/nvidia-increases-concurrent-nvenc-sessions-on-consumer-gpus)).

O problema **não é o teto de 8** — é que o jogo também usa a GPU, e o ShadowPlay/Instant
Replay consome uma sessão. Cada encode 1080p60 adicional rouba tempo de GPU do jogo.

| | Hoje, 4 espectadores | Com SFU |
|---|---|---|
| Sessões NVENC do GoLive | **4** | **1** |
| Sessões NVENC c/ simulcast (2 camadas) | 4 | **2** |
| Upload | 48 Mbps | 12 Mbps (15–18 com simulcast) |
| Degradação da escada de qualidade por tamanho de sala | sim | **não é mais necessária por tamanho** |

**Ressalva do simulcast em H.264:** simulcast H.264 existe no Chrome
([PSA: H264 simulcast available in Chrome](https://groups.google.com/g/discuss-webrtc/c/_lxG4Yg1A2U)),
mas **camadas temporais só valem para VP8, não para H.264**
([webrtchacks.com/sfu-simulcast](https://webrtchacks.com/sfu-simulcast/)). Ou seja:
simulcast em H.264 custa 2–3 *encodes completos*, não é grátis. Ainda assim, 2–3 encodes
fixos batem 4–10 encodes variáveis. Alternativa mais barata: **1 camada só** e deixar o
SFU encaminhar tudo — funciona bem quando todos os espectadores têm download parecido,
que é o caso de um grupo de amigos.

### 6.3 A sala não morre quando o host sai

Hoje: quem criou a sala hospeda a sinalização; se cair, tudo cai (há sucessão, "frágil"
pelo briefing). Com SFU na nuvem, a sala é um recurso do servidor: o transmissor pode
trocar, cair e voltar. **A dor 4 do briefing evapora.**

### 6.4 Entrada tardia e gravação

- **Entrada tardia:** hoje, um amigo que chega no meio força uma nova conexão P2P e mais
  um encoder na origem. Com SFU, ele só faz `pull` da track já existente. O SFU pede um
  keyframe ao transmissor (PLI) e pronto.
- **Gravação:** o SFU já tem os pacotes; gravar é escrever num arquivo. LiveKit tem egress
  nativo; Cloudflare RealtimeKit cobra **US$ 0,010/min** para gravação/RTMP/HLS
  ([cloudflare.com/products/realtime](https://www.cloudflare.com/products/realtime/)).
  Impossível hoje sem um encoder a mais.

### 6.5 O ganho que quase ninguém conta: **o SFU mata a VPN e o TURN**

Este é o argumento mais forte e ele não está na pergunta original.

Hoje a arquitetura é: **Radmin VPN** (para dar IP roteável) + **STUN do Google** +
**árvore caseira** + **sem TURN**. Quando o Radmin cai para relay, a banda despenca
(dor 1). Quando é CGNAT + NAT simétrico (a regra no Brasil), não há P2P.

Um SFU com IP público **é, por construção, um relay de mídia**. Cada cliente faz uma
conexão **de saída** para ele — que é exatamente o que atravessa CGNAT e NAT simétrico
sem esforço. Resultado:

- ❌ **Radmin VPN: desnecessário** → morre a dor 3 (instalação de app de terceiros)
- ❌ **TURN: desnecessário** → o SFU já é o relay
- ❌ **Árvore de retransmissão: desnecessária** → morre a dor 5
- ❌ **Porta 9000-9010 no firewall: desnecessária** para mídia
- ✅ **Dor 1 e 2 resolvidas**

**Uma única mudança elimina quatro das cinco dores do briefing.** O SFU não é "mais uma
peça" — é a peça que remove três outras.

---

## 7. O contra-argumento: "sem ninguém no meio"

### 7.1 Por padrão, o SFU vê tudo

WebRTC criptografa com DTLS-SRTP **salto a salto**. O SFU termina o DTLS, descriptografa o
SRTP, reescreve cabeçalhos e re-criptografa para cada espectador
([real-time-media-architecture.com](https://www.real-time-media-architecture.com/media-server-architecture/selective-forwarding-unit-design/)).
**Sim: por padrão, o operador do SFU pode ver a tela transmitida.** A promessa do projeto
é quebrada — seja o operador a Cloudflare, a Oracle, ou o amigo que hospeda.

### 7.2 Existe E2EE com SFU — e funciona

**Sim.** O mecanismo é **WebRTC Encoded Transform** (antigo *Insertable Streams*):
a aplicação criptografa o **frame já codificado** antes de entregá-lo ao SRTP. O SFU
recebe um payload opaco e só enxerga os cabeçalhos RTP de que precisa para rotear.

> "WebRTC Encoded Transforms provide a mechanism to inject a high performance Stream API
> for modifying encoded video and audio frames into the incoming and outgoing WebRTC
> pipelines, **enabling end-to-end encryption of encoded frames by third-party code**."
> — [w3c/webrtc-encoded-transform explainer](https://github.com/w3c/webrtc-encoded-transform/blob/main/explainer.md),
> [MDN — Using WebRTC Encoded Transforms](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_Encoded_Transforms)

> "WebRTC Insertable Streams can solve the problem of end-to-end encryption for middlebox
> devices outside of the user's control like **Selective Forwarding Units (SFUs)**."
> — [webrtchacks.com — True End-to-End Encryption with WebRTC Insertable Streams](https://webrtchacks.com/true-end-to-end-encryption-with-webrtc-insertable-streams/)

### 7.3 Suporte no Chromium/Electron

- **Chrome: suportado.** Insertable Streams está implementado no Chrome
  ([Chrome Platform Status — WebRTC Insertable Streams](https://chromestatuslite.com/feature/6321945865879552)).
  Firefox implementou `RTCRtpScriptTransform`
  ([Bugzilla 1631263](https://bugzilla.mozilla.org/show_bug.cgi?id=1631263)). **Safari: não.**
- **Electron = Chromium**, então herda o suporte. **[não verificado em Electron
  especificamente, mas é a mesma engine — inferência forte]**
- Safari não importar é irrelevante: o GoLive é Electron/Windows.
- Existe ainda a API `SFrameTransform` nativa no spec, mas "a bit less mature"
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_Encoded_Transforms)).

### 7.4 Prova de que dá para fazer: Cloudflare Orange Meets

A Cloudflare **abriu o código** do Orange Meets com E2EE sobre o próprio Realtime SFU,
usando **MLS (Messaging Layer Security)** com *continuous group key agreement*, e um
**"Designated Committer Algorithm"** para entrada/saída dinâmica de participantes,
**formalmente verificado em TLA+**. A criptografia é **inteiramente client-side** — a
Cloudflare e o SFU são apenas encaminhadores sem acesso ao conteúdo. Anunciado em
**junho/julho de 2025**.

Fontes: [blog.cloudflare.com/orange-me2eets-we-made-an-end-to-end-encrypted-video-calling-app-and-it-was/](https://blog.cloudflare.com/orange-me2eets-we-made-an-end-to-end-encrypted-video-calling-app-and-it-was/),
[bleepingcomputer.com](https://www.bleepingcomputer.com/news/security/cloudflare-open-sources-orange-meets-with-end-to-end-encryption/),
[github.com/cloudflareresearch/orange-e2ee-model-check](https://github.com/cloudflareresearch/orange-e2ee-model-check).

**Ou seja: existe uma implementação de referência, aberta, do exato arranjo que o GoLive
precisaria — E2EE client-side sobre um SFU gerenciado gratuito.**

### 7.5 As letras miúdas do E2EE

1. **O W3C desaconselha formalmente, por ora:** "it is **not recommended** for this use
   case until a mechanism that allows browsers to perform end-to-end encryption without
   exposing keys to JavaScript becomes available"
   ([explainer](https://github.com/w3c/webrtc-encoded-transform/blob/main/explainer.md)).
   Num app Electron que você mesmo distribui, o risco de "chave exposta ao JS" é bem menor
   que num site — o JS é o seu.
2. **Metadados continuam visíveis:** quem fala com quem, quando, por quanto tempo, a que
   bitrate, tamanho dos frames. E2EE de mídia ≠ anonimato.
3. **Custo de implementação real:** é preciso um acordo de chaves entre os amigos. MLS é
   correto mas pesado; para 5 amigos, uma **chave pré-compartilhada derivada do código da
   sala** (o mesmo que já é trocado hoje) é 20 linhas e resolve 95% da ameaça.
4. **Você perde algumas otimizações do SFU:** ele não pode reparar/transcodificar, e
   seleção de camada só funciona se as camadas forem SSRCs separados (simulcast) — o que
   continua funcionando.
5. **A promessa muda de texto, não de espírito:** de *"sem ninguém no meio"* para
   *"tem um retransmissor no meio, mas ele não consegue ver nada"*. É honesto e é
   defensável — é o mesmo argumento do Signal.

---

## 8. Veredito

### **RECOMENDO adotar um SFU. Foi a decisão errada adiar (STATUS.md H5/H6).**

Justificativa, em ordem de força:

1. **É gratuito de verdade.** Cloudflare Realtime SFU: **US$ 0,05/GB com 1.000 GB/mês
   grátis**. O cenário real (216 GB) usa **21,6%** da franquia. Cabem **46 horas de
   transmissão por mês** sem pagar nada. Oracle Always Free dá **10 TB** (463 horas), mas
   com riscos operacionais reais.
2. **Resolve 4 das 5 dores do briefing de uma vez.** Upload do transmissor cai de
   48 Mbps para **12 Mbps fixos** (dor 2); o teto de 4 pessoas desaparece (dor 5); o SFU
   é um relay com IP público, então **o Radmin VPN deixa de ser necessário** (dores 1 e 3);
   a sala deixa de morrer com o host (dor 4).
3. **O custo de engenharia é menor do que parece.** `npm i mediasoup` para auto-hospedar,
   ou uma API HTTP de push/pull para o Cloudflare, reaproveitando **a sinalização `ws` que
   já existe**. Não é reescrever o app — é trocar o transporte de mídia.
4. **A promessa de privacidade é recuperável.** E2EE por Encoded Transform funciona no
   Chromium, tem implementação de referência aberta (Orange Meets/MLS) e roda client-side
   sobre qualquer SFU.

### Plano recomendado, em três degraus

| Degrau | O quê | Custo | Prazo |
|---|---|---|---|
| **1. Spike** | Provar `pushTrack`/`pullTrack` no **Cloudflare Realtime SFU** com uma track H.264 de 12 Mbps saindo do Electron. Medir glass-to-glass. Testar se mediasoup instala no Windows sem toolchain | US$ 0 | dias |
| **2. Produção** | Cloudflare SFU como caminho padrão + **P2P direto preservado quando a sala tem 2 pessoas** (melhor latência, zero custo, zero terceiro) | US$ 0 até 46 h/mês | — |
| **3. Privacidade** | E2EE por Encoded Transform com chave derivada do código da sala. Depois, opcionalmente, "hospedar neste PC" (mediasoup embutido) para quem tem IPv4 público | US$ 0 | — |

### Não recomendo

- ❌ **LiveKit Cloud** — 50 GB = 2h18 de uso. Free tier inútil para 12 Mbps. (LiveKit
  **auto-hospedado** é ótimo, é outra conversa.)
- ❌ **AWS / GCP / Azure** — US$ 3,24/hora de transmissão em São Paulo. 40 h/mês = R$ 619.
- ❌ **Hetzner Europa** — 20 TB lindos, ~200 ms de latência. Estoura o orçamento do briefing.
- ❌ **Millicast/Dolby, 100ms, Whereby** — sem free tier útil.
- ❌ **Owncast/SRT/HLS** — paradigma de broadcast assíncrono, latência de segundos.

### Depende de verificação (bloqueadores do spike)

1. **Há sobretaxa de egress para tráfego no Brasil no Cloudflare Realtime?** Não confirmei.
   Se houver, a conta muda.
2. **O ingress conta na franquia de 1 TB do Cloudflare?** Se contar, 270 GB em vez de
   216 GB — ainda cabe, mas o teto cai de 46 h para 37 h.
3. **mediasoup no Windows exige Python + MSVC ou baixa binário pronto?** Define se a opção
   "amigo hospeda" tem atrito zero ou atrito alto.
4. **Preço real do OVHcloud VPS Brasil e do egress Fly.io GRU.**
5. **Oracle:** capacidade A1 em `sa-saopaulo-1` e se a política de reclaim por ociosidade
   (<20% de CPU no p95 de 7 dias) é de fato aplicada — nosso perfil de uso a dispara.

### O contra-argumento honesto, em uma frase

Adotar um SFU significa que, pela primeira vez, **existe uma máquina de terceiros no
caminho do vídeo** — e a resposta certa não é fingir que não existe, é **cifrar o frame
antes de entregá-lo a ela** e dizer isso na tela para os usuários.

---

## Anexo — todas as fontes citadas

**SFUs open source**
- https://github.com/versatica/mediasoup — licença ISC
- https://registry.npmjs.org/mediasoup — `3.27.1`, publicado 2026-09-16, `node >=22`, ISC (lido direto)
- https://mediasoup.org/documentation/v3/scalability/ — ~500 consumers/core
- https://mediasoup.discourse.group/t/ballpark-calculation-of-cpu-usage-per-stream/671
- https://github.com/bluenviron/mediamtx — MIT, WebRTC/SRT/RTSP/RTMP/HLS/MoQ
- https://github.com/bluenviron/mediamtx/discussions/3985 — não transcodifica
- https://github.com/bluenviron/mediamtx/discussions/5386 — forwarding WHIP/WHEP
- https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion
- https://bloggeek.me/webrtc-tools/media-servers-oss/
- https://sheerbit.com/self-hosted-livekit-complete-deployment-guide/ — portas e requisitos
- https://jitsi.org/jitsi-videobridge-performance-evaluation/ — 1.000 streams / 550 Mbps / 20% CPU
- https://en.wikipedia.org/wiki/Galene_(software) — release 1.0 em 2025-08-09
- https://www.real-time-media-architecture.com/media-server-architecture/selective-forwarding-unit-design/
- https://adhdecode.com/protocol-deep-dives/webrtc-protocol/webrtc-sfu-selective-forwarding-unit/

**Free tiers gerenciados**
- https://developers.cloudflare.com/realtime/sfu/pricing — US$ 0,05/GB, 1.000 GB grátis
- https://developers.cloudflare.com/realtime/turn/faq/ — franquia compartilhada, sem cobrança dupla
- https://developers.cloudflare.com/realtime/sfu/limits/ — 64 tracks por chamada, sem teto de tracks
- https://developers.cloudflare.com/realtime/realtimekit/recording-guide/configure-codecs/ — H264/H265/VP8/VP9/AV1
- https://www.cloudflare.com/products/realtime/ — RealtimeKit US$ 0,002/participant-min, beta grátis
- https://blog.cloudflare.com/introducing-cloudflare-realtime-and-realtimekit/ — aquisição da Dyte (18/04/2025)
- https://www.cipher.co.th/en/blogs/cloudflare-realtime-media-services/ — consolidação 2026
- https://livekit.com/pricing — Build: 5.000 min, 50 GB, 100 participantes, US$ 0
- https://livekit.com/blog/towards-a-future-aligned-pricing-model — US$ 0,12/GB, upstream grátis
- https://www.daily.co/pricing/video-sdk/ — 10.000 participant-min grátis, US$ 0,004/min
- https://docs.agora.io/en/video-calling/overview/pricing — 10.000 min, US$ 3,99/1k HD
- https://getstream.io/video/pricing/ — US$ 100/mês de crédito
- https://whereby.com/information/embedded/pricing — US$ 6,99 com 2.000 min
- https://www.spotsaas.com/product/100ms-video-sdk/pricing — sem free tier público
- https://www.twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product — EOL revertido
- https://help.twilio.com/articles/24158233644443 — extensão do EOL
- https://bloggeek.me/twilio-programmable-video-back/
- https://techcrunch.com/2022/02/03/dolby-acquires-low-latency-streaming-platform-millicast

**Hospedagem**
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm — 10 TB egress, reclaim <20% CPU p95/7d
- https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/ — corte de 4→2 OCPU em 15/06/2026
- https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/
- https://terminalbytes.com/oracle-cloud-free-tier-changes-2026/
- https://community.oracle.com/customerconnect/discussion/949983/ — out of capacity em sa-saopaulo-1 (23/03/2026)
- https://docs.cloud.oracle.com/iaas/releasenotes/changes/43a4df66-4557-469b-95f9-60cd4bf496a6/ — região GRU
- https://www.oracle.com/cloud/free/faq/ — regras de cartão
- https://www.ovhcloud.com/en/vps/vps-brasil/ — tráfego ilimitado, até 3 Gbps, DC São Paulo
- https://magalu.cloud/precos/network/ — R$ 0,10/GiB de saída
- https://www.locaweb.com.br/locaweb-cloud/ — egress sem custo adicional [não verificado na origem]
- https://docs.vultr.com/support/platform/billing/what-is-the-bandwidth-overage-rate — US$ 0,01/GB
- https://blogs.vultr.com/Vultr-Announces-Reduced-Bandwidth-Pricing-2-Tb-Of-Free-Monthly-Egress-Free-Ingress-And-Global-Pooling — 2 TB grátis
- https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/ — 20 TB EU / 1 TB US, €1,00/TB
- https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ — ajuste de 15/06/2026
- https://contabo.com/en/vps-b/ — 32 TB, €3,60–4,50, sem DC no Brasil
- https://fly.io/docs/about/pricing/ — US$ 0,02/GB NA/EU, até US$ 0,12/GB em outras regiões
- https://egresscost.com/aws/data-transfer-pricing/ — US$ 0,09/GB, 100 GB grátis
- https://leanopstech.com/blog/aws-data-transfer-pricing-2026/ — São Paulo US$ 0,15/GB
- https://digital-strategy.ec.europa.eu/en/library/ellalink-connectivity-between-europe-and-latin-america — <60 ms RTT PT↔BR

**Rede doméstica / CGNAT**
- https://stackademic.com/blog/cgnat-for-self-hosters-how-to-know-port-forwarding-is-not-your-problem
- https://oneuptime.com/blog/post/2026-03-20-cgnat-workaround-port-forwarding/view — Cloudflare Tunnel free não faz UDP
- https://www.claro.com.br/internet/banda-larga/fibra-otica — uploads 150–500 Mbps
- https://www.minhaconexao.com.br/planos/internet-banda-larga/vivo-fibra-ou-claro-fibra

**Codecs / E2EE**
- https://groups.google.com/g/discuss-webrtc/c/_lxG4Yg1A2U — simulcast H.264 no Chrome
- https://webrtchacks.com/sfu-simulcast/ — camadas temporais só em VP8
- https://videocardz.com/newz/nvdia-geforce-gpus-now-support-up-to-8-concurrent-nvenc-encoding-sessions — 8 sessões, driver 551.23 (24/01/2024)
- https://www.tomshardware.com/news/nvidia-increases-concurrent-nvenc-sessions-on-consumer-gpus
- https://github.com/w3c/webrtc-encoded-transform/blob/main/explainer.md
- https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_Encoded_Transforms
- https://webrtchacks.com/true-end-to-end-encryption-with-webrtc-insertable-streams/
- https://chromestatuslite.com/feature/6321945865879552 — Insertable Streams no Chrome
- https://bugzilla.mozilla.org/show_bug.cgi?id=1631263 — RTCRtpScriptTransform no Firefox
- https://blog.cloudflare.com/orange-me2eets-we-made-an-end-to-end-encrypted-video-calling-app-and-it-was/
- https://www.bleepingcomputer.com/news/security/cloudflare-open-sources-orange-meets-with-end-to-end-encryption/
- https://github.com/cloudflareresearch/orange-e2ee-model-check — verificação TLA+ do Designated Committer
