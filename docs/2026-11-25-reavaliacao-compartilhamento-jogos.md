# Reavaliação do compartilhamento de tela com jogos

Data: 25/11/2026. Base: `0.28.1` (`4c45ec8`). Complementa
`docs/2026-11-21-diagnostico-lags-jogos.md`.

## Resumo

Na transmissão entre duas pessoas o problema não é a rede. Os logs de 21/11
mostram a origem produzindo 9–17 fps com RTT de 3–4 ms, perda zero e 1–5% da
banda estimada em uso. O gargalo está **antes do encoder, dentro do PC de quem
joga**: o jogo deixa a GPU em ~99% e os processos do GoLive disputam a mesma
GPU com prioridade normal, perdendo para o jogo que está em primeiro plano.

Três ações, em ordem:

1. **Feito agora:** subir a prioridade de agendamento de GPU (e de CPU) dos
   processos do GoLive enquanto há vídeo correndo. É o que o OBS faz quando
   roda como administrador e o Sunshine faz sempre. Barato e reversível.
2. **Próximo experimento:** um pipeline nativo de captura e encode
   (WGC → textura D3D11 → encoder de hardware), sem passar pelo renderer nem
   pelo canvas, usando só APIs do Windows. É o caminho do OBS, do Sunshine e
   do Discord.
3. **Depois, se o experimento confirmar:** transporte próprio em UDP na LAN
   virtual, com decode por WebCodecs em quem assiste e repasse sem re-encode
   na árvore.

## Por que os jogos derrubam a imagem

Caminho atual de cada quadro (Chromium 152, `screenrelay.js`):

```
jogo ─► DWM ─► WGC (textura na GPU)
          └► cópia para textura de staging + Map  (processo do navegador/captura)
                └► memória da CPU ─► IPC ─► renderer
                      └► MediaStreamTrackProcessor ─► drawImage no canvas  (GPU)
                            └► captureStream ─► processo de GPU ─► NVENC/AMF/QSV
```

Cada `─►` que toca a GPU entra na fila do agendador WDDM. Com o jogo em
primeiro plano e a GPU saturada, cada etapa do GoLive espera o jogo terminar o
quadro dele. A cópia com `Map` é a pior: ela bloqueia até a GPU chegar nela.
Não depende de banda, então explica `cap=10fps` com rede ociosa. Explica também
por que jogos "medianos" afetam: basta a GPU estar perto de 100%, o que acontece
com qualquer jogo sem limite de FPS.

A queda do processo de GPU (`exitCode=34`) seguida de OpenH264 piora o
quadro, mas é consequência da mesma disputa: TDR e perda de dispositivo
são mais comuns com a GPU no limite.

## Como os outros fazem

| App | Captura | Encode | Prioridade de GPU | Transporte |
|---|---|---|---|---|
| OBS | Hook no jogo / WGC, textura fica na GPU | NVENC/AMF/QSV direto da textura | `D3DKMTSetProcessSchedulingPriorityClass` quando roda como admin (desde 24.0.3); avisa que pode custar FPS do jogo | RTMP/SRT para servidor |
| Sunshine (Moonlight) | DXGI Desktop Duplication / WGC, textura na GPU | NVENC/AMF/QSV | Sempre; log "Using realtime GPU priority", com recuo para HIGH por bugs de driver | UDP próprio com FEC; hardware decode no cliente |
| Discord Go Live | Captura e encode próprios, integrados aos drivers | Hardware | Não documentado | WebRTC para SFU própria |
| GoLive hoje | WGC do Chromium, cópia para a CPU | MediaFoundation via WebRTC, depois do canvas | Nenhuma | WebRTC P2P + árvore com re-encode |

O ponto em comum dos três primeiros: **a imagem nunca sai da GPU entre a
captura e o encoder**, e o processo que faz isso tem prioridade de GPU maior
que a normal.

Sobre "mediapipe": se o termo for o MediaPipe do Google, ele serve para
visão computacional (mãos, rosto, segmentação) e não ajuda em captura nem em
encode. O que o OBS tem é o próprio pipeline (`libobs`), e é esse modelo que
vale copiar. O progresso local desse trabalho não chegou ao repositório e não
foi avaliado aqui.

## Fase 0 — prioridade de GPU (implementada nesta branch)

- `native/src/gpu_priority.cc`: chama
  `D3DKMTSetProcessSchedulingPriorityClass` (gdi32.dll, carregada em tempo de
  execução) e `SetPriorityClass` num PID; lê de volta com o `Get`
  correspondente. Exportado pelo addon como `setProcessGpuPriority`.
- `src/main/gpupriority.js`: enquanto `shouldKeepAwake` for verdadeiro (na
  sala, transmitindo ou assistindo), aplica GPU **HIGH** a todos os processos
  do app (`app.getAppMetrics()`) e CPU **ABOVE_NORMAL** ao navegador, à GPU,
  aos utilitários e ao renderer principal. Revisa a cada 3 s para pegar o
  processo de GPU recriado após queda. Ao sair, volta tudo para NORMAL.
- Log: `[gpu] prioridade high: GPU pid=… gpu=ok(lida=4) cpu=ok; …`. Falhas
  saem como erro com o NTSTATUS em hexa (ex: `0xc0000061` = falta privilégio).
- `GOLIVE_PRIORIDADE_GPU=off` desliga (para comparação A/B);
  `=realtime` testa a classe mais alta. REALTIME não é o padrão: há relatos
  de NVENC travando com ela, e ela pode exigir administrador.

### Como validar no PC real

1. `npm run build:native` no Windows. Só a checagem de sintaxe com
   MinGW foi feita neste ambiente, não o build com MSVC.
2. Transmitir Fortnite ou Dead by Daylight numa cena com movimento, com a GPU perto de 99%.
3. Conferir no log a linha `[gpu] prioridade high` com `ok(lida=4)` no
   processo de GPU.
4. Comparar o `cap=` da linha `[diag]` e o FPS recebido com
   `GOLIVE_PRIORIDADE_GPU=off` e sem a variável, 3 repetições cada. Anotar
   também o FPS do jogo: é esperado perder um pouco.
5. Se aparecer `falhou(0xc0000061)`, a classe HIGH exige privilégio neste
   Windows; testar abrindo o app como administrador.

## Fase 1 — spike de captura e encode nativos

Objetivo: provar, antes de construir transporte, que um pipeline sem
Chromium segura 60 fps com o jogo saturando a GPU.

Tudo com o Windows SDK, sem biblioteca de terceiros:

- **Captura:** `Windows.Graphics.Capture` (C++/WinRT, já vem no SDK) num
  dispositivo D3D11 próprio, com `IDXGIDevice::SetGPUThreadPriority(7)` e
  classe de GPU HIGH no processo. Recebe uma `ID3D11Texture2D` por quadro.
  Fallback: DXGI Desktop Duplication para monitor inteiro.
- **Conversão:** `ID3D11VideoProcessor` BGRA→NV12, na GPU.
- **Encode:** MFT H.264 de hardware do Media Foundation (o mesmo
  NVENC/AMF/QSV, com uma API só para os três fabricantes) recebendo a
  textura via `IMFDXGIDeviceManager`. `CODECAPI_AVLowLatencyMode`, CBR, GOP
  longo e IDR sob pedido.
- **Saída do spike:** arquivo `.h264` e, por quadro, o tempo de captura,
  conversão e encode, além do FPS de cada etapa.

Onde mora: um processo auxiliar (`golive-media.exe`) em vez do addon dentro
do Electron. Uma falha do driver não derruba o app, e o processo pode ter a
própria prioridade.

Aceitação: com Fortnite e Dead by Daylight a 99% de GPU, 1080p60 entregues
pelo encoder com p95 abaixo de 16 ms e sem queda abaixo de 55 fps por 5 min,
comparado com o `cap=` atual na mesma cena.

## Fase 2 — transporte próprio na LAN virtual

Radmin VPN e Tailscale já dão IP direto entre os PCs, então o principal
motivo de usar WebRTC (atravessar NAT) não existe aqui. O que o WebRTC ainda
dá (controle de congestão, NACK, pacing) é pouco código para o caso de 2 a 7
pessoas numa LAN virtual. É o modelo do Moonlight e do Parsec.

- **Envio:** o processo nativo divide os NALs em pacotes UDP de ~1200 bytes
  com cabeçalho próprio (sequência, quadro, fragmento, flag de keyframe).
- **Recuperação:** NACK com janela curta + FEC XOR simples por grupo; pedido
  de IDR quando falta um quadro de referência.
- **Taxa:** ajuste por perda e atraso de fila (mesma ideia da escada atual).
- **Recepção:** o renderer recebe os pacotes (via main/IPC ou socket no
  processo nativo), monta os quadros e decodifica com WebCodecs
  `VideoDecoder` em hardware. Os testes de setembro descartaram o
  `VideoEncoder` do WebCodecs a 1080p, não o decoder. Os quadros são
  desenhados num canvas ou entregues por `MediaStreamTrackGenerator` ao
  `<video>` atual.
- **Árvore:** o relay **repassa os pacotes sem decodificar nem recodificar**.
  Isso remove o custo do re-encode, que é o problema da árvore apontado no
  diagnóstico de 21/11.
- **Áudio:** fica no WebRTC na primeira versão. O deslocamento entre áudio e
  vídeo é aceitável quando os dois têm baixa latência, e pode ser medido.
- **Convivência:** opção "Modo nativo (experimental)" no diálogo de
  compartilhar, com o caminho WebRTC atual como fallback automático.
  Exige nova regra de firewall para a porta UDP.

### Alternativa descartada por enquanto

Manter o WebRTC e trocar o conteúdo dos quadros codificados pelo do encoder
nativo via Encoded Transform. A especificação diz que o transform não pode
criar frames nem mover frames entre streams, só alterar ou descartar. A troca
de payload dependeria de detalhes internos do Chromium e quebraria a cada
atualização do Electron. Só vale como spike se a Fase 2 parecer cara demais.

## Dicas para quem joga, já valem hoje

- **Limitar o FPS do jogo** (no jogo ou no painel da NVIDIA/AMD) para deixar
  10–20% de folga na GPU. Esta é a mudança isolada com mais efeito: o OBS
  dá a mesma recomendação para "frames perdidos por atraso de renderização".
- Jogo em **tela cheia sem bordas** em vez de exclusiva.
- Em Configurações > Sistema > Tela > Gráficos, marcar o GoLive como
  **Alto desempenho** em PCs com duas GPUs.
- Testar com o **agendamento de GPU acelerado por hardware** ligado e
  desligado. O efeito na prioridade varia por driver.

## O que não foi verificado

- O addon não foi compilado com MSVC nem rodado no Windows. Neste ambiente
  só a checagem de sintaxe com MinGW passou.
- Não se sabe se a classe HIGH exige privilégio em todas as versões do
  Windows. O log mostra o resultado em cada PC.
- Nenhum jogo foi rodado nesta análise. O ganho da Fase 0 precisa da
  comparação A/B descrita acima.

## Fontes

- [OBS 24.0.3 — correção de prioridade de GPU (precisa de admin)](https://obsproject.com/forum/threads/obs-studio-24-0-3-gpu-priority-fix-testing.111669/latest)
- [OBS — prioridade de processo só afeta CPU](https://obsproject.com/forum/threads/is-there-a-way-to-give-obs-more-process-priority.174910/latest)
- [NVIDIA — NVENC travando com D3D11 em prioridade realtime](https://forums.developer.nvidia.com/t/nvenc-encoder-hangs-on-windows-when-using-d3d11-in-real-time-mode/357465)
- [Sunshine — troubleshooting (encoders perdem FPS sob carga de GPU)](https://docs.lizardbyte.dev/projects/sunshine/master/md_docs_2troubleshooting.html)
- [Sunshine — issue de FPS baixo no stream com o jogo a 120 fps](https://github.com/LizardByte/Sunshine/issues/1167)
- [W3C — WebRTC Encoded Transform](https://www.w3.org/TR/webrtc-encoded-transform)
- Discord: fontes já listadas em `docs/2026-11-21-diagnostico-lags-jogos.md`.
