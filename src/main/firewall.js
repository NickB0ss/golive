/*
 * Libera a porta do GoLive no firewall do Windows. Consulta primeiro sem
 * elevacao; so pede UAC se a regra realmente nao existir ainda.
 */

const { exec: execCb } = require('child_process');
const { promisify } = require('util');

const defaultExec = promisify(execCb);
const RULE_NAME = 'GoLive';

// profile=private,domain exclui redes publicas (cafe, aeroporto) -- app de
// compartilhamento em LAN nunca precisou de acesso publico. program= restringe
// a regra a este executavel, senao vira uma porta liberada pra qualquer processo.
function manualCommandFor(port, execPath) {
  return `netsh advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow protocol=TCP localport=${port} profile=private,domain program="${execPath}"`;
}

// Consulta estruturada via PowerShell (Get-NetFirewallRule), nao `netsh
// show rule` + regex. Duas razoes:
//   1. `netsh` e localizado -- em Windows pt-BR a mensagem de "nenhuma
//      regra" e "Nenhuma regra corresponde aos critérios especificados",
//      nao "No rules match". A checagem antiga so reconhecia a versao em
//      ingles (inofensivo ali porque o netsh tambem sai com erro e cai no
//      catch, mas e uma corrida ganha por acidente, nao por design).
//   2. `netsh show rule` so devolvia LocalPort -- nunca o Program. Uma
//      regra "GoLive" criada rodando `npm start` (program=...electron.exe)
//      batia pela porta+nome pro executavel EMPACOTADO tambem, mesmo
//      apontando pra um binario diferente -- ver a auditoria de
//      2026-08-27, item A4.
// -EncodedCommand evita qualquer problema de escaping de aspas ao
// atravessar exec() -> cmd.exe -> powershell -> aspas do proprio script.
function firewallQueryScript() {
  return [
    `$rules = Get-NetFirewallRule -DisplayName '${RULE_NAME}' -ErrorAction SilentlyContinue`,
    '$rules | ForEach-Object {',
    '  $portFilter = $_ | Get-NetFirewallPortFilter',
    '  $appFilter = $_ | Get-NetFirewallApplicationFilter',
    '  [PSCustomObject]@{ LocalPort = $portFilter.LocalPort; Program = $appFilter.Program }',
    '} | ConvertTo-Json -Compress',
  ].join('\n');
}

function encodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** Uma regra "cobre" a porta pra este programa se o LocalPort bate E o
 * Program da regra e "Any" (sem restricao -- vale pra qualquer executavel,
 * inclusive o nosso) ou bate com `execPath` (comparacao sem case, Windows
 * nao diferencia). */
function ruleMatchesPortAndProgram(rule, port, execPath) {
  if (String(rule.LocalPort ?? '') !== String(port)) return false;
  const program = typeof rule.Program === 'string' ? rule.Program : '';
  if (program.toLowerCase() === 'any') return true;
  return program.toLowerCase() === execPath.toLowerCase();
}

async function ruleCoversPort(port, exec, execPath) {
  let stdout = '';
  try {
    ({ stdout } = await exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encodedCommand(firewallQueryScript())}`));
  } catch (err) {
    console.warn('[firewall] falha ao consultar regra existente:', err.message);
    return false;
  }

  const trimmed = stdout.trim();
  if (!trimmed) return false; // nenhuma regra chamada "GoLive"

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    console.warn('[firewall] resposta inesperada do PowerShell:', err.message);
    return false;
  }

  // ConvertTo-Json devolve um objeto solto (nao array) quando so ha UM
  // resultado no pipeline -- normaliza antes de iterar.
  const rules = Array.isArray(parsed) ? parsed : [parsed];
  return rules.some((rule) => ruleMatchesPortAndProgram(rule, port, execPath));
}

/** @returns {Promise<{ ok: boolean, manualCommand?: string }>} */
async function ensureFirewallRule(port, { exec = defaultExec, execPath = process.execPath } = {}) {
  const manualCommand = manualCommandFor(port, execPath);

  if (await ruleCoversPort(port, exec, execPath)) return { ok: true };

  const netshArgs = `advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow protocol=TCP localport=${port} profile=private,domain program="${execPath}"`;
  const psCommand = `Start-Process netsh -ArgumentList '${netshArgs}' -Verb RunAs -WindowStyle Hidden -Wait`;
  try {
    await exec(`powershell -Command "${psCommand}"`);
  } catch (err) {
    console.warn('[firewall] elevacao falhou ou foi cancelada:', err.message);
    return { ok: false, manualCommand };
  }

  if (await ruleCoversPort(port, exec, execPath)) return { ok: true };
  return { ok: false, manualCommand };
}

module.exports = { ensureFirewallRule, RULE_NAME };
