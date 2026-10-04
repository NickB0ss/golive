'use strict';

/*
 * Desenha e adivinha -- jogo `secret` da Mesa (contrato,
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secoes 1, 7, 8 e 10),
 * por cima do Quadro: o desenho em si vai pelo MESMO canal do rabisco
 * (`annotate: true`, ver mesa-modules/quadro.js), so que so quem esta
 * desenhando pode rabiscar (`canAnnotateDraw`, abaixo). Este modulo cuida
 * do jogo -- vez, palavra secreta, palpites, pontos -- nunca do traco; a
 * troca de rodada e o sinal (o campo `round`) pro conteudo saber que o
 * Quadro por cima tem de nascer limpo de novo.
 *
 * Regras (decisao do Nicolas, 2026-09-26):
 *   - A vez de desenhar gira entre quem ENTROU na rodada (`join`, so vale
 *     na fase 'lobby'; a lista fica fixa quando o jogo comeca com `start`).
 *   - Quem desenha escolhe 1 de 3 palavras sorteadas (lista em portugues
 *     embutida, PALAVRAS abaixo); so ele ve as 3 e a escolhida, ate alguem
 *     acertar (ou a rodada acabar, quando ela vira publica em `lastRound`).
 *   - 15 s pra escolher (CHOOSE_MS); se estourar, vai a primeira opcao.
 *     Depois ha 80 s pra desenhar (DRAW_MS). Palpite (`guess`) so na janela; o
 *     servidor compara sem acento e sem caixa (`normalizar`).
 *   - Acertou: pontos pelo tempo que sobrou (100 a 10); quem desenha ganha
 *     10 por acerto. "Quase" (uma letra de diferenca -- `dentroDe1`) avisa
 *     SO quem chutou (`lastEvent.kind === 'close'`, filtrado na `view`).
 *   - A rodada acaba quando todo mundo acerta ou o tempo esgota
 *     (`timeout`); o jogo acaba depois que todos desenharem duas vezes
 *     (`drawCounts`).
 *
 * Estado inteiro (so no servidor): `players` (ordem = ordem da vez),
 * `phase` ('lobby'|'choosing'|'drawing'|'gameend'), `drawerIdx`, `round`
 * (sobe a cada rodada nova), `drawCounts`, `options` (as 3 palavras, so na
 * fase 'choosing'), `word` (so na 'drawing'), `guessedBy`, `seq`,
 * `lastEvent`, `deadline`, `startedAt`, `lastRound` (o que resta visivel de
 * uma rodada que ja acabou: a palavra e quem desenhou -- nao e mais
 * segredo de ninguem).
 */

(function (root) {
  const { codigo } = root.GoLive.i18n;
  const DRAW_MS = 80 * 1000;
  const CHOOSE_MS = 15 * 1000;
  const MAX_PLAYERS = 8;
  const MIN_SCORE = 10;
  const MAX_SCORE = 100;
  const DRAWER_BONUS = 10;
  const DRAWS_PER_PLAYER = 2;

  // Banco trilingue de coisas concretas e desenhaveis. O estado guarda so
  // os ids; as formas ficam locais para cada pessoa aceitar palpites.
  // i18n: dados
  const PALAVRAS = Object.freeze([
    ['cachorro', 'cachorro', 'dog', 'perro'], ['gato', 'gato', 'cat', 'gato'],
    ['elefante', 'elefante', 'elephant', 'elefante'], ['girafa', 'girafa', 'giraffe', 'jirafa'],
    ['leao', 'leão', 'lion', 'león'], ['tigre', 'tigre', 'tiger', 'tigre'], ['urso', 'urso', 'bear', 'oso'],
    ['coelho', 'coelho', 'rabbit', 'conejo'], ['cavalo', 'cavalo', 'horse', 'caballo'], ['vaca', 'vaca', 'cow', 'vaca'],
    ['porco', 'porco', 'pig', 'cerdo'], ['galinha', 'galinha', 'chicken', 'gallina'], ['pato', 'pato', 'duck', 'pato'],
    ['peixe', 'peixe', 'fish', 'pez'], ['tubarao', 'tubarão', 'shark', 'tiburón'], ['baleia', 'baleia', 'whale', 'ballena'],
    ['golfinho', 'golfinho', 'dolphin', 'delfín'], ['polvo', 'polvo', 'octopus', 'pulpo'],
    ['caranguejo', 'caranguejo', 'crab', 'cangrejo'], ['borboleta', 'borboleta', 'butterfly', 'mariposa'],
    ['abelha', 'abelha', 'bee', 'abeja'], ['aranha', 'aranha', 'spider', 'araña'], ['formiga', 'formiga', 'ant', 'hormiga'],
    ['coruja', 'coruja', 'owl', 'búho'], ['aguia', 'águia', 'eagle', 'águila'], ['pinguim', 'pinguim', 'penguin', 'pingüino'],
    ['macaco', 'macaco', 'monkey', 'mono'], ['zebra', 'zebra', 'zebra', 'cebra'],
    ['rinoceronte', 'rinoceronte', 'rhinoceros', 'rinoceronte'], ['hipopotamo', 'hipopótamo', 'hippopotamus', 'hipopótamo'],
    ['canguru', 'canguru', 'kangaroo', 'canguro'], ['camelo', 'camelo', 'camel', 'camello'],
    ['raposa', 'raposa', 'fox', 'zorro'], ['lobo', 'lobo', 'wolf', 'lobo'], ['cobra', 'cobra', 'snake', 'serpiente'],
    ['tartaruga', 'tartaruga', 'turtle', 'tortuga'], ['sapo', 'sapo', 'frog', 'rana'],
    ['jacare', 'jacaré', 'alligator', 'caimán'], ['morcego', 'morcego', 'bat', 'murciélago'],
    ['esquilo', 'esquilo', 'squirrel', 'ardilla'],
    ['cadeira', 'cadeira', 'chair', 'silla'], ['mesa', 'mesa', 'table', 'mesa'], ['cama', 'cama', 'bed', 'cama'],
    ['sofa', 'sofá', 'couch', 'sofá'], ['janela', 'janela', 'window', 'ventana'], ['porta', 'porta', 'door', 'puerta'],
    ['espelho', 'espelho', 'mirror', 'espejo'], ['relogio', 'relógio', 'clock', 'reloj'],
    ['telefone', 'telefone', 'telephone', 'teléfono'], ['computador', 'computador', 'computer', 'computadora'],
    ['televisao', 'televisão', 'television', 'televisión'], ['geladeira', 'geladeira', 'refrigerator', 'refrigerador'],
    ['fogao', 'fogão', 'stove', 'estufa'], ['panela', 'panela', 'pot', 'olla'], ['garfo', 'garfo', 'fork', 'tenedor'],
    ['faca', 'faca', 'knife', 'cuchillo'], ['colher', 'colher', 'spoon', 'cuchara'], ['copo', 'copo', 'glass', 'vaso'],
    ['prato', 'prato', 'plate', 'plato'], ['guarda_chuva', 'guarda-chuva', 'umbrella', 'paraguas'],
    ['escova', 'escova', 'brush', 'cepillo'], ['sabonete', 'sabonete', 'soap', 'jabón'], ['chave', 'chave', 'key', 'llave'],
    ['tesoura', 'tesoura', 'scissors', 'tijeras'], ['lapis', 'lápis', 'pencil', 'lápiz'], ['caneta', 'caneta', 'pen', 'bolígrafo'],
    ['livro', 'livro', 'book', 'libro'], ['mochila', 'mochila', 'backpack', 'mochila'], ['oculos', 'óculos', 'glasses', 'gafas'],
    ['chapeu', 'chapéu', 'hat', 'sombrero'],
    ['pizza', 'pizza', 'pizza', 'pizza'], ['hamburguer', 'hambúrguer', 'hamburger', 'hamburguesa'],
    ['sorvete', 'sorvete', 'ice cream', 'helado'], ['bolo', 'bolo', 'cake', 'pastel'], ['pao', 'pão', 'bread', 'pan'],
    ['queijo', 'queijo', 'cheese', 'queso'], ['maca', 'maçã', 'apple', 'manzana'], ['banana', 'banana', 'banana', 'banana'],
    ['laranja', 'laranja', 'orange', 'naranja'], ['morango', 'morango', 'strawberry', 'fresa'],
    ['uva', 'uva', 'grape', 'uva'], ['melancia', 'melancia', 'watermelon', 'sandía'],
    ['abacaxi', 'abacaxi', 'pineapple', 'piña'], ['cenoura', 'cenoura', 'carrot', 'zanahoria'],
    ['batata', 'batata', 'potato', 'papa'], ['tomate', 'tomate', 'tomato', 'tomate'], ['cebola', 'cebola', 'onion', 'cebolla'],
    ['chocolate', 'chocolate', 'chocolate', 'chocolate'], ['pipoca', 'pipoca', 'popcorn', 'palomitas'],
    ['cafe', 'café', 'coffee', 'café'],
    ['sol', 'sol', 'sun', 'sol'], ['lua', 'lua', 'moon', 'luna'], ['estrela', 'estrela', 'star', 'estrella'],
    ['nuvem', 'nuvem', 'cloud', 'nube'], ['chuva', 'chuva', 'rain', 'lluvia'], ['arco_iris', 'arco-íris', 'rainbow', 'arcoíris'],
    ['montanha', 'montanha', 'mountain', 'montaña'], ['praia', 'praia', 'beach', 'playa'],
    ['floresta', 'floresta', 'forest', 'bosque'], ['rio', 'rio', 'river', 'río'],
    ['cachoeira', 'cachoeira', 'waterfall', 'cascada'], ['vulcao', 'vulcão', 'volcano', 'volcán'],
    ['deserto', 'deserto', 'desert', 'desierto'], ['ilha', 'ilha', 'island', 'isla'], ['castelo', 'castelo', 'castle', 'castillo'],
    ['ponte', 'ponte', 'bridge', 'puente'], ['foguete', 'foguete', 'rocket', 'cohete'], ['aviao', 'avião', 'airplane', 'avión'],
    ['barco', 'barco', 'boat', 'barco'], ['farol', 'farol', 'lighthouse', 'faro'],
    ['medico', 'médico', 'doctor', 'médico'], ['professor', 'professor', 'teacher', 'profesor'],
    ['bombeiro', 'bombeiro', 'firefighter', 'bombero'], ['policial', 'policial', 'police officer', 'policía'],
    ['cozinheiro', 'cozinheiro', 'cook', 'cocinero'], ['pintor', 'pintor', 'painter', 'pintor'],
    ['musico', 'músico', 'musician', 'músico'], ['palhaco', 'palhaço', 'clown', 'payaso'],
    ['astronauta', 'astronauta', 'astronaut', 'astronauta'], ['pirata', 'pirata', 'pirate', 'pirata'],
    ['bailarina', 'bailarina', 'ballerina', 'bailarina'], ['magico', 'mágico', 'magician', 'mago'],
    ['fazendeiro', 'fazendeiro', 'farmer', 'granjero'], ['cientista', 'cientista', 'scientist', 'científico'],
    ['dentista', 'dentista', 'dentist', 'dentista'],
    ['carro', 'carro', 'car', 'coche'], ['onibus', 'ônibus', 'bus', 'autobús'],
    ['bicicleta', 'bicicleta', 'bicycle', 'bicicleta'], ['moto', 'moto', 'motorcycle', 'motocicleta'],
    ['trem', 'trem', 'train', 'tren'], ['caminhao', 'caminhão', 'truck', 'camión'],
    ['helicoptero', 'helicóptero', 'helicopter', 'helicóptero'], ['submarino', 'submarino', 'submarine', 'submarino'],
    ['patinete', 'patinete', 'scooter', 'patinete'], ['trator', 'trator', 'tractor', 'tractor'],
    ['camiseta', 'camiseta', 't-shirt', 'camiseta'], ['calca', 'calça', 'pants', 'pantalones'],
    ['sapato', 'sapato', 'shoe', 'zapato'], ['meia', 'meia', 'sock', 'calcetín'], ['bone', 'boné', 'cap', 'gorra'],
    ['luva', 'luva', 'glove', 'guante'], ['cachecol', 'cachecol', 'scarf', 'bufanda'],
    ['vestido', 'vestido', 'dress', 'vestido'], ['casaco', 'casaco', 'coat', 'abrigo'], ['gravata', 'gravata', 'tie', 'corbata'],
    ['futebol', 'futebol', 'soccer', 'fútbol'], ['basquete', 'basquete', 'basketball', 'baloncesto'],
    ['violao', 'violão', 'acoustic guitar', 'guitarra acústica'], ['piano', 'piano', 'piano', 'piano'],
    ['bateria', 'bateria', 'drums', 'batería'], ['tenis', 'tênis', 'tennis', 'tenis'],
    ['natacao', 'natação', 'swimming', 'natación'], ['volei', 'vôlei', 'volleyball', 'voleibol'],
    ['bola', 'bola', 'ball', 'pelota'], ['skate', 'skate', 'skateboard', 'patineta'],
    ['guitarra', 'guitarra', 'guitar', 'guitarra'], ['flauta', 'flauta', 'flute', 'flauta'],
    ['trombeta', 'trombeta', 'trumpet', 'trompeta'], ['xadrez', 'xadrez', 'chess', 'ajedrez'],
    ['boliche', 'boliche', 'bowling', 'bolos'], ['casa', 'casa', 'house', 'casa'],
  ].map(([id, pt, en, es]) => Object.freeze({ id, pt: [pt], en: [en], es: [es] })));
  // i18n: fim dos dados
  const POR_ID = new Map(PALAVRAS.map((palavra) => [palavra.id, palavra]));

  // ---------------------------------------------------------------------
  // Puras: texto (normalizacao, distancia de 1 letra) e sorte
  // ---------------------------------------------------------------------

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** Sem acento, sem caixa, espacos colapsados -- o que o servidor compara. */
  function normalizar(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function formasDe(id) {
    const palavra = POR_ID.get(id);
    return palavra ? ['pt', 'en', 'es'].flatMap((lingua) => palavra[lingua].map(normalizar)) : [];
  }

  function palavraEm(id, idioma) {
    const palavra = POR_ID.get(id);
    const lingua = idioma === 'pt-BR' ? 'pt' : idioma;
    return palavra && palavra[lingua] ? palavra[lingua][0] : '';
  }

  function acertou(id, palpite) {
    const normalizado = normalizar(palpite);
    return Boolean(normalizado) && formasDe(id).includes(normalizado);
  }

  function quase(id, palpite) {
    const normalizado = normalizar(palpite);
    return Boolean(normalizado) && formasDe(id).some((forma) => dentroDe1(normalizado, forma));
  }

  /** Distancia de edicao <= 1 (uma letra a mais, a menos, ou trocada). */
  function dentroDe1(a, b) {
    if (a === b) return true;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    if (la === lb) {
      let diffs = 0;
      for (let i = 0; i < la; i++) {
        if (a[i] !== b[i]) {
          diffs += 1;
          if (diffs > 1) return false;
        }
      }
      return diffs === 1;
    }
    const curta = la < lb ? a : b;
    const longa = la < lb ? b : a;
    let i = 0;
    let j = 0;
    let pulou = false;
    while (i < curta.length && j < longa.length) {
      if (curta[i] === longa[j]) {
        i += 1;
        j += 1;
        continue;
      }
      if (pulou) return false;
      pulou = true;
      j += 1;
    }
    return true;
  }

  function rnd(random) {
    const r = typeof random === 'function' ? Number(random()) : Math.random();
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0;
  }

  /** 3 palavras distintas, sorteadas (Fisher-Yates parcial). Com um
   * `random` ruim (sempre 0), ainda sai 3 palavras distintas (as 3
   * primeiras da lista) -- nunca undefined. */
  function sorteiaOpcoes(random) {
    const pool = PALAVRAS.slice();
    const out = [];
    for (let k = 0; k < 3 && pool.length; k++) {
      const i = Math.floor(rnd(random) * pool.length);
      out.push(pool.splice(i, 1)[0].id);
    }
    return out;
  }

  function pontosPeloTempo(state, at) {
    const inicio = Number.isFinite(state.startedAt) ? state.startedAt : at;
    const decorrido = Math.max(0, at - inicio);
    const frac = Math.min(1, decorrido / DRAW_MS);
    return Math.max(MIN_SCORE, Math.round(MAX_SCORE - frac * (MAX_SCORE - MIN_SCORE)));
  }

  function withScore(players, id, delta) {
    return players.map((p) => (p.id === id ? { ...p, score: p.score + delta } : p));
  }

  function drawerIdOf(state) {
    return state.phase !== 'lobby' && state.players[state.drawerIdx] ? state.players[state.drawerIdx].id : null;
  }

  // ---------------------------------------------------------------------
  // Modulo
  // ---------------------------------------------------------------------

  function init() {
    return {
      players: [],
      phase: 'lobby',
      drawerIdx: -1,
      round: 0,
      drawCounts: {},
      options: null,
      word: null,
      guessedBy: [],
      seq: 0,
      lastEvent: null,
      deadline: null,
      startedAt: null,
      lastRound: null,
    };
  }

  function validate(state, action, ctx) {
    if (!isObj(action) || typeof action.kind !== 'string') return codigo('mesa.desenha.acaoInvalida');
    const from = ctx && ctx.from;
    if (!from) return codigo('mesa.desenha.quemMandou');
    switch (action.kind) {
      case 'join':
        if (state.phase !== 'lobby') return codigo('mesa.desenha.jogoComecou');
        if (state.players.some((p) => p.id === from)) return codigo('mesa.desenha.jaEntrou');
        if (state.players.length >= MAX_PLAYERS) return codigo('mesa.desenha.rodadaCheia');
        return true;
      case 'leave':
        if (state.phase !== 'lobby') return codigo('mesa.desenha.jogoComecou');
        if (!state.players.some((p) => p.id === from)) return codigo('mesa.desenha.naoEntrou');
        return true;
      case 'start':
        if (state.phase !== 'lobby') return codigo('mesa.desenha.jogoComecou');
        if (state.players.length < 2) return codigo('mesa.desenha.precisaDePessoas');
        return true;
      case 'choose': {
        if (state.phase !== 'choosing') return codigo('mesa.desenha.naoEscolheAgora');
        if (from !== drawerIdOf(state)) return codigo('mesa.desenha.soDesenhistaEscolhe');
        if (action.index !== 0 && action.index !== 1 && action.index !== 2) return codigo('mesa.desenha.palavraInvalida');
        return true;
      }
      case 'guess': {
        if (state.phase !== 'drawing') return codigo('mesa.desenha.ninguemDesenhando');
        if (!state.players.some((p) => p.id === from)) return codigo('mesa.desenha.naoEntrou');
        if (from === drawerIdOf(state)) return codigo('mesa.desenha.desenhistaNaoChuta');
        if (state.guessedBy.includes(from)) return codigo('mesa.desenha.jaAcertou');
        if (typeof action.text !== 'string' || !action.text.trim()) return codigo('mesa.desenha.escrevaPalpite');
        return true;
      }
      case 'timeout':
        return state.phase === 'choosing' || state.phase === 'drawing' ? true : codigo('mesa.desenha.nadaCorrendo');
      default:
        return codigo('mesa.desenha.acaoDesconhecida');
    }
  }

  /** So no servidor: sorte (as 3 palavras da proxima escolha) e hora vao
   * DENTRO da acao. `guess`/`timeout` sempre levam `nextOptions` -- mais
   * simples (nao duplica no `prepare` a logica de "esta rodada vai
   * acabar?") do que decidir aqui se ESTE palpite fecha a rodada. */
  function prepare(state, action, ctx) {
    const random = ctx && ctx.random;
    const at = ctx && Number.isFinite(ctx.now) ? ctx.now : 0;
    switch (action.kind) {
      case 'join': {
        const peers = (ctx && ctx.peers) || [];
        const achou = peers.find((p) => p && p.id === (ctx && ctx.from));
        const nome = achou && typeof achou.name === 'string' && achou.name.trim()
          ? achou.name : codigo('mesa.desenha.alguem');
        return { kind: 'join', name: nome };
      }
      case 'start':
        return { kind: 'start', options: sorteiaOpcoes(random), at };
      case 'choose':
        return { kind: 'choose', index: action.index, at };
      case 'guess':
        return { kind: 'guess', text: typeof action.text === 'string' ? action.text.slice(0, 40) : '', at, nextOptions: sorteiaOpcoes(random) };
      case 'timeout':
        return { kind: 'timeout', at, nextOptions: sorteiaOpcoes(random) };
      default:
        return { kind: action.kind };
    }
  }

  /** Fecha a rodada corrente (todos acertaram, o tempo esgotou, ou o
   * desenhista saiu no meio): marca `drawCounts`, revela em `lastRound`
   * (a palavra deixa de ser segredo -- a rodada ja acabou), e decide se o
   * jogo acabou (todo mundo ja desenhou DRAWS_PER_PLAYER vezes) ou passa a
   * vez pra quem vem depois. `nextOptions` vem do `prepare` (sorteado com
   * `ctx.random`); sem ele (dropPeer nao tem sorte nenhuma pra usar), cai
   * nas 3 primeiras palavras da lista -- deterministico, nunca undefined. */
  function endRound(state, nextOptions, at) {
    const id = drawerIdOf(state);
    const drawCounts = id ? { ...state.drawCounts, [id]: (state.drawCounts[id] || 0) + 1 } : { ...state.drawCounts };
    const lastRound = state.word ? { round: state.round, word: state.word, drawerId: id } : state.lastRound;
    const acabouPraTodos = state.players.length > 0
      && state.players.every((p) => (drawCounts[p.id] || 0) >= DRAWS_PER_PLAYER);
    if (acabouPraTodos || state.players.length < 2) {
      return {
        ...state, phase: 'gameend', word: null, options: null, guessedBy: [], deadline: null,
        drawCounts, lastRound, drawerIdx: -1,
      };
    }
    const proximo = (state.drawerIdx + 1) % state.players.length;
    const opcoes = Array.isArray(nextOptions) && nextOptions.length === 3
      ? nextOptions : PALAVRAS.slice(0, 3).map((palavra) => palavra.id);
    return {
      ...state, phase: 'choosing', drawerIdx: proximo, word: null, options: opcoes,
      guessedBy: [], deadline: at + CHOOSE_MS, drawCounts, lastRound, round: state.round + 1,
    };
  }

  function startDrawing(state, word, at, by) {
    return {
      ...state, phase: 'drawing', word, options: null, guessedBy: [],
      deadline: at + DRAW_MS, startedAt: at, seq: state.seq + 1,
      lastEvent: { seq: state.seq + 1, kind: 'started', by },
    };
  }

  function reduce(state, action, ctx) {
    if (!isObj(action)) return state;
    const from = ctx && ctx.from;
    switch (action.kind) {
      case 'join': {
        if (state.phase !== 'lobby' || state.players.some((p) => p.id === from)) return state;
        const players = state.players.concat([{ id: from, name: action.name || codigo('mesa.desenha.alguem'), score: 0 }]);
        return { ...state, players };
      }
      case 'leave': {
        if (state.phase !== 'lobby') return state;
        const players = state.players.filter((p) => p.id !== from);
        if (players.length === state.players.length) return state;
        return { ...state, players };
      }
      case 'start': {
        if (state.phase !== 'lobby' || state.players.length < 2) return state;
        const opcoes = Array.isArray(action.options) && action.options.length === 3
          ? action.options : PALAVRAS.slice(0, 3).map((palavra) => palavra.id);
        const at = Number.isFinite(action.at) ? action.at : 0;
        return {
          ...state, phase: 'choosing', drawerIdx: 0, options: opcoes, drawCounts: {}, round: 1,
          guessedBy: [], word: null, deadline: at + CHOOSE_MS, lastEvent: null, lastRound: null,
        };
      }
      case 'choose': {
        if (state.phase !== 'choosing' || from !== drawerIdOf(state)) return state;
        const escolhida = Array.isArray(state.options) ? state.options[action.index] : null;
        if (typeof escolhida !== 'string') return state;
        const at = Number.isFinite(action.at) ? action.at : 0;
        return startDrawing(state, escolhida, at, from);
      }
      case 'guess': {
        if (state.phase !== 'drawing') return state;
        const dono = drawerIdOf(state);
        if (!dono || from === dono || state.guessedBy.includes(from)) return state;
        const palpite = normalizar(action.text);
        if (!palpite || !POR_ID.has(state.word)) return state;
        const seq = state.seq + 1;
        const at = Number.isFinite(action.at) ? action.at : 0;
        if (acertou(state.word, palpite)) {
          const pts = pontosPeloTempo(state, at);
          let players = withScore(state.players, from, pts);
          players = withScore(players, dono, DRAWER_BONUS);
          const guessedBy = state.guessedBy.concat([from]);
          let next = { ...state, players, guessedBy, seq, lastEvent: { seq, kind: 'correct', by: from } };
          if (guessedBy.length >= state.players.length - 1) next = endRound(next, action.nextOptions, at);
          return next;
        }
        if (quase(state.word, palpite)) {
          return { ...state, seq, lastEvent: { seq, kind: 'close', by: from } };
        }
        return { ...state, seq, lastEvent: { seq, kind: 'wrong', by: from, text: String(action.text).slice(0, 40) } };
      }
      case 'timeout':
        if (state.phase === 'choosing') {
          const escolhida = Array.isArray(state.options) ? state.options[0] : null;
          if (typeof escolhida !== 'string') return state;
          const at = Number.isFinite(action.at) ? action.at : 0;
          // A escolha automatica usa a primeira opcao, sem expor a palavra aos outros.
          return startDrawing(state, escolhida, at, drawerIdOf(state));
        }
        if (state.phase !== 'drawing') return state;
        return endRound(state, action.nextOptions, Number.isFinite(action.at) ? action.at : 0);
      default:
        return state;
    }
  }

  /** Quem sai da sala (contrato, secao 8): tira das cadeiras/jogadores. Na
   * fase lobby e so tirar da lista. No meio do jogo, se quem saiu era o
   * desenhista, a rodada acaba na hora (ninguem desenhando); sem gente
   * suficiente pra continuar, o jogo volta pro lobby (os pontos ficam). */
  function dropPeer(state, peerId) {
    if (!state.players.some((p) => p.id === peerId)) return state;
    const eraDesenhista = state.phase !== 'lobby' && drawerIdOf(state) === peerId;
    const idx = state.players.findIndex((p) => p.id === peerId);
    const players = state.players.filter((p) => p.id !== peerId);
    const drawCounts = { ...state.drawCounts };
    delete drawCounts[peerId];
    const guessedBy = state.guessedBy.filter((id) => id !== peerId);
    if (state.phase === 'lobby') return { ...state, players, drawCounts, guessedBy };
    if (players.length < 2) {
      return {
        ...state, players, drawCounts, guessedBy, phase: 'lobby', drawerIdx: -1,
        word: null, options: null, deadline: null, lastEvent: null,
      };
    }
    let drawerIdx = state.drawerIdx;
    if (idx < drawerIdx) drawerIdx -= 1;
    else if (idx === drawerIdx) drawerIdx %= players.length;
    if (eraDesenhista) return endRound({ ...state, players, drawCounts, guessedBy, drawerIdx }, null, 0);
    const next = { ...state, players, drawCounts, guessedBy, drawerIdx };
    if (next.phase === 'drawing' && next.guessedBy.length >= next.players.length - 1) return endRound(next, null, 0);
    return next;
  }

  function timeoutAt(state) {
    return (state.phase === 'choosing' || state.phase === 'drawing') && Number.isFinite(state.deadline)
      ? state.deadline
      : null;
  }

  /** O que `peerId` (null = so assiste) pode ver (contrato, secao 8): a
   * palavra so pra quem desenha ou ja acertou; as 3 opcoes so pro
   * desenhista; o "quase" so pra quem chutou (o resto do `lastEvent`,
   * 'correct'/'wrong'/'started', e seguro pra todo mundo -- nunca leva a
   * palavra). `wordLens` da o tamanho da primeira forma em cada idioma pra
   * quem ainda nao acertou, pista comum do genero, sem entregar letra nenhuma. */
  function view(state, peerId, ctx) {
    const roomIds = ctx && Array.isArray(ctx.peers) ? new Set(ctx.peers.map((p) => p.id)) : null;
    const players = state.players.map((p) => ({
      id: p.id, name: p.name, score: p.score, draws: state.drawCounts[p.id] || 0,
      naSala: roomIds ? roomIds.has(p.id) : true,
    }));
    const souEu = typeof peerId === 'string' ? peerId : null;
    const dono = drawerIdOf(state);
    const souDesenhista = souEu !== null && souEu === dono;
    const jaAcertei = souEu !== null && state.guessedBy.includes(souEu);
    const revelaPalavra = state.phase === 'drawing' && (souDesenhista || jaAcertei);
    const event = state.lastEvent && (state.lastEvent.kind !== 'close' || state.lastEvent.by === souEu)
      ? state.lastEvent : null;
    const pode = (action) => (souEu ? validate(state, action, { from: souEu, isLeader: false }) === true : false);
    return {
      phase: state.phase,
      players,
      drawerId: dono,
      round: state.round,
      deadline: state.deadline,
      guessedCount: state.guessedBy.length,
      iGuessed: jaAcertei,
      lastRound: state.lastRound,
      word: revelaPalavra ? state.word : null,
      wordLens: state.phase === 'drawing' ? {
        pt: palavraEm(state.word, 'pt-BR').length,
        en: palavraEm(state.word, 'en').length,
        es: palavraEm(state.word, 'es').length,
      } : null,
      options: state.phase === 'choosing' && souDesenhista ? state.options : null,
      event,
      me: {
        isDrawer: souDesenhista,
        joined: souEu !== null && state.players.some((p) => p.id === souEu),
        can: {
          join: pode({ kind: 'join' }),
          leave: pode({ kind: 'leave' }),
          start: pode({ kind: 'start' }),
          choose: [0, 1, 2].map((i) => pode({ kind: 'choose', index: i })),
          guess: pode({ kind: 'guess', text: 'x' }),
        },
      },
    };
  }

  /** Migracao (contrato, secao 8): o retrato vai pra TODOS, entao a rodada
   * em andamento e cancelada -- a palavra fica no servidor que caiu. Os
   * ids de pessoa mudam no servidor novo, entao os participantes tambem
   * voltam ao lobby para entrar de novo, sem jogadores-fantasma. */
  function migrate() {
    return init();
  }

  /** So o desenhista rabisca, e so durante a fase de desenho (contrato,
   * secao 10, "Desenha e adivinha"). Sem rodada correndo, ninguem
   * desenha -- inclusive pra nao deixar tracos orfaos entre uma escolha e
   * a proxima. */
  function canAnnotateDraw(state, from) {
    return state.phase === 'drawing' && drawerIdOf(state) === from;
  }

  function nomeDe(state, id) {
    const p = state.players.find((x) => x.id === id);
    return p ? p.name : codigo('mesa.desenha.alguem');
  }

  function summary(state) {
    if (state.phase === 'lobby') return state.players.length
      ? { chave: 'mesa.desenha.esperandoComecar', valores: { n: state.players.length } }
      : { chave: 'mesa.desenha.esperandoEntrar', valores: {} };
    if (state.phase === 'gameend') return { chave: 'mesa.desenha.fimDeJogo', valores: {} };
    if (state.phase === 'choosing') return { chave: 'mesa.desenha.escolhendo', valores: { nome: nomeDe(state, drawerIdOf(state)) } };
    return { chave: 'mesa.desenha.desenhando', valores: { nome: nomeDe(state, drawerIdOf(state)) } };
  }

  const mod = {
    type: 'desenha',
    title: 'mesa.titulo.desenha',
    group: 'jogos',
    size: { w: 720, h: 560, minW: 460, minH: 400, aspect: null },
    maxStateBytes: 8192,
    secret: true,
    annotate: true,
    init,
    validate,
    prepare,
    reduce,
    view,
    migrate,
    timeoutAt,
    dropPeer,
    canAnnotateDraw,
    summary,
    // Para os testes e a janela.
    DRAW_MS,
    CHOOSE_MS,
    MAX_PLAYERS,
    DRAWS_PER_PLAYER,
    PALAVRAS,
    formasDe,
    palavraEm,
    acertou,
    quase,
    normalizar,
    dentroDe1,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.desenha = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);
