# Passagem: a Mesa, onde a sessão parou (2026-09-26)

Para abrir numa sessão nova, local, e continuar sem reler a conversa.
Branch: **`claude/project-planning-analysis-5e9lub`** (no GitHub, ponta desta
nota). **Nada disso está no `main` nem em release**: a versão do
`package.json` continua `0.21.0`. Sem PR aberto.

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
git checkout claude/project-planning-analysis-5e9lub
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
| `node tools/bancada-janelas/mesa-real.js` | janelas montadas pela Mesa com o servidor de verdade, inclusive a batalha secreta | 26 conferências, 0 falhas |
| `node tools/bancada-janelas/festa-real.js` | Jam, Sons e Link no servidor de verdade | 14 conferências, 0 falhas |
| `node tools/bancada-cartas/poquer-rodar.js` | pôquer com três pessoas | **falha**: conteúdo sai da janela (ver 3.1) |
| `node tools/bancada-cartas/rodar-blackjack.js` | blackjack com três pessoas | **falha**: conteúdo sai da janela (ver 3.1) |
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

Nenhum código escrito ainda (os dois times caíram por limite de uso antes
do primeiro commit):

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

### 3.5 Decisões do Nicolas em aberto

- **Damas**: empate por "20 lances só com damas, sem captura" foi contado
  como 20 no total (10 de cada). Se for 20 de cada, é a constante
  `KING_ONLY_DRAW` em `mesa-modules/damas.js`.
- **Versão e PR**: número da versão (sugestão 0.22.0), notas de lançamento,
  e quando abrir o PR para o `main` (antes ou depois do teste real).
- **Dominó**: qual variante (ver 3.2).

---

## 4. Como a sessão trabalhou (para repetir ou não)

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
> `claude/project-planning-analysis-5e9lub`. Comece pela seção 3.1 da
> passagem (pôquer/blackjack cabendo na janela, pôquer depois da migração,
> e2e de segredo das cartas, os dois itens do acabamento), junte, rode
> `npm test`, lint e os bancos, e depois lance a leva da seção 3.2.
