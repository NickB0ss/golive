# GoLive LAN — repaginação estilo Discord, webcam e descoberta de salas

Data: 2026-08-18

## Contexto e objetivo

O GoLive LAN hoje funciona, mas parece uma ferramenta de diagnóstico: uma
barra lateral única empilha controles de qualidade, lista de peers, painel de
host e estatísticas, e a tela de entrada é um formulário de IP. Quem vai usar
o app são amigos acostumados com o Discord, e a distância entre as duas
interfaces é grande o suficiente pra atrapalhar.

Este trabalho tem quatro objetivos:

1. **Repaginar a interface** no formato de três colunas do Discord, movendo os
   controles de qualidade pra um modal de Configurações.
2. **Escolher o áudio na hora de compartilhar a tela** — hoje é um checkbox
   permanente na barra lateral, longe do momento em que a decisão importa.
3. **Compartilhar a webcam**, de forma independente do compartilhamento de
   tela, já que o Discord também suspendeu esse recurso no Brasil.
4. **Listar as salas ativas na rede**, pra entrar com um clique em vez de
   alguém ter que passar o IP no chat.

Fora de escopo, decidido explicitamente:

- **Microfone e voz.** A conversa continua no Discord. Sem push-to-talk, sem
  indicador de quem está falando, sem supressão de ruído.
- **Chat de texto, reações, emoji.** Nada disso entra.
- SFU / servidor de mídia central, suporte a Mac/Linux, STUN/TURN — já estavam
  fora antes e continuam fora.

## Restrições que moldam o design

**Áudio por aplicativo não existe.** O Windows entrega o loopback do
dispositivo inteiro. Não há API no Electron pra capturar "o áudio do jogo mas
não o do Discord". O design contorna isso oferecendo a captura de um
*dispositivo* específico, que funciona de verdade quando o usuário manda o
Discord tocar em outra saída pelo mixer de volume do Windows.

**A rede é Radmin VPN.** Radmin emula uma LAN de camada 2 e passa broadcast,
o que torna a descoberta automática viável. Tailscale (camada 3) não passa
broadcast — por isso a entrada manual por endereço continua existindo.

**A malha é o teto de banda.** Não há servidor de mídia: quem transmite manda
uma cópia pra cada espectador. A webcam simultânea multiplica esse custo e o
design precisa deixar isso visível pro usuário, não escondido.

## Fases

Três planos de implementação sequenciais. Cada fase deixa o app inteiro e
utilizável.

| Fase | Entrega | Superfície |
|---|---|---|
| 1 | Layout novo, modal de Configurações, diálogo de compartilhar com escolha de áudio | renderer |
| 2 | Webcam independente da tela | renderer + malha WebRTC |
| 3 | Descoberta de salas na rede | processo principal, firewall, IPC |

A fase 1 entrega a maior parte da familiaridade visual. A fase 3 é a de maior
risco (rede, firewall, dado não confiável) e vem por último de propósito.

---

## Fase 1 — Interface

### Layout

Três colunas mais um trilho estreito, no formato do Discord:

```
+----+---------------+--------------------------+-----------+
| ▣  | SALAS NA REDE |  > sala do Nicolas       | NA SALA   |
|    |               |    26.13.45.201:9000 [c] |           |
| +  | # sala do Ni  | +----------+-----------+ | * Nicolas |
|    |   2 pessoas   | |  tela do |  webcam   | |   AO VIVO |
|    | # LAN house   | |   Joao   |  do Joao  | | * Joao [c]|
|    |   1 pessoa    | +----------+-----------+ | * Ana     |
|    |               |                          |           |
|    | + Entrar por  |                          |           |
|    |   endereco    |                          |           |
|    +---------------+                          |           |
|    | Nicolas       |                          |           |
|    | [cam][tela][*]|                          |           |
+----+---------------+--------------------------+-----------+
```

- **Trilho (72px):** marca do app e botão "Criar sala".
- **Coluna de salas (240px):** substitui a tela de entrada atual. Lista as
  salas disponíveis; um clique conecta. Abaixo da lista, "Entrar por endereço"
  (abre um campo de texto) e "Criar sala". Na fase 1, a lista mostra apenas as
  salas recentes salvas em `localStorage`; a fase 3 acrescenta as descobertas
  na rede.
- **Painel do usuário** no rodapé dessa coluna: seu nome e três botões —
  câmera, compartilhar tela, configurações.
- **Palco (centro, flexível):** cabeçalho com nome da sala, endereço e botão
  de copiar; abaixo, a grade de vídeo. Cada tile ganha, no hover, o nome de
  quem transmite, botão de tela cheia e **controle de volume individual** —
  nenhum dos três existe hoje. Duplo clique pra tela cheia continua valendo.
- **Membros (200px):** lista de quem está na sala, com badge "AO VIVO" e ícone
  de câmera quando aplicável. Substitui a `peer-list` da barra lateral.

### Estilo

Paleta e tipografia próximas do Discord, definidas como CSS custom properties
em `:root` (`--bg-app` `#313338`, `--bg-panel` `#2b2d31`, `--bg-rail`
`#1e1f22`, `--accent` `#5865f2`, mais tokens de texto e borda). Nenhum asset,
ícone ou fonte do Discord é copiado — os ícones são SVG inline próprios.

### Modal de Configurações

Modal em tela cheia, com barra lateral de categorias à esquerda e conteúdo à
direita. Recebe tudo que hoje ocupa espaço permanente na barra lateral:

- **Voz e Vídeo** — dispositivo de câmera (dropdown com preview ao vivo),
  dispositivo de áudio padrão pra compartilhamento.
- **Transmissão** — resolução, framerate, bitrate, codec e
  `degradationPreference` (hoje fixo em `maintain-framerate` no código).
  Bitrate separado pra câmera, com padrão baixo.
- **Rede** — endereço detectado, porta em uso e o interruptor "anunciar minha
  sala na rede" (usado na fase 3, já presente aqui).
- **Estatísticas** — o painel de stats atual, que hoje mora na barra lateral.

Fecha com `Esc` ou clique fora. As configurações são aplicadas ao vivo quando
o WebRTC permite, como o bitrate já faz hoje.

### Persistência

A chave `golive` do `localStorage` deixa de guardar só `{server, name,
hostName}` e passa a guardar o objeto de configuração inteiro, com versão:

```
{ v: 1, name, quality: {...}, camera: {...}, network: {...}, recentRooms: [...] }
```

A leitura preenche campos ausentes com os padrões, pra que uma instalação
antiga não quebre.

### Diálogo de compartilhar tela

O seletor de fontes atual ganha, abaixo da grade de thumbnails, um seletor de
áudio com três opções, e um botão "Ir ao vivo" que confirma:

1. **Sem áudio** — nada do seu PC é transmitido.
2. **Áudio do sistema** — o loopback do Windows. O rótulo diz, sem rodeio,
   que isso **inclui a voz do Discord**.
3. **Um dispositivo específico** — dropdown alimentado por
   `enumerateDevices()`, filtrado por `audioinput`.

A opção 3 é a que atende de verdade o pedido de "não mandar o áudio do
Discord": o usuário aponta o Discord pra outra saída no mixer de volume do
Windows (ou usa um cabo virtual) e escolhe aqui apenas a saída do jogo. O
README ganha uma seção explicando esse arranjo e dizendo por que não existe
opção mais simples.

O IPC `sources:select` passa a receber o modo de áudio em vez de um booleano.
O `setDisplayMediaRequestHandler` em `src/main.js` devolve `audio: 'loopback'`
somente no modo "sistema"; nos modos "nenhum" e "dispositivo", devolve sem
áudio, e no modo "dispositivo" o renderer captura a entrada escolhida com
`getUserMedia` e junta a faixa ao stream.

### Organização do código

`src/renderer/app.js` tem 686 linhas e, com tudo isso, passaria de 1500.
Divide-se em arquivos com uma responsabilidade cada, carregados como `<script>`
comuns na ordem de dependência — sem bundler e sem passo de build, que o
projeto não tem e não precisa ganhar:

| Arquivo | Responsabilidade |
|---|---|
| `renderer/config.js` | leitura/escrita das configurações, padrões, derivação de constraints |
| `renderer/signaling.js` | WebSocket, envio e roteamento de mensagens |
| `renderer/mesh.js` | RTCPeerConnections, tracks, encoding, estatísticas |
| `renderer/ui.js` | grade de vídeo, lista de membros, lista de salas, modais |
| `renderer/app.js` | inicialização e ligação entre os módulos |

Cada arquivo expõe seu módulo num namespace global `GoLive.*` dentro de uma
IIFE. `config.js` e a parte pura de `mesh.js` terminam com um
`if (typeof module !== 'undefined') module.exports = ...` pra poderem ser
carregados pelo `node --test`.

O CSS continua em `style.css`, reescrito em cima dos tokens de tema.

---

## Fase 2 — Webcam

### Comportamento

Câmera e tela são fontes independentes. O botão de câmera liga e desliga a
webcam sem afetar o compartilhamento de tela, e vice-versa. Com as duas
ligadas, o espectador vê dois tiles separados de quem transmite.

### Mudança na malha

Hoje `ensureInConn()` **fecha e recria** a conexão de entrada a cada oferta
nova, e `stopShare()` fecha a conexão de saída inteira. Isso não sobrevive a
duas fontes ligando e desligando de forma independente: desligar a câmera
derrubaria a tela de quem estava assistindo.

Novo desenho: **uma conexão de saída por espectador, com dois slots de vídeo
fixos**. Ao criar a conexão, adicionam-se dois transceivers `sendonly` de
vídeo (slot "tela", slot "câmera") mais um de áudio, todos com track nula.
Ligar uma fonte é `replaceTrack(track)`; desligar é `replaceTrack(null)`. Não
há renegociação depois da oferta inicial, e a imagem de quem já assistia não
pisca.

Como apenas quem transmite cria ofertas nessa malha, não existe negociação
simultânea nos dois sentidos, e o padrão de *perfect negotiation* não é
necessário.

Quando **as duas** fontes são desligadas, a conexão de saída é fechada e o
peer volta ao estado de espectador puro — manter uma conexão sem nenhuma track
só gastaria recursos. Fechar uma fonte sozinha nunca fecha a conexão.

Quem recebe precisa saber qual track é qual. O transmissor envia, pela
sinalização, uma mensagem `stream-roles` mapeando `streamId` para `screen` ou
`camera`; o `ontrack` do receptor consulta esse mapa por
`event.streams[0].id`. A mensagem é reenviada quando um slot muda de estado,
e enviada de forma avulsa pra quem entra na sala depois.

O sinal `broadcast-state` deixa de ser booleano e passa a carregar
`{ screen: bool, camera: bool }`, pra que a lista de membros mostre os dois
indicadores corretamente.

### Qualidade da câmera

A câmera tem resolução, framerate e bitrate próprios nas configurações, com
padrão conservador (720p30, 2 Mbps), justamente porque o custo é multiplicado
pelo número de espectadores.

### Custo de banda

Precisa estar visível na interface, não só no README: quando a câmera está
ligada junto com a tela, o painel de estatísticas soma as duas e o modal de
Configurações mostra a conta — bitrate total × número de espectadores — perto
dos controles de qualidade. O README ganha a linha correspondente na tabela de
upload necessário.

---

## Fase 3 — Descoberta de salas na rede

### Protocolo

Novo módulo `src/main/discovery.js`, no processo principal.

**Anúncio.** Quem hospeda abre um socket UDP e envia, a cada 2 segundos, um
datagrama JSON pro endereço de broadcast da interface detectada por
`pickAddress()` (a mesma função que já escolhe o IP Radmin hoje), na porta
**9001**:

```
{ app: "golive", v: 1, roomId, roomName, hostName, port, peers, live }
```

`roomId` é um identificador aleatório gerado quando a sala sobe, pra que a
lista não duplique se o IP mudar.

**Escuta.** Todas as instâncias fazem bind em `0.0.0.0:9001` com `reuseAddr`
e mantêm um registro `roomId -> { ...dados, lastSeen, address }`. Uma sala
desaparece da lista depois de **6 segundos** sem anúncio (três ciclos
perdidos). O endereço usado pra conectar vem do `rinfo.address` do datagrama,
não de um campo do payload — o remetente não escolhe pra onde você conecta.

**Entrega ao renderer.** O processo principal empurra a lista via
`webContents.send('discovery:rooms', rooms)` sempre que ela muda. O preload
expõe `onRooms(callback)` e `startDiscovery()`.

### Dado não confiável

O datagrama vem da rede, de qualquer pessoa no Radmin. O parser:

- descarta datagramas acima de 1 KB antes de tentar `JSON.parse`;
- exige `app === "golive"` e `v === 1`;
- exige que `port` seja inteiro entre 1 e 65535;
- corta `roomName` e `hostName` em 40 caracteres, como o servidor de
  sinalização já faz com `room` e `name`;
- descarta silenciosamente qualquer coisa que não case, sem lançar.

A renderização continua passando por `escapeHtml()`. Sem essas duas camadas,
qualquer um na rede injeta markup na lista de salas de todo mundo.

### Firewall

`src/main/firewall.js` hoje cria uma regra TCP pra porta do WebSocket. Ganha
uma segunda regra, **UDP na porta 9001**, com o mesmo escopo de perfil
(privado/domínio) e a mesma restrição de programa que a regra TCP já usa. O
retorno de `ensureFirewallRule` passa a reportar as duas regras, e o comando
manual mostrado quando a criação falha inclui as duas linhas.

### Privacidade

O anúncio expõe seu nome e o nome da sala pra rede inteira. O interruptor
"anunciar minha sala na rede", em Configurações → Rede, controla isso e vem
**ligado** por padrão (é o comportamento que o usuário pediu). Com ele
desligado, a sala funciona normalmente e só entra quem receber o endereço.

### Quem não aparece

Tailscale não passa broadcast, então salas hospedadas por quem está nele não
aparecem. A entrada manual por endereço continua na interface, e as salas
recentes ficam salvas em `localStorage` e são listadas junto com as
descobertas, marcadas como "recente" enquanto não forem confirmadas por um
anúncio.

---

## Testes

O projeto usa `node --test` sobre módulos do processo principal. Acréscimos:

- `src/main/discovery.test.js` — construção do datagrama; parser rejeitando
  payload grande, JSON inválido, `app`/`v` errados, porta fora de faixa;
  truncamento de nomes; expiração por `lastSeen` com relógio injetado;
  endereço vindo do `rinfo` e não do payload.
- `src/main/firewall.test.js` — estendido pra cobrir a regra UDP e o comando
  manual com as duas linhas.
- `src/renderer/config.test.js` — padrões, leitura de configuração antiga sem
  os campos novos, derivação das constraints de tela e de câmera.
- `src/renderer/mesh.test.js` — mapeamento `streamId -> papel` e a lógica de
  slots (qual transceiver recebe qual track em cada combinação de fontes
  ligadas), com stubs no lugar das APIs do WebRTC.

A malha WebRTC em si e a interface continuam verificadas à mão, com duas
instâncias do app — não há infraestrutura de teste de integração no projeto e
este trabalho não vai criar uma.

## Riscos

- **Broadcast bloqueado.** Firewall de terceiros ou configuração do Radmin
  podem engolir o datagrama. Mitigação: a entrada manual nunca sai da
  interface, e a lista mostra um aviso quando nenhuma sala aparece em 10
  segundos.
- **Duas fontes de vídeo estourando o upload.** Mitigação: padrão conservador
  pra câmera e a conta de banda visível na interface.
- **Reescrita grande do renderer.** Mitigação: a fase 1 não toca na malha
  WebRTC, que é a parte que hoje funciona e é difícil de testar.
