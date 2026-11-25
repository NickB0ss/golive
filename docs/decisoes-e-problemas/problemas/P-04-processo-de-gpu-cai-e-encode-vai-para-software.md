---
tipo: problema
id: P-04
titulo: "Processo de GPU cai e o encode vai para software"
data: 2026-11-25
status: parcialmente mitigado (0.27/0.28.1)
gravidade: alta
evidencia: logs de 21/11
tags: [golive, transmissao]
aliases: [P-04]
---
# P-04 — Processo de GPU cai e o encode vai para software

## Evidência
`golive transmitindo.log`: processo de GPU cai com `exitCode=34`; o canvas é refeito e o envio passa de
MediaFoundation (NVIDIA) para OpenH264, terminando em 6–12 fps.

## O que já existe
O relay refaz o canvas quando a GPU perde o contexto (0.27.0). A revisão de prioridade a cada 3 s
reaplica HIGH no processo de GPU recriado ([[D-02-prioridade-segue-keep-awake|D-02]]).

## O que falta
O WebRTC não reavalia o encoder na troca de track: depois de cair em software, fica em software.
O pipeline nativo isola a falha num processo separado ([[D-03-processo-auxiliar-golive-media|D-03]]). A causa da queda (TDR? memória?)
precisa de dump; `ignore-gpu-blocklist` não foi provado como causa.
