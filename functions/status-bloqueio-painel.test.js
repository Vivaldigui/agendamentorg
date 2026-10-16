"use strict";

// Status do atendimento e bloqueio por falta pelo servidor (auditoria de
// 16/10/2026, SEG-02).
//
// O painel gravava direto em dados_cidadaos e bloqueios_agendamento, e o log
// vinha depois, do navegador, sem garantia e com o e-mail que o cliente
// quisesse. Alem disso, trocar "nao compareceu" por outro status nao desfazia
// o bloqueio: o CPF seguia bloqueado por seis meses com a falta corrigida.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { painelJs } = require("./painel-fonte");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const regras = fs.readFileSync(path.join(raiz, "firestore.rules"), "utf8");

function extrairExport(codigo, nome) {
  const inicio = codigo.indexOf("exports." + nome + " =");
  assert.notEqual(inicio, -1, "Export " + nome + " nao encontrado.");
  const resto = codigo.slice(inicio + 1);
  const proxima = resto.search(/\n(?:exports\.|(?:async )?function |const |\/\/ )/);
  return proxima === -1 ? codigo.slice(inicio) : codigo.slice(inicio, inicio + 1 + proxima);
}

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

// Firestore falso: transacao com consulta, escritas aplicadas no fim e
// registro de leitura feita depois de escrita.
function montarFirestore(docs) {
  let sequencia = 0;
  const controle = { leituraDepoisDeEscrita: false };
  const snap = (caminho) => {
    const [, id] = caminho.split("/");
    return { id, exists: docs[caminho] !== undefined, data: () => docs[caminho], ref: { path: caminho, id } };
  };
  const db = {
    collection: (colecao) => ({
      doc: (id) => ({ path: `${colecao}/${id || `auto${++sequencia}`}`, id }),
      where: (campo, op, valor) => ({
        limit: (n) => ({ __consulta: { colecao, campo, op, valor, n } })
      })
    }),
    runTransaction: async (fn) => {
      const pendentes = [];
      const t = {
        get: async (alvo) => {
          if (pendentes.length) controle.leituraDepoisDeEscrita = true;
          if (alvo.__consulta) {
            const { colecao, campo, valor, n } = alvo.__consulta;
            const lista = Object.keys(docs)
              .filter((p) => p.startsWith(`${colecao}/`) && docs[p][campo] === valor)
              .slice(0, n)
              .map(snap);
            return { docs: lista };
          }
          return snap(alvo.path);
        },
        set: (ref, v, opcoes) => pendentes.push(() => {
          docs[ref.path] = opcoes && opcoes.merge ? { ...(docs[ref.path] || {}), ...v } : { ...v };
        }),
        delete: (ref) => pendentes.push(() => { delete docs[ref.path]; })
      };
      const resultado = await fn(t);
      pendentes.forEach((aplicar) => aplicar());
      return resultado;
    }
  };
  return { db, controle };
}

function montar(docs, { hoje = "2026-10-16", admin = "recepcao@camara.gov.br" } = {}) {
  const { db, controle } = montarFirestore(docs);
  const subtrairMesesISO = new Function(
    "hojeSaoPauloISO",
    `${extrairFuncao(backend, "subtrairMesesISO")}; return subtrairMesesISO;`
  )(() => hoje);
  const dataBr = new Function(`${extrairFuncao(backend, "dataBr")}; return dataBr;`)();
  const handlers = {};
  const dependencias = {
    exports: {},
    onCall: () => null,
    callableOptions: {},
    assertAdmin: async () => admin,
    HttpsError: ErroFalso,
    db,
    hojeSaoPauloISO: () => hoje,
    cpfNumeros: (v) => String(v || "").replace(/\D/g, ""),
    subtrairMesesISO,
    dataBr,
    FieldValue: { serverTimestamp: () => "TS" },
    STATUS_ATENDIMENTO_PAINEL: new Set(["agendado", "compareceu", "vai_voltar", "nao_compareceu"]),
    BLOQUEIO_FALTA_MESES: 6,
    MOTIVO_BLOQUEIO_FALTA: "Não comparecimento"
  };
  for (const nome of ["alterarStatusAdmin", "liberarBloqueioAdmin"]) {
    dependencias.onCall = (_opcoes, fn) => { handlers[nome] = fn; };
    new Function(...Object.keys(dependencias), extrairExport(backend, nome))(...Object.values(dependencias));
  }
  return {
    alterar: (data) => handlers.alterarStatusAdmin({ data }),
    liberar: (data) => handlers.liberarBloqueioAdmin({ data }),
    controle
  };
}

const CPF = "52998224725";

function agendamento(extra = {}) {
  return {
    nome: "Maria da Silva",
    cpf: "529.982.247-25",
    telefone: "(35) 99999-0000",
    dataISO: "2026-10-15",
    hora: "14:30",
    protocolo: "CIN-ABCD1234",
    status: "agendado",
    ...extra
  };
}

function logs(docs) {
  return Object.entries(docs).filter(([p]) => p.startsWith("logs_admin/")).map(([, d]) => d);
}

// ---- alterarStatusAdmin -----------------------------------------------------------

test("falta cria o bloqueio de seis meses no agendamento e no registro dedicado, com log do servidor", async () => {
  const docs = { "dados_cidadaos/A": agendamento() };
  const { alterar, controle } = montar(docs);
  const r = await alterar({ agendamentoId: "A", status: "nao_compareceu" });

  assert.equal(r.bloqueadoAte, "2027-04-16");
  const ag = docs["dados_cidadaos/A"];
  assert.equal(ag.status, "nao_compareceu");
  assert.equal(ag.bloqueioAtivo, true);
  assert.equal(ag.bloqueioCpf, CPF);
  assert.equal(ag.bloqueioDataFalta, "15/10/2026 14:30");
  assert.equal(ag.statusAtualizadoPor, "recepcao@camara.gov.br");
  assert.equal(ag.bloqueioNome, undefined);
  assert.equal(ag.bloqueioTelefone, undefined);
  assert.deepEqual(Object.keys(docs[`bloqueios_agendamento/${CPF}`]).sort(),
    ["agendamentoId", "bloqueadoAte", "cpf", "criadoEm", "dataFalta", "liberado", "motivo", "origem"]);
  assert.equal(docs[`bloqueios_agendamento/${CPF}`].agendamentoId, "A");
  const [log] = logs(docs);
  assert.equal(log.acao, "alterar_status");
  assert.equal(log.adminEmail, "recepcao@camara.gov.br");
  assert.deepEqual(log.detalhes, { de: "agendado", para: "nao_compareceu", bloqueadoAte: "2027-04-16", bloqueioDesfeito: false });
  assert.ok(!JSON.stringify(log).includes(CPF), "Log sem CPF.");
  assert.equal(controle.leituraDepoisDeEscrita, false);
});

test("REGRESSAO: corrigir a falta para compareceu desfaz o bloqueio", async () => {
  const docs = { "dados_cidadaos/A": agendamento() };
  const { alterar } = montar(docs);
  await alterar({ agendamentoId: "A", status: "nao_compareceu" });
  const r = await alterar({ agendamentoId: "A", status: "compareceu" });
  assert.equal(r.bloqueioDesfeito, true);
  assert.equal(docs["dados_cidadaos/A"].status, "compareceu");
  assert.equal(docs["dados_cidadaos/A"].bloqueioAtivo, false);
  assert.equal(docs["dados_cidadaos/A"].bloqueioLiberado, true);
  assert.equal(docs[`bloqueios_agendamento/${CPF}`], undefined);
});

test("corrigir a falta nao apaga registro dedicado de OUTRA falta do mesmo CPF", async () => {
  const docs = {
    "dados_cidadaos/A": agendamento({ status: "nao_compareceu", bloqueioAtivo: true, bloqueioCpf: CPF, bloqueadoAte: "2027-04-16" }),
    [`bloqueios_agendamento/${CPF}`]: { cpf: CPF, agendamentoId: "OUTRA", bloqueadoAte: "2027-03-01" }
  };
  await montar(docs).alterar({ agendamentoId: "A", status: "compareceu" });
  assert.equal(docs[`bloqueios_agendamento/${CPF}`].agendamentoId, "OUTRA");
});

test("marcar falta de novo nao recria nem estende o bloqueio", async () => {
  const docs = { "dados_cidadaos/A": agendamento({ status: "nao_compareceu", bloqueioAtivo: true, bloqueadoAte: "2027-01-01" }) };
  const r = await montar(docs).alterar({ agendamentoId: "A", status: "nao_compareceu" });
  assert.equal(r.bloqueadoAte, "");
  assert.equal(docs["dados_cidadaos/A"].bloqueadoAte, "2027-01-01");
  assert.equal(docs[`bloqueios_agendamento/${CPF}`], undefined);
});

test("retorno posterior e compareceu nunca bloqueiam", async () => {
  for (const status of ["vai_voltar", "compareceu", "agendado"]) {
    const docs = { "dados_cidadaos/A": agendamento() };
    await montar(docs).alterar({ agendamentoId: "A", status });
    assert.equal(docs["dados_cidadaos/A"].bloqueioAtivo, undefined, status);
    assert.equal(docs[`bloqueios_agendamento/${CPF}`], undefined, status);
  }
});

test("falta de encaixe sem CPF marca o status sem criar registro dedicado", async () => {
  const docs = { "dados_cidadaos/E": agendamento({ cpf: "" }) };
  await montar(docs).alterar({ agendamentoId: "E", status: "nao_compareceu" });
  assert.equal(docs["dados_cidadaos/E"].status, "nao_compareceu");
  assert.ok(!Object.keys(docs).some((p) => p.startsWith("bloqueios_agendamento/")));
});

test("status fora da lista e cancelamento sao recusados sem escrita", async () => {
  for (const status of ["cancelado", "remarcado", "qualquer", ""]) {
    const docs = { "dados_cidadaos/A": agendamento() };
    const antes = JSON.stringify(docs);
    await assert.rejects(() => montar(docs).alterar({ agendamentoId: "A", status }), (e) => e.code === "invalid-argument", status);
    assert.equal(JSON.stringify(docs), antes);
  }
  await assert.rejects(() => montar({}).alterar({ agendamentoId: "X", status: "compareceu" }), (e) => e.code === "not-found");
});

// ---- liberarBloqueioAdmin ----------------------------------------------------------

test("liberar solta todas as faltas ativas do CPF e o registro dedicado", async () => {
  const docs = {
    "dados_cidadaos/A": agendamento({ status: "nao_compareceu", bloqueioAtivo: true, bloqueioCpf: CPF, bloqueadoAte: "2027-04-16" }),
    "dados_cidadaos/ANTIGA": agendamento({ status: "nao_compareceu", bloqueioAtivo: true, bloqueioCpf: CPF, bloqueadoAte: "2027-02-01" }),
    "dados_cidadaos/LIBERADA": agendamento({ status: "nao_compareceu", bloqueioAtivo: false, bloqueioLiberado: true, bloqueioCpf: CPF }),
    "dados_cidadaos/OUTRO": agendamento({ cpf: "111.444.777-35", bloqueioAtivo: true, bloqueioCpf: "11144477735" }),
    [`bloqueios_agendamento/${CPF}`]: { cpf: CPF, bloqueadoAte: "2027-04-16" }
  };
  const r = await montar(docs).liberar({ agendamentoId: "A" });
  assert.equal(r.registrosLiberados, 2);
  for (const id of ["A", "ANTIGA"]) {
    assert.equal(docs[`dados_cidadaos/${id}`].bloqueioAtivo, false, id);
    assert.equal(docs[`dados_cidadaos/${id}`].usuarioLiberacao, "recepcao@camara.gov.br", id);
  }
  assert.equal(docs["dados_cidadaos/OUTRO"].bloqueioAtivo, true, "Outro CPF nao e tocado.");
  assert.equal(docs[`bloqueios_agendamento/${CPF}`], undefined);
  const [log] = logs(docs);
  assert.equal(log.acao, "liberar_bloqueio");
  assert.deepEqual(log.detalhes, { registrosLiberados: 2, registroDedicadoRemovido: true });
  assert.ok(!JSON.stringify(log).includes(CPF));
});

test("liberar agendamento inexistente devolve not-found", async () => {
  await assert.rejects(() => montar({}).liberar({ agendamentoId: "X" }), (e) => e.code === "not-found");
  await assert.rejects(() => montar({}).liberar({}), (e) => e.code === "invalid-argument");
});

test("as duas callables exigem admin", () => {
  for (const nome of ["alterarStatusAdmin", "liberarBloqueioAdmin"]) {
    assert.match(extrairExport(backend, nome), /const adminEmail = await assertAdmin\(request\);/, nome);
  }
});

// ---- Painel e regras -------------------------------------------------------------------

test("painel chama as callables e nao grava agendamento, vaga, indice nem bloqueio", () => {
  assert.match(extrairFuncao(painelJs, "alterarStatus"), /httpsCallable\("alterarStatusAdmin"\)/);
  assert.match(extrairFuncao(painelJs, "liberarBloqueio"), /httpsCallable\("liberarBloqueioAdmin"\)/);
  for (const colecao of ["dados_cidadaos", "vagas_ocupadas", "cpfs_agendados", "bloqueios_agendamento"]) {
    const escrita = new RegExp(`collection\\("${colecao}"\\)[^;]*\\.(set|update|delete|add)\\(`);
    assert.doesNotMatch(painelJs, escrita, colecao);
  }
  assert.doesNotMatch(painelJs, /registrarLog\("(alterar_status|liberar_bloqueio)"/, "Esses logs agora saem do servidor.");
});

test("regras: agendamentos, vagas, indices e bloqueios so leitura para o painel", () => {
  for (const [colecao, variavel] of [["vagas_ocupadas", "slotId"], ["dados_cidadaos", "documentId"], ["cpfs_agendados", "documentId"], ["bloqueios_agendamento", "cpf"]]) {
    const inicio = regras.indexOf(`match /${colecao}/{${variavel}} {`);
    assert.notEqual(inicio, -1, colecao);
    const bloco = regras.slice(inicio, regras.indexOf("\n    }", inicio));
    assert.match(bloco, /allow write: if false;/, colecao);
    assert.doesNotMatch(bloco, /allow (create|update|delete)/, colecao);
  }
});

test("regras: log do navegador leva o e-mail do token e a hora do servidor", () => {
  const inicio = regras.indexOf("match /logs_admin/{documentId} {");
  const bloco = regras.slice(inicio, regras.indexOf("allow update, delete: if false;", inicio));
  assert.match(bloco, /request\.resource\.data\.adminEmail == request\.auth\.token\.email/);
  assert.match(bloco, /request\.resource\.data\.criadoEm == request\.time/);
  // O painel grava exatamente esses dois campos assim.
  const registrar = extrairFuncao(painelJs, "registrarLog");
  assert.match(registrar, /adminEmail: auth\.currentUser \? auth\.currentUser\.email : ""/);
  assert.match(registrar, /criadoEm: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
});
