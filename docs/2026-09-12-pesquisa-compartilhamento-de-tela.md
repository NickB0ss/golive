# Pesquisa: o compartilhamento de tela está bom? O que melhorar

Data: 2026-09-12. Base: 0.13.0 + as frentes de 2026-09-12. Time: pesquisa web
(Claude), auditoria de código e logs (Codex terra high), e spikes no Chromium
real do app (Electron 32.3.3 / Chrome 128). Fatos verificados, inferências e
recomendações estão separados; nada aqui foi medido em sala real de 3–4 PCs.

## Veredito

Não está "bom e estável" para sala de 3–4 pessoas ainda. O envio direto
melhorou muito (relay de canvas mantém o encoder de hardware), mas há três
fontes reais de problema: **repasse (relay) em software**, **captura que para
em certos jogos** e **defeitos de renegociação** que davam tela preta. O
terceiro foi corrigido hoje (hotfix 0.13.1); os outros dois têm diagnóstico e
mitigação, não cura.

## O que foi provado hoje (Chromium 128 do app)

| Achado | Evidência |
|---|---|
| Renegociar numa conexão existente com `addTransceiver` empilha canal de vídeo; o receptor fica preso no canal velho — tela preta com os dados chegando | Spike: 2 tracks na mesma stream, `<video>` com **0 quadros em 2,5 s** e `totalVideoFrames` parado (106→106) enquanto a track nova decodificava 120 quadros. Corrigido no hotfix (reaproveita o transceiver). |
| `replaceTrack(null)` seguido de `replaceTrack(track)` sem await **não** deixa o sender sem track | 60/60 em ordem. Hipótese descartada. |
| As flags WGC do `main.js` funcionam nesta versão | Log do Chromium: `allow_wgc_screen_capturer: 1, allow_wgc_window_capturer: 1`; captura de monitor ~32 fps sem `mute`. |
| Na máquina de teste o caminho DXGI nem sobe | `Cannot initialize any DxgiOutputDuplicator instance` nos adaptadores 1 e 2 (duas RTX 3060 com LUIDs diferentes). O app depende do WGC, que depende do DWM. |

## Diagnóstico pelos logs reais

- **Relay em software:** em 08/09 o repasse usuário 1 → heitor ficou 96,4% em
  OpenH264 (hardware só 3,6%), enquanto o envio direto usuário 2 → usuário 1
  ficou 99,6% em hardware (`logs/agentes/timeline.md`). O relay reencoda a track
  crua com `contentHint='motion'` — a mesma combinação que derrubava o hardware
  na captura própria antes do canvas.
- **Captura parando em jogo (12/09):** a track de captura alternou
  `MUTE`/`UNMUTE` 5× em ~10 s com o encoder saudável em hardware (26 fps).
  Inferência: jogo em tela cheia exclusiva / apresentação que pula o DWM, ou
  anti-captura. Sem correção no app; o hotfix detecta e avisa quem transmite.
- **Tela preta ao assistir outra tela (12/09):** lado de quem assiste não
  logava nada; o usuário, como relay, repassou `out=0x0@0fps` por ~30 min.
  Hotfix: reaproveitar transceiver + autocura por conexão + log `[assistir]`.
- **Quedas de sinalização (1006)** recorrentes; parte coincide com o "Audio
  Service" morrendo, parte com instabilidade de VPN.
- Não havia histórico de FPS recebido, congelamento, jitter nem latência do
  lado de quem assiste — só telemetria de envio.

## Top 5 (maior ganho por esforço)

1. **Canvas também no repasse (relay), com A/B antes de adotar.** Ataca o
   padrão histórico de OpenH264 no relay. 2–4 dias; medir HW/SW, ms/quadro,
   FPS recebido e congelamentos numa sala de 4 por 20 min.
2. **Qualidade pela demanda efetiva, não pelo tamanho da sala.** Hoje quem não
   assiste ainda derruba o preset global (`audienceSize()` conta membros).
   1–2 dias; preservar relay com descendentes.
3. **Telemetria de recepção persistida** (FPS recebido, congelamentos,
   jitter, BWE, papel de relay, rota). O `[assistir]` do hotfix é o começo.
   1–2 dias; botão "copiar diagnóstico".
4. **Fila de áudio nativo com teto + cancelamento da ativação COM.** Fila TSFN
   sem limite e `stop()` que pode travar o main até 5 s. 2–4 dias.
5. **Subir o Electron (32 → linha suportada).** Segurança, correções de
   captura/WebRTC e pré-requisito para HEVC por hardware. 1–2 semanas com QA.

## O que não vale agora

AV1; simulcast/SVC com H.264 (multiplica encodes na origem); servidor de mídia
ou repasse de quadro codificado (Encoded Transform — pesquisa de alto risco);
zerar o jitter buffer às cegas; remover o canvas.

Sobre o caso público da Multi (tela legível e rápida em WebRTC): dá para
copiar `degradationPreference` e teto de fps pelo JavaScript, mas o ganho de
~90 ms de latência veio de mudança em C++ no libwebrtc (`max_playout_delay`) e
eles usam VP9, não H.264 — não se transfere direto ao GoLive
([fonte](https://multi.app/blog/making-illegible-slow-webrtc-screenshare-legible-and-fast)).

## Material de apoio

Pesquisa web completa, com links, e a auditoria do Codex ficaram fora do
repositório (scratchpad da sessão de 2026-09-12); os achados que importam
estão resumidos aqui. Spikes reproduzíveis: ver a spec
`docs/superpowers/specs/2026-09-12-tela-preta-ao-assistir-design.md`.
