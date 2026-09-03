# STATUS — GoLive LAN

Pra quem voltou ao projeto depois de um mês. Leitura de 30 segundos.
Para o passo a passo de uso e a instalação, ver `README.md`.

## O que o app faz hoje

Compartilhamento de tela em até 1080p60 entre amigos numa LAN virtual (Radmin
VPN / Tailscale). Sem servidor na nuvem, sem conta. Quem cria a sala sobe um
servidor de sinalização embutido no próprio processo; a mídia é P2P.

- Descoberta de salas na rede por beacon UDP (opcional, ligada por padrão).
- PIN opcional de 4 dígitos na sala (opt-in em "Criar sala"): corta o
  entrar-por-acidente numa rede compartilhada. Não é cripto.
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

`0.3.4` (`package.json`). Electron `^32` (fora de suporte — ver backlog),
`electron-builder` na `^26`.
Testes: `npm test` → **266 passando**. `npm run lint` → 0 erros, 10 avisos
`require-atomic-updates` (falsos positivos em `let` de módulo reatribuído
após `await`).

## Em andamento

Branch **`claude/backlog-pos-leyjak`**: o que restava do backlog depois que a
leva `leyjak` (A8/D2/G5/C7/B2, [PR #25](https://github.com/NickB0ss/golive/pull/25))
entrou na `main`. Tudo coberto por teste, sem rodar o app à mão.

- **Promessas soltas (dívida do C7)** — as 10 que o ESLint acusava como aviso
  viraram `.catch()` com log por sítio (mesmo padrão do resto do renderer),
  ou `void` com comentário onde a função já engole o próprio erro por
  desenho. Nenhuma virou `await` (mudaria ordem de execução — era o motivo de
  serem aviso). Restam só os 10 avisos `require-atomic-updates`, outra regra.
- **Sinalização — frame que não é objeto derrubava o host** — `JSON.parse('null')`
  passava, e o `switch (msg.type)` lia `.type` de `null`: TypeError sem catch,
  `uncaughtException`, processo do host morto. Um frame `null` de qualquer um
  que alcançasse a porta bastava. Agora todo frame que não é objeto é
  descartado igual a JSON malformado. `watchers`/`kind` do rebroadcast também
  passaram a ter teto (64) — eram repassados à sala inteira sem limite.
- **Robustez (além da auditoria)** — teste de invariantes de `computeTree`
  sob 1000 salas aleatórias (≤1 relay, fanout ≤2, profundidade ≤2, ninguém é
  pai de si); fuzz de 200 frames tortos na sinalização confirmando que a sala
  segue aceitando `join`.
- **B2 (parcial)** — `electron-builder` 25 → 26. `npm audit` cai de 15 pra 2.
  As 15 vinham quase todas do 25 (`@electron/rebuild@3` → `node-gyp@≤10.3.1`,
  `cacache`, `tar` velho). As 2 que sobram são o `electron@32` em si — o B1.
  **`npm run dist` não foi rodado**: validar um build antes da próxima release.
- **B3 — PIN opcional da sala** — o núcleo e o protocolo (servidor recusa
  `join` sem o PIN certo com `join-denied` + close 1008; beacon carrega só o
  flag `protected`, nunca o PIN; `main` gera o PIN de 4 dígitos quando a caixa
  "Proteger com PIN" está marcada). Tudo opt-in — sala aberta segue idêntica.
  **A UI (caixa, campo de PIN, cadeado na lista, selo no cabeçalho) precisa de
  uma passada visual com o app rodando**; a lógica está coberta por teste.

Branch **`claude/chat-e-moderacao`**: redesign completo da interface, mais chat
de texto e moderação pelo dono da sala. Ainda não mesclada. `npm test` → **283
passando**, `npm run lint` → 0 erros (os mesmos 10 avisos `require-atomic-updates`).
Exercitada com o app rodando — duas instâncias / peer de teste por CDP —, sem
`npm run dist` (fora do escopo da spec).

- **Redesign — Lobby e Sala** — a interface passou a ter dois estados
  explícitos: o **Lobby** (fora de sala: criar, entrar por endereço, lista das
  salas descobertas na rede, perfil no rodapé) e a **Sala** (palco à esquerda,
  coluna de membros/banidos/chat à direita, recolhível). Diálogos próprios pra
  criar a sala (com a opção "Proteger com PIN") e pra entrar (o campo de PIN só
  aparece quando a sala pede). Paleta nova índigo/vermelho/âmbar (`--act:#4F46E5`
  ação, `--live:#FF4D4F` ao vivo, `--warn:#F5B544` aviso); o PIN da sala aparece
  num selo no cabeçalho — a "passada visual" que faltava no B3. A grade de
  tiles, o fullscreen, o PiP arrastável e o diálogo de compartilhar foram
  portados sem mudança de comportamento.
- **Chat de texto** — uma mensagem por linha, agrupadas por autor (avatar só na
  primeira de cada grupo), com linhas de sistema pra entrada, saída e cada ação
  de moderação. O servidor de sinalização guarda as últimas 50 entradas (texto
  e sistema no mesmo ring buffer) e entrega esse histórico a quem entra;
  reconectar recarrega o histórico sem duplicar. Teto de 5 mensagens/s por
  participante (não fecha o socket) e de 500 caracteres por mensagem.
- **Moderação pelo dono** — quem cria a sala recebe um **token de dono** gerado
  por sala (`ownerToken`), que nunca sai da máquina e volta no `join`; o
  servidor marca esse participante como dono por igualdade estrita (string
  vazia nunca marca). O dono tem três poderes: **parar a transmissão** de
  alguém (é um pedido — o socket segue aberto e a pessoa pode voltar a
  compartilhar), **expulsar** (fecha o socket com 1008; pode reentrar) e
  **banir** (fecha o socket e barra o reingresso por `clientId` + IP, com o
  loopback de fora pra o dono não se autobanir). Banir pede confirmação com
  foco no Cancelar; o banido entra numa lista "Banidos" com botão "Readmitir".
  Expulso ou banido volta pro lobby sozinho.
- **Quatro sons novos** — além de entrada/saída: mensagem no chat (o mais
  discreto, só com a janela fora de foco e no máximo 1x a cada 2s), alguém
  começou a transmitir, o dono parou a sua transmissão, e você foi removido da
  sala. O interruptor "Sons do app" em Configurações › Voz e Vídeo corta todos
  de uma vez, entrada/saída incluídas.

**Pendências desta branch** (não travam a lógica, que está coberta por teste e
verificação com o app rodando): quando a sinalização cai, a faixa âmbar do chat
e o bloqueio do campo de digitar não aparecem — `ui.chat.setEnabled` existe mas
não chega a ser chamada pelo `app.js` (o cabeçalho já mostra "reconectando…" e
o histórico volta certo na reconexão); e o menu ⋮ de cada membro não é
navegável por teclado (itens `role="menuitem"` sem `tabindex`, sem seta),
alinhado ao item **F1** de acessibilidade que já está adiado.

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
feito e não está explicitamente fora de escopo (abaixo): **C5, F3, G6, H5,
H6**, o resto do **B2** e a UI do **B3**.

Sobre o **B2**: a premissa da auditoria ("14 vulnerabilidades, todas na cadeia
do `node-gyp@9`") não vale mais. Com o `node-gyp` da raiz na 11 **e o
`electron-builder` na 26**, `npm audit` cai a **2** — e as 2 são o
`electron@32` (e o `extract-zip` dele). Zerar exige subir `electron 32 → 44`,
o que é o item **B1** e precisa do app rodando. `npm audit --omit=dev`
sempre esteve em **0**: nada disso alcança quem usa o app.

**F3** (host cai, sala morre) e **G6** (teto de ~4 pessoas) são "confirmado,
por desenho" — limites conhecidos, não bugs. **B3** (sala sem autenticação)
saiu dessa lista: o PIN opcional está feito no núcleo (ver "Em andamento"),
falta só a passada visual na UI.

**C4** (`dist/` de 1,2 GB) e **C5** (branches obsoletas) são higiene de disco
e de repositório local — o repo remoto já está enxuto (só `main`).

A **dívida das 10 promessas soltas** foi paga nesta branch (ver "Em
andamento").

## Fora de escopo (adiado de propósito)

Precisam de verificação manual rodando o app, ou de esforço de dias.

| Item | O que é | Por que ficou de fora |
|---|---|---|
| **B1** | Subir Electron (32 → 44) | Meio dia + verificação manual; flags de WGC e assinatura do `console-message` mudam entre versões e precisam de teste no app rodando. Fecha as 2 vulnerabilidades que sobram no `npm audit`. |
| **B3 (UI)** | Caixa "Proteger com PIN", campo de PIN, cadeado na lista, selo do PIN no cabeçalho | O núcleo e o protocolo estão feitos e cobertos por teste; falta conferir layout/foco com o app rodando. |
| **`npm run dist` pós-`electron-builder@26`** | Rodar um build completo | O 26 muda default de scripts de pacote e nomes de artefato; não dá pra validar sem gerar o instalador. |
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
