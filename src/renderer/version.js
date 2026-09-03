// src/renderer/version.js
'use strict';

/*
 * Versao do app como regra de compatibilidade de sala.
 *
 * A sinalizacao, o formato da arvore de retransmissao e o protocolo P2P
 * mudam de release pra release sem nenhuma negociacao de versao -- duas
 * maquinas em versoes diferentes na mesma sala dao sintomas que parecem bug
 * de rede (tile que nunca abre, chat mudo, arvore que nao fecha). Entao a
 * regra e simples e sem excecao: so entra na sala quem esta na MESMA versao
 * de quem criou a sala.
 *
 * Aqui mora so a parte pura (comparar e redigir o aviso). Quem barra de
 * verdade e o servidor de sinalizacao (server/signaling-core.js), no 'join'
 * -- este modulo nunca e a unica linha de defesa, ele so deixa o app
 * explicar o motivo antes/depois da recusa.
 */

(function (root) {
  /** Quebra "1.2.3" (ou "v1.2.3", ou "1.2.3-beta.1") em [1,2,3].
   * Devolve null pro que nao encaixar -- versao desconhecida nunca finge
   * ser comparavel. */
  function parse(v) {
    if (typeof v !== 'string') return null;
    const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  /** -1 se `a` e mais antiga, 1 se e mais nova, 0 se iguais; null se
   * alguma das duas nao for uma versao reconhecivel. */
  function compare(a, b) {
    const pa = parse(a);
    const pb = parse(b);
    if (!pa || !pb) return null;
    for (let i = 0; i < 3; i += 1) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    }
    return 0;
  }

  /** Igualdade exata (normalizando espaco e o "v" da frente). Duas versoes
   * ilegiveis so passam se forem a mesma string -- na duvida, barra. */
  function same(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const norm = (v) => v.trim().replace(/^v/, '');
    return norm(a) !== '' && norm(a) === norm(b);
  }

  /** Texto do aviso quando as versoes nao batem, do ponto de vista de quem
   * esta tentando entrar. `mine`/`theirs` podem ser null (versao que nao
   * chegou ou nao deu pra ler). */
  function mismatchText({ mine, theirs }) {
    const cmp = compare(mine, theirs);
    if (cmp === -1) {
      return `Essa sala está na versão ${theirs} e você está na ${mine}. Atualize o GoLive pra entrar.`;
    }
    if (cmp === 1) {
      return `Você está na versão ${mine} e essa sala está na ${theirs}. Quem criou a sala precisa atualizar.`;
    }
    if (theirs) {
      return `Essa sala está na versão ${theirs} e o seu app, na ${mine || 'desconhecida'}. Todo mundo precisa estar na mesma versão.`;
    }
    return 'Essa sala está numa versão diferente da sua. Todo mundo precisa estar na mesma versão.';
  }

  /** Selo curto do card da sala na lista da rede (espaco de uma linha). */
  function mismatchBadge({ mine, theirs }) {
    if (!theirs) return 'versão diferente';
    return compare(mine, theirs) === 1 ? `v${theirs} · desatualizada` : `v${theirs} · atualize`;
  }

  const api = { parse, compare, same, mismatchText, mismatchBadge };

  root.GoLive = root.GoLive || {};
  root.GoLive.version = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
