# App em três idiomas (pt-BR, en, es) — design

Data: 2026-10-03 · Estado: aprovado no brainstorming, falta o plano.

## 0. Objetivo e escopo

O GoLive passa a funcionar inteiro em **português, inglês e espanhol**. Por
padrão ele segue o idioma do sistema, e em Configurações dá para trocar.

Decisões tomadas com o Nicolas:

- O alvo é o **app**. O site (`golive-website`) fica fora deste trabalho.
- **Tudo num release só**: casca, Mesa (janelas e regras dos jogos) e conteúdo.
  O plano divide o trabalho em fatias commitadas separadas, mas nada sai pela
  metade.
- O Quiz ganha um **banco novo**, com temas que valem para qualquer região, e a
  partida passa a ter **escolha de temas**. Detalhe na seção 5.

Pré-requisito: o rework das janelas (`feat/janelas-rework`) precisa estar
commitado. Este trabalho mexe nos mesmos arquivos de `mesa-janelas/` e começa
numa branch nova (`feat/idiomas`) a partir da `main`.

Ponto de partida, levantado em 2026-10-03:

- Não existe nenhuma infraestrutura de tradução.
- São ~1.400 literais de texto visível no código: ~740 em
  `app.js`/`ui.js`/demais módulos de `src/renderer`, ~340 em `mesa-janelas/`,
  ~245 em `mesa-modules/` e ~35 em `src/main`. Somam-se o texto fixo do
  `index.html`, o `splash.html` e o banco do Quiz (~190 perguntas sobre o
  Brasil).
- Datas e horas estão fixas em `'pt-BR'` (`ui.js`, `toLocale*`).
- As regras dos jogos devolvem frases prontas (`'Não é a sua vez'`) como
  resultado de validação.

## 1. Infraestrutura

### 1.1 Dicionários

Ficam em `src/renderer/i18n/`, porque a origem local da janela só serve
`src/renderer`. O processo principal e o servidor da sala carregam os mesmos
arquivos com `require`.

- `pt-BR.js`, `en.js` e `es.js` são **objetos planos** de chave → texto.
- As chaves são agrupadas por área, com ponto: `lobby.criarSala`,
  `sala.sair`, `config.idioma.titulo`, `mesa.truco.naoESuaVez`.
- Os arquivos usam o mesmo padrão de módulo dos arquivos da Mesa
  (`root.GoLive...` mais `module.exports`). Assim o processo principal carrega
  com `require` e o renderer carrega por `<script>`.
- **O português é a referência**: toda chave nasce primeiro em `pt-BR.js`.

### 1.2 `t(chave, valores)`

Fica em `src/i18n/index.js`:

- **Interpolação**: `{nome}` é trocado por `valores.nome`. O valor entra sempre
  como texto; quem monta DOM continua usando `textContent`.
- **Plural**: o valor da chave pode ser um objeto `{ one, other }`. A forma é
  escolhida com `Intl.PluralRules(idioma)` a partir de `valores.n`.
- **Fallback**: quando a chave falta em en/es, usa o pt-BR. Quando falta até no
  pt-BR, devolve a própria chave e avisa uma vez no `console.warn`. Os testes
  da seção 6 impedem que isso chegue a um release.
- **Formatação**: `formatarHora`, `formatarData` e `formatarNumero` usam
  `Intl` com o idioma ativo. Substituem todos os `'pt-BR'` fixos, inclusive o
  `toLocaleUpperCase`.
- `idiomaAtivo()` devolve `'pt-BR' | 'en' | 'es'`.

### 1.3 HTML estático

- No `index.html`, cada texto fixo ganha `data-i18n="chave"`. Atributos lidos
  pela pessoa (`title`, `aria-label`, `placeholder`, `alt`) ganham
  `data-i18n-attr="aria-label:chave;title:chave2"`.
- Uma função `aplicarNoDom(raiz)` roda no boot, antes de a janela aparecer, e
  também no DOM montado por template.
- O texto em português fica no HTML como conteúdo inicial. Se a aplicação
  falhar, o app continua legível.
- `<html lang>` passa a acompanhar o idioma ativo. `splash.html`,
  `espiar.html`, `overlay.html` e `vazia.html` seguem a mesma regra.

### 1.4 Processo principal

`src/main/` não tem texto de tela, por regra já registrada em `updater.js`
e `splash.js`. O que muda ali:

- O splash recebe os quatro textos já traduzidos pelo `preload-splash.js`
  (`ipcRenderer.sendSync('i18n:splash')`). Os preloads rodam em sandbox e não
  carregam os dicionários.
- O nome padrão da sala (`sala de ${name}`) é conteúdo e fica no idioma de quem
  cria a sala, montado pelo renderer com `t()` e enviado no `hostRoom`.

## 2. Escolha do idioma

### 2.1 Resolução

Módulo puro `src/main/idioma.js`, testável sem Electron:

```
resolverIdioma(preferencia, idiomasDoSistema) -> 'pt-BR' | 'en' | 'es'
```

- `preferencia` vem da configuração: `'auto' | 'pt-BR' | 'en' | 'es'`.
- Com `'auto'`, ele percorre `app.getPreferredSystemLanguages()` em ordem e
  usa o **primeiro** cujo prefixo seja `pt`, `en` ou `es`. Qualquer `pt-*` dá
  `pt-BR`, e o mesmo vale para `en-*` e `es-*`. Se nenhum servir, o resultado
  é **`en`**.
- Preferência inválida conta como `'auto'`.

O idioma resolvido chega ao renderer pelo `preload.js` antes do primeiro
desenho, então não há piscada de português.

### 2.2 Configuração

- A preferência (`'auto' | 'pt-BR' | 'en' | 'es'`) fica num arquivo próprio,
  `idioma.json` em `userData`, gravado pelo processo principal. Ela não vai
  para o `config.js` porque a config mora no `localStorage` da janela, que o
  processo principal e o splash não enxergam, e o splash aparece antes da
  janela. É o mesmo padrão de `espiar-janela.json` e `origem.json`. Arquivo
  ausente, ilegível ou com valor fora da lista conta como `'auto'`.
  *(Ajuste de 2026-10-03, ao escrever o plano. A primeira versão desta seção
  punha o campo no `config.js`.)*
- Em **Configurações › Idioma** entra um seletor: *Automático (idioma do
  sistema)*, *Português*, *English*, *Español*. Os nomes das línguas aparecem
  sempre na própria língua.

### 2.3 Troca

- **Fora de sala**: salva e recarrega a janela.
- **Dentro de sala**: recarregar derrubaria a conexão. O seletor salva e
  mostra "vale quando você sair da sala"; ao sair, a janela recarrega no idioma
  novo.

### 2.4 O que fica em português de propósito

- `console.*` e os logs em arquivo.
- O relatório copiado em Diagnóstico, porque é lido pelo desenvolvedor. Os
  rótulos da tela de Diagnóstico são traduzidos.
- As notas de versão que vêm do GitHub.

## 3. Sala com idiomas diferentes

**Regra: o que atravessa de um PC para outro é código mais parâmetros, nunca
frase pronta.** Cada pessoa traduz localmente.

- **Validação dos módulos da Mesa**: a função que hoje devolve uma string de
  erro passa a devolver a chave (`'mesa.truco.naoESuaVez'`). Se a frase tiver
  parte variável, devolve `{ erro: chave, valores }`. A interface traduz na
  hora de mostrar, e a forma `true` para "válido" não muda.
- **Eventos de sistema** (entrou, saiu, virou líder…) e textos derivados de
  estado são montados por quem exibe, a partir do estado.
- **Conteúdo escrito por pessoas continua como foi escrito**: chat, nome da
  sala, nomes, categorias do Stop, itens de lista e enquete que alguém digitou.
  Os textos padrão seguem o item seguinte.
- **Recusa com valores** (`Aposta de 10 a 500`): o servidor da sala só repassa
  `detail` como string de até 120 caracteres. Por isso o código leva os valores
  no formato de query, `mesa.blackjack.apostaEntre?min=10&max=500`, montado por
  `codigo(chave, valores)` e lido por `traduzirCodigo(texto)`. O servidor não
  muda.
- **Texto padrão guardado no estado** (opções "Sim"/"Não" da enquete,
  categorias padrão do Stop, nomes de jogo do pôquer etc.) vira chave
  (`'mesa.enquete.sim'`). Quem exibe passa todo texto vindo do estado por
  `traduzirCodigo`: se for uma chave conhecida, traduz; se não, mostra como
  está. É assim que convivem a categoria padrão e a categoria que a pessoa
  digitou.
- **`view` dos módulos secretos** (Quiz, Desenha e outros que rodam `view` no
  servidor): ela é montada **pelo servidor da sala**, então manda ids e
  códigos, nunca texto. Cada pessoa monta o texto no próprio idioma.
- **Compatibilidade**: o formato das mensagens da Mesa muda. Como uma sala já
  só aceita quem está na mesma versão exata, não é preciso conviver com o
  formato antigo.

## 4. Termos e nomes

- `docs/glossario.md` ganha as colunas **en** e **es**, com termo e "nunca
  use" por língua. Exemplos: *room leader* (nunca *host*, *owner*); *líder de
  la sala* (nunca *anfitrión*, *dueño*); *scribble* / *garabato* para
  "rabisco"; *view* / *vista* para "vista".
- Nomes de jogo: Truco, Blackjack, Xadrez/Chess/Ajedrez, Dominó/Dominoes/Dominó
  etc. ficam na tabela do glossário. Pôquer vira *Poker* / *Póquer*.
- A busca de emoji (`emoji.js`) ganha palavras-chave em en e es. A busca usa as
  palavras do idioma ativo mais as do pt-BR, porque a pessoa pode digitar em
  qualquer uma.

## 5. Quiz novo

### 5.1 Banco

O banco atual (~190 perguntas sobre o Brasil) sai e entra outro, com
**8 temas × 60 = 480 perguntas**:

| id do tema | pt-BR | en | es |
|---|---|---|---|
| `games` | Games | Video games | Videojuegos |
| `anime` | Anime e mangá | Anime & manga | Anime y manga |
| `futebol` | Futebol | Soccer / Football | Fútbol |
| `esportes` | Esportes | Sports | Deportes |
| `musica` | Música | Music | Música |
| `filmes` | Filmes e séries | Movies & TV | Cine y series |
| `ciencia` | Ciência e tecnologia | Science & tech | Ciencia y tecnología |
| `mundo` | Geografia e mundo | Geography & world | Geografía y mundo |

Critérios de conteúdo:

- **Conhecimento global, não regional**: artistas, franquias, clubes, atletas e
  fatos conhecidos fora de um país só. Nenhuma pergunta depende de saber algo
  local do Brasil, dos EUA ou da Espanha.
- **Fatos estáveis**: nada de "quem é o atual campeão". Recordes e títulos só
  quando estiverem fechados no tempo, com data na pergunta ("até 2022", "na
  Copa de 2014").
- **Mesmo conteúdo nas três línguas**: o fato e as alternativas são iguais.
  Nomes próprios ficam na forma oficial de cada idioma quando ela existir
  (*Copa do Mundo* / *World Cup* / *Copa del Mundo*).
- **Dificuldade misturada** em cada tema: uns 20 fáceis, 25 médios e 15
  difíceis. O campo `nivel` fica no banco e não aparece na interface.

### 5.2 Formato

Arquivo `mesa-modules/quiz-perguntas.js`, mantendo o mesmo padrão de módulo:

```js
{ id: 'games-001', tema: 'games', nivel: 1, certa: 0,
  pt: ['Pergunta?', ['A', 'B', 'C', 'D']],
  en: ['Question?', ['A', 'B', 'C', 'D']],
  es: ['¿Pregunta?', ['A', 'B', 'C', 'D']] }
```

- `certa` é o índice nas alternativas e vale para as três línguas.
- O id é uma string estável. O estado da partida guarda ids, e cada pessoa
  monta o texto no próprio idioma.
- O embaralhamento das alternativas por rodada (`ordens`) continua como hoje.
- `validarBanco()` exige:
  - 60 perguntas por tema e ids únicos;
  - as três línguas presentes, com 4 alternativas distintas em cada;
  - nenhuma pergunta repetida dentro de uma língua;
  - `certa` entre 0 e 3.

### 5.3 Temas na partida

- O Quiz passa a nascer **em preparo**, sem rodada correndo. Nessa fase
  qualquer pessoa da sala marca ou desmarca temas e aperta *Começar*, do mesmo
  jeito que as categorias do Stop são trocadas. **Todos os temas vêm
  marcados**, e não dá para começar com nenhum. *Reiniciar*, que continua
  restrito ao líder, volta ao preparo mantendo os temas da partida anterior.
- `init`/`sortear` passam a receber os temas e sorteiam as 10 rodadas só entre
  as perguntas deles. Com qualquer tema marcado há 60 perguntas ou mais, então
  as 10 rodadas sempre fecham.
- Os temas escolhidos ficam no estado da partida.
- Cada pergunta mostra o nome do tema no idioma de quem lê.

### 5.4 Desenha e adivinha

As palavras secretas (`PALAVRAS` em `mesa-modules/desenha.js`, 150 ou mais)
também são conteúdo:

- Viram um banco trilíngue com id: `{ id: 'casa', pt: ['casa'], en: ['house'],
  es: ['casa'] }`. Quando uma língua tiver sinônimos comuns, cada uma pode ter
  mais de uma forma aceita (`en: ['couch', 'sofa']`).
- O estado guarda ids (`options`, `word`, `lastRound.word`). Quem desenha vê as
  opções no próprio idioma, usando a primeira forma.
- Um palpite acerta se bater, sem acento e sem caixa, com **qualquer forma de
  qualquer uma das três línguas**. O "quase" (uma letra de diferença) segue a
  mesma regra.
- Critério das palavras: desenháveis e com tradução direta. Palavra sem
  equivalente claro numa das línguas sai do banco.

## 6. Testes

Todos com `node --test`, junto da suíte atual:

1. **Paridade dos dicionários**: as três línguas têm o mesmo conjunto de
   chaves, os mesmos `{marcadores}` por chave, nenhum valor vazio e, nos
   plurais, as mesmas formas.
2. **Chave usada existe**: varredura estática de `t('...')`, `data-i18n` e
   `data-i18n-attr` em `src/`; toda chave citada existe no pt-BR. Chave
   montada dinamicamente precisa ter o prefixo declarado numa lista do teste.
3. **Trava contra texto solto**: o tokenizador do `glossario.test.js` é
   reaproveitado para reprovar frase visível escrita direto em `app.js`,
   `ui.js`, `mesa-janelas/*.js`, `mesa-modules/*.js` e `src/main/*.js`. Fica
   fora `console.*`, com uma lista curta de exceções justificadas no próprio
   teste.
4. **Glossário por língua**: o teste atual passa a varrer os três dicionários,
   cada um com a sua lista de termos proibidos.
5. **`resolverIdioma`**: preferência explícita, `auto` com sistema pt-PT, en-GB,
   es-MX, a lista `['fr-FR', 'es-ES']` resolvendo para `es`, e lista vazia ou
   sem match resolvendo para `en`.
6. **Validação da Mesa**: os testes dos módulos que hoje comparam a frase de
   erro passam a comparar a chave.
7. **Quiz**: o banco é validado, o sorteio respeita os temas e a partida com um
   tema só fecha 10 rodadas sem repetir pergunta.

## 7. Verificação no app real

O `node --test` não carrega o `app.js`, então os testes não bastam:

- **Boot no Electron real** com `language` em pt-BR, en e es: o app sobe, entra
  numa sala e abre Configurações sem erro no console.
- **Prints automatizados** (hook `--require` + `--user-data-dir`) em en e es:
  lobby, sala com presença, Configurações, Diagnóstico e as janelas de texto
  mais denso (Truco, Pôquer, Stop, Quiz no preparo e numa rodada). O que se
  procura é texto estourando, cortado ou quebrando a barra da janela. O
  espanhol costuma ser ~20% mais longo que o português. Os prints ficam em
  `docs/prints/2026-10-xx-idiomas/`.
- **Sala mista**: duas instâncias, uma em pt-BR e outra em es, jogando Truco e
  Quiz. Cada uma precisa ver os erros de jogada e as perguntas no próprio
  idioma.

## 8. Riscos

- **Qualidade da tradução**: as traduções en/es são feitas por IA, com o
  glossário segurando a terminologia. Antes do release vale uma revisão
  nativa, principalmente do espanhol e das 480 perguntas.
- **Fatos do Quiz**: cada pergunta precisa de uma resposta indiscutível. O
  plano prevê uma passada de revisão só para isso, separada da tradução.
- **Tamanho do diff**: é o maior que o app já teve. O plano corta em fatias
  (infraestrutura; casca; Mesa; Quiz; emoji; prints), cada uma com testes
  verdes e commit próprio.
- **Texto montado por concatenação**: frases montadas com `+` não se traduzem
  direito, porque a ordem das palavras muda entre línguas. Cada uma precisa
  virar uma chave só, com marcadores.

## 9. Fora do escopo

- O site.
- Idiomas além destes três e escrita da direita para a esquerda.
- Traduzir as notas de versão do GitHub.
