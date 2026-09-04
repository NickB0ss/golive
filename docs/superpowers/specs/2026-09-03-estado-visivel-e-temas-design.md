# Estado visível e temas de cor — design

Data: 2026-09-03. Sucede o [seletor de qualidade em dois
eixos](./2026-09-03-seletor-de-qualidade-em-dois-eixos-design.md).

Três frentes que parecem soltas mas têm o mesmo defeito de raiz: **o app
sabe de um estado e não o mostra**. O botão sabe que está compartilhando e
continua escrito "Compartilhar tela". A pausa sabe que ninguém está vendo e
o espectador continua olhando um quadro parado sem saber por quê. E a
paleta sabe qual é o significado de cada cor, mas ninguém pode escolher a
cor.

A direção "Superfície e sinal" continua valendo. O que esta passada faz
com ela é o oposto de afrouxar: transforma a regra de que hoje só existe
como comentário no topo do CSS em algo que o **código** aplica e que um
tema custom não consegue quebrar. Ver
`[[golive - acento reservado a ao vivo, sem blur no redesign]]` e
`[[Um token semântico aplicado só por CSS estático vira decoração]]`.

---

## 1. Os três problemas

### 1.1 O botão não sabe dizer o que está acontecendo

`src/renderer/app.js` já faz o trabalho certo:

```js
$('btn-toggle-share').classList.add('active');    // startShare
$('btn-toggle-camera').classList.add('active');   // startCamera
$('btn-toggle-camera').classList.add('loading');  // enquanto o driver abre
```

E `src/renderer/style.css` tem, no arquivo inteiro, **uma** regra pra isso:

```css
#btn-pause-share.active { background: var(--warn); ... }
```

Não existe `.control-btn.active`, não existe `#btn-toggle-share.active`,
não existe `.loading`. Três classes de estado são escritas por JS e caem no
vazio. O resultado na tela:

| Estado real | O que o botão mostra |
|---|---|
| não compartilhando | `[▣ Compartilhar tela]` primário |
| **compartilhando** | `[▣ Compartilhar tela]` primário — **idêntico** |
| câmera desligada | `[▣ Câmera]` secundário |
| **câmera abrindo** (pode levar 2s) | `[▣ Câmera]` secundário — **idêntico** |
| **câmera ligada** | `[▣ Câmera]` secundário — **idêntico** |

O único jeito de saber se você está transmitindo é olhar pro tile de
prévia na grade — que numa sala cheia é um retângulo entre outros. Quem
clica duas vezes por engano derruba a própria transmissão sem nunca ter
visto sinal de que ela estava no ar.

Isto é a mesma falha catalogada em
`[[Um token semântico aplicado só por CSS estático vira decoração]]`, com o
sinal trocado: lá um token de estado estava aceso sem estado; aqui o estado
existe e não tem token. Os dois ensinam a mesma coisa — não acreditar na
interface.

### 1.2 A pausa é invisível pra quem assiste

`setSharePaused(true)` chama `mesh.setPeerDemand(peerId, 'screen', false)`,
que faz `sender.replaceTrack(null)` em cada espectador. Isso é a coisa certa
do ponto de vista de desempenho — libera um encoder inteiro por espectador,
que é o ponto inteiro do F1.3 da spec de 2026-08-23. Mas do ponto de vista
de quem assiste é indistinguível de:

- o jogo travou,
- a rede caiu,
- o encoder morreu (o sintoma que o amigo do Nicolas relatou em 2026-08-26),
- a pessoa alt-tabbou pra uma tela estática.

Quem pausa vê um toast ("Transmissão pausada — ninguém está vendo sua
tela") e o botão fica âmbar. Quem assiste vê **um quadro congelado, sem
nenhuma palavra na tela**. A informação existe do lado errado do cabo.

E o quadro congelado é pior que uma tela preta: ele continua mostrando o
que estava ali no instante da pausa. Se a pessoa pausou justamente porque
ia abrir algo que não queria mostrar, o último quadro antes da pausa é
exatamente o quadro que ela quis esconder — e ele fica na tela dos outros
até ela despausar ou sair.

### 1.3 A paleta é uma decisão de uma pessoa, imposta a todas

O tema atual é bom e é uma escolha defendida (elevação em vez de cor,
acento reservado). Mas é **uma** escolha, escrita em `:root` e sem porta de
saída. Quem prefere um app mais escuro, mais quente, ou com o roxo trocado
por verde, não tem o que fazer.

O CSS já está quase pronto pra isso — 5 níveis de superfície, tokens
semânticos, aliases de migração. O que falta é (a) tirar as ~15 cores cruas
que sobraram fora do `:root`, (b) um lugar pra guardar a escolha e (c) uma
tela pra fazer a escolha.

---

## 2. O princípio que amarra as três

> **Todo estado que muda o que o app faz tem de ter uma forma na tela — e
> todo token com nome de significado tem de ser aplicado por código que
> decide quando ele vale.**

Da primeira metade saem 1.1 e 1.2. Da segunda sai a regra que torna o
sistema de temas seguro: um tema pode repintar o mundo, **menos** os tokens
que significam alguma coisa.

---

## 3. Frente A — o botão que sabe o que está acontecendo

### 3.1 Três estados, três formas

O toggle de tela e o de câmera passam a ter três estados visuais distintos,
e a distinção **nunca é só cor** (regra `color-not-only`):

```
    OFF                    LOADING                  ON
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ ▣  Compartilhar  │   │ ◠  Abrindo…      │   │ ■  Parar de      │
│    tela          │   │                  │   │    compartilhar  │
└──────────────────┘   └──────────────────┘   └──────────────────┘
  primário, ícone        spinner, disabled      superfície viva,
  de monitor                                    ícone de "parar",
                                                RÓTULO DIFERENTE
```

Muda **três** coisas ao mesmo tempo: o texto, o ícone e o preenchimento.
Texto e ícone são o que sobrevive a daltonismo, a monitor ruim e a tema
custom; o preenchimento é o que faz a mudança ser vista sem ler.

| | Tela — OFF | Tela — ON | Câmera — OFF | Câmera — ON |
|---|---|---|---|---|
| rótulo | Compartilhar tela | **Parar de compartilhar** | Câmera | **Desligar câmera** |
| ícone | monitor | quadrado de parada | câmera | câmera cortada (`/`) |
| classe | `.primary` | `.primary.is-on` | `.secondary` | `.secondary.is-on` |
| `aria-pressed` | `false` | `true` | `false` | `true` |
| `title` | — | Ctrl+Alt+P pausa sem parar | — | — |

`aria-pressed` é o que faz o leitor de tela anunciar "botão alternar,
pressionado" em vez de ler dois botões que parecem não ter relação. O
elemento continua sendo o mesmo `<button>` — nada de trocar o nó, que
perderia o foco do teclado no meio do clique.

### 3.2 O que "is-on" parece

Ligado **não** é "primário mais saturado". Um botão de ação e um botão de
estado ligado são coisas diferentes e têm de parecer diferentes:

```css
.control-btn.is-on {
  background: var(--on-fill);          /* superfície viva, não o acento */
  border-color: var(--on-line);
  color: var(--on-text);
  box-shadow: inset 0 0 0 1px var(--on-line);
}
```

`--on-fill` / `--on-line` / `--on-text` são tokens novos, derivados do
acento do tema mas **rebaixados** (fundo de ~12-16% de opacidade sobre a
superfície, borda de ~35%, texto no acento cheio). O botão fica
inconfundivelmente "ligado" sem virar um segundo CTA competindo com o
primário da tela — que é a regra "uma primária colorida por tela" que o CSS
já declara na linha 167.

Um ponto pulsante é **descartado**: pulsar é animação contínua, e a barra de
controle fica visível o tempo todo durante a transmissão. Estado ligado é
estático; só a *transição* entre estados anima (150ms, `transform`/`opacity`).

### 3.3 O estado de carregando é obrigatório na câmera

`startCamera()` espera o driver. Em webcam USB isso é rotineiramente 1-2
segundos, e hoje a tela não muda nada nesse intervalo — o padrão exato que
faz a pessoa clicar de novo. `.loading` ganha corpo: spinner no lugar do
ícone, rótulo "Abrindo…", `disabled` de verdade (não só visual, pra o
teclado também não conseguir disparar duas vezes), `aria-busy="true"`.

O compartilhar tela não precisa: ele abre um diálogo, e o diálogo é o
feedback.

### 3.4 Botão de pausa: o rótulo também vira par

Já funciona hoje (âmbar quando pausado), mas o rótulo é sempre "Pausar".
Vira `Pausar` ⇄ `Retomar`, com o ícone de duas barras virando triângulo,
pela mesma razão dos outros dois.

---

## 4. Frente B — "Transmissão pausada" na tela de quem assiste

### 4.1 O que o espectador vê

```
┌─────────────────────────────────────────────┐
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░  último quadro, borrado  ░░░░░░░░░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░░░  ▍▍  ░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░  Transmissão pausada  ░░░░░░░░░░░░░░│
│░░░░░░░░  Nicolas pausou a tela  ░░░░░░░░░░░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└─────────────────────────────────────────────┘
```

Três camadas, nesta ordem: bitmap borrado do último quadro → véu escuro
(`rgba` do token de scrim, garante 4.5:1 pro texto sobre **qualquer**
conteúdo borrado) → glifo de pausa + duas linhas de texto.

Borrar em vez de tela preta é uma escolha: a tela preta perde o contexto
("é a mesma transmissão que eu estava vendo, ela volta") e parece falha. O
borrado diz "ainda é isto aqui, só que suspenso". E resolve o problema de
privacidade da §1.2 — o último quadro deixa de ser legível.

Grau de borrão: forte o bastante pra texto não ser lido (`blur(20px)` sobre
um bitmap reduzido a 320px de largura — ver §4.3, o resultado visual é o de
um blur de ~60px na resolução cheia).

O tile do **próprio** transmissor (`me`) recebe o mesmo tratamento, mais
suave e com o texto trocado pra "Você pausou — ninguém está vendo". Sem
isso, quem pausa não tem como conferir o que os outros estão vendo, e a
pergunta "será que ainda está passando?" é exatamente a que a pausa precisa
responder sem sombra de dúvida.

### 4.2 Como o espectador fica sabendo

A pausa vira estado de protocolo. `broadcast-state` ganha um campo:

```js
// hoje
{ type: 'broadcast-state', live: true }
// passa a ser
{ type: 'broadcast-state', live: true, paused: false }
```

`server/signaling-core.js` repassa `paused: Boolean(msg.paused)` junto do
`live` — a sala inteira recebe, não só quem está assistindo, do mesmo jeito
que `live` já funciona. Quem trata: `case 'broadcast-state'` em `app.js`,
que já existe e já grava `peer.live`.

Três razões pra estender `broadcast-state` em vez de criar uma mensagem
nova:

1. **Pausado é uma qualificação de "ao vivo", não um evento paralelo.** Um
   peer não pode estar pausado sem estar ao vivo. Duas mensagens
   independentes criam a possibilidade de estados impossíveis
   (`live:false, paused:true`) que alguém teria de reconciliar.
2. `live:false` já limpa o tile. Se `paused` viesse por outro canal, um
   `stop` seguido de um `paused` atrasado repintaria o overlay num tile que
   não existe mais.
3. Já existe o reenvio de `broadcast-state` no `peer-joined` (`app.js`,
   linha ~1726) pra sala que cresce com a tela no ar. Ele passa a carregar
   `paused: sharePaused` e o problema "entrei durante uma pausa" resolve
   sozinho, sem código novo.

Compatibilidade de versão não é preocupação: a sala **recusa** quem está em
versão diferente (`join-denied`, motivo `version`) desde a 0.6.0. Todo mundo
numa sala roda o mesmo protocolo, por construção.

### 4.3 Por que o blur aqui não contradiz a decisão de não usar blur

`[[golive - acento reservado a ao vivo, sem blur no redesign]]` descartou
`backdrop-filter` **em qualquer superfície**, e o motivo está escrito: é
trabalho de GPU **contínuo por camada**, na mesma GPU que o encoder e o
jogo disputam. E `[[Nunca aplicar filter a um elemento animado de tela
cheia]]` fecha a regra geral: *"ou o elemento é estático, ou o efeito é
pré-renderizado numa imagem"*.

O que esta spec faz é **a segunda metade dessa regra, ao pé da letra**:

| | `backdrop-filter` (descartado) | Este overlay |
|---|---|---|
| o que é borrado | conteúdo vivo por baixo, a cada frame | **um bitmap**, uma vez |
| custo | por frame, enquanto a camada existir | uma rasterização, no clique |
| onde roda | na máquina de quem **transmite** | na de quem **assiste** |
| quando | o tempo todo | só enquanto pausado — e pausado é justamente quando o encoder daquele fluxo está **desligado** |

A técnica, explícita, porque é ela que faz a diferença acima ser verdade e
não retórica:

1. no clique da pausa, `drawImage` do `<video>` num `<canvas>` de **320px
   de largura** (o borrão destrói o detalhe de qualquer jeito — borrar 320px
   e esticar dá o mesmo resultado visual por ~1/40 dos pixels);
2. `filter: blur(20px)` no canvas, que é um elemento **estático**: nenhuma
   animação, nenhum `transform`, nenhum conteúdo mudando por baixo;
3. `video.pause()` e `video.hidden = true` — o `<video>` para de compor
   camada, o que **economiza** GPU em relação a hoje, onde ele segue vivo
   segurando um quadro parado.

Se o vídeo ainda não tem quadro (`videoWidth === 0`, peer que pausou antes
do primeiro frame chegar), cai pro véu escuro + texto sem borrão. Sem
`try/catch` mudo: o caminho degradado é o mesmo caminho, com uma camada a
menos.

**Isto não reabre a decisão do vault.** A decisão proíbe borrar conteúdo
vivo; aqui não há conteúdo vivo pra borrar — a pausa é literalmente a
ausência dele. A nota do vault ganha uma seção registrando a distinção, pra
que a próxima leitura não use a regra pra proibir o caso que ela permite (o
erro exato de `[[Uma auditoria que prova um item citando outro documento
herda o erro dele]]`).

### 4.4 O que a pausa **não** vira

Não vira um estado que o espectador possa mudar, pedir pra sair, ou
protestar. Sem botão "avisar que quero ver". A pausa é da pessoa que
transmite, e a tela do espectador é informativa.

Também não mexe em nada do transporte: `setPeerDemand`, a árvore, o
orçamento de uplink e a escada de qualidade ficam byte a byte iguais. O
overlay é consequência de uma mensagem, não de uma mudança de mídia.

---

## 5. Frente C — temas de cor

### 5.1 O contrato: o que um tema pode e não pode pintar

O sistema inteiro se apoia numa divisão dos tokens em três classes:

| Classe | Tokens | Um tema pode mudar? |
|---|---|---|
| **Superfície** | `--bg`, `--s1`…`--s4`, `--line`, `--line2`, `--tx`, `--tx2`, `--tx3`, scrims | **Sim** — é o corpo do tema |
| **Ação** | `--act`, `--act-hover`, `--on-fill`, `--on-line`, `--on-text`, `--ring` | **Sim** — é a cor que a pessoa escolhe |
| **Semântica** | `--live`, `--warn`, `--danger` (+ `-dim`) | **Não.** Travados. |

A terceira linha é a regra inteira. `--live` significa "alguém está ao
vivo", `--warn` significa "degradado", `--danger` significa "isto apaga
alguém da sala". Se o tema custom pudesse pintá-los, um usuário
inevitavelmente escolheria vermelho pro `--act` e a sala inteira passaria a
parecer que está transmitindo — que é a decoração-com-nome-de-estado de
`[[Um token semântico aplicado só por CSS estático vira decoração]]`,
chegando pela outra porta.

Consequência prática: o seletor de cor de ação **recusa** um acento que
fique perto demais de `--live` (distância mínima de matiz, ver §5.4) e
oferece a cor mais próxima aceitável em vez de só barrar.

### 5.2 As predefinições

Seis, cada uma um conjunto fechado de tokens de superfície + ação:

| Nome | Superfícies | Ação | Por que existe |
|---|---|---|---|
| **Superfície e sinal** | grafite neutro (atual) | índigo `#4F46E5` | o padrão de hoje, intocado |
| **Meia-noite** | azul-nanquim, mais escuro que o atual | azul-gelo | pra quem joga no escuro |
| **Carvão** | cinza puro, sem matiz | grafite claro | acromático — o acento é o único matiz da tela |
| **Âmbar quente** | marrom-fumaça | âmbar-queimado | temperatura oposta ao padrão |
| **Floresta** | verde-abissal | verde-sálvia | o pedido mais comum depois de "menos roxo" |
| **Papel** | **claro** — off-white e cinzas | índigo escurecido | o único claro; ver §5.5 |

Trocar de preset é troca de `data-theme` no `<html>`, e cada preset é um
bloco `:root[data-theme="x"]` no CSS. Nenhum JS calcula cor no caminho
comum — o custo de trocar de tema é o custo de trocar um atributo.

### 5.3 O tema personalizado

Dois controles, não vinte:

```
Base da interface   [●─────────]  frio ←→ quente    (matiz das superfícies)
                    [○─────────]  escuro ←→ claro   (nível de fundo)
Cor de ação         [ ▣ ] #4F46E5          (roda de cor + hex)
```

A rampa de superfícies inteira (`--bg`, `--s1`…`--s4`, as duas linhas, os
três níveis de texto) é **derivada** desses três números por uma função em
`src/renderer/theme.js`, com os mesmos degraus de luminosidade relativa que
a rampa atual usa. A pessoa não escolhe cinco cinzas — ela escolhe uma
temperatura e um nível, e a rampa sai coerente por construção.

Por que derivar em vez de deixar escolher tudo: cinco campos de cor
produzem, na prática, temas ilegíveis. A rampa derivada não tem como sair
com dois níveis colados nem com texto sobre fundo de contraste ruim, porque
os degraus são fixos e só o ponto de partida se move.

### 5.4 A trava de contraste, e por que ela não é opcional

`theme.js` valida **antes** de aplicar, e a validação é dura:

- `--tx` sobre `--bg` e sobre `--s1`…`--s4`: mínimo 4.5:1;
- `--tx3` (o rótulo de 10-11px, o mais frágil da interface) sobre `--s1` e
  `--s2`: mínimo 4.5:1 — o comentário no CSS de hoje registra 5.33:1 e
  4.89:1, e isso é o piso a manter;
- texto branco sobre `--act` (todo `.primary`): mínimo 4.5:1 — se o acento
  escolhido for claro demais, o texto do botão vira o `--tx` escuro do
  tema, automaticamente, em vez de o botão ficar ilegível;
- `--live` e `--danger` sobre `--s1`: mínimo 3:1, senão o tema não pode
  ficar tão claro;
- distância de matiz entre `--act` e `--live`: mínimo 40°, pela §5.1.

`--warn` fica **fora** desta checagem, e não por descuido: sua luminância
(~0,53, típica de amarelo) torna 3:1 contra qualquer `--s1` claro
matematicamente impossível — precisaria de uma superfície com luminância
≥1,69 (acima do teto do espaço de cor) ou ≤0,143 (o que já não é mais
"claro"). A primeira tentativa de derivar "Papel" aplicou a regra ao pé da
letra e passou — à custa de forçar `--s1`…`--s4` para quase preto, o que
tecnicamente batia o piso mas deixava de ser um tema claro. `--live`
(~0,27) e `--danger` (~0,14) não têm esse problema: os dois têm solução
com `--s1` genuinamente claro. O preço, aceito e documentado no código: em
"Papel", texto na cor `--warn` pura (coroa de dono da sala, item de aviso
no menu, aviso de chat) fica com contraste reduzido — ainda legível, só
não bate 3:1 como nos outros cinco temas, onde `--warn` foi pensado (fundo
escuro, onde sobra folga).

Falhou: o controle mostra qual regra falhou, em português, e a cor mais
próxima que passa — nunca aplica um tema reprovado nem trava o slider em
silêncio.

Isto é a metade da lição de `[[Um token semântico aplicado só por CSS
estático vira decoração]]` que ainda faltava: o token só significa se
existir **código** decidindo quando ele vale. Aqui existe, e ele reprova.

### 5.5 O tema claro é o teste que prova o resto

"Papel" não está na lista por demanda — está porque é o único jeito de
provar que a tokenização ficou completa. Qualquer cor crua que sobreviva ao
trabalho aparece imediatamente num tema claro: um `rgba(0,0,0,0.65)` de
scrim vira uma mancha preta, um `color: #fff` num botão vira texto branco
sobre fundo claro.

O inventário do que precisa sair do CSS pra isso funcionar (linhas fora do
`:root`, contadas hoje):

| Cor crua | Onde | Vira |
|---|---|---|
| `rgba(0,0,0,0.65)` ×4, `0.55` ×4, `0.85` ×2, `0.75`, `0.5`, `0.4` ×2 | scrims de modal, overlays de tile, PiP | `--scrim-1/2/3` |
| `#fff` ×3 | texto de `.primary`, `.destructive`, `::selection` | `--on-act` |
| `#000` ×3 | fundo de `<video>` e de thumbnail | `--video-bg` |
| `#FF8385` ×3, `#B3242D` ×2, `#D3D7DD` | variantes de `--live`/`--danger`/texto | tokens `-hover`/`-soft` |
| `rgba(79,70,229,0.22)` | glow de foco do chat | derivado de `--act` |
| `rgba(245,181,68,·)` ×3, `rgba(240,178,50,0.12)` | bordas de aviso | derivados de `--warn` |
| `rgba(255,255,255,·)` ×5 | linhas e véus claros | `--line*`, `--veil` |
| `rgba(13,15,19,0.82)` ×2 | véu do lobby | `--scrim-2` |

São ~28 ocorrências em ~20 linhas. Baixo risco, alto retorno: enquanto elas
existirem, **todo** tema não-grafite fica sutilmente quebrado, e o defeito
aparece em lugares aleatórios que ninguém liga ao tema.

`backgroundColor: '#0e1116'` do `BrowserWindow` (`src/main.js:168`) é o
último: é o que pinta a janela antes do CSS carregar. Com "Papel" ativo ele
dá um flash escuro em toda abertura. O tema escolhido passa a ser lido pelo
main process e usado ali.

### 5.6 Onde isso mora na interface

Aba nova em Configurações: **Perfil · Aparência · Voz e Vídeo ·
Estatísticas**. Aparência tem a grade de predefinições (cada uma um cartão
com a rampa da própria paleta desenhada em faixas — não um nome escrito
num quadrado da cor de acento) e, embaixo, o bloco "Personalizar" com os
três controles da §5.3.

A troca é imediata e ao vivo, sem botão "aplicar": a pessoa vê o app
inteiro mudar enquanto arrasta. É a única forma de avaliar um tema.

Persiste em `cfg.theme` (`{ preset: 'signal' }` ou
`{ preset: 'custom', base: {...}, act: '#...' }`), pelo mesmo
`config.load/serialize` que já guarda tudo. Config antigo sem `theme` cai no
padrão de hoje — ninguém abre o app e encontra outra cor.

---

## 6. O que esta passada não toca

`mesh.js`, `tree.js`, `autoquality.js`, `peerquality.js`, `rxstats.js`,
`encode*.js`, `src/main/*` e o addon nativo ficam intactos. De `app.js`,
só a barra de controle, o handler de `broadcast-state` e a aplicação do
tema no boot. De `server/signaling-core.js`, um único campo repassado.

Nada de transporte, adaptação de qualidade ou topologia entra aqui.

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| O blur do overlay reabrir o custo de GPU que a decisão do vault fechou | Bitmap 320px estático, `<video>` pausado e escondido — o saldo de GPU é **negativo** (§4.3). Verificar no app rodando com o painel de estatísticas aberto |
| Tema claro expor cores cruas em lugares não inventariados | "Papel" é o teste, não a feature. Varredura de `#`/`rgba(` fora do `:root` como critério de saída, e conferência visual tela a tela |
| Tema custom produzir combinação ilegível | Trava de contraste da §5.4, que reprova antes de aplicar |
| Peer entrar durante uma pausa e ver tela congelada sem overlay | `paused` viaja no reenvio de `broadcast-state` do `peer-joined` (§4.2) |
| `drawImage` falhar em tile sem primeiro frame | Caminho degradado explícito: véu + texto, sem borrão (§4.3) |
