---
tipo: decisao
id: D-06
titulo: "Transporte UDP próprio em vez de WebRTC para o vídeo nativo"
data: 2026-11-25
status: proposta, depende do portão da Fase 1
fase: 2
tags: [golive, transmissao]
aliases: [D-06]
---
# D-06 — Transporte UDP próprio em vez de WebRTC para o vídeo nativo

## Contexto
Radmin VPN e Tailscale já dão IP direto entre os PCs, então o principal motivo do WebRTC
(atravessar NAT) não existe aqui. Para o vídeo nativo entrar no WebRTC do Chromium seria
preciso injetar quadros já codificados.

## Decisão
Protocolo próprio sobre UDP: pacotes de ~1200 bytes, NACK, FEC XOR, pedido de keyframe,
controle de taxa por perda e atraso, autenticação por HMAC com chave da sessão.
É o modelo do Moonlight/Sunshine e do Parsec. Spec escrita antes do código (P2.1).

## Alternativas consideradas
- **Injetar no WebRTC via Encoded Transform:** a especificação do W3C não deixa o transform criar
  frames, só alterar ou descartar. Trocar o conteúdo dependeria de detalhes internos do Chromium
  e quebraria a cada atualização do Electron. Fica só como spike se a Fase 2 sair cara demais.
- **Pilha WebRTC nativa:** biblioteca externa ([[D-04-so-apis-do-windows|D-04]]).

## Consequências
- Precisa de regra de firewall UDP nova e de mensagens novas na sinalização.
- O relay pode repassar pacotes sem recodificar ([[P-03-arvore-recodifica-no-relay|P-03]]).
- Sem autenticação, qualquer um na LAN virtual injetaria vídeo: o HMAC é obrigatório.

## Ligações
[[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P2.1–P2.4) · [[D-07-decode-webcodecs-no-receptor|D-07]] · [[D-10-recepcao-udp-no-main|D-10]]
