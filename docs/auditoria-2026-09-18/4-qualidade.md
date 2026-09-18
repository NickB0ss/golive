# Time 4 — Qualidade, Testes, Segurança e Entrega

Auditoria de `/home/user/golive` em 2026-09-17, sobre `origin/main` em `b20cb17` (v0.16.0).
Somente leitura. Todo número abaixo veio de um comando rodado nesta máquina ou de uma
chamada à API do GitHub; o que não deu pra medir está marcado **[não verificado]**.

---

## Resumo executivo

A qualidade do código de teste é boa — testes de comportamento, fakes escritos à mão,
invariantes de arquitetura, um teste de propriedade com 1000 casos. O problema não é
como os testes são escritos, é **onde eles não estão** e **que ninguém os está lendo**.

Três riscos ameaçam um lançamento hoje:

1. **O CI está vermelho há 30 execuções seguidas, desde 2026-09-05.** Todas as versões
   de 0.11.0 a 0.16.0 foram publicadas com `lint + test` falhando no GitHub Actions.
   O portão existe, roda, reprova — e ninguém olha. Na prática o projeto não tem CI.
2. **`npm run dist` numa máquina sem `npm run build:native` gera um instalador sem o
   addon nativo de áudio, em silêncio** — `files` do electron-builder é lista de globs,
   e um glob que não casa nada não é erro. Não há hook que confira.
3. **`src/main/firewall.js:91-94` monta um comando PowerShell *elevado* interpolando
   `process.execPath` dentro de aspas simples.** Um apóstrofo no caminho (usuário
   "O'Brien" — legal no Windows) escapa da string e vira código executado com UAC.

Fora isso: 58,6% do código-fonte não tem teste nenhum e o relatório de cobertura diz
98% porque só conta arquivo que algum teste carregou. O Electron 32 está EOL há ~18
meses com 33 CVEs abertas, e a subida pra 44 tem três armadilhas **silenciosas** que a
nota "meio dia + verificação manual" não cobre. Os números do STATUS sobre `npm audit`
(2 e 0) hoje são 3 e 1.

---

## Números de hoje

| Medida | Valor medido | O que o STATUS afirma | Comando |
|---|---|---|---|
| Testes | **728 total, 727 passando, 1 falhando** | 733 passando (`STATUS.md:109`) | `npm test` |
| Teste que falha | `src/main/logger.test.js` | — (STATUS não registra falha) | `npm test 2>&1 \| grep "^not ok"` |
| Cobertura "oficial" | 98,00% linha / 91,84% ramo / 91,44% função | — | `node --test --experimental-test-coverage` |
| Cobertura real (denominador honesto) | **41,4% do código-fonte tem arquivo de teste; 58,6% (11.209 de 19.122 linhas, 14 arquivos) não tem nenhum** | — | script de contagem, abaixo em **A4** |
| Lint | **0 erros, 9 avisos** — todos `require-atomic-updates` | 0 erros, 9 avisos (`STATUS.md:110`) ✔ | `npm run lint` |
| `local/no-floating-promise` | **0 ocorrências** (regra verificada viva por sonda) | "10 promessas soltas" (dívida antiga) — **fechada** | `npm run lint` + sonda com `ESLint.lintText` |
| `npm audit` | **3 vulnerabilidades altas** (`electron`, `extract-zip`, `js-yaml`) | 2 (`STATUS.md:770`) | `npm audit` |
| `npm audit --omit=dev` | **1 alta** (`js-yaml@4.3.1` via `electron-updater`) | "sempre esteve em 0" (`STATUS.md:772-773`) | `npm audit --omit=dev` |
| Dependências | 19 prod / 429 dev / 29 opcionais | — | `npm audit --json` |
| Execuções de CI vermelhas seguidas | **30** (#61 a #90, de 2026-09-05 a 2026-09-15) | — | `actions_list` em `NickB0ss/golive` |
| Última execução verde | **#60**, 2026-09-04 23:31 UTC | — | idem |
| Branches no remoto | **19** (18 fora da `main`); **17 confirmadas mescladas** | "3 branches obsoletas" (`STATUS.md:780-784`) | `list_branches` + `git merge-base --is-ancestor` |
| Releases-rascunho órfãos | **2** (`v0.12.6`, `v0.12.7`, duplicando releases já publicados) | — | `list_releases` |
| Electron: instalado / estável hoje | **32.3.3 / 44.4.1** (45 em alpha) | alvo 44 (`STATUS.md:792`) ✔ | `npm view electron dist-tags` |

Detalhe da cobertura "oficial" (só arquivos carregados por algum teste): `signaling-core.js`
99,34%, `mesh.js` 92,11%, `updater.js` 97,57%, `check-release.js` 70,34% (linhas 107-141
descobertas = o `main()` inteiro), `logger.js` 32,77% (o teste nem carrega).

---

## Achados

### P0-1 — O CI está vermelho há 30 execuções e 12 dias; nenhum release desde a 0.11.0 passou pelo portão

`src/main/logger.js:25` · `.github/workflows/test.yml:27`

`logger.js:25` faz `const { app } = require('electron')` no topo do módulo, sem try/catch.
Com `npm ci --ignore-scripts` o `postinstall` do Electron não roda, `node_modules/electron/path.txt`
não existe, e `node_modules/electron/index.js` **lança** `Electron failed to install correctly`.
Isso não depende de plataforma — reproduzi aqui em Linux e o log do runner Windows mostra
exatamente o mesmo `# fail 1`.

`src/main/updater.js:36-42` faz certo: envolve o require numa função com try/catch, e o
comentário do workflow (`test.yml:12`) cita esse arquivo como se a receita valesse pro
repositório inteiro. Vale pro `updater.js`, não vale pro `logger.js`.

Linha do tempo verificada na API do GitHub:

- `.github/workflows/test.yml` ganhou o passo de lint em `c51a1f9`, **2026-09-02**.
- `logger.js`/`logger.test.js` entraram na `main` em `a50b89f`, **2026-09-05 14:25**.
- Execução **#60** (2026-09-04 23:31) — verde. Execução **#61** (2026-09-05 17:28) — vermelha.
- **#61 a #90 são todas `conclusion: failure`.** Entre elas: os PRs e merges das 0.11.0,
  0.12.x, 0.13.0, 0.13.1, 0.14.0, 0.15.0 e 0.16.0.

Consequência concreta: o portão que existiria pra impedir a regressão de 2026-09-05 está
ligado, roda, reprova — e o projeto seguiu publicando sete versões por cima. Um segundo
teste que quebrasse hoje seria indistinguível do ruído: a saída já é vermelha.

Conserto (3 passos, ~20 min):
1. Em `logger.js`, trocar o require de topo por uma função preguiçosa, no molde exato do
   `updater.js:36-42`: `function userDataDir() { try { return require('electron').app.getPath('userData'); } catch { return null; } }`, e `logsDir()` passa a usá-la. O `opts.dir` injetado
   pelos testes já contorna o caminho, então nenhum teste muda.
2. Rodar `npm test` → 728/728.
3. No workflow, acrescentar um passo `- run: npm test` que também falhe o job se o número
   de testes cair (ver **CI/CD proposto**).

Custo: baixo (20 min) · Risco: nenhum · **Prioridade: P0**

---

### P0-2 — Injeção de comando no PowerShell *elevado* do firewall

`src/main/firewall.js:91-94` (e o mesmo padrão em `:16`)

```js
const netshArgs = `advfirewall firewall add rule name="${RULE_NAME}" ... program="${execPath}"`;
const psCommand = `Start-Process netsh -ArgumentList '${netshArgs}' -Verb RunAs -WindowStyle Hidden -Wait`;
await exec(`powershell -Command "${psCommand}"`);
```

`execPath` (`process.execPath`, `firewall.js:86`) entra cru dentro de uma string de aspas
**simples** do PowerShell. Aspas duplas são caractere ilegal em caminho NTFS, mas
**apóstrofo não é**: `C:\Users\O'Brien\AppData\Local\Programs\golive-lan\GoLive LAN.exe`
é um caminho perfeitamente válido. O NSIS está em `perMachine: false` (`package.json`),
ou seja, instala em `%LOCALAPPDATA%` — o caminho **deriva do nome do usuário do Windows**.

Com um apóstrofo ali, a string do `-ArgumentList` fecha cedo e o resto do caminho é
interpretado como código PowerShell, dentro de um `Start-Process ... -Verb RunAs`, ou seja,
**com elevação**. Para o usuário comum com apóstrofo no nome, o efeito visível é a regra de
firewall nunca ser criada (e o erro cair no `catch` de `:95` como "elevação cancelada").
Para quem controlar o caminho de instalação, é execução de código elevada.

Segundo problema no mesmo trecho: `Start-Process netsh` resolve `netsh` pelo `PATH`. Um
diretório gravável antes do `System32` no `PATH` permite plantar um `netsh.exe` que roda
elevado.

O `port` interpolado na mesma string vem de `findFreeServer` (`src/main/ports.js:13-14`,
inteiro do laço 9000-9010) — esse não é controlável.

Conserto (4 passos):
1. Trocar a construção por `-EncodedCommand`, que o próprio arquivo já usa e documenta
   como a solução certa pro problema de escaping (`firewall.js:31-32`, `:44-46`) — a consulta
   foi convertida e a escrita ficou pra trás.
2. Montar o script com os argumentos numa lista do PowerShell (`@('advfirewall', ..., "program=$exe")`)
   e `$exe` vindo de uma variável definida pelo próprio `-EncodedCommand`, não por interpolação JS.
3. Usar o caminho absoluto `"$env:SystemRoot\System32\netsh.exe"` no lugar de `netsh`.
4. Acrescentar em `firewall.test.js` um caso com `execPath` contendo apóstrofo, espaço e
   `;` — os 8 testes de hoje passam só caminhos benignos.

Custo: médio (2-3 h) · Risco: médio (mexe no único caminho com elevação; precisa de teste no
Windows real) · **Prioridade: P0** (é o único ponto do produto que pede UAC)

---

### P0-3 — `npm run dist` publica um instalador sem o addon nativo, sem avisar

`package.json` (bloco `build.files`, entrada `"build/Release/golive_audio.node"`) · `binding.gyp`

`build/` está no `.gitignore:3` e não existe num clone limpo (confirmado: `ls build/Release/`
→ `No such file or directory`). O campo `files` do electron-builder é uma lista de **globs**:
um glob que não casa nada não é erro, é um conjunto vazio. `asarUnpack` sobre o mesmo
caminho também vira no-op.

Resultado: `npm run dist` num checkout onde `npm run build:native` não rodou **conclui com
sucesso** e produz um `.exe` funcional em que a captura de áudio por processo simplesmente
não existe — `getOwnPid()` devolve 0 e `src/renderer/app.js:3320` cai no loopback de sistema
sem nenhuma mensagem. Não há `beforeBuild`/`afterPack` no `package.json` (verificado por grep),
nem passo de CI que gere o instalador.

Validação estática que **dá** pra fazer sem build completo (fiz, e o resultado é bom): o bloco
`build` foi conferido contra `node_modules/app-builder-lib/scheme.json` do electron-builder 26 —
**nenhuma chave desconhecida** entre as 89 aceitas no topo. Ou seja, o medo do STATUS de que "o
26 muda default de scripts de pacote e nomes de artefato" não se materializa em erro de
configuração; o risco real de `npm run dist` é este aqui, que é anterior ao electron-builder.

Conserto (3 passos):
1. `beforeBuild` no `package.json` que faz `fs.existsSync('build/Release/golive_audio.node')`
   e lança com mensagem explícita ("rode `npm run build:native` antes do `npm run dist`").
2. Passo de CI que roda `npx electron-builder --win --dir` (sem NSIS, sem publicar) e
   confere que `golive_audio.node` está no `resources/app.asar.unpacked/`.
3. `npm run release:check` como último passo, depois da publicação.

Custo: baixo (1-2 h) · Risco: baixo · **Prioridade: P0** (é perda de funcionalidade silenciosa
num artefato que vai pra todo mundo)

---

### P1-1 — Electron 32 está EOL há ~18 meses; a subida pra 44 tem três armadilhas silenciosas

`package.json` (`"electron": "^32.0.0"`) · `src/main.js:516-519`, `:51-63` · `binding.gyp:17,24`

`npm view electron dist-tags` hoje: `latest = 44.4.1`, `alpha = 45.0.0-alpha.7`. O Electron
mantém as 3 majors mais recentes → suportadas hoje são **42, 43, 44**. A 32 saiu do suporte
quando a 35 estabilizou.

O `npm audit` de hoje lista **33 avisos** contra `electron <= 40.10.2` — entre eles ASAR
Integrity Bypass, bypass de isolamento de contexto via `Function.prototype.bind`, injeção de
switch de linha de comando no renderer via `commandLineSwitches`, e HTTP redirect seguido para
o loader de arquivo local. Este app carrega só conteúdo local, não abre URL de terceiro e não
tem `webview`, então a exposição prática é baixa — mas "baixa" não é "nenhuma", e o custo de
ficar é que a lista só cresce.

Custo de ficar onde está: nenhuma correção de segurança chega mais, `npm audit` nunca zera
(bloqueando o B2 pra sempre), e cada major que passa aumenta o tamanho do salto. Ver o
**Plano** abaixo pro detalhe das três armadilhas (assinatura do `console-message`, minúsculas
do `app.commandLine`, C++20 no addon nativo).

Custo: alto (2-3 dias reais, não meio dia) · Risco: alto · **Prioridade: P1**

---

### P1-2 — 58,6% do código-fonte não tem teste nenhum, e o relatório de cobertura esconde isso

`src/renderer/app.js` (5341 linhas) · `src/renderer/ui.js` (3638) · `src/main.js` (1371)

`node --test --experimental-test-coverage` termina com `all files | 98.00 | 91.84 | 91.44`.
Esse número é verdadeiro e enganoso ao mesmo tempo: o coletor do Node só relata arquivo que
foi **carregado** durante a execução. Os três maiores arquivos do projeto não são carregados
por teste nenhum, então não aparecem na tabela — nem com 0%.

Contagem com o denominador honesto (todo `.js` fora de `node_modules`, `build`, `dist`,
excluindo `*.test.js`):

```
LOC total de fonte:            19.122
com arquivo de teste irmão:     7.913  (41,4%)
SEM NENHUM TESTE:              11.209  (58,6%) em 14 arquivos
   5341  src/renderer/app.js
   3638  src/renderer/ui.js
   1371  src/main.js
    229  src/renderer/overlay.js
    181  src/preload.js
    174  src/renderer/sound.js
     66  src/renderer/pcm-injector-worklet.js
     46  server/signaling.js
     45  scripts/patch-clangcl-toolset.js
     42  src/splash/splash.js
     29  src/preload-overlay.js
     23  src/renderer/espiar-page.js
     15  src/splash/preload-splash.js
      9  src/espiar-preload.js
```

**Onde está o buraco:** não é "muito teste em módulo fácil". Os módulos testados são os certos
(mesh, sinalização, árvore, qualidade, tema, atualização) e estão bem cobertos. O buraco é que
o projeto extraiu com disciplina toda a lógica **pura** pra módulos testáveis e deixou toda a
**orquestração** — quem chama o quê, em que ordem, com que guarda de reentrância — em três
arquivos monolíticos sem teste. E é exatamente aí que moram os bugs que o `git log` conta:
`aea96fa` (corrida no repasse, `app.js`), `ef9363a` (retomada, `app.js`), `a0647e1` (instância
única, `main.js`), `561918b`/`405a71c` (faixa de título, dois hotfixes seguidos).

O item **D1** do STATUS ("extrair de `app.js` um módulo puro de orquestração de sessão/árvore")
está catalogado como refatoração adiável de 1-2 dias. Medido assim, ele é o item que destrava
a cobertura — é o pré-requisito dos cinco testes da lista abaixo, não um luxo.

#### Qualidade dos testes: 4 bons e 3 fracos, concretos

**Bons:**

- `src/renderer/css-rules.test.js:54-87` — lê o `style.css` **real** e testa invariantes de
  arquitetura: piso de 11px (e o regex aceita `!important`, porque `10px !important` passava
  antes), `backdrop-filter` proibido, cor literal fora de bloco `:root`, `.empty` sem escopo.
  Quebra quando a regra é quebrada, não quando alguém renomeia uma função. É teste de
  *contrato de design*, raro de ver.
- `src/renderer/emoji.test.js:16-42` — invariantes da tabela de dados: nenhum emoji em dois
  grupos, toda palavra-chave sem acento (`:33` compara `keywords` com `normalize(keywords)`),
  ícone do grupo pertence ao grupo. 18 testes pra 661 linhas parece raso, mas ~600 dessas
  linhas são tabela e os testes atacam exatamente o que uma tabela erra.
- `src/renderer/tree.test.js` — teste de propriedade: "computeTree respeita as invariantes da
  spec pra qualquer sala (1000 casos aleatórios)". É o único no repositório e vale por vinte.
- `src/main/firewall.js:86` + `firewall.test.js` — o `exec` entra por injeção, então os testes
  exercitam o caminho real (inclusive o parse do JSON do PowerShell e o caso "objeto solto em
  vez de array", `firewall.js:79-81`) sem tocar no `netsh`. Boa forma.

**Fracos (passariam com a função quebrada):**

- `src/renderer/annotate.test.js:18` — `assert.equal(colorFor('1'), colorFor('1'))`. Passa se
  `colorFor` devolver `undefined` pra tudo. A propriedade "é determinístico" só vale junto com
  uma asserção de que o valor é uma cor.
- `src/renderer/emoji.test.js:51` — `assert.deepEqual(search('coração').slice(0,1), search('coracao').slice(0,1))`.
  Passa se `search` devolver `[]` pras duas. Salvo pelas linhas `:52-53`, que afirmam valor —
  mas a asserção em si não segura nada.
- `server/signaling-core.test.js:2250` — um `test()` sem **nenhum** `assert` no corpo (único
  do repositório). Só falha se algo lançar.
- E o caso estrutural: `src/main/logger.test.js` injeta `dir` justamente pra rodar sem Electron
  (comentário em `:9-11`), mas o require de topo do módulo derruba tudo antes. O teste está
  correto; o módulo é que não é testável. Nunca rodou verde no CI.

#### Os 5 testes que mais fariam falta hoje

1. **Reentrância de `startShare`/`stopShare`** (`app.js:3339-3541`). Deveria garantir: um
   `stopShare` disparado durante o laço de ofertas (`:3526-3528`) não pode deixar a sala com
   `broadcast-state {live:true}` e o botão em `on`. Hoje deixa — ver **P1-4**.
2. **Reentrância de `room:host`** (`main.js:1024-1075`). Deveria garantir: duas chamadas
   concorrentes não deixam um servidor de sinalização órfão escutando numa porta. Hoje deixam
   — ver **P1-3**.
3. **Contrato do `console-message`** (`main.js:516-519`). Deveria garantir que a linha que
   chega no log de arquivo tem nível e mensagem legíveis, alimentando o handler com a
   assinatura que a versão instalada do Electron usa. É o único teste que pega a armadilha
   nº 1 da subida do Electron antes do app rodar.
4. **`ensureFirewallRule` com caminho hostil** (`firewall.js:86-102`). Deveria garantir que
   `execPath` com apóstrofo, espaço e `;` não escapa da string do PowerShell — ver **P0-2**.
5. **`main()` do `check-release.js`** (`scripts/check-release.js:107-141`, hoje 0% coberto).
   Deveria garantir o código de saída 1 com release incompleto e 0 com release completo, com
   o `gh` injetado. É o script que existe pra impedir que o incidente da v0.10.0 se repita, e
   a única parte dele que é chamada de verdade é a única sem teste.

Custo: alto · Risco: baixo (só acrescenta) · **Prioridade: P1**

---

### P1-3 — `require-atomic-updates` em `main.js:1039` **não** é falso positivo: `room:host` não tem trava de reentrância

`src/main.js:1024-1075`

Verifiquei os 9 avisos um a um. Sete são falsos positivos legítimos; dois merecem conversa.

| # | Local | Variável | Veredito |
|---|---|---|---|
| 1 | `main.js:324` | `discoveryStarted` | **Falso positivo pra regra, mas a guarda tem furo.** `ensureDiscoveryStarted` marca `true` antes do `await` (`:313-314`), então a segunda chamada retorna cedo — *antes* de `discovery.start()` ter terminado. Se a primeira falhar, `:324` volta pra `false` e a segunda já retornou achando que subiu. Efeito: descoberta silenciosamente desligada até a próxima chamada. Baixo impacto (é best-effort por desenho, `:324` comenta isso). |
| 2 | `main.js:1039` | `embeddedServer` | **CORRIDA REAL.** Ver abaixo. |
| 3 | `app.js:3243` | `ownPidCache` | Falso positivo. Cache idempotente (`if (x===null) x = await`); duas chamadas fazem trabalho dobrado e gravam o mesmo valor. |
| 4 | `app.js:3257` | `discordPidCache` | Falso positivo. Mesmo padrão, com TTL. |
| 5 | `app.js:3320` | `nativeAudioAvailable` | Falso positivo. Mesmo padrão. |
| 6 | `app.js:3459` | `localStream` | **Corrida real, mas com outro culpado.** Ver **P1-4**. |
| 7 | `app.js:3540` | `sharing` | Falso positivo. `sharing = true` em `:3346` é síncrono depois da guarda `:3339`; o `finally` fecha o latch corretamente. |
| 8 | `app.js:4015` | `cameraStream` | Falso positivo. Latch `cameraStarting` (`:3984-3985`) + guarda de época (`:4010`). Bem feito. |
| 9 | `app.js:4044` | `cameraStarting` | Falso positivo. `finally` do latch acima. |

O caso 2: `ipcMain.handle('room:host')` faz `if (embeddedServer || embeddedServerClosing) await closeEmbeddedServer();`
(`:1028`) e depois `embeddedServer = await findFreeServer(...)` (`:1039`). **Não existe latch
de "criação em voo"** — diferente de `startShare` (`sharing`) e `startCamera` (`cameraStarting`),
que o mesmo projeto implementou com cuidado.

Duas invocações concorrentes do IPC (o renderer chama `hostRoomFlow` em dois caminhos —
`app.js:1060` na migração de sala e `app.js:1100` no diálogo de criar) passam ambas pela
guarda com `embeddedServer === null`. `findFreeServer` tolera `EADDRINUSE` e cai pra porta
seguinte (`ports.js:16-19`), então **as duas conseguem subir**: uma na 9000, outra na 9001.
A segunda atribuição sobrescreve a referência; o primeiro servidor fica escutando pra sempre,
com o `ownerToken` e o PIN da primeira sala, sem nenhum caminho que o feche. De quebra,
`ensureFirewallRule` roda duas vezes com portas diferentes — dois prompts de UAC.

Conserto (2 passos):
1. Latch no molde de `sharing`: `let hostingInFlight = null;` e `if (hostingInFlight) return hostingInFlight;`
   no topo do handler, liberado num `finally`.
2. Teste do item 2 da lista dos cinco.

Custo: baixo (1 h) · Risco: baixo · **Prioridade: P1**

---

### P1-4 — `stopShare` durante o laço de ofertas deixa a sala achando que você está ao vivo

`src/renderer/app.js:3459` (atribuição), `:3471`, `:3517`, `:3526-3533` · `:3765-3767` (stopShare)

`startShare` atribui `localStream = stream` em `:3459` e só chega no
`session.sig.send({ type: 'broadcast-state', live: true, ... })` em `:3533`. Entre os dois há
dois pontos de `await` reais: `await startAnnotOverlay()` (`:3517`) e o laço
`for (...) await offerOwnStreamTo(...)` (`:3526-3528`), que com 4 pessoas na sala leva segundos.

`stopShare` (`:3765`) é síncrono e tem a guarda `if (!localStream) return` — que a partir de
`:3459` **passa**. Ele é alcançável nessa janela por dois caminhos:

- o listener `track.addEventListener('ended', stopShare)` registrado em `:3471` — dispara quando
  a pessoa clica em "Parar de compartilhar" na barra do Windows;
- o próprio botão do app: `btn-toggle-share` faz `if (localStream) return stopShare();`
  (`app.js:3326`), e `localStream` já está preenchido.

Se `stopShare` roda ali, ele derruba tudo e envia `broadcast-state {live:false}`. Aí
`startShare` retoma do `await` e segue: a guarda de `:3529` é `if (currentSession !== session) return`,
que só pega **troca de sessão**, não um stop dentro da mesma sessão. Então `:3533` reanuncia
`live: true` e `:3534` põe o botão em `on`, com `localStream === null`.

Estado final: a sala inteira acredita que você está transmitindo, seu tile sumiu, o botão diz
que está ligado, e clicar nele não para nada (`stopShare` retorna na guarda) — cai no
`if (sharing) return` (já `false`) e reabre o seletor de fonte.

Conserto (2 passos):
1. Uma época de compartilhamento, no molde exato do que `startCamera` já faz com `mediaEpoch`
   (`app.js:3985`, `:4010`): capturar `const epoch = ++shareEpoch` no topo e trocar a guarda de
   `:3529` por `if (currentSession !== session || epoch !== shareEpoch) return;`. `stopShare` já
   incrementa `swapEpoch` em `:3766` — o padrão está lá, só não foi aplicado aqui.
2. Teste do item 1 da lista dos cinco.

Custo: baixo (1-2 h) · Risco: baixo · **Prioridade: P1**

---

### P1-5 — O PIN de 4 dígitos é força-brutável em menos de um minuto: não há contador por IP

`server/signaling-core.js:645`, `:709-717` · `src/main.js:1033` (geração)

O rate limiter é criado **dentro** do handler de conexão (`:645`, `const rateLimiter = createRateLimiter({})`),
ou seja, é por socket. Uma tentativa de PIN errado responde `join-denied` e fecha com 1008
(`:713-716`). O atacante abre outro socket e tenta de novo, com a cota zerada. Não há contador
por `remoteAddress` — `ws._socket?.remoteAddress` só é lido em `:689` pra checar ban.

10.000 combinações, num handshake de LAN virtual de poucos milissegundos, é menos de um minuto
com uma conexão de cada vez, e o servidor não tem teto de conexões simultâneas.

O raciocínio registrado em `main.js:1030-1032` — *"o servidor derruba o socket a cada tentativa,
e a sala vive minutos"* — **não se sustenta**: derrubar o socket não custa nada ao atacante.
O `Math.random()` na geração é o menor dos problemas (com 9.000 valores, previsibilidade quase
não muda a conta).

Honestidade sobre o modelo de ameaça: ver a seção **Modelo de ameaça** abaixo. Isto é P1 e não
P0 porque o atacante já precisa estar na LAN virtual.

Conserto (2 passos):
1. `Map<remoteAddress, {falhas, ate}>` no escopo do servidor: 5 PINs errados do mesmo IP em 60 s
   → recusa o `join` por 60 s antes de olhar o PIN. Cabe em ~15 linhas ao lado de `findBan`.
2. PIN de 6 dígitos com `crypto.randomInt` (o `require('crypto')` já está em `main.js:1036`).

Custo: baixo (2 h) · Risco: baixo · **Prioridade: P1**

---

### P1-6 — `npm audit --omit=dev` não é 0: `js-yaml` alto chega no app publicado

`package.json` (`"electron-updater": "^6.8.9"`)

```
$ npm audit --omit=dev
js-yaml  4.0.0 - 4.3.1   Severity: high
js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources
  → GHSA-2883-xcg3-v3hh
1 high severity vulnerability
fix available via `npm audit fix`
```

Caminho confirmado: `golive-lan → electron-updater@6.8.9 → js-yaml@4.3.1` (`npm ls js-yaml --omit=dev`).

`STATUS.md:772-773` afirma que "`npm audit --omit=dev` sempre esteve em 0: nada disso alcança
quem usa o app". Hoje não é verdade. O `js-yaml` é o parser do `latest.yml` que o
`electron-updater` baixa do GitHub Releases — ou seja, roda no app instalado de todo mundo,
sobre conteúdo remoto.

Exploração prática: baixa. O `latest.yml` vem do repositório do próprio projeto por HTTPS; pra
alimentar YAML hostil o atacante precisaria comprometer o release (e aí o `.exe` sem assinatura,
**P2-2**, é um problema muito maior). Mas a correção é `npm audit fix` sem quebra, e o custo de
deixar é uma afirmação falsa no documento que o projeto usa como memória.

Conserto (2 passos):
1. `npm audit fix` (sem `--force`): sobe só o `js-yaml`, não toca no Electron.
2. `npm audit --omit=dev` como passo do CI que **falha** o job (ver **CI/CD proposto**) — essa
   é a métrica que o projeto já decidiu que importa.

Custo: trivial (5 min) · Risco: nenhum · **Prioridade: P1**

---

### P1-7 — O processo de release não está à altura da trava de versão que o app impõe

`src/renderer/version.js:4-18` · `server/signaling-core.js:698-706` · `scripts/check-release.js` · `.github/workflows/test.yml`

`version.js` e o gate do servidor (`signaling-core.js:698-706`) exigem **igualdade exata** de
versão pra entrar numa sala. Um release quebrado não afeta só quem baixou: trava a sala inteira,
porque quem já atualizou não consegue mais falar com quem não atualizou, e vice-versa.

Contra essa exigência, o processo de release hoje é:

- **Nenhum passo de build no CI.** O workflow tem três passos (`checkout`, `lint`, `test`) e
  para aí. O instalador é gerado na máquina do autor.
- **`npm run release:check` não é chamado por nada.** O script existe (`scripts/check-release.js`),
  é bom, tem 9 testes — e nasceu justamente do incidente da v0.10.0, em que o release subiu só
  com o `.exe` e derrubou a atualização de **todas** as versões anteriores. Ele não está
  amarrado a nenhum gatilho. Repetir o incidente exige apenas esquecer de rodá-lo à mão.
- **Nenhum caminho de reversão.** Se um release sai quebrado, o `electron-updater` sempre lê o
  `latest.yml` do release **mais novo**. Não há "despublicar" automatizado nem canal de
  pré-release. O conserto é manual, no site do GitHub, sob pressão.
- **O histórico mostra o custo.** `v0.12.0` (2026-09-06 02:58 UTC) até `v0.12.7`
  (2026-09-07 15:35 UTC): **oito releases em ~36 horas**, e cada um obrigou todo mundo da sala
  a atualizar junto. Dois deles (`0.12.6` e `0.12.7`) ainda têm **releases-rascunho órfãos**
  com a mesma tag, duplicando o publicado.

Ponto positivo verificado: o `v0.16.0` publicado está **completo** — `GoLive-LAN-Setup-0.16.0.exe`
(79,4 MB), `.exe.blockmap` e `latest.yml`, com os nomes hifenizados que o `artifactName` fixou
depois do incidente. O `check-release.js` aprovaria. A correção da 0.10.1 funcionou; o que falta
é torná-la automática.

Conserto: ver **CI/CD proposto**, passos 6-8.

Custo: médio (1 dia) · Risco: baixo · **Prioridade: P1**

---

### P2-1 — O `eslint.config.js` escolhe regras à mão e perde parte do `eslint:recommended`

`eslint.config.js:120-184`

A config lista ~45 regras de correção uma a uma em vez de estender o `recommended`. O critério
declarado (`:117-119` — "regras de CORREÇÃO, não de estilo") é o certo, mas a lista feita à mão
deixou de fora regras do próprio `recommended` que são puro pega-bug.

A mais relevante é **`no-case-declarations`**. Confirmei por sonda (`ESLint.lintText` contra a
config real, arquivo virtual, nada escrito em disco): `switch (v) { case 1: const x = 2; ... }`
**não é acusado** hoje. `const`/`let` dentro de um `case` sem chaves vaza pro `switch` inteiro,
e este projeto tem `switch (msg.type)` gigantes em `app.js` e `signaling-core.js` — é a forma
exata do bug que a regra existe pra pegar.

Rodei um conjunto de candidatas contra o código real (`src/**`, `server/**`, `scripts/**`) pra
separar "regra útil" de "regra que só faz barulho":

| Regra | Ocorrências hoje | Leitura |
|---|---|---|
| `eqeqeq` | 62 (`src/main/discovery.js:165`, …) | Barulho. Não ligar. |
| `no-await-in-loop` | 34 (`src/main/ports.js:16`, …) | **Ligar como `warn`.** Inclui `app.js:3526-3528`, o laço de ofertas serializado que é a janela do **P1-4** e a causa do "tela preta ao entrar" (`aea96fa`). Ver o aviso é ver o risco. |
| `no-shadow` | 17 (quase todas em `*.test.js`) | Ligar só fora de teste, ou deixar. |
| `consistent-return` | 8 (`src/main.js:330`, …) | **Ligar como `warn`.** Função que às vezes devolve e às vezes não é fonte clássica de `undefined` inesperado. |
| `no-unmodified-loop-condition` | 1 (`src/renderer/screenrelay.js:132`) | **Ligar como `error`.** Um hit só, no `while (vivo)` do laço de quadros do relay — a variável muda por closure, então é falso positivo, mas custa um `eslint-disable` com comentário e a regra passa a guardar os próximos. |
| `no-case-declarations`, `for-direction`, `no-useless-escape`, `no-template-curly-in-string`, `array-callback-return`, `no-empty-pattern`, `no-regex-spaces` | **0** | **Ligar todas como `error`.** Custo zero hoje, cada uma guarda uma classe de bug real. |

Conserto (2 passos):
1. Trocar a lista manual por `js.configs.recommended` + os `off` deliberados + as regras extras
   que o projeto já escolheu (o `local/no-floating-promise`, o `require-atomic-updates` em `warn`).
2. Acrescentar `no-await-in-loop` e `consistent-return` em `warn`.

Nota boa: a regra caseira `local/no-floating-promise` **continua funcionando** (sonda: acusa
tanto a chamada de `async` local quanto a cadeia `.then` sem `.catch`), e hoje encontra **0**
ocorrências. A dívida das "10 promessas soltas" que o STATUS registra está **fechada** — vale
registrar isso, porque o documento ainda a menciona.

Custo: baixo (2 h) · Risco: baixo · **Prioridade: P2**

---

### P2-2 — O instalador não é assinado e o README não avisa (B6)

`package.json` (bloco `nsis`, sem `certificateFile`) · `README.md:61-70`, `:169-181`

A decisão de não comprar certificado é defensável pra um app entre amigos — concordo com o
STATUS aqui. O problema não é a decisão, é que ela não foi comunicada.

Grep por `smartscreen|assinad|assinatura|certificad|defender` no `README.md` e no `STATUS.md`:
**zero ocorrências** no README. `README.md:63` diz "é só clicar para instalar — sem terminal,
sem Node". O que acontece de verdade é a tela azul do SmartScreen ("O Windows protegeu o seu PC"),
que não tem botão de continuar visível — é preciso clicar em "Mais informações" primeiro.

O custo disso não é o atrito: é que a instrução que o usuário vai receber por voz ("ignora,
clica em mais informações e executar assim mesmo") **treina exatamente o reflexo** que torna a
ausência de assinatura perigosa. O updater baixa e instala sozinho na abertura
(`src/main/updater.js:9-24`), sem assinatura verificada, de um release que qualquer
comprometimento da conta do GitHub pode trocar.

Conserto (2 passos, sem comprar nada):
1. Seção no README, ao lado de `:63`, explicando a tela do SmartScreen, **por que** ela aparece
   e como conferir o SHA-256 do `.exe` contra o `digest` que a API do GitHub já publica (o
   release `v0.16.0` traz `sha256:3148...` no asset — está lá, ninguém usa).
2. Registrar no STATUS que a mitigação escolhida é "hash publicado + canal único de download",
   não "nenhuma".

Custo: baixo (1 h) · Risco: nenhum · **Prioridade: P2**

---

### P2-3 — C5 subestima o problema: 17 branches mescladas no remoto, não 3; e 2 releases-rascunho órfãos

`STATUS.md:780-784`

`STATUS.md:781-783` nomeia três branches (`claude/backlog-pos-leyjak`,
`claude/planejamentos-futuros-projeto-leyjak`, `claude/redesign-discord-style`). A API do
GitHub lista **19 branches**; testei cada SHA com `git merge-base --is-ancestor <sha> origin/main`:

```
MESCLADAS (17):  claude/backlog-pos-leyjak, claude/camera-sharing-sketches-py7ez2,
                 claude/layout-version-validation-c74rb7, claude/planejamentos-futuros-projeto-leyjak,
                 claude/quality-selection-ui-ux-mso19o, claude/redesign-connection-page-k64yy3,
                 claude/redesign-discord-style, claude/screen-share-camera-ui-qppkll,
                 claude/streaming-ui-chat-features-uns69j, feat/design-integracao,
                 feat/integracao-2026-09-12, feat/integracao-2026-09-15, feat/marca-do-app,
                 fix/atualizacao-latest-yml, fix/rabisco-ferramentas-e-overlay,
                 fix/tela-preta-ao-assistir, release/0.5.0
[não verificado]: claude/zen-faraday-lvnsbl (objeto ausente neste clone; não consegui
                 confirmar se está mesclada)
```

Além disso, `list_releases` mostra **dois releases em estado `draft`** com as tags `v0.12.6` e
`v0.12.7` — que também existem como releases publicados. O `electron-updater` ignora rascunho
(e o `check-release.js:68-70` reprova rascunho), então não quebram nada hoje; são entulho do
processo manual e ruído pra quem for auditar o próximo incidente de release.

Higiene do resto do repositório: **limpa**. `.gitignore` cobre `node_modules/`, `dist/`,
`build/`, `tools/iperf3*`, `*.log`, worktrees. O maior arquivo versionado é o próprio
`src/renderer/app.js` (251 KB); o maior binário é `src/renderer/assets/icon.png` (52 KB).
Nenhum artefato de build versionado. **C4** (`dist/` de 1,2 GB) é disco local e não toca no
repositório — neste clone `dist/` nem existe.

Conserto: apagar as 17 do remoto (proteger a `main` antes), apagar os 2 rascunhos, e corrigir
`STATUS.md:780-784`.

Custo: trivial (15 min) · Risco: baixo · **Prioridade: P2**

---

### P2-4 — Os números do STATUS.md não batem com a medição de hoje

`STATUS.md:109`, `:770-773`, `:792`

| Linha | Afirma | Medido hoje |
|---|---|---|
| `STATUS.md:109` | "`npm test` → **733 passando**" | **728 total, 727 passando, 1 falhando** |
| `STATUS.md:110` | "0 erros, 9 avisos" | 0 erros, 9 avisos ✔ |
| `STATUS.md:770` | "`npm audit` cai a **2**" | **3** |
| `STATUS.md:771` | "as 2 são o `electron@32` (e o `extract-zip` dele)" | Essas duas + `js-yaml` |
| `STATUS.md:772-773` | "`npm audit --omit=dev` sempre esteve em **0**" | **1** (`js-yaml`, alcança produção) |
| `STATUS.md:792` | B1 "fecha as 2 vulnerabilidades que sobram" | Fecha 2 de 3; o `js-yaml` sai com `npm audit fix`, sem tocar no Electron |

A linha `:109` é a que mais importa: ela registra um número **maior** que o real e **nenhuma
falha**, num momento em que o CI está vermelho há 12 dias. É o sintoma documental do **P0-1**.

Custo: trivial · Risco: nenhum · **Prioridade: P2**

---

### P3-1 — `README.md:351-357` ainda diz que a sala morre quando o host cai

`README.md:351-357`

```
351: ### Se o host cai, a sala morre
...
356: correndo enquanto ninguém entra nem sai — mas não há transferência de sala:
357: esgotado o retry, a sessão acaba pra todo mundo.
```

A transferência de sala (`transfer-owner`) saiu na 0.14.0. O commit `abfc99c` (release 0.16.0)
diz na própria mensagem que corrigiu esse trecho — e corrigiu **uma** ocorrência (o diff mostra
a remoção de "não há como transferir a sala pra outra máquina no meio da…"), deixando esta
segunda cópia, título incluído.

O resto do README está em dia: o nome hifenizado do instalador (`:177`) bate com o
`artifactName`; não há mais menção a presets 1440p (removidos na 0.13.0); Node 18+ (`:65`) bate
com `engines`.

Custo: trivial · Risco: nenhum · **Prioridade: P3**

---

## Modelo de ameaça honesto

O conjunto "sinalização aberta + PIN de 4 dígitos + WebRTC sem identidade verificada + updater
sem assinatura" merece ser lido junto, não item a item.

**O que é aceitável pra um app entre amigos, e eu não mexeria:**

- **DTLS-SRTP sem identidade verificada.** A mídia É criptografada em trânsito (DTLS-SRTP é
  obrigatório no WebRTC); o que falta é amarrar o certificado a uma identidade. Quem trocaria
  o fingerprint precisa já ser man-in-the-middle no servidor de sinalização — que roda no PC
  de quem criou a sala, dentro da VPN. Amarrar identidade exigiria PKI. Não se paga.
- **Moderação cooperativa.** O STATUS já registra isso: um cliente modificado segura um link
  P2P aberto. Certo, e é o preço de não ter SFU.
- **`ignore-gpu-blocklist`** (`main.js:72`). Desativa uma proteção contra driver bugado. O
  pior caso é crash da GPU, e o log de 2026-08-29 justifica.
- **O servidor aceita qualquer um na LAN virtual.** Radmin VPN e Tailscale já são a fronteira
  de confiança. Quem está lá dentro foi convidado.

**O que é risco real:**

- **PIN força-brutável (P1-5).** Não porque alguém vai invadir, mas porque a única defesa contra
  "o amigo do amigo entrou sem ser chamado" é um segredo de 4 dígitos sem nenhum
  atraso entre tentativas. O PIN é vendido na interface como cadeado; hoje ele é aviso.
- **Updater sem assinatura (P2-2), instalando sozinho na abertura.** `updater.js` baixa e
  `quitAndInstall(true, true)` sem confirmação, de um release do GitHub. Quem tiver a conta do
  GitHub tem execução de código em todas as máquinas que abrirem o app. É o único ponto do
  sistema com raio de ação fora da LAN, e é o que mais se paga documentar.
- **`firewall.js` (P0-2).** O único código que pede elevação, construindo o comando por
  interpolação de string.
- **O servidor escuta em todas as interfaces.** `new WebSocketServer({ port, maxPayload })`
  (`signaling-core.js:355`) sem `host`, ou seja, `0.0.0.0` — não só a interface da VPN.
  Mitigado parcialmente pela regra de firewall com `profile=private,domain` (`firewall.js:16`),
  que exclui redes públicas — mas só quando a regra existe e o perfil está certo. Passar
  `host` explícito custaria uma linha. **[não verificado]** se o `pickAddress()` do `main.js`
  já restringe na prática.

O que o servidor faz **bem**, e vale registrar: reconstrói mensagem campo a campo em vez de
repassar (`signaling-core.js`, rebroadcast de `watchers`), compara `resumeToken` com
`timingSafeEqual` (`:519-524`), tem teto de payload (512 KB), cota global de 300 msg/s e cotas
separadas por tipo (chat 5/s, `annotate` 60/s, laser 30/s, `watchers` 20/s, `reoffer` 2/s),
e checa ban → versão → PIN nessa ordem pra não vazar se o PIN estaria certo (`:690-691`).
É um servidor bem mais duro do que o "app entre amigos" exigiria. A falta de contador por IP
no PIN destoa do resto.

---

## Plano de subida do Electron 32 → 44

**Alvo certo hoje: 44.4.1** (`latest`). A 45 está em alpha. A 44 é a única das suportadas
(42/43/44) que fecha todos os avisos do `npm audit` e dá a maior janela antes do próximo EOL.

A estimativa do STATUS ("meio dia + verificação manual") está errada por um fator de 4-6.
**São 2-3 dias**, e o motivo é que as três mudanças que importam são **silenciosas**: nenhuma
delas gera erro, crash ou log. Fonte: `docs/breaking-changes.md` do repositório do Electron,
consultado hoje.

### As três armadilhas

**1. `console-message` mudou de assinatura na 35 — o log de arquivo morre em silêncio.**

`src/main.js:516-519`:
```js
win.webContents.on('console-message', (_event, level, message) => {
  const LEVELS = ['log', 'info', 'warn', 'error'];
  logger[level >= 2 ? 'error' : 'log'](`[renderer:${LEVELS[level] || level}] ${message}`);
});
```
A partir da 35 o handler recebe `(event, details)`, com `details = { message, level, lineNumber, sourceId, frame }`
e `level` como **string**, não número. Com o código acima: `level` vira o objeto `details`,
`message` vira `undefined`, `level >= 2` é `false`. Toda linha do renderer passa a ser gravada
como `[renderer:[object Object]] undefined`, no nível errado.

Impacto: **o log em arquivo é a ferramenta de diagnóstico principal do projeto** —
`logger.js:1-18` conta que ele existe porque ninguém deixa o DevTools aberto compartilhando
tela, e metade dos hotfixes do `git log` foram diagnosticados por ele. Perdê-lo em silêncio
no meio da subida do Electron é o pior cenário possível: você quebra o instrumento e o
instrumento que diria que ele quebrou.

**2. `app.commandLine` passa tudo pra minúsculas a partir da 36 — as flags de WGC e H264 morrem.**

`src/main.js:51-63`:
```js
const ENABLED_FEATURES = ['WebRtcAllowH264Send', 'AllowWgcScreenCapturer',
                          'AllowWgcWindowCapturer', 'AllowWgcDesktopCapturer'];
app.commandLine.appendSwitch('enable-features', ENABLED_FEATURES.join(','));
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
```
Na 36 o `app.commandLine` **converte switches e argumentos pra minúsculas**. Nomes de feature
do Chromium são case-sensitive, e o próprio arquivo documenta (`:34-35`) que *"uma feature que
não existe nesta versão do Chromium também é ignorada em silêncio — parece que funcionou"*.

Três consequências, todas mudas:
- **WGC desligado** → volta o caminho GDI/BitBlt → tela preta em jogo em tela cheia exclusiva.
  É exatamente o sintoma que a `fix/tela-preta-ao-assistir` (0.13.1) passou dias caçando.
- **`WebRtcAllowH264Send` desligado** → encode cai pro OpenH264 → volta o "compartilhamento mal
  otimizado" que a 0.13.0 corrigiu.
- **`WebRtcHideLocalIpsWithMdns` volta a ficar ligado** → candidatos ICE saem como nomes
  `.local` em vez do IP da VPN → o P2P pode simplesmente não fechar na LAN virtual.

O comentário em `main.js:45` já manda "ao subir o Electron, reconfirmar" as flags de WGC. Ele
está certo e é insuficiente: o problema não é a flag ter mudado de nome, é o mecanismo de
entrega ter parado de funcionar pra **todas**. **[não verificado]** se `app.commandLine.appendArgument`
escapa da conversão — precisa ser testado antes de virar a correção.

**3. Módulo nativo exige C++20 desde a 33.**

`binding.gyp:17` (`"cflags_cc": ["-std=c++17"]`) e `:24` (`"AdditionalOptions": ["/std:c++17"]`).
A 33 passou a exigir compilação com `--std=c++20`. O projeto tem addon nativo
(`native/src/*.cc`, `node-addon-api@8.9.2`), então isso não é opcional.

**Outras, de baixo impacto, já conferidas:**
- 44 removeu o módulo `clipboard` do renderer. O projeto usa `navigator.clipboard.writeText`
  (`app.js:1989`) e `e.clipboardData` (`ui.js:2443`) — APIs web, não o módulo do Electron. **Seguro.**
- 44 deixou de publicar binários Windows x86. `build.win.target` é só `nsis` sem `arch`, o que
  no electron-builder é x64. **Seguro.**
- 42 moveu o download do Electron do `postinstall` pra primeira execução do bin, e **passou a
  suportar oficialmente o `--ignore-scripts`**, com um script `install-electron` pra baixar sob
  demanda. Isso melhora o cenário de CI, mas **não conserta o P0-1**: `require('electron')` fora
  do runtime continua lançando sem o binário. O conserto do `logger.js` é independente e deve
  vir antes.
- 39 exige `NSAudioCaptureUsageDescription` pro `desktopCapturer` — só macOS. **Não se aplica.**
- 36 depreciou `NativeImage.getBitmap()`; `thumbs.js` usa `toJPEG`/`toDataURL`. **Seguro.**
- 33 marcou `systemPreferences.accessibilityDisplay...` — não usado. **Seguro.**

### Sequência, com pontos de retorno

Cada passo é um commit próprio, na branch `chore/electron-44`. Ponto de retorno = `git revert`
daquele commit sozinho, sem desfazer os anteriores.

| # | Passo | O que testar | Automatizável? | Retorno |
|---|---|---|---|---|
| 0 | **Consertar o `logger.js` (P0-1) e ver o CI verde.** Pré-requisito absoluto: subir Electron com o CI vermelho é subir às cegas. | `npm test` → 728/728; execução do Actions verde | Sim | commit isolado |
| 1 | `npm audit fix` (só o `js-yaml`, **P1-6**) | `npm audit --omit=dev` → 0 | Sim | commit isolado |
| 2 | **Teste do `console-message` antes de tocar na versão.** Extrair o handler de `main.js:516-519` pra `src/main/consolelog.js` (função pura: recebe os argumentos do evento, devolve `{nivel, linha}`) e testar as **duas** assinaturas — a posicional numérica e a de objeto com `level` string. | `npm test`; o handler antigo continua passando | Sim | commit isolado |
| 3 | **Flags de linha de comando com escape.** Envolver `ENABLED_FEATURES` numa função que confirme, em runtime, que a flag chegou (ler `app.commandLine.getSwitchValue('enable-features')` logo depois de escrever e comparar com o esperado), logando **erro** se não bater. Testar com `appendArgument` e decidir a estratégia. | Teste unitário da função de montagem; verificação em runtime vira log | Parcial | commit isolado |
| 4 | `binding.gyp:17,24` → `c++20`; `npm run build:native` numa máquina Windows com MSVC | O `.node` compila; `getOwnPid()` ≠ 0 no app | Não | commit isolado |
| 5 | `package.json`: `"electron": "^44.4.1"`; `npm install`; `npm run lint && npm test` | 728/728, 0 erros de lint, `npm audit` → 0 | Sim | commit isolado |
| 6 | **`npm run dist` + instalar de verdade.** Conferir que `golive_audio.node` está no `app.asar.unpacked` (**P0-3**). | Instalador abre; app sobe | Parcial (CI faz `--dir`) | não mesclar |
| 7 | **Verificação manual, roteiro fechado.** Só isto justifica "verificação manual" — os passos 0-5 não precisam dela. | Ver checklist abaixo | Não | não mesclar |
| 8 | `npm run release:check` e publicação | — | Sim | — |

### Checklist do passo 7 (o que só dá pra ver rodando)

1. **WGC vivo:** abrir com `--enable-logging --v=1` e procurar `WgcCapturerWin` no log
   (`main.js:46-47` já documenta o procedimento). Teste decisivo: compartilhar uma janela de
   jogo em tela cheia exclusiva — GDI devolve preto, WGC devolve imagem.
2. **Encode em hardware:** linha `[diag]` com `enc=hardware` e `msPerFrame` abaixo do orçamento.
3. **mDNS desligado:** o `[signaling]` deve mostrar candidatos ICE com o IP `26.x` da Radmin,
   não nomes `.local`.
4. **Log do renderer legível:** abrir o arquivo de log e conferir que as linhas `[renderer:...]`
   têm nível e mensagem — a validação do passo 2 em campo.
5. **Áudio nativo:** `getOwnPid()` ≠ 0 e captura por processo funcionando.
6. **Sala de 3+ pessoas, 15 min**, com uma queda de VPN provocada — o cenário que a 0.16.0
   não teve ("lançada sem teste em PCs reais", `STATUS.md:269`).

---

## CI/CD proposto

Dois workflows. O primeiro substitui o `test.yml` atual; o segundo é novo, disparado por tag.

### `.github/workflows/ci.yml`

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:

jobs:
  verificar:
    runs-on: windows-latest
    strategy:
      fail-fast: false
      matrix:
        node: ['20', '22']        # (5)
    steps:
      - uses: actions/checkout@v5                      # (1)
      - uses: actions/setup-node@v5
        with:
          node-version: ${{ matrix.node }}
          cache: npm                                   # (2)
      - run: npm ci --ignore-scripts
      - run: npm run lint
      - run: npm test
      - name: cobertura (informativa)                  # (3)
        run: node --test --experimental-test-coverage
        continue-on-error: true

  seguranca:
    runs-on: ubuntu-latest                             # (4)
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22', cache: npm }
      - run: npm ci --ignore-scripts
      - name: producao sem vulnerabilidade
        run: npm audit --omit=dev --audit-level=low    # (6) FALHA o job
      - name: dev (informativo)
        run: npm audit || true                         # (7)

  empacotar:
    runs-on: windows-latest                            # (8)
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22', cache: npm }
      - run: npm ci                                    # com scripts: precisa do Electron
      - run: npm run build:native                      # (9)
      - run: npx electron-builder --win --dir          # (10) sem NSIS, sem publicar
      - name: o addon nativo entrou no pacote?         # (11)
        shell: pwsh
        run: |
          $p = 'dist/win-unpacked/resources/app.asar.unpacked/build/Release/golive_audio.node'
          if (!(Test-Path $p)) { throw "addon nativo ausente do pacote -- ver P0-3" }
```

**Justificativa de cada passo, e o que ele teria pego:**

1. **`actions/checkout@v5` / `setup-node@v5`** — o log da execução #90 traz
   `Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24`.
   As `@v4` estão sendo empurradas pro Node 24 do runner. Trocar agora evita uma quebra futura
   que chegaria junto com outra coisa.
2. **`cache: npm`** — as execuções levam ~40 s hoje, então o ganho é pequeno. Vale porque o job
   `empacotar` (8) é caro e o cache paga ali.
3. **Cobertura informativa** — não como portão (**P1-2** mostra que o número é enganoso), mas
   pra o valor ficar visível no log a cada PR em vez de ser descoberto numa auditoria.
4. **`seguranca` em `ubuntu-latest`** — `npm audit` é consulta de registro, não precisa de
   Windows, e roda em paralelo de graça.
5. **Matriz 20/22** — `engines` diz `>=18` e o CI só testava 20. Node 20 entra em manutenção;
   a 22 é a LTS ativa. Duas versões, não cinco: o projeto não distribui como biblioteca.
6. **`npm audit --omit=dev` como portão que FALHA** — é a métrica que o próprio STATUS elegeu
   como a que importa ("nada disso alcança quem usa o app"). Teria pego o `js-yaml` (**P1-6**)
   no dia em que entrou, em vez de deixar o documento afirmar 0 por semanas.
7. **`npm audit` completo informativo** — não pode ser portão enquanto o Electron 32 estiver lá
   (travaria a `main` por meses), mas o número tem que aparecer em vez de ser estimado de memória.
8. **Job `empacotar`** — o buraco central do CI atual. Teria pego o **P0-3** e teria dado uma
   resposta ao "`npm run dist` nunca foi rodado depois do electron-builder@26" sem custo humano.
9. **`build:native` no CI** — exige o toolchain MSVC, que o `windows-latest` já traz. É o que
   torna o passo (11) possível.
10. **`--dir` em vez de NSIS completo** — pula a compressão do instalador (o caro), mantém o
    empacotamento e o `asarUnpack`, que é onde estão os riscos.
11. **Asserção sobre o conteúdo do pacote** — um build que "passa" sem asserção sobre o
    resultado é teatro. Esta é a única linha que de fato guarda o **P0-3**.

### `.github/workflows/release.yml`

```yaml
name: release
on:
  push: { tags: ['v*'] }

jobs:
  publicar:
    runs-on: windows-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22', cache: npm }

      - name: a tag bate com o package.json?           # (12)
        shell: pwsh
        run: |
          $v = (Get-Content package.json | ConvertFrom-Json).version
          $tag = "${{ github.ref_name }}" -replace '^v',''
          if ($v -ne $tag) { throw "tag $tag != package.json $v" }

      - run: npm ci
      - run: npm run lint
      - run: npm test                                  # (13)
      - run: npm run build:native
      - run: npm run dist -- --publish always          # (14)
        env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }

      - run: npm run release:check ${{ github.ref_name }}   # (15)
        env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```

12. **Tag × `package.json`** — o `git log` tem `chore(release): sync package-lock to 0.10.0` e
    `sync package-lock to 0.9.0`, dois commits que existem só porque a versão saiu de sincronia.
    Três linhas de PowerShell fecham essa classe inteira.
13. **Lint e teste antes de publicar** — hoje nada impede publicar uma tag de um commit
    reprovado. Considerando o **P0-1**, isso não é hipotético: todas as sete últimas o foram.
14. **`--publish always`** — o upload deixa de ser manual. O incidente da v0.10.0 (release sem
    `latest.yml`, derrubando a atualização de **todas** as versões anteriores) foi um erro de
    upload manual, e é a única falha do projeto que atingiu quem não tinha nem baixado nada.
15. **`release:check` como último passo** — o script existe, é bom, tem testes, nasceu desse
    incidente, e **nada o chama**. Aqui ele reprova o job com o release já publicado, o que dá
    o sinal de alarme em minutos em vez de esperar o primeiro amigo reclamar de "não consigo
    verificar a atualização". Combinado com (14), fecha o ciclo.

**O que ainda falta e não cabe em CI:** reversão. Como o `electron-updater` sempre lê o
`latest.yml` do release mais novo, um release ruim exige ação manual. Recomendo um
`npm run release:rollback <tag>` que despublique o release e restaure o anterior como `latest` —
uma tarde de trabalho, e é a diferença entre "20 minutos de sala quebrada" e "sábado à noite
perdido", dado que `version.js` obriga todo mundo a atualizar junto.

---

## Backlog reavaliado

| Item | O que o STATUS afirma | Medido hoje | Veredito |
|---|---|---|---|
| **B1** — Electron 32 → 44 | "Meio dia + verificação manual; flags de WGC e assinatura do `console-message` mudam entre versões" (`:792`) | Alvo 44.4.1 correto. 32 EOL, **33 avisos** no audit. As duas armadilhas citadas são reais; falta uma terceira (**C++20 no `binding.gyp:17,24`**, exigido desde a 33) e o motivo de o custo ser 4-6x maior: as falhas são **silenciosas**, não há erro pra ler | **Continua aberto, com estimativa errada.** 2-3 dias, não meio dia. Plano executável acima |
| **B2** — `npm audit` | "cai a **2** — e as 2 são o `electron@32` e o `extract-zip`"; "`--omit=dev` sempre esteve em **0**" (`:770-773`) | `npm audit` → **3**; `npm audit --omit=dev` → **1** (`js-yaml@4.3.1` via `electron-updater`, alto, alcança produção) | **Parcialmente falso.** A parte de produção é `npm audit fix` sem quebra; o resto depende do B1 |
| **B6** — assinatura de código | "Escolha consciente (app entre amigos); custa certificado e processo" (`:796`) | Concordo com a decisão. Mas **zero** menção a SmartScreen/assinatura no `README.md`, e o updater instala sozinho na abertura sem assinatura verificada. O `digest` SHA-256 já é publicado pelo GitHub em cada asset e ninguém usa | **Decisão mantida, comunicação faltando.** Vira P2-2: uma seção de README e o hash publicado |
| **C4** — `dist/` de 1,2 GB | "higiene de disco local" (`:780`) | `dist/` está no `.gitignore:2` e **não existe neste clone**. Nenhum artefato de build versionado; maior binário versionado é `icon.png` (52 KB) | **Confirmado como não-problema de repositório.** Pode sair do backlog |
| **C5** — branches obsoletas | "3 branches: `claude/backlog-pos-leyjak`, `claude/planejamentos-futuros-projeto-leyjak`, `claude/redesign-discord-style`" (`:781-783`) | **19 branches no remoto; 17 confirmadas mescladas** (`git merge-base --is-ancestor` contra `origin/main`). Mais **2 releases-rascunho órfãos** (`v0.12.6`, `v0.12.7`) | **Aberto e maior que o registrado.** Lista completa em P2-3 |
| **`npm run dist` pós-`electron-builder@26`** | "O 26 muda default de scripts de pacote e nomes de artefato; não dá pra validar sem gerar o instalador" (`:793`) | **Dá pra validar parte sem build:** o bloco `build` foi conferido contra o `scheme.json` do electron-builder 26 — **nenhuma chave desconhecida** entre as 89 aceitas. O `artifactName` hifenizado já está provado em campo (o `v0.16.0` publicado tem os três assets certos). O risco real é outro: **o `.node` some do pacote em silêncio se `build:native` não rodou** | **Reformulado.** A configuração está sã; o risco é o addon ausente (P0-3). Verificável em CI com `--dir` + uma asserção, sem NSIS |

### Novos itens que não estavam no backlog

| Item | Prioridade |
|---|---|
| CI vermelho há 30 execuções desde 2026-09-05; 7 releases publicados por cima | **P0-1** |
| Injeção de comando no PowerShell elevado (`firewall.js:91-94`) | **P0-2** |
| `npm run dist` empacota sem o addon nativo, em silêncio | **P0-3** |
| 58,6% do código sem teste, mascarado por "98% de cobertura" | **P1-2** |
| `room:host` sem trava de reentrância (`main.js:1039`) — servidor órfão | **P1-3** |
| `stopShare` durante o laço de ofertas deixa a sala achando que você está ao vivo (`app.js:3459`) | **P1-4** |
| PIN de 4 dígitos força-brutável (sem contador por IP) | **P1-5** |
| `release:check` existe e nada o chama; sem build nem publicação em CI | **P1-7** |
| `eslint.config.js` perdeu regras do `recommended` (`no-case-declarations` confirmado ausente) | **P2-1** |
| Números do STATUS desatualizados (`:109`, `:770-773`, `:792`) | **P2-4** |
| `README.md:351-357` ainda diz que a sala morre com o host | **P3-1** |

### Dívida que pode ser fechada

- **As 10 promessas soltas do ESLint.** `local/no-floating-promise` encontra **0** ocorrências
  hoje, e confirmei por sonda que a regra continua funcionando (acusa tanto chamada de `async`
  local quanto cadeia `.then` sem `.catch`). O STATUS ainda menciona a dívida; ela está paga.
