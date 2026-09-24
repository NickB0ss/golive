'use strict';

// Driver do laboratorio (H15, docs/2026-09-23-analise-transmissao-hipoteses.md).
//
// Carregado no processo principal de cada instancia do app com
// `electron -r tools/lab/driver.js .`, por tools/lab/lab.js. Nao sabe nada de
// cenario: so obedece comandos que chegam pelo canal IPC do child_process
// (`process.on('message')`) e devolve o console do renderer pelo mesmo
// canal. Toda a logica de "o que fazer" e "o que conferir" mora no
// orquestrador, que roda em Node puro.
//
// Nunca e empacotado (package.json > build.files so leva src/ e server/).

const fs = require('fs');
const { app, BrowserWindow } = require('electron');

let win = null;

function send(msg) {
  try {
    if (process.send) process.send(msg);
  } catch {
    /* orquestrador ja foi embora */
  }
}

app.on('browser-window-created', (_event, w) => {
  // Electron 44 entrega um objeto de evento com message/level; versoes
  // antigas mandavam (event, level, message). Os dois formatos sao aceitos.
  w.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
    const texto = event?.message ?? legacyMessage;
    const nivel = event?.level ?? legacyLevel;
    send({ evento: 'console', nivel: String(nivel), texto: String(texto), t: Date.now() });
  });
});

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function mainWindow(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const found = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().endsWith('/index.html'));
    if (found && !found.webContents.isLoading()) return found;
    await sleep(200);
  }
  throw new Error(`janela principal nao apareceu em ${timeoutMs} ms`);
}

/** A janela principal, ou outra pelo fim da URL (`'espiar.html'`). */
function janelaAlvo(janela) {
  if (!janela) return win;
  const alvo = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().endsWith(`/${janela}`));
  if (!alvo) throw new Error(`janela ${janela} nao esta aberta`);
  return alvo;
}

const comandos = {
  /** Espera a janela principal carregar e fixa o tamanho (prints comparaveis). */
  pronto({ timeoutMs = 60000 }) {
    return mainWindow(timeoutMs).then((principal) => {
      win = principal;
      win.setSize(1440, 900);
      return true;
    });
  },
  /** Roda codigo no renderer (mundo principal da pagina) e devolve o
   * resultado. `janela` escolhe outra janela do app (ver janelaAlvo). */
  async js({ codigo, janela }) {
    const alvo = janelaAlvo(janela);
    if (!alvo || alvo.isDestroyed()) throw new Error('sem janela');
    return alvo.webContents.executeJavaScript(String(codigo), true);
  },
  /** Recarrega a pagina e espera terminar (usado depois de gravar a config). */
  async recarregar({ timeoutMs = 30000 }) {
    win.webContents.reload();
    await sleep(300);
    return mainWindow(timeoutMs).then((recarregada) => {
      win = recarregada;
      return true;
    });
  },
  /** Print da janela principal, ou de outra pelo fim da URL
   * (`janela: 'espiar.html'`) -- o Espiar e uma janela a parte. */
  async print({ caminho, janela }) {
    const img = await janelaAlvo(janela).webContents.capturePage();
    fs.writeFileSync(caminho, img.toPNG());
    return caminho;
  },
  async telaCheia() {
    return Boolean(win?.isFullScreen());
  },
  /** Saida normal (app.quit), pra o app fechar sala e servidor como faria de verdade. */
  async sair() {
    setTimeout(() => app.quit(), 50);
    return true;
  },
};

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object' || !msg.id) return;
  const fn = comandos[msg.cmd];
  try {
    if (!fn) throw new Error(`comando desconhecido: ${msg.cmd}`);
    const resultado = await fn(msg.args || {});
    send({ id: msg.id, ok: true, resultado });
  } catch (err) {
    send({ id: msg.id, ok: false, erro: String(err?.message || err) });
  }
});

// Orquestrador morreu (Ctrl+C, timeout do CI): nao deixar instancia orfa.
process.on('disconnect', () => app.exit(0));
