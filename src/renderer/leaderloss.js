'use strict';

// Quando desistir de reconectar no lider e migrar a sala. Modulo puro, sem
// DOM nem relogio: o app.js passa o que ja viu.
//
// A escada de reconexao (reconnect.js, ~1-2 min) existe pra uma queda de
// ROTA da VPN nao partir a sala em duas: enquanto o PC do lider pode estar
// vivo do outro lado, quem assumisse a sala abriria uma segunda sala com o
// mesmo roomId e o lider ficaria sozinho na primeira. So que ela tambem vale
// quando o lider morreu de verdade -- e ai sao ~60 s sem sinalizacao por
// nada (laboratorio, cenario lider-cai).
//
// O que separa os dois casos com certeza e a RECUSA: o processo principal
// tenta um TCP cru no ip:porta da sala (src/main/tcpcheck.js) e so devolve
// 'refused' com ECONNREFUSED, isto e, um RST vindo do proprio PC do lider:
// a maquina esta ali, a rota funciona e ninguem escuta na porta. O servidor
// da sala roda dentro do app do lider; sem ele a sala antiga nao existe mais,
// e migrar nao tem com quem partir. Uma rota caida nunca produz isso: da
// timeout (SYN sem resposta) ou "inalcancavel" (ICMP do adaptador da VPN ou
// de um roteador), e nesses dois casos a escada continua inteira.
//
// So a desistencia fica mais cedo. A base do prazo dos candidatos seguintes
// (migration.baseDelayMs) continua a da escada inteira: o sucessor assume
// na hora, e os outros dao a ele o mesmo tempo de antes (UAC do firewall,
// por exemplo) antes de assumir no lugar dele.
//
// Por que nao usar outras evidencias pra encurtar o caso do timeout:
// - o vigia de vida (15 s sem hb) e o estado das conexoes P2P com o lider
//   morrem igual nas duas causas (maquina morta ou rota caida), entao nao
//   separam uma da outra;
// - a opiniao dos outros sobreviventes nao tem canal: sem sinalizacao, so
//   quem hospeda responde a sonda `probe`, e os sobreviventes nao hospedam
//   nada ate migrar. E mesmo todos concordando, uma queda da VPN do PROPRIO
//   lider (todos o perdem ao mesmo tempo) ainda partiria a sala.
// Por isso, com timeout, nada muda: a protecao contra a queda curta de rota
// fica exatamente como era.
//
// Limite conhecido: o Windows com firewall ligado ("modo furtivo") pode nao
// mandar RST pra uma porta sem ninguem escutando -- ai o app do lider que
// fechou parece rota caida e a espera continua a de antes. So a noite com
// PCs de verdade diz quanto isso acontece (a linha "[signaling] porta da
// sala: ..." do log mostra o que cada tentativa viu).

(function (root) {
  // Quantas recusas seguidas, em tentativas separadas, bastam. Uma so ja
  // provaria a porta fechada; duas nao decidem por um RST avulso e custam
  // ~2 s (a espera entre a 1a e a 2a tentativa da escada).
  const REFUSED_STREAK = 2;

  const RESULTS = ['refused', 'timeout', 'unreachable', 'open', 'error'];

  function isResult(value) {
    return RESULTS.includes(value);
  }

  /** Quantas das ultimas checagens seguidas foram recusa. */
  function refusedStreak(results) {
    const list = Array.isArray(results) ? results : [];
    let n = 0;
    for (let i = list.length - 1; i >= 0 && list[i] === 'refused'; i -= 1) n += 1;
    return n;
  }

  /**
   * Depois de mais uma tentativa de reconexao que falhou: continua a escada
   * ou desiste e migra?
   * - `attempts`: tentativas ja feitas nesta cadeia (a que acabou de falhar
   *   nao conta ainda, como no onClose do app.js).
   * - `maxAttempts`: MAX_RECONNECT.
   * - `results`: checagens TCP da porta da sala DESDE ESTA queda, na ordem.
   * Devolve { giveUp, reason }: 'recusa' (a porta recusou REFUSED_STREAK
   * vezes seguidas), 'escada' (a escada acabou) ou null (continua).
   */
  function decide({ attempts, maxAttempts, results } = {}) {
    const n = Number.isInteger(attempts) && attempts >= 0 ? attempts : 0;
    const max = Number.isInteger(maxAttempts) && maxAttempts >= 0 ? maxAttempts : 0;
    if (refusedStreak(results) >= REFUSED_STREAK) return { giveUp: true, reason: 'recusa' };
    if (n >= max) return { giveUp: true, reason: 'escada' };
    return { giveUp: false, reason: null };
  }

  /** "host:porta" (ou "[v6]:porta") de uma URL de sala, pra checagem TCP.
   * null se nao der pra tirar os dois. */
  function hostPortOf(url) {
    const m = /^(?:wss?:\/\/)?(\[[0-9a-fA-F:.]+\]|[^\s/:[\]]+):(\d{1,5})(?:\/.*)?$/.exec(String(url || '').trim());
    if (!m) return null;
    const port = Number(m[2]);
    if (!(Number.isInteger(port) && port > 0 && port <= 65535)) return null;
    const host = m[1].startsWith('[') ? m[1].slice(1, -1) : m[1];
    return { host, port };
  }

  /** Texto do log pra cada resultado (sem IP, como o [rota]). */
  function describe(result) {
    switch (result) {
      case 'refused': return 'recusou na hora (o PC responde, ninguem escuta na porta)';
      case 'timeout': return 'sem resposta (rota caida ou PC desligado)';
      case 'unreachable': return 'inalcancavel (sem rota ate o PC)';
      case 'open': return 'aceitou a conexao';
      default: return 'erro na checagem';
    }
  }

  const api = {
    REFUSED_STREAK,
    isResult,
    refusedStreak,
    decide,
    hostPortOf,
    describe,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.leaderloss = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
