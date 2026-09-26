# Roteiro manual — origem local, YouTube e Twitch (fase 0 da Mesa)

Data: 2026-09-24
Escopo: 1 PC Windows com internet (o do dono), depois 2+ PCs para a parte da
sala. Resultado do spike: `docs/2026-09-24-spike-origem-local.md`.

O que mudou: a janela principal e a Espiar passam a abrir por
`http://localhost/index.html` (servido pelo próprio app, **sem porta
aberta**) em vez de `file://`. Na primeira abertura depois da atualização, o
app copia o `localStorage` do `file://` para a origem nova (nome, tema,
configurações, `clientId`). Splash e rabisco continuam em `file://`.

Log: `%APPDATA%\golive-lan\logs\golive-<timestamp>.log`.
Registro da origem: `%APPDATA%\golive-lan\origem.json`.

## 1. Configurações preservadas na atualização (o mais importante)

1. Com a versão **anterior** instalada (0.21.0), mude coisas visíveis e
   anote: nome, tema (ex.: **Papel**), um tema personalizado salvo, qualidade,
   volume/áudio, emojis recentes (use 2–3 emojis no chat).
2. Feche o app. Instale a versão nova e abra.
   **Esperado:** tudo igual ao anotado, já na primeira tela (sem piscar o
   tema padrão). No log:
   `origem da janela principal: http://localhost` e
   `origem: file:// -> http://localhost, 1 chave(s) copiada(s)`.
   `origem.json` contém `{"origem":"http://localhost"}`.
3. Feche e abra de novo. **Esperado:** nenhuma linha `origem: file:// ->` (a
   cópia é uma vez só) e tudo continua igual.
4. Mude o tema para outro, feche, abra. **Esperado:** o tema novo ficou (a
   cópia não trouxe o antigo de volta).
5. Entre numa sala em que você é conhecido (moderação, nome). **Esperado:** o
   app se apresenta com o mesmo `clientId` de antes (os outros veem você
   como a mesma pessoa, sem duplicata).

**Se algo sumiu:** mande o log da primeira abertura (a linha `origem:` diz
quantas chaves foram copiadas ou por que falhou) e o `origem.json`. Os dados
antigos do `file://` **não foram apagados**; veja a seção 4 para voltar.

## 2. YouTube e Twitch no Electron do app (o spike de verdade)

Numa cópia do repositório no PC, com internet:

```powershell
npm ci
npx electron tools/spike-youtube/main.js
```

Abrem duas janelas: **A** (`file://`, como até a 0.21) e **B**
(`http://localhost` sem socket, como a versão nova). Cada uma tem um player
do YouTube (`youtube-nocookie`, mudo) e um da Twitch (`parent=localhost`).
Depois de ~15 s o terminal imprime um resumo por janela.

**Esperado:**
- **A:** erro 153 dentro do player ("Erro de configuração do player") ou
  `onReady: false`; a Twitch mostra erro de `parent`.
- **B:** `onReady: true`, `estados` passa por `1` (tocando), `tempoMax`
  sobe, `erros: []`. O vídeo toca na janela. A Twitch toca o canal
  (`twitchgaming`, ou `SPIKE_CANAL=<canal ao vivo>`).
- Nenhuma linha `CSP ...` em `erros` (a CSP é a mesma do `index.html`).

Outro vídeo: `$env:SPIKE_VIDEO='<id>'` antes do comando. Teste também um
vídeo com embed bloqueado pelo dono (espera-se `erros: [101]` ou `[150]`,
não 153: isso é do vídeo, não do app).

**Se B der 153:** anote o resultado e rode de novo com o DevTools aberto
(Ctrl+Shift+I na janela B → aba Network → pedido `embed/...` → Request
Headers). O `Referer` deve ser `http://localhost/`. Mande o print.

## 3. O app continua funcionando na origem nova

Com a versão nova, em 2 PCs:

1. Criar sala, entrar pelo endereço, transmitir a tela, assistir.
2. Câmera: ligar/desligar.
3. Chat: mandar texto, colar uma imagem, emoji.
4. Espiar: abrir, voltar para o app pelo botão.
5. Rabisco na tela real (overlay) e laser.
6. Áudio "incluir o som do Discord" (worklet de áudio).
7. Botão "Atualizar"/busca manual de atualização.
8. Fontes (Outfit/Work Sans) e ícones carregando.

**Esperado:** tudo como na 0.21. No log, nenhuma linha
`origem local: 404 ...` durante o uso normal (404 só aparece se alguém pedir
arquivo que não existe).

## 4. Reserva: voltar ao `file://`

Se a origem nova der problema no PC real:

```powershell
$env:GOLIVE_ORIGEM='file'; & "$env:LOCALAPPDATA\Programs\golive-lan\GoLive LAN.exe"
```

**Esperado:** o app abre por `file://` com os dados mais recentes (log:
`origem: http://localhost -> file://, 1 chave(s) copiada(s)`). Abrir de novo
sem a variável volta para `http://localhost`, também com os dados mais
recentes. YouTube e Twitch não funcionam nesse modo.

## 5. Vídeo, Rádio e Ao vivo na Mesa (time Mídia)

Resultado aqui (contra um YouTube falso): `docs/2026-09-24-midia-na-mesa.md`.
Falta o YouTube e a Twitch de verdade.

### 5.1 Bancada automática com o YouTube real (1 PC, 3 minutos)

```powershell
npm ci
$env:GOLIVE_MIDIA_REAL='1'; npx electron tools/midia/main.js
```

Abrem duas janelas ("PC A" e "PC B") na mesma sala de um servidor local,
cada uma com os conteúdos reais. O terminal imprime `ok`/`FALHOU` por item e
o caminho de um relatório JSON.

**Esperado:** `ok` em "load em A: os dois tocando", "5 s tocando", "pausa no
B", "salto para 1:00", "segundo YouTube entra em espera", "Tocar este",
"tirar o ativo". As verificações de deriva, sandbox e "sem internet" só
existem no modo falso (não aparecem). Mande o JSON.

### 5.2 Na sala de verdade (2 PCs)

1. Abra a Mesa nos dois. No A: `+` → **Vídeo do YouTube** → cole um link
   (`https://youtu.be/<id>?t=30`). **Esperado:** toca nos dois, a partir de
   0:30, em até ~1 s; a diferença entre os dois PCs a olho/ouvido é menor
   que meio segundo.
2. Pause no **B**. **Esperado:** pausa no A também, no mesmo quadro. Toque no
   A: volta nos dois.
3. Arraste a barra de posição no B. **Esperado:** os dois pulam juntos.
4. Volume e mudo no A. **Esperado:** só o A muda.
5. Deixe tocando 5 minutos. **Esperado:** sem soluços nem pulos visíveis (a
   correção é por velocidade 1,05/0,95, imperceptível). Se pular de tempos
   em tempos, anote: pode ser o YouTube arredondando a velocidade.
6. Ponha um **segundo** vídeo do YouTube na mesa. **Esperado:** ele aparece
   com a capa e "Tocar este" (não toca junto). Clique: o primeiro vai para a
   capa. Tire o segundo: o primeiro volta sozinho, no ponto certo.
7. Clique no logo/título do YouTube dentro do player. **Esperado:** abre o
   navegador padrão no vídeo; o app não abre janela nenhuma.
8. Cole o link de um vídeo com embed bloqueado. **Esperado:** "O dono deste
   vídeo não deixa tocar fora do YouTube." (erro 101/150, **não** 153).
9. **Rádio da sala:** ponha 3 músicas (uma do YouTube Music, uma com embed
   bloqueado, outra qualquer). **Esperado:** capa e título aparecem; toca
   nos dois; a bloqueada é pulada com o aviso; "Pular" só para quem pôs (ou
   o líder); os outros veem "Votar para pular (n/m)" e a maioria pula.
10. **Ao vivo:** `+` → **Ao vivo (Twitch)** → `https://www.twitch.tv/<canal ao vivo>`.
    **Esperado:** a live toca (sem erro de `parent`); o logo abre o navegador.
11. Tire o cabo/Wi-Fi de um PC e ponha um vídeo novo. **Esperado:** em até
    15 s, "Sem internet: o YouTube não carregou neste PC." no lugar do
    player; volta sozinho quando a rede volta.

**Se o vídeo não tocar mas o spike da seção 2 tocou:** o suspeito é o
`sandbox` do iframe. Com o DevTools (Ctrl+Shift+I) → Console, procure erros
do player; anote e mande.

## O que mandar

- O resumo impresso pelo `tools/spike-youtube` (as duas janelas).
- O log da primeira abertura da versão nova e o `origem.json`.
- Qualquer item da seção 3 que tenha mudado de comportamento.
- O JSON da bancada da seção 5.1 e o que divergiu da seção 5.2.
