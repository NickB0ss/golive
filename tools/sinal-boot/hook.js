'use strict';

/*
 * Boot do app real (Electron) para conferir a interface: coleta erros de console e falhas de carga da janela
 * principal, tira um print depois de estabilizar e sai. Carregado por NODE_OPTIONS=--require (ver rodar.js).
 *
 * SINAL_BOOT_OUT: pasta de saida (boot.json + boot.png). SINAL_BOOT_W/H: tamanho da janela (padrao 1440x900).
 * SINAL_BOOT_SCRIPT: arquivo .js opcional executado na pagina antes do print (monta estados via window.GoLive.ui).
 */

const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.SINAL_BOOT_OUT;
const W = Number(process.env.SINAL_BOOT_W) || 1440;
const H = Number(process.env.SINAL_BOOT_H) || 900;
const ROTEIRO = process.env.SINAL_BOOT_SCRIPT;
// A janela principal e servida pela origem propria do app (http://localhost/index.html).
const ehPrincipal = (url) => /^(https?:\/\/localhost\/index\.html|file:.*renderer\/index\.html)($|[?#])/.test(url);

setImmediate(() => {
  // require('electron') so aqui dentro: no topo do hook o modulo ainda nao existe.
  const { app } = require('electron');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');

  const erros = [];
  const avisos = [];
  const limite = setTimeout(() => terminar(2, 'tempo esgotado sem a janela principal'), 60000);

  function terminar(codigo, motivo) {
    clearTimeout(limite);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'boot.json'), JSON.stringify({ motivo, erros, avisos }, null, 2));
    app.exit(codigo);
  }

  app.on('browser-window-created', (_evento, win) => {
    const wc = win.webContents;
    wc.on('console-message', (...args) => {
      // Electron novo passa um objeto; o antigo, (evento, nivel, mensagem, linha, origem).
      const e = args[0] && typeof args[0].message === 'string' ? args[0] : null;
      const nivel = e ? e.level : args[1];
      const texto = e ? `${e.message} (${e.sourceId}:${e.lineNumber})` : `${args[2]} (${args[4]}:${args[3]})`;
      if (!ehPrincipal(wc.getURL())) return;
      if (nivel === 'error' || nivel === 3) erros.push(texto);
      else if (nivel === 'warning' || nivel === 2) avisos.push(texto);
    });
    wc.on('did-fail-load', (_e, codigo, descricao, url) => erros.push(`did-fail-load ${codigo} ${descricao} ${url}`));
    wc.on('render-process-gone', (_e, detalhes) => erros.push(`render-process-gone ${detalhes.reason}`));
    wc.on('did-finish-load', async () => {
      if (process.env.SINAL_BOOT_DEBUG) console.log('[sinal-boot] carregou', wc.getURL());
      if (!ehPrincipal(wc.getURL())) return;
      try {
        win.setContentSize(W, H);
        await new Promise((r) => { setTimeout(r, 3000); });
        if (ROTEIRO) {
          const codigo = fs.readFileSync(ROTEIRO, 'utf8');
          const resultado = await wc.executeJavaScript(codigo, true);
          if (resultado) avisos.push(`roteiro: ${JSON.stringify(resultado)}`);
          await new Promise((r) => { setTimeout(r, 800); });
        }
        wc.invalidate();
        await wc.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
        const img = await wc.capturePage();
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, 'boot.png'), img.toPNG());
        terminar(erros.length ? 1 : 0, 'ok');
      } catch (err) {
        erros.push(`hook: ${err && err.stack ? err.stack : err}`);
        terminar(1, 'falha no hook');
      }
    });
  });
});
