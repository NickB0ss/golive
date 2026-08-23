# Preset de qualidade, PiP arrastável, perfil nas configurações e áudio do Discord — design

Data: 2026-08-23

Sete mudanças pedidas de uma vez. Cada seção é independente das outras (dá pra implementar em qualquer ordem), com exceção da 1 e da 4, que mexem no mesmo modal de Configurações.

---

## 1. Preset de qualidade no lugar dos controles avançados

> **Atualização:** o select acabou não indo pra aba "Transmissão" das Configurações como descrito abaixo — foi pro diálogo de compartilhar tela (`#picker`), acima da seção "Áudio", já que é ali que a pessoa decide a qualidade *antes* de ir ao vivo. A aba "Transmissão" foi removida das Configurações (só sobrou "Perfil", "Voz e Vídeo", "Rede", "Estatísticas"). O resto da seção (tabela de presets, migração de config antigo) continua valendo, só o local do controle mudou.

**Hoje** ([ui.js](../../../src/renderer/ui.js), `openSettings` → aba "Transmissão") a pessoa escolhe resolução, framerate, bitrate (slider de 2–40 Mbps), codec e bitrate da câmera separadamente. Quem não sabe o que é bitrate não tem como acertar.

**Fica** um único `<select>`:

| Opção | width×height | fps | bitrate |
|---|---|---|---|
| 720p · 30 fps | 1280×720 | 30 | 2,5 Mbps |
| 720p · 60 fps | 1280×720 | 60 | 4 Mbps |
| 1080p · 30 fps | 1920×1080 | 30 | 6 Mbps |
| 1080p · 60 fps *(padrão)* | 1920×1080 | 60 | 12 Mbps |
| 1440p · 30 fps | 2560×1440 | 30 | 10 Mbps |
| 1440p · 60 fps | 2560×1440 | 60 | 18 Mbps |

O 1080p60 = 12 Mbps é de propósito o mesmo número que o `DEFAULTS` de hoje e o que o [README](../../../README.md) usa na tabela de upload necessário.

Abaixo do select fica a linha de banda que já existe (`bandwidthLine`), recalculada pelo preset: *"≈12 Mbps × número de espectadores"*. Ela é a única coisa numérica que sobra, e vale manter — upload é o gargalo real do app e é o que explica pra pessoa por que escolher 1440p60 pode ser má ideia.

**Some:** slider de bitrate, select de codec, slider de bitrate da câmera.

**Onde mexe:**

- [config.js](../../../src/renderer/config.js): tabela `QUALITY_PRESETS` (`'1080p60' → { width, height, fps, bitrate }`) exportada junto do resto da api. `DEFAULTS.quality` ganha `preset: '1080p60'`; `codec` continua existindo no objeto, fixo em `'video/H264'` (é o que `mesh.js` `preferCodec` consome — nada em `mesh.js` precisa mudar).
- `config.load`: migração de config antigo. Se `parsed.quality.preset` não existir, deriva o preset mais próximo de `width`/`height`/`fps` salvos; se nada bater, cai no padrão. Sempre reescreve `width/height/fps/bitrate` a partir do preset, pra não sobrar combinação órfã do slider antigo.
- [ui.js](../../../src/renderer/ui.js) `openSettings`: aba "Transmissão" vira um `settings-field` só; `emitQuality` monta o objeto a partir de `QUALITY_PRESETS[select.value]`.
- [config.test.js](../../../src/renderer/config.test.js): casos novos pra migração (config antigo com `1280x720@30` → preset `720p30`; config sem `quality` → padrão).

**Premissa:** codec fica travado em H.264 e não há "modo avançado" escondido. Foi o pedido explícito ("não quero que tenha as configurações de mudar bitrate ou essas coisas avançadas"). Se um dia alguém precisar de VP9/AV1, volta como opção — não como slider.

---

## 2. Fullscreen: miniatura não some, e dá pra arrastar/redimensionar

**Hoje** ([ui.js](../../../src/renderer/ui.js), `scheduleFullscreenIdle` + [style.css:434](../../../src/renderer/style.css)) tudo dentro do `.tile.fullscreen` some junto depois de 3s de mouse parado — inclusive as miniaturas de PiP, que é justamente o que a pessoa quer continuar vendo.

### 2a. O que some e o que fica

Depois de 3s parado, com `.idle`:

| Elemento | Hoje | Passa a ser |
|---|---|---|
| `.tile-label` (nome) | some | **some** |
| `.tile-avatar` (foto) | some | **some** |
| `.tile-kind-badge` | some | **some** |
| `.tile-fullscreen-btn` | some | **some** |
| cursor do mouse | some | **some** |
| `.pip-thumb` (o vídeo da miniatura) | some | **fica** |
| `.pip-thumb-avatar` (foto na miniatura) | some | **some** |
| `.pip-thumb-remove` (o "×") | some | **some** |
| `.pip-add-btn` (o "+") | some | **some** |

Ou seja: a imagem da câmera/transmissão que a pessoa fixou continua por cima do vídeo; só a papelada em volta dela desaparece.

CSS: a regra `.tile.fullscreen.idle .pip-strip { opacity: 0; pointer-events: none; }` sai. No lugar entram regras específicas pra `.tile.fullscreen.idle .pip-thumb-avatar`, `.pip-thumb-remove` e `.pip-add-btn`.

### 2b. Arrastar pra mover, arrastar o canto pra redimensionar

`.pip-strip` deixa de ser uma faixa flex no canto e vira uma **camada** (`position: absolute; inset: 0; pointer-events: none`) por onde as miniaturas flutuam livres (`position: absolute; pointer-events: auto`).

Estado novo em `ui.js`, ao lado de `pinnedPip`:

```js
// id -> { x, y, w }  — x/y em % da área do fullscreen (sobrevive a mudar
// de monitor/resolução), w em px.
const pipLayout = new Map();
```

Mesmo ciclo de vida do `pinnedPip`: sobrevive a trocar de foco e a sair/entrar do fullscreen, some quando o id sai do `tileRegistry` ou a pessoa remove a miniatura no "×".

- **Posição inicial** (quando não há entrada em `pipLayout`): canto inferior esquerdo, empilhando pra direita — visualmente igual à faixa de hoje, então nada muda pra quem não arrastar nada.
- **Mover:** `pointerdown` no corpo da miniatura → `setPointerCapture`, `pointermove` atualiza `x`/`y` com clamp pra miniatura nunca sair inteira da tela.
- **Redimensionar:** alça `.pip-thumb-resize` no canto inferior direito (some no `.idle` junto com o "×"). Arrastar muda `w` entre **120px** e **45% da largura da tela**; altura é sempre `w * 9/16`.
- **Clique vs arrasto:** o `click` que troca o foco (`switchFullscreenFocus`) só dispara se o ponteiro andou menos de 4px entre `pointerdown` e `pointerup`. Sem isso, todo arrasto terminaria trocando de tela.
- O "+" continua ancorado no canto inferior esquerdo, fora da camada de miniaturas.

`renderPipStrip` passa a aplicar `left/top/width` de `pipLayout` em cada thumb, e `buildPipThumb` ganha os listeners de ponteiro.

**Fora de escopo:** salvar o layout no `localStorage` entre execuções do app. É estado de sessão, igual ao `pinnedPip`.

---

## 3. Some com "Salas recentes"

Nada de sala fica salvo em disco. Sobra só a lista "Ao vivo agora", que vem do broadcast UDP ([discovery.js](../../../src/main/discovery.js)) e some sozinha quando o beacon para de chegar, e o "Entrar por endereço".

- [config.js](../../../src/renderer/config.js): saem `recentRooms` de `DEFAULTS` e de `load`, e as funções `addRecentRoom` / `removeRecentRoom`.
- [config.test.js](../../../src/renderer/config.test.js): saem os testes de recentes (linhas ~60–96) e as asserções de `recentRooms` nos testes de `load`.
- [index.html](../../../src/renderer/index.html): saem `#rooms-recent-title` e `#room-list`.
- [ui.js](../../../src/renderer/ui.js): `renderRooms` passa a receber só `liveRooms`; `fillRoomList` perde o parâmetro `onDelete` e o botão de lixeira (`TRASH_ICON` sai junto). A lista ao vivo ganha o `emptyMessage`: *"nenhuma sala aberta na rede agora — crie uma ou entre por endereço"*, e o `<h3>` "Ao vivo agora" deixa de ser condicional.
- [app.js](../../../src/renderer/app.js): saem a chamada a `config.addRecentRoom` no `onOpen` do `joinRoom` (linha ~467), o `onDelete` do `renderRoomList`, e o ramo `if (room.isOwn) hostRoomFlow()` do `onSelect` — esse ramo existia só pra reabrir uma sala própria salva em recentes; sala descoberta ao vivo sempre tem host de verdade rodando, então é sempre `joinRoom`.

`activeRoomAddress`, `canonicalAddress` e o cooldown de 2s continuam como estão — não dependiam dos recentes.

**Nota:** quem já usa o app tem `recentRooms` no `localStorage`. O `config.load` simplesmente para de ler a chave; o lixo fica lá inerte até a próxima gravação, que já não a inclui. Não vale escrever migração pra isso.

---

## 4. Apelido e foto vão pro modal de Configurações

**Hoje** ficam no `.user-panel`, no pé da coluna esquerda: um `<input>` de texto que salva no `blur` e um botão de avatar que abre o seletor de arquivo.

**Fica assim:**

- Nova categoria **"Perfil"**, primeira aba do modal (antes de "Voz e Vídeo"), com o avatar grande clicável (mesmo `resizeImageToAvatar` / limite de 10MB — 3MB pra GIF — de hoje) e o campo de apelido.
- O `.user-panel` do rodapé mantém avatar + nome, mas só como **display**: clicar em qualquer um dos dois abre Configurações na aba Perfil. Nada de edição inline ali.

> **Confirmar:** "não quero que fique lá embaixo" também pode significar tirar o avatar/nome do rodapé por completo, deixando só os três botões (câmera, compartilhar, configurações). Adotei a versão que mantém o display porque a pessoa continua vendo quem ela é sem abrir modal — e a identidade também aparece na coluna "Na sala". Se for pra sumir de vez, é deletar o bloco e nada mais.

**Onde mexe:** [index.html](../../../src/renderer/index.html) (bloco `.user-panel` + nova `<button class="settings-cat" data-cat="profile">` e `<section id="settings-profile">`), [ui.js](../../../src/renderer/ui.js) (`settingsPanes.profile`, html do painel, `openSettings` recebe `deps.onNameChange` / `deps.onAvatarChange`), [app.js](../../../src/renderer/app.js) (move `commitName`, `readFileAsDataUrl`, `resizeImageToAvatar` e o handler do `<input file>` pra dentro do wiring de `ui.settings.open`; `renderUserPanel` fica só desenhando o display).

**Cuidado:** trocar nome/avatar com sessão ativa não repropaga pros peers hoje (o `join` já foi enviado). Isso não muda com essa mudança — continua valendo só na próxima entrada em sala. Vale anotar como pendência separada, não como parte desta.

---

## 5. Silenciar vira checkbox

No menu de contexto do tile ([ui.js](../../../src/renderer/ui.js), `openTileMenu`) o `<button class="tile-menu-mute">` que alterna o texto entre "Silenciar" e "Reativar som" vira:

```html
<label class="check-inline">
  <input type="checkbox" class="tile-menu-mute" /> Silenciar
</label>
```

Marcado = mudo. O texto do rótulo nunca muda. O handler passa de `click` com `!state.muted` pra `change` com `state.muted = input.checked`, e a inicialização usa `input.checked = state.muted`. `applyGain` continua igual.

O `.check-inline` já existe no CSS (usado no picker e na aba Rede), então não entra estilo novo — só um ajuste de espaçamento se ficar apertado dentro do `.tile-menu`.

---

## 6. Áudio do Discord vazando mesmo com a checkbox desmarcada

### O bug

Em [app.js](../../../src/renderer/app.js) `startShare`, compartilhando a **tela inteira**:

```js
const ownPid = await window.golive.getOwnPid();
basePid = ownPid;
baseExclude = true;   // captura TUDO menos a árvore do GoLive
```

Essa captura base pega o sistema inteiro menos o próprio GoLive — e o Discord está dentro desse "tudo". A checkbox "Incluir o som do Discord também" só **soma** uma segunda captura, essa sim só do Discord:

```js
if (includeDiscord && discordPid && discordPid !== basePid) { ... }
```

Não existe caminho de exclusão em lugar nenhum. Resultado: com a checkbox **desmarcada** o Discord vai ao ar do mesmo jeito (foi o que a pessoa observou), e com ela **marcada** o Discord vai ao ar **duas vezes**, mixado consigo mesmo — mais alto e provavelmente com efeito de filtro pente pela diferença de latência entre as duas capturas.

### Por que não é uma linha de conserto

`AUDIOCLIENT_ACTIVATION_PARAMS` com `PROCESS_LOOPBACK` ([loopback_capture.cc:171](../../../native/src/loopback_capture.cc)) aceita **um** `TargetProcessId` e um modo (incluir ou excluir *aquela* árvore de processos). Não existe "excluir A e B" numa captura só, então não dá pra pedir "tudo menos GoLive menos Discord" diretamente.

Alternativas consideradas:

- **Subtrair uma captura da outra** (base menos uma captura só-Discord, invertendo a fase): as duas streams não são sample-aligned; o cancelamento seria parcial e sujo. Descartado.
- **Lista de inclusão** *(escolhida)*: enumerar os processos que estão tocando áudio agora e subir uma captura `INCLUDE` pra cada um, pulando a árvore do GoLive e — quando a checkbox estiver desmarcada — a árvore do Discord. Mixa tudo no mesmo `MediaStreamAudioDestinationNode` que já existe.

### O que muda

**Nativo** — binding novo `listAudioRenderPids()` em [native/src](../../../native/src) (`IMMDeviceEnumerator` → endpoint de render padrão → `IAudioSessionManager2` → `IAudioSessionEnumerator` → `IAudioSessionControl2::GetProcessId`, filtrando sessões inativas). Exportado em [addon.cc](../../../native/src/addon.cc) ao lado de `findDiscordRootPid`; handler IPC `audio:listRenderPids` em [main.js](../../../src/main.js) e método no [preload.js](../../../src/preload.js), ambos devolvendo `[]` quando o addon não existe.

**Renderer** — em `startShare`, compartilhando a tela inteira:

- **Checkbox marcada** (incluir Discord): continua uma captura só, `EXCLUDE(ownPid)` — e a captura extra de Discord **é removida**. É o conserto do áudio duplicado.
- **Checkbox desmarcada**: modo lista-de-inclusão. Pega `listAudioRenderPids()`, remove os PIDs da árvore do GoLive e da árvore do Discord (`findDiscordRootPid` + filhos, via `listProcessNames`), e sobe uma captura `INCLUDE` por PID restante.
- **Processos que começam a tocar depois** de a transmissão já ter começado (abriu um vídeo no navegador no meio da call) não entram sozinhos. Poll de 2s enquanto a transmissão está no ar: PIDs novos ganham captura, PIDs mortos são liberados. Todos os `stop()` entram no `stopNativeAudioFns` que o `stopShare` já drena.
- Sem addon nativo (não-Windows, build sem o `.node`): tudo isso é no-op e cai no loopback de sistema do Electron, exatamente como hoje — sem exclusão possível. A checkbox deve ficar desabilitada com um `title` explicando, em vez de mentir que funciona.

Compartilhar uma **janela** só não muda nada: já é `INCLUDE` do PID dono da janela, e o Discord só entraria se a janela compartilhada fosse a do próprio Discord.

### 6b. "Só a voz das pessoas, mas manter vídeos e notificações"

Isso é o pedido mais difícil da lista e **ainda não sei se é possível**. O que dá pra afirmar:

- A exclusão do WASAPI é por *árvore de processos*, então isso só funciona se o Discord tocar a voz da call por um processo diferente do que toca vídeo/notificação — e se der pra excluir só aquele ramo, sem excluir a raiz.
- O Discord é Electron. Todo áudio de página (som de notificação, vídeo embutido) sai pelo **Audio Service** do Chromium, um processo utilitário separado (`--utility-sub-type=audio.mojom.AudioService`). Onde a **voz** sai é a incógnita: a engine de voz é nativa e pode estar no processo principal, num utilitário próprio, ou passando pelo mesmo Audio Service.

**Investigação antes de prometer** (task própria, roda numa máquina com Discord aberto): com uma call ativa, chamar `listProcessNames()` + `listAudioRenderPids()` e anotar quais PIDs têm sessão de render ativa em três cenários — (i) alguém falando, (ii) vídeo tocando, (iii) notificação. Se os PIDs forem distintos, a exclusão fina é viável e vira uma quarta opção da checkbox. Se for o mesmo PID nos três, **não é possível com WASAPI** e a checkbox precisa dizer isso na UI ("tudo ou nada do Discord") em vez de oferecer algo que não entrega.

Só a parte 6 (excluir o Discord inteiro, sem duplicar) é entregável sem essa investigação — e ela já resolve o que a pessoa reportou de fato.

---

## Resumo por arquivo

| Arquivo | 1 preset | 2 PiP | 3 recentes | 4 perfil | 5 mute | 6 áudio |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `src/renderer/config.js` | ✓ | | ✓ | | | |
| `src/renderer/config.test.js` | ✓ | | ✓ | | | |
| `src/renderer/ui.js` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `src/renderer/style.css` | | ✓ | | ✓ | ✓ | |
| `src/renderer/index.html` | | | ✓ | ✓ | | ✓ |
| `src/renderer/app.js` | | | ✓ | ✓ | | ✓ |
| `src/main.js` | | | | | | ✓ |
| `src/preload.js` | | | | | | ✓ |
| `native/src/*` | | | | | | ✓ |

## Ordem sugerida

3 → 5 → 1 → 4 → 2 → 6. Os quatro primeiros são pequenos e independentes; o 2 é o mais chato de UI; o 6 é o único que mexe em C++ e precisa de build nativo (`npm run build:native`) pra testar.

## Pendências levantadas de passagem (fora de escopo)

- Trocar nome/avatar com sessão ativa não repropaga pros peers (ver §4).
- A checkbox "Compartilhar som" não tem feedback de que o addon nativo não está disponível na máquina — hoje ela some pro loopback de sistema em silêncio.
