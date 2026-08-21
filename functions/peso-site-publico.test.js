"use strict";

// Guardas de peso do site do cidadao. Cada recurso extra no caminho critico e
// pago por todo mundo que abre a pagina no celular, muitas vezes em rede fraca,
// e o pico acontece todo no mesmo minuto.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

const SDKS_ESPERADOS = [
  "firebase-analytics.js",
  "firebase-app-check.js",
  "firebase-app.js",
  "firebase-functions.js"
];

test("site publico carrega apenas os SDKs do Firebase que usa", () => {
  const carregados = [...sitePublico.matchAll(/<script[^>]+firebasejs\/[\d.]+\/(firebase-[\w-]+\.js)/g)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(carregados, SDKS_ESPERADOS);
});

test("nenhum icone depende da familia brands do Font Awesome", () => {
  // Uma unica classe fa-brands faz o navegador baixar fa-brands-400.woff2
  // inteiro (102 KB) — nao adianta trocar so um dos dois icones.
  assert.equal(/class="[^"]*\bfa-brands\b/.test(sitePublico), false);
  assert.equal(/class="[^"]*\bfab\b/.test(sitePublico), false);
});

test("WhatsApp e Instagram usam marca em SVG inline", () => {
  const svgs = sitePublico.match(/<svg class="icone-marca"[\s\S]*?<\/svg>/g) || [];
  assert.equal(svgs.length, 2, "esperado um SVG de marca para WhatsApp e outro para Instagram.");

  for (const svg of svgs) {
    assert.match(svg, /viewBox="0 0 24 24"/);
    // Decorativo: o rotulo textual do botao ja diz do que se trata.
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
    // Herdar a cor evita CSS extra e funciona no fundo verde e no gradiente.
    assert.match(svg, /currentColor/);
    // Sem fill solido: as duas marcas sao tracadas.
    assert.match(svg, /stroke="currentColor"/);
  }

  // Os dois destinos seguem corretos.
  assert.match(sitePublico, /<button class="btn-acao-sucesso whatsapp"[^>]*>\s*<svg class="icone-marca"/);
  assert.match(sitePublico, /<a class="btn-instagram"[^>]*href="https:\/\/www\.instagram\.com\/camaraitanhandu\/"/);

  // Dimensionamento acompanha o texto do botao.
  assert.match(sitePublico, /\.icone-marca \{[^}]*width: 1\.15em;[^}]*height: 1\.15em;/);
});
