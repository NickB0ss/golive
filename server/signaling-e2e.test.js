'use strict';
/*
 * Teste ponta a ponta da sinalizacao (item D2 da auditoria de 2026-08-27).
 *
 * `signaling-core.test.js` cobre o servidor por dentro, uma mensagem de cada
 * vez. Aqui o servidor sobe de verdade, dois (ou tres) clientes `ws` reais
 * conectam e o handshake inteiro `join -> welcome -> offer -> answer -> ice`
 * roda pelo fio. E o teste que trancaria o A1: o cliente confia que a rajada
 * `offer` seguida de `ice` chega na ordem em que foi enviada -- se o servidor
 * um dia embaralhar isso, a corrida do renderer deixa de ser bug do cliente e
 * vira bug de protocolo, e ninguem descobre olhando so o nucleo.
 *
 * Regra de estabilidade deste arquivo: nenhuma espera e feita com timer.
 * Toda sincronizacao e por evento/mensagem; os prazos que existem sao apenas
 * limites de falha, pra uma regressao falhar o teste em vez de pendurar o
 * `node --test` pra sempre.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');

// Teto de espera de qualquer evento. Alto o bastante pra nao competir com o
// agendador numa maquina carregada, baixo o bastante pra falhar rapido.
const DEADLINE_MS = 5000;

// Limites que o servidor aplica (B4). Duplicados aqui de proposito: se
// alguem afrouxar o valor la, o teste desta ponta reclama.
const MAX_PAYLOAD_BYTES = 512 * 1024;
const MAX_AVATAR_CHARS = 256 * 1024;

let nonceSeq = 0;
function nonce(prefixo) {
  nonceSeq += 1;
  return `${prefixo}-${nonceSeq}`;
}

/** Cliente `ws` de verdade com caixa de entrada gravada.
 *
 * Gravar TUDO desde o `open` e o que elimina a corrida classica destes
 * testes: quem espera por uma mensagem que ja chegou ainda a encontra no
 * historico, entao nao existe janela entre "mandei" e "assinei o evento". */
function criarCliente(port, rotulo) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const entrada = [];
  const espera = new Set();
  let fechamento = null;

  function reavaliar() {
    for (const w of Array.from(espera)) {
      const achou = w.pred(entrada);
      if (achou) {
        espera.delete(w);
        clearTimeout(w.prazo);
        w.resolve(achou);
      }
    }
  }

  ws.on('message', (raw) => {
    entrada.push(JSON.parse(raw.toString()));
    reavaliar();
  });
  ws.on('close', (code, reason) => {
    fechamento = { code, reason: reason.toString() };
    // Espera pendente que nunca mais pode ser satisfeita: falha ja, com o
    // motivo real (socket caiu), em vez de arrastar ate o prazo.
    for (const w of Array.from(espera)) {
      espera.delete(w);
      clearTimeout(w.prazo);
      w.reject(new Error(`${rotulo}: socket fechou (${code}) esperando ${w.oque}`));
    }
  });
  // O socket cai de proposito em varios testes (flood, payload); o 'error'
  // que acompanha a queda nao pode derrubar o processo de teste.
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

    /** Resolve com o primeiro item da caixa que casa com `pred`, olhando
     * tambem o que ja chegou antes desta chamada. */
    esperaPor(pred, oque) {
      const achou = pred(entrada);
      if (achou) return Promise.resolve(achou);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve, reject, oque };
        w.prazo = setTimeout(() => {
          espera.delete(w);
          reject(new Error(`${rotulo}: ${oque} nao chegou em ${DEADLINE_MS}ms`));
        }, DEADLINE_MS);
        if (typeof w.prazo.unref === 'function') w.prazo.unref();
        espera.add(w);
      });
    },

    esperaMsg(filtro, oque) {
      return cliente.esperaPor((caixa) => caixa.find(filtro), oque);
    },

    esperaTipo(type) {
      return cliente.esperaMsg((m) => m.type === type, `mensagem ${type}`);
    },

    esperaFechar() {
      if (fechamento) return Promise.resolve(fechamento);
      return new Promise((resolve, reject) => {
        const prazo = setTimeout(
          () => reject(new Error(`${rotulo}: socket nao fechou em ${DEADLINE_MS}ms`)),
          DEADLINE_MS
        );
        if (typeof prazo.unref === 'function') prazo.unref();
        ws.once('close', (code, reason) => {
          clearTimeout(prazo);
          resolve({ code, reason: reason.toString() });
        });
      });
    },

    async entra(room, name, extra = {}) {
      cliente.envia({ type: 'join', room, name, ...extra });
      const welcome = await cliente.esperaTipo('welcome');
      cliente.id = welcome.id;
      return welcome;
    },

    /** Barreira propria: o servidor entrega ao proprio remetente o que ele
     * enderecar a si mesmo (mesma sala, destino existente). Quando a marca
     * volta, o servidor terminou de processar tudo que este socket mandou
     * antes dela -- e, como a entrega ate este cliente tambem e ordenada,
     * tudo que o servidor tenha mandado pra ca antes ja esta na caixa.
     * E o que permite afirmar "nao chegou X" sem esperar por tempo. */
    async barreira() {
      const marca = nonce(`eco-${rotulo}`);
      cliente.envia({ type: 'ice', to: cliente.id, candidate: marca });
      return cliente.esperaMsg((m) => m.candidate === marca, `barreira ${marca}`);
    },

    /** Barreira de sala: 'watchers' e broadcast pra sala inteira, entao
     * serve de marca-passo entre dois clientes distintos -- quando a marca
     * de X chega em Y, tudo que o servidor mandou de X pra Y antes dela ja
     * chegou. Devolve o nome da marca pra quem vai esperar por ela. */
    marcaDeSala() {
      const marca = nonce(`marca-${rotulo}`);
      cliente.envia({ type: 'watchers', kind: marca, watchers: [] });
      return marca;
    },

    esperaMarca(marca) {
      return cliente.esperaMsg((m) => m.type === 'watchers' && m.kind === marca, `marca ${marca}`);
    },
  };

  return cliente;
}

/** Servidores e sockets criados no teste, todos fechados no `t.after`.
 * Sem isso o `node --test` fica pendurado esperando handles vivos. */
function palco(t) {
  const servidores = [];
  const clientes = [];

  t.after(async () => {
    for (const c of clientes) {
      try {
        c.ws.close();
      } catch {
        /* socket ja fechando */
      }
    }
    // `close()` do nucleo so resolve quando o wss soltou a porta, entao
    // aguardar aqui garante que nada sobra pro proximo teste.
    for (const s of servidores) await s.close();
  });

  return {
    async servidor(opts = {}) {
      // Porta efemera: dois testes rodando lado a lado nunca disputam bind.
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

const tipos = (caixa) => caixa.map((m) => m.type);

test('handshake completo entre dois clientes, com cada mensagem so pro destinatario', async (t) => {
  const p = palco(t);
  const servidor = await p.servidor();
  const ana = await p.cliente(servidor, 'ana');
  const bruno = await p.cliente(servidor, 'bruno');
  // Terceiro na MESMA sala: e ele que prova que offer/answer/ice sao
  // unicast de verdade, e nao broadcast que por acaso funciona a dois.
  const carla = await p.cliente(servidor, 'carla');

  const welcomeAna = await ana.entra('geral', 'Ana');
  assert.deepEqual(welcomeAna.peers, [], 'primeira a entrar ve a sala vazia');

  const welcomeBruno = await bruno.entra('geral', 'Bruno');
  assert.deepEqual(
    welcomeBruno.peers.map((x) => ({ id: x.id, name: x.name })),
    [{ id: welcomeAna.id, name: 'Ana' }],
    'quem chega depois ja recebe quem estava na sala'
  );
  const joinedNaAna = await ana.esperaTipo('peer-joined');
  assert.equal(joinedNaAna.id, welcomeBruno.id);
  assert.equal(joinedNaAna.name, 'Bruno');

  const welcomeCarla = await carla.entra('geral', 'Carla');
  assert.equal(welcomeCarla.peers.length, 2);
  await bruno.esperaMsg((m) => m.type === 'peer-joined' && m.id === welcomeCarla.id, 'peer-joined da Carla');

  // A negociacao em si: A oferta, B responde, os dois trocam candidato.
  ana.envia({ type: 'offer', to: welcomeBruno.id, kind: 'screen', sdp: 'sdp-da-ana' });
  const offer = await bruno.esperaTipo('offer');
  assert.equal(offer.from, welcomeAna.id, 'servidor carimba quem mandou');
  assert.equal(offer.sdp, 'sdp-da-ana', 'payload chega intacto');
  assert.equal(offer.kind, 'screen');

  bruno.envia({ type: 'answer', to: welcomeAna.id, kind: 'screen', sdp: 'sdp-do-bruno' });
  const answer = await ana.esperaTipo('answer');
  assert.equal(answer.from, welcomeBruno.id);
  assert.equal(answer.sdp, 'sdp-do-bruno');

  ana.envia({ type: 'ice', to: welcomeBruno.id, kind: 'screen', candidate: 'cand-da-ana' });
  bruno.envia({ type: 'ice', to: welcomeAna.id, kind: 'screen', candidate: 'cand-do-bruno' });
  const iceNoBruno = await bruno.esperaTipo('ice');
  const iceNaAna = await ana.esperaTipo('ice');
  assert.equal(iceNoBruno.candidate, 'cand-da-ana');
  assert.equal(iceNoBruno.from, welcomeAna.id);
  assert.equal(iceNaAna.candidate, 'cand-do-bruno');
  assert.equal(iceNaAna.from, welcomeBruno.id);

  // Barreira dos dois lados antes de afirmar o negativo na Carla.
  const marcaAna = ana.marcaDeSala();
  const marcaBruno = bruno.marcaDeSala();
  await carla.esperaMarca(marcaAna);
  await carla.esperaMarca(marcaBruno);

  const vazou = carla.entrada.filter((m) => ['offer', 'answer', 'ice'].includes(m.type));
  assert.deepEqual(vazou, [], 'negociacao alheia nao pode chegar em quem nao e o destino');
  // A propria Ana tambem nao pode receber de volta o que mandou.
  assert.deepEqual(
    ana.entrada.filter((m) => m.type === 'offer'),
    []
  );
});

test('rajada offer + ice chega na mesma ordem em que foi enviada', async (t) => {
  const p = palco(t);
  const servidor = await p.servidor();
  const ana = await p.cliente(servidor, 'ana');
  const bruno = await p.cliente(servidor, 'bruno');

  await ana.entra('geral', 'Ana');
  const welcomeBruno = await bruno.entra('geral', 'Bruno');

  // Rajada sem nenhum await no meio: e exatamente o padrao do trickle ICE,
  // e a ordem offer-antes-dos-ice e a garantia em que o cliente se apoia pra
  // ter `remoteDescription` antes de `addIceCandidate` (A1).
  const QUANTOS = 24;
  ana.envia({ type: 'offer', to: welcomeBruno.id, kind: 'screen', sdp: 'sdp-da-ana' });
  for (let i = 0; i < QUANTOS; i += 1) {
    ana.envia({ type: 'ice', to: welcomeBruno.id, kind: 'screen', candidate: `cand-${i}`, seq: i });
  }

  await bruno.esperaPor(
    (caixa) => (caixa.filter((m) => m.type === 'ice').length === QUANTOS ? caixa : null),
    `os ${QUANTOS} candidatos`
  );

  const negociacao = bruno.entrada.filter((m) => m.type === 'offer' || m.type === 'ice');
  assert.equal(negociacao.length, QUANTOS + 1);
  assert.equal(negociacao[0].type, 'offer', 'a offer nao pode ser ultrapassada pelos ice');
  assert.deepEqual(
    negociacao.slice(1).map((m) => m.seq),
    Array.from({ length: QUANTOS }, (_, i) => i),
    'candidatos chegam na ordem de envio'
  );
});

test('sinalizacao de uma sala nunca vaza pra outra', async (t) => {
  const p = palco(t);
  const servidor = await p.servidor();
  const ana = await p.cliente(servidor, 'ana');
  const alice = await p.cliente(servidor, 'alice');
  const bruno = await p.cliente(servidor, 'bruno');

  await ana.entra('salaA', 'Ana');
  await alice.entra('salaA', 'Alice');
  const welcomeBruno = await bruno.entra('salaB', 'Bruno');
  assert.deepEqual(welcomeBruno.peers, [], 'salaB comeca vazia mesmo com salaA cheia');

  // Unicast pra fora da sala e broadcast de sala: nada disso pode cruzar.
  ana.envia({ type: 'offer', to: welcomeBruno.id, kind: 'screen', sdp: 'vazamento' });
  ana.envia({ type: 'ice', to: welcomeBruno.id, kind: 'screen', candidate: 'vazamento' });
  ana.envia({ type: 'tree', to: welcomeBruno.id, kind: 'screen', epoch: 1 });
  ana.envia({ type: 'broadcast-state', live: true });
  const marcaAna = ana.marcaDeSala();

  // Dois passos, sem timer: a barreira da Ana prova que o servidor ja
  // processou tudo que ela mandou; a do Bruno prova que o socket dele ja
  // recebeu tudo que o servidor tinha pra ele ate ali.
  await ana.barreira();
  await bruno.barreira();

  const recebidoPeloBruno = tipos(bruno.entrada).filter((tipo) => tipo !== 'welcome' && tipo !== 'ice');
  assert.deepEqual(recebidoPeloBruno, [], `salaB recebeu ${JSON.stringify(bruno.entrada)}`);
  assert.equal(
    bruno.entrada.filter((m) => m.type === 'ice' && m.candidate === 'vazamento').length,
    0,
    'nem o ice enderecado pra fora da sala pode passar'
  );

  // Controle positivo: dentro da salaA a mesma rajada chega normalmente --
  // sem isto o teste passaria mesmo com o servidor mudo.
  await alice.esperaMarca(marcaAna);
  await alice.esperaMsg((m) => m.type === 'broadcast-state' && m.live === true, 'broadcast-state na salaA');
});

test('saida de peer avisa o resto da sala, e so ele', async (t) => {
  const p = palco(t);
  const servidor = await p.servidor();
  const ana = await p.cliente(servidor, 'ana');
  const bruno = await p.cliente(servidor, 'bruno');
  const carla = await p.cliente(servidor, 'carla');

  await ana.entra('geral', 'Ana');
  const welcomeBruno = await bruno.entra('geral', 'Bruno');
  await carla.entra('outra', 'Carla');
  await ana.esperaTipo('peer-joined');
  assert.equal(servidor.getPeerCount(), 3);

  bruno.ws.close();
  const saiu = await ana.esperaTipo('peer-left');
  assert.equal(saiu.id, welcomeBruno.id);
  // O 'peer-left' so sai depois do `peers.delete`, entao ele proprio e a
  // sincronizacao do contador -- nao precisa esperar por tempo.
  assert.equal(servidor.getPeerCount(), 2);

  await carla.barreira();
  assert.deepEqual(
    carla.entrada.filter((m) => m.type === 'peer-left'),
    [],
    'saida na sala vizinha nao e da conta de quem esta em outra'
  );
});

test('frame acima do maxPayload derruba so quem mandou (B4)', async (t) => {
  const p = palco(t);
  const servidor = await p.servidor();
  const ana = await p.cliente(servidor, 'ana');
  const bruno = await p.cliente(servidor, 'bruno');

  const welcomeAna = await ana.entra('geral', 'Ana');
  await bruno.entra('geral', 'Bruno');
  await ana.esperaTipo('peer-joined');

  ana.envia({ type: 'broadcast-state', live: true, lixo: 'x'.repeat(MAX_PAYLOAD_BYTES) });

  const fechou = await ana.esperaFechar();
  assert.equal(fechou.code, 1009, 'ws responde 1009 (message too big) e corta a conexao');

  // O resto da sala segue de pe e e avisado da queda.
  const saiu = await bruno.esperaTipo('peer-left');
  assert.equal(saiu.id, welcomeAna.id);
  assert.equal(bruno.ws.readyState, WebSocket.OPEN);
});

test('avatar grande passa no limite de payload e chega cortado em 256 KB', async (t) => {
  const p = palco(t);
  const servidor = await p.servidor();
  const ana = await p.cliente(servidor, 'ana');
  const bruno = await p.cliente(servidor, 'bruno');

  await ana.entra('geral', 'Ana');
  // 400 KB: acima do corte do avatar, abaixo do maxPayload -- o frame tem de
  // ser aceito e o avatar guardado ja truncado, senao a sala inteira paga o
  // custo de repassar o original a cada 'welcome'.
  await bruno.entra('geral', 'Bruno', { avatar: 'y'.repeat(400 * 1024) });

  const joined = await ana.esperaTipo('peer-joined');
  assert.equal(joined.avatar.length, MAX_AVATAR_CHARS);
  assert.equal(bruno.ws.readyState, WebSocket.OPEN, 'o join grande porem legal nao derruba ninguem');
});

test('flood derruba so o cliente em loop e a sala e avisada (B4)', async (t) => {
  const p = palco(t);
  const servidor = await p.servidor();
  const ana = await p.cliente(servidor, 'ana');
  const bruno = await p.cliente(servidor, 'bruno');

  const welcomeAna = await ana.entra('geral', 'Ana');
  await bruno.entra('geral', 'Bruno');
  await ana.esperaTipo('peer-joined');

  // Bem acima do teto de 300/s: mesmo com a janela virando no meio, 1200
  // frames sem pausa estouram o limite de qualquer jeito.
  for (let i = 0; i < 1200; i += 1) {
    ana.envia({ type: 'broadcast-state', live: true });
  }

  const fechou = await ana.esperaFechar();
  assert.equal(fechou.code, 1008);
  assert.equal(fechou.reason, 'flood');

  const saiu = await bruno.esperaTipo('peer-left');
  assert.equal(saiu.id, welcomeAna.id);
  assert.equal(bruno.ws.readyState, WebSocket.OPEN);
});
