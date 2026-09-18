# Auditoria multi-time e plano geral — 2026-09-18

Base: `main` em `b20cb17` (0.16.0). Cinco times independentes leram o projeto
inteiro em paralelo, cada um com um escopo fechado e a obrigação de citar
`arquivo:linha` ou o comando que produziu cada número. **Nenhuma linha de
código foi alterada** — este documento e os cinco anexos são todo o resultado.

Anexos, na íntegra, em `docs/auditoria-2026-09-18/`:

| # | Time | Escopo | Linhas |
|---|---|---|---|
| 1 | Arquitetura | `app.js`/`ui.js`, D1, segurança de IPC e preload, ciclo de vida | 836 |
| 2 | Interface | HTML/CSS medidos no Chromium real, z-index, texto, temas, acessibilidade | 927 |
| 3 | Rede | protocolo de sinalização, árvore, qualidade adaptativa, áudio nativo, o teto de 4 | 943 |
| 4 | Qualidade | cobertura, lint, `npm audit`, CI/CD, Electron 32→44, release | 959 |
| 5 | Produto | buracos de fluxo, 10 propostas, APIs novas, roadmap | 949 |

**Como ler os anexos.** Eles são verbatim, com o texto que cada time escreveu.
Duas correções conhecidas: o anexo 5 abre citando "733 testes" (o número do
`STATUS.md`, não medido — o real é 728) e estima o Electron 44 em "meio dia"
repetindo o STATUS, enquanto o anexo 4 mediu e chegou a 2–3 dias. Onde os dois
divergirem, **vale o anexo 4**, que rodou os comandos.

---

## Veredito

O projeto é melhor do que a própria documentação dele diz — e está sem nenhuma
rede de segurança há doze dias.

A engenharia é séria: o servidor de sinalização reconstrói mensagem campo a
campo, compara token com `timingSafeEqual`, tem cota por tipo de mensagem e um
teste de fuzz; a escada de qualidade tem histerese assimétrica com limiares que
saíram de log real datado, não de chute; a cor da interface é 100% tokenizada e
há teste que reprova cor literal fora do `:root`; `tree.js` tem teste de
propriedade com 1000 casos. Quase nada disso é comum num app mantido por uma
pessoa.

E, ao mesmo tempo: **o CI está vermelho desde 05/09, por 30 execuções seguidas,
e sete versões foram publicadas por cima dele** — da 0.11.0 à 0.16.0. O portão
existe, roda, reprova e ninguém olha. O `STATUS.md` registra "733 passando" num
momento em que o real é 728 com uma falha. Não é descuido de uma pessoa: é o
que acontece quando o sinal fica vermelho permanente e deixa de carregar
informação.

Os três times que trabalharam sem saber uns dos outros chegaram, por caminhos
diferentes, ao mesmo lugar: **o que falta no GoLive não é capacidade, é
fechamento de laço.** A árvore de retransmissão não reconstrói o link que cai.
A qualidade adaptativa desce com cuidado e sobe sem nenhum. O app mede a saúde
de quem recebe e não conta pra ninguém. O servidor valida tudo, menos as duas
mensagens que ninguém revisou. O CI reprova e nada acontece.

---

## Os números de hoje

Medidos nesta máquina em 2026-09-17/18, com as dependências instaladas via
`npm ci --ignore-scripts`.

| Medida | Medido | O que o `STATUS.md` afirma |
|---|---|---|
| Testes | **728 total, 727 passando, 1 falhando** | 733 passando (`STATUS.md:109`) |
| Falha | `src/main/logger.test.js` | nenhuma registrada |
| Cobertura "oficial" | 98,00% linha | — |
| Cobertura real | **41,4% do código tem teste; 58,6% (11.209 linhas, 14 arquivos) não tem nenhum** | — |
| Lint | 0 erros, 9 avisos | 0 erros, 9 avisos ✔ |
| `npm audit` | **3 altas** | 2 (`STATUS.md:770`) |
| `npm audit --omit=dev` | **1 alta** (`js-yaml`, chega no app publicado) | "sempre esteve em 0" (`:772`) |
| Execuções de CI vermelhas seguidas | **30** (#61 a #90, de 05/09 a 15/09) | — |
| Última execução verde | **#60**, 2026-09-04 | — |
| Branches mescladas no remoto | **17** (+2 releases-rascunho órfãos) | 3 (`:781-783`) |
| Electron instalado / estável | 32.3.3 / **44.4.1** | alvo 44 ✔ |
| Menor janela em que a interface funciona | **1041×600** | `main.js:354` promete 900×600 |

A linha dos testes é a que mais importa: ela registra um número **maior** que o
real e **nenhuma falha**, exatamente no período em que o CI estava vermelho. É
o sintoma documental do primeiro P0.

---

## P0 — o que está quebrado agora

Seis itens. Nenhum é hipótese: todos foram reproduzidos, medidos ou
confirmados na API do GitHub.

### P0-1 · O CI está vermelho há 30 execuções e ninguém foi barrado
`src/main/logger.js:25` · `.github/workflows/test.yml:27`

`logger.js:25` faz `const { app } = require('electron')` no topo do módulo, sem
try/catch. Com `npm ci --ignore-scripts` — que é o que o CI usa — o binário do
Electron não existe e o require lança. Não depende de sistema operacional:
reproduzido aqui em Linux e confirmado no log do runner Windows, com os mesmos
`728 / 727 / fail 1`.

`src/main/updater.js:36-42` faz certo, e o comentário do workflow
(`test.yml:12`) cita esse arquivo como se a receita valesse pro repositório
inteiro. Vale pro `updater.js`; não vale pro `logger.js`, escrito depois.

Linha do tempo verificada: execução #60 (04/09) verde; `logger.js` entra na
`main` em `a50b89f` (05/09 14:25); execução #61 (05/09) vermelha; **#61 a #90
todas `failure`**, incluindo os merges das 0.11.0, 0.12.x, 0.13.0, 0.13.1,
0.14.0, 0.15.0 e 0.16.0.

**Conserto: 20 minutos.** Require preguiçoso no molde exato do `updater.js`. Os
testes já injetam `dir`, então nenhum teste muda. **Isto vem antes de tudo o
mais neste documento** — qualquer outro conserto entra às cegas enquanto o
sinal estiver vermelho.

### P0-2 · Injeção de comando no PowerShell elevado do firewall
`src/main/firewall.js:91-94`

`process.execPath` entra cru dentro de uma string de aspas **simples** do
PowerShell, dentro de um `Start-Process -Verb RunAs`. Aspas duplas são ilegais
em caminho NTFS; **apóstrofo não é**. O NSIS instala em `%LOCALAPPDATA%`
(`perMachine: false`), então o caminho deriva do **nome do usuário do
Windows** — `C:\Users\O'Brien\...` é um caminho perfeitamente válido, e ali a
string fecha cedo e o resto vira código executado com UAC.

Segundo problema no mesmo trecho: `Start-Process netsh` resolve `netsh` pelo
`PATH`.

O próprio arquivo já documenta a solução certa e a usa na *consulta*
(`-EncodedCommand`, `firewall.js:31-32`); só a escrita ficou pra trás.

### P0-3 · A imagem do chat é interpolada crua no HTML
`src/renderer/ui.js:2307` · `src/renderer/chatmedia.js:59` ·
`server/signaling-core.js:926` e `:280`

As três validações de data URL testam só o **prefixo**. Confirmado rodando o
módulo nesta máquina: `data:image/png;base64,AAAA" onerror="X` devolve `true`
em `isImageDataUrl` e fecha o atributo em `<img src="${entry.image}">`.

O CSP de `index.html:5` segura a execução de script — o que passa é injeção de
HTML/CSS, não XSS. É o **único** ponto do renderer onde dado remoto é
interpolado sem `escapeHtml`, e o comentário logo acima (`ui.js:2298-2302`)
afirma que a validação já garantiu o contrário.

### P0-4 · O link relay→folha que cai não é reconstruído por ninguém
`src/renderer/app.js:1931-1944` · `:4487-4545`

Os dois ramos de recuperação de `onPeerState` exigem `!sourceId`. Conexão de
repasse usa kind **composto** (`screen@<origem>`), então `sourceId` existe e
**nenhum dos dois roda**. Do lado da folha não há socorro: `reportFailure`
(`mesh.js:347-361`) não zera `peer.inConns[kind]`, o tile já foi removido, e o
`stallwatch` nunca pede `reoffer` porque só dispara para tile que existe e
mostra 0 quadros.

Resultado: a tela some para uma pessoa, todo mundo continua bem, e **não existe
nenhum evento que a traga de volta** — só sair e entrar da sala. É exatamente a
reclamação que o hotfix de 12/09 foi caçar, pelo único caminho que o detector
dele não enxerga.

### P0-5 · `npm run dist` publica um instalador sem o áudio nativo, em silêncio
`package.json` (`build.files`) · `.gitignore:3`

`build/` não existe num clone limpo. O campo `files` do electron-builder é lista
de **globs**, e glob que não casa nada não é erro — é conjunto vazio.
`asarUnpack` sobre o mesmo caminho também vira no-op.

`npm run dist` sem `npm run build:native` antes **conclui com sucesso** e produz
um `.exe` em que a captura de áudio por processo simplesmente não existe:
`getOwnPid()` devolve 0 e `app.js:3320` cai no loopback de sistema sem uma
palavra. Não há `beforeBuild`/`afterPack`, nem passo de CI que gere o
instalador.

Nota boa do mesmo time: o bloco `build` foi conferido contra o `scheme.json` do
electron-builder 26 — **nenhuma chave desconhecida** entre as 89 aceitas. O
medo registrado no STATUS ("o 26 muda default…") não se materializa; o risco
real do `npm run dist` é este, e é anterior ao electron-builder.

### P0-6 · O lobby quebra em qualquer janela ≤1040px — inclusive no mínimo anunciado
`src/renderer/style.css:734-752` (a regra culpada é a `:748`)

Uma `@media (max-width: 1040px)` escrita para o lobby **anterior** ainda
dispara. Das 7 regras do bloco, 6 miram classes que não existem mais; a
sobrevivente (`.lobby-actions { grid-template-columns: 1fr 1fr }`) vence a
regra de hoje por ordem de origem.

Medido em 900×700 no Chromium: caixa de 199px com conteúdo de 237px, "Entrar
por endereço" quebrando em 3 linhas dentro de um botão travado em 44px, e a
barra lateral inteira **vazando 22px por cima da coluna das salas**.
`src/main.js:354-355` promete 900×600. A promessa não se cumpre.

**Conserto: apagar 19 linhas.** As outras 6 regras já são inertes.

---

## Mapa completo dos achados

Prioridades unificadas entre os cinco times. P0 acima; aqui o resto.

### P1 — dívida que já dói

| # | Achado | Onde | Anexo |
|---|---|---|---|
| A | Duas pessoas transmitindo elegem o **mesmo relay**: 4 encoders numa máquina, outra ociosa. Reproduzido chamando `computeTree` duas vezes | `tree.js:96`,`:126` | 3 · R2 |
| B | A migração de sala **se parte em N salas** no Tailscale (sem broadcast), cada sobrevivente vira host com o mesmo `roomId` | `app.js:1790-1818` | 3 · R3 |
| C | Beacon UDP de migração **não é autenticado**: ex-membro banido conhece o `roomId` e sequestra a sala | `discovery.js:108`, `app.js:1081` | 1 · 4 / 3 · R3 |
| D | 58,6% do código sem teste, **mascarado por "98% de cobertura"** (o coletor só conta arquivo carregado) | — | 4 · P1-2 / 1 · 9 |
| E | `room:host` **sem trava de reentrância**: duas chamadas sobem dois servidores, o primeiro fica órfão pra sempre. Não é falso positivo do `require-atomic-updates` | `main.js:1039` | 4 · P1-3 |
| F | `stopShare` durante o laço de ofertas deixa a sala achando que você está ao vivo, com o botão ligado e nada transmitindo | `app.js:3459`,`:3529` | 4 · P1-4 / 1 · 6 |
| G | PIN de 4 dígitos **força-brutável em menos de um minuto**: o rate limiter é por socket, não por IP | `signaling-core.js:645` | 4 · P1-5 |
| H | `npm audit --omit=dev` = 1 alta (`js-yaml` via `electron-updater`) — roda no app de todo mundo, sobre conteúdo remoto. `npm audit fix` resolve sem quebrar | — | 4 · P1-6 |
| I | `release:check` existe, é bom, tem 9 testes, nasceu do incidente da v0.10.0 — e **nada o chama** | `scripts/check-release.js` | 4 · P1-7 |
| J | Electron 32 EOL há ~18 meses, 33 avisos. A subida tem **três armadilhas silenciosas**, não duas | `package.json` | 4 · P1-1 |
| K | Lista de pessoas mostra **4 de 20** (`max-height: 176px` num painel de 704px), com meia tela preta embaixo | `style.css:895` | 2 · A2 |
| L | "Parar de compartilhar" e "Desligar câmera" **perdem o anel de foco justamente quando ligados** (`:where()` tem especificidade zero e zera o `outline`) | `style.css:312` | 2 · A3 |
| M | O toast cobre o campo de chat e **tapa o banner de atualização inteiro**, barra de progresso incluída | `style.css:433`,`:463` | 2 · A4 |
| N | Não dá pra saber de quem é cada tela sem passar o mouse (`opacity: 0` em repouso) | `style.css:1270` | 2 · A5 |
| O | "Conectando…" aparece **em vermelho de erro**, com `role="alert"`, e o botão Conectar não tem estado ocupado — o irmão "Criar sala" tem tudo | `app.js:1466`,`:989` | 2 · A6 |
| P | O nome da sala no cabeçalho é **o seu próprio nome**, não o de quem criou | `app.js:1574` | 5 · buraco 1 |

### P2 — melhorias com dono claro

Vinte e três itens, detalhados nos anexos. Os que mais se pagam:

- **`REELECTION_HYSTERESIS_MS` quebrou a própria invariante.** O comentário diz
  "precisa ser maior que `DISCONNECT_GRACE_MS = 5000`"; a constante virou 15000
  na 0.13.0 e a histerese continuou em 8000. Conserto de 15 minutos: derivar
  uma da outra. (`app.js:4595`, anexo 3 · R4)
- **Qualquer peer pode pintar vídeo arbitrário no tile de outra pessoa** —
  `isKnownKind` só olha o `baseKind`, então `screen@<terceiro>` passa. O dado
  que consertaria já existe (`paiId`). (`app.js:354`, anexo 3 · R5)
- **Nenhuma janela tem `will-navigate`** (zero ocorrências no projeto) e o
  `setDisplayMediaRequestHandler` aprova a fonte sem checar quem pediu.
  (`main.js:840`, anexo 1 · 3)
- **O painel de estatísticas é remontado e injetado no DOM a cada segundo,
  aberto ou não** — disputando o main thread com o laço de 60 fps do
  `screenrelay.js`, que existe justamente porque perder quadro ali derruba o
  encoder pra software. (`app.js:5216`, anexo 3 · R9)
- **O chat cresce sem teto no DOM**, com os data URLs de até 200 KB dentro.
  (`ui.js:2310`, anexo 3 · R10)
- **`eslint.config.js` perdeu regras do `recommended`.** Confirmado por sonda:
  `no-case-declarations` **não acusa** hoje, num projeto com `switch (msg.type)`
  gigantes. Sete regras entram com **zero ocorrências** — custo nulo, cada uma
  guarda uma classe de bug. (anexo 4 · P2-1)
- **`--z-modal` está morto**: `.modal` declara `z-index` duas vezes no mesmo
  bloco e a segunda (100) ganha, deixando toast e banner acima de qualquer
  diálogo. O teste que deveria pegar isso só verifica que os tokens *existem*.
  (`style.css:1742`/`:1746`, anexo 2 · A9)
- **Quatro nomes para o mesmo papel** — "dono", "líder", "host", "anfitrião" —
  e três deles aparecem em mensagem de erro. Duas telas mandam a pessoa "usar
  Desconectar", botão que não existe (chama-se "Sair da sala"). (anexo 2)
- **Áudio nativo: 6 cópias do mesmo bloco** entre o WASAPI e o worklet, e a
  última etapa é um laço JS por amostra **na thread de renderização de áudio**.
  2,3 MB/s de `memcpy` e 96.000 iterações/s por captura, até 5 capturas
  simultâneas. Três consertos de uma linha cada, sem tocar no C++.
  (anexo 3 · R12)

### P3 — quando sobrar tempo

Dezoito itens nos anexos. Entre eles: 53 seletores CSS escritos mais de uma vez
(`.control-bar` ×4), 132 declarações de `font-size` sem um único token (19
tamanhos distintos, com meios-pixels), 159 espaçamentos em px na mão fora da
escala, a janela Espiar ignorando o tema escolhido, o Tab passando por um campo
de arquivo invisível, e a tela da sala sem `h1`.

---

## O plano, dividido

Quatro frentes. A ordem não é por dificuldade — é porque cada uma depende da
anterior ter deixado o chão firme.

### Frente 0 — Destravar · `0.16.1`, 2 a 3 dias

Não tem tema de produto. É o que precisa estar de pé antes de qualquer outra
coisa ser mexida.

- [ ] **P0-1** `logger.js`: require preguiçoso. Ver o CI verde. *(20 min)*
- [ ] **H** `npm audit fix` — só o `js-yaml`, sem tocar no Electron. *(5 min)*
- [ ] **P0-3** validar data URL de imagem por conteúdo, nas três cópias
      (cliente e as duas do servidor), com teste do payload que passa hoje. *(2 h)*
- [ ] **P0-2** `firewall.js` por `-EncodedCommand`, `netsh` por caminho
      absoluto, teste com apóstrofo/espaço/`;` no `execPath`. *(2-3 h)*
- [ ] **P0-6** apagar `style.css:734-752`. O mínimo de janela volta a ser o
      anunciado. *(15 min)*
- [ ] **P0-5** `beforeBuild` que exige o `.node` e falha com mensagem explícita. *(1 h)*
- [ ] **CI novo** (`ci.yml` + `release.yml`, propostos por inteiro no anexo 4):
      matriz Node 20/22, `npm audit --omit=dev` como portão que **falha**, job
      `empacotar` com `electron-builder --win --dir` e uma asserção de que o
      `.node` entrou no pacote, e `release:check` amarrado à tag. *(1 dia)*
- [ ] **P2** corrigir `STATUS.md:109`,`:770-773`,`:792` e `README.md:351-357`
      (que ainda diz que a sala morre com o host — falso desde a 0.14.0). *(30 min)*
- [ ] **P2** apagar as 17 branches mescladas e os 2 releases-rascunho órfãos. *(15 min)*

**Por que esta frente existe.** Sete versões saíram sem portão. A oitava não
precisa. E o item do `README` custa cinco minutos: é o parágrafo mais
assustador do documento, ele está errado, e é o que lê quem está decidindo se
instala.

### Frente A — Fechar os laços · `0.17`, ~1 semana

Tema: **o que o app começa, o app termina.**

- [ ] **P0-4** reconstruir o link relay→folha: ramo novo em `onPeerState` para
      `failed && sourceId`, contador de tentativas por filho, `reportFailure`
      zerando `inConns`, e `checkStalledTiles` tratando "quero assistir e não
      há conexão de entrada" como gatilho de `reoffer`. *(3-4 h)*
- [ ] **A** carga de relay no `view-state`, e `computeTree` ordenando por ela
      antes de tudo. Teste puro: dois `computeTree` sobre o mesmo pool não
      podem devolver o mesmo relay havendo alternativa com carga 0. *(2-3 h)*
- [ ] **E** latch de reentrância em `room:host`, no molde do `sharing`. *(1 h)*
- [ ] **F** época de compartilhamento em `startShare`, no molde do `mediaEpoch`
      que `startCamera` já usa. *(1-2 h)*
- [ ] **R4** derivar `REELECTION_HYSTERESIS_MS` de `DISCONNECT_GRACE_MS`. *(15 min)*
- [ ] **R16** a volta de qualidade também espera: 10 s de topologia estável
      antes de devolver o degrau ao sair do modo degradado. *(1 h)*
- [ ] **G** contador de PIN por IP (5 erros em 60 s) e PIN de 6 dígitos com
      `crypto.randomInt`. *(2 h)*
- [ ] **R5/R6** validar `kind` composto contra o `paiId` anunciado, e exigir
      `live === true` de quem manda `tree`. *(1 h)*
- [ ] **R7/R8/R13** limitador próprio no `annotate-sync`, teto de conexões,
      avatar de 256 KB → 64 KB, beacon chaveado pelo IP de origem com teto e
      coalescência. *(2 h)*
- [ ] **B/C** migração que não depende de broadcast: conexão direta ao sucessor
      (que já vem no `room-migrating`), prazo absoluto desde a queda em vez de
      desde a desistência individual, e `migrationSecret` rotacionado no
      `welcome`. *(1-2 dias)*

**Por que primeiro.** O time de rede fez a conta e chegou a uma conclusão que
vale repetir: **o caminho mais barato pra furar o teto de 4 pessoas não é
tecnologia nova, é fechar estes laços.** Hoje a sala de 4 quebra pelo P0-4 e
pelo A, não por capacidade.

### Frente B — O app conta o que sabe · `0.18`, ~1 semana

Tema: **tudo que o app mede e não diz.**

- [ ] **P** nome de sala escolhido por quem cria, viajando no `welcome` e no
      `room-migrating`. Menor diff da lista, conserta a coisa mais visível que
      está errada. *(meio dia)*
- [ ] **Saúde por pessoa visível dos dois lados** (anexo 5 · P4): `rxstats.js`
      já mede, `view-state` já transporta, `peer.receiveHealth` já guarda — e
      nada vira pixel fora da tabela de Configurações. Um chip no tile com o
      culpado nomeado, e um módulo puro `health.js` com a histerese. Exige um
      campo novo só: `limit` no `broadcast-state`. *(1 dia)*
- [ ] **Medidor de som** (anexo 5 · P7): três caminhos de áudio, dois modos de
      falha documentados no README, nenhuma verificação de que sai amostra. Um
      `AnalyserNode` no `AudioContext` que já existe. *(1 dia)*
- [ ] **`powerSaveBlocker`** (anexo 5 · P5): zero ocorrências em `main.js`. O
      `powerMonitor` está lá desde a 0.13.0 — registrando no log a máquina
      dormir e derrubar a sessão. *(3-4 h)*
- [ ] **Amigos salvos e sonda dirigida** (anexo 5 · P2): mensagem `probe` na
      sinalização (não pacote UDP novo — a porta do servidor embutido já tem
      regra de firewall), `knownhosts.js` puro, e o aviso que falta em
      `renderNetworkStatus`: *"No Tailscale as salas não aparecem sozinhas."*
      **Metade do público provável do app não tem descoberta nenhuma hoje** — o
      Tailscale é o plano B oficial do README e é L3, não repassa broadcast. O
      próprio `discovery.js:44-47` já sabe disso, em comentário. *(2 dias)*
- [ ] **K, L, M, N, O** os cinco defeitos de interface P1. *(1 dia somados)*
- [ ] **Glossário** (`docs/glossario.md`, 8 linhas) e o teste de 20 linhas que
      reprova termo proibido em string visível. Fecha os quatro nomes do dono da
      sala. *(2 h)*

**Uma decisão de escopo.** O anexo 5 propõe também o **painel na tela real** —
subir a janela de overlay sempre, não só com rabisco ligado, e usá-la para
falar com quem está jogando. É a proposta de maior valor da lista e a mais
arriscada: multiplica o número de sessões em que aquela janela existe, e o
anexo 1 achou que **o retângulo dela é calculado uma vez e nunca revalidado**
(zero listeners de `display-metrics-changed` no projeto). As duas coisas juntas
numa release sem PC real de teste é pedir o hotfix. **Recomendo mantê-la fora
da 0.18** e tratá-la como frente própria, depois que o overlay ganhar
revalidação de bounds e um roteiro de teste manual.

### Frente C — Fundação e produto · `0.19`, ~2 semanas

Tema: **o que exige o chão pronto.**

- [ ] **D1, fases 0 a 2** (anexo 1 · 8). Deixou de ser uma frase: fase 0 é a
      fronteira do DOM (`app.js` chama `$()` em 77 pontos, cobrindo 25 ids —
      "`ui.js` é dono do DOM" é convenção declarada e não cumprida); fase 1 é
      `session-tree.js` (~370 linhas, superfície de API já escrita, com a
      bateria de testes que a auditoria de agosto pedia); fase 2 é
      `audience.js`. **4-5 dias em entregas independentes**, não os "1-2 dias"
      do backlog. É o que permite testar "relay cai no meio, folhas voltam" em
      vez de descobrir por log.
- [ ] **J** Electron 32 → **44.4.1**, pelo plano de 9 passos com pontos de
      retorno do anexo 4. **2-3 dias, não meio dia** — e o motivo é que as três
      armadilhas são **silenciosas**:
      1. `console-message` mudou de assinatura na 35 → o log de arquivo passa a
         gravar `[renderer:[object Object]] undefined`. É a ferramenta de
         diagnóstico principal do projeto quebrando sem avisar, no meio da
         subida que mais precisa dela.
      2. `app.commandLine` passa tudo pra minúsculas na 36 → nomes de feature do
         Chromium são case-sensitive → **WGC desliga** (volta a tela preta em
         jogo em tela cheia que a 0.13.1 caçou por dias), `WebRtcAllowH264Send`
         desliga (volta o OpenH264 que a 0.13.0 corrigiu), e `WebRtcHideLocalIps
         WithMdns` volta a ligar (o P2P pode não fechar na LAN virtual).
      3. `binding.gyp:17,24` ainda pede C++17; a 33 exige C++20.
- [ ] **Fanout 2 na origem** (2 relays em vez de 1): leva a sala a 6-7 pessoas
      com 2 encoders na origem em vez de 3. *(1 dia, depois do D1)*
- [ ] **Recorte da fonte**, **ensaio de banda** e **clipe de 30 s** (anexo 5,
      P8/P9/P10) — as três de maior risco técnico e as únicas que não consertam
      nada. Melhoria de produto vem depois de o produto contar a verdade.

---

## Ferramentas novas: o que entra e o que não entra

Os cinco times avaliaram ferramentas em separado. Consolidado, com os "não" —
que aqui valem tanto quanto os "sim", porque o projeto tem **3 dependências de
produção** e isso é um ativo.

### Entra

| Ferramenta | O que destrava | Custo |
|---|---|---|
| **Playwright para teste de layout** — medição, não screenshot | Foi assim que os defeitos P0-6, K, L e M saíram, em minutos. Asserções de invariante: nada estoura a viewport em 900/1040/1280px, nada sobrepõe elemento clicável, todo controle visível tem indicador de foco | ~120 linhas + 1 devDependency. **Derruba sozinho o "falta harness" do F1** |
| **axe-core dentro desse mesmo teste** | 3 linhas a mais com a página já carregada. Pega `aria-live` ausente, ordem de títulos, contraste no DOM real | quase zero, com `disableRules` pro que não se aplica a desktop |
| **`stylelint` com 4 regras, não o preset** | `declaration-block-no-duplicate-properties` acha o `--z-modal` morto sozinho; `no-duplicate-selectors` acha os 53 seletores repetidos | baixo. O preset inteiro seria ruído num arquivo de 2956 linhas com convenção própria |
| **Cobertura com `--test-coverage-include` explícito** | Hoje o número publicado seria falso (98% sem enxergar 58% do código) | 1 h |
| **JSDoc + `checkJs`**, só nos módulos puros | Tipo sem build step, onde ele paga | incremental, nunca em `app.js`/`ui.js` |
| **Regras do `eslint:recommended` que faltam** | 7 entram com **zero** ocorrências hoje; `no-case-declarations` é a que importa | 2 h |
| **`powerSaveBlocker`, `Tray`, `AnalyserNode`, `MediaRecorder`, `RTCDataChannel`, `globalShortcut`** | APIs da plataforma, não pacotes npm — sustentam a Frente B e a C | zero dependências |
| **Sala fantasma: N clientes sintéticos** | Responde "quanto custa uma sala de 10?" sem PC real, e vira teste de regressão pros achados A e R8 | meio dia |

### Não entra, e por quê

- **Bundler / `electron-vite`** — o renderer não importa nada do npm; os
  módulos se registram em `window.GoLive`. Resolveria um problema inexistente e
  criaria três.
- **`madge` / `dependency-cruiser` / `knip`** — pelo mesmo motivo: não há grafo
  de import. As três produziriam relatório vazio ou marcariam quase tudo como
  morto.
- **Regressão visual por screenshot** — com **sete temas**, o número de
  baselines explode (7 × 5 telas × 2 tamanhos = 70 imagens binárias no git). O
  que ela pegaria bem, o teste de medição já pega, com mensagem legível em vez
  de "5,2% dos pixels mudaram".
- **Validação de HTML no CI** — 90% da interface é montada por `innerHTML` em
  `ui.js`. Passaria verde num app quebrado. (O `index.html` foi validado nesta
  auditoria com parser próprio: 117 ids, zero duplicado, zero `<div>`
  desbalanceada, todo `<label>` com `for`. As quatro páginas passaram.)
- **Framework de UI ou Tailwind** — as duas últimas releases foram redesigns
  inteiros feitos sem framework nenhum. Migrar jogaria fora a guarda do
  `css-rules.test.js`.
- **`electron-store`, `electron-log`, `nanoid`, `qrcode`, `bufferutil`,
  `safeStorage`** — cada um substitui 15 linhas que já existem e funcionam, ou
  resolve um problema que o projeto não tem. Somar dependência aqui é perder o
  ativo sem comprar nada.
- **Chat de voz no app** — o pipeline de áudio existe para **excluir** o GoLive
  do loopback e **incluir** o Discord. Isso é prova, no código, de que o grupo
  já está falando no Discord. O Go Live foi suspenso; a voz, não.
- **Controle remoto tipo Parsec** — é a única ideia da lista que pode terminar
  com a máquina de alguém comprometida, num canal cuja autorização é
  cooperativa e cujo PIN, nas palavras do próprio STATUS, "não é cripto".

---

## O teto de 4 pessoas, com a conta feita

O anexo 3 fez a aritmética que faltava. Sala de 4 hoje: origem 6,2 Mbps com 1
encoder, relay 5,3 Mbps com 2 encoders, e as folhas recebendo **720p30** numa
sala que escolheu 1080p60. Sala de 6: a árvore já devolveu o problema — **3 dos
5 encoders voltam pra origem**, 18,5 Mbps de upload em quem está jogando.

Descoberta de passagem, que vale registrar: **`FANOUT_ORIGEM` e
`PROFUNDIDADE_MAX` (`tree.js:10-12`) são constantes decorativas.**
`computeTree` não lê nenhuma das duas — mudar o valor não muda nada, e
`tree.test.js` só verifica que elas continuam com o valor escrito.

As opções, comparadas:

| Opção | Encoders no sistema (sala de 6) | Veredito |
|---|---|---|
| Nada | 5 (3 na origem) | é o teto de hoje |
| **Fanout 2 na origem** | 5, mas **2 na origem** e 12,3 Mbps em vez de 18,5 | **recomendado**, 1 dia, depois do D1 |
| SFU (H5) | 1 — mas **60 Mbps de upload no host** | troca teto de CPU por teto de banda, e a banda é o que o README já avisa que falta. Continua adiado, agora por um motivo melhor |
| WebCodecs (H6) | 1, a **18 ms/quadro em software** | **deve sair do backlog** |
| Simulcast / SVC | pior (2-3 camadas onde havia 1) | não se aplica sem elemento de encaminhamento |
| AV1 | software no Chromium 128 | reabre com o Electron 44, só em máquinas com AV1 em hardware |

**Sobre o H6.** O projeto já mediu, nesta máquina e neste Chromium, e o número
está escrito no próprio código: `screenrelay.js:60-61` registra *"WebCodecs: não
alcança o hardware a 1080p neste build, e em software é mais caro (18 ms/quadro)
que o próprio OpenH264"*. O orçamento a 60 fps é 16,6 ms. **18 ms estoura o
orçamento com zero espectadores**, contra 5,7-8,1 ms do MediaFoundation que o
app usa hoje. Não é plano B — está medido como pior. Deve sair da lista para
não ser reconsiderado de memória daqui a três meses.

---

## Backlog reavaliado

O que a auditoria de 2026-08-27 e o `STATUS.md` afirmam, contra o que foi
medido agora.

| Item | Veredito |
|---|---|
| **B1** Electron 32→44 | **Aberto, estimativa errada.** 2-3 dias, não meio dia. Três armadilhas silenciosas, não duas. Alvo 44.4.1 |
| **B2** `npm audit` | **Parcialmente falso.** 3, não 2; `--omit=dev` é 1, não 0, e alcança produção |
| **B6** assinatura de código | **Decisão mantida, comunicação faltando.** Zero menção a SmartScreen no README, e o `digest` SHA-256 que o GitHub já publica em cada asset não é usado por ninguém |
| **C4** `dist/` de 1,2 GB | **Pode sair.** Está no `.gitignore`, não existe no clone, nenhum artefato de build versionado |
| **C5** branches obsoletas | **Aberto e maior:** 17 mescladas, não 3, mais 2 releases-rascunho órfãos |
| **D1** extrair orquestração | **Aberto, com plano executável agora** (anexo 1 · 8). 4-5 dias em 4 fases |
| **D2** teste e2e de sinalização | **Resolvido sem ninguém marcar** — os dois arquivos existem desde 02/09 |
| **F1** acessibilidade | **Item estragado, precisa de texto novo.** As duas coisas que ele nomeia já existem (24+26 ocorrências de ARIA, 7 regras de `:focus-visible`). O que falta é outra coisa, e o "sem harness" caiu: o Playwright está aqui |
| **F3** host cai, sala morre | **Parcialmente resolvido.** O caminho gracioso funciona desde a 0.14.0; o abrupto ("o PC dele travou") cai nos três buracos do R3. O README ainda afirma o contrário, em dois lugares |
| **G1/G2/G3** áudio nativo | **Continuam verdade, e o G1 é pior do que foi descrito:** 6 cópias, e um laço JS por amostra na thread de áudio. `maxQueueSize = 0` = fila ilimitada. Três consertos baratos sem tocar no C++; o resto exige PC real |
| **G6** teto de ~4 | **Continua verdade, por desenho** — com a aritmética agora escrita, e a descoberta de que as duas constantes de fanout são decorativas |
| **H5** SFU | **Continua adiado, com a conta feita:** 60 Mbps no host numa sala de 6 |
| **H6** WebCodecs | **Deve sair do backlog** — medido como pior que o que já roda |
| **C1** "não existe CI" | **Precisa voltar ao backlog, com redação nova:** o CI existe, roda e é ignorado |
| "10 promessas soltas" | **Dívida paga.** `local/no-floating-promise` encontra 0 hoje, e a regra foi confirmada viva por sonda |

---

## O que ninguém conseguiu verificar

Marcado honestamente pelos times, e que só fecha com PC real:

- Se o **véu de pausa fica por baixo do rabisco** (o z-index diz que sim:
  véu em 2, canvas de tinta em 3). Pra confirmar: rabiscar numa tela e pausar.
- O **elo entre a injeção de HTML do chat e a falta de `will-navigate`** — os
  dois defeitos estão verificados isoladamente; a cadeia entre eles, não.
- Se `app.commandLine.appendArgument` **escapa da conversão pra minúsculas** do
  Electron 36. Precisa ser testado antes de virar a correção do B1.
- Se o **`pickAddress()` já restringe na prática** o servidor, que hoje escuta
  em `0.0.0.0` sem `host` explícito.
- Tudo que envolve **captura real, encoder de hardware e sala de 3+ PCs** — que
  é, não por acaso, o mesmo buraco que o `STATUS.md` registra para as três
  últimas releases: "lançada sem teste em PCs reais".

---

## Uma observação sobre método

As três últimas versões saíram sem teste em PCs reais **e** com o CI vermelho.
A Frente 0 resolve a segunda metade em dois dias. A primeira metade não tem
atalho: exige duas máquinas e uma noite. O anexo 4 escreve o roteiro fechado
(seis itens, do WGC vivo ao log do renderer legível); o repositório já tem três
roteiros do gênero em `docs/testes/`.

A recomendação, em uma linha: **nenhuma das Frentes B e C deveria ser lançada
sem essa noite.** A Frente 0 e a A, sim — são consertos com teste automatizado
possível, e a Frente 0 é justamente o que devolve o sinal que diz se eles
funcionaram.
