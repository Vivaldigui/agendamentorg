"use strict";

// Rota de escape para recusa PERSISTENTE de App Check.
//
// Em 31/08 um moto g05 (Android 15, navegador embutido de app) foi recusado em
// 100% das tentativas de verdade: 78 POSTs, 0 sucessos, 6 minutos preso na
// selecao de horario sem nunca chegar a criar o agendamento. O reCAPTCHA se
// recusa a atestar aquele ambiente, entao renovar o token so gera outro token
// invalido -- o retry existente nao ajuda.
//
// Nao da para consertar no backend. A saida e, apos algumas recusas SEGUIDAS,
// parar de repetir a mensagem generica e orientar a pessoa a abrir num
// navegador de verdade. Estes testes EXECUTAM chamarFuncao com dependencias
// controladas -- ler o texto do arquivo nao provaria a contagem.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

function extrairFuncao(codigo, nome) {
  let inicio = codigo.indexOf("function " + nome + "(");
  assert.notEqual(inicio, -1, "Funcao " + nome + " nao encontrada.");
  if (codigo.slice(inicio - 6, inicio) === "async ") inicio -= 6;
  const abre = codigo.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(inicio, i + 1);
    }
  }
  throw new Error("Fim de " + nome + " nao encontrado.");
}

function erroAppCheck() {
  const e = new Error("Decoding App Check token failed");
  e.code = "unauthenticated";
  return e;
}

// Monta chamarFuncao com um cliente controlavel e conta modais/refreshes.
function montar({ respostas }) {
  const estado = { modais: 0, refreshes: 0, chamadas: 0 };
  // Espelha o formato real: clienteFunctions(nome).httpsCallable(nome)(dados).
  const cliente = (_nome) => ({
    httpsCallable: (_n) => (dados) => {
      estado.chamadas += 1;
      const proxima = respostas.shift();
      if (proxima instanceof Error) return Promise.reject(proxima);
      return Promise.resolve(proxima);
    }
  });
  const codigoErroFunctions = (e) => String(e && e.code || "").replace(/^functions\//, "");
  const corpo = [
    "let recusasAppCheckSeguidas = 0;",
    "let alertaAppCheckMostrado = false;",
    "const LIMITE_RECUSAS_APP_CHECK = 3;",
    extrairFuncao(sitePublico, "erroDeAppCheck"),
    extrairFuncao(sitePublico, "registrarRecusaAppCheck"),
    extrairFuncao(sitePublico, "chamarFuncao"),
    "return { chamarFuncao, estado: () => recusasAppCheckSeguidas };"
  ].join("\n");
  const fn = new Function(
    "clienteFunctions", "garantirAppCheckPronto", "tentarRefreshAppCheck",
    "codigoErroFunctions", "mostrarAlertaAppCheckPersistente", "console",
    corpo
  )(
    cliente,
    async () => true,
    async () => { estado.refreshes += 1; },
    codigoErroFunctions,
    () => { estado.modais += 1; },
    { warn() {} }
  );
  return { chamar: fn.chamarFuncao, estado, contador: fn.estado };
}

test("recusa unica NAO abre a rota de escape", async () => {
  // Uma falha isolada e recuperada pelo retry; nao pode assustar quem so teve
  // um solavanco de rede.
  const { chamar, estado } = montar({ respostas: [erroAppCheck(), { data: { ok: true } }] });
  const r = await chamar("verificarDisponibilidadeSlotCidadao", {});
  assert.deepEqual(r, { data: { ok: true } });
  assert.equal(estado.modais, 0, "Uma recusa recuperada nao pode abrir o alerta.");
});

test("tres acoes recusadas seguidas abrem a rota de escape uma vez", async () => {
  // Cada acao do cidadao = uma chamada que falha nas duas tentativas internas.
  const { chamar, estado } = montar({
    respostas: [
      erroAppCheck(), erroAppCheck(),
      erroAppCheck(), erroAppCheck(),
      erroAppCheck(), erroAppCheck()
    ]
  });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => chamar("verificarDisponibilidadeSlotCidadao", {}));
  }
  assert.equal(estado.modais, 1, "O alerta abre exatamente uma vez, nao a cada clique.");
});

test("um sucesso no meio zera a contagem", async () => {
  // A pessoa cujo aparelho oscila nao pode ser mandada para o navegador so
  // porque teve duas falhas esparsas.
  const { chamar, estado, contador } = montar({
    respostas: [
      erroAppCheck(), erroAppCheck(),   // acao 1: falha
      erroAppCheck(), erroAppCheck(),   // acao 2: falha
      { data: { ok: true } },           // acao 3: SUCESSO -> zera
      erroAppCheck(), erroAppCheck()    // acao 4: falha (contagem recomeca)
    ]
  });
  await assert.rejects(() => chamar("x", {}));
  await assert.rejects(() => chamar("x", {}));
  await chamar("x", {});
  assert.equal(contador(), 0, "Sucesso tem de zerar a contagem.");
  await assert.rejects(() => chamar("x", {}));
  assert.equal(estado.modais, 0, "Com o zeramento, o limite nao foi atingido.");
});

test("erro que NAO e de App Check nao conta nem abre a rota", async () => {
  const bloqueio = new Error("failed-precondition");
  bloqueio.code = "failed-precondition";
  const { chamar, estado, contador } = montar({ respostas: [bloqueio] });
  await assert.rejects(() => chamar("x", {}), /failed-precondition/);
  assert.equal(contador(), 0);
  assert.equal(estado.modais, 0);
});

test("a mensagem de escape e acionavel e cita o navegador", () => {
  // Aqui o criterio e o conteudo, entao a checagem por texto e legitima.
  const fnTexto = extrairFuncao(sitePublico, "mostrarAlertaAppCheckPersistente");
  assert.match(fnTexto, /Abrir no navegador|Abrir no Chrome/);
  assert.match(fnTexto, /Instagram|Facebook|WhatsApp/, "Precisa nomear o caso do navegador embutido.");
  assert.match(fnTexto, /Câmara/, "Precisa dar uma saida humana: ligar para a Camara.");
  assert.match(fnTexto, /alertaAppCheckMostrado = true/, "So pode aparecer uma vez por visita.");
});

test("o limite e conservador: poucas tentativas, nao dezenas", () => {
  const m = sitePublico.match(/const LIMITE_RECUSAS_APP_CHECK = (\d+)/);
  assert.ok(m, "O limite precisa ser uma constante nomeada.");
  const n = Number(m[1]);
  assert.ok(n >= 2 && n <= 5, "Limite de " + n + " esta fora do razoavel (2 a 5).");
});
