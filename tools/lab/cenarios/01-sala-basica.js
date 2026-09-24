'use strict';

// O caminho feliz inteiro, com tres PCs: sem ele passar, nenhum outro
// cenario diz nada.
module.exports = {
  nome: 'sala-basica',
  descricao: 'Ana cria a sala e transmite; Beto, Caio e Davi entram e veem a tela andando, um deles por um relay da arvore. Confere tambem C6, D1, D6 e as linhas [rota] (H7).',
  async rodar(lab) {
    const [ana, beto, caio, davi] = await lab.abrir(['Ana', 'Beto', 'Caio', 'Davi']);
    const convidados = [beto, caio, davi];

    lab.igual(await ana.js(`getComputedStyle(document.getElementById('titlebar')).display`), 'none', 'faixa de titulo escondida fora do Windows (C6)');

    const endereco = await ana.criarSala();
    lab.contem(await ana.js(`document.querySelector('#grid > .empty')?.innerText || ''`), 'Ninguém transmitindo ainda', 'sala vazia explica o estado (D1)');
    lab.verificar(await ana.js(`Boolean(document.querySelector('#grid .empty-share'))`), 'sala vazia tem o botao de compartilhar (D1)');

    const fontes = await ana.transmitir();
    lab.contem(fontes.join(' | '), 'Monitor 1', 'nome da tela em portugues (D6)');

    await Promise.all(convidados.map((i) => i.entrar(endereco)));
    await Promise.all(convidados.map((i) => i.esperarImagemAndando(40000)));
    lab.verificar(true, 'Beto, Caio e Davi veem a tela da Ana andando');

    // Com tres espectadores a origem para de mandar pra todos: um vira relay
    // e repassa (kind composto 'screen@<origem>'). A arvore so se forma
    // passada a histerese de reeleicao (networktiming.js, ~18 s).
    const relay = await lab.ate(() => convidados.find((i) => i.achar(/\[rota\] screen@\S+ para /).length), {
      timeoutMs: 45000, descricao: 'algum convidado repassando a tela (relay da arvore)',
    });
    const folhas = convidados.filter((i) => i !== relay);
    await Promise.all(folhas.map((i) => i.esperarLog(/\[rota\] screen@\S+ de /, { timeoutMs: 20000, descricao: 'tela recebida pelo relay' }).catch(() => null)));
    const pelaArvore = folhas.filter((i) => i.achar(/\[rota\] screen@\S+ de /).length).map((i) => i.nome);
    lab.verificar(pelaArvore.length > 0, `${relay.nome} e relay e repassa pra ${pelaArvore.join(' e ')}`);
    await Promise.all(convidados.map((i) => i.esperarImagemAndando(30000)));
    lab.verificar(true, 'com a arvore montada, os tres continuam com a tela andando');

    for (const i of convidados) {
      await i.esperarLog(/\[rota\] screen(@\S+)? de /, { timeoutMs: 15000, descricao: 'rota da tela recebida' });
    }
    await ana.esperarLog(/\[rota\] screen para /, { timeoutMs: 15000, descricao: 'rota da tela enviada' });
    lab.verificar(true, 'rota de cada conexao no log (H7)');
  },
};
