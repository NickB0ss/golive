---
tipo: problema
id: P-03
titulo: "A árvore recodifica o vídeo em quem retransmite"
data: 2026-11-25
status: aberto
gravidade: média
evidencia: código + diagnóstico de 21/11
tags: [golive, transmissao]
aliases: [P-03]
---
# P-03 — A árvore recodifica o vídeo em quem retransmite

## Sintoma
Quem joga, assiste e retransmite ao mesmo tempo disputa a GPU em três tarefas; as folhas dependem da
saúde desse PC.

## Causa
No WebRTC atual o relay recebe, decodifica e cria senders novos que recodificam para os filhos.

## Próximo passo
Fase 3 do [[2026-11-25-pipeline-nativo|Plano do pipeline nativo]]: o relay repassa pacotes do transporte próprio sem decodificar ([[D-06-transporte-udp-proprio|D-06]]).
A qualidade por espectador com um encode só fica para decisão no P3.3.
