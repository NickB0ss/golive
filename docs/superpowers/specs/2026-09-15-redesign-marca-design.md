# Redesign "Marca" — o app com a cara da logo e do site

Data: 2026-09-15. Pedido: "um design que combine com a logo no sentido de cores,
e mudar tudo que achar que pode melhorar".

## Problema

O app e o site parecem produtos diferentes. A logo (três nós, traço `#EDEDF2`,
nó de origem `#FF4D4F`) e o site usam neutros com leve tom violeta, ação violeta
`#5B4BE8` e as fontes Outfit + Work Sans. O app usa Segoe UI, neutros azulados
(`#0E0F13`…) e ação índigo `#4F46E5`. Nos prints da 0.15.0 (1440x900) o lobby
ocupa só a metade de cima da janela, a logo aparece com 20 px no canto e em nenhum
outro lugar, o estado vazio da lista de salas é texto puro, o botão de fechar de
Configurações flutua sobre a barra de rolagem e o placeholder do chat quase some.

## O que não muda (decisões anteriores, continuam valendo)

- `--live` significa só "alguém está ao vivo". Nenhum brilho, gradiente ou
  destaque novo usa vermelho.
- Nada de `backdrop-filter` nem `filter` sobre conteúdo vivo. Só `transform` e
  `opacity` animam. Cores só por token, nenhum hex fora dos blocos de tema.
- O contrato de temas (`theme.js`): superfícies e cor de ação livres; `--live`,
  `--warn` e `--danger` travados; a trava de contraste reprova antes de aplicar.
- A sala continua palco + coluna lateral. A faixa de título continua sem marca
  (0.12.7).

## 1. Tema padrão novo: "GoLive" (`marca`)

Valores do site, medidos lá (ver `golive-site/contrast.test.js`):

| Token | Valor | Nota |
|---|---|---|
| `--bg` | `#0A0A0F` | |
| `--s1`…`--s4` | `#101018` `#16161F` `#1E1E2A` `#292936` | neutros com tom violeta |
| `--tx` | `#EDEDF2` | a cor do traço da logo |
| `--tx2` / `--tx3` | `#A3A3B8` / `#9292AB` | |
| `--line` / `--line2` | `rgba(237,237,242,.08)` / `.14` | |
| `--act` / `--act-hover` | `#5B4BE8` / `#6D5CF6` | branco sobre `--act`: 5,81:1 |
| texto de ação (`--on-text`, links) | `#A99BFF` | 6,92:1; preenchimento nunca vira cor de texto |

- `marca` passa a ser o `:root` do `style.css` e o padrão de `config.js`.
  "Superfície e sinal" (`signal`) continua na lista, com os valores de hoje.
- Migração, uma vez só: config salvo antes desta versão com `preset: 'signal'`
  e sem cor de ação personalizada vai para `marca` (era o padrão, quase ninguém o
  escolheu). Uma escolha feita depois da migração nunca é desfeita.
- `marca` passa pela mesma trava de contraste dos outros temas (teste).

## 2. Tipografia

- Outfit (600–800) e Work Sans (400–600), `.woff2` copiados do site para
  `src/renderer/assets/fonts/` com `LICENSE-FONTS.txt` (OFL). Arquivos locais: o
  CSP (`default-src 'self'`) já permite, e o app segue sem requisição a terceiros.
- Work Sans no corpo e nos controles; Outfit no que é voz da marca: nome do app,
  título do lobby, título de diálogo, nome da sala no cabeçalho do palco, títulos de
  seção de Configurações e os rótulos de seção em caixa alta.
- Work Sans é mais larga que Segoe UI: conferir estouro a 1366x768 (tamanho mínimo
  real) em botões, lista de membros, cards de sala e seletor. Piso de 11 px mantido.

## 3. Momentos de marca

- **Lobby equilibrado**: o bloco das duas colunas centraliza na vertical
  (`align-content: safe center`), com largura máxima, em vez de colar no topo.
- **Cartão "Comece por aqui"**: a logo em tamanho de ícone de app (40–48 px) acima
  do título, e um brilho estático atrás do cartão feito com `radial-gradient` de
  `color-mix(in srgb, var(--act) …%, transparent)` — sai da cor de ação de cada
  tema, então nunca vira vermelho e não precisa de token novo. Pintura estática: não
  anima, não usa `filter`.
- **Estado vazio da lista de salas**: o desenho dos três nós em traço `--tx3` (o nó
  de origem também em `--tx3`: ninguém está ao vivo), um título curto e a dica do que
  fazer. Hoje é uma linha de texto.
- **Splash e Espiar**: mesmas cores e fontes do tema padrão (o Espiar hoje tem
  `backgroundColor: '#0e1116'` no main).

## 4. Acabamento de componentes

- **Foco visível** em tudo que é clicável (botões, abas, cards, segmentados, campos,
  itens de menu): `:focus-visible` com `var(--ring)`, sem `outline: none` sem
  substituto. Fecha parte do item F1 da auditoria.
- **Botões**: primário em `--act`, secundário em superfície com `--line2`, raio
  único, `cursor: pointer`, hover sem mudar tamanho.
- **Configurações**: o botão de fechar vai para um cabeçalho do modal, alinhado,
  fora da área que rola.
- **Chat**: placeholder e borda do campo com contraste de texto terciário.
- **Rótulos de seção** ("NA SALA", "CHAT", "QUALIDADE", "SALAS ABERTAS…"): Outfit,
  caixa alta, espaçamento de letra, `--tx3` — um só estilo em todo o app.

## Fora de escopo

Mudar a estrutura da sala, a lógica de `ui.js`/`app.js` além do necessário para o
estado vazio e o cabeçalho de Configurações, protocolo e dependências.

## Verificação

- `npm test` e `npm run lint`, com teste de `marca` na trava de contraste e da
  migração do config.
- Prints do app real pelo hook (`--require`, `--user-data-dir`) a 1440x900 e 1366x768:
  lobby com e sem salas, criar sala, entrar com PIN, Configurações > Aparência, sala
  com tela e câmera, seletor de fonte, sala vazia, tema Papel.
