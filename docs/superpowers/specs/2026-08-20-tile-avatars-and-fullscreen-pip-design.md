# Avatar nos tiles + PiP em fullscreen — design

Data: 2026-08-20

## Contexto

Hoje cada tile de vídeo ([ui.js](../../../src/renderer/ui.js), `showTile`) só mostra um label de texto (nome), visível apenas no hover. A lista de membros já mostra avatar por pessoa ([2026-08-19-salas-vivas-design.md](2026-08-19-salas-vivas-design.md)), mas os tiles de vídeo em si não — isso ficou marcado como fora de escopo naquele spec.

O fullscreen de tile já existe (`toggleTileFullscreen`, classe `.tile.fullscreen` com `position:fixed;inset:0`, mais fullscreen nativo da janela via `window.golive.setFullScreen`), mas ao entrar em fullscreen você perde contato visual com as outras pessoas na sala.

Este documento cobre duas melhorias pedidas:

1. Avatar sempre visível no canto de cada tile (tela ou câmera), identificando de quem é aquele stream.
2. Miniaturas (PiP) de outras pessoas dentro do fullscreen, adicionadas manualmente e trocáveis.

## 1. Avatar no canto do tile

**Dado:** avatar já existe em duas fontes — `cfg.avatar` (próprio usuário, `app.js`) e `peer.avatar` (`session.mesh.peers`, populado via `mesh.addPeer`).

**Mudança em `showTile`:**
- Assinatura passa a ser `showTile(id, label, stream, { muted, avatar } = {})` (troca o 4º parâmetro posicional por um objeto de opções, já que vamos ter mais de um extra). Todos os call sites em `app.js` são atualizados.
- Novo elemento no template do tile: `<span class="tile-avatar">` com a mesma lógica de fallback já usada em `renderMembers`/`buildMemberRow` (imagem se houver `avatar`, senão iniciais sobre cor gerada por `avatarColorFor(id)`).
- CSS: canto superior esquerdo, ~32px, sempre opacidade 1 (não segue o fade-on-hover do label), leve sombra/borda escura pra contraste sobre qualquer conteúdo de vídeo.
- `app.js`: nos 4 call sites de `showTile` (self screen-share, self câmera, `onTrack` do mesh pra peer remoto), passa `avatar: cfg.avatar` (self) ou `peer.avatar` (remoto, lido de `session.mesh.peers.get(peerId)`).

## 2. PiP em fullscreen

### Estado

Em `ui.js`, module-level:
- `tileRegistry`: `Map<id, { label, stream, avatar }>` — espelha os tiles ativos, atualizado em `showTile`/`removeTile`. É a fonte de candidatos pro "+".
- `fullscreenTileId`: id do tile atualmente em fullscreen, ou `null`.
- `pinnedPip`: `Set<id>` — ids marcados como miniatura. Sobrevive a trocas de fullscreen e a sair/entrar de fullscreen; só é limpo quando o próprio id some do `tileRegistry` (peer saiu / parou de transmitir) ou o usuário remove manualmente.

### Template do tile

Todo tile (criado em `showTile`) ganha, além do que já existe, um container `.pip-strip` (inicialmente vazio) com um botão `.pip-add-btn` ("+"). Fica oculto por CSS a menos que o tile seja o que está em fullscreen:

```css
.pip-strip { display: none; }
.tile.fullscreen .pip-strip { display: flex; }
```

Segue o padrão de fade já usado pelo botão de sair do fullscreen (opacity 0 por padrão, 1 no `:hover` do `.tile`), pra não atrapalhar a visualização quando o mouse está parado.

### Interações

- **Entrar em fullscreen** (`toggleTileFullscreen`): seta `fullscreenTileId = id`; renderiza a faixa desse tile com as miniaturas correspondentes aos ids em `pinnedPip` que ainda existem em `tileRegistry` (filtra os que sumiram).
- **Botão "+"**: abre uma lista compacta (nome + avatar pequeno) de `tileRegistry` menos `fullscreenTileId` e menos quem já está em `pinnedPip`. Clicar num item: `pinnedPip.add(id)`, fecha a lista, re-renderiza a faixa.
- **Miniatura**: um `<video muted autoplay playsinline>` próprio (elemento novo, não reaproveita o do tile principal) com `srcObject = tileRegistry.get(id).stream`, mais avatar pequeno sobreposto e um "x" no canto pra desmarcar (`pinnedPip.delete(id)` + re-render). Sempre `muted` — o áudio real de peers remotos já toca via `ensureTileAudio`/Web Audio, independente de qualquer `<video>`; tiles de self já são preview mudo por natureza. Não há risco de eco/duplicação.
- **Clique na miniatura (fora do "x")** — troca de foco:
  1. Remove `.fullscreen` do tile atualmente em foco (`fullscreenTileId`); ele volta ao grid normal.
  2. Adiciona `.fullscreen` ao tile clicado; vira o novo `fullscreenTileId`.
  3. `pinnedPip`: remove o novo foco (não faz sentido ele aparecer como miniatura de si mesmo), adiciona o foco antigo.
  4. Re-renderiza a faixa do novo tile em fullscreen.
- **Sair do fullscreen** (botão, duplo-clique, Esc, ou controle nativo do SO via `onFullScreenChange`): remove a classe `.fullscreen`, zera `fullscreenTileId = null`. `pinnedPip` **não é limpo** — mantém a escolha pra próxima vez que entrar em fullscreen (em qualquer tile).
- **`removeTile(id)`** (peer saiu / parou stream): remove `id` de `tileRegistry` e de `pinnedPip`. Se `id === fullscreenTileId`, força saída do fullscreen (não há mais o que mostrar em tela cheia) e limpa `fullscreenTileId`.

### Fora de escopo

- Redimensionar/arrastar as miniaturas — posição fixa em linha na borda inferior.
- Mostrar miniatura de mais de uma pessoa ao mesmo tempo lado a lado com scroll — a faixa cresce horizontalmente com o número de pinned; sem paginação (número de participantes numa LAN party é pequeno o suficiente pra não justificar).
- Persistir `pinnedPip` entre sessões/reconexões — é só em memória, reseta ao trocar de sala ou reiniciar o app (mesmo raciocínio dos avatares remotos, que também não persistem).

## Testes

- Sem framework de teste de renderer no projeto (mesma situação do spec anterior) — verificação manual via `npm start` com dois clientes: avatar aparecendo em tile próprio e remoto (com e sem foto), entrar em fullscreen, adicionar miniatura via "+", trocar de foco clicando na miniatura, remover miniatura pelo "x", sair do fullscreen e voltar (miniatura deve reaparecer), peer sair da sala enquanto é miniatura (deve sumir) e enquanto está em fullscreen (deve forçar saída do fullscreen).
