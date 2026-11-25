---
tipo: decisao
id: D-03
titulo: "Pipeline nativo num processo auxiliar (golive-media.exe)"
data: 2026-11-25
status: proposta, confirmar no P1.1
fase: 1
tags: [golive, transmissao]
aliases: [D-03]
---
# D-03 — Pipeline nativo num processo auxiliar (golive-media.exe)

## Contexto
Captura e encode nativos falam direto com o driver da GPU. Falhas de driver (TDR, perda de
dispositivo) são comuns com a GPU no limite ([[P-04-processo-de-gpu-cai-e-encode-vai-para-software|P-04]]).

## Decisão
Rodar captura, conversão, encode e envio UDP num executável separado, controlado pelo main
por stdin/stdout (JSON por linha), em vez de colocar tudo no addon `golive_audio.node`.

## Alternativas consideradas
- **Dentro do addon:** menos peças, mas um crash do driver derruba o app inteiro e a sala junto.
- **Dentro do processo de GPU do Chromium:** impossível sem fork do Electron.

## Consequências
- Uma falha no exe vira "volta para WebRTC" ([[D-09-webrtc-continua-como-fallback|D-09]]), não um app fechado.
- O exe tem prioridade própria e não disputa a thread do Node.
- Custo: mais um binário para empacotar, e o antivírus pode implicar com ele (Fase 4, P4.2).
- Forma de compilar (gyp `executable` ou CMake) é decidida no P1.1; registrar como D-11.

## Ligações
[[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P1.1) · [[D-04-so-apis-do-windows|D-04]] · [[D-09-webrtc-continua-como-fallback|D-09]]
