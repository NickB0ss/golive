---
tipo: problema
id: P-01
titulo: "O jogo satura a GPU e a transmissão fica na fila"
data: 2026-11-25
status: mitigado (Fase 0), aguarda medição
gravidade: alta
evidencia: logs de 21/11 + referência OBS/Sunshine
tags: [golive, transmissao]
aliases: [P-01]
---
# P-01 — O jogo satura a GPU e a transmissão fica na fila

## Sintoma
Fortnite, Dead by Daylight e The Last of Us: a tela compartilhada trava mesmo entre duas pessoas.

## Evidência
Logs de 21/11 (`docs/2026-11-21-diagnostico-lags-jogos.md`): na origem `cap=9–17 fps` com RTT de 3–4 ms, perda zero e 1–5% da banda
estimada em uso. Não é rede. OBS e Sunshine documentam a mesma queda de FPS do encoder sob
carga de GPU e resolvem com prioridade de GPU.

## Causa provável
Os processos do GoLive têm prioridade de GPU normal; o agendador WDDM atende primeiro o jogo,
que está em primeiro plano. Cada etapa da imagem (cópia da captura, desenho no canvas, envio ao
encoder) espera o jogo terminar o quadro dele.

## O que já foi feito
Prioridade HIGH durante a transmissão ([[D-01-prioridade-gpu-high|D-01]], [[D-02-prioridade-segue-keep-awake|D-02]]).

## Próximo passo
P0.1 e P0.2 do [[2026-11-25-pipeline-nativo|Plano do pipeline nativo]]. Anotar a tabela A/B aqui.

## Dica que já vale
Limitar o FPS do jogo para deixar 10–20% de folga na GPU.
