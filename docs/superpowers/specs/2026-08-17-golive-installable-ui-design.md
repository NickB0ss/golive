# GoLive LAN — instalador, servidor embutido e múltiplos transmissores

Data: 2026-08-17

## Contexto e objetivo

Hoje o GoLive LAN exige que uma pessoa rode `node server/signaling.js` num
terminal separado (com Node instalado) e que cada amigo digite manualmente o
endereço `ws://IP:PORTA` desse servidor, incluindo um nome de sala arbitrário.
O build (`npm run dist`) gera um `.exe` portátil.

O objetivo deste trabalho é tornar o app instalável e amigável o suficiente
pra alguém sem conhecimento técnico usar:

1. Empacotar como instalador de verdade (NSIS), não mais portátil.
2. Embutir o servidor de sinalização dentro do próprio app Electron — quem
   quiser transmitir clica em **Criar sala** e o app sobe o servidor, libera
   o firewall e mostra o endereço pronto pra copiar, sem terminal, sem Node
   separado, sem digitar porta.
3. Corrigir a malha P2P pra suportar **múltiplas pessoas transmitindo ao
   mesmo tempo** na mesma sala (hoje a segunda oferta derruba a conexão da
   primeira).

Fora de escopo: SFU/servidor de mídia central (já documentado no README como
próximo passo se a malha P2P não bastar), suporte a Mac/Linux (o projeto já é
Windows-only pelo uso de `desktopCapturer` + Radmin), TURN/STUN.

## Arquitetura

```
+----------------------------------------------------------+
|                     Processo principal                    |
|                                                            |
|  main.js                                                  |
|   +-- desktopCapturer / getDisplayMedia (já existe)       |
|   +-- server/signaling-core.js  (NOVO: servidor embutido) |
|   +-- src/main/network.js       (NOVO: detectar IP)       |
|   +-- src/main/firewall.js      (NOVO: liberar porta)     |
|                                                            |
+----------------------------------------------------------+
                 |  IPC (preload.js)
+----------------------------------------------------------+
|                        Renderer                           |
|  app.js                                                   |
|   +-- tela inicial: Criar sala / Entrar em sala           |
|   +-- WebSocket client -> ws://<host>:<porta>             |
|   +-- malha WebRTC: outConn/inConn por peer (corrigido)   |
+----------------------------------------------------------+
```

`server/signaling.js` continua existindo como um CLI fino em volta de
`server/signaling-core.js`, pra quem ainda quiser rodar o servidor de
sinalização num PC dedicado, separado do app — mas deixa de ser o caminho
recomendado no README.

## 1. Servidor de sinalização embutido

### `server/signaling-core.js` (extraído do `signaling.js` atual)

Exporta `createSignalingServer({ port })`, que devolve
`{ wss, port, close() }`. Contém toda a lógica atual de `peers`, `join`,
`offer/answer/ice`, `broadcast-state` — sem alteração de comportamento, só
extraído de módulo standalone pra reutilizável.

`server/signaling.js` vira:

```js
const { createSignalingServer } = require('./signaling-core');
const server = createSignalingServer({ port: Number(process.env.PORT) || 9000 });
printAddresses(server.port); // função de log que já existe, reaproveitada
```

### Início do servidor pelo host (`src/main.js`)

Novo handler IPC `room:host`, chamado quando o usuário clica **Criar sala**:

1. Acha a primeira porta livre no intervalo **9000–9010** (tenta
   `createSignalingServer({port})`; se `EADDRINUSE`, tenta a próxima; se
   todas ocupadas, devolve erro `PORTS_EXHAUSTED`).
2. Chama `ensureFirewallRule(port)` (seção 3).
3. Chama `pickAddress()` (seção 2) pra escolher o endereço a mostrar.
4. Devolve ao renderer:
   ```ts
   {
     ok: true,
     port: number,
     address: string,        // ex: "26.13.45.201:9000"
     firewall: { ok: boolean, manualCommand?: string },
     addressWarning?: string // ex: "Radmin/Tailscale não detectado"
   }
   ```

Quando a janela principal fecha ou o app encerra, o servidor embutido é
fechado (`server.close()`) — a sala cai pra todo mundo, e isso é comunicado
na UI (seção 4).

## 2. Detecção de endereço

`src/main/network.js`, extraído/adaptado da função `printAddresses` que já
existe em `signaling.js`:

```js
function listAddresses() // [{ address, iface, kind: 'radmin'|'tailscale'|'lan' }]
function pickAddress()   // melhor candidato: radmin > tailscale > lan > null
```

Prioridade: IP começando com `26.` (Radmin) primeiro, depois a faixa
`100.64.0.0/10` (Tailscale), depois qualquer IPv4 não-interna. Se nenhum
candidato existir (só loopback), `pickAddress()` devolve `null` e o host recebe
um aviso mas a sala sobe do mesmo jeito.

## 3. Firewall

`src/main/firewall.js`:

```js
async function ensureFirewallRule(port) // -> { ok, manualCommand }
```

1. Roda `netsh advfirewall firewall show rule name="GoLive"` (não precisa
   elevação, só consulta). Se a regra já existe **e cobre a porta certa**,
   devolve `{ ok: true }` sem pedir nada.
2. Caso contrário, dispara elevação via
   `powershell -Command "Start-Process netsh -ArgumentList '...' -Verb RunAs -WindowStyle Hidden -Wait"`,
   que aciona o prompt UAC nativo do Windows.
3. Se o processo elevado terminar com sucesso, devolve `{ ok: true }`.
4. Se o usuário cancelar o UAC ou o comando falhar, devolve
   `{ ok: false, manualCommand: 'netsh advfirewall firewall add rule name="GoLive" dir=in action=allow protocol=TCP localport=<porta>' }`
   — a sala sobe mesmo assim, sem bloquear o host.

Regra é nomeada `GoLive` fixa (sem porta no nome); se a porta mudar entre
sessões (fallback por conflito), uma nova regra é adicionada cobrindo a porta
nova — não removemos regras antigas automaticamente (evita pedir elevação de
novo à toa; excesso de regras de firewall não é um problema prático aqui).

## 4. Interface

### Tela inicial (`index.html` / `app.js`)

Substitui o formulário único por duas opções:

- **Criar sala** — campo "seu nome" + botão. Ao clicar, chama
  `window.golive.hostRoom({ name })`, mostra estado de carregamento
  ("Preparando sala...", depois "Liberando firewall..." se aplicável), e ao
  concluir conecta o próprio WebSocket client em `ws://127.0.0.1:<porta>`
  (loopback — sempre funciona, independe de o próprio Radmin rotear de volta
  pra si mesmo) e entra na tela principal.
- **Entrar em sala** — campo "endereço" (aceita `26.x.x.x`,
  `26.x.x.x:porta` ou `ws://...`; sem porta explícita assume `:9000`) + campo
  "seu nome" + botão. Mesmo comportamento de conexão de hoje.

Campo de "sala" é removido de todo lugar — cada host agora representa um
grupo único, sem sub-salas.

### Tela principal

Quando a sessão local é a de host, aparece um painel no topo da sidebar:

```
Sala ativa
26.13.45.201:9000              [Copiar]
Se você fechar o GoLive, a sala cai pra todo mundo.
```

Se `ensureFirewallRule` falhou, some um aviso amarelo abaixo com o comando
manual e um botão **Copiar comando**. Se nenhum IP de VPN foi detectado,
aviso amarelo "Radmin/Tailscale não detectado — endereço abaixo só funciona
na mesma rede local" junto do IP de LAN mostrado mesmo assim.

O resto da sidebar (qualidade, compartilhar tela) não muda de layout, só
perde o campo de sala.

## 5. Múltiplos transmissores simultâneos

`peers` (Map em `app.js`) passa a guardar, por peer:

```js
{ id, name, live, outConn, inConn }
```

- `outConn` — criada por `offerTo(peerId)` quando **eu** começo a transmitir
  pra aquele peer. Só é tocada por código que envia offer/recebe answer.
- `inConn` — criada quando **recebo** uma offer daquele peer (ele começou a
  transmitir pra mim). Só é tocada pelo handler de `offer`.

Mudanças em `handleSignal`:

- `case 'offer'`: fecha e recria **`inConn`** (nunca `outConn`) antes de
  responder com answer.
- `case 'answer'`: sempre corresponde à **`outConn`** (só quem oferece manda
  offer, então não há ambiguidade).
- `case 'ice'`: a mensagem carrega `dir: 'out' | 'in'` indicando de qual
  conexão do remetente veio o candidato. Quem recebe inverte: candidato de
  `dir: 'out'` do remetente vai pro meu `inConn`; candidato de `dir: 'in'` do
  remetente vai pro meu `outConn`.
- `case 'broadcast-state'` com `live: false`: fecha e limpa só o `inConn`
  daquele peer (é o meu lado recebendo o stream dele que precisa cair).

`stopShare()` fecha o `outConn` de todos os peers (minha transmissão parando
não afeta o que eu recebo dos outros). `peer-left` fecha ambas as conexões.

`applyEncoding()` e `updateStats()` iteram só sobre `outConn` (é o que eu
envio). O grid de vídeo (`showTile`/`removeTile`) já funciona por peer id e
não precisa mudar — múltiplos `inConn` simultâneos já geram múltiplos tiles
naturalmente.

**Nota de banda (documentar no README):** com múltiplos transmissores, o
download de cada espectador escala com o número de transmissores
simultâneos, além do upload de cada transmissor já escalar com o número de
espectadores.

## 6. Instalador

`package.json` → `build.win`:

```json
"win": { "target": "nsis" },
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "shortcutName": "GoLive LAN"
}
```

`npm run dist` passa a gerar `dist/GoLive LAN Setup <versão>.exe` em vez do
portátil. README atualizado: instala normalmente, atalho no Desktop/Menu
Iniciar, desinstala pelo painel do Windows.

## Testes (manuais — projeto não tem framework de teste automatizado)

- Criar sala numa máquina limpa (sem regra de firewall prévia): confirmar
  prompt de UAC aparece uma vez, sala sobe, endereço mostrado bate com o IP
  Radmin real.
- Recriar a sala (fechar e abrir o app de novo): confirmar que **não** pede
  UAC de novo (regra já existe).
- Cancelar o UAC de propósito: confirmar que a sala sobe mesmo assim com o
  aviso do comando manual.
- Amigo em outra máquina na mesma VPN Radmin: colar só o IP (sem porta),
  conectar, aparecer na lista de peers.
- Dois peers clicando "Compartilhar tela" ao mesmo tempo (inclusive um pro
  outro, mutuamente): confirmar que ambos os vídeos aparecem pros dois lados
  sem um derrubar o outro.
- Um terceiro peer entra depois que já tem 2 transmitindo: confirmar que
  recebe as duas transmissões.
- Rodar duas instâncias do GoLive na mesma máquina, ambas criando sala:
  confirmar fallback de porta (9001) e que o endereço mostrado reflete a
  porta real.
- Build do instalador NSIS: instalar, confirmar atalhos, desinstalar,
  confirmar remoção limpa.
