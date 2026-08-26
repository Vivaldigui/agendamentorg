"use strict";

// O painel da recepcao deixou de ser um arquivo unico: markup em
// public/recepcao.html, estilo em public/recepcao.css e comportamento em
// public/recepcao.js. As travas de regressao continuam valendo sobre a
// superficie inteira, entao aqui ela e remontada na ordem original --
// markup primeiro, para que as verificacoes que fatiam o texto em volta de
// uma ancora de HTML continuem enxergando a vizinhanca certa.

const fs = require("node:fs");
const path = require("node:path");

const raizPublica = path.resolve(__dirname, "..", "public");
const ler = nome => fs.readFileSync(path.join(raizPublica, nome), "utf8");

const painelHtml = ler("recepcao.html");
const painelCss = ler("recepcao.css");
const painelJs = ler("recepcao.js");

module.exports = {
  painelHtml,
  painelCss,
  painelJs,
  painel: [painelHtml, painelCss, painelJs].join("\n")
};
