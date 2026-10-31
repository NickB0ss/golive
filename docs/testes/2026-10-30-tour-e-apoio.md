# Tour inicial e Ajuda e apoio — 30/10/2026

Entrega da **0.28.0**, preparada sobre a base publicada **0.27.0**. A tag
`v0.28.0` aciona o workflow que gera instalador, blockmap e `latest.yml`.

Validação após incorporar a base **0.27.0**: **2.467 testes passaram**, lint
com zero erros e oito avisos preexistentes, smoke oficial aprovado e roteiro
de interação no Electron real aprovado em 960×600.

A validação anterior, sobre a 0.26.0, teve 2.465 testes aprovados e o roteiro
de interação passou em 960×600 e 1440×900. Reiniciar o perfil de teste manteve o tour pulado.
Foram inspecionados os diálogos em português, inglês e espanhol, nos temas
escuro e Sinal claro; ajuda dentro da sala conferida com estado de UI
simulado em 900×600. Os destinos externos foram conferidos no código e na
resolução por identificador; não foi feito envio de formulário nem doação.

## Base sincronizada com o GitHub

A implementação inicial usou a branch `fix/tela-parada` em `8d24bfa`, sete
commits atrás do `origin/main`. O último release publicado foi confirmado
pela API oficial como `v0.27.0`, e a tag resolve para o mesmo commit do
`main`: `2294bb87fd250e5b8b4dc645fd925c9b7839d3e4`.

O trabalho foi preservado por backup e stash com escopo explícito e reaplicado
sem conflitos na branch `codex/ajuda-tour-027`, criada sobre esse commit.
As correções de relay da 0.27 e os manifests permaneceram iguais ao upstream;
a diferença em `app.js` é apenas a inicialização da ajuda/tour ao fim do boot.
O backup local está em `lab-out/community/migration-027` (cópias de testes
têm sufixo `.bak` para não entrarem na descoberta do `node --test`). O stash
de segurança também foi mantido. A integração preservou a branch anterior.

A regra de consultar o GitHub antes de alterar projetos foi adicionada ao
`C:\Users\nicol\.codex\AGENTS.md` global.

Durante a validação apareceu um falso positivo intermitente já existente no
teste de segredo do Desenha: a palavra sorteada `mesa` coincidiu com o tipo
de mensagem `mesa-viewers`. O teste isolado passou e a execução final da
suíte passou. O teste e o jogo não foram alterados nesta integração.

Os dados vêm de `F:\ProjetosGit\golive-site\apoie.html` e do rodapé do site:
Pix `6d947798-9d1e-4af9-8a4c-2c11123752c7`, PayPal com destinatário
`ZZM3JAT2YKVVC` em BRL e Forms `https://forms.gle/ym5yB2bbbwip9ypm7`.
O app mantém uma cópia desses dados em `src/shared/comunidade.js`.

## Verificação automatizada

- `npm test`: suíte completa, incluindo persistência/conclusão/pulo do tour,
  armazenamento indisponível, links fixos, origem local, idiomas e contrato de IDs.
- `npm run lint`: sem erros; os avisos existentes de `require-atomic-updates`
  em `main.js` e `app.js` continuam.
- `npm run smoke:app`: boot da página real, preload e addon, com perfil temporário.
- Interação no Electron real, com perfil novo e separado:

```powershell
node tools/sinal-boot/rodar.js lab-out/community/perfil-novo tools/sinal-boot/comunidade.js 960x600
```

Use um diretório de saída novo a cada execução: o roteiro exige a primeira
abertura. A pasta guarda perfil, `boot.json` e `boot.png`. O roteiro verifica
avanço, retorno, conclusão, replay, Esc, persistência, contenção/devolução de
foco, bloqueio dos atalhos do fundo, cópia/erro do Pix e recusa de URL arbitrária
pelo IPC. A cópia usa um substituto temporário de `clipboard.writeText` para
preservar a área de transferência real.

## Conferência manual para distribuição

1. Abrir uma instalação sem a chave local `golive:tour:v1`: tour automático.
2. Concluir ou pular e reiniciar: o tour não reaparece. Fechar a janela inteira
   antes de concluir ou pular mantém o tour pendente para a próxima abertura.
3. Abrir Ajuda e apoio no início e numa sala. Rever o tour e fechar: o app volta
   ao controle anterior, sem entrar/sair de sala ou iniciar captura.
4. Copiar o Pix e conferir a chave. Abrir o formulário e o PayPal no navegador;
   conferir os destinatários antes de qualquer envio ou doação.
5. Conferir pt-BR, inglês e espanhol, Sinal e Sinal claro, janela mínima
   (900×600) e 1440×900, teclado e escala de texto ampliada.

Links externos são acionados apenas por clique; a validação não envia
respostas ao formulário nem faz doações. Rede/mídia não mudaram nesta entrega.
