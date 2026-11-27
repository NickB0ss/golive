---
tipo: decisao
id: D-11
titulo: "golive-media compilado como segundo target do binding.gyp"
data: 2026-11-25
status: proposta, confirmar com MSVC no Windows
fase: 1
tags: [golive, transmissao, build]
aliases: [D-11]
---
# D-11 — golive-media compilado como segundo target do binding.gyp

## Contexto
O [[D-03-processo-auxiliar-golive-media|D-03]] manda o pipeline nativo para um executável
separado. O plano (P1.1) pedia tentar um target `"type": "executable"` no `binding.gyp`, para
reaproveitar o `npm run build:native`, e cair para CMake só se o node-gyp atrapalhasse.

## Decisão
Segundo target `golive-media` (`"type": "executable"`) no mesmo `binding.gyp`, com fontes em
`native/media/`. Para não herdar nada de addon: sem `node-addon-api` (include e dependência),
e com `"win_delay_load_hook": "false"` no Windows (o hook de delay-load do node-gyp só faz
sentido para `.node`). Subsistema do linker em console (`SubSystem: 1`) para ter stdin/stdout.
A saída fica em `build/Release/golive-media(.exe)`, ao lado do `golive_audio.node`.

Verificado na nuvem (Linux): `node-gyp configure` gera os makefiles com os dois targets
(headers do Node já em cache, sem falha de rede) e `make -C build golive-media` compila e
liga o executável, que passa nos testes de `native/media/golive-media.test.js`. O target do
addon não compila no Linux (usa `windows.h`), por isso o build completo só roda no Windows.
O caminho `_WIN32` do código foi conferido com MinGW (`-static`), não com MSVC.

## Alternativas consideradas
- **CMake só para o exe:** funcionaria, mas é uma segunda ferramenta de build, um segundo
  comando no `package.json` e outra dependência no ambiente do Windows. Fica como plano B se
  o MSVC reclamar das flags herdadas do `common.gypi` (a P1.2 em diante vai ligar d3d11, mfplat
  etc., o que também é simples no gyp via `libraries`).
- **Compilar o exe dentro do addon (mesmo target):** descartado pelo D-03.

## Consequências
- Um comando (`npm run build:native`) gera o addon e o exe; o `patch-clangcl-toolset.js`
  continua valendo para os dois targets.
- `scripts/check-native-build.js` só informa a ausência do exe (lista opcional); empacotá-lo
  e exigi-lo no `dist` é o P4.1.
- Nos Windows, `ExceptionHandling: 1` e `/std:c++20` repetidos no target novo, porque
  `msvs_settings` não é herdado entre targets.
- Pendente no Windows com MSVC: confirmar que o `common.gypi` não injeta `node.lib` nem o
  hook de delay-load no exe, e que ele roda sem o Node instalado.

## Ligações
[[D-03-processo-auxiliar-golive-media|D-03]] · [[D-04-so-apis-do-windows|D-04]] · [[2026-11-25-pipeline-nativo|Plano do pipeline nativo]] (P1.1)
