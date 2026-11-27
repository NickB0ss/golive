# Pipeline nativo de transmissão (captura, encode e transporte próprios)

**Objetivo:** a imagem de um jogo pesado chegar a quem assiste a 60 fps estáveis,
sem passar pelo renderer, pelo canvas nem pela cópia para a CPU do Chromium.
**Base:** `c5c7104` (branch `claude/focused-clarke-2pakf3`, sobre a 0.28.1).
**Especificação:** `docs/2026-11-25-reavaliacao-compartilhamento-jogos.md`.
**Decisões e problemas:** `docs/decisoes-e-problemas/` (índice no `README.md` de lá).

## Comece aqui (próxima sessão)

1. Ler este arquivo inteiro e o índice de `docs/decisoes-e-problemas/`.
2. O passo atual é o **P0.1** (precisa de Windows). P1.1, P2.1 e P2.2 já foram adiantados
   na nuvem (27/11); sem Windows, o próximo é o **P2.3**. Ver `docs/2026-11-27-continuar-daqui.md`.
   O passo de medição continua sendo o **P0.1**. Os passos de código só começam depois de
   P0.1 e P0.2 terem resultado registrado, porque o P0.2 diz se a Fase 0 sozinha
   já resolveu parte do problema.
3. Se não houver um PC Windows com jogo disponível na sessão, dá para
   adiantar o **P1.1** e o **P2.1**, que não dependem de medição.
4. A cada passo concluído, marcar o `[x]`, anotar o resultado em uma linha
   na seção "Registro" do fim deste arquivo, e criar ou atualizar a nota
   correspondente em `docs/decisoes-e-problemas/`.

## Restrições globais

- O caminho WebRTC atual continua funcionando e é o padrão até a Fase 2 ser
  aprovada. O nativo entra como opção experimental, com volta automática.
- Sem bibliotecas de terceiros no pipeline nativo: só Windows SDK
  (WGC, D3D11, Media Foundation, Winsock). Ver [[D-04-so-apis-do-windows|D-04]].
- O protocolo de sinalização e a trava de versão continuam valendo: sala só
  com a mesma versão, então não há compatibilidade entre versões a manter.
- Texto visível só por `t()`, nas três línguas (regra de `src/renderer/AGENTS.md`).
- `npm test` e `npm run lint` verdes em todo commit.
- Cada medição com jogo: mesma cena com movimento, 3 repetições, anotar
  jogo, resolução, FPS do jogo, uso de GPU e FPS recebido.

## Visão geral das fases

| Fase | O que entrega | Muda o app para o usuário? | Portão para seguir |
|---|---|---|---|
| 0 | Prioridade de GPU/CPU durante a transmissão (código pronto) | Sim, já na próxima versão | Medição A/B com jogo |
| 1 | `golive-media.exe` que captura e codifica em arquivo | Não (ferramenta de bancada) | 1080p60 sob jogo a 99% de GPU |
| 2 | Transporte UDP 1:1 + decode WebCodecs + opção experimental | Sim, opt-in | Multi-PC melhor que WebRTC |
| 3 | Árvore repassando pacotes sem re-encode | Sim, opt-in | 1, 2 e 4 espectadores |
| 4 | Empacotamento, robustez e virar padrão | Sim | Uma semana de uso real |

---

## Fase 0 — Prioridade de GPU (implementada, falta validar)

Código: `native/src/gpu_priority.cc`, `src/main/gpupriority.js`, ligação em
`src/main.js` (`applyKeepAwake`). Decisões: [[D-01-prioridade-gpu-high|D-01]], [[D-02-prioridade-segue-keep-awake|D-02]]. Problema: [[P-01-gpu-saturada-pelo-jogo|P-01]].

### P0.1 — Compilar e conferir no Windows
- **O que faz:** gera o `golive_audio.node` com a função nova e confirma que
  a prioridade é aplicada de verdade.
- **Passos:**
  - [ ] `npm run build:native` no Windows (MSVC). Só a sintaxe foi conferida com MinGW.
  - [ ] `npm start`, entrar numa sala e compartilhar a tela.
  - [ ] Achar no log a linha `[gpu] prioridade high: …` e conferir `ok(lida=4)` no `GPU` e no `Browser`.
  - [ ] Parar de compartilhar e conferir `[gpu] prioridade normal restaurada em N processo(s)`.
  - [ ] Opcional: conferir no Process Explorer a prioridade "Acima do normal" nos processos do app.
- **Se falhar:** `falhou(0xc0000061)` é falta de privilégio; testar como
  administrador e registrar em [[P-08-prioridade-high-pode-exigir-privilegio|P-08]]. `sem-acesso(win32=5)` em algum
  processo é o sandbox do Chromium recusando `OpenProcess`; anotar qual tipo.
- **Pronto quando:** a linha aparece com `ok` no `GPU`, no `Browser` e no renderer principal.

### P0.2 — Medição A/B com jogo real
- **O que faz:** mede se a prioridade melhora o FPS entregue e quanto custa no jogo.
- **Passos:**
  - [ ] Cenário: 2 PCs, 1080p60, Fortnite e Dead by Daylight, GPU perto de 99%.
  - [ ] Rodar com `GOLIVE_PRIORIDADE_GPU=off` (3×) e sem a variável (3×).
  - [ ] Anotar por rodada: `cap=` médio da linha `[diag]` na origem, FPS recebido, FPS do jogo.
  - [ ] Repetir uma rodada com `GOLIVE_PRIORIDADE_GPU=realtime` só para medir (não é o padrão, ver [[D-01-prioridade-gpu-high|D-01]]).
  - [ ] Repetir uma rodada com o FPS do jogo limitado para ~85% de GPU, sem a variável.
- **Pronto quando:** a tabela está no "Registro" deste arquivo e em [[P-01-gpu-saturada-pelo-jogo|P-01]].

### P0.3 — Decidir o padrão
- **O que faz:** fecha a classe padrão com base no P0.2.
- **Passos:**
  - [ ] HIGH ajudou e o custo no jogo é aceitável → manter, atualizar [[D-01-prioridade-gpu-high|D-01]] para "validada".
  - [ ] HIGH não muda nada → registrar; a Fase 1 passa a ser obrigatória.
  - [ ] REALTIME muito melhor e sem travar → avaliar com cuidado (ver [[P-09-realtime-pode-travar-nvenc|P-09]]).
- **Pronto quando:** [[D-01-prioridade-gpu-high|D-01]] tem status final.

### P0.4 — Lançar
- **O que faz:** sai numa versão para os amigos usarem.
- **Passos:**
  - [ ] Bump de versão, `npm run release:check`, notas do release citando o custo de FPS no jogo.
  - [ ] Opcional: mostrar no painel de estatísticas "Prioridade de GPU: alta / normal / indisponível"
        (i18n nas três línguas). Precisa de um IPC novo `gpu:prioridade-estado`.
- **Pronto quando:** release publicado.

---

## Fase 1 — Spike de captura e encode nativos

Prova que a imagem consegue ir da captura ao encoder sem sair da GPU, a
60 fps, com o jogo saturando a GPU. Só grava em arquivo: ainda sem rede.
Decisões: [[D-03-processo-auxiliar-golive-media|D-03]], [[D-04-so-apis-do-windows|D-04]], [[D-05-spike-em-arquivo-antes-da-rede|D-05]]. Problemas: [[P-02-captura-do-chromium-passa-pela-cpu|P-02]], [[P-07-duas-gpus-e-desktop-duplication|P-07]].

### P1.1 — Esqueleto do `golive-media.exe`
- **O que faz:** cria o processo auxiliar e o jeito de compilar.
- **Passos:**
  - [x] Pasta `native/media/` com `main.cc` e o protocolo de linha de comando:
        `--janela <hwnd> | --monitor <indice>`, `--fps`, `--kbps`, `--saida <arquivo.h264>`, `--segundos`.
  - [x] Saída de métricas: uma linha JSON por segundo no stdout (ver P1.6). Erros no stderr.
  - [x] Controle pelo stdin, uma linha JSON por comando: `{"cmd":"keyframe"}`,
        `{"cmd":"kbps","valor":6000}`, `{"cmd":"parar"}`. Serve para a Fase 2.
  - [x] Build: tentar um segundo target `"type": "executable"` no `binding.gyp`, para usar o mesmo
        `npm run build:native`. Se o node-gyp atrapalhar (hook de delay-load, flags de addon),
        usar um `CMakeLists.txt` só para o exe e registrar a escolha numa nota nova `D-11`.
  - [x] `.gitignore` e `scripts/check-environment.js` cientes do exe novo.
- **Não faz:** captura nem encode ainda; só sobe, lê argumentos, responde `parar` e sai com código 0.
- **Pronto quando:** `golive-media.exe --segundos 2` sai com 0 e imprime 2 linhas JSON.

### P1.2 — Dispositivo D3D11 com prioridade
- **O que faz:** cria o dispositivo de GPU certo, já com prioridade alta.
- **Passos:**
  - [ ] Escolher o adaptador do monitor capturado (LUID via `IDXGIOutput`), não o adaptador 0.
        Há PCs com duas GPUs iguais ([[P-07-duas-gpus-e-desktop-duplication|P-07]]).
  - [ ] `D3D11CreateDevice` com `D3D11_CREATE_DEVICE_VIDEO_SUPPORT | BGRA_SUPPORT`.
  - [ ] `IDXGIDevice::SetGPUThreadPriority(7)` e `D3DKMTSetProcessSchedulingPriorityClass(HIGH)`
        no próprio processo (reaproveitar `gpu_priority.cc`).
  - [ ] `ID3D10Multithread::SetMultithreadProtected(TRUE)` (a captura chega em outra thread).
- **Pronto quando:** a métrica imprime o nome do adaptador e a prioridade lida de volta.

### P1.3 — Captura WGC
- **O que faz:** recebe os quadros do jogo como textura, sem cópia para a CPU.
- **Passos:**
  - [ ] C++/WinRT (já vem no Windows SDK): `GraphicsCaptureItem` a partir do HWND
        (`IGraphicsCaptureItemInterop::CreateForWindow`) e do HMONITOR (`CreateForMonitor`).
  - [ ] `Direct3D11CaptureFramePool::CreateFreeThreaded` com 2 buffers, `BGRA8`.
  - [ ] `IsBorderRequired(false)` quando disponível (Windows 11) e `IsCursorCaptureEnabled(true)`.
  - [ ] Tratar `FrameArrived`: pegar a textura, copiar para uma textura própria (`CopyResource`, na GPU)
        e soltar o quadro do pool na hora.
  - [ ] Mudança de tamanho da janela: recriar o pool com o tamanho novo.
  - [ ] Mapear a fonte escolhida no app para HWND/HMONITOR: janela já vem como
        `window:<hwnd>:0` (ver `audio:pidForSource` em `main.js`); monitor precisa casar o
        `display_id` do Electron com o HMONITOR (`EnumDisplayMonitors` + nome do dispositivo).
- **Não faz:** fallback por Desktop Duplication (fica para a Fase 4 se precisar).
- **Pronto quando:** com o jogo aberto, a métrica `captura.fps` acompanha o FPS do jogo até o teto pedido.

### P1.4 — Conversão BGRA → NV12 na GPU
- **O que faz:** converte para o formato que o encoder de hardware come.
- **Passos:**
  - [ ] `ID3D11VideoDevice` + `ID3D11VideoProcessor`, entrada BGRA, saída NV12 no tamanho alvo
        (aqui também mora a redução 1080p→720p da escada de qualidade).
  - [ ] Pool de 3–4 texturas NV12 de saída, reaproveitadas.
  - [ ] Espaço de cor BT.709, faixa limitada (o que o H.264 sinaliza por padrão).
- **Pronto quando:** `conversao.ms` p95 < 2 ms com o jogo aberto.

### P1.5 — Encoder MFT de hardware
- **O que faz:** codifica H.264 na placa (NVENC, AMF ou QSV) a partir da textura NV12.
- **Passos:**
  - [ ] `MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER)`
        filtrando pelo LUID do adaptador (`MFT_ENUM_ADAPTER_LUID`).
  - [ ] `IMFDXGIDeviceManager` com o dispositivo do P1.2; MFT assíncrono
        (`METransformNeedInput` / `METransformHaveOutput`).
  - [ ] `ICodecAPI`: `AVLowLatencyMode=true`, `AVEncCommonRateControlMode=CBR`,
        `AVEncCommonMeanBitRate`, `AVEncMPVGOPSize` longo, `AVEncMPVDefaultBPictureCount=0`,
        perfil High ou Main.
  - [ ] Keyframe sob pedido: `CODECAPI_AVEncVideoForceKeyFrame` ao receber `{"cmd":"keyframe"}`.
  - [ ] Mudança de bitrate ao vivo com `{"cmd":"kbps"}`.
  - [ ] Saída Annex B (com SPS/PPS em todo IDR) gravada no arquivo do `--saida`.
  - [ ] Se nenhum MFT de hardware existir: sair com erro claro (código 3). Sem encoder de software aqui.
- **Pronto quando:** o `.h264` gerado abre no VLC/ffplay sem artefatos, e `encode.ms` p95 < 8 ms.

### P1.6 — Métricas e bancada
- **O que faz:** mede cada etapa no mesmo relógio, para comparar com o caminho atual.
- **Passos:**
  - [ ] Linha JSON por segundo: `captura.fps`, `conversao.fps`, `encode.fps`,
        p50/p95 de `conversao.ms` e `encode.ms`, `idade_ultimo_quadro_ms`, `descartados`, `kbps_reais`.
  - [ ] Fila máxima de 2 quadros entre captura e encode; se o encoder atrasar, descarta o mais
        antigo e conta em `descartados` (nunca acumular atraso).
  - [ ] `tools/media-nativo/rodar.js`: sobe o exe, coleta as linhas, gera resumo
        (média, p95, minutos abaixo de 55 fps) em `lab-out/media-nativo/<data>.json`.
- **Pronto quando:** uma rodada de 5 min gera o resumo sem intervenção.

### P1.7 — Medição e portão de decisão
- **O que faz:** decide se vale construir a Fase 2.
- **Passos:**
  - [ ] Mesmas cenas do P0.2, com o GoLive atual transmitindo e o exe gravando, um de cada vez.
  - [ ] Comparar `encode.fps` do exe com o `cap=` do app na mesma cena.
- **Portão:** 1080p60 com p95 de encode < 16 ms e nenhum minuto abaixo de 55 fps em 5 min,
  nos dois jogos. Passou → Fase 2. Não passou → registrar em [[P-02-captura-do-chromium-passa-pela-cpu|P-02]] o que segurou
  (captura? conversão? encode?) antes de qualquer outra coisa.

---

## Fase 2 — Transporte UDP próprio, 1:1

Leva o H.264 do exe até quem assiste, pela LAN virtual, e mostra no tile.
Decisões: [[D-06-transporte-udp-proprio|D-06]], [[D-07-decode-webcodecs-no-receptor|D-07]], [[D-08-audio-continua-no-webrtc|D-08]], [[D-09-webrtc-continua-como-fallback|D-09]], [[D-10-recepcao-udp-no-main|D-10]].

### P2.1 — Especificar o protocolo
- **O que faz:** escreve o contrato antes do código, em `docs/superpowers/specs/<data>-protocolo-video-nativo.md`.
- **Conteúdo obrigatório:**
  - [x] Cabeçalho (versão, tipo, sessão, sequência, número do quadro, fragmento i/n, flags keyframe/fim).
  - [x] Tipos: `VIDEO`, `FEC`, `NACK`, `PEDIR_KEYFRAME`, `RELATORIO` (perda, atraso, kbps recebidos), `OLA`, `TCHAU`.
  - [x] Tamanho máximo de pacote ~1200 bytes (cabe no MTU do Radmin/Tailscale).
  - [x] Autenticação: chave por sessão trocada pela sinalização; HMAC curto em cada pacote. Sem
        isso, qualquer um na LAN virtual injeta vídeo na tela de outro.
  - [x] Porta: uma UDP por sala, anunciada pela sinalização.
- **Pronto quando:** a spec está revisada e cada campo tem tamanho e regra de validação.

### P2.2 — Empacotar e remontar
- **O que faz:** quebra cada quadro em pacotes no envio e remonta na recepção.
- **Passos:**
  - [x] Envio em C++ dentro do exe (Winsock, um socket UDP), com pacing: espalhar os pacotes de
        um quadro em ~2 ms em vez de rajada.
  - [x] Recepção em JS puro, módulo novo `src/main/videonativo/remontar.js`, testável no `node --test`:
        pacotes fora de ordem, duplicados, perdidos, quadro incompleto vencido.
  - [x] Testes cruzados: vetor de pacotes gerado pelo C++ e lido pelo JS.
- **Pronto quando:** os testes cobrem perda, reordenação e duplicação.

### P2.3 — Recuperação de perda
- **O que faz:** recupera pacote perdido sem pedir keyframe a toda hora.
- **Passos:**
  - [ ] Buffer de reenvio no exe (últimos ~300 ms).
  - [ ] Receptor pede `NACK` uma vez por pacote faltante, depois de um curto tempo de espera.
  - [ ] FEC XOR simples por grupo (1 pacote de paridade a cada N, N configurável).
  - [ ] Sem como recuperar → `PEDIR_KEYFRAME`, no máximo 1 a cada 500 ms.
- **Pronto quando:** com 2% de perda simulada, o vídeo segue sem keyframe em mais de 95% dos quadros.

### P2.4 — Controle de taxa
- **O que faz:** ajusta o bitrate do encoder à rede, como a escada atual faz.
- **Passos:**
  - [ ] Receptor manda `RELATORIO` a cada 200 ms (perda, atraso de chegada relativo).
  - [ ] Regra no lado do envio: perda > 5% ou atraso subindo → −20%; folga por 5 s → +10% até o teto.
  - [ ] Reaproveitar o teto e a escada de resolução de `autoquality.js` / `capturequality.js` quando fizer sentido.
- **Pronto quando:** com banda limitada artificialmente, o atraso volta ao normal em menos de 3 s.

### P2.5 — Receptor com WebCodecs
- **O que faz:** decodifica na placa de quem assiste e mostra no tile existente.
- **Passos:**
  - [ ] Main recebe UDP (`dgram`), remonta e entrega quadros ao renderer por `MessagePort`
        (ArrayBuffer transferido, sem cópia).
  - [ ] Renderer: `VideoDecoder` com `hardwareAcceleration: 'prefer-hardware'`, `codec` derivado do SPS.
  - [ ] Quadros decodificados vão para um `MediaStreamTrackGenerator` e a track entra no `<video>`
        do tile, para o resto da interface (tela cheia, rabisco, estatísticas) não mudar.
  - [ ] Erro de decode ou buraco de referência → `PEDIR_KEYFRAME`.
- **Pronto quando:** 1080p60 de um `.h264` gravado no P1 toca liso num tile, vindo de um script de envio.

### P2.6 — Ligar na sala
- **O que faz:** combina o modo nativo pela sinalização e abre o caminho de rede.
- **Passos:**
  - [ ] Mensagens novas na sinalização: oferta do modo nativo, porta, chave da sessão.
        Mexer em `server/signaling-core.js` com testes, como as mensagens existentes.
  - [ ] Main sobe o `golive-media.exe` ao começar a transmitir no modo nativo e o derruba ao parar.
  - [ ] Regra de firewall UDP para a porta (reaproveitar `src/main/firewall.js`).
  - [ ] Pausa (`Ctrl+Alt+P`) para o envio de vídeo nativo do mesmo jeito que pausa o WebRTC.
- **Pronto quando:** dois PCs na mesma sala veem a tela pelo caminho nativo sem passo manual.

### P2.7 — Opção experimental e volta automática
- **O que faz:** deixa a pessoa escolher e garante que nunca fica sem imagem.
- **Passos:**
  - [ ] No diálogo de compartilhar: "Modo nativo (experimental)", com texto nas três línguas.
  - [ ] Volta para WebRTC sozinho se: exe não subir, nenhum quadro chegar em 5 s, ou o
        exe morrer. Aviso discreto no tile e linha no log.
- **Pronto quando:** matar o exe no meio da transmissão volta para WebRTC sem ninguém sair da sala.

### P2.8 — Áudio
- **O que faz:** garante que o som continua bom ao lado do vídeo nativo.
- **Passos:**
  - [ ] Áudio continua pelo WebRTC atual ([[D-08-audio-continua-no-webrtc|D-08]]).
  - [ ] Medir o desvio entre áudio e vídeo (bater palma na frente da câmera ou um vídeo de teste).
  - [ ] Desvio > 80 ms → atrasar o lado mais rápido; registrar como problema novo.
- **Pronto quando:** desvio medido e anotado.

### P2.9 — Validação multi-PC
- **O que faz:** compara com o caminho atual em condições reais.
- **Passos:**
  - [ ] Mesmas cenas do P0.2, WebRTC × nativo, 3 repetições.
  - [ ] Medir FPS exibido no receptor, tempo sem imagem, FPS do jogo, CPU/GPU dos dois PCs.
- **Portão:** nativo com FPS exibido maior e tempo sem imagem menor nos dois jogos.

---

## Fase 3 — Árvore sem re-encode

Problema que resolve: [[P-03-arvore-recodifica-no-relay|P-03]].

### P3.1 — Relay repassa pacotes
- **O que faz:** quem é relay encaminha os pacotes recebidos aos filhos, sem decodificar para isso.
- **Passos:**
  - [ ] Main do relay reenvia cada pacote `VIDEO`/`FEC` aos filhos com o cabeçalho reescrito
        (sessão e HMAC do salto seguinte).
  - [ ] Relay guarda os últimos ~300 ms para responder `NACK` dos filhos sozinho.
- **Pronto quando:** origem → relay → folha funciona e o relay não sobe o encoder.

### P3.2 — Keyframe e taxa na árvore
- **O que faz:** evita que um filho com problema estrague todos.
- **Passos:**
  - [ ] Pedidos de keyframe dos filhos são agregados no relay (1 pedido para a origem a cada 500 ms no máximo).
  - [ ] A taxa da origem segue o pior caminho direto; filho lento demais sai para outro relay.
- **Pronto quando:** derrubar a rede de uma folha não muda o FPS das outras.

### P3.3 — Qualidade por espectador (decisão pendente)
- **O que faz:** decide como servir espectadores com redes diferentes com um encode só.
- **Opções a avaliar:** camadas temporais (60/30 fps no mesmo fluxo, o relay descarta quadros),
  dois encoders na origem (1080p e 720p), ou aceitar o pior caminho.
- **Pronto quando:** nota `D-12` registrada com a escolha e a medição que a sustenta.

### P3.4 — Validação
- [ ] 1, 2 e 4 espectadores, medindo também o PC relay (CPU, GPU, upload).

---

## Fase 4 — Empacotar e virar padrão

- [ ] **P4.1** `electron-builder`: incluir `golive-media.exe` em `files`/`asarUnpack`;
      `scripts/check-release.js` reprova build sem ele.
- [ ] **P4.2** Antivírus: exe novo sem assinatura pode ser barrado; testar com o Defender e
      documentar. Avaliar assinatura de código.
- [ ] **P4.3** Fallback de captura por Desktop Duplication para jogos em tela cheia exclusiva,
      se o WGC falhar neles.
- [ ] **P4.4** Telemetria do caminho nativo na linha `[diag]` (mesmo formato das métricas atuais).
- [ ] **P4.5** Uma semana de uso real com o modo nativo opt-in sem regressão → virar padrão,
      com WebRTC como volta automática.

---

## Registro

Uma linha por passo concluído: data, passo, resultado, link da nota.

| Data | Passo | Resultado | Nota |
|---|---|---|---|
| 2026-11-25 | Fase 0 código | Implementado e testado em Node (12 testes novos, 2544 no total); C++ só com checagem de sintaxe MinGW | [[D-01-prioridade-gpu-high|D-01]] |
| 2026-11-25 | P1.1 | Esqueleto do `golive-media` (args, métricas JSON, controle por stdin); compila em g++ e MinGW, 5 testes; falta MSVC | [[D-11-como-compilar-o-golive-media\|D-11]] |
| 2026-11-25 | P2.1 | Spec do protocolo UDP escrita e revisada de forma independente (vetores conferidos byte a byte) | [[D-13-formato-do-pacote-udp\|D-13]] |
| 2026-11-27 | P2.2 | Pacote e remontagem em JS (`src/main/videonativo/`), empacotador e HMAC próprios em C++; 57 testes, teste cruzado C++→JS byte a byte | [[D-13-formato-do-pacote-udp\|D-13]] |
