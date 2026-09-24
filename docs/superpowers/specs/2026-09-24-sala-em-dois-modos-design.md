# Sala em dois modos: Transmissão e Mesa

Data: 2026-09-24. Plano de estrutura e visual. Nada implementado ainda.
Protótipo clicável (dados simulados): artifact "Sala em dois modos".

## Pedido

> "Imagino uma área grande, sem nada, apenas um grid, e aí as pessoas vão
> adicionando as janelas e mudando. Talvez fosse legal que o líder dentro da
> sala pudesse mudar o tipo de sala: apenas transmissão, que volta pro jeito
> padrão, e o outro tipo seria a mesa interativa."

E, das conversas antes desta:

- botão direito → "Adicionar janela" → YouTube, xadrez, damas e outros;
- mudar o tamanho da janela, e um botão de tela cheia;
- visual limpo.

## Histórico da decisão

Esta spec substitui duas direções anteriores desta mesma branch (ficam no
histórico do git):

1. **Mundo fixo 16:9 compartilhado**, com a sala inteira virando mesa. Saiu
   porque transformava o app todo, e o pedido era não perder o jeito de hoje.
2. **Mesa de cada um**: cada pessoa arruma a própria tela, sem nada
   compartilhado. Saiu porque o pedido agora é que "as pessoas vão adicionando
   as janelas e mudando" juntas.

O que ficou das duas: a janela limpa (sem moldura, controles só com o mouse
em cima), o botão direito, a tela cheia, a vez por janela para duas pessoas
não arrastarem a mesma coisa, e os jogos como estado da sala.

---

## 1. A ideia

A sala passa a ter **dois tipos**, e **só o líder da sala troca**, a qualquer
momento e para todos:

| | **Transmissão** | **Mesa** |
|---|---|---|
| O que é | O GoLive de hoje, sem mudança | Uma área grande com grade, que começa vazia |
| Telas e câmeras | Palco + tira + coluna (layout automático) | Janelas que qualquer pessoa move e redimensiona |
| Jogos, vídeo, notas | Não aparecem | Botão direito → Adicionar janela |
| Chat | Coluna à direita | Painel flutuante à direita (dá para fechar) |
| Padrão | **Sim**: toda sala nasce assim | Opcional |

Trocar de tipo **não derruba nada**: transmissões, câmeras e chat continuam; só
muda o lugar onde as telas aparecem. Voltar para Transmissão **guarda a mesa**
como estava. Voltar para Mesa traz tudo de volta no lugar, com os jogos no
mesmo lance.

### 1.1 Por que dois modos, e não trocar o app

- Quem só quer transmitir não vê nada novo. O modo padrão é o de hoje, e o
  que existe hoje continua sendo testado e mantido do mesmo jeito.
- A Mesa pode crescer (jogos novos, ferramentas) sem mexer no caminho
  crítico: ela é uma segunda casca em volta dos mesmos tiles.
- O líder escolhe o clima da sala: "hoje é só jogo" (Transmissão) ou "hoje
  é resenha" (Mesa).

---

## 2. Trocar de tipo

- **Onde**: um controle segmentado no centro do topo da sala,
  `Transmissão | Mesa`, com ícone e rótulo.
- **Quem**: só o líder da sala. Para as outras pessoas o mesmo lugar mostra
  um chip parado ("Sala: Mesa"), sem botão. A regra vale **no servidor**
  (mensagem `room-mode`, aceita só do líder), como a moderação.
- **O que todos veem**: aviso curto no topo ("Nick mudou a sala para Mesa") e
  uma linha de sistema no chat. A troca é um corte suave (opacidade, 200 ms);
  com `prefers-reduced-motion`, troca direta.
- **Quem entra depois** recebe o tipo atual no `welcome`.
- **Migração de sala** (o líder caiu): o tipo e a mesa inteira vão na semente
  do servidor novo, junto de `initialChatHistory` e `initialBans`. O líder novo
  herda o controle.

---

## 3. A Mesa

### 3.1 A área

- **Grande e finita**: 4 800 × 3 000 unidades. Grande o bastante para espalhar
  as coisas, finita para ninguém se perder. Fora da borda ainda dá para
  arrastar um pouco (600 unidades), com a borda da área marcada por uma linha
  fina.
- **Só a grade**: linhas finas a cada 40 unidades e uma linha mais forte a cada
  200. De longe (zoom baixo) a grade fina some e fica só a forte. Nada mais no
  fundo.
- **Começa vazia.** Ao virar Mesa, as telas e câmeras de quem está ao vivo
  entram arrumadas no meio, e o resto é espaço livre. Mesa sem nenhuma janela
  mostra uma frase no centro: "A mesa está vazia. Clique com o botão direito
  para adicionar uma janela."

### 3.2 Andar e aproximar (cada um com a sua vista)

A **posição das janelas é da sala**. **Para onde você olha é só seu**, como
num mapa.

| Ação | Mouse | Teclado |
|---|---|---|
| Andar | arrastar o fundo | setas (com a mesa focada) |
| Aproximar / afastar | roda do mouse, no ponto do cursor | `+` / `-` |
| Ver tudo | botão no canto | `0` |
| Ir até uma pessoa | clicar no avatar dela no topo | — |
| Ir até um ponto | clicar no mapa | — |

- **Zoom** de 20 % a 200 %, com o valor visível no canto de baixo à esquerda.
- **Mapa** no mesmo canto: as janelas como blocos (a que está ao vivo em tom
  de `--live`), um ponto por pessoa na cor dela e um retângulo com a sua vista.
  Clicar leva até lá.
- **Ir até alguém**: o avatar no topo é um botão ("Ir até Bia"). A vista voa
  até o ponteiro da pessoa (420 ms, desacelerando).

### 3.3 Janelas

**Adicionar**: botão direito num espaço vazio → **Adicionar janela ›**, com
três grupos:

- Assistir e ouvir: Vídeo do YouTube (toca junto), Rádio da sala (fila de
  músicas pelo YouTube), Spotify Jam (junta a turma num Jam do próprio
  Spotify), Tocando agora (o que cada um ouve, pelo Windows)
- Jogos: Xadrez, Damas, Jogo da velha, Lig 4
- Noite de jogo: Sorteio de times, Placar, Cronômetro
- Ferramentas: Quadro (rabiscar), Nota

A lista completa de candidatas, o que cada serviço permite (Spotify, Twitch,
SoundCloud) e a ordem sugerida estão em
`docs/2026-09-24-pesquisa-janelas-da-mesa.md`.

A janela nasce **com o canto no ponto do clique**. O `+` do dock abre o mesmo
submenu e põe a janela no meio da vista (caminho pelo teclado e para quem não
usa botão direito). Um link do YouTube colado no chat ganha "Pôr na mesa".

**Telas e câmeras**: quem vai ao vivo ou liga a câmera ganha uma janela no
meio da **própria vista**. Quem para, perde a janela.

**Assentadas na mesa, em posição livre.** As janelas não são janelas de
aplicativo flutuando por cima: são peças planas em cima da grade. A grade é
só o fundo (para a mesa não ser um preto chapado); as janelas **não precisam
se alinhar a ela**.

- **Posição e tamanho livres**, ao pixel da mesa. Nada de encaixe em grade.
- **Uma janela nunca fica em cima de outra.** Durante o arraste a janela segue
  o mouse; se estiver sobre outra, um contorno tracejado mostra onde ela vai
  assentar (o lugar livre mais perto, com 16 unidades de vão). Ao soltar, ela
  desliza até lá (260 ms). Redimensionar para ao encostar numa vizinha.
- Janela nova (pelo menu, pelo `+`, por quem vai ao vivo) também nasce no
  lugar livre mais perto de onde foi pedida.
- Sem sobreposição, não existe "trazer pra frente" nem ordem de empilhamento
  no estado da sala.
- A regra vale **no servidor**: `mesa` que deixaria duas janelas sobrepostas
  é recusada (o cliente já manda o lugar livre; a recusa só pega corrida entre
  duas pessoas soltando no mesmo espaço, e quem perdeu recebe o lugar livre
  mais perto de volta).

**Anatomia** (limpa):
- Sem moldura grossa, sem barra de título e **sem sombra de janela
  flutuante**: um contorno de 1 px em `--line2` e canto `--r-lg`. Só enquanto
  você arrasta o contorno vira `--on-text`.
- Com o mouse em cima (ou foco) aparecem, no canto de cima à direita: o avatar
  de quem pôs, **Tela cheia** e **Tirar da mesa**.
- Janelas de vídeo (tela, câmera) se arrastam pegando em qualquer ponto.
  Janelas com conteúdo clicável (jogos, vídeo, quadro, nota) se arrastam por
  uma alça fina no topo (um traço de 36 × 4 px que aparece com o mouse).
- **Tamanho**: pelas bordas esquerda, direita e de baixo e pelos cantos de
  baixo. Vídeo e tabuleiro mantêm a proporção; nota muda livre.
- **Tela cheia**: o botão da janela, `F` ou duplo clique em vídeo. No app é o
  fullscreen da janela do Electron com só aquele conteúdo; `Esc` volta. É só
  para você.
- **Botão direito numa janela**: Tela cheia, Centralizar na tela, Tirar da
  mesa.
- **Nome sempre visível** em tela e câmera (canto de baixo, discreto), com
  "AO VIVO" na tela de quem transmite.

### 3.4 Juntos

- **Todo mundo pode mexer, por padrão.** O líder pode ligar "Só o líder mexe
  na mesa" no menu `⋯` do topo; aí as outras pessoas veem e usam as janelas
  (jogam, dão play), mas não põem, tiram, movem nem redimensionam.
- **Ponteiros**: cada pessoa aparece como uma seta com o nome, na cor dela (a
  mesma do rabisco, `annotate.colorFor`). Dá para esconder em `⋯` → "Mostrar o
  ponteiro das pessoas".
- **Alguém movendo**: a janela ganha um contorno na cor da pessoa e o chip
  "Bia está movendo". Enquanto isso, ninguém mais pega aquela janela.
- **Avisos curtos** no topo quando alguém põe ou tira uma janela ("Leo pôs Lig
  4 na mesa"), também anunciados numa região `aria-live` educada. Mover não
  avisa.

### 3.5 Janelas: o que é da sala e o que é seu

| Da sala (todos veem igual) | Seu |
|---|---|
| Quais janelas existem, posição e tamanho | Para onde você olha (vista e zoom) |
| Estado dos jogos, play/pausa e posição do vídeo | Tela cheia |
| Quem pôs cada janela | Volume de cada tela e do vídeo |
| O tipo da sala e a trava do líder | Mostrar ou não os ponteiros; chat aberto ou fechado |

---

## 4. Como sincroniza

Tudo passa pelo **servidor de sinalização embutido** de quem criou a sala, o
mesmo que já guarda o histórico do chat.

### 4.1 Estado no servidor

```
sala = {
  mode: 'transmissao' | 'mesa',
  mesa: { seq, leaderOnly, windows: [ { id, type, owner, x, y, w, h, props } ] }
}
```

- `welcome` leva `mode` e `mesa`. Semente de migração: `initialMode`,
  `initialMesa`.
- Teto: 32 janelas por mesa; `props` com teto de tamanho por tipo.

### 4.2 Três canais

| Mensagem | Quando | Guardada? | Frequência |
|---|---|---|---|
| `mesa` | pôr, tirar, soltar depois de mover, redimensionar, jogada, play/pausa | sim, com `seq` | por ação |
| `mesa-drag` | durante o arraste ou o redimensionamento | não | até 20 Hz |
| `cursor` | ponteiro sobre a mesa | não | até 20 Hz; some em 1 s parado |

`mesa-drag` e `cursor` seguem o laser (`laser.js`): função pura que decide
quando pode sair, último ponto por pessoa, e cada um apaga pelo próprio relógio.
Ficam muito abaixo do limite do servidor (300 mensagens/s por pessoa).

Cada `mesa` aceita ganha um `seq`. O cliente aplica na ordem; se receber um
buraco, pede o retrato de novo (`mesa-sync`), como o `annotate-sync`.

### 4.3 Vez por janela

Começar a mover ou redimensionar pede a vez (`grab`). O servidor dá a vez por
5 s, renovada a cada `mesa-drag`. Com a vez de outra pessoa, a operação é
recusada e a interface diz quem está movendo.

### 4.4 Jogos e vídeo: módulos com a regra

Cada tipo de janela com estado é um módulo **puro** no padrão UMD do projeto,
carregado no renderer **e** no servidor:

```
{ type, init(), validate(state, action, from), reduce(state, action, from) }
```

O servidor valida e aplica; os clientes aplicam o mesmo `reduce` na mesma
ordem. Jogada ilegal nem chega aos outros. Testes com `node --test`, sem DOM.

- **Xadrez**: `chess.js` (BSD-2) vendorizado em `src/renderer/vendor/`.
- **Damas**: regra brasileira (8 × 8, dama anda longe, captura obrigatória e
  em sequência), escrita no projeto.
- **Jogo da velha, Lig 4**: pequenos, escritos no projeto.
- **Quadro**: o rabisco (`annotate.js`) sobre uma folha branca, sem vídeo por
  baixo. Já existe; só muda a superfície.
- **Nota**: texto compartilhado, último que salva vence, com teto de 1 000
  caracteres.

### 4.5 YouTube junto

- Cada PC toca o próprio vídeo; a sala só troca `{ videoId, playing, pos, at }`.
  Custa quase nada da rede da sala.
- Relógio do servidor por uma mensagem `time` (ida e volta, a de menor atraso
  entre 5, refeita a cada 60 s).
- Deriva: menos de 0,3 s nada; até 1,5 s `playbackRate` 1,05/0,95; acima,
  salto.
- Player por `<iframe>` de `youtube-nocookie.com`, comandado por `postMessage`,
  **sem carregar script do YouTube na página** (daria acesso a `window.golive`).
  CSP ganha só `frame-src https://www.youtube-nocookie.com`.
- O app abre por `file://`, e o YouTube recusa embed sem `Referer` (erro 153).
  Spike obrigatório: protocolo próprio (`app://golive/`) ou `Referer` só para
  os domínios do YouTube via `session.webRequest`.
- Cada PC precisa de internet; sem ela, a janela diz isso no lugar do player.

---

## 5. Desempenho

A Mesa pode ter várias telas e um vídeo na mesma GPU que o jogo e o encoder.
Regras:

- **Janela fora da vista não recebe vídeo.** Tela que ficou 2 s fora da sua
  vista (ou coberta, ou menor que 120 px na tela) manda `watching:false`, e
  quem transmite solta o encoder daquela pessoa. Voltar à vista pede de novo.
  É o mecanismo de "assistir uma tela por vez" que já existe.
- **Tamanho na tela vira teto de qualidade**: a largura em pixels da janela
  (unidades × zoom) entra no `peerquality`. Não há por que mandar 1080p para
  uma janela de 400 px.
- **Uma transformação para a mesa inteira** (`translate` + `scale` num
  contêiner) e `transform` em cada janela. Nada de `filter` ou
  `backdrop-filter`. `will-change` só durante o arraste.
- A grade é um fundo em `linear-gradient` recalculado só quando a vista muda.
- Um só vídeo do YouTube tocando com imagem por PC; um segundo entra pausado.

---

## 6. Visual

A marca continua: tema `marca`, Outfit + Work Sans, tokens de sempre, `--live`
só para "ao vivo".

- **Topo** flutuante de 56 px: sala e "N pessoas" à esquerda; o seletor de
  tipo no centro; avatares (que levam até a pessoa) e `⋯` à direita. Na Mesa,
  um degradê do `--bg` para transparente atrás dele, para ler sobre as janelas.
- **Dock** no centro da base, igual nos dois tipos, mais o `+` na Mesa:
  Compartilhar tela · Câmera · Chat · (+) | Sair da sala.
- **Tudo some com o mouse parado** (3 s): topo, dock, controles das janelas,
  mapa e zoom. Fica o conteúdo.
- **Tokens novos**: `--grid` e `--grid2` (linhas da grade), definidos em cada
  tema e medidos pela trava de contraste contra `--bg` (a grade tem de aparecer
  sem competir: entre 1,1:1 e 1,4:1).
- **Movimento**: entrada de janela `scale .94 → 1` + opacidade em 220 ms;
  saída em 120 ms; voo da vista em 420 ms. Com `prefers-reduced-motion`, tudo
  direto.

## 7. Acessibilidade

- O seletor de tipo é um `radiogroup` com setas.
- A Mesa é uma região focável com nome e instruções; setas andam, `+`/`-`
  aproximam, `0` mostra tudo.
- Cada janela é focável (`role="group"`, nome com quem pôs). Setas movem 10
  unidades (`Shift`, 100), `Alt`+setas redimensionam, `F` tela cheia, `Delete`
  tira da mesa.
- O menu do botão direito abre também pela tecla de menu e por `Shift+F10`;
  setas navegam, `→` abre "Adicionar janela", `←` volta, `Esc` fecha.
- Mudanças de outras pessoas não roubam o foco.

---

## 8. Fases

Cada fase lançável, com `npm test`, `npm run lint`, prints do app real e teste
com 2+ PCs.

**Fase 0: validar o que já existe e os spikes**
- O teste com PCs reais que o `STATUS.md` diz que falta.
- Spike do YouTube no Electron (embed, `Referer`, `postMessage`).
- Spike de desempenho: 3 telas + 2 câmeras + 1 iframe numa mesa com zoom.

**Fase 1: o tipo da sala e a Mesa com telas e câmeras**
- `room-mode` no servidor (só o líder), no `welcome` e na migração.
- `src/renderer/mesa.js` (puro): modelo, operações, `seq`, vez por janela.
- `src/renderer/mesa-view.js`: área, grade, vista (andar, zoom, mapa, ir até),
  janelas (mover, redimensionar, encaixe, tela cheia), menu do botão direito,
  teclado.
- Telas e câmeras viram janelas na Mesa; na Transmissão, o palco de hoje sem
  mudança. O mesmo `<video>` muda de casca, sem renegociar nada.
- Ponteiros e "fora da vista = não assiste".

**Fase 2: ferramentas**
- Registro de módulos nos dois lados. Quadro e Nota.

**Fase 3: YouTube junto**
- Conforme o spike.

**Fase 4: jogos**
- Jogo da velha e Lig 4 primeiro (pequenos, validam o registro), depois damas
  e xadrez.

**Fase 5: acabamento**
- Tokens `--grid` nos sete temas, trava de contraste, passada de teclado com
  Playwright, roteiro de teste manual.

## 9. Glossário novo

| Conceito | Termo | Nunca use |
|---|---|---|
| Os dois jeitos da sala | **tipo da sala**: **Transmissão** e **Mesa** | modo, layout, canvas |
| O que se põe na Mesa | **janela** | widget, card, item |
| Pôr / tirar | **Adicionar janela** / **Tirar da mesa** | inserir, fechar, remover |
| Para onde você olha | **vista** (só em texto técnico; na interface: "Ver tudo", "Ir até") | câmera, viewport |
| Ocupar a tela toda | **Tela cheia** | maximizar |

"Janela" também é o que se escolhe no seletor de fonte ("Telas | Janelas").
Os dois vivem em lugares que não se cruzam (diálogo de compartilhar × Mesa), e
o texto sempre diz qual é ("janela na mesa").

## 10. Riscos

| Risco | Resposta |
|---|---|
| YouTube recusa embed a partir de `file://` | Spike na fase 0 |
| Mesa cheia pesa na GPU de quem joga | Fora da vista não assiste; tamanho vira teto; um vídeo com imagem por vez |
| `ui.js` (4 400 linhas) acoplado ao palco | Na fase 1 a Transmissão não muda; a Mesa é uma casca nova que recebe o mesmo `<video>` |
| Duas pessoas mexendo na mesma janela | Vez por janela no servidor |
| Trocar de tipo no meio de uma transmissão | Nada renegocia; só troca a casca. Teste e2e cobrindo |
| Estado grande no `welcome` | Teto de 32 janelas e de `props` por tipo |
| Akinator | Sem API oficial; fica de fora. Candidato a "Adivinha quem" do grupo, feito aqui |

## 11. Decisões em aberto

1. Quando o líder volta para Transmissão, **quem estava jogando** perde o
   tabuleiro da frente. Avisar antes ("Há 2 jogos em andamento na mesa")?
   Recomendado: sim, só um aviso, sem bloquear.
2. **Jogadores**: xadrez e damas com "sentar" (duas cadeiras, o resto assiste)
   ou qualquer um joga a vez? Recomendado: cadeiras.
3. Uma pessoa pode **seguir a vista do líder** ("olha aqui")? Recomendado:
   depois da fase 1, se fizer falta.
