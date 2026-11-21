# Validação da recuperação de transmissão

O objetivo é recuperar a imagem sem sair da sala e impedir que operações de
uma conexão antiga interfiram na conexão substituta. A base da investigação
é o GoLive 0.28.0, commit `7afe308`, com Electron 44.4.3.

## Cobertura automatizada

- `mesh.test.js`: prazo de negociação, fechamento durante operações
  assíncronas, conclusão tardia, pausa e retomada por conexão.
- `reoffer-app.test.js`: conexão esperada ausente, guarda de topologia,
  sessão encerrada e recuperação direta com falha persistente.
- `capturequality.test.js` e `capturequality-app.test.js`: constraints
  confirmadas após sucesso, retry, serialização, troca e encerramento.
- `screenrelay.test.js`, `capturediag-app.test.js` e
  `audio-capture-app.test.js`: contadores, contexto perdido, leitor
  encerrado e troca de fonte usando os adaptadores de produção.

Rodar a suíte completa e o lint na raiz do repositório:

```powershell
npm test
npm run lint
npm run env:check
npm run smoke:app
```

Os testes de sinalização precisam conectar a `127.0.0.1`. Na sandbox deste
ambiente, o socket aceita `listen`, mas a conexão pode falhar com `EACCES`.
Nesse caso, executar o mesmo teste com a permissão de conexão local; não
substituir os WebSockets por mocks para obter um resultado verde.

## Bancada de vídeo no Electron

```powershell
& .\node_modules\electron\dist\electron.exe .\tools\bancada-sala\recuperacao-video.js
```

A bancada cria um perfil próprio em `lab-out/recuperacao-video`, renderiza
sem janela visível e usa uma cena sintética. Não abre o app de uso pessoal,
sala, updater, captura de tela, câmera ou microfone. As PeerConnections, o
encoder, o decoder e o elemento de vídeo são nativos do Electron. A
sinalização entre as duas pontas é local à bancada; os adaptadores
`createScreenRelay`, `offerOwnStreamTo` e `reofferOne` são lidos de `app.js`.

O JSON em `lab-out/recuperacao-video/recuperacao-*.json` registra checks,
runtime, limitações e contadores da entrada/canvas. O teste exige quadros
decodificados e callbacks de apresentação do elemento de vídeo, não apenas
conexão ICE em estado `connected`.

Cenários: envio inicial; conexão de saída ausente; oferta interrompida;
pedido direto de folha; pausa durante substituição de conexão; retomada;
fim do leitor da captura e criação de outro relay. Toda saída deve voltar
a apresentar quadros nos cenários de recuperação, e a pausa deve deixar o
sender efetivamente sem track de vídeo.

O modo offscreen mantém a apresentação ativa sem mostrar janela. Uma
janela somente escondida entregou mais de 200 quadros ao decoder, mas
parou seus callbacks de apresentação após poucos frames. Esse comportamento
da bancada não foi tratado como falha de transporte nem como reprodução
do travamento em jogo.

## Teste em PCs reais

Usar a mesma compilação em todos os PCs. Registrar os logs da origem, dos
relays e de quem assiste, preservando o horário do incidente.

1. Transmitir uma cena em movimento de The Last of Us, Fortnite ou Dead by
   Daylight por pelo menos dez minutos. Repetir em 720p30 e 1080p60, com o
   GoLive coberto pelo jogo e, quando disponível, em janela sem bordas.
2. Começar com um espectador; adicionar outros para exercitar a árvore.
   Comparar transmissão sozinha com transmitir enquanto assiste outra tela.
3. Pausar a transmissão, interromper/reconectar um espectador e confirmar
   que a pausa não entrega vídeo. Retomar e verificar a imagem sem sair da sala.
4. Trocar a janela compartilhada durante a transmissão. Confirmar que os
   receptores exibem a nova fonte e que o áudio anterior foi encerrado.
5. Diante de perda de imagem, aguardar a recuperação automática e anotar
   o tempo. Não sair imediatamente da sala: isso apaga o estado que o teste
   precisa observar.

Comparar os novos campos `[diag] captura-local` com as linhas por sender:
`entrada` mede frames lidos pelo Processor; `canvas` mede desenhos
solicitados à saída; `repete` conta reapresentação de imagem estática.
`desenhoMs` é tempo síncrono no renderer, sem medir o trabalho posterior
da GPU. O `cap` da linha do sender continua sendo a fonte do encoder.

A bancada sintética não mede o impacto no FPS desses jogos, o backend WGC,
o comportamento do driver sob carga ou a rede entre PCs. Ganho de desempenho
e eventual migração para SFU dependem dessa comparação prática.

## Resultado desta execução

- Suíte completa: **2.532 testes passaram**, zero falhas, cancelamentos ou
  pulos. Registro em `.superpowers/sdd/lags-2026-11-21/suite-final.log`.
- Lint: zero erros e oito avisos preexistentes de `require-atomic-updates`
  em `main.js` e `app.js`.
- Smoke do app: passou com zero falhas e zero avisos. Artefato
  `lab-out/lags-2026-11-21/smoke-final.json`.
- Electron real: **15 checks passaram**, incluindo apresentação de frames
  após perda da conexão, oferta interrompida, pausa/retomada e recriação
  do relay encerrado. Artefato
  `lab-out/recuperacao-video/recuperacao-2026-11-21T21-01-16-607Z.json`.
- Revisão independente aprovada: os três achados de pausa, retry e troca
  de fonte foram corrigidos e reavaliados, sem novos bloqueios no escopo.

A base investigada foi 0.28.0. As correções compõem a versão 0.28.1.
