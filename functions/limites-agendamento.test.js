"use strict";

// Tetos de criacao por telefone e por origem (auditoria de 16/10/2026, CON-01).
//
// Antes, o unico limite de criacao era por IP + User-Agent + CPF, com o IP
// tirado do primeiro X-Forwarded-For, que o cliente escreve: com uma lista de
// CPFs, um so computador reservava a abertura inteira. A criacao e exercitada
// de verdade com um Firestore falso; os tetos sao conferidos dentro da
// transacao e os contadores so andam quando a reserva grava.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizarGradesAtendimento, vagasDoHorario, slotIdsDoHorario, horarioPertenceAgenda } = require("./agenda-grade");
const limites = require("./limites-agendamento");
const {
  LIMITES_AGENDAMENTO_PADRAO,
  normalizarLimitesAgendamento,
  chaveOrigemLimite,
  agendamentosQueContamNoTelefone,
  excedeTeto
} = limites;

const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

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
  constructor(code, message, details) {
    super(message);
    this.code = code;
    if (details !== undefined) this.details = details;
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
  return {
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
}

// criarAgendamentoCidadao de verdade. Funcoes de telefone e de IP vem do
// proprio index.js, para que a canonicalizacao e o IP confiavel sejam os reais.
function montarCriar(docs, { hoje = "2026-09-28" } = {}) {
  const db = montarFirestore(docs);
  const ativo = new Function(`${extrairFuncao(backend, "agendamentoEstaAtivo")}; return agendamentoEstaAtivo;`)();
  const slotRepresentaOcupacaoAtual = new Function(
    "agendamentoEstaAtivo",
    `${extrairFuncao(backend, "slotRepresentaOcupacaoAtual")}; return slotRepresentaOcupacaoAtual;`
  )(ativo);
  const lerVagasDoHorario = new Function(
    "db", "slotIdsDoHorario", "slotRepresentaOcupacaoAtual",
    `${extrairFuncao(backend, "lerVagasDoHorario")}; return lerVagasDoHorario;`
  )(db, slotIdsDoHorario, slotRepresentaOcupacaoAtual);
  const telefoneCanonico = new Function(
    `${extrairFuncao(backend, "digitosTelefone")}; ${extrairFuncao(backend, "telefoneCanonico")}; return telefoneCanonico;`
  )();
  const ipOrigemConfiavel = new Function(`${extrairFuncao(backend, "ipOrigemConfiavel")}; return ipOrigemConfiavel;`)();

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
    processarAgenda: (bruto) => ({
      dias: bruto.dias || [],
      horariosPorDiaSemana: {},
      gradesAtendimento: normalizarGradesAtendimento(bruto.gradesAtendimento)
    }),
    checarDisponibilidade: (agenda, dataISO, hora) => {
      if (!horarioPertenceAgenda(agenda, dataISO, hora)) {
        throw new ErroFalso("failed-precondition", "Horario indisponivel para agendamento.");
      }
    },
    vagasDoHorario,
    lerVagasDoHorario,
    agendamentoCorrespondeAoPedido: () => false,
    agendamentoEstaAtivo: ativo,
    dataBr: (v) => v,
    OPERACAO_AGENDAMENTO_VERSAO: 1,
    FieldValue: { serverTimestamp: () => "TS" },
    TIPO_CONFLITO_HORARIO_PREENCHIDO: "horario-preenchido",
    relancarConflitoComAgenda: async (err) => { throw err; },
    ...limites,
    hojeSaoPauloISO: () => hoje,
    telefoneCanonico,
    ipOrigemConfiavel,
    console: { warn: () => {} }
  };
  new Function(...Object.keys(dependencias), extrairExport(backend, "criarAgendamentoCidadao"))(
    ...Object.values(dependencias)
  );
  assert.ok(handler, "Handler nao capturado.");

  let operacao = 0;
  return ({ cpf, telefone, ip = "", hora = "14:00", data = "2026-09-29", operationId }) => handler({
    data: {
      nome: `Pessoa ${cpf}`, cpf, telefone, nascimento: "1990-01-01", data, hora,
      operationId: operationId || `op${++operacao}`
    },
    // O balanceador acrescenta <cliente>,<balanceador>. O que vier antes foi
    // escrito pelo chamador e nao pode mudar a contagem.
    rawRequest: { headers: ip ? { "x-forwarded-for": `${ip}, 35.191.0.1` } : {} }
  });
}

function agenda(extra = {}) {
  return {
    dias: ["2026-09-29", "2026-09-30"],
    gradesAtendimento: [{
      inicio: "2026-09-28",
      horarios: ["14:00", "14:30", "15:00", "15:30", "16:00", "16:30"].map((hora) => ({ hora, vagas: 1 }))
    }],
    ...extra
  };
}

const HORAS = ["14:00", "14:30", "15:00", "15:30", "16:00", "16:30"];

function agendamentosGravados(docs) {
  return Object.keys(docs).filter((p) => p.startsWith("dados_cidadaos/")).length;
}

const ehLimite = (tipo) => (e) => e.code === "resource-exhausted" && e.details && e.details.tipo === tipo;

// ---- Modulo -----------------------------------------------------------------

test("padroes: 2 por telefone e 4 por origem no dia", () => {
  assert.deepEqual(normalizarLimitesAgendamento(undefined), { porTelefone: 2, porOrigemDia: 4 });
  assert.deepEqual(LIMITES_AGENDAMENTO_PADRAO, { porTelefone: 2, porOrigemDia: 4 });
});

test("configuracao aceita inteiros de 0 a 50; o resto cai no padrao", () => {
  assert.deepEqual(normalizarLimitesAgendamento({ porTelefone: 3, porOrigemDia: 0 }), { porTelefone: 3, porOrigemDia: 0 });
  assert.deepEqual(normalizarLimitesAgendamento({ porTelefone: -1, porOrigemDia: 2.5 }), { porTelefone: 2, porOrigemDia: 4 });
  assert.deepEqual(normalizarLimitesAgendamento({ porTelefone: "x", porOrigemDia: null }), { porTelefone: 2, porOrigemDia: 4 });
  assert.deepEqual(normalizarLimitesAgendamento({ porTelefone: 999, porOrigemDia: "6" }), { porTelefone: 50, porOrigemDia: 6 });
  assert.deepEqual(normalizarLimitesAgendamento([1, 2]), { porTelefone: 2, porOrigemDia: 4 });
});

test("teto zero desliga; teto positivo recusa ao atingir", () => {
  assert.equal(excedeTeto(100, 0), false);
  assert.equal(excedeTeto(1, 2), false);
  assert.equal(excedeTeto(2, 2), true);
});

test("chave de origem: IPv4, IPv4 mapeado e IPv6 pelo prefixo /64", () => {
  assert.equal(chaveOrigemLimite("200.1.2.3"), "v4:200.1.2.3");
  assert.equal(chaveOrigemLimite("::ffff:200.1.2.3"), "v4:200.1.2.3");
  const a = chaveOrigemLimite("2804:14c:1:2::abcd");
  const b = chaveOrigemLimite("2804:14c:1:2:ffff:1:2:3");
  assert.equal(a, "v6:2804:014c:0001:0002::/64");
  assert.equal(a, b, "Trocar de endereco dentro do proprio /64 nao zera a contagem.");
  assert.notEqual(chaveOrigemLimite("2804:14c:1:3::1"), a);
  assert.equal(chaveOrigemLimite("2804:14C:1:2::1%eth0"), a);
});

test("sem IP utilizavel nao ha chave: ninguem divide balde com desconhecidos", () => {
  for (const ip of ["", "sem-ip", "lixo", "1.2.3", "::1::2", undefined]) {
    assert.equal(chaveOrigemLimite(ip), "", String(ip));
  }
});

test("no telefone contam so agendamentos ativos de hoje em diante", () => {
  const doc = (id, dados) => ({ exists: dados !== undefined, id, data: () => dados });
  const ativo = new Function(`${extrairFuncao(backend, "agendamentoEstaAtivo")}; return agendamentoEstaAtivo;`)();
  const contam = agendamentosQueContamNoTelefone([
    doc("futuro", { status: "agendado", dataISO: "2026-09-29" }),
    doc("hoje", { status: "remarcado", dataISO: "2026-09-28" }),
    doc("passado", { status: "agendado", dataISO: "2026-09-27" }),
    doc("cancelado", { status: "cancelado_cidadao", ativo: false, dataISO: "2026-09-30" }),
    doc("apagado", undefined)
  ], "2026-09-28", ativo);
  assert.deepEqual(contam.map((c) => c.id), ["futuro", "hoje"]);
});

// ---- Criacao: teto por telefone ---------------------------------------------

test("terceiro agendamento com o mesmo celular e recusado, sem gastar vaga", async () => {
  const docs = { "configuracoes/agenda": agenda() };
  const criar = montarCriar(docs);
  await criar({ cpf: "11111111111", telefone: "35999990000", hora: "14:00" });
  await criar({ cpf: "22222222222", telefone: "35999990000", hora: "14:30" });
  await assert.rejects(
    () => criar({ cpf: "33333333333", telefone: "35999990000", hora: "15:00" }),
    (e) => ehLimite("limite-telefone")(e) && e.details.teto === 2
  );
  assert.equal(agendamentosGravados(docs), 2);
  assert.equal(docs["vagas_ocupadas/2026-09-29_15:00"], undefined);
});

test("o mesmo celular escrito com 10 ou 11 digitos conta junto", async () => {
  const docs = { "configuracoes/agenda": agenda() };
  const criar = montarCriar(docs);
  await criar({ cpf: "11111111111", telefone: "(35) 9999-0000", hora: "14:00" });
  await criar({ cpf: "22222222222", telefone: "(35) 99999-0000", hora: "14:30" });
  await assert.rejects(
    () => criar({ cpf: "33333333333", telefone: "+55 35 99999-0000", hora: "15:00" }),
    ehLimite("limite-telefone")
  );
});

test("cancelar libera o celular sem precisar mexer no indice", async () => {
  const docs = { "configuracoes/agenda": agenda() };
  const criar = montarCriar(docs);
  const { agendamento } = await criar({ cpf: "11111111111", telefone: "35999990000", hora: "14:00" });
  await criar({ cpf: "22222222222", telefone: "35999990000", hora: "14:30" });
  docs[`dados_cidadaos/${agendamento.id}`] = { ...docs[`dados_cidadaos/${agendamento.id}`], status: "cancelado_cidadao", ativo: false };
  await criar({ cpf: "33333333333", telefone: "35999990000", hora: "15:00" });
  const indice = Object.entries(docs).find(([p]) => p.startsWith("telefones_agendados/"))[1];
  assert.equal(indice.agendamentoIds.length, 2, "O cancelado sai do indice na gravacao seguinte.");
  assert.ok(!indice.agendamentoIds.includes(agendamento.id));
});

test("atendimentos que ja passaram nao contam", async () => {
  const docs = { "configuracoes/agenda": agenda() };
  await montarCriar(docs)({ cpf: "11111111111", telefone: "35999990000", hora: "14:00" });
  await montarCriar(docs)({ cpf: "22222222222", telefone: "35999990000", hora: "14:30" });
  // Uma semana depois, as duas datas passaram.
  const docs2 = { ...docs, "configuracoes/agenda": agenda({ dias: ["2026-10-06"], gradesAtendimento: [{ inicio: "2026-09-28", horarios: [{ hora: "14:00", vagas: 1 }] }] }) };
  await montarCriar(docs2, { hoje: "2026-10-05" })({ cpf: "33333333333", telefone: "35999990000", hora: "14:00", data: "2026-10-06" });
});

test("a recepcao ajusta o teto do telefone pela configuracao, sem deploy", async () => {
  const docs = { "configuracoes/agenda": agenda({ limitesAgendamento: { porTelefone: 3 } }) };
  const criar = montarCriar(docs);
  for (const [i, cpf] of ["11111111111", "22222222222", "33333333333"].entries()) {
    await criar({ cpf, telefone: "35999990000", hora: HORAS[i] });
  }
  await assert.rejects(() => criar({ cpf: "44444444444", telefone: "35999990000", hora: "15:30" }), ehLimite("limite-telefone"));
});

test("indice do telefone nao guarda o numero, so o hash e os ids", async () => {
  const docs = { "configuracoes/agenda": agenda() };
  await montarCriar(docs)({ cpf: "11111111111", telefone: "35999990000", hora: "14:00" });
  const [caminho, indice] = Object.entries(docs).find(([p]) => p.startsWith("telefones_agendados/"));
  assert.match(caminho, /^telefones_agendados\/tel_[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(indice).sort(), ["agendamentoIds", "atualizado", "expiraEm"]);
  assert.ok(!JSON.stringify(indice).includes("99990000"));
  assert.ok(indice.expiraEm > Date.parse("2026-09-29T23:59:59-03:00"), "So expira depois do atendimento.");
});

// ---- Criacao: teto por origem -----------------------------------------------

test("quinto agendamento da mesma conexao no dia e recusado", async () => {
  const docs = { "configuracoes/agenda": agenda() };
  const criar = montarCriar(docs);
  for (let i = 0; i < 4; i++) {
    await criar({ cpf: `1000000000${i}`, telefone: `3599999000${i}`, hora: HORAS[i], ip: "200.1.2.3" });
  }
  await assert.rejects(
    () => criar({ cpf: "10000000009", telefone: "35999990009", hora: "16:00", ip: "200.1.2.3" }),
    (e) => ehLimite("limite-origem")(e) && e.details.teto === 4
  );
  assert.equal(agendamentosGravados(docs), 4);
  // Outra conexao segue livre.
  await criar({ cpf: "20000000000", telefone: "35888880000", hora: "16:00", ip: "200.9.9.9" });
});

test("X-Forwarded-For forjado pelo cliente nao zera a contagem", async () => {
  const docs = { "configuracoes/agenda": agenda({ limitesAgendamento: { porOrigemDia: 1 } }) };
  const criar = montarCriar(docs);
  await criar({ cpf: "11111111111", telefone: "35999990001", hora: "14:00", ip: "200.1.2.3" });
  // O cliente escreve um IP falso antes; o balanceador ainda acrescenta o real.
  await assert.rejects(
    () => criar({ cpf: "22222222222", telefone: "35999990002", hora: "14:30", ip: "9.9.9.9, 200.1.2.3" }),
    ehLimite("limite-origem")
  );
});

test("IPv6: outro endereco do mesmo /64 conta junto", async () => {
  const docs = { "configuracoes/agenda": agenda({ limitesAgendamento: { porOrigemDia: 1 } }) };
  const criar = montarCriar(docs);
  await criar({ cpf: "11111111111", telefone: "35999990001", hora: "14:00", ip: "2804:14c:1:2::10" });
  await assert.rejects(
    () => criar({ cpf: "22222222222", telefone: "35999990002", hora: "14:30", ip: "2804:14c:1:2::99" }),
    ehLimite("limite-origem")
  );
});

test("a contagem da origem recomeca no dia seguinte", async () => {
  const docs = { "configuracoes/agenda": agenda({ limitesAgendamento: { porOrigemDia: 1 } }) };
  await montarCriar(docs)({ cpf: "11111111111", telefone: "35999990001", hora: "14:00", ip: "200.1.2.3" });
  await montarCriar(docs, { hoje: "2026-09-29" })({ cpf: "22222222222", telefone: "35999990002", hora: "14:30", data: "2026-09-30", ip: "200.1.2.3" });
});

test("sem IP o teto de origem nao se aplica", async () => {
  const docs = { "configuracoes/agenda": agenda({ limitesAgendamento: { porOrigemDia: 1 } }) };
  const criar = montarCriar(docs);
  for (let i = 0; i < 3; i++) {
    await criar({ cpf: `1000000000${i}`, telefone: `3599999000${i}`, hora: HORAS[i] });
  }
  assert.ok(!Object.keys(docs).some((p) => p.startsWith("limites_origem/")));
});

test("teto zero na configuracao desliga a origem", async () => {
  const docs = { "configuracoes/agenda": agenda({ limitesAgendamento: { porOrigemDia: 0 } }) };
  const criar = montarCriar(docs);
  for (let i = 0; i < 6; i++) {
    await criar({ cpf: `1000000000${i}`, telefone: `3599999000${i}`, hora: HORAS[i], ip: "200.1.2.3" });
  }
});

// ---- Contadores so andam quando a reserva grava -----------------------------

test("perder a vaga nao consome a cota da origem nem do telefone", async () => {
  const docs = { "configuracoes/agenda": agenda({ limitesAgendamento: { porOrigemDia: 1, porTelefone: 1 } }) };
  const criar = montarCriar(docs);
  await criar({ cpf: "11111111111", telefone: "35111110000", hora: "14:00", ip: "200.9.9.9" });
  await assert.rejects(
    () => criar({ cpf: "22222222222", telefone: "35999990000", hora: "14:00", ip: "200.1.2.3" }),
    (e) => e.code === "already-exists"
  );
  await criar({ cpf: "22222222222", telefone: "35999990000", hora: "14:30", ip: "200.1.2.3" });
});

test("repetir o mesmo pedido (mesmo operationId) nao conta duas vezes", async () => {
  const docs = { "configuracoes/agenda": agenda({ limitesAgendamento: { porOrigemDia: 1 } }) };
  const criar = montarCriar(docs);
  const pedido = { cpf: "11111111111", telefone: "35999990001", hora: "14:00", ip: "200.1.2.3", operationId: "mesmo" };
  const primeiro = await criar(pedido);
  const repetido = await criar(pedido);
  assert.deepEqual(repetido, primeiro);
  const [, origem] = Object.entries(docs).find(([p]) => p.startsWith("limites_origem/"));
  assert.equal(origem.contagem, 1);
});

test("CPF ja agendado continua com a mensagem propria, antes dos tetos", async () => {
  const docs = { "configuracoes/agenda": agenda({ limitesAgendamento: { porTelefone: 1 } }) };
  const criar = montarCriar(docs);
  await criar({ cpf: "11111111111", telefone: "35999990000", hora: "14:00" });
  await assert.rejects(
    () => criar({ cpf: "11111111111", telefone: "35999990000", hora: "14:30" }),
    (e) => e.code === "already-exists" && e.details && e.details.tipo === "cpf-ja-agendado"
  );
});

// ---- Fonte --------------------------------------------------------------------

test("os tetos ficam dentro da transacao, antes de qualquer escrita", () => {
  const criar = extrairExport(backend, "criarAgendamentoCidadao");
  const transacao = criar.slice(criar.indexOf("db.runTransaction"));
  const primeiraEscrita = transacao.search(/\bt\.(set|delete|create)\(/);
  assert.ok(transacao.indexOf("excedeTeto(contamNoTelefone.length") > 0);
  assert.ok(transacao.indexOf("excedeTeto(usadosOrigem") < primeiraEscrita);
  assert.ok(transacao.indexOf("excedeTeto(contamNoTelefone.length") < primeiraEscrita);
  assert.match(criar, /chaveOrigemLimite\(ipOrigemConfiavel\(request\)\)/, "A origem usa o IP do balanceador, nao o primeiro X-Forwarded-For.");
});

test("limpeza diaria apaga os contadores vencidos", () => {
  const limpar = extrairFuncao(backend, "limparAuxiliaresExpirados");
  assert.match(limpar, /limparColecaoExpirada\("limites_origem", agora\)/);
  assert.match(limpar, /limparColecaoExpirada\("telefones_agendados", agora\)/);
});

test("regras do Firestore fecham as colecoes novas ao cliente", () => {
  const regras = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  for (const colecao of ["limites_origem", "telefones_agendados"]) {
    assert.match(regras, new RegExp(`match /${colecao}/\\{documentId\\} \\{\\s*allow read, write: if false;`));
  }
});

test("site explica o teto em vez de mandar esperar", () => {
  const site = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(site, /function erroLimiteAgendamento\(/);
  const confirmar = site.slice(site.indexOf("const e = ultimoErro;"));
  assert.ok(
    confirmar.indexOf("erroLimiteAgendamento(e)") < confirmar.indexOf("resource-exhausted"),
    "O teto precisa ser tratado antes da mensagem generica de muitas tentativas."
  );
  assert.match(site, /WhatsApp \(35\) 3504-0397/);
});
