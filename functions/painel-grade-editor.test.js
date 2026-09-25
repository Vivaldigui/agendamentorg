"use strict";

// Trava de regressao do editor de grade do painel (public/recepcao.js).
//
// A recepcao define horarios e vagas com uma data de inicio. O editor antigo
// era por dia da semana e valia para TODAS as datas daquele dia, inclusive as
// ja publicadas; o novo so vale a partir do inicio escolhido. Estes testes
// garantem que o painel calcula a grade igual ao backend, que o padrao e a
// proxima semana e que salvar nunca apaga agendamento de ninguem.

const test = require("node:test");
const assert = require("node:assert/strict");

const { painel, painelJs, painelHtml } = require("./painel-fonte");
const canonico = require("./agenda-grade");

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

function constante(nome) {
  const m = new RegExp(`const ${nome} = ([^;]+);`).exec(painelJs);
  assert.ok(m, `Constante ${nome} nao encontrada.`);
  return m[1];
}

// Monta o resolvedor do painel com as mesmas funcoes do arquivo.
function montarResolverPainel(horariosPorDiaSemana) {
  const funcoes = [
    "dataISOValidaAutomacao", "indiceDiaSemana", "horariosPadraoParaDataPainel",
    "normalizarVagasHorarioPainel", "normalizarItensGradePainel", "normalizarGradesPainel",
    "gradeVigentePainel", "itensDaGradeNoDia", "gradeDetalhadaParaDataPainel"
  ].map((nome) => extrairFuncao(painelJs, nome)).join("\n");
  const constantes = [
    "HORARIOS_LEGADOS", "HORARIOS_NOVOS", "HORARIOS_SEIS", "DATA_CORTE_GRADE_NOVA", "DATA_CORTE_GRADE_SEIS",
    "LIMITE_VAGAS_POR_HORARIO", "LIMITE_HORARIOS_POR_DIA", "LIMITE_GRADES_ATENDIMENTO", "FORMATO_HORA_GRADE"
  ].map((nome) => `const ${nome} = ${constante(nome)};`).join("\n");
  return new Function(
    "agendaHorariosPorDiaSemana",
    `${constantes}\nlet agendaGradesAtendimento = [];\n${funcoes}
     return (grades, dataISO) => gradeDetalhadaParaDataPainel(dataISO, normalizarGradesPainel(grades));`
  )(horariosPorDiaSemana);
}

const CENARIOS = [
  { horariosPorDiaSemana: {}, gradesAtendimento: [] },
  { horariosPorDiaSemana: { "2": ["08:00"] }, gradesAtendimento: [] },
  {
    horariosPorDiaSemana: { "2": ["08:00"] },
    gradesAtendimento: [
      { inicio: "2026-09-28", horarios: [{ hora: "14:00", vagas: 2 }, "15:00", { hora: "16:00", vagas: 99 }] },
      { inicio: "2026-10-05", horarios: ["09:00"], porDiaSemana: { "5": [], "3": [{ hora: "10:00", vagas: 3 }] } },
      { inicio: "2026-02-30", horarios: ["07:00"] },
      { inicio: "2026-10-05", horarios: ["09:30"] }
    ]
  }
];
const DATAS = ["2026-08-17", "2026-08-18", "2026-09-21", "2026-09-22", "2026-09-28", "2026-09-29",
  "2026-10-06", "2026-10-07", "2026-10-09", "2027-03-02"];

test("o painel resolve horarios e vagas exatamente como o backend", () => {
  for (const cenario of CENARIOS) {
    const resolver = montarResolverPainel(cenario.horariosPorDiaSemana);
    const agenda = {
      horariosPorDiaSemana: canonico.normalizarHorariosPorDiaSemana(cenario.horariosPorDiaSemana),
      gradesAtendimento: cenario.gradesAtendimento
    };
    for (const data of DATAS) {
      assert.deepEqual(resolver(cenario.gradesAtendimento, data), canonico.gradeDetalhadaParaData(agenda, data), data);
    }
  }
});

test("painel e backend usam os mesmos limites e os mesmos ids de vaga", () => {
  assert.equal(Number(constante("LIMITE_VAGAS_POR_HORARIO")), canonico.LIMITE_VAGAS_POR_HORARIO);
  assert.equal(Number(constante("LIMITE_HORARIOS_POR_DIA")), canonico.LIMITE_HORARIOS_POR_DIA);
  assert.equal(Number(constante("LIMITE_GRADES_ATENDIMENTO")), canonico.LIMITE_GRADES_ATENDIMENTO);
  const ids = new Function(
    `const LIMITE_VAGAS_POR_HORARIO = ${constante("LIMITE_VAGAS_POR_HORARIO")};
     ${extrairFuncao(painelJs, "slotIdsDoHorarioPainel")}; return slotIdsDoHorarioPainel;`
  )();
  assert.deepEqual(ids("2026-09-29", "14:00"), canonico.slotIdsDoHorario("2026-09-29", "14:00"));
});

test("a nova grade comeca, por padrao, na proxima semana", () => {
  const nova = extrairFuncao(painelJs, "novaEdicaoGrade");
  assert.match(nova, /let vigencia = "proxima";/);
  assert.match(nova, /let dataInicio = proximaSegundaISO\(\);/);
  assert.match(extrairFuncao(painelJs, "proximaSegundaISO"), /somarDiasISO\(segundaDaSemanaPainel\(hojeISO\(\)\), 7\)/);
  // A semana atual continua possivel, a partir de hoje.
  assert.match(extrairFuncao(painelJs, "inicioDaEdicaoGrade"), /vigencia === "atual"\) return hojeISO\(\)/);
});

test("salvar confere agendamentos existentes antes de pedir confirmacao e nunca os apaga", () => {
  const salvar = extrairFuncao(painelJs, "salvarGradeAtendimento");
  assert.match(salvar, /grade\.inicio < hoje/, "Nao pode comecar numa data passada.");
  const conferencia = salvar.indexOf("agendamentosForaDaGrade(");
  const confirmacao = salvar.indexOf("confirmarPainel(");
  const gravacao = salvar.indexOf("gravarAgendaConfig(");
  assert.ok(conferencia > -1 && conferencia < confirmacao && confirmacao < gravacao);
  assert.match(salvar, /gravarAgendaConfig\(\{ gradesAtendimento: resultantes/);
  for (const corpo of [salvar, extrairFuncao(painelJs, "agendamentosForaDaGrade"), extrairFuncao(painelJs, "excluirGradeAtendimento")]) {
    assert.doesNotMatch(corpo, /vagas_ocupadas|\.delete\(|horariosPorDiaSemana/);
  }
});

test("so grade que ainda nao comecou pode ser excluida", () => {
  const excluir = extrairFuncao(painelJs, "excluirGradeAtendimento");
  assert.match(excluir, /if \(!\(inicio > hojeISO\(\)\)\) return avisoPainel/);
  assert.match(excluir, /confirmarPainel\(/);
});

test("remarcacao pelo painel respeita as vagas do horario", () => {
  const remarcar = extrairFuncao(painelJs, "salvarRemarcacao");
  assert.match(remarcar, /slotIdsDoHorarioPainel\(data, hora\)/);
  assert.match(remarcar, /vagasDoHorarioPainel\(data, hora\)/);
});

test("o editor antigo por dia da semana nao volta", () => {
  for (const nome of ["personalizarDiaSemana", "salvarHorariosSemana", "voltarDiaSemanaAoAutomatico"]) {
    assert.doesNotMatch(painel, new RegExp(`${nome}\\b`));
  }
  assert.match(painelHtml, /<div id="grade-atendimento"><\/div>/);
});

test("a gravacao da agenda usa update, para que chaves removidas desaparecam", () => {
  const corpo = extrairFuncao(painel, "gravarAgendaConfig");
  assert.match(corpo, /\.update\(/, "Precisa usar update: set com merge FUNDE mapas e preserva chaves removidas.");
  assert.match(corpo, /not-found/, "Precisa do fallback para documento inexistente.");
});

// Só os mapas cujas chaves sao removidas importam aqui. Gravar responsavelPosto
// ou avisoNovasVagasProgramado com set/merge continua correto: nao ha chave a
// remover, e um teste que reprovasse isso seria ruido.
test("nenhum set/merge direto grava os mapas com remocao de chave", () => {
  const semComentarios = painel.replace(/\/\/[^\n]*/g, "");
  const arriscadas = [...semComentarios.matchAll(/doc\(\s*["']agenda["']\s*\)\s*\.set\(/g)]
    .map((m) => semComentarios.slice(m.index, m.index + 700))
    .filter((trecho) => /publicacaoDatas|horariosPorDiaSemana|gradesAtendimento/.test(trecho));
  assert.deepEqual(
    arriscadas,
    [],
    "Grave via gravarAgendaConfig: set com merge FUNDE mapas e preserva chaves removidas."
  );
});

test("as telas que gravam a agenda passam pelo helper", () => {
  for (const nome of ["salvarGradeAtendimento", "excluirGradeAtendimento", "salvarAgendaGestao", "salvarAutomacaoSemanal"]) {
    assert.match(extrairFuncao(painel, nome), /gravarAgendaConfig\(/, `${nome} deve gravar pelo helper.`);
  }
});
