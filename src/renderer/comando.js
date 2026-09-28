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
   *   transmitindo, pausado, cameraLigada, naMesa, conversaAberta: booleanos */
  function acoesDisponiveis(estado = {}) {
    const acoes = [];
    const add = (id, rotulo, extra = {}) => acoes.push({ id, rotulo, ...extra });
    if (estado.lugar === 'room') {
      for (const f of estado.fontes || []) {
        if (!f.assistindo) add('assistir', `Assistir ${f.nome}`, { alvo: f.tileId });
        else add('parar-assistir', `Parar de assistir ${f.nome}`, { alvo: f.tileId });
        if (!f.assistindo && !String(f.tileId).startsWith('cam-')) add('ver-junto', `Ver ${f.nome} junto`, { alvo: f.tileId });
      }
      if (!estado.transmitindo) add('transmitir', 'Transmitir tela');
      else {
        add('pausar', estado.pausado ? 'Retomar a transmissão' : 'Pausar a transmissão', { dica: 'Ctrl+Alt+P' });
        add('trocar-fonte', 'Trocar fonte');
        add('parar-transmitir', 'Parar de transmitir');
      }
      add('camera', estado.cameraLigada ? 'Desligar câmera' : 'Ligar câmera');
      add('mesa', estado.naMesa ? 'Voltar ao palco' : 'Abrir a Mesa', { dica: 'M' });
      if (estado.naMesa) add('por-na-mesa', 'Pôr na Mesa…');
      add('conversa', estado.conversaAberta ? 'Fechar a conversa' : 'Abrir a conversa', { dica: 'C' });
      add('teatro', 'Modo teatro', { dica: 'T' });
      add('copiar-endereco', 'Copiar endereço da sala');
      add('diagnostico', 'Diagnóstico');
      add('configuracoes', 'Configurações');
      add('sair', 'Sair da sala');
    } else {
      for (const s of estado.salas || []) add('entrar', `Entrar em ${s.nome}`, { alvo: s.indice });
      add('criar-sala', 'Criar sala');
      add('procurar', 'Procurar salas de novo');
      add('configuracoes', 'Configurações');
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
