# Roteiro: a Mesa com 2+ PCs reais

Data: 2026-09-25. Branch `claude/project-planning-analysis-5e9lub`.
Três pessoas no mínimo (A cria a sala e é o líder; B e C entram). O YouTube e
a Twitch têm roteiro próprio: `2026-09-24-roteiro-youtube-na-mesa.md`.
Deixe "Abrir pasta de logs" à mão: vários passos pedem uma linha do log.

## 1. Vistas de cada um

1. A e B transmitem a tela. Todos na Transmissão: igual à 0.21.
2. C troca para **Mesa**. Só C muda; A e B continuam na Transmissão, sem
   aviso nenhum. C vê as telas de A e B como janelas.
3. C volta para a Transmissão: as telas voltam ao palco **tocando**, sem
   tela preta e sem "reconectando".
4. O número ao lado de "Mesa" no seletor muda quando alguém põe ou tira uma
   janela, mesmo para quem está na Transmissão.

## 2. Mexer juntos

1. B e C na Mesa. B põe uma **Nota** pelo botão direito; C vê "B pôs Nota na
   mesa" e o ponteiro de B com o nome.
2. B arrasta a nota por cima de outra janela e solta: ela desliza para o
   lugar livre mais perto. C vê "B está movendo" durante o arraste e não
   consegue pegar a mesma janela.
3. Setas movem a janela focada (10, com Shift 100), Alt+setas
   redimensionam, `F` tela cheia, `Esc` volta, `Delete` tira da mesa.

## 3. Travas do líder

1. A (líder) abre a Mesa e liga **Travar tamanho** no `⋯`: B move, mas não
   redimensiona.
2. A liga **Só o líder mexe na mesa**: B não põe, tira, move nem
   redimensiona, mas **ainda joga** e usa a nota.

## 4. Jogos e ferramentas

1. B e C sentam num **Xadrez**; A assiste. Lance fora da vez é recusado com
   o motivo. Um lance de B aparece igual para A e C.
2. **Damas**: a captura obrigatória marca as peças; a lei da maioria vale.
3. **Dados**, **Sorteio**, **Roleta**: o resultado é o mesmo nos três PCs.
4. **Cronômetro** regressivo de 1 min: termina no mesmo segundo nos três.
5. B fecha o app no meio da partida: a cadeira dele fica livre, a partida
   continua para quem sentar.

## 5. Desempenho (quem joga)

1. Três telas e uma câmera na Mesa de C. C afasta a vista até uma tela sair
   da tela: 2 s depois o log de C tem
   `[assistir] view-state ... watching=false` e o log de quem transmite
   para de mandar para C. Voltar a vista pede de novo.
2. Com a janela pequena (menos de ~600 px na tela), quem transmite desce a
   resolução para C (painel de estatísticas), não o fps.
3. Arrastar e dar zoom com o jogo aberto: anotar se o jogo engasga.

## 6. Queda do líder com a mesa cheia

1. Mesa com nota, placar e um xadrez no meio da partida. Fechar o app de A
   (ou tirar o cabo).
2. Depois da migração, a mesa volta igual para B e C (as janelas de tela
   voltam quando cada um reanuncia; podem mudar de lugar), e a partida
   continua do mesmo lance.

## 7. Atualização da 0.21

1. Num PC com a 0.21 e tema/nome trocados, instalar esta versão: tema, nome
   e configurações continuam (o app agora abre por `http://localhost`).
2. Log: `origem: file:// -> http://localhost, N chave(s) copiada(s)` uma
   vez só.
