"use strict";

const DATA_CORTE_GRADE_NOVA = "2026-08-18";
const HORARIOS_LEGADOS = ["14:20", "14:40", "15:00", "15:20", "15:40", "16:00", "16:20", "16:40"];
const HORARIOS_NOVOS = ["14:30", "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30", "16:45"];

function normalizarListaHorarios(valor) {
  const base = Array.isArray(valor) ? valor : [];
  return [...new Set(base
    .filter((hora) => /^\d{2}:\d{2}$/.test(String(hora || "")))
    .map(String))].sort();
}

function diaSemanaISO(dataISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataISO || ""))) return -1;
  const data = new Date(`${dataISO}T12:00:00-03:00`);
  return Number.isNaN(data.getTime()) ? -1 : data.getDay();
}

function normalizarHorariosPorDiaSemana(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const limpo = {};
  for (let dia = 0; dia <= 6; dia++) {
    const chave = String(dia);
    if (Object.prototype.hasOwnProperty.call(valor, chave) && Array.isArray(valor[chave])) {
      // Lista vazia e uma configuracao explicita: significa sem atendimento no dia.
      limpo[chave] = normalizarListaHorarios(valor[chave]);
    }
  }
  return limpo;
}

function horariosPadraoParaData(dataISO) {
  return String(dataISO || "") < DATA_CORTE_GRADE_NOVA
    ? [...HORARIOS_LEGADOS]
    : [...HORARIOS_NOVOS];
}

function horariosParaData(agenda, dataISO) {
  const chave = String(diaSemanaISO(dataISO));
  const configurados = agenda && agenda.horariosPorDiaSemana;
  if (configurados && Object.prototype.hasOwnProperty.call(configurados, chave) && Array.isArray(configurados[chave])) {
    return normalizarListaHorarios(configurados[chave]);
  }
  return horariosPadraoParaData(dataISO);
}

function horarioPertenceAgenda(agenda, dataISO, hora) {
  return Boolean(agenda && Array.isArray(agenda.dias) && agenda.dias.includes(dataISO))
    && horariosParaData(agenda, dataISO).includes(String(hora || ""));
}

module.exports = {
  DATA_CORTE_GRADE_NOVA,
  HORARIOS_LEGADOS,
  HORARIOS_NOVOS,
  normalizarListaHorarios,
  diaSemanaISO,
  normalizarHorariosPorDiaSemana,
  horariosPadraoParaData,
  horariosParaData,
  horarioPertenceAgenda
};
