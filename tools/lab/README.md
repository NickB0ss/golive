# Laboratório automatizado (H15)

Várias instâncias do app na mesma máquina Linux, cada uma no seu Xvfb, com
captura de tela falsa (um canvas animado) e falhas de rede de verdade
(`iptables` no UDP de entrada). Ver a H15 de
`docs/2026-09-23-analise-transmissao-hipoteses.md`.

**O que testa:** a orquestração inteira — sala, árvore com relay,
migração quando o líder cai, vigia de congelamento, diagnóstico, reinício de
ICE, avisos no tile —, que é onde mora a maioria das telas pretas do
histórico.

**O que não testa:** encoder de hardware (NVENC/AMF), captura WGC do Windows,
Radmin/Tailscale de verdade e PCs em redes diferentes. Isso continua sendo a
noite de teste com 2+ PCs.

## Rodar

```sh
node node_modules/electron/install.js   # uma vez, se o npm ci foi com --ignore-scripts
npm run lab                             # todos os cenários
npm run lab -- queda-curta origem-parada
npm run lab -- --listar
```

Precisa de Linux com `Xvfb`. Os cenários marcados `(rede)` precisam de
`iptables` como root ou com `sudo -n`, e **cortam o UDP de entrada da
máquina inteira** (menos DNS) por alguns segundos: só o loopback não basta,
porque com STUN respondendo a mídia acha outro caminho pela internet. Numa
máquina de uso diário, isso engasga chamada e jogo enquanto o cenário roda.

Logs, linha do tempo e prints (na falha) ficam em `lab-out/<cenário>/`; o
resumo, em `lab-out/resumo.txt`. Quando um cenário falha, as últimas linhas
de sinalização, malha e vigia de cada instância saem também no terminal (e
no log do job da CI).

Um cenário falha se uma verificação falhar **ou** se qualquer instância
registrar erro não tratado (`Uncaught ...`, `unhandledRejection no main`),
mesmo com as verificações passando.

## Cenários

| Cenário | O que prova |
|---|---|
| `sala-basica` | 4 PCs; a árvore monta um relay e todos seguem com a tela andando; C6, D1, D6 e as linhas `[rota]` |
| `queda-curta` | 9 s sem UDP: quem transmite reinicia o ICE na mesma conexão (C5), a imagem volta e ninguém refaz a conexão |
| `queda-longa` | 15 s sem UDP: diagnóstico "rede", "Sem contato com o PC de Ana" no tile, o vigia segura a reoferta e a mesma conexão volta pelo reinício de ICE |
| `origem-parada` | a captura congela: diagnóstico "origem", "Ana parou de enviar imagem", e o aviso sai quando ela volta |
| `perda-udp` | 3% de perda por 20 s: a imagem segue e ninguém refaz a conexão por engano |
| `lider-cai` | o PC de quem criou a sala morre (SIGKILL): os outros migram e o vídeo entre eles continua |
| `sala-de-6` | 6 PCs: a origem manda pra 2 relays (2 encoders, não 3), cada um repassa, a topologia fica parada; um relay cai e as órfãs voltam sem mexer nas folhas do outro |

## Escrever um cenário

Um arquivo em `cenarios/` exportando `{ nome, descricao, precisaRede?, timeoutMs?, permitidos?, rodar(lab) }`.
`lab.abrir(['Ana', 'Beto'])` sobe as instâncias (em paralelo) e devolve
objetos com as ações do app (`criarSala`, `entrar`, `transmitir`,
`pararOrigem`, `esperarImagemAndando`, `avisoNoTile`, `esperarLog`,
`derrubar`...); `lab.rede` corta ou degrada o UDP; `lab.verificar`,
`lab.igual` e `lab.contem` registram cada conferência na linha do tempo.
O driver (`driver.js`) não sabe nada de cenário: só executa comandos
dentro do app.

Espere o vigia ver a imagem (uns 5 s depois dela andar) antes de provocar
uma falha: ele olha a cada 2 s, e uma falha antes disso vira "nunca mostrou
imagem", não "congelou".
