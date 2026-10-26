'use strict';

// H10/D5: a rede esta boa, quem parou foi a origem (o app parou de mandar
// quadros; tela apenas parada e outro caso, ver tela-parada). O
// diagnostico tem de separar isso de "rede".
module.exports = {
  nome: 'origem-parada',
  descricao: 'O app da Ana para de mandar quadros: o Beto ve "Ana parou de enviar imagem" e o log diz "origem"; o envio volta e o aviso some.',
  async rodar(lab) {
    const [ana, beto] = await lab.abrir(['Ana', 'Beto']);
    const endereco = await ana.criarSala();
    await ana.transmitir();
    await beto.entrar(endereco);
    await beto.esperarImagemAndando(30000);
    // O vigia de congelamento olha a cada 2 s: sem esta folga, a falha
    // chegaria antes de ele ver a primeira imagem.
    await lab.sleep(5000);

    const parada = Date.now();
    await ana.pararOrigem();
    lab.passo('envio da Ana parado');
    const diag = await beto.esperarLog(/\[assistir\] diagnostico da tela de Ana: origem parou de enviar video/, { desde: parada, timeoutMs: 20000, descricao: 'diagnostico "origem" (H10)' });
    lab.passo(diag.texto.slice(0, 200));
    const aviso = await lab.ate(() => beto.avisoNoTile(), { timeoutMs: 5000, descricao: 'aviso no tile' });
    lab.igual(aviso, 'Ana parou de enviar imagem. Tentando de novo…', 'o tile diz que a origem parou (D5)');

    await ana.retomarOrigem();
    lab.passo('envio da Ana de volta');
    await beto.esperarImagemAndando(25000);
    await lab.ate(async () => (await beto.avisoNoTile()) === '', { timeoutMs: 6000, descricao: 'aviso some quando a imagem volta' });
    lab.verificar(true, 'imagem de volta e aviso fora do tile');
  },
};
