"use strict";

// SDK 12.19.0 (compat) e token de App Check de uso unico na criacao do
// agendamento (auditoria de 16/10/2026, MAN-01 + CON-02).
//
// Com o SDK 8.10.1 o site so tinha o token comum, valido por ate uma hora: um
// token copiado de um navegador real servia para um script disparar dezenas
// de reservas. Agora o site pede um token novo a cada criacao e o backend o
// consome; reaproveitado, ele e recusado.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { painelHtml } = require("./painel-fonte");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");
const painel = painelHtml || fs.readFileSync(path.join(raiz, "public", "recepcao.html"), "utf8");

function extrairFuncao(codigo, nome) {
  const marcador = new RegExp(`(?:async )?function ${nome}\\(`).exec(codigo);
  assert.ok(marcador, `Funcao ${nome} nao encontrada.`);
  let nivel = 0;
  for (let i = codigo.indexOf("{", codigo.indexOf(")", marcador.index)); i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}" && --nivel === 0) return codigo.slice(marcador.index, i + 1);
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

class ErroFalso extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const VERSAO_SDK = "12.19.0";

test("site e painel usam o mesmo SDK compat, nenhum resto da 8.10.1", () => {
  for (const [nome, html] of [["site", sitePublico], ["painel", painel]]) {
    const versoes = [...html.matchAll(/firebasejs\/([\d.]+)\/firebase-[\w-]+\.js/g)].map((m) => m[1]);
    assert.ok(versoes.length > 0, nome);
    assert.deepEqual([...new Set(versoes)], [VERSAO_SDK], nome);
    assert.doesNotMatch(html, /firebasejs\/8\./, nome);
    for (const m of html.matchAll(/firebasejs\/[\d.]+\/(firebase-[\w-]+)\.js/g)) {
      assert.match(m[1], /-compat$/, `${nome}: ${m[1]} precisa ser a versao compat (API namespaced).`);
    }
  }
});

test("so a criacao pede token de uso unico; as demais callables seguem com o token comum", () => {
  const opcoes = new Function("return " + /var OPCOES_CALLABLE = (\{[\s\S]*?\n    \});/.exec(sitePublico)[1])();
  assert.deepEqual(opcoes, { criarAgendamentoCidadao: { limitedUseAppCheckTokens: true } });
  // Cada chamada de chamarFuncao passa as opcoes da callable.
  const chamar = extrairFuncao(sitePublico, "chamarFuncao");
  const chamadas = chamar.match(/httpsCallable\(nome, OPCOES_CALLABLE\[nome\]\)\(dados\)/g) || [];
  assert.equal(chamadas.length, 2, "Chamada normal e a repeticao depois de renovar o token.");
});

test("backend consome o token na criacao, e so nela", () => {
  // Religado em 16/10/2026 depois de conceder roles/firebaseappcheck.tokenVerifier
  // a conta de servico; sem o papel, toda criacao volta 401.
  const semComentarios = backend.replace(/\/\/[^\n]*/g, "");
  const inicio = semComentarios.indexOf("const agendamentoPicoOptions = {");
  const opcoes = semComentarios.slice(inicio, semComentarios.indexOf("};", inicio));
  assert.match(opcoes, /consumeAppCheckToken: true/);
  assert.equal((semComentarios.match(/consumeAppCheckToken: true/g) || []).length, 1, "Uso unico tem custo: so no ponto que reserva vaga.");
  const comentario = backend.slice(backend.indexOf("const agendamentoPicoOptions = {"), backend.indexOf("consumeAppCheckToken: true\n};"));
  assert.match(comentario, /roles\/firebaseappcheck\.tokenVerifier/, "A dependencia de IAM precisa ficar escrita junto da opcao.");
  assert.equal((backend.match(/onCall\(agendamentoPicoOptions/g) || []).length, 1, "agendamentoPicoOptions e exclusivo da criacao.");
  const criar = backend.slice(backend.indexOf("exports.criarAgendamentoCidadao"));
  assert.match(criar, /async \(request\) => \{\n  recusarTokenAppCheckReaproveitado\(request\);/, "A recusa vem antes de qualquer leitura.");
});

test("token reaproveitado e recusado com unauthenticated, para o site renovar e repetir", () => {
  const recusar = new Function(
    "HttpsError",
    `${extrairFuncao(backend, "recusarTokenAppCheckReaproveitado")}; return recusarTokenAppCheckReaproveitado;`
  )(ErroFalso);
  assert.throws(() => recusar({ app: { alreadyConsumed: true } }), (e) => e.code === "unauthenticated");
  assert.doesNotThrow(() => recusar({ app: { alreadyConsumed: false } }));
  assert.doesNotThrow(() => recusar({ app: {} }));
  assert.doesNotThrow(() => recusar({}));
  // O site trata unauthenticated como recusa de App Check: renova e repete uma vez.
  assert.match(extrairFuncao(sitePublico, "erroDeAppCheck"), /codigo === "unauthenticated"/);
});

test("painel continua com as APIs que usa disponiveis na versao compat", () => {
  // auth.setPersistence, firestore get({source}), FieldValue, httpsCallable e
  // appCheck().activate(chave, true) existem na API namespaced do compat.
  const js = fs.readFileSync(path.join(raiz, "public", "recepcao.js"), "utf8");
  assert.match(js, /firebase\.appCheck\(\)\.activate\(APP_CHECK_RECAPTCHA_SITE_KEY, true\)/);
  assert.match(js, /firebase\.auth\.Auth\.Persistence\.LOCAL/);
  assert.match(painel, /firebase-auth-compat\.js/);
  assert.match(painel, /firebase-firestore-compat\.js/);
});
