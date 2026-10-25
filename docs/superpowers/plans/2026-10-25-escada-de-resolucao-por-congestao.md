# Escada de resolução decidida por congestão, não pela BWE parada

**Estado:** plano para revisão. Nenhuma linha de código escrita.
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

Conclusões:

1. **O teto `bitrateCap` (1,2×BWE) não trava a subida.** A hipótese foi
   refutada e o teto fica como está.
2. **Com pouco movimento a BWE não se mexe.** O encoder manda bem menos que a
   estimativa, então o GCC não tem o que medir e a estimativa fica parada no
   valor que tinha. Quando uma oscilação do Radmin a derruba, ela não volta
   enquanto a tela tiver pouco movimento, e a escada desce e fica presa.
3. **Sair e entrar resolve** porque a conexão nova refaz a sondagem inicial do
   GCC e `screenResolution` volta a `initialState` (a chave inclui a PC,
   `app.js:668`).

### O que NÃO foi confirmado no motor real

- A queda logo no início da conexão, com a primeira amostra baixa
  (~0,3 Mbps) entrando na média. No loopback o Chrome já começa em ~5 Mbps.
  Evidência só do log (02:46:02 `banda estimada 0,3 Mbps`, queda de 1080p para
  720p às 02:46:27) e da leitura do código.
- Por que a BWE cai no Radmin (perda? atraso?). O log de hoje não registra
  perda nem RTT por sender. A Tarefa 3 resolve isso para a próxima vez.

## 2. Desenho

Princípio: **a BWE só informa a capacidade quando o encoder está usando a
banda.** Com o encoder ocioso, a BWE parada não diz nada, e quem decide são os
sinais de congestão que o `txstats` já lê e a escada ignora: `fractionLost` (do
`remote-inbound-rtp`) e `rtt` (do par ICE).

Em cada amostra (1 s), por sender:

- `uso = realBps / tetoBps`: o que saiu de fato sobre o `maxBitrate` aplicado.
- **Congestão** (qualquer uma das três):
  - `perda >= 5 %`;
  - `rtt - rttBase >= 150 ms`, com `rttBase` = menor RTT visto nesta PC;
  - `uso >= 0,7` **e** BWE média abaixo do limiar de descida do degrau. Ou
    seja: o encoder está enchendo o teto e a estimativa limita de verdade.
- **Descer:** congestão contínua por 5 s (`DOWN_HOLD_MS`, igual a hoje).
- **Subir**, sem congestão (perda < 2 % e RTT sem inflar), por um de dois
  caminhos:
  - **comprovado:** BWE média >= limiar de subida por 15 s (igual a hoje);
  - **tentativa:** `uso < 0,5` (a BWE não mede nada) por `recuoMs` (começa em
    15 s). Se uma descida acontecer até 30 s depois da tentativa, `recuoMs`
    dobra (15 → 30 → 60 → 120 s, teto). Se a tentativa durar 30 s sem descer,
    `recuoMs` volta a 15 s.
- **Aquecimento:** nos primeiros 5 s de uma PC, nenhuma amostra conta nem
  entra na média.

Por que ociosidade não desce: se o encoder manda menos que a estimativa
reduzida, os bits por pixel não caíram, e baixar a resolução só piora a imagem.
A resolução importa quando o encoder enche o teto, e esse caso está coberto.

Fica como está: `bitrateCap`, `SCREEN_HEIGHTS`, os limiares `BWE_BPS`,
`nearestAcceptableScale`, a escada global/por peer (`autoquality.js`,
`peerquality.js`) e a P1.

Risco aceito: com a tela ociosa, a tentativa pode subir para um degrau que a
rede não aguenta. O encoder enche o teto, o GCC acusa e a descida vem em ~5 s.
O recuo exponencial limita o vaivém a uma oscilação a cada 2 min, no pior caso.

**As constantes (0,7 / 0,5 / 5 % / 2 % / 150 ms / 30 s) são pontos de partida,
não medidas.** Não ajustar ao log de uma noite só: a Tarefa 3 existe para medir
no Radmin antes de mexer nelas.

## 3. Tarefas

### Tarefa 1 — `screenres.next` recebe a observação inteira (TDD)

Arquivo: `src/renderer/screenres.js`. Assinatura nova:
`next(state, obs, atMs, maxHeight)`, com
`obs = { availableBps, realBps, tetoBps, fractionLost, rttMs }`. Hoje o único
chamador é `app.js:712`.

```js
  const AQUECIMENTO_MS = 5000;
  const USO_CHEIO = 0.7;
  const USO_OCIOSO = 0.5;
  const PERDA_CONGESTAO = 0.05;
  const PERDA_LIVRE = 0.02;
  const RTT_INFLADO_MS = 150;
  const PROVA_MS = 30000;
  const RECUO_INICIAL_MS = UP_HOLD_MS;
  const RECUO_MAX_MS = 120000;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  function initialState(maxHeight, atMs = 0) {
    return {
      height: highestAllowedHeight(maxHeight),
      bweBps: null,
      belowSinceMs: null,
      aboveSinceMs: null,
      desdeMs: Number(atMs) || 0,
      rttBaseMs: null,
      tentativaMs: null,
      recuoMs: RECUO_INICIAL_MS,
      motivo: null,
    };
  }

  /** Uma amostra por sender. `motivo` sai preenchido so na amostra em que o
   * degrau mudou, para o app logar o porque. */
  function next(state, obs, atMs, maxHeight) {
    const now = Number(atMs) || 0;
    const ceiling = highestAllowedHeight(maxHeight);
    if (!ceiling) return initialState(0, now);
    const prev = state || initialState(ceiling, now);
    const height = Math.min(prev.height || ceiling, ceiling);
    const base = { ...prev, height, motivo: null };
    const parado = { ...base, belowSinceMs: null, aboveSinceMs: null };

    // Aquecimento: o GCC ainda esta sondando, a amostra nao mede a rede.
    if (now - (prev.desdeMs ?? now) < AQUECIMENTO_MS) return parado;

    const amostra = num(obs?.availableBps);
    const bweBps = !(amostra > 0) ? prev.bweBps
      : prev.bweBps == null ? amostra
        : prev.bweBps + BWE_EWMA_ALPHA * (amostra - prev.bweBps);
    const rtt = num(obs?.rttMs);
    const rttBaseMs = rtt == null ? prev.rttBaseMs
      : prev.rttBaseMs == null ? rtt : Math.min(prev.rttBaseMs, rtt);
    const perda = num(obs?.fractionLost);
    const real = num(obs?.realBps);
    const teto = num(obs?.tetoBps);
    const uso = real != null && teto > 0 ? real / teto : null;

    const rttInflado = rtt != null && rttBaseMs != null && rtt - rttBaseMs >= RTT_INFLADO_MS;
    const perdendo = perda != null && perda >= PERDA_CONGESTAO;
    const bweLimita = height > 360 && bweBps != null && uso != null && uso >= USO_CHEIO
      && bweBps < BWE_BPS[height].down;
    const comum = { ...base, bweBps, rttBaseMs };

    // Tentativa que sobreviveu PROVA_MS sem descer: o degrau se provou.
    if (comum.tentativaMs != null && now - comum.tentativaMs >= PROVA_MS) {
      comum.tentativaMs = null;
      comum.recuoMs = RECUO_INICIAL_MS;
    }

    if (height > 360 && (perdendo || rttInflado || bweLimita)) {
      const belowSinceMs = prev.belowSinceMs ?? now;
      if (now - belowSinceMs < DOWN_HOLD_MS) return { ...comum, belowSinceMs, aboveSinceMs: null };
      const falhou = comum.tentativaMs != null;
      const motivo = perdendo ? `perda ${Math.round(perda * 100)}%`
        : rttInflado ? `rtt +${Math.round(rtt - rttBaseMs)} ms`
          : `bwe ${Math.round(bweBps / 1000)} kbps com o encoder usando ${Math.round(uso * 100)}% do teto`;
      return {
        ...comum,
        height: lowerHeight(height, ceiling),
        belowSinceMs: null,
        aboveSinceMs: null,
        tentativaMs: null,
        recuoMs: falhou ? Math.min(comum.recuoMs * 2, RECUO_MAX_MS) : comum.recuoMs,
        motivo: falhou ? `${motivo}; tentativa falhou, proxima em ${Math.min(comum.recuoMs * 2, RECUO_MAX_MS) / 1000}s` : motivo,
      };
    }

    const higher = higherHeight(height, ceiling);
    const livre = !rttInflado && (perda == null || perda < PERDA_LIVRE);
    const comprovado = bweBps != null && bweBps >= BWE_BPS[height].up;
    const ocioso = uso != null && uso < USO_OCIOSO;
    if (higher !== height && livre && (comprovado || ocioso)) {
      const aboveSinceMs = prev.aboveSinceMs ?? now;
      const espera = comprovado ? UP_HOLD_MS : comum.recuoMs;
      if (now - aboveSinceMs < espera) return { ...comum, belowSinceMs: null, aboveSinceMs };
      return {
        ...comum,
        height: higher,
        belowSinceMs: null,
        aboveSinceMs: null,
        tentativaMs: comprovado ? null : now,
        motivo: comprovado ? `bwe ${Math.round(bweBps / 1000)} kbps` : `tentativa: encoder usando ${Math.round(uso * 100)}% do teto`,
      };
    }
    return { ...comum, belowSinceMs: null, aboveSinceMs: null };
  }
```

Exportar as constantes novas junto com as atuais.

Testes em `src/renderer/screenres.test.js`. Os dois testes atuais de `next`
passam a usar `obs` e uma PC já aquecida (`initialState(1080, -10_000)`). Novos:

1. aquecimento: amostras nos primeiros 5 s não mudam o degrau nem semeiam a
   média (BWE de 300 kbps aos 2 s, depois 8 Mbps: segue em 1080p e a média
   começa em 8 Mbps);
2. ocioso não desce: BWE 1 Mbps, `uso` 0,2, 60 s → segue em 1080p;
3. BWE limitando desce: BWE média 1,5 Mbps, `uso` 0,9 em 720p, 5 s → 540p, e
   o `motivo` cita bwe e uso;
4. perda desce: 8 % por 5 s em 1080p → 720p com `uso` qualquer;
5. RTT inflado desce: base 30 ms, depois 200 ms por 5 s → desce;
6. tentativa sobe: 540p, `uso` 0,3, sem perda, 15 s → 720p e `tentativaMs`
   preenchido;
7. tentativa que falha dobra o recuo: sobe, congestiona aos 10 s, desce aos
   15 s → `recuoMs` 30 s; a próxima subida só depois de 30 s ociosos;
8. tentativa que se prova zera o recuo: 30 s sem descer → `recuoMs` 15 s;
9. recuo tem teto de 120 s;
10. sem `obs` (stats faltando) nada muda, como hoje;
11. perda entre 2 % e 5 % não desce e não sobe;
12. reprodução do log de 18/10, 04:06:56–04:12:46 (540p, BWE 1,4–2,0 Mbps,
    real 0,7–1,4 Mbps): com a regra nova chega a 720p. **Só como teste de
    regressão da situação relatada, não como fonte de constantes.**

### Tarefa 2 — `app.js` monta a observação

`updateScreenResolution` (`app.js:702`):

- ler `applied = appliedScreenEncoding.get(key)` **antes** de chamar `next`
  (hoje é lido depois);
- `obs = { availableBps: row.availableBps, realBps: row.mbps != null ? row.mbps * 1e6 : null, tetoBps: applied?.maxBitrate ?? null, fractionLost: row.fractionLost, rttMs: row.rtt }`;
- `initialState(maxHeight, now)` quando a PC é nova (é isso que liga o
  aquecimento);
- com `nextState.motivo`, logar
  `[qualidade] tela->${row.name}: ${antes}p -> ${depois}p (${motivo})`.

`screenEncodingForPeer` (`app.js:669`) só lê `height` e `bweBps` do estado e
não precisa do relógio.

Verificar na revisão: `row.mbps` vem de `statsPrev.rates` sobre o intervalo do
tick; com o app escondido o tick é de 5 s (`STATS_POLL_HIDDEN_MS`). Os prazos
são em ms de relógio, então ficam certos, mas a decisão sai com até 5 s de
atraso.

### Tarefa 3 — perda, RTT e uso na linha `[diag]`

`encodediag.line` ganha `perda=<n>%`, `rtt=<n>ms` e `uso=<n>%`, além do
`motivo` nas linhas `MUDOU`. Os números não entram na assinatura (continuam
fora dela, como fps e kbps). O formato da linha é contrato testado em
`encodediag.test.js`: atualizar o teste de propósito e anotar a mudança no
STATUS. Sem isso, a próxima noite de Radmin continua sem dizer por que a BWE
caiu.

### Tarefa 4 — spike B de novo, com a regra nova

Rodar o spike de 25/10 (`test.html`, cenários B1–B5) com o `screenres` novo:

- desktop (B4/B5): chega a 1080p e fica;
- jogo (B1/B2): mesmo comportamento de hoje (sobe e fica em 1080p).

O spike só mede o link livre. **Descer por congestão real não dá para
reproduzir em loopback no Windows sem um modelador de tráfego** (clumsy /
WinDivert, que pede download e aprovação). Duas opções, a decidir na revisão:

- (a) clumsy no loopback com limite de banda e atraso: confirma a descida e o
  recuo antes da noite de teste;
- (b) direto para a noite de teste com 2 PCs no Radmin, com as linhas `[diag]`
  da Tarefa 3 e `[qualidade]` da Tarefa 2.

Recomendo (a) se o clumsy mostrar que limita o loopback do Chromium; senão (b).

### Tarefa 5 — fechamento

- `npm test`, `npm run lint`, bancada `tela-parada.js` (o repetidor e a escada
  convivem no mesmo sender);
- STATUS.md: a escada nova, as constantes ainda não medidas no Radmin, a
  hipótese do teto refutada;
- noite de teste: no log, toda mudança de degrau com `motivo`, e nenhuma
  descida com `uso` abaixo de 0,5 sem perda ou RTT inflado.

## 4. Para quem revisar

Revisar contra o código real (`screenres.js`, `app.js:640-760`, `txstats.js`,
`encodediag.js`), não contra este texto. **Se este plano mandar algo que esta
rubrica chama de defeito, isso é um achado.** Pontos que merecem dúvida:

- `fractionLost` do `remote-inbound-rtp` é por intervalo de RTCP e pode vir
  ausente ou repetido entre ticks; perda por 5 s contínuos é o que o código
  acima mede de fato?
- `rtt` vem de `currentRoundTripTime` do par ICE (STUN), não do RTCP. Ele
  infla com fila de mídia no Radmin?
- `uso` usa o teto **aplicado**, que só muda quando a diferença passa de 10 %
  (`app.js:721`). Isso cria uma janela em que `uso` fica errado?
- A tentativa com a tela ociosa sobe a resolução sem prova de banda. Quando a
  tela volta a ter movimento, o tempo até descer (5 s com o encoder cheio) é
  aceitável para jogo?
- O `motivo` da descida com tentativa falha repete a conta de
  `Math.min(...)`: simplificar.
