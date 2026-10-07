"use strict";

// Contador de visitas: functions/visitas.js (servidor) e public/visita.js
// (navegador). Ver o cabecalho de visitas.js para o desenho.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  COLECAO_FRAGMENTOS,
  FRAGMENTOS,
  MAX_DIAS_RECALCULO,
  PAGINAS,
  RETENCAO_DIAS,
  classificarVisita,
  consolidarResumo,
  criarContadorVisitas,
  criarLimitador,
  diasParaRecalcular,
  ehRobo,
  idPagina,
  incrementoDaVisita,
  normalizarCaminho,
  somarFragmentos,
  visaoDoResumo
} = require("./visitas");

const raiz = path.resolve(__dirname, "..");
const publico = path.join(raiz, "public");
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), "utf8");
const UA_CELULAR = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36";

// ---------------------------------------------------------------------------
// Caminhos e classificacao
// ---------------------------------------------------------------------------

test("caminhos equivalentes viram o mesmo caminho", () => {
  assert.equal(normalizarCaminho("/"), "/");
  assert.equal(normalizarCaminho("/index.html"), "/");
  assert.equal(normalizarCaminho("/blog/rg-antigo-ainda-vale"), "/blog/rg-antigo-ainda-vale/");
  assert.equal(normalizarCaminho("/blog/rg-antigo-ainda-vale/index.html"), "/blog/rg-antigo-ainda-vale/");
  assert.equal(normalizarCaminho("/BLOG/?utm=x#topo"), "/blog/");
  assert.equal(normalizarCaminho("/duvidas.html"), "/duvidas.html");
});

test("caminho fora do formato e recusado", () => {
  for (const ruim of [null, 42, "", "blog/", "https://x.com/", "/../etc", "/a//b", "/<script>", "/" + "a".repeat(250)]) {
    assert.equal(normalizarCaminho(ruim), null, String(ruim));
  }
});

test("classifica secao, pagina e marcas de visita", () => {
  assert.deepEqual(classificarVisita('{"p":"/","n":1,"s":1}'), {
    caminho: "/", secao: "agendamento", pagina: "inicio", novoVisitante: true, novaSecao: true
  });
  assert.deepEqual(classificarVisita({ p: "/blog/orgao-emissor-do-rg/", n: 0, s: 1 }), {
    caminho: "/blog/orgao-emissor-do-rg/", secao: "blog", pagina: "blog__orgao_emissor_do_rg", novoVisitante: false, novaSecao: true
  });
  // Primeira visita do dia implica primeira visita a secao.
  assert.equal(classificarVisita({ p: "/cin/", n: 1, s: 0 }).novaSecao, true);
  // Post novo ainda fora da lista conta na secao, sem ranking.
  assert.deepEqual(classificarVisita({ p: "/blog/post-novo/", n: 0, s: 0 }), {
    caminho: "/blog/post-novo/", secao: "blog", pagina: null, novoVisitante: false, novaSecao: false
  });
  assert.equal(classificarVisita({ p: "/qualquer/" }).secao, "outros");
});

test("corpo invalido ou grande demais e recusado", () => {
  assert.equal(classificarVisita("nao e json"), null);
  assert.equal(classificarVisita("[1,2]"), null);
  assert.equal(classificarVisita(JSON.stringify({ p: "/", x: "a".repeat(2000) })), null);
  assert.equal(classificarVisita(Buffer.from('{"p":"/"}')).caminho, "/");
  assert.equal(classificarVisita(undefined), null);
});

test("ids de pagina sao nomes de campo simples", () => {
  for (const caminho of Object.keys(PAGINAS)) {
    assert.match(idPagina(caminho), /^[a-z][a-z0-9_]*$/, caminho);
  }
  const ids = Object.keys(PAGINAS).map(idPagina);
  assert.equal(new Set(ids).size, ids.length, "dois caminhos com o mesmo id");
});

test("robos e chamadas sem navegador nao contam", () => {
  assert.equal(ehRobo(UA_CELULAR), false);
  for (const ua of ["", "Googlebot/2.1", "Mozilla/5.0 (compatible; bingbot/2.0)", "HeadlessChrome/120", "Chrome-Lighthouse", "facebookexternalhit/1.1"]) {
    assert.equal(ehRobo(ua), true, ua);
  }
});

// ---------------------------------------------------------------------------
// Trava: toda pagina publica entra no ranking
// ---------------------------------------------------------------------------

function paginasGeradas() {
  const caminhos = ["/", "/duvidas.html"];
  for (const secao of ["blog", "cin", "sobre", "privacidade", "avisos"]) {
    const dir = path.join(publico, secao);
    if (!fs.existsSync(dir)) continue;
    if (fs.existsSync(path.join(dir, "index.html"))) caminhos.push(`/${secao}/`);
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory() && fs.existsSync(path.join(dir, item.name, "index.html"))) caminhos.push(`/${secao}/${item.name}/`);
    }
  }
  return caminhos.sort();
}

test("toda pagina publica esta na lista do contador (e nada a mais)", () => {
  // Post novo publicado? Acrescente o caminho e um titulo curto em PAGINAS
  // (functions/visitas.js) e publique as functions junto com o hosting.
  assert.deepEqual(Object.keys(PAGINAS).sort(), paginasGeradas());
});

test("toda pagina publica carrega o contador uma vez, e o painel e a 404 nao", () => {
  for (const caminho of paginasGeradas()) {
    const arquivo = caminho.endsWith("/") ? path.join(publico, caminho, "index.html") : path.join(publico, caminho);
    const html = fs.readFileSync(arquivo, "utf8");
    assert.equal((html.match(/<script src="\/visita\.js" defer><\/script>/g) || []).length, 1, caminho);
  }
  assert.doesNotMatch(ler("public", "recepcao.html"), /visita\.js/);
  assert.doesNotMatch(ler("public", "404.html"), /visita\.js/);
});

// ---------------------------------------------------------------------------
// Fragmentos e consolidacao
// ---------------------------------------------------------------------------

const inc = (n) => ({ inc: n });

test("cada visita vira um unico incremento, so nos campos que mudam", () => {
  const visita = classificarVisita({ p: "/blog/rg-antigo-ainda-vale/", n: 1, s: 1 });
  assert.deepEqual(incrementoDaVisita(visita, "2026-10-07", inc), {
    dia: "2026-10-07",
    paginas: { total: inc(1), blog: inc(1) },
    visitantes: { blog: inc(1), total: inc(1) },
    porPagina: { blog__rg_antigo_ainda_vale: inc(1) }
  });
  const repetida = classificarVisita({ p: "/blog/post-novo/", n: 0, s: 0 });
  assert.deepEqual(incrementoDaVisita(repetida, "2026-10-07", inc), {
    dia: "2026-10-07",
    paginas: { total: inc(1), blog: inc(1) }
  });
});

function totaisDia(paginas, visitantes, porPagina = {}) {
  return {
    paginas: { total: paginas, agendamento: paginas, blog: 0, guia: 0, outros: 0 },
    visitantes: { total: visitantes, agendamento: visitantes, blog: 0, guia: 0, outros: 0 },
    porPagina
  };
}

test("fragmentos somados ignoram lixo e paginas fora da lista", () => {
  const soma = somarFragmentos([
    { paginas: { total: 3, blog: 3 }, visitantes: { total: 1, blog: 1 }, porPagina: { blog: 2, inventada: 99 } },
    { paginas: { total: 2, guia: "2" }, visitantes: { guia: -5 }, porPagina: { blog: 1 } },
    {}
  ]);
  assert.equal(soma.paginas.total, 5);
  assert.equal(soma.paginas.guia, 2);
  assert.equal(soma.visitantes.guia, 0);
  assert.deepEqual(soma.porPagina, { blog: 3 });
});

test("consolidar de novo o mesmo dia nao conta duas vezes", () => {
  const hoje = "2026-10-07";
  const primeiro = consolidarResumo(null, { [hoje]: totaisDia(10, 4) }, hoje);
  const segundo = consolidarResumo(primeiro, { [hoje]: totaisDia(12, 5) }, hoje);
  const terceiro = consolidarResumo(segundo, { [hoje]: totaisDia(12, 5) }, hoje);
  assert.deepEqual(terceiro, segundo);
  assert.equal(visaoDoResumo(terceiro, hoje).total.paginas.total, 12);
});

test("dias que saem da retencao vao para o acumulado sem sumir do total", () => {
  const hoje = "2026-10-07";
  const antigo = "2026-07-01";
  const resumo = consolidarResumo(null, { [antigo]: totaisDia(100, 40, { blog: 7 }), [hoje]: totaisDia(1, 1) }, "2026-07-01");
  assert.ok(resumo.dias[antigo]);
  const depois = consolidarResumo(resumo, { [hoje]: totaisDia(1, 1) }, hoje);
  assert.equal(depois.dias[antigo], undefined);
  assert.equal(depois.acumulado.paginas.total, 100);
  assert.equal(depois.inicio, antigo);
  const visao = visaoDoResumo(depois, hoje);
  assert.equal(visao.total.paginas.total, 101);
  assert.equal(visao.total.visitantes.total, 41);
  assert.equal(visao.ultimos30.paginas.total, 1);
  // Consolidar outra vez nao soma o acumulado de novo.
  assert.equal(consolidarResumo(depois, {}, hoje).acumulado.paginas.total, 100);
  assert.ok(RETENCAO_DIAS >= 31);
});

test("janelas de hoje, 7 e 30 dias e serie diaria", () => {
  const hoje = "2026-10-07";
  const recalculados = {
    "2026-10-07": totaisDia(5, 2, { inicio: 5 }),
    "2026-10-01": totaisDia(10, 3, { blog__rg_antigo_ainda_vale: 10 }), // dentro dos 7 dias
    "2026-09-30": totaisDia(20, 6, { blog__rg_antigo_ainda_vale: 1 }),  // fora dos 7, dentro dos 30
    "2026-09-07": totaisDia(40, 9)                                       // fora dos 30
  };
  const visao = visaoDoResumo(consolidarResumo(null, recalculados, hoje), hoje);
  assert.equal(visao.hoje.paginas.total, 5);
  assert.equal(visao.ultimos7.paginas.total, 15);
  assert.equal(visao.ultimos7.visitantes.total, 5);
  assert.equal(visao.ultimos30.paginas.total, 35);
  assert.equal(visao.total.paginas.total, 75);
  assert.equal(visao.serie30.length, 30);
  assert.deepEqual(visao.serie30[0], { dia: "2026-09-08", paginas: 0, visitantes: 0 });
  assert.deepEqual(visao.serie30[29], { dia: hoje, paginas: 5, visitantes: 2 });
  assert.deepEqual(visao.maisLidas7.map((p) => [p.caminho, p.paginas]), [["/blog/rg-antigo-ainda-vale/", 10], ["/", 5]]);
  assert.equal(visao.maisLidas30[0].paginas, 11);
  assert.equal(visao.maisLidas30[0].titulo, PAGINAS["/blog/rg-antigo-ainda-vale/"].titulo);
  assert.equal(visao.inicio, "2026-09-07");
});

test("hoje sem visita aparece zerado, mesmo com resumo de ontem", () => {
  const resumo = consolidarResumo(null, { "2026-10-06": totaisDia(8, 3) }, "2026-10-06");
  const visao = visaoDoResumo(resumo, "2026-10-07");
  assert.equal(visao.hoje.paginas.total, 0);
  assert.equal(visao.ultimos7.paginas.total, 8);
});

test("dias relidos: ontem e hoje, ou o buraco desde a ultima consolidacao", () => {
  assert.deepEqual(diasParaRecalcular("2026-10-07", "2026-10-07"), { dias: ["2026-10-06", "2026-10-07"], ateDia: "2026-10-07" });
  assert.deepEqual(diasParaRecalcular("2026-10-04", "2026-10-07"), {
    dias: ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"], ateDia: "2026-10-07"
  });
  const primeira = diasParaRecalcular(null, "2026-10-07");
  assert.equal(primeira.dias.length, MAX_DIAS_RECALCULO);
  assert.equal(primeira.ateDia, "2026-10-07");
  assert.deepEqual(diasParaRecalcular("2030-01-01", "2026-10-07").dias.slice(-1), ["2026-10-07"]);
});

test("buraco maior que uma rodada e lido aos poucos, sem pular dia", () => {
  // Achado da revisao do PR #6: antes, a leitura pulava para os ultimos 45
  // dias e a marca ia para hoje, perdendo o meio para sempre.
  const { dias, ateDia } = diasParaRecalcular("2026-06-01", "2026-10-07");
  assert.equal(dias[0], "2026-05-31");
  assert.equal(ateDia, "2026-07-14");
  assert.equal(dias.length, MAX_DIAS_RECALCULO + 1, "45 seguidos e mais hoje");
  assert.equal(dias[dias.length - 1], "2026-10-07");

  // Rodadas sucessivas fecham o buraco e cada dia conta uma vez so.
  const fragmentos = {};
  for (let d = "2026-05-31"; d <= "2026-10-07"; d = new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10)) {
    fragmentos[d] = totaisDia(1, 1);
  }
  let resumo = consolidarResumo(null, { "2026-05-31": totaisDia(1, 1), "2026-06-01": totaisDia(1, 1) }, "2026-06-01", "2026-06-01");
  for (let rodada = 0; rodada < 5; rodada++) {
    const plano = diasParaRecalcular(resumo.ultimoDiaConsolidado, "2026-10-07");
    const lidos = Object.fromEntries(plano.dias.map((d) => [d, fragmentos[d]]));
    resumo = consolidarResumo(resumo, lidos, "2026-10-07", plano.ateDia);
  }
  assert.equal(resumo.ultimoDiaConsolidado, "2026-10-07");
  assert.equal(visaoDoResumo(resumo, "2026-10-07").total.paginas.total, Object.keys(fragmentos).length);
});

test("consolidacao com leitura mais velha nao desfaz uma mais nova", () => {
  // Achado da revisao do PR #6: duas abas abertas ao mesmo tempo, ou o painel
  // junto da manutencao. A rodada lenta chega depois com numeros menores.
  const hoje = "2026-10-07";
  const nova = consolidarResumo(null, { [hoje]: totaisDia(30, 9, { inicio: 30 }) }, hoje, hoje);
  const depoisDaLenta = consolidarResumo(nova, { [hoje]: totaisDia(25, 7, { inicio: 25 }) }, hoje, "2026-10-06");
  const visao = visaoDoResumo(depoisDaLenta, hoje);
  assert.equal(visao.hoje.paginas.total, 30);
  assert.equal(visao.hoje.visitantes.total, 9);
  assert.equal(visao.maisLidas7[0].paginas, 30);
  assert.equal(depoisDaLenta.ultimoDiaConsolidado, hoje, "a marca nao volta");
});

test("dia ja levado ao acumulado nao entra de novo", () => {
  const resumo = { dias: {}, acumulado: totaisDia(100, 40), inicio: "2026-07-01", ultimoDiaConsolidado: "2026-07-20" };
  const depois = consolidarResumo(resumo, { "2026-07-19": totaisDia(5, 2), "2026-07-20": totaisDia(5, 2) }, "2026-10-07", "2026-10-07");
  assert.equal(depois.acumulado.paginas.total, 100);
  // Ja um dia antigo nunca consolidado (depois da marca) entra no acumulado.
  const comNovo = consolidarResumo(resumo, { "2026-07-21": totaisDia(5, 2) }, "2026-10-07", "2026-10-07");
  assert.equal(comNovo.acumulado.paginas.total, 105);
});

// ---------------------------------------------------------------------------
// Endpoint /api/visita com Firestore falso
// ---------------------------------------------------------------------------

function firestoreFalso() {
  const docs = new Map();
  const gravacoes = [];
  const ref = (colecao, id) => ({
    colecao, id,
    async get() { return snap(colecao, id); },
    async set(dados, opcoes) { gravacoes.push({ colecao, id, dados, opcoes }); docs.set(`${colecao}/${id}`, dados); }
  });
  const snap = (colecao, id) => {
    const dados = docs.get(`${colecao}/${id}`);
    return { exists: dados !== undefined, data: () => dados };
  };
  return {
    docs, gravacoes,
    collection: (colecao) => ({ doc: (id) => ref(colecao, id) }),
    async getAll(...refs) { return refs.map((r) => snap(r.colecao, r.id)); },
    async runTransaction(fn) {
      return fn({
        get: (r) => r.get(),
        set: (r, dados) => { gravacoes.push({ colecao: r.colecao, id: r.id, dados }); docs.set(`${r.colecao}/${r.id}`, dados); }
      });
    }
  };
}

function respostaFalsa() {
  return {
    statusCode: null, cabecalhos: {}, terminou: false,
    set(chave, valor) { this.cabecalhos[chave] = valor; return this; },
    status(codigo) { this.statusCode = codigo; return this; },
    end() { this.terminou = true; return this; }
  };
}

function pedido({ method = "POST", headers = {}, body = '{"p":"/blog/","n":1,"s":1}' } = {}) {
  return {
    method,
    headers: { origin: "https://cin.itanhandu.cam.mg.gov.br", "user-agent": UA_CELULAR, ...headers },
    body
  };
}

function contador(db, extra = {}) {
  return criarContadorVisitas({
    db,
    FieldValue: { increment: inc },
    hoje: () => "2026-10-07",
    origensPermitidas: ["https://cin.itanhandu.cam.mg.gov.br"],
    aleatorio: () => 0.35,
    ...extra
  });
}

test("visita valida grava um incremento num fragmento do dia", async () => {
  const db = firestoreFalso();
  const res = respostaFalsa();
  await contador(db).registrar(pedido(), res, { chaveCliente: "a" });
  assert.equal(res.statusCode, 204);
  assert.equal(res.cabecalhos["Cache-Control"], "no-store");
  assert.equal(db.gravacoes.length, 1);
  const [gravacao] = db.gravacoes;
  assert.equal(gravacao.colecao, COLECAO_FRAGMENTOS);
  assert.equal(gravacao.id, "2026-10-07_3");
  assert.deepEqual(gravacao.opcoes, { merge: true });
  assert.deepEqual(gravacao.dados.paginas, { total: inc(1), blog: inc(1) });
  // Nada que identifique a pessoa vai para o banco.
  assert.doesNotMatch(JSON.stringify(gravacao), /Mozilla|Android|"a"|ip/i);
});

test("pedidos recusados nao gravam", async () => {
  const casos = [
    [pedido({ method: "GET" }), 405],
    [pedido({ headers: { origin: "https://site-qualquer.com" } }), 403],
    [pedido({ body: "lixo" }), 400],
    [pedido({ headers: { "user-agent": "Googlebot/2.1" } }), 204]
  ];
  for (const [req, esperado] of casos) {
    const db = firestoreFalso();
    const res = respostaFalsa();
    await contador(db).registrar(req, res, { chaveCliente: "a" });
    assert.equal(res.statusCode, esperado);
    assert.equal(db.gravacoes.length, 0);
  }
});

test("sem cabecalho Origin (sendBeacon em navegador antigo) ainda conta", async () => {
  const db = firestoreFalso();
  const req = pedido();
  delete req.headers.origin;
  await contador(db).registrar(req, respostaFalsa(), { chaveCliente: "a" });
  assert.equal(db.gravacoes.length, 1);
});

test("chave desligada responde 204 sem tocar no banco", async () => {
  const db = firestoreFalso();
  const res = respostaFalsa();
  await contador(db).registrar(pedido(), res, { ativo: false, chaveCliente: "a" });
  assert.equal(res.statusCode, 204);
  assert.equal(db.gravacoes.length, 0);
});

test("falha do Firestore nunca vira erro para o navegador", async () => {
  const db = firestoreFalso();
  db.collection = () => ({ doc: () => ({ set: async () => { throw new Error("indisponivel"); } }) });
  const res = respostaFalsa();
  const aviso = console.warn;
  console.warn = () => {};
  try {
    await contador(db).registrar(pedido(), res, { chaveCliente: "a" });
  } finally {
    console.warn = aviso;
  }
  assert.equal(res.statusCode, 204);
});

test("limite por cliente corta laco sem afetar os outros", () => {
  const permitido = criarLimitador({ limite: 3, janelaMs: 1000 });
  assert.deepEqual([1, 2, 3, 4].map(() => permitido("a", 0)), [true, true, true, false]);
  assert.equal(permitido("b", 0), true);
  assert.equal(permitido("a", 1000), true, "janela nova libera de novo");
});

test("consolidar le os fragmentos dos dias e devolve a visao do painel", async () => {
  const db = firestoreFalso();
  db.docs.set(`${COLECAO_FRAGMENTOS}/2026-10-07_0`, { paginas: { total: 2, blog: 2 }, visitantes: { total: 1, blog: 1 }, porPagina: { blog: 2 } });
  db.docs.set(`${COLECAO_FRAGMENTOS}/2026-10-07_9`, { paginas: { total: 1, agendamento: 1 }, visitantes: { total: 1, agendamento: 1 }, porPagina: { inicio: 1 } });
  db.docs.set(`${COLECAO_FRAGMENTOS}/2026-10-06_4`, { paginas: { total: 5, guia: 5 }, visitantes: { total: 2, guia: 2 } });
  const visao = await contador(db).consolidar();
  assert.equal(visao.hoje.paginas.total, 3);
  assert.equal(visao.hoje.visitantes.blog, 1);
  assert.equal(visao.ultimos7.paginas.total, 8);
  assert.equal(visao.total.paginas.guia, 5);
  const salvo = db.docs.get("metricas_visitas/resumo");
  assert.equal(salvo.ultimoDiaConsolidado, "2026-10-07");
  assert.ok(salvo.atualizadoEm);

  // Segunda consolidacao no mesmo dia: mesmos numeros.
  const denovo = await contador(db).consolidar();
  assert.deepEqual(denovo.total, visao.total);
  assert.ok(FRAGMENTOS >= 5);
});

// ---------------------------------------------------------------------------
// Ligacao com o Hosting, regras e backend
// ---------------------------------------------------------------------------

test("/api/visita aponta para a funcao, na regiao do Firestore", () => {
  const hosting = JSON.parse(ler("firebase.json")).hosting;
  const rewrite = hosting.rewrites.find((r) => r.source === "/api/visita");
  assert.ok(rewrite);
  assert.deepEqual(rewrite.function, { functionId: "registrarVisita", region: "southamerica-east1" });
  const backend = ler("functions", "index.js");
  assert.match(backend, /exports\.registrarVisita = onRequest\(\{\s*region: REGIAO_PICO,/);
  // O cache do script nao pode prender uma versao velha por 30 dias.
  const cache = hosting.headers.find((h) => h.source === "/visita.js");
  assert.match(cache.headers.find((h) => h.key === "Cache-Control").value, /max-age=0/);
});

test("estatisticas so saem para admin, e o banco nao abre para o navegador", () => {
  const backend = ler("functions", "index.js");
  const callable = backend.slice(backend.indexOf("exports.consultarEstatisticasVisitas"));
  assert.match(callable.slice(0, 200), /await assertAdmin\(request\)/);
  const regras = ler("firestore.rules");
  for (const colecao of ["metricas_visitas", "metricas_visitas_fragmentos"]) {
    assert.match(regras, new RegExp(`match /${colecao}/\\{documentId\\} \\{\\s*allow read, write: if false;`));
  }
});

test("a manutencao diaria fecha o dia sem derrubar as outras limpezas", () => {
  const backend = ler("functions", "index.js");
  const manutencao = backend.slice(backend.indexOf("exports.executarManutencaoDiaria"));
  assert.match(manutencao, /await contadorVisitas\.consolidar\(\)\.catch\(/);
});

// ---------------------------------------------------------------------------
// public/visita.js num navegador simulado
// ---------------------------------------------------------------------------

function navegador({ caminho = "/", local = new Map(), webdriver = false, ua = UA_CELULAR, visivel = "visible", semStorage = false } = {}) {
  const enviados = [];
  const ouvintes = {};
  const temporizadores = [];
  const localStorage = semStorage ? undefined : {
    getItem: (k) => (local.has(k) ? local.get(k) : null),
    setItem: (k, v) => local.set(k, String(v)),
    removeItem: (k) => local.delete(k)
  };
  const janela = {
    location: { pathname: caminho },
    addEventListener: (ev, fn) => { ouvintes[ev] = fn; },
    get localStorage() { if (semStorage) throw new Error("bloqueado"); return localStorage; }
  };
  const documento = {
    readyState: "complete",
    visibilityState: visivel,
    addEventListener: (ev, fn) => { ouvintes["doc:" + ev] = fn; },
    removeEventListener: () => {}
  };
  const contexto = {
    window: janela,
    document: documento,
    navigator: { webdriver, userAgent: ua, sendBeacon: (url, corpo) => { enviados.push({ url, corpo: JSON.parse(corpo) }); return true; } },
    setTimeout: (fn) => temporizadores.push(fn),
    Intl, Date, JSON, Object
  };
  vm.runInNewContext(ler("public", "visita.js"), contexto);
  return {
    enviados, local, documento, ouvintes,
    rodarTemporizadores() { temporizadores.splice(0).forEach((fn) => fn()); }
  };
}

test("navegador: primeira pagina do dia marca visitante e secao", () => {
  const nav = navegador({ caminho: "/blog/rg-antigo-ainda-vale/" });
  assert.equal(nav.enviados.length, 0, "espera a pagina assentar");
  nav.rodarTemporizadores();
  assert.deepEqual(nav.enviados, [{ url: "/api/visita", corpo: { p: "/blog/rg-antigo-ainda-vale/", n: 1, s: 1 } }]);
  const marca = JSON.parse(nav.local.get("cin_visita"));
  assert.deepEqual(marca.s, ["blog"]);
  assert.match(marca.d, /^\d{4}-\d{2}-\d{2}$/);
});

test("navegador: mesma secao no mesmo dia conta so pagina; secao nova conta secao", () => {
  const local = new Map();
  navegador({ caminho: "/blog/", local }).rodarTemporizadores();
  const segunda = navegador({ caminho: "/blog/orgao-emissor-do-rg/", local });
  segunda.rodarTemporizadores();
  assert.deepEqual(segunda.enviados[0].corpo, { p: "/blog/orgao-emissor-do-rg/", n: 0, s: 0 });
  const terceira = navegador({ caminho: "/", local });
  terceira.rodarTemporizadores();
  assert.deepEqual(terceira.enviados[0].corpo, { p: "/", n: 0, s: 1 });
  assert.deepEqual(JSON.parse(local.get("cin_visita")).s, ["blog", "agendamento"]);
});

test("navegador: marca de outro dia conta como visitante novo", () => {
  const local = new Map([["cin_visita", JSON.stringify({ d: "2000-01-01", s: ["blog"] })]]);
  const nav = navegador({ caminho: "/blog/", local });
  nav.rodarTemporizadores();
  assert.deepEqual(nav.enviados[0].corpo, { p: "/blog/", n: 1, s: 1 });
});

test("navegador: painel no mesmo aparelho, automacao e robo nao contam", () => {
  for (const opcoes of [
    { local: new Map([["cin_nao_contar_visita", "1"]]) },
    { webdriver: true },
    { ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" }
  ]) {
    const nav = navegador(opcoes);
    nav.rodarTemporizadores();
    assert.equal(nav.enviados.length, 0, JSON.stringify(opcoes));
  }
});

test("navegador: aba em segundo plano so conta quando fica visivel", () => {
  const nav = navegador({ visivel: "hidden" });
  nav.rodarTemporizadores();
  assert.equal(nav.enviados.length, 0);
  nav.documento.visibilityState = "visible";
  nav.ouvintes["doc:visibilitychange"]();
  nav.rodarTemporizadores();
  assert.equal(nav.enviados.length, 1);
});

test("navegador: sem localStorage conta a pagina, nunca o visitante", () => {
  const nav = navegador({ semStorage: true });
  nav.rodarTemporizadores();
  assert.deepEqual(nav.enviados[0].corpo, { p: "/", n: 0, s: 0 });
});

test("navegador: o painel marca o aparelho para nao contar", () => {
  assert.match(ler("public", "recepcao.js"), /localStorage\.setItem\("cin_nao_contar_visita", "1"\)/);
});
