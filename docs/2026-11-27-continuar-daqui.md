# Continuar daqui — passagem para a próxima sessão (27/11/2026)

Nota para outro agente do Claude (ou pessoa) continuar o trabalho em outro computador.
Leia esta nota inteira antes de mexer em qualquer coisa.

## Estado em uma frase

Pipeline nativo adiantado sem PC Windows (P1.1 e P2.1 prontos, P2.2 em fechamento) e uma
auditoria de bugs e de design do app inteiro, com as correções aplicadas por área.

## O que foi feito nesta rodada (sessões de 25 a 27/11)

| Item | Onde | Estado |
|---|---|---|
| P1.1 esqueleto do `golive-media` | `native/media/`, `binding.gyp`, nota D-11 | pronto no Linux/MinGW; falta MSVC |
| P2.1 spec do protocolo UDP | `docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md`, nota D-13 | pronto e revisado |
| P2.2 empacotar e remontar | `src/main/videonativo/`, `native/media/pacote*`, `sha256*` | ver tabela de verificação |
| Auditoria de bugs | `docs/auditoria-2026-11-25/bugs-*.md` | 4 relatórios (main, servidor, renderer, Mesa) |
| Correções da auditoria | ver cada relatório | ver tabela de verificação |
| Auditoria de design | `docs/auditoria-2026-11-25/design.md` | ver tabela de verificação |

## Verificação no fim desta rodada

(preenchida no fechamento — se estiver vazia, a rodada foi interrompida: rode `npm test` e
`npm run lint` antes de tudo e confira `git log` do branch.)

## Próximos passos, em ordem

1. **Num PC Windows com MSVC** (o que a nuvem não faz):
   - `npm run build:native`: confere que o addon e o `golive-media.exe` compilam (D-11).
   - P0.1 e P0.2 do plano `docs/superpowers/plans/2026-11-25-pipeline-nativo.md`
     (linha `[gpu] prioridade` no log e A/B com jogo real).
   - Testar com 2+ PCs as correções da auditoria marcadas como "validar com PC real" nos relatórios.
2. **Sem Windows:** P2.3 (NACK, FEC e reenvio) sobre o P2.2, seguindo a spec do protocolo.
3. Propostas maiores de design ("Partes que valem refazer" em `design.md`) esperam decisão do dono.

## Como trabalhar neste repositório

- Regras de interface: `src/renderer/AGENTS.md` (tokens, `t()` nas três línguas, ids-contrato).
- `npm test` e `npm run lint` verdes em todo commit (lint: 0 erros; há warnings antigos).
- Plano: a cada passo concluído, marcar `[x]`, anotar no "Registro" do fim do plano e
  atualizar `docs/decisoes-e-problemas/`.
