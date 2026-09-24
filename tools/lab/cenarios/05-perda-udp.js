'use strict';

// Rede ruim mas viva: 3% de perda no UDP por 20 s. NACK e retransmissao
// tem de segurar -- o vigia de congelamento nao pode confundir perda com
// queda e refazer a conexao.
module.exports = {
  nome: 'perda-udp',
  precisaRede: true,
  descricao: '3% de perda no UDP por 20 s: a imagem do Beto segue andando e ninguem refaz a conexao.',
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
    const tirarPerda = await lab.rede.perdaUdp(0.03);
    for (let i = 0; i < 4; i += 1) {
      await lab.sleep(3500);
      await beto.esperarImagemAndando(5000);
    }
    await tirarPerda();
    lab.verificar(true, 'a imagem andou durante toda a perda');
    lab.igual(beto.achar(/pedindo pra refazer a conexao/, inicio).length, 0, 'nenhuma conexao refeita por engano');
  },
};
