"use strict";

// Os dados do cidadao sao gravados na sessao a cada campo digitado. Antes so
// eram gravados ao tocar em "Continuar": quem preenchia durante a contagem
// regressiva e recarregava a pagina perdia tudo o que tinha digitado.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

function extrairFuncao(codigo, nome) {
  const inicio = codigo.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  const abre = codigo.indexOf("{", codigo.indexOf(")", inicio));
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(inicio, i + 1);
    }
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

const chave = /const CHAVE_DADOS_AGENDAMENTO = "([^"]+)";/.exec(sitePublico)[1];
const campos = JSON.parse(/const CAMPOS_DADOS_AGENDAMENTO = (\[[^\]]*\]);/.exec(sitePublico)[1]);

function ambiente() {
  const ouvintes = {};
  const elementos = Object.fromEntries(campos.map((id) => [id, {
    value: "",
    addEventListener(tipo, fn) { (ouvintes[id] ??= []).push({ tipo, fn }); }
  }]));
  const armazenado = new Map();
  return {
    ouvintes,
    elementos,
    armazenado,
    document: { getElementById: (id) => elementos[id] ?? null },
    sessionStorage: {
      setItem: (k, v) => armazenado.set(k, String(v)),
      getItem: (k) => (armazenado.has(k) ? armazenado.get(k) : null),
      removeItem: (k) => armazenado.delete(k)
    }
  };
}

function carregar(amb) {
  const fonte = [
    `const CHAVE_DADOS_AGENDAMENTO = ${JSON.stringify(chave)};`,
    `const CAMPOS_DADOS_AGENDAMENTO = ${JSON.stringify(campos)};`,
    extrairFuncao(sitePublico, "persistirDadosAgendamento"),
    extrairFuncao(sitePublico, "ativarPersistenciaPorCampo"),
    "return { ativarPersistenciaPorCampo };"
  ].join("\n");
  return new Function("document", "sessionStorage", fonte)(amb.document, amb.sessionStorage);
}

function digitar(amb, id, valor) {
  amb.elementos[id].value = valor;
  for (const { tipo, fn } of amb.ouvintes[id] ?? []) if (tipo === "input") fn();
}

test("os cinco campos de dados continuam cobertos", () => {
  assert.deepEqual(campos, ["inp-nome", "inp-cpf", "inp-nasc", "inp-tel", "inp-email"]);
});

test("cada campo registra um unico ouvinte de digitacao", () => {
  const amb = ambiente();
  carregar(amb).ativarPersistenciaPorCampo();
  for (const id of campos) {
    const doInput = (amb.ouvintes[id] ?? []).filter((o) => o.tipo === "input");
    assert.equal(doInput.length, 1, `${id} deveria ter exatamente um ouvinte de input.`);
  }
});

test("digitar grava na sessao sem precisar tocar em Continuar", () => {
  const amb = ambiente();
  carregar(amb).ativarPersistenciaPorCampo();

  digitar(amb, "inp-nome", "Maria da Silva");
  let salvo = JSON.parse(amb.sessionStorage.getItem(chave));
  assert.equal(salvo["inp-nome"], "Maria da Silva");

  digitar(amb, "inp-cpf", "123.456.789-09");
  salvo = JSON.parse(amb.sessionStorage.getItem(chave));
  assert.equal(salvo["inp-nome"], "Maria da Silva", "gravar um campo nao pode apagar os outros.");
  assert.equal(salvo["inp-cpf"], "123.456.789-09");
});

test("campo ausente na pagina nao quebra a inicializacao", () => {
  const amb = ambiente();
  delete amb.elementos["inp-email"];
  assert.doesNotThrow(() => carregar(amb).ativarPersistenciaPorCampo());
});

test("a inicializacao liga a gravacao logo depois de restaurar os dados", () => {
  const init = sitePublico.slice(sitePublico.indexOf("(async function init() {"));
  assert.match(init.slice(0, 1200), /restaurarDadosAgendamento\(\);\s*ativarPersistenciaPorCampo\(\);/);
});
