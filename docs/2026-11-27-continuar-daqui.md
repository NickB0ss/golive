# Continuar daqui — passagem para a próxima sessão (27/11/2026)

Nota para outro agente do Claude (ou pessoa) continuar o trabalho em outro computador.
Leia esta nota inteira antes de mexer em qualquer coisa. Depois dela, na ordem:
`STATUS.md` (topo), `docs/superpowers/plans/2026-11-25-pipeline-nativo.md` ("Comece aqui")
e `docs/decisoes-e-problemas/README.md`.

## Estado em uma frase

O app ganhou 45 correções de bugs com teste (auditoria de 25/11) e 11 de design, e o pipeline
nativo avançou o que dava sem Windows (P1.1, P2.1, P2.2). Nada foi testado em PC Windows real.

## Verificação no fim desta rodada (Linux, nuvem)

- `npm test` (depois do P2.3, 27/11 à noite): 2743 testes, 0 falhas, 13 pulados (sem binário do
  exe neste container). Antes do P2.3: 2727 testes, 0 falhas. Inclui os testes do `golive-media` porque havia binário
  Linux em `build/Release/`; sem binário (CI no Windows) 5 + 8 desses testes são pulados.
- `npm run lint`: 0 erros, 8 warnings antigos (6 `require-atomic-updates` em `app.js`, analisados
  como falsos positivos em `docs/auditoria-2026-11-25/bugs-renderer-midia.md`, e 2 em `main.js`).
- C++ de `native/media/`: compila sem warnings com `g++ -std=c++20` e com MinGW
  (`x86_64-w64-mingw32-g++-posix`). **Nunca foi compilado com MSVC nem executado no Windows.**
- O addon `golive_audio.node` não foi recompilado nesta rodada (não há MSVC aqui).

## O que foi feito

### Pipeline nativo (plano `docs/superpowers/plans/2026-11-25-pipeline-nativo.md`)

| Passo | Onde | Estado |
|---|---|---|
| P1.1 esqueleto do `golive-media` | `native/media/{main,args,controle,metricas}.*`, target no `binding.gyp`, nota D-11 | pronto; falta MSVC |
| P2.1 spec do protocolo UDP | `docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md`, nota D-13 | pronto, revisado por um segundo agente |
| P2.2 empacotar e remontar | `src/main/videonativo/{constantes,pacote,remontar}.js`, `native/media/{pacote,sha256,protocolo,pacote_vetores}.*` | pronto; 57 testes + teste cruzado |
| P2.3 recuperação de perda | `remontar.js` (suspeita, FEC automático, `aoNack`), `reenvio.js` (`BufferReenvio`), `simulacao.test.js` | JS pronto (2% de perda → ~99% dos quadros sem keyframe); **falta o buffer de reenvio em C++ no exe** |

Pontos para quem continuar o pipeline:
- O exe tem modo `--gerar-vetores` (usado pelo teste cruzado `src/main/videonativo/cruzado.test.js`).
- HMAC-SHA256 no C++ é implementação própria (mesmo código no Linux e no Windows, conferido nos
  vetores FIPS 180-4 e RFC 4231). BCrypt fica para gerar a chave no P2.6. Justificativa em `sha256.h`.
- P2.3 no receptor: `Remontador` recebe `aoNack(entradas)` (o `ReceptorVideo` repassa como
  `aoNack(sessao, entradas)`); quem usa chama `tick()` a cada 5 ms. As entradas já são válidas para
  `payloadNack`. O lado de quem envia é `BufferReenvio.guardar(p)` / `atender(entradas, bitrate)`,
  que devolve os pacotes com `RETRANSMISSAO` (montar com sequência nova). Ele é a referência para
  o porte em C++ (mesmos tetos da spec 5.3) e serve ao relay da Fase 3.
- Achado do P2.3 (registrado na Revisão da spec): com `fecN = 0`, "cada fragmento pedido uma vez
  só" deixa a entrega em 87–94% com 2% de perda. Com FEC (padrão) passa folgado. Só importa se
  `fecN = 0` virar opção real.
- Ambiguidades da spec decididas na implementação estão na seção "Revisão" da spec
  (linha "Implementação P2.2").
- A spec registra que o WebSocket da sala é `ws://` sem TLS: numa LAN física sem VPN a chave da
  sessão UDP vaza. Com Radmin/Tailscale o túnel cifra. Decidir antes do P2.6 (seção 8 da spec).

### Auditoria de bugs (`docs/auditoria-2026-11-25/`)

Quatro relatórios, cada achado com arquivo:linha, cenário e evidência, e todos corrigidos com
teste de regressão que falhava antes:

| Relatório | Achados | Commit da correção |
|---|---|---|
| `bugs-servidor.md` (S-01..S-10) | 10 (3 altos) | `471a5f8` (S-10 junto com M-01 em `5496fd7`) |
| `bugs-main.md` (M-01..M-09) | 9 (1 alto) | `5496fd7` (lado renderer de M-08/M-09 em `8d10eb7`) |
| `bugs-renderer-midia.md` (R-01..R-10) | 10 (1 alto) | `8d10eb7` |
| `bugs-mesa.md` (J-01..J-16) | 16 (3 altos) | `71e1c89` |

Mudanças de comportamento que o dono precisa conhecer:
- **Servidor:** join só na sala `geral` (o app nunca usou outra); teto de pessoas por servidor;
  fila de saída de 8 MB por socket (passou disso, a pessoa é cortada e retoma); join em até 10 s;
  até 8 conexões pendentes por IP. **Liderança:** depois de `transfer-owner`, quem recebeu só
  mantém a coroa pela retomada (`resumeToken`); reabrir o app sem retomada devolve a liderança a
  quem criou a sala. Na migração a liderança passa por uma chave de uso único (`leaderKey`,
  `leaderKeyHash`); o campo `newOwnerClientId` saiu do protocolo. Docs antigas em
  `docs/superpowers/*transferencia-de-sala*` ainda citam `newOwnerClientId`.
- **Main:** sem menu padrão no app empacotado (Ctrl+R e DevTools desligados); em `npm start`
  continuam. Se o renderer cair ou recarregar, o main para capturas, overlay e a sala.
- **Mesa:** rádio — só quem pôs a faixa ou o líder pula na hora; os outros votam (2 votos);
  sentar no meio da mão é recusado em truco, dominó e oito; fim de jogo exige "Nova partida";
  fichas de pôquer/blackjack ficam guardadas por pessoa. Quiz: o gabarito saiu do renderer, mas
  continua nos arquivos do app instalado (fechar de vez exige gabarito só no servidor).

### Auditoria de design (`docs/auditoria-2026-11-25/design.md`)

11 correções aplicadas (chave crua `ui.qualidade.padrao` no seletor, textos fixos em português no
inglês e no espanhol, contrastes abaixo do mínimo, abas de Configurações, textos ambíguos), 21
achados não aplicados (D-12..D-32) e 3 propostas de "refazer" **esperando decisão do dono**:
R1 Mesa vazia (mock em `design/proposta-mesa-vazia.html`), R2 cabeça da sala, R3 barra da janela
da Mesa legível em qualquer zoom. As bancadas `tools/sinal-prints/*` param no tour de
boas-vindas; marcar `golive:tour:v1` como visto antes de navegar (como o agente fez nas cópias).

## Próximos passos, em ordem

1. **Num PC Windows com MSVC** (o que a nuvem não faz):
   1. `npm ci` e `npm run build:native`: o addon e o `golive-media.exe` precisam compilar e ligar
      (D-11; conferir que o exe não puxa `node.lib` nem o hook de delay-load). Rodar
      `build\Release\golive-media.exe --segundos 2` e `npm test` (os testes do exe deixam de pular).
   2. P0.1 e P0.2 do plano (linha `[gpu] prioridade` no log; A/B com jogo real).
   3. Roteiro de PCs reais das correções (abaixo).
   4. Se tudo passar: P0.4 (bump de versão, `npm run release:check`, release) — as correções
      da auditoria saem juntas.
2. **Sem Windows:** portar `src/main/videonativo/reenvio.js` para o exe (`native/media/reenvio.*`,
   com teste no modo `--gerar-vetores` ou similar) e fechar o P2.3. Depois P2.4 (controle de taxa:
   `RELATORIO` a cada 200 ms no receptor e a regra −20%/+10% no envio) na parte que é JS puro.
3. Decisões do dono: propostas R1–R3 de design; gabarito do quiz só no servidor; TLS na
   sinalização (afeta a chave do vídeo nativo).

## Roteiro com PCs reais (validar as correções)

Servidor / sala:
- Transferir a liderança e fechar e reabrir o app de quem recebeu (deve voltar sem coroa e a
  coroa voltar a quem criou quando o fantasma expira).
- Migração graciosa com liderança transferida (a pessoa certa vira líder) e sem transferência
  (o sucessor vira líder). Migração com 4+ PCs (limite de 8 pendentes por IP).
- Sala cheia com 8 imagens no chat entrando por VPN lenta (teto de 8 MB na fila de saída).

Transmissão (renderer):
- R-01: relay jogando com o GoLive escondido; congelar a entrada origem→relay. Log do relay:
  `[arvore] folha acusou ... pedindo a <origem>`; folhas voltam a ter imagem, sem laço.
- R-02: desligar e religar a câmera, com espectador que tinha largado a câmera e via relay.
- R-03: relay sai da sala (folha volta a ver); origem sai (sem conexões penduradas em
  `webrtc-internals`).
- R-04: espectador vendo outra tela recebe reoferta; a origem deve suspender o encode dele.
- R-05: erro de GPU provocado → `relay de tela refeito` no log e imagem continua.
- R-08/R-10: derrubar a sinalização "ao vivo" (botões continuam ativos); parar logo depois de
  ir ao vivo (janela de rabisco não fica aberta).
- M-08: migrar a sala enquanto o sucessor sobe o servidor (sem erro no lobby).

App (main):
- Fechar o app com alguém conectado por VPN lenta: o processo deve sair em poucos segundos.
- Ctrl+R / Ctrl+Shift+I no app instalado não fazem nada.

## Como trabalhar neste repositório

- Regras de interface: `src/renderer/AGENTS.md` (tokens, `t()` nas três línguas, ids-contrato).
  O teste `texto-solto` reprova texto visível sem `t()`; logs de console ficam numa linha só.
- `npm test` e `npm run lint` verdes em todo commit (lint: 0 erros; 8 warnings antigos).
- `app.js` não carrega no Node: lógica nova vai para módulo puro testável; testes `*-app.test.js`
  recortam funções do `app.js` por nome (ao criar helper usado nelas, incluir na lista do teste).
- Plano: a cada passo concluído, marcar `[x]`, anotar no "Registro" do fim do plano e
  atualizar `docs/decisoes-e-problemas/` (próximas notas livres: D-12 reservada, D-14 em diante).
- Trabalho com vários agentes em paralelo neste checkout funcionou dividindo por área
  (servidor / main / renderer de mídia / Mesa / design) e usando Edit por trecho.
