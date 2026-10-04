'use strict';

// Conta textos visiveis ainda fora dos dicionarios.
//   node tools/i18n/contar.js                 -> total por arquivo
//   node tools/i18n/contar.js <arq> [--de N] [--ate M] -> linha: texto
//   node tools/i18n/contar.js --gravar        -> atualiza pendentes.json

const fs = require('node:fs');
const path = require('node:path');
const { textosSoltos, ARQUIVOS_VARRIDOS } = require('./literais');

const RAIZ = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);

function numero(flag, padrao) {
  const indice = args.indexOf(flag);
  return indice < 0 ? padrao : Number(args[indice + 1]);
}

function pendentesAtuais() {
  const pendentes = {};
  for (const relativo of ARQUIVOS_VARRIDOS(RAIZ)) {
    const arquivo = path.join(RAIZ, relativo);
    const textos = textosSoltos(relativo, fs.readFileSync(arquivo, 'utf8'))
      .map((solto) => solto.texto)
      .sort();
    if (textos.length) pendentes[relativo] = textos;
  }
  return pendentes;
}

function contagem() {
  return Object.fromEntries(Object.entries(pendentesAtuais()).map(([arquivo, textos]) => {
    return [arquivo, textos.length];
  }));
}

if (args.includes('--gravar')) {
  const destino = path.join(__dirname, 'pendentes.json');
  fs.writeFileSync(destino, `${JSON.stringify(pendentesAtuais(), null, 2)}\n`);
} else if (args[0] && !args[0].startsWith('--')) {
  const de = numero('--de', 1);
  const ate = numero('--ate', Infinity);
  const arquivo = path.join(RAIZ, args[0]);
  for (const solto of textosSoltos(args[0], fs.readFileSync(arquivo, 'utf8'))) {
    if (solto.linha >= de && solto.linha <= ate) console.log(`${solto.linha}: ${solto.texto}`);
  }
} else {
  const totais = contagem();
  for (const [arquivo, total] of Object.entries(totais)) {
    console.log(`${String(total).padStart(5)}  ${arquivo}`);
  }
  const total = Object.values(totais).reduce((soma, quantidade) => soma + quantidade, 0);
  console.log(`${String(total).padStart(5)}  TOTAL`);
}

module.exports = { pendentesAtuais, contagem };
