"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { painelJs } = require("./painel-fonte");

const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

function trechoEntre(inicio, fim) {
  const de = painelJs.indexOf(inicio);
  assert.notEqual(de, -1, `Inicio nao encontrado: ${inicio}`);
  const ate = painelJs.indexOf(fim, de + inicio.length);
  assert.notEqual(ate, -1, `Fim nao encontrado: ${fim}`);
  return painelJs.slice(de, ate);
}

test("painel so aparece depois de validar o administrador ativo no servidor", () => {
  const auth = trechoEntre("auth.onAuthStateChanged", "async function fazerLogin");
  const validacao = auth.indexOf("await validarAdministradorAtivo(user)");
  const revelar = auth.indexOf("document.getElementById('painel-screen').style.display='block'");
  assert.notEqual(validacao, -1);
  assert.notEqual(revelar, -1);
  assert.ok(validacao < revelar, "O painel foi revelado antes da validacao administrativa.");
  assert.match(painelJs, /collection\("admins"\)\.doc\(email\)\.get\(\{ source: "server" \}\)/);
  assert.match(painelJs, /!doc\.exists \|\| doc\.data\(\)\.ativo !== true/);
});

test("revogacao e tratada como autorizacao, encerra a sessao e nao agenda retry", () => {
  const tratamento = trechoEntre("async function encerrarSessaoPorAcessoRevogado", "function definirMutacoesAgendaHabilitadas");
  assert.match(tratamento, /await auth\.signOut\(\)/);
  assert.match(tratamento, /acesso administrativo foi revogado ou está inativo/);
  const lista = trechoEntre("async function listarAgendamentos", "function marcarIndicadoresHistoricosCarregando");
  const revogacao = lista.indexOf("await encerrarSessaoPorAcessoRevogado(e)");
  const retry = lista.indexOf("setTimeout(() =>");
  assert.ok(revogacao >= 0 && retry >= 0 && revogacao < retry);
});

test("mutacoes de agenda ficam bloqueadas ate a leitura integral terminar", () => {
  const carga = trechoEntre("async function carregarAgendaGestao", "async function salvarAgendaGestao");
  assert.match(carga, /doc\("agenda"\)\.get\(\{ source: "server" \}\)/);
  assert.match(carga, /agendaGestaoCarregada = false;[\s\S]*definirMutacoesAgendaHabilitadas\(false\)/);
  assert.match(carga, /agendaGestaoCarregada = true;[\s\S]*definirMutacoesAgendaHabilitadas\(true\)/);
  assert.match(carga, /Tentar novamente/);
  const gravacao = trechoEntre("async function gravarAgendaConfig", "function ordenarDatas");
  assert.match(gravacao, /if \(!exigirAgendaGestaoCarregada\(\)\)/);
  assert.match(painelJs, /ACOES_MUTACAO_AGENDA\.has\(acao\) && !exigirAgendaGestaoCarregada\(\)/);
});

test("falha historica nunca transforma o periodo atual em total completo", () => {
  const historico = trechoEntre("async function carregarTotalAtendimentosRealizados", "function atualizarEstatisticasLocalmente");
  assert.equal(/agendamentosCache\.filter/.test(historico), false);
  assert.match(historico, /totalAtendimentosCarregado = false;/);
  assert.match(historico, /totalAtendimentosIndisponivel = true;/);
  assert.match(historico, /marcarIndicadoresHistoricosIndisponiveis\(\)/);
});

test("canal exato de preview pode exercitar as callables administrativas", () => {
  const inicio = backend.indexOf("const callableOptions = {");
  const fim = backend.indexOf("const publicCallableOptions", inicio);
  const opcoes = backend.slice(inicio, fim);
  assert.match(opcoes, /https:\/\/agendamento-cin-itanhandu--revisao-painel-hmupkekk\.web\.app/);
});
