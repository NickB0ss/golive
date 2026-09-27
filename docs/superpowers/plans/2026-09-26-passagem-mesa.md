# Passagem: a Mesa, onde a sessão parou (2026-09-26)

## Atualização — sessão local de 2026-09-26 (noite)

Feitos: toda a seção 3.1 e toda a seção 3.2. Pôquer e blackjack agora cabem
na janela; as 25 chaves perdidas de `mesa-janelas.css` foram restauradas e há
teste para fechar cada chave do CSS do renderer. Entraram os testes de lugar
fantasma, e2e de segredo e bancada das cartas, travas no `mesa-count` e no
`welcome`, líder pelo `⋯` na Transmissão, cartão "Assistir" curto e
`timeoutAt(state, ctx)` compatível. As sete janelas novas são `truco`, `oito`,
`domino`, `stop`, `quiz`, `quadro` e `desenha`; todas secretas menos o Quadro,
com e2e próprio de segredo. O dominó é clássico, com 28 peças. Apoios novos:
`pedras` e `quiz-perguntas`.

A revisão final corrigiu permissões do Desenha, migração e saída de jogadores,
troca de gestão no Stop, reset e trava do Truco e vez/abertura do Dominó.
Nenhum vazamento de carta, peça ou palavra foi encontrado. Resultados:
`npm test` 1845 passando; lint 0 erros e 9 avisos antigos; `leva2-real.js`
97/0, `mesa-real.js` 31/0, `festa-real.js` 14/0, `rodar.js` 350/0,
`poquer-rodar.js` 47/0, `rodar-blackjack.js` 131/0 e `harness.js checar` sem
falhas. Prints: `docs/prints/2026-09-26-leva2/`. Playwright 1.62.1 já estava
instalado no PC do Nicolas.

Continuam pendentes a seção 3.3 e a seção 3.4. A seção 3.4 deve incluir as
sete janelas novas com pessoas de verdade: truco e dominó em duplas, oito com
3+, stop com votação, Desenha até o fim e Quiz completo.

Riscos novos: a suíte falha cerca de 1 em 5 vezes sob carga, nos testes com
espera de tempo do Quiz e da migração de cartas; isolada passa sempre. Em
"Ver tudo", `.mesa-ctrls` cobre controles do topo de pôquer, blackjack, oito e
dominó. A bancada ainda não cobriu truco e dominó com 4, oito com 3+ nem o fim
do Desenha pelo relógio. Vale decidir um conserto global para os controles.

Para abrir numa sessão nova, local, e continuar sem reler a conversa.
O PR #83 já está no `main`. Este trabalho saiu de `origin/main` na branch
**`feat/mesa-acabamento`**, ainda sem PR e sem merge. A versão do `package.json`
continua `0.21.0`.

Leia nesta ordem (15 min):

1. Esta nota.
2. `docs/superpowers/plans/2026-09-24-mesa-contrato.md` — **o documento
   central**: decisões do Nicolas (seção 0, mandam sobre a spec), formato dos
   módulos e das mensagens, o que cada time fez (5, 7, 8), regras dos jogos
   de cartas (9) e da próxima leva (10).
3. `STATUS.md`, seção "A Mesa".
4. Se precisar do porquê: `docs/superpowers/specs/2026-09-24-sala-em-dois-modos-design.md`
   (spec original; a seção 0 do contrato corrige a parte de "tipo da sala")
   e `docs/2026-09-24-pesquisa-janelas-da-mesa.md` (o que dá para pôr na
   Mesa e o que não dá, com fontes).

---

## 1. Preparar a máquina

```bash
git fetch origin
git checkout feat/mesa-acabamento
git pull
npm ci                 # no container usamos --ignore-scripts; no Windows,
                       # o addon nativo precisa do build de sempre (npm run build:native)
npm test               # esperado: 1646 passando, 0 falhando
npm run lint           # esperado: 0 erros, 9 avisos (os antigos de main.js/app.js)
```

Se o `npm run lint` acusar erros em `.claude/worktrees/...`, são cópias de
agentes: `npx eslint --ignore-pattern ".claude/**" .` mostra só o repo.

**Bancos de prova (Playwright).** Os scripts procuram o Playwright em
`/opt/node22/...` (caminho do container). No seu PC:

```bash
npm i -g playwright
npx playwright install chromium
# PowerShell:  $env:PLAYWRIGHT_DIR = "$(npm root -g)\playwright"
# bash:        export PLAYWRIGHT_DIR="$(npm root -g)/playwright"
```

| Comando | O que confere | Resultado na ponta desta nota |
|---|---|---|
| `node tools/mesa-prints/harness.js checar` | a vista da Mesa num navegador de verdade (arrastar com vez, travas, teclado, tela cheia, voltar à Transmissão sem sobrar DOM) | 0 falhas em 3 rodadas |
| `node tools/mesa-prints/harness.js prints` | refaz `docs/prints/2026-09-24-mesa/` | ok |
| `node tools/bancada-janelas/rodar.js` | as 12 janelas de ferramentas/jogos com duas pessoas | 350 conferências, 0 falhas (na última vez que rodou) |
| `node tools/bancada-janelas/mesa-real.js` | janelas montadas pela Mesa com o servidor de verdade, inclusive a batalha secreta | 31 conferências, 0 falhas |
| `node tools/bancada-janelas/festa-real.js` | Jam, Sons e Link no servidor de verdade | 14 conferências, 0 falhas |
| `node tools/bancada-janelas/leva2-real.js` | sete janelas novas, servidor real e pessoas em páginas separadas | 97 conferências, 0 falhas |
| `node tools/bancada-cartas/poquer-rodar.js` | pôquer com três pessoas | 47 conferências, 0 falhas |
| `node tools/bancada-cartas/rodar-blackjack.js` | blackjack com três pessoas | 131 conferências, 0 falhas |
| `xvfb-run -a npx electron --no-sandbox tools/midia/main.js` (Linux) / `npx electron tools/midia/main.js` (Windows) | YouTube e Twitch **falsos** + Electron real: sincronia e deriva | 23/23 |
| `npx electron tools/spike-youtube/main.js` | YouTube e Twitch **reais** pela origem nova | **nunca rodou** (o proxy do container bloqueia) |

Os bancos regravam PNGs em `docs/prints/`; se não quiser trocar os prints,
`git checkout -- docs/prints` depois.

---

## 2. O que está feito e junto na branch

**A Mesa** (fase 1 a 4 da spec, mais o que veio depois):

- Transmissão e Mesa são **vistas de cada pessoa** (seletor no topo). Na
  Transmissão nada da Mesa existe no DOM nem chega pela rede.
- Duas travas do líder (`leaderOnly`, `lockSize`); `act` (jogar, dar play)
  sempre livre.
- Telas e câmeras viram janelas (postas pelo servidor), o mesmo `<video>`
  sem renegociar; fora da vista 2 s → `watching:false`; largura vira teto de
  qualidade da tela **e da câmera** (por espectador, `scaleResolutionDownBy`).
- Volume, rabisco e reações do tile funcionam dentro da janela (volume pelo
  botão direito → "Volume e silenciar…").
- "Pôr na mesa" no chat para link do YouTube e para imagem.
- Origem `http://localhost` (sem porta aberta) para o YouTube aceitar embed;
  `localStorage` copiado uma vez do `file://`; `GOLIVE_ORIGEM=file` volta.
- **Informação escondida** (seção 8 do contrato): módulo `secret` com
  `view(state, peerId, ctx)`; eco de `act` leva o estado filtrado por
  pessoa (`op: 'state'`), nunca a ação; `timeout` pela hora do servidor;
  `migrate` sem segredo no `room-migrating`; `dropPeer` de todos os módulos
  quando alguém sai de vez (`op: 'drop'`).

**25 tipos de janela** (`src/renderer/mesa-modules/index.js`, `MODULE_NAMES`;
`*` = secreto):

| Grupo | Tipos |
|---|---|
| assistir | `youtube`, `radio`, `aovivo` (Twitch), `jam` (Spotify Jam) |
| ferramentas | `nota`, `lista`, `imagem`, `galeria`, `link` |
| noite | `enquete`, `placar`, `cronometro`, `sorteio`, `dados`, `roleta`, `sons` |
| jogos | `velha`, `lig4`, `damas`, `xadrez`, `batalha`*, `poquer`*, `blackjack`* |
| mídia (postas pelo servidor) | `tela`, `camera` |

Arquivos de apoio (não são tipo; `HELPER_NAMES`): `cadeiras`, `midialinks`,
`baralho`, `poquer-maos`. Desenho de cada tipo em
`src/renderer/mesa-janelas/<tipo>.js` (carregado sob demanda pela Vista) e
CSS em `src/renderer/mesa-janelas.css` (uma seção por time).

Links para fora (Jam, Link, logo do YouTube/Twitch): ponte
`golive.abrirLinkDaMesa(tipo, url)` → IPC `mesa:abrir-link`, só do quadro
principal, um por segundo, conferido de novo no main por
`src/main/linksexternos.js` (`linkDaMesa`, `dominioPublico`).

---

## 3. O que falta, em ordem de prioridade

### 3.1 Consertar antes de lançar (código, dá para fazer local)

**FEITO.** Pôquer e blackjack cabem na janela. A causa real era `mesa-janelas.css`
com 25 chaves `}` perdidas desde a junção da Festa; o CSS depois de
`.mj-jam-lista` ficava aninhado e sem efeito. O teste
`src/renderer/css-rules.test.js` agora fecha todas as chaves. Os itens abaixo
foram implementados, testados e conferidos nas bancadas.

1. **Pôquer e blackjack: o conteúdo não cabe na janela.** Os roteiros
   acusam, já nos worktrees dos próprios times (não foi a junção):
   - `poquer-rodar.js`: tamanho mínimo (540×345) com conteúdo de 540×619 a
     540×692 e lugares cortados; no showdown, 720×819 dentro de 720×460.
   - `rodar-blackjack.js`: 680×612 dentro de 680×440 (padrão) e 420×648
     dentro de 420×320 (mínimo).
   - Caminho: `container queries` no `mesa-janelas.css` (seções do pôquer e
     do blackjack) escondendo o secundário em janela pequena, cartas `p`
     (`cartas.js` tem tamanhos `p|m|g`), e talvez `size.minW/minH` maiores
     nos módulos. Rodar os dois roteiros até 0 falhas.
2. **Pôquer depois da migração**: o blackjack trata o lugar de quem não
   está em `ctx.peers` como livre (ids mudam na migração); o pôquer **não**
   (`grep ghost src/renderer/mesa-modules/blackjack.js` mostra como). Fazer
   igual, com teste.
3. **Teste do blackjack para os lugares "fantasmas"** (a adaptação foi
   commitada pelo integrador com os testes passando, mas sem teste próprio
   do caso).
4. **E2e de segredo para pôquer e blackjack** no padrão de
   `server/signaling-mesa-segredo-e2e.test.js`: varrer todas as mensagens
   que chegam a cada pessoa e provar que ninguém recebe carta alheia, a
   carta fechada da banca nem o baralho/sapato; e acrescentar os dois à
   `tools/bancada-janelas/mesa-real.js`.
5. **Acabamento, itens que não deu tempo**:
   - Travas visíveis na Transmissão: o líder na Transmissão hoje vê "Abra a
     Mesa para ver e mudar as travas". Mandar as travas junto do
     `mesa-count` (que vai para todos) e deixar o `⋯` mudá-las sem abrir a
     Mesa; conferir se o servidor aceita `lock` de quem não está na Mesa.
   - Cartão "Assistir" cortado na tira de miniaturas (defeito antigo, já na
     0.21.0; print `docs/prints/2026-09-24-mesa/01-transmissao.png`): em
     tile pequeno esconder a explicação longa e deixar avatar, nome e botão.

### 3.2 Próxima leva de janelas (regras já decididas no contrato, seção 10)

**FEITO.** Foram implementadas as sete janelas abaixo, com 32 tipos em
`MODULE_NAMES`. Todas são secretas menos o Quadro; cada uma tem e2e de segredo
próprio. `pedras` e `quiz-perguntas` entraram em `HELPER_NAMES`.

Texto anterior, agora superado: nenhum código escrito ainda (os dois times
caíram por limite de uso antes do primeiro commit):

- **Cartas BR**: `truco` (paulista, 2 ou 4, vira/manilhas, truco-seis-nove-
  doze, encoberta, mão de onze e de ferro, a 12) e `oito` (Oito maluco, a
  100). Ambos `secret`. Usar `baralho.js` e `mesa-janelas/cartas.js`.
- **Festa com segredo**: `quadro` (folha para rabiscar; **faltava da fase 2
  da spec**; traços pelo canal `annotate`, não pelo estado da janela),
  `desenha` (Desenha e adivinha, sobre o Quadro), `stop` (Stop/Adedonha com
  anulação por votação), `quiz` (banco de perguntas em português).
- **Dominó**: ainda sem regras escritas; decidir (sugestão: dominó
  "pontinho"/clássico de 28 peças, 2 a 4, duplas, com passe e contagem) e
  pôr na seção 10 antes de codar.

Molde para qualquer jogo secreto: `mesa-modules/batalha.js` (+ teste),
`mesa-janelas/batalha.js`, e o e2e de segredo.

### 3.3 Da pesquisa, ainda não feito

"Tocando agora" e "Jogando agora" (precisam do addon nativo, Windows),
"Filme do seu PC" (vídeo local pela árvore de retransmissão), "Quem sou eu",
"Palavras secretas", Kick. Fora de propósito: Spotify tocando dentro do app,
Akinator, Stockfish, co-browsing (motivos na pesquisa, seção 6).

### 3.4 Só no PC real (bloqueia versão)

Além dos itens abaixo, falta testar com pessoas de verdade as sete janelas
novas: truco e dominó em duplas, oito com 3+, stop com votação, Desenha até o
fim e Quiz completo.

- **Roteiro da Mesa com 2+ PCs**: `docs/testes/2026-09-25-roteiro-mesa.md`
  (vistas de cada um, mexer juntos, travas, jogos, fora da vista para de
  receber — log `[assistir] view-state ... watching=false` —, queda do líder
  com a mesa cheia, atualização da 0.21).
- **YouTube e Twitch reais**: `docs/testes/2026-09-24-roteiro-youtube-na-mesa.md`
  (e `npx electron tools/spike-youtube/main.js`). O que falta provar está em
  `docs/2026-09-24-midia-na-mesa.md` (sandbox aceito, `setPlaybackRate`,
  erros 101/150 vs 153, `parent=localhost`, logo abrindo o navegador).
- **Desempenho com GPU** (a medição foi no Chromium sem GPU:
  `docs/2026-09-24-spike-desempenho-mesa.md`).
- **Cartas com 3+ pessoas de verdade**: pôquer (potes paralelos, tempo de 30
  s), blackjack (dividir/dobrar/seguro), batalha naval.
- A noite de teste antiga que já estava pendente (queda do líder, fanout 2
  com 5-6 PCs) — ver "Próximos passos" do `STATUS.md`.

### 3.5 Decisões do Nicolas

**Decidido.** O dominó é o clássico de 28 peças. Damas continua com 20 lances
no total; `KING_ONLY_DRAW` não muda. O PR #83 já foi mesclado no `main`; este
acabamento está na branch `feat/mesa-acabamento`, ainda sem PR, e a versão
continua 0.21.0.

- **Damas**: empate por "20 lances só com damas, sem captura" foi contado
  como 20 no total (10 de cada). Se for 20 de cada, é a constante
  `KING_ONLY_DRAW` em `mesa-modules/damas.js`.
- **Versão e PR**: número da versão (sugestão 0.22.0), notas de lançamento,
  e quando fazer o merge do PR #83 no `main` (antes ou depois do teste real).
- **Dominó**: decidido como o clássico de 28 peças (ver 3.2).

Atualização das decisões: Damas continua com 20 lances no total
(`KING_ONLY_DRAW` não muda). O PR #83 já está no `main`; esta branch é o
acabamento, ainda sem PR e sem merge. A versão continua 0.21.0.

---

## 4. Como a sessão trabalhou (para repetir ou não)

Na sessão local: integração na sessão principal; jobs do Codex (terra high
para segredo/revisão, terra medium para janelas e correções, luna medium para
conteúdo/formatação), no máximo dois ao mesmo tempo, e um ou dois subagentes
Claude Sonnet para o que precisava de navegador. A sandbox do Codex não grava
no `.git` de um worktree; quem integra faz o commit. Terra precisa de padrão
explícito de qualidade no prompt (linhas com no máximo 120 colunas, um teste
por regra e janela com todas as ações). Luna acentuou o Quiz com regex em
tempo de execução; foi trocado por texto estático. A cota do Codex acabou uma
vez; `codex exec resume` retomou sem perda.

- **Integrador + times em worktrees.** A sessão principal escreveu o
  contrato antes de cada leva, lançou agentes com `isolation: "worktree"`
  (um por assunto, arquivos separados), e juntou cada branch com `git merge
  --no-ff`, rodando `npm test`, lint e os bancos a cada junção.
  Commits dos agentes nunca foram enviados direto: só a branch principal vai
  para o GitHub.
- **Conflitos esperados** em toda junção de janelas novas: `MODULE_NAMES`
  (`mesa-modules/index.js`), as tags `<script>` no `index.html` e o fim do
  `mesa-janelas.css`. São sempre "os dois acrescentaram": manter os dois.
- **Limite de uso da API**: com 4-6 agentes ao mesmo tempo o limite da
  sessão estourou várias vezes (reset a cada ~5 h). Pedir aos agentes
  "commite cedo e sempre" salvou o trabalho; retomar com `SendMessage` ao
  mesmo agente mantém o contexto dele. Numa sessão local, 2-3 agentes por
  vez rende mais.
- **Regras do projeto que os agentes precisam ouvir**: português em código,
  comentários e commits (assunto sem acento); cor só por token de
  `style.css`; `--live` só para "ao vivo"; nada de `filter`/`backdrop-filter`
  sobre vídeo; só `transform` e opacidade animam; nenhum `id` do
  `index.html` removido; glossário (`docs/glossario.md`, testado).
  Atenção a um detalhe achado aqui: animação com a propriedade `scale`
  avulsa encolhe também o `translate` do `transform` (a janela "voava");
  animar sempre pelo próprio `transform`.

### Prompt sugerido para abrir a sessão local

> Leia `docs/superpowers/plans/2026-09-26-passagem-mesa.md` e o contrato
> `docs/superpowers/plans/2026-09-24-mesa-contrato.md`. Estou na branch
> `feat/mesa-acabamento`. Comece pela seção 3.1 da
> passagem (pôquer/blackjack cabendo na janela, pôquer depois da migração,
> e2e de segredo das cartas, os dois itens do acabamento), junte, rode
> `npm test`, lint e os bancos, e depois lance a leva da seção 3.2.
