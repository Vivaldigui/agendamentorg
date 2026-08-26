"use strict";

// Regressao da janela 07:50-07:59 da abertura semanal.
//
// prepararAgendaSemanalAutomatica roda as 07:50 e reescreve
// avisoNovasVagasProgramado apontando para a PROXIMA semana, com publicarEm as
// 08:00 de hoje. Enquanto esse instante e futuro, avisoNovasVagasAtivo cai no
// campo de topo `dataNovasVagas` -- que a automacao nunca atualizava e por isso
// guardava a abertura da semana anterior.
//
// Efeito medido na configuracao real de producao em 22/08/2026, com o campo
// congelado em "17/08/2026": das 07:50 as 07:59 de 24/08 o alvo do contador
// regressivo caia no passado (contador some) e o banner trocava a data pelo
// texto generico "Novas vagas em breve" -- nos dez minutos de maior audiencia
// da semana. As 08:00 o aviso programado assumia e tudo voltava ao normal.
//
// Aqui as funcoes reais do backend e do site publico sao extraidas e
// executadas, no mesmo padrao de agenda-grade-surfaces.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { aberturaVigenteDaSemana } = require("./agenda-automation");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

function extrairFuncao(codigo, nome) {
  const inicio = codigo.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  const abre = codigo.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(inicio, i + 1);
    }
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

// onSchedule recebe um objeto de opcoes inline, entao a contagem de chaves a
// partir da primeira "{" fecharia nas opcoes, nao no corpo. Aqui o bloco vai
// ate a proxima declaracao de topo.
function extrairBlocoExport(codigo, nome) {
  const inicio = codigo.indexOf(`exports.${nome} =`);
  assert.notEqual(inicio, -1, `Export ${nome} nao encontrado.`);
  const resto = codigo.slice(inicio + 1);
  const proxima = resto.search(/\n(?:exports\.|(?:async )?function |const AGENDA_REF)/);
  return proxima === -1 ? codigo.slice(inicio) : codigo.slice(inicio, inicio + 1 + proxima);
}

const avisoNovasVagasAtivo = new Function(
  "DATA_NOVAS_VAGAS_PADRAO",
  `${extrairFuncao(backend, "avisoNovasVagasAtivo")}; return avisoNovasVagasAtivo;`
)("01/06/2026");

// Estado do documento depois que a automacao das 07:50 grava, na segunda 24/08.
// `dataNovasVagas` reproduz o valor real encontrado em producao: a abertura da
// semana anterior.
function docDepoisDas0750(dataNovasVagasTopo) {
  return {
    dataNovasVagas: dataNovasVagasTopo,
    avisoNovasVagasProgramado: {
      publicarEm: "2026-08-24T08:00",
      dataNovasVagas: "31/08/2026"
    }
  };
}

test("abertura vigente: semana normal e a propria segunda", () => {
  assert.equal(aberturaVigenteDaSemana({ ativa: true, diasSemana: [2, 3, 4, 5] }, "2026-08-24"), "2026-08-24");
});

test("abertura vigente: semana pausada aponta para a proxima com atendimento", () => {
  const cfg = { ativa: true, diasSemana: [2, 3, 4, 5], semanasPausadas: ["2026-08-24"] };
  assert.equal(aberturaVigenteDaSemana(cfg, "2026-08-24"), "2026-08-31");
});

test("abertura vigente: semana inteira bloqueada por ferias pula para a seguinte", () => {
  const cfg = {
    ativa: true,
    diasSemana: [2, 3, 4, 5],
    periodosBloqueados: [{ inicio: "2026-08-24", fim: "2026-08-30", motivo: "ferias" }]
  };
  assert.equal(aberturaVigenteDaSemana(cfg, "2026-08-24"), "2026-08-31");
});

test("abertura vigente: automacao desligada devolve vazio e nao toca no aviso manual", () => {
  assert.equal(aberturaVigenteDaSemana({ ativa: false }, "2026-08-24"), "");
});

test("a automacao semanal grava o campo de topo do aviso", () => {
  const automacao = extrairBlocoExport(backend, "prepararAgendaSemanalAutomatica");
  assert.match(
    automacao,
    /aberturaVigenteDaSemana\(\s*automacao\s*,\s*segunda\s*\)/,
    "Sem gravar a abertura vigente, o fallback do aviso guarda a semana anterior."
  );
  assert.match(
    automacao,
    /atualizacao\.dataNovasVagas\s*=\s*dataBr\(aberturaVigente\)/,
    "O campo de topo precisa entrar na mesma gravacao transacional."
  );
});

test("REGRESSAO: entre 07:50 e 08:00 o aviso aponta para a abertura de hoje", () => {
  const doc = docDepoisDas0750("24/08/2026"); // com a correcao aplicada
  for (const hora of ["07:50", "07:52", "07:55", "07:57", "07:59"]) {
    assert.equal(
      avisoNovasVagasAtivo(doc, `2026-08-24T${hora}`),
      "24/08/2026",
      `As ${hora} o aviso caiu no fallback errado.`
    );
  }
});

test("REGRESSAO: o bug original e reproduzivel, entao a trava mede algo", () => {
  const doc = docDepoisDas0750("17/08/2026"); // estado real de producao, sem a correcao
  assert.equal(avisoNovasVagasAtivo(doc, "2026-08-24T07:55"), "17/08/2026");
});

test("as 08:00 o aviso programado assume e anuncia a proxima semana", () => {
  const doc = docDepoisDas0750("24/08/2026");
  assert.equal(avisoNovasVagasAtivo(doc, "2026-08-24T08:00"), "31/08/2026");
  assert.equal(avisoNovasVagasAtivo(doc, "2026-08-24T09:30"), "31/08/2026");
});

test("no site publico, o que a data errada quebra e o contador, nao o texto", () => {
  const emBreve = new Function(
    "DATA_NOVAS_VAGAS",
    "hojeISO",
    `${extrairFuncao(sitePublico, "avisoNovasVagasEmBreve")}; return avisoNovasVagasEmBreve;`
  );
  const alvo = new Function(
    "desvioParaContador",
    `${extrairFuncao(sitePublico, "alvoContadorNovasVagas")}; return alvoContadorNovasVagas;`
  )(() => 0);

  const hoje = () => "2026-08-24";
  const agoraNaJanela = new Date("2026-08-24T07:55:00-03:00");

  // O texto do banner e o MESMO nos dois casos: na manha da propria abertura
  // hojeISO() ja alcancou a data, entao "Novas vagas em breve" e o esperado.
  // Nao e por ai que o defeito aparece.
  assert.equal(emBreve("17/08/2026", hoje)(), true);
  assert.equal(emBreve("24/08/2026", hoje)(), true);

  // A diferenca esta no alvo do contador. Com a data da semana anterior o alvo
  // nasce no passado: iniciarContadorRegressivo cai no ramo `alvo <= new Date()`,
  // nao desenha contador nenhum e ainda dispara tentarAtualizarAbertura() as
  // 07:50 -- dez minutos antes da publicacao existir.
  assert.ok(alvo("17/08/2026") < agoraNaJanela, "O alvo antigo precisa estar no passado.");
  assert.ok(alvo("24/08/2026") > agoraNaJanela, "O contador precisa continuar correndo as 07:55.");
});

test("o contador so dispara a atualizacao quando o alvo realmente chegou", () => {
  const iniciar = extrairFuncao(sitePublico, "iniciarContadorRegressivo");
  assert.match(
    iniciar,
    /if\s*\(\s*alvo\s*<=\s*new Date\(\)\s*\)\s*\{\s*\n\s*if\s*\(\s*!DIAS_DISPONIVEIS\.length\s*\)\s*tentarAtualizarAbertura\(\)/,
    "Um alvo no passado vira retentativa imediata: por isso a data do aviso precisa estar certa."
  );
});

test("agenda vazia significa agenda fechada, sem lista de datas embutida", () => {
  const processarAgenda = new Function(
    "normalizarPublicacaoDatas",
    "HORARIOS_NOVOS",
    "normalizarHorariosPorDiaSemana",
    "avisoNovasVagasAtivo",
    "avisoPopupPublico",
    "normalizarAutomacaoSemanal",
    `${extrairFuncao(backend, "processarAgenda")}; return processarAgenda;`
  )(() => ({}), [], () => ({}), () => "", () => null, () => ({}));

  assert.deepEqual(processarAgenda({ dias: [] }, "2026-08-22T23:00", "2026-08-22").dias, []);
  assert.deepEqual(processarAgenda({}, "2026-08-22T23:00", "2026-08-22").dias, []);
  assert.deepEqual(processarAgenda(null, "2026-08-22T23:00", "2026-08-22").dias, []);
});

test("nenhuma lista de datas de atendimento fica embutida no backend", () => {
  assert.doesNotMatch(backend, /DIAS_INICIAIS\s*=/);
  const semComentarios = backend.replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(
    semComentarios,
    /const\s+\w+\s*=\s*\[\s*"\d{4}-\d{2}-\d{2}"\s*,\s*"\d{4}-\d{2}-\d{2}"/,
    "Datas de atendimento pertencem ao Firestore, nunca ao codigo."
  );
});
