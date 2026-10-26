'use strict';

// Tela parada nao e pane (logs de 2026-10-07 e spike de 2026-10-25): a
// captura so entrega quadro quando a tela muda, e o relay do app repete o
// ultimo quadro para o fio nao ficar mudo. Sem isso o vigia do Beto lia
// "origem parou de enviar video" e refazia a conexao a cada tela parada.
module.exports = {
  nome: 'tela-parada',
  descricao: 'A imagem da Ana para de mudar por 20 s: quadros seguem chegando no Beto, sem diagnostico "origem" nem conexao refeita.',
  async rodar(lab) {
    const [ana, beto] = await lab.abrir(['Ana', 'Beto']);
    const endereco = await ana.criarSala();
    await ana.transmitir();
    await beto.entrar(endereco);
    await beto.esperarImagemAndando(30000);
    // O vigia de congelamento olha a cada 2 s: sem esta folga, a falha
    // chegaria antes de ele ver a primeira imagem.
    await lab.sleep(5000);

    const inicio = Date.now();
    const antes = await beto.quadrosRemotos();
    await ana.pararImagem();
    lab.passo('imagem da Ana parada');
    await lab.sleep(20000);
    const depois = await beto.quadrosRemotos();
    await ana.retomarOrigem();
    lab.passo(`quadros no Beto com a imagem parada: ${antes} -> ${depois}`);

    // O relay repete a ~5 quadros/s: 20 s parados dao ~100. Contador menor
    // que o de antes e tile recriado, ou seja, reoferta.
    lab.verificar(depois >= antes + 40, 'quadros continuam chegando com a imagem parada');
    lab.igual(beto.achar(/origem parou de enviar video/, inicio).length, 0, 'sem diagnostico "origem" com a imagem parada');
    lab.igual(beto.achar(/pedindo pra refazer a conexao/, inicio).length, 0, 'nenhuma conexao refeita por tela parada');
    await beto.esperarImagemAndando(15000);
    lab.igual(await beto.avisoNoTile(), '', 'tile sem aviso de congelamento');
  },
};
