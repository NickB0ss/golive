'use strict';

// Pior caso da Frente A2: o PC de quem criou a sala some sem responder nada
// -- desligou, travou, ou a rota da VPN ate ele caiu. Ninguem recusa a
// conexao, entao nao ha como saber que ele morreu: os outros esperam a
// escada de reconexao inteira (src/renderer/reconnect.js) antes de migrar,
// e o atalho da recusa (src/renderer/leaderloss.js) NAO pode disparar.
//
// Como se faz o "sumir" aqui: o TCP da porta da sala e descartado nos dois
// sentidos (SYN sem resposta, nenhum FIN/RST de volta) e so depois o app da
// Ana morre. No laboratorio todos estao no MESMO IP, entao o sucessor sobe
// a sala nova na mesma porta que a Ana usava; o descarte sai quando alguem
// anuncia "minha vez" -- a partir dai 127.0.0.1:porta e o sucessor, como o
// IP dele seria com PCs de verdade.
module.exports = {
  nome: 'lider-some',
  precisaRede: true,
  descricao: 'Como lider-cai, mas o PC da Ana some sem recusar nada (TCP da sala descartado): a migracao espera a escada inteira e ainda assim acontece.',
  timeoutMs: 300000,
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
    ana.derrubar();

    await lab.ate(() => [beto, caio].some((i) => i.achar(/\[migracao\] minha vez/, queda).length), { timeoutMs: 220000, intervaloMs: 100, descricao: 'alguem assumir a sala' });
    lab.passo(`alguem assumiu ${((Date.now() - queda) / 1000).toFixed(1)}s depois do sumico`);
    await devolverTcp();

    await Promise.all([beto, caio].map((i) => i.esperarLog(/\[signaling\] welcome: sou #/, { desde: queda, timeoutMs: 60000, descricao: 'welcome numa sala depois do sumico do lider' })));
    const lider = [beto, caio].find((i) => i.achar(/\[signaling\] welcome: .*host=sim/, queda).length);
    lab.verificar(Boolean(lider), `alguem assumiu a sala (${lider?.nome})`);
    const recusas = [beto, caio].flatMap((i) => i.achar(/porta da sala recusou/, queda));
    lab.verificar(recusas.length === 0, 'sem recusa, ninguem pulou a escada');
    const hosts = [beto, caio].filter((i) => i.achar(/\[signaling\] welcome: .*host=sim/, queda).length);
    lab.verificar(hosts.length === 1, `uma sala so depois da migracao (${hosts.map((i) => i.nome).join(', ')})`);
    await caio.esperarImagemAndando(30000);
    lab.verificar(true, 'a tela do Beto segue andando no Caio depois da migracao');
    lab.passo(`migracao completa em ${((Date.now() - queda) / 1000).toFixed(1)}s`);
  },
};
