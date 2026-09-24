'use strict';

// Laboratorio automatizado (H15): varias instancias do app na mesma maquina
// Linux, cada uma num Xvfb, com captura de tela falsa (canvas animado) e
// falhas de rede de verdade (iptables no UDP). Nao testa o encoder de hardware; testa a
// orquestracao inteira -- sala, arvore, retomada, demanda, vigia de
// congelamento, reinicio de ICE -- que e onde mora a maioria das telas pretas
// do historico.
//
// Cada instancia e um processo do Electron com tools/lab/driver.js carregado;
// este arquivo manda comandos pelo canal IPC e junta o console de todas.
// Os cenarios ficam em tools/lab/cenarios/ e o runner em tools/lab/run.js.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { achar, regraUdp } = require('./verificar');

const RAIZ = path.resolve(__dirname, '..', '..');
const DRIVER = path.join(__dirname, 'driver.js');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function electronBin() {
  // Em Node, require('electron') devolve o caminho do binario.
  const bin = require('electron');
  if (typeof bin !== 'string' || !fs.existsSync(bin)) {
    throw new Error('binario do Electron ausente -- rode `node node_modules/electron/install.js`');
  }
  return bin;
}

/** Repete `fn` ate devolver algo verdadeiro, ou falha com `descricao`. */
async function ate(fn, { timeoutMs, intervaloMs = 250, descricao }) {
  const t0 = Date.now();
  let ultimoErro = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      ultimoErro = err;
    }
    await sleep(intervaloMs);
  }
  const extra = ultimoErro ? ` (ultimo erro: ${ultimoErro.message})` : '';
  throw new Error(`esperei ${Math.round(timeoutMs / 1000)}s por: ${descricao}${extra}`);
}

// Displays em sequencia a partir de um ponto aleatorio: instancias subindo
// em paralelo nunca disputam o mesmo numero.
let proximoDisplay = 100 + Math.floor(Math.random() * 300);

/** Sobe um Xvfb proprio (nao depende de xvfb-run) e devolve o DISPLAY. */
async function iniciarXvfb() {
  if (process.platform !== 'linux') throw new Error('o laboratorio so roda no Linux (Xvfb + iptables)');
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const n = proximoDisplay++;
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`) || fs.existsSync(`/tmp/.X${n}-lock`)) continue;
    const proc = spawn('Xvfb', [`:${n}`, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
    const subiu = await ate(() => fs.existsSync(`/tmp/.X11-unix/X${n}`), { timeoutMs: 10000, descricao: `Xvfb :${n}` }).catch(() => false);
    if (subiu) {
      return {
        display: `:${n}`,
        parar: () => { try { proc.kill('SIGTERM'); } catch { /* ja saiu */ } },
      };
    }
    proc.kill('SIGKILL');
  }
  throw new Error('nao consegui subir o Xvfb');
}

// ---------- Rede ----------

function iptables(args) {
  const [cmd, full] = process.getuid?.() === 0 ? ['iptables', args] : ['sudo', ['-n', 'iptables', ...args]];
  return new Promise((resolve, reject) => {
    execFile(cmd, full, (err, _stdout, stderr) => (err ? reject(new Error(`iptables ${args.join(' ')}: ${stderr || err.message}`)) : resolve()));
  });
}

/** Falhas de rede (UDP de entrada, todas as interfaces, menos DNS), sempre
 * desfeitas no fim do cenario -- ver regraUdp em verificar.js. */
class Rede {
  constructor(passo) {
    this.passo = passo;
    this.ativas = [];
  }

  static async disponivel() {
    try {
      await iptables(['-L', 'INPUT', '-n']);
      return true;
    } catch {
      return false;
    }
  }

  async inserir(opts, descricao) {
    await iptables(regraUdp('-I', opts));
    this.ativas.push(opts);
    this.passo(`rede: ${descricao}`);
  }

  async remover(opts, descricao) {
    const i = this.ativas.indexOf(opts);
    if (i < 0) return;
    await iptables(regraUdp('-D', opts));
    this.ativas.splice(i, 1);
    this.passo(`rede: ${descricao}`);
  }

  /** Corta todo o UDP (midia) por `ms`; a sinalizacao (TCP) continua. */
  async cortarUdp(ms) {
    const opts = {};
    await this.inserir(opts, `UDP cortado por ${(ms / 1000).toFixed(0)}s`);
    await sleep(ms);
    await this.remover(opts, 'UDP de volta');
  }

  /** Descarta a fracao `perda` do UDP ate `restaurar()` ou a funcao devolvida. */
  async perdaUdp(perda) {
    const opts = { perda };
    await this.inserir(opts, `perda de ${(perda * 100).toFixed(0)}% no UDP`);
    return () => this.remover(opts, 'perda removida');
  }

  async restaurar() {
    for (const opts of [...this.ativas].reverse()) {
      await iptables(regraUdp('-D', opts)).catch(() => {});
    }
    this.ativas = [];
  }
}

// ---------- Instancia do app ----------

// Canvas animado no lugar da captura de tela: a captura X11 do Xvfb falha de
// forma intermitente (tambem no codigo sem mudanca), e o que o laboratorio
// quer medir e o caminho depois dela. `__lab.parar()` congela a origem.
const CAPTURA_FALSA = `(() => {
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 720;
  const g = c.getContext('2d');
  let t = 0;
  let timer = null;
  const desenhar = () => {
    t += 1;
    g.fillStyle = 'hsl(' + (t * 3 % 360) + ',60%,35%)';
    g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#fff';
    g.font = '64px sans-serif';
    g.fillText('laboratorio ' + t, 80, 360);
  };
  window.__lab = {
    retomar() { if (!timer) timer = setInterval(desenhar, 33); },
    parar() { clearInterval(timer); timer = null; },
  };
  window.__lab.retomar();
  navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(30);
  return true;
})()`;

// Primeiro tile de tela de OUTRA pessoa na grade.
const TILE_REMOTO = `[...document.querySelectorAll('#grid .tile')].find((t) => !/^tile-(me|cam-)/.test(t.id) && t.dataset.kind !== 'camera')`;

class Instancia {
  constructor({ nome, dir, passo }) {
    this.nome = nome;
    this.dir = dir;
    this.passo = passo;
    this.linhas = [];
    this.pendentes = new Map();
    this.proximoId = 1;
    this.saiu = null;
    fs.mkdirSync(dir, { recursive: true });
    this.logFile = fs.createWriteStream(path.join(dir, 'console.log'));
  }

  registrar(origem, texto, t = Date.now()) {
    this.linhas.push({ t, origem, texto });
    this.logFile.write(`${new Date(t).toISOString()} [${origem}] ${texto}\n`);
  }

  async iniciar() {
    // Um Xvfb por instancia, como PCs separados: numa tela so, as janelas
    // se cobrem, o Chromium marca a de baixo como oculta e ela para de
    // assistir (e o app faz isso de proposito -- viewhold.js).
    this.xvfb = await iniciarXvfb();
    this.display = this.xvfb.display;
    this.proc = spawn(electronBin(), [
      '--no-sandbox',
      `--user-data-dir=${path.join(this.dir, 'dados')}`,
      '-r', DRIVER,
      RAIZ,
    ], {
      cwd: RAIZ,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, DISPLAY: this.display },
    });
    for (const stream of [this.proc.stdout, this.proc.stderr]) {
      readline.createInterface({ input: stream }).on('line', (l) => {
        // O logger do main reencaminha o console do renderer, que ja chega
        // pelo driver: a copia so duplicaria as linhas.
        if (/\[renderer:\w+\]/.test(l)) return;
        this.registrar('main', l);
      });
    }
    this.proc.on('message', (msg) => {
      if (msg?.evento === 'console') {
        this.registrar(`renderer:${msg.nivel}`, msg.texto, msg.t);
        return;
      }
      const p = this.pendentes.get(msg?.id);
      if (!p) return;
      this.pendentes.delete(msg.id);
      if (msg.ok) p.resolve(msg.resultado);
      else p.reject(new Error(`${this.nome}: ${msg.erro}`));
    });
    this.proc.on('exit', (code, signal) => {
      this.saiu = code ?? signal;
      for (const p of this.pendentes.values()) p.reject(new Error(`${this.nome}: o app saiu (${this.saiu})`));
      this.pendentes.clear();
    });

    await this.chamar('pronto', { timeoutMs: 60000 }, 70000);
    // Nome proprio em cada instancia: e o que aparece nos avisos e no log dos
    // outros ("Sem contato com o PC de Ana").
    await this.js(`localStorage.setItem('golive', JSON.stringify({ ...JSON.parse(localStorage.getItem('golive') || '{}'), name: ${JSON.stringify(this.nome)} }))`);
    await this.chamar('recarregar', {}, 40000);
    await this.esperar(`document.readyState === 'complete' && document.getElementById('btn-create-room')`, 30000, 'lobby carregado');
    // A tela de carregamento do app pode segurar um instante depois do load.
    await sleep(1500);
    this.passo(`${this.nome} pronta`);
  }

  chamar(cmd, args = {}, timeoutMs = 30000) {
    if (this.saiu !== null) return Promise.reject(new Error(`${this.nome}: o app ja saiu (${this.saiu})`));
    const id = this.proximoId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new Error(`${this.nome}: comando '${cmd}' sem resposta em ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pendentes.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc.send({ id, cmd, args });
    });
  }

  js(codigo) {
    return this.chamar('js', { codigo });
  }

  esperar(expr, timeoutMs, descricao) {
    return ate(() => this.js(`Boolean(${expr})`), { timeoutMs, descricao: `${this.nome}: ${descricao}` });
  }

  achar(re, desde = 0) {
    return achar(this.linhas, re, { desde });
  }

  esperarLog(re, { desde = 0, timeoutMs = 15000, descricao = String(re) } = {}) {
    return ate(() => this.achar(re, desde)[0], { timeoutMs, descricao: `${this.nome}: log ${descricao}` });
  }

  async print(nome) {
    return this.chamar('print', { caminho: path.join(this.dir, `${nome}.png`) }, 20000).catch(() => null);
  }

  // ---------- Acoes do app ----------

  /** Cria a sala e devolve o endereco pra quem vai entrar (sempre pelo
   * loopback: todas as instancias estao nesta maquina). */
  async criarSala() {
    await this.js(`document.getElementById('btn-create-room').click()`);
    await this.esperar(`!document.getElementById('dialog-create-room').classList.contains('hidden')`, 5000, 'dialogo de criar sala');
    await this.js(`document.getElementById('btn-create-room-confirm').click()`);
    await this.esperar(`!document.getElementById('room-view').classList.contains('hidden')`, 20000, 'entrar na propria sala');
    const endereco = await ate(() => this.js(`document.getElementById('stage-room-address').textContent`), { timeoutMs: 10000, descricao: `${this.nome}: endereco da sala` });
    const porta = endereco.split(':').pop();
    this.passo(`${this.nome} criou a sala (${endereco})`);
    return `127.0.0.1:${porta}`;
  }

  async entrar(endereco) {
    await this.js(`document.getElementById('btn-join-address').click()`);
    await this.esperar(`!document.getElementById('dialog-join-room').classList.contains('hidden')`, 5000, 'dialogo de entrar');
    await this.js(`(() => { const i = document.getElementById('in-server'); i.value = ${JSON.stringify(endereco)}; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('btn-connect').click(); })()`);
    await this.esperar(`!document.getElementById('room-view').classList.contains('hidden')`, 20000, 'entrar na sala');
    this.passo(`${this.nome} entrou na sala`);
  }

  /** Captura falsa + "Compartilhar tela" + "Ir ao vivo". Devolve os nomes
   * das fontes que o seletor mostrou. */
  async transmitir() {
    await this.js(CAPTURA_FALSA);
    await this.js(`document.getElementById('btn-toggle-share').click()`);
    await this.esperar(`!document.getElementById('picker').classList.contains('hidden')`, 5000, 'seletor de fonte');
    // A lista de telas vem do desktopCapturer; se o X11 do Xvfb engasgar,
    // "Atualizar" pede de novo.
    await ate(async () => {
      if (await this.js(`Boolean(document.querySelector('.source-card'))`)) return true;
      await this.js(`document.getElementById('picker-refresh').click()`);
      await sleep(2000);
      return this.js(`Boolean(document.querySelector('.source-card'))`);
    }, { timeoutMs: 30000, intervaloMs: 500, descricao: `${this.nome}: alguma fonte no seletor` });
    const fontes = await this.js(`[...document.querySelectorAll('.source-card .source-name')].map((e) => e.textContent)`);
    await this.js(`document.getElementById('btn-go-live').disabled && document.querySelector('.source-card').click()`);
    await this.js(`document.getElementById('btn-go-live').click()`);
    await this.esperar(`document.getElementById('tile-me')`, 15000, 'o proprio tile ao vivo');
    this.passo(`${this.nome} ao vivo`);
    return fontes;
  }

  pararOrigem() {
    return this.js('window.__lab.parar()');
  }

  retomarOrigem() {
    return this.js('window.__lab.retomar()');
  }

  /** Quadros exibidos pelo tile de tela de outra pessoa (-1 sem tile). */
  quadrosRemotos() {
    return this.js(`(() => { const v = ${TILE_REMOTO}?.querySelector('video'); return v ? v.getVideoPlaybackQuality().totalVideoFrames : -1; })()`);
  }

  /** Espera a tela de outra pessoa ter imagem ANDANDO (quadros subindo). */
  async esperarImagemAndando(timeoutMs = 30000) {
    await ate(async () => {
      const a = await this.quadrosRemotos();
      if (a < 0) return false;
      await sleep(1500);
      const b = await this.quadrosRemotos();
      return b > a + 5;
    }, { timeoutMs, intervaloMs: 200, descricao: `${this.nome}: tela recebida com imagem andando` });
  }

  /** Texto do aviso de congelamento visivel no tile remoto ('' sem aviso). */
  avisoNoTile() {
    return this.js(`(() => { const n = ${TILE_REMOTO}?.querySelector('.tile-stall-note'); return n && !n.classList.contains('hidden') ? n.textContent : ''; })()`);
  }

  /** Mata o processo na hora, como a queda de um PC (sem fechar a sala). */
  derrubar() {
    this.passo(`${this.nome} derrubada (SIGKILL)`);
    try { this.proc.kill('SIGKILL'); } catch { /* ja saiu */ }
  }

  async encerrar() {
    if (this.saiu === null) {
      await this.chamar('sair', {}, 5000).catch(() => {});
      await ate(() => this.saiu !== null, { timeoutMs: 10000, descricao: 'sair' }).catch(() => {
        try { this.proc.kill('SIGKILL'); } catch { /* ja saiu */ }
      });
    }
    this.xvfb?.parar();
    await new Promise((resolve) => { this.logFile.end(resolve); });
  }
}

module.exports = { Instancia, Rede, iniciarXvfb, ate, sleep, RAIZ };
