# Melhorias nas salas ao vivo — design

Data: 2026-08-19

## Contexto

O app GoLive LAN já tem descoberta de salas via broadcast UDP ([discovery.js](../../../src/main/discovery.js)) e sinalização WebRTC via WebSocket ([signaling-core.js](../../../server/signaling-core.js)). Este documento cobre cinco melhorias pedidas, todas girando em torno da lista de salas e da experiência de entrar/sair:

1. Botão de refresh na lista de salas ao vivo
2. Som de entrada/saída de sala
3. Cooldown de 2s pra entrar/sair da mesma sala repetidamente
4. Foto de perfil por pessoa
5. Contagem de pessoas exibida ao lado de cada sala na lista

## 1. Contagem de pessoas na lista

`fillRoomList` em [ui.js:85](../../../src/renderer/ui.js) já lê `room.peers` e mostra "N pessoa(s)" no lugar do endereço quando o campo existe — só falta o dado chegar até ali.

**Fluxo:**
- `createSignalingServer` (signaling-core.js) expõe `getPeerCount()` no objeto retornado, lendo `peers.size` (o `Map` que já existe, populado no `case 'join'` e limpo no `close`).
- `discovery.js`: `formatBeacon` ganha um campo `peers` (número, opcional — beacon sem o campo é tratado como sala sem contagem, pra não quebrar compat com uma versão antiga do app na mesma rede). `startAdvertising` passa a aceitar um `getPeerCount` callback e recalcula o payload a cada tick do `setInterval` (a cada 2s, mesmo intervalo já usado — sem beacon extra), em vez de montar o payload uma vez só.
- `parseBeacon` valida `peers` como inteiro ≥ 0 quando presente; `toRoomList` repassa o campo.
- `main.js`: no handler `room:host`, passa `getPeerCount: () => embeddedServer.getPeerCount()` pro `startAdvertising`.

## 2. Botão de refresh

Ícone de refresh (SVG, círculo com seta) ao lado do título "Ao vivo agora" em [index.html](../../../src/renderer/index.html). Só aparece/faz sentido quando há uma listagem ativa — fica sempre visível, sem gate.

**Fluxo:**
- Renderer chama `window.golive.refreshDiscovery()` (novo método no preload).
- `main.js`, IPC `discovery:refresh`: guarda se estava anunciando (`discovery.isAdvertising()`, novo getter), chama `discovery.stop()` seguido de `discovery.start()` (fecha e reabre o socket UDP, limpando o `Map` de salas conhecidas — implementação já existente em `stop()`), e se estava anunciando, chama `startAdvertising` de novo com os mesmos dados (nome/porta/endereço da sala hospedada).
- Renderer: no `onclick`, adiciona uma classe CSS ao ícone que dispara uma animação de rotação de 600ms (`@keyframes spin`), sem esperar callback do IPC (a lista já vai se repovoar sozinha pelos beacons que chegarem).

## 3 & 4. Sons de entrada/saída e cooldown de 2s

**Sons — novo módulo `src/renderer/sound.js`:**
- `playJoinSound()` / `playLeaveSound()`: cada uma cria (ou reusa) um `AudioContext` singleton lazy, e toca um oscilador curto (~120ms, onda senoidal) — entrada sobe de 440Hz a 660Hz, saída desce de 660Hz a 440Hz. Ganho baixo (~0.15) pra não ser irritante, com fade-out no final pra evitar estalo.
- Chamado em quatro pontos de `app.js`:
  - Sua própria entrada: dentro do `onOpen` de `joinRoom`, depois que a conexão realmente abre.
  - Sua própria saída: no início de `leaveRoom()`.
  - Peer entrou: no `case 'peer-joined'` de `handleSignal` (não toca para os peers que já estavam na sala quando você chega, só `welcome` popula sem som).
  - Peer saiu: no `case 'peer-left'` de `handleSignal`.

**Cooldown de 2s — em `app.js`:**
- `Map` module-level `roomCooldowns` (endereço → timestamp da última transição, seja entrada ou saída).
- Toda entrada bem-sucedida (`onOpen` de `joinRoom`) e toda saída (`leaveRoom()`) grava `roomCooldowns.set(address, Date.now())`.
- Antes de conectar (clique na lista de salas, ou no botão de desconectar), checa se `Date.now() - roomCooldowns.get(address) < 2000`; se sim, ignora o clique.
- Efeito visual: `renderRoomList()` e o botão de desconectar consultam o cooldown a cada render — se dentro da janela, aplicam `disabled` + classe CSS de opacidade reduzida no elemento correspondente (linha da sala na lista, ou botão de desconectar). Um `setTimeout` de 2s força um re-render pra tirar o estado assim que o cooldown expira.

## 5. Fotos de perfil

**Captura e armazenamento:**
- Painel do usuário (`user-panel`) ganha um avatar circular clicável ao lado do campo de apelido. Clique abre `<input type="file" accept="image/*">` oculto.
- Ao selecionar: carrega a imagem, desenha num `<canvas>` 128×128 com cover-fit (corta o excesso, mantém proporção), exporta via `canvas.toDataURL('image/jpeg', 0.8)`.
- Arquivos maiores que 10MB são rejeitados antes de processar (guarda simples, mensagem de erro).
- Resultado (data URL, tipicamente 5–15KB) salvo em `cfg.avatar`, persistido em `localStorage` do mesmo jeito que `cfg.name` hoje ([config.js](../../../src/renderer/config.js)).

**Transmissão:**
- `app.js`: mensagem `join` ganha campo `avatar: cfg.avatar || null`.
- `signaling-core.js`: `peers.set(id, { ws, name, room, avatar })` no `case 'join'`; `roomPeers()` inclui `avatar` no retorno; a mensagem `peer-joined` broadcast também inclui `avatar`.
- `mesh.js`: `addPeer(id, name, avatar)` guarda o campo na entry do peer.
- `app.js`: no `case 'welcome'`, passa `p.avatar` pra `mesh.addPeer`; no `case 'peer-joined'`, passa `msg.avatar`.

**Exibição:**
- `ui.js`, `renderMembers`: cada `<li>` da lista de membros ganha um avatar circular (`<img>` se `peer.avatar` existir, senão um `<div>` com a inicial do nome sobre um fundo colorido gerado a partir de um hash simples do `id` do peer — paleta fixa de ~6 cores). O indicador de conexão (hoje uma bolinha separada) vira uma borda colorida ao redor do avatar (verde=conectado, laranja=conectando, sem borda=parado).

## Testes

- `signaling-core.test.js`: cobre `getPeerCount()` refletindo entradas/saídas, e `avatar` sendo repassado em `welcome`/`peer-joined`.
- `discovery.test.js`: `formatBeacon`/`parseBeacon` com e sem campo `peers` (compat), validação de tipo.
- Módulos de UI (`ui.js`, `app.js`, `sound.js`) não têm suite automatizada hoje (é tudo DOM direto, sem framework de teste de renderer no projeto) — verificação manual via `npm start` faz parte do plano de implementação, cobrindo: refresh, cooldown (clicar rápido 2x), som ao entrar/sair com dois clientes, avatar aparecendo pro peer remoto.

## Fora de escopo

- Avatar em tiles de vídeo (só lista de membros, por ora).
- Persistir/cachear avatares de outros peers entre sessões (avatar remoto só existe enquanto a sessão WebRTC estiver ativa, se reconectar pede de novo).
- Configuração de volume dos sons (fixo, baixo).
