// Builds recentes do Node.js pra Windows sao compiladas com clang-cl, e o
// node-gyp detecta isso (`process.config.variables.clang === 1`) e forca o
// toolset MSVC gerado pra "ClangCL" -- que so existe se o componente
// "C++ Clang tools for Windows" do Visual Studio estiver instalado (nao faz
// parte da instalacao padrao do "Desktop development with C++").
//
// Em vez de depender desse componente extra, trocamos o toolset gerado de
// volta pro MSVC padrao (v143) direto nos .vcxproj, antes do passo `build`.
// Ver README/binding.gyp -- rodar via `npm run build:native`.
'use strict';

const fs = require('fs');
const path = require('path');

function findVcxprojFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findVcxprojFiles(full, out);
    } else if (entry.name.endsWith('.vcxproj')) {
      out.push(full);
    }
  }
  return out;
}

const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) {
  console.error('build/ não existe -- rode "node-gyp configure" antes deste script.');
  process.exit(1);
}

let patchedCount = 0;
for (const file of findVcxprojFiles(buildDir)) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes('<PlatformToolset>ClangCL</PlatformToolset>')) continue;
  fs.writeFileSync(file, content.replace(/<PlatformToolset>ClangCL<\/PlatformToolset>/g, '<PlatformToolset>v143</PlatformToolset>'));
  patchedCount++;
  console.log(`toolset corrigido: ${path.relative(process.cwd(), file)}`);
}

if (patchedCount === 0) {
  console.log('nenhum .vcxproj usando ClangCL encontrado -- nada a corrigir.');
}
