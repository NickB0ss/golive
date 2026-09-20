'use strict';

const fs = require('fs');
const { app } = require('electron');

const features = 'WebRtcAllowH264Send,AllowWgcScreenCapturer,AllowWgcWindowCapturer,AllowWgcDesktopCapturer';
const metodo = process.env.GOLIVE_FLAG_METHOD;
const destino = process.env.GOLIVE_PROBE_OUTPUT;

if (metodo === 'appendSwitch') app.commandLine.appendSwitch('enable-features', features);
else if (metodo === 'appendArgument') app.commandLine.appendArgument(`--enable-features=${features}`);
else throw new Error('GOLIVE_FLAG_METHOD precisa ser appendSwitch ou appendArgument');

if (!destino) throw new Error('GOLIVE_PROBE_OUTPUT precisa apontar para um arquivo temporario');

// O binario GUI do Windows pode nao ter stdout; o arquivo deixa a comparacao
// dos dois metodos visivel mesmo quando o Electron roda sem terminal.
void app.whenReady().then(() => {
  fs.writeFileSync(destino, JSON.stringify({
    electron: process.versions.electron,
    metodo,
    recebido: app.commandLine.getSwitchValue('enable-features'),
  }));
  app.quit();
}).catch((err) => {
  fs.writeFileSync(destino, JSON.stringify({ erro: err.message }));
  app.exit(1);
});
