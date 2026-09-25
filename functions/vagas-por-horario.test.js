"use strict";

// Grades configuradas pela recepcao: vigencia por data e mais de uma vaga por
// horario.
//
// Duas garantias sustentam a mudanca:
//   1. Uma grade salva para a semana que vem nao toca nas datas anteriores ao
//      seu inicio -- elas continuam na regra antiga, com os agendamentos que ja
//      tem.
//   2. Cada vaga de um horario e um documento proprio em vagas_ocupadas, e a
//      reserva le todas dentro da transacao. Duas pessoas nao levam a mesma
//      vaga, e o horario nunca aceita mais pessoas do que a grade oferece --
//      nem quando a recepcao reduz as vagas com reservas ja feitas.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const grade = require("./agenda-grade");
const {
  HORARIOS_SEIS,
  LIMITE_VAGAS_POR_HORARIO,
  normalizarItensGrade,
  normalizarGradesAtendimento,
  gradeVigenteParaData,
  gradeDetalhadaParaData,
  horariosParaData,
  vagasDoHorario,
  slotIdsDoHorario,
  horarioPertenceAgenda
} = grade;

const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

const GRADE_28_09 = {
  inicio: "2026-09-28",
  horarios: [{ hora: "14:00", vagas: 2 }, { hora: "15:00", vagas: 2 }, { hora: "16:00", vagas: 1 }]
};

test("datas anteriores a primeira grade continuam na regra antiga", () => {
  const agenda = { gradesAtendimento: [GRADE_28_09] };
  // 25/09/2026 e sexta: grade de seis horarios, uma vaga cada.
  assert.deepEqual(horariosParaData(agenda, "2026-09-25"), HORARIOS_SEIS);
  assert.equal(vagasDoHorario(agenda, "2026-09-25", "14:30"), 1);
  assert.equal(vagasDoHorario(agenda, "2026-09-25", "14:00"), 0);
});

test("a partir do inicio vale a grade configurada, com as vagas de cada horario", () => {
  const agenda = { gradesAtendimento: [GRADE_28_09] };
  for (const data of ["2026-09-28", "2026-09-29", "2026-10-02", "2027-01-05"]) {
    assert.deepEqual(horariosParaData(agenda, data), ["14:00", "15:00", "16:00"], data);
  }
  assert.equal(vagasDoHorario(agenda, "2026-09-29", "14:00"), 2);
  assert.equal(vagasDoHorario(agenda, "2026-09-29", "16:00"), 1);
  assert.equal(vagasDoHorario(agenda, "2026-09-29", "14:30"), 0);
});

test("vale a grade de maior inicio que ja comecou", () => {
  const agenda = {
    gradesAtendimento: [
      GRADE_28_09,
      { inicio: "2026-10-05", horarios: [{ hora: "09:00", vagas: 3 }] },
      { inicio: "2026-09-23", horarios: ["13:00"] }
    ]
  };
  assert.deepEqual(horariosParaData(agenda, "2026-09-22"), HORARIOS_SEIS);
  assert.deepEqual(horariosParaData(agenda, "2026-09-24"), ["13:00"]);
  assert.deepEqual(horariosParaData(agenda, "2026-09-30"), ["14:00", "15:00", "16:00"]);
  assert.deepEqual(gradeDetalhadaParaData(agenda, "2026-10-06"), [{ hora: "09:00", vagas: 3 }]);
  assert.equal(gradeVigenteParaData(agenda.gradesAtendimento, "2026-10-04").inicio, "2026-09-28");
});

test("grade configurada prevalece sobre horariosPorDiaSemana, so a partir do inicio", () => {
  const agenda = {
    horariosPorDiaSemana: { "2": ["08:00"] },
    gradesAtendimento: [GRADE_28_09]
  };
  // 22/09 e 29/09/2026 sao tercas.
  assert.deepEqual(horariosParaData(agenda, "2026-09-22"), ["08:00"]);
  assert.deepEqual(horariosParaData(agenda, "2026-09-29"), ["14:00", "15:00", "16:00"]);
});

test("um dia da semana pode ter grade propria, e lista vazia fecha o dia", () => {
  const agenda = {
    dias: ["2026-09-29", "2026-10-01", "2026-10-02"],
    gradesAtendimento: [{
      ...GRADE_28_09,
      porDiaSemana: { "4": [{ hora: "09:00", vagas: 4 }], "5": [] }
    }]
  };
  assert.deepEqual(gradeDetalhadaParaData(agenda, "2026-10-01"), [{ hora: "09:00", vagas: 4 }]);
  assert.deepEqual(horariosParaData(agenda, "2026-10-02"), []);
  assert.deepEqual(horariosParaData(agenda, "2026-09-29"), ["14:00", "15:00", "16:00"]);
  assert.equal(horarioPertenceAgenda(agenda, "2026-10-01", "09:00"), true);
  assert.equal(horarioPertenceAgenda(agenda, "2026-10-02", "14:00"), false);
});

test("normalizacao descarta lixo e limita as vagas por horario", () => {
  assert.deepEqual(normalizarItensGrade([
    "15:00",
    { hora: "14:00", vagas: 3 },
    { hora: "14:00", vagas: 2 },
    { hora: "25:00", vagas: 1 },
    { hora: "9:00", vagas: 1 },
    { hora: "16:00", vagas: 999 },
    { hora: "16:30", vagas: 0 },
    null
  ]), [
    { hora: "14:00", vagas: 3 },
    { hora: "15:00", vagas: 1 },
    { hora: "16:00", vagas: LIMITE_VAGAS_POR_HORARIO },
    { hora: "16:30", vagas: 1 }
  ]);
  const grades = normalizarGradesAtendimento([
    { inicio: "2026-02-30", horarios: ["14:00"] },
    { inicio: "ontem", horarios: ["14:00"] },
    { inicio: "2026-10-05", horarios: ["10:00"] },
    { inicio: "2026-10-05", horarios: ["11:00"] },
    "x"
  ]);
  assert.equal(grades.length, 1);
  assert.deepEqual(grades[0].horarios, [{ hora: "11:00", vagas: 1 }]);
});

test("a primeira vaga mantem o id de sempre; as demais ganham sufixo", () => {
  assert.deepEqual(slotIdsDoHorario("2026-09-29", "14:00", 3), [
    "2026-09-29_14:00", "2026-09-29_14:00_2", "2026-09-29_14:00_3"
  ]);
  assert.equal(slotIdsDoHorario("2026-09-29", "14:00").length, LIMITE_VAGAS_POR_HORARIO);
});

// ---- Reserva de verdade, com Firestore falso -------------------------------

function extrairExport(codigo, nome) {
  const inicio = codigo.indexOf(`exports.${nome} = `);
  assert.notEqual(inicio, -1, `Export ${nome} nao encontrado.`);
  const abre = codigo.indexOf("{", codigo.indexOf("=>", inicio));
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(inicio, codigo.indexOf(";", i) + 1);
    }
  }
  throw new Error(`Fim de ${nome} nao encontrado.`);
}

function extrairFuncao(codigo, nome) {
  const marcador = new RegExp(`(?:async )?function ${nome}\\(`).exec(codigo);
  assert.ok(marcador, `Funcao ${nome} nao encontrada.`);
  const abre = codigo.indexOf("{", codigo.indexOf(")", marcador.index));
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(marcador.index, i + 1);
    }
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

class ErroFalso extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function montarFirestore(docs) {
  let sequencia = 0;
  const snap = (r) => {
    const dados = docs[r.path];
    return { exists: dados !== undefined, id: r.id, data: () => dados };
  };
  const ref = (colecao, id) => {
    const r = { path: `${colecao}/${id}`, id };
    r.get = async () => snap(r);
    return r;
  };
  const db = {
    collection: (colecao) => ({ doc: (id) => ref(colecao, id || `auto${++sequencia}`) }),
    getAll: async (...refs) => refs.map(snap),
    runTransaction: async (fn) => {
      const pendentes = [];
      const t = {
        get: async (r) => snap(r),
        getAll: async (...refs) => refs.map(snap),
        set: (r, v) => pendentes.push(() => { docs[r.path] = v; }),
        create: (r, v) => pendentes.push(() => { docs[r.path] = v; }),
        delete: (r) => pendentes.push(() => { delete docs[r.path]; })
      };
      const resultado = await fn(t);
      pendentes.forEach((aplicar) => aplicar());
      return resultado;
    }
  };
  return db;
}

function montarCriar(docs) {
  const db = montarFirestore(docs);
  const agendamentoEstaAtivo = new Function(`${extrairFuncao(backend, "agendamentoEstaAtivo")}; return agendamentoEstaAtivo;`)();
  const slotRepresentaOcupacaoAtual = new Function(
    "agendamentoEstaAtivo",
    `${extrairFuncao(backend, "slotRepresentaOcupacaoAtual")}; return slotRepresentaOcupacaoAtual;`
  )(agendamentoEstaAtivo);
  const lerVagasDoHorario = new Function(
    "db", "slotIdsDoHorario", "slotRepresentaOcupacaoAtual",
    `${extrairFuncao(backend, "lerVagasDoHorario")}; return lerVagasDoHorario;`
  )(db, slotIdsDoHorario, slotRepresentaOcupacaoAtual);
  const processarAgenda = (bruto) => ({
    dias: bruto.dias || [],
    horariosPorDiaSemana: {},
    gradesAtendimento: normalizarGradesAtendimento(bruto.gradesAtendimento)
  });
  const checarDisponibilidade = (agenda, dataISO, hora) => {
    if (!horarioPertenceAgenda(agenda, dataISO, hora)) {
      throw new ErroFalso("failed-precondition", "Horario indisponivel para agendamento.");
    }
  };

  let handler = null;
  const dependencias = {
    exports: {},
    onCall: (_opcoes, fn) => { handler = fn; },
    agendamentoPicoOptions: {},
    normalizarTexto: (v) => String(v),
    normalizarCpf: (v) => String(v),
    normalizarTelefone: (v) => String(v),
    normalizarEmail: (v) => String(v || ""),
    normalizarData: (v) => String(v),
    normalizarHora: (v) => String(v),
    normalizarOperationIdPublico: (v) => String(v),
    crypto: { randomBytes: () => ({ toString: () => `op${Math.random()}` }) },
    validarIdadeMinimaAgendamento: () => {},
    hashPayloadAgendamento: () => "hash",
    db,
    aplicarRateLimit: async () => {},
    resolverResultadoOperacaoAgendamento: (dados) => dados.resultado,
    buscarBloqueioAtivoCpf: async () => null,
    HttpsError: ErroFalso,
    mensagemCpfBloqueado: () => "",
    formatarCpf: (v) => v,
    cpfDocId: (v) => `cpf_${v}`,
    validarSlotDisponivel: async () => {},
    gerarProtocolo: (id) => `CIN-${id}`,
    AGENDA_REF: () => db.collection("configuracoes").doc("agenda"),
    Timestamp: { fromMillis: (ms) => ms },
    OPERACAO_AGENDAMENTO_TTL_MS: 1,
    bloqueioAtivoDeDoc: () => null,
    processarAgenda,
    checarDisponibilidade,
    vagasDoHorario,
    lerVagasDoHorario,
    agendamentoCorrespondeAoPedido: () => false,
    agendamentoEstaAtivo,
    dataBr: (v) => v,
    OPERACAO_AGENDAMENTO_VERSAO: 1,
    FieldValue: { serverTimestamp: () => "TS" }
  };
  new Function(...Object.keys(dependencias), extrairExport(backend, "criarAgendamentoCidadao"))(
    ...Object.values(dependencias)
  );
  assert.ok(handler, "Handler nao capturado.");
  let operacao = 0;
  return (cpf, hora = "14:00", data = "2026-09-29") => handler({
    data: { nome: `Pessoa ${cpf}`, cpf, telefone: "35999999999", nascimento: "1990-01-01", data, hora, operationId: `op${++operacao}` }
  });
}

function agendaCom(vagas) {
  return {
    dias: ["2026-09-29"],
    gradesAtendimento: [{ inicio: "2026-09-28", horarios: [{ hora: "14:00", vagas }] }]
  };
}

function vagasGravadas(docs) {
  return Object.keys(docs).filter((p) => p.startsWith("vagas_ocupadas/")).sort();
}

test("horario com duas vagas aceita duas pessoas e recusa a terceira", async () => {
  const docs = { "configuracoes/agenda": agendaCom(2) };
  const criar = montarCriar(docs);
  await criar("11111111111");
  await criar("22222222222");
  await assert.rejects(() => criar("33333333333"), (e) => e.code === "already-exists");
  assert.deepEqual(vagasGravadas(docs), [
    "vagas_ocupadas/2026-09-29_14:00",
    "vagas_ocupadas/2026-09-29_14:00_2"
  ]);
  const agendamentos = Object.entries(docs).filter(([p]) => p.startsWith("dados_cidadaos/")).map(([, d]) => d.slotId).sort();
  assert.deepEqual(agendamentos, ["2026-09-29_14:00", "2026-09-29_14:00_2"]);
});

test("uma vaga de agendamento cancelado volta a ser oferecida", async () => {
  const docs = { "configuracoes/agenda": agendaCom(2) };
  const criar = montarCriar(docs);
  await criar("11111111111");
  await criar("22222222222");
  const primeiro = Object.entries(docs).find(([p, d]) => p.startsWith("dados_cidadaos/") && d.slotId === "2026-09-29_14:00");
  primeiro[1].status = "cancelado";
  const { agendamento } = await criar("33333333333");
  assert.equal(docs["vagas_ocupadas/2026-09-29_14:00"].agendamentoId, agendamento.id);
  await assert.rejects(() => criar("44444444444"), (e) => e.code === "already-exists");
});

test("reduzir as vagas nao deixa passar do novo limite", async () => {
  const docs = { "configuracoes/agenda": agendaCom(2) };
  const criar = montarCriar(docs);
  await criar("11111111111");
  await criar("22222222222");
  // A recepcao cancela a primeira reserva e reduz o horario para uma vaga.
  // A reserva restante esta na posicao _2, acima da nova capacidade.
  const primeiro = Object.entries(docs).find(([p, d]) => p.startsWith("dados_cidadaos/") && d.slotId === "2026-09-29_14:00");
  primeiro[1].status = "cancelado";
  docs["configuracoes/agenda"] = agendaCom(1);
  await assert.rejects(() => criar("33333333333"), (e) => e.code === "already-exists");
});

test("horario de uma vaga segue igual ao modelo antigo", async () => {
  const docs = { "configuracoes/agenda": agendaCom(1) };
  const criar = montarCriar(docs);
  await criar("11111111111");
  await assert.rejects(() => criar("22222222222"), (e) => e.code === "already-exists");
  assert.deepEqual(vagasGravadas(docs), ["vagas_ocupadas/2026-09-29_14:00"]);
});

test("horario fora da grade da data e recusado", async () => {
  const docs = { "configuracoes/agenda": agendaCom(2) };
  const criar = montarCriar(docs);
  await assert.rejects(() => criar("11111111111", "14:30"), (e) => e.code === "failed-precondition");
});

test("leitura publica conta as vagas de cada horario em vez de marcar ocupado", () => {
  const carregar = extrairFuncao(backend, "carregarDisponibilidadePublica");
  assert.match(carregar, /gradeDetalhadaParaData\(agenda, dataISO\)/);
  assert.match(carregar, /ocupados\.set\(chave, \(ocupados\.get\(chave\) \|\| 0\) \+ 1\)/);
  assert.match(carregar, /disponivel: restantes > 0/);
  // O total do dia soma as vagas restantes, nao os horarios livres.
  assert.match(carregar, /reduce\(\(total, item\) => total \+ item\.vagas, 0\)/);
});

test("verificacao e remarcacao usam a mesma leitura de vagas do horario", () => {
  const verificar = backend.slice(
    backend.indexOf("exports.verificarDisponibilidadeSlotCidadao"),
    backend.indexOf("exports.verificarBloqueioCpf")
  );
  assert.match(verificar, /lerVagasDoHorario\(/);
  assert.match(verificar, /vagasDoHorario\(agenda, dataISO, hora\)/);
  const remarcar = extrairExport(backend, "remarcarAgendamentoAdmin");
  assert.match(remarcar, /lerVagasDoHorario\(\(refs\) => t\.getAll\(\.\.\.refs\)/);
  assert.match(remarcar, /vagasDoHorario\(agendaTransacao, dataISO, hora\)/);
});

// ---- "remarcado" pelo painel continua ocupando a vaga ----------------------

test("agendamento remarcado pelo painel continua ativo; substituido nao", () => {
  const ativo = new Function(`${extrairFuncao(backend, "agendamentoEstaAtivo")}; return agendamentoEstaAtivo;`)();
  assert.equal(ativo({ status: "remarcado" }), true);
  assert.equal(ativo({ status: "remarcado", ativo: true }), true);
  assert.equal(ativo({ status: "remarcado", ativo: false, remarcadoParaAgendamentoId: "novo" }), false);
  assert.equal(ativo({ status: "remarcado", remarcadoParaAgendamentoId: "novo" }), false);
  assert.equal(ativo({ status: "remarcado", canceladoPor: "cidadao_substituicao" }), false);
  for (const status of ["cancelado", "cancelado_cidadao", "cancelado_camara"]) assert.equal(ativo({ status }), false);
  for (const status of ["agendado", "compareceu", "vai_voltar", "nao_compareceu"]) assert.equal(ativo({ status }), true);
});

test("vaga de quem foi remarcado pelo painel nao e vendida de novo", async () => {
  // A recepcao remarcou A para 29/09 14:00 pelo painel: a vaga aponta para A
  // e o status de A e "remarcado". Antes, a reserva via isso como vaga livre.
  const docs = {
    "configuracoes/agenda": agendaCom(1),
    "dados_cidadaos/A": { nome: "A", cpf: "99999999999", dataISO: "2026-09-29", hora: "14:00", slotId: "2026-09-29_14:00", status: "remarcado", ativo: true },
    "vagas_ocupadas/2026-09-29_14:00": { dataISO: "2026-09-29", hora: "14:00", agendamentoId: "A", origem: "gestaov6_remarcacao" }
  };
  const criar = montarCriar(docs);
  await assert.rejects(() => criar("11111111111"), (e) => e.code === "already-exists");
  assert.equal(docs["vagas_ocupadas/2026-09-29_14:00"].agendamentoId, "A");
});

test("CPF remarcado pelo painel nao consegue um segundo agendamento", async () => {
  const docs = {
    "configuracoes/agenda": agendaCom(2),
    "dados_cidadaos/A": { nome: "A", cpf: "11111111111", dataISO: "2026-09-29", hora: "14:00", slotId: "2026-09-29_14:00", status: "remarcado" },
    "vagas_ocupadas/2026-09-29_14:00": { dataISO: "2026-09-29", hora: "14:00", agendamentoId: "A" },
    "cpfs_agendados/cpf_11111111111": { agendamentoId: "A" }
  };
  const criar = montarCriar(docs);
  await assert.rejects(() => criar("11111111111"), (e) => e.code === "already-exists" && /CPF/.test(e.message));
});
