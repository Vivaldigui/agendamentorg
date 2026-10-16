"use strict";

// Transacoes reais e concorrencia contra o emulador (auditoria de 16/10/2026,
// QA-01). Os testes de functions/ usam um Firestore falso que executa as
// transacoes uma de cada vez; aqui as proprias Cloud Functions rodam contra o
// emulador, com pedidos disparados ao mesmo tempo.
//
// Rode da raiz: npm --prefix tests/emulador test

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-agendamento-cin";
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Rode com o emulador: npm --prefix tests/emulador test");

const funcoes = require(path.join(__dirname, "..", "..", "functions", "index.js"));
const { getFirestore } = require(path.join(__dirname, "..", "..", "functions", "node_modules", "firebase-admin", "lib", "firestore"));
const db = getFirestore();

const ADMIN = "recepcao@camara.gov.br";

// Data futura de verdade: a criacao recusa horario passado.
function dataFutura(dias) {
  const d = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}
const DIA = dataFutura(10);
const DIA2 = dataFutura(11);

function cpfValido(semente) {
  const base = String(100000000 + semente).slice(-9).split("").map(Number);
  const digito = (nums, peso) => {
    const soma = nums.reduce((t, n, i) => t + n * (peso - i), 0);
    const r = 11 - (soma % 11);
    return r >= 10 ? 0 : r;
  };
  const d1 = digito(base, 10);
  const d2 = digito([...base, d1], 11);
  return [...base, d1, d2].join("");
}

let sequencia = 0;
function pedidoCriar({ hora, data = DIA, ip, telefone, cpf, operationId } = {}) {
  const n = ++sequencia;
  return {
    data: {
      nome: `Pessoa Teste ${n}`,
      cpf: cpf || cpfValido(n * 7919),
      telefone: telefone || `(35) 9${String(10000000 + n).slice(-8, -4)}-${String(n).padStart(4, "0").slice(-4)}`,
      email: "",
      nascimento: "1990-01-01",
      data,
      hora,
      operationId: operationId || require("node:crypto").randomBytes(16).toString("hex")
    },
    rawRequest: { headers: { "x-forwarded-for": `${ip || `200.0.${Math.floor(n / 250)}.${n % 250}`}, 35.191.0.1`, "user-agent": `teste-${n}` } }
  };
}

const pedidoAdmin = (data) => ({ data, auth: { uid: "uid-admin", token: { email: ADMIN, email_verified: true } }, rawRequest: { headers: {} } });

async function limparBanco() {
  const colecoes = await db.listCollections();
  for (const colecao of colecoes) await db.recursiveDelete(colecao);
}

async function prepararAgenda(horarios) {
  await limparBanco();
  await db.collection("admins").doc(ADMIN).set({ ativo: true });
  await db.collection("configuracoes").doc("agenda").set({
    dias: [DIA, DIA2],
    gradesAtendimento: [{ inicio: dataFutura(-30), horarios }]
  });
}

async function contar(colecao, filtro = () => true) {
  const snap = await db.collection(colecao).get();
  return snap.docs.filter((doc) => filtro(doc.id, doc.data())).length;
}

async function resultados(promessas) {
  const lista = await Promise.allSettled(promessas);
  return {
    ok: lista.filter((r) => r.status === "fulfilled").map((r) => r.value),
    erros: lista.filter((r) => r.status === "rejected").map((r) => r.reason)
  };
}

// ---- Disputa pela mesma vaga --------------------------------------------------

test("30 pessoas ao mesmo tempo numa vaga: exatamente uma leva", async () => {
  await prepararAgenda([{ hora: "14:30", vagas: 1 }]);
  const { ok, erros } = await resultados(Array.from({ length: 30 }, () => funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "14:30" }))));
  assert.equal(ok.length, 1, `sucessos: ${ok.length}; erros: ${[...new Set(erros.map((e) => e.code))].join(",")}`);
  assert.ok(erros.every((e) => e.code === "already-exists"), [...new Set(erros.map((e) => `${e.code}:${e.message}`))].join(" | "));
  assert.equal(await contar("vagas_ocupadas"), 1);
  assert.equal(await contar("dados_cidadaos"), 1);
});

test("horario com 3 vagas e 25 pessoas: exatamente tres levam, em vagas diferentes", async () => {
  await prepararAgenda([{ hora: "15:00", vagas: 3 }]);
  const { ok } = await resultados(Array.from({ length: 25 }, () => funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "15:00" }))));
  assert.equal(ok.length, 3);
  const vagas = (await db.collection("vagas_ocupadas").get()).docs.map((d) => d.id).sort();
  assert.deepEqual(vagas, [`${DIA}_15:00`, `${DIA}_15:00_2`, `${DIA}_15:00_3`]);
  const donos = new Set((await db.collection("vagas_ocupadas").get()).docs.map((d) => d.data().agendamentoId));
  assert.equal(donos.size, 3, "Cada vaga com um dono diferente.");
});

test("o mesmo pedido repetido 8 vezes ao mesmo tempo vira um unico agendamento", async () => {
  await prepararAgenda([{ hora: "14:30", vagas: 1 }]);
  const base = pedidoCriar({ hora: "14:30" });
  const { ok, erros } = await resultados(Array.from({ length: 8 }, () => funcoes.criarAgendamentoCidadao.run(base)));
  assert.equal(erros.length, 0, erros.map((e) => e.message).join(" | "));
  assert.equal(new Set(ok.map((r) => r.agendamento.id)).size, 1);
  assert.equal(await contar("dados_cidadaos"), 1);
});

test("mesmo CPF em dois horarios ao mesmo tempo: so um agendamento ativo", async () => {
  await prepararAgenda([{ hora: "14:30", vagas: 1 }, { hora: "15:00", vagas: 1 }]);
  const cpf = cpfValido(424242);
  const { ok } = await resultados([
    funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "14:30", cpf })),
    funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "15:00", cpf }))
  ]);
  assert.equal(ok.length, 1);
  assert.equal(await contar("dados_cidadaos"), 1);
});

// ---- Tetos sob rajada (CON-01) ----------------------------------------------------

test("rajada de 6 pedidos do mesmo celular em horarios livres: no maximo 2", async () => {
  await prepararAgenda(["14:00", "14:30", "15:00", "15:30", "16:00", "16:30"].map((hora) => ({ hora, vagas: 1 })));
  const telefone = "(35) 98888-0000";
  const { ok, erros } = await resultados(["14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]
    .map((hora) => funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora, telefone }))));
  assert.equal(ok.length, 2, `sucessos ${ok.length}`);
  assert.ok(erros.every((e) => e.code === "resource-exhausted" && e.details && e.details.tipo === "limite-telefone"));
});

test("rajada de 8 pedidos da mesma conexao: no maximo 4 no dia", async () => {
  await prepararAgenda(["14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:30", "15:45"].map((hora) => ({ hora, vagas: 1 })));
  const { ok, erros } = await resultados(["14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:30", "15:45"]
    .map((hora) => funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora, ip: "200.10.10.10" }))));
  assert.equal(ok.length, 4, `sucessos ${ok.length}`);
  assert.ok(erros.every((e) => e.details && e.details.tipo === "limite-origem"));
});

// ---- Painel x cidadao (BUG-01) ----------------------------------------------------

test("remarcacao do painel e cidadao disputando a mesma vaga: um so dono", async () => {
  await prepararAgenda([{ hora: "14:30", vagas: 1 }, { hora: "15:00", vagas: 1 }]);
  const { agendamento } = await funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "15:00" }));
  for (let rodada = 0; rodada < 5; rodada++) {
    await db.recursiveDelete(db.collection("vagas_ocupadas").doc(`${DIA}_14:30`));
    await resultados([
      funcoes.remarcarAgendamentoAdmin.run(pedidoAdmin({ agendamentoId: agendamento.id, data: DIA, hora: "14:30", contabilizaVaga: true })),
      funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "14:30" }))
    ]);
    const naVaga = (await db.collection("dados_cidadaos").get()).docs
      .filter((d) => d.data().dataISO === DIA && d.data().hora === "14:30" && d.data().ativo !== false);
    assert.ok(naVaga.length <= 1, `rodada ${rodada}: ${naVaga.length} pessoas as 14:30`);
    // Volta A para as 15:00 para a proxima rodada.
    if (naVaga.length && naVaga[0].id === agendamento.id) {
      await funcoes.remarcarAgendamentoAdmin.run(pedidoAdmin({ agendamentoId: agendamento.id, data: DIA, hora: "15:00", contabilizaVaga: true }));
    } else {
      for (const d of naVaga) await d.ref.delete();
    }
  }
});

test("cancelamento duplo pela recepcao nao apaga a vaga de quem reservou depois", async () => {
  await prepararAgenda([{ hora: "14:30", vagas: 1 }]);
  const a = await funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "14:30" }));
  await funcoes.cancelarAgendamentoAdmin.run(pedidoAdmin({ agendamentoId: a.agendamento.id }));
  const b = await funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "14:30" }));
  const r = await funcoes.cancelarAgendamentoAdmin.run(pedidoAdmin({ agendamentoId: a.agendamento.id }));
  assert.equal(r.jaEstavaCancelado, true);
  const vaga = await db.collection("vagas_ocupadas").doc(`${DIA}_14:30`).get();
  assert.equal(vaga.data().agendamentoId, b.agendamento.id);
});

// ---- Falta e bloqueio (SEG-02) ------------------------------------------------------

test("falta bloqueia o CPF de verdade e a correcao libera", async () => {
  await prepararAgenda([{ hora: "14:30", vagas: 1 }, { hora: "15:00", vagas: 1 }]);
  const cpf = cpfValido(777);
  const a = await funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "14:30", cpf }));
  await funcoes.alterarStatusAdmin.run(pedidoAdmin({ agendamentoId: a.agendamento.id, status: "nao_compareceu" }));
  await funcoes.cancelarAgendamentoAdmin.run(pedidoAdmin({ agendamentoId: a.agendamento.id }));
  await assert.rejects(
    () => funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "15:00", cpf })),
    (e) => e.code === "failed-precondition" && /ausencia/i.test(e.message)
  );
  await funcoes.liberarBloqueioAdmin.run(pedidoAdmin({ agendamentoId: a.agendamento.id }));
  const b = await funcoes.criarAgendamentoCidadao.run(pedidoCriar({ hora: "15:00", cpf }));
  assert.ok(b.agendamento.id);
});

test("callables administrativas recusam e-mail nao verificado", async () => {
  await prepararAgenda([{ hora: "14:30", vagas: 1 }]);
  const pedido = { data: { agendamentoId: "x", status: "compareceu" }, auth: { uid: "u", token: { email: ADMIN, email_verified: false } }, rawRequest: { headers: {} } };
  await assert.rejects(() => funcoes.alterarStatusAdmin.run(pedido), (e) => e.code === "permission-denied");
});
