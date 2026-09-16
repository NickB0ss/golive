# BRIEFING — GoLive LAN: pesquisa sobre transporte de transmissão de tela

Data da pesquisa: 2026-09-16. Escreva SEMPRE datas/versões que encontrar, e marque
o que não conseguiu confirmar como "não confirmado".

## O produto hoje (v0.16.0)

- App Electron (Windows), desktop, `github.com/NickB0ss/golive`.
- Compartilhamento de tela 1080p60 entre AMIGOS (grupo pequeno, 3-6 pessoas),
  motivado pela suspensão do Go Live do Discord no Brasil em agosto de 2026.
- **Sem servidor na nuvem, sem conta, sem ninguém no meio.** É um valor explícito
  do projeto ("sem ninguém no meio olhando a transmissão").
- Mídia é **WebRTC P2P puro** dentro de uma LAN virtual (Radmin VPN ou Tailscale).
  ICE usa só STUN do Google (`stun.l.google.com`). **Não há TURN.**
- Sinalização: servidor `ws` embutido no processo de quem cria a sala, porta
  9000-9010, liberada no firewall do Windows. Descoberta por beacon UDP na LAN.
- Vídeo: H.264 via encoder de hardware (NVENC/AMF/QuickSync), escolhido pelo
  Chromium. Áudio: Opus estéreo + loopback do Windows (WASAPI) e captura por
  processo via addon nativo C++.
- Topologia: árvore de retransmissão de 1 nível (origem -> 1 relay -> 2 folhas),
  profundidade máx 2. **Teto prático de ~4 pessoas**; acima disso vira malha e
  cada espectador extra custa mais um encoder na origem.
- Escada automática de qualidade: desce degrau por tamanho da sala e por
  telemetria de encode.

## As dores conhecidas (o motivo desta pesquisa)

1. **Radmin VPN cai pra relay** quando não consegue P2P direto (CGNAT e NAT
   simétrico são a regra em operadora brasileira: Vivo, Claro, Oi, Tim). Nesse
   caso a banda despenca para poucos Mbps e 1080p60 é impossível.
2. **Upload do transmissor é o teto**: 12 Mbps por espectador. 3 espectadores =
   36 Mbps de upload. Fibra brasileira costuma ter upload muito menor que download.
3. **Radmin VPN exige instalação manual de um app de terceiros**, com conta/rede,
   antes de o GoLive sequer abrir. Atrito enorme de onboarding.
4. Se quem criou a sala cai, a sinalização cai junto (há sucessão, mas é frágil).
5. Teto de ~4 pessoas por causa da árvore.

## O que o usuário pediu

"Analise se o Radmin VPN ou alguma outra VPN é a única opção gratuita. Avalie
outras ferramentas — tenho um exemplo que talvez seja interessante: o ngrok. Mas
levante questionamentos para talvez fazermos uma MUDANÇA RADICAL no aplicativo."

Ou seja: não é para defender o desenho atual. É para questioná-lo.

## Restrições que qualquer proposta precisa respeitar (ou declarar que quebra)

- **Custo: gratuito ou quase.** É um app entre amigos, sem monetização. Se algo
  custa, diga o custo mensal REAL em USD/BRL para 5 pessoas usando ~10h/mês a
  12 Mbps (calcule o volume de tráfego: 12 Mbps * 3600s = ~5,4 GB/hora por fluxo).
- **Latência baixa**: é para jogar/assistir junto, não streaming assíncrono.
  Acima de ~200ms de glass-to-glass já incomoda.
- **Windows desktop**, Electron. Captura de tela + áudio de sistema.
- Público leigo: quanto menos passos de instalação, melhor.
- Privacidade: hoje ninguém no meio vê a transmissão. Se a proposta quebra isso,
  diga explicitamente.

## Como entregar

Markdown. Seja concreto e numérico: limites de free tier com números, versões,
datas, links. **Cite a fonte (URL) de cada número.** Se um dado é de memória e
você não confirmou na web, marque "[não verificado]". Prefira dizer "não achei"
a inventar. Termine com um veredito direto: recomendo / não recomendo / depende de X.
