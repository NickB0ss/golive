'use strict';

/*
 * Sobe o GoLive real com o hook de boot e imprime o resultado.
 * Uso: node tools/sinal-boot/rodar.js <pasta-saida> [roteiro.js] [LxA]
 * Usa um --user-data-dir proprio: com o GoLive instalado aberto, a trava de instancia unica faria o app sair calado.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const [saida, roteiro, tamanho] = process.argv.slice(2);
if (!saida) {
  console.error('uso: node tools/sinal-boot/rodar.js <pasta-saida> [roteiro.js] [LxA]');
  process.exit(64);
}
const [w, h] = (tamanho || '1440x900').split('x');
const exe = path.join(RAIZ, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const dados = path.join(path.resolve(saida), 'userdata');
fs.mkdirSync(dados, { recursive: true });

const r = spawnSync(exe, ['.', `--user-data-dir=${dados}`], {
  cwd: RAIZ,
  env: {
    ...process.env,
    NODE_OPTIONS: `--require=${path.join(__dirname, 'hook.js')}`,
    SINAL_BOOT_OUT: path.resolve(saida),
    SINAL_BOOT_SCRIPT: roteiro ? path.resolve(roteiro) : '',
    SINAL_BOOT_W: w,
    SINAL_BOOT_H: h,
  },
  stdio: 'inherit',
  timeout: 90000,
});
const resultado = path.join(path.resolve(saida), 'boot.json');
console.log(fs.existsSync(resultado) ? fs.readFileSync(resultado, 'utf8') : `sem boot.json (saida ${r.status})`);
process.exit(r.status ?? 1);
