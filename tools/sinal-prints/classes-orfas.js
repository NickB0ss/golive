'use strict';

/*
 * Lista classes usadas na interface (index.html e JS do renderer) que nao aparecem em nenhuma folha do Sinal nem
 * em mesa-janelas.css. Serve para achar marcacao que ficou sem estilo (ou restos da interface antiga) durante o
 * redesign. Classes que so servem de gancho para o JS podem aparecer aqui; a lista e para leitura, nao um teste.
 *
 * Uso: node tools/sinal-prints/classes-orfas.js [arquivo...]
 */

const fs = require('node:fs');
const path = require('node:path');

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
const css = [...fs.readdirSync(path.join(R, 'sinal')).filter((f) => f.endsWith('.css')).map((f) => path.join(R, 'sinal', f)),
  path.join(R, 'mesa-janelas.css')].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const arquivos = process.argv.slice(2).length ? process.argv.slice(2)
  : ['index.html', 'ui.js', 'app.js', 'warningcenter.js'].map((f) => path.join(R, f));

const usadas = new Map();
for (const arquivo of arquivos) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const achados = [
    ...texto.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`$]+)["'`]/g),
    ...texto.matchAll(/classList\.(?:add|toggle|remove)\(\s*'([^']+)'/g),
  ];
  for (const m of achados) {
    for (const c of m[1].split(/\s+/).filter(Boolean)) {
      if (!usadas.has(c)) usadas.set(c, new Set());
      usadas.get(c).add(path.basename(arquivo));
    }
  }
}
const orfas = [...usadas].filter(([c]) => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
for (const [c, onde] of orfas.sort()) console.log(`${c}\t${[...onde].join(',')}`);
console.log(`\n${orfas.length} de ${usadas.size} classes sem regra em sinal/*.css`);
