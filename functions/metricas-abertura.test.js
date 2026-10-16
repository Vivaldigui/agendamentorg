"use strict";

// Metricas de cada abertura (auditoria de 16/10/2026, item I-1). Contadores
// sem dado pessoal, espalhados em fragmentos para nao virar documento quente
// no pico, e gravados fora da transacao: metrica nunca atrasa nem derruba um
// agendamento.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { painelJs } = require("./painel-fonte");

const metricas = require("./metricas-abertura");
const {
  FRAGMENTOS_METRICAS,
  PRAZO_GRAVACAO_METRICA_MS,
  MOTIVOS,
  motivoMetricaAgendamento,
  minutoSaoPaulo,
  segundaDaSemana,
  camposMetrica,
  criarRegistradorMetricas,
  comMetricaAbertura,
  somarFragmentos
} = metricas;

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const regras = fs.readFileSync(path.join(raiz, "firestore.rules"), "utf8");
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

const erro = (code, message = "", details) => Object.assign(new Error(message), { code, details });
const incremento = (n) => ({ inc: n });

// ---- Classificacao -------------------------------------------------------------

test("cada resultado da criacao cai no motivo certo", () => {
  const casos = [
    [null, "sucesso"],
    [erro("already-exists", "Este horario foi preenchido", { tipo: "horario-preenchido" }), "conflitoHorario"],
    [erro("already-exists", "Este CPF ja possui", { tipo: "cpf-ja-agendado" }), "cpfJaAgendado"],
    [erro("failed-precondition", "Nao foi possivel...\nConsta ausencia em atendimento anterior."), "cpfBloqueado"],
    [erro("failed-precondition", "Este horario ja passou."), "horarioIndisponivel"],
    [erro("resource-exhausted", "Este celular...", { tipo: "limite-telefone" }), "limiteExcedido"],
    [erro("resource-exhausted", "Esta conexao...", { tipo: "limite-origem" }), "limiteExcedido"],
    [erro("resource-exhausted", "Muitas tentativas"), "muitasTentativas"],
    [erro("functions/invalid-argument", "Informe um CPF valido."), "dadosInvalidos"],
    [erro("internal", "boom"), "erro"],
    [new Error("sem codigo"), "erro"]
  ];
  for (const [entrada, esperado] of casos) {
    assert.equal(motivoMetricaAgendamento(entrada), esperado, entrada ? entrada.message : "sucesso");
  }
});

test("minuto e segunda-feira no fuso de Sao Paulo", () => {
  assert.equal(minutoSaoPaulo(Date.parse("2026-10-19T11:00:30Z")), "2026-10-19T08:00");
  assert.equal(minutoSaoPaulo(Date.parse("2026-10-20T02:59:00Z")), "2026-10-19T23:59");
  assert.equal(segundaDaSemana("2026-10-19"), "2026-10-19");
  assert.equal(segundaDaSemana("2026-10-23"), "2026-10-19");
  assert.equal(segundaDaSemana("2026-10-25"), "2026-10-19", "Domingo pertence a semana que comecou na segunda anterior.");
});

test("campos gravados: contadores e histograma, sem dado pessoal", () => {
  const ms = Date.parse("2026-10-19T11:00:05Z");
  assert.deepEqual(camposMetrica("sucesso", ms, incremento), {
    segunda: "2026-10-19",
    tentativas: { inc: 1 },
    sucesso: { inc: 1 },
    tentativasPorMinuto: { "2026-10-19T08:00": { inc: 1 } },
    sucessosPorMinuto: { "2026-10-19T08:00": { inc: 1 } }
  });
  const conflito = camposMetrica("conflitoHorario", ms, incremento);
  assert.equal(conflito.sucessosPorMinuto, undefined);
  assert.deepEqual(conflito.conflitoHorario, { inc: 1 });
  assert.deepEqual(camposMetrica("inventado", ms, incremento).erro, { inc: 1 });
});

// ---- Gravacao ------------------------------------------------------------------

function montarDb(set) {
  const caminhos = [];
  const db = {
    collection: (c1) => ({
      doc: (d1) => ({
        collection: (c2) => ({
          doc: (d2) => ({
            set: (campos, opcoes) => {
              caminhos.push({ caminho: `${c1}/${d1}/${c2}/${d2}`, campos, opcoes });
              return set(campos, opcoes);
            }
          })
        })
      })
    })
  };
  return { db, caminhos };
}

test("grava num dos fragmentos da segunda da abertura, com merge e increment", async () => {
  const { db, caminhos } = montarDb(async () => {});
  const registrar = criarRegistradorMetricas({
    db,
    FieldValue: { increment: incremento },
    agora: () => Date.parse("2026-10-19T11:00:05Z"),
    aleatorio: () => 0.999
  });
  await registrar("sucesso");
  assert.equal(caminhos.length, 1);
  assert.equal(caminhos[0].caminho, `metricas_abertura/2026-10-19/fragmentos/${FRAGMENTOS_METRICAS - 1}`);
  assert.deepEqual(caminhos[0].opcoes, { merge: true });
  assert.deepEqual(caminhos[0].campos.tentativas, { inc: 1 });
});

test("gravacao lenta nao segura a resposta alem do prazo", async () => {
  const { db } = montarDb(() => new Promise(() => {}));
  const registrar = criarRegistradorMetricas({ db, FieldValue: { increment: incremento }, logger: { warn: () => {} } });
  const inicio = Date.now();
  await registrar("sucesso");
  const decorrido = Date.now() - inicio;
  assert.ok(decorrido < PRAZO_GRAVACAO_METRICA_MS + 300, `${decorrido} ms`);
});

test("falha ao gravar e engolida, inclusive erro sincrono", async () => {
  const avisos = [];
  const logger = { warn: (...args) => avisos.push(args) };
  const { db } = montarDb(async () => { throw new Error("quota"); });
  await criarRegistradorMetricas({ db, FieldValue: { increment: incremento }, logger })("sucesso");
  const quebrado = { collection: () => { throw new Error("sincrono"); } };
  await criarRegistradorMetricas({ db: quebrado, FieldValue: { increment: incremento }, logger })("erro");
  assert.equal(avisos.length, 2);
});

// ---- Envoltorio ------------------------------------------------------------------

test("o envoltorio devolve o resultado e conta sucesso", async () => {
  const contados = [];
  const handler = comMetricaAbertura(async (m) => contados.push(m), async (request) => ({ eco: request.data }));
  assert.deepEqual(await handler({ data: 1 }), { eco: 1 });
  assert.deepEqual(contados, ["sucesso"]);
});

test("o envoltorio relanca o MESMO erro e conta o motivo", async () => {
  const contados = [];
  const original = erro("already-exists", "Este horario foi preenchido", { tipo: "horario-preenchido", agenda: {} });
  const handler = comMetricaAbertura(async (m) => contados.push(m), async () => { throw original; });
  await assert.rejects(() => handler({}), (e) => e === original);
  assert.deepEqual(contados, ["conflitoHorario"]);
});

test("criarAgendamentoCidadao passa pelo envoltorio com o registrador real", () => {
  assert.match(backend, /const registrarMetricaAbertura = criarRegistradorMetricas\(\{ db, FieldValue \}\);/);
  assert.match(
    backend,
    /exports\.criarAgendamentoCidadao = onCall\(agendamentoPicoOptions, comMetricaAbertura\(registrarMetricaAbertura, async \(request\) => \{/
  );
  const inicio = backend.indexOf("exports.criarAgendamentoCidadao");
  const fim = backend.indexOf("exports.prepararCancelamentoCidadao");
  assert.match(backend.slice(inicio, fim), /return resultadoTransacao;\n\}\)\);/);
  // A transacao da reserva nao toca nas metricas.
  const transacao = backend.slice(backend.indexOf("db.runTransaction", inicio), fim);
  assert.doesNotMatch(transacao, /metricas_abertura|registrarMetricaAbertura/);
});

// ---- Regras e painel -------------------------------------------------------------

test("regras: painel le, ninguem grava pelo cliente", () => {
  assert.match(
    regras,
    /match \/metricas_abertura\/\{segunda\}\/fragmentos\/\{fragmento\} \{\s*allow read: if isAdmin\(\);\s*allow write: if false;/
  );
});

test("soma do painel e a mesma do backend", () => {
  const motivosPainel = /const MOTIVOS_METRICA_ABERTURA = (\[[^\]]*\]);/.exec(painelJs);
  assert.ok(motivosPainel);
  assert.deepEqual(JSON.parse(motivosPainel[1]), [...MOTIVOS]);
  const somarPainel = new Function(
    `const MOTIVOS_METRICA_ABERTURA = ${motivosPainel[1]}; ${extrairFuncao(painelJs, "somarFragmentosMetricas")}; return somarFragmentosMetricas;`
  )();
  const fragmentos = [
    { tentativas: 3, sucesso: 1, conflitoHorario: 2, tentativasPorMinuto: { "2026-10-19T08:00": 3 }, sucessosPorMinuto: { "2026-10-19T08:00": 1 } },
    { tentativas: 2, sucesso: 1, limiteExcedido: 1, tentativasPorMinuto: { "2026-10-19T08:00": 1, "2026-10-19T08:01": 1 }, sucessosPorMinuto: { "2026-10-19T08:01": 1 } },
    null,
    { tentativas: "x" }
  ];
  assert.deepEqual(somarPainel(fragmentos), somarFragmentos(fragmentos));
  assert.equal(somarFragmentos(fragmentos).tentativas, 5);
});

test("resumo da abertura: pico, primeiro e ultimo agendamento, recusados", () => {
  const resumo = new Function(`${extrairFuncao(painelJs, "resumoAbertura")}; return resumoAbertura;`)();
  const total = somarFragmentos([{
    tentativas: 40, sucesso: 6, conflitoHorario: 25, cpfJaAgendado: 2, cpfBloqueado: 1, limiteExcedido: 3, muitasTentativas: 1, erro: 2,
    tentativasPorMinuto: { "2026-10-19T07:59": 2, "2026-10-19T08:00": 30, "2026-10-19T08:01": 8 },
    sucessosPorMinuto: { "2026-10-19T08:01": 2, "2026-10-19T08:00": 4 }
  }]);
  const r = resumo("2026-10-19", total);
  assert.equal(r.agendados, 6);
  assert.equal(r.perderamHorario, 25);
  assert.equal(r.recusados, 7);
  assert.equal(r.outros, 2);
  assert.equal(r.primeiroAgendamento, "2026-10-19T08:00");
  assert.equal(r.ultimoAgendamento, "2026-10-19T08:01");
  assert.deepEqual(r.pico, { minuto: "2026-10-19T08:00", quantidade: 30 });
});

test("REGRESSAO: recusa ao ler metricas nao encerra a sessao do painel", () => {
  // 16/10/2026: com o hosting novo e as regras antigas, abrir Relatorios
  // deslogava a recepcao com "acesso revogado".
  const carregar = extrairFuncao(painelJs, "carregarMetricasAbertura");
  assert.doesNotMatch(carregar, /encerrarSessaoPorAcessoRevogado|signOut/);
  assert.match(carregar, /erroDeAutorizacao\(e\)/);
});

test("tabela do painel tem rotulo em cada celula para o celular", () => {
  const carregar = extrairFuncao(painelJs, "carregarMetricasAbertura");
  const linha = carregar.slice(carregar.indexOf(": `<tr>"), carregar.indexOf("</tr>`).join"));
  assert.equal((linha.match(/<td data-label="/g) || []).length, 8);
  assert.equal((linha.match(/<td>/g) || []).length, 0);
  assert.match(painelHtml, /<tbody id="metricas-abertura-corpo"><\/tbody>/);
  assert.match(painelHtml, /data-acao="carregarMetricasAbertura"/);
  // Relatorios carregam sob demanda: a primeira abertura da area dispara as
  // metricas (uma vez) junto com os indicadores e o historico de acoes.
  assert.match(painelJs, /if \(vistaPainelAtual === "relatorios"\) iniciarRelatorios\(\);/);
  assert.match(extrairFuncao(painelJs, "iniciarRelatorios"), /if \(!metricasAberturaCarregadas\) carregarMetricasAbertura\(\);/);
});
