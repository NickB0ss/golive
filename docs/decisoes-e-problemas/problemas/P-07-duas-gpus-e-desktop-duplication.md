---
tipo: problema
id: P-07
titulo: "Duas GPUs iguais e Desktop Duplication que não sobe"
data: 2026-11-25
status: conhecido
gravidade: baixa
evidencia: comentário em src/main.js (2026-09-12)
tags: [golive, transmissao]
aliases: [P-07]
---
# P-07 — Duas GPUs iguais e Desktop Duplication que não sobe

## Evidência
Num PC com duas RTX 3060, o caminho DXGI Desktop Duplication do Chromium não iniciou
("Cannot initialize any DxgiOutputDuplicator instance"); só o WGC funcionou.

## Consequência para o nativo
- Criar o dispositivo D3D11 no adaptador do monitor capturado (LUID), não no adaptador 0 (P1.2).
- Escolher o MFT de encode do mesmo adaptador (`MFT_ENUM_ADAPTER_LUID`, P1.5).
- WGC primeiro; Desktop Duplication só como fallback opcional (P4.3).
