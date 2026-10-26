# Escada de resolução decidida por congestão, não pela BWE parada

**Estado:** plano, versão 3. Passou por duas revisões: a primeira deu
"replanejar a seção 2 e a Tarefa 1" e a segunda "implementar com as correções".
A v3 aplica essas correções. A seção 5 diz o que mudou por causa de cada achado.
**Origem:** logs de 2026-10-07 (Nubanho, 0.25.0) e de 2026-10-18 (Nicolas,
0.26.0), e o spike de 2026-10-25 no Electron 44.4.3 com os módulos de produção.

## 1. O problema, com evidência

No log de 18/10, das 03:21 às 04:27, a tela do Nicolas para o Nubanho ficou em
1080p só nos primeiros ~2,5 min. Depois disso ficou cerca de metade do tempo em
720p e metade em 540p/360p, embora o mesmo log mostre a conexão aguentando
6,5 Mbps (`realKbps=6536` às 04:19:52). Sair e entrar da sala "normaliza".

`screenres.next` (`src/renderer/screenres.js:111`) trata a média da
`availableOutgoingBitrate` (BWE do GCC) como capacidade da rede: desce se ela
fica abaixo de `BWE_BPS[h].down` por 5 s e sobe se fica acima de
`BWE_BPS[h].up` por 15 s.

### O que o spike mediu (loopback, sem limite de banda, lógica de produção)

| Cenário | Resultado |
|---|---|
| Jogo (ruído a cada quadro), preso em 720p, teto 1,2×BWE | sobe para 1080p em 24 s |
| O mesmo, teto = preset (controle) | sobe em 41 s |
| Desktop (texto parado + caixa pequena), conexão nova | BWE **congelada em 4803 kbps** por 57 s, real 190–380 kbps |
| Desktop, começando em 540p | sobe para 720p e **fica**: BWE congelada em 5204 kbps < 7,5 Mbps, num link sem limite |

Conclusões, com o alcance de cada uma:

1. **O teto `bitrateCap` (1,2×BWE) não travou a subida na faixa varrida**:
   BWE de ~4,8 Mbps para cima, em loopback sem limite de banda. **Abaixo disso
   não foi testado**, e é justamente onde o log de 18/10 está (BWE de 1,4 a
   2 Mbps, teto de 1,7 a 2,4 Mbps). A Tarefa 4 varre essa faixa. Até lá o teto
   fica como está, sem a afirmação de que é inofensivo.
2. **Com pouco movimento a BWE não se mexe.** O encoder manda bem menos que a
   estimativa, o GCC não tem o que medir e ela fica parada no valor que tinha.
   Quando uma oscilação do Radmin a derruba, ela não volta enquanto a tela tiver
   pouco movimento, e a escada atual desce e fica presa.
3. **Sair e entrar resolve** porque a conexão nova refaz a sondagem inicial do
   GCC e `screenResolution` volta a `initialState` (a chave inclui a PC,
   `app.js:668`).

No log de 18/10, nas linhas `[diag]` imediatamente anteriores às descidas, o uso
(`realKbps / bwe`) ficava em geral entre 0,2 e 0,6. Isso é coerente com a BWE
caindo com o encoder folgado. Ressalva: são instantâneos a cada 15 s, que não
provam isso segundo a segundo.

### O que NÃO foi confirmado no motor real

- A queda logo no início da conexão, com a primeira amostra baixa (~0,3 Mbps)
  entrando na média. No loopback o Chrome já começa em ~5 Mbps. Evidência só
  do log (02:46:02 `banda estimada 0,3 Mbps`, queda de 1080p para 720p às
  02:46:27) e da leitura do código.
- Por que a BWE cai no Radmin (perda? atraso?). O log de hoje não registra
  perda nem RTT por sender; a Tarefa 3 resolve isso para a próxima vez.
- Toda a parte de congestão real (descida, recuo, limiares). Só o modelo da
  seção 4 e os testes cobrem isso, até a Tarefa 4.

## 2. Desenho

Princípio: **a BWE só informa a capacidade quando o encoder está usando a
banda.** Com folga, ela fica parada e não diz nada sobre a rede.

Por amostra (tick de 1 s com o app visível, 5 s escondido), por sender:

- **`uso = real / amostra de BWE`**, com a amostra crua da própria linha, e não
  o teto aplicado. `pressionando` = `uso ≥ 0,85`; `folga` = o contrário, quando
  há `uso`.
  - O `bytesSent` conta só a carga RTP. Então o uso real do canal é ~5 a 12 %
    maior que esse número, e o 0,85 equivale a ~0,92 a 0,97 do canal. Certeza
    média.
- **Só conta quem está enviando:** com a tela pausada (alvo direto), demanda
  suspensa, `fps` 0 ou sem amostra de BWE, nada anda: nem relógios, nem folga,
  nem média.
  - **Voltar a enviar** depois de 10 s ou mais parado reabre o aquecimento
    (N12; o GCC pode precisar sondar de novo; estimado).
- **Um tick vale no máximo 10 s** (`DT_MAX_MS`). Tick mais longo é linha que
  faltou (stats nulas, renderer travado) e não pode valer por minutos de folga.
- **Aquecimento de 10 s** por PC: nada é decidido e a média segue a amostra
  crua. Assim o teto do encoder acompanha a rampa do GCC, e a média começa do
  valor do fim da rampa. Por que 10 s: no log de 02:46 a rampa ainda estava em
  curso uns 10 s depois do início. **Número estimado, não medido.**
- **Média por tempo**: `alpha = 1 − 0,75^(dt/1 s)`. Com tick de 5 s, a média
  anda o mesmo que em cinco ticks de 1 s.
- **Descer** só com a BWE limitando de verdade: o encoder `pressionando` e a
  média abaixo do limiar de descida do degrau.
  - O tempo limitando **acumula, e o tempo sem limitar desconta**, em vez de
    zerar a cada tick fora. Desce quando o acumulado chega a 5 s. Assim o
    serrote normal do GCC (sobe devagar, cai de uma vez) e o ruído da amostra
    não seguram a descida (N1).
  - Cada tick soma no máximo 2,5 s (`LIMITE_POR_TICK_MS`): com o tick de 5 s do
    app escondido, que é o caso de quem transmite um jogo, são duas amostras
    (10 s, como na escada atual), e não uma.
  - Com uma tentativa aberta, a BWE subindo (amostra 5 % acima da média) pausa
    a conta. É a BWE saindo do valor congelado para descobrir a banda do degrau
    novo (I3). Fora de tentativa, subir não protege da descida, ou o serrote
    nunca deixaria descer.
  - Perda e RTT **não descem**: com o encoder ocioso, baixar a resolução não
    alivia a rede, e com o encoder cheio o GCC já reage a perda e a atraso
    cortando a BWE, que cai na regra acima.
- **Subir comprovado**: média ≥ limiar de subida por 15 s, igual a hoje. Zera
  a tentativa e o recuo.
- **Subir por tentativa**, sem zona morta. A folga **acumula**: um tick
  pressionando pausa a conta, não zera. Quando a folga passa de `recuoMs`
  (começa em 15 s), sobe um degrau e abre uma tentativa.
  - Com uma tentativa ainda sem prova, a próxima (empilhada) espera o **dobro**
    (N5).
  - Nada sobe sem estar `livre`, que significa:
    - perda < 2 % na janela de 10 s (Σ perdidos / Σ enviados), medida só com
      pelo menos 200 pacotes; com menos, a perda não é medida e não trava
      (N3);
    - RTT sem inflar ≥ 150 ms sobre a base;
    - encoder não limitado por CPU.
  - Sem `livre`, a folga zera.
- **A tentativa só se prova com uso:** 10 s acumulados com o encoder usando o
  degrau novo sem a BWE limitar. "Usando" quer dizer pressionando a BWE ou
  mandando ao menos o limiar de descida do degrau. Conteúdo que cabe folgado
  não pressiona, mas manda bits. Aí o recuo volta a 15 s. Tela parada não
  prova nada, e a tentativa fica aberta.
- **A tentativa falha** quando vem uma descida com ela aberta: o recuo dobra
  (15 → 30 → 60 → 120 s, teto).
- **RTT de base** = mínimo dos últimos 60 s, em baldes de 10 s, ignorando
  valores ≤ 0. Uma troca de rota vira a base nova em até um minuto. A fonte
  preferida é o RTT do RTCP (`remote-inbound-rtp.roundTripTime`), que mede a
  fila da mídia; sem ele, o do par ICE.
  - **Limite conhecido (N11):** uma fila que o próprio envio mantenha estável
    por mais de 60 s vira a base, e o RTT volta a contar como livre. Aceito,
    porque o RTT só trava a subida. Quem desce é a BWE limitando.
- **Carência no `peerquality`:** a limitação `bandwidth` do WebRTC não conta
  como ruim para a escada de preset em dois momentos:
  - nos 10 s depois de uma subida por tentativa;
  - nos 10 s depois da descida que a desfaz (N8).

  A escada de resolução resolve primeiro.

Fica como está: `bitrateCap`, `SCREEN_HEIGHTS`, os limiares `BWE_BPS`,
`nearestAcceptableScale`, a escada global (`autoquality.js`) e a P1.

**Risco aceito, com número do modelo (seção 4, S2):** numa rede de 1,5 Mbps
com tela alternando 60 s parada e 20 s em movimento, a tentativa sobe na parte
parada e falha no movimento. Foram 24 falhas por hora, com intervalo mínimo
de 160 s entre falhas depois da quarta.

Cada falha custa até ~5 s de encoder pressionando acima da rede **por degrau
empilhado**: duas descidas, ~10 s, quando havia duas tentativas sem prova. O
ganho é a imagem parada em resolução maior com a mesma banda, porque tela
parada gasta pouco. Se o custo incomodar no Radmin, os botões são
`RECUO_MAX_MS` e `PROVA_PRESSAO_MS`.

**As constantes (0,85 / 5 % / 2 % / 200 pacotes / 150 ms / 60 s / 10 s / 2,5 s
/ 120 s) são pontos de partida, não medidas.** Não ajustar ao log de uma noite
só: a Tarefa 4 existe para medir antes de mexer nelas.

## 3. Tarefas

### Tarefa 1 — `screenres`: observação inteira, regras novas (TDD)

Arquivo: `src/renderer/screenres.js`. No arquivo atual, `lowerHeight` e
`higherHeight` ficam **entre** `initialState` e `next`. Por isso a troca é em
duas remoções separadas, e não num intervalo só:

1. remover `function initialState(` (linhas 91–98 hoje) até antes de
   `function lowerHeight(`;
2. remover o comentário `/** Uma amostra de BWE por sender.` e `function next(`
   até antes de `// K > 1 deixa o GCC`;
3. inserir o trecho abaixo no lugar do `next` removido.

`highestAllowedHeight`, `lowerHeight`, `higherHeight`, `bitrateCap` e os
limiares ficam.

Assinatura nova: `next(state, obs, atMs, maxHeight)`, com `obs` montado por
`observacao(row, { ativo })`. O export ganha:
- `observacao`, `emCarencia`, `motivoRecente`;
- as constantes `AQUECIMENTO_MS, USO_PRESSAO, BWE_SUBINDO, PERDA_LIVRE,
  PERDA_JANELA_MS, PERDA_MIN_PACOTES, RTT_INFLADO_MS, RTT_JANELA_MS,
  PROVA_PRESSAO_MS, RECUO_INICIAL_MS, RECUO_MAX_MS, CARENCIA_TENTATIVA_MS,
  DT_MAX_MS, LIMITE_POR_TICK_MS, MOTIVO_RECENTE_MS`.

Os trechos de texto do `motivo` vão só para o log. Eles entram em `EXCECOES`
de `tools/i18n/literais.js`, como os outros relatórios para o desenvolvedor
(spec 2.4). Sem isso, a catraca `src/renderer/i18n/texto-solto.test.js` acusa
cinco textos soltos: `'kbps com o encoder usando'`, `'; tentativa falhou,
proxima em'`, `'tentativa: encoder usando'`, `'% da bwe,'` e `'s de folga'`.
A Tarefa 2 (`[qualidade] tela->…`) e a Tarefa 3 (campos do `[diag]`) vão
precisar do mesmo.

**Atenção:** com só a Tarefa 1, o `app.js` ainda chama `next(…, row.availableBps, …)`
com um número. A escada fica parada (`obs.availableBps` indefinido devolve
`parado`) até a Tarefa 2. Não lançar versão entre as duas.

```js
  // ---------- Escada por congestao (plano 2026-10-25, v3) ----------
  // A BWE so mede a rede quando o encoder a usa. Com folga, ela fica parada
  // no valor que tinha (medido no spike de 2026-10-25) e quem decide subir e
  // a tentativa com recuo. Descer exige o encoder pressionando a BWE.
  const AQUECIMENTO_MS = 10000;
  const USO_PRESSAO = 0.85;
  const BWE_SUBINDO = 1.05;
  const PERDA_LIVRE = 0.02;
  // Perda numa janela, nao por tick: tela parada manda ~30-100 pacotes/s, e
  // um pacote perdido num tick so ja passaria de 2 %.
  const PERDA_JANELA_MS = 10000;
  const PERDA_MIN_PACOTES = 200;
  const RTT_INFLADO_MS = 150;
  const RTT_JANELA_MS = 60000;
  const RTT_BALDE_MS = 10000;
  const PROVA_PRESSAO_MS = 10000;
  const RECUO_INICIAL_MS = UP_HOLD_MS;
  const RECUO_MAX_MS = 120000;
  // Logo depois de uma tentativa (e da descida que a desfaz), a limitacao
  // 'bandwidth' do WebRTC e a propria tentativa sendo testada: a escada
  // resolve, e o peerquality nao deve somar um degrau de preset por cima.
  const CARENCIA_TENTATIVA_MS = 10000;
  // O tick e de 1 s (5 s com o app escondido). Mais que isso e linha que
  // faltou (stats nulas, renderer travado): um tick so nao vale por minutos.
  const DT_MAX_MS = 10000;
  // Quanto um tick so pode somar ao tempo limitando: com o tick de 5 s do app
  // escondido (o caso de quem transmite um jogo), uma amostra so nao derruba
  // o degrau; sao duas, 10 s, como na escada antiga.
  const LIMITE_POR_TICK_MS = DOWN_HOLD_MS / 2;
  // Ate quando o motivo da ultima troca ainda explica uma linha [diag] MUDOU.
  const MOTIVO_RECENTE_MS = 30000;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const kbps = (bps) => Math.round(bps / 1000);
  const pct = (f) => Math.round(f * 100);

  function initialState(maxHeight, atMs = 0) {
    return {
      height: highestAllowedHeight(maxHeight),
      bweBps: null,
      aboveSinceMs: null,
      desdeMs: Number(atMs) || 0,
      ultimoMs: null,
      paradoDesdeMs: null,
      limiteMs: 0,
      folgaMs: 0,
      rttBaldes: [],
      perdaJanela: [],
      perda: null,
      tentativa: null,
      recuoMs: RECUO_INICIAL_MS,
      carenciaAteMs: null,
      motivo: null,
      ultimoMotivo: null,
      ultimoMotivoMs: null,
    };
  }

  /** Minimo de RTT por balde de 10 s, so os ultimos 60 s: uma troca de rota
   * no Radmin vira a base nova em ate um minuto, em vez de congestao eterna. */
  function registrarRtt(baldes, rttMs, atMs) {
    const vivos = (baldes || []).filter((b) => atMs - b.inicioMs < RTT_JANELA_MS);
    if (!(rttMs > 0)) return vivos;
    const ultimo = vivos[vivos.length - 1];
    if (ultimo && atMs - ultimo.inicioMs < RTT_BALDE_MS) {
      return [...vivos.slice(0, -1), { inicioMs: ultimo.inicioMs, min: Math.min(ultimo.min, rttMs) }];
    }
    return [...vivos, { inicioMs: atMs, min: rttMs }];
  }

  function rttBase(baldes, atMs) {
    const vivos = (baldes || []).filter((b) => atMs - b.inicioMs < RTT_JANELA_MS);
    return vivos.length ? Math.min(...vivos.map((b) => b.min)) : null;
  }

  function registrarPerda(janela, perdidos, enviados, atMs) {
    const vivos = (janela || []).filter((p) => atMs - p.atMs < PERDA_JANELA_MS);
    if (!(enviados > 0) || !(perdidos >= 0)) return vivos;
    return [...vivos, { atMs, perdidos, enviados }];
  }

  /** Perdidos sobre enviados na janela; null com poucos pacotes para medir. */
  function perdaDaJanela(janela) {
    const enviados = janela.reduce((s, p) => s + p.enviados, 0);
    if (enviados < PERDA_MIN_PACOTES) return null;
    return Math.min(1, janela.reduce((s, p) => s + p.perdidos, 0) / enviados);
  }

  /** A escada acabou de subir por tentativa, ou de desfazer uma (ver
   * CARENCIA_TENTATIVA_MS). */
  function emCarencia(state, atMs) {
    return state?.carenciaAteMs != null && Number(atMs) < state.carenciaAteMs;
  }

  /** Motivo da ultima troca, se ainda recente para explicar uma linha MUDOU. */
  function motivoRecente(state, atMs) {
    if (!state?.ultimoMotivo || state.ultimoMotivoMs == null) return null;
    return Number(atMs) - state.ultimoMotivoMs <= MOTIVO_RECENTE_MS ? state.ultimoMotivo : null;
  }

  /** Observacao de um sender a partir da linha do updateStats. `ativo` e
   * falso com a tela pausada (so no alvo direto) ou a demanda suspensa. */
  function observacao(row, { ativo }) {
    const fps = num(row?.fps);
    const mbps = num(row?.mbps);
    return {
      availableBps: num(row?.availableBps),
      realBps: mbps == null ? null : mbps * 1e6,
      perdidos: num(row?.lostDelta),
      enviados: num(row?.sentDelta),
      rttMs: num(row?.rttRtcp) ?? num(row?.rtt),
      limitacao: row?.limitation || null,
      enviando: Boolean(ativo) && fps != null && fps > 0,
    };
  }

  /** Uma amostra por sender. `motivo` sai preenchido so na amostra em que o
   * degrau mudou; `ultimoMotivo` fica para a linha [diag] (motivoRecente). */
  function next(state, obs, atMs, maxHeight) {
    const now = Number(atMs) || 0;
    const ceiling = highestAllowedHeight(maxHeight);
    if (!ceiling) return initialState(0, now);
    const prev = state || initialState(ceiling, now);
    const height = Math.min(prev.height || ceiling, ceiling);
    const dt = prev.ultimoMs == null ? 0 : Math.min(DT_MAX_MS, Math.max(0, now - prev.ultimoMs));
    const base = { ...prev, height, ultimoMs: now, motivo: null };

    // Sem amostra de BWE ou sem quadros saindo (pausa, demanda suspensa):
    // nada a medir, e nenhum relogio anda.
    const amostra = num(obs?.availableBps);
    if (!(amostra > 0) || !obs?.enviando) {
      return { ...base, aboveSinceMs: null, limiteMs: 0, paradoDesdeMs: prev.paradoDesdeMs ?? now };
    }

    // Voltou a enviar depois de um aquecimento inteiro parado: o GCC pode ter
    // de sondar de novo, e o aquecimento recomeca (estimado, nao medido).
    const desdeMs = prev.paradoDesdeMs != null && now - prev.paradoDesdeMs >= AQUECIMENTO_MS ? now : prev.desdeMs;
    const ativo = { ...base, desdeMs, paradoDesdeMs: null };

    // Aquecimento: o GCC ainda esta sondando. A BWE segue a amostra crua
    // (o teto do encoder acompanha a rampa) e nada e decidido.
    if (now - (desdeMs ?? now) < AQUECIMENTO_MS) return { ...ativo, aboveSinceMs: null, limiteMs: 0, bweBps: amostra };

    // Media por TEMPO, nao por amostra: com o app escondido o tick e de 5 s,
    // e alpha fixo por amostra faria a media andar 5x mais devagar.
    const alpha = 1 - Math.pow(1 - BWE_EWMA_ALPHA, Math.max(dt, 1000) / 1000);
    const bweBps = prev.bweBps == null ? amostra : prev.bweBps + alpha * (amostra - prev.bweBps);
    const real = num(obs.realBps);
    const uso = real == null ? null : real / amostra;
    const pressionando = uso != null && uso >= USO_PRESSAO;
    const folga = uso != null && !pressionando;
    const perdaJanela = registrarPerda(prev.perdaJanela, num(obs.perdidos), num(obs.enviados), now);
    const perda = perdaDaJanela(perdaJanela);
    const rtt = num(obs.rttMs);
    const baseRtt = rttBase(prev.rttBaldes, now);
    const rttInflado = rtt > 0 && baseRtt != null && rtt - baseRtt >= RTT_INFLADO_MS;
    const livre = !rttInflado && (perda == null || perda < PERDA_LIVRE) && obs.limitacao !== 'cpu';
    const limitando = height > 360 && pressionando && bweBps < BWE_BPS[height].down;

    let tentativa = prev.tentativa;
    let recuoMs = prev.recuoMs ?? RECUO_INICIAL_MS;
    // A tentativa so se prova com o encoder USANDO o degrau novo sem a BWE
    // limitar: pressionando a BWE, ou mandando ao menos o limiar de descida do
    // degrau (conteudo que cabe folgado nao pressiona). Tela parada nao prova.
    const usandoDegrau = pressionando || (real != null && real >= BWE_BPS[height].down);
    if (tentativa && usandoDegrau && !limitando) {
      const pressaoMs = tentativa.pressaoMs + dt;
      if (pressaoMs >= PROVA_PRESSAO_MS) {
        tentativa = null;
        recuoMs = RECUO_INICIAL_MS;
      } else {
        tentativa = { ...tentativa, pressaoMs };
      }
    }

    // Tempo limitando acumula e o tempo sem limitar desconta, em vez de zerar
    // a cada tick fora: o serrote normal do GCC nao segura a descida. Com uma
    // tentativa aberta, a BWE subindo (saindo do valor congelado) pausa a
    // conta: ela ainda esta descobrindo a banda do degrau novo.
    const subindo = tentativa != null && prev.bweBps != null && amostra > prev.bweBps * BWE_SUBINDO;
    const anterior = prev.limiteMs || 0;
    const limiteMs = !limitando ? Math.max(0, anterior - dt)
      : subindo ? anterior : anterior + Math.min(dt, LIMITE_POR_TICK_MS);
    const comum = {
      ...ativo,
      bweBps,
      rttBaldes: registrarRtt(prev.rttBaldes, rtt, now),
      perdaJanela,
      perda,
      tentativa,
      recuoMs,
      limiteMs,
    };

    if (limitando) {
      if (limiteMs < DOWN_HOLD_MS) return { ...comum, aboveSinceMs: null, folgaMs: 0 };
      const falhou = tentativa != null;
      const proximoRecuo = falhou ? Math.min(recuoMs * 2, RECUO_MAX_MS) : recuoMs;
      const motivo = `bwe ${kbps(bweBps)} kbps com o encoder usando ${pct(uso)}% dela`
        + (falhou ? `; tentativa falhou, proxima em ${proximoRecuo / 1000}s` : '');
      return {
        ...comum,
        height: lowerHeight(height, ceiling),
        aboveSinceMs: null,
        limiteMs: 0,
        folgaMs: 0,
        tentativa: null,
        recuoMs: proximoRecuo,
        carenciaAteMs: falhou ? now + CARENCIA_TENTATIVA_MS : comum.carenciaAteMs,
        motivo,
        ultimoMotivo: motivo,
        ultimoMotivoMs: now,
      };
    }

    const higher = higherHeight(height, ceiling);
    if (higher === height || !livre) {
      return { ...comum, aboveSinceMs: null, folgaMs: livre ? prev.folgaMs : 0 };
    }

    const comprovado = bweBps >= BWE_BPS[height].up;
    const aboveSinceMs = comprovado ? (prev.aboveSinceMs ?? now) : null;
    if (comprovado && now - aboveSinceMs >= UP_HOLD_MS) {
      const motivo = `bwe ${kbps(bweBps)} kbps`;
      return {
        ...comum,
        height: higher,
        aboveSinceMs: null,
        limiteMs: 0,
        folgaMs: 0,
        tentativa: null,
        recuoMs: RECUO_INICIAL_MS,
        motivo,
        ultimoMotivo: motivo,
        ultimoMotivoMs: now,
      };
    }

    // Folga acumula; tick com o encoder pressionando pausa (nao zera) a conta.
    // Com uma tentativa ainda sem prova, a proxima (empilhada) espera o dobro.
    const folgaMs = folga ? (prev.folgaMs || 0) + dt : (prev.folgaMs || 0);
    const espera = tentativa ? recuoMs * 2 : recuoMs;
    if (folgaMs >= espera) {
      const motivo = `tentativa: encoder usando ${pct(uso)}% da bwe, ${Math.round(folgaMs / 1000)}s de folga`;
      return {
        ...comum,
        height: higher,
        aboveSinceMs: null,
        limiteMs: 0,
        folgaMs: 0,
        tentativa: { desdeMs: now, pressaoMs: 0 },
        carenciaAteMs: now + CARENCIA_TENTATIVA_MS,
        motivo,
        ultimoMotivo: motivo,
        ultimoMotivoMs: now,
      };
    }
    return { ...comum, aboveSinceMs, folgaMs };
  }
```

Testes: em `src/renderer/screenres.test.js` saem os dois testes atuais de
`next`:
- "BWE desce depois de 5s e so sobe apos 15s sustentados com folga";
- "BWE nunca sobe alem do teto da escada por espectador", que passa com o
  código novo mas não testa nada, porque a assinatura mudou.

Entram os testes abaixo (no repositório, `require('./screenres')`).

**Já executados contra o trecho acima (montado sobre o `screenres.js` atual,
fora do repositório): 32/32 passando.** Os testes antigos de
`nearestAcceptableScale`, escala e `bitrateCap` também passam com o módulo novo
(11 de 12; o que falha é o antigo de `next`, que sai).

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sr = require('./screenres');
const { initialState, next, observacao, RECUO_INICIAL_MS, RECUO_MAX_MS } = sr;

/** Estado de uma PC ja aquecida, no degrau `height`, com media `bwe`. */
const aquecido = (height, bwe) => ({ ...initialState(1080, -60_000), height, bweBps: bwe });
/** Observacao de um tick; por padrao 1000 pacotes enviados e nenhum perdido. */
const obs = (bwe, real, extra = {}) => ({
  availableBps: bwe, realBps: real, perdidos: 0, enviados: 1000, rttMs: 30, limitacao: null, enviando: true, ...extra,
});

/** Roda ticks de `tick` s a partir de `t0` s. `f(t)` devolve a obs. */
function rodar(st, { t0 = 0, segundos, tick = 1, f, maxHeight = 1080 }) {
  const trocas = [];
  for (let t = t0; t < t0 + segundos; t += tick) {
    const antes = st.height;
    st = next(st, f(t), t * 1000, maxHeight);
    if (st.height !== antes) trocas.push({ t, de: antes, para: st.height, motivo: st.motivo });
  }
  return { st, trocas };
}

/** PRNG com semente, para o ruido ser o mesmo em toda execucao. */
function sorteio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

test('aquecimento: nos primeiros 10 s nada decide e a BWE segue a amostra crua', () => {
  let st = initialState(1080, 0);
  for (let t = 0; t < 9; t += 1) st = next(st, obs(300_000, 300_000), t * 1000, 1080);
  st = next(st, obs(8_000_000, 5_000_000), 9000, 1080);
  assert.equal(st.height, 1080);
  assert.equal(st.bweBps, 8_000_000, 'a media comeca do ultimo valor do aquecimento, nao dos 300 kbps');
});

test('encoder com folga nao desce, por mais baixa que a BWE esteja', () => {
  const { st } = rodar(aquecido(1080, 1_000_000), { segundos: 60, f: () => obs(1_000_000, 200_000) });
  assert.equal(st.height, 1080);
});

test('BWE limitando com o encoder pressionando desce em 5 s, com o motivo', () => {
  const { trocas } = rodar(aquecido(720, 1_500_000), { segundos: 10, f: () => obs(1_500_000, 1_400_000) });
  assert.equal(trocas[0].t, 5);
  assert.equal(trocas[0].para, 540);
  assert.match(trocas[0].motivo, /bwe 1500 kbps com o encoder usando 93% dela/);
});

test('serrote da BWE nao segura a descida (N1)', () => {
  // GCC classico: sobe devagar (2 %/s por 7 s) e cai de uma vez, perto de 2 Mbps.
  const serra = (t) => 2_000_000 * (0.87 + 0.02 * (t % 8));
  const { trocas } = rodar(aquecido(1080, 2_000_000), { segundos: 30, f: (t) => obs(serra(t), 0.95 * serra(t)) });
  assert.ok(trocas.length && trocas[0].t <= 6, `desceu aos ${trocas[0]?.t}s`);
});

test('ruido de +-15 % na BWE atrasa pouco a descida (N1)', () => {
  const rnd = sorteio(7);
  const { trocas } = rodar(aquecido(1080, 2_000_000), {
    segundos: 40, f: () => obs(2_000_000 * (0.85 + 0.3 * rnd()), 1_900_000),
  });
  assert.ok(trocas.length && trocas[0].t <= 15, `desceu aos ${trocas[0]?.t}s`);
});

test('com tentativa aberta, a BWE subindo pausa a descida (I3)', () => {
  // Saindo de um valor congelado, o GCC cresce ~5%/s com o encoder cheio.
  const st = { ...aquecido(720, 1_000_000), tentativa: { desdeMs: 0, pressaoMs: 0 } };
  const { trocas } = rodar(st, {
    segundos: 20, f: (t) => obs(1_000_000 * 1.06 ** (t + 1), 0.95 * 1_000_000 * 1.06 ** (t + 1)),
  });
  assert.equal(trocas.filter((x) => x.para < 720).length, 0);
});

test('perda na janela: 2 a 5 % trava a subida, abaixo de 2 % sobe, e nunca desce sozinha (M1)', () => {
  const travado = rodar(aquecido(540, 1_500_000), { segundos: 60, f: () => obs(1_500_000, 300_000, { perdidos: 30 }) });
  assert.equal(travado.st.height, 540);
  assert.equal(travado.st.perda, 0.03);
  const livre = rodar(aquecido(540, 1_500_000), { segundos: 20, f: () => obs(1_500_000, 300_000, { perdidos: 10 }) });
  assert.equal(livre.st.height, 720);
  const muita = rodar(aquecido(720, 1_500_000), { segundos: 30, f: () => obs(1_500_000, 300_000, { perdidos: 200 }) });
  assert.equal(muita.st.height, 720, 'perda com o encoder ocioso nao desce: o GCC ja cortou a BWE');
});

test('tela parada com poucos pacotes: uma perda isolada nao trava a subida (N3)', () => {
  // ~30 pacotes/s e um perdido a cada 3 s: 1 em 30 num tick (3,3 %), ~1,1 % na janela.
  const { st, trocas } = rodar(aquecido(540, 1_500_000), {
    segundos: 20, f: (t) => obs(1_500_000, 150_000, { enviados: 30, perdidos: t % 3 === 0 ? 1 : 0 }),
  });
  assert.equal(trocas[0]?.t, 15);
  assert.ok(st.perda < 0.02);
  // Menos de 200 pacotes na janela: a perda nao e medida, nao trava nada.
  const pouco = rodar(aquecido(540, 1_500_000), { segundos: 20, f: () => obs(1_500_000, 150_000, { enviados: 10, perdidos: 1 }) });
  assert.equal(pouco.st.perda, null);
  assert.equal(pouco.st.height, 720);
});

test('RTT inflado trava a subida, e a janela de 60 s absorve um patamar novo (I4)', () => {
  const { trocas } = rodar(aquecido(540, 1_500_000), {
    segundos: 200, f: (t) => obs(1_500_000, 300_000, { rttMs: t < 20 ? 30 : 230 }),
  });
  // Folga desde t=0; o RTT infla aos 20 s e zera a folga. A base de 30 ms
  // sai da janela entre 70 e 80 s, e a folga recomeca a contar dali.
  assert.ok(trocas[0].t < 20, 'subiu antes do RTT inflar');
  const depois = trocas.filter((x) => x.t >= 20);
  assert.ok(depois.length && depois[0].t >= 80 && depois[0].t <= 100, `voltou a subir aos ${depois[0]?.t}s`);
});

test('RTT zero ou negativo nao entra na base (I4)', () => {
  const { st } = rodar(aquecido(540, 1_500_000), {
    segundos: 20, f: (t) => obs(1_500_000, 300_000, { rttMs: t === 0 ? 0 : 40 }),
  });
  assert.equal(st.height, 720);
});

test('tentativa: 15 s de folga sobem um degrau e abrem a tentativa', () => {
  const { st, trocas } = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  assert.deepEqual(trocas.map((x) => [x.t, x.para]), [[15, 720]]);
  assert.match(trocas[0].motivo, /^tentativa: encoder usando 30% da bwe/);
  assert.ok(st.tentativa);
});

test('tick pressionando pausa a folga em vez de zerar (B1)', () => {
  // uso alternando 0,3 e 0,9, BWE acima do limiar de descida: sem zona morta.
  const { trocas } = rodar(aquecido(540, 1_500_000), {
    segundos: 40, f: (t) => obs(1_500_000, t % 2 ? 1_350_000 : 450_000),
  });
  assert.equal(trocas[0].para, 720);
  assert.ok(trocas[0].t >= 29 && trocas[0].t <= 31, `subiu aos ${trocas[0].t}s`);
});

test('tentativa que falha dobra o recuo e a proxima espera o recuo novo', () => {
  let r = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  r = rodar(r.st, { t0: 16, segundos: 10, f: () => obs(1_500_000, 1_450_000) });
  const desc = r.trocas.find((x) => x.para === 540);
  // Limitando a partir do tick dos 16 s: 5 s acumulados no tick dos 20 s.
  assert.equal(desc.t, 20);
  assert.equal(r.st.recuoMs, 2 * RECUO_INICIAL_MS);
  assert.match(desc.motivo, /tentativa falhou, proxima em 30s/);
  // Dos 21 aos 25 s o encoder segue pressionando em 540p: a folga fica
  // parada. Ela anda de 1 s em 1 s a partir do tick dos 26 s e chega aos
  // 30 s de recuo no tick dos 55 s.
  const volta = rodar(r.st, { t0: 26, segundos: 40, f: () => obs(1_500_000, 450_000) });
  assert.equal(volta.trocas[0].t, 55);
});

test('tela parada nao prova a tentativa (B2)', () => {
  let r = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  r = rodar(r.st, { t0: 16, segundos: 120, f: () => obs(1_500_000, 150_000), maxHeight: 720 });
  assert.ok(r.st.tentativa, '2 min de folga nao provam banda nenhuma');
  r = rodar(r.st, { t0: 136, segundos: 10, f: () => obs(1_500_000, 1_450_000) });
  assert.equal(r.st.recuoMs, 2 * RECUO_INICIAL_MS, 'a falha depois da folga ainda conta como falha');
});

test('tentativa se prova com 10 s de encoder pressionando sem limitar, sem subir junto (M4)', () => {
  let st = { ...aquecido(540, 1_500_000), recuoMs: 2 * RECUO_INICIAL_MS };
  let r = rodar(st, { segundos: 31, f: () => obs(1_500_000, 450_000) });
  assert.equal(r.st.height, 720);
  // Em 720p com BWE de 2,5 Mbps (acima do limiar de descida, 1,8 Mbps).
  r = rodar(r.st, { t0: 31, segundos: 11, f: () => obs(2_500_000, 2_300_000), maxHeight: 1080 });
  st = r.st;
  assert.equal(st.tentativa, null);
  assert.equal(st.recuoMs, RECUO_INICIAL_MS);
  assert.equal(st.height, 720, 'zerar o recuo nao dispara outra subida na mesma amostra');
  assert.equal(st.folgaMs, 0);
});

test('o recuo tem teto', () => {
  let st = aquecido(540, 1_500_000);
  let t = 0;
  const recuos = [];
  for (let ciclo = 0; ciclo < 5; ciclo += 1) {
    let r = rodar(st, { t0: t, segundos: st.recuoMs / 1000 + 1, f: () => obs(1_500_000, 450_000) });
    t += st.recuoMs / 1000 + 1;
    r = rodar(r.st, { t0: t, segundos: 6, f: () => obs(1_500_000, 1_450_000) });
    t += 6;
    st = r.st;
    recuos.push(st.recuoMs / 1000);
  }
  assert.deepEqual(recuos, [30, 60, 120, 120, 120]);
  assert.equal(RECUO_MAX_MS, 120_000);
});

test('tentativa empilhada sobre outra sem prova espera o dobro (N5)', () => {
  const { trocas } = rodar(aquecido(540, 1_500_000), { segundos: 60, f: () => obs(1_500_000, 150_000) });
  assert.deepEqual(trocas.map((x) => [x.t, x.para]), [[15, 720], [45, 1080]]);
});

test('sem amostra de BWE nada anda, mesmo com media antiga alta (I7)', () => {
  const { st } = rodar(aquecido(720, 20_000_000), {
    segundos: 60, f: () => ({ availableBps: null, realBps: 100_000, enviando: true }),
  });
  assert.equal(st.height, 720);
  assert.equal(st.aboveSinceMs, null);
  assert.equal(st.bweBps, 20_000_000);
});

test('sem quadros saindo (pausa, demanda suspensa) nada anda (I2)', () => {
  const { st } = rodar(aquecido(540, 1_500_000), { segundos: 120, f: () => obs(1_500_000, 0, { enviando: false }) });
  assert.equal(st.height, 540);
  assert.equal(st.folgaMs, 0);
});

test('voltar a enviar depois de 10 s parado reabre o aquecimento (N12)', () => {
  let r = rodar(aquecido(720, 1_500_000), { segundos: 30, f: () => obs(1_500_000, 0, { enviando: false }) });
  // Na volta, a BWE limitando (encoder cheio): no aquecimento nada decide.
  r = rodar(r.st, { t0: 30, segundos: 9, f: () => obs(1_500_000, 1_450_000) });
  assert.equal(r.trocas.length, 0);
  r = rodar(r.st, { t0: 39, segundos: 10, f: () => obs(1_500_000, 1_450_000) });
  assert.equal(r.trocas[0]?.para, 540, 'depois do aquecimento a regra volta a valer');
  // Parada curta (menos de 10 s) nao reabre.
  let c = rodar(aquecido(720, 1_500_000), { segundos: 3, f: () => obs(1_500_000, 0, { enviando: false }) });
  c = rodar(c.st, { t0: 3, segundos: 8, f: () => obs(1_500_000, 1_450_000) });
  // O relogio andou nos ticks parados: o tick dos 3 s ja soma 1 s limitando,
  // e os 5 s fecham no tick dos 7 s.
  assert.equal(c.trocas[0]?.t, 7);
});

test('um tick atrasado vale no maximo 10 s (N2)', () => {
  let st = { ...aquecido(540, 1_500_000), ultimoMs: 0 };
  st = next(st, obs(1_500_000, 150_000), 90_000, 1080);
  assert.equal(st.height, 540, '90 s sem linha nao viram 90 s de folga');
  assert.equal(st.folgaMs, 10_000);
});

test('com tick de 5 s, uma amostra limitando sozinha nao derruba o degrau', () => {
  const st = { ...aquecido(1080, 2_000_000), ultimoMs: -5000 };
  const limitando = obs(2_000_000, 1_900_000);
  const folga = obs(2_000_000, 300_000);
  const uma = rodar(st, { segundos: 30, tick: 5, f: (t) => (t === 0 ? limitando : folga) });
  assert.equal(uma.trocas.length, 0);
  const duas = rodar(st, { segundos: 30, tick: 5, f: (t) => (t <= 5 ? limitando : folga) });
  assert.equal(duas.trocas[0]?.t, 5);
});

test('tentativa se prova com o encoder mandando o limiar de descida do degrau, sem pressionar', () => {
  // Conteudo que cabe folgado: 2 Mbps em 720p (limiar 1,8 Mbps) com BWE de 8 Mbps.
  let r = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  r = rodar(r.st, { t0: 16, segundos: 11, f: () => obs(8_000_000, 2_000_000), maxHeight: 720 });
  assert.equal(r.st.tentativa, null);
  assert.equal(r.st.recuoMs, RECUO_INICIAL_MS);
});

test('encoder limitado por CPU nao tenta subir (M7)', () => {
  const { st } = rodar(aquecido(540, 1_500_000), { segundos: 60, f: () => obs(1_500_000, 450_000, { limitacao: 'cpu' }) });
  assert.equal(st.height, 540);
});

test('tick de 5 s desce no mesmo tempo de relogio que o de 1 s (I1)', () => {
  for (const tick of [1, 5]) {
    // ultimoMs: no app sempre houve um tick antes, `tick` segundos atras.
    const st = { ...aquecido(1080, 7_000_000), ultimoMs: -tick * 1000 };
    const { trocas } = rodar(st, { segundos: 30, tick, f: () => obs(1_275_000, 1_500_000) });
    assert.ok(trocas[0].t <= 7, `tick ${tick}s: desceu aos ${trocas[0].t}s`);
  }
});

test('subida comprovada pela BWE zera tentativa e recuo', () => {
  let st = { ...aquecido(540, 1_500_000), tentativa: { desdeMs: 0, pressaoMs: 0 }, recuoMs: 60_000 };
  const r = rodar(st, { segundos: 20, f: () => obs(4_000_000, 3_900_000) });
  st = r.st;
  assert.equal(r.trocas[0].para, 720);
  assert.match(r.trocas[0].motivo, /^bwe /);
  assert.equal(st.tentativa, null);
  assert.equal(st.recuoMs, RECUO_INICIAL_MS);
});

test('360p e o piso: nao desce mais', () => {
  const { st } = rodar(aquecido(360, 300_000), { segundos: 30, f: () => obs(300_000, 300_000) });
  assert.equal(st.height, 360);
});

test('nunca sobe alem do teto da escada por espectador', () => {
  const { st } = rodar(aquecido(720, 20_000_000), { segundos: 60, f: () => obs(20_000_000, 300_000), maxHeight: 720 });
  assert.equal(st.height, 720);
});

test('motivoRecente explica a linha [diag] por 30 s e depois some (M2, N7)', () => {
  const { st } = rodar(aquecido(540, 1_500_000), { segundos: 18, f: () => obs(1_500_000, 450_000), maxHeight: 720 });
  assert.equal(st.motivo, null, 'motivo so na amostra da troca');
  assert.match(sr.motivoRecente(st, 45_000), /^tentativa/);
  assert.equal(sr.motivoRecente(st, 45_001), null);
  assert.equal(sr.motivoRecente(aquecido(540, 1_500_000), 0), null);
});

test('carencia do peerquality: 10 s depois da tentativa e 10 s depois da descida que a desfaz (I3, N8)', () => {
  let r = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  assert.equal(sr.emCarencia(r.st, 24_999), true);
  assert.equal(sr.emCarencia(r.st, 25_000), false);
  r = rodar(r.st, { t0: 16, segundos: 5, f: () => obs(1_500_000, 1_450_000) });
  assert.equal(r.trocas[0].t, 20);
  assert.equal(sr.emCarencia(r.st, 29_999), true, 'a descida que desfaz a tentativa renova a carencia');
  assert.equal(sr.emCarencia(r.st, 30_000), false);
  assert.equal(sr.emCarencia(aquecido(540, 1_500_000), 0), false);
});

test('regressao: a serie real do log de 18/10 (540p, 04:06:56-04:12:46) sai de 540p', () => {
  // Valores literais das linhas [diag] de golive log meu.log (bwe = media
  // impressa, real = realKbps). Cada linha e um instantaneo de ~1 s tratado
  // como constante ate a seguinte (15-20 s). Depois que a escada sai de
  // 540p, os valores do log ja nao valem (o encoder estaria noutro degrau):
  // o teste so cobre a saida de 540p. NAO e fonte de constantes.
  const serie = [[0, 1606, 854], [15, 1606, 1297], [30, 1849, 1439], [50, 1604, 921], [70, 1604, 825],
    [85, 1394, 813], [105, 1394, 996], [120, 1394, 1066], [140, 1394, 686], [155, 1394, 1280], [175, 1548, 853],
    [190, 1548, 1090], [205, 1705, 1454], [225, 1940, 2032], [245, 2054, 911], [265, 1537, 822], [280, 1322, 828],
    [295, 1625, 1851], [315, 3253, 1786], [330, 3407, 3918], [350, 3402, 2256]];
  const valor = (t) => serie.filter(([s]) => s <= t).at(-1);
  const { trocas } = rodar(aquecido(540, 1_606_000), {
    segundos: 360, f: (t) => { const [, b, r] = valor(t); return obs(b * 1000, r * 1000); }, maxHeight: 720,
  });
  assert.ok(trocas.length && trocas[0].para === 720 && trocas[0].t <= 20, JSON.stringify(trocas[0]));
});

test('observacao: unidades e quem conta como enviando (M6)', () => {
  const row = { availableBps: 2_000_000, mbps: 1.5, lostDelta: 3, sentDelta: 400, rttRtcp: 42, rtt: 30, limitation: 'bandwidth', fps: 30 };
  assert.deepEqual(observacao(row, { ativo: true }), {
    availableBps: 2_000_000, realBps: 1_500_000, perdidos: 3, enviados: 400, rttMs: 42, limitacao: 'bandwidth', enviando: true,
  });
  assert.equal(observacao({ ...row, rttRtcp: null }, { ativo: true }).rttMs, 30, 'sem RTT do RTCP usa o do par');
  assert.equal(observacao({ ...row, fps: 0 }, { ativo: true }).enviando, false);
  assert.equal(observacao({ ...row, fps: null }, { ativo: true }).enviando, false);
  assert.equal(observacao(row, { ativo: false }).enviando, false);
  assert.equal(observacao({ ...row, mbps: null }, { ativo: true }).realBps, null);
});
```

### Tarefa 1b — `txstats`: pacotes enviados, RTT do RTCP e perdidos no intervalo

Arquivo: `src/renderer/txstats.js`.

Em `readSenderReport`, logo depois de `packetsLostNet` / `fractionLost`:

```js
      packetsSent: aggregate(rtp, 'packetsSent'),
      // RTT do RTCP: mede a fila da midia, ao contrario do par ICE (STUN).
      rttRtcp: numeric(remote?.roundTripTime) == null ? null : remote.roundTripTime * 1000,
```

Em `deriveRates`:
- o objeto vazio vira
  `{ mbps: null, msPerFrame: null, sentDelta: null, lostDelta: null }`;
- no objeto devolvido, depois de `msPerFrame`, acrescentar:

```js
      // Pacotes enviados e perdidos (RTCP do outro lado) NO INTERVALO; a
      // escada soma numa janela. O fractionLost cru e so o ultimo relatorio.
      sentDelta: delta(cur, prev, 'packetsSent'),
      lostDelta: delta(cur, prev, 'packetsLostNet'),
```

O retorno sem PC em `createTracker().rates` ganha `sentDelta: null,
lostDelta: null`. A fração é calculada na escada, na janela de 10 s
(`perdaDaJanela`). Nenhum campo novo colide com campos existentes:
`grep -rn "lostDelta\|sentDelta\|rttRtcp\|packetsSent"` em `src/` não acha nada.

Testes:
- os cinco `deepEqual` de `deriveRates` em `txstats.test.js:45-51` ganham
  `sentDelta: null, lostDelta: null`;
- entram os dois testes abaixo.

**Executados contra essas mudanças (aplicadas a uma cópia de `txstats.js`): os
6 testes atuais, com o ajuste dos `deepEqual`, e os 2 novos passam.**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tx = require('./txstats');

function relatorio({ packetsSent, lost, rtt }) {
  const m = new Map();
  m.set('o', { id: 'o', type: 'outbound-rtp', kind: 'video', bytesSent: 1000, framesEncoded: 10, packetsSent, remoteId: 'r' });
  m.set('r', { id: 'r', type: 'remote-inbound-rtp', kind: 'video', packetsLost: lost, fractionLost: 0.5, roundTripTime: rtt });
  return m;
}

test('readSenderReport le pacotes enviados e o RTT do RTCP em ms', () => {
  const s = tx.readSenderReport(relatorio({ packetsSent: 500, lost: 3, rtt: 0.042 }));
  assert.equal(s.packetsSent, 500);
  assert.equal(s.rttRtcp, 42);
  assert.equal(tx.readSenderReport(relatorio({ packetsSent: 500, lost: 3, rtt: undefined })).rttRtcp, null);
});

test('deriveRates: pacotes enviados e perdidos no intervalo', () => {
  const prev = { bytesSent: 0, framesEncoded: 0, totalEncodeTime: 0, packetsSent: 1000, packetsLostNet: 10, rtpIds: 'a' };
  const cur = { bytesSent: 0, framesEncoded: 0, totalEncodeTime: 0, packetsSent: 1200, packetsLostNet: 14, rtpIds: 'a' };
  const r = tx.deriveRates(cur, prev, 1000);
  assert.equal(r.sentDelta, 200);
  assert.equal(r.lostDelta, 4);
  // Relatorio RTCP repetido entre ticks: perdidos nao andam.
  assert.equal(tx.deriveRates({ ...cur, packetsLostNet: 10 }, prev, 1000).lostDelta, 0);
  // Perdidos andando para tras (duplicata reportada) nao vira numero.
  assert.equal(tx.deriveRates({ ...cur, packetsLostNet: 8 }, prev, 1000).lostDelta, null);
  // Sem o campo, sem numero.
  assert.equal(tx.deriveRates({ ...cur, packetsSent: undefined }, prev, 1000).sentDelta, null);
});
```

### Tarefa 2 — `app.js` monta a observação e usa a carência

`updateScreenResolution` (`app.js:702`):

```js
      const saved = screenResolution.get(key);
      const previous = saved && (!saved.pc || saved.pc === row.pc) ? saved : screenres.initialState(maxHeight, now);
      // Tela pausada so silencia o alvo DIRETO (o repasse segue), como no
      // bloco do peerquality; demanda suspensa nao codifica para este peer.
      const isRelayChild = Boolean(parseKind(row.kind).sourceId);
      const ativo = !(sharePaused && !isRelayChild) && !currentSession.mesh.isPeerSuspended(row.peerId, row.kind);
      const nextState = screenres.next(previous, screenres.observacao(row, { ativo }), now, maxHeight);
      if (nextState.motivo) {
        console.log(`[qualidade] tela->${row.name}: ${previous.height}p -> ${nextState.height}p (${nextState.motivo})`);
      }
      screenResolution.set(key, { ...nextState, pc: row.pc });
```

`initialState(maxHeight, now)` na PC nova é o que liga o aquecimento.
`screenEncodingForPeer` (`app.js:663`) só lê `height` e `bweBps` do estado e
fica como está. No primeiro tick, com `bweBps` ainda `null`, o teto é o preset
(seção 4, S6).

`isPeerSuspended` vale para o kind de repasse:
- `mesh.js:1010` grava `peer.suspended[kind]` com o kind recebido;
- `mesh.js:1134` lê pelo kind;
- `app.js:6004` já chama com o kind composto.

Bloco do `peerquality` (`app.js:~6890`): `senderBandwidthLimited` passa a ser

```js
          senderBandwidthLimited: limByPeer.get(key) === 'bandwidth'
            && !screenres.emCarencia(screenResolution.get(key), now),
```

`key` é a mesma `${peerId}:${kind}` nas duas escadas.

**Teste (N6)** em `src/renderer/qualitypolicy-app.test.js`, no mesmo esquema
que o arquivo já usa (`functionSource` + `vm`): extrair
`updateScreenResolution` (e `screenEncodingForPeer`, `screenSourceSize`,
`qualityFor`, `qualityForPeer`, que ela chama) com `screenres` real, `sharePaused`
e `mesh.isPeerSuspended` simulados, e conferir:

1. alvo direto com `sharePaused = true`: o estado fica parado (folga 0 depois
   de 20 ticks ociosos);
2. repasse (`screen@N`) com `sharePaused = true`: a folga anda e sobe aos 15 s;
3. demanda suspensa: parado;
4. a linha `[qualidade] tela->…` sai só no tick da troca;
5. PC nova: começa em aquecimento (`desdeMs` = `now`).

### Tarefa 3 — perda, RTT, uso e motivo na linha `[diag]`

`logEncodeDiag` (`app.js:6570`) põe no `ctx`, a partir de `row` e de
`screenResolution.get(key)`:
- `perda` (`state.perda`, da janela);
- `rtt` (`row.rttRtcp ?? row.rtt`);
- `uso` (`row.mbps × 1e6 / row.availableBps`);
- `motivo` (`screenres.motivoRecente(state, nowMs)`, só nas linhas `MUDOU`).

`encodediag.line` **anexa no fim da linha**, depois de `degraus=`:
- `perda=<n>%`, `rtt=<n>ms` e `uso=<n>%`, com `?` quando o valor é `null` (como
  `bwe=?` e `realKbps=?` hoje), nunca `NaN%`;
- e, quando houver, ` motivo="<texto>"`.

Isso não quebra os testes atuais, que só conferem trechos
(`encodediag.test.js:64` casa `alvoKbps=… bwe=… realKbps=…` vizinhos). Entram
dois testes novos: um com os quatro campos e outro com os três numéricos
`null`. Os números não entram na assinatura, como fps e kbps hoje.

O `motivoRecente` existe porque `updateScreenResolution` (`app.js:6797`) roda
antes do `logEncodeDiag` (`app.js:6932`), e a linha `MUDOU` só aparece no tick
em que o `setParameters` já resolveu e a assinatura mudou. Depois de 30 s, um
`MUDOU` por outro motivo (troca de encoder, degrau `g/p`) não herda um motivo
velho (N7).

### Tarefa 4 — medir antes de confiar nas constantes

1. **Spike B de novo** (`test.html` de 25/10) com o `screenres` novo, link
   livre: desktop (B4/B5) chega a 1080p e fica, e jogo (B1/B2) se comporta
   como hoje.
2. **Faixa de BWE baixa:** repetir B2/B3 com a BWE na faixa do log
   (1–2,5 Mbps). Exige limitar a banda do loopback. Opções:
   - (a) clumsy/WinDivert, que pede download e aprovação do Nicolas, e antes
     é preciso confirmar que ele limita o loopback do Chromium;
   - (b) noite de teste com 2 PCs no Radmin.

   A mesma rodada mede o teto 1,2×BWE nessa faixa (conclusão 1), a descida por
   congestão real e a amplitude real do serrote da BWE: logar a amostra crua de
   BWE por segundo durante um congestionamento.
3. Registrar no STATUS a faixa varrida em cada medição, e o que ficou de fora.

### Tarefa 5 — fechamento

- `npm test`, `npm run lint`, e a bancada `tools/bancada-sala/tela-parada.js`.
  Ela só confere que o repetidor não quebrou; **não passa pela escada**. Quem
  cobre a escada são os testes das Tarefas 1, 2 e 3.
- STATUS.md: a escada nova e as constantes ainda não medidas no Radmin.
- Noite de teste:
  - toda mudança de degrau aparece no log com `motivo`;
  - nenhuma descida acontece sem `uso ≥ 0,85`;
  - o número de tentativas falhas por hora fica registrado.

## 4. Modelo usado nas simulações (não é medição)

O script fica fora do repositório e roda o trecho da Tarefa 1 contra um modelo
simples:
- o GCC cresce 5 %/s quando `real ≥ 0,7 × BWE`;
- fica parado com folga;
- cai para 85 % da capacidade quando o envio passa dela.

O 0,7 do modelo é de propósito diferente do 0,85 do código, para o modelo não
repetir a regra que testa (N10). A demanda do conteúdo por degrau é inventada:
360p 1 Mbps, 540p 1,8, 720p 3, 1080p 6 Mbps; tela parada 0,15–0,25 Mbps.

Os números "v1" e "código atual" desta tabela vêm da simulação da primeira
revisão, que não deixou arquivo. Os da v3 são deste script.

| # | Caso | Resultado com o código da Tarefa 1 (v3) |
|---|---|---|
| S1 | **Série real** do log, 540p, 04:06:56–04:12:46 | sai de 540p aos 15 s (tentativa). Depois disso os valores do log já não valem, porque o encoder estaria noutro degrau |
| S1b | Mesmas faixas, aleatório por segundo, 200 × 350 s (B1) | 200/200 saem de 540p, mediana 16 s (v1: 4/200) |
| S2 | Rede 1,5 Mbps, 60 s parado + 20 s ativo, 1 h (B2) | 50 trocas (v1: 90), 24 falhas, recuo termina em 120 s, ≥ 160 s entre falhas depois da 4ª |
| S3 | 1080p a 6 Mbps, rede cai para 1,5 Mbps (I1) | primeira descida 7 s depois com tick de 1 s e 5 s com tick de 5 s (código atual 6 e 10 s; v1 15 e 55 s) |
| S4 | Ruído i.i.d. na BWE, 1080p, encoder cheio, 100 sementes (N1) | ±3/8/10 %: 100/100 descem em 4 s; ±15 %: mediana 4 s, máx. 14 s; ±15 % com tick de 5 s: mediana 5 s, máx. 30 s |
| S4b | Serrote de 8 s, ±15 % (N1) | desce aos 5 s (v2: não descia em 300 s, pela segunda revisão) |
| S5 | Tela parada, 540p → 720p, perda i.i.d., 100 sementes, 10 min (N3) | 30 pacotes/s com 0,5 % e 1 %, 100 pacotes/s com 1 %, 500 pacotes/s: mediana 15 s, 0/100 presos; 30 pacotes/s com 3 % de perda real: 73/100 não sobem (o esperado) |
| S6 | Aquecimento, rampa 0,3 → 6 Mbps | termina em 1080p; teto (kbps) nos primeiros ticks: 12000, 800, 800, 800, 1098, 1591, 2308, 3346, 4852, 7035, 7200 |
| S7 | Tentativa com BWE congelada (1,4 Mbps) num link livre, depois movimento (I3) | 540 → 720 aos 15 s, 720 → 1080 aos 52 s, nenhuma descida errada, tentativa provada |
| S8 | Tela parada num link livre, de 540p | 540 → 720 aos 15 s (comprovada: BWE de 5,2 Mbps ≥ limiar), 720 → 1080 aos 30 s (tentativa) |
| S9 | RTT 30 → 230 ms permanente aos 5 s (I4) | sobe aos 74 s em vez de 15 s: a base nova entra em ~60 s |

## 5. O que mudou desde as revisões

### Primeira revisão (aplicada na v2)

| Achado | Mudança |
|---|---|
| B1 zona morta entre uso 0,5 e 0,7 | um limiar só (0,85); folga acumula e tick pressionando pausa em vez de zerar |
| B2 tela parada "provava" a tentativa | prova exige o encoder usando o degrau sem limitar; tempo sozinho não zera o recuo |
| I1 uso contra o teto aplicado; descida lenta escondido | uso contra a amostra de BWE da linha; média por tempo |
| I2 pausa/suspenso contava como ocioso | `observacao(row, { ativo })` + `fps > 0`; sem enviar, nada anda |
| I3 BWE subindo confundida com limitando; penalidade dupla | (v3) "subindo" só pausa com tentativa aberta; carência no `peerquality` |
| I4 RTT de base vitalício | mínimo dos últimos 60 s em baldes; ignora ≤ 0; prefere RTT do RTCP |
| I5 `fractionLost` cru | (v3) perdidos e enviados no intervalo, somados numa janela de 10 s |
| I6 "refutada" sem faixa | conclusão 1 reescrita com a faixa (plano e STATUS); Tarefa 4 varre a faixa baixa |
| I7 sem amostra seguia contando | sem amostra, nada anda (guarda a média) |
| M1 perda/RTT desciam com encoder ocioso | perda e RTT só travam a subida |
| M2 `motivo` não chegava ao `MUDOU` | (v3) `motivoRecente` |
| M3 contrato do `[diag]` exagerado | campos anexados no fim; testes novos |
| M4 zerar o recuo subia junto | a folga zera em toda troca; prova não mexe na folga (teste) |
| M5 aquecimento e teto | média segue a amostra crua no aquecimento; 10 s justificado (estimado) |
| M6 mapeamento sem teste | `observacao` pura, com teste |
| M7 tentativa ignorava CPU | `limitacao === 'cpu'` trava a subida |
| M8 conta repetida no `motivo` | `proximoRecuo` calculado uma vez |

### Segunda revisão (aplicada na v3)

| Achado | Mudança |
|---|---|
| N1 serrote/ruído seguravam a descida | acumulador que desconta em vez de zerar; "subindo" só com tentativa aberta; testes de serrote e ruído; S4/S4b |
| — (achado na v3) uma amostra só derrubava com tick de 5 s | `LIMITE_POR_TICK_MS` = 2,5 s; teste |
| N2 `dt` sem teto | `DT_MAX_MS` = 10 s; teste |
| N3 perda por tick travava a tela parada | janela de 10 s, mínimo de 200 pacotes; teste; S5 |
| N4 série "literal" com valores errados | série real das linhas `[diag]` (conferida no log); teste e S1 só afirmam a saída de 540p, com a ressalva escrita |
| N5 tentativas empilhadas; custo da falha | empilhada espera o dobro; frase do custo corrigida; teste |
| — (achado na v3) prova exigia pressionar | prova aceita o encoder mandando o limiar de descida do degrau; teste |
| N6 Tarefa 2 sem teste | teste no harness `vm` de `qualitypolicy-app.test.js` (Tarefa 2) |
| N7 `ultimoMotivo` eterno; `NaN%` | `motivoRecente` (30 s); `?` para nulos na Tarefa 3 |
| N8 carência acabava na descida | a descida que desfaz a tentativa renova a carência (`emCarencia`); teste |
| N9 instrução de edição ambígua; linha errada | duas remoções separadas; `app.js:663` |
| N10 simulação circular | modelo cresce com 0,7, não 0,85 |
| N11 fila permanente escapa da guarda de RTT | escrito como limite conhecido |
| N12 retomar não reaquecia | parado ≥ 10 s reabre o aquecimento (estimado); teste |
| Números sem procedência | seção 4 diz de onde vem cada número |

## 6. Para quem revisar (e para a implementação)

Pontos ainda abertos, que só a Tarefa 4 ou a bancada respondem:

- a amplitude real do serrote da BWE no Radmin (S4 usa até ±15 %);
- se a carência de 10 s basta para o `peerquality`, já que o `receiveHealth`
  continua valendo;
- se o GCC precisa mesmo re-sondar depois de uma demanda suspensa (N12 é
  estimado);
- o teto 1,2×BWE na faixa de 1–2,5 Mbps.
