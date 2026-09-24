'use strict';

// Runner do laboratorio: `npm run lab` roda todos os cenarios de
// tools/lab/cenarios/; `npm run lab -- queda-curta origem-parada` roda so
// esses; `npm run lab -- --listar` so lista. Sai com codigo 1 se algum
// falhar. Logs e prints de cada instancia ficam em lab-out/<cenario>/.
//
// Precisa de Linux com Xvfb, do binario do Electron baixado e, pros
// cenarios de rede, de iptables (root ou `sudo -n`). Ver tools/lab/README.md.

const fs = require('fs');
const path = require('path');
const { Instancia, Rede, ate, sleep, RAIZ } = require('./lab');
const { errosNaoTratados, resumo } = require('./verificar');

const SAIDA = path.join(RAIZ, 'lab-out');
const PASTA_CENARIOS = path.join(__dirname, 'cenarios');

// Ruido do ambiente de teste, nao do app. Cada item diz por que pode.
const PERMITIDOS_SEMPRE = [];

function carregarCenarios() {
  return fs.readdirSync(PASTA_CENARIOS)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => require(path.join(PASTA_CENARIOS, f)));
}

async function rodarCenario(cenario) {
  const dir = path.join(SAIDA, cenario.nome);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const linhaDoTempo = fs.createWriteStream(path.join(dir, 'passos.log'));
  const passo = (texto) => {
    const l = `[${cenario.nome} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${texto}`;
    console.log(l);
    linhaDoTempo.write(`${l}\n`);
  };
  const rede = new Rede(passo);
  const instancias = [];

  const lab = {
    rede,
    passo,
    sleep,
    ate,
    /** Abre uma instancia por nome, em paralelo, e devolve na mesma ordem. */
    async abrir(nomes) {
      const novas = nomes.map((nome) => new Instancia({ nome, dir: path.join(dir, nome.toLowerCase()), passo }));
      instancias.push(...novas);
      await Promise.all(novas.map((i) => i.iniciar()));
      return novas;
    },
    verificar(condicao, descricao) {
      if (!condicao) throw new Error(`falhou: ${descricao}`);
      passo(`ok: ${descricao}`);
    },
    igual(valor, esperado, descricao) {
      lab.verificar(valor === esperado, `${descricao} (esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)})`);
    },
    contem(texto, trecho, descricao) {
      lab.verificar(String(texto).includes(trecho), `${descricao} (esperado conter ${JSON.stringify(trecho)}, veio ${JSON.stringify(texto)})`);
    },
  };

  let erro = null;
  try {
    if (cenario.precisaRede && !await Rede.disponivel()) {
      throw new Error('iptables indisponivel (precisa de root ou `sudo -n iptables`)');
    }
    passo(cenario.descricao);
    const limite = cenario.timeoutMs || 240000;
    let timer = null;
    // Estourado o limite, o cenario segue rodando ate as instancias fecharem
    // e rejeita depois: sem este catch, isso derrubaria o runner no meio do
    // cenario seguinte.
    const execucao = cenario.rodar(lab);
    execucao.catch(() => {});
    try {
      await Promise.race([
        execucao,
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`cenario passou de ${limite / 1000}s`)), limite);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    erro = err;
    passo(`FALHOU: ${err.message}`);
    await Promise.all(instancias.map((i) => i.print('falha')));
  } finally {
    await rede.restaurar();
    await Promise.all(instancias.map((i) => i.encerrar()));
  }

  // Erro nao tratado em qualquer instancia reprova o cenario, mesmo que as
  // verificacoes tenham passado: e exatamente o tipo de defeito que so
  // aparece com o app rodando (incidente #62/#63).
  if (!erro) {
    const permitidos = [...PERMITIDOS_SEMPRE, ...(cenario.permitidos || [])];
    const soltos = instancias.flatMap((i) => errosNaoTratados(i.linhas, permitidos).map((l) => `${i.nome}: ${l.texto}`));
    if (soltos.length) {
      erro = new Error(`erro nao tratado no app:\n       ${soltos.slice(0, 5).join('\n       ')}`);
      passo(`FALHOU: ${erro.message}`);
    }
  }
  await new Promise((resolve) => { linhaDoTempo.end(resolve); });
  return { nome: cenario.nome, ok: !erro, erro: erro?.message, ms: Date.now() - t0 };
}

async function main() {
  const args = process.argv.slice(2);
  const todos = carregarCenarios();
  if (args.includes('--listar')) {
    for (const c of todos) console.log(`${c.nome}${c.precisaRede ? ' (rede)' : ''}\n  ${c.descricao}`);
    return 0;
  }
  const pedidos = args.filter((a) => !a.startsWith('--'));
  const desconhecidos = pedidos.filter((n) => !todos.some((c) => c.nome === n));
  if (desconhecidos.length) {
    console.error(`cenario(s) desconhecido(s): ${desconhecidos.join(', ')} -- veja --listar`);
    return 2;
  }
  const escolhidos = pedidos.length ? todos.filter((c) => pedidos.includes(c.nome)) : todos;

  if (process.platform !== 'linux') {
    console.error('o laboratorio so roda no Linux (Xvfb + iptables)');
    return 2;
  }
  fs.mkdirSync(SAIDA, { recursive: true });
  const resultados = [];
  for (const cenario of escolhidos) resultados.push(await rodarCenario(cenario));
  const texto = resumo(resultados);
  fs.writeFileSync(path.join(SAIDA, 'resumo.txt'), `${texto}\n`);
  console.log(`\n${texto}`);
  return resultados.every((r) => r.ok) ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => {
  console.error(err);
  process.exit(1);
});
