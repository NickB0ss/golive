# Pesquisa: o que dá para pôr na Mesa

Data: 2026-09-24. Complementa `docs/superpowers/specs/2026-09-24-sala-em-dois-modos-design.md`.
Pedido: "procure outras janelas, outras coisas que podem deixar o aplicativo
rico nisso, talvez até Spotify".

## Como avaliei

Cada ideia passou por cinco perguntas:

1. **Funciona entre amigos numa LAN virtual**, sem conta nossa e sem servidor na
   nuvem?
2. **Quanto custa da rede da sala?** Estado (bytes) é barato; mídia pela árvore
   de retransmissão é caro.
3. **Depende de terceiro?** API, termos de uso, licença, internet em cada PC.
4. **Cabe numa janela assentada** da Mesa (seção 3.3 da spec)?
5. **Esforço**: P (dias), M (uma a duas semanas), G (mais).

E um critério de gosto: o público é uma turma que joga junto (CS, Valorant,
Minecraft) e conversa no Discord. O que serve à noite de jogo vale mais.

## Resumo

| Prioridade | Janela | Por quê |
|---|---|---|
| 1 | **Rádio da sala** (fila de músicas pelo YouTube) | Música junto, sincronizada, sem Spotify e sem custo de rede |
| 1 | **Sorteio de times** | A noite de CS começa com "quem joga com quem" |
| 1 | **Placar** e **Cronômetro** | Pequenos, usados toda noite |
| 1 | **Fixar imagem do chat** na mesa | O chat já tem imagem; é só uma janela |
| 2 | **Ao vivo junto** (Twitch/Kick) | Assistir campeonato junto; ao vivo não precisa sincronizar |
| 2 | **Filme do seu PC** | Arquivo local pela árvore de retransmissão, melhor que compartilhar a tela |
| 2 | **Tocando agora** (o que cada um ouve no Spotify, via Windows) | Sem API do Spotify, sem login |
| 2 | **Stop / Adedonha**, **Desenha e adivinha** | Os jogos de festa que a turma já joga em outro site |
| 3 | **Truco**, **Dominó**, **Batalha naval**, **Oito maluco** | Jogos de mesa brasileiros e clássicos; regra no módulo |
| 3 | **Soundboard** | Sons curtos para todos; diversão barata |
| — | Spotify tocando dentro do app | Não dá do jeito certo; ver seção 1 |

---

## 1. Música

### 1.1 Spotify: o que existe e o que não serve

Pesquisado em setembro de 2026.

- **Web Playback SDK e a Web API de controle** exigem Spotify Premium de
  **quem ouve**, não só de quem desenvolve. Desde fevereiro de 2026, o modo de
  desenvolvimento do Spotify limita cada app a **cinco usuários** e exige
  Premium do desenvolvedor ([TechCrunch](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/),
  [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)).
  Um app distribuído para qualquer turma precisaria de aprovação de cota
  estendida do Spotify. Fora de alcance para um projeto de uma pessoa.
- **A política de desenvolvedor proíbe sincronizar gravações com mídia visual**
  (vídeo, slideshow) ([Spotify Developer Policy](https://developer.spotify.com/policy)).
  Tocar música do Spotify por cima de uma tela transmitida esbarra nisso.
- **Embed do Spotify (iFrame API)** tem `play`, `pause`, `seek` e `togglePlay`,
  mas quem chama `play()` pela API recebe a **prévia de 30 s**, mesmo logado
  com Premium; só os controles do próprio player tocam a faixa inteira
  ([relato na comunidade](https://community.spotify.com/t5/Spotify-for-Developers/Spotify-iframe-API-play-resume-starts-preview-playback-while/td-p/7430703),
  [iFrame API](https://developer.spotify.com/documentation/embeds/references/iframe-api)).
  No Electron, sem o cookie de login do Spotify, é prévia sempre.
- **Spotify Jam** já faz "ouvir junto": fila compartilhada, todos no mesmo
  ponto, no desktop também. Premium para criar e para entrar de longe
  ([suporte do Spotify](https://support.spotify.com/us/article/jam/),
  [newsroom](https://newsroom.spotify.com/2026-01-07/listening-activity-request-to-jam-messages-updates/)).
- **Compartilhar o som do Spotify com a sala** já é possível hoje (áudio por
  processo, o mesmo do "incluir o som do Discord"). Mas retransmitir a música
  do Spotify para outras pessoas vai contra os termos de uso do Spotify. O app
  não deve oferecer isso como recurso de música.

### 1.2 O que dá para fazer com o Spotify

**Janela "Spotify Jam"** (P). Quem tem Premium cria um Jam no Spotify e cola o
link na janela. A janela mostra a capa, "Entrar no Jam" (abre o link no
Spotify de cada um) e quem já entrou. A sincronização é do próprio Spotify; o
GoLive só junta a turma. Nenhuma API, nenhum termo quebrado.

**Janela "Tocando agora"** (M). O Windows publica o que está tocando em cada
app de mídia (Spotify, navegador, VLC) pela API
`GlobalSystemMediaTransportControlsSessionManager`, com título, artista, capa
e controles de tocar, pausar e pular
([The Old New Thing](https://devblogs.microsoft.com/oldnewthing/20231108-00/?p=108980),
[docs](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager.getcurrentsession)).
O projeto já tem addon nativo (`native/`, áudio por processo); ler essa API
cabe nele. A janela mostra, para cada pessoa que ligar a opção, "Bia está
ouvindo: <faixa> — <artista>", com a capa. Não toca nada para ninguém, então
não esbarra em direito de música. Opt-in por pessoa (é informação pessoal).

### 1.3 Rádio da sala (a música que toca junto)

**Janela "Rádio"** (M). Uma fila de músicas em que qualquer pessoa cola link do
**YouTube** (inclui links do YouTube Music, que usam o mesmo id de vídeo).
Toca só o áudio (o iframe fica escondido na janela, com a capa no lugar),
sincronizado do mesmo jeito que o "Vídeo do YouTube" da spec: estado
`{ fila, atual, tocando, posição, relógio }` e cada PC tocando o próprio.

- Custo de rede da sala: quase zero.
- Pular, votar para pular (maioria das pessoas na sala), reordenar a fila.
- Limitação: alguns vídeos de música não permitem embed; a janela pula para
  o próximo e diz qual falhou.

**SoundCloud** (P, depois do Rádio). O widget oficial do SoundCloud tem API
completa (`play`, `pause`, `seekTo`, `getPosition`, eventos de progresso)
([Widget API](https://developers.soundcloud.com/docs/api/html5-widget)), então
entra como segunda fonte do Rádio com o mesmo relógio.

---

## 2. Assistir junto

| Janela | Como sincroniza | Esforço | Observação |
|---|---|---|---|
| **Vídeo do YouTube** | relógio da sala | M | Já na spec |
| **Ao vivo** (Twitch, Kick) | nenhum: é ao vivo, cada um abre o mesmo canal | P | Twitch exige o parâmetro `parent` com o domínio da página, e `file://` não serve ([Twitch](https://dev.twitch.tv/docs/embed/), [fórum](https://discuss.dev.twitch.com/t/embedding-twitch-in-an-electron-app/40334)) |
| **Filme do seu PC** | a própria transmissão | M | Um `<video>` local vira fonte com `captureStream()` e entra na árvore de retransmissão como uma tela. Qualidade melhor que capturar a tela, sem cursor nem notificação por cima |
| **Imagem fixada** | estado | P | "Pôr na mesa" numa imagem do chat. O chat já guarda as imagens |

**O mesmo conserto destrava YouTube e Twitch.** Desde o fim de 2025 o YouTube
recusa embed sem `Referer` válido (erro 153), e páginas `file://` no Electron
não mandam
([Simon Willison](https://til.simonwillison.net/youtube/fixing-153-embed),
[caso no upscayl](https://github.com/upscayl/upscayl/issues/1404)). A saída
mais citada é servir o renderer por `http://127.0.0.1:<porta>` em vez de
`file://`. Isso também dá à Twitch um `parent` que ela aceita (`localhost`
funciona em desenvolvimento, segundo o fórum). O spike da fase 0 deve testar
os dois juntos: servidor local só em `127.0.0.1`, só arquivos estáticos, porta
aleatória, e a CSP de hoje.

---

## 3. Jogos

Todos seguem o mesmo molde da spec (módulo puro com `validate` e `reduce`,
rodando no renderer e no servidor). O estado é pequeno; nenhum custa rede.

### 3.1 De mesa

| Jogo | Jogadores | Esforço | Nota |
|---|---|---|---|
| Xadrez | 2 | M | `chess.js` (BSD-2) para a regra |
| Damas (regra brasileira) | 2 | M | Captura obrigatória e em sequência |
| Jogo da velha, Lig 4 | 2 | P | Primeiros a entrar: validam o molde |
| **Truco** (paulista) | 2 ou 4 | G | O jogo de cartas da turma brasileira. Cartas escondidas exigem que o servidor só mande a cada um a própria mão (ver 3.3) |
| **Dominó** | 2 a 4 | M | Peças escondidas, mesmo cuidado |
| **Batalha naval** | 2 | P | Tabuleiro escondido do adversário, mesmo cuidado |
| **Oito maluco** | 2 a 8 | M | O jogo de domínio público de onde veio o Uno; nome e cartas nossos, sem marca de terceiro |
| Poker (sem dinheiro) | 2 a 8 | G | Fichas de mentira |

### 3.2 De festa

| Jogo | Esforço | Nota |
|---|---|---|
| **Desenha e adivinha** | M | O Gartic da turma: uma pessoa desenha no Quadro, as outras chutam no chat, placar por rodada. Lista de palavras em português embutida |
| **Stop / Adedonha** | M | Letra sorteada, categorias (nome, cor, fruta, CEP…), cronômetro, correção por votação. Muito brasileiro, cabe numa janela |
| **Quiz** | M | Perguntas em português embutidas (criadas para o app) ou escritas pelo líder na hora |
| **Quem sou eu?** | P | Cada pessoa recebe um personagem que só as outras veem |
| **Palavras secretas** | M | Dois times, dicas de uma palavra. Nome nosso, sem usar marca de terceiro |

### 3.3 Cartas escondidas: um cuidado de protocolo

Hoje toda mensagem da mesa vai para todo mundo. Jogo com informação escondida
(mão do truco, navios da batalha naval) precisa que o servidor mande a cada
pessoa **só a parte dela**. O módulo ganha uma função `view(state, pessoa)`
que o servidor usa antes de enviar. Quem abre as ferramentas de
desenvolvedor não pode ver a mão do outro.

### 3.4 Jogar contra o computador

Xadrez contra o Stockfish exigiria distribuir o Stockfish, que é GPL-3. Isso
obriga o app inteiro a sair como GPL. Fora, a não ser que o projeto aceite essa
licença.

---

## 4. Ferramentas da noite de jogo

| Janela | Esforço | O que faz |
|---|---|---|
| **Sorteio de times** | P | Pega as pessoas da sala (ou nomes digitados), sorteia dois ou mais times, "sortear de novo". Cada nome na cor da pessoa |
| **Placar** | P | Dois times, nome editável, +1/−1, zerar. Para melhor-de-3, campeonato da turma |
| **Cronômetro** | P | Contagem regressiva ou progressiva, igual para todos (usa o relógio da sala). "Pausa de 5 min" |
| **Roleta** | P | Opções digitadas, gira para todos e para no mesmo lugar (a semente sai do servidor) |
| **Enquete** | P | Uma pergunta, um voto por pessoa, votos com o avatar |
| **Dados e moeda** | P | O resultado sai do servidor, para ninguém "rolar de novo" em segredo |
| **Soundboard** | M | Sons curtos (CC0, embutidos) que tocam para todos; com limite de um por pessoa a cada 3 s e volume próprio |
| **Quadro com imagem** | P | O Quadro aceita colar um print (mapa do jogo) como fundo para riscar a estratégia |
| **Jogando agora** | M | Opt-in: mostra o jogo aberto de cada pessoa. O app já lista processos (`listProcessNames`, usado no áudio); precisa de uma lista de jogos conhecidos |

## 5. Coisas da sala

| Janela | Esforço | O que faz |
|---|---|---|
| **Nota** | P | Já na spec |
| **Lista** | P | Itens com caixa de marcar ("quem traz o quê", "mapas para jogar") |
| **Link** | P | Mostra título e imagem de um site e "Abrir" no navegador de cada um. Não é navegar junto |
| **Galeria** | P | As imagens fixadas do chat, em grade |

---

## 6. O que não fazer (e por quê)

| Ideia | Motivo |
|---|---|
| Spotify tocando dentro do app (SDK ou Web API) | Premium de todos, limite de 5 usuários no modo de desenvolvimento, e a política contra sincronizar com vídeo |
| Retransmitir o som do Spotify como "rádio" | Contra os termos do Spotify |
| Akinator | Sem API oficial; as bibliotecas raspam o site e quebram |
| Navegar junto (co-browsing) | Outro produto: isolamento de `<webview>`, login, segurança |
| tldraw como quadro | Desde a versão 4.0 (set/2025) uso em produção exige licença paga ou marca-d'água ([comparação](https://instapods.com/apps/excalidraw/vs/tldraw/)). Se um dia o Quadro próprio não bastar, o Excalidraw é MIT |
| Stockfish | GPL-3 (ver 3.4) |
| Nomes de marca (Uno, Codenames, Gartic) | Usar nomes e cartas próprios |

## 7. Base técnica comum

As janelas caem em quatro tipos de sincronização. Cada tipo é resolvido uma
vez e todas as janelas do tipo reaproveitam:

| Tipo | Exemplos | Mecanismo |
|---|---|---|
| **Estado** | jogos, placar, enquete, nota, sorteio | módulo puro + `seq` no servidor (spec, 4.4) |
| **Mídia com relógio** | YouTube, Rádio, SoundCloud, cronômetro | estado + relógio da sala (mensagem `time`) + correção de deriva |
| **Ao vivo** | Twitch, Kick | só o canal; cada PC abre o seu |
| **Transmissão** | telas, câmeras, filme do PC | a árvore de retransmissão que já existe |

Mais um, para jogos com cartas: **estado com visão por pessoa** (3.3).

## 8. Ordem sugerida

Encaixa nas fases da spec:

1. **Fase 2 (ferramentas)**: Sorteio de times, Placar, Cronômetro, Enquete,
   Dados, Nota, Lista, Imagem fixada. Todas P, todas do tipo "estado".
   Validam o molde de módulo com coisas pequenas e úteis desde o primeiro dia.
2. **Fase 3 (mídia)**: spike do `http://127.0.0.1`; Vídeo do YouTube, Rádio,
   Ao vivo (Twitch/Kick), Spotify Jam.
3. **Fase 4 (jogos)**: Jogo da velha e Lig 4, depois Desenha e adivinha,
   Stop, Xadrez, Damas.
4. **Depois**: visão por pessoa (3.3) e os jogos de cartas (Truco, Oito
   maluco, Dominó, Batalha naval); Tocando agora e Jogando agora (addon
   nativo); Filme do seu PC; Soundboard.

## Fontes

- [TechCrunch: Spotify muda o modo de desenvolvimento (fev/2026)](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/)
- [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)
- [Spotify Developer Policy](https://developer.spotify.com/policy)
- [Spotify iFrame API](https://developer.spotify.com/documentation/embeds/references/iframe-api)
- [Comunidade Spotify: iFrame API toca prévia](https://community.spotify.com/t5/Spotify-for-Developers/Spotify-iframe-API-play-resume-starts-preview-playback-while/td-p/7430703)
- [Spotify Jam (suporte)](https://support.spotify.com/us/article/jam/)
- [Spotify newsroom: Request to Jam (jan/2026)](https://newsroom.spotify.com/2026-01-07/listening-activity-request-to-jam-messages-updates/)
- [The Old New Thing: mídia tocando no sistema](https://devblogs.microsoft.com/oldnewthing/20231108-00/?p=108980)
- [Microsoft: GlobalSystemMediaTransportControlsSessionManager](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager.getcurrentsession)
- [SoundCloud Widget API](https://developers.soundcloud.com/docs/api/html5-widget)
- [Twitch: Embedding](https://dev.twitch.tv/docs/embed/)
- [Fórum Twitch: embed no Electron](https://discuss.dev.twitch.com/t/embedding-twitch-in-an-electron-app/40334)
- [Simon Willison: erro 153 do YouTube](https://til.simonwillison.net/youtube/fixing-153-embed)
- [upscayl: erro 153 no Electron](https://github.com/upscayl/upscayl/issues/1404)
- [Discord: Activities](https://discord.com/blog/server-activities-games-voice-watch-together)
- [Excalidraw × tldraw (licenças, 2026)](https://instapods.com/apps/excalidraw/vs/tldraw/)
