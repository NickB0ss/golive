'use strict';
/*
 * Teste ponta a ponta da informacao escondida do "Desenha e adivinha"
 * (contrato, docs/superpowers/plans/2026-09-24-mesa-contrato.md, secoes 8 e
 * 10), com `mesa-modules/desenha.js` como o jogo `secret` de prova.
 *
 * A pergunta central: o socket de quem AINDA NAO acertou recebe, em
 * alguma mensagem (eco de add, `op: 'state'`, `mesa-sync`), a palavra
 * secreta ou o palpite certo de outra pessoa? Nao pode -- nem antes dela
 * acertar, nem nas 3 opcoes de quem NAO e o desenhista da vez.
 *
 * Mesmo molde de server/signaling-mesa-segredo-e2e.test.js (arquivo
 * proprio, por instrucao do contrato: "nao edite o arquivo da batalha").
 * Servidor de verdade, clientes `ws` reais, "nao chegou X" so depois de
 * uma barreira (eco de um `ice` enderecado a si mesmo).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
const desenha = require('../src/renderer/mesa-modules/desenha');
require('../src/renderer/mesa-modules/index');

const DEADLINE_MS = 5000;
let nonceSeq = 0;

function criarCliente(port, rotulo) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const entrada = [];
  const espera = new Set();
  ws.on('message', (raw) => {
    entrada.push(JSON.parse(raw.toString()));
    for (const w of Array.from(espera)) {
      const achou = entrada.slice(w.desde).find(w.filtro);
      if (achou) {
        espera.delete(w);
        clearTimeout(w.prazo);
        w.resolve(achou);
      }
    }
  });
  ws.on('error', () => {});

  const cliente = {
    rotulo,
    ws,
    entrada,
    id: null,
    aberto() {
      if (ws.readyState === WebSocket.OPEN) return Promise.resolve(cliente);
      return new Promise((resolve, reject) => {
        ws.once('open', () => resolve(cliente));
        ws.once('error', reject);
      });
    },
    envia(msg) {
      ws.send(JSON.stringify(msg));
      return cliente;
    },
    esperaMsg(filtro, oque, desde = 0) {
      const achou = entrada.slice(desde).find(filtro);
      if (achou) return Promise.resolve(achou);
      return new Promise((resolve, reject) => {
        const w = { filtro, desde, resolve };
        w.prazo = setTimeout(() => {
          espera.delete(w);
          reject(new Error(`${rotulo}: ${oque} nao chegou em ${DEADLINE_MS}ms`));
        }, DEADLINE_MS);
        if (typeof w.prazo.unref === 'function') w.prazo.unref();
        espera.add(w);
      });
    },
    esperaNova(filtro, oque) {
      return cliente.esperaMsg(filtro, oque, entrada.length);
    },
    async entra(name, extra = {}) {
      cliente.envia({ type: 'join', room: 'geral', name, ...extra });
      const welcome = await cliente.esperaMsg((m) => m.type === 'welcome', 'welcome');
      cliente.id = welcome.id;
      return welcome;
    },
    async barreira() {
      nonceSeq += 1;
      const marca = `eco-${rotulo}-${nonceSeq}`;
      cliente.envia({ type: 'ice', to: cliente.id, candidate: marca });
      return cliente.esperaMsg((m) => m.candidate === marca, `barreira ${marca}`);
    },
    async abreMesa() {
      const retrato = cliente.esperaNova((m) => m.type === 'mesa-sync', 'mesa-sync');
      cliente.envia({ type: 'mesa-view', on: true });
      return (await retrato).mesa;
    },
    async poeDesenha(x = 100, y = 100) {
      const r = cliente.esperaNova((m) => (m.type === 'mesa' && m.op === 'add' && m.by === cliente.id)
        || (m.type === 'mesa-denied' && m.op === 'add'), 'resposta do add');
      cliente.envia({ type: 'mesa', op: 'add', win: { type: 'desenha', x, y, w: 720, h: 560 } });
      return r;
    },
    /** Uma acao: espera o `op: 'state'` dela (quem esta na Mesa) ou a recusa. */
    async joga(id, action) {
      const r = cliente.esperaNova((m) => (m.type === 'mesa' && m.op === 'state' && m.id === id && m.by === cliente.id)
        || (m.type === 'mesa-denied' && m.op === 'act'), `resposta de ${action.kind}`);
      cliente.envia({ type: 'mesa', op: 'act', id, action });
      return r;
    },
  };
  return cliente;
}

function palco(t) {
  const servidores = [];
  const clientes = [];
  t.after(async () => {
    for (const c of clientes) {
      try {
        c.ws.close();
      } catch {
        /* ja fechando */
      }
    }
    for (const s of servidores) {
      if (s.fechado) continue;
      s.fechado = true;
      await s.close();
    }
  });
  return {
    async servidor(opts = {}) {
      const s = await createSignalingServer({ port: 0, ...opts });
      servidores.push(s);
      return s;
    },
    async cliente(servidor, rotulo) {
      const c = criarCliente(servidor.port, rotulo);
      clientes.push(c);
      await c.aberto();
      return c;
    },
  };
}

/** Ana, Bia e Caio na sala e na Mesa; a janela do desenha posta; os tres
 * entraram na rodada; Ana comecou. Devolve o id da janela e as 3 opcoes
 * (a view da propria Ana, a unica que as ve). */
async function cena(p, opts = {}) {
  const s = await p.servidor({ ownerToken: 'segredo', ...opts });
  const ana = await p.cliente(s, 'ana');
  const bia = await p.cliente(s, 'bia');
  const caio = await p.cliente(s, 'caio');
  await ana.entra('Ana', { ownerToken: 'segredo', clientId: 'cli-ana' });
  await bia.entra('Bia', { clientId: 'cli-bia' });
  await caio.entra('Caio', { clientId: 'cli-caio' });
  await ana.abreMesa();
  await bia.abreMesa();
  await caio.abreMesa();
  const add = await ana.poeDesenha();
  const id = add.win.id;
  await ana.joga(id, { kind: 'join' });
  await bia.joga(id, { kind: 'join' });
  await caio.joga(id, { kind: 'join' });
  const iniciou = await ana.joga(id, { kind: 'start' });
  assert.equal(iniciou.state.phase, 'choosing');
  const opcoes = iniciou.state.options;
  assert.equal(opcoes.length, 3);
  return { s, ana, bia, caio, id, opcoes };
}

/** Nenhuma mensagem que chegou neste socket contem `texto` em lugar
 * nenhum -- nem cru no fio, nem dentro de um estado. */
function naoVaza(cliente, texto, oque) {
  const linhas = cliente.entrada.map((m) => JSON.stringify(m));
  for (const linha of linhas) {
    assert.equal(linha.toLowerCase().includes(String(texto).toLowerCase()), false, `${oque}: "${texto}" vazou: ${linha}`);
  }
}

test('a Ana escolhe: so ela ve a palavra; Bia e Caio (que ainda nao acertaram) nunca a veem em nenhuma mensagem', async (t) => {
  const p = palco(t);
  const { ana, bia, caio, id, opcoes } = await cena(p);

  const escolhida = await ana.joga(id, { kind: 'choose', index: 1 });
  assert.equal(escolhida.state.phase, 'drawing');
  const palavra = escolhida.state.word;
  assert.equal(palavra, opcoes[1]);
  assert.equal(typeof palavra, 'string');

  // O eco de secret vai pra cada pessoa na Mesa (mesmo seq); a promessa da
  // Ana resolve com a MENSAGEM DELA assim que chega -- as das outras duas
  // podem ainda estar a caminho, entao espera a de cada uma pelo seq.
  const doSeq = (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.seq === escolhida.seq;
  const vBia = await bia.esperaMsg(doSeq, 'estado da Bia');
  const vCaio = await caio.esperaMsg(doSeq, 'estado do Caio');
  assert.equal(vBia.state.word, null, 'a Bia ainda nao acertou: nao ve a palavra');
  assert.equal(vCaio.state.word, null, 'o Caio ainda nao acertou: nao ve a palavra');
  assert.equal(vBia.state.wordLen, palavra.length, 'mas ve o tamanho, pra pista');
  assert.equal(vBia.state.options, null, 'quem nao desenha nunca ve as opcoes');

  await bia.barreira();
  await caio.barreira();
  naoVaza(bia, palavra, 'Bia');
  naoVaza(caio, palavra, 'Caio');
  // As outras 2 palavras sorteadas (que a Ana nao escolheu) tambem nunca
  // deviam aparecer pro resto da sala -- elas nao sao segredo de jogo, mas
  // nao tem por que vazar a lista toda que so a Ana viu.
  naoVaza(bia, opcoes[0], 'Bia (opcao nao escolhida)');
  naoVaza(bia, opcoes[2], 'Bia (opcao nao escolhida)');
});

test('o palpite certo de um nao vaza pra quem ainda nao acertou; depois que os dois acertam, a rodada revela pra todos', async (t) => {
  const p = palco(t);
  const { ana, bia, caio, id } = await cena(p);
  const escolhida = await ana.joga(id, { kind: 'choose', index: 0 });
  const palavra = escolhida.state.word;

  // Bia erra primeiro (nao pode nem chegar perto do "quase" de proposito).
  const errou = await bia.joga(id, { kind: 'guess', text: 'coisa nenhuma a ver' });
  assert.equal(errou.state.phase, 'drawing');
  assert.equal(errou.state.guessedCount, 0);

  // Caio ainda nao acertou: garante que nada do que ja aconteceu vazou a
  // palavra pra ele antes do acerto dele.
  await caio.barreira();
  naoVaza(caio, palavra, 'Caio (antes de acertar)');

  // Bia acerta.
  const acertouBia = await bia.joga(id, { kind: 'guess', text: palavra.toUpperCase() });
  assert.equal(acertouBia.state.iGuessed, true);
  assert.equal(acertouBia.state.word, palavra, 'agora que acertou, a propria view da Bia mostra');

  // O Caio (que ainda nao acertou) NAO pode ter recebido a palavra da Bia
  // em mensagem nenhuma -- nem no evento 'correct' (que nao leva texto).
  const vCaioDepoisDoAcertoDaBia = await caio.esperaMsg(
    (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.seq === acertouBia.seq,
    'estado do Caio pro seq do acerto da Bia',
  );
  assert.equal(vCaioDepoisDoAcertoDaBia.state.word, null);
  assert.equal(vCaioDepoisDoAcertoDaBia.state.event?.kind, 'correct');
  assert.equal('text' in (vCaioDepoisDoAcertoDaBia.state.event || {}), false, 'o evento correct nao leva texto nenhum');
  await caio.barreira();
  naoVaza(caio, palavra, 'Caio (Bia ja acertou, ele ainda nao)');

  // Caio acerta: agora os dois acertaram, a rodada fecha e revela pra todos.
  const acertouCaio = await caio.joga(id, { kind: 'guess', text: palavra });
  assert.equal(acertouCaio.state.phase, 'choosing', 'todos acertaram: proxima rodada');
  assert.equal(acertouCaio.state.lastRound.word, palavra);
  const vAnaDepois = await ana.esperaMsg(
    (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.seq === acertouCaio.seq,
    'estado da Ana pro seq do fim da rodada',
  );
  assert.equal(vAnaDepois.state.lastRound.word, palavra, 'agora e publico: a rodada ja acabou');
});

test('"quase" (uma letra de diferenca) avisa so quem chutou -- ninguem mais recebe o evento', async (t) => {
  const p = palco(t);
  const { ana, bia, caio, id } = await cena(p);
  const escolhida = await ana.joga(id, { kind: 'choose', index: 0 });
  const palavra = escolhida.state.word;
  const quase = `${palavra}x`;

  const respBia = await bia.joga(id, { kind: 'guess', text: quase });
  assert.equal(respBia.state.event.kind, 'close');
  assert.equal(respBia.state.event.by, bia.id);

  // O eco de 'act' de secret vai pra TODOS que estao na Mesa (mesmo seq,
  // cada um com a sua view) -- Ana e Caio tambem receberam uma mensagem
  // pra este `seq`, mas a `view` deles filtra o 'close' (so quem chutou o
  // ve). Confere que NENHUMA das duas leva `event.kind === 'close'`.
  const doMesmoSeq = (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.seq === respBia.seq;
  const vAna = await ana.esperaMsg(doMesmoSeq, 'estado da Ana pro seq do "quase"');
  const vCaio = await caio.esperaMsg(doMesmoSeq, 'estado do Caio pro seq do "quase"');
  assert.notEqual(vAna.state.event?.kind, 'close');
  assert.notEqual(vCaio.state.event?.kind, 'close');
});

test('so o desenhista da vez pode rabiscar na janela; os outros sao ignorados em silencio', async (t) => {
  const p = palco(t);
  const { ana, bia, caio, id } = await cena(p);
  await ana.joga(id, { kind: 'choose', index: 0 });

  const chegaEmCaio = caio.esperaNova((m) => m.type === 'annotate' && m.surface === `mesa:${id}`, 'traco da Ana');
  ana.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'begin', id: 't1', x: 0.2, y: 0.3, width: 4 });
  const msg = await chegaEmCaio;
  assert.equal(msg.from, ana.id);

  const desde = caio.entrada.length;
  bia.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'begin', id: 't2', x: 0.1, y: 0.1 });
  await new Promise((r) => { setTimeout(r, 200); });
  assert.equal(caio.entrada.slice(desde).some((m) => m.type === 'annotate' && m.id === 't2'), false, 'traco de quem nao desenha nao devia chegar');
});

test('lista de palavras embutida tem 150+ palavras (contrato, secao 10)', () => {
  assert.ok(desenha.PALAVRAS.length >= 150);
});
