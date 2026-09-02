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

`0.3.4` (`package.json`). Electron `^32` (fora de suporte — ver backlog).
Testes: `npm test` → **256 passando**. `npm run lint` → 0 erros.

## Em andamento

Branch **`claude/planejamentos-futuros-projeto-leyjak`**: pega o que sobrou
do backlog da auditoria e que dá pra fechar sem rodar o app à mão.

- **A8** — renegociação reusa a conexão em vez de trocá-la. `ensureInConn`
  fechava e recriava a `RTCPeerConnection` a cada oferta; numa reoferta na
  conexão que já existe isso responde com ufrag ICE e fingerprint DTLS novos,
  que o ofertante não espera. A oferta agora carrega `renegotiate`, e só
  reusa quando há conexão viva num `signalingState` que aceita oferta. Peer
  em versão antiga não manda o campo e cai no caminho antigo.
- **D2** — teste ponta a ponta da sinalização: servidor de verdade, clientes
  `ws` reais, `join → welcome → offer → answer → ice` inteiro pelo fio. Sete
  casos, incluindo ordem preservada numa rajada (a garantia em que o cliente
  se apoia, e o que teria pego o A1), isolamento de sala com controle
  positivo, teto de payload e flood.
- **G5** — thumbnail do seletor de fonte em JPEG, não PNG. Era um PNG
  codificado por janela no processo principal, no clique em que a pessoa vai
  começar a transmitir.
- **C7** — ESLint com config flat por ambiente e passo no CI antes dos
  testes. Inclui uma regra local que aproxima o `no-floating-promises` sem
  type info: pega `.then()` sem catch e chamada de função `async` do próprio
  arquivo usada como statement. **Não** pega chamada vinda de fora do
  arquivo — é rede de segurança, não garantia.
- **B2** — `node-gyp` 9.4.1 → 11.5.0 (o advisory cobre até a 10.3.1, então o
  "10+" da auditoria já não bastava). Ver a ressalva no backlog.

**Já lançado** (em release com tag):

- **0.2.0** — qualidade adaptativa **por espectador**: escada de histerese por
  conexão, `receiveHealth` do espectador viajando no view-state, e a escada
  global parando de fundir a saúde dos relays.
- **0.3.0** — fechamento da adaptação: orçamento de uplink do relay por filho,
  loop de estatísticas rodando também num relay puro, banda disponível e perda
  real no painel.
- **0.3.1 – 0.3.4** — correções da escada: saúde de encode é só da tela (a
  câmera não contamina mais), a escada não vai ao piso só porque o codec é de
  software, e instrumentação do encode no log em arquivo.
- **0.1.x** — F2 (árvore sempre ligada), A1–A7, B4/B5, C1–C3, C6, G4, H1–H4.
  Detalhe por item na auditoria e no histórico do git.

## Backlog técnico

Fonte única: **`docs/2026-08-27-auditoria-de-fragilidade.md`**. O que não foi
feito e não está explicitamente fora de escopo (abaixo): **B3, C4, C5, F3,
G6, H5, H6** — e o resto do **B2**.

Sobre o **B2**: a premissa da auditoria ("14 vulnerabilidades, todas na cadeia
do `node-gyp@9`") não vale mais. Com o `node-gyp` da raiz na 11, as 15 que
sobram vêm do `electron@32`, do `electron-builder@25` e de uma cópia aninhada
do `node-gyp@9` que o `@electron/rebuild` fixa. Zerar exige subir dois majors
(`electron 32 → 44`), o que é o item **B1** e precisa do app rodando.
`npm audit --omit=dev` continua em **0**: nada disso alcança quem usa o app.

**B3** (sala sem autenticação), **F3** (host cai, sala morre) e **G6** (teto de
~4 pessoas) são "confirmado, por desenho" — limites conhecidos, não bugs.

Dívida nova, deixada visível de propósito: as **10 promessas soltas** que o
ESLint acusa como aviso (`src/main.js`, `src/renderer/app.js`,
`src/renderer/ui.js`). Não viraram erro porque transformar cada uma em `await`
muda ordem de execução de handler de clique e do bootstrap, e um `catch` vazio
só esconderia a falha.

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
