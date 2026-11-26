# Auditoria da Mesa: bugs reais (2026-11-25)

Escopo: `src/renderer/mesa*.js`, `src/renderer/mesa-modules/**` (regras), `src/renderer/mesa-janelas/**`.
Nada de código de produção foi alterado. Os testes de reprodução estão em
`/tmp/claude-0/-home-user-golive/55573a2c-39b7-58ae-bbac-ac37f25f7d3b/scratchpad/bugs-mesa/` (`node --test <arquivo>`).
Convenção: cada teste afirma o comportamento CORRETO; "falha" = o bug reproduziu.
Os testes `e2e`/`forja` sobem o `signaling-core` de verdade (harness em `harness.js`);
os `pure.test.js`/`misc.test.js`/`dom2.test.js` rodam `validate -> prepare -> reduce` como o servidor
(o `reduce` só recebe `{ from, isLeader }`, como em `mesa.js:applyOp`).

Legenda de evidência: CONFIRMADO = reproduzido por teste; PLAUSÍVEL = leitura de código, sem teste fim a fim.

## Resumo

| id | gravidade | achado |
|---|---|---|
| J-01 | alta | Truco: `from` forjado na ação faz o servidor aceitar jogada/resposta/sentar em nome de outra pessoa |
| J-02 | alta | Truco: `{type:'timeout'}` (sem `kind`) pula a checagem `early` do servidor: qualquer um força "corre", joga a carta do outro etc. |
| J-03 | alta | Quiz: depois da 1ª rodada o prazo vira ~20 000 (1970); `timeout` passa na hora e a pontuação por velocidade some |
| J-04 | média | Velha/Lig4/Damas/Xadrez: após migração de host as cadeiras ficam presas a ids que não existem mais |
| J-05 | média | Truco: espectador que senta no meio da mão trava a mão com um truco e, ao levantar, corrompe `scores` |
| J-06 | média | Dominó: `timeout` é recusado na fase `opening`; quem ganhou a mão e está AFK trava a mesa |
| J-07 | média | Dominó: sentar no meio da mão põe uma cadeira de mão vazia no rodízio; ela ganha a tranca com 0 pontos |
| J-08 | média | Oito maluco: sentar no meio da rodada + comprar uma carta jogável = mão vazia = vence a rodada |
| J-09 | média | Desenha: quando o desenhista sai, o próximo é creditado sem desenhar e o prazo de escolha vira 1970 |
| J-10 | média | Oito maluco: após migração, lugar fantasma recebe cartas e a vez (`reduce` não enxerga `peers`) |
| J-11 | média | Quiz: a `view` entrega `id` + `ordem`; o banco está no renderer, então a resposta certa é calculável |
| J-12 | baixa | Truco/Oito/Dominó: dá para começar nova mão depois do fim do jogo sem reset; placar segue acima de 12/100 |
| J-13 | baixa | Rádio: `ended`/`failed` de qualquer um pula a música e burla "só quem pôs ou o líder pula" |
| J-14 | baixa | Stop: voto com `category` negativa é aceito e enche o estado (16 KB) até recusar votos legítimos |
| J-15 | baixa | Pôquer/Blackjack: levantar e sentar de novo devolve 1000 fichas (burla a regra de recompra só com zero) |
| J-16 | baixa | Quadro escondido: após migração `owner` é id antigo, ninguém desfaz o `hidden` |

Sem achado (verificado e descartado): ver a seção final.

---

## J-01 (alta) Truco aceita `from` forjado

- Arquivo: `src/renderer/mesa-modules/truco.js:31-37` (`origem`/`idDaAcao`), `:205-216` (`preparar`), `:232` (`validar`), `:336-343`/`:364` (`reduzir`).
- Defeito: `idDaAcao` prefere `acao.from` (vindo do cliente) a `ctx.from`; o servidor não limpa a ação (`signaling-core.js:~1236 (cloneJson da ação)` só clona), e `preparar` copia o `from` forjado.
- Cenário: Ana (cadeira 0) e Bia (cadeira 1) jogam; Otávio, que só assiste, manda `{kind:'play', index:0, from:'<id da Bia>'}` e o servidor joga a carta da Bia (ou `answer`/`call`/`stand`/`eleven` por ela). Também `{kind:'sit', seat:2, from:'<id da Bia>'}` senta a Bia à força.
- Evidência: CONFIRMADO. `truco-forja.test.js` casos T1 (jogou a carta de Qd pela vez do dono) e T1b (`seats` ficou `[null,null,"2",null]` com `"2"` = Bia).
- Correção: usar só `ctx.from` em `validar`/`preparar`; em `reduzir` ler `ctx.from` (o cliente também recebe `msg.by` como `ctx.from`) e ignorar `acao.from`.

## J-02 (alta) Truco: `type: 'timeout'` escapa do `early` do servidor

- Arquivo: `truco.js:26-29` (`comTipo`: `type || kind`) combinado com `server/signaling-core.js:1243` (`if (action.kind === 'timeout')`).
- Defeito: o servidor só confere o prazo quando `action.kind === 'timeout'`; o truco aceita `type` no lugar de `kind` e o `validar` de timeout (`truco.js:252`) só olha se existe `deadline`.
- Cenário: A pede truco; antes de B responder, qualquer pessoa manda `{type:'timeout'}`. Cai em `reduzirTimeout` (`:409`): o pedido vira "corre" e A leva a mão. Ou joga a carta mais fraca da vez de quem estiver pensando.
- Evidência: CONFIRMADO. `truco-forja.test.js` T2: com `kind` o servidor devolve `early`; com `type` o timeout é aceito e a carta é jogada.
- Correção: aceitar só `kind` no truco (remover `comTipo`/`type`); e, defesa em profundidade, conferir `ctx.now >= mao.deadline` no `validar` de timeout (como poquer/blackjack fazem).

## J-03 (alta) Quiz: prazo da 2ª pergunta em diante é 1970

- Arquivo: `src/renderer/mesa-modules/quiz.js:50` (`agora(ctx)`), `:145-161` (`avancar`), `:191`, `:193`; `prepare` do `timeout` (`:132`) não leva `at`.
- Defeito: `reduce` roda com `ctx = {from, isLeader}` (sem `now`), então `agora(ctx) = 0` e `deadline = 0 + 20000`. Os testes do módulo passam `now` no ctx do reduce, o que o servidor nunca faz.
- Cenário: todos respondem a 1ª pergunta; a 2ª nasce com `deadline = 20000`. (a) `timeoutAt` já passou, qualquer um manda `timeout` e a pergunta é pulada na hora (o `early` não protege); (b) `prepare` da resposta calcula `started = 0` e `seconds = 500`, então todo acerto vale 500 (bônus de velocidade some); (c) contagem regressiva na tela mostra negativo.
- Evidência: CONFIRMADO. `quiz-deadline.test.js` (prazo `20000`) e `e2e2.test.js` Q1b (`timeout` aceito logo após a 2ª pergunta, `round` foi a 2).
- Correção: `prepare` colocar `at` em `answer` e `timeout` e o `reduce` usar `action.at` (como `start`), em vez de `ctx.now`; mesma coisa em `dropPeer` (`:232`, hoje usa `state.deadline`).

## J-04 (média) Cadeiras de jogos de 2 pessoas viram fantasmas depois da migração

- Arquivo: `src/renderer/mesa-modules/cadeiras.js:65-73` (`validateSeat`), `:152-156` (`canReset` mantém `seats`); afeta `velha.js`, `lig4.js`, `damas.js`, `xadrez.js` (nenhum tem `migrate` nem olha `ctx.peers`).
- Defeito: o contrato (seção 5/8) diz que ids mudam na migração e que cadeira de quem não está em `ctx.peers` deve contar como livre; `validateSeat` só olha `state.seats[seat] !== null`, `dropPeer` nunca é chamado para id antigo, e `reset` preserva `seats`.
- Cenário: host cai com uma partida de velha/xadrez em andamento; no servidor novo ninguém consegue sentar (`ocupada`), nem levantar (`não está sentado`), nem `reset` libera. Só tirar e pôr a janela de novo.
- Evidência: CONFIRMADO fim a fim. `e2e2.test.js` M1b: `seats` migrados `["1","2"]`, ids novos `3`/`4`, sentar => `mesa.cadeiras.ocupada`, levantar => recusado. Versão pura em `pure.test.js` M1.
- Correção: em `cadeiras.js` tratar cadeira cujo id não está em `ctx.peers` (quando a lista vem) como livre em `validateSeat`/`canPlay`/`seatOf`; ou `migrate` dos 4 módulos zerando `seats`/`names`.

## J-05 (média) Truco: quem senta no meio da mão trava ou corrompe o placar

- Arquivo: `truco.js:236-243` (`sit` sem checar mão em curso), `:269-275` (`call` não confere se o autor está na mão), `:418-429` (`removerPessoa`).
- Defeito: espectador senta numa cadeira livre durante a mão; `duplaDaMao(mao, lugar)` devolve `-1`. `call` passa (`-1 !== lastCaller`) e cria `pending {fromTeam:-1, toTeam:2}` que ninguém pode responder; ao levantar, `encerrar(estado, 1 - (-1), ...)` faz `scores[2] += valor`.
- Cenário: com 2 jogadores nas cadeiras 0 e 2, um terceiro senta na 1 e aperta Truco: a mão fica parada até estourar o tempo (30 s) e é anulada (`scores[-1]`). Se levantar, `scores` vira `[0,0,null]` e a mão é cancelada. Repetível por quem quiser atrapalhar.
- Evidência: CONFIRMADO. `pure.test.js` T3: `sit` aceito, `call` aceito com `pending {"fromTeam":-1,"toTeam":2}`, `stand` => `scores=[0,0,null]`, `hand=null`.
- Correção: recusar `sit` com `estado.hand` ativo (ou `call/answer/play/eleven` só se `duplaDaMao(...) >= 0`), e em `encerrar`/`removerPessoa` ignorar dupla `-1`.

## J-06 (média) Dominó: `timeout` recusado na fase `opening`

- Arquivo: `src/renderer/mesa-modules/domino.js:145` (`validate` só aceita `phase === 'play'`) contra `:425-427` (`timeoutAt` inclui `opening`) e `:327-329` (`timeout` sabe abrir).
- Defeito: a UI e o servidor acham que há prazo de 30 s para o vencedor abrir, mas o `validate` recusa o `timeout`.
- Cenário: quem ganhou a mão anterior (ou saiu da sala: `dropPeer` `:377` só reajusta a vez em `play`) não abre; ninguém consegue disparar o tempo. Só "Nova mão" (que devolve a abertura ao mesmo vencedor) ou `reset` sai disso.
- Evidência: CONFIRMADO. `pure.test.js` D1: `timeout` em `opening` => `mesa.domino.nadaCorrendo` com `timeoutAt === deadline`.
- Correção: `validate` de `timeout` aceitar `play` e `opening`; `dropPeer` na fase `opening` com vez do que saiu: abrir/zerar o vencedor.

## J-07 (média) Dominó: cadeira sentada no meio da mão entra no rodízio sem pedras

- Arquivo: `domino.js:97-105` (`validarLugar` não olha `phase`), `:174-180` (`proximoLugar` conta qualquer cadeira), `:284-291` (`vencedorDaTranca`).
- Defeito: quem senta durante `play` entra na ordem de jogo com `hands[lugar] = []`, altera `lugaresOcupados` (tranca/quatro duplas) e `pontosNaMao = 0`.
- Cenário: 2 jogadores; um terceiro senta; na tranca ele tem 0 pontos e leva a mão (79 pontos no teste); antes disso a vez cai nele e ele pode comprar do monte.
- Evidência: CONFIRMADO. `dom2.test.js` D2b: `passes 0 1 2 -> {"reason":"trancou","winner":2,"gain":79}`; `pure.test.js` D2: `sit` no meio da mão é aceito.
- Correção: recusar `sit` quando `phase` é `opening`/`play` (ou marcar a cadeira como "espera a próxima mão").

## J-08 (média) Oito maluco: sentar no meio da rodada dá vitória por mão vazia

- Arquivo: `src/renderer/mesa-modules/oito.js:102-108` (`sit` sem checar `phase`), `:245-251` (`draw` joga automaticamente a 1ª carta jogável), `:183-189` (`putCard` encerra se a mão ficou vazia).
- Defeito: quem senta durante `play` tem `hands[seat] = []`; ao comprar e a 1ª carta comprada já servir, `putCard` esvazia a mão e `finishRound` dá todos os pontos dos outros a ele.
- Cenário: espectador senta, espera a vez, aperta "Comprar": ~30 % das vezes ganha a rodada sem ter jogado.
- Evidência: CONFIRMADO. `pure.test.js` O1 (`sit` aceito) e O1b (40 sementes: 12 vitórias imediatas por 1 saque).
- Correção: recusar `sit` com `phase === 'play'` (entra na próxima rodada) ou excluir do rodízio quem não foi dado em `start`.

## J-09 (média) Desenha: desenhista que sai faz o próximo ser creditado e sem prazo

- Arquivo: `src/renderer/mesa-modules/desenha.js:443-446` (`dropPeer`: `drawerIdx %= players.length` aponta para o próximo e então chama `endRound`), `:326-345` (`endRound`).
- Defeito: `endRound` lê `drawerIdOf` do estado já sem o desenhista, então credita `drawCounts` e `lastRound.drawerId` ao próximo e pula a vez dele; além disso `endRound(..., null, 0)` dá `deadline = 0 + 15000` e `options` = 3 primeiras palavras da lista.
- Cenário: A, B, C; A desenha e sai. B ganha "1 desenho" sem desenhar, `lastRound` diz que B desenhou a palavra, C é quem escolhe; a escolha já nasce vencida (qualquer `timeout` passa) e escolhe sempre cachorro/gato/elefante.
- Evidência: CONFIRMADO. `pure.test.js` DS1: `drawCounts {"B":1}`, `lastRound.drawerId "B"`, `deadline 15000`, `options ["cachorro","gato","elefante"]`.
- Correção: no `dropPeer`, chamar `endRound` ANTES de remover o jogador (ou passar o id do desenhista) e levar `at`/`nextOptions` de `prepare` (via ação `drop` com hora) em vez de `0`/`null`.

## J-10 (média) Oito maluco: lugar fantasma depois da migração

- Arquivo: `oito.js:224` (`players(out, ctx)` no `reduce`), `:47-51`; `migrate` (`:281-287`) mantém `seats` antigos.
- Defeito: `validate` (servidor, com `peers`) conta só quem está na sala, mas `reduce` (sem `peers`) distribui cartas a todo lugar ocupado, inclusive id antigo; `turn = p[0]` pode ser o fantasma.
- Cenário: migração com alguém sentado no lugar 0; novos jogadores sentam 1 e 2 e dão `start`: a vez cai no lugar 0 (5 cartas para ninguém); ninguém joga e cada volta custa 30 s de timeout que compra carta pelo fantasma.
- Evidência: CONFIRMADO no módulo reproduzindo o fluxo do servidor. `pure.test.js` O2: `start -> turn=0 maos=5,5,5`.
- Correção: `migrate` limpar `seats`/`names` (como batalha trata) ou `prepare` do `start` gravar `players` na ação e o `reduce` usá-los.

## J-11 (média) Quiz: resposta certa calculável no cliente

- Arquivo: `quiz.js:196-225` (`view` entrega `question: { id, tema, ordem }`), `quiz-perguntas.js` (o renderer carrega `certa` de todas as perguntas).
- Defeito: o contrato da seção 8 diz que o segredo não sai do servidor; aqui `ordem` + `id` + banco local entregam o índice certo antes de responder.
- Cenário: qualquer participante abre o DevTools e responde sempre certo e rápido (1000 pts).
- Evidência: CONFIRMADO. `pure.test.js` Q2: índice deduzido = índice real.
- Correção: o servidor mandar na `view` o texto das alternativas já ordenado (o banco de textos serve ao servidor; o cliente só mostra), ou não expor `certa` ao renderer; manter `certa` só em `history` depois de revelado.

## J-12 (baixa) Fim de jogo não bloqueia nova mão

- Arquivos: `truco.js:248-250` (`deal` só olha `maoValida`), `oito.js:117-118` (`start` só bloqueia `play`), `domino.js:139-144` (`start` só bloqueia `play`; `scores` nunca zeram e `result.game` é só informativo).
- Defeito: com `phase: 'finished'` (≥ 12 no truco, ≥ 100 no oito) ainda dá para dar cartas; o placar segue de onde parou e `finished` é recalculado, escondendo o vencedor.
- Evidência: CONFIRMADO. `pure.test.js` T4 (truco: `deal` aceito com `[12,3]`, `phase=play`), `misc.test.js` O3 (oito: `start` aceito, `scores=[105,0]`, `winner=null`).
- Correção: exigir `reset` quando `phase === 'finished'` (ou zerar `scores` ao começar partida nova).

## J-13 (baixa) Rádio: `ended`/`failed` burlam a permissão de pular

- Arquivo: `src/renderer/mesa-modules/radio.js:109-115` (parse), `:187` (validate aceita), `:251-259` (reduce).
- Defeito: `ended` só confere que o `videoId` bate com a atual; qualquer pessoa manda e a fila avança sem voto, mesmo que `skip` seja `soQuemPosPula`.
- Evidência: CONFIRMADO. `pure.test.js` R1: `skip` do intruso é recusado, `ended` do mesmo intruso avança para a próxima.
- Correção: exigir que `pos` do `ended` (ou `ctx.now - at`) esteja perto do fim, ou aceitar `ended`/`failed` só de quem pediu para tocar/ou com maioria; no mínimo limitar a 1 por faixa e por pessoa.

## J-14 (baixa) Stop: `category` negativa aceita em voto

- Arquivo: `src/renderer/mesa-modules/stop.js:107-108` (parse só exige inteiro) e `:180` (validate só testa `>= categories.length`).
- Defeito: dá para votar em `category: -1, -2, ...`; cada um vira uma entrada em `votes` que não conta pontos.
- Cenário: um participante manda ~300 votos lixo na revisão; o estado chega a ~15,6 KB (teto 16 KB) e os votos de anulação legítimos passam a ser recusados (`state-too-big`) até o criador fechar a correção.
- Evidência: CONFIRMADO. `pure.test.js` S1 (aceito; 301 votos, 15 619 bytes).
- Correção: exigir `0 <= category < categories.length` no `parse`/`validate`.

## J-15 (baixa) Fichas: levantar e sentar devolve 1000

- Arquivo: `poquer.js:519-525` (`sit` => `STACK`; `stand` zera), `blackjack.js:590-598` (`sit` => `START_CHIPS`).
- Defeito: o contrato diz que recompra só com zero fichas e "entre mãos"; com stand+sit quem tem 5 fichas volta com 1000 (inclusive no meio do jogo).
- Evidência: CONFIRMADO. `misc.test.js` P1 e B1 (1000 após levantar/sentar com 5/10 fichas).
- Correção: guardar as fichas por id (`bank[id]`) para quem volta à mesa, ou aceitar como regra e documentar. Prioridade baixa (fichas de mentira).

## J-16 (baixa) Quadro escondido fica preso após migração

- Arquivo: `src/renderer/mesa-modules/quadro.js:33-40` (`validate` só deixa o `owner` mexer), `:68-73` (`dropPeer` só trata saída normal).
- Defeito: após migração `owner` é um id antigo; se o quadro estava `hidden`, ninguém vê, desenha nem desfaz.
- Evidência: PLAUSÍVEL (mesma causa confirmada em J-04; sem teste dedicado do quadro). Correção: `migrate` voltando `hidden: false`.

---

## Verificado e sem defeito (não reportar de novo)

- Avaliador de mãos do pôquer (`poquer-maos.js`): comparado com uma implementação independente em 4 000 mãos de 7 cartas (kicker, trinca/dois pares, roda A-2-3-4-5, flush, full, empate): 0 divergências (`fuzz.test.js`).
- Pôquer (`poquer.js`): fuzz de 1 800 mãos com 2 a 8 jogadores, ações aleatórias só entre as que `view.me.actions` libera: fichas conservadas, nenhuma mão travou, maior estado 1 761 bytes (teto 8 192). Potes paralelos, aumento curto que não reabre ação, dealer/blinds mano a mano e `timeout` coerentes com a seção 9.
- Blackjack (`blackjack.js`): fuzz de 5 000 rodadas (1 a 5 lugares, seguro, dobrar, dividir, timeouts): `Δfichas = soma(win) + seguro` em toda rodada, nenhuma travada, estado dentro do teto. Ás 1/11, S17, 3:2, blackjack natural vs 21 pós-divisão, ases divididos e carta fechada da banca ok.
- Segredo: nas `view` de truco, pôquer, blackjack, dominó, batalha, oito, stop e desenha não achei carta/pedra/navio/palavra de outro jogador (exceto J-11 no quiz). `ctx.from` é usado corretamente em todos exceto o truco (J-01).
- Batalha, Damas (regra brasileira, captura por maioria, promoção só ao terminar), Xadrez (chess.js), Lig4, Velha: regras e `validate` ok; `prepare` descarta campos do cliente (frota, `at`).
- Dados, roleta, sorteio, cronômetro, sons, enquete, jam, aovivo, link, youtube: `prepare` sobrescreve `by`/`at`/sorte do cliente; embaralhamentos são Fisher-Yates corretos; URLs do YouTube, Twitch, Jam e Link passam por lista de hosts + regex (id de 11 caracteres, `https` sem usuário/porta/IP).
- XSS: `mesa-view.js` escapa tudo que mistura dado de pessoa em `innerHTML` (`escapeHtml` em nomes, tooltips e avatar); `mesa-janelas/*.js` usam `textContent`/`h()`; os únicos `innerHTML` restantes recebem SVG fixo (ícones, `pedraSvg` com números validados). Sem achado.

## Observações menores (não entram como bug)

- Oito: `view.me.can.play` é `true` para espectador quando não há rodada (`-1 === -1`, `oito.js:319`); a mão vazia faz o botão não ter efeito.
- `reset` de qualquer sentado (cadeiras, truco, oito, domino) apaga a partida em andamento; é decisão de projeto (`cadeiras.canReset`), mas permite escapar de derrota.
- Truco: mão de ferro vale 3 (`truco.js:169`); o contrato não diz o valor (muitas regras dão 1).
