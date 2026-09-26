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
| Os dois jeitos de ver a sala, que cada pessoa escolhe para si | **vista**: **Transmissão** e **Mesa** | modo, tipo da sala, layout, canvas |
| O que se põe na Mesa | **janela** ("janela na mesa" quando puder confundir) | widget, card, item |
| Pôr / tirar uma janela | **Adicionar janela** / **Tirar da mesa** | inserir, fechar, remover |
| Ocupar a tela toda com uma janela | **Tela cheia** | maximizar |
| Para onde você olha dentro da Mesa | sem nome na interface: os botões dizem **Ver tudo** e **Ir até** | câmera (é a webcam), viewport |

### A Mesa (2026-09-24)

Termos da spec `docs/superpowers/specs/2026-09-24-sala-em-dois-modos-design.md`
(seção 9), já com a decisão de que Transmissão e Mesa **não são um tipo da
sala trocado pelo líder**: são **vistas**, e cada pessoa alterna a sua sem
mudar a de ninguém (contrato da Mesa, seção 0). Por isso "tipo da sala" entrou
na coluna do "nunca use".

"Vista" fica reservada para Transmissão e Mesa. Para onde você olha dentro da
mesa (andar, aproximar) não ganha substantivo na interface: os controles dizem
o que fazem ("Ver tudo", "Ir até Bia").

"Janela" também é o que se escolhe no seletor de fonte ("Telas | Janelas").
Os dois vivem em lugares que não se cruzam (diálogo de compartilhar × Mesa), e
quando o texto puder confundir ele diz qual é ("janela na mesa").

**Por que "líder da sala" e não "dono da sala".** A auditoria original
recomendou "dono" por já estar na coroa do ícone. Uma contagem com `rg` nas
strings visíveis atuais (pós-0.17.0) mostra o oposto: "líder"/"liderança"
aparece 5 vezes (toast de troca de comando, item de menu, título e botão da
confirmação) contra 2 de "dono da sala" (só a coroa), 2 de "anfitrião" e 1 de
"host" — o vocabulário já migrou pra "líder" no fluxo mais usado (transferir o
comando), e padronizar nele exige trocar menos strings do que o inverso.
