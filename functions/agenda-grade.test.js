"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DATA_CORTE_GRADE_SEIS,
  HORARIOS_LEGADOS,
  HORARIOS_NOVOS,
  HORARIOS_SEIS,
  horariosParaData,
  horarioPertenceAgenda
} = require("./agenda-grade");

function minutos(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

test("17/08/2026 usa somente a grade legada de oito horarios", () => {
  const horarios = horariosParaData({ horariosPorDiaSemana: {} }, "2026-08-17");
  assert.deepEqual(horarios, HORARIOS_LEGADOS);
  assert.equal(horarios.length, 8);
  assert.equal(horarios.includes("14:30"), false);
});

test("18/08/2026 usa somente a grade nova de dez horarios", () => {
  const horarios = horariosParaData({ horariosPorDiaSemana: {} }, "2026-08-18");
  assert.deepEqual(horarios, HORARIOS_NOVOS);
  assert.equal(horarios.length, 10);
  assert.equal(horarios.includes("14:20"), false);
});

test("grade explicita do dia da semana prevalece antes do corte", () => {
  const agenda = { horariosPorDiaSemana: { "1": ["13:00", "13:15"] } };
  assert.deepEqual(horariosParaData(agenda, "2026-08-17"), ["13:00", "13:15"]);
});

test("agendamento legado as 14:20 continua permitido antes do corte", () => {
  const agenda = { dias: ["2026-08-17"], horariosPorDiaSemana: {} };
  assert.equal(horarioPertenceAgenda(agenda, "2026-08-17", "14:20"), true);
});

test("horario novo as 14:30 e rejeitado antes do corte", () => {
  const agenda = { dias: ["2026-08-17"], horariosPorDiaSemana: {} };
  assert.equal(horarioPertenceAgenda(agenda, "2026-08-17", "14:30"), false);
});

test("20/09/2026 ainda usa a grade de dez horarios", () => {
  assert.deepEqual(horariosParaData({ horariosPorDiaSemana: {} }, "2026-09-20"), HORARIOS_NOVOS);
});

test("a partir de 21/09/2026 a grade tem seis horarios a cada 25 minutos", () => {
  assert.equal(DATA_CORTE_GRADE_SEIS, "2026-09-21");
  for (const data of ["2026-09-21", "2026-09-22", "2026-09-25"]) {
    assert.deepEqual(horariosParaData({ horariosPorDiaSemana: {} }, data), HORARIOS_SEIS, data);
  }
  assert.deepEqual(HORARIOS_SEIS, ["14:30", "14:55", "15:20", "15:45", "16:10", "16:35"]);
  for (let i = 1; i < HORARIOS_SEIS.length; i++) {
    assert.equal(minutos(HORARIOS_SEIS[i]) - minutos(HORARIOS_SEIS[i - 1]), 25, HORARIOS_SEIS[i]);
  }
  // O ultimo atendimento termina ate as 17:00.
  assert.ok(minutos(HORARIOS_SEIS.at(-1)) + 25 <= 17 * 60);
});

test("a semana de 15 a 18/09 preserva os horarios antigos; a de 22/09 recusa", () => {
  const agenda = { dias: ["2026-09-18", "2026-09-22"], horariosPorDiaSemana: {} };
  assert.equal(horarioPertenceAgenda(agenda, "2026-09-18", "15:15"), true);
  assert.equal(horarioPertenceAgenda(agenda, "2026-09-22", "15:15"), false);
  assert.equal(horarioPertenceAgenda(agenda, "2026-09-22", "14:55"), true);
});

test("grade explicita do dia da semana prevalece tambem depois do corte de 21/09", () => {
  // 22/09/2026 e terca-feira (dia 2).
  const agenda = { horariosPorDiaSemana: { "2": ["13:00"] } };
  assert.deepEqual(horariosParaData(agenda, "2026-09-22"), ["13:00"]);
});
