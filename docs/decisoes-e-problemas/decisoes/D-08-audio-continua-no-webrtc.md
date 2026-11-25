---
tipo: decisao
id: D-08
titulo: "Áudio continua no WebRTC na primeira versão"
data: 2026-11-25
status: proposta
fase: 2
tags: [golive, transmissao]
aliases: [D-08]
---
# D-08 — Áudio continua no WebRTC na primeira versão

## Contexto
O áudio já funciona (loopback, captura por processo, Opus estéreo) e não é o gargalo.

## Decisão
Na Fase 2 só o vídeo vai pelo caminho nativo. O áudio segue pelo WebRTC atual.

## Risco
Desvio entre áudio e vídeo. Medir no P2.8; acima de 80 ms, atrasar o lado mais rápido e
registrar um problema novo.

## Ligações
[[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P2.8) · [[D-06-transporte-udp-proprio|D-06]]
