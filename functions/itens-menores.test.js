"use strict";

// Itens menores da auditoria de 16/10/2026: BUG-02 (contagem publica), BUG-04
// (nascimento implausivel) e LGPD-04 (consentimento do convite de avaliacao).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const grade = require("./agenda-grade");
const cache = require("./agenda-cache-publica");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

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

// ---- BUG-02 -----------------------------------------------------------------

function montarDisponibilidade(vagas, agendamentos) {
  const snap = (id, dados) => ({ id, exists: dados !== undefined, data: () => dados });
  const db = {
    collection: (colecao) => ({
      where: () => ({ get: async () => ({ docs: Object.entries(vagas).map(([id, d]) => snap(id, d)) }) }),
      doc: (id) => ({ colecao, id })
    }),
    getAll: async (...refs) => refs.map((r) => snap(r.id, agendamentos[r.id]))
  };
  const agenda = {
    dias: ["2026-10-20"],
    horariosPorDiaSemana: {},
    gradesAtendimento: grade.normalizarGradesAtendimento([{ inicio: "2026-10-01", horarios: [{ hora: "14:30", vagas: 1 }, { hora: "15:00", vagas: 2 }] }]),
    publicacaoDatas: {},
    automacaoSemanal: { ativa: false }
  };
  const ativo = new Function(`${extrairFuncao(backend, "agendamentoEstaAtivo")}; return agendamentoEstaAtivo;`)();
  const ocupacao = new Function("agendamentoEstaAtivo", `${extrairFuncao(backend, "slotRepresentaOcupacaoAtual")}; return slotRepresentaOcupacaoAtual;`)(ativo);
  return new Function(
    "db", "carregarAgenda", "agoraSaoPauloInput", "hojeSaoPauloISO", "vagaContaNoSite", "horariosParaData",
    "gradeDetalhadaParaData", "horarioAgendamentoFuturo", "fimAtualizacaoRapida", "cacheControlAgendaPublica",
    "slotRepresentaOcupacaoAtual",
    `${extrairFuncao(backend, "carregarDisponibilidadePublica")}; return carregarDisponibilidadePublica;`
  )(
    db, async () => agenda, () => "2026-10-16T10:00", () => "2026-10-16",
    new Function(`${extrairFuncao(backend, "vagaContaNoSite")}; return vagaContaNoSite;`)(),
    grade.horariosParaData, grade.gradeDetalhadaParaData, () => true,
    cache.fimAtualizacaoRapida, cache.cacheControlAgendaPublica, ocupacao
  );
}

test("BUG-02: vaga de agendamento cancelado nao conta como ocupada no site", async () => {
  const carregar = montarDisponibilidade({
    "2026-10-20_14:30": { dataISO: "2026-10-20", hora: "14:30", agendamentoId: "CANCELADO" },
    "2026-10-20_15:00": { dataISO: "2026-10-20", hora: "15:00", agendamentoId: "ATIVO" },
    "2026-10-20_15:00_2": { dataISO: "2026-10-20", hora: "15:00" }
  }, {
    CANCELADO: { status: "cancelado_cidadao", ativo: false },
    ATIVO: { status: "agendado" }
  });
  const { payload } = await carregar();
  const horarios = Object.fromEntries(payload.dias[0].horarios.map((h) => [h.hora, h.vagas]));
  assert.equal(horarios["14:30"], 1, "Cancelado libera a vaga, como na transacao.");
  assert.equal(horarios["15:00"], 0, "Ativo e vaga sem agendamentoId (legado) continuam ocupando.");
});

test("BUG-02: agendamento apagado conta como livre; manual nao conta no site", async () => {
  const carregar = montarDisponibilidade({
    "2026-10-20_14:30": { dataISO: "2026-10-20", hora: "14:30", agendamentoId: "SUMIU" },
    "manual_X": { dataISO: "2026-10-20", hora: "15:00", agendamentoId: "X", origem: "manual", contabilizaVaga: false }
  }, { X: { status: "agendado" } });
  const { payload } = await carregar();
  assert.equal(payload.totalVagasRestantes, 3);
});

// ---- BUG-04 -----------------------------------------------------------------

test("BUG-04: backend recusa nascimento no futuro ou antes de 1900", () => {
  const criar = backend.slice(backend.indexOf("exports.criarAgendamentoCidadao"), backend.indexOf("exports.prepararCancelamentoCidadao"));
  assert.match(criar, /if \(dataNasc > hojeSaoPauloISO\(\) \|\| dataNasc < "1900-01-01"\) \{\s*throw new HttpsError\("invalid-argument", "Informe a data de nascimento corretamente\."\);/);
  assert.doesNotMatch(backend, /validarIdadeMinimaAgendamento/, "A funcao vazia saiu.");
});

test("BUG-04: site recusa as mesmas datas antes de enviar", () => {
  const valida = new Function(
    "converterDataISO", "hojeISO",
    `${extrairFuncao(sitePublico, "nascimentoAgendamentoValido")}; return nascimentoAgendamentoValido;`
  )((br) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; }, () => "2026-10-16");
  assert.equal(valida("17/05/1980"), "1980-05-17");
  assert.equal(valida("16/10/2026"), "2026-10-16");
  assert.equal(valida("17/10/2026"), "");
  assert.equal(valida("31/12/1899"), "");
});

// ---- LGPD-04 ----------------------------------------------------------------

test("LGPD-04: caixa do convite e opcional, desmarcada e separada do aceite", () => {
  assert.match(sitePublico, /<input type="checkbox" id="aceite-avaliacao">/, "Comeca desmarcada.");
  assert.match(sitePublico, /<strong>Opcional:<\/strong> quero receber no e-mail informado/);
  assert.match(extrairFuncao(sitePublico, "destacarAceitesPendentes"), /\["aceite-lgpd"\]/, "So o aceite do agendamento e obrigatorio.");
  assert.match(sitePublico, /aceiteAvaliacao: Boolean\(email\) && \(document\.getElementById\("aceite-avaliacao"\) \|\| \{\}\)\.checked === true/);
});

test("LGPD-04: backend grava o consentimento so com caixa marcada e e-mail", () => {
  const criar = backend.slice(backend.indexOf("exports.criarAgendamentoCidadao"), backend.indexOf("exports.prepararCancelamentoCidadao"));
  assert.match(criar, /const consentimentoAvaliacao = dadosRequisicao\.aceiteAvaliacao === true && Boolean\(email\);/);
  assert.match(criar, /\.\.\.\(consentimentoAvaliacao \? \{ consentimentoAvaliacao: true, consentimentoAvaliacaoEm: criado \} : \{\}\)/);
  const avaliacao = fs.readFileSync(path.join(__dirname, "avaliacao-google.js"), "utf8");
  assert.match(avaliacao, /dados\.consentimentoAvaliacao === true;/);
});
