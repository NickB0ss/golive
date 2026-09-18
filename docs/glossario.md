# Glossário — um termo por conceito

Nasce do achado da auditoria de 2026-09-18 (anexo 2 · Interface): o papel de
quem manda na sala tinha **quatro** nomes na interface ("dono", "líder",
"host", "anfitrião"), três deles em mensagens de erro — o momento em que a
pessoa menos quer decifrar sinônimo. Este arquivo fixa um termo por conceito;
`src/renderer/glossario.test.js` reprova os proibidos em string visível.

| Conceito | Termo | Nunca use |
|---|---|---|
| A sala em si | **sala** | — |
| Quem manda na sala (pode moderar, migra em queda) | **líder da sala** (ação: "passar a liderança") | dono, host, anfitrião |
| O que sai da sua máquina pra sala | **transmissão** | — |
| O que aparece num tile | **tela** | — |
| Estar vendo uma transmissão | **assistir** / **quem está assistindo** | espectador |
| Desenhar por cima de uma tela | **rabisco** / **rabiscar** | anotação |
| Encerrar a própria conexão com a sala | **Sair da sala** (rótulo real do botão) | desconectar |
| Qualquer pessoa na sala | **pessoa** | membro, participante, peer |

**Por que "líder da sala" e não "dono da sala".** A auditoria original
recomendou "dono" por já estar na coroa do ícone. Uma contagem com `rg` nas
strings visíveis atuais (pós-0.17.0) mostra o oposto: "líder"/"liderança"
aparece 5 vezes (toast de troca de comando, item de menu, título e botão da
confirmação) contra 2 de "dono da sala" (só a coroa), 2 de "anfitrião" e 1 de
"host" — o vocabulário já migrou pra "líder" no fluxo mais usado (transferir o
comando), e padronizar nele exige trocar menos strings do que o inverso.
