/*
 * Onde a janela de rabisco tem de ficar: qual monitor a pessoa escolheu
 * compartilhar, e qual e o retangulo dele.
 *
 * Vive fora de main.js pelo mesmo motivo de thumbs.js: main.js importa
 * `electron` e nao pode ser carregado pelo node:test. Aqui as fontes do
 * desktopCapturer e a lista de displays entram como argumento, entao a
 * decisao fica testavel sem subir Electron.
 *
 * A razao de existir um indice em vez de parsear o id: o id de uma fonte de
 * tela tem a forma `screen:<n>:0`, e esse `<n>` NAO e o id de display do
 * Electron -- no Windows ele e um indice interno do capturador. Quem casa os
 * dois e o campo `display_id` que o proprio desktopCapturer devolve, que o
 * main.js ja usa pra mostrar a resolucao de cada tela no seletor. Guardar o
 * casamento na hora da listagem e de graca e nao inventa correspondencia
 * nenhuma.
 *
 * Ver docs/superpowers/specs/2026-09-05-rabisco-na-tela-real-design.md
 */

'use strict';

/** Fonte de tela? Janela nao serve pra overlay: o retangulo dela muda quando
 * a pessoa move, redimensiona ou minimiza, e nao ha como acompanhar isso de
 * forma confiavel no Windows. Quem compartilha janela fica com o rabisco
 * dentro do app, como antes. */
function isScreenSource(sourceId) {
  return typeof sourceId === 'string' && sourceId.startsWith('screen:');
}

/** `Map<sourceId, displayId>` a partir do que o desktopCapturer devolveu.
 * So entram fontes de TELA que tenham um display correspondente na lista --
 * fonte de janela, `display_id` vazio ou display que nao existe mais ficam
 * de fora, porque pra nenhum deles ha um retangulo pra cobrir. */
function indexSourceDisplays(sources, displays) {
  const index = new Map();
  if (!Array.isArray(sources) || !Array.isArray(displays)) return index;
  for (const source of sources) {
    if (!source || !isScreenSource(source.id)) continue;
    const displayId = source.display_id;
    if (displayId == null || displayId === '') continue;
    const display = displays.find((d) => d && String(d.id) === String(displayId));
    if (!display) continue;
    index.set(source.id, String(displayId));
  }
  return index;
}

/** Retangulo do display, em coordenadas de tela do Electron (que ja sao
 * independentes de escala -- `bounds`, nao `size` x `scaleFactor`: e o que a
 * BrowserWindow espera). `null` quando o display sumiu entre a escolha e o
 * inicio da transmissao (monitor desligado, notebook desencaixado da dock),
 * e ai simplesmente nao ha overlay. */
function boundsFor(displayId, displays) {
  if (displayId == null || !Array.isArray(displays)) return null;
  const display = displays.find((d) => d && String(d.id) === String(displayId));
  if (!display || !display.bounds) return null;
  const { x, y, width, height } = display.bounds;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (!(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

/**
 * Soma o que uma listagem descobriu ao indice que ja existe, em vez de
 * trocar um pelo outro.
 *
 * O dialogo de compartilhar pede as fontes em DUAS chamadas em paralelo --
 * `listSources(['screen'])` e `listSources(['window'])` -- justamente pra
 * que as janelas, que sao a parte cara de enumerar, nao segurem a lista de
 * telas. So que uma listagem de JANELAS nao tem tela nenhuma dentro, entao
 * ela indexa vazio; enquanto o main ATRIBUIA o resultado, ela apagava o
 * casamento tela->display que a outra chamada tinha acabado de descobrir.
 * E como as janelas quase sempre chegam por ultimo, isso nao dava um bug
 * intermitente: dava um bug quase certo -- quem compartilhava a tela inteira
 * era avisado de que estava "compartilhando uma janela" e ficava sem o
 * rabisco na tela real.
 *
 * Somar resolve sem depender de ordem nenhuma. Entrada torta (a promessa de
 * uma das listagens falhou) nao tira nada do que ja estava la. Uma tela que
 * mudou de monitor e sobrescrita, nao duplicada, porque a chave e o id da
 * fonte. Entrada velha que sobreviva a uma troca de monitor nao faz estrago:
 * quem vai usar o valor e `boundsFor`, que devolve `null` quando o display
 * nao existe mais.
 */
function mergeSourceDisplays(existing, sources, displays) {
  const merged = new Map(existing || []);
  for (const [sourceId, displayId] of indexSourceDisplays(sources, displays)) {
    merged.set(sourceId, displayId);
  }
  return merged;
}

module.exports = { isScreenSource, indexSourceDisplays, mergeSourceDisplays, boundsFor };
