# Arquitetura vigente — 07/10/2026

GoLive continua um aplicativo Electron/WebRTC com mídia P2P e árvore de
retransmissão. Esta entrega extrai núcleos testáveis; não substitui o transporte
por SFU nem converte o renderer inteiro para módulos ES.

## Fronteiras atuais

- `src/main.js`, `src/main/` e preloads cuidam de runtime, permissões,
  captura nativa, armazenamento, janelas e origem local. `origem.js` serve
  a raiz renderer com contenção por realpath e uma exceção exata para
  `/shared/succession.js`; não expõe o diretório `src/` ou `shared/` inteiro.
- `server/signaling-core.js` mantém o estado da sala e roteia mensagens.
  `server/signaling.js` fornece o transporte WebSocket. Mídia não passa por
  esse servidor. A versão do app deve coincidir exatamente no join e beacon.
- `src/renderer/app.js` ainda orquestra sessão, captura, rede e ligação com
  a interface. `mesh.js` mantém PeerConnections e senders, incluindo kinds
  compostos como `screen@origem`. `ui.js` constrói o DOM e o design system
  vive em `sinal/`. Não houve redesign nesta entrega.
- `qualitypolicy.js`, `autoquality.js`, `peerquality.js`, `screenres.js` e
  `encodehealth.js` oferecem políticas puras. A carga vem de envios locais
  efetivos ou planejados, incluindo filhos de relay; membros ociosos e vídeo
  suspenso não representam um encoder ativo. BWE é orçamento de cada conexão.
- `audio-capture.js` acompanha capturas nativas, falhas e encerramento;
  seleção por processo não vira sistema inteiro ao falhar. O adaptador em
  `app.js` liga essas fontes ao AudioContext/tracks e conserva o fluxo de
  eventos nativos de fim da captura.
- `src/shared/succession.js` é o domínio puro canônico de sucessão. O servidor
  importa diretamente; o renderer carrega `../shared/succession.js`, que
  resolve tanto em `file://` quanto em HTTP. `src/renderer/succession.js` é
  somente um adaptador CommonJS para consumidores antigos.

## Telemetria e decisões

`txstats.js` lê outbound RTP e suas referências codec, transport/par ICE,
remote inbound e media source. Sem referência disponível, só um candidato
inequívoco permite fallback. Campos numéricos ausentes são `null`; zeros
observados continuam zero. `deriveRates` usa deltas e relógio explícito;
reset ou intervalo inválido não produz taxa inventada. O tracker associa
amostras à identidade real da PeerConnection e ao kind completo, incluindo
troca do conjunto RTP na mesma PC.

`rxstats.js` lê inbound RTP e deriva saúde de recepção e espera no buffer na
janela recente. Primeira amostra, reset ou falta de delta válido retornam
ausência. Perda e freeze continuam disponíveis. Buffer de jitter e RTT são
medidas diferentes; nenhum dos dois é latência ponta-a-ponta da imagem.

Após cada await de getStats, `app.js` confere sessão, peer e PC antes de
consumir o relatório. Saúde, largura de view-state e escada por destinatário
usam o kind completo. Pressão do relay anunciada rio acima vem dos seus
filhos daquela origem; a escada global usa apenas a tela local. O painel
rotula o menor BWE como mínimo por conexão, sem inferir capacidade total de
upload. Implementação de encoder desconhecida permanece desconhecida.

## Limites e próximos passos

Ainda há dependências implícitas em `window.GoLive` e ordem de scripts, e
`app.js` conserva muita orquestração. A migração planejada é gradual: separar
adaptadores de mídia, controlador de sessão e consumidores da UI; tornar
imports explícitos por fronteira e aplicar JSDoc/typechecking seletivo aos
contratos extraídos antes de ampliar a cobertura. Isso não está implementado
como conversão global nesta entrega.

Uma futura versão independente de protocolo precisa de matriz de
compatibilidade cliente/servidor, campos opcionais e testes de migração antes
de mudar a trava atual. O version-lock exato permanece vigente. Benchmarks
de captura, hardware e eventual SFU são experimentos separados, ainda sem
evidência para substituir o transporte de produção ou prometer desempenho
em PCs reais.
