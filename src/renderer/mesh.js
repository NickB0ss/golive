'use strict';

(function (root) {
  const { DISCONNECT_GRACE_MS } = root.GoLive.networktiming;
  // Sem STUN o ICE so junta candidatos host, entao a unica rota possivel
  // entre dois peers fora da mesma LAN e o adaptador virtual da VPN -- todo
  // o video passa dentro do tunel, que costuma ser o gargalo (jitter e perda
  // derrubam o bitrate bem abaixo do teto configurado). Com STUN o ICE
  // tambem coleta o candidato srflx e tenta conexao direta pela internet; o
  // candidato host da VPN continua na lista e assume se o NAT nao deixar.
  const STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

  const RTC_CONFIG = { iceServers: [{ urls: STUN_URLS }], iceTransportPolicy: 'all' };

  // 'disconnected' e o estado TRANSITORIO do ICE -- perdeu conectividade e
  // esta tentando reconectar sozinho, o que acontece o tempo todo num
  // tunel de VPN (Radmin) com jitter, e na maioria das vezes se resolve em
  // poucos segundos sem intervencao nenhuma. Tratar 'disconnected' como
  // falha na hora (o comportamento antigo) faz um soluco de rede disparar
  // a maquina inteira de recuperacao -- fechar repasses, vetar o relay,
  // recalcular a arvore -- por algo que ia se curar sozinho. Ver a
  // auditoria de 2026-08-27, item A2.
  // C5 (analise de 2026-09-23): quanto tempo em 'disconnected' antes de o
  // lado que OFERTA reiniciar o ICE na mesma conexao. Curto porque o proprio
  // 'disconnected' ja chega atrasado: medido no app (Chromium 152, UDP
  // cortado no Xvfb), a conexao so saiu de 'connected' 6,5 s depois do
  // ultimo pacote -- e o vigia de tela assistida refaz a conexao inteira
  // ~9 s depois. Esperar os 15 s da carencia e entao derrubar tudo (ICE,
  // DTLS, SDP e quadro-chave de novo) e o caminho lento. `restartIce` troca so as credenciais ICE e recoleta candidatos --
  // e o caminho padrao quando a interface da VPN troca de rota (Radmin
  // reconectando). A carencia continua valendo por cima: se o reinicio nao
  // resolver, a conexao cai e e refeita como antes.
  const ICE_RESTART_AFTER_MS = 1000;
  // Resposta do reinicio que nunca chegou (sinalizacao caiu no meio) numa
  // conexao que voltou sozinha: desfaz a oferta, senao a pc fica presa em
  // 'have-local-offer' e toda renegociacao seguinte desiste.
  const ICE_RESTART_ANSWER_TIMEOUT_MS = 10000;
  const NEGOTIATION_TIMEOUT_MS = 10000;

  // Estados de sinalizacao em que uma pc de ENTRADA ainda pode receber uma
  // oferta remota: 'stable' (a negociacao anterior fechou) e
  // 'have-remote-offer' (reenvio da mesma oferta, antes de respondermos).
  // Em qualquer outro estado -- 'have-local-offer', 'closed' -- reusar
  // daria InvalidStateError, e recomecar do zero e o caminho seguro.
  const RENEGOTIABLE_STATES = new Set(['stable', 'have-remote-offer']);

  // Teto de candidatos guardados por conexao enquanto ela nao tem
  // remoteDescription. Numa negociacao sa o buffer vive alguns
  // milissegundos e junta poucos candidatos host; o limite existe so pra que
  // um peer defeituoso (ou malicioso) despejando 'ice' sem nunca mandar a
  // SDP nao faca a memoria crescer sem teto. Ao estourar, o mais ANTIGO cai:
  // os candidatos mais recentes sao os que ainda tem chance de servir.
  const MAX_PENDING_ICE = 64;

  // Payloads auxiliares (retransmissao e correcao de erro) nao sao codecs de
  // verdade -- x-google-start-bitrate neles nao faz nada.
  const NON_CODEC_ENCODINGS = new Set(['rtx', 'red', 'ulpfec', 'flexfec-03']);

  // Alvo de buffer de jitter dos receptores, em ms. O padrao do Chromium e
  // dimensionado pra internet aberta e custa ~100-200ms por hop -- com a
  // arvore, a folha paga isso DUAS vezes (origem->relay->folha). Isto e um
  // ALVO, nao um teto: se a rede exigir, o Chromium sobe sozinho.
  const JITTER_BUFFER_TARGET_MS = 50;

  // Uma Promise de replaceTrack pode nunca resolver quando a PC entra num
  // estado ruim. Cinco segundos deixam uma maquina carregada terminar, mas
  // impedem que um sender morto retenha toda a demanda seguinte para sempre.
  const DEMAND_REPLACE_TIMEOUT_MS = 5000;

  // ---------- Chave de conexao de retransmissao (F2) ----------
  //
  // Toda RTCPeerConnection e indexada por (peerId, kind). Quando um RELAY
  // repassa a tela da ORIGEM pra um filho, quem manda a oferta e o relay --
  // entao, com `kind` cru, essa conexao cairia no MESMO slot
  // (relayId, 'screen') que a conexao do proprio compartilhamento do relay,
  // se ele tambem estiver transmitindo. ensureInConn FECHA o que estiver no
  // slot antes de criar o novo: as duas se destruiriam alternadamente,
  // dependendo de qual oferta chegasse por ultimo.
  //
  // Por isso a conexao de repasse usa um kind composto, 'screen@<origemId>':
  // nunca colide com o 'screen' proprio do relay, e carrega, ate o outro
  // lado, de QUEM e o conteudo -- e o que deixa a folha desenhar o tile com
  // o nome e o avatar da ORIGEM em vez dos do relay. O kind composto viaja
  // identico nas mensagens offer/answer/ice/view-state, entao os dois lados
  // concordam na chave sem estado extra.
  //
  // So aparece em conexoes de repasse: com `cfg.network.tree` desligado
  // relayTo nunca e chamado e todo kind continua sendo 'screen'/'camera'
  // cru, exatamente como antes.
  const RELAY_KIND_SEP = '@';

  function relayKindFor(kind, sourcePeerId) {
    return `${kind}${RELAY_KIND_SEP}${sourcePeerId}`;
  }

  /** Devolve { baseKind, sourceId }. sourceId e null pra kind cru (conexao
   * direta) e o id da ORIGEM pra conexao de repasse. */
  function parseKind(kind) {
    const raw = String(kind ?? '');
    const at = raw.indexOf(RELAY_KIND_SEP);
    if (at < 0) return { baseKind: raw, sourceId: null };
    return { baseKind: raw.slice(0, at), sourceId: raw.slice(at + 1) || null };
  }

  // Um quarto do teto, dentro de limites sensatos. Comecar em ~300 kbps
  // (padrao do Chromium) deixa os primeiros segundos borrados; comecar no
  // maximo faz a rajada inicial virar perda e derrubar o GCC. O custo dos
  // dois lados NAO e simetrico: subir a estimativa e rapido, um colapso de
  // congestion control por rajada inicial demora muito mais -- e em VPN de
  // LAN virtual (Radmin/Tailscale) o teto de banda real fica bem abaixo do
  // preset escolhido. Por isso 1/4, e o teto superior caiu de 10000 pra
  // 2500: mesmo com presets de topo (12 Mbps) a rajada fica pequena o
  // bastante pra nao afogar um tunel de VPN.
  function startBitrateKbps(maxBitrateBps) {
    const quarter = Math.round((maxBitrateBps || 0) / 4000);
    return Math.min(Math.max(quarter, 300), 2500);
  }

  // x-google-start-bitrate e uma extensao do Chromium (a unica engine que roda
  // aqui, ja que e Electron) e so existe via SDP -- nao ha equivalente em
  // setParameters, dai a edicao na mao. Mexe apenas na secao de video.
  function withStartBitrate(sdp, kbps) {
    if (!sdp || !kbps) return sdp;
    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);

    // Primeira passada: descobre quais payloads sao codecs e quais ja tem uma
    // linha a=fmtp (VP8, por exemplo, costuma nao ter -- ai precisamos criar).
    const codecPts = new Set();
    const withFmtp = new Set();
    let inVideo = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inVideo = line.startsWith('m=video');
      if (!inVideo) continue;
      const rtpmap = /^a=rtpmap:(\d+) ([^/]+)\//.exec(line);
      if (rtpmap && !NON_CODEC_ENCODINGS.has(rtpmap[2].toLowerCase())) codecPts.add(rtpmap[1]);
      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp) withFmtp.add(fmtp[1]);
    }

    const out = [];
    inVideo = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inVideo = line.startsWith('m=video');
      if (!inVideo) {
        out.push(line);
        continue;
      }

      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp && codecPts.has(fmtp[1]) && !line.includes('x-google-start-bitrate')) {
        out.push(`${line};x-google-start-bitrate=${kbps}`);
        continue;
      }

      out.push(line);

      const rtpmap = /^a=rtpmap:(\d+) /.exec(line);
      if (rtpmap && codecPts.has(rtpmap[1]) && !withFmtp.has(rtpmap[1])) {
        out.push(`a=fmtp:${rtpmap[1]} x-google-start-bitrate=${kbps}`);
      }
    }

    return out.join(eol);
  }

  // Bitrate medio de audio, em bits/s. 160 kbps e transparente o bastante
  // pra som de jogo e musica em estereo, e e ruido perto dos 12 Mbps de
  // video do preset de topo.
  const OPUS_MAX_AVERAGE_BITRATE = 160000;

  // O Chromium so manda Opus em estereo se o fmtp declarar -- e declarar
  // vale pros DOIS lados: `stereo` diz o que aceitamos receber,
  // `sprop-stereo` diz o que vamos mandar. Sem isto o audio sai mono no
  // padrao, mesmo com a captura nativa entregando estereo de verdade
  // (ver pcm-injector-worklet.js). Como relayTo repassa a stream inteira,
  // a folha paga o mono duas vezes: ha um transcode Opus->Opus no relay.
  //
  // Idempotente de proposito: a mesma SDP pode passar por aqui duas vezes
  // e nao pode acumular parametro.
  function withOpusParams(sdp, opts) {
    if (!sdp) return sdp;
    const maxAverageBitrate = opts?.maxAverageBitrate ?? OPUS_MAX_AVERAGE_BITRATE;
    const wanted = [
      ['stereo', '1'],
      ['sprop-stereo', '1'],
      ['maxaveragebitrate', String(maxAverageBitrate)],
    ];

    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);

    // Primeira passada: quais payloads sao opus, e quais ja tem a=fmtp.
    const opusPts = new Set();
    const withFmtp = new Set();
    let inAudio = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inAudio = line.startsWith('m=audio');
      if (!inAudio) continue;
      const rtpmap = /^a=rtpmap:(\d+) opus\//i.exec(line);
      if (rtpmap) opusPts.add(rtpmap[1]);
      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp) withFmtp.add(fmtp[1]);
    }
    if (!opusPts.size) return sdp;

    const out = [];
    inAudio = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inAudio = line.startsWith('m=audio');
      if (!inAudio) {
        out.push(line);
        continue;
      }

      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp && opusPts.has(fmtp[1])) {
        let updated = line;
        for (const [key, value] of wanted) {
          if (!new RegExp(`[; ]${key}=`, 'i').test(updated)) updated += `;${key}=${value}`;
        }
        out.push(updated);
        continue;
      }

      out.push(line);

      const rtpmap = /^a=rtpmap:(\d+) opus\//i.exec(line);
      if (rtpmap && !withFmtp.has(rtpmap[1])) {
        out.push(`a=fmtp:${rtpmap[1]} ${wanted.map(([k, v]) => `${k}=${v}`).join(';')}`);
      }
    }

    return out.join(eol);
  }

  function createMesh({
    send, onTrack, onPeerState,
    demandTimeoutMs = DEMAND_REPLACE_TIMEOUT_MS, negotiationTimeoutMs = NEGOTIATION_TIMEOUT_MS,
  }) {
    const peers = new Map();
    // A sessao P2P pode sobreviver a troca do WebSocket de sinalizacao.
    // A retomada aponta este mesmo mesh para o socket novo, sem recriar PCs.
    let sendSignal = send;

    // Candidatos ICE que chegaram ANTES de a conexao ter remoteDescription.
    //
    // A sinalizacao entrega 'offer' e 'ice' em sequencia, mas tratar a
    // 'offer' passa por awaits: entre criar a RTCPeerConnection (sincrono) e
    // terminar setRemoteDescription cabe uma mensagem 'ice' inteira. Nessa
    // janela a conexao JA existe, entao handleIce a encontrava e chamava
    // addIceCandidate com remoteDescription nulo -- o que a spec do WebRTC
    // manda rejeitar com InvalidStateError. O catch engolia o erro como
    // "candidato tardio": nao era tardio, era adiantado, e perder o
    // candidato host da VPN significa ICE que nunca fecha (o peer aparece na
    // lista e o video nunca vem). Ver a auditoria de 2026-08-27, item A1.
    //
    // WeakMap indexada pela propria pc pra que o buffer seja coletado junto
    // com a conexao quando ela e fechada e descartada -- nada fica pendurado
    // por peer que saiu.
    const pendingIce = new WeakMap();

    // A resposta precisa rodar enquanto outra oferta espera por 'stable'.
    // As duas operacoes pertencem a PC concreta, inclusive durante o fechamento.
    const negotiating = new WeakMap();
    const answering = new WeakMap();
    const demandByPc = new WeakMap();

    function isNegotiating(peerId, kind) {
      const pc = peers.get(peerId)?.outConns[kind];
      return negotiating.has(pc) || answering.has(pc);
    }

    function currentPc(peerId, kind, dir) {
      const peer = peers.get(peerId);
      return dir === 'in' ? peer?.inConns[kind] : peer?.outConns[kind];
    }

    function cancelPcWork(pc) {
      negotiating.get(pc)?.controller.abort();
      answering.get(pc)?.controller.abort();
      demandByPc.get(pc)?.controller.abort();
      demandByPc.delete(pc);
    }

    async function runNegotiation(pc, peerId, kind, dir, operations, run) {
      const controller = new AbortController();
      const { signal } = controller;
      const op = {
        controller, signal, stage: 'iniciar', started: Date.now(),
        at(next) {
          if (signal.aborted || currentPc(peerId, kind, dir) !== pc) throw cancelled();
          if (next) op.stage = next;
        },
      };
      const cancelled = () => new Error(`negociacao cancelada em ${op.stage} com #${peerId} (kind=${kind})`);
      operations.set(pc, op);
      const stopped = new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      let timeout;
      const timer = setTimeout(() => {
        timeout = new Error(`prazo de ${negotiationTimeoutMs} ms esgotado em ${op.stage} com #${peerId} (kind=${kind})`);
        controller.abort(timeout);
      }, negotiationTimeoutMs);
      try {
        const result = await Promise.race([stopped, run(op)]);
        op.at();
        return result;
      } catch (err) {
        if (currentPc(peerId, kind, dir) !== pc || (signal.aborted && !timeout)) {
          // handleOffer precisa rejeitar: seu consumidor envia toda SDP devolvida.
          if (dir === 'in') throw cancelled();
          return false;
        }
        failNegotiation(peerId, kind, dir, pc, timeout || err, op.stage);
        throw timeout || err;
      } finally {
        clearTimeout(timer);
        if (operations.get(pc) === op) operations.delete(pc);
      }
    }

    function waitForStable(pc, signal) {
      if (pc.signalingState === 'stable') return Promise.resolve(true);
      return new Promise((resolve) => {
        const finish = (stable) => {
          pc.removeEventListener?.('signalingstatechange', onState);
          signal.removeEventListener('abort', onAbort);
          resolve(stable);
        };
        const onAbort = () => finish(false);
        const onState = () => {
          if (pc.signalingState === 'stable') finish(true);
          else if (pc.signalingState === 'closed') finish(false);
        };
        pc.addEventListener('signalingstatechange', onState, { once: false });
        signal.addEventListener('abort', onAbort, { once: true });
        onState();
      });
    }

    // Esvazia, na ordem de chegada, os candidatos guardados pra `pc`. Uma
    // falha individual (candidato malformado do outro lado) nao pode
    // impedir a entrega dos demais -- basta UM candidato bom pra rota fechar.
    async function drainIce(pc, op) {
      const queued = pendingIce.get(pc);
      if (!queued) return;
      pendingIce.delete(pc);
      for (const candidate of queued) {
        op.at('aplicar candidato ICE');
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* candidato invalido; os outros ainda podem servir */
        }
      }
    }

    function addPeer(id, name, avatar) {
      if (!peers.has(id)) {
        peers.set(id, {
          id, name, avatar: avatar || null, live: false,
          outConns: {}, inConns: {}, joinedAt: Date.now(),
        });
      } else if (avatar) {
        peers.get(id).avatar = avatar;
      }
      return peers.get(id);
    }

    function removePeer(id) {
      const peer = peers.get(id);
      if (!peer) return;
      peers.delete(id);
      for (const pc of [...Object.values(peer.outConns), ...Object.values(peer.inConns)]) {
        if (!pc) continue;
        cancelPcWork(pc);
        pc.close();
      }
    }

    // `kind` distingue tela ('screen') de camera ('camera') -- cada uma tem
    // sua propria RTCPeerConnection por peer, pra nao atropelar a track uma
    // da outra quando as duas estao ativas ao mesmo tempo (ver showTile no
    // ui.js, que agora usa ids diferentes por kind).
    function makeConnection(peerId, dir, kind) {
      const pc = new RTCPeerConnection(RTC_CONFIG);

      pc.addEventListener('icecandidate', (event) => {
        if (currentPc(peerId, kind, dir) !== pc) return;
        if (event.candidate) sendSignal({ type: 'ice', to: peerId, dir, kind, candidate: event.candidate });
      });

      if (dir === 'in') {
        pc.addEventListener('track', (event) => {
          if (currentPc(peerId, kind, dir) !== pc) return;
          const peer = peers.get(peerId);
          if (peer) (peer.inStreams ||= {})[kind] = event.streams[0];
          // Nem toda versao do Chromium expoe isto; sem a propriedade, o
          // padrao continua valendo e nada quebra.
          try {
            if (event.receiver && 'jitterBufferTarget' in event.receiver) {
              event.receiver.jitterBufferTarget = JITTER_BUFFER_TARGET_MS;
            }
          } catch {
            /* receptor ja fechado, ou propriedade somente-leitura nesta versao */
          }
          onTrack(peerId, peer ? peer.name : peerId, event.streams[0], kind);
        });
      }

      // `settled` garante que a falha desta conexao seja reportada UMA vez
      // so, nao importa por qual caminho ela chegou (imediato via
      // 'failed'/'closed', ou depois da carencia de 'disconnected'). Sem
      // isto, um `pc.close()` explicito enquanto a carencia de disconnected
      // ainda esta correndo dispararia dois eventos de falha pra mesma
      // conexao: um na hora (o close vira 'closed' sincrono) e outro
      // quando o timer da carencia checasse o estado depois.
      let settled = false;
      let disconnectTimer = null;
      let iceRestartTimer = null;
      // Pro log: desde quando esta em 'disconnected' (0 = nao esta).
      let disconnectedAt = 0;

      function clearDisconnectTimer() {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        if (iceRestartTimer) {
          clearTimeout(iceRestartTimer);
          iceRestartTimer = null;
        }
      }

      function reportFailure() {
        if (settled) return;
        settled = true;
        clearDisconnectTimer();
        if (currentPc(peerId, kind, dir) !== pc) return;
        cancelPcWork(pc);
        if (dir === 'in') {
          const peer = peers.get(peerId);
          // Uma inConn morta nao pode continuar ocupando o slot: quem
          // recebe usa esse slot para decidir se ainda ha video entrando e,
          // sem limpa-lo, nunca pede a oferta de volta. Se ja entrou uma PC
          // nova no lugar, a falha e da velha e nao deve apagar o estado sao.
          peer.inConns[kind] = null;
          // A stream guardada morre junto com a conexao que a trouxe --
          // sem limpar aqui, relayTo repassaria adiante uma stream cujas
          // tracks ja estao 'ended' e o filho ficaria com tela preta sem
          // nenhum evento pra corrigir depois.
          clearInStream(peerId, kind);
          onPeerState(peerId, { removedTile: true, kind, dir, failed: true });
          // Depois de soltar o unico slot que a referencia, esta PC nao tem
          // mais dono que possa fecha-la. `settled` evita reentrar pela
          // mudanca para 'closed'; ainda assim, registre uma falha de close
          // em vez de escondê-la num catch vazio.
          if (pc.connectionState !== 'closed') {
            try {
              pc.close();
            } catch (err) {
              console.error(`[mesh] nao foi possivel fechar inConn falhada de #${peerId} (kind=${kind}):`, err);
            }
          }
        } else {
          onPeerState(peerId, { kind, dir, failed: true });
        }
      }

      pc.addEventListener('connectionstatechange', () => {
        if (currentPc(peerId, kind, dir) !== pc) {
          clearDisconnectTimer();
          return;
        }
        const state = pc.connectionState;

        // 'failed' e 'closed' sao terminais -- reportar na hora continua
        // certo pros dois.
        if (state === 'failed' || state === 'closed') {
          reportFailure();
          return;
        }

        if (state === 'disconnected') {
          clearDisconnectTimer();
          if (!disconnectedAt) {
            disconnectedAt = Date.now();
            console.info(`[mesh] conexao de ${dir === 'out' ? 'saida para' : 'entrada de'} #${peerId} (kind=${kind}) em 'disconnected'`);
          }
          // So quem oferta pode reiniciar o ICE; do lado que recebe, a
          // oferta nova chega como renegociacao e ensureInConn reaproveita
          // a pc.
          if (dir === 'out') {
            iceRestartTimer = setTimeout(() => {
              iceRestartTimer = null;
              if (pc.connectionState === 'disconnected') void restartIceOn(pc, peerId, kind);
            }, ICE_RESTART_AFTER_MS);
          }
          disconnectTimer = setTimeout(() => {
            disconnectTimer = null;
            // So vira falha de verdade se, passada a carencia, AINDA nao
            // tiver voltado a 'connected' sozinho.
            if (pc.connectionState !== 'connected') reportFailure();
          }, DISCONNECT_GRACE_MS);
          onPeerState(peerId, { kind, dir, failed: false });
          return;
        }

        if (state === 'connected') {
          clearDisconnectTimer();
          if (disconnectedAt) {
            console.info(`[mesh] conexao de ${dir === 'out' ? 'saida para' : 'entrada de'} #${peerId} (kind=${kind}) voltou depois de ${((Date.now() - disconnectedAt) / 1000).toFixed(1)}s`);
            disconnectedAt = 0;
          }
        }
        onPeerState(peerId, { kind, dir, failed: false });
      });

      return pc;
    }

    /** Reinicia o ICE de uma conexao de SAIDA sem derrubar a conexao (C5).
     * Nao mexe em nada se ja houver negociacao em voo, se a pc nao estiver
     * em 'stable' ou se a sinalizacao estiver fora do ar (`send` devolve
     * false): nesses casos a carencia de 'disconnected' segue valendo. */
    async function restartIceOn(pc, peerId, kind) {
      if (peers.get(peerId)?.outConns[kind] !== pc) return false;
      if (typeof pc.restartIce !== 'function' || pc.signalingState !== 'stable') return false;
      if (isNegotiating(peerId, kind)) return false;
      return runNegotiation(pc, peerId, kind, 'out', negotiating, async (op) => {
        let sent;
        try {
          op.at('restartIce');
          pc.restartIce();
          op.at('createOffer no reinicio de ICE');
          const offer = await pc.createOffer({ iceRestart: true });
          op.at('setLocalDescription no reinicio de ICE');
          if (pc.signalingState !== 'stable') return false;
          await pc.setLocalDescription({ type: offer.type, sdp: withOpusParams(offer.sdp) });
          op.at('enviar reinicio de ICE');
          sent = sendSignal({ type: 'offer', to: peerId, sdp: pc.localDescription, kind, renegotiate: true });
          if (sent === false) console.warn(`[mesh] reinicio de ICE com #${peerId} (kind=${kind}) sem sinalizacao`);
        } catch (err) {
          op.at();
          console.warn(`[mesh] reinicio de ICE com #${peerId} (kind=${kind}) falhou em ${op.stage}:`, err);
          sent = false;
        }
        if (sent === false) {
          // Sinalizacao fora do ar: a oferta nao saiu e a resposta nunca
          // vira. Volta pra 'stable' e deixa a carencia decidir.
          op.at('desfazer oferta de ICE');
          if (pc.signalingState === 'have-local-offer') await pc.setLocalDescription({ type: 'rollback' });
          return false;
        }
        console.info(`[mesh] ICE com #${peerId} (kind=${kind}) em 'disconnected' ha ${ICE_RESTART_AFTER_MS / 1000}s -- reiniciando o ICE na mesma conexao`);
        const offered = pc.localDescription;
        setTimeout(() => {
          if (currentPc(peerId, kind, 'out') !== pc) return;
          if (pc.signalingState !== 'have-local-offer' || pc.localDescription !== offered) return;
          if (pc.connectionState !== 'connected') return; // a carencia cuida
          if (answering.has(pc)) return; // a aplicacao da resposta tem seu proprio prazo
          console.warn(`[mesh] resposta do reinicio de ICE de #${peerId} (kind=${kind}) nao chegou; a conexao voltou sozinha, desfazendo a oferta`);
          runNegotiation(pc, peerId, kind, 'out', answering, async (op) => {
            op.at('desfazer reinicio de ICE sem resposta');
            await pc.setLocalDescription({ type: 'rollback' });
          }).catch(() => {}); // a falha ja passa por failNegotiation
        }, ICE_RESTART_ANSWER_TIMEOUT_MS);
        return true;
      }).catch(() => false); // runNegotiation ja notificou a falha da PC vigente.
    }

    function ensureOutConn(peerId, kind) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      if (!peer.outConns[kind]) {
        peer.outConns[kind] = makeConnection(peerId, 'out', kind);
        if (peer.suspended) peer.suspended[kind] = false;
      }
      return peer.outConns[kind];
    }

    function clearInStream(peerId, kind) {
      const peer = peers.get(peerId);
      if (peer?.inStreams) peer.inStreams[kind] = null;
    }

    // `renegotiate` vem da propria mensagem de sinalizacao: o ofertante
    // avisou que reofertou NA MESMA pc (removeTrack ao desligar a camera, ou
    // um offerTo numa outConn que ja existia). Trocar a conexao aqui, nesse
    // caso, responderia com ufrag ICE e fingerprint DTLS novos -- que a pc
    // dele nao espera como resposta da oferta que mandou -- e a renegociacao
    // nunca fecharia. Um peer em versao antiga nao manda o flag, e um flag
    // que chega sem conexao viva (ou com ela em estado que nao aceita
    // oferta) nao tem o que reusar: os dois caem no caminho de sempre,
    // recriar. Ver a auditoria de 2026-08-27, item A8.
    function ensureInConn(peerId, kind, renegotiate) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      const existing = peer.inConns[kind];
      if (renegotiate && existing && RENEGOTIABLE_STATES.has(existing.signalingState)) return existing;
      if (existing) {
        peer.inConns[kind] = null;
        cancelPcWork(existing);
        existing.close();
        // A stream antiga pertence a conexao que acabou de fechar; a nova
        // so existe quando o evento 'track' da nova conexao chegar.
        clearInStream(peerId, kind);
        onPeerState(peerId, { removedTile: true, kind });
      }
      peer.inConns[kind] = makeConnection(peerId, 'in', kind);
      return peer.inConns[kind];
    }

    function preferCodec(transceiver, mimeType) {
      if (!transceiver.setCodecPreferences) return;
      const caps = RTCRtpSender.getCapabilities('video');
      if (!caps) return;
      const wanted = caps.codecs.filter((c) => c.mimeType.toLowerCase() === mimeType.toLowerCase());
      if (!wanted.length) return;
      const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== mimeType.toLowerCase());
      try {
        transceiver.setCodecPreferences([...wanted, ...rest]);
      } catch {
        /* combinacao nao suportada, segue com o padrao */
      }
    }

    async function offerTo(peerId, stream, quality, kind, options = {}) {
      // UMA negociacao de saida por vez, por conexao.
      //
      // `createOffer` tira um RETRATO dos m-lines que existem no instante em
      // que e chamado, e so `setLocalDescription` o aplica. Duas chamadas
      // concorrentes na mesma pc, portanto, addTransceiver duas vezes (dois
      // encoders pro mesmo espectador) e produzem duas SDP com contagens
      // diferentes de m-line; aplicada fora de ordem, a menor e recusada com
      // InvalidAccessError ("The order of m-lines in subsequent offer doesn't
      // match order from previous offer/answer") e a conexao fica meio
      // negociada, sem nunca entregar um frame.
      //
      // A guarda e SINCRONA de proposito: o primeiro await ja seria tarde --
      // e exatamente entre ensureOutConn e setLocalDescription que a segunda
      // chamada entrava. Ver o log de 2026-09-05, 18:47:35.
      //
      // Quem chega com a negociacao em voo desiste em vez de esperar: o unico
      // caminho que corre de verdade e o repasse disparado duas vezes pra
      // mesma origem (flushPendingRelay, via onTrack e via case 'offer'), e
      // ali a segunda chamada e literalmente a mesma oferta -- enfileira-la
      // so devolveria o transceiver duplicado por outro caminho.
      const existing = peers.get(peerId)?.outConns[kind];
      const active = negotiating.get(existing);
      if (active) {
        console.warn(
          `[mesh] oferta pra #${peerId} (kind=${kind}) ignorada: negociacao em ${active.stage}`
          + ` ha ${Date.now() - active.started} ms`
        );
        return false;
      }
      const pc = existing || ensureOutConn(peerId, kind);
      if (options.videoPaused) setPeerDemand(peerId, kind, false, null);
      const previousDemand = demandByPc.get(pc)?.desired;
      return runNegotiation(pc, peerId, kind, 'out', negotiating, async (op) => {
        if (existing && existing.signalingState !== 'stable') {
          op.at('aguardar sinalizacao estavel');
          if (!options.waitForStable || !await waitForStable(pc, op.signal)) return false;
        }
        op.at('preparar transceivers');
        // Uma nova oferta pode reativar a camera na mesma PC. Restaura o
        // video antigo suspenso, exceto se a demanda mudou durante a espera.
        if (!options.videoPaused && previousDemand?.wanted === false
          && demandByPc.get(pc)?.desired === previousDemand) {
          const video = stream.getTracks().find((t) => t.kind === 'video');
          if (video) {
            setPeerDemand(peerId, kind, true, video);
            await demandApplied(peerId, kind);
            op.at();
          }
        }
        await negotiateOffer(pc, peerId, stream, quality, kind, Boolean(existing), op);
        return true;
      });
    }

    async function negotiateOffer(pc, peerId, stream, quality, kind, renegotiate, op) {
      // Ofertar numa outConn que JA existia e renegociacao (religar a camera
      // logo depois de stopCamera, por exemplo): sem avisar, o outro lado
      // derrubaria a conexao que continua de pe deste lado. Ver ensureInConn.

      // Renegociar numa pc que ja existe REAPROVEITA o transceiver de cada
      // tipo de midia em vez de empilhar outro. Empilhar deixava o receptor
      // com duas tracks de video na mesma stream e o <video> preso na
      // primeira -- a velha, muda: tela preta com os dados chegando. Medido
      // no Chromium 128 do app (spec 2026-09-12-tela-preta-ao-assistir):
      // 0 quadros exibidos, 120 decodificados na track que ninguem mostrava.
      const reusable = renegotiate && pc.getTransceivers
        ? pc.getTransceivers().filter((t) => !t.stopped && t.receiver?.track)
        : [];
      for (const track of stream.getTracks()) {
        op.at('preparar transceiver');
        const paused = track.kind === 'video' && isPeerSuspended(peerId, kind);
        const idx = reusable.findIndex((t) => t.receiver.track.kind === track.kind);
        if (idx >= 0) {
          const reused = reusable.splice(idx, 1)[0];
          reused.direction = 'sendonly';
          op.at('replaceTrack no transceiver reaproveitado');
          if (!paused && reused.sender.track !== track) await reused.sender.replaceTrack(track);
          op.at('configurar transceiver reaproveitado');
          reused.sender.setStreams?.(stream);
          if (track.kind === 'video') {
            preferCodec(reused, quality.codec);
            op.at('setParameters no transceiver reaproveitado');
            await applyReusedVideoParams(reused.sender, quality, peerId, kind);
          }
          continue;
        }
        // Quando a transmissao esta pausada, nem a primeira SDP pode carregar
        // a captura. O canal de video continua negociado para o religamento.
        const transceiver = pc.addTransceiver(paused ? 'video' : track, {
          direction: 'sendonly',
          streams: [stream],
          sendEncodings: track.kind === 'video'
            ? [{ maxBitrate: quality.bitrate, maxFramerate: quality.fps }]
            : undefined,
        });
        if (track.kind === 'video') {
          if (paused) demandByPc.get(pc)?.senders.add(transceiver.sender);
          preferCodec(transceiver, quality.codec);
          // degradationPreference nao existe no RTCRtpTransceiverInit, so em
          // setParameters -- sem isto a conexao nasce em 'balanced' e so vira
          // outra coisa se o usuario mexer na qualidade (o que chama
          // applyEncoding). A preferencia agora depende do kind (tela em
          // 'maintain-resolution', camera em 'maintain-framerate') -- ver
          // setDegradationPreference.
          setDegradationPreference(transceiver.sender, peerId, kind);
        }
      }
      // Sobrou transceiver sem track correspondente (a stream nova tem menos
      // midias, ou havia um empilhado por uma versao anterior): nao pode
      // seguir mandando a track velha.
      op.at('desativar transceivers restantes');
      for (const leftover of reusable) {
        leftover.sender.replaceTrack(null).catch(() => {});
        leftover.direction = 'inactive';
      }

      op.at('createOffer');
      const offer = await pc.createOffer();
      op.at('setLocalDescription da oferta');
      await pc.setLocalDescription({
        type: offer.type,
        sdp: withOpusParams(withStartBitrate(offer.sdp, startBitrateKbps(quality.bitrate))),
      });
      op.at('enviar oferta');
      sendSignal({ type: 'offer', to: peerId, sdp: pc.localDescription, kind, renegotiate });
    }

    /** Negociacao que morreu no meio: derruba a conexao e AVISA, pra que a
     * recuperacao que ja existe (onPeerState com failed:true) rode.
     *
     * Sem isto a pc ficava aberta e vazia -- sem remoteDescription, sem
     * nunca conectar. Como ela nunca chega em 'failed' no
     * connectionstatechange (ela nao falhou: ela nunca comecou), nada
     * disparava a maquina de recuperacao, e o unico rastro era uma linha no
     * log. Pra quem estava na sala, "a tela de alguem sumiu e nao voltou".
     * Ver o log de 2026-09-05, 04:57:21-22. */
    function failNegotiation(peerId, kind, dir, pc, err, stage) {
      const peer = peers.get(peerId);
      const slot = dir === 'in' ? peer?.inConns : peer?.outConns;
      if (slot?.[kind] !== pc) return;
      slot[kind] = null;
      if (dir === 'out' && peer.suspended) peer.suspended[kind] = false;
      cancelPcWork(pc);
      try {
        pc.close();
      } catch {
        /* ja fechada */
      }
      if (dir === 'in') clearInStream(peerId, kind);
      console.error(
        `[mesh] negociacao de ${dir} com #${peerId} (kind=${kind}) falhou em ${stage}, derrubando a conexao:`,
        `${err?.name || 'Erro'}: ${err?.message || err}`
      );
      onPeerState(peerId, { removedTile: dir === 'in', kind, dir, failed: true });
    }

    /** PCs que perderam uma oferta/resposta durante a suspensao nao podem
     * voltar so por o WebSocket ter voltado. Usa a mesma falha que ja limpa
     * slots e avisa o app, para ele re-ofertar somente as saidas necessarias. */
    function recoverUnstable() {
      const recovered = [];
      for (const [peerId, peer] of peers) {
        for (const [dir, conns] of [['in', peer.inConns], ['out', peer.outConns]]) {
          for (const [kind, pc] of Object.entries(conns)) {
            if (!pc) continue;
            if (pc.signalingState === 'stable' && pc.iceConnectionState !== 'failed' && pc.connectionState !== 'failed') continue;
            recovered.push({ peerId, kind, dir });
            failNegotiation(peerId, kind, dir, pc, new Error('sinalizacao interrompida'), 'retomada');
          }
        }
      }
      return recovered;
    }

    function setSend(next) {
      sendSignal = typeof next === 'function' ? next : () => {};
    }

    async function handleOffer(fromId, sdp, kind, renegotiate) {
      const pc = ensureInConn(fromId, kind, renegotiate);
      if (negotiating.has(pc)) throw new Error(`oferta em andamento com #${fromId} (kind=${kind})`);
      return runNegotiation(pc, fromId, kind, 'in', negotiating, async (op) => {
        op.at('setRemoteDescription da oferta');
        await pc.setRemoteDescription(sdp);
        op.at('drenar candidatos ICE');
        await drainIce(pc, op);
        op.at('createAnswer');
        const answer = await pc.createAnswer();
        // Estereo se negocia dos dois lados: sem declarar aqui tambem, o par
        // cai pra mono mesmo com a oferta pedindo estereo.
        op.at('setLocalDescription da resposta');
        await pc.setLocalDescription({ type: answer.type, sdp: withOpusParams(answer.sdp) });
        return pc.localDescription;
      });
    }

    async function handleAnswer(fromId, sdp, kind) {
      const peer = peers.get(fromId);
      const pc = peer?.outConns[kind];
      if (!pc) return;
      // Uma 'answer' so pode ser aplicada numa pc que esta ESPERANDO por
      // ela. Em qualquer outro estado -- resposta duplicada, resposta
      // atrasada de uma oferta que ja foi substituida, pc fechada no meio
      // do caminho -- setRemoteDescription lanca InvalidStateError. E era
      // uma conexao SA sendo morta por uma mensagem tardia: ignorar e o
      // certo, nao derrubar.
      if (pc.signalingState !== 'have-local-offer') {
        console.warn(
          `[mesh] 'answer' de #${fromId} (kind=${kind}) ignorada:`
          + ` a conexao esta em '${pc.signalingState}', nao esperava resposta`
        );
        return;
      }
      if (answering.has(pc)) return;
      await runNegotiation(pc, fromId, kind, 'out', answering, async (op) => {
        op.at('setRemoteDescription da resposta');
        await pc.setRemoteDescription(sdp);
        op.at('drenar candidatos ICE');
        await drainIce(pc, op);
      });
    }

    async function handleIce(fromId, dir, candidate, kind) {
      const peer = peers.get(fromId);
      if (!peer || !candidate) return;
      const target = dir === 'out' ? peer.inConns[kind] : peer.outConns[kind];
      if (!target) return;

      // Adiantado: a conexao existe mas a SDP remota ainda esta a caminho
      // (ou no meio do await). Guarda e entrega em drainIce, logo depois do
      // setRemoteDescription -- ver o comentario de pendingIce.
      if (!target.remoteDescription) {
        const queued = pendingIce.get(target) || [];
        queued.push(candidate);
        if (queued.length > MAX_PENDING_ICE) queued.shift();
        pendingIce.set(target, queued);
        return;
      }

      try {
        await target.addIceCandidate(candidate);
      } catch {
        /* candidato invalido ou conexao ja fechando; nao ha o que fazer */
      }
    }

    function setDegradationPreference(sender, peerId, kind) {
      if (!sender) return;
      // Tela perde fps sob banda baixa, nunca pixels: H.264 hardware do
      // Chromium 128 recusa altura <= 359 e dimensao impar. Camera fica em
      // 'maintain-framerate' porque rosto travando incomoda mais que perder
      // nitidez. parseKind cobre o kind de repasse (screen@<origem>).
      const pref = parseKind(kind).baseKind === 'screen' ? 'maintain-resolution' : 'maintain-framerate';
      try {
        const params = sender.getParameters();
        params.degradationPreference = pref;
        sender.setParameters(params).catch((err) => console.warn('[mesh] setParameters falhou', peerId, kind, err?.name));
      } catch {
        /* sender pode ter sido fechado no meio da negociacao */
      }
    }

    // Transceiver reaproveitado nao passa pelo sendEncodings do
    // addTransceiver: teto e preferencia de degradacao vao num setParameters
    // UNICO (dois em voo no mesmo sender brigam pelo transactionId).
    async function applyReusedVideoParams(sender, quality, peerId, kind) {
      try {
        const params = sender.getParameters();
        if (params.encodings?.[0]) {
          params.encodings[0].maxBitrate = quality.bitrate;
          params.encodings[0].maxFramerate = quality.fps;
        }
        params.degradationPreference = parseKind(kind).baseKind === 'screen' ? 'maintain-resolution' : 'maintain-framerate';
        await sender.setParameters(params);
      } catch (err) {
        console.warn('[mesh] setParameters no transceiver reaproveitado falhou', peerId, kind, err?.name);
      }
    }

    /** Resumo da conexao de saida pra um peer/kind, so pra log de
     * diagnostico ([assistir]). Nunca lanca. */
    function describeOut(peerId, kind) {
      const pc = peers.get(peerId)?.outConns?.[kind];
      if (!pc) return 'sem conexao';
      try {
        const videos = (pc.getTransceivers ? pc.getTransceivers() : [])
          .filter((t) => t.receiver?.track?.kind === 'video');
        const tracks = videos
          .map((t) => (t.sender.track ? `${t.sender.track.readyState}${t.sender.track.muted ? '/muda' : ''}` : 'sem-track'))
          .join(',');
        return `pc=${pc.connectionState} canais-video=${videos.length} [${tracks}] suspenso=${Boolean(peers.get(peerId)?.suspended?.[kind])}`;
      } catch {
        return 'indisponivel';
      }
    }

    function applyEncoding(quality, kind) {
      for (const peer of peers.values()) {
        const pc = peer.outConns[kind];
        if (!pc) continue;
        for (const sender of pc.getSenders()) {
          if (!sender.track || sender.track.kind !== 'video') continue;
          const params = sender.getParameters();
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = quality.bitrate;
          params.encodings[0].maxFramerate = quality.fps;
          // Mesma regra do setDegradationPreference: tela em
          // 'maintain-resolution', camera em
          // 'maintain-framerate'. parseKind cobre o kind de repasse.
          params.degradationPreference =
            parseKind(kind).baseKind === 'screen' ? 'maintain-resolution' : 'maintain-framerate';
          sender.setParameters(params).catch((err) => console.warn('[mesh] setParameters falhou', peer.id, kind, err?.name));
        }
      }
    }

    /** Igual a applyEncoding, mas resolve UMA conexao (peerId + kind) e
     * tambem empurra a resolucao pra baixo no encoder via
     * scaleResolutionDownBy -- o piso global controla a captura, esta
     * funcao afina por-espectador a partir dele. `scaleDownBy` vem pronto
     * de quem chama (config.scaleFactorFor), pra este modulo nao depender
     * do config. */
    function applyEncodingToPeer(peerId, quality, kind, scaleDownBy, onApplied) {
      const pc = peers.get(peerId)?.outConns[kind];
      if (!pc) return;
      for (const sender of pc.getSenders()) {
        if (!sender.track || sender.track.kind !== 'video') continue;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = quality.bitrate;
        params.encodings[0].maxFramerate = quality.fps;
        params.encodings[0].scaleResolutionDownBy = Number(scaleDownBy) > 0 ? Number(scaleDownBy) : 1;
        // Ver applyEncoding: tela em 'maintain-resolution', camera em
        // 'maintain-framerate'.
        params.degradationPreference =
          parseKind(kind).baseKind === 'screen' ? 'maintain-resolution' : 'maintain-framerate';
        sender.setParameters(params)
          .then(() => onApplied?.({ peerId, kind, scaleDownBy: params.encodings[0].scaleResolutionDownBy, maxBitrate: params.encodings[0].maxBitrate }))
          .catch((err) => console.warn('[mesh] setParameters falhou', peerId, kind, err?.name));
      }
    }

    // Remove uma track especifica (ex: camera) da outConn daquele kind sem
    // mexer na outConn de outro kind do mesmo peer (ex: tela, que agora vive
    // numa RTCPeerConnection separada -- ver comentario acima de
    // makeConnection). Renegocia com uma nova oferta pra avisar o lado
    // remoto -- do contrario a track para de mandar frames mas a conexao
    // continua "viva" e o peer remoto fica vendo o ultimo frame congelado
    // indefinidamente.
    async function removeTrack(peerId, track, kind) {
      const peer = peers.get(peerId);
      const pc = peer?.outConns[kind];
      if (!pc) return false;
      const sender = pc.getSenders().find((s) => s.track === track);
      if (!sender) return false;
      if (negotiating.has(pc)) return false;
      return runNegotiation(pc, peerId, kind, 'out', negotiating, async (op) => {
        op.at('aguardar sinalizacao estavel para remover track');
        if (!await waitForStable(pc, op.signal)) return false;
        op.at('remover track');
        pc.removeTrack(sender);
        op.at('createOffer ao remover track');
        const offer = await pc.createOffer();
        op.at('setLocalDescription ao remover track');
        await pc.setLocalDescription(offer);
        // Renegociacao pura: a pc, o ICE e o DTLS continuam de pe deste
        // lado, so a track saiu. Ver ensureInConn.
        op.at('enviar oferta sem track');
        sendSignal({ type: 'offer', to: peerId, sdp: pc.localDescription, kind, renegotiate: true });
        return true;
      }).catch(() => false);
    }

    // Fecha so a outConn de um peer/kind especifico, sem mexer no outro
    // kind do mesmo peer nem nos demais peers. Usado na troca de PAPEL na
    // arvore (F2): a origem para de mandar direto pra um peer que passou a
    // ser folha de um relay. Diferente de setPeerDemand (F1.3): aqui a
    // conexao fecha de verdade, porque quem vai mandar video pra esse peer
    // e outro no (o relay), nao mais a origem.
    function closeOut(peerId, kind) {
      const peer = peers.get(peerId);
      const pc = peer?.outConns[kind];
      if (!pc) return;
      peer.outConns[kind] = null;
      cancelPcWork(pc);
      if (peer.suspended) peer.suspended[kind] = false;
      pc.close();
    }

    // Repassa uma track JA RECEBIDA (peers.get(sourcePeerId).inStreams[kind])
    // pra um peer abaixo na arvore (F2). O Chromium recodifica -- nao existe
    // passagem direta de frame codificado entre RTCPeerConnections -- entao
    // isto custa 1 decode + 1 encode a mais no relay. Ver a spec de
    // 2026-08-23, secao F2.
    //
    // Devolve false sem lancar se a stream ainda nao chegou (a mensagem
    // 'tree' pode chegar antes da 'offer' da origem terminar de negociar --
    // ver o retry em app.js, Task 5).
    //
    // A conexao criada pro filho usa o kind COMPOSTO ('screen@<origem>'),
    // nao o cru -- ver relayKindFor no topo deste arquivo pro porque.
    async function relayTo(childId, sourcePeerId, kind, quality) {
      const inbound = peers.get(sourcePeerId)?.inStreams?.[kind];
      if (!inbound) return false;
      const track = inbound.getVideoTracks()[0];
      // Track ja encerrada (a conexao com a origem caiu e a stream guardada
      // ficou pra tras): repassar isto so entrega tela preta.
      if (track?.readyState === 'ended') return false;
      // Heranca do contentHint da origem nao e garantida pelo Chromium na
      // recodificacao -- reaplicar aqui.
      if (track) track.contentHint = 'motion';
      return offerTo(childId, inbound, quality, relayKindFor(kind, sourcePeerId));
    }

    // ---------- Encode sob demanda (spec de 2026-08-23, F1.3) ----------
    //
    // Ninguem deve pagar encode por um espectador que nao esta olhando. Cada
    // RTCRtpSender do Chromium instancia SEU PROPRIO encoder -- com 3
    // espectadores sao 3 encodes de 1080p60 saindo da mesma captura, na
    // mesma GPU que o jogo usa.
    //
    // replaceTrack(null) libera o encoder na hora e NAO exige renegociacao:
    // a PeerConnection, o ICE e o DTLS continuam de pe, entao religar custa
    // um frame. Fechar a pc faria o oposto -- ICE + DTLS + SDP de novo,
    // segundos de tela preta ao voltar.
    //
    // So a track de VIDEO suspende: quem minimizou provavelmente ainda quer
    // ouvir, e encode de audio e irrelevante perto do de video.
    //
    // A intencao fica visivel imediatamente para watchersOf e a qualidade.
    // A fila, os senders e os prazos pertencem a uma unica PC: ao trocar de
    // conexao, nem um replaceTrack pendente da antiga pode atrasar a nova.
    function setPeerDemand(peerId, kind, wanted, track) {
      const peer = peers.get(peerId);
      const pc = peer?.outConns[kind];
      if (!pc) return false;
      let state = demandByPc.get(pc);
      if (Boolean(peer.suspended?.[kind]) === !wanted
        && (!wanted || !state || state.desired.track === track)) return false;
      if (!state) {
        state = { controller: new AbortController(), senders: new Set(), desired: null, running: false };
        demandByPc.set(pc, state);
      }
      (peer.suspended ||= {})[kind] = !wanted;
      state.desired = { wanted, track };
      runDemand(peerId, kind, pc, state);
      return true;
    }

    function runDemand(peerId, kind, pc, state) {
      if (state.controller.signal.aborted) return;
      state.dirty = true;
      if (state.running) return;
      state.running = true;
      state.applied = (async () => {
        try {
          while (state.dirty && !state.controller.signal.aborted) {
            state.dirty = false;
            const intent = state.desired;
            // Depois de replaceTrack(null) e o receiver que identifica o
            // canal de video. Guardamos os conhecidos mesmo se o religar falhar.
            for (const s of pc.getSenders?.() || []) {
              if (s.track?.kind === 'video') state.senders.add(s);
            }
            for (const t of pc.getTransceivers?.() || []) {
              if (t.receiver?.track?.kind === 'video' && t.sender && !t.stopped) state.senders.add(t.sender);
            }
            if (intent.wanted && !intent.track) {
              console.warn('[mesh] religar sem track -- senders preservados', peerId, kind);
              continue;
            }
            await Promise.all([...state.senders].map((sender) =>
              replaceDemandTrack(peerId, kind, pc, state, sender, intent)));
          }
        } catch (err) {
          console.warn('[mesh] demanda falhou', peerId, kind, err?.name || err);
        } finally {
          state.running = false;
        }
      })();
    }

    // Se a chamada expirar, o reconciliador pode seguir. Uma escrita
    // tardia so pede outra aplicacao enquanto ESTA conexao ainda estiver viva.
    function replaceDemandTrack(peerId, kind, pc, state, sender, intent) {
      const { signal } = state.controller;
      const phase = intent.wanted ? 'religar' : 'suspender';
      let expired = false;
      return new Promise((resolve) => {
        let waiting = true;
        const finish = () => {
          if (!waiting) return;
          waiting = false;
          clearTimeout(timer);
          signal.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(() => {
          expired = true;
          console.warn('[mesh] demanda expirou', peerId, kind, phase, `${demandTimeoutMs}ms`);
          finish();
        }, demandTimeoutMs);
        signal.addEventListener('abort', finish, { once: true });
        Promise.resolve().then(() => {
          if (!signal.aborted) return sender.replaceTrack(intent.wanted ? intent.track : null);
        }).then(() => {
          if (expired && !signal.aborted && currentPc(peerId, kind, 'out') === pc && state.desired !== intent) {
            runDemand(peerId, kind, pc, state);
          }
        }, (err) => {
          if (!expired && !signal.aborted) console.warn(`[mesh] ${phase} falhou`, peerId, kind, err?.name || err);
        }).finally(finish);
      });
    }

    function isPeerSuspended(peerId, kind) {
      return Boolean(peers.get(peerId)?.suspended?.[kind]);
    }

    /** Resolve quando a ultima demanda enfileirada pra esse peer/kind ja
     * chegou nos senders. E o que deixa o log [assistir] contar o que de fato
     * aconteceu: ate 2026-09-19 ele chamava describeOut no mesmo tique da
     * troca e imprimia sempre o estado ANTERIOR -- 'religado ... [sem-track]'
     * e 'suspenso ... [live]', invertido, em 100% das 60 transicoes. */
    function demandApplied(peerId, kind) {
      return Promise.resolve(demandByPc.get(currentPc(peerId, kind, 'out'))?.applied);
    }

    function replaceLocalTrack(kind, matchKind, track) {
      let tocados = 0;
      for (const peer of peers.values()) {
        const pc = peer.outConns[kind];
        if (!pc) continue;
        // P1: trocar fonte nao pode religar video que a pausa suspendeu.
        if (matchKind === 'video' && peer.suspended?.[kind]) continue;
        const sender = pc.getSenders().find((s) => s.track?.kind === matchKind);
        if (!sender) continue;
        sender.replaceTrack(track || null).catch(() => {});
        tocados += 1;
      }
      return tocados;
    }

    /** Quem, entre os peers pra quem estamos ENVIANDO aquele kind, esta de
     * fato assistindo agora (nao suspenso por F1.3). E a lista que o
     * transmissor broadcasta pra sala poder desenhar "quem esta assistindo"
     * no proprio tile -- ver app.js broadcastWatchers. */
    function watchersOf(kind) {
      const out = [];
      for (const peer of peers.values()) {
        if (!peer.outConns[kind]) continue;
        if (peer.suspended?.[kind]) continue;
        out.push({ id: peer.id, name: peer.name, avatar: peer.avatar || null });
      }
      return out;
    }

    /** Pares { peerId, kind } de quem estamos RECEBENDO video agora. E a
     * lista de destinatarios do nosso proprio 'view-state'. */
    function receivingFrom() {
      const out = [];
      for (const [peerId, peer] of peers) {
        for (const kind of Object.keys(peer.inConns)) {
          if (peer.inConns[kind]) out.push({ peerId, kind });
        }
      }
      return out;
    }

    function closeAllOut(kind) {
      for (const peerId of peers.keys()) closeOut(peerId, kind);
    }

    async function statsFor(peerId, kind = 'screen') {
      const pc = peers.get(peerId)?.outConns[kind];
      if (!pc || pc.connectionState !== 'connected') return null;
      return pc.getStats();
    }

    /** Igual a statsFor, mas da conexao de ENTRADA daquele kind -- e por
     * onde o espectador enxerga a propria recepcao. */
    async function inStatsFor(peerId, kind = 'screen') {
      const pc = peers.get(peerId)?.inConns[kind];
      if (!pc || pc.connectionState !== 'connected') return null;
      return pc.getStats();
    }

    return {
      peers,
      addPeer,
      removePeer,
      handleOffer,
      handleAnswer,
      handleIce,
      offerTo,
      isNegotiating,
      recoverUnstable,
      setSend,
      removeTrack,
      applyEncoding,
      applyEncodingToPeer,
      closeAllOut,
      closeOut,
      relayTo,
      statsFor,
      inStatsFor,
      setPeerDemand,
      isPeerSuspended,
      demandApplied,
      replaceLocalTrack,
      receivingFrom,
      watchersOf,
      describeOut,
    };
  }

  const api = {
    createMesh, withStartBitrate, withOpusParams, startBitrateKbps, relayKindFor, parseKind, RTC_CONFIG,
    DEMAND_REPLACE_TIMEOUT_MS,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesh = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
