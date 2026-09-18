# Auditoria — Time 3: Rede, WebRTC, Mídia e Desempenho

Base: `main` em `b20cb17` (0.16.0). `npm test` nesta máquina: 727 passando,
1 falhando — `src/main/logger.test.js`, que só falha porque o binário do
Electron não está instalado no sandbox (`Electron failed to install
correctly`). Não é defeito de código.

## Resumo executivo

A camada de rede está bem melhor do que a auditoria de agosto descreve. O H1
foi feito de verdade (a sessão vira órfã e o vídeo sobrevive à queda da
sinalização), o H2/H3/H4 também, e o servidor de sinalização é hoje um dos
arquivos mais bem defendidos do projeto: teto de payload, limitador por tipo
de mensagem, `from` carimbado, reconstrução campo a campo, checagem de sala.
O que sobrou não é falta de defesa — é falta de **fechamento de laço** na
árvore de retransmissão.

As três coisas que mais arriscam quebrar uma noite de uso:

1. **Se o link relay→folha cai, ninguém o reconstrói.** Nem o relay, nem a
   origem, nem a folha. A tela some pra aquela pessoa e só volta se ela sair
   e entrar — exatamente a reclamação que o hotfix de 12/09 tentou matar,
   pelo único caminho que o detector dele não enxerga. **P0.**
2. **Duas pessoas transmitindo ao mesmo tempo elegem o MESMO relay.**
   Reproduzido deterministicamente: 4 encoders e 2 decoders numa máquina só,
   enquanto a outra fica ociosa. É o problema que a árvore existe pra
   resolver, mudado de lugar. **P1.**
3. **A migração de sala depende de broadcast UDP e de todo mundo desistir no
   mesmo minuto.** No Tailscale (que o próprio README recomenda) não há
   broadcast: cada sobrevivente vira host da sua própria sala com o mesmo
   `roomId`. **P1.**

## Tabela do protocolo de sinalização

`server/signaling-core.js`. "Valida formato" = o servidor reconstrói ou
checa os campos; "Valida direito" = confere se o remetente podia mandar
aquilo.

### Cliente → servidor

| Msg | Quem manda | Quem recebe | Payload | Valida formato | Valida direito | Limite |
|---|---|---|---|---|---|---|
| `join` :681 | qualquer socket | servidor | `room,name,avatar,pin,clientId,ownerToken,resumeToken,appVersion` | sim (corta 40/40/256KB/100) | ban → versão → PIN → token; `joined` impede 2º join | só o global 300/s |
| `moderate` :799 | dono | servidor | `action,target` | parcial (`String(msg.target)`) | **sim** — `!me.owner` → ignora; auto-moderação barrada | global |
| `offer` :874 | peer | peer (`to`) | `to,sdp,kind,renegotiate` + **o que mais vier** | **não** — `{...msg}` repassa tudo | destino existe e na mesma sala | global |
| `answer` :874 | peer | peer | `to,sdp,kind` + extras | **não** | idem | global |
| `ice` :874 | peer | peer | `to,dir,kind,candidate` + extras | **não** | idem | global |
| `view-state` :874 | peer | peer | `to,kind,watching,looking,encodeHealth,receiveHealth` + extras | **não** (o cliente normaliza) | idem | global |
| `tree` :874 | origem | peer | `to,kind,origem,paiId,filhos,epoch` + extras | **não** | só "está na sala" — **não confere se é origem** | global |
| `reoffer` :890 | peer | peer | `to,kind` | **sim** — regex de id e de kind, reconstrói | destino e `sourceId` na sala | **2/s** por peer |
| `chat` :912 | peer | sala | `text,image,w,h` | sim (500 ch, data URL de imagem, 200KB, dims) | precisa ter dado join | **5/s**, imagens **3/5s** |
| `annotate` :956 | peer | sala | `surface,op,id,x,y,points,width,text,size,color` | **sim** — `sanitizeAnnotateOp` | dono da superfície tem de estar na sala | **60/s** |
| `laser` :974 | peer | sala | `surface,x,y` | sim — `parseSurface` estrito + `normPoint` | idem | **30/s** |
| `reaction` :990 | peer | sala | `surface,emoji` | sim — lista fechada de 6 emojis | idem | rajada 5, 1/300ms |
| `annotate-sync` :1009 | peer | peer | `to,surface,items[]` | **NÃO** — só corta a lista em 400; item e `surface` passam crus | destino na mesma sala | **nenhum** próprio |
| `broadcast-state` :1023 | peer | sala | `live,paused,annotate,bootstrap` | sim — reconstrói, `Boolean`/`=== true` | join prévio | **nenhum** próprio |
| `camera-state` :1059 | peer | sala | `on,annotate` | sim — reconstrói | join prévio | **nenhum** próprio |
| `watchers` :1076 | peer | sala | `kind,origin,watchers[]` | sim — refaz cada item pela tabela de peers, corta 64/64ch | join prévio; `origin` é **aceito como veio** | **20/s** |

### Servidor → cliente

| Msg | Gatilho | Payload |
|---|---|---|
| `welcome` :766/:785 | `join` aceito | `id,owner,peers[{id,name,avatar,owner}],chat[],banned[],resumeToken,resumed?,roomId,hostId` |
| `join-denied` :694/:705/:715 | ban / versão / PIN | `reason`, + `hostVersion,yourVersion` no caso `version` |
| `peer-joined` :791 | join novo | `id,name,avatar,owner` |
| `peer-left` :588 | `removePeer` | `id` |
| `peer-resumed` :774 | retomada com token | `id` |
| `owner-changed` :505 | transfer / reclaim | `id,name` (nulos = sala sem dono) |
| `banned-list` :493/:512 | ban/unban/troca de dono | `list[]` (vazia pra quem não é dono) |
| `moderated` :835/:840 | dono agiu sobre você | `action,by` |
| `chat` (eco/sistema) :938/:417 | chat ou evento de sala | `id,from,name,text,ts,image,w,h` / `system,event,actor,target,ts` |
| `room-closed` :1187 | `close()` | — (seguido de close 1001 `host-left`) |
| `room-migrating` :1174 | `close({migrate:true})` | `roomId,successor,successorName,newOwnerClientId,pin,bans[],chat[]` |
| roteadas | — | `offer/answer/ice/view-state/tree/reoffer/annotate-sync` com `from` carimbado |
| broadcast | — | `annotate/laser/reaction/broadcast-state/camera-state/watchers` com `from`/`id` carimbados |

### Fora do WebSocket: beacons UDP (`src/main/discovery.js`)

| Msg | Porta | Payload | Autenticação |
|---|---|---|---|
| `golive-room` :62 | 41235 broadcast | `name,port,address,peers,protected,version` | **nenhuma** |
| `golive-room-migrate` :108 | 41235 broadcast | `roomId,address,port,protected` | **nenhuma** (só o `roomId`, que todo ex-membro conhece) |

### O que um cliente hostil ou bugado consegue, medido

Mensagem malformada: coberto. JSON que não é objeto é descartado
(`:678`, com teste), frame acima de 512 KB fecha o socket (`:19`),
mensagem antes do `join` é ignorada em todos os handlers, e há um teste de
fuzz (`signaling-core.test.js:605`). Não achei um caminho que derrube o
processo do host por frame torto.

O que consegui provar (probe em `/tmp/.../scratchpad/`, servidor num
processo separado pra medir só a CPU dele):

- **`annotate-sync` a 478 KB × 27/s (= 12,6 MB/s, o que cabe em 100 Mbps):**
  9% de um núcleo no host, maior travada do event loop 20 ms. Extrapolando
  linearmente, encher 1 Gbps daria ~90% de um núcleo. Ou seja: é limitado
  pela banda do atacante, **não é o matador que parece**. Na VPN é ruído.
- **60 sockets com avatar de 256 KB:** 4,2 s de CPU do host em 4,5 s
  (~93% de um núcleo), RSS 141 MB, travada de 122 ms no loop, e o **61º
  `join` sozinho custa 141 ms de CPU** do host. O custo é O(N²): cada
  `welcome` carrega os avatares de todo mundo e cada `peer-joined` replica
  256 KB pra sala inteira.
- **400 sockets sem avatar:** entram todos, sem teto nenhum. 88 MB de RSS.
  Não existe limite de conexões nem por IP nem no total.
- **Sala legítima de 6 com avatares + 1 cliente reentrando 27× em 3 s:**
  15,5 ms de CPU do host por reentrada. No backoff real (1–15 s) isso é
  nada; num flap rápido, 13% de um núcleo.
- **Se passar por outra pessoa:** sim, mas não pela sinalização — ver o
  achado R5 (`kind` composto forjado).

## Achados

### R1. O link relay→folha que cai não é reconstruído por ninguém

`src/renderer/app.js:1931-1944` · `src/renderer/app.js:4487-4545`

Os dois ramos de recuperação de `onPeerState` exigem `!sourceId`:

```js
if (failed && dir === 'out' && !sourceId && ... role === 'relay') recoverFromRelayLoss(...)
else if (failed && dir === 'out' && !sourceId && ...) { closeOut; offerOwnStreamTo }
```

Uma conexão de repasse usa kind **composto** (`screen@<origem>`), então
`sourceId` existe e **nenhum dos dois ramos roda**. O filho continua dentro
de `state.relayed` (`app.js:4530`), e `flushPendingRelay` pula quem já está
lá (`:4520`). `state.relayed` só é esvaziado em três lugares: um `tree` que
tira o filho da lista (`:3097`), `dropRelaysOf` — que só dispara quando a
stream **de entrada** da origem morre (`:1918`) — e a própria tentativa de
repasse falhando (`:4538`).

Do lado da folha não há socorro: `reportFailure` (`mesh.js:347-361`) não
zera `peer.inConns[kind]`, então `receivingFrom()` continua listando a
conexão morta, mas o tile já foi removido e `ui.grid.framesShown` devolve
`null` pra tile ausente (`ui.js`, `framesShown`) — o `stallwatch` deleta a
chave e nunca pede `reoffer` (`stallwatch.js:41-44`, `app.js:2365`).

Resultado: a tela some pra uma pessoa, todo mundo continua bem, e não há
nenhum evento que traga ela de volta. A origem sequer percebe: ela só saberia
pelo `watchers`, que o relay para de emitir, e o handler de `watchers` só
desenha UI (`app.js:3057`).

**Como reproduzir:** sala de 4, árvore formada (origem → relay → 2 folhas).
Na máquina do relay, bloqueie o tráfego pra UMA das folhas (regra de saída
no Firewall do Windows pro IP Radmin dela) por mais de 15 s
(`DISCONNECT_GRACE_MS`, `mesh.js:22`) e depois libere. A folha perde a tela
para sempre; o olho de espectadores da origem continua contando ela.

**Conserto, em passos:**
1. Em `onPeerState`, ramo novo para `failed && dir === 'out' && sourceId`:
   `myRole[baseKind].get(sourceId)?.relayed.delete(peerId)`,
   `mesh.closeOut(peerId, kind)`, depois
   `flushPendingRelay(activeSession, baseKind, sourceId)`.
2. Contador de tentativas por filho (3, espaçadas) pra uma folha realmente
   inalcançável não virar laço; esgotado, o relay tira o filho de
   `filhosIds` e para de contá-lo no `watchers` — o que faz a origem ver a
   sub-árvore encolher.
3. Em `mesh.reportFailure`, para `dir === 'in'`, zerar `peer.inConns[kind]`
   como `failNegotiation` já faz (`mesh.js:576`). Isso sozinho já faz
   `resume.reofferStillNeeded` voltar a valer pra este caso.
4. No `checkStalledTiles`, tratar "quero assistir X e não existe conexão de
   entrada dele" como gatilho de `reoffer` — hoje só "tile existe e mostra
   0 quadros" dispara.

Custo: 3–4 h (passos 1 e 3 são pequenos; o 4 mexe no `stallwatch`).
Risco: médio — o passo 1 pode virar laço sem o passo 2.
Sem teste: `app.js` não tem harness (D1 da auditoria).
**Prioridade: P0.**

### R2. Duas origens elegem o mesmo relay; uma máquina fica com 4 encoders

`src/renderer/tree.js:96` · `src/renderer/tree.js:126` · `src/renderer/app.js:4640-4668`

`computeTree` exclui candidatos que estão `transmitting` (`peer.live`), mas
**não sabe que um candidato já é relay de outra origem**. Cada origem
calcula a própria árvore, sozinha, sobre o mesmo conjunto de espectadores.
Numa sala de 4 com duas pessoas transmitindo sobram exatamente 2 elegíveis,
e os dois cálculos ordenam por saúde de encode → RTT, que na LAN é quase
simétrico: os dois tendem a escolher o mesmo.

Reproduzido deterministicamente chamando `computeTree` duas vezes:

```
relay eleito por A: C | filhos: [B, D]
relay eleito por B: C | filhos: [A, D]
-> encoders em C: 4 (+ 2 decoders)
```

D fica com zero. C paga 4 encoders de tela + 2 decoders — mais do que a
malha pura cobraria de qualquer um deles.

O sinal que consertaria isso já trafega: `view-state` carrega `encodeHealth`
(`app.js:4358`). Falta a contagem de carga.

**Como reproduzir:** 4 máquinas, duas compartilham tela ao mesmo tempo.
Na terceira, `Configurações > Estatísticas` deve listar **4 linhas
`screen@`**; no log, quatro `[diag] tela->… (repasse de #…)` distintos.

**Conserto:**
1. `view-state` passa a levar `relayLoad` = nº de filhos que este nó já
   serve somando todas as origens (`isRelaying` já varre isso,
   `app.js:443`).
2. `recomputeTree` põe `relayLoad` no candidato (`:4641`).
3. `computeTree` ordena `relayLoad` **antes** de tudo (quem já serve alguém
   vai pro fim), e veta `relayLoad >= FANOUT_RELAY` quando há alternativa —
   mesma forma do veto de encoder em software que já existe (`tree.js:110`).
4. Teste puro em `tree.test.js`: dois `computeTree` sobre o mesmo pool não
   podem devolver o mesmo relay quando há outro elegível com carga 0.

Custo: 2–3 h. Risco: baixo (módulo puro, com testes).
**Prioridade: P1.**

### R3. A migração de sala se parte em N salas quando o beacon UDP não passa

`src/renderer/app.js:1034-1082` · `src/renderer/app.js:1790-1818` ·
`src/main/discovery.js:281-295`

Dois gatilhos de migração: o gracioso (`close({migrate:true})` em
`main.js:477/923/1085`, que manda `room-migrating`) e o de desistência
(`app.js:1790`, depois de `MAX_RECONNECT` ≈ 116 s). O sucessor sobe um
servidor novo e anuncia por **broadcast UDP**, numa janela de 45 s
(`MIGRATION_BEACON_WINDOW_MS`). Quem espera só aceita o beacon se já tiver
`migrationState` preenchido (`:1075`).

Três buracos, todos no mesmo lugar:

- **Tailscale não repassa broadcast.** É L3; `255.255.255.255` e o broadcast
  da interface não chegam a ninguém. O README recomenda o Tailscale
  justamente pra quem tem banda ruim no Radmin — ou seja, o cenário em que a
  migração é mais provável é o cenário em que ela não funciona.
- **Cada cliente desiste no seu próprio tempo.** A escada de backoff é
  independente por máquina (1,2,4,8,15,15,15 s + até 8 s de handshake cada,
  `reconnect.js:13-33`). Quem desiste depois dos 45 s da janela nunca vê o
  beacon, e o `armMigrationWait` dele (`rank × 15 s`) o faz virar host de uma
  **segunda sala com o mesmo `roomId`**.
- **O beacon não é autenticado.** `parseMigrationBeacon` só confere formato;
  o `roomId` chega no `welcome` de todo mundo (`signaling-core.js:770`).
  Quem foi expulso ou banido sabe o `roomId` e pode anunciar a "migração"
  pra própria máquina — e vira dono da sala nova.

De quebra, `rooms.set(beacon.address, …)` (`discovery.js:208`) usa o
endereço **do payload**, não o da origem do datagrama, e `notify()` dispara
a cada pacote: qualquer um na rede virtual injeta salas falsas na lista de
todo mundo e força um re-render por pacote.

**Como reproduzir (o caso do split):** 3 máquinas no Tailscale, uma
hospedando. Mate o processo do host (Gerenciador de Tarefas — assim não há
`room-migrating`). Passados ~2 min, as duas sobreviventes desistem; a de id
menor vira host e anuncia; a outra, por não receber o beacon, vira host
também. Duas salas, mesmo `roomId`, ninguém junto.

**Conserto:**
1. Não depender só do UDP: o sucessor já conhece o endereço de todos os
   peers vivos (`peer.address` só existe no servidor, mas o cliente tem o
   `roomId` e o endereço de quem ele conhece) — o caminho barato é o
   sucessor **continuar anunciando enquanto houver gente faltando** e os
   demais tentarem o endereço do sucessor **diretamente** por WebSocket
   assim que souberem quem ele é (o `successor` vem no `room-migrating`;
   no caminho de desistência é calculável localmente por
   `chooseSuccessor`).
2. Alinhar os relógios: o `armMigrationWait` já escalona por rank; falta
   ancorar o rank-0 num prazo absoluto desde a queda, não desde a
   desistência individual.
3. Assinar o beacon de migração com um segredo que só quem estava na sala
   viva conhece — o `resumeToken` não serve (é por peer); o mais simples é
   o servidor passar um `migrationSecret` no `welcome` e rotacioná-lo ao
   migrar. Fecha o sequestro por ex-membro.
4. `discovery.js`: chavear `rooms` pelo endereço **de origem** do datagrama,
   pôr um teto de salas (ex.: 64) e um `notify()` com coalescência de 250 ms.

Custo: 1–2 dias (o item 4 é 30 min e vale sozinho).
Risco: médio — mexe no caminho que a 0.14.0 acabou de abrir.
**Prioridade: P1** (P2 só o item 4).

### R4. `REELECTION_HYSTERESIS_MS` quebrou a própria invariante quando a carência triplicou

`src/renderer/app.js:4595-4603` · `src/renderer/mesh.js:22`

O comentário diz, textualmente: *"Precisa ser MAIOR que a carência de
'disconnected' do mesh (DISCONNECT_GRACE_MS = 5000, mesh.js)"*. O valor em
`mesh.js:22` é **15000** desde o commit `09dd353` (0.13.0) — o mesmo commit
que mudou a constante não atualizou o comentário nem a histerese, que
continua em **8000**.

Efeito: dentro da carência em que um soluço de ICE ainda pode se curar
sozinho, um evento discreto (alguém entra ou sai) já pode re-eleger o relay
e renegociar as duas folhas. É exatamente a troca por queda passageira que a
constante existe pra impedir.

**Como reproduzir:** sala de 4 com árvore formada. Provoque um `disconnected`
no link origem→relay (desligue o adaptador VPN do relay por ~6 s e religue) e,
8 s depois, faça alguém entrar na sala. A árvore troca de relay durante a
carência; o log mostra `[arvore]`/`tree` novos e as folhas renegociam.

**Conserto:** exportar `DISCONNECT_GRACE_MS` de `mesh.js` e definir
`REELECTION_HYSTERESIS_MS = DISCONNECT_GRACE_MS + 3000` — some o número
mágico e some a chance de divergirem de novo. Corrigir o comentário.

Custo: 15 min. Risco: baixo. **Prioridade: P2.**

### R5. Qualquer peer pode pintar vídeo arbitrário no tile de outra pessoa

`src/renderer/app.js:354-356` · `src/renderer/app.js:2759` ·
`src/renderer/app.js:1863-1878`

`isKnownKind` só olha o `baseKind`: `screen@<qualquer coisa>` passa. O
`case 'offer'` usa essa guarda e mais nada. No `onTrack`, o dono do tile sai
do `sourceId` do kind (`:1870`), e o nome e o avatar saem da tabela de peers
(`:1871-1872`).

Então o peer X oferta ao peer Y com `kind: 'screen@F'`, onde F é um terceiro
da sala. Y cria (ou **substitui**) o tile de F com o vídeo de X, o nome de F
e o avatar de F. Se F estiver transmitindo de verdade, X sequestra o tile
dele — `tileSource` passa a apontar pra conexão de X (`:1874`).

É a mesma mensagem que o relay legítimo usa, e não há checagem de que X é o
relay que F designou — embora o dado exista: o papel recebido de F guarda
`paiId` (`app.js:3104`).

**Como reproduzir:** precisa de um cliente modificado. Numa sala de 3 (A, B,
F), a partir de A mande um `offer` com `kind: 'screen@<id de F>'` para B. O
tile de F na tela de B passa a mostrar a tela de A.

**Conserto:** no `case 'offer'`, quando `parseKind(msg.kind).sourceId`
existir, aceitar só se `myRole[baseKind].get(sourceId)?.paiId === msg.from`
(ou seja: F me disse que meu pai para a tela dele é quem está ofertando).
Recusar em silêncio e logar. Espelha a checagem que o `annotate-sync` já faz
no cliente (`app.js:2905`).

Custo: 30 min. Risco: baixo — mas precisa cobrir a corrida "oferta chega
antes do `tree`", que hoje existe (é o motivo do `flushPendingRelay`); a
saída é enfileirar a oferta por alguns segundos em vez de recusar de cara.
**Prioridade: P2.**

### R6. Um `tree` forjado liga o loop de estatísticas de quem não codifica nada

`server/signaling-core.js:874-888` · `src/renderer/app.js:3066-3115`

`tree` é roteado como `offer`: o servidor não confere se o remetente é
origem de coisa alguma. O cliente usa `msg.from` como chave (`:3073`), o que
já impede uma origem mexer no papel dado por outra — mas não impede um peer
qualquer se declarar origem.

Efeito concreto: X manda `tree` a Y com `filhos: ['a','b']`. Y grava
`role = 'relay'`, chama `syncStatsLoop()` (`:3112`), e `isRelaying()`
devolve `true` (`app.js:443`) — o loop de `getStats` de 1 em 1 segundo liga
numa máquina que não está codificando nada e **não desliga sozinho**.
`flushPendingRelay` não faz nada (não há stream de X), então não há encoder;
é só CPU queimada em silêncio.

Junto: `filhosIds` é aceito sem teto e sem checar o tipo dos elementos
(`:3079`). Uma origem bugada pode designar 10 filhos a um relay; o
`FANOUT_RELAY` só vive no lado de quem calcula.

**Como reproduzir:** cliente modificado manda
`{type:'tree', to:<vítima>, kind:'screen', epoch:1, paiId:<meuId>, filhos:['9','9']}`.
No log da vítima aparece o loop de stats subindo sem ela transmitir.

**Conserto:** no `case 'tree'`, exigir `mesh.peers.get(origem)?.live === true`
(só quem está ao vivo distribui papéis) e cortar
`filhos` em `tree.FANOUT_RELAY`, descartando o que não for id de peer da
sala. Três linhas.

Custo: 30 min. Risco: baixo. **Prioridade: P2.**

### R7. `annotate-sync` é a única mensagem roteada sem reconstrução e sem limitador próprio

`server/signaling-core.js:1009-1021`

Todas as outras mensagens ou são reconstruídas campo a campo ou têm cota
própria. Esta tem só um corte de 400 itens. Provei que um item de 50 KB com
estrutura arbitrária atravessa inteiro e que `surface` de 20 000 caracteres
passa sem corte.

O que salva hoje é o **cliente**: `annotate.load` → `sanitizeItems`
(`annotate.js:217`) descarta tudo que não é `stroke`/`text` válido, e a
guarda de `app.js:2905` obriga `surface` a começar com o id do remetente, o
que a limita a `<id>` ou `<id>:screen|camera`. Ou seja, a defesa vive toda
do lado errado do fio — um cliente mais antigo (ou um futuro que esqueça a
guarda) fica exposto.

E medido: a 12,6 MB/s (100 Mbps) isso custa **9% de um núcleo** do host e
20 ms de travada. É desperdício, não é um matador. A 1 Gbps chegaria a ~90%
de um núcleo; na VPN, nunca chega lá.

**Como reproduzir:** cliente modificado manda `annotate-sync` de 478 KB a
27/s pra outro peer. O socket nunca é fechado (o teto global é 300/s).

**Conserto:** (1) limitador próprio de 4/s por peer — o uso legítimo é uma
mensagem por pessoa que entra; (2) `surface: String(msg.surface).slice(0,64)`;
(3) sanitizar os itens no servidor com o mesmo recorte de
`sanitizeAnnotateOp`, ou pelo menos exigir que cada item seja objeto e cortar
o JSON por tamanho.

Custo: 1 h com teste. Risco: nenhum. **Prioridade: P2.**

### R8. Nenhum teto de conexões: o custo de entrar na sala é O(N²) por causa do avatar

`server/signaling-core.js:355` · `:721` · `:786` · `:791`

`new WebSocketServer({ port, maxPayload })` não tem `maxConnections`, e nada
limita conexões por IP. O avatar é aceito com 256 KB (`:721`) e vai no
`welcome` de cada entrada (a lista inteira de peers, `:786`) **e** no
`peer-joined` que vai pra sala toda (`:791`).

Medido: 400 sockets sem avatar entram sem reclamar. Com avatar de 256 KB, 60
sockets custam 4,2 s de CPU do host em 4,5 s e 141 MB de RSS; o 61º `join`
sozinho custa **141 ms de CPU** e 170 ms de ida e volta.

Numa sala real de 6 isso é irrelevante. O que importa é que o teto não
existe: um cliente com bug num laço de conexão, ou alguém mal-intencionado
na rede virtual, trava o app de quem hospeda sem precisar de banda nenhuma.

**Como reproduzir:** `for (let i=0;i<60;i++) new WebSocket(addr)` com `join`
carregando um data URL de 256 KB. O app do host engasga.

**Conserto:**
1. `wss.on('connection')`: se `wss.clients.size > 24`, fecha com 1013
   ("try again later") antes de qualquer processamento.
2. Contador de handshakes por IP numa janela (ex.: 5 em 10 s).
3. Baixar o teto do avatar de 256 KB para 64 KB — 64 KB já é um PNG de
   128×128 de sobra, e corta o custo de broadcast por 4. `resizeImageToAvatar`
   em `app.js:656` já reduz do lado do cliente; isto é o teto pra quem não é
   o nosso cliente.
4. Melhor ainda a prazo: mandar um hash no `welcome`/`peer-joined` e servir o
   avatar sob demanda. Fora de escopo agora.

Custo: 1 h (itens 1–3). Risco: baixo — o item 1 precisa de um número que não
atrapalhe uma sala legítima; 24 é 4× o maior caso previsto.
**Prioridade: P2.**

### R9. O painel de estatísticas é remontado e injetado no DOM a cada segundo, esteja aberto ou não

`src/renderer/app.js:5216` · `src/renderer/ui.js:3136-3148`

`updateStats` roda a cada 1 s (`STATS_POLL_VISIBLE_MS`, `:4836`) e sempre
termina em `renderStats(rows, rxRows)`, que monta a tabela inteira em string
e chama `ui.settings.setStatsHtml(html)` → `body.innerHTML = html`
(`ui.js:3141`). Não há nenhuma checagem de a aba Estatísticas estar aberta.

Importa mais do que parece porque **quem transmite tem um laço de 60 fps na
mesma thread**: `screenrelay.js:131-173` lê um `VideoFrame` e faz
`ctx.drawImage` por quadro, no main thread do renderer. Cada parse de HTML de
1 em 1 segundo disputa exatamente com ele — e o próprio `screenrelay.js`
existe porque perder quadros ali derruba o encoder pra software.

Na mesma volta: `renderRoomStatus()` (`:5223`) e `updateEncoderWarning`
(`:5222`) também rodam sempre.

**Como reproduzir:** transmitir com a aba Estatísticas fechada e olhar o
perfil do renderer: um pico de `innerHTML`/parse a cada 1000 ms.

**Conserto:** `setStatsHtml` guarda o HTML em `lastStatsHtml` (já faz,
`:3137`) e só escreve no DOM se o diálogo estiver aberto; `openSettings` já
reescreve o último valor na abertura (`ui.js:3018`). Melhor ainda: passar as
`rows` e deixar o `ui` decidir se formata — hoje o `app.js` gasta o
`String`/`map`/`join` mesmo que ninguém veja.

Custo: 30 min. Risco: nenhum. **Prioridade: P2.**

### R10. O chat cresce sem teto no DOM, com os data URLs das imagens dentro

`src/renderer/ui.js:2310-2351` · `server/signaling-core.js:54-55`

`appendMessage`/`appendSystemLine` fazem `chatMessagesEl.appendChild(div)` e
nunca podam. O servidor limita o **histórico** que entrega a quem chega (50
linhas, 8 imagens — `:371`, `:55`), mas a sessão ao vivo não tem teto nenhum:
cada imagem fica no DOM como `<img src="data:…">` de até 200 KB
(`chatImageHtml`, `ui.js`), mais o bitmap decodificado.

A cota do servidor permite 3 imagens a cada 5 s **por pessoa**: numa sala de
6, 3,6 imagens/s × 200 KB = 720 KB/s entrando no DOM de todo mundo, sem
volta até sair da sala. Mesmo no uso normal, 1 imagem por minuto numa sessão
de 3 h são 180 imagens ≈ 36 MB de string mais os bitmaps — no mesmo renderer
que faz o laço de 60 fps do R9.

**Como reproduzir:** colar 20 prints no chat durante uma transmissão e
acompanhar a memória do renderer no Gerenciador de Tarefas do Windows. Ela
não volta.

**Conserto:** podar `chatMessagesEl` acima de ~200 linhas (remover do topo,
que é o que sai de vista) e, ao podar, trocar o `src` da imagem por um
placeholder — o `localChatTail` já guarda as 50 últimas para o que precisar
ser reapresentado. `openImageLightbox` passa a ler do `entry` guardado, não
do DOM.

Custo: 2 h. Risco: baixo. **Prioridade: P2.**

### R11. Mapas por-sender que não são limpos quando o peer sai

`src/renderer/app.js:171-172` · `:3823-3824` · `:2696-2698`

`peer-left` limpa `rxHealthByPeer`, `rxPrevSample`, `peerQuality`,
`watchersByTile`, `lookingByViewer` (`:2696-2733`). **Não** limpa
`screenResolution` nem `appliedScreenEncoding`, que só são zerados no fim da
sessão (`:171-172`) e, em `resetShareState`, só nas chaves terminadas em
`:screen` (`:3823-3824`) — as chaves compostas (`<filho>:screen@<origem>`)
escapam das duas peneiras.

São entradas pequenas (uma dezena de bytes cada), uma por (peer, kind) já
visto. Numa noite de entra-e-sai são dezenas. Não é vazamento que quebre
nada; é sujeira que sobrevive à pessoa.

**Conserto:** no `case 'peer-left'`, o mesmo laço de prefixo que já limpa os
outros três mapas. Duas linhas.

Custo: 10 min. Risco: nenhum. **Prioridade: P3.**

### R12. Áudio nativo: o pacote é copiado 6 vezes entre o WASAPI e o worklet

`native/src/loopback_capture.cc:274-286` · `src/main.js:1338` ·
`src/renderer/app.js:3167-3169` · `src/renderer/pcm-injector-worklet.js:19-42`

Caminho de um pacote de ~10 ms (480 quadros × 2 canais = 960 floats):

1. `chunk->samples.resize()` zera 3,8 KB e `memcpy` copia do buffer WASAPI
   (`loopback_capture.cc:278-282`). No caminho `SILENT`, o `std::fill`
   (`:280`) refaz o que o `resize` já fez.
2. `Napi::Float32Array::New` + `memcpy` para um ArrayBuffer do V8
   (`:26-28`).
3. `sender.send('audio:chunk', …)` — structured clone através do IPC:
   serializa no main, desserializa no renderer (duas cópias, `main.js:1338`).
4. `port.postMessage({ samples, channels })` **sem lista de transferência**
   (`app.js:3168`) — mais uma cópia para o escopo do AudioWorklet.
5. O worklet escreve amostra a amostra, com `%` por amostra, num laço JS
   (`pcm-injector-worklet.js:27-40`) — **na thread de renderização de
   áudio**, que é tempo real.

Conta por captura: 96 000 floats/s = 384 KB/s × 6 cópias ≈ **2,3 MB/s de
memcpy** e **96 000 iterações/s de JS na thread de áudio**. No modo
lista-de-inclusão são até 5 capturas simultâneas (`app.js:3261`): ~11,5 MB/s
e ~480 000 iterações/s, durante o jogo.

**Conserto barato (sem tocar no C++):**
- `port.postMessage({ samples, channels }, [samples.buffer])` — elimina a
  cópia 5 e libera o GC do renderer. Uma linha.
- Trocar o laço por-amostra do worklet por `subarray` + `set` em dois
  segmentos (antes e depois da volta do buffer circular), desintercalando com
  passo 2. Elimina a maior parte das 96 k iterações.
- Tirar o `std::fill` redundante do caminho `SILENT`.

**Conserto de verdade (C++):** ring buffer em `SharedArrayBuffer` — o addon
escreve, o worklet lê, zero cópias e zero mensagens de IPC. É o que resolve
o G1 de vez, e é meio dia de trabalho que **não dá pra testar aqui**.

Custo: 1 h (barato) / meio dia (SAB). Risco: baixo / alto sem PC real.
**Prioridade: P2** (o barato), **P3** (o SAB).

### R13. Beacon UDP sem autenticação nem teto alimenta a lista de salas

`src/main/discovery.js:205-213`

Coberto em parte no R3. Separando o que não é sobre migração: `parseBeacon`
aceita qualquer datagrama bem-formado, `rooms.set(beacon.address, …)` usa o
endereço **anunciado**, e `notify()` dispara a cada pacote — o que percorre o
Map inteiro (`toRoomList` faz `map` + `sort`), atravessa o IPC e re-renderiza
a lista no renderer.

Um emissor com 1000 endereços distintos enche a lista de salas de todo mundo
na rede virtual e força mil re-renders por segundo. Não derruba nada, mas
torna o lobby inútil.

**Conserto:** chave pelo endereço de origem do datagrama (`rinfo.address`),
teto de 64 salas, e coalescer `notify()` em 250 ms.

Custo: 30 min. Risco: nenhum. **Prioridade: P2.**

### R14. STUN do Google numa VPN privada

`src/renderer/mesh.js:10-12`

`RTC_CONFIG` aponta pra `stun.l.google.com` com `iceTransportPolicy: 'all'`.
Num app que se apresenta como "sem servidor na nuvem, sem conta", toda
conexão dispara consultas ao Google e coleta o candidato srflx — ou seja, o
IP público de cada participante sai da máquina e pode virar a rota
escolhida, passando por fora do túnel que o usuário instalou de propósito.

O comentário justifica: sem STUN só há candidatos host, e o túnel costuma ser
o gargalo. É um argumento de desempenho legítimo. Mas hoje é decisão
implícita, sem interruptor e sem aviso, e o caminho de falha (sem internet) é
gathering mais lento sem ganho nenhum.

**Conserto:** interruptor em Configurações > Rede ("tentar conexão direta
pela internet", desligado por padrão) e uma linha no README. O código já é
uma constante só.

Custo: 1 h. Risco: baixo — atenção a quem hoje **depende** do srflx.
**Prioridade: P2.**

### R15. O relay que recebe e não repassa é invisível pra origem

`src/renderer/app.js:3057-3060` · `src/renderer/app.js:4709`

A origem só descobre problema no relay por dois caminhos: a conexão
origem→relay falha, ou o relay sai da sala. Um relay que aceita o papel,
recebe o vídeo e simplesmente não entrega às folhas — por bug, por
`relayed` preso (R1) ou por má fé — não é detectado. O `watchers` que ele
emite alimenta só a UI (`applyWatchers`, `:4403`), e a origem não compara o
que ele reporta com os filhos que designou.

Correlato: `encodeHealth` vem do próprio candidato (`:2991`). Um cliente que
reporte `softwareEncoder: true` se livra de ser relay pra sempre
(`tree.js:110`), e um que reporte saúde perfeita se elege. É carona, não
ataque — mas é o mesmo dado sendo usado sem contraprova.

**Conserto:** a origem já sabe os `filhosIds` que designou. Se, N segundos
depois de aplicar a árvore, o `watchers` do relay não listar aqueles filhos,
tratar como falha de relay (`recoverFromRelayLoss`) — reusa a máquina que já
existe. 15 s cobre negociação com folga.

Custo: 2 h. Risco: médio (falso positivo derruba uma árvore sadia; precisa
de teto de tentativas). **Prioridade: P2.**

### R16. Qualidade adaptativa: o amortecimento está bem feito; falta só o degrau da volta

`src/renderer/autoquality.js` · `src/renderer/peerquality.js` ·
`src/renderer/screenres.js`

Avaliando o que foi pedido, item a item:

- **Histerese, escada global:** 3 s contínuos para descer, **30 s** para
  subir, no máximo 2 degraus (`autoquality.js:8-19`). Assimetria explicada e
  correta. O relógio entra por parâmetro (`sample.atMs`), então é testável e
  é testado.
- **Histerese, escada por espectador:** 3 s / **20 s**, 2 degraus, mais
  **15 s de carência** para todo sender recém-criado (`peerquality.js:47`),
  com o log que motivou o número citado no próprio comentário. É o melhor
  pedaço desta camada.
- **Resolução por banda:** degraus 1080/720/540/360 com limiares de descida
  abaixo do bitrate do degrau e subida pedindo ~25% de folga, `DOWN_HOLD_MS`
  5 s e `UP_HOLD_MS` 15 s (`screenres.js:7-20`). São três amortecedores
  independentes em série — não vi como oscilar.
- **Um espectador ruim penaliza os outros?** **Não**, e isso é desenho:
  `senderBandwidthLimited` e `receiveHealth` são por conexão e só movem a
  escada daquela conexão (`app.js:5124-5177`), que se aplica com
  `applyEncodingToPeer` num sender só (`mesh.js:750`). A única coisa global é
  `cpuLimited`/`msPerFrame`, que é `Math.max` entre os senders
  (`encodehealth.js:52-54`) — e isso está certo: a CPU é uma só.
- **Os limiares são defensáveis?** Sim, e com procedência: `budgetMsFor`
  nasceu de um falso positivo documentado com data e hora
  (`autoquality.js:28-44`); `FREEZE_PER_MIN = 6` com `LOSS_PCT_MAX = 2`
  separa "decode não acompanha" de "a rede está perdendo pacote"
  (`peerquality.js:20-24`); `WARMUP_MS = 15000` sai da rampa do GCC medida
  num log real. Não achei chute.
- **Onde falta amortecimento:** a **volta** depois de uma queda. Quando a
  sala encolhe (`peer-left` → `reapplyAudienceQuality`, `:2740`) ou quando o
  modo malha degradada sai (`setMeshFallback`, `:584`), o preset sobe **na
  hora**, sem nenhuma folga observada — ao contrário dos 30 s/20 s que as
  escadas exigem para subir um degrau. O comentário de `setMeshFallback:583`
  diz "sair do modo não interrompe ninguém: é boa notícia" — mas a boa
  notícia é justamente o regime que acabou de quebrar. Numa árvore que
  desmorona e se remonta (entra-sai-entra), isso é um oscilador de preset
  cheio → degradado → cheio.

**Como reproduzir:** sala de 4. Faça o relay sair e entrar duas vezes em
30 s. Entre a saída e a re-eleição a sala cai pra malha degradada (toast
"Sem ninguém pra retransmitir"), e ao voltar sobe a preset cheio
imediatamente; o log de `[qualidade]` mostra o vaivém.

**Conserto:** submeter a saída do modo degradado ao mesmo relógio das
escadas — exigir ~10 s de topologia estável antes de devolver o degrau.
Barato: guardar `meshFallbackSince` e só permitir `setMeshFallback(kind,
false)` passado esse prazo.

Custo: 1 h. Risco: baixo. **Prioridade: P2.**

### R17. Sem teste do que de fato quebra

`server/signaling-e2e.test.js` · `src/renderer/tree.test.js`

O que existe é bom: 7 testes ponta a ponta de sinalização (incluindo
`maxPayload`, flood e isolamento entre salas) e 115 no núcleo, com fuzz. Os
módulos puros (`tree`, `autoquality`, `peerquality`, `screenres`, `resume`,
`succession`, `stallwatch`) têm cobertura real.

O que não existe: **nenhum teste da orquestração** — que é onde estão R1, R2,
R3 e R16. `app.js` tem 5340 linhas e zero testes (é o D1 da auditoria, ainda
aberto). Os três achados P0/P1 deste relatório estão todos lá.

Ferramentas que eu recomendaria, em ordem de retorno (só três):

1. **Extrair a orquestração de árvore de `app.js`** (o D1). Não é
   "refatoração por higiene": é a única forma de escrever um teste que cubra
   "relay cai no meio, folhas voltam". Um módulo puro
   `treeorchestrator.js` com as entradas (`peers`, `myRole`, `originTree`,
   eventos) e saídas (`offerTo`, `closeOut`, `relayTo`, `send`) declaradas,
   e um fake de mesh como o que `mesh.test.js` já usa. 1–2 dias, e é o que
   destrava tudo.
2. **Sala fantasma: N clientes sintéticos.** Um script Node que abre N
   WebSockets, faz `join`, responde offer/answer com SDP de mentira e
   reporta `view-state`/`encodeHealth` fabricados. Não testa mídia, mas
   testa **protocolo, árvore, eleição e limites** — e responde de graça as
   perguntas "quanto custa uma sala de 10?" e "o que acontece com 60 joins?"
   que eu tive que medir com probe descartável. Meio dia, e vira teste de
   regressão para R2 e R8.
3. **`webrtc-internals` exportável.** O Electron tem
   `chrome://webrtc-internals` disponível; um botão "Salvar diagnóstico de
   rede" que despeje o dump JSON junto do log da sessão transforma toda
   reclamação futura num arquivo, em vez de numa conversa. 2 h.

O que eu **não** recomendaria agora: simulação de perda/jitter no teste
(precisa de netem ou de um proxy UDP, e sem mídia real no CI o sinal é
fraco) e telemetria contínua em arquivo além do `[diag]` que já existe —
`encodediag.js` já faz o trabalho com assinatura categórica e heartbeat de
15 s, que é a coisa certa.

**Prioridade: P2** (itens 2 e 3), **P1 a prazo** (item 1).

## Furar o teto de 4 pessoas

Base das contas: preset escolhido 1080p60 = 12 Mbps (`config.js:26`), áudio
Opus 160 kbps (`mesh.js:149`). `audienceSteps(viewers) = viewers >= 3 ? 1 : 0`
(`config.js:122`), então com 3+ espectadores o piso efetivo é **1080p30 =
6 Mbps**. `qualityForRelay` divide o orçamento do relay pelo nº de filhos
(`config.js:156-173`).

### O que a sala entrega hoje

**Sala de 4 (origem + 3), árvore 1/2 profundidade 2:**

| nó | upload | encoders | decoders | recebe |
|---|---|---|---|---|
| origem | 6,2 Mbps | **1** | 0 | — |
| relay | 5,3 Mbps | **2** | 1 | 1080p30 |
| 2 folhas | 0 | 0 | 1 cada | **720p30** |
| **total** | 11,5 Mbps | **3** | 3 | 2 hops |

(o relay tem orçamento de 6 Mbps ÷ 2 filhos = 3 Mbps, e a cadeia desce até
720p30 a 2,5 Mbps — daí as folhas verem 720p30 numa sala que escolheu
1080p60.)

**Sala de 6 (origem + 5), mesma árvore:** 1 relay + 2 folhas + **2 diretos**.

| nó | upload | encoders |
|---|---|---|
| origem | 3 × 6,2 = **18,5 Mbps** | **3** |
| relay | 5,3 Mbps | **2** |
| **total** | 23,8 Mbps | **5** |

Com 6 pessoas a árvore já devolveu a maior parte do problema: 3 dos 5
encoders voltaram pra origem. É esse o teto, e ele é de desenho: `computeTree`
elege **um** relay (`tree.js:126`, `eligible[0]`) e o excedente vira
`direct` (`:137`). `FANOUT_ORIGEM` e `PROFUNDIDADE_MAX` (`tree.js:10-12`) são
constantes **de documentação** — `computeTree` não lê nenhuma das duas;
mudar o valor não muda nada.

### As opções, com números

**(a) Não fazer nada.** Sala de 6: 3 encoders e 18,5 Mbps na origem. Custa
zero. Entrega 1080p30 pros diretos e 720p30 pras folhas.

**(b) Fanout 2 na origem (2 relays, profundidade 2).** Sala de 6: origem →
2 relays, cada um com 2 e 1 folha.

| nó | upload | encoders |
|---|---|---|
| origem | 2 × 6,2 = **12,3 Mbps** | **2** |
| relay A (2 filhos) | 5,3 Mbps | 2 |
| relay B (1 filho) | 6,2 Mbps | 1 |
| **total** | 23,8 Mbps | **5** |

Ganho: −1 encoder e −6,2 Mbps **na origem** (que é quem está jogando).
Total do sistema igual. Cabe até 7 pessoas (2 relays × 2 folhas) sem nenhum
`direct`. **Custo: 1 dia** — `computeTree` passa a escolher 2 relays e
distribuir; mas a recuperação precisa saber lidar com duas sub-árvores
(`recoverFromRelayLoss` hoje reoferta todas as órfãs direto da origem, e com
4 órfãs isso é justamente a rajada que a árvore evita). **Risco: médio.**

**(c) SFU no host (H5).** Origem manda 1 cópia; o host encaminha RTP (sem
re-encode).

| cenário | origem | host | encoders no sistema |
|---|---|---|---|
| 6 pessoas, origem ≠ host | 12,2 Mbps, **1 encoder** | ↓12 / ↑5×12 = **60 Mbps** | **1** |
| 6 pessoas, origem = host | ↑5×12 = **60 Mbps**, 1 encoder | — | **1** |

É a única opção que leva o total de encoders a 1 e permite voltar ao
1080p60 de verdade. Mas ela **troca um teto de CPU por um teto de banda no
host** — e a banda é exatamente o que o README já avisa que costuma faltar:
*"Se der abaixo de 10 Mbps: instale o Tailscale"* (README:54). Com um link
Radmin relayado de alguns Mbps, 60 Mbps de upload no host não existe. Além
disso o host volta a ser ponto único de falha **do vídeo**, propriedade que
o H1 acabou de eliminar. Custo: **1–2 semanas** (mediasoup precisa de addon
nativo — o projeto já paga esse preço uma vez e não consegue testá-lo;
MediaMTX é binário externo a empacotar e a liberar no firewall), mais
renegociar todas as conexões e refazer a sinalização de mídia. **Risco:
alto.**

**(d) Encode-once com WebCodecs (H6).** **Já está medido neste repositório,
e o número é ruim:** `screenrelay.js:60-61` registra, da investigação de
05/09 — *"WebCodecs: não alcança o hardware a 1080p neste build, e em
software é mais caro (18 ms/quadro) que o próprio OpenH264 do WebRTC."*

O orçamento a 60 fps é 16,6 ms (`autoquality.js:24`). **18 ms estoura o
orçamento com zero espectadores.** Para comparação, do mesmo bloco de
medições (`screenrelay.js:15-18, 32-35`):

| caminho | encoder | ms/quadro |
|---|---|---|
| WebCodecs (medido aqui) | software | **18,0** |
| captura direta + 'motion' | OpenH264 | 12,3–13,2 |
| canvas relay + 'motion' (hoje) | MediaFoundation | **5,7–8,1** |

A árvore de hoje roda 2 encoders de hardware a ~8 ms **em paralelo na GPU**.
Um único encoder de WebCodecs a 18 ms **em série na CPU** é pior. Somando a
perda do jitter buffer, do PLI/FIR, da sincronia A/V e do congestion control,
o saldo é negativo em todas as colunas. **Ganho: zero. Não é plano B — está
medido como pior.**

**(e) Simulcast / SVC.** Não se aplica, e o motivo é estrutural, não de
medida: simulcast só paga quando **um** sender alimenta **vários**
receptores, o que exige um elemento de encaminhamento. Aqui cada espectador
tem a própria `RTCPeerConnection` e o próprio `RTCRtpSender`
(`mesh.js:523`); as camadas de um sender vão todas pro mesmo peer. Sem SFU,
simulcast só **adiciona** encode: 2–3 camadas onde havia 1.

E o problema que ele resolveria — "um espectador ruim degrada todo mundo" —
**já está resolvido por outro caminho**: `peerquality.js` mantém uma escada
por conexão e `applyEncodingToPeer` aplica `maxBitrate`, `maxFramerate` e
`scaleResolutionDownBy` num sender só (`mesh.js:750-768`). Um espectador
ruim hoje afeta só a si mesmo, exceto pelo sinal de CPU, que é global de
propósito. **Recomendação: não.**

**(f) Trocar de codec.** A tela é H.264 (`config.js:69`) e o canvas relay já
garante MediaFoundation em hardware. AV1 no Chromium 128 cai em `libaom` —
que está na própria lista de encoders de software do projeto
(`encodehealth.js:8`) —, ou seja, software a 1080p60: fora do orçamento por
uma margem grande. Encode AV1 em hardware exige Arc/RTX 40 **e** um
Chromium mais novo. Os 30–50% de economia de banda do AV1 seriam
exatamente o que ajuda num túnel de VPN lento, então **isto reabre quando o
B1 (Electron 32→44) acontecer**, e só nas máquinas com AV1 em hardware —
com fallback obrigatório pra H.264. *[não verificado no app real]*

**(g) Insertable streams (`RTCRtpScriptTransform`).** Em tese permitiria
pegar o quadro **já codificado** do sender 1 e escrevê-lo nos senders 2..N —
"encode once" mantendo RTP, jitter buffer, PLI e sincronia A/V, que é
exatamente o que falta ao (d). Na prática: um sender não emite sem um
encoder atrás dele, então seria preciso uma fonte fantasma por sender e
substituição de payload, com SSRC, timestamps e keyframes coerentes. E o
bitrate passa a ser o do encoder 1 — o GCC de cada peer perde o controle,
que é a objeção nº 4 do H5, de volta inteira. *[não verificado]* Risco alto,
não recomendo.

### Recomendação

**O caminho mais barato pra furar o teto de 4 não é tecnologia nova — é
fechar os laços que faltam.** Em ordem:

1. **R1** (relay→folha sem reconstrução). Hoje a sala de 4 quebra por isso,
   não por capacidade. 3–4 h.
2. **R2** (duas origens, um relay só). Uma sala de 4 com dois transmissores
   põe 4 encoders numa máquina — pior que a malha. 2–3 h.
3. **(b) fanout 2 na origem**, depois que 1 e 2 estiverem de pé e o D1 der
   como testar a recuperação. Leva a sala a 6–7 com 2 encoders na origem.
   1 dia.
4. Só então, se ainda quebrar: **(c) SFU** — com a conta de banda do host
   feita ANTES, com o `tools/testar-radmin.ps1` que já existe, na máquina de
   quem hospedaria. Se o upload dele não passar de 60 Mbps na VPN, o SFU não
   resolve nada e a resposta honesta é "a sala tem 4 lugares".

**H6 (WebCodecs) deve sair do backlog.** Está medido como pior que o que já
roda.

## Itens do backlog que reavaliei

**F3 — "host cai, sala morre" — MUDOU, e o README está desatualizado.**
Existe transferência de sala desde a 0.14.0. No caminho **gracioso** (fechar
o app, Desconectar, logoff do Windows) o servidor manda `room-migrating` com
sucessor, PIN, banidos e chat (`signaling-core.js:1163-1184`, chamado de
`main.js:477/923/1085`) e um sobrevivente sobe a sala. No caminho
**abrupto** (crash, queda de energia, rota que some) não há mensagem
nenhuma: cada cliente esgota ~116 s de retry e só então tenta a migração
sozinho (`app.js:1790`) — e aí caem os três buracos do R3. Ou seja: F3 é
**parcialmente resolvido**, com a metade que falta sendo justamente a que o
usuário chama de "o PC dele travou". O README:69-75 ainda diz "não há
transferência de sala: esgotado o retry, a sessão acaba pra todo mundo" —
falso nas duas metades.

**G1 — áudio nativo como PCM cru no IPC — CONTINUA VERDADE, e é pior do que
foi descrito.** `NonBlockingCall` por pacote de `GetBuffer`
(`loopback_capture.cc:286`), ~100/s por captura, até 5 capturas simultâneas
no modo lista-de-inclusão. O que a auditoria não contou: são **6 cópias** do
mesmo bloco de amostras entre o WASAPI e o worklet, e a última etapa é um
laço JS por amostra **na thread de renderização de áudio**
(`pcm-injector-worklet.js:27-40`). Detalhe: a `ThreadSafeFunction` é criada
com `maxQueueSize = 0` (`loopback_capture.cc:135`) = ilimitada — se a thread
JS do main engasgar, a fila cresce sem teto. Conserto e conta no R12.

**G2 — `Stop()` congela o main por até 5 s — CONTINUA VERDADE, sem
mudança.** `Stop()` (`:147-151`) e o destrutor (`:142-145`) fazem
`thread_.join()` na thread do JS; a thread de captura pode estar dentro de
`WaitForSingleObject(handler->event_, 5000)` (`:195`), que **não olha
`running_`**. `audio:stopCapture` é um `ipcMain.handle` síncrono
(`main.js:1360-1368`) e `window-all-closed` para todas as capturas em
sequência (`main.js:929`) — com 5 capturas no modo lista-de-inclusão, o pior
caso teórico é **25 s** de janela travada. Conserto concreto: segundo
`HANDLE` de cancelamento, `WaitForMultipleObjects({event_, cancel_}, 5000)`,
e `SetEvent(cancel_)` no `Stop()` antes do `join`. **Risco de mexer sem
testar: alto** — é C++ nativo que só existe no Windows com o addon
compilado, o `.node` nem está no git (C2), e um `join` mal sequenciado troca
um congelamento de 5 s por um crash do processo principal. Não faça sem
máquina real.

**G3 — `NonBlockingCall` que falha vaza o chunk — CONTINUA VERDADE, e
continua pequeno.** `loopback_capture.cc:286` ignora o `napi_status`; com
`maxQueueSize = 0` o único retorno de falha realista é `napi_closing`, então
o vazamento fica mesmo restrito ao encerramento: alguns pacotes de 3,8 KB.
Conserto de uma linha:
`if (tsfnData_.NonBlockingCall(chunk, DeliverAudioChunk) != napi_ok) delete chunk;`.
Custo real: 5 min de código e a mesma impossibilidade de teste do G2 —
por isso vale fazer **junto** com o G2, numa única ida ao C++.

**G6 — teto de ~4 pessoas — CONTINUA VERDADE, e a aritmética ficou mais
clara.** Confirmado em `tree.js:126` (um relay só) e `:137` (excedente vira
`direct`). Números na seção acima: sala de 6 põe 3 dos 5 encoders de volta
na origem. Dois detalhes que valem registrar e não estavam na auditoria:
(1) `FANOUT_ORIGEM` e `PROFUNDIDADE_MAX` são constantes **decorativas** —
`computeTree` não lê nenhuma das duas, então mudar o valor não muda nada e
`tree.test.js:10-12` só verifica que elas continuam com o valor escrito;
(2) o teto **efetivo de qualidade** numa sala de 4 já é 1080p30 no relay e
**720p30 nas folhas**, não o 1080p60 do seletor — vale dizer isso na
interface, que é a mesma linha de raciocínio da branch "transmissão
honesta".

**H5 — SFU — CONTINUA ADIADO, agora com a conta feita.** Ele resolve o que
promete (1 encoder no sistema) mas move o teto para o upload do host: 60
Mbps numa sala de 6 a 1080p60. O próprio README manda testar a VPN e trocar
de VPN abaixo de 10 Mbps. Enquanto essa conta não fechar na máquina de quem
hospeda, o SFU não é solução — é troca de gargalo. E ele reintroduz o ponto
único de falha do vídeo que o H1 eliminou. Continua adiado, por um motivo
melhor do que antes.

**H6 — encode-once com WebCodecs — DEVE SAIR DO BACKLOG.** A própria
investigação do canvas relay já mediu, nesta máquina e neste Chromium:
WebCodecs não alcança o hardware a 1080p e custa 18 ms/quadro em software
(`screenrelay.js:60-61`), contra 5,7–8,1 ms do MediaFoundation que o app usa
hoje. 18 ms estoura o orçamento de 16,6 ms **antes do primeiro espectador**.
Não é "plano B se a sala de 4 quebrar": é uma alternativa pior, já
descartada por medição. Reabre só se um Electron novo trouxer
`VideoEncoder` com `prefer-hardware` funcionando de verdade — e aí a decisão
volta a zero.
