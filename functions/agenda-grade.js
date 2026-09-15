"use strict";

const DATA_CORTE_GRADE_NOVA = "2026-08-18";
// A partir da semana aberta em 21/09/2026, seis atendimentos a cada 25 minutos.
const DATA_CORTE_GRADE_SEIS = "2026-09-21";
const HORARIOS_LEGADOS = ["14:20", "14:40", "15:00", "15:20", "15:40", "16:00", "16:20", "16:40"];
const HORARIOS_NOVOS = ["14:30", "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30", "16:45"];
const HORARIOS_SEIS = ["14:30", "14:55", "15:20", "15:45", "16:10", "16:35"];

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
  const data = String(dataISO || "");
  if (data < DATA_CORTE_GRADE_NOVA) return [...HORARIOS_LEGADOS];
  if (data < DATA_CORTE_GRADE_SEIS) return [...HORARIOS_NOVOS];
  return [...HORARIOS_SEIS];
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
  DATA_CORTE_GRADE_SEIS,
  HORARIOS_LEGADOS,
  HORARIOS_NOVOS,
  HORARIOS_SEIS,
  normalizarListaHorarios,
  diaSemanaISO,
  normalizarHorariosPorDiaSemana,
  horariosPadraoParaData,
  horariosParaData,
  horarioPertenceAgenda
};
