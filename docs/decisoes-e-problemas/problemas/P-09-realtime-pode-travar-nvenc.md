---
tipo: problema
id: P-09
titulo: "Prioridade REALTIME pode travar o NVENC"
data: 2026-11-25
status: evitado (padrão é HIGH)
gravidade: alta se ocorrer
evidencia: fórum de desenvolvedores NVIDIA; Sunshine
tags: [golive, transmissao]
aliases: [P-09]
---
# P-09 — Prioridade REALTIME pode travar o NVENC

## Evidência
Há um relato no fórum de desenvolvedores da NVIDIA de NVENC travando com D3D11 com o processo em
`D3DKMT_SCHEDULINGPRIORITYCLASS_REALTIME`. O Sunshine usa realtime, mas recua para HIGH em certas condições.

## Decisão tomada
Padrão HIGH; REALTIME só com `GOLIVE_PRIORIDADE_GPU=realtime`, para medir ([[D-01-prioridade-gpu-high|D-01]]).

## Fonte
https://forums.developer.nvidia.com/t/nvenc-encoder-hangs-on-windows-when-using-d3d11-in-real-time-mode/357465
