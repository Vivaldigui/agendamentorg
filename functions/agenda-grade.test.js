"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HORARIOS_LEGADOS,
  HORARIOS_NOVOS,
  horariosParaData,
  horarioPertenceAgenda
} = require("./agenda-grade");

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
