'use strict';

// Frente A2: o PC de quem criou a sala cai de verdade (SIGKILL, sem fechar
// nada). Os que ficaram tem de se achar de novo na mesma sala -- um vira o
// novo lider -- e o video P2P entre eles nao pode morrer no caminho.
//
// Demora por desenho: na queda abrupta todos tentam reconectar no lider
// morto ate esgotar a escada de reconexao (src/renderer/reconnect.js) antes
// de migrar, pra uma queda de rota da VPN nao partir a sala. Aqui o PC morto
// recusa na hora (RST no loopback) e a migracao leva ~60 s; com SYN sem
// resposta, o pior caso calculado passa de 2 min.
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
    await caio.esperar(`!document.getElementById('room-view').classList.contains('hidden')`, 5000, 'Caio continua na tela da sala');
    await beto.esperar(`!document.getElementById('room-view').classList.contains('hidden')`, 5000, 'Beto continua na tela da sala');

    await caio.esperarImagemAndando(30000);
    lab.verificar(true, 'a tela do Beto segue andando no Caio depois da migracao');
    lab.passo(`migracao completa em ${((Date.now() - queda) / 1000).toFixed(1)}s`);
  },
};
