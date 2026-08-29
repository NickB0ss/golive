# STATUS — GoLive LAN

Pra quem voltou ao projeto depois de um mês. Leitura de 30 segundos.
Para o passo a passo de uso e a instalação, ver `README.md`.

## O que o app faz hoje

Compartilhamento de tela em até 1080p60 entre amigos numa LAN virtual (Radmin
VPN / Tailscale). Sem servidor na nuvem, sem conta. Quem cria a sala sobe um
servidor de sinalização embutido no próprio processo; a mídia é P2P.

- Descoberta de salas na rede por beacon UDP (opcional, ligada por padrão).
- Liberação de porta no firewall do Windows automática, com botão
  "Permitir acesso à rede" quando a elevação falha.
- Áudio de sistema por loopback; áudio por processo (incluir só o Discord)
  quando o addon nativo está compilado.
- Árvore de retransmissão **sempre ligada** (origem → relay → folha,
  fanout 1/2, profundidade 2). Teto prático ~4 pessoas.
- Qualidade em preset fechado, escolhida no diálogo de compartilhar, que é
  só um **teto**: o app desce sozinho pelo tamanho da sala **e** pela
  telemetria de encode (tempo por quadro, encoder em software), degradando a própria captura
  via `applyConstraints`, não só o teto do encode — e volta a subir quando
  sobra folga. Um degrau extra quando cai pra malha.
- Áudio negociado em **estéreo** (Opus, bitrate declarado no SDP dos dois
  lados).
- Pausar a transmissão a qualquer momento, com atalho global `Ctrl+Alt+P`
  que funciona com o jogo por cima.
- Painel de estatísticas mostra os dois lados: o que sai e o que está
  **sendo recebido**.
- Atualização via GitHub Releases, disparada pelo usuário (não baixa sozinha).
- Log em arquivo por sessão (Configurações > Estatísticas > "Abrir pasta de
  logs").

## Versão atual

`0.1.10` (`package.json`). Electron `^32` (fora de suporte — ver backlog).

## Em andamento

Branch **`feat/transmissao-honesta`**: torna a transmissão honesta com o que
ela consegue entregar, seguindo o plano
`docs/superpowers/plans/2026-08-28-transmissao-honesta.md`. Acrescenta:

- ponto/badge de status no cabeçalho dirigido pelo estado real da sala
  (conserta o uso do acento apontado no F4 da auditoria);
- escada de qualidade automática em laço fechado, alimentada pela telemetria
  de encode — desce sozinha e volta a subir quando há folga;
- degradação da própria captura via `applyConstraints`, não só o teto do
  encode;
- Opus em estéreo no SDP dos dois lados, com bitrate declarado;
- tabela "Recebendo" no painel de estatísticas (lado do receptor);
- alvo de jitter buffer mais baixo;
- pausar a transmissão, com atalho global `Ctrl+Alt+P`.

**Já lançado** (em release com tag):

- **F2** — retransmissão em cadeia sempre ligada, sem interruptor na UI
  (`cfg.network.tree` forçado) — desde a v0.1.5.
- **C2/C3/C6** — addon nativo faz o build falhar se faltar; `asarUnpack` do
  `.node`; metadados do `package.json`.
- **A1** — buffer de candidato ICE adiantado + fila serial de sinalização.
- **A2** — carência de 5s antes de tratar `disconnected` como falha.
- **A3** — a captura de tela sobrevive à reconexão automática.
- **A4** — checagem de firewall compara o programa, não só a porta.
- **A5** — recusa compartilhar quando a fonte escolhida sumiu (não cai em `sources[0]`).
- **A6/A7** — `handleSignal` com try/catch; `myId` zera com a sessão.
- **B4/B5** — limite de payload e taxa no WebSocket; roteamento confinado à sala.
- **C1** — CI rodando `node --test` em push e PR (`.github/workflows/test.yml`).
- **G4** — `findFreeServer` fecha o `WebSocketServer` que falhou o bind.
- **H1** — sinalização caída vira sessão órfã, o vídeo continua.
- **H2** — relay eleito por saúde de encode, não só RTT.
- **H3** — malha degradada (preset desce um degrau) quando não há relay.
- **H4** — encode da tela degrada com o tamanho da sala.

(A1–A7, B4/B5, C1, G4, H1–H4 vieram no PR #17, `chore/robustez-e-higiene`,
mesclado e já embarcado nas tags 0.1.9 / 0.1.10.)

Testes: `npm test` → **171 passando**.

## Backlog técnico

Fonte única: **`docs/2026-08-27-auditoria-de-fragilidade.md`**. O que não foi
feito nesta branch e não está explicitamente fora de escopo (abaixo):
A8, B2, B3, C4, C5, C7, D2, F3, G5, G6, H5, H6.

## Fora de escopo (adiado de propósito)

Precisam de verificação manual rodando o app, ou de esforço de dias.

| Item | O que é | Por que ficou de fora |
|---|---|---|
| **B1** | Subir Electron (32 → atual) | Meio dia + verificação manual; flags de WGC e assinatura do `console-message` mudam entre versões e precisam de teste no app rodando. |
| **D1** | Extrair de `app.js` um módulo puro de orquestração de sessão/árvore | 1–2 dias de refatoração; ganho a prazo, não corrige bug aberto. |
| **G1–G3** | Áudio nativo em C++ (batching do IPC, cancelamento do `Stop()`, leak no `NonBlockingCall`) | Mexe em C++ nativo; só testável rodando o app com captura real. |
| **B6** | Assinatura de código do instalador | Escolha consciente (app entre amigos); custa certificado e processo. |
| **F1** | Acessibilidade (ARIA, `:focus-visible`) | Escopo de produto, não de robustez; sem harness pra validar. |

**F4** saiu desta tabela: o redesign "Superfície e sinal" já estava mesclado
desde 2026-08-23 (commit `51fc1f7`) — a auditoria de 2026-08-27 o listou como
"nada implementado" por engano (correção registrada no próprio arquivo). O que
restava era o mau uso do acento no ponto de status e a falta de estado visível
pra transmissão degradada, ambos feitos na Task 1 da branch
`feat/transmissao-honesta`.

Também adiado, registrado na auditoria (H5/H6): **SFU** e **encode-once
(WebCodecs)**. Plano B se, depois de H1–H4, a sala de 4 ainda quebrar.
