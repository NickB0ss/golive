# Roteiro manual — novidades de 2026-09-12

Data: 2026-09-12
Escopo: GoLive LAN em 2–3 PCs Windows na LAN virtual (Radmin/Tailscale).
Build: a mesma versão instalada em todos os PCs (a sala recusa versão diferente).

Os testes automáticos (`npm test`) cobrem a lógica de cada frente em módulos
puros. Nada abaixo foi executado em PCs reais ainda: cada item é o que só o app
rodando consegue provar. Anote data, hora, PC e o trecho do log
(`%APPDATA%\golive-lan\logs\golive-<timestamp>.log`) de cada falha.

PCs: **A** cria a sala e transmite, **B** assiste, **C** (opcional) assiste pela
árvore.

## 1. Tela de carregamento e atualização

Precisa de duas releases publicadas no GitHub (a instalada e uma mais nova).

1. Com a versão antiga instalada e a nova publicada, abra o app.
   **Esperado:** a janelinha mostra "Procurando atualizações…", depois
   "Baixando — NN%", "Instalando…", e o app reabre sozinho na versão nova, sem
   perguntar nada.
2. Sem internet (ou com o GitHub fora), abra o app.
   **Esperado:** em ~5 s a tela de carregamento libera e o lobby abre normal.
3. Com o app aberto na versão antiga, clique no botão de buscar atualização.
   **Esperado:** o botão "Atualizar" acende no topo do lobby (cor de ação e um
   pontinho), nunca vermelho. Clique: baixa com progresso e reinicia.
4. Clique em "Atualizar" e, enquanto baixa, entre numa sala.
   **Esperado:** o download termina e o app **não** fecha. Ao sair da sala, o
   botão está pronto; o clique instala sem baixar de novo.
5. Dentro da sala, confirme que o botão "Atualizar" não aparece.
6. `npm start` (desenvolvimento): a tela aparece por um instante e libera.
7. Abra o app duas vezes rápido: a segunda tentativa só traz a janela
   existente pra frente.

## 2. Transferência de sala (host cai ou sai)

Três PCs: A cria a sala, B e C entram; B transmite a tela.

1. **Saída graciosa:** A clica "Sair da sala" (ou fecha o app).
   **Esperado:** aparece "Anfitrião saiu. <nome> está assumindo a sala…"; em
   segundos B e C estão de novo na mesma sala (servidor agora no sucessor), a
   tela de B continua aparecendo sem precisar clicar em nada, o PIN (se havia)
   continua valendo, o chat anterior continua lá e os banidos continuam banidos.
2. **Queda:** repita, mas encerre o processo de A pelo Gerenciador de Tarefas.
   **Esperado:** depois de a reconexão se esgotar, a sala se recupera sozinha
   no sucessor. Limitações conhecidas nesse caso: a lista de banidos se perde,
   e se o dono era uma terceira pessoa (nem o host nem o sucessor), a
   liderança vai para o sucessor.
3. Alguém de fora entra depois da migração pela lista de salas / endereço novo
   (com PIN, se havia). **Esperado:** entra normal.
4. Primeira vez que um PC vira sucessor: observe se o Windows pede permissão de
   firewall e se o botão "Permitir acesso à rede" resolve.

## 3. Trocar a fonte sem parar a transmissão

A transmite; B assiste; C assiste pelo relay (árvore).

1. A clica "Trocar" e escolhe outra tela. **Esperado:** B e C veem a nova
   tela sem clicar em nada, sem tela preta longa.
2. Tela → janela, e janela → tela. **Esperado:** a imagem troca; o som segue
   a fonte nova no mesmo modo escolhido. Se o som só da janela não puder ser
   capturado, aparece um aviso e a transmissão segue **sem som** — nunca com o
   som do sistema inteiro.
3. Com a transmissão **pausada**, troque a fonte e force uma reeleição do relay
   (feche o app de B enquanto C assiste). **Esperado:** nada da tela nova
   aparece para ninguém enquanto estiver pausado.
4. Com o rabisco permitido, troque de uma tela para outra. **Esperado:** o
   overlay de rabisco passa para o monitor novo.
5. Clique "Trocar" e pare de compartilhar antes de escolher. **Esperado:** nada
   fica capturando em segundo plano (luz/ícone de captura some).

## 4. Ponteiro laser e reações

A transmite com "Deixar a sala rabiscar" ligado; B assiste.

1. B escolhe Laser na barra do tile e move o mouse. **Esperado:** o ponto
   aparece no tile de quem assiste e na tela real de A (por cima do jogo em
   janela sem borda) e some ~1 s depois de parar.
2. B usa as reações. **Esperado:** o emoji sobe e some no tile e na tela real
   de A. Seis cliques rápidos: o excesso é descartado.
3. Windows com "Mostrar animações" desligado: as reações aparecem e somem sem
   subir.
4. B sai da sala com laser/reação visível: somem na hora.
5. A transmite **sem** a permissão: reações aparecem só nos tiles; nada na tela
   real de A.

## 5. Notificação "ficou ao vivo" e janela espiar

1. B minimiza o GoLive; A começa a transmitir. **Esperado:** notificação do
   Windows "<A> ficou ao vivo"; clicar traz o app e o tile de A. Parar e voltar
   rápido não gera outra notificação em seguida.
2. B entra numa sala onde alguém já está ao vivo: nenhuma rajada de avisos.
3. B, botão direito no tile de A → "Espiar". **Esperado:** janelinha sem
   moldura, sempre no topo, arrastável e redimensionável, por cima de um jogo em
   **janela sem borda**. Espiar outro tile troca o vídeo na mesma janela.
4. A para de transmitir (ou sai): a janela espiar fecha.
5. Feche e reabra o app: a espiar volta na mesma posição/tamanho.
6. Limitação esperada: jogo em **tela cheia exclusiva** não deixa nada ficar por
   cima.

## 6. Sons

1. B com o GoLive **minimizado**; A manda mensagem no chat. **Esperado:** som
   de chat, e no log de B a linha `[som] chat: tocou (contexto=running)`.
2. B com o GoLive **em foco**; A manda mensagem. **Esperado:** sem som, e no log
   `[som] chat: pulado (janela em foco)`.
3. A começa e para de transmitir. **Esperado:** sons de "ao vivo" e "parou" em B,
   com as linhas `[som]` correspondentes.
4. Configurações > Voz e Vídeo > "Testar sons": toca cada aviso com o nome
   aparecendo; "Últimos sons" mostra tocou/pulado/não tocou e o motivo.
5. Qualquer `[som] ... NAO tocou (...)` no log é bug: guarde o log.
