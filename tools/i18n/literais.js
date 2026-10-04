'use strict';

// Contextos depois dos quais um '/' e inicio de regex, nao divisao. Sem isso,
// uma classe de caracteres pode fazer o tokenizador ler aspas como string.
const REGEX_STARTS_AFTER = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '\n', '+', '-', '*', '%', '<', '>', '~', '^', '',
]);

/**
 * Devolve trechos literais de aspas simples, duplas e templates, ignorando
 * comentarios, regex e o codigo dentro de ${...}. A linha e a do inicio do
 * literal, para a catraca apontar o local que precisa de traducao.
 */
function extrairLiterais(src) {
  const out = [];
  let i = 0;
  let linha = 1;
  let ultimo = '';

  function avancar(quantidade = 1) {
    for (let indice = 0; indice < quantidade && i < src.length; indice += 1) {
      if (src[i] === '\n') linha += 1;
      i += 1;
    }
  }

  function salvar(texto, linhaInicio) {
    if (texto) out.push({ texto, linha: linhaInicio });
  }

  while (i < src.length) {
    const atual = src[i];
    const proximo = src[i + 1];

    if (atual === '/' && proximo === '/') {
      while (i < src.length && src[i] !== '\n') avancar();
      continue;
    }
    if (atual === '/' && proximo === '*') {
      avancar(2);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) avancar();
      avancar(2);
      continue;
    }
    if (atual === '/' && REGEX_STARTS_AFTER.has(ultimo)) {
      avancar();
      let emClasse = false;
      while (i < src.length) {
        if (src[i] === '\\') {
          avancar(2);
          continue;
        }
        if (src[i] === '[') emClasse = true;
        else if (src[i] === ']') emClasse = false;
        else if (src[i] === '/' && !emClasse) {
          avancar();
          break;
        } else if (src[i] === '\n') {
          break;
        }
        avancar();
      }
      while (i < src.length && /[a-z]/i.test(src[i])) avancar();
      ultimo = '/';
      continue;
    }
    if (atual === "'" || atual === '"') {
      const aspas = atual;
      const linhaInicio = linha;
      let texto = '';
      avancar();
      while (i < src.length && src[i] !== aspas) {
        if (src[i] === '\\') {
          avancar(2);
          continue;
        }
        texto += src[i];
        avancar();
      }
      avancar();
      salvar(texto, linhaInicio);
      ultimo = aspas;
      continue;
    }
    if (atual === '`') {
      const linhaInicio = linha;
      let texto = '';
      avancar();
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') {
          avancar(2);
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          salvar(texto, linhaInicio);
          texto = '';
          avancar(2);
          let profundidade = 1;
          while (i < src.length && profundidade > 0) {
            if (src[i] === '{') profundidade += 1;
            else if (src[i] === '}') profundidade -= 1;
            avancar();
          }
          continue;
        }
        texto += src[i];
        avancar();
      }
      avancar();
      salvar(texto, linhaInicio);
      ultimo = '`';
      continue;
    }
    if (!/\s/.test(atual)) ultimo = atual;
    avancar();
  }
  return out;
}

function fragmentosVisiveis(literal) {
  if (!literal.includes('<')) return [literal];
  const textos = [...literal.matchAll(/>([^<]+)</g)].map((resultado) => resultado[1]);
  const atributos = [...literal.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)]
    .map((resultado) => resultado[1]);
  return [...textos, ...atributos];
}

const ACENTO = /[À-ÿ]/;
const DUAS_PALAVRAS = /[A-Za-zÀ-ÿ]{2,}\s+[A-Za-zÀ-ÿ]{2,}/;
const TOKEN_CSS = /^[a-z0-9]+(?:[-_]{1,2}[a-z0-9]+)*$/;
const FORMA_CHAVE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+(\?.*)?$/;

const EXCECOES = new Set([
  // palavras de busca do emoji, nao texto de tela
  'GoLive LAN', // marca
  'GoLive', // marca
  'Esc', // nome da tecla de atalho
  'tic tac toe', // palavra de busca do menu Adicionar janela, nao texto de tela
  'Português', // nome da lingua na propria lingua (spec 2.2)
  'English', // nome da lingua na propria lingua (spec 2.2)
  'Español', // nome da lingua na propria lingua (spec 2.2)
  'use strict', // diretiva JavaScript, nao texto de tela
  'NAO tocou', // codigo de status tecnico recebido pelo teste de som
  'Radmin VPN', // marca (nome da rede virtual), igual em toda lingua
  // Log e relatorio para o desenvolvedor (console e diagnostico copiado): ficam em pt-BR (spec 2.4)
  'conexao direta', // relatorio para o desenvolvedor (spec 2.4)
  'validacao apos assumir', // relatorio para o desenvolvedor (spec 2.4)
  'via relay #', // relatorio para o desenvolvedor (spec 2.4)
  'sem conexao de entrada (a arvore diz que devia haver uma)', // relatorio para o desenvolvedor (spec 2.4)
  'congelou depois de mostrar imagem', // relatorio para o desenvolvedor (spec 2.4)
  'segue sem imagem desde que passou a ser assistida', // relatorio para o desenvolvedor (spec 2.4)
  '[assistir] tela de', // relatorio para o desenvolvedor (spec 2.4)
  'voltou a mostrar imagem depois de', // relatorio para o desenvolvedor (spec 2.4)
  // relatorio para o desenvolvedor (spec 2.4)
  'voltou a mostrar imagem sem refazer a conexao (reoferta segurada: rede)',
  '[signaling] sala migrada, renegociando a malha', // relatorio para o desenvolvedor (spec 2.4)
  '[signaling] retomada recusada, renegociando tudo', // relatorio para o desenvolvedor (spec 2.4)
  'mudancas em', // relatorio para o desenvolvedor (spec 2.4)
  'sem par de candidatos selecionado', // relatorio para o desenvolvedor (spec 2.4)
  'banda estimada', // relatorio para o desenvolvedor (spec 2.4)
  'rede (nada chegando)', // relatorio para o desenvolvedor (spec 2.4)
  'origem parou de enviar video (caminho vivo)', // relatorio para o desenvolvedor (spec 2.4)
  'video chegando sem decodificar (quadro-chave/decoder)', // relatorio para o desenvolvedor (spec 2.4)
  'quadros decodificados sem aparecer na tela', // relatorio para o desenvolvedor (spec 2.4)
  'sem estatistica suficiente', // relatorio para o desenvolvedor (spec 2.4)
  ', par ICE +', // relatorio para o desenvolvedor (spec 2.4)
  'respostas STUN', // relatorio para o desenvolvedor (spec 2.4)
  'load failed', // mensagem interna de Error, nunca chega a tela
  '×', // simbolo de multiplicacao entre largura e altura
  // Motivos do registro de janelas da Mesa (loadErrors): diagnostico para o desenvolvedor, nunca vao para a tela
  'não é objeto', 'type inválido', 'title inválido', 'group inválido', 'size inválido', 'size.aspect inválido',
  'maxStateBytes inválido', 'sem init', 'não é função', 'sem validate/reduce', 'secret inválido', 'secret sem view',
  'type não bate com a chave', 'type não bate com o nome do arquivo',
  'mj-dados-palco is-', 'ms cubic-bezier(0.12, 0.8, 0.18, 1)', // trecho de classe/valor CSS, nao e texto
  'nao registrou', 'nao carregou', // mensagem interna de Error ao injetar script, nunca chega a tela
  // Log e erro interno do processo principal (src/main): nunca chega a tela (spec 1.4)
  'addon de audio nativo indisponivel -- "incluir o som do Discord" e a exclusao do audio do proprio GoLive'
    + ' vao ficar fora do ar:', // log
  'processo filho encerrou: type=', 'GPU ativa: vendorId=', // log
  'origem local:', 'origem local: falha servindo', // log
  'conferencia do destino nao bateu', 'copia passou de', 'falhou (tenta de novo na proxima abertura):', // log
  'captura: o Electron recusou a fonte escolhida:', // log
  'metodo nao permitido', 'url invalida', 'nao encontrado', 'erro interno', // corpo HTTP do servidor local de origem
  'roomId invalido', 'address invalido', 'port invalida', // Error de argumento, nunca chega a tela
  // Titulos de secao da pagina chrome://gpu: sao o que a busca procura, nao texto do app
  'Problems Detected', 'Graphics Feature Status', 'Video Acceleration Information',
  // Fallback defensivo do nome da sala: o renderer sempre manda o nome ja no idioma de quem cria (Tarefa 9)
  'anônimo', 'sala de',
  // Fallback em pt-BR da splash quando o preload falha: sem preload nao ha dicionario nem idioma (Tarefa 9)
  'Procurando atualizações…', 'Baixando atualização — {pct}%',
  // Diagnostico e Error interno do renderer (log, relatorio copiado, historico tecnico de sons): pt-BR por spec 2.4
  'contexto nao retomou em 1s', 'ao vivo', 'som desconhecido', 'falha no AudioContext', // nomes e motivos do log de sons
  'sons desligados', 'janela em foco', 'intervalo mínimo de chat', // motivos do log de sons (testes travam o texto)
  '[mesh] negociacao de', 'sinalizacao interrompida durante a retomada', // log e Error de negociacao
  "a conexao esta em '", "', nao esperava resposta", 'sem conexao', // log de diagnostico do mesh
  'recusou na hora (o PC responde, ninguem escuta na porta)', 'sem resposta (rota caida ou PC desligado)', // log
  'inalcancavel (sem rota ate o PC)', 'erro na checagem', // log da checagem de rota ao lider
  'Qualidade desconhecida:', 'A função de bloqueio é obrigatória.', 'A função de aviso é obrigatória.', // Error de uso
  '(repasse de #', 'videoId invalido', // linha de diagnostico de encode e Error de argumento
  'warn-center-icon warn-center-icon-', 'warn-center-item warn-center-item-', // classes CSS montadas por template
  // Sobras da migracao: classes CSS e valores de CSS montados por template, nunca texto de tela
  'radial-gradient(circle at 1.25px 1.25px, var(--grid) 1.25px, transparent 1.5px)',
  'radial-gradient(circle at 1.25px 1.25px, var(--grid2) 1.75px, transparent 2px)',
  'class="mesa-menu-row menu__item', 'mj mj-', 'class="menu__item tile-menu-watch" role="menuitem"',
  // SHIP_NAMES (mesa-modules/batalha.js) esta exportada mas nao e usada em lugar nenhum: a Batalha mostra
  // so a frota por tamanho, nunca o nome do navio
  'Porta-aviões', 'Encouraçado', 'Destróier',
]);

// Codigo que o main injeta em paginas (executeJavaScript) ou manda ao PowerShell: nunca e texto de tela.
const CODIGO_EMBUTIDO = [
  /^\(\(\) => \{[\s\S]*\}\)\(\)$/, // IIFE injetada na pagina chrome://gpu
  /^;\s*localStorage\.clear\(\)[\s\S]*\}\)\(\)$/, // fim do script de gravacao de localStorage
  /^Start-Process\b/, /^' -ErrorAction SilentlyContinue$/, // linhas de script do PowerShell
];

function ehListaDeClasses(texto) {
  const tokens = texto.trim().split(/\s+/);
  return tokens.every((token) => TOKEN_CSS.test(token)) && tokens.some((token) => /[-_]/.test(token));
}

// Valores de CSS e seletores aparecem em templates junto com o DOM. Sao
// recorrentes em ui.js, mas nunca chegam como frase para a pessoa ler.
function ehTrechoDeCss(texto) {
  if (/\b(?:system-ui|sans-serif|monospace)\b/.test(texto)) return true;
  return /(?:^|[\s,])[#.][a-z][\w-]*(?:[\s,]|$)/i.test(texto);
}

function ehTextoVisivel(fragmento) {
  const texto = String(fragmento).trim();
  if (!texto || !/[A-Za-zÀ-ÿ]/.test(texto)) return false;
  if (EXCECOES.has(texto) || FORMA_CHAVE.test(texto) || ehListaDeClasses(texto)) return false;
  if (ehTrechoDeCss(texto) || CODIGO_EMBUTIDO.some((re) => re.test(texto))) return false;
  return ACENTO.test(texto) || DUAS_PALAVRAS.test(texto);
}

function ehTextoVisivelNoHtml(fragmento) {
  const texto = String(fragmento).trim();
  const letras = texto.match(/[A-Za-zÀ-ÿ]/g) || [];
  return letras.length >= 2 && !EXCECOES.has(texto);
}

function literaisDoHtml(html) {
  const out = [];
  const linhaDe = (posicao) => html.slice(0, posicao).split('\n').length;
  const semScriptsEComentarios = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, (trecho) => trecho.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (trecho) => trecho.replace(/[^\n]/g, ' '));
  for (const resultado of semScriptsEComentarios.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>([^<]+)/g)) {
    if (/\bdata-i18n="/.test(resultado[2])) continue;
    if (ehTextoVisivelNoHtml(resultado[3])) {
      out.push({ texto: resultado[3].trim(), linha: linhaDe(resultado.index) });
    }
  }
  for (const resultado of semScriptsEComentarios.matchAll(/<[a-zA-Z][\w-]*([^>]*)>/g)) {
    const atributoI18n = resultado[1].match(/data-i18n-attr="([^"]*)"/);
    const valorI18n = atributoI18n ? atributoI18n[1] : '';
    const traduzidos = valorI18n
      .split(';')
      .map((par) => par.split(':')[0].trim());
    for (const atributo of resultado[1].matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)) {
      if (!traduzidos.includes(atributo[1]) && ehTextoVisivelNoHtml(atributo[2])) {
        out.push({ texto: atributo[2], linha: linhaDe(resultado.index) });
      }
    }
  }
  return out;
}

function textosSoltos(arquivo, conteudo) {
  if (arquivo.endsWith('.html')) return literaisDoHtml(conteudo);
  const linhasDeLog = new Set();
  conteudo.split('\n').forEach((linha, indice) => {
    if (/\b(console|logger)\.\w+\(/.test(linha)) linhasDeLog.add(indice + 1);
  });
  const out = [];
  for (const literal of extrairLiterais(conteudo)) {
    if (linhasDeLog.has(literal.linha)) continue;
    for (const fragmento of fragmentosVisiveis(literal.texto)) {
      if (ehTextoVisivel(fragmento)) out.push({ texto: fragmento.trim(), linha: literal.linha });
    }
  }
  return out;
}

const PASTAS = [
  'src/renderer',
  'src/renderer/mesa-janelas',
  'src/renderer/mesa-modules',
  'src/main',
  'src/splash',
];
const FORA = /(\.test\.js$|dom-falso|[\\/]vendor[\\/]|[\\/]i18n[\\/]|quiz-banco|pcm-injector-worklet|[\\/]emoji-(en|es)\.js$|[\\/]emoji\.js$)/;

function ARQUIVOS_VARRIDOS(raizRepo) {
  const lista = ['src/main.js'];
  for (const pasta of PASTAS) {
    for (const arquivo of fs.readdirSync(path.join(raizRepo, pasta))) {
      const relativo = `${pasta}/${arquivo}`;
      if (/\.(js|html)$/.test(arquivo) && !FORA.test(relativo)) lista.push(relativo);
    }
  }
  return [...new Set(lista)].sort();
}

const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  REGEX_STARTS_AFTER,
  extrairLiterais,
  fragmentosVisiveis,
  ehTextoVisivel,
  literaisDoHtml,
  textosSoltos,
  ARQUIVOS_VARRIDOS,
  EXCECOES,
};
