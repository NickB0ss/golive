# Rework das janelas da Mesa — plano de implementação

> **Para quem executa:** cada leva é um job do Codex (`gpt-5.6-terra`), sem commit; a sessão principal revisa,
> roda as bancadas e commita. Passos em checkbox (`- [ ]`).

**Objetivo:** as 30 janelas da Mesa ganham materiais (feltro, tabuleiro, papel, lousa, palco), componentes comuns
(cadeiras, vazio, ações) e as regras de botão, escala e título da spec.

**Arquitetura:** só renderer. `mesa-janelas.css` vira uma lista de `@import` de folhas por família;
`mesa-janelas/comum.js` ganha a tabela `SUPERFICIES` e os componentes `cadeiras`, `vazio` e `acoes`; cada
`mesa-janelas/<tipo>.js` adota o que lhe cabe.

**Spec:** `docs/superpowers/specs/2026-10-01-janelas-da-mesa-rework-design.md` (ler inteira antes de qualquer leva).

## Restrições globais

- Não tocar em `server/`, `src/renderer/mesa-modules/` (inclusive `size`) nem na lógica de jogo dos `mesa-janelas/*.js`.
- Hex novo só nas custom properties `--mj-mat-*` do topo de `mesa-janelas/css/base.css`.
- Nada de `filter`, `backdrop-filter`, imagem de fundo ou SVG com `feTurbulence`. Só `transform`/`opacity` animam,
  ≤ 300 ms, e `prefers-reduced-motion` desliga.
- Vermelho (`--live`) só para "ao vivo". Cor de pessoa (`--mj-cor`) só em detalhe.
- Texto lido ≥ 12 px, só por `--fs-*`/`--t-*`. Nenhum conteúdo repete o título da barra da janela.
- Todo botão continua botão, com o mesmo `aria-label`; desligar é `aria-disabled` via `ligado()`.
- Padrão de código: ≤ 120 colunas, uma instrução por linha, comentários em PT sem acento como no resto do arquivo,
  um teste por regra do contrato. Não "acentuar" nem gerar texto por regex em tempo de execução.
- Arquivos em UTF-8 com fim de linha LF; nada de `â€”` (conferir com `git diff | grep 'â€'`).
- `PLAYWRIGHT_DIR=C:/Users/nicol/Desktop/portfolio-nubinho/node_modules/playwright`.
- Bancadas regravam `docs/prints/`: não incluir PNG nos commits das levas.

---

## Leva 0 — Fundação

### Tarefa 0.1: dividir `mesa-janelas.css` (só mover)

**Arquivos:**
- Criar: `src/renderer/mesa-janelas/css/{base,ferramentas,tabuleiros,cartas,festa,midia,movimento}.css`
- Modificar: `src/renderer/mesa-janelas.css` (passa a ter só os `@import`, nesta ordem: base, ferramentas,
  tabuleiros, cartas, festa, midia, movimento), `src/renderer/css-rules.test.js`,
  `tools/sinal-prints/classes-orfas.js`

Mapa das seções atuais (pelos comentários `/* ---------- X ---------- */`):

| Folha | Seções |
|---|---|
| base | Base, Segmentado, Nome de pessoa na cor dela, Dentro da caixa da Vista |
| ferramentas | Placar, Nota, Cronometro, Sorteio, Enquete, Dados e moeda, Roleta, Lista, Sons, Quadro (onde estiver) |
| tabuleiros | Tabuleiros: moldura comum, Velha, Lig 4, Tabuleiro 8x8, Damas, Xadrez, Batalha naval |
| cartas | Pôquer, Blackjack e o que houver de truco, oito, domino e cartas comuns |
| festa | Stop, Quiz, Desenha |
| midia | Imagem, Galeria, Palco (video), Radio, Spotify Jam, Link e o que houver de youtube/aovivo |
| movimento | Movimento e o bloco final de `prefers-reduced-motion` |

Uma seção que não esteja na tabela vai para a folha da sua família pela spec, seção 4.

- [ ] **Passo 1:** em `css-rules.test.js`, trocar a leitura única por todas as folhas: `mesaJanelas` passa a ser a
  concatenação de `mesa-janelas/css/*.css` (ordenadas pelo `@import`). Acrescentar o teste:

```js
test('mesa-janelas.css so importa, e importa toda folha de mesa-janelas/css', () => {
  const entrada = fs.readFileSync(path.join(__dirname, 'mesa-janelas.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const importados = [...entrada.matchAll(/@import url\('mesa-janelas\/css\/([\w-]+\.css)'\);/g)].map((m) => m[1]);
  const semImport = entrada.replace(/@import url\('[^']+'\);/g, '').trim();
  assert.equal(semImport, '', 'mesa-janelas.css so pode ter @import');
  const folhas = fs.readdirSync(path.join(__dirname, 'mesa-janelas', 'css')).filter((f) => f.endsWith('.css')).sort();
  assert.deepEqual([...importados].sort(), folhas);
});
```

- [ ] **Passo 2:** `node --test src/renderer/css-rules.test.js` → falha (a pasta não existe).
- [ ] **Passo 3:** mover os blocos, sem mudar uma declaração. Conferir que nada sumiu nem duplicou: o conjunto de
  linhas não vazias das folhas novas, ordenado, é igual ao do arquivo antigo menos os comentários de cabeçalho
  (script de conferência no scratchpad, não no repo).
- [ ] **Passo 4:** `classes-orfas.js` lê as folhas de `mesa-janelas/css/` em vez do arquivo único.
- [ ] **Passo 5:** `node --test` inteiro verde.

### Tarefa 0.2: base — botão, materiais, ilhas escuras e `SUPERFICIES`

**Arquivos:** `mesa-janelas/css/base.css`, `mesa-janelas/comum.js`, `mesa-janelas/comum.test.js`

**Produz:** `GoLive.mesaJanelasComum.SUPERFICIES` (objeto congelado `tipo → 'feltro'|'tabuleiro'|'papel'|'lousa'|'palco'`),
e o atributo `data-superficie` na raiz `.mj` criada por `base()`.

- [ ] **Passo 1:** testes em `comum.test.js`:

```js
const registro = require('../mesa-modules');

test('SUPERFICIES cobre exatamente os tipos do registro, com um dos cinco materiais', () => {
  const tipos = registro.MODULE_NAMES.filter((t) => registro.get(t)).sort();
  assert.deepEqual(Object.keys(C.SUPERFICIES).sort(), tipos);
  for (const [tipo, sup] of Object.entries(C.SUPERFICIES)) {
    assert.ok(['feltro', 'tabuleiro', 'papel', 'lousa', 'palco'].includes(sup), `${tipo}: ${sup}`);
  }
  assert.ok(Object.isFrozen(C.SUPERFICIES));
});

test('base() marca a raiz com a superficie do tipo', () => {
  // DOM falso no estilo de stop.test.js (Elemento com className, dataset, append, remove)
  const raiz = montarBase('poquer'); // helper do teste: chama C.base(elFalso, apiFalsa, 'poquer')
  assert.equal(raiz.dataset.superficie, 'feltro');
});
```

  A tabela é a da spec, seção 1 (30 tipos). Se o registro tiver tipo fora da tabela, o teste falha e a tabela é
  completada pela família na spec, nunca com `'palco'` por omissão.
- [ ] **Passo 2:** rodar → falha.
- [ ] **Passo 3:** em `comum.js`, `SUPERFICIES` (Object.freeze) e, em `base()`, `raiz.dataset.superficie = SUPERFICIES[tipo]`
  quando houver. Exportar em `module.exports`/`GoLive.mesaJanelasComum` como o resto.
- [ ] **Passo 4:** em `base.css`:
  - `.mj .mj-btn { display: inline-flex; align-items: center; justify-content: center; }` (a causa do ícone
    empilhado sobre o rótulo: `.mj-btn` não herda o `.btn` do Sinal);
  - topo do arquivo: `:root { --mj-mat-feltro-1: #1D513C; --mj-mat-feltro-2: #133A2B; --mj-mat-feltro-3: #0F2F23;
    --mj-mat-lousa: #1B2228; --mj-mat-madeira: #7A5233; --mj-mat-casa-clara: #D9B98C; --mj-mat-casa-escura: #5B3B22;
    --mj-mat-papel: #E9DFC8; }`;
  - `.mj[data-superficie='feltro'|'lousa'|'palco']`: ilha escura (spec seção 1, lista exata de primitivas e
    semântica repostas, `color-scheme: dark`) + o fundo de cada material;
  - `.mj[data-superficie='tabuleiro'|'papel']`: fundo pelo `color-mix` da spec; as variáveis auxiliares
    `--mj-casa-clara`, `--mj-casa-escura`, `--mj-moldura`, `--mj-pauta` ficam definidas aqui para as levas usarem;
  - utilitário `.mj-volume` (brilho + sombra de contato) para peças, cartas e pedras.
- [ ] **Passo 5:** `node --test` verde; prints dos 30 com `fotos-janelas.js` (Sinal e Papel) — o material já
  aparece em todos sem quebrar texto.

### Tarefa 0.3: componentes `cadeiras`, `vazio`, `acoes`

**Arquivos:** `mesa-janelas/comum.js`, `mesa-janelas/comum.test.js`, `mesa-janelas/css/base.css`

**Produz (assinaturas exatas, usadas pelas levas 1–4):**

```js
// lugar: { peer: string|null, nome: string, cor: string|null, peca: {texto}|{cor}|null,
//          vez: boolean, eu: boolean, motivoSentar: true|string, motivoLevantar: true|string }
C.cadeiras({ aoSentar(i), aoLevantar(i), rotulo }) // -> { node, sync(lugares) }
C.vazio({ icone, titulo, texto, acao })            // -> node   (acao: Node|null)
C.acoes({ principal, secundarias })                // -> node   (principal: Node|null, secundarias: Node[])
```

- [ ] **Passo 1:** testes com o DOM falso (um por regra):
  - `cadeiras.sync` com 2 lugares (1 ocupado, 1 livre) gera 2 itens; o livre tem botão com texto "Sentar";
    o ocupado com `eu: true` mostra "Você"; `vez: true` põe `data-vez="1"` no item.
  - `sync` de novo com o mesmo número de lugares **reaproveita** os mesmos nós (identidade `===`).
  - clicar no livre chama `aoSentar(i)`; com `motivoSentar` em texto, não chama e o botão fica `aria-disabled`.
  - `vazio` monta glifo, título, texto e ação, nessa ordem; sem `acao`, não cria a área de ação.
  - `acoes` põe as secundárias antes da principal; principal ganha `mj-pri`, secundárias `mj-fantasma`.
- [ ] **Passo 2:** rodar → falha.
- [ ] **Passo 3:** implementar com os helpers que já existem (`el`, `botao`, `ligado`, `icone`, `bolinha`).
  Avatar: inicial do nome em Sora 700 num círculo de 24 px, anel `box-shadow: 0 0 0 2px var(--mj-cor)`.
  Livre: círculo tracejado (`border: 1.5px dashed var(--line2)`) com o ícone `mais`.
  CSS em `base.css`: `.mj-cadeiras`, `.mj-cadeira`, `.mj-cadeira[data-vez='1']` (anel e brilho `--wire`,
  `--wire-soft` de fundo), `@container mj (max-width: 280px)` esconde o nome (fica no `title`);
  `.mj-vazio` (centralizado com `margin: auto`, glifo 40 px num círculo 72 px `--s2`, título `--t-heading`, texto
  `--tx2` `max-width: 36ch`); `.mj-acoes` (`margin-top: auto`, `border-top: 1px solid var(--line)`,
  `padding-top: var(--s-2)`, `.mj-mola` entre secundárias e principal; abaixo de 280 px as secundárias mostram só
  o ícone).
- [ ] **Passo 4:** `node --test` verde.

### Tarefa 0.4: chip do material na barra

**Arquivos:** `src/renderer/sinal/mesa.css`

- [ ] `.mesa-type` vira chip de 20×20 (`border-radius: var(--r-xs)`, centralizado, `--t-tag`) com fundo por
  material: `.mesa-win:has(.mj[data-superficie='feltro']) .mesa-type { background: var(--mj-mat-feltro-2); color: #EDEDF2; }`
  e equivalentes (tabuleiro → `--mj-mat-madeira` com texto `#EDEDF2`; papel → `--mj-mat-papel` com texto `#0E0E14`;
  lousa → `--mj-mat-lousa`; palco → `--void`). Só as `--mj-mat-*` de `:root` servem aqui: as variáveis definidas
  dentro de `.mj` não alcançam a barra. Janelas de tela/câmera (`.is-media`) não mudam.
- [ ] `node --test` verde (há testes de regra de CSS sobre `sinal/*.css`).

### Fechamento da leva 0 (sessão principal)

- [ ] `node --test`; `caber.js` com todos os tipos (≈15 min); `rodar.js --sem-prints`; prints dos 30 em Sinal e Papel; boot
  no Electron; revisão terra high; commit `feat(mesa-janelas): fundacao do rework (materiais, cadeiras, vazio, acoes)`.

---

## Levas 1–4 — aplicar por família

Cada leva segue o mesmo ciclo: implementar a lista abaixo, rodar `node --test` e
`node tools/bancada-janelas/caber.js <tipos>`, ajustar até passar **sem mudar `size`**, e entregar a lista do que
mudou por tipo. Testes de tipo (`<tipo>.test.js`) que dependem de texto ou classe que a leva removeu são
atualizados para a regra nova (ex.: "não repete o título"), nunca apagados.

As levas 1 e 2 podem rodar em paralelo (folhas e arquivos disjuntos); depois 3 e 4.

### Leva 1 — Ferramentas (`ferramentas.css`)

- **nota** (papel): área de escrita com pauta e margem; contador `0 / 1 000` discreto no canto em `--t-data`.
- **lista** (papel): vazio por `C.vazio` (ícone `check`, "Lista vazia", "Escreva o primeiro item abaixo.") e **uma** frase
  só (some a duplicata "Nada na lista ainda" / "Lista vazia"); campo de novo item fixo no rodapé; itens com pauta.
- **enquete** (papel): "+ Opção" e "Publicar" em `C.acoes`; barras de voto com o volume do papel.
- **placar** (lousa): números em giz (Sora 700, `clamp(32px, 22cqh, 96px)`), nome do time em `--t-heading`, `−`/`+`
  como botões redondos translúcidos; troca de número desliza (movimento).
- **cronometro** (lousa): dígitos em giz; segmentado e durações como chips; Iniciar/Zerar/±1 min em `C.acoes`
  (Iniciar é a principal).
- **sorteio** (papel): "Sortear" principal, "Pôr a sala toda" e "Limpar" secundárias em `C.acoes`; times como cartões
  de papel com a bolinha das pessoas.
- **dados** (feltro): bandeja (sombra interna) com os dados em `.mj-volume`; "Rolar" principal e "Moeda"
  secundária em `C.acoes`; histórico "Antes" em `--t-meta`.
- **roleta** (feltro): sem opções, a roda mostra `C.vazio` **fora** do miolo (o pino não pode cobrir o texto);
  "Girar" principal em `C.acoes`; fatias com cores derivadas dos tokens.
- **quadro** (lousa): barra de ferramentas como um grupo segmentado; cores em bolinhas de 18 px com anel na
  selecionada. A cor padrão do traço e do texto do canvas deixa de ser escrita à mão e passa a sair do token (pendência
  do STATUS: "texto desenhado no canvas do quadro ainda usa Work Sans escrita à mão" → usar `--font-body` lido por
  `getComputedStyle`).
- **sons** (palco): pads com ícone + nome, toque com pulso (`transform: scale`), volume no rodapé.

### Leva 2 — Tabuleiros (`tabuleiros.css`)

- **tabuleiro.js** (moldura comum): as pílulas de assento viram `C.cadeiras`; some o rodapé "Cadeiras livres:
  sente-se para jogar"; o botão de reiniciar vai para o canto da linha de cadeiras como `mj-fantasma`.
- **velha**: casas com relevo sobre `--mj-casa-clara`; X e O grandes em Sora 700 na cor de quem joga; peça assenta.
- **lig4**: grade com a madeira da moldura; buracos com sombra interna; fichas em `.mj-volume` na cor do jogador;
  ficha cai do topo até a casa (`translateY`, ≤ 300 ms).
- **damas** e **xadrez**: casas clara/escura dos tokens `--mj-casa-*`; damas em `.mj-volume` (branca e preta com
  brilho), coroa visível; última jogada marcada com `--wire-soft`.
- **batalha**: mar = `color-mix(in oklab, #1F4E79 35%, var(--s2))` declarado como `--mj-mat-mar` em `base.css`;
  navios com volume; tiro na água e acerto com marcadores claros (acerto em `--danger`, não em `--live`).

### Leva 3 — Cartas e festa (`cartas.css`, `festa.css`)

- **cartas.js** (comum das cartas): carta com volume, verso com padrão por gradiente; carta que vira (`rotateY`).
- **poquer**: mesa oval de feltro (já existe a forma) com `C.cadeiras` em volta; "Pôquer · 10/20" sai do corpo
  (vai para a linha de estado em `--t-meta`); fichas e pote com volume.
- **blackjack**: banca em arco no alto, 5 lugares por `C.cadeiras`; "Sapato: 312" em `--t-data`.
- **truco**: sem ninguém, `C.vazio` com as 4 cadeiras em cruz (duplas frente a frente) em vez de 4 "Livre/Sentar"
  soltos; durante o jogo, a mesa de feltro com as cartas viradas no centro.
- **oito**: some o título "Oito maluco" repetido; monte e descarte no centro com volume; naipe escolhido em chip.
- **domino**: sem ninguém, `C.vazio` ("Sente 2 a 4 pessoas e dê as pedras") no lugar da caixa vazia; pedras com
  volume; Comprar/Passar/Levantar em `C.acoes`.
- **stop** (papel): some o "Stop —" solto; categorias como linhas de caderno; "Começar rodada" principal em
  `C.acoes`. Preservar o autosave e o clique do STOP que não se perde (commit `75f0457`; testes em `stop.test.js`).
- **quiz** (papel): some o "Quiz" repetido; "Pergunta 1 de 10" e o tempo na linha de estado; alternativas como
  cartões A–D; placar das pessoas com `C.cadeiras` em modo só leitura ou a lista atual com avatar.
- **desenha** (lousa): esperando gente, `C.vazio` com "Entrar na rodada" como ação e "Começar" em `C.acoes`.
  Preservar o "Quadro escondido" e o filtro de cursor (commit `75f0457`).

### Leva 4 — Mídia (`midia.css`)

- **youtube**, **aovivo** (Twitch), **radio**, **jam**, **link**: sem conteúdo, `C.vazio` com o formulário de link como
  `acao` (ícone `play`/`musica`/`link`, título curto, uma frase); "Cancelar" continua só se já existia com a mesma
  função.
- **imagem**, **galeria**: vazio por `C.vazio` com a dica de "Pôr na Mesa" no chat; galeria em grade com cantos
  `--r-xs` e a imagem como protagonista.
- **radio**: fila como lista numerada (a ordem é informação), faixa tocando em destaque.

### Fechamento de cada leva (sessão principal)

- [ ] Conferir `git status` e o diff (inclusive `git diff | grep 'â€'` e regex nas linhas adicionadas).
- [ ] `node --test`; `caber.js <tipos>`; `rodar.js --sem-prints <tipos>`; prints Sinal e Papel; boot no Electron.
- [ ] Revisão terra high read-only contra a spec; corrigir; commit `feat(mesa-janelas): leva N — <família>`.
