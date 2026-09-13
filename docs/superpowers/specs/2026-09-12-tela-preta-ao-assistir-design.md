# Tela preta ao passar a assistir outra tela — investigação e hotfix

Data: 2026-09-12. Base: `main` = 0.13.0 (lançada). Branch
`fix/tela-preta-ao-assistir`. Urgente: é a função principal do app.

## Relato

"Quando duas pessoas compartilham a tela, e eu estava vendo uma tela antes, e
depois clico para assistir a tela de alguém, a tela dessa nova pessoa só fica
preta, até a pessoa sair e entrar na sala." E: "tenho que ficar compartilhando
e parando a tela para funcionar".

## Evidência do log real (`logs/logs-asstindo nova tela.log`, 0.13.0)

- **O lado de quem assiste não loga nada.** Todas as linhas `[diag]` são de
  envio; o clique em "Assistir" e a tela preta não existem no log.
- Sinalização caindo com 1006 (18:03, 18:07 com "retomada recusada,
  renegociando tudo", 18:25 voltando com id novo sem "sessão retomada").
- Três recompartilhamentos em 2 min (19:36:43, 19:38:05, 19:38:24).
- O usuário, como **relay** da tela do #1 para outra pessoa, alternou por
  ~30 min entre `out=0x0@0fps realKbps=0` e ~2 kbps (19:49–20:20): quem
  recebia por ele via tela preta/parada.

## Hipóteses e o que a investigação mostrou

| Hipótese | Resultado | Evidência |
|---|---|---|
| Renegociar numa pc existente **empilha** transceiver de vídeo e o receptor fica preso na track velha | **Confirmada no Chromium real** | Spike no Electron 32.3.3 / Chrome 128 (`scratchpad/times/telapreta/spike`): depois da renegociação a stream recebida tem 2 tracks de vídeo, a 1ª muda; o `<video>` exibe **0 quadros em 2,5 s** e fica no último quadro da track velha, enquanto a track nova **decodifica 120 quadros** que ninguém mostra. `negotiateOffer` sempre fazia `addTransceiver` (mesh.js), mesmo com `renegotiate=true`. |
| Corrida `replaceTrack(null)` → `replaceTrack(track)` sem await deixa o sender sem track | **Refutada no Chromium real** | 60/60 repetições concluíram em ordem (`null>track`), sender termina com a track. O Chromium encadeia as operações como manda a spec. |
| Relay nunca avisa a origem que um filho voltou a assistir | Refutada (para relay) | O relay roda o loop de estatísticas (`syncStatsLoop` inclui `isRelaying()`), que chama `broadcastViewState` a cada 1–5 s. |
| Religar entrega a track errada (captura crua em vez do canvas) | Refutada | `localStream` troca a track crua pela do canvas (app.js, startShare). |
| Retomada de sessão (0.13.0) perde o estado de suspensão | Refutada | A sessão adotada reaproveita o mesmo objeto `mesh`; `addPeer` não sobrescreve peer existente. |
| O "gate" de assistir não religa o `<video>` / véu de pausa deixa o vídeo pausado | Refutada | `showTile` troca `srcObject` a cada stream nova; o gate é só uma camada; despausar chama `applyPainting`. |

**O que não ficou provado:** qual caminho, no uso real, renegocia uma
conexão **de tela** viva. Pelo código, todos os caminhos de tela fecham a pc
antes de ofertar de novo (`closeOut`); o empilhamento é certo hoje na
**câmera** (desligar/religar renegocia na mesma pc). Por isso o hotfix ataca o
defeito provado **e** trata o sintoma de forma localizada, com log para achar
o gatilho restante.

Achado lateral: quem **só assiste** (não transmite nem repassa) não roda o
loop de estatísticas — ou seja, nenhuma medida de recepção do lado dele
existia até aqui.

## Correção (hotfix)

1. **Renegociação reaproveita o transceiver de cada mídia** (`mesh.js`,
   `negotiateOffer`): `replaceTrack` + `setStreams` + um único
   `setParameters` (teto e degradação) no canal existente; só cria
   transceiver para mídia que ainda não tem canal; canal que sobra passa a
   `inactive` sem track. Testes em `mesh.test.js`.
2. **Detector de tela assistida sem imagem** (`stallwatch.js`, puro, com
   testes): mede os quadros que o `<video>` do tile de fato exibiu
   (`getVideoPlaybackQuality().totalVideoFrames`). Só dispara quando a tela
   **nunca exibiu quadro desde que passou a ser assistida** (ou desde que o
   tile foi recriado), após 6 s — tela parada de conteúdo estático não
   dispara. Timer próprio de 2 s (não depende do loop de estatísticas).
3. **Autocura localizada:** o espectador manda `reoffer` (novo tipo de
   sinalização, repassado pelo servidor com a mesma regra de sala do
   `view-state`) a quem serve aquela tela; quem recebe refaz **só aquela
   conexão** (`closeOut` + `offerTo`, ou `relayTo` se for relay daquele
   filho), com teto de 1 a cada 15 s por pedinte/kind. O espectador tenta no
   máximo 3 vezes, com 20 s entre elas, e registra "desistiu" se não voltar.
4. **Instrumentação `[assistir]`:** intenção de assistir, `view-state`
   enviado (só quando muda), demanda aplicada em quem transmite (com o estado
   dos canais de vídeo da pc), pedido/resultado de autocura.

### Ajustes da revisão independente

1. **`reoffer` validado de ponta a ponta:** o servidor deixa de tratá-lo como
   repasse genérico. Aceita apenas `to` string de peer da mesma sala e `kind`
   `screen`, `camera`, `screen@<id>` ou `camera@<id>`, com `<id>` decimal no
   formato dos ids de conexão do servidor (máximo de 16 algarismos) e presente
   na sala. Reconstrói `{ type, to, kind, from }` e aplica limite silencioso de
   2 pedidos/s por remetente. O cliente só processa kind composto cuja origem
   ainda é peer conhecido; seu histórico de reofertas tem teto de 128 chaves.
2. **Estado da autocura é da sessão:** o encerramento central da sessão limpa
   `stallWatch`, `lastReofferAt` e `lastViewStateSent`, eliminando tentativas
   herdadas quando uma nova sala reutiliza o mesmo id/kind.
3. **Reoferta não fecha PC com negociação ativa:** `mesh.offerTo` passa a
   devolver `true` somente depois de emitir a oferta e `false` quando a guarda
   a recusa; `relayTo` propaga o resultado. `reofferOne` consulta a guarda
   antes de fechar a conexão e o relay desfaz a reserva do filho quando a
   oferta não saiu.
4. **Câmera serializa remoção e religamento:** `removeTrack` usa a mesma
   guarda de negociação. Ao religar a câmera, a nova oferta espera a PC voltar
   a `stable` após a resposta da remoção, em vez de criar oferta em
   `have-local-offer`; os demais chamadores continuam descartando uma oferta
   concorrente para não duplicar transceivers.

## Fora deste hotfix

- A tela preta de relay em si (canvas no repasse, P4) e as quedas 1006 do
  host — itens da pesquisa de 2026-09-12 e do STATUS.
- Integração na branch `feat/integracao-2026-09-12` (a troca de fonte ao vivo
  e a migração de sala mexem nas mesmas funções): o hotfix entra lá depois de
  lançado.

## Como validar

Automático: `npm test`, `npm run lint`.
Manual (3 PCs, A e B transmitindo, C assistindo): ver
`docs/testes/2026-09-12-roteiro-tela-preta.md`.

## Travamento de captura em jogo

O log de 0.13.0 separa este defeito da tela preta ao começar a assistir: a
track de captura alternou `MUTE`/`UNMUTE` cinco vezes em cerca de dez segundos,
enquanto o encoder MediaFoundation continuava em hardware, a 26 fps. Portanto,
o gargalo é a entrega de quadros pela captura, não encoder ou rede. A máquina
também tem duas RTX 3060 com LUIDs diferentes e um adaptador básico, contexto
que reforça a hipótese de captura/driver, sem provar uma causa única.

O hotfix cria `capturewatch.js`, um módulo puro que recebe eventos com relógio
injetado. Ele transita de `ok` para `instável` com três `mute` em 20 s ou com
um `mute` contínuo de pelo menos 3 s. Depois de um `unmute`, exige 15 s sem
novo `mute` para voltar a `ok`; assim uma recuperação breve não faz o aviso
piscar. O `app.js` alimenta o detector nos listeners da track e em um tick de
1 s, e limpa o timer e o aviso ao parar de compartilhar.

Quando instável, o slot persistente de aviso do palco mostra a orientação para
usar janela sem borda ou compartilhar somente a janela do jogo. Esse aviso tem
prioridade sobre o aviso de encoder, porque descreve a causa observável e a
ação que a pessoa pode tentar. Não há correção possível no app para tela cheia
exclusiva ou para proteção anti-captura/DRM imposta pelo jogo; nesses casos o
aviso é deliberadamente diagnóstico, não uma promessa de recuperação.

O mesmo log mostrou outro defeito independente após fechar o host: o timer do
beacon ainda chamava `getPeerCount` depois de `embeddedServer` virar `null`.
O fechamento agora para o anúncio antes de invalidar o servidor, o callback
retorna zero se observar a transição, e a descoberta encerra o anúncio se um
callback ainda falhar. Isso evita a exceção recorrente sem criar protocolo ou
dependência nova.
