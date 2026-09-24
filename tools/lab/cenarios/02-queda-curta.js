'use strict';

// C5: a VPN engasga uns segundos e volta. O Chromium 152 so declara
// 'disconnected' ~6,5 s depois do ultimo pacote; 1 s depois disso o lado que
// oferta reinicia o ICE na mesma conexao. Nove segundos de corte deixam o
// reinicio acontecer com o UDP ainda fora.
module.exports = {
  nome: 'queda-curta',
  precisaRede: true,
  descricao: 'UDP cortado por 9 s entre Ana (transmitindo) e Beto: a Ana reinicia o ICE na mesma conexao e a imagem volta.',
  async rodar(lab) {
    const [ana, beto] = await lab.abrir(['Ana', 'Beto']);
    const endereco = await ana.criarSala();
    await ana.transmitir();
    await beto.entrar(endereco);
    await beto.esperarImagemAndando(30000);
    // O vigia de congelamento olha a cada 2 s: sem esta folga, a falha
    // chegaria antes de ele ver a primeira imagem.
    await lab.sleep(5000);

    const corte = Date.now();
    await lab.rede.cortarUdp(9000);

    await ana.esperarLog(/\[mesh\] conexao de saida para #\d+ \(kind=screen\) em 'disconnected'/, { desde: corte, timeoutMs: 5000, descricao: "saida em 'disconnected'" });
    await ana.esperarLog(/reiniciando o ICE na mesma conexao/, { desde: corte, timeoutMs: 5000, descricao: 'reinicio de ICE (C5)' });
    lab.verificar(true, 'a Ana reiniciou o ICE durante a queda (C5)');

    await beto.esperarImagemAndando(20000);
    lab.verificar(true, 'a imagem voltou no Beto');
    const refeita = beto.achar(/pedindo pra refazer a conexao/, corte).length > 0;
    lab.passo(`conexao ${refeita ? 'refeita pelo vigia de congelamento' : 'recuperada sem ser refeita'}`);
  },
};
