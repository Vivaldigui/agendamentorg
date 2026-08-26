"use strict";

// Trava de regressao do status "vai_voltar" (quem foi atendido mas nao conseguiu
// fazer o RG na hora e vai voltar depois).
//
// Dois riscos justificam o teste:
// 1. Confundir o retorno com falta bloquearia o CPF por 6 meses -- punindo quem
//    apareceu por um problema do posto.
// 2. A lista de controle precisa vir de consulta por status. Se ela dependesse do
//    periodo carregado no painel (ontem em diante, por padrao), o cidadao sumiria
//    da lista no dia seguinte a marcacao.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { painel } = require("./painel-fonte");
const backend = fs.readFileSync(path.resolve(__dirname, "index.js"), "utf8");

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

test("marcar retorno posterior nunca bloqueia o CPF", () => {
  const corpo = extrairFuncao(painel, "alterarStatus");
  assert.match(
    corpo,
    /if \(status === "nao_compareceu"\) \{\s*dadosBloqueio = criarDadosBloqueio/,
    "Somente nao_compareceu pode gerar bloqueio de CPF."
  );
  const geracoesDeBloqueio = corpo.match(/criarDadosBloqueio\(/g) || [];
  assert.equal(geracoesDeBloqueio.length, 1, "Ha mais de um caminho gerando bloqueio em alterarStatus.");
  const confirmacoes = corpo.match(/statusValor\(ag\.dados\) !== "nao_compareceu"/g) || [];
  assert.equal(confirmacoes.length, 1, "A confirmacao de falta deve seguir exclusiva do nao comparecimento.");
});

test("o status existe nas duas pontas e o painel oferece o botao", () => {
  assert.match(painel, /vai_voltar: "Vai voltar depois"/);
  assert.match(painel, /STATUS_ORDEM = \[[^\]]*"vai_voltar"/);
  // O painel deixou de usar onclick embutido: o gatilho agora e data-acao mais
  // os argumentos em data-*, resolvidos pela delegacao de cliques.
  assert.match(
    painel,
    /data-acao="alterar-status" data-id="\$\{id\}" data-status="vai_voltar"/,
    "Falta o botao direto na fila de hoje."
  );
  assert.match(backend, /const STATUS_VALIDOS = \[[^\]]*"vai_voltar"/, "respostaPublica rebaixaria o status para agendado.");
});

test("a lista de retorno consulta por status, nao pelo periodo carregado", () => {
  const corpo = extrairFuncao(painel, "carregarRetornosPendentes");
  assert.match(corpo, /\.where\("status", "==", "vai_voltar"\)/);
  assert.doesNotMatch(corpo, /dataISO/, "A lista de controle nao pode depender do intervalo de datas.");
  assert.match(extrairFuncao(painel, "filtroRapidoPainel"), /carregarRetornosPendentes\(\)/);
  assert.match(
    extrairFuncao(painel, "agendamentosFiltrados"),
    /soFuturos && d\.dataISO < hoje && !\["bloqueados", "retornos"\]\.includes\(filtroRapidoAtual\)/,
    "O filtro de datas passadas esconderia a lista de retorno."
  );
});

test("o retorno mantem a vaga do dia ocupada e continua sujeito a anonimizacao LGPD", () => {
  const agendamentoEstaAtivo = new Function(
    `${extrairFuncao(backend, "agendamentoEstaAtivo")}; return agendamentoEstaAtivo;`
  )();
  assert.equal(agendamentoEstaAtivo({ status: "vai_voltar" }), true);
  assert.match(backend, /STATUS_ANONIMIZAR_LGPD = new Set\(\[[^\]]*"vai_voltar"/);
});
