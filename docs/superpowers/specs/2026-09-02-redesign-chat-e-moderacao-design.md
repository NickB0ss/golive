# Redesign da interface + chat + poderes do dono da sala — design

Data: 2026-09-02
Status: **fechado, pronto pra virar plano de implementação**

Substitui `2026-09-02-redesign-discord-style-design.md`, que era o estado
parcial de um brainstorm interrompido. Aquele arquivo virou ponteiro pra este.

---

## 1. O que este documento cobre

Três frentes que se decidiu tratar como **uma spec só**, porque moram nas
mesmas superfícies:

1. **Redesign da interface** — `index.html`, `style.css` e `ui.js` reescritos
   do zero, telas novas, linguagem visual nova.
2. **Chat de texto na sala** — mensagens, histórico, avisos de sistema.
3. **Poderes do dono da sala** — parar a transmissão de alguém, expulsar,
   banir da sala atual.

Separar as três significaria desenhar a coluna direita da Sala duas vezes: o
chat pede lugar nela e o menu de moderação nasce dentro da lista de membros.

## 2. Decisões travadas com o usuário

Todas perguntadas e respondidas explicitamente, em duas sessões (a primeira
interrompida por troca de máquina).

| # | Decisão | Alternativas recusadas |
|---|---|---|
| 1 | **Escala não é transporte.** O teto de ~4 participantes fica como está. "Muitas pessoas tranquilamente" significa interface óbvia pra leigo. | SFU; mexer em `mesh.js`/`tree.js`/topologia |
| 2 | **Nova IA + novo visual.** `index.html`, `style.css`, `ui.js` do zero. `app.js` e o resto da lógica ficam. | Repintar o CSS existente |
| 3 | **Sem wizard de primeiro uso.** O lobby se explica sozinho: duas ações grandes, salas da rede em destaque, perfil óbvio. | Onboarding em passos; trazer `tools/testar-radmin.ps1` pra dentro do app |
| 4 | **Layout "A + barra do C".** Lobby em coluna centrada; Sala com palco cheio, coluna à direita, barra de controle rotulada embaixo. | "Discord literal" com rail de servidores (0 ou 1 sala numa LAN — forma sem conteúdo); "palco primeiro" puro (denso demais) |
| 5 | **Chat e membros empilhados na mesma coluna**, os dois sempre visíveis. | Abas Membros \| Chat (a lista tem 4 linhas — não justifica esconder); painel deslizante por cima do palco (tapa o vídeo justo quando se quer comentar o vídeo) |
| 6 | **Parar transmissão é um pedido, não um bloqueio.** A transmissão cai, a pessoa é avisada, e nada impede de compartilhar de novo. Quem abusar, o dono expulsa. | Travar até o dono liberar; travar + expulsão automática por insistência |
| 7 | **Histórico de chat: últimas 50, só em memória.** Entregues no `welcome`, morrem com a sala. | Nada de histórico (queda de conexão vira buraco silencioso); salvar em disco (vira dado pessoal num app que hoje não guarda nada) |
| 8 | **Avatar no chat em calha de 28px**, estilo Discord, só na primeira mensagem do grupo. | Avatar de 18px na linha do nome (cabe 20% mais texto, mas varredura mais lenta) |
| 9 | **Os quatro sons novos entram**, com interruptor único. | Subconjunto |

## 3. Restrições inegociáveis

**Nada de `backdrop-filter` / vidro fosco.** Não é gosto, é físico: blur é
trabalho contínuo de GPU por camada, na mesma GPU que o encoder de vídeo
(NVENC/AMF/QuickSync) e o jogo de quem transmite disputam. Um visual "Discord
glassy" custaria exatamente o recurso que a spec de performance de 2026-08-23
tenta liberar. Elevação se faz por luminosidade sólida; borda, por alpha.

**Pelo mesmo motivo, só `transform` e `opacity` são animados.** As duas rodam
no compositor sem repintar camada. Nada de animar `width`, `height`, `top`,
`box-shadow` ou `filter`.

**`app.js` não é refatorado.** Ganha handlers novos; não perde os que tem. A
extração de um módulo de orquestração (item D1 da auditoria) segue fora de
escopo.

## 4. Sistema visual

### 4.1 A regra que organiza o tema

O sistema atual reserva o acento a uma coisa só (alguém ao vivo) e distingue
botão primário, aba ativa e seleção por elevação, não por cor. Elegante pra
quem conhece o app, ilegível pra quem abre pela primeira vez: "Criar sala" e
"Compartilhar tela" ficam cinza sobre cinza, iguais a "Cancelar". **O redesign
inverte a regra:** cor marca ação, e o vermelho fica reservado a ao vivo.

| Papel | Token | Onde aparece |
|---|---|---|
| **Ação** | `--act: #4F46E5` | Criar sala, Conectar, Compartilhar tela, Ir ao vivo |
| **Ao vivo** | `--live: #FF4D4F` | ponto do cabeçalho, selo AO VIVO, anel pulsante, borda do tile |
| **Atenção** | `--warn: #F5B544` | reconectando, qualidade baixada, firewall não liberado |
| **Destrutivo** | `--danger: #C92A33` | só o preenchimento do botão de confirmar banimento |

Vermelho pra "ao vivo" e não pra "perigo" é deliberado: é o símbolo de gravação
que qualquer pessoa lê, e o app quase não tem ação destrutiva ("Desconectar" é
reversível e vira "Sair da sala", botão neutro).

**`--danger` existe porque a regra se contradizia.** Na primeira versão do
mockup o botão "Banir" foi pintado com `--live`, o que gastava o acento de ao
vivo numa ação destrutiva — e ainda reprovava em contraste (3,27 com branco).
Dois tons resolvem os dois problemas: vermelho vivo é transmissão, vermelho
fundo é destruição, e ele nunca aparece como acento, só como preenchimento de
botão dentro de um diálogo de confirmação.

Nenhum estado depende só de cor: o selo ao vivo sempre traz ícone e palavra.

### 4.2 Superfícies e texto

```
--bg:  #0E0F13   fundo da janela
--s1:  #16181D   painel, cartão, coluna
--s2:  #1D2026   menu, campo de entrada
--s3:  #262A32   botão secundário, chip
--s4:  #323742   avatar vazio, hover de botão secundário
--line:  rgba(255,255,255,.08)
--line2: rgba(255,255,255,.14)

--tx:  #E8EAED   texto principal
--tx2: #9AA0AA   secundário
--tx3: #868D9B   rótulo 10-11px, hora, dica
```

### 4.3 Contraste verificado

Calculado, não estimado. Todos os pares em uso, contra a superfície onde de
fato aparecem:

| Par | Ratio | AA |
|---|---|---|
| `--tx` sobre `--bg` | 15,89 | ✓ |
| `--tx` sobre `--s1` | 14,73 | ✓ |
| `--tx` sobre `--s3` | 11,94 | ✓ |
| corpo do chat `#D3D7DD` sobre `--s1` | 12,29 | ✓ |
| `--tx2` sobre `--s1` | 6,75 | ✓ |
| `--tx3` sobre `--s1` | 5,33 | ✓ |
| `--tx3` sobre `--s2` (menu) | 4,89 | ✓ |
| `--warn` sobre `--s1` | 9,79 | ✓ |
| `--live` sobre `--s1` | 5,43 | ✓ |
| branco sobre `--act` | 6,29 | ✓ |
| branco sobre `--danger` | 5,44 | ✓ |

Duas correções nasceram desse cálculo: `--tx3` era `#6B7280` (3,67 — reprovava
nas duas superfícies onde é usado) e o botão destrutivo era `--live` (3,27).
**Qualquer token novo entra por este mesmo cálculo, não por olho.**

### 4.4 Tipografia e densidade

Inter em toda a interface. Escala: 20px título de tela · 15px título de seção ·
13px corpo, mensagem, nome de membro · 11px rótulo, hora, apoio.

Densidade é resolvida **por superfície**, porque "denso" e "óbvio pra leigo" se
contradizem e a spec precisa escolher onde cada um vale:

- **Generoso** onde qualquer pessoa age: alvo 44px, raio 10px, gap 10px, rótulo
  em texto em todo botão.
- **Denso** onde é leitura de especialista: tabela de estatísticas em 12px com
  `font-variant-numeric: tabular-nums`, linha de 28px, gap 8px. É a única
  exceção aos 44px, e mora atrás de Configurações.

### 4.5 Botões

Altura 44px em todos. **Uma primária colorida por tela, nunca duas.**

| Variante | Fundo | Texto | Uso |
|---|---|---|---|
| primária | `--act` (hover `#6257EB`) | branco | a ação da tela |
| secundária | `--s3`, borda `--line2` | `--tx` | ações de igual peso |
| discreta | transparente, borda `--line2` | `--tx2` | Cancelar, Sair da sala |
| desabilitada | `--s2` | `--tx3` | `cursor: not-allowed` |
| destrutiva | `--danger` | branco | só confirmar banimento |

Foco: `outline: 2px solid var(--act); outline-offset: 2px`. Nunca
`outline: none` sem substituto.

## 5. As duas telas

### 5.1 Lobby (fora de sala)

```
┌──────────────────────────────────────────────────────┐
│  GoLive LAN                                 ↻  ⚙     │
│                                                        │
│         ┌────────────────┐  ┌────────────────┐       │
│         │  ▣ Criar sala  │  │  ⇥ Entrar numa │       │  ← índigo cheio
│         │                │  │     sala       │       │     e contorno
│         └────────────────┘  └────────────────┘       │
│                                                        │
│  Salas abertas na sua rede                    ↻       │
│  ┌────────────────────────────────────────────────┐  │
│  │ ●  Sala do João        2 pessoas    [Entrar]   │  │
│  ├────────────────────────────────────────────────┤  │
│  │ 🔒 Sala da Ana         3 pessoas    [Entrar]   │  │
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────┐    │
│  │ ◯  Nicolas                              ⚙    │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### 5.2 Sala (dentro de sala)

Palco toma tudo; coluna direita com **membros em cima e chat embaixo**, os dois
sempre visíveis; barra de controle rotulada embaixo. A coluna inteira recolhe
num botão do cabeçalho, pra quem quiser o palco na largura total.

```
┌──────────────────────────────────────────┬────────────────┐
│ ● Sala do Nicolas  26.7.1.3:9000 [Copiar]│ NA SALA · 4    │
│   🔒 PIN 4821                        [»] ├────────────────┤
├──────────────────────────────────────────┤ ◯ Nicolas você♛│
│ ⚠ A porta não está liberada no firewall  │ ◉ João  ●AO VIVO⋮│
│   [Permitir acesso à rede]               │ ◯ Ana         ⋮│
├──────────────────────────────────────────┤ ◯ Pedro       ⋮│
│                                           ├────────────────┤
│            [   vídeo do João   ]          │ BANIDOS · 1    │
│                                           │ ◯ Lucas [Read.]│
│                                           ├────────────────┤
│                                           │ CHAT           │
│                                           │ ◯ João   21:04 │
│                                           │   tá travando? │
│                                           │ ◯ Ana    21:05 │
│                                           │   tá liso aqui │
├──────────────────────────────────────────┤ ⊘ Nicolas baniu│
│ [▣ Compartilhar tela] [🎥 Câmera]        │   Lucas        │
│ [⏸ Pausar]              [Sair da sala]   │ [Escreva…    ] │
└──────────────────────────────────────────┴────────────────┘
```

A seção "Banidos" só existe quando a lista não está vazia, e só o dono a vê.

Coração da mudança na barra inferior: **rótulo em texto em todo botão**, alvo
≥44px, ação primária como única colorida. Hoje esses quatro controles são
ícones de 20px sem rótulo, empilhados no canto junto do avatar do usuário.

## 6. Mapa de continuidade — nada sai, tudo tem endereço novo

| Hoje | Depois |
|---|---|
| Lista "Ao vivo agora" na coluna esquerda | Cartões de sala no Lobby: nome, nº de pessoas, cadeado, "Entrar", estado de cooldown |
| Botão atualizar descoberta | ↻ no cabeçalho da seção de salas |
| "Criar sala" (ghost pequeno) | Ação primária do Lobby |
| Checkbox "Proteger com PIN" solto entre botões | Dentro do fluxo de Criar sala |
| "Entrar por endereço" + form inline | Diálogo "Entrar numa sala", rótulo visível por campo (hoje é placeholder-only), campo de PIN só quando a sala pede |
| Painel de usuário (avatar, nome, 4 ícones) | Lobby: cartão de perfil + ⚙. Sala: câmera/pausar/compartilhar vão pra barra de controle rotulada |
| Cabeçalho do palco | Cabeçalho da Sala; "Desconectar" vira "Sair da sala" e desce pra barra |
| `stage-warning` do firewall | Faixa âmbar abaixo do cabeçalho, mesma posição, mesmo botão de retry |
| Grid de tiles, avatar, badge, rótulo, overlay de watchers, fullscreen, duplo clique | Idênticos em comportamento, re-vestidos |
| Fullscreen com PiP arrastável, strip, fixar, menu de escolha | Mantido inteiro, sem redesenho de interação |
| Menu de contexto do tile (mute + volume) | Mantido, alvos maiores, alternativa por teclado |
| Lista de membros (borda de estado, AO VIVO com pulso, tag de qualidade) | Topo da coluna direita; ganha coroa do dono e ⋮ de moderação |
| Diálogo de compartilhar (abas, dica, grade, preset, banda, som, som do Discord) | Mantido inteiro, re-desenhado; preset ganha rótulo humano além do técnico |
| Configurações: Perfil / Voz e Vídeo / Rede / Estatísticas | Mantidas as 4 abas e todo o conteúdo; "Voz e Vídeo" ganha o interruptor de sons |
| Painel de estatísticas | Mantido; números tabulares; resumo de uma linha no topo |
| Banner de atualização, toast, `Ctrl+Alt+P` | Globais, inalterados |

O status derivado (`offline / reconnecting / degraded / paused / live / idle`)
continua vindo de `src/renderer/status.js` **sem mudança de lógica** — muda
como é pintado, e mudam os rótulos de motivo (§12).

## 7. Chat

### 7.1 Comportamento

- Mensagens do mesmo autor em sequência se agrupam: cabeçalho (avatar, nome,
  hora) só na primeira; as seguintes alinham com o texto.
- Avatar em calha de 28px à esquerda. Reusa o avatar que já viaja no `join` —
  **nenhum byte novo na rede**. Sem foto, cai pra inicial sobre `--s4`, igual à
  lista de membros hoje.
- Mensagem de histórico de quem já saiu da sala não tem avatar pra buscar e cai
  pra inicial. Aceito.
- Compose: `textarea`, Enter envia, Shift+Enter quebra linha, contador aparece
  ao passar de 400 caracteres, teto 500.
- **Com a sinalização caída o compose desabilita** e aparece a faixa âmbar
  "Reconectando — o que você escrever agora não vai sair", em vez de fingir que
  enviou. Ao voltar, as últimas 50 chegam no `welcome` e o buraco se fecha.
- Entrada, saída e toda ação de moderação viram **linha de sistema** no fluxo,
  visível pra sala inteira.

### 7.2 Por que a transparência

Moderação silenciosa entre amigos é mais estranha que moderação transparente:
sem a linha, alguém simplesmente some e ninguém sabe se caiu ou foi expulso.
As linhas entram no log de 50 junto com as mensagens.

## 8. Moderação

### 8.1 Quem pode

Só o dono da sala — quem a criou. Não há transferência de dono: quando o host
sai, a sala morre (item F3 da auditoria, "confirmado, por desenho"), então não
existe o estado "sala sem dono".

### 8.2 O menu ⋮

Aparece na linha de cada membro que não é você. **O conteúdo depende de quem
você é:**

| Item | Dono | Não-dono |
|---|---|---|
| Silenciar (já existe hoje no menu do tile) | ✓ | ✓ |
| Parar transmissão | ✓ | — |
| Expulsar da sala | ✓ | — |
| Banir da sala | ✓ | — |

Quem não é dono vê só "Silenciar". Item desabilitado não aparece: menu que
mostra ação bloqueada só ensina o que a pessoa não pode fazer.

Rodapé do menu do dono, em 10px: *"Expulso pode voltar. Banido não, enquanto a
sala existir."*

### 8.3 O que cada poder faz

**Parar transmissão.** A transmissão do alvo cai e ele recebe o aviso. **Nada
impede de compartilhar de novo** — é um pedido (decisão 6). Escalada é
expulsar.

**Expulsar.** Sai agora, volta quando quiser. **Não pede confirmação:** é
reversível em dois cliques, e diálogo em toda expulsão treina o dedo a clicar
"Sim" sem ler.

**Banir.** Sai agora e não entra de novo enquanto a sala existir. **Pede
confirmação**, porque fecha a porta — com o foco indo pro "Cancelar", não pro
botão destrutivo. Ainda assim tem volta: a seção "Banidos" lista quem foi, com
"Readmitir", pra um clique errado não ser definitivo.

### 8.4 Duas limitações honestas

**Parar transmissão é cooperativo.** A mídia é P2P direta; o host não tem como
cortar o fluxo. O comando só funciona porque o cliente do alvo obedece. Cliente
modificado ignora.

**O ban é contornável.** Ver §9.3 pelo que o identifica. Quem editar o cliente
passa.

As duas são aceitas conscientemente: o modelo de ameaça é amigo chato, não
invasor — o mesmo que já justifica o PIN de 4 dígitos ser "não é cripto, só
corta o entrar-por-acidente".

## 9. Protocolo de sinalização

Hoje o `signaling-core.js` não tem noção de dono: todo peer é igual e
`nextId++` é a única identidade. Tudo nesta seção é novo.

### 9.1 Identidade do dono

`room:host` no `main.js` gera um `ownerToken` (`crypto.randomUUID()`) junto com
o PIN, passa pro `createSignalingServer({ port, pin, ownerToken })` e devolve
pro renderer do host, que o manda no `join`. **O token nunca sai da máquina** —
vai do renderer pro `127.0.0.1` e nunca é retransmitido a ninguém.

O servidor marca `peer.owner = true` quando o token confere. `welcome` e
`peer-joined` passam a carregar `owner` por peer — é isso que desenha a coroa e
decide qual menu ⋮ o cliente monta.

*Alternativa recusada:* identificar o dono por `remoteAddress` ser loopback.
Mais simples e sem plumbing, mas duas instâncias do GoLive na mesma máquina
fariam a segunda virar dona também — e não dá pra testar sem subir socket,
enquanto o token testa direto no core.

### 9.2 Mensagens novas

**Cliente → servidor**

```jsonc
{ "type": "chat", "text": "..." }
{ "type": "moderate", "action": "stop-share|kick|ban|unban", "target": "<peerId|banKey>" }
```

**Servidor → cliente**

```jsonc
// eco de chat, pra sala INTEIRA, inclusive quem mandou
{ "type": "chat", "id": "...", "from": "<peerId>", "name": "...", "text": "...", "ts": 0 }

// linha de sistema
{ "type": "chat", "system": true, "event": "join|leave|kick|ban|unban|stop-share",
  "actor": "<nome>", "target": "<nome>", "ts": 0 }

// só pro alvo da ação
{ "type": "moderated", "action": "stop-share|kick|ban", "by": "<nome do dono>" }

// só pro dono, quando a lista muda
{ "type": "banned-list", "list": [ { "key": "...", "name": "..." } ] }

// recusa de entrada, reusando o canal do PIN
{ "type": "join-denied", "reason": "pin|banned" }
```

`welcome` cresce: passa a carregar `chat` (as últimas 50) e `owner` em cada
descritor de peer.

### 9.3 Regras do servidor

- **`moderate` de quem não é dono é ignorado em silêncio.** A autorização é do
  servidor, nunca do cliente. É o teste mais importante do conjunto.
- `chat`: `text` tem que ser string; corta em 500; descarta vazio depois do
  trim; o servidor carimba `id`, `from`, `name` e `ts` — o cliente não escolhe
  nenhum dos quatro.
- **Ecoa pro remetente também**, pra que a ordem tenha uma fonte só em vez de
  cada cliente inventar a sua.
- Log circular de 50 (mensagens e linhas de sistema juntas), em memória, morre
  com a sala.
- **Limitador próprio de chat: 5 msg/s por peer**, reusando o
  `createRateLimiter` que já existe. O global de 300/s foi dimensionado pra
  rajada de ICE e é folgado demais pra texto.
- `kick` e `ban`: avisam o alvo, fecham com `close(1008)`, emitem a linha de
  sistema.
- **Chave de ban: IP normalizado (sem o prefixo `::ffff:`) + `clientId`.** Os
  dois juntos porque o IP sozinho falha se o Radmin trocar o endereço, e o
  `clientId` sozinho cai com um editor de texto no `config.json`. Guardada em
  memória, morre com a sala — é "banir da sala atual".
- **Endereço de loopback nunca entra na lista de IPs banidos.** O cliente do
  próprio dono conecta em `127.0.0.1`: banir alguém que também veio de loopback
  (segunda instância na mesma máquina, ou um túnel) gravaria o endereço do dono
  e o **recusaria no próprio reconnect**. Peer vindo de loopback é banido só
  pelo `clientId`.
- **`moderate` cujo alvo é o dono é ignorado**, qualquer que seja a ação. Sem
  isso, um bug de UI que mandasse o id errado poderia expulsar o host — e a
  sala morre com ele.
- `join` de quem bate em qualquer uma das duas chaves recebe
  `join-denied: banned` e `close(1008)`.
- O cálculo da chave sai numa função pura exportada (`banKeyFor({ address,
  clientId })`), pra ser testável sem subir socket.

O `clientId` é um UUID gerado uma vez por instalação, guardado no config e
mandado no `join`.

## 10. Sons

O `sound.js` de hoje sintetiza dois tons com Web Audio — **nenhum arquivo de
áudio**, nenhuma licença, nada a empacotar. Os novos seguem o mesmo molde: onda
senoidal, curtos, volume baixo.

| Momento | Tom | Duração | Ganho |
|---|---|---|---|
| Alguém entrou *(já existe)* | 440 → 660 Hz | 0,12s | 0,15 |
| Alguém saiu *(já existe)* | 660 → 440 Hz | 0,12s | 0,15 |
| **Mensagem nova no chat** | 660 e 880 Hz, dois blips com 70ms de intervalo | 0,05s cada | 0,10 |
| **Alguém começou a transmitir** | 523 → 784 Hz | 0,20s | 0,15 |
| **O dono parou a sua transmissão** | 587 → 392 Hz | 0,22s | 0,16 |
| **Você foi expulso ou banido** | 440 → 220 Hz | 0,34s | 0,18 |

**Três regras valem pra todos:**

1. Interruptor único **"Sons do app"** em Configurações › Voz e Vídeo, ligado
   por padrão. Quem joga de fone desliga tudo de uma vez.
2. **Nada toca por ação sua.** Você não ouve a própria mensagem, e o dono não
   ouve o próprio comando de moderação.
3. **O som de chat só sai com a janela do GoLive fora de foco**, e no máximo uma
   vez a cada 2 segundos. Se você está olhando a coluna, já viu a mensagem
   chegar — o beep viraria ruído.

Os dois últimos da tabela tocam **só pro alvo**; a sala vê a linha no chat, sem
som.

## 11. Contrato do `ui.js`

O `ui.js` é reescrito, mas `app.js` não — então todo ponto de chamada atual
continua valendo. Assinaturas preservadas; crescimento só por objeto de opções
no fim, seguindo o idioma que o módulo já usa (`rooms.render({ onSelect, … })`).

```js
root.GoLive.ui = {
  escapeHtml,
  grid:        { showTile, removeTile, setPainting, setWatchers },  // intacto
  rooms:       { render },                                          // intacto
  stageHeader: { set, clear, setStatus },                           // intacto
  settings:    { open, close, setStatsHtml },                       // intacto
  picker:      { open },                                            // intacto
  members:     { render, renderBanned },                            // render cresce
  chat:        { render, append, setHistory, setEnabled },          // novo
};
```

- `members.render(peers, self, qualityTags)` → `members.render(peers, self,
  qualityTags, { ownerId, myId, onModerate })`. Quarto argumento **opcional**:
  as chamadas antigas seguem válidas enquanto a nova passa o objeto. Menor diff
  possível em `app.js`.
- `members.renderBanned(list, { onUnban })` — a seção só é desenhada quando
  `list` não está vazia, e só pro dono.
- `chat.render({ onSend })` monta o painel e registra o envio, seguindo a forma
  de `rooms.render`. **Uma única maneira de fazer cada coisa:**
  `setHistory(msgs)` substitui a lista inteira (chegada do `welcome`),
  `append(msg)` acrescenta uma, `setEnabled(bool)` liga e desliga o compose na
  queda da sinalização. `render` não recebe mensagens.

## 12. Rótulos de degradação

`REASON_LABELS` em `src/renderer/status.js`, reescritos pra linguagem de
usuário. A lógica de precedência em `degradeReason` **não muda**.

| Hoje | Passa a ser |
|---|---|
| `encoder em software` | **sem aceleração de vídeo** |
| `sem retransmissor` | **muita gente recebendo de você** |
| `máquina no limite` | **seu PC no limite** |
| `sala cheia` | **sala cheia** |

O primeiro casa com uma condição real e já observada: máquinas de amigos rodando
Chromium sem aceleração, caindo pro OpenH264 — investigação aberta desde a
0.3.3.

Os cabeçalhos da tabela de estatísticas em `renderStats` ("encode", "rtt",
"perda rede") ganham forma por extenso, mas seguem em vocabulário técnico: a
aba Estatísticas é a superfície de especialista da §4.4.

## 13. Motion

Fora `--ease-enter`, `--ease-move`, `--ease-drawer`. Entram:

```
--dur-fast:   120ms   hover, foco, mudança de cor
--dur-base:   180ms   menu abrindo, mensagem entrando
--dur-slow:   240ms   modal, coluna recolhendo
--ease-out:    cubic-bezier(.2,.8,.3,1)    entrada
--ease-in-out: cubic-bezier(.4,0,.2,1)     movimento
```

- Só `transform` e `opacity` (§3).
- Mensagem nova entra com fade + 2px de deslocamento, 120ms. Sem slide, sem
  bounce.
- **O anel pulsante do ao vivo continua sendo o único movimento em laço da
  interface** — o `ui.js` atual já garante isso escolhendo um só pulso por vez,
  e o comentário que explica o porquê é preservado na reescrita.
- `prefers-reduced-motion: reduce` zera todas as durações, replicando o que o
  CSS atual já faz.

## 14. Acessibilidade

- **Menu ⋮** — a única armadilha de teclado nova. `role="menu"`, itens
  `role="menuitem"`, setas navegam, Escape fecha **e devolve o foco ao ⋮**.
- **Diálogo de banir** — `role="dialog" aria-modal="true"`, foco inicial no
  **Cancelar**, Escape cancela.
- **Chat** — lista com `role="log" aria-live="polite"`; compose é `textarea`
  com `<label>` visualmente oculto.
- `aria-label` em todo botão só-ícone que sobrar (↻ da descoberta, ⋮ do membro,
  × dos modais).
- Foco visível em tudo: `outline: 2px solid var(--act); outline-offset: 2px`.
- Alvo ≥44px em tudo, exceto a tabela de estatísticas (§4.4).
- Cor nunca é o único indicador: ao vivo tem ícone e palavra; degradado tem
  texto de motivo.

## 15. Plano de teste

### 15.1 Correção a uma afirmação anterior

A Parte 1 do brainstorm afirmava que "os 266 testes continuam passando sem
alteração — nenhum deles testa DOM/CSS". **A segunda metade é verdadeira; a
primeira não.** `src/renderer/status.test.js` tem `'sala cheia'` cravado em
quatro asserts (linhas 45, 52, 79, 83). Não é DOM: é string de usuário testada
por igualdade, e a reescrita da §12 quebra os quatro. Eles são atualizados
junto.

### 15.2 Testes novos — `server/signaling-core.test.js`

O arquivo **não** é de unidade pura: ele sobe servidor real com `port: 0` e
clientes `ws` de verdade contra `127.0.0.1`. Os testes novos seguem esse
padrão, com uma consequência que muda o desenho de dois deles: **todo cliente
de teste vem de loopback**, então "banir por IP" não é observável ali — por
isso a regra de loopback da §9.3 e a função pura `banKeyFor`.

1. **`moderate` de quem não é dono é ignorado** — o mais importante.
2. **`moderate` cujo alvo é o dono é ignorado.**
3. Token certo marca dono; ausente ou errado, não marca.
4. `banKeyFor` (pura, sem socket): endereço comum gera chave de IP + chave de
   `clientId`; endereço de loopback gera **só** a de `clientId`.
5. Ponta a ponta: banido não reentra na mesma sala (pelo `clientId`, que é o
   que loopback permite observar), e recebe `join-denied: banned`.
6. `unban` readmite.
7. Chat corta em 500, descarta não-string, respeita 5 msg/s.
8. Log de 50 é circular e chega no `welcome`.
9. `kick` fecha com 1008 e emite a linha de sistema.
10. Chat e moderação de quem nunca mandou `join` são descartados.

### 15.3 O que não tem harness

CSS, layout, foco e som só se validam com o app rodando. O `STATUS.md` já
registra "sem rodar o app à mão" como dívida a não repetir, então o plano de
implementação carrega uma **checklist manual explícita** — não uma intenção:

- [ ] `npm start`, criar sala, conferir a coroa no dono e o ⋮ certo pros dois papéis
- [ ] Segunda instância entra; testar parar transmissão, expulsar, banir, readmitir
- [ ] Chat: agrupamento, avatar, linha de sistema, contador, Enter vs Shift+Enter
- [ ] Derrubar a sinalização com o chat aberto: compose desabilita e a faixa aparece
- [ ] Reconectar: as 50 chegam e o buraco fecha
- [ ] Os quatro sons, e o interruptor cortando todos
- [ ] Percorrer a Sala inteira só de teclado, incluindo o menu ⋮ e o diálogo
- [ ] `prefers-reduced-motion` ligado no Windows: nada anima
- [ ] Fullscreen + PiP arrastável seguem funcionando (não foram redesenhados)

## 16. Arquivos tocados

| Arquivo | O que muda |
|---|---|
| `server/signaling-core.js` | dono, chat + log de 50, moderação, lista de ban, limitador de chat |
| `server/signaling-core.test.js` | os 8 testes da §15.2 |
| `src/main.js` | gera e devolve o `ownerToken` no `room:host` |
| `src/renderer/config.js` | `clientId` persistente + preferência "Sons do app" |
| `src/renderer/app.js` | manda token e `clientId` no `join`; trata `chat`, `moderated`, `banned-list`, `join-denied: banned` |
| `src/renderer/sound.js` | os quatro sons novos + o interruptor |
| `src/renderer/status.js` | `REASON_LABELS` (§12) |
| `src/renderer/status.test.js` | os quatro asserts da §15.1 |
| `src/renderer/index.html` | reescrito |
| `src/renderer/style.css` | reescrito |
| `src/renderer/ui.js` | reescrito, contrato da §11 |

**A decisão 2 ("só renderer") cede aqui, e de propósito:** chat e moderação não
existem sem servidor. `app.js` continua sem refatoração.

## 17. Fora de escopo

- Transferência de dono (§8.1 — a sala morre com o host, por desenho).
- Ban que sobrevive à sala, ou lista de ban em disco.
- Histórico de chat em disco.
- Anexo, imagem, emoji picker, edição ou apagamento de mensagem.
- Chat privado entre dois membros.
- Menção com notificação, `@`.
- Qualquer mudança em `mesh.js`, `tree.js`, `autoquality.js` ou topologia.
- Extração de módulo de `app.js` (D1 da auditoria).
- Subir Electron 32 → 44 (B1), assinatura de código (B6).

## 18. Riscos

| Risco | Mitigação |
|---|---|
| Reescrever `ui.js` inteiro quebra um ponto de chamada de `app.js` que ninguém lembrava | O contrato da §11 preserva assinatura por assinatura; a checklist da §15.3 percorre a Sala inteira |
| Chat na mesma conexão da sinalização competindo com ICE | Teto de 500 caracteres e 5 msg/s por peer; a rajada real de ICE (~115 frames) segue com folga dentro dos 300/s |
| Som virando irritação durante o jogo | Interruptor único, nada por ação própria, chat só fora de foco e no máximo 1 a cada 2s |
| Moderação parecer garantia de segurança | As duas limitações estão escritas na §8.4 e devem aparecer no texto da interface, não só aqui |
| Ban por IP acertar o próprio dono (loopback) | Regra explícita na §9.3 e teste 4 da §15.2 |
