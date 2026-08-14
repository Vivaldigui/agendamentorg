"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

function extrairFuncao(codigo, nome) {
  const marcador = `function ${nome}(`;
  const inicio = codigo.indexOf(marcador);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  const inicioCompleto = codigo.slice(Math.max(0, inicio - 6), inicio) === "async " ? inicio - 6 : inicio;
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
      if (nivel === 0) return codigo.slice(inicioCompleto, i + 1);
    }
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

function constanteLista(codigo, nome) {
  const match = codigo.match(new RegExp(`const\\s+${nome}\\s*=\\s*(\\[[^;]+\\])`));
  assert.ok(match, `Constante ${nome} nao encontrada.`);
  return JSON.parse(match[1]);
}

test("retentativas usam janela de 60 segundos, backoff crescente e jitter de ate 1,5 segundo", () => {
  assert.match(sitePublico, /const\s+JANELA_ATUALIZACAO_ABERTURA_MS\s*=\s*60\s*\*\s*1000\s*;/);
  assert.match(sitePublico, /const\s+JITTER_ATUALIZACAO_ABERTURA_MS\s*=\s*1500\s*;/);

  const atrasos = constanteLista(sitePublico, "ATRASOS_ATUALIZACAO_ABERTURA_MS");
  assert.deepEqual(atrasos, [0, 2000, 4000, 7000, 11000, 16000, 22000]);

  const codigo = extrairFuncao(sitePublico, "atrasoRetentativaAbertura");
  const calcular = new Function(
    "ATRASOS_ATUALIZACAO_ABERTURA_MS",
    "JITTER_ATUALIZACAO_ABERTURA_MS",
    `${codigo}; return atrasoRetentativaAbertura;`
  )(atrasos, 1500);

  assert.equal(calcular(1, 0), 2000);
  assert.equal(calcular(1, 1), 3500);
  assert.ok(calcular(5, 0.5) > atrasos[5]);

  const fluxo = extrairFuncao(sitePublico, "executarAtualizacaoAbertura");
  assert.match(fluxo, /JANELA_ATUALIZACAO_ABERTURA_MS/);
  assert.match(fluxo, /atrasoRetentativaAbertura/);
  assert.match(fluxo, /carregarConfig\(\{\s*ignorarCache:\s*true,\s*atualizarInterface:\s*false,\s*timeoutMs:/);
});

test("fluxo se recupera sozinho de falha transitoria e respeita o limite de 60 segundos", async () => {
  const codigo = extrairFuncao(sitePublico, "executarAtualizacaoAbertura");
  const montar = (dependencias) => new Function(
    "Date",
    "JANELA_ATUALIZACAO_ABERTURA_MS",
    "DIAS_DISPONIVEIS",
    "alvoContadorNovasVagas",
    "atrasoRetentativaAbertura",
    "esperarAtualizacaoAbertura",
    "mostrarEstadoLiberandoVagas",
    "mostrarErroAtualizacaoAbertura",
    "carregarConfig",
    "renderDatas",
    "atualizarBannerVagas",
    `${codigo}; return executarAtualizacaoAbertura;`
  )(...dependencias);

  const relogioRecuperacao = { agora: 0 };
  let tentativas = 0;
  let renderizacoes = 0;
  let errosVisiveis = 0;
  const diasRecuperados = [];
  const recuperar = montar([
    { now: () => relogioRecuperacao.agora },
    60000,
    diasRecuperados,
    () => null,
    (indice) => [0, 2000, 4000][indice] || 4000,
    async (ms) => { relogioRecuperacao.agora += ms; },
    () => {},
    () => { errosVisiveis++; },
    async (opcoes) => {
      tentativas++;
      assert.equal(opcoes.ignorarCache, true);
      assert.equal(opcoes.atualizarInterface, false);
      if (tentativas === 1) throw new Error("rede indisponivel");
      if (tentativas === 2) return { dias: [] };
      diasRecuperados.push("2026-08-18");
      return { dias: [{ dataISO: "2026-08-18" }] };
    },
    async () => { renderizacoes++; },
    () => { renderizacoes++; }
  ]);

  assert.equal(await recuperar(), true);
  assert.equal(tentativas, 3);
  assert.equal(renderizacoes, 2);
  assert.equal(errosVisiveis, 0);

  const relogioFalha = { agora: 0 };
  let erroFinal = 0;
  const falhar = montar([
    { now: () => relogioFalha.agora },
    60000,
    [],
    () => null,
    (indice) => [0, 2000, 4000, 7000, 11000, 16000, 22000][Math.min(indice, 6)],
    async (ms) => { relogioFalha.agora += ms; },
    () => {},
    () => { erroFinal++; },
    async () => { throw new Error("rede indisponivel"); },
    async () => {},
    () => {}
  ]);

  assert.equal(await falhar(), false);
  assert.equal(relogioFalha.agora, 60000);
  assert.equal(erroFinal, 1);
});

test("falha de rede nao apaga uma agenda valida que ja estava em memoria", async () => {
  const codigo = extrairFuncao(sitePublico, "carregarConfig");
  const cenario = new Function(
    "buscarAgendaPublicaAtualizada",
    "console",
    "HORARIOS_NOVOS",
    `
      let HORARIOS = ["14:30"];
      let DIAS_DISPONIVEIS = ["2026-08-18"];
      let DISPONIBILIDADE_PUBLICA = { porData: { "2026-08-18": {} }, totalVagasRestantes: 1 };
      let DATA_NOVAS_VAGAS = "24/08/2026";
      ${codigo};
      return {
        executar: async () => {
          try { await carregarConfig({ ignorarCache: true }); } catch (e) {}
        },
        estado: () => ({ HORARIOS, DIAS_DISPONIVEIS, DISPONIBILIDADE_PUBLICA })
      };
    `
  )(
    async () => { throw new Error("rede indisponivel"); },
    { error: () => {} },
    ["14:30", "14:45"]
  );

  await cenario.executar();
  assert.deepEqual(cenario.estado(), {
    HORARIOS: ["14:30"],
    DIAS_DISPONIVEIS: ["2026-08-18"],
    DISPONIBILIDADE_PUBLICA: { porData: { "2026-08-18": {} }, totalVagasRestantes: 1 }
  });
});

test("online e retorno da aba retomam a abertura sem empilhar execucoes", () => {
  assert.match(sitePublico, /addEventListener\(["']online["'],\s*retomarAtualizacaoAbertura\)/);
  assert.match(sitePublico, /addEventListener\(["']visibilitychange["']/);
  assert.match(sitePublico, /document\.visibilityState\s*===\s*["']visible["']/);

  const iniciar = extrairFuncao(sitePublico, "tentarAtualizarAbertura");
  assert.match(iniciar, /if\s*\(atualizacaoAberturaEmCurso\)\s*return\s+atualizacaoAberturaEmCurso\s*;/);
  assert.match(iniciar, /\.finally\(/);
});

test("backend informa o horario de Sao Paulo usado na resposta publica", () => {
  const carregar = extrairFuncao(backend, "carregarDisponibilidadePublica");
  assert.match(carregar, /const\s+agora\s*=\s*agoraSaoPauloInput\(\)/);
  assert.match(carregar, /servidorEm:\s*agora/);
});

function respostaHttp(data, age) {
  return {
    headers: {
      get(nome) {
        if (nome.toLowerCase() === "date") return data;
        if (nome.toLowerCase() === "age") return age;
        return null;
      }
    }
  };
}

function montarRelogio() {
  const converter = extrairFuncao(sitePublico, "servidorEmSaoPauloParaMs");
  const extrair = extrairFuncao(sitePublico, "horaServidorDaResposta");
  const calcular = extrairFuncao(sitePublico, "calcularDesvioRelogioServidor");
  const sincronizar = extrairFuncao(sitePublico, "sincronizarRelogioServidor");
  return new Function(
    "LIMIAR_DESVIO_RELOGIO_SERVIDOR_MS",
    `
      ${converter};
      ${extrair};
      ${calcular};
      let DESVIO_RELOGIO_SERVIDOR_MS = 0;
      let RELOGIO_SERVIDOR_SINCRONIZADO = false;
      ${sincronizar};
      return {
        horaServidorDaResposta,
        calcularDesvioRelogioServidor,
        sincronizarRelogioServidor,
        estado: () => ({ DESVIO_RELOGIO_SERVIDOR_MS, RELOGIO_SERVIDOR_SINCRONIZADO })
      };
    `
  )(90 * 1000);
}

test("resposta cacheada usa Date mais Age e nao atrasa relogio local correto", () => {
  const relogio = montarRelogio();
  const resposta = respostaHttp("Mon, 17 Aug 2026 10:55:00 GMT", "300");
  const hora = relogio.horaServidorDaResposta(resposta, "2026-08-17T07:55");
  const localCorreto = Date.parse("2026-08-17T08:00:20-03:00");

  assert.equal(hora.servidorMs, Date.parse("2026-08-17T08:00:00-03:00"));
  assert.equal(hora.respostaFresca, false);
  assert.equal(relogio.calcularDesvioRelogioServidor(hora.servidorMs, localCorreto), 0);
  relogio.sincronizarRelogioServidor(hora, localCorreto);
  assert.equal(relogio.estado().DESVIO_RELOGIO_SERVIDOR_MS, 0);

  const alvoCodigo = extrairFuncao(sitePublico, "alvoContadorNovasVagas");
  const alvo = new Function(
    "DESVIO_RELOGIO_SERVIDOR_MS",
    `${alvoCodigo}; return alvoContadorNovasVagas;`
  )(relogio.estado().DESVIO_RELOGIO_SERVIDOR_MS)("17/08/2026");
  assert.equal(alvo.getTime(), Date.parse("2026-08-17T08:00:00-03:00"));
});

// Forma observada em producao: em X-Cache HIT o Google Frontend renova Date,
// mas nao envia Age. Nao remova este caso por parecer redundante.
test("Date presente sem Age usa a hora real e permite corrigir relogio adiantado", () => {
  const resposta = respostaHttp("Mon, 17 Aug 2026 11:00:00 GMT", null);
  const relogioCorreto = montarRelogio();
  const horaCorreta = relogioCorreto.horaServidorDaResposta(resposta, "2026-08-17T07:55");

  assert.equal(horaCorreta.respostaFresca, true);
  assert.equal(
    relogioCorreto.calcularDesvioRelogioServidor(
      horaCorreta.servidorMs,
      Date.parse("2026-08-17T08:00:20-03:00")
    ),
    0
  );
  relogioCorreto.sincronizarRelogioServidor(
    horaCorreta,
    Date.parse("2026-08-17T08:00:20-03:00")
  );

  const alvoCodigo = extrairFuncao(sitePublico, "alvoContadorNovasVagas");
  const alvoSemDesvio = new Function(
    "DESVIO_RELOGIO_SERVIDOR_MS",
    `${alvoCodigo}; return alvoContadorNovasVagas;`
  )(relogioCorreto.estado().DESVIO_RELOGIO_SERVIDOR_MS)("17/08/2026");
  assert.equal(alvoSemDesvio.getTime(), Date.parse("2026-08-17T08:00:00-03:00"));

  const relogioAdiantado = montarRelogio();
  relogioAdiantado.sincronizarRelogioServidor(
    horaCorreta,
    Date.parse("2026-08-17T08:10:00-03:00")
  );
  assert.equal(relogioAdiantado.estado().DESVIO_RELOGIO_SERVIDOR_MS, -10 * 60 * 1000);
});

test("resposta fresca corrige celular dez minutos adiantado e ignora ruido de quarenta segundos", () => {
  const relogio = montarRelogio();
  const hora = relogio.horaServidorDaResposta(
    respostaHttp("Mon, 17 Aug 2026 11:00:00 GMT", "0"),
    "2026-08-17T08:00"
  );

  assert.equal(
    relogio.calcularDesvioRelogioServidor(hora.servidorMs, Date.parse("2026-08-17T08:10:00-03:00")),
    -10 * 60 * 1000
  );
  assert.equal(
    relogio.calcularDesvioRelogioServidor(hora.servidorMs, Date.parse("2026-08-17T08:00:40-03:00")),
    0
  );

  relogio.sincronizarRelogioServidor(hora, Date.parse("2026-08-17T08:10:00-03:00"));
  const alvoCodigo = extrairFuncao(sitePublico, "alvoContadorNovasVagas");
  const alvo = new Function(
    "DESVIO_RELOGIO_SERVIDOR_MS",
    `${alvoCodigo}; return alvoContadorNovasVagas;`
  )(relogio.estado().DESVIO_RELOGIO_SERVIDOR_MS)("17/08/2026");
  assert.equal(alvo.getTime(), Date.parse("2026-08-17T08:10:00-03:00"));
});

test("Date ausente usa servidorEm e ausencia das duas fontes nao quebra", () => {
  const relogio = montarRelogio();
  const fallback = relogio.horaServidorDaResposta(
    respostaHttp(null, "0"),
    "2026-08-17T08:00"
  );
  assert.equal(fallback.servidorMs, Date.parse("2026-08-17T08:00:00-03:00"));

  const fallbackCacheado = relogio.horaServidorDaResposta(
    respostaHttp(null, "300"),
    "2026-08-17T07:55"
  );
  assert.equal(fallbackCacheado.servidorMs, Date.parse("2026-08-17T08:00:00-03:00"));

  const ausente = relogio.horaServidorDaResposta(respostaHttp(null, null), undefined);
  assert.equal(ausente.servidorMs, null);
  assert.doesNotThrow(() => relogio.sincronizarRelogioServidor(ausente, Date.now()));
  assert.equal(relogio.estado().RELOGIO_SERVIDOR_SINCRONIZADO, false);
});

test("resposta fresca ressincroniza e resposta cacheada nao desfaz sincronizacao boa", () => {
  const relogio = montarRelogio();
  const fresca = relogio.horaServidorDaResposta(
    respostaHttp("Mon, 17 Aug 2026 11:00:00 GMT", "0"),
    "2026-08-17T08:00"
  );
  relogio.sincronizarRelogioServidor(fresca, Date.parse("2026-08-17T08:10:00-03:00"));
  assert.equal(relogio.estado().DESVIO_RELOGIO_SERVIDOR_MS, -10 * 60 * 1000);

  const cacheada = relogio.horaServidorDaResposta(
    respostaHttp("Mon, 17 Aug 2026 11:00:00 GMT", "300"),
    "2026-08-17T08:00"
  );
  relogio.sincronizarRelogioServidor(cacheada, Date.parse("2026-08-17T08:00:00-03:00"));
  assert.equal(relogio.estado().DESVIO_RELOGIO_SERVIDOR_MS, -10 * 60 * 1000);

  relogio.sincronizarRelogioServidor(fresca, Date.parse("2026-08-17T08:00:00-03:00"));
  assert.equal(relogio.estado().DESVIO_RELOGIO_SERVIDOR_MS, 0);
});

test("carregarConfig usa metadados HTTP e mantem retorno compativel com o retry", () => {
  const buscar = extrairFuncao(sitePublico, "buscarAgendaPublicaAtualizada");
  const carregar = extrairFuncao(sitePublico, "carregarConfig");
  assert.match(buscar, /horaServidorDaResposta\(resposta,\s*dados\.servidorEm\)/);
  assert.match(buscar, /return\s+\{\s*dados,\s*relogioServidor\s*\}/);
  assert.match(carregar, /const\s+\{\s*dados:\s*cfg,\s*relogioServidor\s*\}\s*=\s*await\s+buscarAgendaPublicaAtualizada/);
  assert.match(carregar, /sincronizarRelogioServidor\(relogioServidor/);
  assert.match(carregar, /return\s+cfg\s*;/);
  assert.match(carregar, /atualizarBannerVagas\(\{\s*iniciarAbertura:\s*false\s*\}\)/);
});

test("estados de liberacao, lotacao e erro tecnico sao distintos e sem total fixo", () => {
  assert.match(sitePublico, /Liberando vagas, mantenha esta p[aá]gina aberta/);
  assert.match(sitePublico, /Vagas preenchidas/);
  assert.match(sitePublico, /N[aã]o foi poss[ií]vel atualizar a agenda/);
  assert.doesNotMatch(sitePublico, /40\s+vagas/i);
});

test("chave compartilhada por minuto continua protegendo a origem", () => {
  assert.match(sitePublico, /\?atualizar-minuto=\$\{minutoCompartilhado\}/);
});
