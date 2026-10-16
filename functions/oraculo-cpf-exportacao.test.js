"use strict";

// Oraculo do CPF e exportacao com dados pessoais (auditoria de 16/10/2026,
// SEG-05 e LGPD-05).
//
// SEG-05: com so um CPF, verificarBloqueioCpf dizia se a pessoa tinha faltado
// e ate quando estava bloqueada; a recusa na criacao dizia o mesmo. A callable
// saiu (o site nem a chamava) e a data de liberacao so aparece para quem
// informa o nascimento do registro da falta.
// LGPD-05: o CSV do painel levava CPF, nascimento e e-mail de todo mundo.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { painelJs } = require("./painel-fonte");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");
const painelHtml = fs.readFileSync(path.join(raiz, "public", "recepcao.html"), "utf8");

function extrairFuncao(codigo, nome) {
  const marcador = new RegExp(`(?:async )?function ${nome}\\(`).exec(codigo);
  assert.ok(marcador, `Funcao ${nome} nao encontrada.`);
  let nivel = 0;
  for (let i = codigo.indexOf("{", codigo.indexOf(")", marcador.index)); i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}" && --nivel === 0) return codigo.slice(marcador.index, i + 1);
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

class ErroFalso extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const CPF = "52998224725";
const NASC = "1980-05-17";

const hashNascimentoBloqueio = new Function(
  "crypto", `${extrairFuncao(backend, "hashNascimentoBloqueio")}; return hashNascimentoBloqueio;`
)(crypto);

function montarBusca(dedicado, cadastros = []) {
  const dataBr = new Function(`${extrairFuncao(backend, "dataBr")}; return dataBr;`)();
  const normalizarBloqueadoAte = new Function(
    "hojeSaoPauloISO", "dataBr",
    `${extrairFuncao(backend, "normalizarBloqueadoAte")}; return normalizarBloqueadoAte;`
  )(() => "2026-10-16", dataBr);
  const db = {
    collection: (colecao) => ({
      doc: () => ({ get: async () => ({ exists: dedicado !== undefined, data: () => dedicado }) }),
      where: () => ({ limit: () => ({ get: async () => ({ docs: cadastros.map((d) => ({ data: () => d })) }) }) })
    })
  };
  return new Function(
    "db", "comRetry", "normalizarBloqueadoAte", "hashNascimentoBloqueio", "HttpsError",
    `${extrairFuncao(backend, "buscarBloqueioAtivoCpf")}
     ${extrairFuncao(backend, "nascimentoConfereBloqueio")}
     ${extrairFuncao(backend, "mensagemCpfBloqueado")}
     const TIPO_CPF_BLOQUEADO = "cpf-bloqueado";
     ${extrairFuncao(backend, "erroCpfBloqueado")}
     return { buscar: buscarBloqueioAtivoCpf, erro: erroCpfBloqueado };`
  )(db, (fn) => fn(), normalizarBloqueadoAte, hashNascimentoBloqueio, ErroFalso);
}

// ---- SEG-05 ---------------------------------------------------------------------

test("a callable verificarBloqueioCpf nao existe mais, nem a chamada morta no site", () => {
  assert.doesNotMatch(backend, /exports\.verificarBloqueioCpf\s*=/);
  assert.doesNotMatch(sitePublico, /verificarBloqueioCpf|function verificarBloqueioCPF/);
});

test("quem informa o nascimento da falta ve a data de liberacao", async () => {
  const { buscar, erro } = montarBusca(undefined, [{ bloqueioCpf: CPF, bloqueadoAte: "2027-04-16", bloqueioAtivo: true, dataNasc: NASC }]);
  const bloqueio = await buscar(CPF, NASC);
  assert.equal(bloqueio.nascimentoConfere, true);
  const e = erro(bloqueio);
  assert.equal(e.code, "failed-precondition");
  assert.match(e.message, /permitido a partir de 16\/04\/2027/);
  assert.equal(e.details.tipo, "cpf-bloqueado");
});

test("quem so sabe o CPF e recusado sem saber da falta nem da data", async () => {
  const { buscar, erro } = montarBusca(undefined, [{ bloqueioCpf: CPF, bloqueadoAte: "2027-04-16", bloqueioAtivo: true, dataNasc: NASC }]);
  for (const nascimento of ["1990-01-01", ""]) {
    const bloqueio = await buscar(CPF, nascimento);
    assert.ok(bloqueio, "O bloqueio continua valendo.");
    const e = erro(bloqueio);
    assert.equal(e.code, "failed-precondition");
    assert.equal(e.details.tipo, "cpf-bloqueado");
    assert.doesNotMatch(e.message, /2027|16\/04|Consta ausencia/);
  }
});

test("registro dedicado sem a data confere pelo hash do nascimento", async () => {
  const dedicado = { cpf: CPF, bloqueadoAte: "2027-04-16", nascimentoHash: hashNascimentoBloqueio(CPF, NASC) };
  const { buscar } = montarBusca(dedicado);
  assert.equal((await buscar(CPF, NASC)).nascimentoConfere, true);
  assert.equal((await buscar(CPF, "1980-05-18")).nascimentoConfere, false);
  // Registro antigo, sem hash: recusa generica.
  assert.equal((await montarBusca({ cpf: CPF, bloqueadoAte: "2027-04-16" }).buscar(CPF, NASC)).nascimentoConfere, false);
});

test("hash do nascimento e gravado na falta pelo painel e na anonimizacao", () => {
  const falta = backend.slice(backend.indexOf("exports.alterarStatusAdmin"), backend.indexOf("exports.liberarBloqueioAdmin"));
  assert.match(falta, /nascimentoHash: hashNascimentoBloqueio\(cpfNum, dados\.dataNasc\)/);
  assert.match(extrairFuncao(backend, "anonimizarDadosAntigosLGPD"), /nascimentoHash: hashNascimentoBloqueio\(cpfNum, dados\.dataNasc\)/);
});

test("criacao usa o nascimento informado nas duas checagens de bloqueio", () => {
  const criar = backend.slice(backend.indexOf("exports.criarAgendamentoCidadao"), backend.indexOf("exports.prepararCancelamentoCidadao"));
  assert.match(criar, /await buscarBloqueioAtivoCpf\(cpfNum, dataNasc\)/);
  assert.match(criar, /throw erroCpfBloqueado\(bloqueio\)/);
  assert.match(criar, /nascimentoConfere: nascimentoConfereBloqueio\(bloqueioDoc\.data\(\), cpfNum, dataNasc\)/);
  assert.doesNotMatch(criar, /mensagemCpfBloqueado\(/, "A mensagem com data so sai por erroCpfBloqueado.");
});

test("site e metricas reconhecem a recusa generica pelo tipo", () => {
  assert.match(extrairFuncao(sitePublico, "erroCpfBloqueado"), /erroObj\.details\.tipo === "cpf-bloqueado"/);
  const { motivoMetricaAgendamento } = require("./metricas-abertura");
  const generica = Object.assign(new Error("Nao foi possivel realizar o agendamento com este CPF."), { code: "failed-precondition", details: { tipo: "cpf-bloqueado" } });
  assert.equal(motivoMetricaAgendamento(generica), "cpfBloqueado");
});

// ---- LGPD-05 --------------------------------------------------------------------

function montarCsv() {
  return new Function(
    "semanaAno", "dataBrISO", "statusLabel", "statusValor", "dataNascBR", "csvCampo",
    `const COLUNAS_EXPORTACAO = ${/const COLUNAS_EXPORTACAO = (\[[\s\S]*?\n\]);/.exec(painelJs)[1]};
     ${extrairFuncao(painelJs, "gerarCsvAgendamentos")}
     return gerarCsvAgendamentos;`
  )(() => "42", (d) => d, () => "Agendado", () => "agendado", (d) => d, (v) => String(v == null ? "" : v));
}

const LISTA = [{ dados: { dataISO: "2026-10-20", hora: "14:30", nome: "Maria", cpf: "529.982.247-25", dataNasc: NASC, telefone: "(35) 99999-0000", email: "maria@exemplo.com", protocolo: "CIN-X" } }];

test("exportacao padrao sai sem CPF, nascimento e e-mail", () => {
  const csv = montarCsv()(LISTA, false);
  const [cabecalho, linha] = csv.replace(/^﻿/, "").split("\n");
  assert.equal(cabecalho, "Semana;Mes;Data;Hora;Status;Protocolo;Nome;Telefone;Manual;Bloqueado Ate;Alterado Por;Observacao Interna");
  assert.doesNotMatch(linha, /529\.982|1980-05-17|maria@/);
  assert.match(linha, /Maria/);
  assert.match(linha, /\(35\) 99999-0000/);
  assert.ok(csv.startsWith("﻿"), "BOM para o Excel reconhecer UTF-8.");
});

test("exportacao completa so com confirmacao e registro no log", () => {
  const csv = montarCsv()(LISTA, true);
  assert.match(csv, /;CPF;Nascimento;Telefone;Email;/);
  assert.match(csv, /529\.982\.247-25/);
  const completo = extrairFuncao(painelJs, "exportarExcelCompleto");
  assert.ok(completo.indexOf("await confirmarPainel(") < completo.indexOf("gerarCsvAgendamentos(lista, true)"));
  assert.match(completo, /if \(!confirmar\) return;/);
  assert.match(completo, /registrarLog\("exportar_excel", \{ quantidade: lista\.length, completo: true \}\)/);
  assert.match(extrairFuncao(painelJs, "exportarExcel"), /gerarCsvAgendamentos\(lista, false\)/);
  assert.match(painelHtml, /data-acao="exportarExcelCompleto"/);
  assert.match(painelJs, /exportarExcel, exportarExcelCompleto,/);
});
