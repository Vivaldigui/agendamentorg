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
  // Medido em canal de pre-visualizacao (revisao-painel, 26/08/2026): quando
  // duas entradas casam, o Hosting acumula as chaves diferentes e resolve a
  // chave repetida pela ULTIMA. /recepcao.html recebeu um unico
  // Content-Security-Policy, o restrito, e continuou recebendo X-Frame-Options,
  // nosniff e os demais cabecalhos da entrada "**". Mover esta entrada para
  // cima devolve a politica permissiva ao painel, em silencio.
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

// ---------------------------------------------------------------------------
// O reCAPTCHA do App Check faz um fetch do documento pai para
// https://www.google.com/recaptcha/api2/clr. O painel liberou isso em 26/08,
// mas a politica global ficou como estava e o SITE PUBLICO seguia bloqueando
// quatro vezes por carregamento -- verificado no navegador contra producao em
// 29/08, dois dias antes de uma abertura. `clr` e o canal por onde o reCAPTCHA
// devolve sinal ao Google; bloqueado, o motor de risco decide com menos
// informacao, e e explicacao plausivel para atestacoes que falham em aparelhos
// especificos.
// ---------------------------------------------------------------------------

test("as DUAS politicas liberam o fetch que o reCAPTCHA faz de verdade", () => {
  for (const origem of ["**", "/recepcao.html"]) {
    assert.ok(
      diretiva(cspDe(origem), "connect-src").includes("https://www.google.com"),
      `${origem}: sem www.google.com em connect-src, o reCAPTCHA e bloqueado 4x por carga.`
    );
  }
});

test("o dominio liberado ja era confiavel nas outras diretivas", () => {
  // Nao e ampliacao de superficie: www.google.com ja carregava script e iframe
  // nas duas politicas. So faltava o canal de volta.
  for (const origem of ["**", "/recepcao.html"]) {
    assert.ok(diretiva(cspDe(origem), "script-src").includes("https://www.google.com"), `${origem}: script-src`);
    assert.ok(diretiva(cspDe(origem), "frame-src").includes("https://www.google.com"), `${origem}: frame-src`);
  }
});

test("o site publico nao herdou a folga do painel em script-src", () => {
  // O painel perdeu 'unsafe-inline' porque nao tem mais codigo embutido. O site
  // publico ainda tem, entao a politica global mantem. Liberar connect-src nao
  // pode ser desculpa para afrouxar o resto.
  assert.ok(diretiva(cspDe("**"), "script-src").includes("'unsafe-inline'"));
  assert.ok(!diretiva(cspDe("/recepcao.html"), "script-src").includes("'unsafe-inline'"));
});

// ---------------------------------------------------------------------------
// A trava de precedencia acima olha CADA bloco isoladamente. Auditoria de 29/08
// mostrou que isso nao prova o CSP EFETIVO: o Hosting aplica todos os blocos
// cujo padrao casa e, para a mesma chave, vence o ULTIMO. Bastava um segundo
// bloco "**" depois de /recepcao.html para o painel voltar a aceitar
// 'unsafe-inline' com as duas guardas verdes.
// ---------------------------------------------------------------------------

// Reproduz o casamento de padrao do Hosting para os globs usados aqui.
function casa(padrao, caminho) {
  if (padrao === caminho) return true;
  if (padrao === "**") return true;
  if (padrao.startsWith("**/")) return caminho.endsWith(padrao.slice(2));
  if (padrao.endsWith("/**")) return caminho.startsWith(padrao.slice(0, -2));
  return false;
}

function cspEfetivo(caminho) {
  let valor = null;
  for (const bloco of hosting.headers) {
    if (!casa(bloco.source, caminho)) continue;
    const h = (bloco.headers || []).find(x => x.key === "Content-Security-Policy");
    if (h) valor = h.value; // ultimo que casa vence
  }
  return valor;
}

test("o CSP EFETIVO do painel e o restrito, nao o global", () => {
  const efetivo = cspEfetivo("/recepcao.html");
  assert.ok(efetivo, "Nenhum CSP casaria com /recepcao.html.");
  assert.equal(
    diretiva(efetivo, "script-src").includes("'unsafe-inline'"),
    false,
    "Um bloco depois de /recepcao.html devolveu 'unsafe-inline' ao painel."
  );
  assert.equal(efetivo, cspDe("/recepcao.html"), "O bloco especifico tem de ser o vencedor.");
});

test("o CSP EFETIVO do site publico continua sendo o global", () => {
  const efetivo = cspEfetivo("/index.html");
  assert.equal(efetivo, cspDe("**"));
  assert.ok(diretiva(efetivo, "script-src").includes("'unsafe-inline'"),
    "O site publico ainda tem codigo embutido e depende disso.");
  assert.ok(diretiva(efetivo, "connect-src").includes("https://www.google.com"),
    "Sem isto o reCAPTCHA e bloqueado 4x por carga no site que recebe o pico.");
});
