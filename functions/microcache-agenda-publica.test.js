"use strict";

// Microcache da leitura publica e IP confiavel nos limites (auditoria de
// 16/10/2026, PERF-01 e SEG-04).
//
// PERF-01: a URL de carregarAgendaPublicaHttp responde tambem fora do CDN, e
// cada pedido ali gravava uma transacao de rate limit e lia a agenda e todas
// as vagas futuras. Um script em laco virava conta de Firestore.
// SEG-04: os limites por IP usavam o PRIMEIRO X-Forwarded-For, que o
// chamador escreve; trocar o cabecalho zerava a contagem.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

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

// ---- Microcache -------------------------------------------------------------------

function montarMicrocache(leitura) {
  const contexto = { leituras: 0 };
  const fn = new Function(
    "carregarDisponibilidadePublica", "agoraSaoPauloInput",
    `const MICROCACHE_AGENDA_PUBLICA_MS = 2000;
     let microcacheAgendaPublica = null;
     ${extrairFuncao(backend, "disponibilidadePublicaComMicrocache")}
     return disponibilidadePublicaComMicrocache;`
  )(() => { contexto.leituras++; return leitura(contexto.leituras); }, () => "2026-10-19T08:00");
  return { pedir: fn, contexto };
}

test("pedidos dentro de 2s no mesmo minuto usam uma unica leitura", async () => {
  const { pedir, contexto } = montarMicrocache(async (n) => ({ payload: { n }, cacheControl: "x" }));
  const t0 = 1_000_000;
  const a = await pedir(t0, "2026-10-19T08:00");
  const b = await pedir(t0 + 1999, "2026-10-19T08:00");
  assert.equal(contexto.leituras, 1);
  assert.deepEqual(a, b);
  await pedir(t0 + 2000, "2026-10-19T08:00");
  assert.equal(contexto.leituras, 2, "Depois de 2s le de novo.");
});

test("a copia nunca atravessa a virada do minuto (publicacao das 08:00)", async () => {
  const { pedir, contexto } = montarMicrocache(async (n) => ({ payload: { n }, cacheControl: "x" }));
  const t0 = 1_000_000;
  await pedir(t0, "2026-10-19T07:59");
  const depois = await pedir(t0 + 500, "2026-10-19T08:00");
  assert.equal(contexto.leituras, 2);
  assert.deepEqual(depois.payload, { n: 2 });
});

test("pedidos simultaneos esperam a mesma leitura", async () => {
  let liberar;
  const { pedir, contexto } = montarMicrocache(() => new Promise((resolve) => { liberar = resolve; }));
  const pedidos = Array.from({ length: 50 }, () => pedir(1_000_000, "2026-10-19T08:00"));
  liberar({ payload: {}, cacheControl: "x" });
  await Promise.all(pedidos);
  assert.equal(contexto.leituras, 1);
});

test("falha na leitura nao fica guardada", async () => {
  const { pedir, contexto } = montarMicrocache(async (n) => {
    if (n === 1) throw new Error("indisponivel");
    return { payload: { n }, cacheControl: "x" };
  });
  await assert.rejects(() => pedir(1_000_000, "2026-10-19T08:00"));
  const r = await pedir(1_000_100, "2026-10-19T08:00");
  assert.deepEqual(r.payload, { n: 2 });
  assert.equal(contexto.leituras, 2);
});

test("handler HTTP sem gravacao por pedido; conflito de vaga segue com leitura fresca", () => {
  const inicio = backend.indexOf("exports.carregarAgendaPublicaHttp");
  const handler = backend.slice(inicio, backend.indexOf("exports.", inicio + 10));
  assert.doesNotMatch(handler, /aplicarRateLimit|runTransaction/);
  assert.match(handler, /await disponibilidadePublicaComMicrocache\(\)/);
  assert.match(extrairFuncao(backend, "relancarConflitoComAgenda"), /carregarDisponibilidadePublica\(\)/);
  assert.doesNotMatch(extrairFuncao(backend, "relancarConflitoComAgenda"), /Microcache/);
});

// ---- IP confiavel ----------------------------------------------------------------

const ipOrigemConfiavel = new Function(`${extrairFuncao(backend, "ipOrigemConfiavel")}; return ipOrigemConfiavel;`)();
const fingerprintRequisicao = new Function(
  "crypto", "ipOrigemConfiavel",
  `${extrairFuncao(backend, "fingerprintRequisicao")}; return fingerprintRequisicao;`
)(crypto, ipOrigemConfiavel);

const pedido = (xff, ua = "Android") => ({ rawRequest: { headers: { "x-forwarded-for": xff, "user-agent": ua } } });

test("SEG-04: X-Forwarded-For forjado nao muda o fingerprint", () => {
  const real = fingerprintRequisicao(pedido("200.1.2.3, 35.191.0.1"), "acao");
  for (const forjado of ["1.1.1.1, 200.1.2.3, 35.191.0.1", "9.9.9.9, 8.8.8.8, 200.1.2.3, 35.191.0.1"]) {
    assert.equal(fingerprintRequisicao(pedido(forjado), "acao"), real, forjado);
  }
  assert.notEqual(fingerprintRequisicao(pedido("200.9.9.9, 35.191.0.1"), "acao"), real, "Outro cliente, outro balde.");
});

test("todos os limites passam pelo IP do balanceador", () => {
  const fingerprint = extrairFuncao(backend, "fingerprintRequisicao");
  assert.match(fingerprint, /const ip = ipOrigemConfiavel\(request\);/);
  assert.doesNotMatch(fingerprint, /split\(","\)\[0\]/);
});
