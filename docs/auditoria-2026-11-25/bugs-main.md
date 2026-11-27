# Auditoria 2026-11-25 — bugs no processo main, preload e addon nativo

Escopo: `src/main.js`, `src/main/*.js`, preloads (`src/preload.js`,
`src/espiar-preload.js`, `src/preload-overlay.js`, `src/splash/preload-splash.js`)
e `native/src/*.cc`. `native/media/` ficou de fora (tem outro dono).
Nenhum código de produção foi alterado.

Reproduções em
`/tmp/claude-0/-home-user-golive/55573a2c-39b7-58ae-bbac-ac37f25f7d3b/scratchpad/bugs-main/`
(scratchpad da sessão, temporário):

- `discovery.repro.test.js`, `ports.repro.test.js`, `close-hang.repro.test.js`:
  rodar com `node --test <arquivo>`;
- `close-hang-duracao.js`: mede quanto tempo o `close()` fica preso (`node close-hang-duracao.js`);
- `electron-menu/` e `electron-overlay/`: sondas no Electron 44.4.3 do repo
  (`xvfb-run -a node_modules/electron/dist/electron --no-sandbox <pasta>`).

Ordem: do mais grave ao menos grave.

---

## M-01 — alta — fechar o app pode deixar o processo vivo, invisível, segurando a trava de instância única

- **Onde:** `src/main.js:1085-1106` (`window-all-closed` faz `await closeEmbeddedServer({ migrate: true })` antes de `app.quit()`, sem prazo); causa em `server/signaling-core.js:2291` (`close()` só resolve em `wss.close(() => res())`).
- **Defeito:** o `close()` do servidor de sinalização só resolve quando o `http.Server` interno do `ws` fecha, e isso exige que **toda** conexão TCP tenha acabado. Nada limita essa espera, e o `app.quit()` fica atrás dela.
- **Cenário:** quem hospeda fecha a janela.
  - (a) Um participante cuja rota da VPN caiu não responde ao frame de close. O `ws` espera o `closeTimeout` dele (30 s) e só então derruba o socket.
  - (b) Qualquer máquina da LAN abre TCP na porta 9000-9010 e manda um cabeçalho HTTP incompleto: um scanner, um navegador ou uma sonda. O Node para o relógio de `headersTimeout` quando `server.close()` é chamado, então essa conexão **nunca** termina.

  Nos dois casos a janela some, mas o processo continua rodando: `before-quit`/`will-quit` não disparam, o log não ganha a linha "encerrando" e a trava de `requestSingleInstanceLock` continua presa. Se a pessoa abre o GoLive de novo, nada acontece: o `second-instance` cai num processo sem janela (`target` nulo → `return`) e a nova instância sai. O mesmo `await` sem prazo também trava o `room:host` quando ele precisa fechar uma sala anterior (`src/main.js:1211`). Ali o `embeddedServerHosting` fica pendente e toda tentativa seguinte de "Criar sala" devolve a mesma promessa parada. Também trava o `room:unhost` (`:1276-1278`).
- **Evidência:** CONFIRMADO.
  - `close-hang.repro.test.js`: os dois testes passam; o `close()` ainda está pendente depois de 5 s.
  - `close-hang-duracao.js`: par mudo = **30 002 ms**; cabeçalho incompleto = ainda pendente quando o `timeout 200` matou o script (mais de 200 s).
- **Correção:** no main, `Promise.race([closeEmbeddedServer(...), prazo de ~2 s])` antes do `app.quit()`. No `close()` do servidor, mandar `room-closed` e, depois de um prazo curto, chamar `client.terminate()` nos clientes que restarem e destruir as conexões HTTP pendentes. A forma mais simples: criar o servidor HTTP à mão e chamar `server.closeAllConnections()` depois do prazo.

## M-02 — média — menu padrão do Electron ativo: Ctrl+R recarrega no meio da sala e Ctrl+Shift+I abre o DevTools em produção; o main não limpa nada quando a página recarrega ou cai

- **Onde:** `src/main.js:473` (só `setMenuBarVisibility(false)`; não existe `Menu.setApplicationMenu(null)` nem `win.removeMenu()`). Limpeza ausente em `src/main.js:613` (`render-process-gone` só solta o keep-awake) e na falta de qualquer handler de navegação/recarga do quadro principal.
- **Defeito:** esconder a barra de menu não desliga os aceleradores do menu padrão. O próprio código já bloqueia o F11 em `before-input-event`, o que mostra que esses aceleradores chegam à janela, mas Ctrl+R, Ctrl+Shift+R e Ctrl+Shift+I continuam ativos. Quando o renderer recarrega ou cai, o estado que o main guarda em nome dele sobrevive.
- **Cenário:** alguém aperta Ctrl+R por hábito com a sala aberta, transmitindo, com rabisco ligado e "incluir Discord". A página volta para o lobby, mas:
  - as capturas nativas em `activeCaptures` continuam: uma thread WASAPI fazendo polling a cada 5 ms e cerca de 384 KB/s de `audio:chunk` por IPC para uma página que descarta tudo. Só param ao fechar o app;
  - a janela de rabisco (sempre por cima, transparente) continua sobre o monitor com os traços velhos, e a UI não tem como fechá-la;
  - se a pessoa hospedava, o servidor embutido continua de pé e anunciado com os outros dentro, sem o dono;
  - `roomActive` continua `true`, então `update:download` devolve `blocked` em silêncio até a pessoa entrar e sair de outra sala.

  O keep-awake se corrige sozinho, porque o boot do renderer reenvia `power:keep-awake`. Ctrl+Shift+I abre o DevTools da página principal, que tem acesso a toda a ponte `window.golive`.
- **Evidência:** CONFIRMADO para o menu: `electron-menu/` no Electron 44.4.3 com `setMenuBarVisibility(false)` imprime `MENU presente [reload=CmdOrCtrl+R, forcereload=…, toggledevtools=Ctrl+Shift+I, togglefullscreen=F11]` e `CTRL_R_RECARREGOU true CTRL_SHIFT_I_ABRIU_DEVTOOLS true`. As consequências da recarga vêm da leitura do código (PLAUSÍVEL forte): não há nenhum handler que pare `activeCaptures`, `overlayWin` ou `embeddedServer` fora do fechamento.
- **Correção:** `Menu.setApplicationMenu(null)` antes de criar as janelas (o F11 continua bloqueado). No main, em `render-process-gone` e em `did-start-navigation` do quadro principal de `win` (exceto a primeira carga), uma rotina de limpeza que pare as capturas cujo `sender` é aquela janela, chame `destroyOverlayWindow()`, ponha `roomActive = false` e aplique o `updatePolicy`.

## M-03 — média — qualquer máquina da LAN reescreve o card de uma sala que já existe (porta, versão, nome, cadeado, Mesa)

- **Onde:** `src/main/discovery.js:290-305` (a chave do mapa é `beacon.address`, texto do pacote; `rooms.set(key, { ...beacon, ... })` troca todos os campos pelos do último pacote, venha de que IP vier).
- **Defeito:** o grupo de uma sala aceita pacotes de qualquer IP de origem, e o último pacote vence em todos os campos. O `pickJoinAddress` impede só a troca do IP de destino, não a da porta nem dos outros campos.
- **Cenário:** numa rede Radmin/Tailscale compartilhada, um terceiro manda em laço beacons com o `address` da sala de outra pessoa e:
  - `version: "0.0.1"`: o lobby marca a sala como incompatível e desliga o botão "Entrar";
  - ou `port: 9009`: o card passa a apontar para `host-real:9009` e a entrada falha;
  - ou outro `name`/`protected`/`mesa`.

  O host verdadeiro restaura os campos a cada 2 s; quem manda mais rápido ganha.
- **Evidência:** CONFIRMADO: `discovery.repro.test.js`, teste `M-spoof`. Depois do pacote do "atacante", o card vira `address 10.0.0.5:9009` e `version 0.0.1`.
- **Correção:** guardar os campos por IP de origem e montar o card só com os do pacote que veio do IP anunciado, quando ele estiver em `sources`. Pacote de outra origem com o mesmo `address` só acrescenta a origem, sem mexer em nome, porta e versão.

## M-04 — baixa — `discovery.start()` nunca resolve se o bind UDP falha; a descoberta morre em silêncio pelo resto da sessão

- **Onde:** `src/main/discovery.js:317-335` (só existe o callback de sucesso do `bind`; o `'error'` é engolido em `:312-314`). Consumidores em `src/main.js:407-421` e `:1329-1335`.
- **Defeito:** se o `bind` falha, o socket emite `'error'` (ignorado) e a promessa fica pendente para sempre. `ensureDiscoveryStarted` deixa `discoveryStarted = true` e nunca tenta de novo, e nada vai para o log.
- **Cenário:** no Windows, a porta 41235 cai numa faixa reservada (Hyper-V/WSL/Docker: `EACCES`), ou outro programa a tomou com `SO_EXCLUSIVEADDRUSE`. O lobby nunca mostra salas, a sala hospedada nunca é anunciada e cada clique em "Procurar de novo" deixa mais uma promessa de IPC pendente. Sem nenhuma linha de log.
- **Evidência:** CONFIRMADO: `discovery.repro.test.js`, teste `M-bind`. Com a porta ocupada por um socket sem `reuseAddr`, a promessa continua pendente depois de 1 s.
- **Correção:** `socket.once('error', ...)` antes do `bind`, rejeitando a promessa; no main, registrar o erro no log e voltar `discoveryStarted` para `false`.

## M-05 — baixa — o teto de 64 salas despeja a sala real mais antiga, mesmo que ela acabe de renovar

- **Onde:** `src/main/discovery.js:293-296` (despeja `rooms.keys().next().value`, isto é, a primeira inserida; `rooms.set` numa chave que já existe não muda a posição dela no `Map`).
- **Defeito:** o critério de despejo é a ordem de inserção, não o `lastSeen`.
- **Cenário:** uma máquina da LAN anuncia endereços novos sem parar. A sala legítima, descoberta primeiro e renovada a cada 2 s, é sempre a primeira a sair. Ela pisca ou some da lista.
- **Evidência:** CONFIRMADO: teste `M-evict` (com `maxRooms: 4`, a sala real some logo depois de renovar).
- **Correção:** despejar a sala de menor `lastSeen`, ou fazer `delete` antes do `set` para mover para o fim. Um teto por IP de origem resolve melhor.

## M-06 — baixa — beacon sem limite de tamanho em `name`, `address` e `peers`

- **Onde:** `src/main/discovery.js:103-110` (o beacon de migração já limita a 64 caracteres em `:154-155`; o de sala, não).
- **Defeito/cenário:** um pacote UDP de cerca de 64 KB vira um card com nome de 60 000 caracteres e um "1e15 pessoas". O HTML sai escapado (`escapeHtml` em `src/renderer/ui.js`), então não há XSS; o problema é layout e memória (64 × 64 KB no mapa e no IPC a cada atualização).
- **Evidência:** CONFIRMADO: teste `M-tamanho`.
- **Correção:** cortar `name` em ~64, recusar `address` com mais de 64 caracteres (como no de migração) e limitar `peers`, por exemplo a ≤ 1000.

## M-07 — baixa — `findFreeServer` só pula `EADDRINUSE`; porta reservada no Windows aborta a criação da sala

- **Onde:** `src/main/ports.js:24-29`.
- **Defeito:** qualquer erro diferente de `EADDRINUSE` aborta o laço, inclusive o `EACCES` que o Windows devolve para portas nas faixas reservadas (`netsh int ipv4 show excludedportrange`).
- **Cenário:** uma máquina com Hyper-V/WSL/Docker cuja reserva cobre a 9000. "Criar sala" falha com "listen EACCES…" em vez de subir na 9001. Na migração, `preferredPort` nessa situação também derruba a tentativa inteira.
- **Evidência:** CONFIRMADO: `ports.repro.test.js` (tenta só a 9000 e rejeita com `EACCES`). PLAUSÍVEL quanto à frequência no campo.
- **Correção:** tratar `EACCES` como `EADDRINUSE` (passar para a próxima porta).

## M-08 — baixa — `room:abort-host` durante o `room:host` (esperando UAC/PowerShell) vira erro cru no lobby

- **Onde:** `src/main.js:1240-1242` (lê `embeddedServer.port` depois do `await ensureFirewallRule`; o `room:abort-host` em `:1285` pode ter zerado `embeddedServer` nesse meio-tempo).
- **Defeito:** o handler não confere se o servidor que criou ainda é o atual depois do `await`.
- **Cenário:** na migração, o renderer chama `abortHosting` em `yieldMigrationHost` enquanto o `hostRoom` do sucessor ainda espera a consulta de firewall (PowerShell leva de 0,5 a 2 s mesmo sem UAC). O `room:host` lança `TypeError` e devolve `{ ok: false, error: "Cannot read properties of null (reading 'port')" }`. Em `becomeMigrationHost` isso não é `cancelled`, então o lobby mostra "erro ao subir a sala (Cannot read…)" enquanto a pessoa entra normalmente na sala migrada.
- **Evidência:** PLAUSÍVEL: leitura do caminho completo (`src/renderer/app.js:1612-1624` → `src/main.js:1285` → `:1240`). O main não se testa no `node:test`.
- **Correção:** guardar `const server = embeddedServer` logo após criá-lo e, depois de cada `await`, `if (embeddedServer !== server) return { ok: false, error: 'CANCELLED' }`. O renderer trata como `cancelled`.

## M-09 — baixa — dois `overlay:start` sobrepostos derrubam um ao outro

- **Onde:** `src/main.js:1401-1440` e `:1466-1478`.
- **Defeito:** o `catch` do primeiro `overlay:start` chama `destroyOverlayWindow()` sobre a variável global, que a essa altura já aponta para a janela do **segundo** pedido.
- **Cenário:** duas aberturas próximas (troca de fonte logo depois de ir ao vivo). A segunda janela é destruída pelo `catch` da primeira, os dois pedidos voltam `{ ok: false, reason: 'display' }` e a pessoa vê o aviso de "monitor sumiu" sem motivo. Relacionado, no renderer: `stopAnnotOverlay` (`src/renderer/app.js:2960`) não faz nada enquanto um start está pendente (`annotOverlayOn` ainda é `false`). Se a transmissão é cancelada nesse intervalo, a janela de rabisco abre depois e fica sobre a tela.
- **Evidência:** CONFIRMADO para o mecanismo: `electron-overlay/` (mesma sequência de `main.js`) imprime `#1 catch: ERR_FAILED`, `#2 catch: ERR_FAILED`, `janela viva: false`. PLAUSÍVEL quanto ao alcance: o renderer atual espera cada start antes de seguir, então a sobreposição exige uma troca de fonte no meio.
- **Correção:** no `catch`, destruir só a janela criada por aquele pedido (`const w = overlayWin` antes do `await`; `if (overlayWin === w) destroyOverlayWindow()`). No renderer, guardar a promessa do start em andamento e fazer o stop esperar por ela.

---

## Verificado e descartado (não alcançável ou sem efeito real)

- **`contextIsolation`/`sandbox`/`nodeIntegration`:** todas as janelas têm `contextIsolation: true` e `nodeIntegration: false`; o sandbox vem ligado por padrão (Electron ≥ 20). Os preloads expõem funções com nome, sem `ipcRenderer` genérico e sem canal que receba caminho ou comando.
- **`shell.openExternal`:** os três chamadores validam a URL (`linkParaNavegador`, `linkDaMesa`, `linkDeApoio`) e checam `senderFrame`. `logs:openFolder` usa um caminho fixo.
- **`will-navigate`/`window.open`:** todas as janelas têm `lockNavigation` e `setWindowOpenHandler`. A navegação dos iframes fica presa pelo `frame-src` da CSP.
- **`setDisplayMediaRequestHandler`:** confere só `frame.top`, então um iframe de YouTube/Twitch passaria na checagem. Mas esses iframes não têm `allow="display-capture"`, então o `getDisplayMedia` nem chega ao handler.
- **Sem `setPermissionRequestHandler`:** o Electron concede permissões por padrão, mas o único conteúdo de terceiros (players) está limitado pelo atributo `allow` (`autoplay; encrypted-media`).
- **Firewall/PowerShell:** a porta é um inteiro do main e o `execPath` passa por `psQuote` dentro de `-EncodedCommand`. Nenhum dado externo chega à linha de comando.
- **Beacon refletido na UI:** nome, endereço e versão passam por `escapeHtml`; `peers` é limitado a 5 avatares em `lobby-room.js`.
- **C++ (`loopback_capture.cc`):** o `tsfnData_` e o `tsfnReady_` são liberados exatamente uma vez em todo caminho de saída. O `ActivationHandler` tem a contagem de referências correta, inclusive no caminho de timeout (a operação assíncrona segura a própria referência). O `memcpy` usa `numFrames * channels`, com o formato fixo de 2 canais em float32. A fila tem teto de 200 ms. Exceção de JS no callback do TSFN vira exceção de JS (`WrapVoidCallback` do node-addon-api 8.9.2), não `terminate`. O `Stop()` e o destrutor podem bloquear até 5 s se forem chamados durante a ativação, mas o renderer só recebe o `captureId` depois do `ready`, então não há como parar antes. O `ReadyResult` vaza só no desmonte do ambiente: irrelevante.
- **C++ (`audio_sessions.cc`, `process_util.cc`, `gpu_priority.cc`):** COM equilibrado (`RPC_E_CHANGED_MODE` tratado), handle do snapshot e do `OpenProcess` fechados em todo caminho. A corrida de reuso de PID entre `getAppMetrics` e `OpenProcess` tem janela de microssegundos: desprezível.
- **Keep-awake/prioridade de GPU:** liberados em `closed`, `render-process-gone` e `before-quit`. Na recarga da página, o boot do renderer reenvia o estado. A prioridade é por processo e morre com ele.
- **Listeners de IPC duplicados em `createWindow`:** só aconteceria pelo `activate` do macOS. O app é Windows.
