# FRENTE 3 — MATAR A VPN: NAT traversal nativo, STUN/TURN, IPv6

Pesquisa: 2026-09-16. Alvo: GoLive LAN v0.16.0 (Electron/Windows, WebRTC P2P, ICE só com
`stun.l.google.com`, sem TURN, mídia dentro de uma LAN virtual Radmin/Tailscale).

> **Nota de método.** O ambiente desta sessão tem egress HTTPS restrito por política: a
> maioria dos domínios (tailscale.com, arxiv.org, docs.oracle.com, developers.cloudflare.com,
> twilio.com, bloggeek.me, stats.labs.apnic.net, ipv6.br, radar.cloudflare.com,
> pulse.internetsociety.org, wondernetwork.com) retornou `EGRESS_BLOCKED` no fetch direto.
> Consegui buscar (indexação + resumo das páginas) mas **não consegui abrir e conferir com
> meus olhos** a maior parte das páginas de preço/estatística. Onde o número vem só do resumo
> de busca e não de leitura direta, marquei **[não verificado — confira a URL]**. As URLs
> estão todas citadas para você fechar a conferência em 10 minutos.

---

## 0. Resposta curta à pergunta central

**Pergunta:** "Discord, Parsec, WhatsApp e Google Meet conectam duas pessoas atrás de CGNAT sem
pedir VPN. O que eles fazem que o GoLive não faz?"

**Resposta:** três deles **não fazem NAT traversal melhor — eles pagam um relay.**

| Produto | O que realmente faz |
|---|---|
| **Discord** (voz/vídeo em servidor) | **Nunca é P2P.** Tudo passa pelos Discord Voice servers. A própria Discord escreve: usa arquitetura cliente-servidor porque P2P "fica proibitivamente caro conforme o número de participantes cresce", e porque rotear por servidores garante que "seu IP nunca vaza". ([discord.com/blog](https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc)) DMs seguem o mesmo caminho. ([docs.discord.food](https://docs.discord.food/topics/voice-connections)) |
| **Google Meet** | SFU da Google no meio, sempre. Não existe modo P2P exposto. ([developers.google.com/workspace/meet/media-api](https://developers.google.com/workspace/meet/media-api/guides/concepts)) |
| **WhatsApp** | Tenta P2P, mas na prática "chamadas modernas de voz/vídeo do WhatsApp normalmente são relayadas pelos TURN servers da Meta". A Meta tem um time e uma palestra inteira sobre "Calling Relay Infrastructure at WhatsApp scale". ([atscaleconference.com](https://atscaleconference.com/calling-relay-infrastructure-at-whatsapp-scale/), [github.com/arshadakl/Whatsapp-P2P-Traceroute](https://github.com/arshadakl/Whatsapp-P2P-Traceroute)) |
| **Parsec** | **Este sim é P2P-first de verdade** — e é o modelo certo para o GoLive. Usa **UPnP + hole punching**, e quando falha cai num **Parsec Relay Server** próprio (que a empresa/o usuário pode auto-hospedar). ([support.parsec.app](https://support.parsec.app/hc/en-us/articles/32361410290324-Components-and-Connection-Sequence), [relay legacy](https://support.parsec.app/hc/en-us/articles/32381397579284-Configure-Parsec-Relay-Server-Legacy)) |

**A consequência para o GoLive é desconfortável e libertadora ao mesmo tempo:**

O Radmin VPN **não é uma alternativa ao TURN — ele *é* o seu TURN**, terceirizado e mal
configurado. Quando o Radmin consegue P2P, ele fez o hole punching que o ICE faria sozinho
(e você paga o preço de encapsulamento/MTU/uma única flow UDP por cima). Quando o Radmin
**não** consegue, ele relaya pela infra da Famatech — que é exatamente um relay, com ping
relatado de >400 ms contra ~50 ms do direto ([radmin-club.com](https://radmin-club.com/radmin-vpn/relay-connection-vs-direct-connection/)).
Ou seja: hoje o GoLive **já depende de um relay de terceiro**, só que um relay opaco, sem SLA,
otimizado para tráfego de jogo LAN (pacotinhos) e não para 12 Mbps de vídeo, e que exige que
o usuário instale um programa antes.

Trocar isso por **ICE com TURN próprio** não adiciona um intermediário: **substitui um
intermediário pior por um melhor, que você controla, e que é usado só quando é a única saída.**

---

## 1. Taxa real de sucesso do ICE / hole punching

### 1.1 O número mais confiável e mais recente que achei

**Estudo de 2025/2026, produção, 4,4 milhões de tentativas:**
*"Challenging Tribal Knowledge — Large Scale Measurement Campaign on Decentralized NAT
Traversal"* (arXiv 2510.27500), medindo o DCUtR do libp2p na rede IPFS em produção:

- **70% ± 7,1% de sucesso no hole punching**, condicionado a reserva de relay e descoberta de
  endereço público terem funcionado.
- Base: **>4,4 milhões de tentativas, 85.000+ redes distintas, 167 países**.
- **97,6% das conexões bem-sucedidas fecham na primeira tentativa** (ou seja: quando funciona,
  funciona rápido — não adianta insistir muito).
- Derruba o folclore de que UDP é superior a TCP para traversal: com sincronização por RTT,
  as taxas são estatisticamente indistinguíveis.
- Fonte: https://arxiv.org/abs/2510.27500 — **[não verificado — arxiv.org bloqueado no fetch;
  números vêm do abstract indexado]**

**Leitura para o GoLive: ~30% dos pares vão precisar de relay. Sem TURN, esses 30% hoje caem
na VPN (e no relay da Radmin, que estrangula o bitrate).**

### 1.2 Os números da indústria WebRTC (convergem no mesmo lugar)

| Fonte | Número | URL |
|---|---|---|
| callstats.io (~2016, dados reais de produção) | **22% das conferências precisam de algum TURN** | https://webrtchacks.com/usage-stats/ |
| Consolidado 2018 (fippo/Hancke) | grandes fornecedores reportam ~20% de tráfego via TURN, alguns >30% | https://medium.com/@fippo/what-kind-of-turn-server-is-being-used-d67dbfc2ff5d |
| Chrome UMA / tráfego consumidor aberto | 75–80% fecham direto (host+srflx); **20–25% precisam de relay** | https://www.rtcinsights.com/blog/ice-connection-failures/ |
| Corporativo / 4G-5G restritivo | **30–40%** precisam de TURN | https://www.softpagecms.com/2025/11/21/turn-servers-webrtc-voip-call-reliability/ |
| Com STUN só | ~80% de sucesso; **com TURN: ~99–100%** | https://getstream.io/resources/projects/webrtc/advanced/stun-turn/ |

Todos esses estão em **[não verificado]** quanto à leitura direta (domínios bloqueados),
mas são quatro fontes independentes convergindo em **~20–25% de necessidade de relay em rede
residencial aberta, subindo para 30–40% em rede hostil**. Para o Brasil residencial com CGNAT
pesado, a expectativa razoável é a **faixa alta** dessa distribuição.

### 1.3 Por que o CGNAT e o NAT simétrico mudam tudo

A variável decisiva **não é "tem NAT ou não"**, é **o comportamento de mapeamento**:

- **EIM — Endpoint-Independent Mapping ("cone")**: o NAT dá a você a *mesma* porta pública
  para qualquer destino. O STUN descobre essa porta, você manda pro amigo por sinalização,
  e o hole punching funciona. **É o caso P2P-amigável.**
- **EDM / APDM — Endpoint-Dependent / Address-and-Port-Dependent Mapping ("simétrico")**:
  a porta pública muda **para cada destino**. A porta que o STUN te contou **não serve** para
  falar com o seu amigo. Hole punching padrão morre aqui.
  (https://docs.netgate.com/tnsr/en/latest/vpf/nat-ed-vs-ei.html,
  https://blog.apnic.net/2022/04/19/how-nat-traversal-works-the-nature-of-nats/)

E **o pior caso é os dois lados simétricos.**

### 1.4 "Port prediction" e "birthday paradox" — quem faz, e por que não te salva

**O que é.** Se o NAT do outro lado aloca portas de forma previsível (incremental) ou aleatória
mas você pode fazer *muitas* tentativas, você adivinha a porta:

- **Port prediction determinístico**: você sonda o NAT do par, descobre a regra de alocação
  (ex.: +1 a cada conexão), prevê a próxima porta e ambos mandam pacotes para a porta prevista.
  Só funciona com NAT de algoritmo determinístico conhecido.
  (https://patents.google.com/patent/US11671487 — "Port prediction for peer-to-peer communications")
- **Birthday paradox**: "converte N de esforço em algo da ordem de √N". Um lado abre centenas
  de portas de origem, o outro dispara centenas de sondas para portas de destino aleatórias, e
  você aposta numa colisão. É o que a **Tailscale** implementa (e documenta abertamente).
  (https://tailscale.com/blog/how-nat-traversal-works e
  https://tailscale.com/blog/nat-traversal-improvements-pt-1 — **[não verificado: tailscale.com
  bloqueado no fetch]**)

**O número que mata a ideia:** segundo a própria Tailscale, quando **os dois lados** são NAT
"hard"/simétrico, a busca vira uma colisão no par {porta de origem, porta de destino}, e
**depois de 20 segundos, com 256 sondas de um lado e 2048 do outro, a chance de sucesso é de
0,01%.** (mesma fonte Tailscale, via resumo de busca — **[não verificado]**)

**Quem implementa:** Tailscale (DERP + birthday paradox), alguns clientes de jogo/console,
e há uma pilha de patentes (US8015300, US9497160, US11140053, US9826044). **O WebRTC/ICE não
implementa nada disso.** ICE é RFC 8445 puro: host, srflx, prflx, relay. Confirmado:
"hole punching techniques such as STUN and ICE are unable to traverse symmetric NATs without
the help of a relay server (TURN)" (https://github.com/pion/webrtc/issues/428,
https://docs.libp2p.io/concepts/transports/webrtc/).

> **Implicação direta e importante para o GoLive:** você está em Electron/Chromium. Você **não
> tem** como implementar port prediction dentro do `RTCPeerConnection`. Você teria que fazer um
> transporte paralelo em addon nativo, socar o vídeo em `RTCDataChannel` ou reescrever a mídia
> fora do WebRTC. **Custo altíssimo, retorno de 0,01% no pior caso.** Esqueça essa linha.
> O caminho é: **IPv6 primeiro, TURN como rede de segurança.**

---

## 2. CGNAT no Brasil

### 2.1 O que consegui confirmar por operadora

| Operadora | CGNAT? | Evidência |
|---|---|---|
| **Vivo Fibra** | Sim, faixa **100.64.0.0/10** (RFC 6598), e ainda bloqueia as portas **80, 443 e 25** em plano residencial | https://www.sabermeuip.com.br/vivo-fibra-portas-bloqueadas , https://natchecker.com/pt/blog/vivo-bloqueando-cgnat |
| **Claro / NET** | Sim — "obriga todos a usarem CGNAT, sem opção de não usar" em boa parte dos planos residenciais de fibra e cabo | https://www.sabermeuip.com.br/claro-net-cgnat |
| **Oi / TIM / ISPs regionais** | **Não achei medição pública por assinante.** O padrão citado pelo NIC.br é que CGNAT é a norma em plano residencial brasileiro | https://nic.br/noticia/na-midia/o-que-e-cgnat-e-como-isso-pode-afetar-sua-conexao-de-internet/ |

**[não verificado]**: não encontrei nenhuma medição pública brasileira (Anatel, NIC.br, ISOC)
que dê **percentual de assinantes por operadora atrás de CGNAT**. Isso simplesmente não parece
existir publicado. Quem afirma "80% dos brasileiros estão em CGNAT" está chutando.

### 2.2 O que existe de medição séria (global, com Brasil dentro)

Estudo IMC 2016 / CAIDA (Richter et al., *A Multi-perspective Analysis of Carrier-Grade NAT
Deployment*), cobrindo >60% dos eyeball ASes da internet:

- **13,3%** de todos os ASes não-celulares usam CGN;
- sobe para **17–18%** considerando só **eyeball ASes** (provedores de acesso residencial);
- em redes **celulares: >92%**;
- **as regiões APNIC e RIPE têm mais que o dobro de penetração de CGN das outras** — e são as
  que esgotaram IPv4 primeiro. (LACNIC, do Brasil, esgotou logo depois.)
- https://www.caida.org/catalog/papers/2018_inferring_carrier_grade_nat/inferring_carrier_grade_nat.pdf
- https://arxiv.org/pdf/1605.05606 — **[não verificado: fetch bloqueado]**

Esses números são de 2016 e só pioraram. Para o Brasil de 2026, com 80,2% dos acessos de banda
larga fixa em fibra (https://teletime.com.br/04/05/2026/221-mbps-velocidade-banda-larga-brasil/)
e com crescimento explosivo de ISPs regionais que **nasceram já sem estoque de IPv4**, a
presunção de CGNAT em plano residencial novo é razoável.

### 2.3 O ponto que ninguém discute e que é o decisivo

**CGNAT ≠ NAT simétrico.** Um CGN pode perfeitamente ser **EIM (endpoint-independent)**, e a
maioria das operadoras grandes configura assim — porque CGN simétrico quebra VoIP, Xbox Live,
PSN e jogos P2P em massa, e gera enxurrada de chamado de suporte. Existe até draft de IETF
específico sobre "EIM/EIF para CGNAT" para preservar traversal
(https://www.ietf.org/archive/id/draft-chan-tsvwg-eipf-cgnat-01.txt).

**Consequência prática enorme:** sob **CGNAT com EIM**, o hole punching **funciona**.
O que **não** funciona sob CGNAT é **abrir porta / receber conexão de entrada não solicitada**
(port forwarding, UPnP, hospedar servidor). Isso é uma coisa diferente.

**O GoLive não precisa abrir porta — precisa de hole punching.** Então CGNAT, por si só, **não
é** o motivo de precisar de VPN. **O motivo é não ter TURN para os casos EDM/simétrico.**

**[não verificado]**: não achei dado público sobre qual comportamento de mapeamento (EIM vs EDM)
Vivo, Claro, Oi e TIM usam nos seus CGNs. **Este é o único dado que você realmente precisa e
que só se obtém medindo.** Ver §9.0 — é o primeiro experimento a fazer, custa uma tarde.

---

## 3. IPv6 — a bala de prata (parcial, mas grátis)

### 3.1 O número do Brasil

Achei **três medições que não batem entre si**, e é importante que você saiba disso:

| Fonte | Número | Data | URL |
|---|---|---|---|
| **Cloudflare Radar** | **44,2%** de adoção IPv6 no Brasil; 15º no mundo | recente (2026) | https://radar.cloudflare.com/adoption-and-usage/br |
| **NIC.br / IPv6.br** | **~50%** — "a revolução silenciosa do IPv6 no Brasil: 50% de adoção alcançados" | 2025 | https://ipv6.br/post/a-revolucao-silenciosa-do-ipv6-no-brasil-50-de-adocao-alcancados/ |
| **NIC.br (matéria)** | "IPv6 move **45%** da internet no Brasil" | — | https://www.nic.br/noticia/na-midia/ipv6-move-45-da-internet-no-brasil-mas-faltam-roteadores-e-conteudos/ |
| **APNIC (BR)** | Brasil passou dos 50% desde jun/2024 (clube da maioria) | 2024+ | https://stats.labs.apnic.net/ipv6/BR |
| **Contexto global** | Google passou **50% de IPv6 mundial** em abr/2026 | 2026-04 | https://blog.apnic.net/2026/04/28/google-hits-50-ipv6/ |

**Todos [não verificado]** — todos esses domínios estão bloqueados para fetch nesta sessão.
**Trabalhe com a faixa 44–50%** e cheque `stats.labs.apnic.net/ipv6/BR` antes de citar em
qualquer lugar. O Brasil é, sim, dos líderes mundiais e **está acima da média LACNIC (39%)**.

**Por ASN (este número me preocupa e você deve conferir):** a busca retornou, citando
`stats.labs.apnic.net`:
- **AS26599 (Telefônica Brasil / Vivo): IPv6 capable 13,51%, preferred 13,12%**
- **AS28573 (Claro S.A.): IPv6 capable 22,60%, preferred 20,60%**

Esses valores são **muito** mais baixos que os 44–50% nacionais — o que sugere ou que são
dados antigos, ou que o IPv6 brasileiro vem desproporcionalmente de **móvel (TIM/Vivo móvel)
e de ISPs regionais de fibra**, não das duas maiores de banda larga fixa.
**[não verificado — este é o dado mais importante e mais frágil desta seção. Abra
https://stats.labs.apnic.net/ipv6/AS26599 e https://stats.labs.apnic.net/ipv6/AS28573 .]**

Sobre entrega residencial: relatos consistentes de que **Vivo Fibra e TIM Live vêm dual-stack
ligado por padrão no roteador da operadora**, mas a **Vivo entrega só um /64** (não um /56),
o que é tecnicamente pobre mas **irrelevante para o GoLive** — um /64 já dá endereço global ao
PC. (https://forum.netgate.com/topic/166431/vivo-fibra-ipv6-pfsense-pppoe ,
https://www.sabermeuip.com.br/meu-ipv6)

### 3.2 Por que IPv6 é tão bom para este caso

Com IPv6 nativo nas duas pontas:

1. **Não existe NAT.** Nada de mapeamento, nada de porta que muda, nada de CGNAT. O
   `host candidate` do Chromium **já é o endereço global roteável**.
2. **Não existe o gargalo de porta compartilhada do CGN.** Banda cheia, caminho direto.
3. **Não existe simétrico.** O problema do §1.4 simplesmente evapora.

### 3.3 O cuidado que você levantou (e está certo): o firewall do CPE

O roteador continua com **firewall stateful, default-deny de entrada**. Isso é real — o
próprio ipSpace escreveu sobre isso: "mesmo com IPv6, firewalls continuam existindo... ICE,
STUN e TURN ainda seriam necessários para travessia de firewall"
(https://blog.ipspace.net/2025/04/response-p2p-apps-ipv6/).

**Mas o ICE resolve isso praticamente de graça, e é por um motivo técnico preciso:**

> Um firewall stateful casa pelo **5-tuple completo** — o que é *funcionalmente equivalente a
> NAT simétrico* **exceto que ele não muda os números de porta**.
> (https://webrtchacks.com/an-intro-to-webrtcs-natfirewall-problem/)

Essa exceção é tudo. Como a **porta não muda**, o par sabe exatamente para onde mandar. O
ICE faz checks de conectividade **simultâneos nos dois sentidos**: o pacote de A cria estado no
firewall de A, o pacote de B cria estado no firewall de B, e o segundo pacote de cada lado
passa. É hole punching de livro-texto, **com 100% de previsibilidade de porta**.

Conclusão da literatura: "firewall hole punching no mundo IPv6 tipicamente envolve **só STUN**,
e IPv6 traz menos complexidade para conexões P2P" (mesma fonte ipSpace, via resumo —
**[não verificado]**).

### 3.4 Vale priorizar candidatos IPv6? O Electron/Chromium faz sozinho?

**O Chromium coleta IPv6 sozinho, sim**, se o SO tem endereço global. E na priorização, "em
navegadores que não sejam o Safari, **candidatos IPv6 são preferidos**"
(https://docs.flashphoner.com/static/WCS52/Streaming_video_functions/IPv6_support_for_WebRTC/).
A RFC 8421 é justamente o guia de ICE dual-stack e recomenda intercalar as prioridades por tipo
(https://datatracker.ietf.org/doc/html/rfc8421).

**Mas há três coisas que o GoLive precisa fazer e provavelmente não faz hoje:**

1. **Garantir que a sinalização passa TODOS os candidatos, inclusive os IPv6.** Se em algum
   ponto o código filtra por formato de IPv4, os candidatos IPv6 somem. Vale um `grep` no
   `src/renderer/mesh.js` / `signaling-core.js`.
2. **Ter um STUN que responda em IPv6.** Os hostnames `stun.l.google.com` … `stun4.l.google.com`
   aparecem publicados só com **endereços A (IPv4)** em listas públicas
   (https://gist.github.com/zziuni/3741933). Para IPv6 srflx você precisa de um STUN com AAAA.
   (Na prática, para IPv6 o candidato **host** já é global e o srflx quase não importa — mas o
   `stun.cloudflare.com` é gratuito e ilimitado e resolve o ponto.)
3. **Rodar a VPN é ativamente ruim para isso.** O adaptador virtual da Radmin injeta um
   candidato host IPv4 `26.x.x.x` que o ICE adora (type preference de `host` é 126, o mais
   alto de todos, contra 0 do relay — RFC 8445). Ou seja: **hoje o GoLive pode estar escolhendo
   o túnel da VPN por cima de um caminho IPv6 nativo e perfeito.** O comentário no topo do
   `src/renderer/mesh.js` inclusive descreve exatamente esse desenho ("o candidato host da VPN
   continua na lista e assume se o NAT não deixar") — mas o `host` da VPN tem prioridade de
   `host`, não de último recurso.

**Ganho esperado do IPv6 sozinho:** se ~45% dos usuários têm IPv6, a chance de **um par
qualquer** ter IPv6 dos dois lados é ≈ 0,45² ≈ **20%**. Não é bala de prata — mas é **20% de
pares que passam a ter caminho direto, gratuito, sem NAT e com banda cheia**, e que hoje
provavelmente estão sendo jogados dentro de um túnel Radmin. **Custa ~0 linhas de código
(é só não atrapalhar) e vale muito.**

---

## 4. Abrir porta automaticamente: UPnP IGD, NAT-PMP, PCP

### 4.1 O veredito primeiro

**Sob CGNAT: inútil. Confirmado, e o motivo é estrutural, não de implementação.**

O serviço de port mapping **precisa localizar um IP público roteável, ou ele se recusa a mapear**
(https://docs.netgate.com/pfsense/en/latest/services/upnp.html). Sob CGNAT, o WAN do seu CPE é
`100.64.0.0/10` — um endereço reservado RFC 6598, **não público**. As implementações de UPnP
rejeitam esses endereços como inadequados para mapeamento externo
(https://www.snbforums.com/threads/upnp-doesnt-work-on-cgnat-double-nat.80132/).

E mesmo que mapeasse: **a porta que você abriu é no seu CPE, não no CGN da operadora.** O CGN
continua na frente, sem nenhuma regra para você. O comentário mais direto que achei:
*"UPnP é completamente inútil para CGNAT, e PCP só funcionaria SE o gateway CGNAT falasse PCP"*
(https://news.ycombinator.com/item?id=24542028).

### 4.2 PCP é a única com chance teórica — e na prática não tem

**PCP (RFC 6887)** foi desenhado justamente para isso: "PCP pode permitir que hosts operem
servidores atrás de um carrier-grade NAT operado por um ISP, ou de um firewall IPv6"
(https://blog.apnic.net/2022/04/26/how-nat-traversal-works-nat-notes-for-nerds/).

Mas exige que **a operadora habilite PCP no CGN**. **[não verificado — não achei nenhuma
evidência de Vivo, Claro, Oi ou TIM oferecendo PCP no CGN. Presuma que não.]**

E do lado do CPE é igualmente ruim: "RouterOS e vários outros firmwares consumer/prosumer
implementam UPnP IGD mas **não** PCP ou NAT-PMP, tornando o mapeador efetivamente morto nessas
redes" (https://github.com/netbirdio/netbird/discussions/7021).

### 4.3 Bibliotecas Node/Electron (se ainda assim você quiser tentar)

| Pacote | Estado | Observação |
|---|---|---|
| `nat-upnp` (indutny) | **v1.1.1, última publicação há ~8 anos** | Abandonado. https://www.npmjs.com/package/nat-upnp |
| `@runonflux/nat-upnp` | fork mantido | https://www.npmjs.com/package/@runonflux/nat-upnp |
| `@achingbrain/nat-port-mapper` | **mantido, do ecossistema libp2p, fala UPnP + NAT-PMP + PCP** | Melhor opção. https://www.npmjs.com/package/@achingbrain/nat-port-mapper |
| `@libp2p/upnp-nat` | wrapper libp2p | https://www.npmjs.com/package/@libp2p/upnp-nat |

E uma ressalva de arquitetura: **abrir porta por UPnP só ajudaria a sinalização (porta 9000-9010),
não a mídia.** O WebRTC usa portas efêmeras negociadas pelo ICE — não dá pra pré-mapear.

**Prioridade recomendada: BAIXA.** Vale ~30 linhas para a minoria com IPv4 público real e UPnP
ligado. Não resolve o problema de ninguém que está no caso difícil.

---

## 5. TURN: o que custa de verdade relayar

### 5.1 A conta base

- 1 fluxo a **12 Mbps** = 1,5 MB/s × 3600 s = **5,4 GB por hora**.
- Sala de 5 pessoas (1 transmissor + 4 espectadores) = **4 fluxos** = **21,6 GB/h de egress
  do relay**.
- Cenário do briefing (**10 h/mês**) = **216 GB/mês de egress**, **no pior caso em que 100% dos
  fluxos vão para relay**.

**Duas correções importantes para cima e para baixo:**

- **Para baixo (a que importa):** o ICE **só usa relay em último caso**. Pela RFC 8445, a
  *type preference* é `host`=126, `srflx`=100, `relay`=**0** — relay é literalmente a última
  prioridade. Então se ~70% dos pares fecham direto (§1.1), o consumo real fica em torno de
  **~30% de 216 GB ≈ 65 GB/mês**. Adicionar TURN **não gasta nada quando o direto funciona.**
- **Para cima:** se ambos os lados só tiverem candidato relay, o ICE pode escolher um par
  relay↔relay e o tráfego atravessa o servidor **duas vezes**. Provedores como a Cloudflare
  cobram só o que sai do edge para o cliente, então isso pode dobrar a conta nesse par.

### 5.2 Provedores gerenciados — comparativo com a conta feita

Quantas **horas de sala cheia (4 espectadores, 21,6 GB/h)** cabem no free tier:

| Provedor | Free tier | Horas/mês de sala cheia no grátis | Preço acima | Custo de 10 h/mês (pior caso 216 GB) | PoP no Brasil? |
|---|---|---|---|---|---|
| **Cloudflare Realtime TURN** | **1.000 GB/mês** (compartilhado com o SFU) | **~46 h** | **US$ 0,05/GB** | **US$ 0,00** (cabe no grátis) | **Sim — GRU/São Paulo, anycast, 330+ cidades** |
| **ExpressTURN** | **100 GB/mês** | ~4,6 h | US$ 9/mês por 5 TB | US$ 9 (ou US$ 0 se ficar ≤100 GB) | Não confirmado |
| **Metered / Open Relay** | **0,5 GB** sem cartão; **20 GB** com cartão | **~0,9 h** | ~US$ 0,40/GB (NA) | ~US$ 78 | Não confirmado |
| **Xirsys** | **0,5 GB/mês** | **~0,02 h** (1,4 min) | US$ 39/mês por 50 GB; US$ 0,09/GB overage | ~US$ 54 | 12 regiões |
| **Twilio NTS** | nenhum | 0 | **US$ 0,40/GB** (US/DE), **US$ 0,80/GB (Brasil!)** | **US$ 86 (US) / US$ 173 (BR)** | Sim, e é o mais caro |
| **Google** | **não oferece TURN público** — só STUN, com rate limit e sem SLA | — | — | — | — |

Fontes: Cloudflare https://developers.cloudflare.com/realtime/turn/ e
https://developers.cloudflare.com/realtime/sfu/pricing ; ExpressTURN https://www.expressturn.com/ ;
Metered https://www.metered.ca/tools/openrelay/ e https://www.metered.ca/pricing ;
Xirsys https://xirsys.com/pricing ; Twilio https://www.twilio.com/en-us/stun-turn/pricing ;
Google STUN https://www.videosdk.live/developer-hub/stun-turn-server/google-stun-server .
**Todos [não verificado] quanto à leitura direta — domínios bloqueados nesta sessão. Os de
Cloudflare, Metered e Twilio vieram confirmados por duas buscas independentes cada.**

### 5.3 A conclusão brutal desta tabela

**Cloudflare Realtime TURN é, de longe, a melhor opção e é efetivamente gratuita para o seu caso.**

- **1 TB/mês grátis** cobre 46 h/mês de sala cheia **totalmente relayada** — e como só ~30% dos
  pares vão para relay, na prática cobre **~150 h/mês de uso real**.
- **US$ 0,05/GB** depois — 8 a 16× mais barato que a Twilio, e a Twilio cobra **US$ 0,80/GB no
  Brasil**, o dobro do preço US/DE.
- **É anycast, com PoP em São Paulo (GRU).** A Cloudflare afirma que ~95% da população conectada
  do mundo está a ~50 ms de um POP dela
  (https://blog.cloudflare.com/webrtc-turn-using-anycast/ — **[não verificado]**). Isso é
  **decisivo** — ver §5.5.
- **Não vê a sua transmissão** — ver §5.6.

**O atrito real:** a Cloudflare exige credenciais TURN efêmeras geradas com um API token. Como
o GoLive não tem servidor, isso exige **um Cloudflare Worker minúsculo** (free tier 100k
req/dia) que emite credenciais de curta duração. É ~40 linhas. **É um servidor no meio — mas
só para emitir credenciais, jamais vê mídia.** Alternativa: embutir um token de longa duração
no binário (ruim: quem descompilar usa a sua cota).

### 5.4 Self-host coturn: em qual VPS?

| Opção | Custo | Egress incluso | Horas/mês de sala cheia | Latência do Brasil | Situação em 2026 |
|---|---|---|---|---|---|
| **Oracle Cloud Always Free** | **US$ 0** | **10 TB/mês** | **~463 h** | **Ótima — regiões São Paulo (`sa-saopaulo-1`) e Vinhedo (`sa-vinhedo-1`)** | ⚠️ **Ampere A1 caiu de 4 OCPU/24 GB para 2 OCPU/12 GB em 15/06/2026**; instâncias acima do novo limite seriam terminadas a partir de 18/08/2026 |
| **Hetzner CX22** (Alemanha) | ~€3,79–4,49/mês | **20 TB** (só locais EU; US = 1 TB, Singapura = 0,5 TB) | ~925 h | ❌ **~180–200 ms** | Overage €1,00/TB |
| **Contabo** | barato | alto | alto | ❌ fora do Brasil | Relatos de manutenção não planejada em fim de semana |
| **Fly.io** | pago por uso | US$ 0,02/GB (NA/EU); **até US$ 0,12/GB em outras regiões** | — | GRU existe | Caro para egress fora de NA/EU |
| **VPS brasileiro** (Hostinger KVM 1 ~R$ 28/mês em SP; Kronic/SpeedCloud/Turbo Cloud com "tráfego ilimitado" em Ascenty SP) | R$ 28–60/mês | "ilimitado" (na prática limitado pela porta) | alto | ✅ **excelente (~5–20 ms)** | Melhor relação latência/preço se o Oracle não rolar |

Fontes: Oracle Always Free https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
e https://github.com/oracle/free (este eu **consegui abrir**: confirma "4 Arm-based Ampere A1
cores and 24 GB" e "**10 TB per month**" de outbound — mas o repo está desatualizado frente à
mudança de junho/2026); mudança de limites
https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/ e
https://terminalbytes.com/oracle-cloud-free-tier-changes-2026/ ;
regiões BR https://docs.oracle.com/pt-br/iaas/Content/FreeTier/freetier.htm ;
Hetzner https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/ e
https://wz-it.com/en/blog/aws-egress-fees-vs-hetzner-traffic-costs/ ;
Fly.io https://fly.io/docs/about/pricing/ ;
VPS BR https://runzos.com/vps-brasil-barato-2026/ e https://www.speedcloud.com.br/vps-no-brasil .

**Sobre o Oracle Always Free em 2026 — o que confirmar antes de contar com ele:**
1. ✅ **Os 10 TB/mês de egress grátis continuam documentados.** Não achei nenhuma notícia de
   corte no egress — o corte de junho/2026 foi **só de CPU/RAM** (4 OCPU/24 GB → 2 OCPU/12 GB).
   **[não verificado — docs.oracle.com bloqueado; confira a URL acima.]**
2. ✅ **2 OCPU / 12 GB é mais que suficiente para coturn.** TURN "não é realmente intensivo em
   CPU ou memória"; a referência é ~100 clientes por vCPU e ~1.000 clientes por 100 Mbps
   (https://github.com/coturn/coturn/wiki/TURN-Performance-and-Load-Balance,
   https://docs.intracomsystems.com/turn_server/). Uma sala de 4 espectadores a 12 Mbps são
   4 sessões e ~96 Mbps in+out — trivial.
3. ⚠️ **Região de origem (home region) não pode ser mudada depois.** Escolha
   `sa-saopaulo-1` ou `sa-vinhedo-1` **na criação da conta** — Always Free só existe na home region.
4. ⚠️ **Conta brasileira: [não verificado].** Não consegui confirmar se o Oracle aceita CPF/cartão
   brasileiro sem fricção hoje. Historicamente aceita (exige cartão só para verificação, sem
   cobrança). **Confirme antes de desenhar a arquitetura em cima disso.**
5. ⚠️ **"Out of capacity" em Ampere A1 é notório.** É comum não conseguir criar a instância ARM
   gratuita por falta de capacidade na região. **[não verificado para as regiões brasileiras
   especificamente.]** O fallback é a instância AMD micro (1/8 OCPU, 1 GB) — que ainda serve
   para coturn, já que o gargalo é rede e não CPU.

### 5.5 TURN dentro do Brasil vs fora — por que isso decide a viabilidade

O orçamento do briefing é **~200 ms glass-to-glass**. Desse orçamento, captura + encode +
jitter buffer + decode + render já comem uma fatia grande. O que sobra para a rede é pouco.

- **TURN em São Paulo**: acrescenta a ida e volta local. Penalidade estimada **< 20–30 ms**.
  Aceitável, quase imperceptível.
- **TURN em Miami**: São Paulo–Miami é da ordem de 110–130 ms de RTT. O caminho relayado
  SP → Miami → SP acrescenta ~110–130 ms one-way. **Come metade do orçamento.**
  **[não verificado — não consegui abrir wondernetwork.com para citar o número medido.]**
- **TURN na Alemanha (Hetzner)**: fonte brasileira afirma **~180–200 ms de latência** do Brasil
  para a Hetzner (https://tudosobrehospedagemdesites.com.br/melhor-vps/). Isso **sozinho já
  estoura os 200 ms**. **Hetzner está descartada para mídia, por mais barata que seja.**

> **Regra: o relay precisa estar no Brasil, ou ser anycast com PoP no Brasil. Não há
> negociação aqui.** Isso elimina Hetzner/Contabo/Racknerd e coloca **Cloudflare (anycast/GRU)**
> e **Oracle São Paulo/Vinhedo** como as duas únicas opções sérias de custo ~zero.

Nota adicional: se o UDP estiver bloqueado e o ICE cair em **TURN sobre TCP/TLS 443**, você
ganha conectividade mas perde qualidade — head-of-line blocking do TCP arruína vídeo a 12 Mbps.
Trate TURN/TCP como "salvação de emergência com qualidade degradada", não como caminho normal.
Vale reduzir o degrau de qualidade automaticamente quando detectar `relay` + `tcp` nas
`RTCIceCandidatePairStats` — você já tem uma escada de qualidade, é só mais um gatilho.

### 5.6 Privacidade: TURN NÃO quebra a promessa de "ninguém no meio olhando"

Este ponto é importante porque é um valor explícito do projeto.

- **O servidor TURN não consegue descriptografar nada.** Todo dado de camada de aplicação —
  vídeo, áudio, datachannel — vai em **DTLS-SRTP**, e "o servidor TURN não pode descriptografar
  esse dado — ele apenas repassa o dado cifrado entre os pares"
  (https://groups.google.com/g/turn-server-project-rfc5766-turn-server/c/0CI4lwNwP4w).
- **O material de chaveamento DTLS-SRTP nunca é exposto ao JavaScript** — o navegador guarda as
  chaves internamente e nenhum código de aplicação consegue extraí-las
  (https://antmedia.io/webrtc-security/).
- O que o relay vê: **quem falou com quem, quando e quantos bytes**. Metadados. Exatamente o
  mesmo que o relay da Radmin vê hoje.
- **Se você auto-hospedar o coturn, "o cara no meio" é você.** Isso é *melhor* do que hoje, não pior.

**Portanto: adicionar TURN não quebra a privacidade. Diga isso explicitamente no README para
não perder o argumento de venda do projeto.**

---

## 6. "TURN caseiro" e a relação com a árvore de retransmissão

### 6.1 Um amigo com upload bom hospeda o relay — funciona?

**Quase sempre não, e pelo motivo mais irônico possível: um servidor TURN precisa de porta de
entrada aberta.** E o amigo brasileiro típico está atrás de CGNAT — que impede exatamente isso
(§4). Você cairia no mesmo problema, um nível acima.

Só funcionaria se o amigo tiver:
- **IPv4 público real** (raro em plano residencial brasileiro novo), **e** porta liberada; ou
- **IPv6 com regra de entrada no CPE** — mas aí só clientes IPv6 alcançam o relay, e são
  justamente os que **menos precisam de relay** (§3.2). Autoderrota.

### 6.2 O que muda ao usar TURN padrão em vez da árvore própria?

Esta é a comparação mais importante do documento, porque **as duas coisas não se substituem —
elas resolvem problemas diferentes.**

| | **Árvore de retransmissão (hoje)** | **TURN padrão** |
|---|---|---|
| Problema que resolve | **Upload do transmissor.** Origem manda 2 fluxos, o relay abana para 2 folhas | **Conectividade.** Dá um caminho quando o hole punching falha |
| Economiza upload da origem? | **Sim** — é o ponto dele | **Não. Nenhum.** Cada espectador continua custando 12 Mbps de upload na origem |
| Quem implementa a lógica? | **Você** — sucessão, recálculo de árvore, veto de relay, profundidade máx 2 | **O ICE, sozinho.** Um objeto a mais no `iceServers` |
| Latência adicional | Um hop extra de peer (e um peer residencial, com jitter) | Um hop de datacenter (São Paulo: baixo e estável) |
| Falha se o relay cair? | Sim, precisa recalcular a árvore | Não — outros pares não dependem dele |
| Custo | 0 | Egress do relay |

**Conclusão:** **não troque a árvore por TURN. Use os dois.** A árvore continua sendo a sua
resposta ao teto de upload; o TURN vira o **transporte de cada aresta da árvore** quando aquela
aresta específica não fecha direto. Se você usar TURN em todas as arestas, o egress continua
sendo "um fluxo por espectador" — a mesma conta de §5.1.

E se você quiser mesmo um "relay caseiro" padronizado, o caminho é **`pion/turn` (v5)**, que é
explicitamente *"TURN como API — inclua no seu aplicativo existente, sem precisar gerenciar
outro serviço"*, com suporte a **RFC 6156 (IPv6)** e cross-compilação trivial para Windows
(https://github.com/pion/turn). Mas ele esbarra no mesmo problema de porta de entrada do §6.1.
**Só vale a pena na VPS.**

---

## 7. Experiência de instalação: VPN vs WebRTC com TURN

| Passo | **Hoje (Radmin VPN)** | **Proposto (ICE + IPv6 + TURN)** |
|---|---|---|
| 1 | Baixar e instalar o Radmin VPN (app de terceiro, instalador com driver de adaptador de rede virtual) | — |
| 2 | Criar ou entrar numa rede, com nome e senha | — |
| 3 | Convidar cada amigo e esperar cada um repetir os passos 1–2 | — |
| 4 | Descobrir o IP `26.x.x.x` de quem criou a sala e passar para os outros | — |
| 5 | Aceitar prompt de firewall do Windows (de novo, agora para o adaptador virtual) | Aceitar prompt de firewall do Windows **[só quem cria a sala, para a sinalização]** |
| 6 | Abrir o GoLive | Abrir o GoLive |
| 7 | Torcer para o Radmin ter fechado P2P, e não estar relayando a 400 ms | — |
| **Total** | **~7 passos, 2 programas, 1 conta/rede, 1 IP para copiar** | **~2 passos, 1 programa, 0 contas** |

O passo 4 é especialmente letal para público leigo: "manda pro seu amigo o número que começa
com 26" é o tipo de instrução que faz gente desistir.

**Mas há um custo escondido na migração que você precisa encarar:** hoje, o endereço
`26.x.x.x` da VPN também serve como **descoberta e identidade**. Sem ele, você precisa de um
mecanismo de "entrar na sala" que funcione pela internet — o beacon UDP da LAN não atravessa
NAT. Isso é problema de **sinalização**, não de mídia, e é o assunto de outra frente desta
pesquisa. **Matar a VPN sem resolver a sinalização pela internet não é uma migração, é uma
regressão.** Considere isso um pré-requisito bloqueante.

---

## 8. O que mudar no código (concreto)

Hoje, em `/home/user/golive/src/renderer/mesh.js` linhas 10–12:

```js
const STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
const RTC_CONFIG = { iceServers: [{ urls: STUN_URLS }], iceTransportPolicy: 'all' };
```

Problemas:
1. **Zero TURN.** Nenhuma rede de segurança. Quando o hole punching falha (≈30% dos pares),
   o ICE escolhe o candidato host da VPN — que é o caminho lento.
2. **Só STUN do Google**, que tem *rate limiting* "voltado para tráfego moderado, não massivo",
   **sem SLA nem garantia de uptime**, e com relatos de IPs anunciados que não respondem
   corretamente a STUN em certos ISPs
   (https://www.videosdk.live/developer-hub/stun-turn-server/google-stun-server ,
   https://groups.google.com/g/discuss-webrtc/c/3aCpejYepZg).
3. **Nenhum STUN com AAAA**, o que limita a coleta de srflx IPv6.

Direção:

```js
const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
    { urls: ['turn:<relay-br>:3478?transport=udp',
             'turns:<relay-br>:5349?transport=tcp'],   // último recurso, 443/TLS
      username: efemero.user, credential: efemero.cred }
  ],
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 4
};
```

E instrumentar: ler `RTCIceCandidatePairStats` do par nomeado e logar
`localCandidateType`/`remoteCandidateType` (`host` | `srflx` | `prflx` | `relay`) e o
`protocol`. **Isso te dá, em uma semana de uso real com seus amigos, a estatística brasileira
que eu não achei publicada em lugar nenhum** — e é ela que decide se o TURN vai ser usado em
5% ou em 45% dos pares.

Se auto-hospedar coturn, lembre de limitar a cota (o binário do app vai carregar o segredo HMAC
do `use-auth-secret`, e quem descompilar pode usar o seu relay): o coturn tem opções de quota
total, quota por usuário e teto de banda no `turnserver.conf` — **[não verificado: nomes exatos
das diretivas; confira em https://github.com/coturn/coturn]**.

---

## 9. Plano, na ordem de retorno sobre esforço

**9.0 — MEDIR PRIMEIRO (uma tarde, custo zero, maior retorno de todos).**
Ninguém publicou o dado que decide tudo: **os CGNs da Vivo, Claro, Oi e TIM são EIM ou
simétricos?** Rode um teste de comportamento de NAT (`stunclient --mode full`, `natchecker`,
ou o próprio `pion/stun`) na casa de cada um dos 4–5 amigos e anote. Se forem EIM, o hole
punching funciona e o TURN vai ficar quase ocioso. Se forem simétricos, o TURN é obrigatório e
você vai queimar o free tier. **Sem esse dado, todo o resto é estimativa.**

**9.1 — Deixar o IPv6 trabalhar (dias, custo zero).** Verificar que a sinalização repassa
candidatos IPv6; trocar/adicionar STUN com AAAA; **desligar a VPN nos testes** para o candidato
host `26.x.x.x` parar de sequestrar a seleção do ICE. Ganho estimado: ~20% dos pares com
caminho direto sem NAT nenhum.

**9.2 — Adicionar TURN (dias, custo ~zero).** Cloudflare Realtime TURN (1 TB/mês grátis, PoP em
São Paulo, US$ 0,05/GB depois) com um Worker de credenciais efêmeras. Ganho: taxa de conexão
vai de ~70% para ~99%.

**9.3 — Plano B de soberania (um fim de semana).** coturn numa Oracle Always Free em
`sa-saopaulo-1`/`sa-vinhedo-1` (10 TB/mês grátis) como segundo `iceServer`. Se a Cloudflare
mudar preço ou você quiser "ninguém de fora no meio", já está pronto.

**9.4 — Só então, aposentar a VPN.** E só depois que a **sinalização pela internet** estiver
resolvida (§7).

**9.5 — UPnP/PCP: opcional, prioridade baixa.** `@achingbrain/nat-port-mapper` para quem tem
IPv4 público. Não resolve CGNAT.

---

## 10. VEREDITO

### Dá pra eliminar a VPN?

**Sim — e a VPN nunca foi a solução do problema, foi um sintoma de não ter TURN.**
Hole punching nativo (ICE) + IPv6 + um relay TURN no Brasil cobre tudo que o Radmin cobre, com
**menos** intermediários, **melhor** latência e **muito** menos atrito de instalação.

**Mas com duas condições bloqueantes, e elas não são negociáveis:**

1. **O relay precisa estar no Brasil** (ou ser anycast com PoP em São Paulo). Relay na Europa
   estoura sozinho o orçamento de 200 ms.
2. **A sinalização precisa funcionar pela internet antes.** Hoje ela depende do beacon UDP na
   LAN virtual. Matar a VPN sem resolver isso quebra o app.

### O que custa?

**Praticamente nada, no volume descrito no briefing.**

- Cenário do briefing (5 pessoas, 10 h/mês, 12 Mbps): **~216 GB de egress no pior caso
  absoluto** (100% relayado), **~65 GB no caso realista** (~30% relayado).
- **Cloudflare Realtime TURN: 1.000 GB/mês grátis → US$ 0,00/mês.** Cabe 3× o pior caso.
- Fora do free tier: **US$ 0,05/GB** → o pior caso custaria **US$ 10,80/mês** (≈ R$ 58).
- **Oracle Always Free em São Paulo: 10 TB/mês → US$ 0,00**, cobrindo ~463 h/mês de sala cheia
  totalmente relayada.
- **Twilio é a armadilha: US$ 0,80/GB no Brasil → US$ 173/mês** pelo mesmo uso. Não use.
- **Metered (20 GB) e Xirsys (0,5 GB) são inúteis nesta escala** — 0,9 h e 1,4 min de sala
  cheia, respectivamente.

### Qual a taxa de falha esperada?

| Cenário | Conexão direta | Precisa de relay | Falha total |
|---|---|---|---|
| **Hoje (STUN só, sem TURN)** | ~70% | — | **~30% cai no túnel da VPN → relay da Radmin → poucos Mbps → 1080p60 impossível** |
| **Com IPv6 priorizado + STUN** | ~75–80% | — | ~20–25% degrada |
| **Com IPv6 + STUN + TURN/UDP no Brasil** | ~70% direto | ~29% via relay, **qualidade preservada** | **~1%** |
| **+ TURN/TLS 443 como último recurso** | — | ~1% adicional, **qualidade degradada** (TCP head-of-line) | **<0,5%** |

Base: 70% ± 7,1% de hole punching medido em 4,4 M de tentativas (arXiv 2510.27500) e 20–25%
de necessidade de TURN reportada de forma consistente pela indústria WebRTC. **Modelo, não
medição brasileira** — o §9.0 existe para substituir esta linha por dado real.

### Recomendação final

**Recomendo fortemente: adicione TURN e deixe o IPv6 trabalhar. Custa US$ 0/mês, é dias de
trabalho, e é o item de maior retorno de toda esta pesquisa.**

**Não recomendo:** implementar port prediction / birthday paradox (impossível dentro do
Chromium, e 0,01% de sucesso no pior caso); depender de UPnP/NAT-PMP/PCP (inútil sob CGNAT);
TURN na Hetzner/Europa (latência mata); Twilio (16× mais caro no Brasil).

**Depende de medir:** o quanto o TURN vai ser realmente usado depende de os CGNs brasileiros
serem EIM ou simétricos — o único dado que precisa e que **não existe publicado**. Meça antes
de dimensionar.

---

## Apêndice — o que NÃO consegui verificar

Tudo abaixo está marcado no corpo do texto e é o que você deve checar antes de tomar decisão:

1. **Todos os preços de TURN** (Cloudflare, Twilio, ExpressTURN, Metered, Xirsys) — domínios
   bloqueados no fetch. Vieram de resumo de busca, com concordância entre buscas independentes
   para Cloudflare, Metered e Twilio.
2. **Percentual de IPv6 do Brasil hoje** — três fontes dando 44,2%, 45% e 50%. Confira
   `stats.labs.apnic.net/ipv6/BR`.
3. **IPv6 por ASN brasileiro** (Vivo 13,51%, Claro 22,60%) — muito abaixo do nacional; suspeito
   de estar desatualizado. **Mais frágil da pesquisa.**
4. **Egress de 10 TB do Oracle Always Free continuar valendo em 2026** — o corte confirmado de
   junho/2026 foi só de CPU/RAM, mas não abri a página oficial.
5. **Oracle aceitar conta brasileira sem atrito** e **ter capacidade Ampere nas regiões BR**.
6. **Comportamento de mapeamento (EIM vs EDM) dos CGNs de Vivo, Claro, Oi e TIM** —
   **não existe publicado. É o dado mais importante do documento.**
7. **Percentual de assinantes brasileiros atrás de CGNAT por operadora** — não existe publicado.
8. **Números de latência ponto a ponto** (SP→Miami, SP→Frankfurt) — wondernetwork.com bloqueado.
   O "~180–200 ms para a Hetzner" veio de fonte secundária brasileira.
9. **Nomes exatos das diretivas de cota do coturn.**
10. **Se `stun.cloudflare.com` tem registro AAAA** (para srflx IPv6).
