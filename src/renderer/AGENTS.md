# Regras para quem implementa a interface (redesign "Sinal")

A interface do GoLive foi redesenhada do zero. A fonte de verdade de produto e de visual é:

- `docs/redesign-greenfield/05-arquitetura.md` — telas, fluxos, comportamento, teclado (spec congelada);
- `docs/redesign-greenfield/04-design-system.md` — cores, tipos, espaço, forma, movimento, componentes;
- `tools/sinal-prototipo/*.html` — protótipos estáticos: a aparência esperada, com as classes reais;
- `src/renderer/sinal/*.css` — o design system em código.

Regras:

1. **Não invente direção visual.** Se a spec não cobre um caso, use o componente mais próximo de
   `sinal/components.css` e registre a dúvida na resposta. Não copie nada da interface antiga (CSS, estrutura,
   posições); o código antigo serve só para achar eventos, ids e funções.
2. **Só tokens.** Nenhuma cor, fonte, raio, sombra ou duração solta: use as variáveis de `sinal/tokens.css`.
   Vermelho (`--live`) é exclusivamente "ao vivo". Foco, seleção, "assistindo" e "sua vez" usam `--wire`.
   Perigo é `--danger` (laranja).
3. **CSS novo mora em `src/renderer/sinal/`**, um arquivo por área. Nada de sobrescrever regra com
   `!important` (exceção única: `[hidden]` em `base.css`).
4. **A lógica fica.** `app.js` orquestra sessão, rede e mídia; `ui.js` constrói o DOM. Mude o DOM e as ligações,
   não protocolos de rede, sinalização, captura, encoder, WebRTC ou áudio nativo.
5. **Ids são API.** `ids-contrato.json` lista os ids exigidos; ao mudar a estrutura, atualize código e contrato
   juntos, no mesmo diff.
6. **Acessibilidade é requisito**: todo controle alcançável por teclado, foco visível (`--ring`), rótulo
   acessível em botão só de ícone, contexto temporário devolve o foco a quem abriu, Esc fecha o mais recente.
7. **Validação**: `npm test` e `npm run lint` verdes. `node --test` não carrega `app.js`; o boot no Electron
   real é feito por quem integra (a sandbox não abre o Electron). Bancadas Playwright:
   `PLAYWRIGHT_DIR=C:/Users/nicol/Desktop/portfolio-nubinho/node_modules/playwright`.
8. Código: linhas ≤ 120 colunas, comentários em português no estilo do arquivo, sem commit (quem integra commita).
