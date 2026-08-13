"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");
const painel = fs.readFileSync(path.join(raiz, "public", "recepcao.html"), "utf8");
const readme = fs.readFileSync(path.join(raiz, "README.md"), "utf8");

test("site publico nao abre conexao de telemetria enquanto a medicao esta desativada", () => {
  assert.match(sitePublico, /const\s+METRICAS_ACESSO_PUBLICO_ATIVAS\s*=\s*false\s*;/);
  assert.match(sitePublico, /function\s+registrarPresencaPublica\(\)\s*\{\s*if\s*\(!METRICAS_ACESSO_PUBLICO_ATIVAS\s*\|\|\s*!realtimeDb\)\s*return\s*;/);
});

test("painel informa explicitamente que a medicao esta desativada", () => {
  assert.match(painel, /const\s+METRICAS_ACESSO_PUBLICO_ATIVAS\s*=\s*false\s*;/);
  assert.equal((painel.match(/Medição desativada/g) || []).length >= 3, true);
  assert.match(painel, /if\s*\(!METRICAS_ACESSO_PUBLICO_ATIVAS\)/);
});

test("README registra a condicao necessaria para religar a telemetria", () => {
  assert.match(readme, /telemetria[^\n]*desativada/i);
  assert.match(readme, /idempot[^\n]*shards|shards[^\n]*idempot/i);
  assert.match(readme, /homologa/i);
});
