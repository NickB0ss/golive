---
tipo: decisao
id: D-09
titulo: "WebRTC continua como padrão e como volta automática"
data: 2026-11-25
status: aceita
fase: 2-4
tags: [golive, transmissao]
aliases: [D-09]
---
# D-09 — WebRTC continua como padrão e como volta automática

## Decisão
O modo nativo entra como opção "experimental" no diálogo de compartilhar. O app volta
sozinho para o WebRTC se o exe não subir, se nada chegar em 5 s ou se o exe morrer.
Só vira padrão depois de uma semana de uso real sem regressão (P4.5).

## Por quê
Ninguém pode ficar sem imagem por causa do caminho novo. É a mesma regra do 0.28.1:
ninguém precisa sair e entrar na sala para recuperar a imagem.

## Ligações
[[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P2.7, P4.5) · [[D-03-processo-auxiliar-golive-media|D-03]]
