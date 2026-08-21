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
  // Religar exige a flag E a tag do SDK; so a flag deixa realtimeDb nulo.
  assert.match(readme, /firebase-database\.js/);
  assert.match(readme, /METRICAS_ACESSO_PUBLICO_ATIVAS/);
});

test("religar a telemetria exige a flag e o SDK do Realtime Database juntos", () => {
  const flag = sitePublico.match(/const\s+METRICAS_ACESSO_PUBLICO_ATIVAS\s*=\s*(true|false)\s*;/);
  assert.ok(flag, "flag METRICAS_ACESSO_PUBLICO_ATIVAS nao encontrada no site publico.");
  const medicaoLigada = flag[1] === "true";
  const carregaSdk = /<script[^>]+firebasejs\/[\d.]+\/firebase-database\.js/.test(sitePublico);

  // Com a medicao ligada e sem a tag, registrarPresencaPublica desiste em
  // silencio porque realtimeDb fica nulo: a telemetria pareceria funcionar.
  assert.equal(
    medicaoLigada && !carregaSdk,
    false,
    "METRICAS_ACESSO_PUBLICO_ATIVAS=true exige a tag do firebase-database.js em public/index.html."
  );

  // Com a medicao desligada o SDK nao pode voltar a pesar no site do cidadao.
  if (!medicaoLigada) {
    assert.equal(
      carregaSdk,
      false,
      "Com a medicao desligada, o site publico nao deve carregar firebase-database.js."
    );
  }

  // A degradacao continua sendo silenciosa por construcao, nunca um erro.
  assert.match(sitePublico, /var realtimeDb = firebase\.database \? firebase\.database\(\) : null;/);
  // O painel da recepcao segue usando o Realtime Database.
  assert.match(painel, /firebasejs\/[\d.]+\/firebase-database\.js/);
});
