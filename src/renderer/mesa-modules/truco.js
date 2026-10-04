'use strict';

/*
 * Truco paulista, com baralho limpo e manilha pela vira.
 * Escolhas clássicas onde o contrato não detalha: o primeiro carteador é
 * aleatório e depois gira entre lugares ocupados; abre quem está à esquerda
 * dele; empate mantém a saída; as três rodadas empatadas não pontuam; e a
 * saída de alguém durante uma mão equivale a correr para a dupla adversária.
 */
(function registrarTruco(root) {
  const { codigo } = (root.GoLive && root.GoLive.i18n)
    || (typeof module !== 'undefined' ? require('../i18n') : { codigo: (chave) => chave });
  const moduloBaralho = (root.GoLive && root.GoLive.mesaBaralho)
    || (typeof module !== 'undefined' && typeof module.require === 'function'
      ? module.require('./baralho')
      : null);
  const ORDEM = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
  const NAIPES = ['d', 's', 'h', 'c'];
  const VALORES = [1, 3, 6, 9, 12];
  const TEMPO_DA_VEZ = 30000;

  function objeto(valor) {
    return valor && typeof valor === 'object' ? valor : {};
  }

  function comTipo(acao) {
    const entrada = objeto(acao);
    return Object.assign({}, entrada, { type: entrada.type || entrada.kind });
  }

  function origem(acao) {
    return String(objeto(acao).from || '');
  }

  function idDaAcao(acao, contexto) {
    return origem(acao) || String(objeto(contexto).from || '');
  }

  function agoraDoServidor(contexto) {
    const agora = objeto(contexto).now;
    return typeof agora === 'number' && Number.isFinite(agora) ? agora : 0;
  }

  function listaDePessoas(contexto) {
    return Array.isArray(objeto(contexto).peers) ? contexto.peers : [];
  }

  function pessoaPorId(contexto, id) {
    return listaDePessoas(contexto).find((pessoa) => pessoa && pessoa.id === id) || null;
  }

  function lugarDaPessoa(estado, id) {
    return objeto(estado).seats.indexOf(id);
  }

  function pessoaNoLugar(estado, contexto, lugar) {
    const id = objeto(estado).seats[lugar];
    return id && pessoaPorId(contexto, id) ? id : null;
  }

  function lugaresAtivos(estado, contexto) {
    return objeto(estado).seats
      .map((id, lugar) => (id && pessoaPorId(contexto, id) ? lugar : -1))
      .filter((lugar) => lugar >= 0);
  }

  function proximoLugar(lugares, lugar) {
    const indice = lugares.indexOf(lugar);
    return lugares[(indice + 1) % lugares.length];
  }

  function duplaDoLugar(lugares, lugar) {
    return lugares.length === 4 ? lugar % 2 : lugares.indexOf(lugar);
  }

  function proximaManilha(carta) {
    const indice = ORDEM.indexOf(String(carta || '').charAt(0));
    return ORDEM[(indice + 1 + ORDEM.length) % ORDEM.length];
  }

  function forca(carta, manilha) {
    const texto = String(carta || '');
    const valor = texto.charAt(0);
    const naipe = texto.charAt(1);
    if (valor === manilha) return 10 + NAIPES.indexOf(naipe);
    return ORDEM.indexOf(valor);
  }

  function vencedorDasRodadas(rodadas) {
    if (rodadas.length < 2) return undefined;
    const primeira = valorDaRodada(rodadas[0]);
    const segunda = valorDaRodada(rodadas[1]);

    if (primeira === null && segunda !== null) return segunda;
    if (primeira !== null && (segunda === primeira || segunda === null)) return primeira;
    if (rodadas.length < 3) return undefined;

    const terceira = valorDaRodada(rodadas[2]);
    if (terceira !== null) return terceira;
    return primeira !== null ? primeira : segunda;
  }

  function valorDaRodada(rodada) {
    return rodada && typeof rodada === 'object' ? rodada.winner : rodada;
  }

  function estadoNovo() {
    return {
      version: 1,
      seats: [null, null, null, null],
      names: [null, null, null, null],
      scores: [0, 0],
      dealer: -1,
      phase: 'waiting',
      hand: null,
      result: null
    };
  }

  function nomeDaPessoa(contexto, id) {
    const pessoa = pessoaPorId(contexto, id);
    return pessoa ? String(pessoa.name || pessoa.id).slice(0, 32) : null;
  }

  function baralhoDoTruco() {
    return moduloBaralho.newDeck().filter((carta) => !['8', '9', 'T'].includes(carta.charAt(0)));
  }

  function duplaDasPessoas(lugares) {
    return lugares.map((lugar, indice) => [lugar, duplaDoLugar(lugares, lugar, indice)]);
  }

  function carteadorSeguinte(estado, lugares, aleatorio) {
    if (!lugares.includes(estado.dealer)) {
      return lugares[Math.floor(aleatorio() * lugares.length)];
    }
    return proximoLugar(lugares, estado.dealer);
  }

  function distribuirCartas(baralho, lugares, carteador) {
    const cartas = [[], [], [], []];
    let cursor = 0;
    for (let rodada = 0; rodada < 3; rodada += 1) {
      lugares.forEach((lugar) => {
        cartas[lugar].push(baralho[cursor]);
        cursor += 1;
      });
    }
    const vira = baralho[cursor];
    return { cards: cartas, vira, deck: baralho.slice(cursor + 1), turn: proximoLugar(lugares, carteador) };
  }

  function podeComecar(estado, contexto) {
    const quantidade = lugaresAtivos(estado, contexto).length;
    return quantidade === 2 || quantidade === 4;
  }

  function maoValida(estado) {
    return Boolean(estado.hand && estado.phase !== 'waiting' && estado.phase !== 'finished');
  }

  function criarMao(estado, acao) {
    const lugares = acao.seats || estado.seats
      .map((id, lugar) => id ? lugar : -1)
      .filter((lugar) => lugar >= 0);
    const duplaDeOnze = estado.scores.findIndex((pontos) => pontos === 11);
    const ferro = estado.scores[0] === 11 && estado.scores[1] === 11;
    const onze = ferro ? null : duplaDeOnze;
    const valor = ferro || onze !== -1 && onze !== null ? 3 : 1;

    return {
      cards: acao.cards.map((cartas) => cartas.slice()),
      deck: Array.isArray(acao.deck) ? acao.deck.slice() : [],
      vira: acao.vira,
      manilha: proximaManilha(acao.vira),
      seats: lugares.slice(),
      teams: duplaDasPessoas(lugares),
      dealer: acao.dealer,
      lead: acao.turn === undefined ? proximoLugar(lugares, acao.dealer) : acao.turn,
      turn: acao.turn === undefined ? proximoLugar(lugares, acao.dealer) : acao.turn,
      table: [],
      rounds: [],
      value: valor,
      pending: null,
      deadline: acao.at + TEMPO_DA_VEZ,
      iron: ferro,
      eleven: onze === -1 ? null : onze,
      noCall: ferro || onze !== -1,
      lastCaller: null
    };
  }

  function duplaDaMao(mao, lugar) {
    const dupla = mao.teams.find((entrada) => entrada[0] === lugar);
    return dupla ? dupla[1] : -1;
  }

  function proximoValor(valor) {
    return VALORES[VALORES.indexOf(valor) + 1];
  }

  function preparar(estado, acao, contexto) {
    const entrada = comTipo(acao);
    const agora = agoraDoServidor(contexto);
    if (entrada.type === 'sit') {
      return {
        type: 'sit',
        from: idDaAcao(entrada, contexto),
        seat: entrada.seat,
        name: nomeDaPessoa(contexto, idDaAcao(entrada, contexto))
      };
    }
    if (entrada.type !== 'deal') {
      return Object.assign({}, entrada, {
        from: idDaAcao(entrada, contexto),
        at: agora
      });
    }

    const lugares = lugaresAtivos(estado, contexto);
    const aleatorio = typeof contexto.random === 'function' ? contexto.random : Math.random;
    const baralho = moduloBaralho.shuffle(baralhoDoTruco(), aleatorio);
    const carteador = carteadorSeguinte(estado, lugares, aleatorio);
    const distribuicao = distribuirCartas(baralho, lugares, carteador);
    return Object.assign({ type: 'deal', seats: lugares, dealer: carteador }, distribuicao, {
      at: agora
    });
  }

  function validar(estado, acao, contexto) {
    const entrada = comTipo(acao);
    const id = idDaAcao(entrada, contexto);
    const lugar = lugarDaPessoa(estado, id);
    const mao = estado.hand;

    if (entrada.type === 'sit') {
      if (!Number.isInteger(entrada.seat) || entrada.seat < 0 || entrada.seat > 3) {
        return codigo('mesa.jogo.lugarInvalido');
      }
      if (lugar >= 0) return codigo('mesa.jogo.jaEstaSentado');
      if (pessoaNoLugar(estado, contexto, entrada.seat)) return codigo('mesa.jogo.lugarOcupado');
      return true;
    }
    if (entrada.type === 'stand') return lugar >= 0 ? true : codigo('mesa.truco.naoEstaSentado');
    if (entrada.type === 'reset') return lugar >= 0 || objeto(contexto).isLeader === true
        ? true
        : codigo('mesa.truco.soQuemEstaNaMesaReinicia');
    if (entrada.type === 'deal') {
      if (lugar < 0 || !podeComecar(estado, contexto) || maoValida(estado)) return codigo('mesa.truco.naoPodeDarAgora');
      return true;
    }
    if (entrada.type === 'timeout') return mao && mao.deadline ? true : codigo('mesa.truco.semDecisaoPendente');
    if (!mao) return codigo('mesa.truco.semMao');

    if (entrada.type === 'eleven') {
      if (estado.phase !== 'eleven' || duplaDaMao(mao, lugar) !== mao.eleven) {
        return codigo('mesa.truco.naoESuaDecisao');
      }
      return ['play', 'run'].includes(entrada.choice) ? true : codigo('mesa.truco.decisaoInvalida');
    }
    if (entrada.type === 'play') {
      if (mao.pending || estado.phase !== 'play' || mao.turn !== lugar) return codigo('mesa.jogo.naoESuaVez');
      if (!Number.isInteger(entrada.index) || !mao.cards[lugar][entrada.index]) {
        return codigo('mesa.jogo.cartaInvalida');
      }
      if (entrada.covered && mao.rounds.length === 0) return codigo('mesa.truco.encobertaSegunda');
      return true;
    }
    if (entrada.type === 'call') {
      if (lugar < 0) return codigo('mesa.truco.cantoIndisponivel');
      if (estado.phase !== 'play') return codigo('mesa.truco.maoNaoJogando');
      if (mao.pending || mao.noCall || mao.value >= 12) return codigo('mesa.truco.cantoIndisponivel');
      if (duplaDaMao(mao, lugar) === mao.lastCaller) return codigo('mesa.truco.cantoIndisponivel');
      return true;
    }
    if (entrada.type === 'answer') {
      if (!mao.pending || duplaDaMao(mao, lugar) !== mao.pending.toTeam) return codigo('mesa.truco.naoESuaResposta');
      if (!['accept', 'run', 'raise'].includes(entrada.answer)) return codigo('mesa.truco.respostaInvalida');
      if (entrada.answer === 'raise' && mao.pending.amount >= 12) return codigo('mesa.truco.naoPassaDeDoze');
      return true;
    }
    return codigo('mesa.jogo.acaoDesconhecida');
  }

  function encerrar(estado, dupla, pontos) {
    const placar = estado.scores.slice();
    if (dupla !== null) placar[dupla] += pontos;
    return Object.assign({}, estado, {
      scores: placar,
      phase: placar.some((valor) => valor >= 12) ? 'finished' : 'waiting',
      hand: null,
      result: { winner: dupla, points: pontos }
    });
  }

  function resolverMesa(estado, mao, agora) {
    const maior = Math.max(...mao.table.map((jogada) => jogada.covered ? -1 : forca(jogada.card, mao.manilha)));
    const melhores = mao.table.filter((jogada) => !jogada.covered && forca(jogada.card, mao.manilha) === maior);
    const duplas = new Set(melhores.map((jogada) => duplaDaMao(mao, jogada.seat)));
    const vencedora = duplas.size === 1 ? [...duplas][0] : null;
    const cartaVencedora = vencedora === null
      ? null
      : melhores.find((jogada) => duplaDaMao(mao, jogada.seat) === vencedora);
    const lider = cartaVencedora ? cartaVencedora.seat : mao.lead;
    const rodadas = mao.rounds.concat({ winner: vencedora, lead: lider });
    const ganhadora = vencedorDasRodadas(rodadas);
    if (ganhadora !== undefined) return encerrar(estado, ganhadora, mao.value);

    const proxima = Object.assign({}, mao, {
      table: [],
      rounds: rodadas,
      lead: lider,
      turn: lider,
      deadline: agora + TEMPO_DA_VEZ
    });
    return Object.assign({}, estado, { hand: proxima });
  }

  function jogar(estado, acao) {
    const mao = estado.hand;
    const cartas = mao.cards.map((maozinha) => maozinha.slice());
    const carta = cartas[acao.seat].splice(acao.index, 1)[0];
    const mesa = mao.table.concat({ seat: acao.seat, card: carta, covered: Boolean(acao.covered) });
    const proxima = Object.assign({}, mao, {
      cards: cartas,
      table: mesa,
      turn: proximoLugar(mao.seats, acao.seat),
      deadline: acao.at + TEMPO_DA_VEZ
    });
    const comMao = Object.assign({}, estado, { hand: proxima });
    return mesa.length === mao.seats.length ? resolverMesa(comMao, proxima, acao.at) : comMao;
  }

  function reduzir(estado, acao, contexto) {
    const entrada = comTipo(acao);
    if (entrada.type === 'sit') {
      const seats = estado.seats.slice();
      const names = estado.names.slice();
      seats[entrada.seat] = origem(entrada);
      names[entrada.seat] = entrada.name || nomeDaPessoa(contexto, origem(entrada));
      return Object.assign({}, estado, { seats, names });
    }
    if (entrada.type === 'stand') return removerPessoa(estado, origem(entrada));
    if (entrada.type === 'reset') return estadoNovo();
    if (entrada.type === 'deal') {
      const mao = criarMao(estado, entrada);
      return Object.assign({}, estado, {
        dealer: entrada.dealer,
        phase: mao.eleven === null ? 'play' : 'eleven',
        hand: mao,
        result: null
      });
    }
    if (entrada.type === 'timeout') return reduzirTimeout(estado, Object.assign({}, entrada, { at: entrada.at }));
    if (entrada.type === 'eleven') {
      if (entrada.choice === 'run') return encerrar(estado, 1 - estado.hand.eleven, 1);
      const mao = Object.assign({}, estado.hand, {
        eleven: null,
        deadline: entrada.at + TEMPO_DA_VEZ
      });
      return Object.assign({}, estado, { phase: 'play', hand: mao });
    }
    if (entrada.type === 'play') {
      const lugar = lugarDaPessoa(estado, origem(entrada));
      return jogar(estado, Object.assign({}, entrada, { seat: lugar }));
    }
    if (entrada.type === 'call') {
      const mao = estado.hand;
      const dupla = duplaDaMao(mao, lugarDaPessoa(estado, origem(entrada)));
      const pendente = {
        fromTeam: dupla,
        toTeam: 1 - dupla,
        previous: mao.value,
        amount: proximoValor(mao.value)
      };
      return Object.assign({}, estado, {
        hand: Object.assign({}, mao, { pending: pendente, lastCaller: dupla, deadline: entrada.at + TEMPO_DA_VEZ })
      });
    }
    if (entrada.type === 'answer') {
      const mao = estado.hand;
      if (entrada.answer === 'run') return encerrar(estado, mao.pending.fromTeam, mao.pending.previous);
      if (entrada.answer === 'accept') {
        return Object.assign({}, estado, {
          hand: Object.assign({}, mao, {
            value: mao.pending.amount,
            pending: null,
            deadline: entrada.at + TEMPO_DA_VEZ
          })
        });
      }
      const dupla = duplaDaMao(mao, lugarDaPessoa(estado, origem(entrada)));
      const pendente = {
        fromTeam: dupla,
        toTeam: 1 - dupla,
        previous: mao.pending.amount,
        amount: proximoValor(mao.pending.amount)
      };
      return Object.assign({}, estado, {
        hand: Object.assign({}, mao, { pending: pendente, lastCaller: dupla, deadline: entrada.at + TEMPO_DA_VEZ })
      });
    }
    return estado;
  }

  function reduzirTimeout(estado, acao) {
    const mao = estado.hand;
    if (estado.phase === 'eleven') return encerrar(estado, 1 - mao.eleven, 1);
    if (mao.pending) return encerrar(estado, mao.pending.fromTeam, mao.pending.previous);

    const cartas = mao.cards[mao.turn];
    const indice = cartas.reduce((pior, carta, atual) => {
      return forca(carta, mao.manilha) < forca(cartas[pior], mao.manilha) ? atual : pior;
    }, 0);
    return jogar(estado, { seat: mao.turn, index: indice, covered: false, at: acao.at });
  }

  function removerPessoa(estado, id) {
    const lugar = lugarDaPessoa(estado, id);
    let proximo = estado;
    if (estado.hand && lugar >= 0) {
      proximo = encerrar(estado, 1 - duplaDaMao(estado.hand, lugar), estado.hand.value);
    }
    const seats = proximo.seats.slice();
    const names = proximo.names.slice();
    seats[lugar] = null;
    names[lugar] = null;
    return Object.assign({}, proximo, { seats, names });
  }

  function ocultarMesa(mao) {
    return mao.table.map((jogada) => {
      const publica = { seat: jogada.seat, covered: jogada.covered };
      if (!jogada.covered) publica.card = jogada.card;
      return publica;
    });
  }

  function visao(estado, id, contexto) {
    const lugar = lugarDaPessoa(estado, id);
    const publico = {
      type: 'truco',
      seats: estado.seats.map((pessoa, indice) => pessoaNoLugar(estado, contexto, indice)),
      names: estado.names.map((nome, indice) => pessoaNoLugar(estado, contexto, indice) ? nome : null),
      scores: estado.scores.slice(),
      dealer: estado.dealer,
      phase: estado.phase,
      result: estado.result,
      me: { seat: lugar, team: estado.hand ? duplaDaMao(estado.hand, lugar) : null, can: {} }
    };
    if (!estado.hand) {
      publico.me.can.sit = lugar < 0;
      publico.me.can.stand = lugar >= 0;
      publico.me.can.deal = lugar >= 0 && podeComecar(estado, contexto);
      return publico;
    }

    const mao = estado.hand;
    const minhaDupla = duplaDaMao(mao, lugar);
    const souDaDecisao = mao.eleven === minhaDupla;
    const possoVer = !mao.iron && (mao.eleven === null || souDaDecisao);
    let cartas;
    if (mao.iron && lugar >= 0) cartas = mao.cards[lugar].map(() => null);
    if (possoVer && lugar >= 0) cartas = mao.cards[lugar].slice();
    const parceiro = mao.seats.find((outro) => outro !== lugar && duplaDaMao(mao, outro) === minhaDupla);
    let cartasDoParceiro;
    if (estado.phase === 'eleven' && souDaDecisao && parceiro !== undefined) {
      cartasDoParceiro = mao.cards[parceiro].slice();
    }

    publico.hand = {
      vira: mao.vira,
      manilha: mao.manilha,
      table: ocultarMesa(mao),
      rounds: mao.rounds.map((rodada) => ({ winner: rodada.winner, lead: rodada.lead })),
      value: mao.value,
      pending: mao.pending && { amount: mao.pending.amount, toTeam: mao.pending.toTeam },
      turn: mao.turn,
      deadline: mao.deadline,
      iron: mao.iron,
      eleven: mao.eleven,
      counts: mao.cards.map((maozinha) => maozinha.length),
      cards: cartas,
      partnerCards: cartasDoParceiro
    };
    publico.me.can = {
      stand: lugar >= 0,
      play: estado.phase === 'play' && !mao.pending && mao.turn === lugar,
      cover: estado.phase === 'play' && !mao.pending && mao.turn === lugar && mao.rounds.length > 0,
      call: lugar >= 0 && estado.phase === 'play' && !mao.pending && !mao.noCall && mao.value < 12
        && minhaDupla !== mao.lastCaller,
      answer: Boolean(mao.pending && mao.pending.toTeam === minhaDupla),
      eleven: estado.phase === 'eleven' && souDaDecisao
    };
    return publico;
  }

  function migrar(estado) {
    const anterior = objeto(estado);
    const novo = estadoNovo();
    novo.seats = Array.isArray(anterior.seats) ? anterior.seats.slice(0, 4) : novo.seats;
    novo.names = Array.isArray(anterior.names) ? anterior.names.slice(0, 4) : novo.names;
    novo.scores = Array.isArray(anterior.scores) ? anterior.scores.slice(0, 2) : novo.scores;
    novo.dealer = Number.isInteger(anterior.dealer) ? anterior.dealer : -1;
    return novo;
  }

  const modulo = {
    type: 'truco',
    title: 'Truco',
    group: 'jogos',
    size: { w: 720, h: 460, minW: 520, minH: 330, aspect: null },
    maxStateBytes: 12288,
    secret: true,
    init: estadoNovo,
    prepare: preparar,
    validate: validar,
    reduce: reduzir,
    view: visao,
    migrate: migrar,
    dropPeer: (estado, id) => removerPessoa(estado, id),
    timeoutAt: (estado) => estado.hand && estado.hand.deadline,
    summary: (estado) => `Truco ${estado.scores[0]} a ${estado.scores[1]}`,
    RANKS: ORDEM,
    SUITS: NAIPES,
    TURN_MS: TEMPO_DA_VEZ,
    proximaManilha,
    forca,
    vencedorDasRodadas
  };

  if (root.GoLive) {
    root.GoLive.mesaModules = root.GoLive.mesaModules || {};
    root.GoLive.mesaModules.truco = modulo;
  }
  if (typeof module !== 'undefined') module.exports = modulo;
}(typeof window !== 'undefined' ? window : globalThis));
