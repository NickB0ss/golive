# Firewall "Permitir acesso" + reconexão automática da sala

Data: 2026-08-26

## Problema

1. **Firewall.** Quando a liberação automática da porta falha (UAC cancelado
   ou negado), o app só despejava o comando `netsh` como texto no aviso do
   palco. Ninguém copia e cola um comando desses no meio de uma call.

2. **"Caio da sala" sozinho.** Log recorrente:
   `[signaling] conexao fechada: code=1006 wasClean=false`, sem padrão, com o
   usuário parado. A conexão de sinalização fica ociosa quase o tempo todo
   (só a negociação WebRTC passa por ela). Numa LAN virtual (Radmin/Tailscale)
   um fluxo TCP ocioso por 60–120s tem o estado de NAT descartado — a conexão
   morre sem handshake de close (1006). Não havia heartbeat em lugar nenhum.

## Solução

### Firewall — botão "Permitir acesso à rede"

- Novo IPC `firewall:retry` (`src/main.js`): re-executa `ensureFirewallRule`
  para a porta da sala ativa, re-disparando o pedido de elevação.
- `src/preload.js`: expõe `retryFirewall()`.
- `src/renderer/app.js` (`buildFirewallFix`): o aviso passa a ter uma
  mensagem curta + botão. Sucesso → o aviso some. Falha → botão vira
  "Tentar de novo" e só então aparece o comando manual, como último recurso.

### Heartbeat no servidor de sinalização

- `server/signaling-core.js`: `createSignalingServer` aceita `heartbeatMs`
  (padrão 25000). A cada ciclo, `ws.ping()` em todos os clientes e
  `ws.terminate()` em quem não respondeu o `pong` do ciclo anterior
  (padrão da lib `ws`). O navegador responde `pong` sozinho, então o ping
  mantém o fluxo vivo **e** deixa o servidor derrubar sockets mortos.

### Reconexão automática no cliente

- `src/renderer/app.js` (`joinRoom`): em close anormal (code 1006 ou
  `wasClean === false`) que **não** seja saída deliberada — `leaveRoom`
  zera `currentSession` antes de fechar, então nunca chega ao ramo de
  reconexão — o app volta pra mesma sala sozinho, com backoff exponencial
  (1s, 2s, 4s, 8s), até `MAX_RECONNECT` (4) tentativas. A reconexão
  reconstrói mesh/árvore do zero, que é o estado seguro depois de perder a
  sinalização. O contador zera quando a conexão fica de pé por 20s
  (`STABLE_MS`), pra uma queda isolada horas depois não herdar a contagem
  de uma sequência antiga. Esgotadas as tentativas: mensagem clara pedindo
  pra entrar de novo.

## Fora de escopo

- "Não recebo a tela compartilhada de alguém": provável corrida no repasse
  da árvore de retransmissão (relay). Sem reprodução confiável ainda —
  fica para uma investigação dedicada.
