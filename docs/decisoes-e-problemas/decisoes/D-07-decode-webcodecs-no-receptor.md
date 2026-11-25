---
tipo: decisao
id: D-07
titulo: "Decode por WebCodecs VideoDecoder em quem assiste"
data: 2026-11-25
status: proposta
fase: 2
tags: [golive, transmissao]
aliases: [D-07]
---
# D-07 — Decode por WebCodecs VideoDecoder em quem assiste

## Contexto
Quem assiste precisa decodificar H.264 em hardware e mostrar no tile que já existe
(tela cheia, rabisco e estatísticas dependem do `<video>`).

## Decisão
`VideoDecoder` com `hardwareAcceleration: 'prefer-hardware'`, saída para um
`MediaStreamTrackGenerator`, e a track no `<video>` do tile.

## Por que não repete o problema do WebCodecs no envio
O teste de setembro descartou o **VideoEncoder** do WebCodecs a 1080p ([[P-05-webcodecs-encoder-sem-hardware-1080p|P-05]]).
O decoder é outro caminho e precisa ser confirmado no P2.5; se falhar, o plano B é decodificar
no exe nativo do receptor e entregar textura compartilhada.

## Ligações
[[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P2.5) · [[D-06-transporte-udp-proprio|D-06]] · [[P-05-webcodecs-encoder-sem-hardware-1080p|P-05]]
