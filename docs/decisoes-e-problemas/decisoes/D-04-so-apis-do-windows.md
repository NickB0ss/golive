---
tipo: decisao
id: D-04
titulo: "Só APIs do Windows, sem bibliotecas de terceiros"
data: 2026-11-25
status: aceita
fase: 1-2
tags: [golive, transmissao]
aliases: [D-04]
---
# D-04 — Só APIs do Windows, sem bibliotecas de terceiros

## Contexto
O pedido foi "uma forma de compartilhamento sem precisar de uma biblioteca". O Windows SDK
já traz tudo o que OBS e Sunshine usam por baixo.

## Decisão
- Captura: Windows.Graphics.Capture (C++/WinRT, já no SDK).
- Conversão: `ID3D11VideoProcessor` (BGRA→NV12 na GPU).
- Encode: MFT H.264 de hardware do Media Foundation (NVENC, AMF ou QSV com a mesma API).
- Rede: Winsock (envio) e `dgram` do Node (recepção).

## Alternativas consideradas
- **FFmpeg:** pesado, licença a cuidar, e não resolve nada que o MF não resolva aqui.
- **NVENC SDK direto:** um pouco mais de controle, mas só NVIDIA. Pode virar otimização
  futura para placas NVIDIA se o MFT limitar algo.
- **libdatachannel / outra pilha WebRTC nativa:** biblioteca externa, e o transporte próprio
  é pequeno para 2–7 pessoas numa LAN virtual ([[D-06-transporte-udp-proprio|D-06]]).

## Consequências
Funciona em NVIDIA, AMD e Intel sem dependência nova. O comportamento de cada MFT de
fabricante varia; testar ao menos NVIDIA (os PCs atuais) e uma AMD se aparecer.

## Ligações
[[D-03-processo-auxiliar-golive-media|D-03]] · [[D-06-transporte-udp-proprio|D-06]] · [[2026-11-25-pipeline-nativo|Plano do pipeline nativo]]
