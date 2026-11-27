# Auditoria de design — 2026-11-25

Pedido do dono: "buscar melhorias no design, talvez até refazer em algumas partes, melhorar". Lente: a spec do
redesign Sinal (`docs/redesign-greenfield/04-design-system.md`, `05-arquitetura.md`), as regras de
`src/renderer/AGENTS.md` e, só como crítica (não como direção nova), a skill de design de frontend da Anthropic
(hierarquia, escrita de interface, restrição).

## Como foi visto

- Bancadas `tools/sinal-prints/inicio.js` e `tools/sinal-prints/sala.js` rodadas fora do Electron (Chromium do
  Playwright, servidor de sinalização real, pessoas falsas por ws). Cópias locais com três mudanças: pulam o tour
  de boas-vindas (`golive:tour:v1`), gravam em outra pasta e rodam uma **varredura de contraste WCAG** de todo
  texto visível (fundo efetivo composto, opacidade dos ancestrais) e uma **varredura de nome acessível e alvo**
  em cada print. As bancadas originais hoje param no tour: a primeira abertura mostra o diálogo e a bancada não
  acha `#room-view` (vale corrigir nelas também).
- Telas: Início (salas, vazio, sem rede, entrando, erro, criar sala, PIN, baixando atualização), sala "Só
  transmissões" (palco vazio, tiles com HUD, pausada, presença, menu da sala, você transmitindo/pausado,
  conversa fixada e espiando, Transmitir, Configurações nas quatro abas, painel de comando) e sala "Mesa"
  (Mesa vazia, janelas, Adicionar janela, emoji, janela em foco).
- Temas: Sinal (escuro, padrão), Papel (`paper`) e Sinal claro. Janelas 1280×800 e 900×700 (mínimo do app).
- A auditoria de teclado da bancada (40 paradas de Tab na sala, nome acessível + foco visível + na tela) passou
  nos dois tipos de sala e nos dois tamanhos. A varredura de nome acessível não achou controle sem nome.
- Prints em `docs/auditoria-2026-11-25/design/antes/` (estado encontrado) e
  `docs/auditoria-2026-11-25/design/antes-depois/` (recortes do que mudou: antes em cima, depois embaixo).

## Leitura geral

A direção Sinal está de pé e é consistente: só tokens nas folhas (nenhuma cor solta fora de `themes.css`), um
`!important` de componente só no `[hidden]`, vermelho reservado ao "ao vivo", fio em foco/seleção/assistindo, e
o teclado funciona. Os problemas que sobram são de três tipos: **texto que escapou da tradução** (chave crua e
HTML fixo em português), **legibilidade em pontos de borda** (placeholder, motivo de sala incompatível, barra das
janelas da Mesa em zoom baixo) e **estados sem direção** (a Mesa vazia não tem estado vazio).

## Achados

Gravidade: **Alta** = erro visível ou bloqueio de entendimento; **Média** = atrapalha ou fere a spec/acessibilidade;
**Baixa** = acabamento.

### Corrigidos nesta auditoria

| ID | Grav. | Tela | Print | O que estava errado | O que mudou |
|---|---|---|---|---|---|
| D-01 | Alta | Transmitir | `antes/transmitir-telas-1280.png`, `antes-depois/seletor-rodape-*` | A linha de custo mostrava a chave crua `ui.qualidade.padrao` em toda língua (`bandwidthLineHtml` passava a chave ao `escapeHtml` sem `t()`). | `ui.js`: `escapeHtml(t(nota))`. |
| D-02 | Média | Transmitir (en) | `antes-depois/seletor-rodape-sinal-en-1280.png` | O número da taxa era sempre com vírgula ("2,5 Mbps") também em inglês. | `toLocaleString(idiomaAtivo(), { maximumFractionDigits: 1 })`. |
| D-03 | Baixa | Transmitir | idem | A frase inteira de custo estava em Geist Mono (`tx-data`): dado é número, não frase (04 §3); em 900 px quebrava em duas linhas mono. | `#picker-quality-bandwidth` passa a `tx-meta`. |
| D-04 | Média | Barramento | `antes-depois/barramento-*` | Cada fonte de tela dizia "Telas" (plural, chave do seletor) embaixo do nome. | Chave nova `ui.fonte.tela` (Tela · Screen · Pantalla). |
| D-05 | Média | Menu da sala, Presença | `antes-depois/menu-sala-sinal-en-1280.png` | "Copiar PIN", "Diagnóstico", "Modo teatro" e "Banidos" eram texto fixo no `index.html`: em inglês o menu ficava em português. A catraca `paginas.test.js` não viu porque o texto vem depois de `</svg>` (ver D-27). | `data-i18n` com `pagina.copiarPin`, `pagina.diagnostico`, `pagina.modoTeatro`, `pagina.banidos`. |
| D-06 | Média | Cabeça (avisos) | — (leitor de tela) | `warningcenter.js` montava o `aria-label` ("2 avisos") e o anúncio ao vivo ("1 novo aviso") em português fixo. | `t('pagina.avisosContagem')` e `t('pagina.avisosNovos')`, plurais `{ one, other }` nas três línguas. |
| D-07 | Média | Início | `antes-depois/lobby-linhas-*` | Sala de outra versão: a linha inteira levava `opacity .55`, e o motivo ("Versão 0.20.0 — quem criou precisa atualizar"), a única informação útil da linha, caía para 4,1:1 no Sinal e 2,4:1 no Papel e no Sinal claro. | `shell.css`: na linha `.incompatible` esmaecem nó, nome e endereço; o motivo fica em `--warn` cheio (6,1:1 no Papel). As outras linhas desabilitadas durante a entrada continuam esmaecendo inteiras. |
| D-08 | Média | Campos (Início, Conversa, Configurações) | `antes/inicio-salas-1280.png` | Placeholder em `--tx3` sobre `--s3`: 4,42:1 no Sinal, combinação que a 04 §2 proíbe. No Início o placeholder é o único rótulo visível do campo de endereço. | `color-mix(in srgb, var(--tx3) 50%, var(--tx2))`: 5,7:1 no Sinal, 5,9:1 no Papel, ainda mais apagado que o texto digitado. |
| D-09 | Baixa | Transmitir | `antes-depois/seletor-abas-*` | A contagem na aba escolhida ("Telas 2") era `--tx3` sobre `--s3` (4,42:1) e usava `font-size: 11px` solto. | Na opção escolhida a contagem vai a `--tx2`; tamanho por `--fs-micro`. |
| D-10 | Baixa | Configurações < 1280 px | `antes-depois/config-abas-sinal-pt-BR-900.png` | `space-between` deixava "Perfil" e "Diagnóstico" colados nas bordas, com vãos desiguais. | As abas dividem a sobra por igual (`flex: 1 1 auto`, sem quebrar o rótulo). |
| D-11 | Média | Palco vazio | `antes-depois/palco-vazio-*` | "Quando alguém transmitir, a tela aparece aqui embaixo." — a tela aparece no palco (em cima), quem aparece embaixo é a fonte. | "Quem transmitir aparece na barra da sala, lá embaixo. Clique para assistir." (mesmo termo do tour: "barra da sala"), com en e es. |

### Não aplicados (ficam para decidir)

| ID | Grav. | Tela | Print | O que está errado | Proposta |
|---|---|---|---|---|---|
| D-12 | Alta | Mesa | `antes/mesa-vazia-1280.png` | Sala "Mesa" recém-criada é só uma grade de pontos: não existe o estado "A Mesa está vazia." da 05 §3.4. Quem entra pela primeira vez não tem pista do que fazer (o tour fala de "botão direito na área vazia"). | **R1** abaixo. |
| D-13 | Média | Mesa | `antes/mesa-janelas-44pct-1280.png`, `antes/mesa-900.png` | Com três janelas, "Ver tudo" deixa a vista em 36–44 %. A barra da janela escala junto: o título fica com ~5 px ("Tela de Leo"), ilegível; a 05 §3.4 só diz que abaixo de 60 % a barra mostra só o título. | **R3** abaixo. |
| D-14 | Média | Cabeça da sala | `antes/sala-tiles-hud-1280.png`, `antes/sala-palco-vazio-900.png` | "Ajuda e apoio" (rótulo + ícone) ocupa a cabeça da sala, onde a 05 §3.1 põe presença, avisos e saúde; em 900 px vira um "?" ao lado de pessoas e saúde, três ícones sem hierarquia. | **R2** abaixo. |
| D-15 | Média | Cabeça da sala | `antes/sala-palco-vazio-1280.png` | "Sair da sala" fica desabilitado (opacidade .45, 2,5:1) ~2 s depois de entrar (`updateDisconnectButtonState` em `app.js`), sem dica do porquê. | Não desabilitar: aceitar o clique e sair quando a trava acabar, ou ao menos `title`/`aria-describedby` "Aguarde um instante para sair". Mexe em `app.js`; não toquei. |
| D-16 | Média | Conversa, nós | `antes/sala-tiles-hud-1280.png` | As cores de identidade (`AVATAR_PALETTE` em `ui.js`, hex soltos fora dos tokens) incluem amarelo `#FFD166`, verde `#6EE7B7` e laranja `#FDBA74`, vizinhos de `--warn`, `--ok` e `--danger`: o nome "Bia" em amarelo lê como aviso. | Tirar a paleta de identidade para tokens (`--who-1..8`) e afastar as matizes das semânticas (sem amarelo puro e sem laranja). |
| D-17 | Baixa | Barramento < 1024 px | `antes/mesa-900.png` | "Pôr na Mesa" vira um "+" sozinho, o mesmo glifo de "Transmitir tela" ao lado. Tem rótulo acessível, mas de relance são dois "+". | Ícone do losango da Mesa com um "+" pequeno, ou manter o rótulo curto "Mesa". |
| D-18 | Baixa | Presença | `antes/sala-presenca-1280.png` | O grupo "NA SALA" não tem título (só o separador), e "AO VIVO" tem; a 05 §3.5 pede os três rótulos. | Pôr o rótulo `NA SALA` (termo do glossário; chave nova `ui.presenca.naSala` nas três línguas). |
| D-19 | Baixa | Configurações | `antes/config-perfil-1280.png` | Cabeçalho "CONFIGURAÇÕES / Perfil" repete o nome da aba escolhida logo abaixo; a aba Perfil é quase vazia (um campo). | Título fixo "Configurações" e a aba diz a seção; ou juntar Perfil a Aparência. |
| D-20 | Baixa | Configurações > Câmera | `antes/config-camera-sons-900.png` | Sem câmera, o select fica em branco (nenhuma opção), e a explicação só aparece na prévia. | Uma opção desabilitada "Nenhuma câmera encontrada" no próprio select. |
| D-21 | Baixa | Início, PIN | `antes/dialogo-pin-1280.png` | Erro de campo sem ícone (04 §8: "erro abaixo em `--c-danger` com ícone"); só a cor separa erro de ajuda. | `.field__error` com `#i-circle-alert` antes do texto. |
| D-22 | Baixa | Tour | — | Ao abrir o tour o foco vai ao título (`h2` com `tabindex=-1`) e ele ganha o anel de foco, como se fosse um controle. | Não mostrar `--ring` em elemento não interativo (`[tabindex='-1']:focus-visible { box-shadow: none }`) ou focar o primeiro botão. |
| D-23 | Baixa | Mesa no Papel / Sinal claro | `antes/mesa-papel-1280.png` | A Mesa herda o "palco escuro" dos temas claros: metade da janela clara, a Mesa inteira escura, com aviso rápido claro por cima. A decisão de 2026-09-28 fala do vídeo; a Mesa tem notas, jogos e listas. | Decisão do dono: manter (coerência com as janelas de tela) ou deixar a superfície da Mesa no tom do tema e só as janelas de vídeo em `--void`. |
| D-24 | Baixa | CSS | — | `shell.css` tem comentários sem regra ("Menu da sala: ancorado…", "Espiando: superfície sólida…") e regras soltas no fim do arquivo, longe da seção de cada componente; `.pip-thumb-avatar .node__initial` usa `font: 700 10px/1` (abaixo do piso de 11 px: a catraca só olha `font-size`); `.btn--lg`, `.input--lg` e `.input--mono` trazem `font-size` solto (14/15/13 px, na escala mas fora dos tokens `--t-*`). | Limpeza de CSS num diff só; estender a catraca a `font:`. |
| D-25 | Baixa | CSS | — | `base.css` usa `!important` também em `.sr-only` e no movimento reduzido; o `AGENTS.md` diz "exceção única: `[hidden]`" e o teste aceita as duas outras. | Atualizar o texto do `AGENTS.md` para as três exceções reais. |
| D-26 | Baixa | Tela cheia | — | O "×" da miniatura (`.pip-thumb-remove`) tem 22×22 px; a 04 §4 diz alvo nunca abaixo de 28×28. | 28×28 com o glifo em 16. |
| D-27 | Baixa | Catraca i18n | — | `tools/i18n/literais.js` só lê texto logo após uma tag de abertura; `</svg>Texto` passa. Foi assim que D-05 entrou. | Ler também texto depois de tag de fechamento. |
| D-28 | Baixa | Cabeça (en/es) | `antes-depois/menu-sala-sinal-en-1280.png` | O nome padrão da sala chega do servidor em português ("Sala de Nick") também em inglês. | Depende do protocolo; registrar. |
| D-29 | Baixa | Transmitir | `antes/transmitir-telas-1280.png` | A 1280 px, com duas telas, ~60 % do diálogo é vazio e o rodapé espreme três colunas; com mais de um monitor nada vem escolhido e a ação principal fica cinza com a dica à esquerda do "Cancelar". | Pré-escolher o monitor principal e deixar o diálogo encolher à altura do conteúdo. |
| D-30 | Baixa | Início | `antes/inicio-sem-rede-1280.png` | Sem rede, a saudação e as ações sobem 2 px (a linha de rede muda de altura). | Altura fixa na linha de rede. |
| D-31 | Baixa | Início | `antes/inicio-salas-1280.png` | A linha de sala de outra versão é um `button:disabled`: o leitor de tela em modo de foco não chega ao motivo. | `aria-disabled="true"` (focável, sem ação) em vez de `disabled`. |
| D-32 | Baixa | Cabeça | `antes/sala-tiles-hud-1280.png` | "Sair da sala" (`btn--danger`) tem contorno sempre; a 04 §8 diz contorno só no hover. Ao lado do "?" e da engrenagem sem contorno, vira o elemento mais pesado da cabeça. | `border-color: transparent` fora do hover. Escolha visual; deixei para o dono. |

Medições (WCAG 2.x, contraste de texto): fora D-07/D-08/D-09, a varredura não achou texto ativo abaixo de 4,5:1
nos três temas e nas duas larguras. Desabilitados (opacidade .45) ficam entre 2,1 e 4,0:1, o que a WCAG isenta.

## Partes que valem refazer

Três propostas maiores, para o dono decidir. Nenhuma foi implementada.

### R1 — Mesa vazia e primeira janela

**Problema.** Numa sala "Mesa" (o tipo padrão ao criar sala), quem entra vê só a grade de pontos (D-12). A
spec 05 §3.4 já desenhou o estado vazio e ele nunca foi feito. É o primeiro contato com o recurso que diferencia
o app.

**Proposta.** O bloco vazio da spec, centrado na vista: o grafo do ícone com o nó trocado pelo losango da Mesa,
"A Mesa está vazia.", uma frase do que ela faz, os 6 tipos mais usados como botões secundários compactos (pôr
na Mesa direto, sem abrir o catálogo), e uma linha que aponta para "Pôr na Mesa" e para a tecla `N`. Some quando
entra a primeira janela; volta quando a última sai. Não cobre janelas de tela que chegam sozinhas: com qualquer
janela, nada de bloco.

Mock estático com os tokens e componentes reais: `design/proposta-mesa-vazia.html` (print:
`design/proposta-mesa-vazia.png`).

**Custo.** Pequeno a médio: um nó no `mesa-view.js` ligado à contagem de janelas, os 6 tipos lidos de
`mesa-catalogo.js`, ~6 chaves i18n × 3 línguas, CSS em `sinal/mesa.css` reaproveitando `.blank`. Meio dia com
bancada.

**Risco.** Baixo. Cuidado com o "Ver tudo" (não enquadrar o bloco como janela) e com o menu de botão direito na
área vazia, que continua valendo por cima do bloco.

### R2 — Cabeça da sala com uma hierarquia só

**Problema.** A cabeça da sala acumulou coisas fora da spec (D-14, D-32, D-15): "Ajuda e apoio" com rótulo,
"Sair da sala" com contorno permanente e às vezes desabilitado sem motivo, e, abaixo de 1024 px, quatro ícones
seguidos (?, pessoas, saúde, engrenagem) sem agrupamento. A informação que muda durante o jogo (presença,
avisos, saúde) disputa espaço com coisas que se usa uma vez.

**Proposta.** Dois grupos à direita: estado (presença · avisos · saúde) e ações (Configurações · Sair). "Ajuda e
apoio" sai da cabeça da sala e entra no menu da sala (o tour e o PIX continuam a um clique); no Início fica onde
está. "Sair" volta a `quiet`/`danger` sem contorno e nunca desabilitado.

```
Hoje (1280)
┌ Sala de Nick ▾  127.0.0.1:41667 ⧉        (?) Ajuda e apoio  ⚇ 4  ▮▮▮  ⚙ │[⇥ Sair da sala]│  — □ × ┐
Proposta (1280)
┌ Sala de Nick ▾  127.0.0.1:41667 ⧉                ⚇○○●○ 4 · ⚠1 · ▮▮▮   │   ⚙   ⇥ Sair da sala   — □ × ┐
Proposta (900)
┌ Sala de Nick ▾                                   ⚇ 4 · ▮▮▮            │   ⚙   ⇥ Sair            — □ × ┐
Menu da sala ▾: Copiar endereço · Copiar PIN · Diagnóstico · Modo teatro · ─ · Ajuda e apoio · Rever o tour
```

**Custo.** Pequeno: mover um botão no `index.html` (o id `btn-comunidade` continua, só muda de lugar; conferir
`ids-contrato.json`), CSS da cabeça, e tirar a desabilitação do Sair em `app.js` (pede quem cuida da lógica de
sessão).

**Risco.** Baixo. O tour hoje diz que "Ajuda e apoio fica no cabeçalho… e dentro da sala": o texto
`tour.apoio.descricao` muda junto.

### R3 — Barra da janela da Mesa legível em qualquer zoom

**Problema.** A barra da janela é parte do mundo e escala com ele. Em 36–44 %, o zoom típico depois de "Ver
tudo" com três janelas, o título tem ~5 px e o "Sua vez" não se lê (D-13). É justamente nesse zoom que se procura
"qual janela é a minha vez".

**Proposta.** Abaixo de 60 %, a barra deixa de escalar com o conteúdo: altura e texto ficam em tamanho de tela
(24 px, `--t-label`), por cima da borda superior da janela, cortando o título com reticências na largura da
janela. "Sua vez" vira o selo de fio sozinho, com o título truncado. Acima de 60 % nada muda.

```
44 % hoje                       44 % proposta
┌──────────────┐                ┌Tela de Leo ───┐   ← 24 px de tela, texto 13 px
│▫▫▫▫▫▫▫▫▫▫▫▫▫▫│ (título 5 px)  │               │
│              │                │               │
└──────────────┘                └───────────────┘
                                ┌Truco · Sua vez┐   ← fio, anunciado ao leitor
```

**Custo.** Médio: contraescala da barra (`transform: scale(1/zoom)` com origem no topo esquerdo e largura
compensada) em `mesa-view.js`/`sinal/mesa.css`, recálculo no zoom, e a alça de arrastar precisa continuar
acertando a barra. Um dia com a bancada de janelas (`tools/bancada-janelas`).

**Risco.** Médio: mexe na geometria que o arrastar, o mapa e "Ver tudo" usam; precisa da bancada de janelas
verde antes de entrar.

## Arquivos alterados

- `src/renderer/ui.js` — D-01, D-02, D-04 (três linhas).
- `src/renderer/warningcenter.js` — D-06.
- `src/renderer/index.html` — D-03, D-05.
- `src/renderer/i18n/pt-BR.js`, `en.js`, `es.js` — chaves `ui.fonte.tela`, `pagina.copiarPin`,
  `pagina.modoTeatro`, `pagina.banidos`, `pagina.avisosContagem`, `pagina.avisosNovos`; texto novo de
  `ui.palco.quandoTransmitir`.
- `src/renderer/sinal/components.css` — D-08, D-09.
- `src/renderer/sinal/shell.css` — D-07.
- `src/renderer/sinal/sheets.css` — D-10.

Nenhum id mudou (o contrato de ids fica como está). `app.js`, protocolo, captura, WebRTC e áudio não foram
tocados.
