"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DATA_CORTE_GRADE_NOVA,
  HORARIOS_LEGADOS,
  HORARIOS_NOVOS
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

test("site publico espelha o corte e as duas grades canonicas", () => {
  assert.equal(constanteTexto(sitePublico, "DATA_CORTE_GRADE_NOVA"), DATA_CORTE_GRADE_NOVA);
  assert.deepEqual(constanteLista(sitePublico, "HORARIOS_LEGADOS"), HORARIOS_LEGADOS);
  assert.deepEqual(constanteLista(sitePublico, "HORARIOS_NOVOS"), HORARIOS_NOVOS);
  const codigoFuncao = extrairFuncao(sitePublico, "horariosPadraoParaDataPublica");
  const resolver = new Function("DATA_CORTE_GRADE_NOVA", "HORARIOS_LEGADOS", "HORARIOS_NOVOS", `${codigoFuncao}; return horariosPadraoParaDataPublica;`)(
    DATA_CORTE_GRADE_NOVA, HORARIOS_LEGADOS, HORARIOS_NOVOS
  );
  assert.deepEqual(resolver("2026-08-17"), HORARIOS_LEGADOS);
  assert.deepEqual(resolver("2026-08-18"), HORARIOS_NOVOS);
});

test("painel da recepcao espelha o corte e as duas grades canonicas", () => {
  assert.equal(constanteTexto(painel, "DATA_CORTE_GRADE_NOVA"), DATA_CORTE_GRADE_NOVA);
  assert.deepEqual(constanteLista(painel, "HORARIOS_LEGADOS"), HORARIOS_LEGADOS);
  assert.deepEqual(constanteLista(painel, "HORARIOS_PADRAO"), HORARIOS_NOVOS);
  const codigoFuncao = extrairFuncao(painel, "horariosPadraoParaDataPainel");
  const resolver = new Function("DATA_CORTE_GRADE_NOVA", "HORARIOS_LEGADOS", "HORARIOS_PADRAO", `${codigoFuncao}; return horariosPadraoParaDataPainel;`)(
    DATA_CORTE_GRADE_NOVA, HORARIOS_LEGADOS, HORARIOS_NOVOS
  );
  assert.deepEqual(resolver("2026-08-17"), HORARIOS_LEGADOS);
  assert.deepEqual(resolver("2026-08-18"), HORARIOS_NOVOS);
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
