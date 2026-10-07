"use strict";

// A telemetria de presenca no Realtime Database (presenca_publica, gatilhos
// onValueCreated/onValueDeleted e a flag METRICAS_ACESSO_PUBLICO_ATIVAS) foi
// removida em 07/10/2026. Ela ficou desligada desde 17/08 porque cada acesso
// lia o no inteiro de conexoes e disputava uma transacao num unico contador.
// A contagem de visitas agora e functions/visitas.js (Firestore, fragmentos).
// Estas travas impedem que o caminho antigo volte aos poucos.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const { painel, painelHtml } = require("./painel-fonte");

test("site publico nao fala mais com o Realtime Database", () => {
  assert.doesNotMatch(sitePublico, /firebase-database\.js/);
  assert.doesNotMatch(sitePublico, /firebase\.database|presenca_publica|METRICAS_ACESSO_PUBLICO_ATIVAS/);
});

test("painel nao carrega o SDK do Realtime Database nem os cartoes antigos", () => {
  assert.doesNotMatch(painelHtml, /firebase-database\.js/);
  assert.doesNotMatch(painel, /firebase\.database|presenca_publica|METRICAS_ACESSO_PUBLICO_ATIVAS|acessos-tempo-real/);
});

test("backend nao tem mais gatilho nem limpeza do Realtime Database", () => {
  assert.doesNotMatch(backend, /firebase-admin\/database|firebase-functions\/v2\/database/);
  assert.doesNotMatch(backend, /onValueCreated|onValueDeleted|presenca_publica|getDatabase/);
});

test("o Realtime Database fica fechado para leitura e escrita", () => {
  const regras = JSON.parse(fs.readFileSync(path.join(raiz, "database.rules.json"), "utf8"));
  assert.deepEqual(regras, { rules: { ".read": false, ".write": false } });
});
