# FRENTE 1 — Redes overlay / VPNs de malha

Pesquisa: 2026-09-16. Alvo: GoLive LAN v0.16.0 (Electron/Windows, WebRTC P2P, 1080p60, 3–6 amigos).

Pergunta central: *"Radmin VPN é mesmo a única opção gratuita? E dá pra eliminar a VPN separada
embutindo a rede no próprio app?"*

**Resposta curta:** Não, Radmin não é a única — nem é a melhor. E sim, dá pra embutir, mas
provavelmente **você não deveria embutir uma VPN**: deveria embutir um *transporte P2P*
(iroh) ou simplesmente adicionar TURN ao WebRTC que você já tem. A VPN de malha, no desenho
atual, é um TURN server com passos extras — e um TURN pior.

> **Aviso sobre fontes.** O proxy de rede deste ambiente bloqueia `tailscale.com`,
> `zerotier.com`, `radmin-vpn.com`, `iroh.computer`, `stats.labs.apnic.net`, `hetzner.com`,
> `lacnic.net` e `radmin-club.com`. GitHub e pkg.go.dev passaram. Onde só consegui o dado via
> *snippet* de busca (e não pela página original), marquei **[via busca, página original
> inacessível]**. Onde não confirmei nada, marquei **[não verificado]**.

---

## 1. O achado estrutural (leia isto antes da tabela)

### 1.1 A VPN de malha não te dá nada que o WebRTC já não faça — exceto o relay

Uma overlay mesh entrega três coisas:

| O que a overlay entrega | O WebRTC do GoLive já faz? |
|---|---|
| Endereçamento estável (IP virtual) | Sim — SDP/sinalização já resolve "quem é quem" |
| Furo de NAT (STUN, hole punching) | Sim — ICE faz exatamente o mesmo STUN binding + hole punch |
| Fallback por relay quando o furo falha | **Não** — o GoLive não tem TURN |

Ou seja: **a única contribuição real do Radmin/Tailscale ao GoLive é o relay.** Todo o resto é
uma segunda pilha de rede, uma segunda camada de cripto e um instalador a mais para fazer o
que o ICE já faz. E o relay que essas ferramentas oferecem é *pior* que um TURN dedicado:
o DERP do Tailscale é **TCP** ("DERP has been highly reliable, but isn't optimized for high
performance, and being TCP-based, it incurs extra latency due to TCP handshakes, buffering,
and the like" — <https://tailscale.com/blog/nat-traversal-improvements-pt3-looking-ahead>
[via busca]). TCP para vídeo ao vivo é head-of-line blocking: o pior transporte possível
para 1080p60.

### 1.2 Suspeita forte: rodar WebRTC dentro da VPN pode estar te *prejudicando*

Hipótese concreta, e testável:

O ICE calcula prioridade de candidato pela RFC 8445, e **candidatos `host` têm prioridade
maior que `srflx`**. A interface virtual do Radmin (rede `26.x.x.x`) aparece para o Chromium
como uma interface local comum, e seus candidatos são `host`. Resultado: o par
`host(26.x) ↔ host(26.x)` tende a vencer o par `srflx ↔ srflx` que seria a conexão pública
real — mesmo quando, por baixo, aquele `26.x` está indo pelo relay do Radmin a 400 ms de ping
(relay = indicador amarelo, ~400 ms vs ~50 ms direto —
<https://radmin-club.com/radmin-vpn/relay-connection-vs-direct-connection/> [via busca]).

Ou seja, existe um cenário em que **o ICE teria achado um caminho direto bom, e a VPN o
convenceu a escolher um caminho relayado ruim**, porque o caminho ruim se disfarça de LAN.

**[não verificado — precisa de teste]** Testar assim: numa sessão em que o Radmin mostra
amarelo (relay), abrir `chrome://webrtc-internals` no app e olhar o par de candidatos
selecionado. Se o par selecionado for `26.x ↔ 26.x`, a hipótese está confirmada e a VPN está
ativamente sabotando o ICE. Custo do teste: 15 minutos. É o teste de maior retorno desta
pesquisa inteira.

### 1.3 A conta de banda que mata qualquer relay gratuito

Do briefing: 12 Mbps = 1,5 MB/s = **5,4 GB/hora por fluxo**.

Cenário do usuário (5 pessoas, ~10 h/mês, 3 espectadores por transmissão):

- 3 espectadores × 10 h × 5,4 GB = **162 GB/mês** atravessando o relay.
- Um relay conta entrada **e** saída, então na prática pode ser ~324 GB/mês de tráfego
  no servidor, dependendo de como é medido.

Nenhum free tier de relay do mercado aguenta isso. Guarde esse número: ele elimina sozinho
metade das opções abaixo.

---

## 2. Tabela comparativa

Legenda de "Conta?": conta de usuário obrigatória antes de conectar.
"Admin?": exige privilégio de administrador no Windows (driver TUN/TAP).
"Cliques": estimativa de passos do zero até conectado, para um leigo.

| Ferramenta | Free tier (números) | Conta? | Admin? | Cliques | CGNAT | Relay: qualidade | Licença | Veredito p/ GoLive |
|---|---|---|---|---|---|---|---|---|
| **Radmin VPN** | "Free forever", redes ilimitadas, dispositivos ilimitados; **máx. 150 usuários por rede** | Sim (rede + senha) | **Sim** (driver) | ~8–10 | Cai p/ relay | Relay ~400 ms vs ~50 ms direto; banda não documentada | Proprietária (Famatech, BVI) | É o que existe hoje. Funciona, mas é o pior atrito e caixa-preta |
| **Tailscale** | Personal: **6 usuários**, dispositivos ilimitados, 50 tagged resources, 3 ACL groups, 1.000 min efêmeros/mês (mudou em **08/abr/2026**; antes era 3 usuários/100 devices) | **Sim** (SSO obrigatório) | Sim (cliente) | ~10–14 | DERP se NAT duro↔duro | **DERP é TCP e rate-limited**; relato de ~50 Mbps vs ~1 Gbps direto | Cliente BSD-3 | Melhor NAT traversal do mercado, mas login obrigatório e DERP TCP |
| **ZeroTier** | Reduzido para **10 dispositivos + 1 rede** (era 25 + ilimitadas) | Sim | Sim (TAP) | ~10 | Cai p/ relay | Relay próprio; stack 100% userspace, teto ~200–400 Mbps | **BSL 1.1** — uso comercial/closed-source exige licença paga | Free tier encolheu; licença é risco jurídico |
| **iroh** | Public relays grátis (US/EU/SG), **rate-limited**, sem SLA, sem auth. Pro $19/mês: **5 MB/s (=40 Mbps)**, 100 GB egress, 10k conexões. Dedicated $199/mês/região: sem rate limit, 250 GB | **Não** | **Não** (userspace, sem TUN) | **0** (embutido) | Hole punch **~90%**; ~95% do volume vai direto | Relay próprio, self-hostável | **MIT / Apache-2.0** | **Melhor candidato para embutir.** Ver §3 |
| **NetBird** | Cloud: **5 usuários / 100 máquinas**. Self-host (Community): **sem limite** de usuários/devices | Sim (cloud) | Sim | ~10 | Relay TURN próprio | Coturn; self-host ilimitado | Self-host grátis; Commercial Starter €2.000/ano | Boa alternativa ao Tailscale se aceitar self-host |
| **Nebula (Slack)** | 100% self-host, sem SaaS, sem limite | **Não** | Sim | ~15+ (certificados manuais) | Lighthouse não relaya por padrão | Precisa configurar relay explicitamente | Open source (MIT) | Config por certificado x509 — inviável para leigo |
| **EasyTier** | v2.6.4 (12/mai/2026), 13,7k ★, nós públicos comunitários grátis | **Não** | **Sim** ("run with administrator privileges") | ~6–8 | NAT4↔NAT4 + IPv6 | Relay via shared nodes | **LGPL-3.0** | Opção *sem conta* mais interessante depois do iroh. Rust, descentralizado |
| **Hamachi / LogMeIn** | **5 computadores**; pago $49/ano (6–32) | Sim | Sim | ~10 | Relay | Relay LogMeIn, historicamente lento | Proprietária | Pior que Radmin em tudo. Descartar |
| **Husarnet** | 377 ★, P2P com base servers só como failover | Dashboard (opcional) | Sim | ~8 | Base servers | Failover proxy | GPL + MPL dual | Projeto pequeno, foco IoT/ESP32. Não |
| **Twingate** | **5 usuários** (free forever, mai/2026) | Sim | Sim | ~10 | — | — | Proprietária | Zero-trust corporativo, não LAN virtual. Não |
| **Netmaker** | Community grátis; Enterprise free com **50 nós** | Sim | Sim | ~15 | — | — | Open core | WireGuard kernel, foco infra. Overkill |
| **Pritunl** | Open source, self-host | Sim | Sim | ~15 | — | — | Open core | É VPN cliente-servidor (OpenVPN/WG), não malha. Não |
| **Yggdrasil** | Grátis, sem servidor central, IPv6 overlay | **Não** | Sim | ~10 | Roteamento pela mesh | Roteia por peers | LGPL | **Experimental** por autodeclaração; latência imprevisível. Não |
| **Mycelium / Innernet / Hyprspace / n2n** | — | — | — | — | — | — | — | Nichos/experimentais, base de usuários pequena, Windows fraco. **[não verificado em detalhe]** |

### Notas e fontes da tabela

- **Radmin 150 usuários/rede + ilimitado no resto**: <https://radmin-club.com/radmin-vpn/users-limit-in-networks-important-suggestions/> e <https://www.radmin-vpn.com/> [via busca]. "60 milhões de usuários", servidores da Famatech Corp. nas Ilhas Virgens Britânicas. **Não existe documentação pública de throughput do relay do Radmin** — nem capacidade, nem limite por sessão, nem SLA. Isso é um dado em si: você está apostando 1080p60 numa caixa-preta de uma empresa offshore sem nenhum número publicado.
- **Radmin relay ~400 ms**: <https://radmin-club.com/radmin-vpn/relay-connection-vs-direct-connection/> [via busca]. Fórum oficial, não *statement* de engenharia. Também: "quanto mais redes Radmin VPN você está, menos performance você tem".
- **Tailscale Personal 6 usuários / devices ilimitados, mudança de 08/abr/2026**: <https://tailscale.com/docs/account/manage-plans/free-plans-discounts> e <https://costbench.com/software/business-vpn/tailscale/free-plan/> [via busca; tailscale.com bloqueado neste ambiente].
- **Tailscale >90% de conexões diretas**: métricas internas citadas em <https://tailscale.com/blog/nat-traversal-improvements-pt-1> [via busca]. **Atenção:** esse número é global, dominado por EUA/Europa. **[não verificado]** se vale para o parque brasileiro, que é muito mais CGNAT. Não assuma 90% no Brasil.
- **DERP ~50 Mbps vs ~1 Gbps direto**: <https://github.com/tailscale/tailscale/issues/13133> — usuário mede ~1 Gbps direto no IP público do VPS e ~50 Mbps pelo IP Tailscale via DERP. Issue aberta, `needs-triage`, **sem resposta oficial da Tailscale**. É um relato, não uma spec.
- **DERP é rate-limited de propósito**: <https://tailscale.com/docs/reference/derp-servers> [via busca] — "DERP servers enforce rate limits and fair usage policies that can throttle throughput since they're a shared resource".
- **Peer Relays (GA em 18/fev/2026)**: <https://tailscale.com/blog/peer-relays-ga> [via busca] — relays gerenciados por você, "throughputs neared that of a direct connection; often **multiple orders of magnitude higher** than Tailscale's managed DERP fleet". Essa frase da própria Tailscale é a confissão mais clara de que **o DERP público não serve para vídeo**.
- **ZeroTier 10 devices / 1 rede**: <https://toolradar.com/tools/zerotier/pricing> e <https://costbench.com/software/sd-wan/zerotier/> [via busca; zerotier.com bloqueado]. ⚠️ **Fontes terciárias agregadoras, qualidade duvidosa — confirme em zerotier.com/pricing antes de decidir.** O sentido da mudança (redução) é consistente entre as fontes; os números exatos, não.
- **ZeroTier teto 200–400 Mbps userspace**: <https://meshwg.com/alternatives/zerotier/> [via busca]. Fonte terciária. **[não verificado]**
- **NetBird cloud 5 usuários/100 máquinas**: <https://docs.netbird.io/manage/settings/plans-and-billing> e <https://costbench.com/software/business-vpn/netbird/free-plan/> [via busca].
- **iroh preços**: <https://www.iroh.computer/pricing> [via busca; site bloqueado]. Pro $19/mês, 5 MB/s, 100 GB egress; Dedicated $199/mês/região, sem rate limit, 250 GB.
- **iroh ~90% hole punch, ~95% do volume direto**: <https://www.iroh.computer/blog/comparing-iroh-and-libp2p> e <https://pinggy.io/blog/iroh_1_0_dial_keys_not_ips/> [via busca]. Mesma ressalva do Tailscale: **[não verificado]** para o Brasil.
- **EasyTier**: <https://github.com/EasyTier/EasyTier> (LGPL-3.0, 13,7k ★, sem conta, exige admin no Windows, nós públicos comunitários) e <https://github.com/EasyTier/EasyTier/releases> (v2.6.4, 12/mai/2026).
- **Hamachi 5 computadores**: <https://en.wikipedia.org/wiki/LogMeIn_Hamachi> [via busca].
- **Twingate 5 usuários**: <https://costbench.com/software/business-vpn/twingate/free-plan/> [via busca].
- **Husarnet**: <https://github.com/husarnet/husarnet> — GPL+MPL, 377 ★, base servers como failover.
- **Nebula**: <https://nebula.defined.net/docs/> [via busca] — lighthouse só responde "onde está o nó X", não relaya salvo configuração explícita.
- **Netmaker 50 nós**: <https://www.netmaker.io/pricing> [via busca].
- **Yggdrasil "experimental"**: <https://github.com/yggdrasil-network/yggdrasil-go> — a própria descrição do repo diz "An experiment in scalable routing".

---

## 3. Embutir a rede no próprio app

Esta é a parte que importa. Avaliei cada candidato contra 5 critérios:
(a) roda sem admin? (b) roda sem conta? (c) o **Chromium/WebRTC consegue usar o túnel**?
(d) licença permite distribuir num app fechado? (e) empacota num NSIS?

### 3.1 O obstáculo que quase ninguém percebe: userspace ≠ utilizável pelo Chromium

`tsnet` e `libzt` são ambos **stacks de rede em userspace**. Isso é ótimo para "não precisa de
admin" e péssimo para o seu caso, porque:

> tsnet "runs a fully self-contained Tailscale node inside your process using a userspace
> TCP/IP stack (gVisor). **No root privileges required. No system daemons to install or
> manage.**" — <https://github.com/tailscale/tailscale/blob/main/tsnet/README.md>

E a consequência:

> "Calling `Server.Listen` or `Server.Dial` routes traffic exclusively over the tailnet" —
> <https://pkg.go.dev/tailscale.com/tsnet>

Traduzindo: **o túnel só existe dentro daquele processo Go.** Não há interface de rede no
Windows. O Chromium — que é quem tem o encoder H.264 e o stack WebRTC do GoLive — **não
consegue mandar um pacote por ali**. Mesmo problema com `libzt`, que expõe `zts_bsd_socket()`
/ `zts_bsd_connect()` e não uma TUN/TAP (<https://github.com/zerotier/libzt>).

Para o Chromium usar o túnel, você precisaria de uma **TUN de verdade** — e aí volta o admin:
"Installing the Wintun virtual network adapter driver requires local administrator privileges"
(<https://www.wintun.net/> [via busca]). É possível pré-instalar o driver via instalador e
depois usar com o grupo *Network Configuration Operators*, mas a **instalação** continua
elevada. Como você já distribui um NSIS e já mexe no firewall do Windows, um prompt de UAC
único na instalação é aceitável — mas então você perdeu a vantagem do "userspace, sem admin".

**Existe uma saída para o dilema:** `tsnet` ganhou `ListenPacket` para UDP
(<https://github.com/tailscale/tailscale/issues/5871>, implementado). Dá para montar um
**proxy UDP local**: Chromium → `127.0.0.1:porta` → sidecar Go → tsnet → sidecar do outro lado
→ `127.0.0.1` → Chromium, e injetar esse endereço no SDP como candidato host. Funciona no
papel. Mas você acabou de colocar um stack TCP/IP em userspace Go (gVisor) no caminho de
36 Mbps de vídeo ao vivo — e o gVisor tem histórico ruim exatamente no Windows:
"Tailscale uses netstack within gVisor and has experienced performance issues on Windows with
default settings... Linux does not exhibit the same behavior" — throughput de **8 Mb/s** com
TCP-RACK ligado, **80 Mb/s** com loss recovery desligado
(<https://github.com/google/gvisor/issues/9778> [via busca]). 8 Mb/s é menos que um único
fluxo do GoLive. **Não faça isso.**

### 3.2 Comparação dos SDKs embutíveis

| SDK | Licença | Sem admin? | Sem conta? | Chromium usa o túnel? | Bindings p/ Node | Veredito |
|---|---|---|---|---|---|---|
| **tsnet** (Go) | **BSD-3-Clause** ✅ | **Sim** ✅ | **Não** — exige tailnet + authkey/OAuth/login | **Não** (userspace-only) ❌ | Não oficiais; via sidecar ou `libtailscale` (C, BSD-3, oficial, 337 ★, 52 commits) | Licença perfeita, arquitetura errada |
| **libzt** (C) | **BSL 1.1** ❌ | Provavelmente sim (userspace) | Sim, com controller próprio | **Não** (só socket API) ❌ | C#, Python, Rust, Java — **sem Node** | Licença **bloqueia app fechado**. Descartar |
| **wireguard-go** | MIT | Não (precisa Wintun) ❌ | Sim | Sim (é TUN real) | Não | **~95 Mbps no Wi-Fi** vs ~600 Mbps nativo. Lento demais |
| **boringtun** (Rust) | BSD-3 ✅ | Não (precisa TUN) ❌ | Sim | Sim | Via napi-rs (você escreve) | Só o cripto; você teria que escrever controle, descoberta, NAT traversal, relay. **Meses de trabalho** |
| **iroh** (Rust) | **MIT / Apache-2.0** ✅ | **Sim** ✅ | **Sim** ✅ | **Não** — mas *não precisa* (ver abaixo) | **Sim, oficiais desde 1.0** (15/jun/2026) ✅ | **O único que fecha a conta** |

Sobre licenças, dois pontos duros:

- **`libzt` é BSL 1.1.** Texto do próprio repo: "ZeroTier is free to use internally in
  businesses and academic institutions and for non-commercial purposes... certain types of
  commercial use such as **building closed-source apps and devices based on ZeroTier**...
  require a commercial license" (<https://github.com/zerotier/libzt>). O GoLive é um app entre
  amigos sem monetização, então *talvez* caia em "non-commercial" — mas "talvez" numa licença
  proprietária, distribuindo binário para terceiros, é risco desnecessário quando existe
  alternativa MIT. **Descarte.**
- **`tsnet` é BSD-3-Clause** (<https://pkg.go.dev/tailscale.com/tsnet>), sem nenhuma restrição
  de uso. A licença não é o problema do Tailscale; a **exigência de conta** é. `tsnet` aceita
  `Server.AuthKey`, `TS_AUTHKEY`, OAuth ou login interativo — todos pressupõem um tailnet
  existente. Você poderia embarcar uma authkey reutilizável no instalador, mas aí ela está no
  binário, qualquer um extrai, e entra na *sua* tailnet. Ou rodar **headscale** próprio
  (`--login-server=https://seu.dominio --authkey=...`,
  <https://oneuptime.com/blog/post/2026-03-02-how-to-set-up-headscale-self-hosted-tailscale-on-ubuntu/view>),
  mas aí você tem servidor, domínio, TLS e custo fixo — e quebrou o "sem servidor na nuvem".

### 3.3 Por que o iroh é o único que fecha a conta

`iroh` **não é uma VPN**. Não cria interface de rede, não tem IP virtual. É uma biblioteca que
abre **conexões QUIC diretas entre chaves públicas**, com hole punching e fallback de relay
(<https://github.com/n0-computer/iroh>). Isso muda tudo:

- **MIT/Apache-2.0** — pode distribuir em app fechado, sem dúvida jurídica.
- **Sem conta.** Identidade = par de chaves gerado localmente. "dial by public key".
- **Sem admin.** Não instala driver, não cria adaptador. Só abre sockets UDP como qualquer app.
- **Bindings oficiais de Node.js** desde a 1.0 (15/jun/2026)
  (<https://www.techtimes.com/articles/318490/20260616/peer-peer-library-iroh-10-ships-dial-devices-key-not-ip-address.htm>
  [via busca]). Isso é exatamente o que Electron precisa: um módulo nativo, não um sidecar.
- **NSIS**: é um `.node` nativo dentro do `asar`/`resources`. Empacotamento trivial.
- **Hole punching ~90%**, ~95% do volume indo direto.
- **Relay self-hostável** (`iroh-relay`), e os relays públicos do n0 são grátis.
- **Cliques até conectar: zero.** O usuário abre o GoLive e pronto.

**O preço:** o iroh **não transporta o WebRTC do Chromium**. Ele te dá um socket QUIC em
Node. Para usar, o GoLive teria que parar de usar `RTCPeerConnection` para a mídia e passar a
empurrar frames H.264 codificados por QUIC datagrams — o que significa reimplementar
jitter buffer, controle de congestionamento adaptativo, FEC, retransmissão seletiva e a
escada de qualidade que o WebRTC te dá de graça. **Isso é uma reescrita do núcleo de mídia,
não uma troca de VPN.** É a "mudança radical" que o usuário pediu para considerar — mas
precisa ser dimensionada honestamente: são semanas a meses, e o WebRTC do Chromium tem uma
década de tuning de congestion control que você não vai replicar.

### 3.4 O caminho barato que ninguém falou: nem VPN, nem iroh

Se a única coisa que a overlay te dá é o relay (§1.1), então a versão mínima é:

**Mantenha o WebRTC. Jogue a VPN fora. Adicione TURN.**

- ICE passa a fazer o furo de NAT diretamente (é bom nisso), em vez de fazer por baixo de
  outra camada que faz a mesma coisa.
- O fallback vira TURN sobre **UDP**, não TCP como o DERP.
- Zero instalação de terceiros. O atrito de onboarding (dor #3 do briefing) some inteiro.
- A privacidade *melhora* em relação a hoje: TURN encaminha bytes DTLS-SRTP cifrados
  ponta-a-ponta que o servidor não consegue ler — enquanto hoje você confia num relay
  proprietário da Famatech, sediado nas Ilhas Virgens Britânicas, sem auditoria.

O custo é um coturn num VPS, e ele só é usado quando o P2P falha. Nos ~162 GB/mês do pior
caso (§1.3), você precisa de um VPS com tráfego generoso. **[não verificado]** — não consegui
confirmar preços de Hetzner/Oracle neste ambiente (domínios bloqueados). A Frente 2/3 deve
fechar esse número; a ordem de grandeza esperada é **um dígito de dólares por mês**, e só se
o relay for realmente usado.

---

## 4. CGNAT e IPv6 no Brasil

### O problema
CGNAT é a regra, não a exceção:

- **Vivo Fibra** "aplica CGNAT por padrão na maioria dos planos residenciais em 2025-2026",
  usando `100.64.0.0/10`, com portas 80/443/25 bloqueadas —
  <https://www.sabermeuip.com.br/vivo-fibra-portas-bloqueadas> [via busca].
- **Claro/NET** "usa CGNAT na maioria dos planos residenciais de fibra e cabo, colocando
  dezenas de assinantes atrás de um único IP público e bloqueando qualquer conexão de
  entrada"; implantação começou ~2018 — <https://www.sabermeuip.com.br/claro-net-cgnat> [via busca].
- **Não achei percentuais por operadora.** Nenhuma fonte pública dá "X% dos assinantes da
  Vivo estão em CGNAT". **[não verificado]** — trate como "maioria", não como número.

CGNAT sozinho ainda permite hole punching se o NAT for *endpoint-independent* ("easy NAT").
O que mata é **NAT simétrico**. O Tailscale só relaya quando "both devices have a hard NAT
configuration, or one has hard and the other easy"
(<https://tailscale.com/docs/reference/connection-types> [via busca]). **[não verificado]**
qual a proporção de NAT simétrico entre as operadoras brasileiras — esse é o número que
realmente decide o destino do projeto, e ele não existe publicado. **Recomendo medir**:
o próprio GoLive pode rodar um teste de tipo de NAT (RFC 5780) nos 5 amigos e reportar. Uma
tarde de trabalho, e você para de adivinhar.

### A saída: IPv6 ponta a ponta

Este é o dado mais animador da pesquisa inteira:

- **Brasil está em ~50,15% de adoção de IPv6** — 2º da América do Sul, atrás do Uruguai (62%)
  — <https://pulse.internetsociety.org/blog/the-silent-revolution-of-ipv6-in-brazil-50-adoption-milestone-achieved>
  [via busca]. Global passou de 50% em 28/mar/2026
  (<https://pulse.internetsociety.org/en/blog/2026/04/18-years-later-ipv6-reaches-majority/>).
- **"Vivo Fibra e Claro distribuem IPv6 em grande parte do parque residencial em 2025-2026,
  enquanto TIM Live e Oi Fibra estão em expansão"**; na Claro, "o v4 é compartilhado e o v6 é
  o seu endereço de verdade" — <https://www.sabermeuip.com.br/como-configurar-ipv6> [via busca].
- **O Chromium já coleta candidatos ICE IPv6 automaticamente** em hosts com IPv6
  (<https://oneuptime.com/blog/post/2026-03-20-webrtc-ipv6-ice-candidates/view> [via busca]).

**Consequência direta:** quando os dois lados têm IPv6 nativo, **não há NAT nenhum** e o
WebRTC conecta direto — sem VPN, sem STUN, sem TURN, sem CGNAT. A 50% por ponta, a chance dos
dois terem IPv6 é ~25% se independentes — e na prática **mais alta**, porque amigos brasileiros
tendem a estar nas mesmas operadoras grandes, que são justamente as que já têm IPv6.

⚠️ Duas ressalvas honestas:
1. O roteador/CPE precisa estar com IPv6 ligado. Muitos vêm ligados de fábrica na Vivo e TIM
   Live, mas nem todos.
2. Há histórico de bugs de ICE com IPv6 no Chrome especificamente —
   <https://github.com/feross/simple-peer/issues/436> ("Ice connection fails in Chrome when
   IPv6 is enabled, works in Firefox"). Precisa testar, não assumir.

**Ação concreta e barata:** garanta que o GoLive **não filtra candidatos IPv6** no ICE e que a
sinalização os transporta. Se hoje ele roda dentro do Radmin (IPv4 `26.x`), é bem possível
que o caminho IPv6 nem esteja sendo tentado. Isso pode ser a correção de maior impacto por
linha de código do projeto inteiro.

---

## 5. Riscos

| Risco | Gravidade | Comentário |
|---|---|---|
| **ICE prefere o caminho relayado da VPN** (§1.2) | 🔴 Alta | Se confirmado, a VPN está *causando* a dor #1 do briefing, não resolvendo |
| Radmin: zero transparência de throughput/capacidade do relay | 🔴 Alta | Empresa offshore (BVI), protocolo fechado, nenhum número publicado. Você aposta 1080p60 numa caixa-preta |
| Radmin: "free forever" pode mudar | 🟡 Média | Já aconteceu com ZeroTier (25→10 devices) e Tailscale (3→6 users, mudou duas vezes). Não há contrato |
| Privacidade — hoje já não é "ninguém no meio" | 🟡 Média | Quando o Radmin cai para relay, **o tráfego passa pelos servidores da Famatech**. O valor declarado do projeto já está quebrado hoje, silenciosamente. TURN próprio seria *mais* privado |
| Tailscale: login obrigatório | 🟡 Média | Quebra "sem conta". Contornável só com headscale, que quebra "sem servidor" |
| `libzt` BSL 1.1 | 🟡 Média | Ambíguo para distribuição. Evitável — use MIT |
| gVisor/netstack no Windows: 8–80 Mb/s | 🔴 Alta | Mata qualquer plano de tunelar mídia por tsnet |
| wireguard-go userspace: ~95 Mbps no Wi-Fi | 🟡 Média | Serviria para 1 fluxo, não para 3 |
| Reescrever mídia sobre QUIC (iroh) | 🔴 Alta | Perde uma década de congestion control do WebRTC. Não subestime |
| Dados de "90% direto" são globais | 🟡 Média | Ninguém publica número para o Brasil. Podem ser otimistas demais aqui |
| **O upload do transmissor continua sendo o teto** | 🔴 Alta | **Nenhuma opção desta frente resolve a dor #2.** 3×12 Mbps = 36 Mbps de upload. Trocar de VPN não cria banda |

---

## 6. Veredito

**1. "Radmin VPN é a única opção gratuita?" — Não.** Tailscale (6 usuários), NetBird
(5 usuários cloud, ilimitado self-host), EasyTier (LGPL, sem conta, sem limite) e iroh
(MIT, sem conta) são todos gratuitos para o tamanho do GoLive. O Radmin ganha só em
"dispositivos ilimitados numa rede sem login individual" — e paga por isso com opacidade
total e o pior onboarding da lista.

**2. "Dá pra embutir a rede no app?" — Sim, mas não a *VPN*.**
- `libzt`: **descarte** (BSL 1.1, sem binding Node, userspace inutilizável pelo Chromium).
- `tsnet`: licença ótima (BSD-3), mas exige conta e é userspace-only; tunelar mídia por ele
  esbarra em 8–80 Mb/s de gVisor no Windows. **Descarte para mídia.**
- `wireguard-go`/`boringtun`: exigem admin e, no caso do boringtun, meses de trabalho para
  construir tudo em volta. **Descarte.**
- `iroh`: **é o único tecnicamente viável** — MIT, sem conta, sem admin, bindings Node
  oficiais, ~90% hole punch, zero cliques. Mas cobra o preço de reescrever o transporte de
  mídia.

**3. A recomendação, em ordem de retorno sobre esforço:**

- **Primeiro, gaste 15 minutos** testando a hipótese §1.2 no `chrome://webrtc-internals`.
  Se o ICE está escolhendo o caminho relayado do Radmin quando existia um direto, você
  descobriu a causa raiz da dor #1 sem escrever uma linha.
- **Segundo, gaste uma tarde** garantindo que candidatos IPv6 são coletados e transportados
  na sinalização. Com ~50% de IPv6 no Brasil e crescendo, isso elimina CGNAT de vez para uma
  fração relevante dos pares — de graça, sem servidor, sem conta.
- **Terceiro: tire a VPN e coloque TURN.** Mantém o WebRTC (e seu congestion control),
  elimina a instalação de terceiros, troca um relay TCP opaco por um relay UDP que você
  controla, e melhora a privacidade em vez de piorar.
- **Só então**, se o TURN provar ser caro ou insuficiente, considere o iroh — sabendo que é
  uma reescrita do núcleo de mídia, não uma troca de biblioteca.

**4. O que nenhuma opção desta frente resolve:** o upload do transmissor. 3 espectadores a
12 Mbps são 36 Mbps de subida na origem, e fibra residencial brasileira raramente entrega
isso de forma estável. **Esse é o teto real do produto**, e ele é assunto das Frentes 2/3
(SVC, SFU, codecs mais eficientes, degradar resolução) — não de qual VPN você usa.

---

## 7. Lacunas desta pesquisa

Itens que eu **não** consegui confirmar e que alguém deveria fechar:

1. **Throughput e capacidade do relay do Radmin VPN** — nenhum número publicado existe.
2. **Números exatos do free tier atual do ZeroTier** — só fontes terciárias agregadoras.
3. **Percentual de CGNAT e de NAT simétrico por operadora brasileira** — não existe público.
   **Meça você mesmo** (RFC 5780) nos 5 amigos; é o dado que mais importa.
4. **Taxa de conexão direta de Tailscale/iroh especificamente no Brasil** — só há número global.
5. **Preços de VPS com tráfego generoso** (Hetzner, Oracle Always Free) — domínios bloqueados
   neste ambiente.
6. **Maturidade real de n2n, Mycelium, Innernet, Hyprspace** — avaliados só superficialmente;
   nenhum parece competitivo, mas não aprofundei.
