"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  OPERACAO_AGENDAMENTO_VERSAO,
  OPERACAO_AGENDAMENTO_TTL_MS,
  normalizarOperationId,
  hashPayloadAgendamento,
  resolverOperacaoExistente
} = require("./agendamento-idempotencia");

const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const sitePublico = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

function payload(overrides = {}) {
  return {
    operationId: "0123456789abcdef0123456789abcdef",
    nome: "Maria da Silva",
    cpfNum: "52998224725",
    telefone: "35999999999",
    email: "maria@example.com",
    dataNasc: "1990-05-20",
    dataISO: "2026-08-18",
    hora: "14:30",
    substituirAnterior: false,
    ...overrides
  };
}

function documentoOperacao(payloadHash, resultado = {
  agendamento: { id: "ag-1", dataISO: "2026-08-18", dataBR: "18/08/2026", hora: "14:30" },
  substituiu: null
}) {
  return {
    tipo: "criar_agendamento",
    versao: OPERACAO_AGENDAMENTO_VERSAO,
    payloadHash,
    resultado
  };
}

test("operationId exige 128 bits em hexadecimal e normaliza caixa", () => {
  assert.equal(
    normalizarOperationId("0123456789ABCDEF0123456789ABCDEF"),
    "0123456789abcdef0123456789abcdef"
  );
  assert.throws(() => normalizarOperationId(""), /operationId/i);
  assert.throws(() => normalizarOperationId("1234"), /operationId/i);
  assert.throws(() => normalizarOperationId("g".repeat(32)), /operationId/i);
});

test("hash e canonico e muda com qualquer parte relevante do pedido", () => {
  const base = payload();
  const hash = hashPayloadAgendamento(base);
  assert.equal(hash, hashPayloadAgendamento({ ...base }));
  assert.match(hash, /^[a-f0-9]{64}$/);

  for (const [campo, valor] of [
    ["operationId", "fedcba9876543210fedcba9876543210"],
    ["nome", "Maria Souza"],
    ["cpfNum", "11144477735"],
    ["telefone", "35888888888"],
    ["email", "outra@example.com"],
    ["dataNasc", "1991-05-20"],
    ["dataISO", "2026-08-19"],
    ["hora", "14:45"],
    ["substituirAnterior", true]
  ]) {
    assert.notEqual(hashPayloadAgendamento({ ...base, [campo]: valor }), hash, campo);
  }

  assert.equal(
    hashPayloadAgendamento({ ...base, telefone: "(35) 99999-9999", email: "Maria@Example.com" }),
    hashPayloadAgendamento({ ...base, telefone: "35999999999", email: "maria@example.com" })
  );
});

test("repeticao identica devolve exatamente o resultado gravado", () => {
  const hash = hashPayloadAgendamento(payload());
  const doc = documentoOperacao(hash);
  assert.deepEqual(resolverOperacaoExistente(doc, hash), doc.resultado);
  assert.equal(resolverOperacaoExistente(null, hash), null);
});

test("mesma chave com payload diferente e documento malformado falham fechados", () => {
  const hash = hashPayloadAgendamento(payload());
  const outroHash = hashPayloadAgendamento(payload({ hora: "14:45" }));

  assert.throws(
    () => resolverOperacaoExistente(documentoOperacao(hash), outroHash),
    erro => erro && erro.code === "operacao-conflitante"
  );
  assert.throws(
    () => resolverOperacaoExistente({ ...documentoOperacao(hash), versao: 99 }, hash),
    erro => erro && erro.code === "operacao-invalida"
  );
  assert.throws(
    () => resolverOperacaoExistente({ ...documentoOperacao(hash), resultado: null }, hash),
    erro => erro && erro.code === "operacao-invalida"
  );
});

test("simulacao de resposta perdida repete resultado sem repetir efeito", () => {
  const operacoes = new Map();
  let efeitos = 0;
  const executar = (pedido) => {
    const hash = hashPayloadAgendamento(pedido);
    const existente = resolverOperacaoExistente(operacoes.get(pedido.operationId), hash);
    if (existente) return existente;
    efeitos++;
    const resultado = {
      agendamento: { id: `ag-${efeitos}`, dataISO: pedido.dataISO, dataBR: "18/08/2026", hora: pedido.hora },
      substituiu: null
    };
    operacoes.set(pedido.operationId, documentoOperacao(hash, resultado));
    return resultado;
  };

  const primeiraRespostaDescartada = executar(payload());
  const repeticao = executar(payload());
  assert.deepEqual(repeticao, primeiraRespostaDescartada);
  assert.equal(efeitos, 1);
});

test("backend consulta e cria recibo idempotente dentro da transacao", () => {
  const inicio = backend.indexOf("exports.criarAgendamentoCidadao");
  const fim = backend.indexOf("exports.prepararCancelamentoCidadao", inicio);
  const criar = backend.slice(inicio, fim);

  assert.match(criar, /normalizarOperationId/);
  assert.match(criar, /hashPayloadAgendamento/);
  assert.match(criar, /await\s+operacaoRef\.get\(\)/);
  assert.ok(criar.indexOf("await operacaoRef.get()") < criar.indexOf("await aplicarRateLimit"));
  assert.match(criar, /const\s+operacaoDoc\s*=\s*await\s+t\.get\(operacaoRef\)/);
  assert.match(criar, /t\.create\(operacaoRef/);
  assert.match(criar, /return\s+resultadoTransacao/);
});

test("recibos tem expiracao, limpeza e regra explicita sem acesso do cliente", () => {
  assert.equal(OPERACAO_AGENDAMENTO_TTL_MS, 24 * 60 * 60 * 1000);
  assert.match(backend, /limparColecaoExpirada\(["']operacoes_agendamento["']/);

  const regras = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  assert.match(regras, /match\s+\/operacoes_agendamento\/\{documentId\}[\s\S]*?allow\s+read,\s*write:\s*if\s+false/);
});

// Originalmente este teste tambem exigia que confirmar a substituicao iniciasse
// uma nova operacao. A contencao B4 removeu esse fluxo de proposito -- ele
// permitia tomar o agendamento de quem so se conhecia o CPF --, entao as
// asercoes de substituicao sairam e a ausencia dela e verificada em
// contencao-b4-b5.test.js. O resto, que trata da preservacao do operationId
// diante de resposta ambigua, continua valendo.
test("cliente preserva operationId em erro ambiguo", () => {
  assert.match(sitePublico, /let\s+operacaoAgendamentoPendente\s*=\s*null/);
  assert.match(sitePublico, /function\s+obterOperacaoAgendamentoPendente/);
  assert.match(sitePublico, /operationId:\s*operacaoPendente\.operationId/);
  assert.match(sitePublico, /operacaoPendente\.resultadoIncerto\s*=\s*true/);
  assert.match(sitePublico, /definirCamposOperacaoBloqueados\(true\)/);
  assert.match(sitePublico, /if\s*\(!operacaoPendente\.resultadoIncerto\)[\s\S]*?definirCamposOperacaoBloqueados\(false\)/);
  assert.match(sitePublico, /operacaoPendente\.emEnvio\s*=\s*true/);
  assert.match(sitePublico, /resultadoIncerto\s*===\s*true[\s\S]*?emEnvio\s*===\s*true/);
  assert.match(sitePublico, /const\s+dataOperacao\s*=\s*dataSel[\s\S]*?const\s+horaOperacao\s*=\s*horaSel/);
  assert.doesNotMatch(sitePublico, /TENTANDO NOVAMENTE[\s\S]{0,700}slotAindaDisponivel/);
});

test("backend mantem compatibilidade segura com cliente anterior ao operationId", () => {
  const inicio = backend.indexOf("exports.criarAgendamentoCidadao");
  const fim = backend.indexOf("exports.prepararCancelamentoCidadao", inicio);
  const criar = backend.slice(inicio, fim);
  assert.match(criar, /operationIdInformado/);
  assert.match(criar, /crypto\.randomBytes\(16\)\.toString\(["']hex["']\)/);
  assert.match(criar, /!operationIdInformado[\s\S]*?agendamentoCorrespondeAoPedido/);
});

test("callables publicas novas possuem limite e replay nao e ilimitado", () => {
  const verificacaoInicio = backend.indexOf("exports.verificarDisponibilidadeSlotCidadao");
  const verificacaoFim = backend.indexOf("exports.verificarBloqueioCpf", verificacaoInicio);
  const verificacao = backend.slice(verificacaoInicio, verificacaoFim);
  assert.match(verificacao, /sessaoId/);
  assert.match(verificacao, /fragmentoRateLimitVerificacao\(sessaoId\)/);
  assert.match(
    verificacao,
    /aplicarRateLimitOrigem\(\s*request,\s*["']verificar_disponibilidade_slot_origem["'],\s*125,\s*10\s*\*\s*60\s*\*\s*1000,\s*`fragmento_\$\{fragmento\}`\s*\)/
  );
  assert.doesNotMatch(verificacao, /`\$\{sessaoId\}\|\$\{dataISO\}_\$\{hora\}`/);
  assert.match(sitePublico, /verificarSlot\(\{\s*data,\s*hora,\s*sessaoId\s*\}\)/);

  const fingerprintInicio = backend.indexOf("function fingerprintOrigemRequisicao");
  const fingerprintFim = backend.indexOf("function fragmentoRateLimitVerificacao", fingerprintInicio);
  assert.doesNotMatch(backend.slice(fingerprintInicio, fingerprintFim), /user-agent/i);
  assert.match(backend, /RATE_LIMIT_VERIFICACAO_FRAGMENTOS\s*=\s*16/);

  const criarInicio = backend.indexOf("exports.criarAgendamentoCidadao");
  const criarFim = backend.indexOf("exports.prepararCancelamentoCidadao", criarInicio);
  assert.match(
    backend.slice(criarInicio, criarFim),
    /aplicarRateLimit\(request,\s*["']repetir_agendamento["'],\s*60,\s*10\s*\*\s*60\s*\*\s*1000,\s*operationId\)/
  );
});

test("erro definitivo apos resposta ambigua libera uma nova operacao", () => {
  assert.match(
    sitePublico,
    /else if\s*\(codigoFinal\s*===\s*["']failed-precondition["']\)\s*\{[\s\S]*?operacaoAgendamentoPendente\s*=\s*null;[\s\S]*?definirCamposOperacaoBloqueados\(false\)/
  );
});

test("ensaio de disputa envia operationId por invocacao", () => {
  const carga = fs.readFileSync(path.join(__dirname, "..", "tests", "load", "booking-contention.js"), "utf8");
  assert.match(carga, /operationId\s*:/);
});
