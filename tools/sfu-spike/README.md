# sfu-spike: prova de conceito de SFU local (mediasoup)

Experimento para responder UMA pergunta: se o app encaminhasse o video por uma
SFU em vez de um relay que decodifica e recodifica, o produtor continuaria
enviando uma vez e os consumidores receberiam quadros sem nenhum encoder no
meio? Roda em **loopback**, no mesmo PC, com cena sintetica. Fica em `tools/`,
fora do app e do instalador. **Nao substitui o transporte de producao** e nao
e iniciado por ele.

```
node tools/sfu-spike/run.js --help
node tools/sfu-spike/run.js --list --quick     # mostra o que rodaria, sem abrir o Electron
node tools/sfu-spike/run.js --quick            # 1 e 4 consumidores, ~1 min
```

## Instalar e preparar (uma vez, dentro de `tools/sfu-spike`)

As dependencias sao so deste experimento (versoes exatas, lock proprio) e **nao
entram** no `package.json` da raiz nem no instalador:

| pacote | versao |
|--------|--------|
| `mediasoup` | 3.28.0 |
| `mediasoup-client` | 3.24.4 |

```
cd tools/sfu-spike
npm ci --ignore-scripts      # instala sem rodar postinstall (rede: registry npm)
npm run prepare-worker       # baixa o worker pre-compilado oficial (rede: GitHub Releases do mediasoup)
npm run bundle               # gera renderer/mediasoup-client.bundle.js (local, sem CDN)
```

- `prepare-worker` roda o script oficial do pacote (`node npm-scripts.mjs postinstall`
  com cwd em `node_modules/mediasoup`, porque os caminhos dele sao relativos). Se
  nao houver binario para a plataforma, o proprio script oficial tenta compilar
  localmente (precisa de Python e toolchain C++); `MEDIASOUP_WORKER_BIN` aponta um
  binario proprio. **Nao ha checksum nem hash travado do binario baixado**: ele so e
  validado por executar (o proprio script roda o worker). Tambem **e o script oficial que decide
  cair em build local** (instala `invoke` via pip em pasta propria e compila) se o download
  falhar ou nao houver binario; confira o que ele fez antes de confiar no resultado.
- `bundle` usa um empacotador CommonJS minimo (`lib/bundler.js`) para nao acrescentar
  esbuild/webpack: o `mediasoup-client` 3.24.4 e suas dependencias sao CommonJS puro. A
  resolucao para em `tools/sfu-spike/node_modules`, falha com `browser` em objeto ou `exports`
  so de condicoes e trava a lista de 9 pacotes esperada (`scripts/bundle.js`). Depois de
  atualizar o `mediasoup-client`, rode `npm run bundle`; senao a verificacao `client-version`
  reprova (compara `SfuSpikeClient.version` da pagina com o pacote).
- `node_modules/`, `lab-out/` e o bundle estao no `.gitignore` e fora do ESLint. O
  `node --test` da raiz ignora `node_modules` por padrao e so roda os testes proprios
  do spike (`lib/*.test.js`, `renderer/*.test.js`, `run.test.js`), que nao exigem
  instalacao.
- Se faltar qualquer um dos tres passos, `run.js` sai com **codigo 4** listando o que
  falta. Nenhum cenario e dado como executado, passado ou pulado.

## O que roda

Para cada `--consumers` (padrao `1,4`) sobe uma SFU nova (worker + router proprios) e:

1. `Device.factory()` + `device.load(routerRtpCapabilities)`.
2. **Produtor**: UM transport de envio, UM producer, UMA codificacao (sem simulcast/SVC),
   track de canvas sintetico (a cena de `tools/media-bench`, reaproveitada sem copia).
   Codec preferido H.264 (`packetization-mode=1`); se o Device x router nao tiver
   H.264, cai para VP8 de forma **explicita** (`codec.fellBack`, vira `warning`).
3. **Cada consumidor**: transport de recepcao proprio, o servidor cria o consumer
   com `paused: true` (apos `router.canConsume`), o cliente chama `transport.consume`
   e so depois o servidor faz `resume`. O DTLS nao precisa estar conectado antes do
   consume (o `consume()` do cliente dispara o connect).
4. Aquece, mede por delta de contadores (`getStats` do cliente e `getStats` do servidor).
5. Com 2 ou mais consumidores, **fecha o segundo no meio da medida** e exige que os
   demais continuem recebendo quadros e que o servidor libere consumer e transport.
6. Fecha tudo e verifica: evento `subprocessclose` do worker, processo morto e as portas
   UDP anunciadas livres (um socket UDP exclusivo consegue ocupa-las).

### Seguranca do experimento

- **SFU**: `listenInfos: [{ protocol: 'udp', ip: '127.0.0.1', portRange: 42000-42199 }]`
  (`rtcMinPort`/`rtcMaxPort` sao obsoletos no 3.28). `0.0.0.0`, `::`, IP de LAN, TCP,
  `announcedAddress` e `listenIps` nao sao aceitos nem usados. O worker escuta **so em 127.0.0.1**.
- **Cliente (Chromium)**: o WebRTC abre sockets UDP efemeros em **`0.0.0.0`** (comportamento
  do navegador, fora do controle do mediasoup; nao existe politica que o faca ligar so no
  loopback; no Windows pode aparecer o aviso do Firewall). O experimento **nao promete**
  "nenhuma porta fora do loopback"; ele confina esses sockets a uma faixa propria
  (`webContents.setWebRTCUDPPortRange`, 42200-42399, separada da faixa da SFU), registra o
  **par de candidatos ICE selecionado** de cada transport do cliente (`getStats`:
  `transport.selectedCandidatePairId`; o remoto precisa ser UDP em 127.0.0.1 e o socket local
  ficar na faixa) e verifica ao fim que a faixa inteira voltou a ficar livre.
- Sem servidor HTTP/WebSocket. A pagina fala com a SFU **so por IPC** (`spike:rpc`), e o
  main aceita apenas o frame principal da pagina da bancada (`lib/trust.js`).
- `join` devolve um `peerId` imprevisivel amarrado ao dono (o webContents). Ids de
  transport/consumer so valem dentro do peer que os criou; id arbitrario ou de outro
  dono vira `FORBIDDEN`. Formas de payload, tamanho e estado (produtor so envia,
  consumidor so recebe, um unico producer, uma unica codificacao: simulcast/SVC e recusado)
  sao validados antes do mediasoup. As vagas de transport/producer/consumer sao **reservadas
  antes do `await`**: duas chamadas RPC concorrentes nao criam um recurso a mais (a segunda
  recebe `BAD_STATE`).
- Perfil temporario, sem lock de instancia, sem sala/descoberta/updater/firewall, sem
  captura de tela, camera ou microfone, permissoes recusadas, CSP sem rede.

## Relatorio

`lab-out/sfu-spike/sfu-spike-<UTC>[-rotulo].json` (pasta ignorada no git; `--out` muda).
Schema `golive-sfu-spike/1`: `status` (`ok`, `warning`, `partial`, `error`, `timeout`),
`midCloseCovered` (false se nenhum cenario fechou um consumidor no meio, ex.: so
`--consumers=1`), `runtime` (Electron/Chrome/Node/SO/CPU), `versions` (mediasoup, cliente, caminho do
worker), `architecture`, `limitations`, `planned`/`completed`/`missingScenarios` e
`scenarios[]` com:

- `checks[]` (`passed`, `failed`, `warning`, `not-applicable` com o motivo): `run`,
  `client-cleanup`, `listen-loopback`, `single-send`, `consumers-paused-then-resumed`,
  `codec`, `frames-flow`, `mid-close`, `server-forwarding`, `server-cleanup`, alem de
  `client-version` (o bundle do cliente roda a versao do pacote instalado), `client-ice-pair` e
  `client-udp-range` (rede do cliente, acima);
- `codec`: pedido, escolhido, **real** lido do `getStats` do envio e dos consumidores,
  `rtpParameters` do produtor, codec registrado no servidor, e `fellBack`/motivo;
- `sender` e `consumers[]`: quadros, fps, kbps, pacotes, perdas, congelamentos, resolucao;
- `forwarding`: pacotes do producer x de cada consumer no servidor (razao esperada ~1) e o
  tempo de CPU do worker na janela (`ru_utime + ru_stime`);
- `cleanup`: fechamento do worker, `verify` (pid vivo? portas livres?) e eventos da SFU;
- `raw`: passos, amostras e snapshots do servidor para auditar os numeros.

Codigos de saida: `0` ok ou ok com aviso, `1` falha de cenario/runtime, `2` timeout,
`3` uso invalido, `4` pre-requisito ausente.

## Como ler

- "Sem encode na SFU" e **propriedade da arquitetura** (o router do mediasoup
  encaminha RTP; o worker nao decodifica nem recodifica). O relatorio mostra o
  encaminhamento (razao de pacotes ~1, consumer `simple`) e o tempo de CPU do worker
  como **dado**, nao como prova de custo zero.
- O encoder/decoder do navegador so aparece se o Chromium expuser
  `encoderImplementation`/`decoderImplementation` (em geral so com captura real);
  ausente significa **desconhecido**, nao software nem hardware. Capabilities do Device
  nao provam hardware.
- Janelas curtas (`--quick`) sao ruidosas: o controle de banda do Chromium pode baixar a
  resolucao (veja `qualityLimitationReason`). Para comparar use os padroes e repita.

## Limites

1. **Loopback**, mesmo PC e mesmo processo Electron para cliente e SFU: sem perda,
   jitter ou banda reais.
2. **Camada unica**: todos recebem a mesma representacao. Consumidor lento nao tem
   qualidade propria nem isolamento de banda; o mediasoup tem simulcast/SVC, mas isto
   NAO foi implementado nem medido aqui. Nao ha promessa de qualidade independente.
3. Cena sintetica em canvas, nao captura real (nao reproduz o caso `contentHint=motion`
   da captura de tela/jogo).
4. **Nao substitui o benchmark multi-PC**.
5. Teste de invalidade do worker (`died`) e de timeout de fechamento sao cobertos por
   testes com dubles; a execucao real nao mata o worker de proposito.

## Criterio de decisao para o benchmark multi-PC

Avancar para uma SFU em producao so se, em PCs reais na LAN do uso (varios receptores,
incluindo um com banda ruim), com o mesmo jogo/captura e o mesmo codec:

- o produtor continuar com **um** envio e a CPU/GPU dele ficar igual ou menor que a do
  relay atual com a mesma carga de espectadores;
- o PC que hospedaria a SFU mantiver CPU e rede folgadas com 4+ consumidores
  (medindo o worker E o resto do app, nao so `ru_utime`);
- a perda de um receptor lento nao degradar os demais (isto exige simulcast/SVC ou
  politica de camada, ainda nao implementados aqui) e a recuperacao de keyframe (PLI/FIR)
  nao congelar os outros;
- a latencia e o tempo de entrada na sala ficarem no nivel do relay atual;
- o custo de operar a SFU (porta UDP, firewall, quem hospeda, queda do hospedeiro)
  for aceito pelo produto.

Se qualquer item falhar, o relay atual (decode + re-encode no intermediario) permanece.

## Testes

```
node --test "tools/sfu-spike/**/*.test.js"
```

Cobrem validacao e rejeicao de `listenIp`, `portRange`, chamadas concorrentes de
`createTransport`/`produce`/`consume`, o contrato com `tools/media-bench` (nomes e aridade), `listenInfos`, propriedade de peer/ids,
estados `send`/`recv`, `paused:true` + resume, `canConsume`, um unico producer,
`leave` e `close` idempotentes, timeout, `died`, fechamento durante a criacao do
worker/router/transport, a sequencia do cliente contra a SFU (com dubles), o avaliador
(cada verificacao reprova quando deve), o relatorio (cenario ausente = `error`), o
empacotador e as regras de isolamento (dependencias, gitignore, eslint, CSP). Nenhum
abre o Electron nem a rede.
