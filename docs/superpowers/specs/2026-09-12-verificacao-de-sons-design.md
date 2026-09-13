# Verificação de sons — desenho

## Objetivo

Tornar audível e diagnosticável cada aviso sonoro do GoLive LAN sem alterar quando os avisos existentes devem ocorrer.

## Decisão

`soundevents.js` concentra duas decisões puras: o som associado a cada evento e se ele deve tocar. O segundo resultado sempre carrega uma razão legível para o log. `app.js` conserva os gatilhos de entrada, saída, chat, moderação e transição de transmissão, delegando apenas a escolha ao módulo.

`sound.js` confirma que o `AudioContext` está em `running` antes de criar os osciladores. Falha de retomada, contexto que não volta em até um segundo e preferência desligada entram no histórico limitado a vinte registros e no console com o prefixo `[som]`. Sequências usam o tempo do contexto, para que o segundo blip não dependa de temporizadores da janela oculta.

Na aba Voz e Vídeo, o teste reproduz todos os sons em sequência e exibe o nome atual. A lista curta de tentativas é atualizada ao abrir as configurações e após cada tentativa.

## Comportamento preservado

- Chat próprio não produz som.
- Chat recebido com a janela em foco não produz som, pois já está visível.
- Chat permanece limitado a um aviso a cada dois segundos.
- `broadcast-state` só avisa ao vivo/parou em transições; estado inicial e retomada não repetem som.

## Fora de escopo

Não há alteração de saída de áudio, protocolo de sinalização, dependências, preferência persistida nem temporizadores globais do Electron.
