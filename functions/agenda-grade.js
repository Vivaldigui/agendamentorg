"use strict";

const DATA_CORTE_GRADE_NOVA = "2026-08-18";
// A partir da semana aberta em 21/09/2026, seis atendimentos a cada 25 minutos.
const DATA_CORTE_GRADE_SEIS = "2026-09-21";
const HORARIOS_LEGADOS = ["14:20", "14:40", "15:00", "15:20", "15:40", "16:00", "16:20", "16:40"];
const HORARIOS_NOVOS = ["14:30", "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30", "16:45"];
const HORARIOS_SEIS = ["14:30", "14:55", "15:20", "15:45", "16:10", "16:35"];

// Grades definidas pela recepcao no painel, cada uma com data de inicio de
// vigencia. Ficam em configuracoes/agenda.gradesAtendimento:
//
//   [{ inicio: "2026-09-28",
//      horarios: [{ hora: "14:30", vagas: 2 }, ...],
//      porDiaSemana: { "5": [{ hora: "09:00", vagas: 1 }] } }]
//
// Para uma data vale a grade de MAIOR inicio que ainda seja <= data. Assim a
// mudanca feita hoje para a semana que vem nao toca nas datas ja publicadas,
// e as datas anteriores a primeira grade continuam na regra antiga (cortes
// fixos acima ou horariosPorDiaSemana). `porDiaSemana` e opcional; lista vazia
// nele significa sem atendimento naquele dia da semana.
const LIMITE_VAGAS_POR_HORARIO = 10;
const LIMITE_HORARIOS_POR_DIA = 40;
const LIMITE_GRADES_ATENDIMENTO = 60;
const FORMATO_HORA_GRADE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FORMATO_DATA_GRADE = /^\d{4}-\d{2}-\d{2}$/;

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

function normalizarVagasHorario(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1) return 1;
  return Math.min(numero, LIMITE_VAGAS_POR_HORARIO);
}

// Aceita "14:30" (uma vaga) ou { hora, vagas }. Horario repetido fica com o
// maior numero de vagas informado.
function normalizarItensGrade(valor) {
  const base = Array.isArray(valor) ? valor : [];
  const porHora = new Map();
  for (const item of base) {
    const objeto = item && typeof item === "object" && !Array.isArray(item);
    const hora = String(objeto ? item.hora : item || "");
    if (!FORMATO_HORA_GRADE.test(hora)) continue;
    const vagas = objeto ? normalizarVagasHorario(item.vagas) : 1;
    porHora.set(hora, Math.max(porHora.get(hora) || 0, vagas));
  }
  return [...porHora.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, LIMITE_HORARIOS_POR_DIA)
    .map(([hora, vagas]) => ({ hora, vagas }));
}

function dataGradeValida(valor) {
  const texto = String(valor || "");
  if (!FORMATO_DATA_GRADE.test(texto)) return false;
  const [ano, mes, dia] = texto.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function normalizarGradesAtendimento(valor) {
  const base = Array.isArray(valor) ? valor : [];
  const porInicio = new Map();
  for (const item of base) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const inicio = String(item.inicio || "");
    if (!dataGradeValida(inicio)) continue;
    const porDiaSemana = {};
    const origemDias = item.porDiaSemana && typeof item.porDiaSemana === "object" && !Array.isArray(item.porDiaSemana)
      ? item.porDiaSemana
      : {};
    for (let dia = 0; dia <= 6; dia++) {
      const chave = String(dia);
      if (Object.prototype.hasOwnProperty.call(origemDias, chave) && Array.isArray(origemDias[chave])) {
        porDiaSemana[chave] = normalizarItensGrade(origemDias[chave]);
      }
    }
    // Mesma data de inicio gravada duas vezes: vale a ultima da lista.
    porInicio.set(inicio, { inicio, horarios: normalizarItensGrade(item.horarios), porDiaSemana });
  }
  return [...porInicio.values()]
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .slice(-LIMITE_GRADES_ATENDIMENTO);
}

function gradeVigenteParaData(grades, dataISO) {
  const data = String(dataISO || "");
  let vigente = null;
  for (const grade of normalizarGradesAtendimento(grades)) {
    if (grade.inicio <= data) vigente = grade;
  }
  return vigente;
}

// Horarios da data com o numero de vagas de cada um.
function gradeDetalhadaParaData(agenda, dataISO) {
  const vigente = gradeVigenteParaData(agenda && agenda.gradesAtendimento, dataISO);
  if (vigente) {
    const chave = String(diaSemanaISO(dataISO));
    return Object.prototype.hasOwnProperty.call(vigente.porDiaSemana, chave)
      ? vigente.porDiaSemana[chave].map((item) => ({ ...item }))
      : vigente.horarios.map((item) => ({ ...item }));
  }
  return horariosSemGradeConfigurada(agenda, dataISO).map((hora) => ({ hora, vagas: 1 }));
}

function vagasDoHorario(agenda, dataISO, hora) {
  const item = gradeDetalhadaParaData(agenda, dataISO).find((h) => h.hora === String(hora || ""));
  return item ? item.vagas : 0;
}

// Documentos de vagas_ocupadas de um horario. A primeira vaga mantem o id de
// sempre (AAAA-MM-DD_HH:MM); as demais ganham sufixo _2, _3... Cada vaga e um
// documento proprio, entao a transacao continua impedindo dupla reserva.
function slotIdsDoHorario(dataISO, hora, quantidade = LIMITE_VAGAS_POR_HORARIO) {
  const total = Math.max(1, Math.min(Number(quantidade) || 1, LIMITE_VAGAS_POR_HORARIO));
  return Array.from({ length: total }, (_, i) => (i === 0 ? `${dataISO}_${hora}` : `${dataISO}_${hora}_${i + 1}`));
}

function horariosParaData(agenda, dataISO) {
  return gradeDetalhadaParaData(agenda, dataISO).map((item) => item.hora);
}

function horariosSemGradeConfigurada(agenda, dataISO) {
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
  LIMITE_VAGAS_POR_HORARIO,
  LIMITE_HORARIOS_POR_DIA,
  LIMITE_GRADES_ATENDIMENTO,
  normalizarListaHorarios,
  normalizarVagasHorario,
  normalizarItensGrade,
  normalizarGradesAtendimento,
  gradeVigenteParaData,
  gradeDetalhadaParaData,
  vagasDoHorario,
  slotIdsDoHorario,
  diaSemanaISO,
  normalizarHorariosPorDiaSemana,
  horariosPadraoParaData,
  horariosParaData,
  horarioPertenceAgenda
};
