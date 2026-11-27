# Decisões e problemas — transmissão de jogos

Notas para levar ao vault. Cada arquivo é uma nota independente, com frontmatter
(`tipo`, `id`, `status`, `aliases`) e links `[[...]]` no formato do Obsidian. Os
links usam o nome do arquivo, então funcionam em qualquer pasta do vault.

- Plano com os passos: [[2026-11-25-pipeline-nativo]] (`docs/superpowers/plans/`).
- Análise que originou tudo: `docs/2026-11-25-reavaliacao-compartilhamento-jogos.md`.
- Diagnóstico anterior: `docs/2026-11-21-diagnostico-lags-jogos.md`.

## Decisões

| Id | Decisão | Fase | Status |
|---|---|---|---|
| [[D-01-prioridade-gpu-high\|D-01]] | Prioridade de GPU HIGH (não REALTIME) enquanto há vídeo | 0 | aceita, aguarda validação no P0.2 |
| [[D-02-prioridade-segue-keep-awake\|D-02]] | Prioridade liga e desliga pela mesma regra do keep-awake | 0 | aceita |
| [[D-03-processo-auxiliar-golive-media\|D-03]] | Pipeline nativo num processo auxiliar (golive-media.exe) | 1 | aceita no P1.1 (esqueleto compila e roda; falta MSVC) |
| [[D-04-so-apis-do-windows\|D-04]] | Só APIs do Windows, sem bibliotecas de terceiros | 1-2 | aceita |
| [[D-05-spike-em-arquivo-antes-da-rede\|D-05]] | Spike grava em arquivo antes de construir a rede | 1 | aceita |
| [[D-06-transporte-udp-proprio\|D-06]] | Transporte UDP próprio em vez de WebRTC para o vídeo nativo | 2 | proposta, depende do portão da Fase 1 |
| [[D-07-decode-webcodecs-no-receptor\|D-07]] | Decode por WebCodecs VideoDecoder em quem assiste | 2 | proposta |
| [[D-08-audio-continua-no-webrtc\|D-08]] | Áudio continua no WebRTC na primeira versão | 2 | proposta |
| [[D-09-webrtc-continua-como-fallback\|D-09]] | WebRTC continua como padrão e como volta automática | 2-4 | aceita |
| [[D-10-recepcao-udp-no-main\|D-10]] | Recepção UDP no processo main, entrega ao renderer por MessagePort | 2 | proposta, validar no P2.5 |
| [[D-11-como-compilar-o-golive-media\|D-11]] | golive-media como segundo target do binding.gyp | 1 | proposta, confirmar com MSVC |
| [[D-13-formato-do-pacote-udp\|D-13]] | Formato do pacote UDP: big-endian, HMAC-SHA256/16 por par, sem cifra, FEC XOR | 2-3 | aceita, spec revisada; implementada no P2.2 e P2.3 (JS) |

## Problemas encontrados

| Id | Problema | Gravidade | Status |
|---|---|---|---|
| [[P-01-gpu-saturada-pelo-jogo\|P-01]] | O jogo satura a GPU e a transmissão fica na fila | alta | mitigado (Fase 0), aguarda medição |
| [[P-02-captura-do-chromium-passa-pela-cpu\|P-02]] | A captura do Chromium passa pela CPU e pelo canvas | alta | aberto |
| [[P-03-arvore-recodifica-no-relay\|P-03]] | A árvore recodifica o vídeo em quem retransmite | média | aberto |
| [[P-04-processo-de-gpu-cai-e-encode-vai-para-software\|P-04]] | Processo de GPU cai e o encode vai para software | alta | parcialmente mitigado (0.27/0.28.1) |
| [[P-05-webcodecs-encoder-sem-hardware-1080p\|P-05]] | VideoEncoder do WebCodecs não alcança hardware a 1080p | média | conhecido (medido em 2026-09) |
| [[P-06-motion-derruba-encoder-hw-na-captura-direta\|P-06]] | contentHint "motion" derruba o encoder de hardware na captura direta | média | contornado (relay por canvas) |
| [[P-07-duas-gpus-e-desktop-duplication\|P-07]] | Duas GPUs iguais e Desktop Duplication que não sobe | baixa | conhecido |
| [[P-08-prioridade-high-pode-exigir-privilegio\|P-08]] | A classe HIGH pode exigir privilégio em algum Windows | média | a verificar no P0.1 |
| [[P-09-realtime-pode-travar-nvenc\|P-09]] | Prioridade REALTIME pode travar o NVENC | alta se ocorrer | evitado (padrão é HIGH) |
| [[P-10-progresso-local-fora-do-repositorio\|P-10]] | Progresso local do pipeline não chegou ao repositório | processo | aberto |

## Como manter

- Decisão nova: próximo número livre (`D-11`, `D-12` já estão reservados no plano para a
  forma de compilar o exe e a qualidade por espectador). Seções: Contexto, Decisão,
  Alternativas, Consequências, Ligações.
- Problema novo: próximo `P-NN`. Seções: Sintoma, Evidência, Causa, O que já foi feito,
  Próximo passo. Escrever no campo `evidencia` se é medido ou hipótese.
- Ao mudar o status de uma nota, atualizar esta tabela e a seção "Registro" do plano.
- Uma decisão que se mostrar errada não é apagada: muda para `status: substituída por D-NN`.
