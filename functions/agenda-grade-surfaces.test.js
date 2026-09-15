"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DATA_CORTE_GRADE_NOVA,
  DATA_CORTE_GRADE_SEIS,
  HORARIOS_LEGADOS,
  HORARIOS_NOVOS,
  HORARIOS_SEIS
} = require("./agenda-grade");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");
const { painel } = require("./painel-fonte");

function constanteTexto(codigo, nome) {
  const match = codigo.match(new RegExp(`const\\s+${nome}\\s*=\\s*"([^"]+)"`));
  assert.ok(match, `Constante ${nome} nao encontrada.`);
  return match[1];
}

function constanteLista(codigo, nome) {
  const match = codigo.match(new RegExp(`const\\s+${nome}\\s*=\\s*(\\[[^;]+\\])`));
  assert.ok(match, `Constante ${nome} nao encontrada.`);
  return JSON.parse(match[1]);
}

function extrairFuncao(codigo, nome) {
  const inicio = codigo.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  const abre = codigo.indexOf("{", inicio);
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

// Uma data de cada lado de cada corte.
const DATAS_DE_CONTROLE = [
  ["2026-08-17", HORARIOS_LEGADOS],
  ["2026-08-18", HORARIOS_NOVOS],
  ["2026-09-20", HORARIOS_NOVOS],
  ["2026-09-21", HORARIOS_SEIS],
  ["2026-09-22", HORARIOS_SEIS]
];

function conferirConstantes(codigo) {
  assert.equal(constanteTexto(codigo, "DATA_CORTE_GRADE_NOVA"), DATA_CORTE_GRADE_NOVA);
  assert.equal(constanteTexto(codigo, "DATA_CORTE_GRADE_SEIS"), DATA_CORTE_GRADE_SEIS);
  assert.deepEqual(constanteLista(codigo, "HORARIOS_LEGADOS"), HORARIOS_LEGADOS);
  assert.deepEqual(constanteLista(codigo, "HORARIOS_NOVOS"), HORARIOS_NOVOS);
  assert.deepEqual(constanteLista(codigo, "HORARIOS_SEIS"), HORARIOS_SEIS);
}

function montarResolver(codigo, nomeFuncao) {
  const corpo = extrairFuncao(codigo, nomeFuncao);
  return new Function(
    "DATA_CORTE_GRADE_NOVA", "DATA_CORTE_GRADE_SEIS", "HORARIOS_LEGADOS", "HORARIOS_NOVOS", "HORARIOS_SEIS",
    `${corpo}; return ${nomeFuncao};`
  )(DATA_CORTE_GRADE_NOVA, DATA_CORTE_GRADE_SEIS, HORARIOS_LEGADOS, HORARIOS_NOVOS, HORARIOS_SEIS);
}

test("site publico espelha os cortes e as tres grades canonicas", () => {
  conferirConstantes(sitePublico);
  const resolver = montarResolver(sitePublico, "horariosPadraoParaDataPublica");
  for (const [data, esperado] of DATAS_DE_CONTROLE) assert.deepEqual(resolver(data), esperado, data);
});

test("painel da recepcao espelha os cortes e as tres grades canonicas", () => {
  conferirConstantes(painel);
  // A grade em vigor para datas novas alimenta o editor semanal e o campo legado `horarios`.
  assert.match(painel, /const\s+HORARIOS_PADRAO\s*=\s*HORARIOS_SEIS\s*;/);
  const resolver = montarResolver(painel, "horariosPadraoParaDataPainel");
  for (const [data, esperado] of DATAS_DE_CONTROLE) assert.deepEqual(resolver(data), esperado, data);
});

test("nenhuma superficie mantem migracao por igualdade ou uniao cega", () => {
  const todos = [
    fs.readFileSync(path.join(__dirname, "index.js"), "utf8"),
    sitePublico,
    painel
  ].join("\n");
  assert.doesNotMatch(todos, /migrarGradeLegada/);
  assert.doesNotMatch(sitePublico, /\.\.\.base\s*,\s*\.\.\.HOR/);
  assert.doesNotMatch(painel, /\.\.\.base\s*,\s*\.\.\.HORARIOS_PADRAO/);
});
