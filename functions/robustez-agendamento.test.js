"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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
  assert.notEqual(fechaParametros, -1, `Parametros de ${nome} nao encontrados.`);
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

// Devolve o bloco que segue um marcador, por exemplo o corpo do if de um codigo de erro.
// Assim as assertivas nao dependem de a comparacao estar inline na condicao ou guardada
// antes numa variavel.
function blocoApos(codigo, marcador) {
  const inicio = codigo.indexOf(marcador);
  assert.notEqual(inicio, -1, `Marcador ${marcador} nao encontrado.`);
  const abre = codigo.indexOf("{", inicio);
  assert.notEqual(abre, -1, `Bloco apos ${marcador} nao encontrado.`);
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(abre, i + 1);
    }
  }
  throw new Error(`Fim do bloco apos ${marcador} nao encontrado.`);
}

test("verificacao pontual espelha a ocupacao usada pela transacao", () => {
  const codigo = extrairFuncao(backend, "slotRepresentaOcupacaoAtual");
  const verificar = new Function(
    "agendamentoEstaAtivo",
    `${codigo}; return slotRepresentaOcupacaoAtual;`
  )((dados) => dados && dados.ativo !== false && dados.status !== "cancelado");

  assert.equal(verificar(false, null, false, null), false);
  assert.equal(verificar(true, {}, false, null), true);
  assert.equal(verificar(true, { agendamentoId: "a1" }, false, null), false);
  assert.equal(verificar(true, { agendamentoId: "a1" }, true, { status: "cancelado" }), false);
  assert.equal(verificar(true, { agendamentoId: "a1" }, true, { status: "agendado" }), true);
});

test("rate limit fresco usa somente dezesseis fragmentos por origem", () => {
  const codigo = extrairFuncao(backend, "fragmentoRateLimitVerificacao");
  const fragmentar = new Function(
    "crypto",
    "RATE_LIMIT_VERIFICACAO_FRAGMENTOS",
    `${codigo}; return fragmentoRateLimitVerificacao;`
  )(crypto, 16);
  const fragmentos = new Set();
  for (let i = 0; i < 512; i++) {
    const fragmento = fragmentar(i.toString(16).padStart(32, "0"));
    assert.ok(fragmento >= 0 && fragmento < 16);
    fragmentos.add(fragmento);
  }
  assert.equal(fragmentos.size, 16);
});

test("rate limit fresco ignora prefixos x-forwarded-for fornecidos pelo cliente", () => {
  const codigo = extrairFuncao(backend, "ipOrigemConfiavel");
  const identificar = new Function(`${codigo}; return ipOrigemConfiavel;`)();
  assert.equal(identificar({
    rawRequest: {
      headers: {
        "x-forwarded-for": "198.51.100.10, valor-falso, 203.0.113.7, 35.191.0.1"
      },
      ip: "10.0.0.1"
    }
  }), "203.0.113.7");
  assert.equal(identificar({ rawRequest: { headers: {}, ip: "203.0.113.9" } }), "203.0.113.9");

  const fingerprint = extrairFuncao(backend, "fingerprintOrigemRequisicao");
  assert.match(fingerprint, /ipOrigemConfiavel\(request\)/);
});

test("selecao usa callable sem CDN e nunca avanca quando a verificacao falha", () => {
  const verificar = extrairFuncao(sitePublico, "verificarDisponibilidadeSlotAtual");
  const renderHoras = extrairFuncao(sitePublico, "renderHoras");

  assert.match(verificar, /httpsCallable\(["']verificarDisponibilidadeSlotCidadao["']\)/);
  assert.match(renderHoras, /await\s+verificarDisponibilidadeSlotAtual\(data,\s*h\)/);
  assert.match(renderHoras, /marcarSlotIndisponivelLocalmente\(data,\s*h\)/);
  assert.doesNotMatch(renderHoras, /carregarConfig\(\{\s*ignorarCache:\s*true\s*\}\)/);
});

test("codigos de erro das callables aceitam o prefixo functions do SDK web", () => {
  const normalizarCodigo = extrairFuncao(sitePublico, "codigoErroFunctions");
  const codigoErroFunctions = new Function(
    `${normalizarCodigo}; return codigoErroFunctions;`
  )();
  assert.equal(codigoErroFunctions({ code: "functions/unavailable" }), "unavailable");
  assert.equal(codigoErroFunctions({ code: "unavailable" }), "unavailable");

  const transienteCodigo = extrairFuncao(sitePublico, "erroTransiente");
  const erroTransiente = new Function(
    "codigoErroFunctions",
    `${transienteCodigo}; return erroTransiente;`
  )(codigoErroFunctions);
  assert.equal(erroTransiente({ code: "functions/unavailable" }), true);
  assert.equal(erroTransiente({ code: "functions/deadline-exceeded" }), true);
  assert.equal(erroTransiente({ code: "functions/unknown" }), true);
  assert.equal(erroTransiente({ code: "functions/data-loss" }), true);

  const confirmar = extrairFuncao(sitePublico, "confirmarAgendamento");
  const renderHoras = extrairFuncao(sitePublico, "renderHoras");
  assert.match(confirmar, /const\s+codigo\s*=\s*codigoErroFunctions\(e\)/);
  // O que importa e renderHoras classificar o erro pelo normalizador, nunca pelo
  // e.code cru: o SDK web entrega "functions/failed-precondition".
  assert.match(renderHoras, /codigoErroFunctions\(e\)/);
  assert.doesNotMatch(renderHoras, /\be\.code\b/);
  assert.match(renderHoras, /["']failed-precondition["']/);
});

test("resposta geral obsoleta nao ressuscita slot confirmado no mesmo minuto", () => {
  const normalizarCodigo = extrairFuncao(sitePublico, "normalizarDisponibilidadePublica");
  const confirmarCodigo = extrairFuncao(sitePublico, "slotConfirmadoOcupadoLocalmente");
  const agora = Date.parse("2026-08-17T08:00:30-03:00");
  const mapa = new Map([["2026-08-18_14:30", agora + 32000]]);
  const normalizar = new Function(
    "SLOTS_OCUPADOS_CONFIRMADOS",
    "Date",
    "horarioAgendamentoFuturo",
    "horariosPadraoParaDataPublica",
    `${confirmarCodigo}; ${normalizarCodigo}; return normalizarDisponibilidadePublica;`
  )(
    mapa,
    { now: () => agora },
    () => true,
    () => ["14:30", "14:45"]
  );

  const resultado = normalizar([{
    dataISO: "2026-08-18",
    horarios: [
      { hora: "14:30", disponivel: true },
      { hora: "14:45", disponivel: true }
    ]
  }]);

  assert.equal(resultado.porData["2026-08-18"].horarios[0].disponivel, false);
  assert.equal(resultado.porData["2026-08-18"].vagas, 1);
  assert.equal(resultado.totalVagasRestantes, 1);
});

test("conflito definitivo remove o slot antes de reabrir a selecao", () => {
  const confirmar = extrairFuncao(sitePublico, "confirmarAgendamento");
  assert.match(
    confirmar,
    /if\s*\(erroHorarioOcupado\(e\)\)\s*\{\s*marcarSlotIndisponivelLocalmente\(dataOperacao,\s*horaOperacao\);[\s\S]*?await\s+abrirAlterarHorario\(\)/
  );
});

test("primeira falha tecnica inicia retry e nao fabrica agenda vazia", async () => {
  const carregarCodigo = extrairFuncao(sitePublico, "carregarConfig");
  let retries = 0;
  const cenario = new Function(
    "buscarAgendaPublicaAtualizada",
    "tentarAtualizarAbertura",
    "console",
    "localStorage",
    "HORARIOS_NOVOS",
    `
      let ESTADO_AGENDA_PUBLICA = "desconhecido";
      let HORARIOS = ["sentinela"];
      let DIAS_DISPONIVEIS = [];
      let DISPONIBILIDADE_PUBLICA = { porData: {}, totalVagasRestantes: 0 };
      let DATA_NOVAS_VAGAS = "data a definir";
      function aplicarConfigAgendaPublica() { throw new Error("nao deveria aplicar"); }
      function renderDatas() { throw new Error("nao deveria renderizar como agenda valida"); }
      function atualizarBannerVagas() { throw new Error("nao deveria renderizar como agenda valida"); }
      ${carregarCodigo};
      return {
        executar: () => carregarConfig(),
        estado: () => ({ ESTADO_AGENDA_PUBLICA, HORARIOS, DIAS_DISPONIVEIS, DISPONIBILIDADE_PUBLICA })
      };
    `
  )(
    async () => { throw new Error("rede indisponivel"); },
    () => { retries++; return Promise.resolve(false); },
    { error: () => {} },
    { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    ["14:30", "14:45"]
  );

  await cenario.executar();
  assert.equal(retries, 1);
  assert.deepEqual(cenario.estado(), {
    ESTADO_AGENDA_PUBLICA: "erro",
    HORARIOS: ["sentinela"],
    DIAS_DISPONIVEIS: [],
    DISPONIBILIDADE_PUBLICA: { porData: {}, totalVagasRestantes: 0 }
  });
});

test("agenda publica valida aceita zero dias, mas rejeita payload malformado", () => {
  const codigo = extrairFuncao(sitePublico, "configAgendaPublicaValida");
  const validar = new Function(
    "dataISOValida",
    `${codigo}; return configAgendaPublicaValida;`
  )(valor => {
    const partes = String(valor || "").split("-").map(Number);
    if (partes.length !== 3 || partes.some(parte => !Number.isInteger(parte))) return null;
    const data = new Date(partes[0], partes[1] - 1, partes[2]);
    return data.getFullYear() === partes[0]
      && data.getMonth() === partes[1] - 1
      && data.getDate() === partes[2]
      ? data
      : null;
  });

  assert.equal(validar({ dias: [], horarios: [] }), true);
  assert.equal(validar({ dias: [], horarios: ["14:30"] }), true);
  assert.equal(validar({ dias: [{}], horarios: [] }), false);
  assert.equal(validar({ dias: [{ dataISO: "2026-08-18", horarios: null }], horarios: [] }), false);
  assert.equal(validar({ dias: [{ dataISO: "2026-08-18", horarios: [{ hora: "14:30" }] }], horarios: [] }), false);
  assert.equal(validar({ dias: [{ dataISO: "2026-99-99", horarios: [] }], horarios: [] }), false);
  assert.equal(validar({ dias: [{ dataISO: "2026-02-30", horarios: [] }], horarios: [] }), false);
  assert.equal(validar({ dias: [], horarios: ["29:59"] }), false);
  assert.equal(validar({ dias: [{ dataISO: "2026-08-18", horarios: [{ hora: "14:99", disponivel: true }] }], horarios: [] }), false);
  assert.equal(validar({ dias: null, horarios: [] }), false);
  assert.equal(validar({ dias: [], horarios: null }), false);
  assert.equal(validar(null), false);
});

test("retomada com estado tecnico nao depende de data de abertura conhecida", () => {
  const codigo = extrairFuncao(sitePublico, "retomarAtualizacaoAbertura");
  let tentativas = 0;
  const retomar = new Function(
    "tentarAtualizarAbertura",
    "alvoContadorNovasVagas",
    "Date",
    `
      let atualizacaoAberturaEmCurso = null;
      let ESTADO_AGENDA_PUBLICA = "erro";
      let DIAS_DISPONIVEIS = [];
      let DATA_NOVAS_VAGAS = "data a definir";
      ${codigo};
      return retomarAtualizacaoAbertura;
    `
  )(
    () => { tentativas++; },
    () => null,
    Date
  );

  retomar();
  assert.equal(tentativas, 1);
});

test("banner so chama agenda fechada quando o estado e valido", () => {
  const banner = extrairFuncao(sitePublico, "atualizarBannerVagas");
  assert.match(banner, /ESTADO_AGENDA_PUBLICA\s*!==\s*["']valido["']/);
  assert.match(banner, /mostrarErroAtualizacaoAbertura/);
  assert.ok(
    banner.indexOf("ESTADO_AGENDA_PUBLICA") < banner.indexOf("Agenda fechada"),
    "o estado tecnico deve ser tratado antes do ramo de agenda fechada"
  );
});

test("retry idempotente nao consulta o proprio slot antes de reenviar", () => {
  const confirmar = extrairFuncao(sitePublico, "confirmarAgendamento");
  assert.doesNotMatch(confirmar, /slotAindaDisponivel/);
  assert.match(confirmar, /operationId:\s*operacaoPendente\.operationId/);
});

test("slot removido da agenda e ocultado depois de failed-precondition", () => {
  const renderHoras = extrairFuncao(sitePublico, "renderHoras");
  const tratamento = blocoApos(renderHoras, "failed-precondition");
  assert.match(tratamento, /marcarSlotIndisponivelLocalmente\(data,\s*h\)/);
  assert.match(tratamento, /renderDatas\(\)/);
  assert.match(tratamento, /renderHoras\(data\)/);
});

test("overlay de conflito cobre o stale maximo e sobrevive ao reload da aba", () => {
  assert.match(sitePublico, /DURACAO_SLOT_OCUPADO_CONFIRMADO_MS\s*=\s*16\s*\*\s*60\s*\*\s*1000/);
  assert.match(sitePublico, /sessionStorage\.setItem\(["']cin_slots_ocupados_confirmados["']/);
  assert.match(sitePublico, /sessionStorage\.getItem\(["']cin_slots_ocupados_confirmados["']/);
  const revalidar = extrairFuncao(sitePublico, "revalidarSlotsOcupadosConfirmados");
  assert.match(revalidar, /verificarDisponibilidadeSlotAtual/);
  assert.match(revalidar, /desmarcarSlotIndisponivelLocalmente/);
});

test("substituicao no mesmo slot preserva o overlay da nova reserva", () => {
  const confirmar = extrairFuncao(sitePublico, "confirmarAgendamento");
  assert.match(
    confirmar,
    /if\s*\(substituiu\)[\s\S]*?chaveSlotPublico\(substituiu\.dataISO,\s*substituiu\.hora\)[\s\S]*?!==\s*chaveSlotPublico\(dataOperacao,\s*horaOperacao\)[\s\S]*?desmarcarSlotIndisponivelLocalmente/
  );
});

test("fallback legado reconhece o proprio agendamento apesar de mascara e caixa", () => {
  const codigo = extrairFuncao(backend, "agendamentoCorrespondeAoPedido");
  const corresponde = new Function(
    "cpfNumeros",
    "digitosTelefone",
    `${codigo}; return agendamentoCorrespondeAoPedido;`
  )(
    valor => String(valor || "").replace(/\D/g, ""),
    valor => String(valor || "").replace(/\D/g, "")
  );
  const salvo = {
    nome: "Maria da Silva",
    cpf: "529.982.247-25",
    telefone: "(35) 99999-9999",
    email: "Maria@Example.com",
    dataNasc: "1990-05-20",
    dataISO: "2026-08-18",
    hora: "14:30"
  };
  const pedido = {
    nome: "Maria da Silva",
    cpfNum: "52998224725",
    telefone: "35999999999",
    email: "maria@example.com",
    dataNasc: "1990-05-20",
    dataISO: "2026-08-18",
    hora: "14:30"
  };
  assert.equal(corresponde(salvo, pedido), true);
  assert.equal(corresponde(salvo, { ...pedido, hora: "14:45" }), false);
});
