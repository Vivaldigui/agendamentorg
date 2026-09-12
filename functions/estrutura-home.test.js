"use strict";

// Estrutura de cabecalhos e tamanho da description do site do cidadao. Os dois
// achados da auditoria de 12/09/2026 — a pagina saltava de h1 para h3, e a
// description tinha 161 caracteres — voltariam em silencio: nada quebra na
// tela, o Google apenas corta o trecho e o leitor de tela perde a hierarquia.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

// O comprovante em PDF e montado como string dentro de um <script> e tem o
// proprio h1. So a marcacao servida ao navegador entra na analise.
const marcacao = sitePublico.replace(/<script[\s\S]*?<\/script>/g, "");

function niveisDeCabecalho(html) {
  return [...html.matchAll(/<h([1-6])[\s>]/g)].map((achado) => Number(achado[1]));
}

test("a home tem exatamente um h1", () => {
  const sequencia = niveisDeCabecalho(marcacao);
  assert.equal(sequencia.filter((nivel) => nivel === 1).length, 1);
  assert.equal(sequencia[0], 1, "o primeiro cabecalho da pagina precisa ser o h1.");
});

test("a hierarquia de cabecalhos nao pula nivel", () => {
  const sequencia = niveisDeCabecalho(marcacao);
  assert.ok(sequencia.length >= 5, "esperado ao menos cinco cabecalhos na marcacao.");
  for (let i = 1; i < sequencia.length; i++) {
    const anterior = sequencia[i - 1];
    const atual = sequencia[i];
    assert.ok(
      atual - anterior <= 1,
      `h${anterior} seguido de h${atual}: descer mais de um nivel de uma vez quebra a hierarquia.`
    );
  }
});

test("a description cabe no trecho exibido pelo Google", () => {
  const achado = /<meta name="description" content="([^"]*)"/.exec(sitePublico);
  assert.ok(achado, "meta description ausente.");
  const tamanho = achado[1].length;
  assert.ok(tamanho >= 70 && tamanho <= 160, `description com ${tamanho} caracteres; use de 70 a 160.`);
});

test("a og:description cabe no cartao compartilhado", () => {
  const achado = /<meta property="og:description" content="([^"]*)"/.exec(sitePublico);
  assert.ok(achado, "og:description ausente.");
  const tamanho = achado[1].length;
  assert.ok(tamanho <= 160, `og:description com ${tamanho} caracteres; use ate 160.`);
});
