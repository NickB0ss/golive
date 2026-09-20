'use strict';

const NIVEIS_ANTIGOS = ['log', 'info', 'warn', 'error'];

/**
 * Normaliza o console-message das duas APIs para o logger do processo main.
 * O Electron 35 trocou argumentos posicionais por details sem avisar o
 * handler antigo, entao manter as duas formas evita perder o diagnostico.
 */
function normalizarConsoleMessage(_event, levelOuDetails, mensagemAntiga) {
  const details = levelOuDetails && typeof levelOuDetails === 'object' ? levelOuDetails : null;
  const level = details ? details.level : levelOuDetails;
  const mensagem = details ? details.message : mensagemAntiga;
  const origem = typeof level === 'number' ? (NIVEIS_ANTIGOS[level] || String(level)) : String(level);
  const nivel = typeof level === 'number'
    ? (level >= 2 ? 'error' : 'log')
    : (level === 'warning' || level === 'warn' || level === 'error' ? 'error' : 'log');

  return { nivel, mensagem: String(mensagem ?? ''), origem: `renderer:${origem}` };
}

module.exports = { normalizarConsoleMessage };
