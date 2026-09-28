# Passagem para a próxima sessão: sala em dois tipos (Transmissão e Mesa)

Data: 2026-09-24. Branch: `claude/redesign-planning-structure-wpfpsg` (só
documentos e um protótipo; nenhuma linha do app mudou). Sem PR aberto.

Leia nesta ordem:

1. Este arquivo (5 min).
2. `docs/superpowers/specs/2026-09-24-sala-em-dois-modos-design.md`: a spec.
3. `docs/2026-09-24-pesquisa-janelas-da-mesa.md`: o que dá para pôr na Mesa,
   com fontes (Spotify, Twitch, YouTube, jogos, ferramentas).
4. `docs/prototipos/sala-dois-tipos.html`: protótipo clicável. Abrir direto
   no navegador. Mesma coisa publicada em
   https://claude.ai/artifact/5nF2HZN45a2FBVxjwAjcq7 (versão 3).

Documento para compartilhar (Claude Docs, mesmo conteúdo em linguagem de
produto): https://claude.ai/code/artifact/a042768e-6847-4aa6-96b9-c0b13ec67f53
Tem um comentário aberto perguntando se "todo mundo mexe" é o padrão certo.

---

## O que foi decidido (pelo Nicolas, nesta ordem)

1. **Redesign de estrutura**, partindo do design da 0.16.0 ("um dos melhores
   que tivemos").
2. **A sala ganha dois tipos, e só o líder da sala troca**, ao vivo e para
   todos:
   - **Transmissão**: o app de hoje, sem mudança. É o padrão.
   - **Mesa**: "uma área grande, sem nada, apenas um grid, e as pessoas vão
     adicionando as janelas e mudando".
3. **Área grande** (maior que a tela), com andar arrastando o fundo, zoom na
   roda do mouse e mapa no canto. Escolhido numa pergunta direta.
4. **Janelas assentadas na grade, não flutuando** como janela de app: planas,
   sem sombra, contorno fino. A grade é só o fundo "pra não ficar tudo preto".
5. **Posição livre**: "não precisam estar alinhadas na grade". Mas **uma
   janela nunca fica em cima de outra**: soltou em cima, desliza para o lugar
   livre mais perto.
6. **Botão direito → Adicionar janela** → YouTube, xadrez, damas e outras.
   Janela redimensionável e com **botão de tela cheia**.
7. **Visual limpo**: controles só com o mouse em cima; tudo some com 3 s de
   mouse parado.
8. Janelas extras pesquisadas a pedido ("talvez até Spotify"): ver a pesquisa.

## Direções descartadas (não refazer)

| Direção | Por que saiu |
|---|---|
| Sala inteira vira mesa, mundo fixo 16:9 compartilhado | Mudava o app todo; ele não quer perder o modo de transmissão |
| Mesa de cada um (arrumação só local) | Ele quer que as pessoas mexam juntas |
| Janelas flutuando como apps, com sombra e sobreposição | Pedido explícito contra |
| Encaixe na grade | Pedido explícito contra ("quero liberdade") |
| Spotify tocando dentro do app | Premium de todos, limite de 5 usuários no modo de desenvolvimento (fev/2026), embed toca só prévia pela API, termos proíbem sincronizar com vídeo. Ver pesquisa, seção 1 |
| Akinator | Sem API oficial |

## Decisões em aberto (perguntar antes de implementar)

- [ ] "Todo mundo mexe na mesa" como padrão, com trava opcional do líder?
      (recomendado: sim; comentário aberto no Claude Doc)
- [ ] Avisar o líder antes de voltar para Transmissão com jogo em andamento?
      (recomendado: avisar, sem bloquear)
- [ ] Xadrez e damas com duas "cadeiras" de jogador? (recomendado: sim)
- [ ] Seguir a vista do líder ("olha aqui")? (recomendado: depois)

## Próximo passo: fase 0 da spec

Nada de código da Mesa antes disto.

1. **Preparar o ambiente**: `npm ci`. Neste container as dependências não vêm
   instaladas; sem elas, 4 arquivos de teste do servidor quebram no
   `require('ws')` e parece regressão.
2. **Teste com 2+ PCs reais** do que já existe (ver "Próximos passos" do
   `STATUS.md`). A Mesa é uma casca nova em volta dos mesmos tiles; se a
   transmissão tiver problema, ele aparece nos dois tipos.
3. **Spike do YouTube no Electron** (decide a fase 3):
   - o app abre por `file://` (`src/main.js:571`, `win.loadFile`), e o YouTube
     recusa embed sem `Referer` desde o fim de 2025 (erro 153);
   - testar servir o renderer por `http://127.0.0.1:<porta aleatória>` (só
     estáticos, só loopback) e ver: embed do `youtube-nocookie.com` tocando,
     comando por `postMessage` sem carregar script do YouTube na página, e
     embed da Twitch com `parent=localhost`;
   - conferir que a CSP de hoje continua valendo, com só
     `frame-src https://www.youtube-nocookie.com https://player.twitch.tv`.
4. **Spike de desempenho**: 3 telas + 2 câmeras + 1 iframe num contêiner com
   `transform: translate() scale()`, arrastando e com zoom, medindo quadros
   no Electron 44.
5. **Glossário**: pôr os termos novos em `docs/glossario.md` e no
   `src/renderer/glossario.test.js` ("tipo da sala", "Transmissão", "Mesa",
   "janela", "Adicionar janela", "Tirar da mesa", "Tela cheia"). Atenção:
   "janela" já existe no seletor de fonte ("Telas | Janelas"); a spec, seção
   9, diz como convivem.

## Onde mexer no código (fase 1)

| O quê | Onde | Padrão a copiar |
|---|---|---|
| Tipo da sala e estado da Mesa no servidor | `server/signaling-core.js` | `chatHistory` (linha ~551): guardado no servidor, vai no `welcome` |
| Semente na migração | `src/main.js:1081` (`hostRoom`) e `createSignalingServer` | `initialChatHistory`, `initialBans` |
| Canais `mesa-drag` e `cursor` (não guardados) | novo módulo puro | `src/renderer/laser.js` (24 Hz, último ponto por pessoa, TTL) |
| Cor de cada pessoa | `src/renderer/annotate.js` | `colorFor(peerId)` e `PALETTE` (sem vermelho) |
| Tiles de tela e câmera | `src/renderer/ui.js:743` (`showTile`) | Na Mesa, o mesmo `<video>` muda de casca; na Transmissão, nada muda |
| Arranjo automático de hoje | `src/renderer/gridlayout.js` | Continua sendo o layout da Transmissão |
| Não assistir tela fora da vista | `view-state {watching:false}` | Já usado no "assistir uma tela por vez" |
| Teto de qualidade pelo tamanho | `src/renderer/peerquality.js` | Largura da janela em pixels vira teto |
| Tokens novos `--grid`, `--grid2` | `src/renderer/style.css` e `theme.js` | Trava de contraste dos temas |

Regras do projeto que continuam valendo: `--live` só para "ao vivo"; nada de
`backdrop-filter`/`filter` sobre vídeo; só `transform` e opacidade animam; cor
só por token; nenhum `id` do `index.html` removido sem motivo.

## Ferramentas desta sessão que valem reaproveitar

**Prints do renderer sem Electron.** Playwright global
(`/opt/node22/lib/node_modules/playwright`, Chromium em `/opt/pw-browsers`)
carregando `src/renderer/index.html` com a ponte `window.golive` simulada.
Deu prints reais do lobby, da sala e de Configurações:

```js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => {
    const cbs = {}; window.__cbs = cbs;
    window.golive = new Proxy({}, { get: (_, k) => {
      if (k === 'getNetworkAddress') return async () => ({ address: '26.114.8.201', kind: 'radmin' });
      if (String(k).startsWith('on')) return (cb) => { cbs[k] = cb; };
      return async () => null;
    } });
  });
  await p.goto('file:///home/user/golive/src/renderer/index.html');
  // salas na rede: window.__cbs.onRoomsDiscovered([{ name, hostName, address, version, peers }])
  // sala: window.GoLive.ui.stageHeader.set({ name, address, pin }) e ui.grid.showTile(id, nome, canvas.captureStream(30), { kind })
  await p.screenshot({ path: 'print.png' });
  await b.close();
})();
```

**Codex.** Não funciona neste ambiente como está: o proxy recusa
`api.openai.com` (403) e não há `OPENAI_API_KEY`. Para usar: nas
configurações do ambiente, liberar `api.openai.com` em Network access e
adicionar a variável `OPENAI_API_KEY`; abrir sessão nova; `npm i -g
@openai/codex` (o npm está liberado) e `codex exec`.

## Estado da branch

```
a14fd9c docs: pesquisa do que por na Mesa
d3fe74e docs(spec): janelas da Mesa assentadas, em posicao livre e sem sobrepor
52e6998 docs(spec): sala em dois tipos
664858f docs(spec): a sala vira mesa (direção descartada, fica no histórico)
```

mais o commit deste arquivo, do protótipo em `docs/prototipos/` e da nota no
`STATUS.md`.
