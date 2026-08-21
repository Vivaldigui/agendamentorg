"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

function extrairFuncao(codigo, nome) {
  const marcador = `function ${nome}(`;
  const inicio = codigo.indexOf(marcador);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  const abreParametros = codigo.indexOf("(", inicio);
  let nivelParametros = 0;
  let fechaParametros = -1;
  for (let i = abreParametros; i < codigo.length; i++) {
    if (codigo[i] === "(") nivelParametros++;
    if (codigo[i] === ")") {
      nivelParametros--;
      if (nivelParametros === 0) {
        fechaParametros = i;
        break;
      }
    }
  }
  assert.notEqual(fechaParametros, -1, `Parametros da funcao ${nome} nao encontrados.`);
  const abre = codigo.indexOf("{", fechaParametros);
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

const FUNCOES = [
  "servidorEmSaoPauloParaMs",
  "horaServidorDaResposta",
  "calcularDesvioRelogioServidor",
  "sincronizarRelogioServidorBruto",
  "sincronizarRelogioServidor",
  "agoraServidorMs",
  "minutoCompartilhadoAgenda",
  "hojeISO",
  "dataHoraSaoPauloInputEm",
  "agoraSaoPauloInput",
  "horarioAgendamentoFuturo",
  "desvioParaContador",
  "alvoContadorNovasVagas"
];

// Sandbox com relogio local controlavel: o aparelho pode estar adiantado,
// atrasado ou certo, e o codigo extraido nao sabe a diferenca.
function montarCliente(relogioLocalMs) {
  const corpo = FUNCOES.map((nome) => extrairFuncao(sitePublico, nome)).join("\n");
  const fabrica = new Function(
    "LIMIAR_DESVIO_RELOGIO_SERVIDOR_MS",
    "PRECISAO_MAXIMA_RELOGIO_BRUTO_MS",
    "DateReal",
    "relogio",
    `
      const Date = class extends DateReal {
        constructor(...args) {
          if (args.length === 0) super(relogio.agora);
          else super(...args);
        }
        static now() { return relogio.agora; }
      };
      let DESVIO_RELOGIO_SERVIDOR_MS = 0;
      let RELOGIO_SERVIDOR_SINCRONIZADO = false;
      let DESVIO_RELOGIO_SERVIDOR_BRUTO_MS = 0;
      let RELOGIO_SERVIDOR_BRUTO_SINCRONIZADO = false;
      const DATA_NOVAS_VAGAS_PADRAO = "";
      ${corpo}
      return {
        agoraServidorMs,
        minutoCompartilhadoAgenda,
        hojeISO,
        agoraSaoPauloInput,
        horarioAgendamentoFuturo,
        horaServidorDaResposta,
        sincronizarRelogioServidor,
        alvoContadorNovasVagas,
        estado: () => ({
          DESVIO_RELOGIO_SERVIDOR_MS,
          RELOGIO_SERVIDOR_SINCRONIZADO,
          DESVIO_RELOGIO_SERVIDOR_BRUTO_MS,
          RELOGIO_SERVIDOR_BRUTO_SINCRONIZADO
        })
      };
    `
  );
  const relogio = { agora: relogioLocalMs };
  const api = fabrica(90 * 1000, 1000, Date, relogio);
  api.moverRelogioLocal = (ms) => { relogio.agora = ms; };
  return api;
}

function respostaHttp(dataHeader, ageHeader) {
  return {
    headers: {
      get(nome) {
        const chave = String(nome).toLowerCase();
        if (chave === "date") return dataHeader;
        if (chave === "age") return ageHeader;
        return null;
      }
    }
  };
}

const ms = (texto) => Date.parse(texto);

// Servidor as 07:59:30 de segunda, 30 segundos antes da abertura.
const SERVIDOR_MS = ms("2026-08-24T07:59:30-03:00");
const DATE_HEADER = new Date(SERVIDOR_MS).toUTCString();

function clienteSincronizado(localMs, resposta = respostaHttp(DATE_HEADER, "0")) {
  const cliente = montarCliente(localMs);
  cliente.sincronizarRelogioServidor(
    cliente.horaServidorDaResposta(resposta, "2026-08-24T07:59"),
    localMs
  );
  return cliente;
}

// ---------------------------------------------------------------------------
// Chave do minuto
// ---------------------------------------------------------------------------

test("chave do minuto vem do relogio do servidor, nao do aparelho", () => {
  const minutoServidor = Math.floor(SERVIDOR_MS / 60000);

  // 40s adiantado: abaixo do limiar de 90s, entao o desvio conservador nao
  // corrige nada. E exatamente o desvio que joga o aparelho no balde das 08:00.
  const adiantado = clienteSincronizado(SERVIDOR_MS + 40 * 1000);
  const certo = clienteSincronizado(SERVIDOR_MS);
  const atrasado = clienteSincronizado(SERVIDOR_MS - 50 * 1000);

  assert.equal(adiantado.minutoCompartilhadoAgenda(), minutoServidor);
  assert.equal(certo.minutoCompartilhadoAgenda(), minutoServidor);
  assert.equal(atrasado.minutoCompartilhadoAgenda(), minutoServidor);

  // Sem a correcao, o aparelho adiantado cairia no minuto seguinte.
  assert.equal(Math.floor((SERVIDOR_MS + 40 * 1000) / 60000), minutoServidor + 1);
});

test("desvio bruto ignora o limiar que protege o contador", () => {
  const cliente = clienteSincronizado(SERVIDOR_MS + 40 * 1000);
  const estado = cliente.estado();

  // O limiar de 90s zera o desvio conservador de proposito.
  assert.equal(estado.DESVIO_RELOGIO_SERVIDOR_MS, 0);
  // A referencia bruta precisa enxergar os mesmos 40 segundos.
  assert.equal(estado.DESVIO_RELOGIO_SERVIDOR_BRUTO_MS, -40 * 1000);
  assert.equal(estado.RELOGIO_SERVIDOR_BRUTO_SINCRONIZADO, true);
  assert.equal(cliente.agoraServidorMs(), SERVIDOR_MS);
});

test("o contador dispara na virada real do servidor, nao na do aparelho", () => {
  // A janela de retentativas dura 60s. Um aparelho 70s adiantado — abaixo do
  // limiar de 90s do desvio conservador — comecaria cedo e terminaria a janela
  // as 07:59:50 do servidor, sem nunca ver a agenda aberta.
  const adiantado = clienteSincronizado(SERVIDOR_MS + 70 * 1000);
  assert.equal(adiantado.estado().DESVIO_RELOGIO_SERVIDOR_MS, 0, "o desvio conservador segue ignorando 70s");
  assert.equal(adiantado.estado().DESVIO_RELOGIO_SERVIDOR_BRUTO_MS, -70 * 1000);

  // Alvo expresso no relogio do aparelho: 08:00:00 do servidor acontece quando
  // ele marca 08:01:10.
  assert.equal(
    adiantado.alvoContadorNovasVagas("24/08/2026").getTime(),
    ms("2026-08-24T08:00:00-03:00") + 70 * 1000
  );

  // Aparelho certo continua com alvo exato.
  assert.equal(
    clienteSincronizado(SERVIDOR_MS).alvoContadorNovasVagas("24/08/2026").getTime(),
    ms("2026-08-24T08:00:00-03:00")
  );

  // Desvio inequivoco continua sendo corrigido nas duas referencias.
  const muitoAdiantado = clienteSincronizado(SERVIDOR_MS + 10 * 60 * 1000);
  assert.equal(muitoAdiantado.estado().DESVIO_RELOGIO_SERVIDOR_MS, -10 * 60 * 1000);
  assert.equal(
    muitoAdiantado.alvoContadorNovasVagas("24/08/2026").getTime(),
    ms("2026-08-24T08:00:00-03:00") + 10 * 60 * 1000
  );
});

test("sem referencia bruta o contador cai no desvio conservador", () => {
  // Resposta sem cabecalho Date: fonte truncada no minuto nao alimenta o
  // relogio bruto, entao o alvo volta a usar o desvio com limiar.
  const localMs = SERVIDOR_MS + 10 * 60 * 1000;
  const cliente = clienteSincronizado(localMs, respostaHttp(null, null));
  assert.equal(cliente.estado().RELOGIO_SERVIDOR_BRUTO_SINCRONIZADO, false);
  assert.equal(
    cliente.alvoContadorNovasVagas("24/08/2026").getTime(),
    ms("2026-08-24T08:00:00-03:00") - cliente.estado().DESVIO_RELOGIO_SERVIDOR_MS
  );
});

// ---------------------------------------------------------------------------
// Data e hora usadas para esconder vagas
// ---------------------------------------------------------------------------

test("hojeISO segue o servidor mesmo com o aparelho um dia a frente", () => {
  const umDia = 24 * 60 * 60 * 1000;
  const cliente = montarCliente(SERVIDOR_MS + umDia);

  // Antes de sincronizar, o site so tem o relogio do aparelho.
  assert.equal(cliente.hojeISO(), "2026-08-25");

  cliente.sincronizarRelogioServidor(
    cliente.horaServidorDaResposta(respostaHttp(DATE_HEADER, "0"), "2026-08-24T07:59"),
    SERVIDOR_MS + umDia
  );
  assert.equal(cliente.hojeISO(), "2026-08-24");
  assert.equal(cliente.agoraSaoPauloInput(), "2026-08-24T07:59");
});

test("relogio adiantado nao esconde mais horario que ainda vale", () => {
  const servidorMs = ms("2026-08-25T13:00:00-03:00");
  const localMs = ms("2026-08-25T15:00:00-03:00"); // duas horas adiantado
  const cliente = montarCliente(localMs);

  // Comportamento antigo: o aparelho decide sozinho que 14:30 ja passou.
  assert.equal(cliente.horarioAgendamentoFuturo("2026-08-25", "14:30"), false);

  cliente.sincronizarRelogioServidor(
    cliente.horaServidorDaResposta(respostaHttp(new Date(servidorMs).toUTCString(), "0"), "2026-08-25T13:00"),
    localMs
  );

  assert.equal(cliente.agoraSaoPauloInput(), "2026-08-25T13:00");
  assert.equal(cliente.horarioAgendamentoFuturo("2026-08-25", "14:30"), true);
  // Horario realmente passado continua bloqueado.
  assert.equal(cliente.horarioAgendamentoFuturo("2026-08-25", "12:30"), false);
});

// ---------------------------------------------------------------------------
// Qualidade da fonte
// ---------------------------------------------------------------------------

test("servidorEm truncado no minuto nao alimenta o relogio bruto", () => {
  const localMs = SERVIDOR_MS + 40 * 1000;
  const cliente = montarCliente(localMs);
  // Sem cabecalho Date sobra apenas servidorEm, com precisao de minuto: usar
  // isso como referencia injetaria ate 60s de erro na chave do minuto.
  const hora = cliente.horaServidorDaResposta(respostaHttp(null, null), "2026-08-24T07:59");

  assert.equal(hora.precisaoMs, 60000);
  cliente.sincronizarRelogioServidor(hora, localMs);
  assert.equal(cliente.estado().RELOGIO_SERVIDOR_BRUTO_SINCRONIZADO, false);
  assert.equal(cliente.estado().DESVIO_RELOGIO_SERVIDOR_BRUTO_MS, 0);
});

test("cabecalho Date tem precisao de segundo e vale como referencia", () => {
  const cliente = montarCliente(SERVIDOR_MS);
  const hora = cliente.horaServidorDaResposta(respostaHttp(DATE_HEADER, "0"), "2026-08-24T07:59");
  assert.equal(hora.precisaoMs, 1000);
  assert.equal(hora.servidorMs, SERVIDOR_MS);
});

test("resposta cacheada estabelece a referencia e depois so a fresca refina", () => {
  const localMs = SERVIDOR_MS + 40 * 1000;
  const cliente = montarCliente(localMs);

  // Date + Age reconstroi o instante atual mesmo vindo do CDN.
  const cacheada = cliente.horaServidorDaResposta(
    respostaHttp(new Date(SERVIDOR_MS - 120 * 1000).toUTCString(), "120"),
    "2026-08-24T07:57"
  );
  assert.equal(cacheada.servidorMs, SERVIDOR_MS);
  assert.equal(cacheada.respostaFresca, false);
  cliente.sincronizarRelogioServidor(cacheada, localMs);
  assert.equal(cliente.estado().DESVIO_RELOGIO_SERVIDOR_BRUTO_MS, -40 * 1000);

  // Ja sincronizado, uma resposta cacheada nao mexe mais na referencia.
  const outraCacheada = cliente.horaServidorDaResposta(
    respostaHttp(new Date(SERVIDOR_MS + 9 * 60 * 1000).toUTCString(), "300"),
    "2026-08-24T08:08"
  );
  cliente.sincronizarRelogioServidor(outraCacheada, localMs);
  assert.equal(cliente.estado().DESVIO_RELOGIO_SERVIDOR_BRUTO_MS, -40 * 1000);

  // Resposta fresca refina.
  const fresca = cliente.horaServidorDaResposta(
    respostaHttp(new Date(SERVIDOR_MS + 25 * 1000).toUTCString(), "0"),
    "2026-08-24T07:59"
  );
  cliente.sincronizarRelogioServidor(fresca, localMs);
  assert.equal(cliente.estado().DESVIO_RELOGIO_SERVIDOR_BRUTO_MS, -15 * 1000);
});

// ---------------------------------------------------------------------------
// Superficie do site publico
// ---------------------------------------------------------------------------

test("consumidores de hora usam a referencia do servidor", () => {
  const agora = extrairFuncao(sitePublico, "agoraSaoPauloInput");
  assert.match(agora, /dataHoraSaoPauloInputEm\(agoraServidorMs\(\)\)/);
  assert.equal(agora.includes("Date.now()"), false);

  const hoje = extrairFuncao(sitePublico, "hojeISO");
  assert.match(hoje, /hojeISO\(instanteMs = agoraServidorMs\(\)\)/);
  assert.match(hoje, /formatToParts\(new Date\(instanteMs\)\)/);

  const buscar = extrairFuncao(sitePublico, "buscarAgendaPublicaAtualizada");
  assert.match(buscar, /const\s+minutoCompartilhado\s*=\s*minutoCompartilhadoAgenda\(\)/);
  // A formula antiga nao pode voltar em lugar nenhum.
  assert.equal(/Math\.floor\(Date\.now\(\)\s*\/\s*60000\)/.test(sitePublico), false);

  // Bloqueio de CPF e prazo de cancelamento vem do servidor.
  assert.equal(/ativo:\s*\w+\.getTime\(\)\s*>\s*Date\.now\(\)/.test(sitePublico), false);
  assert.match(sitePublico, /expiraEm\s*-\s*agoraServidorMs\(\)/);
});

test("a medicao do desvio continua usando o relogio local", () => {
  // Guarda contra "corrigir" o lado local da conta: referenciaLocalMs precisa
  // ser o relogio do aparelho, senao o desvio se realimenta e converge para zero.
  const carregar = extrairFuncao(sitePublico, "carregarConfig");
  assert.match(carregar, /const\s+buscaIniciadaEm\s*=\s*Date\.now\(\)/);
  assert.match(carregar, /const\s+referenciaLocalMs\s*=\s*Math\.round\(\(buscaIniciadaEm \+ Date\.now\(\)\) \/ 2\)/);

  const bruto = extrairFuncao(sitePublico, "sincronizarRelogioServidorBruto");
  assert.match(bruto, /referenciaLocalMs = Date\.now\(\)/);
  assert.match(bruto, /relogioServidor\.servidorMs - referenciaLocalMs/);
  assert.match(bruto, /precisaoMs\) > PRECISAO_MAXIMA_RELOGIO_BRUTO_MS/);
});
