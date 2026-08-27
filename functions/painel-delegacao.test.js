"use strict";

// Trava da delegacao de eventos do painel (public/recepcao.js).
//
// O painel nao tem mais onclick/oninput/onchange embutidos: cada gatilho
// declara data-acao (ou data-input / data-change) e um unico ouvinte resolve a
// chave contra um registro. O modo de falhar dessa troca e silencioso -- um
// botao com chave que ninguem registrou simplesmente nao faz nada, sem erro
// visivel para quem opera. Estes testes fecham essa porta nos dois sentidos.

const test = require("node:test");
const assert = require("node:assert/strict");
const { painelHtml, painelJs } = require("./painel-fonte");

const fonte = painelHtml + "\n" + painelJs;

// Extrai as chaves de um objeto literal do fonte. Precisa lidar com as tres
// formas usadas no registro: atalho (`fazerLogin,`), chave nomeada
// (`vista: el => ...`) e chave entre aspas (`"filtro-rapido": el => ...`).
function chavesDoRegistro(nome) {
  const inicio = fonte.indexOf(`const ${nome} = {`);
  assert.notEqual(inicio, -1, `Registro ${nome} nao encontrado.`);
  const fim = fonte.indexOf("\n};", inicio);
  assert.notEqual(fim, -1, `Registro ${nome} sem fechamento.`);
  const corpo = fonte
    .slice(fonte.indexOf("{", inicio) + 1, fim)
    .replace(/\/\/[^\n]*/g, "");

  const chaves = new Set();
  let profundidade = 0;
  let atual = "";
  const fechar = () => {
    const fragmento = atual.trim();
    atual = "";
    if (!fragmento) return;
    const nomeada = fragmento.match(/^"([^"]+)"\s*:/) || fragmento.match(/^([A-Za-z0-9_$]+)\s*:/);
    if (nomeada) return chaves.add(nomeada[1]);
    const atalho = fragmento.match(/^([A-Za-z0-9_$]+)$/);
    if (atalho) chaves.add(atalho[1]);
  };
  for (const c of corpo) {
    if (c === "(" || c === "[" || c === "{") profundidade++;
    else if (c === ")" || c === "]" || c === "}") profundidade--;
    if (c === "," && profundidade === 0) fechar();
    else atual += c;
  }
  fechar();
  return chaves;
}

// Valores usados no markup, ignorando os que sao montados por template.
function usadas(atributo) {
  const encontradas = new Set();
  for (const m of fonte.matchAll(new RegExp(`data-${atributo}="([^"$]+)"`, "g"))) {
    encontradas.add(m[1]);
  }
  return encontradas;
}

test("o painel nao tem nenhum manipulador de evento embutido", () => {
  // Enquanto existir um so, tirar 'unsafe-inline' do script-src do CSP quebra
  // o painel em vez de proteger.
  const embutidos = fonte.match(/\son[a-z]+="[^"]*"/g) || [];
  assert.deepEqual(embutidos, [], `Handlers inline encontrados: ${embutidos.join(", ")}`);
});

test("nenhum codigo le o atributo de um manipulador embutido", () => {
  // Foi assim que a lista parou de carregar depois do F2: marcarFiltroRapidoVisual
  // descobria o filtro de cada botao lendo o texto do proprio onclick. Sem
  // onclick, getAttribute devolvia null e a excecao subia por listarAgendamentos
  // antes de a tabela renderizar. Quem precisa do argumento le o data-*.
  const leituras = painelJs.match(/getAttribute\(\s*["'`]on[a-z]+["'`]\s*\)|\.\bon(click|input|change|submit)\b\s*[.[]/g) || [];
  assert.deepEqual(leituras, [], `Leitura de handler embutido: ${leituras.join(", ")}`);
});

test("os filtros rapidos marcam o ativo pelo data-tipo", () => {
  assert.match(painelJs, /btn\.dataset\.tipo === tipo/);
  const botoes = painelHtml.match(/data-acao="filtro-rapido" data-tipo="[a-z]+"/g) || [];
  assert.equal(botoes.length >= 10, true, "Os filtros rapidos precisam declarar data-tipo.");
});

test("o painel nao volta a embutir script nem estilo no HTML", () => {
  assert.equal(/<script>/.test(painelHtml), false, "O comportamento vive em /recepcao.js.");
  assert.equal(/<style>/.test(painelHtml), false, "O estilo vive em /recepcao.css.");
  assert.match(painelHtml, /<script src="\/recepcao\.js"><\/script>/);
  assert.match(painelHtml, /<link rel="stylesheet" href="\/recepcao\.css">/);
});

test("todo gatilho de clique tem acao registrada", () => {
  const registro = chavesDoRegistro("ACOES_CLIQUE");
  const noMarkup = usadas("acao");
  assert.equal(noMarkup.size > 0, true, "Nenhum data-acao encontrado no painel.");
  const orfas = [...noMarkup].filter(a => !registro.has(a));
  assert.deepEqual(orfas, [], `data-acao sem entrada em ACOES_CLIQUE: ${orfas.join(", ")}`);
});

test("nao sobra acao de clique registrada sem uso", () => {
  const registro = chavesDoRegistro("ACOES_CLIQUE");
  const noMarkup = usadas("acao");
  const sobrando = [...registro].filter(k => !noMarkup.has(k));
  assert.deepEqual(sobrando, [], `Registrada mas nunca usada: ${sobrando.join(", ")}`);
});

test("todo gatilho de campo tem acao registrada", () => {
  const registro = chavesDoRegistro("ACOES_CAMPO");
  const noMarkup = new Set([...usadas("input"), ...usadas("change")]);
  assert.equal(noMarkup.size > 0, true, "Nenhum data-input/data-change encontrado.");
  const orfas = [...noMarkup].filter(a => !registro.has(a));
  assert.deepEqual(orfas, [], `data-input/data-change sem entrada em ACOES_CAMPO: ${orfas.join(", ")}`);
  const sobrando = [...registro].filter(k => !noMarkup.has(k));
  assert.deepEqual(sobrando, [], `Registrada mas nunca usada: ${sobrando.join(", ")}`);
});

test("as janelas de impressao nao levam script nem onclick embutidos", () => {
  // Sao documentos de mesma origem escritos por document.write e herdam o CSP
  // do painel; os ouvintes vao pelo opener, em prepararJanelaImpressao.
  assert.equal(/<script>setTimeout/.test(painelJs), false, "Script embutido na janela gerada.");
  assert.match(painelJs, /function prepararJanelaImpressao\(janela\)/);
  assert.match(painelJs, /id="acao-imprimir"/);
  const chamadas = painelJs.match(/prepararJanelaImpressao\(janela\);/g) || [];
  assert.equal(chamadas.length, 3, "Cada janela gerada precisa ligar os proprios botoes.");
});

test("os menus deixaram de depender de stopPropagation", () => {
  // Com um unico ouvinte no documento, stopPropagation nao impediria os outros
  // ouvintes do mesmo alvo: quem fecha e quem abre precisam estar na mesma
  // funcao, em ordem explicita.
  const semComentarios = painelJs.replace(/\/\/[^\n]*/g, "");
  assert.equal(/\.stopPropagation\(\)/.test(semComentarios), false);
  assert.match(painelJs, /if \(acao !== "menu-linha"\) fecharMenusAcoes\(\);/);
  assert.match(painelJs, /if \(acao !== "acoes-lista"\) fecharAcoesDaLista\(\);/);
});
