# Como o GoLive deve transmitir a tela — síntese da pesquisa

**Data:** 2026-09-16 · **Versão analisada:** 0.16.0 · **Status:** pesquisa, não decisão

Cinco frentes de pesquisa paralelas responderam à pergunta: *"Radmin VPN é a única
opção gratuita? O ngrok serve? Vale uma mudança radical?"* Os relatórios completos,
com URL em cada número, estão nos arquivos `frente1..5` deste diretório;
`frente0-codigo.md` é a leitura do próprio código.

---

## Leia isto antes de acreditar em qualquer número aqui

A política de egresso da sessão de pesquisa **bloqueou o acesso direto à maioria
dos domínios de fornecedor** (`cloudflare.com`, `tailscale.com`, `ngrok.com`,
`livekit.io`, `oracle.com`, `zerotier.com`, entre outros). Só `github.com` e
`pkg.go.dev` passaram. A maior parte dos números veio de **trechos indexados pelo
buscador**, não da leitura da página. O orçamento de buscas da sessão esgotou no
fim de três das cinco frentes.

Cada relatório marca o que foi lido na fonte e o que não foi. **Nada aqui deve
virar decisão de arquitetura sem reconferir os números que sustentam a escolha**
— em especial os preços e franquias da Cloudflare, que são o eixo de quase toda
a recomendação.

---

## A tese

> **O Radmin VPN não é uma alternativa ao TURN. Ele *é* o TURN do GoLive —
> terceirizado, opaco, sem SLA e pelo transporte errado.**

O app nunca precisou de uma rede virtual. Ele precisava de um relay de último
recurso para quando o furo de NAT falha, e a VPN foi o jeito de conseguir isso
sem escrever código. O preço disso aparece em quatro lugares:

1. **Latência** — o relay da Radmin passa de 400 ms, contra ~50 ms do caminho direto.
2. **Onboarding** — instalar um app de terceiros, criar rede, convidar, trocar IP `26.x`.
3. **Privacidade** — quando cai para relay, a mídia atravessa servidores da
   Famatech (BVI, protocolo fechado). **A promessa de "ninguém no meio" já está
   quebrada hoje, em silêncio.** Um TURN próprio seria *mais* privado: DTLS-SRTP
   ponta a ponta que o relay não tem chave para ler.
4. **Possivelmente, conectividade** — ver "a suspeita" abaixo.

Duas frentes chegaram a esta conclusão por caminhos independentes.

## A suspeita que precisa ser testada antes de tudo

Candidatos ICE do tipo `host` têm *type preference* 126, a mais alta da RFC 8445.
O adaptador virtual da Radmin aparece ao Chromium como LAN comum — então o par
`host↔host` pela VPN tende a **vencer** o par direto real, mesmo quando, por
baixo, está indo pelo relay da Radmin a 400 ms.

Se isso se confirmar, **a VPN não está salvando as conexões: está sabotando-as.**
E o mesmo vale para um caminho IPv6 perfeito, que seria descartado em favor do
`26.x`. O comentário em `src/renderer/mesh.js:4-9` descreve esse desenho como
rede de segurança; a hipótese é que ele funcione como armadilha.

**Custo de testar: 15 minutos** em `chrome://webrtc-internals`, numa sessão com o
Radmin em amarelo, olhando qual par foi selecionado.

## O que o ngrok respondeu (a pista do dono do projeto)

**Para a mídia: não, por três paredes independentes.**

| Parede | Número |
|---|---|
| Não tem UDP | Issue aberta em set/2013, repo arquivado em jun/2024 sem ela |
| Franquia | 1 GB/mês = **11 min** de um fluxo a 12 Mbps; **3 min 47 s** com 3 espectadores |
| Sessão | Máximo de 2 h — derruba a transmissão no meio |

Forçar SRTP por TCP traz *head-of-line blocking*: com RTT de 100 ms, uma única
perda custa ≥100 ms, metade do orçamento de 200 ms.

Dois pontos **a favor** da intuição, que merecem registro: o ngrok **tem PoP em
São Paulo** (o desvio geográfico não era a objeção) e os **ToS dele não proíbem
streaming** — o freio é a cota, não o contrato. Dos 18 túneis avaliados, só
playit.gg e Pinggy passam na triagem de UDP + grátis + PoP sul-americano, e
ambos caem depois (região só no plano pago; timeout de 60 min).

**Mas a ideia acerta em outro lugar.** A sinalização de uma sala de 5 pessoas são
**~250 KB por sessão** — razão mídia:sinalização de **1:200.000**. Ali um túnel
elimina a abertura de porta no firewall e a LAN virtual, e o convite vira uma URL
colável. Ver "Passo 2".

---

## O que sobrou de pé, por dor do briefing

| Dor | Solução | Custo | Esforço |
|---|---|---|---|
| 1. Radmin cai para relay lento | TURN (Cloudflare, PoP BR) | US$ 0 | 1 linha + Worker |
| 3. Atrito de instalação da VPN | TURN + sinalização na nuvem | US$ 0 | dias |
| 4. Sala morre com o host | Sinalização em Durable Object | US$ 0 | dias |
| 2. Upload do transmissor (12 Mbps × N) | SFU, ou AV1 por hardware | US$ 0 até 1 TB | semanas |
| 5. Teto de ~4 pessoas | SFU | idem | semanas |

**Nenhuma troca de VPN resolve as dores 2 e 5.** Trocar de VPN não cria banda.

### A conta que decide tudo

12 Mbps = **5,4 GB/hora** por fluxo. Sala de 5 pessoas = **21,6 GB/hora**.
Cenário do briefing (10 h/mês) = **216 GB/mês**.

| Opção | Franquia grátis | Horas/mês | Custo do cenário |
|---|---|---|---|
| **Cloudflare Realtime** (SFU **e** TURN) | 1 TB/mês | **46,3 h** | **US$ 0,00** |
| Oracle Always Free + coturn | 10 TB/mês | 463 h | US$ 0,00 |
| Daily.co | 10.000 part-min | 33,3 h | US$ 0,00 |
| ExpressTURN | 100 GB | 4,6 h | US$ 9/mês por 5 TB |
| LiveKit Cloud | 50 GB | **2 h 18 min** | ~US$ 22-26/mês |
| Metered / Xirsys | 20 GB / 0,5 GB | 54 min / 1,4 min | inúteis nesta escala |
| **Twilio** | — | — | **US$ 173/mês** (US$ 0,80/GB no BR, 2× o preço US/EU) |
| **AWS São Paulo** | 100 GB | 4,6 h | **US$ 3,24 por hora** de transmissão |

Três armadilhas confirmadas: **Twilio cobra o dobro no Brasil**; **AWS São Paulo
é a região mais cara do mundo** (US$ 0,15/GB); e **Hetzner está fora apesar dos
20 TB** — ~200 ms de RTT Brasil↔Alemanha estouram sozinhos o orçamento de
latência, e um SFU *dobra* o caminho da mídia.

**Regra que saiu da pesquisa: o relay tem que estar no Brasil, ou ser anycast com
PoP brasileiro.** Isso elimina mais candidatos que qualquer critério de preço.

⚠️ **A franquia de 1 TB da Cloudflare é compartilhada entre SFU e TURN.** Usar os
dois não dobra o gratuito.

---

## O dado que não existe no mundo e decide o desenho

**Ninguém publicou se o CGNAT das operadoras brasileiras é *endpoint-independent*
(EIM) ou *endpoint-dependent* (EDM).** E isso muda tudo:

- **CGNAT ≠ NAT simétrico.** CGNAT impede *abrir porta*; não impede *hole
  punching* — e o GoLive só precisa de hole punching.
- Se o CGN da Vivo/Claro for EIM, o furo funciona e o TURN é fallback raro.
- Se for EDM, quase toda sessão cai em relay, e a conta de banda acima passa a
  ser o caso **normal**, não o pior caso.

Confirmado: Vivo usa 100.64/10 com portas 80/443/25 bloqueadas; Claro/NET tem
CGNAT obrigatório. O comportamento EIM/EDM, não.

**Referência moderna de hole punching: 70% ±7,1%**, medido em produção com 4,4 M
de tentativas em 167 países (arXiv 2510.27500), consistente com os 20-25% de
necessidade de TURN reportados pela indústria WebRTC.

**Isto é medível numa tarde**, instrumentando `RTCIceCandidatePairStats` e uma
sonda RFC 5780 nos cinco amigos reais. É a ação de maior informação por esforço
de toda a pesquisa — e produziria um dado que hoje não existe publicado.

### IPv6: ~20% dos pares de graça

O Brasil está entre **44,2%** (Cloudflare Radar) e **~50%** (NIC.br/ISOC) de
adoção — as fontes divergem. Com IPv6 dos dois lados **não há NAT nenhum**, e o
firewall do CPE não impede: ele casa a 5-tupla mas **não muda a porta**, então os
checks simultâneos do ICE furam com STUN puro.

O Chromium já coleta e prefere IPv6 sozinho, e **`mesh.js` não filtra candidato
nenhum** (verificado). O servidor de sinalização já escuta dual-stack
(`signaling-core.js:355` usa `new WebSocketServer({ port })` sem host).

**Mas há um bloqueio bobo no caminho:** `src/main/network.js:21` e
`src/main/discovery.js:53` fazem `if (addr.family !== 'IPv4') continue`. O app é
**incapaz de mostrar um endereço IPv6 ao host** — então, com tudo pronto por
baixo, ninguém tem o que digitar. Uma tarde de trabalho (mais a sintaxe
`ws://[::1]:9000`, que a normalização em `app.js:1432` não trata).

---

## O contexto que ninguém tinha olhado: o problema original ainda existe?

A suspensão do Go Live foi **medida preventiva da ANPD de 12/08/2026** — primeira
fiscalização sob o **ECA Digital (Lei 15.211/2025)** —, cumprida pelo Discord em
17/08. **Voz e texto não foram afetados; o Discord inteiro não caiu.** Recurso em
24/08; AGU pedindo R$ 500 mi. Em vigor, sem data de volta.
*(Status das últimas semanas de setembro: não verificado — domínios de notícia
bloqueados na sessão.)*

**O detalhe que vira o jogo:** o Discord **já verificava idade por selfie/RG no
Brasil desde março de 2026 e caiu assim mesmo.** O que a ANPD apontou foi a
**incapacidade de moderar transmissão ao vivo em tempo real** — critério que o
GoLive falha de forma ainda mais completa, por desenho. Hoje o risco regulatório
é ~zero por irrelevância; ele aparece **exatamente no cenário de sucesso**.

O ECA Digital manda aplicar obrigações proporcionalmente ao porte e ao grau de
interferência sobre o conteúdo (o GoLive tem grau zero), mas a consulta pública
do MJSP perguntou **explicitamente** sobre arquiteturas descentralizadas e sobre
repartir responsabilidade com desenvolvedores de protocolo. Está na mesa, sem
resposta fechada.

### Ideias mortas com fonte primária

- **"Virar um Moonlight de sala": morta.** Issue LizardByte/Sunshine#3887, fechada
  como *not planned* — **o Sunshine não faz fan-out multi-espectador**. Resolveria
  latência (que não é o gargalo) e não resolveria fan-out nem upload (que são).
  Moonlight-qt é GPL-3.0: reusar contamina a licença.
- **MoQ: cedo.** Draft-17, RFC previsto para 2027-2028, encaixe declarado em
  apostas/leilões e *explicitamente não* chamada bidirecional. E adotá-lo é
  abandonar o P2P.
- **Embutir a VPN no app: 2 de 3 candidatos caem.** `libzt` é BSL 1.1 (proíbe app
  de código fechado). `tsnet` tem licença ótima mas é userspace via gVisor — o
  Chromium não manda pacote por ali, e o throughput bate em 8-80 Mb/s, menos que
  *um* fluxo. Só `iroh` fecha (MIT, bindings Node desde jun/2026, ~90% de hole
  punch), ao preço de reescrever o transporte sobre QUIC e perder o congestion
  control do WebRTC.
- **Web app completo: não.** Áudio de sistema até funciona no Chrome/Edge, mas
  áudio **por processo**, atalho global, overlay de rabisco e o servidor embutido
  são irrecuperáveis. O resultado seria um Kosmi pior — que já existe e já se
  posiciona como saída para o bloqueio brasileiro.
- **"TURN caseiro na casa de um amigo": não funciona** — ironicamente pelo mesmo
  motivo do resto: servidor TURN precisa de porta de entrada, e o amigo está atrás
  de CGNAT. Upload já não é obstáculo (Claro 350 Mega dá 150 Mbps de subida).

### O concorrente que dói

**Steam Remote Play Together:** grátis, até 4 jogadores, só o host precisa ter o
jogo, convidados entram **por link sem conta Steam**, relay da Valve quando o P2P
falha. É o GoLive inteiro — mesmo teto de 4, mesmo encode por hardware, mesmo
fallback — feito pela Valve. Só não serve para "mostrar qualquer tela".

---

## A ideia que não estava no roadmap

**Transmissor nativo + espectador como página web por link.**

Um instala, três clicam. Mata ~75% do atrito de onboarding sem perder nenhum
diferencial: quem transmite continua nativo (áudio por processo, atalho global,
overlay na tela real); quem só assiste não instala nada. Combina com qualquer um
dos caminhos abaixo e é independente da escolha TURN-vs-SFU.

---

## Ordem de ataque recomendada

A pesquisa **não** recomenda escolher agora entre "TURN e continuar P2P" e "SFU e
mudar tudo". Os dois caminhos compartilham os mesmos dois pré-requisitos, e o
dado que decide entre eles ainda não foi medido.

| # | Passo | Esforço | O que resolve |
|---|---|---|---|
| **0** | `chrome://webrtc-internals`: o candidato `26.x` está sequestrando o ICE? | **15 min** | Informação. Pode explicar a dor nº 1 inteira |
| **1** | Instrumentar `RTCIceCandidatePairStats` + sonda RFC 5780 nos 5 amigos | **1 tarde** | Produz o dado EIM/EDM que não existe publicado |
| **2** | Sinalização pela internet (Worker + Durable Object) | dias | Dores 3 e 4. **Pré-requisito dos dois caminhos** |
| **3** | TURN da Cloudflare no `RTC_CONFIG` + Worker de credencial efêmera | 1 linha + Worker | Dor 1. Aposenta o Radmin |
| **4** | Espectador web por link | dias | ~75% do atrito |
| **5** | SFU — **só se** a sala realmente passar de 4 pessoas | semanas | Dores 2 e 5 |
| **6** | Se o SFU entrar: E2EE por Encoded Transform | semanas | Recupera a promessa de privacidade |

O passo 2 é o mais subestimado: hoje a descoberta depende de **broadcast UDP na
LAN** (`src/main/discovery.js`, 362 linhas), que não atravessa internet. **Matar a
VPN sem resolver a sinalização é regressão, não migração** — "Salas na sua rede"
simplesmente deixa de existir. Em compensação, `src/main/firewall.js` (104 linhas)
e o pedido de elevação do Windows **somem**, o que é atrito de instalação puro.

### Sobre o SFU (passo 5)

A favor: **uma mudança elimina 4 das 5 dores.** Um SFU com IP público *é* um
relay, e cada cliente faz conexão **de saída** — atravessa CGNAT e NAT simétrico
sem esforço. Radmin desnecessário, TURN desnecessário, árvore desnecessária,
upload do transmissor cai de 48 para **12 Mbps fixos**, sala não morre com o host.
Encode-once: de 4 sessões NVENC para 1. CPU é irrelevante (SFU não transcodifica:
~2-5% de um core no nosso caso) — **o gargalo é 100% banda**. Cloudflare Realtime
faz **H.264 passthrough**, então o pipeline NVENC atual passa intacto.

Contra: quebra "sem ninguém no meio" (DTLS-SRTP é salto a salto), **exige conta
Cloudflare e um endpoint que emita token** — não dá para embutir o segredo num
app desktop —, e joga fora `src/renderer/tree.js` mais a orquestração já depurada
ao longo de ~15 releases. A privacidade é recuperável: a Cloudflare abriu o código
do **Orange Meets com E2EE via MLS**, client-side, sobre o próprio Realtime SFU
(o W3C ainda desaconselha formalmente, e metadados seguem visíveis).

`mediasoup 3.27.1` (ISC, publicado em 2026-09-16) é literalmente `npm i` dentro do
processo Electron que já existe — o único SFU com esse encaixe, caso a opção
"hospedar neste PC" volte à mesa. **Pendência: não confirmado se instala no
Windows sem toolchain Python/MSVC.**

---

## Os cinco questionamentos

O dono do projeto pediu questionamentos, não só opções. Estes são os que a
pesquisa levantou e que **nenhum código responde**:

1. **O que você faz no dia em que o Go Live voltar?** A medida é administrativa e
   reversível. Se a resposta for "o app perde a razão de ser", isso deveria mudar
   quanto se investe agora. Se for "continua valendo por X", **X é o produto** —
   e X não é "transmitir tela", que o Discord faz melhor.

2. **"Sem ninguém no meio" é princípio ou racionalização?** Hoje, quando o Radmin
   cai para relay, a mídia atravessa servidores de uma empresa offshore sem você
   escolher nem saber. Um TURN seu seria mais privado. **Se o princípio vale,
   ele está sendo violado agora; se não vale, ele não deveria bloquear o SFU.**
   Não dá para ter os dois.

3. **Quantas das suas sessões são "jogar junto" e quantas são "assistir junto"?**
   Para a primeira, o Steam Remote Play Together já ganha (grátis, link, sem
   conta). Para a segunda, Syncplay ganha. **O nicho residual — "mostrar qualquer
   tela, para 3-6 amigos, em 1080p60" — justifica manter 19 mil linhas?**

4. **Por que o espectador-web não estava no roadmap?** É a mudança de maior
   retorno sobre esforço da lista inteira e não depende de decidir nada acima.

5. **Os quatro amigos têm encoder AV1 por hardware?** (RTX 40+, RDNA3, Arc.) Se
   sim, AV1 corta o upload de 36 para 18 Mbps **sem servidor nenhum, sem quebrar
   P2P e sem quebrar a promessa de privacidade** — a única solução para a dor 2
   que não custa arquitetura. São quatro pessoas com nome e sobrenome: resolve-se
   com três mensagens no grupo.

---

## Pendências que podem mudar a conta

1. O ingress conta na franquia de 1 TB da Cloudflare? (Se sim, o teto cai de 46 h
   para ~37 h.)
2. Há sobretaxa de egress para o Brasil no Realtime?
3. `mediasoup` instala no Windows sem toolchain?
4. A Oracle aplica mesmo o *reclaim* por ociosidade (<20% de CPU no p95 de 7 dias)?
   Um SFU que roda 3 h/semana é exatamente esse perfil. O Ampere A1 já encolheu de
   4 OCPU/24 GB para 2 OCPU/12 GB em 15/06/2026.
5. Compatibilidade de Insertable Streams com encoder H.264 de hardware no Electron.
6. **Todos os preços e franquias da Cloudflare** — eixo da recomendação, obtidos
   por busca indexada e não por leitura da página.
