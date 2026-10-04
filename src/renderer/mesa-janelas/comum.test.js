'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../i18n');
const pt = require('../i18n/pt-BR');
require('../i18n/en');
require('../i18n/es');
const C = require('./comum');
const registro = require('../mesa-modules');

class Elemento {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attrs = new Map();
    this.className = '';
    this.listeners = new Map();
    this.style = { setProperty() {} };
    this.textContent = '';
    this.classList = {
      add: (...classes) => {
        this.className = [...new Set([...this.className.split(' '), ...classes].filter(Boolean))].join(' ');
      },
      remove: (...classes) => {
        this.className = this.className.split(' ').filter((item) => !classes.includes(item)).join(' ');
      },
    };
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }

  insertBefore(node, before) {
    node.remove();
    node.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }

  remove() {
    const index = this.parentNode?.children.indexOf(this) ?? -1;
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  removeAttribute(name) { this.attrs.delete(name); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  dispatch(type) { this.listeners.get(type)?.({ preventDefault() {} }); }

  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }
}

function montarBase(tipo) {
  const anterior = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new Elemento(tag),
    createElementNS: (_ns, tag) => new Elemento(tag),
  };
  const root = new Elemento('div');
  const api = { act() {}, validate: () => true };
  const instancia = C.base(root, api, tipo);
  globalThis.document = anterior;
  return instancia.raiz;
}

function comDocumento(fazer) {
  const anterior = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new Elemento(tag),
    createElementNS: (_ns, tag) => new Elemento(tag),
  };
  try {
    return fazer();
  } finally {
    globalThis.document = anterior;
  }
}

function texto(node) {
  return node.textContent + node.children.map(texto).join('');
}

test('carregar no Node nao precisa de DOM e registra o apoio', () => {
  assert.equal(globalThis.GoLive.mesaJanelasComum, C);
  assert.equal(typeof globalThis.GoLive.mesaJanelas, 'object');
});

test('motivoRecusa: invalid mostra o motivo do modulo; o resto vira frase em PT', () => {
  assert.equal(C.motivoRecusa('invalid', 'o placar não fica negativo'), 'O placar não fica negativo');
  assert.equal(C.motivoRecusa('locked'), 'Só o líder da sala mexe na Mesa agora');
  assert.equal(C.motivoRecusa('rate'), 'Muitas ações seguidas; espere um instante');
  assert.equal(C.motivoRecusa('coisa-nova'), 'Não deu certo; tente de novo');
  assert.equal(C.motivoRecusa('invalid', ''), 'Não deu certo; tente de novo');
});

test('motivoRecusa traduz codigo do validate e mantem frase antiga', () => {
  pt['mesa.teste.ocupado'] = 'Lugar ocupado';
  try {
    i18n.definirIdioma('pt-BR');
    assert.equal(C.motivoRecusa('invalid', 'mesa.teste.ocupado'), 'Lugar ocupado');
    assert.equal(C.motivoRecusa('invalid', 'texto antigo'), 'Texto antigo');
  } finally {
    delete pt['mesa.teste.ocupado'];
  }
});

test('motivoRecusa, podeFazer e ligado traduzem codigos no idioma ativo', () => {
  try {
    i18n.definirIdioma('en');
    assert.equal(C.motivoRecusa('rate'), 'Too many actions in a row; wait a moment');
    assert.equal(
      C.podeFazer({ validate: () => i18n.codigo('mesa.recusa.semAcao') }, {}),
      'Window has no actions',
    );
    const btn = new Elemento('button');
    C.ligado(btn, i18n.codigo('mesa.recusa.noAct'));
    assert.equal(btn.title, "This window doesn't take actions");
  } finally {
    i18n.definirIdioma('pt-BR');
  }
});

test('milhar; o plural agora e chave { one, other } do dicionario', () => {
  assert.equal(C.milhar(1000), '1 000');
  assert.equal(C.milhar(999), '999');
  assert.equal(C.milhar(1234567), '1 234 567');
  assert.equal(C.plural, undefined);
  assert.equal(i18n.t('mesa.galeria.imagens', { n: 1 }), '1 imagem');
  assert.equal(i18n.t('mesa.galeria.imagens', { n: 3 }), '3 imagens');
});

test('podeFazer: true passa; motivo vem com maiuscula; validate que lanca desliga', () => {
  assert.equal(C.podeFazer({ validate: () => true }, {}), true);
  assert.equal(C.podeFazer({ validate: () => 'ação desconhecida' }, {}), 'Ação desconhecida');
  assert.equal(C.podeFazer({ validate: () => { throw new Error('x'); } }, {}), 'Indisponível');
  assert.equal(C.podeFazer({ validate: () => false }, {}), 'Indisponível');
});

test('nomeDe e corDe aguentam pessoa que saiu e api que lanca', () => {
  const api = { nameOf: (id) => (id === '1' ? 'Ana' : null), colorFor: (id) => (id === '1' ? '#4ade80' : 'vermelho') };
  assert.equal(C.nomeDe(api, '1'), 'Ana');
  assert.equal(C.nomeDe(api, '9'), 'Alguém');
  assert.equal(C.nomeDe(api, null), 'Alguém');
  assert.equal(C.corDe(api, '1'), '#4ade80');
  assert.equal(C.corDe(api, '2'), null);
  assert.equal(C.corDe({ colorFor() { throw new Error('x'); } }, '1'), null);
});

test('SUPERFICIES cobre exatamente os tipos do registro, com um dos cinco materiais', () => {
  const tipos = registro.MODULE_NAMES.filter((tipo) => registro.get(tipo)).sort();
  assert.deepEqual(Object.keys(C.SUPERFICIES).sort(), tipos);
  for (const [tipo, superficie] of Object.entries(C.SUPERFICIES)) {
    assert.ok(['feltro', 'tabuleiro', 'papel', 'lousa', 'palco'].includes(superficie), `${tipo}: ${superficie}`);
  }
  assert.ok(Object.isFrozen(C.SUPERFICIES));
});

test('base marca a raiz com a superficie do tipo', () => {
  const raiz = montarBase('poquer');
  assert.equal(raiz.dataset.superficie, 'feltro');
});

test('cadeiras sync monta lugar ocupado, livre e vez', () => {
  comDocumento(() => {
    const cadeiras = C.cadeiras({ aoSentar() {}, aoLevantar() {} });
    cadeiras.sync([
      { peer: 'ana', nome: 'Ana', cor: '#4ade80', peca: { texto: 'X' }, vez: true, eu: true },
      { peer: null, motivoSentar: true },
    ]);
    assert.equal(cadeiras.node.children.length, 2);
    assert.equal(cadeiras.node.children[0].dataset.vez, '1');
    assert.equal(texto(cadeiras.node.children[0].children[0]), 'VVocêX');
    assert.equal(texto(cadeiras.node.children[1].children[0]), 'Sentar');
  });
});

test('cadeiras sync sem peca nao escreve nada no lugar dela', () => {
  comDocumento(() => {
    const cadeiras = C.cadeiras({ aoSentar() {}, aoLevantar() {} });
    cadeiras.sync([{ peer: 'ana', nome: 'Ana', cor: '#4ade80', peca: null }]);
    const botaoLugar = cadeiras.node.children[0].children[0];
    assert.equal(texto(botaoLugar), 'AAna');
    assert.equal(botaoLugar.children.length, 2);
  });
});

test('cadeiras sync reaproveita os mesmos nos com a mesma quantidade de lugares', () => {
  comDocumento(() => {
    const cadeiras = C.cadeiras({ aoSentar() {}, aoLevantar() {} });
    cadeiras.sync([{ peer: null, motivoSentar: true }, { peer: null, motivoSentar: true }]);
    const antes = [...cadeiras.node.children];
    cadeiras.sync([{ peer: null, motivoSentar: true }, { peer: null, motivoSentar: true }]);
    assert.equal(cadeiras.node.children[0], antes[0]);
    assert.equal(cadeiras.node.children[1], antes[1]);
  });
});

test('cadeiras chama aoSentar somente quando o lugar livre esta ligado', () => {
  comDocumento(() => {
    const sentados = [];
    const cadeiras = C.cadeiras({ aoSentar: (indice) => sentados.push(indice), aoLevantar() {} });
    cadeiras.sync([{ peer: null, motivoSentar: true }, { peer: null, motivoSentar: 'Mesa cheia' }]);
    cadeiras.node.children[0].children[0].dispatch('click');
    cadeiras.node.children[1].children[0].dispatch('click');
    assert.deepEqual(sentados, [0]);
    assert.equal(cadeiras.node.children[1].children[0].getAttribute('aria-disabled'), 'true');
  });
});

test('cadeiras sem motivo informado deixam o lugar ligado', () => {
  comDocumento(() => {
    const sentados = [];
    const cadeiras = C.cadeiras({ aoSentar: (indice) => sentados.push(indice) });
    cadeiras.sync([{ peer: null }]);
    const botao = cadeiras.node.children[0].children[0];
    assert.equal(botao.getAttribute('aria-disabled'), null);
    botao.dispatch('click');
    assert.deepEqual(sentados, [0]);
  });
});

test('cadeiras desligada mostra o motivo por aoRecusar em vez de ficar muda', () => {
  comDocumento(() => {
    const motivos = [];
    const cadeiras = C.cadeiras({ aoSentar() {}, aoRecusar: (motivo) => motivos.push(motivo) });
    cadeiras.sync([{ peer: null, motivoSentar: 'Mesa cheia' }]);
    cadeiras.node.children[0].children[0].dispatch('click');
    assert.deepEqual(motivos, ['Mesa cheia']);
  });
});

test('vazio monta glifo, titulo, texto e acao nessa ordem', () => {
  comDocumento(() => {
    const acao = new Elemento('button');
    const vazio = C.vazio({ icone: 'mais', titulo: 'Sem cartas', texto: 'Sente-se para jogar.', acao });
    assert.equal(vazio.children.length, 4);
    assert.equal(vazio.children[1].textContent, 'Sem cartas');
    assert.equal(vazio.children[2].textContent, 'Sente-se para jogar.');
    assert.equal(vazio.children[3].children[0], acao);
    const semAcao = C.vazio({ icone: 'mais', titulo: 'Sem cartas', texto: 'Sente-se para jogar.', acao: null });
    assert.equal(semAcao.children.length, 3);
  });
});

test('acoes deixa secundarias antes da principal com as classes esperadas', () => {
  comDocumento(() => {
    const secundarias = [new Elemento('button'), new Elemento('button')];
    const principal = new Elemento('button');
    const acoes = C.acoes({ principal, secundarias });
    assert.equal(acoes.children[0].children[0], secundarias[0]);
    assert.equal(acoes.children[0].children[1], secundarias[1]);
    assert.equal(acoes.children[2], principal);
    assert.match(secundarias[0].className, /mj-fantasma/);
    assert.match(secundarias[1].className, /mj-fantasma/);
    assert.match(principal.className, /mj-pri/);
  });
});
