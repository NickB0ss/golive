---
tipo: decisao
id: D-01
titulo: "Prioridade de GPU HIGH (não REALTIME) enquanto há vídeo"
data: 2026-11-25
status: aceita, aguarda validação no P0.2
fase: 0
tags: [golive, transmissao]
aliases: [D-01]
---
# D-01 — Prioridade de GPU HIGH (não REALTIME) enquanto há vídeo

## Contexto
Com o jogo deixando a GPU em ~99%, captura, canvas e encoder do GoLive ficam na fila do
agendador do Windows atrás do jogo ([[P-01-gpu-saturada-pelo-jogo|P-01]]). OBS (como administrador) e Sunshine
sobem a prioridade de GPU do próprio processo para resolver isso.

## Decisão
Enquanto há vídeo correndo, todos os processos do app recebem classe de GPU **HIGH**
(`D3DKMTSetProcessSchedulingPriorityClass`), e os que tocam a imagem (navegador, GPU,
utilitários, renderer principal) recebem CPU **ABOVE_NORMAL**. Ao parar, tudo volta a NORMAL.
`GOLIVE_PRIORIDADE_GPU=off` desliga; `=realtime` serve só para medir.

## Alternativas consideradas
- **REALTIME por padrão:** há relatos de NVENC travando com ela ([[P-09-realtime-pode-travar-nvenc|P-09]]), e ela pode exigir administrador.
- **Pedir para rodar como administrador:** atrito para os amigos e risco desnecessário se HIGH bastar.
- **Não mexer e só recomendar limitar FPS do jogo:** continua valendo como dica, mas depende de cada pessoa.

## Consequências
- O jogo pode perder alguns FPS enquanto a pessoa transmite (o OBS dá o mesmo aviso).
- Depende do addon nativo; sem ele, o log avisa uma vez e nada muda.
- Código: `native/src/gpu_priority.cc`, `src/main/gpupriority.js`, `applyKeepAwake` em `src/main.js`.

## Como saber se estava errada
O P0.2 não mostra ganho de FPS entregue com HIGH, ou mostra perda grande de FPS no jogo.
Nesse caso registrar aqui e seguir direto para a Fase 1.

## Ligações
[[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P0.1–P0.3) · [[D-02-prioridade-segue-keep-awake|D-02]] · [[P-01-gpu-saturada-pelo-jogo|P-01]] · [[P-08-prioridade-high-pode-exigir-privilegio|P-08]] · [[P-09-realtime-pode-travar-nvenc|P-09]]
