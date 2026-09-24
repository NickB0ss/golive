'use strict';

// Partes puras do laboratorio: ler as linhas de log de uma instancia,
// montar as regras de rede e resumir o resultado. Separadas do lab.js pra
// terem teste sem Electron nem Xvfb (verificar.test.js).

/** Linhas que denunciam erro nao tratado: o renderer ("Uncaught ...") ou o
 * processo principal (o logger escreve "uncaughtException no main" e
 * "unhandledRejection no main"). `permitidos` e uma lista de regex pra
 * ruido conhecido do ambiente, sempre com o motivo ao lado no cenario. */
function errosNaoTratados(linhas, permitidos = []) {
  const suspeita = /\bUncaught\b|uncaughtException no main|unhandledRejection no main/;
  return linhas.filter((l) => suspeita.test(l.texto) && !permitidos.some((re) => re.test(l.texto)));
}

/** Linhas que casam com `re`, a partir do instante `desde` (ms epoch). */
function achar(linhas, re, { desde = 0 } = {}) {
  return linhas.filter((l) => l.t >= desde && re.test(l.texto));
}

// So UDP: a midia (RTP/STUN) cai e a sinalizacao (WebSocket, TCP) fica --
// e o cenario "a VPN engasgou mas o app continua conectado".
//
// Em TODAS as interfaces, nao so na `lo`: na CI (runner do GitHub, com STUN
// respondendo) o cenario queda-longa nunca congelava cortando so a `lo` --
// provavelmente porque o ICE tambem tem um par srflx, que sai pela internet
// e volta pelo NAT entrando pela eth0, e a midia trocava de caminho. O DNS
// (porta 53) fica de fora pra nao derrubar a maquina junto.
const BASE_UDP = ['INPUT', '-p', 'udp', '-m', 'multiport', '!', '--ports', '53'];

/** Argumentos do iptables pra inserir (`-I`) ou remover (`-D`) uma regra.
 * `perda` entre 0 e 1 descarta essa fracao dos pacotes; sem ela, todos. */
function regraUdp(acao, { perda = null } = {}) {
  if (acao !== '-I' && acao !== '-D') throw new Error(`acao invalida: ${acao}`);
  const args = [acao, ...BASE_UDP];
  if (perda != null) {
    if (!(perda > 0 && perda < 1)) throw new Error(`perda fora de (0, 1): ${perda}`);
    args.push('-m', 'statistic', '--mode', 'random', '--probability', String(perda));
  }
  args.push('-j', 'DROP');
  return args;
}

/** Argumentos do iptables pra descartar o TCP da `porta` (inclusive no
 * loopback) num sentido: `dport` o que chega nela, `sport` o que sai dela.
 * Os dois juntos fazem a sala de quem "some": SYN sem resposta e nenhum
 * FIN/RST de volta, como PC desligado ou rota da VPN caida -- e nao a
 * recusa (RST) de um app morto. */
function regraTcp(acao, porta, sentido = 'dport') {
  if (acao !== '-I' && acao !== '-D') throw new Error(`acao invalida: ${acao}`);
  if (!(Number.isInteger(porta) && porta > 0 && porta <= 65535)) throw new Error(`porta invalida: ${porta}`);
  if (sentido !== 'dport' && sentido !== 'sport') throw new Error(`sentido invalido: ${sentido}`);
  return [acao, 'INPUT', '-p', 'tcp', `--${sentido}`, String(porta), '-j', 'DROP'];
}

/** Todos os descendentes de `raiz` (sem ela), dada a lista [pid, ppid] de
 * cada processo: o Electron sobe GPU, rede e renderer como filhos. */
function descendentes(pares, raiz) {
  const filhos = new Map();
  for (const [pid, ppid] of pares) {
    if (!filhos.has(ppid)) filhos.set(ppid, []);
    filhos.get(ppid).push(pid);
  }
  const out = [];
  const fila = [raiz];
  while (fila.length) {
    for (const f of filhos.get(fila.shift()) || []) {
      if (f === raiz || out.includes(f)) continue;
      out.push(f);
      fila.push(f);
    }
  }
  return out;
}

/** Texto do resumo final: uma linha por cenario, e o motivo das falhas. */
function resumo(resultados) {
  const linhas = resultados.map((r) => {
    const s = (r.ms / 1000).toFixed(0);
    return `${r.ok ? 'ok  ' : 'FALHOU'} ${r.nome} (${s}s)${r.ok ? '' : `\n       ${r.erro}`}`;
  });
  const falhas = resultados.filter((r) => !r.ok).length;
  linhas.push(falhas ? `${falhas} de ${resultados.length} cenario(s) falharam` : `${resultados.length} cenario(s) ok`);
  return linhas.join('\n');
}

module.exports = { errosNaoTratados, achar, regraUdp, regraTcp, descendentes, resumo };
