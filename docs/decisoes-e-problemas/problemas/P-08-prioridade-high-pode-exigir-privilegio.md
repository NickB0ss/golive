---
tipo: problema
id: P-08
titulo: "A classe HIGH pode exigir privilégio em algum Windows"
data: 2026-11-25
status: a verificar no P0.1
gravidade: média
evidencia: incerteza da documentação
tags: [golive, transmissao]
aliases: [P-08]
---
# P-08 — A classe HIGH pode exigir privilégio em algum Windows

## Contexto
O OBS só liga a correção de prioridade como administrador, e a documentação pública não deixa claro se
HIGH (e não só REALTIME) exige privilégio.

## Como aparece
Linha `[gpu] prioridade … falhou(0xc0000061)` no log (STATUS_PRIVILEGE_NOT_HELD), ou
`sem-acesso(win32=5)` se o `OpenProcess` for recusado num processo filho em sandbox.

## Se acontecer
Registrar aqui qual Windows e qual processo. Opções: pedir elevação só quando a pessoa ligar uma opção,
ou aplicar só no próprio processo do pipeline nativo (Fase 1), que não tem sandbox.

## Ligações
[[D-01-prioridade-gpu-high|D-01]] · [[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P0.1)
