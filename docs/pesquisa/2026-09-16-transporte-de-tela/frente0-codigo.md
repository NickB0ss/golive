# FRENTE 0 — O que o CÓDIGO diz sobre o custo de cada mudança
(análise local, feita enquanto as frentes de pesquisa rodavam)

## Achado 1: o acoplamento à VPN é MUITO mais fino do que o README sugere

Grep por `radmin|tailscale|26\.|100\.` em todo `src/` e `server/` retorna
**16 ocorrências fora de testes**, e quase todas são rótulo de UI ou detecção
de endereço para exibir:

- `src/main/network.js` — 36 linhas. Classifica o IP local (`26.` = radmin,
  `100.64-127.` = tailscale, resto = lan) e escolhe qual mostrar. É só
  **cosmético/diagnóstico**: nada no transporte depende disso.
- `src/renderer/ui.js:1987,2004` — rótulos "Radmin VPN"/"Tailscale" e a
  mensagem "ligue o Radmin ou o Tailscale".
- `src/main.js:1071` — aviso "Radmin/Tailscale não detectado".
- `server/signaling.js:29-31` — só imprime uma tag no console do CLI.
- `src/renderer/mesh.js:16,89` e `signaling-core.js:313,337` — comentários.

**Não existe nenhum lugar onde a mídia dependa do adaptador da VPN.** A VPN
só entrega duas coisas: (a) um IP roteável entre os amigos para a sinalização
e (b) um candidato ICE `host` que fecha quando o NAT não deixa passar.

## Achado 2: trocar STUN por STUN+TURN é uma mudança de UMA LINHA

`src/renderer/mesh.js:10-12`:

```js
const STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
const RTC_CONFIG = { iceServers: [{ urls: STUN_URLS }], iceTransportPolicy: 'all' };
```

É o único ponto de configuração de ICE do app inteiro (`mesh.test.js:72` só
afirma que a lista não é vazia). Acrescentar um entry TURN com credencial ali
dentro é literalmente um objeto a mais no array. O comentário logo acima já
documenta que o autor SABE que o túnel da VPN é o gargalo — o app já tenta
conexão direta pela internet via srflx e usa a VPN como rota de último
recurso. Ou seja: **o app já é 80% independente de VPN; falta só o TURN para
os casos em que o hole punching falha.**

## Achado 3: a sinalização já aceita um endpoint remoto

`src/renderer/app.js:990` e `:1432` — o campo "Entrar por endereço" já
normaliza para `ws://` **e aceita `wss://` completo** se o usuário colar.
`joinRoom()` recebe uma URL. Isso significa que apontar a sinalização para um
serviço na nuvem (ou para a saída de um túnel) **não exige refatoração do
cliente** — exige um servidor do outro lado e um jeito de distribuir o
endereço.

O servidor real é `server/signaling-core.js` (1212 linhas, `ws`), embutido no
processo do host. Ele é headless e testável — em tese roda igual numa VPS ou
num Worker, desde que o transporte WebSocket seja o mesmo.

## Achado 4: o que SÓ funciona na LAN e morreria numa mudança radical

- `src/main/discovery.js` (362 linhas) — descoberta de salas por **broadcast
  UDP** na porta 41235. Broadcast não atravessa internet, e o próprio arquivo
  já anota (linha 47) que "VPNs tipo Radmin/Tailscale não repassam" broadcast
  direito. Sem LAN virtual, **"Salas na sua rede" deixa de existir** e precisa
  virar uma lista vinda de um serviço de rendezvous. É a maior perda de UX de
  qualquer plano que tire a VPN.
- `src/main/firewall.js` (104 linhas) + o botão "Permitir acesso à rede" — só
  fazem sentido porque o host escuta uma porta de entrada. Com sinalização na
  nuvem ou por túnel, **esse código todo some** (e com ele o pedido de
  elevação do Windows, que é atrito de instalação puro).

## Achado 5: a árvore caseira é o ponto mais caro de substituir

`src/renderer/tree.js` (169 linhas) + a orquestração dentro de
`app.js` (5340 linhas, com o `kind` composto `screen@<origemId>` em
`mesh.js`). Um SFU tornaria tudo isso **código morto** — o que é bom para
manutenção (o `app.js` está grande demais; `STATUS.md` item D1 já pede extrair
a orquestração), mas é justamente onde mora a complexidade que já foi paga e
depurada ao longo de ~15 releases.

## Custo relativo, do mais barato ao mais caro

| Mudança | Arquivos tocados | Ordem de grandeza |
|---|---|---|
| Adicionar TURN ao ICE | `mesh.js` (1 linha) + um jeito de entregar credencial | horas |
| Sinalização por túnel/nuvem (`wss://`) | nada no cliente; servidor + distribuição do endereço | dias |
| Trocar descoberta UDP por rendezvous | `discovery.js`, `ui.js`, `app.js` | dias |
| Embutir a rede overlay no app | `main.js`, empacotamento, instalador | dias–semanas |
| Trocar árvore por SFU | `tree.js` morre, `mesh.js` e `app.js` reescrevem a negociação | semanas |
| Virar web app | perde `firewall.js`, addon nativo de áudio, overlay, atalho global | reescrita |

**Conclusão da frente 0:** as opções mais baratas (TURN, sinalização remota)
são exatamente as que atacam a dor nº 1 e a dor nº 3 do briefing. A mudança
radical cara (SFU) ataca a dor nº 2 e a nº 5, que são reais mas afetam menos
gente. Isso sugere fortemente uma ordem de ataque, não um "ou tudo ou nada".
