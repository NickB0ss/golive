// src/main/overlayslot.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarSlotOverlay } = require('./overlayslot');

/** Janela falsa: `carregou` e uma promessa que o teste resolve/rejeita quando quiser. */
function fabrica() {
  const janelas = [];
  const criar = () => {
    let resolver;
    let rejeitar;
    const carregou = new Promise((res, rej) => {
      resolver = res;
      rejeitar = rej;
    });
    const janela = { destruida: false, resolver, rejeitar };
    janelas.push(janela);
    return { janela, carregou };
  };
  return { criar, janelas };
}

const novoSlot = () => criarSlotOverlay({ destruir: (janela) => { janela.destruida = true; } });

test('abre a janela e resolve ok quando ela carrega', async () => {
  const slot = novoSlot();
  const { criar, janelas } = fabrica();
  const pedido = slot.abrir(criar);
  janelas[0].resolver();
  assert.deepEqual(await pedido, { ok: true });
  assert.equal(slot.janela, janelas[0]);
});

test('falha de carga do unico pedido destroi a janela e devolve display', async () => {
  const slot = novoSlot();
  const { criar, janelas } = fabrica();
  const pedido = slot.abrir(criar);
  janelas[0].rejeitar(new Error('ERR_FAILED'));
  const r = await pedido;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'display');
  assert.equal(janelas[0].destruida, true);
  assert.equal(slot.janela, null);
});

// M-09: dois overlay:start sobrepostos. O segundo destroi a janela do primeiro;
// a falha de carga do primeiro NAO pode derrubar a do segundo.
test('M-09: a falha do primeiro start nao destroi a janela do segundo', async () => {
  const slot = novoSlot();
  const { criar, janelas } = fabrica();
  const primeiro = slot.abrir(criar);
  const segundo = slot.abrir(criar); // fecha a janela #0 e abre a #1
  assert.equal(janelas[0].destruida, true);
  janelas[0].rejeitar(new Error('ERR_FAILED')); // o loadFile da #0 rejeita ao ser destruida
  const r1 = await primeiro;
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'superseded'); // o renderer nao mostra aviso de "monitor sumiu"
  assert.equal(janelas[1].destruida, false);
  assert.equal(slot.janela, janelas[1]);
  janelas[1].resolver();
  assert.deepEqual(await segundo, { ok: true });
  assert.equal(slot.janela, janelas[1]);
});

test('M-09: stop no meio do carregamento nao vira erro de monitor', async () => {
  const slot = novoSlot();
  const { criar, janelas } = fabrica();
  const pedido = slot.abrir(criar);
  slot.fechar();
  janelas[0].rejeitar(new Error('ERR_FAILED'));
  assert.equal((await pedido).reason, 'superseded');
  assert.equal(slot.janela, null);
});

test('M-09: carregar depois de um stop nao deixa o pedido dizer ok', async () => {
  const slot = novoSlot();
  const { criar, janelas } = fabrica();
  const pedido = slot.abrir(criar);
  slot.fechar();
  janelas[0].resolver();
  assert.equal((await pedido).ok, false);
});

test("o 'closed' da janela antiga nao solta o slot da nova", async () => {
  const slot = novoSlot();
  const { criar, janelas } = fabrica();
  slot.abrir(criar);
  slot.abrir(criar);
  slot.fechada(janelas[0]); // evento atrasado da #0
  assert.equal(slot.janela, janelas[1]);
  slot.fechada(janelas[1]);
  assert.equal(slot.janela, null);
});

test('criar() que lanca (a janela nem nasceu) vira display sem deixar slot sujo', async () => {
  const slot = novoSlot();
  const r = await slot.abrir(() => { throw new Error('sem GPU'); });
  assert.equal(r.reason, 'display');
  assert.equal(slot.janela, null);
});
