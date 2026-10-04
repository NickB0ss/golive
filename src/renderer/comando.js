'use strict';

// Painel de comando (Ctrl+K, 05 §4). Modulo puro: diz quais acoes existem no
// estado atual e filtra pelo que foi digitado. Quem executa e a camada de DOM
// (ui.js), que aciona os mesmos controles da tela -- o painel e atalho, nunca o
// unico caminho.
(function (root) {
  /** Texto para comparar: minusculo e sem acento ("Câmera" acha "camera"). */
  function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  /** Acoes possiveis agora. `estado`:
   *   lugar: 'lobby' | 'room'
   *   fontes: [{ tileId, nome, assistindo }] (fontes ao vivo de outras pessoas)
   *   salas: [{ indice, nome }] (salas encontradas na rede)
   *   transmitindo, pausado, cameraLigada, conversaAberta: booleanos
   *   soMesa: sala "Mesa" -- so ha a Mesa (sem Modo teatro, sem assistir/ver junto: o comando leva a janela)
   *   semMesa: sala "so transmissoes" -- sem os comandos da Mesa */
  function acoesDisponiveis(estado = {}) {
    const t = root.GoLive.i18n.t;
    const acoes = [];
    const add = (id, rotulo, extra = {}) => acoes.push({ id, rotulo, ...extra });
    if (estado.lugar === 'room') {
      for (const f of estado.fontes || []) {
        if (estado.soMesa) {
          // Na Mesa quem decide o que se assiste sao as janelas visiveis: o comando so leva ate a janela.
          add('assistir', t('comando.irAte', { nome: f.nome }), { alvo: f.tileId });
          continue;
        }
        if (!f.assistindo) add('assistir', t('comando.assistir', { nome: f.nome }), { alvo: f.tileId });
        else add('parar-assistir', t('comando.pararAssistir', { nome: f.nome }), { alvo: f.tileId });
        if (!f.assistindo && !String(f.tileId).startsWith('cam-')) add('ver-junto', t('comando.verJunto', { nome: f.nome }), { alvo: f.tileId });
      }
      if (!estado.transmitindo) add('transmitir', t('comando.transmitirTela'));
      else {
        add('pausar', t(estado.pausado ? 'comando.retomarTransmissao' : 'comando.pausarTransmissao'), { dica: 'Ctrl+Alt+P' });
        add('trocar-fonte', t('comando.trocarFonte'));
        add('parar-transmitir', t('comando.pararTransmitir'));
      }
      add('camera', t(estado.cameraLigada ? 'comando.desligarCamera' : 'comando.ligarCamera'));
      // Os tipos de sala sao exclusivos: nao ha comando que alterne entre Mesa e palco.
      if (estado.soMesa) add('por-na-mesa', t('comando.porNaMesa'));
      add('conversa', t(estado.conversaAberta ? 'comando.fecharConversa' : 'comando.abrirConversa'), { dica: 'C' });
      // O Modo teatro e o palco em tela cheia: na sala Mesa nao ha palco.
      if (!estado.soMesa) add('teatro', t('comando.modoTeatro'), { dica: 'T' });
      add('copiar-endereco', t('comando.copiarEnderecoSala'));
      add('diagnostico', t('comando.diagnostico'));
      add('configuracoes', t('comando.configuracoes'));
      add('sair', t('comando.sairSala'));
    } else {
      for (const s of estado.salas || []) add('entrar', t('comando.entrarEm', { nome: s.nome }), { alvo: s.indice });
      add('criar-sala', t('comando.criarSala'));
      add('procurar', t('comando.procurarSalas'));
      add('configuracoes', t('comando.configuracoes'));
    }
    return acoes;
  }

  /** Filtra e ordena: comeco de palavra antes de meio de palavra; sem termo,
   * a ordem original (a mais util primeiro). */
  function filtrar(acoes, termo) {
    const t = normalizar(termo);
    if (!t) return acoes.slice();
    const pontuadas = [];
    acoes.forEach((acao, i) => {
      const r = normalizar(acao.rotulo);
      const pos = r.indexOf(t);
      if (pos < 0) return;
      const inicioDePalavra = pos === 0 || r[pos - 1] === ' ';
      pontuadas.push({ acao, peso: (inicioDePalavra ? 0 : 1000) + pos * 10 + i });
    });
    return pontuadas.sort((a, b) => a.peso - b.peso).map((p) => p.acao);
  }

  const api = { normalizar, acoesDisponiveis, filtrar };
  root.GoLive = root.GoLive || {};
  root.GoLive.comando = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
