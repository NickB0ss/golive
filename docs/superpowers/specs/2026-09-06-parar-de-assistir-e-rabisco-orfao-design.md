# Parar de assistir pelo botão direito, e rabisco órfão quando alguém sai — design

Dois pedidos pequenos, depois de mais um uso de verdade:

1. **Poder parar de assistir uma tela (ou câmera) pelo menu de botão
   direito.** Hoje só dá pra largar uma tela quando se assiste duas ou
   mais, e câmera não tem como desligar de jeito nenhum.
2. **Quando alguém sai da sala, o que essa pessoa rabiscou na tela dos
   outros tem de sumir junto.** A tela _dela_ já leva a lousa embora com o
   tile; o traço dela na tela dos outros fica órfão.

Continuação de `2026-09-05-rabisco-na-tela-real-design.md` e do modelo de
"assistir vira escolha" que entrou na 0.12.0.

## 1. O que já existe

### Assistir tela

`watchedScreens` (um `Set<originId>` em `app.js`) é opt-**in**: uma tela
por padrão, e `syncWatchedScreens` **repõe a primeira tela viva** sempre
que o Set fica vazio — é o que evita que uma sala com um só transmissor
vire um cartão "Assistir" pra todo mundo. Um botão-olho de hover larga uma
tela, mas só aparece com duas ou mais assistidas (`canDrop`), e o handler
de intent tem um guard `if (watchedScreens.size <= 1) return`.

A economia real não mora no cliente que assiste: a tela não escolhida vira
`view-state {watching:false}`, e quem transmite **solta o encoder daquele
espectador** (`mesh.setPeerDemand`, F1.3 da spec de 2026-08-23).

### Assistir câmera

Não é escolha. `broadcastViewState` fixa `querendo = true` para todo kind
`camera`. Não há Set, não há portão, não há como desligar.

### Menu de botão direito

`openTileMenu(id, x, y)` em `ui.js` já existe, ligado no `contextmenu` de
todo tile que não seja o próprio (`id !== 'me' && id !== 'cam-me'`) — vale
pra tela e pra câmera. Hoje só tem cabeçalho (nome + avatar), silenciar e
volume.

### Rabisco quando alguém sai

`peer-left` em `app.js` chama `ui.annotations.setSurface(msg.id, {allowed:
false})` para as superfícies **do peer que saiu** (tela e câmera dele), e
`dropTile` derruba o tile — o que já apaga a lousa daquelas superfícies
(`releaseTileAnnotations` → `annotStore.drop`). O que **não** acontece: o
depósito guarda itens por superfície, cada item com `from` = autor, e não
há nenhum caminho que remova os itens de um autor **das superfícies dos
outros**.

O servidor de sinalização não guarda estado de anotação nenhum, e não vai
passar a guardar — a limpeza é cooperativa, cada cliente faz a sua.

## 2. Parte 1 — Parar de assistir tela e câmera

### 2.1 O mecanismo do sender já serve os dois

O handler de `view-state` em `app.js` é genérico por kind:
`mesh.setPeerDemand(msg.from, msg.kind, wanted, track)`, com
`track = trackForKind(msg.kind)` — e `trackForKind` já devolve
`cameraStream.getVideoTracks()[0]` para o kind `camera`, inclusive
resolvendo a track de entrada quando o kind é composto (`camera@<origem>`,
repasse). **Nada muda no sender.** Câmera só nunca recebeu um
`watching:false` porque o lado de quem assiste nunca mandou um.

### 2.2 Dois estados, porque os defaults são opostos

| | Tela | Câmera |
|---|---|---|
| padrão | **não** assiste (auto-escolhe uma) | **assiste** |
| múltiplas | sim ("+ Ver junto") | não, binário |
| estrutura | `watchedScreens` opt-in | `unwatchedCameras` opt-out |

Unir os dois num Set só seria pior: o auto-preenchimento de uma tela não
faz sentido nenhum pra câmera, e o "+ Ver junto" também não. O que os dois
compartilham é o **cartão-portão** (`renderWatchGate` / `setWatched` /
`tileWatch`), que já é indexado por `tileId` qualquer.

### 2.3 `app.js` — telas

- **Flag nova `autoWatchSuppressed`** (boolean, escopo de sessão). Começa
  `false`, é resetada em `teardownPeers` junto com `watchedScreens.clear()`.
- `syncWatchedScreens`: a auto-escolha passa a respeitar a flag —
  `if (!watchedScreens.size && !autoWatchSuppressed && vivas.length)
  watchedScreens.add(vivas[0]);`. O caso comum (entrou na sala, uma pessoa
  compartilhando) continua idêntico: a flag só liga depois de uma escolha
  explícita de parar.
- Handler `onWatchIntent`, ramo de tela:
  - `only` / `add` → `autoWatchSuppressed = false` (voltei a querer ver
    algo);
  - `remove` → `watchedScreens.delete(id)`; **sai o guard** `size <= 1`; se
    o Set ficou vazio, `autoWatchSuppressed = true`.
- O botão-olho de hover não muda: ele só aparece com `canDrop` (duas ou
  mais), então `remove` por ele nunca chega a zero e nunca liga a flag.

Resultado do pedido: botão direito numa tela → "Parar de assistir esta
tela" → o tile vira o cartão "fulano está ao vivo / Assistir", e **assim
fica** — nem essa tela reiniciando nem outra entrando no ar re-liga o
vídeo sozinho. Só clicar "Assistir" (que manda `only` e desliga a flag).

### 2.4 `app.js` — câmeras

- **`unwatchedCameras = new Set()`** — ids de dono de câmera de que optei
  sair. Resetado em `teardownPeers`.
- `watchingCamera(originId)` → `!unwatchedCameras.has(String(originId))`.
- `onTrack`, ramo `baseKind === 'camera'`: depois do `showTile`, chama
  `ui.grid.setWatched(tileId, watchingCamera(ownerId), { name: displayName,
  avatar: owner?.avatar || null, kind: 'camera' })`. É esse `setWatched`
  que põe (ou tira) o portão do tile da câmera.
- `broadcastViewState`: `querendo` para câmera passa a ser
  `watchingCamera(sourceId || peerId)` em vez de `true` fixo. A linha vira:
  ```js
  const querendo = baseKind === 'camera'
    ? watchingCamera(sourceId || peerId)
    : watchingScreen(sourceId || peerId);
  ```
  A agregação de relay (`anyFolhaWatching`) não muda e já cobre câmera: um
  relay que optou sair de uma câmera continua recebendo e repassando
  enquanto qualquer folha da sub-árvore dele ainda quiser — mesma regra da
  tela.
- Handler `onWatchIntent`, ramo de câmera (prefixo `cam-` no tileId, dono =
  `tileId.slice(4)`):
  - `only` → `unwatchedCameras.delete(dono)`;
  - `remove` → `unwatchedCameras.add(dono)`;
  - nos dois: re-`setWatched` desse tile com o novo estado + `broadcastViewState()`.
- `peer-left` e a saída órfã: `unwatchedCameras.delete(id)` — um id
  reaproveitado não herda a opção.

### 2.5 `ui.js`

- **`renderWatchGate`**: `opts.kind === 'camera'` troca o texto e corta o
  que não se aplica.
  - Tela (padrão, como hoje): título "{nome} está ao vivo", subtítulo "A
    tela só chega quando você pede — é um encoder a menos rodando na
    máquina de quem transmite.", botões "Assistir" (`only`) e, com
    `canAdd`, "+ Ver junto" (`add`).
  - Câmera: título "{nome}", subtítulo "A câmera só chega quando você
    pede.", só o botão "Assistir" (`only`). Nunca "+ Ver junto"; o
    botão-olho de hover (`canDrop`) também não, porque `app.js` nunca passa
    `canAdd`/`canDrop` pra câmera.
- **`openTileMenu`**: um item no topo do menu, antes do "Silenciar", com um
  separador depois. O que ele mostra sai de `tileWatch.get(id)` (ausência
  conta como assistido — é o default de `renderWatchGate`):
  - tile de tela, assistido → **"Parar de assistir esta tela"** →
    `onWatchIntent(id, 'remove')`, fecha o menu;
  - tile de tela, não assistido → **nada** (o portão já tem "Assistir");
  - tile de câmera (`id.startsWith('cam-')`), assistido → **"Parar de
    assistir esta câmera"** → `onWatchIntent(id, 'remove')`;
  - tile de câmera, não assistido → **"Assistir câmera"** →
    `onWatchIntent(id, 'only')`.
  - Como saber se é tela ou câmera: o tile tem `dataset.kind`
    (`showTile` grava). O prefixo `cam-` no id é o mesmo sinal e não
    depende de o dataset já ter sido escrito.

## 3. Parte 2 — Rabisco órfão

### 3.1 `annotate.js` — `dropAuthor` no depósito

```js
/** Remove tudo que `author` desenhou, em TODAS as superfícies. Devolve os
 * surfaceIds que mudaram, pra quem chama redesenhar só esses. Chamado
 * quando um peer sai da sala: o que ele rabiscou na tela dos outros sai
 * com ele (a tela DELE já morre por outro caminho, com o tile). */
function dropAuthor(author) {
  const a = String(author);
  const changed = [];
  for (const [surfaceId, list] of surfaces) {
    const kept = list.filter((it) => it.from !== a);
    if (kept.length !== list.length) {
      list.length = 0;
      list.push(...kept);
      changed.push(surfaceId);
    }
  }
  return changed;
}
```

Exposta no `return { ... }` do `createStore` e no `api`.

### 3.2 `ui.js` — `forgetAuthor`

```js
function forgetAnnotAuthor(peerId) {
  const changed = annotStore.dropAuthor(peerId);
  if (!changed.length) return [];
  const alvo = new Set(changed.map(String));
  for (const [tileId, info] of annotSurfaces) {
    if (alvo.has(String(info.surfaceId))) {
      redrawAnnot(tileId);
      syncAnnotBar(tileId);
    }
  }
  return changed;
}
```

Exposta como `ui.annotations.forgetAuthor`.

### 3.3 `app.js` — no `peer-left`

Junto da limpeza de anotação que já está lá (logo depois dos dois
`ui.annotations.setSurface(msg.id, {allowed:false})`):

```js
const surfacesLimpas = ui.annotations.forgetAuthor(msg.id);
// Se apaguei rabisco da MINHA tela real, o overlay tem a cópia dele —
// recarrega do snapshot já podado (reusa o caminho overlay:load).
if (annotOverlayOn) {
  const minhaTela = annotate.surfaceKey(myId, 'screen');
  if (surfacesLimpas.some((s) => String(s) === minhaTela)) {
    window.golive.sendAnnotOverlayLoad?.({
      surface: minhaTela,
      items: ui.annotations.snapshot(minhaTela),
    });
  }
}
```

A mesma chamada de `forgetAuthor` no ramo de saída órfã (`session ===
orphanSession`, onde nunca chega um `peer-left`) — sem o bloco do overlay
ali, porque uma órfã não está negociando repasse; basta a limpeza do
depósito, e o overlay se corrige no próximo `overlay:load` normal.

### 3.4 Por que não precisa de rede

Todo cliente que fica na sala processa o mesmo `peer-left` e chega ao
mesmo resultado — igual a todo o resto do protocolo de anotação. Quem
saiu está fechando a sessão; não precisa limpar nada.

O overlay (a lousa na tela real de quem compartilha) reusa o canal
`overlay:load` que já existe — o snapshot já vem podado do depósito do
app, então a janela redesenha sem o traço de quem saiu. Não há canal de
IPC novo.

## 4. O que fica de fora

- Rabisco não "persiste" pra quem entra depois do autor sair — o snapshot
  `annotate-sync` já sai do depósito podado, então naturalmente não inclui
  o traço de quem não está mais na sala.
- Sem desfazer a saída: se a pessoa voltar, os traços antigos dela não
  ressuscitam (ids novos de conexão de qualquer forma).
- Câmera continua sem cadeia de degradação de qualidade — parar de
  assistir é o único controle novo.

## 5. Testes

- `annotate.test.js`: `dropAuthor`
  - remove só os itens do autor pedido, deixa os dos outros intactos;
  - devolve exatamente os surfaceIds que mudaram, e `[]` quando o autor não
    tinha nada;
  - não cria superfície nova pra um autor desconhecido.
- Parte 1 é estado de `watchedScreens` / `unwatchedCameras` + DOM do menu e
  do portão — teste manual no app: tela e câmera, sozinho e com um relay no
  meio (a folha atrás do relay tem de continuar recebendo quando o relay
  para de assistir).

## 6. Versão

Bump de patch (`0.12.2` → `0.12.3`): recurso pequeno, sem quebra de
protocolo — um cliente que não manda `view-state {kind:'camera',
watching:false}` continua sendo servido normalmente, e um que manda é
tratado pelo caminho que já existe.
