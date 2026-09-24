'use strict';

// A protecao que a escada de reconexao da (src/renderer/reconnect.js): o PC
// de quem criou a sala some por 40 s -- como uma queda de rota da VPN -- e
// volta. Beto e Caio perdem a sinalizacao (vigia de vida, 15 s), entram na
// escada e reconectam NA SALA DA ANA: ninguem assume uma sala nova, a sala
// nao se parte em duas. O atalho da recusa (leaderloss.js) nao dispara,
// porque sumir nao e recusar.
module.exports = {
  nome: 'lider-volta',
  precisaRede: true,
  descricao: 'O PC da Ana some por 40 s (congelado, TCP da sala descartado) e volta: Beto e Caio reconectam na sala dela e ninguem migra.',
  timeoutMs: 240000,
  async rodar(lab) {
    const [ana, beto, caio] = await lab.abrir(['Ana', 'Beto', 'Caio']);
    const endereco = await ana.criarSala();
    const porta = Number(endereco.split(':').pop());
    await beto.entrar(endereco);
    await caio.entrar(endereco);
    await beto.transmitir();
    await caio.esperarImagemAndando(30000);
    await lab.sleep(5000);

    const queda = Date.now();
    const devolverTcp = await lab.rede.cortarTcpPorta(porta);
    ana.congelar();
    await Promise.all([beto, caio].map((i) => i.esperarLog(/\[signaling\] sessao orfa criada/, { desde: queda, timeoutMs: 30000, descricao: 'perceber a queda (vigia de vida)' })));
    lab.verificar(true, 'os dois perderam a sinalizacao e entraram na escada');
    await lab.sleep(Math.max(0, 40000 - (Date.now() - queda)));
    ana.descongelar();
    await devolverTcp();
    const volta = Date.now();

    await Promise.all([beto, caio].map((i) => i.esperarLog(/\[signaling\] welcome: sou #\d+, host=nao/, { desde: volta, timeoutMs: 60000, descricao: 'welcome na sala da Ana' })));
    lab.passo(`reconectados ${((Date.now() - volta) / 1000).toFixed(1)}s depois da volta`);
    const migracoes = [beto, caio].flatMap((i) => i.achar(/\[migracao\]|host=sim/, queda).map((l) => `${i.nome}: ${l.texto}`));
    lab.verificar(migracoes.length === 0, `ninguem migrou nem assumiu sala nova${migracoes.length ? ` (${migracoes[0].slice(0, 160)})` : ''}`);
    await caio.esperarImagemAndando(30000);
    lab.verificar(true, 'a tela do Beto segue andando no Caio');
  },
};
