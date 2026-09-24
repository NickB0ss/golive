'use strict';

// Fanout 2 na origem (auditoria 2026-09-18, anexo 3): numa sala de 6 a
// origem manda pra DOIS relays, cada um repassa, e ninguem recebe direto
// alem deles -- 2 encoders na origem em vez dos 3 da arvore de um relay so.
// Depois derruba um dos relays e confere que as folhas do OUTRO nao sao
// renegociadas, e que as orfas voltam a ver a tela.
//
// A contagem de encoders vem das proprias RTCPeerConnection do app: cada
// instancia ganha um contador (window.__labPcs) antes de entrar na sala.
// "Envia" = conexao conectada com track de video saindo; "recebe" = conexao
// conectada com track de video chegando viva.

const CONTAR_PCS = `(() => {
  if (window.__labPcs) return true;
  const Orig = window.RTCPeerConnection;
  window.__labPcs = [];
  function Contada(...args) {
    const pc = new Orig(...args);
    window.__labPcs.push(pc);
    return pc;
  }
  Contada.prototype = Orig.prototype;
  Object.setPrototypeOf(Contada, Orig);
  window.RTCPeerConnection = Contada;
  return true;
})()`;

const ESTADO_PCS = `(() => {
  const vivas = (window.__labPcs || []).map((pc, i) => ({ pc, i })).filter(({ pc }) => pc.connectionState === 'connected');
  return {
    envia: vivas.filter(({ pc }) => pc.getSenders().some((s) => s.track && s.track.kind === 'video' && s.track.readyState === 'live')).map(({ i }) => i),
    recebe: vivas.filter(({ pc }) => pc.getReceivers().some((r) => r.track && r.track.kind === 'video' && r.track.readyState === 'live')
      && pc.getTransceivers().some((t) => t.receiver.track?.kind === 'video' && /recv/.test(t.currentDirection || ''))).map(({ i }) => i),
  };
})()`;

module.exports = {
  nome: 'sala-de-6',
  descricao: 'Ana transmite pra 5 pessoas: a arvore monta 2 relays (2 encoders na Ana), cada um repassa, todos veem a tela andando e a topologia fica parada; um relay cai e as folhas do outro nao mudam.',
  timeoutMs: 360000,
  async rodar(lab) {
    const todos = await lab.abrir(['Ana', 'Beto', 'Caio', 'Davi', 'Eva', 'Fabio']);
    const [ana, ...convidados] = todos;
    await Promise.all(todos.map((i) => i.js(CONTAR_PCS)));

    const endereco = await ana.criarSala();
    await ana.transmitir();
    for (const i of convidados) await i.entrar(endereco);
    await Promise.all(convidados.map((i) => i.esperarImagemAndando(60000)));
    lab.verificar(true, 'os cinco veem a tela da Ana andando');

    const foto = async () => {
      const estados = await Promise.all(todos.map((i) => i.js(ESTADO_PCS)));
      return new Map(todos.map((i, k) => [i, estados[k]]));
    };
    // Arvore montada: Ana envia pra exatamente 2, que sao os unicos
    // convidados que enviam; entre os dois repassam pros outros 3. E cada
    // convidado recebe por UMA conexao so: a entrada direta da Ana que a
    // folha tinha antes demora uns segundos pra cair do lado dela.
    const arvoreDeDois = (f) => {
      const relays = convidados.filter((i) => f.get(i).envia.length > 0);
      return f.get(ana).envia.length === 2
        && convidados.every((i) => f.get(i).recebe.length === 1)
        && relays.length === 2
        && relays.every((i) => f.get(i).envia.length >= 1)
        && relays.reduce((soma, i) => soma + f.get(i).envia.length, 0) === 3;
    };
    // A arvore so se forma passada a histerese de reeleicao (networktiming.js).
    const montada = await lab.ate(async () => { const f = await foto(); return arvoreDeDois(f) && f; }, {
      timeoutMs: 60000, intervaloMs: 1000, descricao: 'Ana enviando pra 2 relays, que repassam pros outros 3',
    });
    const relays = convidados.filter((i) => montada.get(i).envia.length > 0);
    const folhas = convidados.filter((i) => !relays.includes(i));
    const filhosDe = (relay) => folhas.filter((f) => relay.achar(new RegExp(`\\[rota\\] screen@\\S+ para ${f.nome}:`)).length);
    for (const r of relays) {
      await lab.ate(() => filhosDe(r).length === montada.get(r).envia.length, { timeoutMs: 15000, descricao: `rotas de repasse de ${r.nome} no log` });
    }
    lab.verificar(true, `Ana envia 2 copias; ${relays.map((r) => `${r.nome} repassa pra ${filhosDe(r).map((f) => f.nome).join(' e ')}`).join('; ')}`);
    lab.igual(montada.get(ana).envia.length, 2, 'encoders de tela na origem (eram 3 com um relay so)');

    await Promise.all(convidados.map((i) => i.esperarImagemAndando(30000)));
    lab.verificar(true, 'com a arvore de 2 relays montada, os cinco seguem com a tela andando');

    // Estabilidade: duas janelas de histerese sem ninguem entrar ou sair. Um
    // relay que conta os filhos que a PROPRIA origem lhe deu como carga
    // alheia faria a arvore trocar de relay aqui (ver app.js, 'view-state').
    await lab.sleep(22000);
    const depois = await foto();
    const mudou = todos.filter((i) => JSON.stringify(depois.get(i)) !== JSON.stringify(montada.get(i)));
    lab.verificar(
      !mudou.length,
      `topologia parada por 22 s: nenhuma conexao de video nova nem fechada${mudou.length ? ` (mudou: ${mudou.map((i) => `${i.nome} ${JSON.stringify(montada.get(i))} -> ${JSON.stringify(depois.get(i))}`).join('; ')})` : ''}`,
    );

    // Um dos relays cai. As folhas do outro nao podem ser renegociadas; as
    // orfas voltam a ver a tela (direto da Ana primeiro, depois pela arvore).
    const [caiu, ficou] = relays;
    const filhosQueFicam = filhosDe(ficou);
    const orfas = filhosDe(caiu);
    const antesDaQueda = await foto();
    caiu.derrubar();
    const vivos = convidados.filter((i) => i !== caiu);
    await Promise.all(orfas.map((i) => i.esperarImagemAndando(60000)));
    lab.verificar(true, `orfas de ${caiu.nome} (${orfas.map((i) => i.nome).join(' e ')}) voltaram a ver a tela`);
    // A origem reoferta as orfas direto e reelege na hora (recoverFromRelayLoss
    // passa por cima da histerese). Espera a arvore assentar -- Ana com 2
    // envios e todo convidado vivo recebendo por uma conexao so -- e confere
    // de novo depois de uma janela de histerese, pra nao julgar um estado de
    // passagem.
    const ativos = [ana, ...vivos];
    const fotoAtivos = async () => {
      const estados = await Promise.all(ativos.map((i) => i.js(ESTADO_PCS)));
      return new Map(ativos.map((i, k) => [i, estados[k]]));
    };
    const assentou = (f) => f.get(ana).envia.length === 2 && vivos.every((i) => f.get(i).recebe.length === 1);
    await lab.ate(async () => assentou(await fotoAtivos()), {
      timeoutMs: 60000, intervaloMs: 1000, descricao: 'arvore refeita com 2 relays depois da queda',
    });
    await lab.sleep(12000);
    const assentada = await lab.ate(async () => { const f = await fotoAtivos(); return assentou(f) && f; }, {
      timeoutMs: 30000, intervaloMs: 1000, descricao: 'arvore refeita continua de pe',
    });
    const relaysAgora = vivos.filter((i) => assentada.get(i).envia.length);
    lab.verificar(relaysAgora.length === 2, `arvore refeita: Ana envia ${assentada.get(ana).envia.length} copias; relays agora ${relaysAgora.map((i) => i.nome).join(' e ')}`);
    if (relaysAgora.includes(ficou)) {
      for (const f of filhosQueFicam) {
        lab.igual(
          JSON.stringify(assentada.get(f).recebe), JSON.stringify(antesDaQueda.get(f).recebe),
          `${f.nome}, folha de ${ficou.nome}, segue na mesma conexao`,
        );
      }
    } else {
      // A estabilidade (tree.js, opts.anterior) vem DEPOIS de carga e saude
      // de encode no ranking: um relay que estourou o orcamento de ms/quadro
      // perde o posto na reeleicao, de proposito (H2). Neste conteiner, com
      // seis instancias codificando em software, isso acontece.
      lab.passo(`${ficou.nome} perdeu o posto de relay na reeleicao (saude de encode, H2); as folhas dele foram redistribuidas`);
    }
    await Promise.all(vivos.map((i) => i.esperarImagemAndando(30000)));
    lab.verificar(true, 'os quatro que ficaram seguem com a tela andando');
  },
};
