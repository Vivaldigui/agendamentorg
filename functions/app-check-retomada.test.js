"use strict";

// Recuperacao de App Check na retomada da aba.
//
// Abertura de 24/08/2026: 47 recusas de App Check entre 08:00 e 08:05, todas em
// verificarDisponibilidadeSlotCidadao -- a primeira callable disparada por quem
// voltava a uma aba deixada aberta esperando a abertura. Zero antes das 08:00,
// zero depois das 08:05.
//
// O erro do backend era `app-check/invalid-argument` ("Decoding App Check token
// failed"), ou seja token MALFORMADO: quando a atestacao falha, o SDK web anexa
// um placeholder de erro no lugar do JWT e a barreira nao consegue decodificar.
//
// Duas causas somadas:
//   1. erroTransiente NAO classifica unauthenticated/permission-denied como
//      transiente, entao nenhum dos lacos de retentativa existentes se
//      recuperava de uma recusa de App Check -- eles faziam break na hora.
//   2. O navegador suspende timers de aba oculta, entao o auto-refresh do token
//      nao roda enquanto a pessoa espera com o celular bloqueado.
//
// A correcao ataca as duas: chamarFuncao repete uma unica vez apos forcar token
// novo, e a volta da aba renova o token antes de qualquer toque.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

function extrairFuncao(codigo, nome) {
  let inicio = codigo.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  // Sem isto o "async" fica de fora do recorte e o corpo extraido vira erro de
  // sintaxe no primeiro await.
  const PREFIXO_ASYNC = "async ";
  if (codigo.slice(inicio - PREFIXO_ASYNC.length, inicio) === PREFIXO_ASYNC) {
    inicio -= PREFIXO_ASYNC.length;
  }
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

const codigoErroFunctions = new Function(
  `${extrairFuncao(sitePublico, "codigoErroFunctions")}; return codigoErroFunctions;`
)();

const erroDeAppCheck = new Function(
  "codigoErroFunctions",
  `${extrairFuncao(sitePublico, "erroDeAppCheck")}; return erroDeAppCheck;`
)(codigoErroFunctions);

const erroTransiente = new Function(
  "codigoErroFunctions",
  `${extrairFuncao(sitePublico, "erroTransiente")}; return erroTransiente;`
)(codigoErroFunctions);

// Monta chamarFuncao com dependencias controladas, para exercitar o caminho de
// recuperacao de verdade em vez de so olhar o texto do arquivo.
function montarChamarFuncao({ respostas }) {
  const chamadas = [];
  let refreshes = 0;
  const clienteFake = (regiao) => ({
    httpsCallable: (nome) => (dados) => {
      chamadas.push({ nome, dados, regiao });
      const proxima = respostas.shift();
      if (proxima instanceof Error) return Promise.reject(proxima);
      return Promise.resolve(proxima);
    }
  });
  const fn = new Function(
    "functions", "functionsPico", "CALLABLES_REGIAO_PICO",
    "garantirAppCheckPronto", "tentarRefreshAppCheck", "erroDeAppCheck",
    "registrarRecusaAppCheck", "console",
    [
      "let recusasAppCheckSeguidas = 0;",
      extrairFuncao(sitePublico, "clienteFunctions"),
      extrairFuncao(sitePublico, "chamarFuncao"),
      "return chamarFuncao;"
    ].join(";\n")
  )(
    clienteFake("us-central1"),
    clienteFake("southamerica-east1"),
    LISTA_REGIAO_PICO,
    async () => true,
    async () => { refreshes += 1; },
    erroDeAppCheck,
    () => {},
    { warn() {} }
  );
  return { chamarFuncao: fn, chamadas, contarRefreshes: () => refreshes };
}

// Lista real do site: se alguem tirar uma callable dali, o teste de roteamento
// abaixo passa a cobrir a nova realidade em vez de uma copia congelada.
const LISTA_REGIAO_PICO = JSON.parse(
  (sitePublico.match(/var CALLABLES_REGIAO_PICO = (\[[^\]]*\])/) || [])[1]
  || assert.fail("CALLABLES_REGIAO_PICO nao encontrada no site.")
);

function erro(codigo) {
  const e = new Error(`falha ${codigo}`);
  e.code = codigo;
  return e;
}

test("a classificacao de transiente continua sem incluir recusa de App Check", () => {
  // Documenta por que a correcao nao podia ser "so replicar o laco existente":
  // os lacos fazem break nestes codigos.
  assert.equal(erroTransiente(erro("unauthenticated")), false);
  assert.equal(erroTransiente(erro("permission-denied")), false);
  assert.equal(erroTransiente(erro("unavailable")), true);
});

test("erroDeAppCheck reconhece as duas recusas da barreira", () => {
  assert.equal(erroDeAppCheck(erro("unauthenticated")), true);
  assert.equal(erroDeAppCheck(erro("permission-denied")), true);
  assert.equal(erroDeAppCheck(erro("functions/unauthenticated")), true, "o SDK web prefixa com functions/");
  assert.equal(erroDeAppCheck(erro("failed-precondition")), false);
  assert.equal(erroDeAppCheck(erro("already-exists")), false);
  assert.equal(erroDeAppCheck(new Error("sem code")), false);
});

test("recusa de App Check renova o token e repete uma unica vez", async () => {
  const { chamarFuncao, chamadas, contarRefreshes } = montarChamarFuncao({
    respostas: [erro("unauthenticated"), { data: { disponivel: true } }]
  });
  const r = await chamarFuncao("verificarDisponibilidadeSlotCidadao", { data: "2026-09-08", hora: "14:30" });
  assert.deepEqual(r, { data: { disponivel: true } });
  assert.equal(chamadas.length, 2, "precisa repetir exatamente uma vez");
  assert.equal(contarRefreshes(), 1, "a repeticao so vale depois de forcar token novo");
  assert.deepEqual(chamadas[0].dados, chamadas[1].dados, "o payload repetido tem de ser o mesmo");
});

test("a repeticao nao vira laco: a segunda recusa sobe para quem chamou", async () => {
  const { chamarFuncao, chamadas, contarRefreshes } = montarChamarFuncao({
    respostas: [erro("unauthenticated"), erro("unauthenticated")]
  });
  await assert.rejects(() => chamarFuncao("verificarDisponibilidadeSlotCidadao", {}), /unauthenticated/);
  assert.equal(chamadas.length, 2, "no maximo duas tentativas");
  assert.equal(contarRefreshes(), 1);
});

test("erro que nao e de App Check sobe na hora, sem repetir", async () => {
  // failed-precondition significa vaga tomada. Repetir aqui atrasaria o aviso
  // de "escolha outro horario" sem nenhum ganho.
  const { chamarFuncao, chamadas, contarRefreshes } = montarChamarFuncao({
    respostas: [erro("failed-precondition")]
  });
  await assert.rejects(() => chamarFuncao("verificarDisponibilidadeSlotCidadao", {}), /failed-precondition/);
  assert.equal(chamadas.length, 1, "nenhuma repeticao para erro de negocio");
  assert.equal(contarRefreshes(), 0);
});

test("sucesso de primeira nao renova token nem repete", async () => {
  const { chamarFuncao, chamadas, contarRefreshes } = montarChamarFuncao({
    respostas: [{ data: { ok: true } }]
  });
  await chamarFuncao("criarAgendamentoCidadao", { cpf: "x" });
  assert.equal(chamadas.length, 1);
  assert.equal(contarRefreshes(), 0);
});

test("a recuperacao vive em chamarFuncao, entao alcanca as quatro callables", () => {
  // Era exatamente esta a lacuna: verificarDisponibilidadeSlotCidadao e a unica
  // chamada sem laco proprio de retentativa. Corrigir no ponto unico de chamada
  // cobre as quatro sem duplicar codigo em cada fluxo.
  const corpo = extrairFuncao(sitePublico, "chamarFuncao");
  assert.match(corpo, /erroDeAppCheck\(erro\)/);
  assert.match(corpo, /await tentarRefreshAppCheck\(\)/);
  for (const callable of [
    "verificarDisponibilidadeSlotCidadao",
    "criarAgendamentoCidadao",
    "consultarAgendamentoCidadao",
    "prepararCancelamentoCidadao"
  ]) {
    assert.match(
      sitePublico,
      new RegExp(`chamarFuncao\\("${callable}"`),
      `${callable} precisa passar por chamarFuncao para herdar a recuperacao.`
    );
  }
});

test("nenhuma callable publica escapa de chamarFuncao", () => {
  // httpsCallable direto burlaria tanto o App Check quanto a recuperacao.
  const foraDeChamarFuncao = sitePublico
    .replace(extrairFuncao(sitePublico, "chamarFuncao"), "");
  assert.doesNotMatch(
    foraDeChamarFuncao,
    /httpsCallable\(/,
    "httpsCallable so pode aparecer dentro de chamarFuncao."
  );
});

test("a volta da aba renova o token antes do primeiro toque", () => {
  const trecho = sitePublico.slice(
    sitePublico.indexOf('document.addEventListener("visibilitychange"'),
    sitePublico.indexOf('document.addEventListener("visibilitychange"') + 900
  );
  assert.match(trecho, /visibilityState === "hidden"/, "precisa marcar quando a aba sumiu");
  assert.match(trecho, /abaOcultaDesde = Date\.now\(\)/);
  assert.match(trecho, /retomarAtualizacaoAbertura\(\)/, "a retomada da agenda nao pode se perder");
  assert.match(trecho, /ausencia >= MS_OCULTA_PARA_RENOVAR_APP_CHECK.*tentarRefreshAppCheck\(\)/);
});

test("a renovacao na retomada tem guarda de tempo", () => {
  // Sem guarda, cada alternancia de aba viraria uma chamada ao reCAPTCHA.
  const match = sitePublico.match(/const MS_OCULTA_PARA_RENOVAR_APP_CHECK = (\d+)/);
  assert.ok(match, "a guarda precisa ser uma constante nomeada.");
  const ms = Number(match[1]);
  assert.ok(ms >= 10000, `guarda de ${ms}ms e curta demais: alternar abas geraria reCAPTCHA a toa.`);
  assert.ok(ms <= 120000, `guarda de ${ms}ms e longa demais: perderia a espera tipica pela abertura.`);
});

// ---------------------------------------------------------------------------
// Roteamento por regiao
//
// O Firestore fica em southamerica-east1 e as Functions nasceram em
// us-central1: toda leitura e escrita cruzava o continente. Medido em
// 24/08/2026 com instancia quente e cache furado de proposito, ~880ms de
// origem, sendo so 12ms ate a borda do CDN.
//
// So o caminho critico do pico mudou. Chamar uma callable na regiao errada
// devolve not-found -- erro que so apareceria as 08:00 de uma segunda-feira.
// ---------------------------------------------------------------------------

test("as callables do pico saem por southamerica-east1", async () => {
  for (const nome of LISTA_REGIAO_PICO) {
    const { chamarFuncao, chamadas } = montarChamarFuncao({ respostas: [{ data: {} }] });
    await chamarFuncao(nome, {});
    assert.equal(chamadas[0].regiao, "southamerica-east1", `${nome} precisa sair pela regiao do Firestore.`);
  }
});

test("as demais callables continuam em us-central1", async () => {
  // Estas nao migraram: mudar a regiao delas exigiria tocar tambem o painel da
  // recepcao, que nao passou por nenhuma verificacao desta mudanca.
  for (const nome of ["consultarAgendamentoCidadao", "prepararCancelamentoCidadao",
                      "cancelarAgendamentoCidadao", "verificarBloqueioCpf"]) {
    const { chamarFuncao, chamadas } = montarChamarFuncao({ respostas: [{ data: {} }] });
    await chamarFuncao(nome, {});
    assert.equal(chamadas[0].regiao, "us-central1", `${nome} nao migrou e nao pode sair pela regiao nova.`);
  }
});

test("a lista do site bate exatamente com o que o backend moveu", () => {
  const backendJs = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  // As que ganharam region no backend, por meio das opcoes do caminho critico.
  const opcoesComRegiao = ["agendamentoPicoOptions", "verificacaoSlotOptions"];
  for (const opcao of opcoesComRegiao) {
    // Recorte por indice em vez de regex: escapar chave e classe de caractere
    // dentro de template literal e faceil de errar, e o erro seria silencioso
    // (a trava passaria a nao verificar nada).
    const inicio = backendJs.indexOf(`const ${opcao} = {`);
    assert.notEqual(inicio, -1, `${opcao} nao encontrada no backend.`);
    const bloco = backendJs.slice(inicio, backendJs.indexOf("};", inicio));
    assert.ok(
      bloco.includes("region: REGIAO_PICO"),
      `${opcao} deveria declarar a regiao do pico.`
    );
  }
  const declaradas = [...backendJs.matchAll(/exports\.(\w+) = onCall\((\w+)/g)]
    .filter(([, , opcao]) => opcoesComRegiao.includes(opcao))
    .map(([, nome]) => nome)
    .sort();
  assert.deepEqual(
    [...LISTA_REGIAO_PICO].sort(),
    declaradas,
    "A lista do site e as callables movidas no backend divergiram: uma delas sairia na regiao errada."
  );
});

test("a regiao do pico e a mesma do Firestore, nos dois lados", () => {
  const backendJs = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  assert.match(backendJs, /const REGIAO_PICO = "southamerica-east1"/);
  assert.match(sitePublico, /var REGIAO_PICO = "southamerica-east1"/);
  // O rewrite do Hosting aponta a regiao da funcao HTTP: errar aqui derruba
  // /api/agenda-publica inteiro, nao uma callable so.
  const hosting = fs.readFileSync(path.resolve(__dirname, "..", "firebase.json"), "utf8");
  const rewrite = JSON.parse(hosting).hosting.rewrites
    .find((r) => r.function && r.function.functionId === "carregarAgendaPublicaHttp");
  assert.ok(rewrite, "rewrite de /api/agenda-publica nao encontrado.");
  assert.equal(rewrite.function.region, "southamerica-east1");
});
