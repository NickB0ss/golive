---
tipo: problema
id: P-10
titulo: "Progresso local do pipeline não chegou ao repositório"
data: 2026-11-25
status: aberto
gravidade: processo
evidencia: relato do usuário em 25/11
tags: [golive, transmissao]
aliases: [P-10]
---
# P-10 — Progresso local do pipeline não chegou ao repositório

## O que houve
A tentativa anterior de um pipeline nativo ("mediapipe", no estilo OBS) ficou só no PC local, sem commit.
A reavaliação de 25/11 não pôde aproveitá-la.

## Como evitar
- Commit e push numa branch de trabalho ao fim de cada sessão, mesmo incompleto (marcado como WIP).
- Antes de começar a Fase 1, comparar o que existe localmente com o [[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] e trazer o que servir,
  registrando aqui o que foi aproveitado.

## Observação
Se "mediapipe" se referia ao MediaPipe do Google, ele é para visão computacional e não ajuda em captura
nem encode. O que se quer é um pipeline próprio como o `libobs` do OBS.
