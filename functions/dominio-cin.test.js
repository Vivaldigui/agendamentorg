"use strict";

// Endereco oficial do servico: cin.itanhandu.cam.mg.gov.br, desde 15/09/2026.
// Sem a origem na lista de CORS das callables, o site abre no dominio novo mas
// consultar, cancelar, confirmar agendamento e o painel falham no navegador.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), "utf8");
const NOVO = "https://cin.itanhandu.cam.mg.gov.br";

function origensCors() {
  const backend = ler("functions", "index.js");
  const bloco = /const callableOptions = \{\s*cors: \[([\s\S]*?)\]/.exec(backend);
  assert.ok(bloco, "lista cors de callableOptions nao encontrada.");
  return [...bloco[1].replace(/^\s*\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("as callables aceitam o dominio oficial e os enderecos padrao do Firebase", () => {
  const origens = origensCors();
  for (const origem of [NOVO, "https://agendamento-cin-itanhandu.web.app", "https://agendamento-cin-itanhandu.firebaseapp.com"]) {
    assert.ok(origens.includes(origem), `origem ausente no CORS: ${origem}`);
  }
  assert.equal(new Set(origens).size, origens.length, "origem duplicada no CORS.");
  for (const origem of origens) assert.match(origem, /^https:\/\/[a-z0-9.-]+$/, `origem invalida: ${origem}`);
});

test("o canal temporario de revisao, expirado em 02/09/2026, saiu do CORS", () => {
  assert.ok(!origensCors().some((origem) => origem.includes("--revisao-painel-")));
});

test("todas as opcoes publicas herdam a lista de CORS", () => {
  const backend = ler("functions", "index.js");
  assert.match(backend, /const publicCallableOptions = \{\s*\.\.\.callableOptions,/);
  assert.match(backend, /const agendamentoPicoOptions = \{\s*\.\.\.publicCallableOptions,/);
  assert.match(backend, /const verificacaoSlotOptions = \{\s*\.\.\.publicCallableOptions,/);
});

test("home, editorial e sitemap usam o dominio oficial como endereco canonico", () => {
  const home = ler("public", "index.html");
  assert.ok(home.includes(`<link rel="canonical" href="${NOVO}/">`));
  assert.ok(!home.includes("agendamento-cin-itanhandu.web.app"), "a home ainda cita o web.app.");
  assert.equal(JSON.parse(ler("editorial", "config.json")).urlBase, NOVO);
  const locs = [...ler("public", "sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length > 0 && locs.every((loc) => loc.startsWith(`${NOVO}/`)), "sitemap com URL fora do dominio oficial.");
  assert.match(ler("public", "robots.txt"), new RegExp(`Sitemap: ${NOVO.replace(/\./g, "\.")}/sitemap\.xml`));
});
