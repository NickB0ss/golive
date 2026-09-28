'use strict';

/*
 * Galeria: as imagens que o historico do chat ainda guarda, em grade, cada
 * uma com "Pôr na mesa" (que cria uma janela `imagem`).
 *
 * Nao ha estado da sala: cada PC mostra o proprio historico do chat, que e
 * o mesmo para todos (chatimagens.js espelha as regras do servidor). Nada
 * de imagem no estado (teto de bytes do contrato da Mesa).
 */

(function (root) {
  const TYPE = 'galeria';

  const galeria = {
    type: TYPE,
    title: 'Galeria',
    group: 'ferramentas',
    size: { w: 480, h: 360, minW: 240, minH: 180, aspect: null },
    maxStateBytes: 64,

    init() {
      return {};
    },

    validate() {
      return 'a galeria não tem ações';
    },

    reduce(state) {
      return state;
    },

    summary() {
      return 'Imagens do chat';
    },
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = galeria;

  if (typeof module !== 'undefined') module.exports = galeria;
})(typeof window !== 'undefined' ? window : global);
