// src/main/firewall.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensureFirewallRule, psQuote, firewallRuleScript } = require('./firewall');

const EXEC_PATH = 'C:\\Program Files\\GoLive LAN\\GoLive LAN.exe';

function fakeExec(script) {
  const calls = [];
  const exec = async (cmd) => {
    calls.push(cmd);
    return script(cmd, calls.length);
  };
  return { exec, calls };
}

// A consulta de verdade sai como um -EncodedCommand (base64 UTF-16LE) --
// os testes casam em "EncodedCommand" pra distinguir a etapa de consulta
// da etapa de elevacao (que usa Start-Process), sem depender do conteudo
// exato do script.
function isQuery(cmd) {
  return cmd.includes('-EncodedCommand')
    && Buffer.from(cmd.split('-EncodedCommand ')[1], 'base64').toString('utf16le').includes('Get-NetFirewallRule');
}

function isElevation(cmd) {
  return cmd.includes('-EncodedCommand')
    && Buffer.from(cmd.split('-EncodedCommand ')[1], 'base64').toString('utf16le').includes('Start-Process');
}

test('o script elevado trata caminho hostil como um unico literal PowerShell', () => {
  const execPath = "C:\\Users\\O'Brien\\Go Live; $env:USERPROFILE` &.exe";
  const script = firewallRuleScript(9000, execPath);

  assert.equal(psQuote(execPath), "'C:\\Users\\O''Brien\\Go Live; $env:USERPROFILE` &.exe'");
  assert.ok(script.includes(`$program = ${psQuote(execPath)}`));
  assert.ok(script.includes("$ruleName = 'GoLive'"));
  assert.ok(script.includes("$port = '9000'"));
  assert.match(script, /Start-Process "\$env:SystemRoot\\System32\\netsh\.exe"/);
  assert.doesNotMatch(script, /Start-Process netsh\b/);
});

test('comando manual para PowerShell mantem caracteres especiais no caminho como literais', async () => {
  const execPath = "C:\\Users\\$(Start-Process calc)\\O'Brien`%\\GoLive.exe";
  const { exec } = fakeExec((cmd) => {
    if (isQuery(cmd)) return { stdout: '' };
    if (isElevation(cmd)) throw new Error('UAC cancelado');
    throw new Error(`comando inesperado: ${cmd}`);
  });

  const { manualCommand } = await ensureFirewallRule(9000, { exec, execPath });

  assert.match(manualCommand, /^& "\$env:SystemRoot\\System32\\netsh\.exe" /);
  assert.ok(manualCommand.includes(psQuote(`program="${execPath}"`)));
});

test('nao pede elevacao se a regra ja cobre porta e programa', async () => {
  const { exec, calls } = fakeExec((cmd) => {
    if (isQuery(cmd)) {
      return { stdout: JSON.stringify({ LocalPort: '9000', Program: EXEC_PATH }) };
    }
    throw new Error('nao deveria chamar Start-Process');
  });

  const result = await ensureFirewallRule(9000, { exec, execPath: EXEC_PATH });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
});

test('Program "Any" cobre qualquer executavel, inclusive o nosso', async () => {
  const { exec } = fakeExec((cmd) => {
    if (isQuery(cmd)) return { stdout: JSON.stringify({ LocalPort: '9000', Program: 'Any' }) };
    throw new Error('nao deveria chamar Start-Process');
  });

  const result = await ensureFirewallRule(9000, { exec, execPath: EXEC_PATH });
  assert.deepEqual(result, { ok: true });
});

test('regra na mesma porta mas com OUTRO programa nao conta como cobertura (#A4)', async () => {
  // Cenario real: `npm start` cria "GoLive" na porta 9000 apontando pro
  // electron.exe de dentro de node_modules; o app EMPACOTADO tem um
  // execPath diferente e nao deve achar que ja esta liberado.
  const electronDevPath = 'C:\\golive\\node_modules\\electron\\dist\\electron.exe';
  const { exec, calls } = fakeExec((cmd) => {
    if (isQuery(cmd)) return { stdout: JSON.stringify({ LocalPort: '9000', Program: electronDevPath }) };
    if (isElevation(cmd)) return { stdout: '' };
    throw new Error(`comando inesperado: ${cmd}`);
  });

  const result = await ensureFirewallRule(9000, { exec, execPath: EXEC_PATH });
  // Consultou, nao achou cobertura pro nosso execPath, tentou elevar --
  // como a segunda consulta usa o MESMO mock (sempre devolve o programa
  // antigo), a elevacao "nao pega" e o resultado e ok:false com o comando
  // manual pronto.
  assert.equal(result.ok, false);
  assert.ok(calls.some(isElevation));
});

test('varias regras "GoLive" (uma por porta) -- so a da porta certa importa', async () => {
  const { exec } = fakeExec((cmd) => {
    if (isQuery(cmd)) {
      return {
        stdout: JSON.stringify([
          { LocalPort: '9000', Program: 'algum-outro.exe' },
          { LocalPort: '9001', Program: EXEC_PATH },
        ]),
      };
    }
    throw new Error('nao deveria chamar Start-Process');
  });

  const result = await ensureFirewallRule(9001, { exec, execPath: EXEC_PATH });
  assert.deepEqual(result, { ok: true });
});

test('nenhuma regra "GoLive" -- consulta devolve saida vazia', async () => {
  let elevationAttempts = 0;
  const warnings = [];
  const originalWarn = console.warn;
  const { exec, calls } = fakeExec((cmd) => {
    if (isQuery(cmd)) return { stdout: '' };
    if (isElevation(cmd)) {
      elevationAttempts += 1;
      return { stdout: '' };
    }
    throw new Error(`comando inesperado: ${cmd}`);
  });

  console.warn = (...args) => warnings.push(args);
  try {
    await ensureFirewallRule(9000, { exec, execPath: EXEC_PATH });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(elevationAttempts, 1, 'a escrita elevada deve ser chamada');
  assert.ok(calls.some(isElevation));
  assert.deepEqual(warnings, []);
});

test('eleva e confirma quando a regra nao existe', async () => {
  let created = false;
  const { exec } = fakeExec((cmd) => {
    if (isQuery(cmd)) {
      return created
        ? { stdout: JSON.stringify({ LocalPort: '9000', Program: EXEC_PATH }) }
        : { stdout: '' };
    }
    if (isElevation(cmd)) {
      created = true;
      return { stdout: '' };
    }
    throw new Error(`comando inesperado: ${cmd}`);
  });

  const result = await ensureFirewallRule(9000, { exec, execPath: EXEC_PATH });
  assert.deepEqual(result, { ok: true });
});

test('devolve comando manual quando a elevacao falha', async () => {
  const { exec } = fakeExec((cmd) => {
    if (isQuery(cmd)) return { stdout: '' };
    if (isElevation(cmd)) throw new Error('UAC cancelado');
    throw new Error(`comando inesperado: ${cmd}`);
  });

  const result = await ensureFirewallRule(9000, { exec, execPath: EXEC_PATH });
  assert.equal(result.ok, false);
  assert.match(result.manualCommand, /netsh\.exe" 'advfirewall' 'firewall' 'add' 'rule' 'name="GoLive"'.*'localport=9000'/);
  assert.match(result.manualCommand, /profile=private,domain/);
  assert.match(result.manualCommand, /program="/);
});

test('resposta inesperada do PowerShell (nao-JSON) e tratada como sem cobertura, sem lancar', async () => {
  const { exec, calls } = fakeExec((cmd) => {
    if (isQuery(cmd)) return { stdout: 'isso nao e json' };
    if (isElevation(cmd)) return { stdout: '' };
    throw new Error(`comando inesperado: ${cmd}`);
  });

  const result = await ensureFirewallRule(9000, { exec, execPath: EXEC_PATH });
  assert.equal(result.ok, false);
  assert.ok(calls.some(isElevation));
});
