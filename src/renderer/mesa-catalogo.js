'use strict';

/* Metadados puros do seletor de janelas da Mesa. */

(function (root) {
  // i18n/index.js carrega antes (index.html); nos testes, o teste o carrega primeiro.
  const { traduzirCodigo } = root.GoLive.i18n;

  // Os grupos e as descricoes sao CHAVES de traducao; o nome de cada janela e o
  // `title` do modulo (tambem uma chave). Quem mostra passa por t().
  const GRUPOS = Object.freeze({
    assistir: 'mesa.catalogo.grupo.assistir',
    jogos: 'mesa.catalogo.grupo.jogos',
    noite: 'mesa.catalogo.grupo.noite',
    ferramentas: 'mesa.catalogo.grupo.ferramentas',
  });

  // A descricao diz o que a janela faz, sem repetir o titulo que ja esta em cima dela no cartao.
  const item = (icone, descricao, ...chaves) => Object.freeze({ icone, descricao, chaves });
  const itens = Object.freeze({
    youtube: item('i-play', 'mesa.catalogo.youtube.descricao', 'video', 'filme', 'canal'),
    radio: item('i-volume-2', 'mesa.catalogo.radio.descricao', 'musica', 'audio', 'estacao'),
    aovivo: item('i-tv-minimal', 'mesa.catalogo.aovivo.descricao', 'live', 'stream'),
    jam: item('i-volume-2', 'mesa.catalogo.jam.descricao', 'musica', 'audio'),
    nota: item('i-type', 'mesa.catalogo.nota.descricao', 'texto', 'escrever', 'post-it', 'anotacao'),
    lista: item('i-check', 'mesa.catalogo.lista.descricao', 'tarefas', 'checklist'),
    enquete: item('i-bar-chart-3', 'mesa.catalogo.enquete.descricao', 'voto', 'votacao', 'pesquisa'),
    imagem: item('i-image', 'mesa.catalogo.imagem.descricao', 'foto', 'figura'),
    galeria: item('i-gallery-horizontal-end', 'mesa.catalogo.galeria.descricao', 'fotos', 'album', 'imagens'),
    quadro: item('i-pen-line', 'mesa.catalogo.quadro.descricao', 'desenho', 'lousa', 'rabisco'),
    link: item('i-link', 'mesa.catalogo.link.descricao', 'url', 'site', 'pagina'),
    placar: item('i-layout-grid', 'mesa.catalogo.placar.descricao', 'pontos', 'resultado', 'score'),
    cronometro: item('i-timer', 'mesa.catalogo.cronometro.descricao', 'tempo', 'relogio', 'timer'),
    sorteio: item('i-sparkles', 'mesa.catalogo.sorteio.descricao', 'sortear', 'aleatorio', 'times'),
    dados: item('i-dices', 'mesa.catalogo.dados.descricao', 'dado', 'rolar', 'rpg', 'moeda'),
    roleta: item('i-circle-dot', 'mesa.catalogo.roleta.descricao', 'girar', 'sorteio', 'aleatorio'),
    stop: item('i-type', 'mesa.catalogo.stop.descricao', 'adedonha', 'palavras', 'letras'),
    sons: item('i-volume-2', 'mesa.catalogo.sons.descricao', 'audio', 'efeitos', 'soundboard'),
    velha: item('i-grid-3x3', 'mesa.catalogo.velha.descricao', 'tic tac toe', 'jogo'),
    lig4: item('i-circle-dot', 'mesa.catalogo.lig4.descricao', 'conecta 4', 'tabuleiro', 'jogo'),
    damas: item('i-circle-dot', 'mesa.catalogo.damas.descricao', 'tabuleiro', 'pecas', 'jogo'),
    xadrez: item('i-crown', 'mesa.catalogo.xadrez.descricao', 'chess', 'tabuleiro', 'pecas'),
    batalha: item('i-grid-3x3', 'mesa.catalogo.batalha.descricao', 'naval', 'barcos', 'tabuleiro'),
    poquer: item('i-spade', 'mesa.catalogo.poquer.descricao', 'poker', 'cartas', 'baralho'),
    blackjack: item('i-spade', 'mesa.catalogo.blackjack.descricao', '21', 'vinte e um', 'cartas', 'baralho'),
    truco: item('i-spade', 'mesa.catalogo.truco.descricao', 'cartas', 'baralho'),
    oito: item('i-circle-dot', 'mesa.catalogo.oito.descricao', 'cartas', 'baralho', 'uno'),
    domino: item('i-dices', 'mesa.catalogo.domino.descricao', 'pedras', 'pecas', 'jogo'),
    desenha: item('i-pen-line', 'mesa.catalogo.desenha.descricao', 'desenho', 'adivinha', 'pictionary'),
    quiz: item('i-circle-help', 'mesa.catalogo.quiz.descricao', 'perguntas', 'trivia', 'conhecimento'),
  });

  function filtrar(mods, termo, grupo) {
    const busca = normalizar(termo);
    return mods.filter((mod) => {
      if (grupo && grupo !== 'tudo' && mod.group !== grupo) return false;
      if (!busca) return true;
      const item = itens[mod.type] || {};
      const texto = [traduzirCodigo(mod.title), traduzirCodigo(GRUPOS[mod.group]), ...(item.chaves || [])].join(' ');
      return normalizar(texto).includes(busca);
    });
  }

  function lembrarRecente(lista, type) {
    const anteriores = Array.isArray(lista) ? lista : [];
    return [type, ...anteriores.filter((item) => item !== type)].slice(0, 4);
  }

  function deveRedirecionarParaBusca(tecla, focoNaGrade) {
    return focoNaGrade && tecla.length === 1 && tecla !== ' ';
  }

  function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  const api = { GRUPOS, itens, filtrar, lembrarRecente, deveRedirecionarParaBusca };
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaCatalogo = api;
  if (typeof module !== 'undefined' && typeof require === 'function') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
