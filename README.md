# GoLive LAN

Compartilhamento de tela em 1080p60 entre amigos, direto de PC pra PC pela sua
LAN virtual (Radmin VPN ou Tailscale). Sem servidor na nuvem, sem conta, sem
ninguém no meio olhando a transmissão.

Feito porque o Go Live do Discord foi suspenso no Brasil em agosto de 2026.

---

## Antes de tudo: teste a sua rede

Esta é a parte que decide se o projeto vai funcionar, e vem antes de instalar
qualquer coisa.

O app não tem servidor de mídia. Quem transmite manda uma cópia do vídeo pra
cada espectador. Isso significa que o **upload de quem transmite** é o teto de
tudo:

| Espectadores | Upload necessário (1080p60 a 12 Mbps) |
|---|---|
| 1 | ~12 Mbps |
| 2 | ~24 Mbps |
| 3 | ~36 Mbps |
| 5 | ~60 Mbps |

Isso é por transmissor: com duas pessoas transmitindo ao mesmo tempo, o
**download de cada espectador** também dobra (uma cópia de cada
transmissão chegando).

Boa parte dos planos de fibra no Brasil entrega upload bem menor que o
download. Confira o seu antes de convidar meia dúzia de gente.

O segundo problema é o Radmin em si. Ele tenta conexão direta entre os peers,
mas quando não consegue (CGNAT, NAT simétrico — comum em operadora brasileira)
cai pra um relay dele, e aí a banda despenca pra alguns Mbps. O teste abaixo
mostra qual dos dois casos é o seu:

```powershell
# Na máquina de quem vai transmitir:
cd tools
.\testar-radmin.ps1 -Modo servidor

# Na máquina de um amigo:
cd tools
.\testar-radmin.ps1 -Modo cliente -Alvo 26.x.x.x -Espectadores 3
```

Ele mede latência, jitter, perda de pacote e banda real nos dois sentidos, e
te diz em qual faixa de qualidade você cabe. Precisa do `iperf3.exe`
(<https://iperf.fr/iperf-download.php>) dentro da pasta `tools/` — sem ele, só
o teste de latência roda.

**Se der abaixo de 10 Mbps:** instale o [Tailscale](https://tailscale.com) no
lugar do Radmin e rode o teste de novo. É WireGuard, faz P2P direto em muito
mais situações, e é gratuito até 100 dispositivos. Nada no app muda — só o IP
que vocês digitam (Tailscale usa a faixa `100.x.x.x`).

---

## Instalação

Precisa do [Node.js 18+](https://nodejs.org) em todas as máquinas.

```bash
npm install
```

## Como usar

**1. Alguém da turma clica em "Criar sala"** na tela inicial do GoLive.
O app sobe o servidor de sinalização embutido, libera a porta no firewall
(pode pedir uma confirmação do Windows na primeira vez) e mostra um
endereço pronto pra copiar:

```
Sala ativa
26.13.45.201:9000              [Copiar]
```

Sem terminal, sem instalar Node à parte, sem digitar porta.

**2. Todo mundo mais abre o GoLive** e clica em "Entrar em sala", cola o
endereço (`26.x.x.x` — a porta é opcional, assume `:9000`), escolhe um
nome e clica em Conectar.

Quem quiser transmitir clica em **Compartilhar tela**, escolhe monitor ou
janela, e pronto. Mais de uma pessoa pode transmitir ao mesmo tempo na
mesma sala.

Duplo clique em qualquer vídeo expande pra tela cheia.

**Se você fechar o GoLive no PC que criou a sala, a sala cai pra todo
mundo** — não há como transferir a sala pra outra máquina no meio da
sessão.

## Gerar o instalador pros amigos

Pra ninguém precisar instalar Node:

```bash
npm run dist
```

Sai um instalador em `dist/GoLive LAN Setup <versão>.exe`. Ele cria atalho
na Área de Trabalho e no Menu Iniciar, e desinstala normalmente pelo painel
do Windows. Quem só quer transmitir/assistir não precisa mais de Node — o
servidor de sinalização agora sobe embutido no próprio app quando alguém
clica em **Criar sala** (ver "Como usar" abaixo).

---

## Configurações de qualidade

Tudo no painel da esquerda, e tudo aplica ao vivo — não precisa reiniciar a
transmissão.

- **Bitrate** — o botão mais importante. Suba até a imagem ficar boa, desça
  assim que o indicador acusar `Limitado por: banda da rede insuficiente`.
- **Codec** — H.264 usa o encoder da GPU (NVENC/AMF/QuickSync) e tem a menor
  latência; é o padrão certo pra jogo. VP9 rende imagem melhor no mesmo
  bitrate mas come CPU. AV1 economiza banda de verdade, e só vale se as GPUs
  dos dois lados forem novas (RTX 40+, RX 7000+, Arc).
- **Áudio do sistema** — captura o som que sai da placa, não o microfone.
  Funciona no Windows via loopback.

O painel de estatísticas mostra fps real, resolução, banda e latência a cada
segundo. O campo **Limitado por** é o mais útil pra diagnóstico: ele diz se
quem está te segurando é a rede, a CPU ou o encoder.

---

## O que fizemos pra segurar os 60 fps

Compartilhamento de tela em WebRTC entrega 30 fps por padrão, mesmo pedindo
60. Três ajustes resolvem, e todos estão no código:

- `track.contentHint = 'motion'` — avisa o encoder que é vídeo em movimento,
  não um slide parado. Sem isso o Chromium prioriza nitidez e derruba o fps.
- `degradationPreference = 'maintain-framerate'` — quando a banda aperta, o
  encoder baixa a resolução em vez de congelar a imagem.
- `maxFramerate` e `maxBitrate` explícitos no `sendEncodings`, mais um
  `applyConstraints` de reforço na track, porque alguns caminhos de captura
  ignoram as constraints iniciais e entregam 30 fps caladamente.

---

## Se der problema

**"Não consegui conectar"** — o servidor está rodando? A porta 9000 está
liberada? Rode como administrador na máquina do servidor:

```powershell
netsh advfirewall firewall add rule name="GoLive" dir=in action=allow protocol=TCP localport=9000
```

**Conecta, aparece o peer, mas o vídeo não vem** — é ICE não fechando. O
Radmin às vezes bloqueia UDP entre peers; teste um `ping 26.x.x.x` primeiro.

**fps travado em 30** — abra as estatísticas e veja o campo "Limitado por". Se
for `CPU`, troque o codec pra H.264. Se for `banda`, baixe o bitrate ou a
resolução.

**Sem áudio** — o loopback só funciona no Windows, e só captura o áudio da
máquina inteira. Se você usa saída de áudio exclusiva (modo WASAPI exclusivo
em alguns players/DACs), o loopback vem mudo.

---

## Limites conhecidos

A malha P2P é o desenho certo pra 2-4 pessoas e o desenho errado pra 8. Se a
turma crescer, o caminho é trocar a malha por um SFU (mediasoup ou o
[MediaMTX](https://github.com/bluenviron/mediamtx), que é bem mais simples):
quem transmite manda **uma** cópia pro SFU, e o SFU replica pros outros. O
upload de quem transmite passa a ser fixo, independente da plateia — mas aí
alguém precisa hospedar o SFU numa máquina com upload folgado, ou numa VPS.

Vale fazer essa troca quando o teste de rede mostrar que o upload não cobre o
número de gente que vocês querem.
