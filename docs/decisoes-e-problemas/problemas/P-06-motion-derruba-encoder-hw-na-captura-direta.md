---
tipo: problema
id: P-06
titulo: "contentHint "motion" derruba o encoder de hardware na captura direta"
data: 2026-11-25
status: contornado (relay por canvas)
gravidade: média
evidencia: medido em 2026-09-05, RTX 3060, Chromium 128
tags: [golive, transmissao]
aliases: [P-06]
---
# P-06 — contentHint "motion" derruba o encoder de hardware na captura direta

## Evidência
Captura direta + `motion` → OpenH264 (12–13 ms/quadro). Sem hint ou com `detail` → hardware, mas
~24% menos FPS. Canvas + `motion` → hardware e FPS mantido. Detalhes no cabeçalho de
`src/renderer/screenrelay.js`.

## Consequência
É o motivo do canvas no caminho atual, que por sua vez soma idas à GPU ([[P-02-captura-do-chromium-passa-pela-cpu|P-02]]). O pipeline nativo
não depende de `contentHint`. A medição foi no Chromium 128; o diagnóstico de 21/11 recomenda retestar no 152.
