# FRENTE 2 — Túneis de exposição (ngrok e similares) para 1080p60 ao vivo

Pesquisa: 2026-09-16 · Projeto: GoLive LAN v0.16.0

> **Nota de método (importante para calibrar a confiança).** O ambiente desta
> pesquisa tem uma política de egresso que bloqueou o acesso direto a
> `ngrok.com`, `developers.cloudflare.com`, `blog.cloudflare.com`, `playit.gg`,
> `tailscale.com`, `pinggy.io` e praticamente todo domínio fora do GitHub.
> Consegui buscar na web (os resultados de busca trazem trechos indexados das
> páginas oficiais, e é deles que vêm os números), e consegui ler diretamente
> apenas conteúdo hospedado no GitHub (READMEs de frp, rathole, chisel, bore,
> awesome-tunneling). Onde o número vem do índice de busca e não da página
> oficial lida por mim, marquei **[via índice de busca]**. Onde não confirmei
> nada, marquei **[não verificado]**. Nada aqui é de memória.

---

## 1. Veredito sobre ngrok para a MÍDIA

### NÃO. E não é uma questão de grau — são três paredes independentes, cada uma sozinha suficiente para matar a ideia.

O usuário levantou uma hipótese razoável: "se o problema é NAT/CGNAT e firewall,
um túnel resolve NAT/CGNAT e firewall". Isso está **correto**. O erro não está no
raciocínio, está no fato de que ngrok resolve o problema *de conectividade* de um
jeito que destrói o problema *de mídia*.

### Parede 1 — ngrok não fala UDP. WebRTC fala UDP.

ngrok suporta HTTP, HTTPS e TCP. Não suporta UDP, e isso não é um detalhe de
roadmap: é a posição do produto desde sempre. O pedido de UDP é a issue #26 do
repositório original, aberta em **setembro de 2013**, e o repositório foi
arquivado em **3 de junho de 2024** sem que UDP fosse entregue
([github.com/inconshreveable/ngrok/issues/26](https://github.com/inconshreveable/ngrok/issues/26), lido diretamente).
Em 2026 a situação continua a mesma: "ngrok still has zero native UDP support.
It only handles HTTP, HTTPS, and TCP"
([localxpose.io/blog/ngrok-udp-alternative](https://localxpose.io/blog/ngrok-udp-alternative) — vendor concorrente, mas consistente com a doc oficial) [via índice de busca].

Consequência concreta para o GoLive: o transporte de mídia do WebRTC é
SRTP sobre UDP. Forçar isso por um túnel TCP significa:

- **Head-of-line blocking.** Se o pacote #100 se perde, o stack TCP segura #101,
  #102, #103 no buffer até a retransmissão chegar. Com RTT de 100 ms, **uma
  única perda injeta no mínimo 100 ms de atraso**, e sob congestionamento o
  backoff de retransmissão do TCP estica isso para segundos
  ([getstream.io/blog/webrtc-websocket-av-sync](https://getstream.io/blog/webrtc-websocket-av-sync/)) [via índice de busca].
- **Latência em dente de serra.** O sistema "drifts in and out of sync, or pauses
  entirely to rebuffer, destroying the illusion of real-time interaction"
  (mesma fonte). Isso é exatamente o oposto do requisito do briefing
  (< ~200 ms glass-to-glass, para jogar junto).
- **Travamento em vez de glitch.** Sobre UDP, uma perda vira um artefato de
  meio segundo que ninguém nota. Sobre TCP, vira congelamento. A literatura de
  WebRTC descreve o fallback TCP/TURN assim: "Latency is higher, and TCP's
  behavior under packet loss translates to occasional stuttering rather than
  brief glitches" (mesma fonte).
- **Bufferbloat.** A 12 Mbps, um buffer de túnel de poucos MB já é 1–2 segundos
  de vídeo enfileirado. O congestion control do WebRTC (GCC/transport-cc) não
  enxerga o que está acontecendo dentro do túnel TCP — ele mede o túnel, não a
  rede — então a escada de qualidade do GoLive passaria a reagir a um sinal
  errado. **[não verificado empiricamente — é inferência a partir do
  comportamento conhecido de TCP-over-TCP, não medi]**

Em resumo: o GoLive teria de reconfigurar o ICE para só oferecer candidatos
TCP e apontá-los ao endpoint ngrok. Funciona? Provavelmente conecta. Entrega
1080p60 fluido? Não, por construção.

### Parede 2 — a franquia grátis acaba em minutos, não em horas.

ngrok apertou drasticamente o free tier em **início de fevereiro de 2026**
([instatunnel.substack.com](https://instatunnel.substack.com/p/the-great-ngrok-migration-why-developers), [community.developer.atlassian.com/t/.../76707](https://community.developer.atlassian.com/t/ngrok-is-restricted-to-1gb-per-month-any-alternative-for-ngrok/76707)) [via índice de busca].
Limites atuais do plano Free, segundo a doc oficial
([ngrok.com/docs/pricing-limits/free-plan-limits](https://ngrok.com/docs/pricing-limits/free-plan-limits)) [via índice de busca — não consegui abrir a página]:

| Item | Free |
|---|---|
| **Banda / data transfer** | **1 GB/mês** |
| Requisições HTTP | 20.000/mês |
| Endpoints simultâneos | 3 |
| Domínio | 1 dev domain estático (`*.ngrok-free.dev`), endpoints aleatórios por padrão |
| Sessão do agente | **2 h** (encerra e a URL muda) |
| Endpoint TCP | Existe no Free, **mas exige verificação da conta com cartão de crédito** |
| Endpoint TLS | Só no Pay-as-you-go |
| Taxa de conexão | ~40 conexões/minuto [via índice de busca, fonte secundária — [não verificado] na doc] |
| Página interstitial | Sim, mostrada a todos os visitantes |

Fonte dos preços pagos: Hobbyist US$ 10/mês (US$ 8 anual) com 5 GB;
Pay-as-you-go US$ 20/mês de base com overage a **US$ 0,10/GB**
([ngrok.com/pricing](https://ngrok.com/pricing), [vendr.com/marketplace/ngrok](https://www.vendr.com/marketplace/ngrok)) [via índice de busca].
Detalhe relevante: no Hobbyist, estourar os 5 GB **não** gera cobrança — os
endpoints simplesmente param de servir tráfego até o ciclo virar.

Aritmética (seção 4 abaixo faz a conta completa): **1 GB a 12 Mbps são 11
minutos e 22 segundos de um único fluxo.** Com 3 espectadores, **3 minutos e
47 segundos.** O free tier do ngrok não dura uma partida de Valorant.

### Parede 3 — o limite de 2 h da sessão derruba a transmissão no meio.

Mesmo comprando banda, a sessão do agente free termina em 2 h e gera nova URL.
Uma noite de jogo entre amigos é rotineiramente mais longa que isso.

### O que NÃO é problema no ngrok (para ser justo com a ideia)

- **Latência de PoP no Brasil: ngrok tem São Paulo.** Os data planes regionais
  ficam em Austrália (Sydney), Europa (Frankfurt), Índia (Mumbai), Japão
  (Tóquio), **América do Sul (São Paulo)** e EUA (Califórnia e Ohio); o código
  interno da região é `sa`
  ([ngrok.com/docs/gateway/points-of-presence](https://ngrok.com/docs/gateway/points-of-presence)) [via índice de busca].
  Um usuário em Berlim medindo contra o PoP `eu-fra-1` vê ~10 ms
  ([ngrok.com/blog/gslb-global-server-load-balancing](https://ngrok.com/blog/gslb-global-server-load-balancing)) [via índice de busca].
  Então o *desvio geográfico* não é a objeção — São Paulo–São Paulo adiciona
  talvez 10–30 ms **[não verificado para o Brasil especificamente]**. A objeção
  é o transporte TCP e a franquia.
- **Os ToS do ngrok NÃO proíbem streaming explicitamente.** Procurei e não
  encontrei cláusula de "excessive bandwidth" ou "streaming" nos Termos
  ([ngrok.com/tos](https://ngrok.com/tos)). O que existe é uma política de abuso
  focada em phishing, malware e túneis não autorizados
  ([ngrok.com/abuse](https://ngrok.com/abuse)) [via índice de busca].
  **Ou seja: no ngrok o freio é a cota (1 GB), não o contrato.** Isso é uma
  correção importante ao que eu esperaria encontrar — ngrok não te expulsa por
  fazer streaming; ele simplesmente te cobra ou te corta em 1 GB.

### Ponto de dados sobre throughput (vale ceticismo)

Um benchmark citado em blog de concorrente coloca o throughput do ngrok em
**0,84 MB/s (≈ 6,7 Mbps)** contra 3,47 MB/s do Cloudflare Tunnel
([localxpose.io/blog/best-ngrok-alternatives](https://localxpose.io/blog/best-ngrok-alternatives)) [via índice de busca].
**Trate com desconfiança**: é vendor concorrente, sem metodologia publicada que
eu tenha conseguido ler. Mas se for sequer da ordem certa, 6,7 Mbps já está
abaixo dos 12 Mbps de um único fluxo 1080p60 do GoLive.

---

## 2. Tabela comparativa de túneis

Legenda: **UDP** = suporta tunelamento UDP nativo (não "UDP encapsulado em TCP",
que reintroduz head-of-line blocking).

| Serviço | UDP nativo? | Free tier — banda | Outros limites free | PoP Brasil? | Hospedado/self-host | Serve para mídia do GoLive? |
|---|---|---|---|---|---|---|
| **ngrok** | **Não** (HTTP/HTTPS/TCP) | **1 GB/mês** | 3 endpoints, 20k req/mês, sessão 2 h, URL aleatória, interstitial, TCP exige cartão | **Sim** (São Paulo, região `sa`) | Hospedado | **Não** |
| **Cloudflare Tunnel** | **Não em endpoint público** (UDP só no modo Zero Trust privado, exigindo WARP em todos os clientes) | Sem cobrança por GB / sem cota de túneis divulgada | Precisa de domínio na Cloudflare para túnel nomeado | Sim (12+ cidades no BR) | Hospedado | **Não** (para mídia) |
| **trycloudflare / quick tunnel** | Não | idem | **Sem SLA nem garantia de uptime, "debug aid, not production"**; URL efêmera; sem conta | Sim | Hospedado | **Não** |
| **playit.gg** | **Sim** (feito para jogos) | Sem número público que eu tenha confirmado; relatos de throttling sob tráfego pesado | 4 portas no free (16 no Premium, US$ 3/mês); free usa Anycast global, **região não é escolhível** — regional tunnels são pagos | Tem PoP South America (`ping.sa.ply.gg`) | Hospedado (agente open source, servidor não) | **Talvez** — o único da lista tecnicamente plausível; ver §2b |
| **Pinggy** | **Sim** (HTTP/TCP/UDP/TLS no free) | **Ilimitada** (declarada) | **Timeout de 60 min por túnel**, 1 túnel concorrente por IP de origem; URL nova a cada reinício | **Sim** (servidores no Brasil; `free.pinggy.io` roteia ao mais próximo) | Hospedado | **Talvez**, com a ressalva dos 60 min; ver §2b |
| **LocalToNet** | **Sim** | **1 GB/mês** | 1 túnel, timeout de 30 min | [não verificado] | Hospedado | Não (1 GB = 11 min) |
| **zrok / OpenZiti** | Não documentado para shares públicos **[não verificado]** | **5 GB/dia** (janela móvel de 24 h) | 25 environments, 50 shares; estourar desabilita os shares em execução | [não verificado] | Ambos | Não (5 GB/dia ≈ 57 min de 1 fluxo) |
| **Tailscale Funnel** | **Não** | **Limites de banda não configuráveis**, não divulgados | **Só portas 443, 8443, 10000**; só TLS; **todo tráfego passa por DERP relay** (nunca P2P) | [não verificado] | Hospedado | **Não** — a própria doc desaconselha alto tráfego |
| **frp** | **Sim** (+ P2P, KCP, QUIC) | n/a — você paga o servidor | Precisa de VPS com IP público | Você escolhe | **Self-hosted** | Tecnicamente sim, **mas exige VPS pago** |
| **rathole** | **Sim** (`type = "udp"`) | n/a | Transportes: TCP, TLS, Noise, WebSocket (sem QUIC) | Você escolhe | **Self-hosted** | idem frp |
| **chisel** | "Sim" desde a v1.7, **mas encapsulado em TCP/HTTP/SSH** | n/a | `CHISEL_UDP_MAX_CONNS` = 100 por túnel | Você escolhe | **Self-hosted** | **Não** — UDP-sobre-TCP tem o mesmo HoL blocking |
| **bore** | **Não** ("a modern, simple TCP tunnel in Rust") | Instância pública `bore.pub`, sem limites publicados | Sem ToS/limites documentados | Não | Ambos | **Não** |
| **localtunnel** | **Não** (só HTTP/HTTPS) | Sem limite publicado | Confiabilidade histórica ruim | Não | Ambos | **Não** |
| **localhost.run** | **Não** (SSH, HTTP/HTTPS) | "unlimited free sessions" | Domínio custom é pago | [não verificado] | Hospedado | **Não** |
| **serveo** | **Não** (HTTP(S) + TCP via SSH) | 3 túneis ativos | **Uptime historicamente instável** | Não | Hospedado | **Não** |
| **Telebit** | [não verificado] | [não verificado] | Projeto com pouca atividade recente **[não verificado]** | [não verificado] | Hospedado | [não verificado] |
| **expose (BeyondCode)** | Não documentado | Exige registro em beyondco.de | — | Não | Ambos | **Não** |

Fontes da tabela: [awesome-tunneling (README lido diretamente do GitHub)](https://raw.githubusercontent.com/anderspitman/awesome-tunneling/master/README.md);
[frp README](https://raw.githubusercontent.com/fatedier/frp/dev/README.md);
[rathole README](https://raw.githubusercontent.com/rapiz1/rathole/main/README.md);
[chisel README](https://raw.githubusercontent.com/jpillora/chisel/master/README.md);
[bore README](https://raw.githubusercontent.com/ekzhang/bore/main/README.md);
[Tailscale Funnel docs](https://tailscale.com/kb/1311/tailscale-funnel) e [tailscale.com/docs/features/tailscale-funnel](https://tailscale.com/docs/features/tailscale-funnel);
[Quick Tunnels (Cloudflare)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/);
[Cloudflare Tunnel private net P2P](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/peer-to-peer/);
[zrok service limits (NetFoundry)](https://netfoundry.io/docs/zrok/myzrok/service-limits/);
[Playit Premium](https://playit.gg/support/playit-premium/) e [How to lower ping on playit](https://playit.gg/support/how-to-lower-ping/);
[Pinggy blog — scaling across multiple regions](https://pinggy.io/blog/scaling_across_multiple_regions/) e [Help and Support](https://pinggy.io/help/).

### 2b. Os dois candidatos que sobrevivem à triagem técnica — e por que ainda não recomendo

**playit.gg** e **Pinggy** são os únicos com UDP nativo + free tier hospedado +
presença sul-americana. Se a ideia de "túnel para mídia" tivesse de ser
testada, seria com um deles. Mas:

- **playit.gg:** no free, o tráfego vai pela rede Anycast global e o datacenter
  de saída **não é escolhível** — regional tunnels são do Premium (US$ 3/mês)
  ([playit.gg/support/how-to-lower-ping](https://playit.gg/support/how-to-lower-ping/)) [via índice de busca].
  Na prática você pode acabar saindo pelos EUA e pagando 120–200 ms de RTT
  extra **[não verificado — não medi]**. Existem relatos de throttling sob
  tráfego pesado e uma discussão específica sobre limites de tráfego aberta em
  28/05/2026 ([discuss.playit.gg/t/traffic-limits/5574](https://discuss.playit.gg/t/traffic-limits/5574)) — **não consegui ler a resposta oficial do thread**.
  E o produto é explicitamente "tunneling for game servers": 36 Mbps sustentados
  de vídeo não é o perfil de carga que eles dimensionaram.
- **Pinggy:** o **timeout de 60 minutos no free** derruba o túnel no meio da
  sessão e gera URL nova ([pinggy.io/help](https://pinggy.io/help/)) [via índice de busca].
  Isso, num app para leigos, é pior que o problema original. O Pro resolve por
  ~US$ 3/mês. A banda declarada é ilimitada, mas **não achei nos ToS
  ([pinggy.io/terms_of_service](https://pinggy.io/terms_of_service/)) nenhuma
  cláusula autorizando ou proibindo uso intensivo de banda** — o que li de
  proibição explícita foi sobre conteúdo adulto. Uma franquia "ilimitada" sem
  cláusula de fair use é um risco, não uma garantia.

E o mais importante: **mesmo que um deles aguente, você trocou P2P por um
intermediário que vê os bytes**. Ver §3.

---

## 3. A questão dos Termos de Serviço

Aqui eu esperava encontrar o argumento matador — "os ToS proíbem streaming, fim
de papo". A realidade é mais nuançada, e é mais honesto dizer isso.

### ngrok

**Não encontrei cláusula proibindo streaming ou uso intensivo de banda** nos
Termos ([ngrok.com/tos](https://ngrok.com/tos)) nem na política de abuso
([ngrok.com/abuse](https://ngrok.com/abuse)), que trata de phishing, malware e
túneis não autorizados. **O controle no ngrok é econômico (cota de 1 GB e
cobrança por GB), não contratual.** Marque como **[não verificado
exaustivamente]** — não consegui abrir a página de ToS integralmente para ler
cada seção.

### Cloudflare — o famoso §2.8

O texto histórico da Seção 2.8 era:

> "Use of the Service for serving video (unless purchased separately as a Paid
> Service) or a disproportionate percentage of pictures, audio files, or other
> non-HTML content, is prohibited."

Em **maio de 2023** a Cloudflare reescreveu os termos e **removeu o §2.8** do
acordo self-serve, movendo a restrição para uma seção específica de CDN nos
Service-Specific Terms ([blog.cloudflare.com/updated-tos](https://blog.cloudflare.com/updated-tos)) [via índice de busca — domínio bloqueado aqui].
A regra nova, em substância: **você pode servir vídeo pelo CDN desde que o
conteúdo esteja hospedado num serviço da Cloudflare (Stream, Images, R2).**

E a doc atual mantém o poder de polícia:

> "If you are on a Free, Pro, or Business Plan and your application appears to
> be serving videos or a disproportionate amount of large files without using
> the appropriate paid service, Cloudflare may redirect your content or take
> other actions to protect quality of service."
> — [developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/) [via índice de busca]

**Leitura para o GoLive:** passar 36 Mbps de vídeo por um Cloudflare Tunnel no
plano gratuito é exatamente o caso que essa cláusula existe para conter. Não é
"ilegal", mas é um convite a ter o túnel redirecionado ou a conta acionada — e
um app entre amigos não tem como absorver esse risco operacional.

**A ironia útil:** a própria Cloudflare oferece o caminho legítimo. Vídeo em
tempo real pela **Cloudflare Realtime** (SFU/TURN) é o serviço pago-correto, e
tem free tier generoso. Ver §6.

### Os "ilimitados"

Pinggy declara banda ilimitada; localhost.run declara sessões ilimitadas. Nos
ToS que consegui indexar **não há cláusula de fair use explícita nem
autorização explícita para streaming contínuo de dezenas de Mbps**. Isso não é
permissão — é ausência de texto. Um provedor que descobre 200 GB/mês de vídeo
vindo de uma conta grátis muda os termos ou corta a conta, e o app dos seus
amigos quebra numa terça-feira. **[não verificado — é avaliação de risco, não
fato documentado]**

---

## 4. A conta de tráfego

### Unidade base

```
12 Mbps = 12.000.000 bits/s ÷ 8 = 1.500.000 bytes/s = 1,5 MB/s
1,5 MB/s × 60      =    90 MB por minuto, por fluxo
1,5 MB/s × 3.600   = 5.400 MB = 5,4 GB por hora, por fluxo   ← confere com o briefing
```

### Sessão de 3 h com 3 espectadores

Se a mídia passasse por um túnel, **todos** os fluxos cruzariam o túnel (a
árvore de retransmissão do GoLive deixa de ajudar: o relay também estaria do
outro lado do túnel).

| Contagem | Cálculo | Total |
|---|---|---|
| Só a saída do túnel (1 sentido) | 3 fluxos × 3 h × 5,4 GB | **48,6 GB** |
| Entrada + saída (como a maioria dos provedores mede) | 48,6 × 2 | **97,2 GB** |

### Cenário mensal do briefing: 5 pessoas, ~10 h/mês, 12 Mbps

1 transmissor + 4 espectadores = 4 fluxos.

| Contagem | Cálculo | Total |
|---|---|---|
| 1 sentido | 4 × 10 h × 5,4 GB | **216 GB/mês** |
| 2 sentidos | | **432 GB/mês** |

### Em quantos MINUTOS o free tier acaba

Consumo: **90 MB/min por fluxo**. Com 3 espectadores: **270 MB/min**.

| Serviço | Franquia free | 1 fluxo (90 MB/min) | 3 espectadores (270 MB/min) |
|---|---|---|---|
| **ngrok Free** | 1 GB/mês | **11 min 22 s** | **3 min 47 s** |
| **LocalToNet Free** | 1 GB/mês | 11 min 22 s | 3 min 47 s |
| **ngrok Hobbyist** (US$ 10/mês) | 5 GB/mês | 56 min 53 s | 18 min 58 s |
| **zrok Free** | 5 GB/**dia** | 56 min 53 s/dia | 18 min 58 s/dia |
| **Cloudflare Realtime** | **1.000 GB/mês** | **189 h 38 min/mês** | **63 h 12 min/mês** |

> Ou seja: **o plano gratuito do ngrok dura menos de 4 minutos de uma
> transmissão real do GoLive.** Não é "apertado", é ordem de grandeza errada —
> falta um fator de ~50x.

### Quanto custaria fazer isso "direito" no ngrok

Cenário de 216 GB/mês (1 sentido), plano Pay-as-you-go
(US$ 20/mês de base + US$ 0,10/GB de overage — [ngrok.com/pricing](https://ngrok.com/pricing) [via índice de busca]):

```
US$ 20,00 (base)  +  216 GB × US$ 0,10  =  US$ 41,60/mês
```

Se a medição for nos dois sentidos (432 GB): **US$ 63,20/mês**.

Em reais, a ~R$ 5,40/USD **[cotação não verificada — não consegui consultar]**:
**R$ 225 a R$ 341 por mês** para 5 amigos jogarem 10 h. Isso é mais caro que
Discord Nitro para o grupo inteiro. **Descartado por custo, mesmo ignorando a
questão do TCP.**

---

## 5. Onde um túnel AJUDA de verdade: a SINALIZAÇÃO

**Esta é a parte que vale a pena, e é onde a intuição do usuário estava certa —
só que apontada para o alvo errado.**

Hoje o GoLive tem um problema real que o túnel resolve de graça:

> "Sinalização: servidor `ws` embutido no processo de quem cria a sala, porta
> 9000-9010, liberada no firewall do Windows. Descoberta por beacon UDP na LAN."

Isso é o que obriga (a) a abrir porta no Firewall do Windows — um prompt de UAC
que assusta leigo e que antivírus adoram bloquear — e (b) a existir uma LAN
virtual (Radmin/Tailscale) para todo mundo enxergar a porta 9000. **A dor #3 do
briefing ("Radmin VPN exige instalação manual de um app de terceiros") é, em
boa parte, uma consequência da sinalização, não da mídia.**

### O volume de sinalização é ridiculamente pequeno

- SDP de oferta áudio+vídeo típico: 40–80 linhas, **>1,5 KB**
  ([webrtchacks.com/the-minimum-viable-sdp](https://webrtchacks.com/the-minimum-viable-sdp/)) [via índice de busca]
- SDP só de data channel: ~400 bytes (mesma fonte)
- ICE trickle: 5–15 candidatos por lado, algumas centenas de bytes cada
  ([freecodecamp.org/news/how-webrtc-scales-signaling-nat-traversal-and-the-mesh-sfu-mcu-tradeoff](https://www.freecodecamp.org/news/how-webrtc-scales-signaling-nat-traversal-and-the-mesh-sfu-mcu-tradeoff)) [via índice de busca]

**Estimativa de tráfego de sinalização para uma sala de 5 pessoas:**

```
Setup por par:  ~2 KB (SDP) + ~15 × 0,3 KB (ICE) ≈ 6,5 KB
Sala de 5 em árvore, ~6 pares:                   ≈ 40 KB
Keepalive/renegociação ao longo de 3 h:          ≈ 200 KB (generoso)
                                        TOTAL    ≈ 250 KB por sessão
```

**250 KB.** Contra os 48,6 GB da mídia — uma razão de **1 : 200.000**.

Nos 1 GB/mês do ngrok Free isso dá **~4.000 sessões de 3 horas por mês**. As
20.000 requisições HTTP/mês nem são tocadas: uma WebSocket é **uma** requisição
de upgrade, e ngrok suporta WebSocket em todos os planos, inclusive no free
([ngrok.com/docs/pricing-limits/free-plan-limits](https://ngrok.com/docs/pricing-limits/free-plan-limits), [videosdk.live/developer-hub/websocket/ngrok-websocket](https://www.videosdk.live/developer-hub/websocket/ngrok-websocket)) [via índice de busca].

### A arquitetura híbrida

```
  SINALIZAÇÃO  ──►  túnel HTTPS/WSS  ──►  ~250 KB/sessão  ──►  praticamente de graça
       MÍDIA   ──►  WebRTC P2P (UDP) direto, ou TURN quando P2P falha
```

O que isso compra:

1. **Some a necessidade de abrir porta no firewall.** O túnel é uma conexão
   *de saída* do processo do host. Nenhum prompt de UAC, nenhum inbound rule.
2. **Some a necessidade da LAN virtual para a sinalização.** O convite vira uma
   URL `https://algo.ngrok-free.dev/sala/XYZ` que você cola no Discord/WhatsApp.
   Onboarding do espectador: colar link. Zero instalação de terceiro.
3. **A mídia continua P2P.** Ninguém no meio olhando a transmissão — o valor
   explícito do projeto fica intacto, porque o túnel só carrega SDP e ICE.
4. **Latência do túnel não importa.** Handshake acontece uma vez, antes do
   vídeo começar. +50 ms na troca de SDP é invisível.

### Ressalvas honestas do híbrido

- **O limite de 2 h de sessão do ngrok Free continua doendo**, porque a
  sinalização precisa sobreviver à sessão inteira (renegociação, entrada e
  saída de gente, sucessão de host). Com túnel de 2 h, quem entrar depois das
  2 h não consegue. **Isso por si só desqualifica o ngrok Free para
  sinalização.**
- **Um túnel não resolve o CGNAT/NAT simétrico da mídia.** Ele elimina o
  firewall e a LAN virtual da *sinalização*; o P2P de mídia continua dependendo
  de STUN e continua falhando nos mesmos casos (dor #1 do briefing). **O
  híbrido resolve o onboarding, não resolve a conectividade.** Para a
  conectividade você precisa de TURN. Ver §6.
- **Alternativa melhor que túnel para sinalização:** rodar a sinalização num
  **Cloudflare Worker + Durable Object**, em vez de um túnel até a máquina do
  host. Durable Objects estão no plano Free do Workers desde abril de 2025, com
  **100.000 requisições/dia e 313.000 GB-s/dia**, e a WebSocket Hibernation API
  mantém a conexão aberta sem consumir duração
  ([developers.cloudflare.com/durable-objects/platform/pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)) [via índice de busca].
  A Cloudflare cita explicitamente **sinalização WebRTC** e jogos multiplayer
  como caso de uso, e um único DO atende milhares de clientes
  (mesma fonte) [via índice de busca]. Isso resolve de brinde a **dor #4**
  ("se quem criou a sala cai, a sinalização cai junto"): o DO sobrevive à queda
  do host. Custo: US$ 0. Custo de privacidade: a Cloudflare vê os SDPs (que
  contêm IPs dos peers) — mas **não vê a mídia**.
  *(Isso é território da Frente 3; anoto aqui porque compete diretamente com a
  ideia de túnel e ganha.)*

**Veredito da §5: a ideia de túnel tem mérito real, mas só para sinalização, e
mesmo aí um Durable Object é estritamente melhor que um túnel (sem limite de
2 h, sobrevive à queda do host, sem agente extra rodando no PC do usuário).**

---

## 6. Cloudflare Realtime (SFU + TURN) — provavelmente a resposta certa

Categoria diferente: não é túnel, é infraestrutura WebRTC gerenciada. E vem do
mesmo fornecedor que a ideia de túnel Cloudflare já estava rondando.

### Preço

- **US$ 0,05 por GB de egresso**, com **free tier de 1.000 GB/mês**
  ([developers.cloudflare.com/realtime/sfu/pricing](https://developers.cloudflare.com/realtime/sfu/pricing/)) [via índice de busca]
- O free tier de 1.000 GB é **compartilhado** entre SFU e TURN, não são duas
  franquias independentes (mesma fonte)
- **TURN é gratuito quando usado junto com o SFU da Realtime**; standalone custa
  US$ 0,05/GB de saída da Cloudflare para o cliente TURN
  ([developers.cloudflare.com/realtime/turn/faq](https://developers.cloudflare.com/realtime/turn/faq/)) [via índice de busca]
- A cobrança é sobre o que sai da borda da Cloudflare em direção aos clientes
  (mesma fonte)

### Aplicando os números do GoLive

Cenário do briefing (5 pessoas, 10 h/mês, 12 Mbps, 1 transmissor + 4
espectadores). Egresso da Cloudflare = 4 × 12 Mbps = 48 Mbps = 6 MB/s =
21,6 GB/h.

```
21,6 GB/h × 10 h = 216 GB/mês
Franquia free   = 1.000 GB/mês
                  ────────────
Custo mensal    = US$ 0,00   (sobram 784 GB)
```

O grupo caberia no free tier até **~46 horas/mês** de transmissão com 4
espectadores. Acima disso, US$ 0,05/GB — 100 h/mês custariam
`(2.160 − 1.000) × 0,05` = **US$ 58/mês**, mas 100 h/mês não é o caso de uso.

### Por que isso resolve as dores que o túnel não resolve

| Dor do briefing | Cloudflare Realtime |
|---|---|
| #1 Radmin cai pra relay em CGNAT/NAT simétrico | **TURN resolve por definição** — relay que ambos os lados alcançam, sobre UDP em `turn.cloudflare.com:3478/udp` (alternativa `53/udp`), com alocação anycast no datacenter Cloudflare mais próximo do cliente ([developers.cloudflare.com/realtime/turn](https://developers.cloudflare.com/realtime/turn/)) [via índice de busca] |
| #2 Upload do transmissor é o teto (36 Mbps para 3 espectadores) | **O SFU resolve**: o transmissor envia **1 fluxo** de 12 Mbps e a Cloudflare fan-out para N espectadores. Isso derruba o requisito de upload de 36 Mbps para 12 Mbps |
| #3 Radmin exige instalação manual | **Some a VPN inteira** |
| #4 Se o host cai, a sinalização cai | O SFU é o ponto de encontro, não a máquina do host |
| #5 Teto de ~4 pessoas por causa da árvore | **Some a árvore de retransmissão inteira** e o custo de um encoder extra por espectador |

### Latência no Brasil

A Cloudflare tem presença profunda no Brasil: São Paulo (GRU, Equinix SP2),
Rio de Janeiro (GIG, Equinix RJ2), Porto Alegre, Fortaleza, Curitiba, Recife,
Manaus, Goiânia, Joinville, Juazeiro do Norte, Ribeirão Preto, São José do Rio
Preto, São José dos Campos
([cloudflarestatus.com/locations](https://www.cloudflarestatus.com/locations), [mapa CNI de mai/2026](https://developers.cloudflare.com/network-interconnect/static/cni-locations-05-may-2026.pdf)) [via índice de busca].
O TURN é roteado por anycast ao datacenter mais próximo do cliente; quando os
dois peers usam TURN da Cloudflare, o trecho entre as duas bordas usa a backbone
da Cloudflare ([developers.cloudflare.com/realtime/turn/faq](https://developers.cloudflare.com/realtime/turn/faq/)) [via índice de busca].
Para dois brasileiros, isso é plausivelmente um desvio de **10–40 ms**
**[não verificado — não medi]** — dentro do orçamento de 200 ms do briefing.

### E a privacidade? Aqui a resposta se divide em duas.

Esta é a parte que o usuário precisa decidir, não eu.

**TURN puro (mantendo P2P, sem SFU): a privacidade continua intacta.**
A documentação da Cloudflare afirma que ela **não consegue** acessar o conteúdo
da mídia relayada, porque o WebRTC usa DTLS-SRTP ponta-a-ponta entre os peers
antes de o pacote chegar ao servidor TURN — a Cloudflare só repassa pacotes
cifrados ([developers.cloudflare.com/realtime/turn/faq](https://developers.cloudflare.com/realtime/turn/faq/)) [via índice de busca].
**Um relay TURN não é "alguém no meio olhando a transmissão" no sentido que o
briefing quer proteger** — ele vê metadados (quem fala com quem, quando, quanto
volume), não a tela.

**SFU: aí sim há um custo de privacidade, e a própria Cloudflare admite.**
"When using an SFU, there is a privacy cost, as there is now a centralized hub
that could see and listen to all the media contents"
([blog.cloudflare.com/orange-me2eets-we-made-an-end-to-end-encrypted-video-calling-app-and-it-was](https://blog.cloudflare.com/orange-me2eets-we-made-an-end-to-end-encrypted-video-calling-app-and-it-was/)) [via índice de busca].
Na prática o SFU da Realtime "forwards media streams without inspecting or
modifying content, remaining agnostic to encryption" (mesma fonte) — mas isso é
uma promessa operacional, não uma garantia criptográfica.

**A saída existe e é pública:** a Cloudflare construiu o Orange Meets com E2EE
de verdade sobre o próprio SFU, usando uma abordagem client-only padronizada
(MLS + insertable streams) — o SFU repassa pacotes já cifrados pela aplicação e
não consegue lê-los (mesma fonte). Existe até um projeto open source explorando
"free end-to-end encrypted group video calls on Cloudflare's free tier"
([github.com/anupkumarmridha/talkspace](https://github.com/anupkumarmridha/talkspace)).
Custo: complexidade de implementação considerável, e **[não verificado]** se o
encoder de hardware H.264 do Chromium (NVENC/AMF/QuickSync) convive bem com
insertable streams no Electron.

---

## 7. Veredito

### Sobre ngrok para mídia: **não. Sem meio-termo.**

Três razões independentes, em ordem de severidade:

1. **Não fala UDP.** Empurrar SRTP por TCP introduz head-of-line blocking; a
   200 ms de orçamento glass-to-glass, uma perda de pacote com RTT de 100 ms já
   consome metade do orçamento, e sob congestionamento o backoff do TCP leva a
   segundos de travamento.
2. **1 GB/mês de franquia.** São **3 minutos e 47 segundos** de uma transmissão
   real do GoLive com 3 espectadores. Comprar banda suficiente custa
   **US$ 42–63/mês (≈ R$ 225–341)** num app sem monetização.
3. **Sessão de 2 h** derruba a transmissão no meio de uma noite de jogo.

Vale registrar duas coisas a favor do raciocínio original: **ngrok tem PoP em
São Paulo** (o desvio geográfico não seria o problema) e **os ToS do ngrok não
proíbem streaming** (o freio é econômico, não contratual). A ideia não era
ingênua — ela só colide com o transporte errado.

### Sobre túneis em geral para mídia: **não.**

Dos 18 avaliados, só **playit.gg** e **Pinggy** têm UDP nativo + free tier +
presença sul-americana, e ambos têm um defeito fatal para este caso (região não
escolhível no free / timeout de 60 min). Os self-hosted (frp, rathole) fariam o
trabalho tecnicamente mas exigem uma VPS paga — e aí você está pagando por um
relay pior que o TURN da Cloudflare, que é grátis até 1 TB/mês.

E o argumento de fundo: **túnel é a ferramenta certa para "expor um serviço que
espera conexões de entrada"**. O WebRTC não é isso. Ele já tem sua própria
solução para o problema de NAT — ICE/STUN/TURN — desenhada para mídia em tempo
real. Usar um túnel de propósito geral é reimplementar TURN, pior.

### Sobre túnel para SINALIZAÇÃO: **mérito real, mas há algo melhor.**

O túnel elimina a abertura de porta no firewall e a LAN virtual, com ~250 KB por
sessão — 1/200.000 do tráfego de mídia. Isso ataca de frente a dor #3
(onboarding do Radmin). **Mas o limite de 2 h do ngrok Free desqualifica o
ngrok até para isso**, e um **Cloudflare Worker + Durable Object** faz o mesmo
trabalho de graça, sem limite de sessão, sem agente extra no PC do usuário, e
sobrevive à queda do host (resolvendo também a dor #4).

### A recomendação que sai desta frente

**Depende de uma decisão de privacidade que só o usuário pode tomar:**

- **Se "ninguém no meio" significa "ninguém pode ler a tela":**
  **P2P + TURN da Cloudflare Realtime.** Mantém a arquitetura atual, mata a dor
  #1 (CGNAT/NAT simétrico) e a dor #3 (some o Radmin), custa **US$ 0** dentro de
  1.000 GB/mês, e a Cloudflare é criptograficamente incapaz de ver a mídia
  (DTLS-SRTP). **Não** resolve as dores #2 e #5 — o upload do transmissor
  continua sendo o teto e a árvore continua limitando a ~4 pessoas.

- **Se o usuário aceitar um hub que tecnicamente poderia ver a mídia:**
  **SFU da Cloudflare Realtime.** Resolve as cinco dores de uma vez — em
  particular derruba o requisito de upload de 36 Mbps para 12 Mbps e elimina a
  árvore de retransmissão inteira. Mesmo free tier de 1.000 GB. E existe o
  caminho do Orange Meets (E2EE client-side) para recuperar a garantia de
  privacidade, ao custo de complexidade.

**Não recomendo ngrok nem qualquer túnel de propósito geral para a mídia, em
nenhum cenário.**

---

## Lacunas desta pesquisa (o que eu não consegui confirmar)

- Não consegui abrir nenhuma página oficial de ngrok, Cloudflare, playit.gg,
  Pinggy ou Tailscale (bloqueio de egresso). **Todos os números dessas fontes
  vieram de trechos indexados pelo buscador**, não de leitura direta. Antes de
  decidir, valide `ngrok.com/docs/pricing-limits/free-plan-limits` e
  `developers.cloudflare.com/realtime/sfu/pricing` abrindo no navegador.
- **Limite de banda do free tier do playit.gg**: não existe número público que
  eu tenha encontrado. O thread `discuss.playit.gg/t/traffic-limits/5574`
  (28/05/2026) trata exatamente disso e eu não consegui ler a resposta.
- **Latência real Brasil→PoP** de ngrok, playit.gg e Cloudflare TURN: não medi.
  Os "10–40 ms" são estimativa a partir da geografia dos PoPs.
- **Codecs suportados pelo SFU da Cloudflare Realtime** (H.264? simulcast com
  encoder de hardware?): não consegui verificar — a busca acabou. **Isso é um
  bloqueador potencial**, porque o GoLive depende de NVENC/AMF/QuickSync via
  Chromium. Verificar antes de qualquer protótipo.
- **Cotação USD/BRL**: não consegui consultar. Usei R$ 5,40/USD como referência.
- **Compatibilidade de insertable streams (E2EE) com encoder de hardware H.264
  no Electron**: não verificado.
