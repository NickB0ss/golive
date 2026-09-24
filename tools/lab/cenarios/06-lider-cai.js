'use strict';

// Frente A2: o PC de quem criou a sala cai de verdade (SIGKILL, sem fechar
// nada). Os que ficaram tem de se achar de novo na mesma sala -- um vira o
// novo lider -- e o video P2P entre eles nao pode morrer no caminho.
//
// Aqui o app da Ana morre mas a "maquina" continua respondendo: a porta da
// sala recusa na hora (RST no loopback). Duas recusas seguidas provam que a
// sala antiga acabou (src/renderer/leaderloss.js), e os outros migram em
// poucos segundos em vez de esgotar a escada de reconexao (~60 s antes).
// Quando o PC some sem recusar nada, a escada inteira continua valendo:
// cenarios lider-some (pior caso) e lider-volta (queda curta nao parte a
// sala).
module.exports = {
  nome: 'lider-cai',
  descricao: 'Ana cria a sala, Beto transmite e Caio assiste; o PC da Ana cai: Beto e Caio continuam na sala, com a tela do Beto andando.',
  timeoutMs: 240000,
  async rodar(lab) {
    const [ana, beto, caio] = await lab.abrir(['Ana', 'Beto', 'Caio']);
    const endereco = await ana.criarSala();
    await beto.entrar(endereco);
    await caio.entrar(endereco);
    await beto.transmitir();
    await caio.esperarImagemAndando(30000);
    await lab.sleep(5000);

    const queda = Date.now();
    ana.derrubar();

    // Os dois voltam a ter sinalizacao numa sala (welcome depois da queda).
    await Promise.all([beto, caio].map((i) => i.esperarLog(/\[signaling\] welcome: sou #/, { desde: queda, timeoutMs: 150000, descricao: 'welcome numa sala depois da queda do lider' })));
    const lider = [beto, caio].find((i) => i.achar(/\[signaling\] welcome: .*host=sim/, queda).length);
    lab.verificar(Boolean(lider), `alguem assumiu a sala (${lider?.nome})`);
    const recusas = [beto, caio].filter((i) => i.achar(/\[migracao\] a porta da sala recusou/, queda).length);
    lab.verificar(recusas.length > 0, `a porta recusou e a escada foi pulada (${recusas.map((i) => i.nome).join(', ')})`);
    await caio.esperar(`!document.getElementById('room-view').classList.contains('hidden')`, 5000, 'Caio continua na tela da sala');
    await beto.esperar(`!document.getElementById('room-view').classList.contains('hidden')`, 5000, 'Beto continua na tela da sala');

    await caio.esperarImagemAndando(30000);
    lab.verificar(true, 'a tela do Beto segue andando no Caio depois da migracao');
    lab.passo(`migracao completa em ${((Date.now() - queda) / 1000).toFixed(1)}s`);
  },
};
