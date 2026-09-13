# Roteiro manual — tela preta ao passar a assistir outra tela (hotfix 0.13.1)

Data: 2026-09-12
Escopo: 3 PCs Windows na LAN virtual, todos na mesma versão (0.13.1).
Spec: `docs/superpowers/specs/2026-09-12-tela-preta-ao-assistir-design.md`.

PCs: **A** e **B** transmitem a tela; **C** assiste. Anote horário e guarde o
log dos três (`%APPDATA%\golive-lan\logs\golive-<timestamp>.log`).

## 1. Troca de tela assistida (o relato)

1. A e B transmitindo; C assiste A.
2. C clica em "Assistir" na tela de B.
   **Esperado:** a imagem de B aparece em até ~2 s.
   **Se ficar preta:** em ~6–8 s deve aparecer no log de C
   `[assistir] tela de B ... sem imagem ha 6s ... pedindo pra refazer a
   conexao`, e no log de quem serve B (B, ou o relay) `[assistir] #C pediu
   para refazer ...: refeito`. A imagem volta sozinha; no log de C,
   `voltou a mostrar imagem depois de 1 tentativa(s)`.
3. Repita trocando A ↔ B várias vezes, inclusive rápido.

## 2. Depois de queda de rede

1. Com C assistindo A, derrube a rede de C por ~10 s e volte (retomada).
2. C passa a assistir B. **Esperado:** imagem de B; se não, a autocura acima.

## 3. Tela parada não dispara

1. B deixa a área de trabalho parada (nada mudando) por 1 min; C assiste B.
   **Esperado:** nenhuma linha `sem imagem` no log de C depois que a primeira
   imagem apareceu.

## 4. Câmera ligar/desligar (o empilhamento provado)

1. A liga a câmera; C vê. A desliga e religa a câmera 3 vezes.
   **Esperado:** C vê a câmera nova toda vez, sem tile preto.

## O que mandar se ainda der errado

O trecho do log de C com as linhas `[assistir]` e o de quem serve a tela
(`[assistir] demanda de ...` mostra quantos canais de vídeo a conexão tem e
se estão com track).
