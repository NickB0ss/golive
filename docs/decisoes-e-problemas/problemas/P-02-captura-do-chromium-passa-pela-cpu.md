---
tipo: problema
id: P-02
titulo: "A captura do Chromium passa pela CPU e pelo canvas"
data: 2026-11-25
status: aberto
gravidade: alta
evidencia: hipótese (arquitetura), não medido por etapa
tags: [golive, transmissao]
aliases: [P-02]
---
# P-02 — A captura do Chromium passa pela CPU e pelo canvas

## Sintoma
Mesmo com rede ociosa, o FPS que sai da origem cai sob jogo pesado.

## Caminho atual de cada quadro
WGC (textura na GPU) → cópia para staging + `Map` (CPU) → IPC → renderer →
`MediaStreamTrackProcessor` → `drawImage` no canvas (GPU) → `captureStream` → processo de GPU → encoder.

## Por que é problema
Várias idas e voltas entre GPU e CPU, todas disputando a GPU com o jogo ([[P-01-gpu-saturada-pelo-jogo|P-01]]). O `Map` bloqueia
até a GPU chegar nele. O canvas existe por causa de [[P-06-motion-derruba-encoder-hw-na-captura-direta|P-06]].

## Limite da evidência
O `cap=` da linha `[diag]` mede a saída do canvas, não a captura crua (ver `docs/2026-11-21-diagnostico-lags-jogos.md`). A cópia para a CPU
é como o capturador do WebRTC entrega quadros; não foi medida etapa por etapa neste PC.

## Próximo passo
Fase 1 do [[2026-11-25-pipeline-nativo|Plano do pipeline nativo]]: pipeline que não sai da GPU, com métrica por etapa ([[D-05-spike-em-arquivo-antes-da-rede|D-05]]).
