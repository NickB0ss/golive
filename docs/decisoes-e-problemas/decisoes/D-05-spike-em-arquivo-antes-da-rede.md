---
tipo: decisao
id: D-05
titulo: "Spike grava em arquivo antes de construir a rede"
data: 2026-11-25
status: aceita
fase: 1
tags: [golive, transmissao]
aliases: [D-05]
---
# D-05 — Spike grava em arquivo antes de construir a rede

## Contexto
O transporte próprio é o pedaço mais caro. Não vale construí-lo antes de provar que a
captura e o encode nativos seguram 60 fps com o jogo saturando a GPU.

## Decisão
A Fase 1 só grava `.h264` em arquivo e mede cada etapa. Portão no P1.7: 1080p60, p95 de encode
< 16 ms, nenhum minuto abaixo de 55 fps em 5 min, em Fortnite e Dead by Daylight.

## Consequências
Se o portão falhar, a medição por etapa mostra onde ([[P-02-captura-do-chromium-passa-pela-cpu|P-02]]), antes de gastar tempo em rede.

## Ligações
[[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P1.6–P1.7) · [[D-03-processo-auxiliar-golive-media|D-03]]
