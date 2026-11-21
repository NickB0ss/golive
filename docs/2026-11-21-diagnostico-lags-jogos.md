# Diagnóstico de travamentos na transmissão de jogos

Na base auditada do GoLive 0.28.0 havia falhas em três partes do caminho de
vídeo: a origem já entrega poucos quadros antes da retransmissão, a
recuperação pode deixar de recriar uma conexão ausente, e houve queda do
processo de GPU seguida de encode em CPU. A árvore aumenta o custo e a
dependência dos espectadores que retransmitem, mas sua remoção isolada não
resolve o baixo framerate observado na origem.

Recomendação: corrigir primeiro a recuperação sem sair da sala; medir e
reduzir o custo da captura sob carga; comparar a árvore com encaminhamento
RTP por SFU local antes de decidir uma migração. Este diagnóstico descreve
a base anterior à correção. As correções locais posteriores estão no
`STATUS.md` e em `docs/testes/2026-11-21-recuperacao-transmissao.md`.

## Base e limites

- Base: commit `7afe308`, branch `codex/ajuda-tour-027`, igual a
  `origin/main` após `git fetch origin` em 21/11/2026. Os arquivos locais
  previamente não versionados foram preservados.
- Três logs de `logs/lagsTela`: `golive transmitindo.log` (316 linhas),
  `golive assistindo 1.log` (1.691) e `golive assistindo 2.log` (519).
- Todos registram 0.28.0, Electron 44.4.3 e Chromium 152.0.7977.130.
  A origem do último trecho usa RTX 2060; os dois outros PCs, RTX 3060.
- Jogos informados pelo usuário: The Last of Us, Fortnite e Dead by
  Daylight. Os arquivos não identificam qual jogo estava ativo em cada
  instante nem o modo de tela. Não permitem concluir se o FPS do próprio
  jogo caiu junto com o vídeo recebido.
- A interseção dos três logs começa em `2026-11-21T03:39:16Z`.
  O log da origem não cobre os incidentes anteriores dos espectadores.
- Horários abaixo em Brasília, UTC−3. Nas referências aos arquivos,
  as linhas usam os horários UTC originais.

## Evidências dos logs

| Horário em Brasília | Observação | Referência |
|---|---|---|
| 00:39:34–00:40:05 | Captura solicitada em 1080p30. Um envio direto para o primeiro espectador já cai para 9–11 fps; RTT de 3–4 ms, perda reportada de 0% nas amostras e uso de 1–5% da BWE em parte do trecho. | `golive transmitindo.log:135–150` |
| 00:40:26 | Contexto do canvas perdido e saída refeita, antes do crash de GPU registrado mais tarde. | `golive transmitindo.log:152` |
| 00:41:15–00:41:36 | Origem registra `cap=0fps`, zero kbps e depois `cap=1fps`. O receptor registra zero RTP de vídeo em seis segundos, mas tráfego ICE/STUN continua. | `golive transmitindo.log:159–164`; `golive assistindo 2.log:431–432` |
| 00:42:20–00:42:34 | Os dois receptores perdem sinalização por silêncio; na origem há uma lacuna de aproximadamente 30 s entre mensagens registradas. As retomadas aparecem juntas, seguidas de `OverconstrainedError` ao reconfigurar captura. | `golive assistindo 1.log:1569–1574`; `golive assistindo 2.log:445–450`; `golive transmitindo.log:172–179` |
| 00:43:33–00:44:33 | Nova captura, quatro ofertas ignoradas por negociação em andamento e pedidos de recuperação respondidos com `nada a refazer`. | `golive transmitindo.log:181–196` |
| 00:44:14–00:44:39 | Espectadores saem e voltam, recebem IDs novos e surgem novas rotas de vídeo. Coincide com o sintoma de precisar reconectar manualmente. | `golive transmitindo.log:188–203` |
| 00:46:58–00:47:49 | Nova captura a 1080p60 começa perto de 50 fps e cai para 11–17 fps, inclusive com baixa utilização de banda. Há tanto períodos de uso alto como períodos de uso baixo; não é um único regime constante de rede. | `golive transmitindo.log:222–233` |
| 00:53:23–00:54:22 | Processo GPU cai com `reason=crashed exitCode=34`. O canvas é refeito; o envio passa de NVIDIA MediaFoundation para OpenH264 e termina em amostras de 6–12 fps. | `golive transmitindo.log:293–312` |

Os valores `cap` da linha `[diag]` vêm de `media-source.framesPerSecond`
referenciado pelo sender (`src/renderer/txstats.js:44–50`). Na origem com
canvas obrigatório, essa fonte é a saída do canvas, não uma medição
independente da captura WGC crua. Logo, `cap=10` localiza o problema antes
ou na alimentação do encoder, mas não distingue WGC, leitura do Processor,
desenho do canvas e agendamento do renderer.

Baixa banda usada, RTT baixo e perda reportada zero nessas amostras tornam
congestionamento uma explicação insuficiente para todo o trecho. Não
excluem falhas curtas de rede ou atrasos do próprio PC. O diagnóstico
`origem parou de enviar video` identifica ausência de RTP no hop observado;
numa folha recebendo de relay, não identifica sozinho qual etapa anterior parou.

Há ainda 297 avisos de áudio no log do espectador 1 e 24 na origem.
`cortes` é um contador acumulado de frames PCM descartados, não uma
contagem de interrupções audíveis. Os 801.344 frames da captura 8 no fim do
log da origem equivalem a aproximadamente 16,7 s de áudio a 48 kHz
descartado ao longo dessa captura. O teto de atraso fica perto de 120 ms
por construção do worklet; ler `117ms` repetidamente não prova áudio saudável.
Isso reforça a investigação de filas, agendamento e IPC sob carga, sem
provar saturação de CPU ou GPU específica.

## Falhas e riscos no código

### Recuperação recusa a conexão que já desapareceu

`reofferOne` retorna `false` no caminho direto se não existir
`mesh.peers.get(peerId)?.outConns[kind]` (`src/renderer/app.js:3497`).
Entretanto, o próprio vigia percorre as entradas esperadas pela árvore
quando a conexão desaparece (`checkStalledTiles`). Há um desacordo:
o receptor pede uma conexão que deveria existir, e a origem só aceita o
pedido se a conexão ainda existir.

Reproduzido no Electron 44.4.3 com `mesh.js` e o corpo de `reofferOne`
extraídos do código de produção, PeerConnections nativas, mídia sintética
e ICE restrito a candidatos locais:

| Estado na origem | Resultado do pedido | Novas ofertas |
|---|---|---|
| Conexão presente | `true` | A conexão é refeita |
| Conexão ausente antes do primeiro envio | `false` | 0 |
| Conexão ausente após `closeOut` | `false` | 0 |

O teste comprova a recusa desse estado. Não comprova que toda linha
`nada a refazer` dos logs passou pela mesma guarda: `isNegotiating` também
pode recusar a recuperação. A correção precisa validar sessão, origem,
papel na árvore e demanda antes de criar uma conexão ausente; retirar a
guarda indiscriminadamente faria a origem enviar também para folhas.

### Negociações em andamento bloqueiam novas tentativas

`mesh.offerTo` mantém uma trava por peer/kind durante seus awaits
(`src/renderer/mesh.js:568–589`). Uma nova oferta é descartada enquanto a
trava existir; `reofferOne` também retorna sem agir nesse estado.
O log registra esse bloqueio por cerca de um minuto para o mesmo peer.
A operação específica que ficou pendente não está registrada.

Melhoria: registrar etapa, duração e identidade da PC; limitar a duração
das negociações; invalidar operações antigas no fechamento e usar gerações
para que uma conclusão tardia não limpe a trava de uma conexão nova.
Um timeout só com `Promise.race`, sem invalidar o trabalho antigo, não basta.

### Reconfiguração de captura falha sem confirmação de aplicação

`reapplyAudienceQuality` grava `lastCaptureKey` antes de o
`applyConstraints` resolver (`src/renderer/app.js:751–760`). Se rejeitar,
a mesma configuração deixa de ser tentada até a chave mudar. Existe uma
rejeição real no log, mas a mensagem atual não mostra a constraint
responsável. Uma escada por destinatário pode reduzir o encode sem reduzir
o trabalho de captura/canvas compartilhado, que segue o piso global.

Melhoria: distinguir alvo solicitado e aplicado; atualizar a chave aplicada
após sucesso; registrar `name`, `message` e `constraint`; repetir com backoff
e restrições suportadas quando houver falha. Mudanças concorrentes precisam
de geração/serialização para uma resposta antiga não sobrescrever o estado atual.

### O caminho de vídeo depende do renderer e do canvas

O caminho atual é captura → `MediaStreamTrackProcessor` → canvas 2D →
`captureStream(0)` → encoder WebRTC (`screenrelay.js`). Todo quadro passa
pelo laço JavaScript e por um redesenho. O caminho foi escolhido por uma
medição real de 2026-09 no Chromium 128; essa medição não decide seu custo
sob os jogos atuais no Chromium 152.

A recuperação de contexto perdido já existe e foi acionada duas vezes.
Mesmo assim houve paradas e fallback para CPU. `onFrameError` só registra
erro no adaptador de `app.js:4769`; não inicia recuperação da fonte.
É necessário medir a captura crua e o canvas separadamente e tratar a falha
no estágio responsável, em vez de sempre refazer a conexão do espectador.

O código também força `ignore-gpu-blocklist`. O fato de essa flag estar
ativa não prova que causou o crash; qualquer teste sem ela precisa registrar
se o encoder permaneceu acelerado. O motivo específico do crash requer
dump/telemetria adicional. O `disabled_software` registrado no início dos
logs muda para `enabled` após a inicialização; não é evidência de aceleração
desligada durante toda a sessão.

## O papel da árvore e a diferença do Discord

A árvore de produção economiza envios na origem transferindo trabalho para
espectadores: o relay recebe vídeo, decodifica e cria novos senders para
recodificá-lo para seus filhos. O custo total de encode não desaparece.
Alguém que está jogando, assistindo e retransmitindo pode disputar recursos
nas três atividades, e as folhas dependem da saúde desse intermediário.

O Discord descreve captura/encode próprios integrados ao sistema e aos
drivers, fallback entre métodos de captura e distribuição pelo backend.
Sua publicação de junho de 2026 confirma uma SFU por chamada. Essas fontes
públicas já explicam a diferença arquitetural relevante; não foi feita
engenharia reversa do executável.
Fontes: [captura e pipeline](https://discord.com/blog/how-it-all-goes-live-an-overview-of-discords-streaming-technology),
[captura e encode próprios](https://discord.com/blog/from-blocky-to-brilliant-improving-video-quality-on-discord-go-live-on-amd-gpus),
[SFU por chamada](https://discord.com/blog/how-we-moved-discord-voice-to-the-edge).

Uma SFU encaminha mídia comprimida sem recodificá-la. Isso retira o
decode/re-encode do intermediário de distribuição, mas não conserta uma
origem produzindo 10 fps nem elimina o upload do nó que distribui.
Qualidade independente para receptores lentos exige uma política explícita
de camadas/simulcast/SVC ou outro compromisso de qualidade; não vem pronta
apenas por trocar o transporte.
Fonte: [mediasoup Overview](https://mediasoup.org/documentation/overview/).

O repositório já tem `tools/media-bench` e `tools/sfu-spike` com mediasoup,
isolados do instalador. Não foi encontrado nesta análise um resultado
multi-PC com esses jogos que autorize substituir a árvore. A SFU local
merece comparação prática; hospedá-la no próprio transmissor continua
cobrando dele a saída para todos os receptores. Um PC ocioso pode assumir
essa distribuição, com custo de escolha do hospedeiro, firewall e recuperação.

## Experimento de segundo plano

Bancada temporária em `lab-out/lags-2026-11-21/spike-hidden.js`, saída em
`spike-hidden.json`: mídia sintética 1280×720, H.264 em loopback, relay de
produção, perfil isolado, janelas escondidas e depois minimizadas. Não
capturou tela, áudio, jogo ou outro aplicativo. Runtime coincide com os logs.

O main de produção não declara `backgroundThrottling: false` na janela
principal; a bancada de mídia declara. Foi testada essa diferença com as
flags atuais de segundo plano, em janelas de medição de quatro segundos:

| Configuração | Escondida, fps decodificados | Minimizada, fps decodificados |
|---|---:|---:|
| `backgroundThrottling: true` | 59,6 | 56,5 |
| `backgroundThrottling: false` | 59,4 | 57,9 |

Sem jogo e com fonte sintética, não ocorreu colapso de frames em nenhuma
configuração. A amostra curta não mede ganho estatístico nem exclui efeito
sob carga/captura real. Ela não sustenta apresentar essa flag como solução
para os travamentos. Também mudá-la altera a semântica de visibilidade usada
pelo app para suspender vídeos e prévias.

## Ordem recomendada de melhorias

| Prioridade | Entrega | Evidência de aceitação |
|---|---|---|
| 1 | Recuperar conexão esperada ausente; cancelar negociação obsoleta; limitar espera e preservar estado aplicado da captura. | Derrubar PC de entrada/saída, interromper oferta e parar/reiniciar transmissão sem ninguém sair da sala; verificar frames exibidos no receptor. Pedido de folha não cria envio direto indevido. |
| 2 | Medir estágios da origem e recuperação de GPU/canvas, com filas limitadas e descarte de quadros antigos. | FPS bruto, processado, codificado, decodificado e exibido, idade do último quadro, atraso do event loop, tempo de desenho, carga por processo e tempo sem imagem no mesmo relógio. |
| 3 | Comparar captura direta sem hint, direta com `motion` e canvas atual no Electron 44.4.3. | Mesmo jogo/cena, codec, qualidade e destinatários, janela do GoLive coberta pelo jogo, três repetições; medir CPU/GPU e FPS do jogo e do vídeo. Usar a bancada `owned-window` para isolar o bug antigo e depois o jogo real. |
| 4 | Comparar árvore e SFU local com 1, 2 e 4 espectadores. | Mesma captura; medir também o PC intermediário, receptor lento, saída do hospedeiro, keyframes, perda de nó e reconexão. Avançar se reduzir custo e congelamentos sem ampliar falhas operacionais. |

Se a captura direta atual continuar inadequada sob carga, o próximo
experimento é captura/encode nativos com menos cópias e independentes da
interface, preservando o transporte WebRTC. Tirar apenas a interface do
Electron ou trocar JavaScript por outra linguagem não resolve, por si só,
o caminho de mídia identificado.

Para a validação com jogos, comparar 720p30 e 1080p60, transmissão sozinha e
transmissão enquanto assiste outra tela, e modos sem bordas/exclusivo quando
o jogo oferecer. Medir uma cena em movimento para não confundir baixa taxa
de atualização de uma tela estática com falha. O próprio Discord recomenda
sem bordas para compatibilidade da captura no Windows:
[documentação de captura](https://support.discord.com/hc/en-us/articles/9410427556375--Windows-Capturing-Application-Window-for-Screen-Share-and-Go-Live).

Critério de produto: ninguém precisar sair e entrar para recuperar imagem;
falhas de mídia aparecerem como recuperação em andamento; comparar tempo
sem imagem e FPS exibido sob o mesmo jogo antes/depois. A análise dos logs
e a bancada sintética não equivalem à reprodução dos três jogos em múltiplos PCs.

## Verificação executada

- Bancada no Electron 44.4.3 concluída com código de saída 0; resultado
  `lab-out/lags-2026-11-21/spike-hidden.json` contém os quatro cenários e a
  reprodução da recuperação ausente.
- 203 testes existentes de `screenrelay`, `mesh`, `stallwatch`,
  `autoquality`, `peerquality` e `screenres` passaram, sem falhas ou pulos.
  Essa cobertura não impede a falha de integração reproduzida em
  `reofferOne`, que vive no orquestrador `app.js`.
- As referências principais aos logs foram conferidas por linha. Nenhuma
  execução dos três jogos foi realizada nesta análise.
