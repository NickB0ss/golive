'use strict';

(function (root) {
  const CHAVE_TOUR = 'golive:tour:v1';
  const PASSOS = Object.freeze([
    { nome: 'perfil', icone: 'circle-user', itens: ['nome', 'rede'] },
    { nome: 'sala', icone: 'users', itens: ['criar', 'entrar'] },
    { nome: 'tela', icone: 'monitor', itens: ['transmitir', 'assistir'] },
    { nome: 'mesa', icone: 'diamond', itens: ['janelas', 'conversa'] },
    { nome: 'apoio', icone: 'circle-help', itens: ['sugerir', 'doar'] },
  ]);

  // Independente do perfil/nome: atualizar as configuracoes nao repete o tour.
  function criarTour(storage) {
    let visto = false;
    let passo = 0;
    try { visto = ['concluido', 'pulado'].includes(storage.getItem(CHAVE_TOUR)); } catch { /* sem persistencia */ }
    function registrar(estado) {
      visto = true;
      try { storage.setItem(CHAVE_TOUR, estado); } catch { /* continua utilizavel nesta sessao */ }
    }
    return {
      deveAbrir: () => !visto,
      indice: () => passo,
      reiniciar: () => { passo = 0; },
      voltar: () => { passo = Math.max(0, passo - 1); },
      avancar: () => {
        if (passo < PASSOS.length - 1) { passo++; return true; }
        registrar('concluido');
        return false;
      },
      pular: () => registrar('pulado'),
    };
  }

  function init({ doc, storage, bridge, clipboard, t }) {
    const $ = (id) => doc.getElementById(id);
    const ajuda = $('comunidade-dialog');
    const guia = $('tour-dialog');
    const tour = criarTour(storage);
    let focoAnterior = null;
    $('comunidade-pix').textContent = root.GoLive.comunidade.PIX;

    function abrir(dialogo) {
      focoAnterior = doc.activeElement;
      dialogo.showModal();
    }
    function fechar(dialogo) {
      dialogo.close();
      const destino = focoAnterior?.isConnected ? focoAnterior : $('btn-comunidade');
      destino.focus({ preventScroll: true });
    }
    function renderPasso() {
      const indice = tour.indice();
      const passo = PASSOS[indice];
      $('tour-progresso').textContent = t('tour.progresso', { atual: indice + 1, total: PASSOS.length });
      $('tour-titulo').textContent = t(`tour.${passo.nome}.titulo`);
      $('tour-descricao').textContent = t(`tour.${passo.nome}.descricao`);
      $('tour-icone').setAttribute('href', `#i-${passo.icone}`);
      passo.itens.forEach((item, i) => {
        $(`tour-item-${i}-titulo`).textContent = t(`tour.${item}.titulo`);
        $(`tour-item-${i}-texto`).textContent = t(`tour.${item}.texto`);
      });
      $('tour-voltar').disabled = indice === 0;
      $('tour-avancar').textContent = t(indice === PASSOS.length - 1 ? 'tour.concluir' : 'tour.proximo');
    }
    function abrirTour() {
      tour.reiniciar();
      renderPasso();
      abrir(guia);
      $('tour-titulo').focus();
    }
    function pular() {
      tour.pular();
      fechar(guia);
    }

    // Dialog nativo mantem Tab dentro da superficie e torna o fundo inerte.
    // Nao deixa atalhos globais do app agirem por tras da ajuda/tour.
    for (const dialogo of [ajuda, guia]) {
      dialogo.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          if (dialogo === guia) pular();
          else fechar(ajuda);
        }
      });
      dialogo.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (dialogo === guia) pular();
        else fechar(ajuda);
      });
    }
    $('btn-comunidade').addEventListener('click', () => {
      $('comunidade-status').textContent = '';
      abrir(ajuda);
    });
    $('comunidade-fechar').addEventListener('click', () => fechar(ajuda));
    $('comunidade-tour').addEventListener('click', () => {
      fechar(ajuda);
      abrirTour();
    });
    $('tour-pular').addEventListener('click', pular);
    $('tour-voltar').addEventListener('click', () => { tour.voltar(); renderPasso(); $('tour-titulo').focus(); });
    $('tour-avancar').addEventListener('click', () => {
      if (tour.avancar()) { renderPasso(); $('tour-titulo').focus(); }
      else fechar(guia);
    });
    $('comunidade-copiar').addEventListener('click', async () => {
      try {
        await clipboard.writeText(root.GoLive.comunidade.PIX);
        $('comunidade-status').textContent = t('comunidade.copiado');
      } catch {
        $('comunidade-status').textContent = t('comunidade.erroCopiar');
      }
    });
    ajuda.querySelectorAll('[data-apoio-link]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        botao.disabled = true;
        try {
          const resultado = await bridge.abrirApoio(botao.dataset.apoioLink);
          $('comunidade-status').textContent = t(resultado?.ok ? 'comunidade.aberto' : 'comunidade.erroAbrir');
        } catch {
          $('comunidade-status').textContent = t('comunidade.erroAbrir');
        } finally {
          botao.disabled = false;
        }
      });
    });
    if (tour.deveAbrir()) abrirTour();
  }

  const api = { criarTour, CHAVE_TOUR, PASSOS, init };
  root.GoLive = root.GoLive || {};
  root.GoLive.boasVindas = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
