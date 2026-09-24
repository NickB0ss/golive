'use strict';

// Resposta ao getDisplayMedia do renderer (setDisplayMediaRequestHandler).
//
// Duas armadilhas do Electron 44, medidas no app rodando (Xvfb, 23/09):
//   - recusar com `callback({})` FUNCIONA (o getDisplayMedia do renderer
//     rejeita com AbortError), mas o callback ainda LANCA "Video was
//     requested, but no video stream was provided";
//   - o callback so pode ser chamado uma vez. O `.then(...).catch(() =>
//     callback({}))` antigo pegava aquele erro e chamava de novo, e o log
//     ganhava um "One-time callback was called more than once" solto.
// Aqui o callback e chamado no maximo uma vez e o erro vira uma linha de log
// que diz o que aconteceu.

/** Streams a entregar, ou null quando a fonte escolhida sumiu da lista
 * (janela fechada, ou a captura da tela falhou ao iniciar). Nunca cai pra
 * `sources[0]`: seria compartilhar a area de trabalho inteira calado. */
function pickDisplayMediaStreams({ sources, selectedId, audioMode }) {
  const chosen = (sources || []).find((s) => s.id === selectedId);
  if (!chosen) return null;
  // 'loopback' so no modo 'system'; nos modos 'none' e 'device' o
  // getDisplayMedia nao carrega audio (o modo 'device' e adicionado pelo
  // renderer via getUserMedia, fora deste handler).
  return { video: chosen, audio: audioMode === 'system' ? 'loopback' : undefined };
}

/** Embrulha o callback: a primeira chamada vale, as seguintes sao
 * ignoradas, e um erro lancado por ele e logado em vez de subir. `log`
 * recebe uma string. */
function replyOnce(callback, log) {
  let answered = false;
  return (streams) => {
    if (answered) return false;
    answered = true;
    const denying = !streams || !streams.video;
    try {
      callback(denying ? {} : streams);
    } catch (err) {
      // Na recusa o erro e o Electron 44 reclamando do `{}` que ele mesmo
      // pede: a recusa ja chegou no renderer. Na entrega, e defeito de
      // verdade e tem de aparecer.
      if (!denying) log(`captura: o Electron recusou a fonte escolhida: ${err?.message || err}`);
    }
    return true;
  };
}

module.exports = { pickDisplayMediaStreams, replyOnce };
