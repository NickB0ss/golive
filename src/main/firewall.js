/*
 * Libera a porta do GoLive no firewall do Windows. Consulta primeiro sem
 * elevacao; so pede UAC se a regra realmente nao existir ainda.
 */

const { exec: execCb } = require('child_process');
const { promisify } = require('util');

const defaultExec = promisify(execCb);
const RULE_NAME = 'GoLive';

function manualCommandFor(port) {
  return `netsh advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow protocol=TCP localport=${port}`;
}

async function ruleCoversPort(port, exec) {
  let stdout = '';
  try {
    ({ stdout } = await exec(`netsh advfirewall firewall show rule name="${RULE_NAME}"`));
  } catch {
    return false;
  }
  if (/No rules match/i.test(stdout)) return false;
  const ports = [...stdout.matchAll(/LocalPort:\s*(.+)/gi)].flatMap((m) =>
    m[1].split(',').map((p) => p.trim())
  );
  return ports.includes(String(port));
}

/** @returns {Promise<{ ok: boolean, manualCommand?: string }>} */
async function ensureFirewallRule(port, { exec = defaultExec } = {}) {
  const manualCommand = manualCommandFor(port);

  if (await ruleCoversPort(port, exec)) return { ok: true };

  const netshArgs = `advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow protocol=TCP localport=${port}`;
  const psCommand = `Start-Process netsh -ArgumentList '${netshArgs}' -Verb RunAs -WindowStyle Hidden -Wait`;
  try {
    await exec(`powershell -Command "${psCommand}"`);
  } catch {
    return { ok: false, manualCommand };
  }

  if (await ruleCoversPort(port, exec)) return { ok: true };
  return { ok: false, manualCommand };
}

module.exports = { ensureFirewallRule, RULE_NAME };
