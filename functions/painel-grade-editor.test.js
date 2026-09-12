"use strict";

// Trava de regressao do editor semanal do painel (public/recepcao.js).
//
// O editor e por dia da semana, mas a grade vale por data. Se ele nao souber
// representar o estado "automatico" (sem chave em horariosPorDiaSemana), a
// recepcao salva sem querer uma grade fixa para todas as datas daquele dia,
// inclusive as anteriores ao corte de 18/08/2026 -- reintroduzindo a
// sobreposicao de atendimentos que a grade por data eliminou.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { painel } = require("./painel-fonte");

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

function montarResolver(mapa) {
  const corpo = extrairFuncao(painel, "horariosEditaveisDiaSemana");
  return new Function("agendaHorariosPorDiaSemana", `${corpo}; return horariosEditaveisDiaSemana;`)(mapa);
}

test("dia sem configuracao explicita e reportado como automatico, nao como grade nova", () => {
  const resolver = montarResolver({});
  for (let dia = 0; dia <= 6; dia++) {
    assert.equal(resolver(dia), null, `Dia ${dia} deveria estar em modo automatico.`);
  }
});

test("dia com configuracao explicita devolve a lista gravada, inclusive vazia", () => {
  const resolver = montarResolver({ "2": ["14:20", "14:40"], "3": [] });
  assert.deepEqual(resolver(2), ["14:20", "14:40"]);
  assert.deepEqual(resolver(3), []);
  assert.equal(resolver(4), null);
});

test("o editor oferece caminho de volta ao automatico", () => {
  assert.match(painel, /function\s+voltarDiaSemanaAoAutomatico\s*\(/);
  assert.match(painel, /delete\s+agendaHorariosPorDiaSemana\[/);
  assert.match(painel, /Voltar ao automático/);
});

test("personalizar um dia exige confirmacao explicita", () => {
  const corpo = extrairFuncao(painel, "personalizarDiaSemana");
  assert.match(corpo, /confirmarPainel/);
  assert.match(corpo, /todas as datas|TODAS as datas/i);
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
    .filter((trecho) => /publicacaoDatas|horariosPorDiaSemana/.test(trecho));
  assert.deepEqual(
    arriscadas,
    [],
    "Grave via gravarAgendaConfig: set com merge FUNDE mapas e preserva chaves removidas."
  );
});

test("as tres telas que gravam a agenda passam pelo helper", () => {
  for (const nome of ["salvarHorariosSemana", "salvarAgendaGestao", "salvarAutomacaoSemanal"]) {
    assert.match(extrairFuncao(painel, nome), /gravarAgendaConfig\(/, `${nome} deve gravar pelo helper.`);
  }
});

test("o painel avisa que a edicao vale para todas as datas do dia da semana", () => {
  assert.match(painel, /dia da semana<\/strong>, não por data/);
  assert.match(painel, /anteriores\s*\n?\s*a 18\/08|anteriores a 18\/08/);
});
