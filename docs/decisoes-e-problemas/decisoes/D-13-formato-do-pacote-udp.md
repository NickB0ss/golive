---
tipo: decisao
id: D-13
titulo: "Formato do pacote UDP do vídeo nativo"
data: 2026-11-25
status: proposta, revisar com a spec (P2.1)
fase: 2-3
tags: [golive, transmissao]
aliases: [D-13]
---
# D-13 — Formato do pacote UDP do vídeo nativo

## Contexto
O transporte próprio ([[D-06-transporte-udp-proprio|D-06]]) é implementado dos dois lados
por linguagens diferentes: envio em C++ no exe, recepção e repasse em JS no main
([[D-10-recepcao-udp-no-main|D-10]]). O formato precisa estar fechado antes do código, caber
no MTU da LAN virtual, impedir que outra pessoa da rede injete vídeo, e deixar o relay da
Fase 3 repassar sem recodificar. Contrato completo:
[[2026-11-25-protocolo-video-nativo|Spec do protocolo de vídeo nativo]]
(`docs/superpowers/specs/`).

## Decisão
- **Datagrama de até 1200 bytes:** cabeçalho de 28 + payload + HMAC de 16. Vídeo em
  fragmentos fixos de 1152 bytes (o último menor). Cabe no MTU de 1280 do Tailscale sem
  fragmentação IP.
- **Big-endian** em todo campo, como todo protocolo de rede; `htonl` no Winsock,
  `readUInt32BE` no Node, hex legível nos vetores de teste.
- **Sequência e número de quadro de 32 bits, sem volta:** a sessão é refeita antes do limite
  (dias ou anos de uso). Só o tempo de envio dá a volta, e é tratado por diferença com sinal.
- **HMAC-SHA256 truncado em 16 bytes** (HMAC-SHA-256-128, RFC 4868) sobre cabeçalho e payload,
  com chave de 32 bytes **por sessão**, ou seja, por par emissor → receptor, trocada pela
  sinalização da sala. Janela de replay de 1024 sequências, consultada só depois do HMAC.
- **Sem cifra na versão 1.** A ameaça é injeção; o túnel da VPN já cifra; AES-GCM traz o
  risco de nonce repetido com reenvio e relay. Com a trava de versão, cifrar depois é só
  subir a versão do protocolo.
- **FEC XOR simples:** 1 pacote de paridade a cada N fragmentos do mesmo quadro (N anunciado
  na sinalização, padrão 10), com o XOR dos tamanhos para recuperar o último fragmento, que é
  menor.
- **Relay reescreve por salto** só sessão, sequência, tempo de envio, flag de reenvio e HMAC;
  quadro, fragmento e payload passam bit a bit.
- **Uma porta UDP por sala em cada PC**, no main; o exe manda de porta efêmera e recebe a
  volta no mesmo socket.

## Alternativas consideradas
- **Chave única por sala ou por origem:** um espectador poderia forjar pacotes para os outros.
  Descartada.
- **HMAC de 8 bytes:** suficiente contra tentativa online, mas economiza só 0,7 % e foge do
  tamanho padrão. Descartada.
- **AES-GCM desde já:** ver Decisão. Fica para uma versão futura se o app for usado fora de
  LAN virtual.
- **Sequência de 16 bits com volta (como RTP):** economiza 2 bytes e traz aritmética circular e
  replay ambíguo depois da volta. Descartada.
- **FEC Reed-Solomon:** recupera mais de uma perda por grupo, mas é bem mais código nos dois
  lados; com NACK numa LAN virtual de RTT baixo, XOR basta para começar (P2.3 mede).

## Consequências
- O JS e o C++ compartilham uma tabela de constantes e vetores de teste com HMAC real
  (spec, seção 12), usados nos testes cruzados do P2.2.
- O exe passa a informar a versão do protocolo na métrica; o main recusa um exe de outra versão.
- Três mensagens novas de sinalização (`nativo-oferta`, `nativo-resposta`, `nativo-fim`) para
  o P2.6. A chave passa pelo servidor de sinalização de quem criou a sala, que já é confiável
  hoje; ela nunca pode aparecer em log.
- Regressão de sigilo em relação ao DTLS-SRTP do WebRTC para quem usar o app numa LAN física
  sem VPN.

## Ligações
[[2026-11-25-protocolo-video-nativo|Spec do protocolo]] · [[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P2.1–P2.6, P3.1) · [[D-06-transporte-udp-proprio|D-06]] · [[D-10-recepcao-udp-no-main|D-10]] · [[D-04-so-apis-do-windows|D-04]]
