"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const disputa = fs.readFileSync(path.join(raiz, "tests", "load", "booking-contention.js"), "utf8");
const leitura = fs.readFileSync(path.join(raiz, "tests", "load", "agenda-read.js"), "utf8");
const instrucoes = fs.readFileSync(path.join(raiz, "tests", "load", "README.md"), "utf8");

function extrairFuncao(codigo, nome) {
  const inicio = codigo.indexOf(`function ${nome}(`);
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

test("backend usa a configuracao Firebase do projeto atual sem fallback de producao", () => {
  assert.match(backend, /initializeApp\(\s*\)\s*;/);
  const hostProducao = ["agendamento-cin-itanhandu", "default-rtdb"].join("-");
  assert.doesNotMatch(backend, new RegExp(hostProducao));
  assert.doesNotMatch(backend, /FIREBASE_DATABASE_URL/);
});

// O Realtime Database saiu do backend junto com a telemetria de presenca
// (07/10/2026). Um getDatabase() de volta em escopo de modulo derrubaria todas
// as funcoes na carga quando o FIREBASE_CONFIG nao traz databaseURL.
test("backend nao inicializa o Realtime Database", () => {
  assert.doesNotMatch(backend, /getDatabase\(/);
});

for (const [nome, codigo, variavel] of [
  ["disputa de vaga", disputa, "FUNCTION_URL"],
  ["leitura da agenda", leitura, "BASE_URL"]
]) {
  test(`${nome} bloqueia producao sem possibilidade de desbloqueio por variavel`, () => {
    const funcao = extrairFuncao(codigo, "bloquearAlvoProducao");
    const bloquear = new Function(`${funcao}; return bloquearAlvoProducao;`)();

    for (const alvo of [
      "https://agendamento-cin-itanhandu.web.app",
      "https://us-central1-agendamento-cin-itanhandu.cloudfunctions.net/criarAgendamentoCidadao",
      "https://AGENDAMENTO-CIN-ITANHANDU.firebaseapp.com",
      "https://cin.itanhandu.cam.mg.gov.br",
      "https://CIN.ITANHANDU.CAM.MG.GOV.BR/api/agenda-publica"
    ]) {
      assert.throws(() => bloquear(alvo, variavel), /producao|produção/i, alvo);
    }

    assert.doesNotThrow(() => bloquear("http://127.0.0.1:5000", variavel));
    assert.doesNotThrow(() => bloquear("https://agendamento-cin-homolog.web.app", variavel));
    assert.doesNotMatch(funcao, /CONFIRM_HOMOLOGATION|__ENV/);

    const chamada = codigo.indexOf(`bloquearAlvoProducao(${variavel}`);
    const confirmacao = codigo.indexOf("CONFIRM_HOMOLOGATION");
    assert.notEqual(chamada, -1, "A denylist precisa ser chamada no carregamento do script.");
    assert.ok(confirmacao === -1 || chamada < confirmacao, "A denylist deve rodar antes da confirmacao por ambiente.");
  });
}

test("documentacao declara que a denylist de producao nao pode ser contornada", () => {
  assert.match(instrucoes, /denylist|bloqueio expl[ií]cito/i);
  assert.match(instrucoes, /n[aã]o (?:pode ser )?(?:contornada|desativada|desbloqueada)/i);
  assert.match(instrucoes, /vari[aá]vel de ambiente/i);
});
