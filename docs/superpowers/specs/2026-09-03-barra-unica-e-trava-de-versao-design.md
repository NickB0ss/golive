# Barra única do lobby e trava de versão de sala — design

Data: 2026-09-03. Sucede
[`2026-09-03-lobby-v2-e-acabamento-design.md`](./2026-09-03-lobby-v2-e-acabamento-design.md)
(lançado na 0.5.0) e não reabre nada dele: as duas colunas do corpo, a
paleta, a densidade e o motion continuam valendo palavra por palavra. Esta
passada mexe em **duas coisas pequenas vindas do uso**, uma de layout e uma
de protocolo.

## 1. Os dois problemas

**(a) O lobby tem duas molduras horizontais e dois botões de Configurações.**
A 0.5.0 desenhou três faixas: topbar (marca + versão + buscar atualização +
Configurações), corpo, e barra do usuário no rodapé (avatar + apelido +
Configurações **de novo**). Numa tela que cabe inteira sem rolagem, isso é
uma faixa a mais e um botão duplicado — a mesma ação em dois lugares faz
quem usa parar pra decidir qual dos dois é "o certo".

E os controles da topbar não estão no canto: ela compartilha o
`.lobby-bounds` (máximo de 1120px, centrado) com o corpo, então numa janela
de 1600px o botão de Configurações fica parado a ~240px da borda direita,
sem nada à direita dele. Lê como um elemento solto no meio da tela, não como
o canto da janela.

**(b) Dá pra entrar numa sala de outra versão do app — e quebra feio.** O
protocolo de sinalização (campos do `join`, `welcome`, `tree`, `view-state`),
o formato da árvore de retransmissão e a negociação P2P mudam de release em
release **sem nenhum acordo de compatibilidade**: nada no protocolo carrega
versão, nada degrada. Duas máquinas em versões diferentes na mesma sala não
dão erro — dão sintoma: tile que nunca abre, chat que não chega, árvore que
não fecha, estatística zerada. Todos parecem problema de rede, e é o que a
pessoa vai investigar (firewall, Radmin, porta) antes de desconfiar da
versão.

## 2. Princípios

> **Um lobby, uma barra, um botão por ação.**

> **A sala é do app que a criou.** Quem não está na mesma versão não entra —
> e é dito com todas as letras antes do clique, não depois.

## 3. Layout: a barra do usuário some dentro da barra do topo

A faixa do rodapé é absorvida pela do topo, que passa a ir **de borda a
borda da janela**:

```
┌──────────────────────────────────────────────────────────────────────┐
│ [GL] GoLive LAN v0.5.0        (avatar) apelido   [↓ atualizar] [⚙]  │  56px
├──────────────────────────────────────────────────────────────────────┤
│      ┌──────────── corpo, ainda centrado em 1120px ────────────┐     │
```

Decisões:

- **A barra não usa `.lobby-bounds`.** O corpo continua num container de
  leitura de 1120px centrado; a barra tem `width: 100%` e `padding: 0
  var(--s-4)`. É a distinção normal de app shell: cromo encosta na janela,
  conteúdo se centra.
- **Avatar + apelido ficam no par da direita**, encostados nos dois botões de
  ícone, e os dois abrem Configurações > Perfil (mesmo handler de antes). O
  apelido **não estica** (`flex: none`, `max-width: 200px`, elipse) — com
  `flex: 1`, como na barra antiga, ele empurraria os botões pra longe da
  borda, que é exatamente o defeito que estamos corrigindo. Abaixo de 1040px
  de janela o teto cai pra 120px.
- **`#btn-open-settings-2` deixa de existir**, e com ele a classe `.icon-btn`
  (ficou sem nenhum elemento; varrida junto, igual à limpeza de CSS morto da
  0.4.0).
- `.lobby` passa de três linhas de grade pra duas. Nada no corpo muda.

## 4. Trava de versão

### 4.1 Onde ela mora

No **servidor de sinalização**, no `join` — o mesmo ponto do PIN e do ban.
É o único lugar que decide de verdade: a lista da rede e o card são
conveniência, e um cliente adulterado não passa por eles de qualquer jeito.

`createSignalingServer({ appVersion })` recebe a versão de quem hospeda
(`app.getVersion()`, do `package.json`). No `join`:

| Ordem | Checagem | Motivo da ordem |
|---|---|---|
| 1 | banido | quem foi banido não descobre nem o PIN nem a versão |
| 2 | **versão** | não adianta acertar o PIN numa sala que o seu app não sabe conversar |
| 3 | PIN | como antes |

Recusa = `{ type: 'join-denied', reason: 'version', hostVersion, yourVersion }`
seguida de `close(1008, 'version')`, espelhando o PIN. As **duas** versões
voltam porque é o que permite ao cliente dizer quem precisa atualizar.

Regra: **igualdade exata**, normalizando espaço e um `v` na frente. Não é
"no mínimo a versão da sala": um app mais novo entrando numa sala velha
quebra igual. Cliente que não manda `appVersion` (release anterior a esta,
ou cliente adulterado) é recusado com `yourVersion: null`.

`appVersion` ausente na criação do servidor **desliga** a checagem — é o
default, e é o que mantém os testes de protocolo escrevendo `join` sem
carregar versão em toda mensagem. O app sempre passa a versão.

### 4.2 O que o app faz com isso

- **Antes do clique:** a versão de quem hospeda entra no beacon UDP
  (`formatBeacon`/`parseBeacon`/`toRoomList`), e o card da sala incompatível
  fica apagado, sem clique, com um selo âmbar `v0.7.0 · atualize` (ou
  `· desatualizada`, quando o velho é o outro) e a linha de baixo trocando o
  endereço pela frase inteira. O card **não some** da lista: sala do amigo
  que some sem explicação vira "meu app não acha a sala dele".
- **Depois da recusa:** `reason === 'version'` é o único `join-denied` que
  **não reabre** o diálogo de entrar — não há PIN nem endereço pra corrigir,
  tentar de novo agora dá a mesma recusa. Vai pro erro do lobby + toast de 8s,
  e o botão de buscar atualização está a um clique dali, na mesma barra.
- **Beacon sem versão** (uma release antiga anunciando) não é marcado na
  lista: aí a recusa vem do servidor, com a mensagem certa.

### 4.3 Quem redige o aviso

`src/renderer/version.js` (`GoLive.version`), módulo puro no padrão dos
outros do renderer, com `parse`/`compare`/`same`/`mismatchText`/`mismatchBadge`.
`compare` existe por um motivo só: decidir a **direção** ("atualize o seu" vs
"quem criou é que precisa atualizar"). Comparação numérica por componente,
porque `'0.10.0' < '0.9.0'` como string. Versão ilegível devolve `null` em
vez de chutar direção — a mensagem vira a neutra ("todo mundo precisa estar
na mesma versão").

## 5. O que NÃO muda

- Nada de negociação de versão ou modo de compatibilidade: a regra é igual,
  não "compatível o bastante".
- Nada no palco, na sala, no chat, na moderação ou no transporte.
- O PIN, o ban e o `ownerToken` seguem exatamente como estão — a trava de
  versão é uma quarta porta, não uma troca de fechadura.
