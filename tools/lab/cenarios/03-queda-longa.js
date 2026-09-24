'use strict';

// H10/D5: uma queda longa o bastante pro vigia de tela assistida agir. O
// diagnostico tem de dizer "rede" e o tile tem de explicar em vez de
// mostrar um quadro parado; quando a rede volta, o aviso sai. E, com
// "rede", o vigia NAO refaz a conexao: segura a reoferta e o reinicio de ICE
// de quem transmite (C5) traz a mesma conexao de volta.
module.exports = {
  nome: 'queda-longa',
  precisaRede: true,
  descricao: 'UDP cortado por 15 s: o Beto ve "Sem contato com o PC de Ana", o log diz "rede", o vigia segura a reoferta e a mesma conexao volta.',
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
    const queda = lab.rede.cortarUdp(15000);
    const diag = await beto.esperarLog(/\[assistir\] diagnostico da tela de Ana: rede/, { desde: corte, timeoutMs: 14000, descricao: 'diagnostico "rede" (H10)' });
    lab.passo(diag.texto.slice(0, 200));
    const aviso = await lab.ate(() => beto.avisoNoTile(), { timeoutMs: 5000, descricao: 'aviso no tile' });
    lab.igual(aviso, 'Sem contato com o PC de Ana. Tentando de novo…', 'o tile explica o congelamento (D5)');
    await queda;

    await beto.esperarImagemAndando(25000);
    lab.verificar(true, 'a imagem voltou depois da rede');
    await lab.ate(async () => (await beto.avisoNoTile()) === '', { timeoutMs: 6000, descricao: 'aviso some quando a imagem volta' });
    lab.verificar(true, 'o aviso saiu do tile');
    // Com "rede" o vigia segura a reoferta (a conexao nova precisaria da
    // mesma rede) e o reinicio de ICE da Ana traz a MESMA conexao de volta.
    lab.verificar(beto.achar(/segurando reoferta: rede/, corte).length > 0, 'o vigia segurou a reoferta durante a queda');
    lab.igual(beto.achar(/pedindo pra refazer a conexao/, corte).length, 0, 'ninguem refez a conexao');
    await ana.esperarLog(/conexao de saida para #\d+ \(kind=screen\) voltou depois de/, { desde: corte, timeoutMs: 1000, descricao: 'a mesma conexao voltou' });
    lab.verificar(true, 'a mesma conexao voltou (reinicio de ICE)');
  },
};
