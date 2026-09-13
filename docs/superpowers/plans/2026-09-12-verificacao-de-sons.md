# Verificação de sons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagnosticar e testar os avisos sonoros sem mudar seus gatilhos funcionais.

**Architecture:** Um módulo IIFE puro decide evento e permissão; `sound.js` executa e registra; a UI consome o histórico pela dependência entregue por `app.js`.

**Tech Stack:** JavaScript do renderer, Web Audio API, `node --test`.

## Global Constraints

- Sem dependência nova, sem commit e sem alteração de package.json, STATUS.md ou README.md.
- Módulos do renderer são IIFE, expostos em `window.GoLive` e carregados antes de app.js.
- Comentários de código em português sem acentos; texto de UI em português com acentos.

---

### Task 1: decisões puras de som

**Files:** criar `src/renderer/soundevents.js` e `src/renderer/soundevents.test.js`.

- [ ] Escrever testes que cobrem chat remoto, foco, chat próprio, transições de transmissão, retomada, preferência desligada e intervalo de chat.
- [ ] Rodar `node --test src/renderer/soundevents.test.js` e observar falha por módulo ausente.
- [ ] Implementar `soundForEvent(event, context)` e `shouldPlay(name, state)` com razões estáveis.
- [ ] Rodar o teste isolado e confirmar sucesso.

### Task 2: execução e integração

**Files:** modificar `sound.js`, `app.js`, `index.html`, `ui.js`, `style.css`.

- [ ] Fazer `sound.js` confirmar `AudioContext.running`, registrar as últimas vinte tentativas e agendar sequências no relógio do contexto.
- [ ] Carregar o módulo puro antes de app.js e substituir somente as chamadas de som existentes por suas decisões.
- [ ] Acrescentar teste sequencial e histórico na aba Voz e Vídeo, usando tokens existentes e foco visível.
- [ ] Executar `node --check` em todos os JS tocados, `npm.cmd test` e `npm.cmd run lint`.
