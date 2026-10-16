"use strict";

// Admin so com e-mail verificado (auditoria de 16/10/2026, SEG-03).
//
// A identidade do admin era apenas request.auth.token.email. Conta de e-mail e
// senha pode ser criada pelo proprio cliente com qualquer endereco, sem prova
// de posse: se um e-mail listado em admins ainda nao tivesse conta, quem a
// criasse primeiro herdaria o painel inteiro. Regras, callables e painel
// passam a exigir email_verified.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { painelJs } = require("./painel-fonte");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const regras = fs.readFileSync(path.join(raiz, "firestore.rules"), "utf8");
const painelHtml = fs.readFileSync(path.join(raiz, "public", "recepcao.html"), "utf8");

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

function montarAssertAdmin(admins) {
  const leituras = [];
  const db = {
    collection: (colecao) => ({
      doc: (id) => ({
        get: async () => {
          leituras.push(`${colecao}/${id}`);
          const dados = admins[id];
          return { exists: dados !== undefined, data: () => dados };
        }
      })
    })
  };
  const assertAdmin = new Function(
    "db", "HttpsError",
    `${extrairFuncao(backend, "assertAdmin")}; return assertAdmin;`
  )(db, ErroFalso);
  return { assertAdmin, leituras };
}

const pedido = (token) => ({ auth: token ? { token } : undefined });

// ---- Backend --------------------------------------------------------------------

test("assertAdmin aceita admin ativo com e-mail verificado", async () => {
  const { assertAdmin } = montarAssertAdmin({ "recepcao@camara.gov.br": { ativo: true } });
  assert.equal(await assertAdmin(pedido({ email: "Recepcao@Camara.gov.br", email_verified: true })), "recepcao@camara.gov.br");
});

test("assertAdmin recusa e-mail nao verificado sem nem consultar admins", async () => {
  const { assertAdmin, leituras } = montarAssertAdmin({ "recepcao@camara.gov.br": { ativo: true } });
  for (const verificado of [false, undefined, "true", 1]) {
    await assert.rejects(
      () => assertAdmin(pedido({ email: "recepcao@camara.gov.br", email_verified: verificado })),
      (e) => e.code === "permission-denied",
      String(verificado)
    );
  }
  assert.deepEqual(leituras, []);
});

test("assertAdmin continua recusando admin inativo, ausente e chamada anonima", async () => {
  const { assertAdmin } = montarAssertAdmin({ "inativo@camara.gov.br": { ativo: false } });
  for (const token of [
    { email: "inativo@camara.gov.br", email_verified: true },
    { email: "ninguem@camara.gov.br", email_verified: true },
    { email_verified: true },
    null
  ]) {
    await assert.rejects(() => assertAdmin(pedido(token)), (e) => e.code === "permission-denied");
  }
});

test("todas as callables administrativas passam por assertAdmin", () => {
  for (const nome of ["criarEncaixeManual", "atualizarObservacaoAdmin", "remarcarAgendamentoAdmin", "cancelarAgendamentoAdmin", "listarLogsAdmin", "gerarBackupAdmin"]) {
    const inicio = backend.indexOf(`exports.${nome} =`);
    assert.notEqual(inicio, -1, nome);
    assert.match(backend.slice(inicio, inicio + 200), /await assertAdmin\(request\)/, nome);
  }
});

// ---- Regras -------------------------------------------------------------------------

test("isAdmin() nas regras exige email_verified", () => {
  const isAdmin = regras.slice(regras.indexOf("function isAdmin()"), regras.indexOf("match /admins/"));
  assert.match(isAdmin, /request\.auth\.token\.email_verified == true/);
  assert.match(isAdmin, /exists\(\/databases\/\$\(database\)\/documents\/admins\/\$\(request\.auth\.token\.email\)\)/);
});

test("SEG-01: admins so le o proprio documento e ninguem grava pelo navegador", () => {
  const inicio = regras.indexOf("match /admins/{adminEmail} {");
  const bloco = regras.slice(inicio, regras.indexOf("\n    }", inicio));
  assert.match(bloco, /allow get: if isSignedIn\(\)[\s\S]*email_verified == true[\s\S]*request\.auth\.token\.email\.lower\(\) == adminEmail;/);
  assert.match(bloco, /allow list, write: if false;/);
  assert.doesNotMatch(bloco, /allow (create|update|delete)|isAdmin\(\)/);
  // O painel so le o documento do proprio e-mail, ja em minusculas.
  assert.match(painelJs, /const email = String\(user && user\.email \|\| ""\)\.trim\(\)\.toLowerCase\(\);/);
  assert.doesNotMatch(painelJs, /collection\("admins"\)\.(add|doc\([^)]*\)\.(set|update|delete))/);
});

// ---- Painel ---------------------------------------------------------------------------

function montarValidacao(admins) {
  const leituras = [];
  const db = {
    collection: (colecao) => ({
      doc: (id) => ({
        get: async () => {
          leituras.push(`${colecao}/${id}`);
          const dados = admins[id];
          return { exists: dados !== undefined, data: () => dados };
        }
      })
    })
  };
  const validar = new Function("db", `${extrairFuncao(painelJs, "validarAdministradorAtivo")}; return validarAdministradorAtivo;`)(db);
  return { validar, leituras };
}

test("painel trata e-mail nao verificado antes de consultar admins", async () => {
  const { validar, leituras } = montarValidacao({ "recepcao@camara.gov.br": { ativo: true } });
  await assert.rejects(
    () => validar({ email: "recepcao@camara.gov.br", emailVerified: false }),
    (e) => e.code === "email-nao-verificado"
  );
  assert.deepEqual(leituras, []);
  await validar({ email: "recepcao@camara.gov.br", emailVerified: true });
  assert.deepEqual(leituras, ["admins/recepcao@camara.gov.br"]);
});

test("e-mail nao verificado abre a confirmacao, sem derrubar a sessao nem dizer 'revogado'", () => {
  const inicio = painelJs.indexOf("auth.onAuthStateChanged");
  const bloco = painelJs.slice(inicio, painelJs.indexOf("async function fazerLogin", inicio));
  const naoVerificado = bloco.indexOf('e.code === "email-nao-verificado"');
  const revogado = bloco.indexOf("await encerrarSessaoPorAcessoRevogado(e)");
  assert.ok(naoVerificado > 0 && naoVerificado < revogado);
  const ramo = bloco.slice(naoVerificado, revogado);
  assert.match(ramo, /mostrarVerificacaoEmail\(user\);\s*return;/);
  assert.doesNotMatch(ramo, /signOut/);
});

test("conferir a confirmacao renova o token antes de recarregar", () => {
  const conferir = extrairFuncao(painelJs, "conferirEmailVerificado");
  const reload = conferir.indexOf("await user.reload()");
  const token = conferir.indexOf("getIdToken(true)");
  const recarregar = conferir.indexOf("window.location.reload()");
  assert.ok(reload > 0 && reload < token && token < recarregar, "Sem token novo as regras seguem recusando por ate uma hora.");
});

test("botoes da confirmacao estao ligados ao despachante de acoes", () => {
  for (const acao of ["enviarVerificacaoEmail", "conferirEmailVerificado", "fazerLogout"]) {
    assert.match(painelHtml, new RegExp(`data-acao="${acao}"`), acao);
  }
  const acoes = painelJs.slice(painelJs.indexOf("const ACOES_CLIQUE = {"), painelJs.indexOf("const ACOES_CAMPO"));
  assert.match(acoes, /enviarVerificacaoEmail, conferirEmailVerificado,/);
  assert.match(painelHtml, /id="verificacao-email-status"[^>]*role="status"[^>]*aria-live="polite"/);
});

// ---- Script de diagnostico ---------------------------------------------------------------

test("script de diagnostico so altera conta com --marcar-verificado explicito", () => {
  const script = fs.readFileSync(path.join(raiz, "scripts", "verificar-admins.js"), "utf8");
  const marcar = script.indexOf("if (MARCAR) {");
  const update = script.indexOf("auth.updateUser(");
  assert.ok(marcar > 0 && update > marcar, "updateUser so dentro do ramo de --marcar-verificado.");
  assert.equal(script.split("auth.updateUser(").length, 2, "Um unico ponto de escrita no Auth.");
  assert.match(script.slice(marcar, update), /ativo !== true/, "So marca quem e admin ativo.");
});
