"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  segundaDaSemanaISO,
  normalizarAutomacaoSemanal,
  planoSemana,
  proximaSemanaComAtendimento
} = require("./agenda-automation");

test("localiza a segunda-feira da semana inclusive a partir do domingo", () => {
  assert.equal(segundaDaSemanaISO("2026-08-17"), "2026-08-17");
  assert.equal(segundaDaSemanaISO("2026-08-20"), "2026-08-17");
  assert.equal(segundaDaSemanaISO("2026-08-23"), "2026-08-17");
});

test("padrao abre de terca a sexta as 08:00", () => {
  assert.deepEqual(planoSemana({}, "2026-08-17"), {
    ativa: true,
    segunda: "2026-08-17",
    semanaPausada: false,
    publicarEm: "2026-08-17T08:00",
    datas: ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"]
  });
});

test("semana pausada prevalece sobre os dias padrao", () => {
  const plano = planoSemana({ semanasPausadas: ["2026-08-19"] }, "2026-08-17");
  assert.equal(plano.semanaPausada, true);
  assert.deepEqual(plano.datas, []);
});

test("bloqueios por data e por ferias prevalecem sobre a automacao", () => {
  const plano = planoSemana({
    diasSemana: [1, 2, 3, 4, 5],
    datasBloqueadas: ["2026-08-18"],
    periodosBloqueados: [{ inicio: "2026-08-19", fim: "2026-08-20", motivo: "Ferias" }]
  }, "2026-08-17");
  assert.deepEqual(plano.datas, ["2026-08-17", "2026-08-21"]);
});

test("automacao desativada nao gera datas", () => {
  assert.deepEqual(planoSemana({ ativa: false }, "2026-08-17").datas, []);
});

test("encontra a proxima segunda que tenha atendimento", () => {
  const proxima = proximaSemanaComAtendimento({
    semanasPausadas: ["2026-08-24"],
    periodosBloqueados: [{ inicio: "2026-08-31", fim: "2026-09-04", motivo: "Ferias" }]
  }, "2026-08-17");
  assert.equal(proxima.segunda, "2026-09-07");
  assert.deepEqual(proxima.datas, ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
});

test("normalizacao descarta entradas invalidas e limita aos dias uteis", () => {
  assert.deepEqual(normalizarAutomacaoSemanal({
    diasSemana: [0, 2, 2, 6, 4],
    horaAbertura: "99:00",
    datasBloqueadas: ["invalida", "2026-08-20"]
  }), {
    ativa: true,
    horaAbertura: "08:00",
    diasSemana: [2, 4],
    semanasPausadas: [],
    datasBloqueadas: ["2026-08-20"],
    periodosBloqueados: []
  });
});
