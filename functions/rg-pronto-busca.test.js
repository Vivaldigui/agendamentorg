"use strict";

// Busca da aba "RG pronto" do painel (public/recepcao.js). Como o teste do
// painel em whatsapp-cin.test.js, recorta normalizarNomeBusca e
// filtrarCandidatosRg do arquivo e roda as duas sozinhas num contexto
// isolado: a busca nao pode depender de outras funcoes do painel.
// Todos os nomes sao ficticios.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const publico = path.join(__dirname, "..", "public");
const js = fs.readFileSync(path.join(publico, "recepcao.js"), "utf8");
const html = fs.readFileSync(path.join(publico, "recepcao.html"), "utf8");

function trecho(nome) {
  const i = js.indexOf(`function ${nome}(`);
  assert.notEqual(i, -1, `${nome} sumiu de public/recepcao.js`);
  return js.slice(i, js.indexOf("\nfunction ", i + 10));
}

// Contexto novo a cada chamada: a memoria de nomes preparados comeca vazia.
function novaBusca() {
  const ctx = {};
  vm.runInNewContext(trecho("normalizarNomeBusca") + "\n" + trecho("filtrarCandidatosRg") + "\nthis.f = filtrarCandidatosRg;", ctx);
  return ctx.f;
}

const filtrar = novaBusca();
let seq = 0;
const cad = (nome, dataISO = "2026-10-01", hora = "09:00") => ({ id: `c${++seq}`, dados: { nome, dataISO, hora } });
const nomes = (lista, busca) => Array.from(filtrar(lista, busca), x => x.dados.nome);
const campo = (lista, busca, chave) => Array.from(filtrar(lista, busca), x => x[chave]);

test("rg pronto: menos de 3 letras nao busca; com 3 ja busca, com uma palavra so", () => {
  const lista = [cad("Francisca Carvalho", "2026-10-02"), cad("Francisco Lima", "2026-10-01"), cad("Fabiana Souza")];
  for (const busca of ["", "   ", "f", "fr", "F r", "d e", "12345"]) {
    assert.deepEqual(nomes(lista, busca), [], JSON.stringify(busca));
  }
  assert.deepEqual(nomes(lista, "fra"), ["Francisca Carvalho", "Francisco Lima"]);
  assert.deepEqual(nomes(lista, "fran"), ["Francisca Carvalho", "Francisco Lima"]);
  assert.deepEqual(campo(lista, "fran", "nivel"), [2, 2], "comeco de palavra");
  assert.deepEqual(campo(lista, "fran", "parecido"), [false, false]);
});

test("rg pronto: so a ultima parte casa pelo comeco; as outras, palavra inteira, em qualquer ordem", () => {
  const lista = [
    cad("Francisca de Carvalho", "2026-10-02"),
    cad("Francisca Silva", "2026-10-03"),
    cad("Maria Francisca Carvalhaes", "2026-09-01")
  ];
  assert.deepEqual(nomes(lista, "francisca carv"), ["Francisca de Carvalho", "Maria Francisca Carvalhaes"]);
  assert.deepEqual(nomes(lista, "carvalho francisca"), ["Francisca de Carvalho"]);
  assert.deepEqual(nomes(lista, "fran carvalho"), [], "parte do meio pela metade nao casa");
});

test("rg pronto: acento, caixa e de/da/do/das/dos/e nao contam", () => {
  const lista = [cad("JOSÉ DA CONCEIÇÃO"), cad("João dos Santos e Araújo")];
  assert.deepEqual(nomes(lista, "jose conceicao"), ["JOSÉ DA CONCEIÇÃO"]);
  assert.deepEqual(nomes(lista, "Conceição José"), ["JOSÉ DA CONCEIÇÃO"]);
  assert.deepEqual(nomes(lista, "JOAO ARAUJO"), ["João dos Santos e Araújo"]);
  const [r] = filtrar(lista, "joao dos santos e araujo");
  assert.equal(r.exato, true, "nome identico ao digitado");
  assert.equal(r.nivel, 3);
  assert.equal(r.parecido, false);
});

test("rg pronto: grafias comuns de nomes brasileiros casam como nome parecido", () => {
  const pares = [
    ["Luiz Fernando", "luis fernando"], ["Luis Fernando", "luiz fernando"],
    ["Ana Souza", "ana sousa"], ["Ana Sousa", "ana souza"],
    ["Rafael Lima", "raphael lima"], ["Raphael Lima", "rafael lima"],
    ["Thiago Reis", "tiago reis"], ["Tiago Reis", "thiago reis"],
    ["Isabella Mattos", "isabela matos"], ["Helena Dias", "elena dias"],
    ["Thays Rocha", "thais rocha"], ["Wagner Costa", "vagner costa"],
    ["Kátia Gomes", "catia gomes"], ["Jhonatan Alves", "jonathan alves"],
    ["William Freitas", "willian freitas"], ["Kelly Queiroz", "keli queiros"],
    ["Ana Gonçalves", "ana gonsalves"], ["Ana Conceição", "ana conseicao"]
  ];
  for (const [cadastro, busca] of pares) {
    const r = filtrar([cad(cadastro)], busca);
    assert.equal(r.length, 1, `${busca} -> ${cadastro}`);
    assert.equal(r[0].parecido, true, `${busca} -> ${cadastro} sai como parecido`);
    assert.equal(r[0].exato, false);
  }
});

test("rg pronto: erro de digitacao pequeno -- 1 letra em palavras de 4+, 2 em palavras de 8+", () => {
  const lista = [cad("Francisca Carvalho"), cad("Maria Aparecida Lima"), cad("Ivo Reis"), cad("Marina Costa")];
  for (const busca of ["Fransisca Carvalho", "fracisca carvalho", "francsica carvalho", "francisca carvalo"]) {
    const r = filtrar(lista, busca);
    assert.deepEqual(Array.from(r, x => x.dados.nome), ["Francisca Carvalho"], busca);
    assert.equal(r[0].parecido, true, busca);
  }
  assert.deepEqual(nomes(lista, "maria apracida lima"), ["Maria Aparecida Lima"], "2 letras numa palavra de 8+");
  assert.deepEqual(nomes(lista, "mirana costa"), [], "2 letras numa palavra de 6 nao");
  assert.deepEqual(nomes(lista, "iva reis"), [], "palavra de 3 letras nao aceita erro");
});

test("rg pronto: com 3+ palavras uma pode faltar (sobrenome a mais ou a menos na carta)", () => {
  const lista = [
    cad("Maria Aparecida Lima", "2026-10-03"),
    cad("Maria Aparecida Souza Lima", "2026-10-02"),
    cad("Maria Lima", "2026-10-04")
  ];
  // Carta com um sobrenome a mais que o cadastro.
  assert.deepEqual(nomes(lista, "maria aparecida souza lima"), ["Maria Aparecida Souza Lima", "Maria Aparecida Lima"]);
  assert.deepEqual(campo(lista, "maria aparecida souza lima", "parecido"), [false, true]);
  // Carta com um sobrenome a menos: todas as partes estao no nome, sem etiqueta.
  assert.deepEqual(nomes(lista, "maria souza lima"), ["Maria Aparecida Souza Lima", "Maria Lima", "Maria Aparecida Lima"]);
  assert.deepEqual(campo(lista, "maria souza lima", "parecido"), [false, true, true]);
  // Com 2 palavras as duas tem de casar; e so uma pode faltar.
  assert.deepEqual(nomes(lista, "maria souza"), ["Maria Aparecida Souza Lima"]);
  assert.deepEqual(nomes([cad("Maria Lima")], "maria aparecida souza lima"), []);
  // A que falta nao pode ser o primeiro nome do cadastro: outra pessoa.
  assert.deepEqual(nomes([cad("Ana Clara Souza")], "maria clara souza"), []);
  assert.deepEqual(nomes([cad("Ana Clara Souza")], "clara souza maria"), []);
  assert.deepEqual(nomes([cad("Clara Souza")], "maria clara souza"), ["Clara Souza"]);
});

test("rg pronto: ordem -- identico, palavras inteiras, comeco de palavra, parecido; depois o mais recente", () => {
  const lista = [
    cad("Maria Josefa Ribeiro", "2026-11-10"),
    cad("Mariah José Ribeiro", "2026-11-09"),
    cad("Maria José Ribeiro", "2026-11-08", "09:00"),
    cad("Joana José", "2026-11-12"),
    cad("Maria Josi Ribeiro", "2026-11-12"),
    cad("Maria José", "2026-01-05"),
    cad("Maria José Souza", "2026-11-08", "14:00")
  ];
  assert.deepEqual(nomes(lista, "maria jose"), [
    "Maria José", "Maria José Souza", "Maria José Ribeiro", "Maria Josefa Ribeiro", "Maria Josi Ribeiro", "Mariah José Ribeiro"
  ]);
  assert.deepEqual(campo(lista, "maria jose", "exato"), [true, false, false, false, false, false]);
  assert.deepEqual(campo(lista, "maria jose", "nivel"), [3, 3, 3, 2, 1, 1]);
  assert.deepEqual(campo(lista, "maria jose", "parecido"), [false, false, false, false, true, true]);
});

test("rg pronto: nao traz nome sem relacao", () => {
  const lista = [
    cad("Maria Souza", "2026-10-01"), cad("Mario Souza", "2026-10-09"), cad("Daria Souza"),
    cad("Joana Dias"), cad("Luana Reis"), cad("Ana Lima"), cad("Priscila Moraes"), cad("Zélia Moraes")
  ];
  const r = filtrar(lista, "maria");
  assert.deepEqual(Array.from(r, x => x.dados.nome), ["Maria Souza", "Mario Souza"], "Mario so como parecido, depois da Maria");
  assert.equal(r[1].exato, false);
  assert.equal(r[1].parecido, true);
  assert.deepEqual(nomes(lista, "ana"), ["Ana Lima"], "ana nao casa no meio de Joana nem de Luana");
  assert.deepEqual(nomes(lista, "sil"), [], "nem sil no meio de Priscila");
  assert.deepEqual(nomes(lista, "celia moraes"), [], "Celia nao vira Zelia");
  assert.deepEqual(nomes(lista, "souza souza"), [], "cada parte precisa de uma palavra sua");
});

test("rg pronto: no maximo 20, os atendimentos mais recentes primeiro", () => {
  const lista = Array.from({ length: 30 }, (_, i) => ({
    id: `m${i + 1}`,
    dados: { nome: "Maria Silva", dataISO: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), hora: "09:00" }
  }));
  const r = filtrar(lista, "maria silva");
  assert.equal(r.length, 20);
  assert.deepEqual(Array.from(r, x => x.id), Array.from({ length: 20 }, (_, i) => `m${30 - i}`));
});

test("rg pronto: particula pela metade no fim nao some com os nomes enquanto se digita", () => {
  const lista = [cad("Maria da Silva", "2026-10-02"), cad("Maria Dias", "2026-10-01"), cad("Mariana Lopes", "2026-10-03")];
  assert.deepEqual(nomes(lista, "maria"), ["Maria da Silva", "Maria Dias", "Mariana Lopes"]);
  assert.deepEqual(nomes(lista, "maria d"), ["Maria da Silva", "Maria Dias"]);
  assert.deepEqual(nomes(lista, "maria da"), ["Maria da Silva", "Maria Dias"]);
  assert.deepEqual(nomes(lista, "maria di"), ["Maria Dias"]);
  assert.deepEqual(nomes(lista, "maria da s"), ["Maria da Silva"]);
});

test("rg pronto: a memoria de nomes preparados nao muda o resultado", () => {
  const lista = [cad("Francisca Carvalho"), cad("Luiz Souza")];
  const busca = novaBusca();
  const ids = texto => Array.from(busca(lista, texto), x => x.id);
  const primeira = ids("luis sousa");
  assert.deepEqual(primeira, [lista[1].id]);
  assert.deepEqual(ids("luis sousa"), primeira, "segunda vez, com a memoria");
  lista[1].dados.nome = "Luiz Pereira";
  assert.deepEqual(ids("luis sousa"), [], "nome trocado no mesmo objeto vale o novo");
  assert.deepEqual(ids("luis pereira"), [lista[1].id]);
});

test("rg pronto: linha do resultado parecido leva a etiqueta Nome parecido", () => {
  const ctx = {};
  vm.runInNewContext(["textoSeguro", "dataBrISO", "celularFinal", "linhaRgPronto"].map(trecho).join("\n") + "\nthis.linha = linhaRgPronto;", ctx);
  const c = { id: "x1", dados: { nome: "Ana <b>Lima</b>", dataISO: "2026-10-01", hora: "09:00", protocolo: "CIN-1", telefone: "(35) 99999-0000" } };
  const comum = ctx.linha(c);
  assert.match(comum, /Ana &lt;b&gt;Lima&lt;\/b&gt;/);
  assert.doesNotMatch(comum, /Nome parecido/);
  assert.match(ctx.linha({ ...c, exato: false, nivel: 1, parecido: true }), /<span class="etiqueta nota"[^>]*><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"><\/i> Nome parecido<\/span>/);
});

test("rg pronto: mensagem de vazio pede 3 letras", () => {
  assert.match(html, /<tbody id="rg-pronto-corpo"><tr><td colspan="4" class="td-vazio">Digite pelo menos 3 letras do nome\.<\/td><\/tr><\/tbody>/);
  assert.match(trecho("buscarRgPronto"), /"Digite pelo menos 3 letras do nome\."/);
  assert.doesNotMatch(html + js, /duas partes do nome/);
});
