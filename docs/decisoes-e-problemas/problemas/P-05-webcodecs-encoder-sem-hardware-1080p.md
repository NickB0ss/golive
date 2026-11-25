---
tipo: problema
id: P-05
titulo: "VideoEncoder do WebCodecs não alcança hardware a 1080p"
data: 2026-11-25
status: conhecido (medido em 2026-09)
gravidade: média
evidencia: comentário de screenrelay.js
tags: [golive, transmissao]
aliases: [P-05]
---
# P-05 — VideoEncoder do WebCodecs não alcança hardware a 1080p

## Evidência
Medido em setembro: o `VideoEncoder` do WebCodecs não usou hardware a 1080p naquele build, e em software
custou 18 ms/quadro, mais que o OpenH264 do próprio WebRTC.

## Consequência
Um caminho "só JavaScript" com WebCodecs no envio não resolve. Por isso o encode vai para o nativo
([[D-04-so-apis-do-windows|D-04]]). O **decoder** do WebCodecs no receptor é outra questão e será testado no P2.5 ([[D-07-decode-webcodecs-no-receptor|D-07]]).
Vale retestar o encoder no Chromium 152, mas não é o caminho principal.
