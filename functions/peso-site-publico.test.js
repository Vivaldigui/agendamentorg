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

test("o Instagram usa SVG inline; o botao do WhatsApp e so texto", () => {
  const svgs = sitePublico.match(/<svg class="icone-marca"[\s\S]*?<\/svg>/g) || [];
  assert.equal(svgs.length, 1, "so o Instagram usa marca em SVG.");

  const instagram = svgs[0];
  assert.match(instagram, /viewBox="0 0 24 24"/);
  // Decorativo: o rotulo textual do link ja diz do que se trata.
  assert.match(instagram, /aria-hidden="true"/);
  assert.match(instagram, /focusable="false"/);
  // Herdar a cor evita CSS extra e funciona sobre o gradiente.
  assert.match(instagram, /currentColor/);
  assert.match(sitePublico, /<a class="btn-instagram"[^>]*href="https:\/\/www\.instagram\.com\/camaraitanhandu\/"/);

  // O botao do WhatsApp ficou sem icone por decisao de design: o rotulo basta.
  assert.match(
    sitePublico,
    /<button class="btn-acao-sucesso whatsapp" onclick="enviarConfirmacaoWhatsApp\(\)">Enviar no WhatsApp<\/button>/
  );

  // Dimensionamento acompanha o texto.
  assert.match(sitePublico, /\.icone-marca \{[^}]*width: 1\.15em;[^}]*height: 1\.15em;/);
});
