"use strict";

// Trava do CSP proprio do painel (firebase.json).
//
// Depois que o painel deixou de ter script e handler embutidos, ele nao precisa
// mais de 'unsafe-inline' em script-src. O cabecalho global nao pode ser
// apertado junto: vale para "**" e o site publico ainda tem codigo embutido.
// Por isso /recepcao.html ganhou politica propria.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { painelHtml } = require("./painel-fonte");

const raiz = path.resolve(__dirname, "..");
const hosting = JSON.parse(fs.readFileSync(path.join(raiz, "firebase.json"), "utf8")).hosting;
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

const cspDe = origem => {
  const entrada = hosting.headers.find(h => h.source === origem);
  if (!entrada) return null;
  const cabecalho = entrada.headers.find(h => h.key === "Content-Security-Policy");
  return cabecalho ? cabecalho.value : null;
};

const diretiva = (csp, nome) => {
  const parte = csp.split(";").map(p => p.trim()).find(p => p.startsWith(nome + " "));
  return parte ? parte.slice(nome.length).trim().split(/\s+/) : [];
};

test("o painel tem politica propria, sem inline nem eval no script-src", () => {
  const csp = cspDe("/recepcao.html");
  assert.ok(csp, "/recepcao.html precisa de um Content-Security-Policy proprio.");
  const scripts = diretiva(csp, "script-src");
  assert.equal(scripts.includes("'unsafe-inline'"), false,
    "O painel nao tem mais codigo embutido; 'unsafe-inline' devolveria a brecha de graca.");
  assert.equal(scripts.includes("'unsafe-eval'"), false);
  assert.equal(scripts.includes("'self'"), true, "/recepcao.js precisa poder rodar.");
});

test("a politica do painel libera todos os scripts externos que ele carrega", () => {
  // Uma origem esquecida aqui quebra o login sem erro obvio para quem opera.
  const permitidas = diretiva(cspDe("/recepcao.html"), "script-src");
  const usadas = [...painelHtml.matchAll(/<script src="(https:\/\/[^/"]+)/g)].map(m => m[1]);
  assert.equal(usadas.length > 0, true, "Nenhum script externo encontrado no painel.");
  const bloqueadas = [...new Set(usadas)].filter(o => !permitidas.includes(o));
  assert.deepEqual(bloqueadas, [], `Origens de script fora do CSP do painel: ${bloqueadas.join(", ")}`);
});

test("a politica do painel e a ultima da lista", () => {
  // O Hosting nao documenta com clareza o que acontece quando duas entradas
  // casam. Ficando por ultimo, o painel vence tanto se valer a ultima quanto se
  // valerem as duas (o navegador aplica a interseccao, que e esta). Se valer a
  // primeira, o painel apenas continua com a politica global de hoje -- perde o
  // ganho, nao quebra.
  const ultima = hosting.headers[hosting.headers.length - 1];
  assert.equal(ultima.source, "/recepcao.html");
});

test("o CSP global segue permitindo inline enquanto o site publico tiver codigo embutido", () => {
  // Esta e a razao de o painel ter politica propria em vez de a global ser
  // apertada. No dia em que index.html for limpo, este teste passa a cobrar a
  // troca -- e ai a entrada do painel pode ser dispensada.
  const embutidoNoSite = /<script>/.test(sitePublico) || /\son[a-z]+="/.test(sitePublico);
  const global = diretiva(cspDe("**"), "script-src");
  assert.equal(global.includes("'unsafe-inline'"), embutidoNoSite,
    embutidoNoSite
      ? "index.html ainda tem codigo embutido: apertar o CSP global derruba o site."
      : "index.html nao tem mais codigo embutido: tire 'unsafe-inline' do CSP global.");
});

test("estilo continua com inline liberado, por causa dos atributos style", () => {
  // style-src nao pode ser apertado junto: o markup usa style="..." em varios
  // pontos, e as janelas de impressao levam <style> proprio.
  const estilos = diretiva(cspDe("/recepcao.html"), "style-src");
  assert.equal(estilos.includes("'unsafe-inline'"), true);
  assert.match(painelHtml, /\sstyle="/, "Se os atributos style sumirem, aperte tambem o style-src.");
});

test("recepcao.js e recepcao.css nao ficam em cache junto com HTML novo", () => {
  for (const arquivo of ["/recepcao.js", "/recepcao.css"]) {
    const entrada = hosting.headers.find(h => h.source === arquivo);
    assert.ok(entrada, `${arquivo} precisa de Cache-Control proprio.`);
    const cache = entrada.headers.find(h => h.key === "Cache-Control");
    assert.match(cache.value, /no-cache/,
      `Sem isso ${arquivo} cai no padrao do Hosting e o painel serve markup novo com comportamento velho.`);
  }
});
