# FRENTE 5 — A mudança radical: o problema ainda existe? E o que os outros fazem?

Pesquisa: 2026-09-16. Autor: agente de pesquisa (frente 5).

## Nota de método (leia antes de confiar em qualquer número)

Duas limitações reais desta pesquisa, declaradas de saída:

1. **O proxy de rede desta sessão bloqueou o `WebFetch` para quase todos os
   domínios relevantes** — `gov.br`, `planalto.gov.br`, `conjur.com.br`,
   `migalhas.com.br`, `techtudo.com.br`, `support.discord.com`, `parsec.app`,
   `store.steampowered.com`, `developers.cloudflare.com`, `cybernews.com`,
   `jurishand.com`, `chromestatus.com`. Só `github.com` passou. Portanto **não
   li a fonte primária com os meus olhos** na maioria dos casos: o que tenho é
   o conteúdo que o buscador extraiu dessas páginas, com a URL. Sempre que for
   esse o caso eu marco **[via busca, página não aberta]**.
2. **O orçamento de buscas da sessão (200) esgotou** após 17 buscas minhas.
   Ficaram sem confirmação: status do Discord nas duas últimas semanas de
   setembro/2026, preço do Parsec Warp, adoção de AV1 por hardware, preço de
   VPS. Marcados **[não verificado]**.

Onde eu não achei, eu escrevo "não achei". Não preenchi buraco com memória.

---

# 1. O problema original ainda existe?

## 1.1 O que aconteceu, com precisão

**Não foi a ANATEL. Não foi decisão judicial de bloqueio. Não foi decisão
comercial do Discord. Foi a ANPD, usando o ECA Digital.**

| Data | Fato | Fonte |
|---|---|---|
| 2026-07-22 | Suicídio de adolescente de 13 anos em Naviraí/MS, caso que envolveu o Discord e teve repercussão nacional. É o gatilho. | [gov.br/anpd](https://www.gov.br/anpd/pt-br/assuntos/noticias/em-medida-preventiva-anpd-determina-que-discord-suspenda-transmissoes-ao-vivo-no-brasil) *[via busca, página não aberta — gov.br bloqueado]* |
| 2026-08-12 | **ANPD emite medida preventiva** determinando que o Discord suspenda as transmissões ao vivo no Brasil. É a **primeira vez que a ANPD exerce competência fiscalizatória a partir do ECA Digital (Lei 15.211/2025)**. Prazo dado: 3 dias úteis. | [conjur.com.br/2026-ago-13](https://conjur.com.br/2026-ago-13/anpd-suspende-transmissoes-ao-vivo-do-discord-no-brasil/) · [dataprivacybr.org](https://www.dataprivacybr.org/anpd-suspende-lives-no-discord/) · [lawletter.com.br](https://lawletter.com.br/articulista/camila-betanin-1/discord-anpd-medida-preventiva-eca-digital-lei-15211-direito-gamer) *[via busca]* |
| 2026-08-17 | **Discord cumpre** e suspende **por tempo indeterminado** todos os recursos de vídeo e compartilhamento de tela na jurisdição brasileira. | [migalhas.com.br/462598](https://www.migalhas.com.br/quentes/462598/discord-suspende-lives-no-brasil-apos-determinacao-da-anpd) · [cartacapital.com.br](https://www.cartacapital.com.br/toquetec/discord-suspende-recursos-de-video-no-brasil-apos-determinacao-da-anpd/) *[via busca]* |
| 2026-08-24 | Discord entra com **recurso formal** para reverter. ANPD confirma o recebimento. | [cnnbrasil.com.br](https://www.cnnbrasil.com.br/politica/discord-entra-com-recurso-para-retomar-transmissoes-ao-vivo/) · [gpsbrasilia.com.br](https://gpsbrasilia.com.br/discord-questiona-anpd-e-tenta-liberar-transmis/) *[via busca]* |
| 2026-08 (depois) | **AGU processa o Discord na Justiça Federal**, pedindo R$ 500 milhões e um pacote de mudanças em 15 dias, sob **multa diária de R$ 500 mil**. | [migalhas.com.br/463309](https://www.migalhas.com.br/quentes/463309/governo-processa-discord-pede-r-500-mi-e-cobra-protecao-a-menores) · [bpmoney.com.br](https://bpmoney.com.br/inovacao/tecnologia/discord-tera-audiencia-com-justica-federal-sobre-protecao-de-criancas-e-adolescentes/) *[via busca]* |

Processo administrativo da ANPD: **nº 00261.004804/2026-54** (Nota Técnica nº 1,
versão pública, sobre Discord Inc.) —
[gov.br/anpd, PDF](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/documentos-tecnicos-orientativos/nota_tecnica_1_versao_publica_discord-inc.pdf/@@display-file/file)
*[não consegui abrir o PDF: gov.br bloqueado. O número do processo veio do
título do resultado de busca.]*

## 1.2 Escopo exato da suspensão

**Só vídeo. O Discord inteiro NÃO está bloqueado no Brasil.**

- **Suspenso:** toda comunicação de vídeo em tempo real — Go Live, câmera e
  compartilhamento de tela — em DMs, group DMs, canais de voz e canais de
  palco.
- **Não afetado:** voz em tempo real e mensagens de texto continuam
  funcionando.

Fontes: [gov.br/anpd](https://www.gov.br/anpd/pt-br/assuntos/noticias/em-medida-preventiva-anpd-determina-que-discord-suspenda-transmissoes-ao-vivo-no-brasil),
[support.discord.com — "Why video features are currently unavailable in
Brazil"](https://support.discord.com/hc/en-us/articles/42704051358359-Why-video-features-are-currently-unavailable-in-Brazil)
*[via busca; não consegui abrir a página de suporte do Discord, domínio
bloqueado — mas a existência de um artigo oficial com esse título é, por si,
confirmação de que a medida é real e reconhecida pela empresa]*.

**Consequência direta para o GoLive:** o app resolve **exatamente** o pedaço
que caiu (vídeo/tela) e **não** precisa resolver o que continua funcionando
(voz e texto). Isso é uma validação forte do escopo atual — e ao mesmo tempo
o argumento mais forte contra inchar o produto: **ninguém precisa de mais um
chat de voz.**

## 1.3 Continua em vigor em setembro de 2026? Há previsão de volta?

**Em vigor, sim. Sem data de volta.**

A ANPD deixou explicitamente aberta a possibilidade de retorno assim que o
Discord comprovar "medidas razoáveis" de proteção — ações técnicas, de
segurança e de governança
([eshoje.com.br](https://eshoje.com.br/tecnologia/2026/08/anpd-abre-caminho-para-volta-das-lives-se-discord-apresentar-medidas-razoaveis/),
[economicnewsbrasil.com.br](https://economicnewsbrasil.com.br/2026/08/12/discord-lives-brasil-condicoes-retorno/)
*[via busca]*). Não há prazo.

**[não verificado]** Não consegui confirmar o que aconteceu entre ~28/08/2026
e hoje (16/09/2026) — nem o julgamento do recurso, nem a audiência na Justiça
Federal. **Isto é uma lacuna material: pode ter voltado ontem e eu não saberia.
Antes de decidir qualquer coisa a partir deste documento, abra o
[artigo de suporte do Discord](https://support.discord.com/hc/en-us/articles/42704051358359-Why-video-features-are-currently-unavailable-in-Brazil)
e olhe o estado de hoje.** É uma checagem de 30 segundos que vale mais que
este parágrafo.

## 1.4 O detalhe que muda o jogo: o Discord JÁ verificava idade — e caiu assim mesmo

Desde **09/03/2026** o Discord implementa verificação de idade no Brasil, via
**selfie em vídeo** (estimativa etária no dispositivo) ou **escaneamento de
RG/passaporte**, justamente para cumprir o ECA Digital
([cnnbrasil.com.br](https://www.cnnbrasil.com.br/tecnologia/como-vao-funcionar-as-novas-regras-do-discord-para-verificar-idade-no-app/),
[rede98.com.br](https://rede98.com.br/noticias/tecnologia/discord-exigira-verificacao-de-idade-com-selfie-de-video-ou-rg-a-partir-de-marco/),
[proton.me/blog](https://proton.me/blog/discord-global-age-verification),
[support.discord.com — Age Assurance for Brazilian Users](https://support.discord.com/hc/en-us/articles/38860612202775-Age-Assurance-for-Brazilian-Users)
*[via busca]*).

**Mesmo verificando idade, as lives caíram.** O que a ANPD apontou não foi só
ausência de verificação etária: foi a **incapacidade técnica de moderar
transmissões ao vivo em tempo real**
([lawletter.com.br](https://lawletter.com.br/articulista/camila-betanin-1/discord-anpd-medida-preventiva-eca-digital-lei-15211-direito-gamer),
[economicnewsbrasil.com.br](https://economicnewsbrasil.com.br/2026/08/12/discord-lives-brasil-condicoes-retorno/)
*[via busca]*).

Isso tem duas leituras opostas, e as duas importam:

- **A favor do GoLive:** há um mercado real de brasileiros fugindo da exigência
  de RG e selfie — existe imprensa dedicada a isso
  ([viciados.net](https://viciados.net/discord-5-alternativas-exigencia-rg-e-selfie-2026/)).
  Um app que não pede conta nem documento tem um valor de produto que não
  existia em julho de 2026.
- **Contra o GoLive:** o critério que derrubou o Discord foi **"não consegue
  moderar transmissão ao vivo em tempo real"**. O GoLive não consegue moderar
  nada — por desenho, e isso é vendido como virtude ("sem ninguém no meio
  olhando a transmissão"). Se a régua for aplicada literalmente, o GoLive
  falha nela de forma mais completa que o Discord.

## 1.5 A MESMA regra alcançaria um app P2P entre amigos?

Esta é a pergunta certa e a resposta honesta é: **juridicamente incerta, na
prática irrelevante enquanto forem 5 amigos.**

**O que aponta para "alcança":**

- O ECA Digital (Lei 15.211/2025) se aplica a "produtos ou serviços de
  tecnologia da informação **direcionados a crianças e adolescentes ou com
  provável acesso** por esse público no país", abrangendo expressamente
  **aplicativos**, jogos eletrônicos, sistemas operacionais e lojas de app,
  **inclusive de empresas sediadas no exterior**
  ([machadomeyer.com.br](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/lei-15-211-25-protecao-para-criancas-e-adolescentes-no-ambiente-digital),
  [computerweekly.com/br](https://www.computerweekly.com/br/reportagen/ECA-Digital-obrigacoes-penalidades-e-o-que-muda-para-plataformas-digitais-no-Brasil)
  *[via busca]*). Não há, nas fontes que achei, uma exceção de porte que diga
  "não se aplica a app pequeno".
- A consulta pública do **MJSP sobre Aferição de Idade na Internet Brasileira**
  (Participa + Brasil, 15/10 a 14/11/2025, 70 contribuições; relatório
  divulgado em **fevereiro de 2026**) perguntou **explicitamente** sobre
  **arquiteturas descentralizadas ou federadas** e sobre **como repartir a
  responsabilidade de aferição de idade entre desenvolvedores de protocolo,
  operadores de servidor e criadores de aplicação**
  ([brasilparticipativo](https://brasilparticipativo.presidencia.gov.br/processes/idadeafericao?locale=pt-BR),
  [gov.br/mj — relatório](https://www.gov.br/mj/pt-br/assuntos/sua-protecao/sedigi/eca-digital/relatorio-sobre-afericao-de-idade-na-internet),
  [agenciabrasil](https://agenciabrasil.ebc.com.br/direitos-humanos/noticia/2026-02/consulta-publica-sugere-mais-rigidez-na-afericao-de-idade-na-internet)
  *[via busca]*). **O Estado brasileiro já está pensando em P2P/federado.**
  Não está resolvido, mas está na mesa.
- Sanções do art. 35 do ECA Digital chegam a **R$ 50 milhões por infração**
  ([lawletter.com.br](https://lawletter.com.br/articulista/camila-betanin-1/discord-anpd-medida-preventiva-eca-digital-lei-15211-direito-gamer)
  *[via busca]*).

**O que aponta para "não alcança, na prática":**

- A própria lei manda aplicar as obrigações **proporcionalmente às
  características, funcionalidades, porte e grau de interferência do provedor
  sobre os conteúdos distribuídos**, e a doutrina alerta contra "hipertrofia
  regulatória que eleve excessivamente o custo de conformidade para pequenos
  provedores"
  ([madronaadvogados.com.br](https://madronaadvogados.com.br/publicacoes/conhecimento-em-foco/eca-digital-o-que-muda-para-empresas-com-a-entrada-em-vigor-da-lei-no-15-211-2025/),
  [machadomeyer.com.br](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/lei-15-211-25-protecao-para-criancas-e-adolescentes-no-ambiente-digital)
  *[via busca]*). O GoLive tem **grau de interferência zero** sobre o conteúdo:
  ele não hospeda, não indexa, não recomenda, não armazena. Isso é o degrau
  mais baixo possível da escada de proporcionalidade.
- O relatório do MJSP concluiu que **não deve haver um modelo único**, e sim
  **requisitos proporcionais ao nível de risco de cada serviço**
  ([agenciabrasil](https://agenciabrasil.ebc.com.br/direitos-humanos/noticia/2026-02/consulta-publica-sugere-mais-rigidez-na-afericao-de-idade-na-internet),
  [cgi.br](https://cgi.br/publicacao/contribuicao-do-cgi-br-a-consulta-publica-afericao-de-idade-na-internet-brasileira-do-ministerio-da-justica-e-seguranca-publica/)).
- Elementos essenciais ao funcionamento da internet, como **protocolos e
  padrões técnicos abertos**, não são considerados produtos/serviços de TI para
  fins da lei
  ([machadomeyer.com.br](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/lei-15-211-25-protecao-para-criancas-e-adolescentes-no-ambiente-digital)
  *[via busca]*). Um app que só faz WebRTC direto entre dois pares está
  desconfortavelmente perto dessa categoria — mas **não é** um protocolo
  aberto, é um produto.

**[não verificado]** Procurei especificamente um dispositivo da Lei 15.211/2025
que **exclua comunicação interpessoal privada** do âmbito de aplicação (como
existe em outros regimes) e **não achei**. Não consegui abrir o texto no
Planalto (bloqueado). **Este é o ponto exato onde um advogado responderia em
uma hora o que eu não consigo responder em um dia de pesquisa.**

**Veredito honesto desta seção:** o risco regulatório do GoLive hoje é
essencialmente zero *porque ele é irrelevante* — 5 amigos, sem distribuição em
loja, sem receita, sem servidor. O risco aparece **exatamente no cenário de
sucesso**: se virar "o app que os brasileiros usam para burlar a suspensão do
Discord", ele passa a ter "provável acesso por crianças e adolescentes", vira
notícia, e o argumento "eu não modero nada" deixa de ser uma virtude de
privacidade e vira a acusação literal da ANPD contra o Discord. **O projeto
precisa decidir agora se ele quer ser pequeno de propósito.**

---

# 2. Alternativas prontas — o app precisa existir?

Legenda de veredito: **SIM** = já resolve o problema do dono do projeto e
torna o GoLive redundante; **NÃO** = não resolve; **PARCIAL** = resolve um
recorte.

| Ferramenta | Grátis? | Qualidade máx. | Latência | Nº de pessoas | Funciona no BR hoje? | Servidor no meio? | Substitui o GoLive? |
|---|---|---|---|---|---|---|---|
| **Steam Remote Play Together** | **Sim, embutido no Steam** | herda a tela do host | baixa (stream Valve) | **até 4 jogadores** | sim | relay da Valve **quando P2P falha** | **PARCIAL — o mais próximo** |
| **Parsec** (free) | Sim para uso pessoal | 4K60 citado no free tier *[via busca]* | muito baixa (protocolo próprio UDP) | **Party/co-op até 4** | sim | relay próprio quando P2P falha | **PARCIAL — muito forte** |
| **Sunshine + Moonlight** | Sim, GPL-3.0 | 4K HDR | **<15 ms em LAN** | **1 sessão ativa por host** | sim | não (self-host) | **NÃO (mata no fan-out)** |
| **Apollo** (fork do Sunshine) | Sim | idem | idem | múltiplos, via displays virtuais | sim | não | **PARCIAL** |
| **Kosmi** | Sim, sem conta, sem download | *[não verificado]* | *[não verificado]* | sala | **sim — se posiciona explicitamente como saída para o bloqueio BR** | **sim (quebra privacidade)** | **PARCIAL** |
| **Jitsi Meet** (meet.jit.si) | Sim | até 1080p na aba | ~sub-segundo | sem limite artificial | sim | **sim** | **NÃO (degrada com upload <2 Mbps)** |
| **Google Meet / Zoom / Teams free** | Sim | compartilhamento comprimido, não 1080p60 | sub-segundo | limite de tempo/pessoas | sim | **sim** | **NÃO** |
| **RustDesk** | Sim, open source | mediana | **1–2 s de atraso de operação** | 1:1 | sim | opcional (self-host) | **NÃO** |
| **Deskreen** | Sim, open source | segundo monitor | — | — | sim | não | **NÃO (outro caso de uso)** |
| **Chiaki** | Sim | PS4/PS5 | baixa | 1 | sim | não | **NÃO (só PlayStation)** |
| **Rainway** | — | — | — | — | **MORTO desde 31/10/2022** | — | **NÃO** |
| **Twitch** (ULL) | Sim | 1080p60 | **1,5–3 s** | ilimitado | sim | **sim (público/privado com link)** | **NÃO para jogar junto** |
| **YouTube** (ULL) | Sim | 1080p60+ | **4–8 s** | ilimitado | sim | sim | **NÃO** |
| **Owncast** | Sim, self-host | — | *[não verificado]* | — | sim | self-host | **NÃO (latência de HLS)** |
| **Syncplay / Stremio** | Sim | **qualidade do arquivo local = perfeita** | — (não transmite) | ilimitado | sim | **não transmite vídeo** | **outro paradigma — ver abaixo** |
| **Discord** | — | — | — | — | **vídeo SUSPENSO** | — | — |
| **Guilded** | — | — | — | — | **MORTO desde 19/12/2025** | — | **NÃO** |
| **Revolt** | Sim, open source | ferramentas ainda amadurecendo | — | — | sim | sim | **NÃO (é chat, não é Go Live)** |
| **TeamSpeak** | Sim (básico) | voz excelente | mínima | — | sim | sim/self-host | **NÃO (é voz)** |
| **Element / Matrix** | Sim | — | — | — | sim | federado | **NÃO** |

### Os três que realmente doem

**1. Steam Remote Play Together — o concorrente que ninguém pode ignorar.**
Grátis, já instalado na máquina de todo mundo do grupo, **até 4 jogadores**,
**só o host precisa ter o jogo**, convidados **não precisam nem de conta
Steam** desde a expansão do recurso — entram por link — e a Valve usa relay
próprio quando o P2P falha
([makeuseof.com](https://www.makeuseof.com/remote-play-together-steam/),
[resetera.com](https://www.resetera.com/threads/valve-expands-steam-remote-play-functionality-today-invite-anyone-to-join-your-local-multi-game-with-just-a-link.398293/),
[steamnavigator.com](https://www.steamnavigator.com/blog/steam-remote-play-together-guide)
*[via busca]*).
**Isso é o GoLive inteiro — teto de 4 pessoas, hardware encode, relay de
fallback — construído pela Valve, de graça, com infraestrutura global.**
O que ele **não** faz: mostrar a sua tela genérica (um filme, um navegador,
um jogo fora do Steam ou que não suporte o recurso). Remote Play Together é
para **jogos locais/split-screen**, não para "vem ver minha tela".

**2. Parsec.** Free tier com 4K60 e Party Mode para até 4 jogadores, adquirido
pela Unity em 2021; o que virou pago foi **Guest Access no plano Teams**
(US$ 25 por convite, com desconto por volume) — não o uso pessoal
([parsec.app/pricing](https://parsec.app/pricing),
[warzoneplay.net](https://warzoneplay.net/parsec-gaming-in-2026-the-complete-guide-to-cloud-gaming-setup-and-multiplayer-features/),
[softabase.com](https://softabase.com/software/remote-desktop/parsec)
*[via busca; não abri parsec.app — bloqueado]*). **[não verificado]** Não
confirmei se o free tier atual limita FPS/resolução, nem o preço do Warp.

**3. Sunshine + Moonlight — e o achado técnico mais importante desta frente.**
Sunshine é GPL-3.0, LizardByte, latência de **um dígito a dois dígitos baixos
em rede local**, protocolo baseado em RTSP sobre TCP+UDP, GPU-agnóstico
([pistack.xyz](https://www.pistack.xyz/posts/sunshine-vs-parsec-vs-moonlight-self-hosted-game-streaming-guide-2026/),
[mustafa.net](https://mustafa.net/2026/02/22/moonlight-sunshine-free-open-source-remote-gaming-stream-2026/),
[shattered.io](https://shattered.io/sunshine-moonlight-setup-guide/)
*[via busca]*; licença GPL-3.0 do cliente confirmada abrindo o
[moonlight-qt no GitHub](https://github.com/moonlight-stream/moonlight-qt) —
**esta eu li**).

**Mas:** o Sunshine **amarra cada cliente à saída de display física do host** e
**roda uma sessão ativa por vez**. A issue
[LizardByte/Sunshine#3887](https://github.com/LizardByte/Sunshine/issues/3887)
(aberta em 17/05/2025, **fechada como "not planned", label "stale"** — **esta
eu abri e li**) é exatamente um usuário tentando conectar múltiplos clientes
Moonlight simultâneos ao mesmo servidor: o segundo cliente **fica pendurado
esperando o primeiro desconectar**. O fork **Apollo** resolve com displays
virtuais
([tech-insider.org](https://tech-insider.org/apollo-vs-sunshine-game-streaming-2026/)
*[via busca]*).

**Consequência direta e dura:** a ideia (3b) de "virar um Moonlight de sala"
resolve o problema que o GoLive **não tem** (latência) e não resolve o problema
que o GoLive **tem** (fan-out para 3-4 espectadores + travessia de NAT). O
Sunshine nem sequer tentou resolver o fan-out — e ele tem ~40 mil estrelas e
anos de desenvolvimento.

### O paradigma que ninguém do grupo considerou: não transmitir

**Syncplay / Stremio.** Se metade do uso real for "assistir um filme/série
junto", transmitir 1080p60 por 12 Mbps é a solução mais cara possível para
um problema que se resolve com **sincronizar o play/pause de um arquivo que
cada um já tem**. Custo de banda: **zero**. Qualidade: **perfeita, é o arquivo
original**. Latência: **não existe, não há stream**. O GoLive nunca vai
entregar 1080p60 com a fidelidade de um arquivo local, por definição.

Isto não é uma piada: é a alternativa de melhor relação custo/benefício da
tabela inteira, e ela **descarta o produto** para um subconjunto do uso. **A
pergunta "quantas das suas sessões são 'assistir junto' e não 'jogar junto'?"
tem que ser respondida com dados, não com intuição.**

---

# 3. Reposicionamentos radicais do GoLive

## (a) Virar web app — nada a instalar

**O que ganha:** zero atrito de onboarding, que é a **dor nº 3** do briefing
(Radmin VPN exige instalação de terceiro antes do app abrir). Elimina
instalador, assinatura de código (item B6 do backlog), Electron 32→44 (item
B1), e todo o atrito de "baixe isso, crie conta ali".

**O que perde — e é grave:**

- **Áudio de sistema no Windows:** aqui a notícia é **melhor do que o briefing
  supõe**. Chrome e Edge **suportam** captura de áudio de sistema via
  `getDisplayMedia({audio:true})` em sistemas compatíveis; o Firefox **ignora
  silenciosamente** a parte de áudio — sem erro, sem aviso, você só não recebe
  som ([addpipe.com](https://addpipe.com/getdisplaymedia-demo/),
  [MDN Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture),
  [dev.to](https://dev.to/flo152121063061/i-tried-to-capture-system-audio-in-the-browser-heres-what-i-learned-1f99)
  *[via busca]*). O que **não** existe no navegador é o diferencial real do
  GoLive hoje: **captura de áudio por processo** (o addon nativo C++ que pega
  só o som do jogo, sem o Discord/Spotify junto). Isso é irrecuperável na web.
- **Atalho global** (transmitir/parar com o jogo em foco): impossível.
- **Overlay de rabisco sobre a tela real:** impossível.
- **Servidor de sinalização embutido no processo de quem cria a sala:**
  impossível — um navegador não abre porta de escuta. **Isso obriga um
  servidor de sinalização hospedado, ou seja, alguém no meio.** Não vê a
  mídia, mas vê quem fala com quem, e quando.

**Isso mata a ideia?** **Não mata, mas troca de produto.** Vira um "Kosmi
melhor" — e o Kosmi já existe, é grátis, roda no navegador, sem conta, sem
download, e já se posiciona como resposta ao bloqueio brasileiro
([kosmi.io/discord-alternative-brazil](https://kosmi.io/discord-alternative-brazil/),
[workadventu.re](https://workadventu.re/article/discord-screen-sharing-alternative/)).
**Ir para a web é entrar no ringue do Kosmi com anos de atraso e sem as
vantagens nativas que justificam o app existir.**

**Veredito: não recomendo como substituição. Recomendo como *complemento*** —
uma página web de "espectador" para quem só assiste (que é a maioria: 1
transmissor, 3 espectadores). O transmissor continua nativo (áudio por
processo, atalho, overlay); os espectadores entram por link, sem instalar
nada. **Isso resolve 75% do atrito de onboarding sem perder nada do que o app
nativo dá.** É, de longe, a melhor ideia deste documento.

## (b) Virar um "Moonlight de sala"

**Veredito: não recomendo.** Três motivos, em ordem de gravidade:

1. **Não resolve o problema que você tem.** O gargalo do GoLive, segundo o
   próprio briefing, é **banda de upload e travessia de NAT** — não latência de
   codec. Trocar WebRTC por RTSP+UDP do Sunshine não devolve um único Mbps de
   upload.
2. **O Sunshine não faz fan-out** (§2 acima, issue #3887 fechada como *not
   planned*). Você herdaria o protocolo e teria que construir a árvore de
   retransmissão do zero — que é justamente o que você já tem.
3. **Licença GPL-3.0** (confirmado no [moonlight-qt](https://github.com/moonlight-stream/moonlight-qt)).
   Reusar código do Moonlight/Sunshine **contamina o GoLive com GPL-3.0**. Para
   um app entre amigos isso pode ser aceitável — mas é uma decisão consciente,
   não um detalhe. Reimplementar o protocolo *limpo* (sem copiar código) é
   legalmente possível e é um projeto de meses.

## (c) Trocar o transporte por QUIC / WebTransport / Media over QUIC (MoQ)

**O MoQ NÃO está pronto para você em 2026.**

- `draft-ietf-moq-transport-17` é a base atual, **Standards Track, ainda não é
  RFC**; a expectativa é RFC em **2027 ou 2028**
  ([forasoft.com](https://www.forasoft.com/learn/video-streaming/articles-streaming/media-over-quic-moq),
  [streaminglearningcenter.com](https://streaminglearningcenter.com/articles/what-is-media-over-quic-moq-and-why-it-matters-for-real-time-streaming.html),
  [datatracker.ietf.org](https://datatracker.ietf.org/doc/draft-englishm-moq-relay-dos/)
  *[via busca]*).
- Há tração real: a **Cloudflare implantou relays MoQ em 330+ cidades**
  ([cloudflare/moq-rs no GitHub](https://github.com/cloudflare/moq-rs)) e
  **onze fornecedores demonstraram interoperabilidade no NAB Show 2026, em
  abril**.
- **Mas:** o encaixe de produção em 2026 é apostas ao vivo, live commerce,
  leilões e segunda tela — **explicitamente não é chamada bidirecional**. E,
  em maio de 2026, **nenhuma plataforma de consumo foi publicamente nomeada
  como cliente final**
  ([forasoft.com](https://www.forasoft.com/learn/video-streaming/articles-streaming/media-over-quic-moq)
  *[via busca]*).

**E o ponto que decide:** MoQ é um modelo **publish/subscribe com relays**. O
relay é um servidor. **Adotar MoQ é abandonar o P2P puro** — que é o valor
declarado nº 1 do projeto. Você não estaria "trocando o transporte", estaria
trocando a arquitetura *e* o princípio.

**Veredito: não recomendo agora. Reavalie em 2027-2028, se o projeto ainda
existir.** Apostar a arquitetura de um app entre amigos em um draft IETF é o
tipo de decisão que se toma quando o problema real já foi resolvido.

## (d) Virar cliente de um SFU gerenciado (LiveKit / Cloudflare)

**Tecnicamente, é a solução. Filosoficamente, é a rendição.**

O app fica trivial: some a árvore de retransmissão, some o teto de 4 pessoas,
some o problema de upload (1 fluxo de subida em vez de N), some o relay do
Radmin, some a sucessão de sinalização, some o CGNAT.

**O custo real** (cálculo do briefing: 12 Mbps × 3600 s = 5,4 GB/hora por
fluxo; 4 espectadores × 10 h/mês = **216 GB/mês de descida**):

| Serviço | Free tier | Preço acima | Custo dos seus 216 GB/mês |
|---|---|---|---|
| **Cloudflare Realtime SFU** | **1.000 GB/mês** (compartilhado SFU+TURN) | **US$ 0,05/GB** | **US$ 0,00 — cabe inteiro no free tier** |
| **Cloudflare Realtime TURN** | incluso no mesmo free tier; **grátis quando usado junto com o SFU** | US$ 0,05/GB avulso | **US$ 0,00** |
| **LiveKit Cloud (Build)** | 5.000 min WebRTC/mês | **US$ 0,10–0,12/GB de descida**; subida virou grátis em 2026 | **≈ US$ 22–26/mês (~R$ 120–145)** |

Fontes: [cloudflare.com/products/turn-sfu](https://www.cloudflare.com/products/turn-sfu/),
[developers.cloudflare.com/realtime/sfu/pricing](https://developers.cloudflare.com/realtime/sfu/pricing),
[developers.cloudflare.com/realtime/turn/faq](https://developers.cloudflare.com/realtime/turn/faq/),
[cipher.co.th](https://www.cipher.co.th/en/blogs/cloudflare-realtime-media-services/),
[livekit.com/pricing](https://livekit.com/pricing),
[blog.livekit.io](https://blog.livekit.io/towards-a-future-aligned-pricing-model/)
*[via busca; developers.cloudflare.com bloqueado, não abri]*.

**O número que precisa ser dito em voz alta: o uso descrito no briefing (5
pessoas, 10 h/mês, 12 Mbps) cabe com folga de 4,6× dentro do free tier de
1.000 GB da Cloudflare. Custo: zero. Para sempre, no volume atual.**

**O que quebra:** privacidade. A mídia passa pela Cloudflare descriptografada
no SFU (um SFU precisa ler os cabeçalhos RTP; com E2EE via Insertable Streams
o *payload* pode ficar cifrado — **[não verificado]** se o Cloudflare Realtime
suporta isso hoje). Isso viola diretamente "sem ninguém no meio olhando a
transmissão". **Se esse valor é real, (d) está fora. Se ele é uma
racionalização de uma restrição técnica ("não temos servidor, então
transformamos isso em princípio"), (d) é objetivamente a melhor engenharia
deste documento.**

**Meio-termo que eu recomendo de verdade:** use a Cloudflare **só como TURN**,
não como SFU. Mantém P2P (a mídia é cifrada fim a fim por DTLS-SRTP entre os
pares; o TURN só encaminha pacotes que não consegue ler), **elimina o Radmin
VPN inteiro**, resolve CGNAT e NAT simétrico, e custa **zero** dentro do free
tier. Perde-se: a Cloudflare vê *que* há tráfego e entre quem — não *o quê*.
Isso é uma quebra de privacidade **ordens de grandeza menor** do que um SFU, e
mata a dor nº 1 e a nº 3 do briefing de uma vez.

## (e) Ser um "launcher" honesto

**Anticlimático, e possivelmente o mais útil — mas não é um produto.**

Detectar Steam/Parsec instalado e dizer "para este caso, use Remote Play
Together; para aquele, Parsec" é um **fluxograma**, não um app Electron. E o
usuário aprende o fluxograma na primeira vez e desinstala o launcher na
segunda.

**Veredito: não recomendo como produto. Recomendo como *honestidade
editorial*** — um README que diz "se você quer jogar um co-op local com 3
amigos, use Steam Remote Play Together, é melhor que este app. Use o GoLive
quando você precisa mostrar **qualquer** tela, com **áudio por processo**, sem
conta e sem intermediário." Isso **aumenta** a credibilidade do projeto e
delimita o nicho real, que é estreito mas existe.

## (f) Continuar P2P, mudar codec/pipeline (H6: WebCodecs encode-once + DataChannel; AV1)

**Encode-once (H6):** tecnicamente sólido e é a coisa certa a fazer se você
ficar P2P. Hoje cada espectador extra custa **mais um encoder na origem** (item
G6 do backlog, "confirmado, por desenho"). WebCodecs dá controle total do
encode/decode e os quadros codificados podem ir por `RTCDataChannel` ou
WebTransport — com a ressalva documentada de que **falta lógica de adaptação
para ligar `RTCDataChannel` a Streams**
([webrtchacks.com](https://webrtchacks.com/webcodecs-webtransport-and-webrtc/),
[w3c.github.io/webrtc-nv-use-cases](https://w3c.github.io/webrtc-nv-use-cases/)
*[via busca]*). E o custo escondido é enorme: **ao sair do pipeline de mídia do
WebRTC você perde de graça o que ele fazia por você** — controle de
congestionamento, retransmissão seletiva, FEC, adaptação de bitrate,
jitter buffer, sincronização A/V. Você vai reimplementar tudo isso à mão, em
JavaScript, e a "escada automática de qualidade" que já existe vai ter que ser
reescrita sobre um transporte sem feedback de rede.

**Encode-once resolve CPU na origem. Não resolve upload.** 3 espectadores
continuam custando 36 Mbps de subida, encode-once ou não. E upload é a dor
nº 2 do briefing.

**AV1:** *isto* resolveria upload — ~50% do bitrate para a mesma qualidade
seria a diferença entre 36 Mbps e 18 Mbps, que é a diferença entre
"impossível" e "possível" em fibra brasileira.

**[não verificado — e é a lacuna mais importante desta seção]** Não consegui
confirmar: (i) se o Chromium do Electron 32 expõe **encode AV1 por hardware**
no WebRTC (a busca esgotou); (ii) qual fração dos GPUs tem encoder AV1. O que
consegui: a soma das séries **RTX 40 + RTX 50 está abaixo de 30%** de todas as
GPUs dedicadas na pesquisa de hardware da Steam de **junho de 2026**, e a GPU
mais popular do Steam é uma **RTX 4060 Laptop (3,81%)**
([tech-insider.org](https://tech-insider.org/steam-hardware-survey-june-2026/),
[xda-developers.com](https://www.xda-developers.com/the-most-popular-gaming-gpu-on-steam-isnt-a-desktop-card-anymore-and-it-tells-you-everything-about-2026/),
[thefpsreview.com](https://www.thefpsreview.com/2026/05/02/trends-from-the-april-2026-steam-hardware-survey/)
*[via busca]*).

**Mas a estatística global do Steam é irrelevante para você.** Você tem **um
grupo de 3-6 amigos conhecidos**. A pergunta não é "quantos % do Steam têm
AV1", é **"o Fulano, o Ciclano e o Beltrano têm RTX 40+/RDNA3/Arc?"** — e isso
se responde com três mensagens no grupo, não com pesquisa de mercado.
**Se os 4 transmissores potenciais têm AV1 por hardware, (f) com AV1 é a
melhor jogada que preserva P2P puro.** Se nem todos têm, AV1 vira um caminho
condicional que dobra a matriz de teste — para um app que já luta com uma
árvore de retransmissão de 1 nível.

---

# 4. A pergunta desconfortável: quanto custaria simplesmente pagar?

**Cenário:** 5 pessoas, ~10 h/mês, 12 Mbps por fluxo, 4 espectadores.
**Volume:** 5,4 GB/hora/fluxo × 4 × 10 h = **216 GB/mês**, **2,6 TB/ano**.

| Opção | Custo/mês | Custo/ano | Entrega o que você quer hoje? |
|---|---|---|---|
| **Cloudflare Realtime (SFU ou TURN)** | **R$ 0** (216 GB dentro do free tier de 1.000 GB) | **R$ 0** | **Sim** — 1.000 GB/mês grátis, US$ 0,05/GB depois ([cloudflare.com](https://www.cloudflare.com/products/turn-sfu/)) |
| **Discord Nitro** (1 assinante, o transmissor) | R$ 24,99 | **R$ 249,99/ano** (preço anual) | **NÃO. Go Live está suspenso no Brasil.** Você pagaria por um recurso desligado. ([tecnoblog](https://tecnoblog.net/noticias/discord-nitro-ganha-novo-preco-mais-baixo-e-em-reais-para-brasileiros/), [tecmundo](https://www.tecmundo.com.br/internet/239420-discord-nitro-custam-versoes-premium-oferecem.htm)) |
| **Discord Nitro Basic** | R$ 8,90 | ~R$ 107 | Não (idem) |
| **LiveKit Cloud** | ~US$ 22–26 (R$ 120–145) só de banda | **~R$ 1.450–1.740/ano** | Sim, mas caro e com terceiro no meio |
| **Parsec** (free) | R$ 0 | R$ 0 | **Sim, para co-op até 4** |
| **Parsec Warp** | **[não verificado]** — não consegui abrir parsec.app | — | — |
| **Steam Remote Play Together** | R$ 0 | R$ 0 | **Sim, para jogos com co-op local, até 4** |
| **VPS como TURN próprio** | **[não verificado]** — não confirmei preços. 216 GB/mês cabe na franquia de tráfego da maioria dos VPS de baixo custo; o gargalo seria a **taxa** (48 Mbps sustentados), não o volume | — | Sim, com trabalho |

**E o outro lado da conta — o custo de engenharia.** O `STATUS.md` do projeto
lista, só no que está declaradamente adiado: subir Electron 32→44 (~meio dia +
verificação manual), extrair o módulo de orquestração de `app.js` (1–2 dias),
três bugs de áudio nativo em C++ (G1–G3, "só testáveis rodando o app com
captura real"), e os itens H5/H6 (SFU e encode-once) marcados como "Plano B se,
depois de H1–H4, a sala de 4 ainda quebrar".

**A comparação que dói:** a alternativa gerenciada mais capaz da tabela
(Cloudflare) custa **R$ 0/ano** no seu volume e elimina **de uma vez** as
dores 1, 2, 3 e 5 do briefing. O caminho P2P puro custa **dezenas de horas de
engenharia** e, no melhor cenário, chega ao mesmo lugar com um teto de 4
pessoas. **O argumento para continuar P2P não pode ser custo — porque o custo
já é zero dos dois lados. Só pode ser privacidade.** E se o argumento é
privacidade, então o TURN da Cloudflare (que encaminha pacotes DTLS-SRTP que
ele não consegue ler) merece uma resposta melhor do que "tem alguém no meio".

---

# 5. Os 5 questionamentos mais afiados

Nenhuma linha de código nova deveria ser escrita antes destas cinco respostas.

### 1. O Go Live do Discord já voltou?

A suspensão da ANPD (12/08/2026) segue em vigor até onde consegui apurar, o
Discord recorreu em 24/08/2026 e a ANPD deixou a porta aberta para o retorno
mediante "medidas razoáveis" — **mas não consegui verificar as duas últimas
semanas**. Se o vídeo voltar amanhã, o GoLive perde a razão de ser declarada
no README no mesmo dia, e todo o backlog vira dívida de um produto sem
usuários. **Pergunta operacional: o que exatamente você faz com este projeto
no dia em que o Discord religar o Go Live? Se a resposta é "arquivo", pare de
investir em arquitetura e invista só no que já funciona hoje. Se a resposta é
"continuo porque X", escreva o X no README — porque o X, e não a suspensão, é
o verdadeiro motivo do app existir.**
Verifique hoje em
[support.discord.com/.../42704051358359](https://support.discord.com/hc/en-us/articles/42704051358359-Why-video-features-are-currently-unavailable-in-Brazil).

### 2. "Sem ninguém no meio" é um princípio ou é uma racionalização?

O TURN da Cloudflare Realtime custa **R$ 0** no seu volume (1.000 GB/mês
grátis), encaminha pacotes cifrados por DTLS-SRTP que ele não consegue ler, e
**elimina sozinho o Radmin VPN, o CGNAT, o NAT simétrico e o atrito de
onboarding** — as dores 1 e 3 do briefing, que são as duas piores. Se você
recusa isso, a recusa precisa de um argumento mais forte que a frase de
marketing. **Escreva a diferença concreta, em termos de risco real para
5 amigos, entre "a Cloudflare encaminha pacotes que não consegue decodificar"
e "o servidor de relay do Radmin VPN encaminha os mesmos pacotes" — porque
hoje o app já cai no segundo caso, sem você escolher, e você chama isso de
P2P puro.**

### 3. Quantas das suas sessões são "jogar junto" e quantas são "assistir junto"?

São dois produtos diferentes com duas soluções ótimas diferentes, e o GoLive
está tentando ser os dois de uma vez e sendo mediano nos dois.
Para **jogar junto até 4**, o Steam Remote Play Together é grátis, já está
instalado, só o host precisa ter o jogo, os convidados entram por link sem
conta Steam, e a Valve tem relay global quando o P2P falha — é o seu app
inteiro, feito pela Valve.
Para **assistir junto**, o Syncplay custa zero de banda, dá qualidade perfeita
(é o arquivo local) e latência inexistente.
**Meça: das últimas 10 sessões reais do grupo, quantas cada bucket? Se a
maioria cai em um dos dois, uma ferramenta pronta já ganha e o GoLive é
trabalho desperdiçado.**

### 4. O nicho real do GoLive é grande o bastante para justificar um app?

Depois de descontar tudo que as alternativas já cobrem, o que sobra de
genuinamente exclusivo é: **compartilhar qualquer tela (não só jogo Steam com
co-op local), com captura de áudio por processo, sem conta, sem documento, sem
intermediário, com atalho global e overlay.** Isso é real — nenhuma ferramenta
da tabela faz tudo. É também **muito estreito**.
**Se o nicho é esse, então (a-parcial) é a jogada óbvia e ninguém a propôs:
transmissor continua nativo (é lá que mora todo o diferencial), espectador vira
uma página web que se abre por link.** Um transmissor instala; três
espectadores clicam. Isso mata 75% do atrito de onboarding sem perder um único
diferencial. **Por que isso não está no roadmap?**

### 5. Os seus 4 amigos têm GPU com encoder AV1 — sim ou não?

AV1 por hardware corta o bitrate pela metade: 36 Mbps → 18 Mbps de upload para
3 espectadores. **É a única mudança técnica deste documento que resolve a dor
nº 2 (teto de upload) sem quebrar o P2P puro.** Tudo o mais — encode-once
(H6), MoQ, trocar para o protocolo do Sunshine — resolve latência ou CPU, que
não são os seus gargalos. E o Sunshine, com 40 mil estrelas, **nunca resolveu
fan-out multi-espectador** (issue #3887, fechada como *not planned*): não
espere herdar essa solução de ninguém.
A estatística do Steam não te serve — RTX 40+50 somam menos de 30% globalmente,
mas você não tem usuários globais, tem quatro amigos com nome e sobrenome.
**Mande três mensagens no grupo perguntando o modelo da GPU. Se a resposta for
"todos têm AV1", esse é o próximo commit e ele vale mais que os últimos
dezesseis releases. Se não for, aceite que o P2P puro tem teto de 2
espectadores em fibra brasileira e pare de tentar furá-lo.**

---

## Veredito da frente 5

**O app não deveria deixar de existir — mas o desenho atual deveria.**

- O problema original **ainda existe** (suspensão em vigor, sem data de volta),
  e ficou **mais interessante**: o Discord agora exige RG/selfie no Brasil, e
  existe um público fugindo disso. O GoLive tem, hoje, um argumento de produto
  que não tinha em julho.
- **Nenhuma alternativa cobre o nicho inteiro**, mas **o Steam Remote Play
  Together cobre o caso "jogar co-op junto até 4" melhor do que o GoLive jamais
  vai cobrir**, e é grátis. Reconheça isso no README.
- **Não recomendo:** MoQ (draft até 2027-28, e é pub/sub com relay — mata o
  P2P), protocolo do Sunshine (GPL-3.0 e não faz fan-out), web app completo
  (perde áudio por processo e vira um Kosmi pior), launcher (é um fluxograma,
  não um app).
- **Recomendo, em ordem:** (1) **TURN da Cloudflare** — grátis no seu volume,
  mata o Radmin VPN e o CGNAT de uma vez; (2) **espectador web por link**,
  transmissor nativo; (3) **AV1 por hardware, se e somente se os quatro amigos
  tiverem** — verificável com três mensagens.
- **Depende de X:** de X = "o vídeo do Discord voltou?" e X = "privacidade é
  princípio ou racionalização?". As duas respostas estão fora do código e
  precisam vir antes dele.
