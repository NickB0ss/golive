---
tipo: decisao
id: D-02
titulo: "Prioridade liga e desliga pela mesma regra do keep-awake"
data: 2026-11-25
status: aceita
fase: 0
tags: [golive, transmissao]
aliases: [D-02]
---
# D-02 — Prioridade liga e desliga pela mesma regra do keep-awake

## Contexto
A prioridade alta custa FPS ao jogo, então não deve ficar ligada o tempo todo. O app já
tinha uma regra para "há vídeo de verdade correndo": `shouldKeepAwake` em `src/main/awake.js`
(na sala **e** transmitindo ou assistindo).

## Decisão
`applyKeepAwake` chama `prioridadeGpu.definirAtivo(deve)`; `forceStopKeepAwake` (renderer caiu,
app fechando) desliga. Uma revisão a cada 3 s pega processos novos, como o processo de GPU
recriado depois de cair ([[P-04-processo-de-gpu-cai-e-encode-vai-para-software|P-04]]).

## Alternativas consideradas
- **Só ao transmitir:** quem assiste e é relay também recodifica ([[P-03-arvore-recodifica-no-relay|P-03]]); ficaria de fora.
- **Sempre ligada:** custo no jogo mesmo sem ninguém transmitindo.

## Consequências
Quem só assiste enquanto joga também ganha prioridade (e perde um pouco de FPS no jogo).
Se isso incomodar, separar "transmitindo/relay" de "só assistindo".

## Ligações
[[D-01-prioridade-gpu-high|D-01]] · [[2026-11-25-pipeline-nativo|Plano do pipeline nativo]]
