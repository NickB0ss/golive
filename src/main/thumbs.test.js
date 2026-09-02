// src/main/thumbs.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { thumbnailDataUrl, QUALIDADE_JPEG, PIXEL_VAZIO } = require('./thumbs');

// Dubles no formato do nativeImage do Electron: so os tres metodos que o
// modulo toca.
function fakeImage({ jpeg, png, empty = false, onJPEG } = {}) {
  const calls = { jpeg: [], png: 0 };
  return {
    calls,
    isEmpty: () => empty,
    toJPEG: (q) => {
      calls.jpeg.push(q);
      if (onJPEG) return onJPEG(q);
      return jpeg;
    },
    toDataURL: () => {
      calls.png++;
      return png;
    },
  };
}

test('codifica JPEG e monta a data URL com o base64 do buffer', () => {
  const img = fakeImage({ jpeg: Buffer.from('abc'), png: 'data:image/png;base64,ZZZZ' });
  const url = thumbnailDataUrl(img);
  assert.equal(url, `data:image/jpeg;base64,${Buffer.from('abc').toString('base64')}`);
  assert.equal(img.calls.png, 0, 'nao deve pagar o PNG quando o JPEG deu certo');
});

test('usa a qualidade sugerida pela auditoria', () => {
  const img = fakeImage({ jpeg: Buffer.from('abc') });
  thumbnailDataUrl(img);
  assert.deepEqual(img.calls.jpeg, [QUALIDADE_JPEG]);
  assert.equal(QUALIDADE_JPEG, 70);
});

test('cai no PNG quando toJPEG nao existe nesta versao do Electron', () => {
  const img = {
    isEmpty: () => false,
    toDataURL: () => 'data:image/png;base64,ZZZZ',
  };
  assert.equal(thumbnailDataUrl(img), 'data:image/png;base64,ZZZZ');
});

test('cai no PNG quando toJPEG lanca', () => {
  const img = fakeImage({
    png: 'data:image/png;base64,ZZZZ',
    onJPEG: () => {
      throw new Error('encoder indisponivel');
    },
  });
  assert.equal(thumbnailDataUrl(img), 'data:image/png;base64,ZZZZ');
  assert.equal(img.calls.png, 1);
});

test('cai no PNG quando toJPEG devolve buffer vazio', () => {
  const img = fakeImage({ jpeg: Buffer.alloc(0), png: 'data:image/png;base64,ZZZZ' });
  assert.equal(thumbnailDataUrl(img), 'data:image/png;base64,ZZZZ');
});

test('cai no PNG quando toJPEG devolve null', () => {
  const img = fakeImage({ jpeg: null, png: 'data:image/png;base64,ZZZZ' });
  assert.equal(thumbnailDataUrl(img), 'data:image/png;base64,ZZZZ');
});

test('thumbnail vazia devolve o pixel transparente, sem codificar nada', () => {
  const img = fakeImage({ jpeg: Buffer.from('abc'), empty: true });
  assert.equal(thumbnailDataUrl(img), PIXEL_VAZIO);
  assert.deepEqual(img.calls.jpeg, []);
  assert.equal(img.calls.png, 0);
});

test('data URL sem payload nao e repassada pro renderer', () => {
  const img = fakeImage({ jpeg: Buffer.alloc(0), png: 'data:image/png;base64,' });
  assert.equal(thumbnailDataUrl(img), PIXEL_VAZIO);
});

test('imagem ausente nao quebra a lista de fontes', () => {
  assert.equal(thumbnailDataUrl(null), PIXEL_VAZIO);
  assert.equal(thumbnailDataUrl(undefined), PIXEL_VAZIO);
});

test('isEmpty quebrado nao impede o JPEG', () => {
  const img = fakeImage({ jpeg: Buffer.from('abc') });
  img.isEmpty = () => {
    throw new Error('nativeImage estranho');
  };
  assert.equal(thumbnailDataUrl(img), `data:image/jpeg;base64,${Buffer.from('abc').toString('base64')}`);
});

test('objeto sem nenhum dos dois metodos ainda devolve uma data URL valida', () => {
  const url = thumbnailDataUrl({});
  assert.equal(url, PIXEL_VAZIO);
  assert.match(url, /^data:image\/png;base64,.+/);
});

test('toDataURL que lanca cai no pixel vazio', () => {
  const img = {
    toJPEG: () => {
      throw new Error('sem jpeg');
    },
    toDataURL: () => {
      throw new Error('sem png');
    },
  };
  assert.equal(thumbnailDataUrl(img), PIXEL_VAZIO);
});
