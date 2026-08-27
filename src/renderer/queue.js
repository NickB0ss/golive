'use strict';

(function (root) {
  // Fila serial: encadeia funcoes assincronas numa unica cadeia de promises,
  // de modo que a proxima so comece depois que a anterior tiver TERMINADO.
  //
  // Existe por causa da corrida de sinalizacao da auditoria de 2026-08-27,
  // item A1: o `onMessage` do WebSocket chamava um handler `async` sem
  // aguardar o retorno, entao duas mensagens seguidas rodavam concorrentes e
  // uma 'ice' podia atropelar o `await setRemoteDescription` da 'offer' que
  // veio antes dela. Como o WebSocket ja entrega as mensagens em ordem, uma
  // fila UNICA por sessao devolve a ordem total que o protocolo assume.
  //
  // A cadeia NAO pode quebrar: um handler que rejeita (peer que saiu no meio
  // da negociacao, SDP invalido) nao pode deixar todas as mensagens
  // seguintes da sessao presas pra sempre.
  function createSerialQueue() {
    let tail = Promise.resolve();

    function push(fn) {
      // O resultado devolvido a quem chamou vem desta cadeia; a cadeia
      // interna (`tail`) usa uma derivacao ja neutralizada por `catch`, pra
      // que a falha de uma `fn` nunca envenene a proxima. `Promise.resolve()
      // .then` tambem cobre a `fn` SINCRONA que lanca -- o throw vira
      // rejeicao dentro do then, nao uma excecao no chamador de `push`.
      const result = tail.then(() => fn());
      tail = result.catch(() => {});
      return result;
    }

    return { push };
  }

  const api = { createSerialQueue };

  root.GoLive = root.GoLive || {};
  root.GoLive.queue = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
