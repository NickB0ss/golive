# STATUS — GoLive LAN

Pra quem voltou ao projeto depois de um mês. Leitura de 30 segundos.
Para o passo a passo de uso e a instalação, ver `README.md`.

## O que o app faz hoje

Compartilhamento de tela em até 1080p60 entre amigos numa LAN virtual (Radmin
VPN / Tailscale). Sem servidor na nuvem, sem conta. Quem cria a sala sobe um
servidor de sinalização embutido no próprio processo; a mídia é P2P.

- Descoberta de salas na rede por beacon UDP (opcional, ligada por padrão).
- **Sala só aceita quem está na mesma versão do app.** O `join` carrega a
  `appVersion`; o servidor de sinalização de quem criou a sala recusa
  qualquer versão diferente (`join-denied`, motivo `version`, com as duas
  versões na resposta). A versão viaja também no beacon UDP, então a lista de
  salas da rede já marca a sala incompatível e desliga o botão antes do
  clique. Direção do aviso vem de `src/renderer/version.js` (quem tem de
  atualizar: você ou quem criou a sala).
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

`0.6.0` (`package.json`). Electron `^32` (fora de suporte — ver backlog),
`electron-builder` na `^26`.
Testes: `npm test` → **301 passando**. `npm run lint` → 0 erros, 10 avisos
`require-atomic-updates` (falsos positivos em `let` de módulo reatribuído
após `await`).

## Já lançado (em release com tag)

- **0.2.0** — qualidade adaptativa **por espectador**: escada de histerese por
  conexão, `receiveHealth` do espectador viajando no view-state, e a escada
  global parando de fundir a saúde dos relays.
- **0.3.0** — fechamento da adaptação: orçamento de uplink do relay por filho,
  loop de estatísticas rodando também num relay puro, banda disponível e perda
  real no painel.
- **0.3.1 – 0.3.4** — correções da escada: saúde de encode é só da tela (a
  câmera não contamina mais), a escada não vai ao piso só porque o codec é de
  software, e instrumentação do encode no log em arquivo.
- **0.4.0** ([PR #28](https://github.com/NickB0ss/golive/pull/28))
  — redesign completo da interface: dois estados explícitos, **Lobby** (criar,
  entrar por endereço, salas da rede, perfil) e **Sala** (palco + coluna de
  membros/banidos/chat recolhível), diálogos próprios de criar/entrar/banir,
  paleta índigo/vermelho/âmbar (`--act:#4F46E5` / `--live:#FF4D4F` /
  `--warn:#F5B544`); o selo de PIN no cabeçalho fecha a passada visual do B3.
  Grade de tiles, fullscreen, PiP e diálogo de compartilhar portados sem
  mudança de comportamento. **Chat de texto** com histórico de 50 (texto +
  linhas de sistema no mesmo ring buffer) guardado no servidor de sinalização,
  agrupado por autor, 5 msg/s e 500 caracteres por mensagem. **Moderação pelo
  dono** — `ownerToken` gerado por sala que nunca sai da máquina, autorização
  só no servidor; **parar transmissão** (pedido, socket segue aberto),
  **expulsar** (1008, pode reentrar) e **banir** (barra por `clientId` + IP,
  loopback de fora; confirmação com foco no Cancelar; lista "Banidos" com
  "Readmitir"). O bloqueio é cooperativo (sinalização + clientes), não é
  garantia criptográfica. **Quatro sons novos** (chat, ao vivo, transmissão
  parada, removido) + interruptor mestre em Configurações. Conhecido: o menu ⋮
  de membro ainda não navega por teclado (item **F1**, adiado). Chegou junto,
  já mesclado antes desta versão ([PR #26](https://github.com/NickB0ss/golive/pull/26)):
  a dívida das 10 promessas soltas do ESLint paga (viraram `.catch()` ou
  `void` comentado, nunca `await` — mudaria ordem de execução), um frame de
  sinalização que não é objeto (`JSON.parse('null')`) parando de derrubar o
  host, teto de 64 em `watchers`/`kind` do rebroadcast, testes de invariantes
  de `computeTree` sob 1000 salas aleatórias e fuzz de 200 frames tortos, e
  `electron-builder` 25 → 26 (`npm audit` de 15 pra 2 vulnerabilidades).
- **0.5.0** ([PR #30](https://github.com/NickB0ss/golive/pull/30)) — replaneja
  o lobby do zero como layout de desktop: três faixas (topbar / corpo / barra
  do usuário) com duas colunas — ações à esquerda (380px fixos: hero, os dois
  CTAs, e o **endereço desta máquina na rede virtual**, que antes só aparecia
  depois de criar a sala) e salas descobertas à direita em cards com avatar
  por endereço, cadeado SVG e estado vazio explicado. Empilha abaixo de
  1040px de janela. **"Anunciar na rede" saiu de Configurações** e virou
  opção do diálogo de criar sala — é propriedade da sala, decidida na hora de
  criá-la; a aba Rede de Configurações foi removida. Botão **"Criar" com
  progresso** (spinner + "Criando sala…", confirmar/cancelar desabilitados
  enquanto o firewall do Windows pode estar pedindo elevação). **Checkbox
  virou componente** (caixa desenhada, título + descrição, linha inteira
  clicável — o `<input>` real segue lá, só `opacity: 0`, pro teclado e pro
  leitor de tela). **Nome longo não estoura mais nem cria barra horizontal**
  — causa raiz era a regra base de `button` trazendo `align-items: center`,
  que num container coluna é o eixo horizontal e impedia os filhos de
  esticar até a largura do card. Diálogo de compartilhar com **tag de
  qualidade por tela** (`4K`/`1440p`/`1080p`/`720p`), ícone do app por
  janela, ordenação determinística, contador por aba e presets em chips no
  lugar do `<select>` nativo. **Grade de tiles por contagem** (1 / 2 / 3–4 /
  5–6 / 7+) com trilhas `min-content` + `align-content: safe center`, em vez
  de `auto-fit` (que deixava tile órfão ocupando meia tela) e de `1fr` (que
  empilhava toda a folga vertical numa fileira só). Barra de rolagem com
  estilo global fino e escuro. Nenhum arquivo de transporte tocado.
- **0.6.0** ([PR #32](https://github.com/NickB0ss/golive/pull/32), **pré-release**)
  — **trava de versão de sala**: a sala recusa quem não está exatamente na
  versão de quem a criou (`join-denied {reason:'version'}` + close 1008,
  checado logo depois do ban e antes do PIN; a versão viaja no beacon UDP,
  então o card da sala incompatível já aparece apagado, sem clique e com selo).
  Protocolo de sinalização, formato da árvore de retransmissão e negociação
  P2P mudam entre releases sem acordo de compatibilidade — sala com versões
  misturadas quebrava parecendo problema de rede. **Barra única no topo do
  lobby** — era topbar + barra do usuário no rodapé, com dois botões de
  Configurações; virou uma faixa só de borda a borda (marca à esquerda;
  perfil, buscar atualização e Configurações à direita). `#btn-open-settings-2`
  e a classe `.icon-btn` (sem elemento) saíram. Novo `src/renderer/version.js`
  (parte pura: comparar + redigir o aviso), +15 testes.
- **0.1.x** — F2 (árvore sempre ligada), A1–A7, B4/B5, C1–C3, C6, G4, H1–H4.
  Detalhe por item na auditoria e no histórico do git.

## Backlog técnico

Fonte única: **`docs/2026-08-27-auditoria-de-fragilidade.md`**. O que não foi
feito e não está explicitamente fora de escopo (abaixo): **C5, F3, G6, H5,
H6** e o resto do **B2**.

Sobre o **B2**: a premissa da auditoria ("14 vulnerabilidades, todas na cadeia
do `node-gyp@9`") não vale mais. Com o `node-gyp` da raiz na 11 **e o
`electron-builder` na 26**, `npm audit` cai a **2** — e as 2 são o
`electron@32` (e o `extract-zip` dele). Zerar exige subir `electron 32 → 44`,
o que é o item **B1** e precisa do app rodando. `npm audit --omit=dev`
sempre esteve em **0**: nada disso alcança quem usa o app.

**F3** (host cai, sala morre) e **G6** (teto de ~4 pessoas) são "confirmado,
por desenho" — limites conhecidos, não bugs. **B3** (sala sem autenticação)
saiu dessa lista de vez: núcleo, protocolo e UI (caixa, campo de PIN, cadeado
na lista, selo no cabeçalho) foram lançados na 0.4.0.

**C4** (`dist/` de 1,2 GB) é higiene de disco local. **C5** (branches
obsoletas) segue aberto: `claude/backlog-pos-leyjak`,
`claude/planejamentos-futuros-projeto-leyjak` e `claude/redesign-discord-style`
já estão inteiramente mescladas na `main` e só precisam ser apagadas do
remoto.

## Fora de escopo (adiado de propósito)

Precisam de verificação manual rodando o app, ou de esforço de dias.

| Item | O que é | Por que ficou de fora |
|---|---|---|
| **B1** | Subir Electron (32 → 44) | Meio dia + verificação manual; flags de WGC e assinatura do `console-message` mudam entre versões e precisam de teste no app rodando. Fecha as 2 vulnerabilidades que sobram no `npm audit`. |
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
