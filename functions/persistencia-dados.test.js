"use strict";

// Os dados do cidadao sao gravados na sessao a cada campo digitado, e a
// declaracao, a cada marcacao. Antes so eram gravados ao tocar em "Continuar":
// quem preenchia durante a contagem regressiva e recarregava a pagina perdia
// o que tinha digitado e precisava marcar a declaracao de novo.

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
const aceites = JSON.parse(/const ACEITES_DADOS_AGENDAMENTO = (\[[^\]]*\]);/.exec(sitePublico)[1]);

function ambiente() {
  const ouvintes = {};
  const elementos = Object.fromEntries([...campos, ...aceites].map((id) => [id, {
    value: "",
    checked: false,
    addEventListener(tipo, fn) { (ouvintes[id] ??= []).push({ tipo, fn }); }
  }]));
  const armazenado = new Map();
  return {
    ouvintes,
    elementos,
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
    `const ACEITES_DADOS_AGENDAMENTO = ${JSON.stringify(aceites)};`,
    "function validarNascimentoAgendamento() {}",
    extrairFuncao(sitePublico, "persistirDadosAgendamento"),
    extrairFuncao(sitePublico, "restaurarDadosAgendamento"),
    extrairFuncao(sitePublico, "ativarPersistenciaPorCampo"),
    "return { ativarPersistenciaPorCampo, restaurarDadosAgendamento };"
  ].join("\n");
  return new Function("document", "sessionStorage", fonte)(amb.document, amb.sessionStorage);
}

function disparar(amb, id, tipo) {
  for (const ouvinte of amb.ouvintes[id] ?? []) if (ouvinte.tipo === tipo) ouvinte.fn();
}
function digitar(amb, id, valor) { amb.elementos[id].value = valor; disparar(amb, id, "input"); }
function marcar(amb, id, valor) { amb.elementos[id].checked = valor; disparar(amb, id, "change"); }
const salvo = (amb) => JSON.parse(amb.sessionStorage.getItem(chave));

test("os cinco campos de dados continuam cobertos", () => {
  assert.deepEqual(campos, ["inp-nome", "inp-cpf", "inp-nasc", "inp-tel", "inp-email"]);
});

test("a declaracao guardada e a mesma exigida para continuar", () => {
  // Se uma nova declaracao obrigatoria for criada, ela precisa ser guardada
  // tambem, senao volta desmarcada depois de recarregar a pagina.
  const exigidas = JSON.parse(/const pendentes = (\[[^\]]*\])\.filter/.exec(extrairFuncao(sitePublico, "destacarAceitesPendentes"))[1]);
  assert.deepEqual(aceites, exigidas);
});

test("cada campo e cada declaracao registram um unico ouvinte", () => {
  const amb = ambiente();
  carregar(amb).ativarPersistenciaPorCampo();
  for (const id of campos) {
    assert.equal((amb.ouvintes[id] ?? []).filter((o) => o.tipo === "input").length, 1, `${id}: um ouvinte de input.`);
  }
  for (const id of aceites) {
    assert.equal((amb.ouvintes[id] ?? []).filter((o) => o.tipo === "change").length, 1, `${id}: um ouvinte de change.`);
  }
});

test("digitar grava na sessao sem precisar tocar em Continuar", () => {
  const amb = ambiente();
  carregar(amb).ativarPersistenciaPorCampo();

  digitar(amb, "inp-nome", "Maria da Silva");
  assert.equal(salvo(amb)["inp-nome"], "Maria da Silva");

  digitar(amb, "inp-cpf", "123.456.789-09");
  assert.equal(salvo(amb)["inp-nome"], "Maria da Silva", "gravar um campo nao pode apagar os outros.");
  assert.equal(salvo(amb)["inp-cpf"], "123.456.789-09");
});

test("marcar e desmarcar a declaracao fica guardado sem apagar os dados", () => {
  const amb = ambiente();
  carregar(amb).ativarPersistenciaPorCampo();

  digitar(amb, "inp-nome", "Maria da Silva");
  marcar(amb, "aceite-lgpd", true);
  assert.equal(salvo(amb)["aceite-lgpd"], true);
  assert.equal(salvo(amb)["inp-nome"], "Maria da Silva");

  marcar(amb, "aceite-lgpd", false);
  assert.equal(salvo(amb)["aceite-lgpd"], false, "desmarcar tambem precisa ficar guardado.");
});

test("a declaracao volta marcada ao recarregar, junto com os dados", () => {
  const amb = ambiente();
  amb.sessionStorage.setItem(chave, JSON.stringify({ "inp-nome": "Maria da Silva", "aceite-lgpd": true }));
  carregar(amb).restaurarDadosAgendamento();
  assert.equal(amb.elementos["aceite-lgpd"].checked, true);
  assert.equal(amb.elementos["inp-nome"].value, "Maria da Silva");
});

test("so um valor booleano marca a declaracao ao restaurar", () => {
  const amb = ambiente();
  amb.sessionStorage.setItem(chave, JSON.stringify({ "aceite-lgpd": "true" }));
  carregar(amb).restaurarDadosAgendamento();
  assert.equal(amb.elementos["aceite-lgpd"].checked, false);
});

test("campo ou declaracao ausentes na pagina nao quebram a inicializacao", () => {
  const amb = ambiente();
  delete amb.elementos["inp-email"];
  delete amb.elementos["aceite-lgpd"];
  assert.doesNotThrow(() => carregar(amb).ativarPersistenciaPorCampo());
});

test("a inicializacao liga a gravacao logo depois de restaurar os dados", () => {
  const init = sitePublico.slice(sitePublico.indexOf("(async function init() {"));
  assert.match(init.slice(0, 1200), /restaurarDadosAgendamento\(\);\s*ativarPersistenciaPorCampo\(\);/);
});
