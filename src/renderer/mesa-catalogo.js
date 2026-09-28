'use strict';

/* Metadados puros do seletor de janelas da Mesa. */

(function (root) {
  const GRUPOS = Object.freeze({
    assistir: 'Assistir e ouvir',
    jogos: 'Jogos',
    noite: 'Noite de jogo',
    ferramentas: 'Ferramentas',
  });

  // A descricao diz o que a janela faz, sem repetir o titulo que ja esta em cima dela no cartao.
  const item = (icone, desc, ...chaves) => Object.freeze({ icone, desc, chaves });
  const itens = Object.freeze({
    youtube: item('i-play', 'Assistam juntos, no mesmo ponto', 'video', 'filme', 'canal'),
    radio: item('i-volume-2', 'Fila de músicas que a sala monta', 'musica', 'audio', 'estacao'),
    aovivo: item('i-tv-minimal', 'Uma live da Twitch aberta na Mesa', 'live', 'stream'),
    jam: item('i-volume-2', 'Ouçam o Spotify juntos', 'musica', 'audio'),
    nota: item('i-type', 'Recado rápido para a sala', 'texto', 'escrever', 'post-it', 'anotacao'),
    lista: item('i-check', 'Itens para a sala ir marcando', 'tarefas', 'checklist'),
    enquete: item('i-bar-chart-3', 'Votação com resultado ao vivo', 'voto', 'votacao', 'pesquisa'),
    imagem: item('i-image', 'Uma imagem para todos verem', 'foto', 'figura'),
    galeria: item('i-gallery-horizontal-end', 'Várias imagens, uma de cada vez', 'fotos', 'album', 'imagens'),
    quadro: item('i-pen-line', 'Lousa para desenhar junto', 'desenho', 'lousa', 'rabisco'),
    link: item('i-link', 'Um endereço para a sala abrir', 'url', 'site', 'pagina'),
    placar: item('i-layout-grid', 'Pontos de cada time ou pessoa', 'pontos', 'resultado', 'score'),
    cronometro: item('i-timer', 'Marque o tempo da rodada', 'tempo', 'relogio', 'timer'),
    sorteio: item('i-sparkles', 'Divide a sala em times na sorte', 'sortear', 'aleatorio', 'times'),
    dados: item('i-dices', 'Role dados ou jogue uma moeda', 'dado', 'rolar', 'rpg', 'moeda'),
    roleta: item('i-circle-dot', 'Gire e deixe a sorte escolher', 'girar', 'sorteio', 'aleatorio'),
    stop: item('i-type', 'Adedonha: uma palavra por categoria', 'adedonha', 'palavras', 'letras'),
    sons: item('i-volume-2', 'Botões de efeito sonoro', 'audio', 'efeitos', 'soundboard'),
    velha: item('i-grid-3x3', 'Três em linha, para duas pessoas', 'tic tac toe', 'jogo'),
    lig4: item('i-circle-dot', 'Alinhe quatro peças antes do outro', 'conecta 4', 'tabuleiro', 'jogo'),
    damas: item('i-circle-dot', 'Tabuleiro clássico, para duas pessoas', 'tabuleiro', 'pecas', 'jogo'),
    xadrez: item('i-crown', 'Uma partida, para duas pessoas', 'chess', 'tabuleiro', 'pecas'),
    batalha: item('i-grid-3x3', 'Afunde a frota do outro lado', 'naval', 'barcos', 'tabuleiro'),
    poquer: item('i-spade', 'Cartas, fichas e apostas', 'poker', 'cartas', 'baralho'),
    blackjack: item('i-spade', 'Chegue a 21 sem estourar', '21', 'vinte e um', 'cartas', 'baralho'),
    truco: item('i-spade', 'Cartas, blefe e manilha', 'cartas', 'baralho'),
    oito: item('i-circle-dot', 'Descarte pelo naipe ou pelo número', 'cartas', 'baralho', 'uno'),
    domino: item('i-dices', 'Encaixe as pedras pelas pontas', 'pedras', 'pecas', 'jogo'),
    desenha: item('i-pen-line', 'Uma pessoa desenha, a sala adivinha', 'desenho', 'adivinha', 'pictionary'),
    quiz: item('i-circle-help', 'Perguntas valendo ponto', 'perguntas', 'trivia', 'conhecimento'),
  });

  function filtrar(mods, termo, grupo) {
    const busca = normalizar(termo);
    return mods.filter((mod) => {
      if (grupo && grupo !== 'tudo' && mod.group !== grupo) return false;
      if (!busca) return true;
      const item = itens[mod.type] || {};
      const texto = [mod.title, GRUPOS[mod.group], ...(item.chaves || [])].join(' ');
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
    return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  const api = { GRUPOS, itens, filtrar, lembrarRecente, deveRedirecionarParaBusca };
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaCatalogo = api;
  if (typeof module !== 'undefined' && typeof require === 'function') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
