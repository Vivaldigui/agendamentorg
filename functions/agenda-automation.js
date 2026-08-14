"use strict";

const DIAS_ATENDIMENTO_PADRAO = [2, 3, 4, 5]; // Terca a sexta.
const HORA_ABERTURA_PADRAO = "08:00";
const LIMITE_EXCECOES = 400;

function dataISOValida(valor) {
  const texto = String(valor || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [ano, mes, dia] = texto.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function somarDiasISO(dataISO, quantidade) {
  if (!dataISOValida(dataISO)) throw new Error("Data ISO invalida.");
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + Number(quantidade || 0)));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
}

function diaSemanaISO(dataISO) {
  if (!dataISOValida(dataISO)) return -1;
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

function segundaDaSemanaISO(dataISO) {
  const diaSemana = diaSemanaISO(dataISO);
  if (diaSemana < 0) throw new Error("Data ISO invalida.");
  const deslocamento = diaSemana === 0 ? -6 : 1 - diaSemana;
  return somarDiasISO(dataISO, deslocamento);
}

function listaDatas(valor) {
  const base = Array.isArray(valor) ? valor : [];
  return [...new Set(base.filter(dataISOValida).map(String))].sort().slice(0, LIMITE_EXCECOES);
}

function normalizarPeriodos(valor) {
  const base = Array.isArray(valor) ? valor : [];
  const periodos = [];
  for (const item of base) {
    const inicio = item && String(item.inicio || "");
    const fim = item && String(item.fim || "");
    if (!dataISOValida(inicio) || !dataISOValida(fim) || fim < inicio) continue;
    periodos.push({
      inicio,
      fim,
      motivo: String(item.motivo || "").trim().slice(0, 120)
    });
    if (periodos.length >= LIMITE_EXCECOES) break;
  }
  return periodos.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fim.localeCompare(b.fim));
}

function normalizarAutomacaoSemanal(valor) {
  const origem = valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
  const diasInformados = Array.isArray(origem.diasSemana)
    ? origem.diasSemana.map(Number).filter((dia) => Number.isInteger(dia) && dia >= 1 && dia <= 5)
    : DIAS_ATENDIMENTO_PADRAO;
  const diasSemana = [...new Set(diasInformados)].sort((a, b) => a - b);
  const horaAbertura = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(origem.horaAbertura || ""))
    ? String(origem.horaAbertura)
    : HORA_ABERTURA_PADRAO;

  return {
    ativa: origem.ativa !== false,
    horaAbertura,
    diasSemana,
    semanasPausadas: listaDatas(origem.semanasPausadas).map(segundaDaSemanaISO).filter((data, indice, lista) => lista.indexOf(data) === indice).sort(),
    datasBloqueadas: listaDatas(origem.datasBloqueadas),
    periodosBloqueados: normalizarPeriodos(origem.periodosBloqueados)
  };
}

function dataBloqueada(config, dataISO) {
  const cfg = normalizarAutomacaoSemanal(config);
  if (cfg.datasBloqueadas.includes(dataISO)) return true;
  return cfg.periodosBloqueados.some((periodo) => dataISO >= periodo.inicio && dataISO <= periodo.fim);
}

function planoSemana(config, segundaISO) {
  const cfg = normalizarAutomacaoSemanal(config);
  const segunda = segundaDaSemanaISO(segundaISO);
  const semanaPausada = cfg.semanasPausadas.includes(segunda);
  const datas = cfg.ativa && !semanaPausada
    ? cfg.diasSemana
      .map((diaSemana) => somarDiasISO(segunda, diaSemana - 1))
      .filter((dataISO) => !dataBloqueada(cfg, dataISO))
    : [];

  return {
    ativa: cfg.ativa,
    segunda,
    semanaPausada,
    publicarEm: `${segunda}T${cfg.horaAbertura}`,
    datas
  };
}

function proximaSemanaComAtendimento(config, depoisDeSegundaISO, limiteSemanas = 104) {
  const cfg = normalizarAutomacaoSemanal(config);
  let segunda = segundaDaSemanaISO(depoisDeSegundaISO);
  for (let i = 0; i < limiteSemanas; i++) {
    segunda = somarDiasISO(segunda, 7);
    const plano = planoSemana(cfg, segunda);
    if (plano.datas.length) return plano;
  }
  return null;
}

module.exports = {
  DIAS_ATENDIMENTO_PADRAO,
  HORA_ABERTURA_PADRAO,
  dataISOValida,
  somarDiasISO,
  diaSemanaISO,
  segundaDaSemanaISO,
  normalizarAutomacaoSemanal,
  dataBloqueada,
  planoSemana,
  proximaSemanaComAtendimento
};
