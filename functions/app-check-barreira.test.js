"use strict";

// O App Check deixou de ser ativado no carregamento da pagina para tirar o
// reCAPTCHA (763 KB de JS) do caminho critico. Em troca, nenhuma callable pode
// sair antes da barreira de prontidao resolver: todas as callables publicas
// rodam com enforceAppCheck: true no backend.

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
  const abre = codigo.indexOf("{", codigo.indexOf(")", inicio));
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

function montarBarreira({ chave = "chave-de-teste", getTokenFalha = false, falharPrimeiroToken = false } = {}) {
  const corpo = ["appCheckConfigurado", "prepararAppCheck", "garantirAppCheckPronto", "chamarFuncao"]
    .map((nome) => extrairFuncao(sitePublico, nome))
    .join("\n");

  const registro = { activate: 0, getToken: 0, chamadas: [], avisos: [] };
  const firebase = {
    appCheck: () => ({
      activate: () => { registro.activate++; },
      getToken: () => {
        registro.getToken++;
        const falhar = getTokenFalha || (falharPrimeiroToken && registro.getToken === 1);
        return falhar ? Promise.reject(new Error("sem rede")) : Promise.resolve({ token: "t" });
      }
    })
  };
  const functions = {
    httpsCallable: (nome) => (dados) => {
      // Registra quantos tokens ja haviam sido emitidos quando a chamada saiu.
      registro.chamadas.push({ nome, dados, tokensQuandoSaiu: registro.getToken });
      return Promise.resolve({ data: { ok: true } });
    }
  };
  const consoleFalso = { warn: (...args) => registro.avisos.push(args.join(" ")) };

  const fabrica = new Function(
    "APP_CHECK_RECAPTCHA_SITE_KEY",
    "firebase",
    "functions",
    "console",
    `
      let appCheckAtivado = false;
      let promessaAppCheckPronto = null;
      ${corpo}
      return {
        chamarFuncao,
        garantirAppCheckPronto,
        estado: () => ({ appCheckAtivado, barreiraViva: promessaAppCheckPronto !== null })
      };
    `
  );
  return { api: fabrica(chave, firebase, functions, consoleFalso), registro };
}

// ---------------------------------------------------------------------------
// Comportamento da barreira
// ---------------------------------------------------------------------------

test("a callable so sai depois do token de App Check", async () => {
  const { api, registro } = montarBarreira();
  await api.chamarFuncao("criarAgendamentoCidadao", { cpf: "1" });

  assert.equal(registro.chamadas.length, 1);
  assert.equal(registro.chamadas[0].nome, "criarAgendamentoCidadao");
  // Token emitido ANTES da chamada sair: e isso que o enforceAppCheck exige.
  assert.ok(registro.chamadas[0].tokensQuandoSaiu >= 1);
  assert.equal(registro.activate, 1);
});

test("a barreira e idempotente e o reCAPTCHA e ativado uma vez so", async () => {
  const { api, registro } = montarBarreira();
  await Promise.all([
    api.chamarFuncao("consultarAgendamentoCidadao", {}),
    api.chamarFuncao("verificarBloqueioCpf", {}),
    api.garantirAppCheckPronto()
  ]);
  await api.chamarFuncao("cancelarAgendamentoCidadao", {});

  // Tres chamadas e um aquecimento compartilham a mesma preparacao.
  assert.equal(registro.activate, 1);
  assert.equal(registro.getToken, 1);
  assert.equal(registro.chamadas.length, 3);
  assert.equal(api.estado().appCheckAtivado, true);
});

test("falha ao emitir token libera nova tentativa sem repetir activate", async () => {
  const { api, registro } = montarBarreira({ getTokenFalha: true });

  await api.chamarFuncao("criarAgendamentoCidadao", {});
  // Cada preparacao tenta o token duas vezes: falha de rede isolada e comum em
  // celular trocando de torre.
  assert.equal(registro.getToken, 2);
  // A promessa falhada nao pode ficar em cache: a proxima acao do usuario
  // precisa poder tentar de novo.
  assert.equal(api.estado().barreiraViva, false);
  assert.equal(api.estado().appCheckAtivado, true);

  await api.chamarFuncao("criarAgendamentoCidadao", {});
  assert.equal(registro.getToken, 4, "a segunda acao deve tentar emitir token de novo");
  assert.equal(registro.activate, 1, "activate nao pode rodar duas vezes");
  // Mesmo sem token a chamada segue: quem decide aceitar ou recusar e o backend,
  // que roda com enforceAppCheck: true. Isto e explicitamente melhor esforco,
  // nao uma garantia de prontidao.
  assert.equal(registro.chamadas.length, 2);
});

test("a preparacao e melhor esforco: falhar nao bloqueia, mas tenta o token duas vezes", async () => {
  // "Barreira" nao significa garantia de prontidao. chamarFuncao aguarda a
  // preparacao mas ignora o resultado de proposito: quem recusa o pedido sem
  // token e o backend, com enforceAppCheck: true.
  const chamar = extrairFuncao(sitePublico, "chamarFuncao");
  assert.equal(/if\s*\(\s*await garantirAppCheckPronto\(\)/.test(chamar), false);
  // O unico throw admitido e o repasse do erro da propria callable, de que
  // quem chamou depende para distinguir vaga tomada de falha tecnica. O que
  // segue proibido e derrubar a chamada por causa da PREPARACAO do App Check:
  // essa decisao e do backend, com enforceAppCheck: true.
  const lancamentos = chamar.match(/throw\s+[^;]+;/g) || [];
  assert.deepEqual(lancamentos, ["throw erro;"], "chamarFuncao so pode repassar o erro da callable.");

  const preparar = extrairFuncao(sitePublico, "prepararAppCheck");
  assert.equal((preparar.match(/getToken\(\)/g) || []).length, 2, "uma segunda tentativa de token.");

  // Falha isolada na primeira emissao (celular trocando de torre) nao derruba
  // a preparacao: a segunda tentativa resolve e a barreira segue viva.
  const { api, registro } = montarBarreira({ falharPrimeiroToken: true });
  await api.chamarFuncao("criarAgendamentoCidadao", {});
  assert.equal(registro.getToken, 2);
  assert.equal(registro.activate, 1);
  assert.equal(api.estado().barreiraViva, true, "preparacao bem-sucedida fica em cache");
  assert.equal(registro.chamadas.length, 1);
});

test("chave nao configurada avisa mas nao trava o agendamento", async () => {
  const { api, registro } = montarBarreira({ chave: "COLE_AQUI_A_CHAVE" });
  await api.chamarFuncao("criarAgendamentoCidadao", {});

  assert.equal(registro.activate, 0);
  assert.equal(registro.chamadas.length, 1);
  assert.ok(registro.avisos.some((aviso) => /App Check/.test(aviso)));
});

// ---------------------------------------------------------------------------
// Garantia estrutural: nenhuma chamada escapa da barreira
// ---------------------------------------------------------------------------

test("httpsCallable so aparece dentro de chamarFuncao", () => {
  const chamar = extrairFuncao(sitePublico, "chamarFuncao");
  assert.match(chamar, /await garantirAppCheckPronto\(\)/);
  assert.match(chamar, /functions\.httpsCallable\(nome\)\(dados\)/);
  // A barreira precisa vir antes da chamada dentro da propria funcao.
  assert.ok(
    chamar.indexOf("garantirAppCheckPronto") < chamar.indexOf("httpsCallable"),
    "garantirAppCheckPronto deve ser aguardado antes de httpsCallable."
  );

  // Fora de chamarFuncao nao pode haver nenhuma invocacao: e isso que impede um
  // call site futuro de esquecer a barreira. Dentro dela o numero de chamadas
  // e livre -- a recuperacao de recusa de App Check repete a callable uma vez
  // depois de forcar token novo, e contar linhas globalmente reprovava isso
  // sem que nada da barreira tivesse afrouxado.
  const fora = sitePublico.replace(chamar, "");
  const ocorrenciasFora = fora.split("\n").filter((linha) => /httpsCallable\(/.test(linha));
  assert.equal(ocorrenciasFora.length, 0, `httpsCallable fora de chamarFuncao: ${ocorrenciasFora.join(" | ")}`);
});

test("App Check nao e ativado no carregamento da pagina", () => {
  const ativacoes = sitePublico.split("\n").filter((linha) => /appCheck\(\)\.activate\(/.test(linha));
  assert.equal(ativacoes.length, 1, "activate() deve existir em um unico ponto.");

  const preparar = extrairFuncao(sitePublico, "prepararAppCheck");
  assert.match(preparar, /appCheck\(\)\.activate\(APP_CHECK_RECAPTCHA_SITE_KEY, true\)/);
  // Guarda de ativacao unica.
  assert.match(preparar, /if \(!appCheckAtivado\)/);
  assert.match(preparar, /appCheckAtivado = true/);

  // prepararAppCheck so pode ser alcancada pela barreira (ignorando a linha
  // da propria declaracao).
  const chamadasDiretas = sitePublico
    .split("\n")
    .filter((linha) => /prepararAppCheck\(\)/.test(linha) && !/function prepararAppCheck\(/.test(linha));
  assert.equal(chamadasDiretas.length, 1, `prepararAppCheck deveria ser chamada so pela barreira: ${chamadasDiretas.join(" | ")}`);
  assert.match(extrairFuncao(sitePublico, "garantirAppCheckPronto"), /prepararAppCheck\(\)/);
});

test("o aquecimento roda depois da primeira pintura e sem bloquear", () => {
  const ocioso = extrairFuncao(sitePublico, "agendarQuandoOcioso");
  assert.match(ocioso, /requestIdleCallback/);
  // requestIdleCallback nao existe no Safari antigo; precisa de plano B.
  assert.match(ocioso, /setTimeout\(tarefa, atrasoMs\)/);

  const aquecer = extrairFuncao(sitePublico, "aquecerAppCheckEmSegundoPlano");
  assert.match(aquecer, /agendarQuandoOcioso\(/);
  assert.equal(aquecer.includes("await"), false, "o aquecimento nao pode bloquear o init.");

  // A reconciliacao de slots tambem chama callable: se rodasse durante o
  // carregamento, ativaria o reCAPTCHA no caminho critico e desfaria o ganho.
  const carregar = extrairFuncao(sitePublico, "carregarConfig");
  assert.match(carregar, /agendarQuandoOcioso\(\(\) => \{\s*revalidarSlotsOcupadosConfirmados\(cfg\)/);

  // Chamado no fim do init, depois de renderizar a agenda.
  const init = sitePublico.slice(sitePublico.indexOf("async function init()"));
  const corpoInit = init.slice(0, init.indexOf("})();"));
  assert.match(corpoInit, /aquecerAppCheckEmSegundoPlano\(\)/);
  assert.ok(
    corpoInit.indexOf("carregarConfig()") < corpoInit.indexOf("aquecerAppCheckEmSegundoPlano()"),
    "o aquecimento deve vir depois de carregar e desenhar a agenda."
  );
});

test("renovacao forcada de token tambem passa pela barreira", () => {
  const refresh = extrairFuncao(sitePublico, "tentarRefreshAppCheck");
  assert.match(refresh, /await garantirAppCheckPronto\(\)/);
  assert.ok(
    refresh.indexOf("garantirAppCheckPronto") < refresh.indexOf("getToken"),
    "sem ativacao previa nao existe token para renovar."
  );
});

// ---------------------------------------------------------------------------
// As duas pontas concordam sobre quem exige App Check
// ---------------------------------------------------------------------------

test("toda callable chamada pelo site exige App Check no backend", () => {
  const chamadasDoSite = [...sitePublico.matchAll(/chamarFuncao\("([\w]+)"/g)].map((m) => m[1]);
  assert.ok(chamadasDoSite.length >= 6, "esperado ao menos as seis callables publicas.");

  // Opcoes que herdam publicCallableOptions e, com ele, enforceAppCheck: true.
  const opcoesComAppCheck = ["publicCallableOptions", "agendamentoPicoOptions", "verificacaoSlotOptions"];
  assert.match(backend, /const publicCallableOptions = \{[\s\S]*?enforceAppCheck: true/);
  for (const opcao of opcoesComAppCheck.slice(1)) {
    assert.match(
      backend,
      new RegExp(`const ${opcao} = \\{\\s*\\.\\.\\.publicCallableOptions`),
      `${opcao} deveria herdar publicCallableOptions.`
    );
  }

  for (const nome of new Set(chamadasDoSite)) {
    const declaracao = new RegExp(`exports\\.${nome} = onCall\\((\\w+)`);
    const match = backend.match(declaracao);
    assert.ok(match, `Callable ${nome} nao encontrada no backend.`);
    assert.ok(
      opcoesComAppCheck.includes(match[1]),
      `Callable ${nome} usa ${match[1]}, que nao exige App Check.`
    );
  }
});

test("a agenda inicial continua sem depender de App Check", () => {
  // E o que torna o adiamento seguro: a primeira tela nao chama callable.
  assert.match(backend, /exports\.carregarAgendaPublicaHttp = onRequest\(\{/);
  const handler = backend.slice(backend.indexOf("exports.carregarAgendaPublicaHttp"));
  const corpo = handler.slice(0, handler.indexOf("exports.", 1));
  assert.equal(corpo.includes("enforceAppCheck"), false);

  const buscar = extrairFuncao(sitePublico, "buscarAgendaPublicaAtualizada");
  assert.match(buscar, /fetch\(`\/api\/agenda-publica/);
  assert.equal(buscar.includes("chamarFuncao"), false);
});
