"use strict";

// Cancelamento pela recepcao.
//
// O painel escrevia direto no Firestore e chamava
// vagas_ocupadas.doc(slotId).delete() de forma INCONDICIONAL, engolindo o erro.
// E a mesma falha B5 fechada em cancelarAgendamentoCidadao em 14/08, que aqui
// seguiu aberta ate 29/08 -- e estava em producao.
//
// Cenario que ela permitia:
//   1. a recepcao cancela A das 14:30 -> vaga liberada
//   2. o cidadao B reserva as 14:30 -> nasce nova vaga
//   3. a recepcao cancela de novo a linha velha de A, ainda no cache da tela
//   4. a vaga de B some, o agendamento de B sobrevive, e o horario volta a ser
//      oferecido -- duas pessoas para as 14:30
//
// A transacao abaixo e exercitada de verdade, com um Firestore falso: nao ha
// como provar exclusao condicional lendo o texto do arquivo.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const painel = fs.readFileSync(path.join(raiz, "public", "recepcao.js"), "utf8");

function extrairExport(codigo, nome) {
  const inicio = codigo.indexOf("exports." + nome + " =");
  assert.notEqual(inicio, -1, "Export " + nome + " nao encontrado.");
  const resto = codigo.slice(inicio + 1);
  const proxima = resto.search(/\n(?:exports\.|(?:async )?function |const |\/\/ )/);
  return proxima === -1 ? codigo.slice(inicio) : codigo.slice(inicio, inicio + 1 + proxima);
}

// Firestore falso, so o suficiente para exercitar a transacao.
function montarFirestore(docs) {
  const escritas = { deletes: [], sets: [] };
  const ordem = { leituraDepoisDeEscrita: false };
  const ref = (colecao, id) => ({ path: colecao + "/" + id, colecao, id });
  const db = {
    collection: (colecao) => ({ doc: (id) => ref(colecao, id || "auto") }),
    runTransaction: async (fn) => fn({
      get: async (r) => {
        if (escritas.deletes.length || escritas.sets.length) ordem.leituraDepoisDeEscrita = true;
        const d = docs[r.path];
        return { exists: d !== undefined, id: r.id, data: () => d };
      },
      delete: (r) => escritas.deletes.push(r.path),
      set: (r, v) => escritas.sets.push({ path: r.path, valor: v })
    })
  };
  return { db, escritas, ordem };
}

class ErroFalso extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function montarCancelar(docs) {
  const { db, escritas, ordem } = montarFirestore(docs);
  let capturado = null;
  const onCall = (_opcoes, handler) => { capturado = handler; };
  const ativo = (d) => d.ativo !== false
    && ["cancelado", "cancelado_cidadao", "cancelado_camara", "remarcado"].includes(String(d.status || "agendado")) === false;

  new Function(
    "exports", "onCall", "callableOptions", "assertAdmin", "HttpsError", "db",
    "agendamentoEstaAtivo", "cpfDocId", "FieldValue",
    extrairExport(backend, "cancelarAgendamentoAdmin")
  )(
    {}, onCall, {}, async () => "recepcao@camara", ErroFalso, db,
    ativo, (cpf) => "cpf_hash_" + cpf, { serverTimestamp: () => "TS" }
  );

  assert.ok(capturado, "Handler nao capturado.");
  return { chamar: (data) => capturado({ data }), escritas, ordem };
}

const AGENDAMENTO = {
  nome: "Fulano",
  cpf: "529.982.247-25",
  dataISO: "2026-09-01",
  hora: "14:30",
  slotId: "2026-09-01_14:30",
  status: "agendado"
};

test("cancelamento normal libera a propria vaga e o indice de CPF", async () => {
  const { chamar, escritas } = montarCancelar({
    "dados_cidadaos/A1": AGENDAMENTO,
    "vagas_ocupadas/2026-09-01_14:30": { agendamentoId: "A1" },
    "cpfs_agendados/cpf_hash_52998224725": { agendamentoId: "A1" }
  });
  const r = await chamar({ agendamentoId: "A1" });
  assert.equal(r.cancelado, true);
  assert.equal(r.vagaLiberada, true);
  assert.ok(escritas.deletes.includes("vagas_ocupadas/2026-09-01_14:30"));
  assert.ok(escritas.deletes.includes("cpfs_agendados/cpf_hash_52998224725"));
});

test("REGRESSAO: cancelar linha velha NAO apaga a vaga de quem reservou depois", async () => {
  // A vaga das 14:30 agora pertence a B. O codigo antigo apagava assim mesmo.
  const { chamar, escritas } = montarCancelar({
    "dados_cidadaos/A1": AGENDAMENTO,
    "vagas_ocupadas/2026-09-01_14:30": { agendamentoId: "B2" },
    "cpfs_agendados/cpf_hash_52998224725": { agendamentoId: "B2" }
  });
  const r = await chamar({ agendamentoId: "A1" });
  assert.equal(r.cancelado, true);
  assert.equal(r.vagaLiberada, false, "A vaga e de outro agendamento: nao pode ser liberada.");
  assert.equal(
    escritas.deletes.includes("vagas_ocupadas/2026-09-01_14:30"),
    false,
    "Apagou a vaga de terceiro -- e a venda dupla que isto existe para impedir."
  );
  assert.equal(
    escritas.deletes.includes("cpfs_agendados/cpf_hash_52998224725"),
    false,
    "O indice ja aponta para o agendamento posterior."
  );
});

test("cancelar duas vezes e idempotente e nao mexe em nada", async () => {
  const { chamar, escritas } = montarCancelar({
    "dados_cidadaos/A1": Object.assign({}, AGENDAMENTO, { status: "cancelado", ativo: false }),
    "vagas_ocupadas/2026-09-01_14:30": { agendamentoId: "B2" }
  });
  const r = await chamar({ agendamentoId: "A1" });
  assert.equal(r.jaEstavaCancelado, true);
  assert.equal(r.cancelado, false);
  assert.deepEqual(escritas.deletes, [], "Um segundo cancelamento nao pode apagar nada.");
  assert.deepEqual(escritas.sets, [], "Nem regravar status.");
});

test("agendamento inexistente falha em vez de gravar", async () => {
  const { chamar, escritas } = montarCancelar({});
  await assert.rejects(() => chamar({ agendamentoId: "SUMIU" }), /nao encontrado/i);
  assert.deepEqual(escritas.deletes, []);
});

test("id vazio e recusado antes de qualquer leitura", async () => {
  const { chamar } = montarCancelar({ "dados_cidadaos/A1": AGENDAMENTO });
  await assert.rejects(() => chamar({ agendamentoId: "" }), /invalido/i);
  await assert.rejects(() => chamar({}), /invalido/i);
});

test("todas as leituras acontecem antes das escritas", async () => {
  // Exigencia do Firestore. Violar isso so falharia em producao.
  const { chamar, ordem } = montarCancelar({
    "dados_cidadaos/A1": AGENDAMENTO,
    "vagas_ocupadas/2026-09-01_14:30": { agendamentoId: "A1" },
    "cpfs_agendados/cpf_hash_52998224725": { agendamentoId: "A1" }
  });
  await chamar({ agendamentoId: "A1" });
  assert.equal(ordem.leituraDepoisDeEscrita, false);
});

test("encaixe manual sem vaga contabilizada nao quebra", async () => {
  const { chamar, escritas } = montarCancelar({
    "dados_cidadaos/M1": { nome: "Beltrano", cpf: "", dataISO: "2026-09-01", hora: "15:00", slotId: "manual_M1", status: "agendado" }
  });
  const r = await chamar({ agendamentoId: "M1" });
  assert.equal(r.cancelado, true);
  assert.equal(r.vagaLiberada, false);
  assert.ok(escritas.sets.some((x) => x.path === "dados_cidadaos/M1"));
});

// O corpo da funcao tem um comentario que CITA o defeito antigo, inclusive os
// nomes das colecoes. A trava tem de olhar codigo executavel, nao a prosa --
// foi assim que a trava de CSP ficou vazia em 24/08.
function semComentarios(codigo) {
  return codigo.split("\n").map((linha) => {
    const i = linha.indexOf("//");
    if (i === -1) return linha;
    if (i > 0 && linha[i - 1] === ":") return linha; // preserva "https://"
    return linha.slice(0, i);
  }).join("\n");
}

test("o painel nao escreve mais direto nas colecoes sensiveis ao cancelar", () => {
  const i = painel.indexOf("async function cancelarAgendamentoPainel");
  const corpo = semComentarios(painel.slice(i, painel.indexOf("\n}", painel.indexOf("catch", i)) + 2));
  assert.match(corpo, /httpsCallable\("cancelarAgendamentoAdmin"\)/);
  assert.doesNotMatch(corpo, /vagas_ocupadas/, "Exclusao de vaga pelo cliente foi o defeito.");
  assert.doesNotMatch(corpo, /cpfs_agendados/, "Indice de CPF tambem e do backend.");
  assert.match(corpo, /jaEstavaCancelado/, "Lista velha precisa forcar recarga.");
  assert.match(corpo, /vagaLiberada === false/, "A recepcao precisa saber quando a vaga era de outra pessoa.");
});

test("o backend registra quando a vaga NAO foi liberada", () => {
  // E o unico sinal de que alguem tentou cancelar a partir de uma lista velha.
  const bloco = extrairExport(backend, "cancelarAgendamentoAdmin");
  assert.match(bloco, /acao: "cancelar_agendamento_painel"/);
  assert.match(bloco, /vagaLiberada,/);
});
