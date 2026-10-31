// Roteiro do Electron real. Executar com perfil isolado:
// node tools/sinal-boot/rodar.js lab-out/community/qa tools/sinal-boot/comunidade.js 960x600
/* global document, window, KeyboardEvent, innerWidth, innerHeight */
(async () => {
  const $ = (id) => document.getElementById(id);
  const exigir = (condicao, mensagem) => { if (!condicao) throw new Error(mensagem); };
  const guia = $('tour-dialog');
  const ajuda = $('comunidade-dialog');
  const { t } = window.GoLive.i18n;
  exigir(document.documentElement.dataset.golivePronto === '1', 'boot ainda incompleto');
  exigir(guia.open, 'primeira abertura deve oferecer o tour');
  exigir($('tour-voltar').disabled, 'primeiro passo nao deve permitir voltar');
  const titulos = ['perfil', 'sala', 'tela', 'mesa', 'apoio'];
  for (const nome of titulos) {
    exigir($('tour-titulo').textContent === t(`tour.${nome}.titulo`), `passo incorreto: ${nome}`);
    exigir(document.activeElement === $('tour-titulo'), 'foco deve acompanhar o titulo da etapa');
    $('tour-avancar').click();
  }
  exigir(!guia.open && localStorage.getItem('golive:tour:v1') === 'concluido', 'conclusao nao persistiu');
  exigir(document.activeElement !== document.body, 'tour deve devolver o foco a um controle utilizavel');
  $('btn-comunidade').focus();
  $('btn-comunidade').click();
  exigir(ajuda.matches(':modal'), 'ajuda deve ser modal');
  exigir($('comunidade-pix').textContent === '6d947798-9d1e-4af9-8a4c-2c11123752c7', 'chave Pix incorreta');
  $('home-name').focus();
  exigir(ajuda.contains(document.activeElement), 'foco escapou para o fundo');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  exigir($('command-palette').classList.contains('hidden'), 'atalho global atravessou o modal');

  // Nao altera a area de transferencia da pessoa durante a verificacao.
  const escreverAntes = navigator.clipboard.writeText;
  let copiado;
  navigator.clipboard.writeText = async (valor) => { copiado = valor; };
  $('comunidade-copiar').click();
  await new Promise((r) => { setTimeout(r, 0); });
  exigir(copiado === '6d947798-9d1e-4af9-8a4c-2c11123752c7', 'botao nao copiou a chave');
  exigir($('comunidade-status').textContent === t('comunidade.copiado'), 'copia sem confirmacao');
  navigator.clipboard.writeText = async () => { throw new Error('copia bloqueada'); };
  $('comunidade-copiar').click();
  await new Promise((r) => { setTimeout(r, 0); });
  exigir($('comunidade-status').textContent === t('comunidade.erroCopiar'), 'copia bloqueada sem instrucao');
  navigator.clipboard.writeText = escreverAntes;

  const recusado = await window.golive.abrirApoio('https://example.com');
  exigir(recusado.ok === false && recusado.reason === 'recusado', 'IPC aceitou URL arbitraria');
  $('comunidade-tour').click();
  exigir(!ajuda.open && guia.open, 'rever deve trocar ajuda pelo tour');
  exigir($('tour-voltar').disabled, 'rever nao comecou no inicio');
  $('tour-avancar').click();
  $('tour-voltar').click();
  exigir($('tour-titulo').textContent === t('tour.perfil.titulo'), 'voltar nao retornou ao primeiro passo');
  $('tour-titulo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  exigir(!guia.open && localStorage.getItem('golive:tour:v1') === 'pulado', 'Esc deve pular e persistir');
  exigir(document.activeElement === $('btn-comunidade'), 'foco nao voltou ao acesso da ajuda');
  $('btn-comunidade').click();
  $('comunidade-fechar').dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
  exigir(!ajuda.open, 'Esc nao fechou ajuda');
  $('btn-comunidade').click();
  $('comunidade-status').textContent = '';
  const r = ajuda.getBoundingClientRect();
  exigir(r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
    'dialogo ultrapassou a janela');
  exigir(ajuda.scrollWidth <= ajuda.clientWidth, 'ajuda tem rolagem horizontal');
  return { ok: true, tamanho: [innerWidth, innerHeight], idioma: window.GoLive.i18n.idiomaAtivo(),
    tour: 'avancar, voltar, concluir, rever e pular', foco: 'contido e devolvido',
    pix: 'copia e erro', links: 'IPC recusa URL arbitraria' };
})();
