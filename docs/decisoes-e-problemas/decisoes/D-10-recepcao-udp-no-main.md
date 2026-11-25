---
tipo: decisao
id: D-10
titulo: "Recepção UDP no processo main, entrega ao renderer por MessagePort"
data: 2026-11-25
status: proposta, validar no P2.5
fase: 2
tags: [golive, transmissao]
aliases: [D-10]
---
# D-10 — Recepção UDP no processo main, entrega ao renderer por MessagePort

## Contexto
O renderer não abre socket UDP (isolamento de contexto). O decode precisa estar no renderer
para usar WebCodecs ([[D-07-decode-webcodecs-no-receptor|D-07]]).

## Decisão
O main recebe com `dgram`, remonta os quadros (módulo JS puro e testável) e os transfere ao
renderer por `MessagePort`, sem cópia. 1080p60 a ~10 Mbps dá ~1.000 pacotes/s, o que o Node aguenta.

## Alternativa
Receber e remontar no exe nativo do receptor e passar só quadros prontos ao main. Usar se o
main mostrar atraso de event loop sob carga.

## Ligações
[[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P2.2, P2.5) · [[D-06-transporte-udp-proprio|D-06]] · [[D-07-decode-webcodecs-no-receptor|D-07]]
