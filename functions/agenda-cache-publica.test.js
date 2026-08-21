"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MINUTOS_CACHE_CURTO_ANTES,
  MINUTOS_CACHE_CURTO_DEPOIS,
  MINUTOS_CACHE_CURTO_AGUARDANDO_PUBLICACAO,
  SEGUNDOS_CACHE_CURTO,
  CACHE_CURTO,
  CACHE_SEM_ARMAZENAMENTO,
  emJanelaDeVirada,
  cacheControlAgendaPublica,
  minutosAtePublicacao,
  proximaPublicacao,
  aberturasProgramadas,
  aberturasProgramadasPendentes,
  publicacaoAtravessada,
  janelaAberturaSemanal,
  vidaMaximaCacheSegundos
} = require("./agenda-cache-publica");

const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

// 24/08/2026 e uma segunda-feira; 26/08/2026, uma quarta.
const SEGUNDA = "2026-08-24";
const QUARTA = "2026-08-26";
const ABERTURA = `${SEGUNDA}T08:00`;

const PUBLICACAO_SEMANAL = {
  "2026-08-25": ABERTURA,
  "2026-08-26": ABERTURA,
  "2026-08-27": ABERTURA,
  "2026-08-28": ABERTURA
};

// Automacao desligada: isola os casos que dependem so de publicacaoDatas.
const SEM_AUTOMACAO = { ativa: false };

function instanteEm(dataISO, hora, minuto) {
  return `${dataISO}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

function somarMinutos(instante, minutos) {
  const [data, relogio] = instante.split("T");
  const [ano, mes, dia] = data.split("-").map(Number);
  const [hora, minuto] = relogio.split(":").map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto + minutos));
  return instanteEm(
    `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, "0")}-${String(alvo.getUTCDate()).padStart(2, "0")}`,
    alvo.getUTCHours(),
    alvo.getUTCMinutes()
  );
}

function diretiva(cacheControl, nome) {
  const match = new RegExp(`(?:^|[,\\s])${nome}=(\\d+)`).exec(cacheControl);
  return match ? Number(match[1]) : null;
}

// Na maior parte dos casos corpo e emissao caem no mesmo minuto.
const politica = (agora, datas, automacao = SEM_AUTOMACAO) =>
  cacheControlAgendaPublica(agora, agora, datas, automacao);

// ---------------------------------------------------------------------------
// Camadas de cache somam
// ---------------------------------------------------------------------------

test("o navegador nunca guarda copia propria: max-age e sempre zero", () => {
  // As camadas encadeiam: o CDN segura por s-maxage (+ stale-while-revalidate)
  // e so entao entrega ao navegador, que ainda guardaria por max-age.
  for (const agora of [`${QUARTA}T10:00`, `${SEGUNDA}T09:00`, `${SEGUNDA}T07:30`]) {
    const cabecalho = politica(agora, PUBLICACAO_SEMANAL);
    if (cabecalho === CACHE_SEM_ARMAZENAMENTO) continue;
    assert.equal(diretiva(cabecalho, "max-age"), 0, `${agora} deveria zerar o cache privado: ${cabecalho}`);
  }
});

test("vida maxima soma as camadas em vez de pegar a maior", () => {
  assert.equal(vidaMaximaCacheSegundos("public, max-age=120, s-maxage=300, stale-while-revalidate=600"), 1020);
  assert.equal(vidaMaximaCacheSegundos("public, max-age=0, s-maxage=300, stale-while-revalidate=600"), 900);
  assert.equal(vidaMaximaCacheSegundos("public, max-age=0, s-maxage=60"), 60);
  assert.equal(vidaMaximaCacheSegundos("no-store"), 0);
});

// ---------------------------------------------------------------------------
// Pre-semeadura da chave do minuto
// ---------------------------------------------------------------------------

test("nos minutos ao redor da abertura o prazo cai para segundos", () => {
  for (let faltam = 1; faltam <= MINUTOS_CACHE_CURTO_ANTES; faltam++) {
    const agora = somarMinutos(ABERTURA, -faltam);
    assert.equal(politica(agora, PUBLICACAO_SEMANAL), CACHE_CURTO, `${agora} deveria usar cache curto`);
  }
  for (let passaram = 0; passaram <= MINUTOS_CACHE_CURTO_DEPOIS; passaram++) {
    const agora = somarMinutos(ABERTURA, passaram);
    assert.equal(politica(agora, PUBLICACAO_SEMANAL), CACHE_CURTO, `${agora} deveria usar cache curto`);
  }
});

test("o cache curto nao guarda copia no navegador nem usa stale-while-revalidate", () => {
  const cabecalho = politica(`${SEGUNDA}T07:59`, PUBLICACAO_SEMANAL);
  assert.equal(cabecalho, "public, max-age=0, s-maxage=5");
  assert.equal(diretiva(cabecalho, "max-age"), 0);
  assert.equal(diretiva(cabecalho, "stale-while-revalidate"), null);
  assert.equal(vidaMaximaCacheSegundos(cabecalho), SEGUNDOS_CACHE_CURTO);
});

test("pedir de proposito a chave de um minuto futuro rende no maximo cinco segundos", () => {
  // A pre-semeadura deixa de fixar 60s de agenda fechada; o estrago cabe na
  // janela de cinco segundos, e o CDN continua absorvendo a rajada em vez de
  // jogar cada visitante na transacao de rate limit.
  for (const agora of [`${SEGUNDA}T07:57`, `${SEGUNDA}T07:58`, `${SEGUNDA}T07:59`]) {
    assert.equal(vidaMaximaCacheSegundos(politica(agora, PUBLICACAO_SEMANAL)), SEGUNDOS_CACHE_CURTO);
  }
});

test("a janela acompanha o envelope de retentativa do Scheduler", () => {
  // prepararAgendaSemanalAutomatica tem maxRetrySeconds 900 e timeoutSeconds
  // 120: a execucao das 07:59 pode so ter sucesso perto de 08:16. Enquanto a
  // publicacao esperada nao esta no mapa, o prazo curto continua valendo.
  const automacaoPadrao = {};
  assert.ok(MINUTOS_CACHE_CURTO_AGUARDANDO_PUBLICACAO >= 17, "precisa cobrir 900s de retry + 120s de execucao");

  for (const minuto of [6, 10, 16, MINUTOS_CACHE_CURTO_AGUARDANDO_PUBLICACAO]) {
    const agora = somarMinutos(ABERTURA, minuto);
    assert.equal(
      cacheControlAgendaPublica(agora, agora, {}, automacaoPadrao),
      CACHE_CURTO,
      `${agora}: publicacao ainda ausente do mapa`
    );
  }
  // Passado o teto, volta ao perfil normal mesmo sem publicacao (agenda montada
  // a mao nunca gravaria o instante programado).
  const alem = somarMinutos(ABERTURA, MINUTOS_CACHE_CURTO_AGUARDANDO_PUBLICACAO + 1);
  assert.equal(cacheControlAgendaPublica(alem, alem, {}, automacaoPadrao), "public, max-age=0, s-maxage=60");

  // Com a publicacao ja gravada, a janela curta termina em +5 min.
  const gravada = { "2026-08-25": ABERTURA };
  assert.deepEqual(aberturasProgramadasPendentes(gravada, automacaoPadrao, `${SEGUNDA}T07:00`), ["2026-08-31T08:00"]);
  const seisMin = somarMinutos(ABERTURA, 6);
  assert.equal(cacheControlAgendaPublica(seisMin, seisMin, gravada, automacaoPadrao), "public, max-age=0, s-maxage=60");
});

test("corpo anterior a virada com emissao posterior nao pode ser guardado", () => {
  // Guardar por 5s somaria o tempo das leituras ao prazo: o falso fechamento
  // duraria leitura + 5s. E resposta de transicao, entao no-store nao recria
  // a rajada.
  assert.equal(
    cacheControlAgendaPublica(`${SEGUNDA}T07:59`, ABERTURA, PUBLICACAO_SEMANAL, SEM_AUTOMACAO),
    CACHE_SEM_ARMAZENAMENTO
  );
  assert.equal(
    cacheControlAgendaPublica(`${SEGUNDA}T07:58`, somarMinutos(ABERTURA, 1), PUBLICACAO_SEMANAL, SEM_AUTOMACAO),
    CACHE_SEM_ARMAZENAMENTO
  );
  assert.ok(publicacaoAtravessada(PUBLICACAO_SEMANAL, SEM_AUTOMACAO, `${SEGUNDA}T07:59`, ABERTURA));

  // Corpo ja do lado de la da virada: nao atravessou nada.
  assert.equal(publicacaoAtravessada(PUBLICACAO_SEMANAL, SEM_AUTOMACAO, ABERTURA, ABERTURA), false);
  assert.equal(politica(ABERTURA, PUBLICACAO_SEMANAL), CACHE_CURTO);
  // Ainda antes da virada nos dois instantes: cache curto normal.
  assert.equal(publicacaoAtravessada(PUBLICACAO_SEMANAL, SEM_AUTOMACAO, `${SEGUNDA}T07:57`, `${SEGUNDA}T07:58`), false);
});

test("agenda atrasada nao volta a ser cacheavel por um minuto as 08:00", () => {
  // Se as tres execucoes agendadas atrasarem, as 08:00 a publicacao deixa de
  // ser futura e a agenda ainda fechada cairia no perfil de 60s.
  const automacaoPadrao = {};
  for (let passaram = 0; passaram <= MINUTOS_CACHE_CURTO_DEPOIS; passaram++) {
    const agora = somarMinutos(ABERTURA, passaram);
    assert.equal(
      cacheControlAgendaPublica(agora, agora, {}, automacaoPadrao),
      CACHE_CURTO,
      `${agora} ainda esta na janela de virada`
    );
  }
  // O retorno ao perfil normal depende de a publicacao ter sido gravada; o
  // caso com o mapa ainda vazio esta no teste do envelope do Scheduler.
});

// ---------------------------------------------------------------------------
// A janela nao depende de publicacaoDatas ja escrita
// ---------------------------------------------------------------------------

test("a janela semanal vale mesmo com publicacaoDatas ainda vazia", () => {
  // Cenario real: as execucoes de 07:50 e 07:55 falharam e o mapa so sera
  // gravado as 07:59. Uma requisicao adiantada nao pode cachear a agenda
  // fechada nesse intervalo.
  const automacaoPadrao = {};
  for (const agora of [`${SEGUNDA}T07:57`, `${SEGUNDA}T07:58`, `${SEGUNDA}T07:59`]) {
    assert.equal(
      cacheControlAgendaPublica(agora, agora, {}, automacaoPadrao),
      CACHE_CURTO,
      `${agora} deveria usar cache curto mesmo sem publicacaoDatas.`
    );
  }
  // Fora da janela o cache normal volta.
  assert.equal(cacheControlAgendaPublica(`${SEGUNDA}T07:50`, `${SEGUNDA}T07:50`, {}, automacaoPadrao), "public, max-age=0, s-maxage=60");
});

test("a abertura programada respeita hora configurada, pausa e automacao desligada", () => {
  assert.deepEqual(aberturasProgramadas({}, `${SEGUNDA}T07:00`), [`${SEGUNDA}T08:00`, "2026-08-31T08:00"]);
  assert.deepEqual(aberturasProgramadas({ horaAbertura: "09:30" }, `${SEGUNDA}T07:00`), [`${SEGUNDA}T09:30`, "2026-08-31T09:30"]);
  assert.deepEqual(aberturasProgramadas({ semanasPausadas: [SEGUNDA] }, `${SEGUNDA}T07:00`), ["2026-08-31T08:00"]);
  assert.deepEqual(aberturasProgramadas({ ativa: false }, `${SEGUNDA}T07:00`), []);

  // Semana pausada nao cria janela sem cache.
  assert.notEqual(
    cacheControlAgendaPublica(`${SEGUNDA}T07:58`, `${SEGUNDA}T07:58`, {}, { semanasPausadas: [SEGUNDA] }),
    CACHE_CURTO
  );
  // Hora configurada diferente move a janela junto.
  assert.equal(
    cacheControlAgendaPublica(`${SEGUNDA}T09:28`, `${SEGUNDA}T09:28`, {}, { horaAbertura: "09:30" }),
    CACHE_CURTO
  );
});

// ---------------------------------------------------------------------------
// Corpo x emissao
// ---------------------------------------------------------------------------

test("corpo anterior a virada nao ganha cache mesmo emitido depois dela", () => {
  // As leituras comecaram as 07:59 e a resposta saiu as 08:00: o corpo ainda
  // esconde a agenda, entao a copia nao pode ser armazenada.
  // Atravessou a virada: nada e guardado.
  assert.equal(
    cacheControlAgendaPublica(`${SEGUNDA}T07:59`, ABERTURA, PUBLICACAO_SEMANAL, SEM_AUTOMACAO),
    CACHE_SEM_ARMAZENAMENTO
  );
  // Ainda antes da virada nos dois instantes: prazo curto, sem no-store.
  assert.equal(
    cacheControlAgendaPublica(`${SEGUNDA}T07:56`, `${SEGUNDA}T07:58`, PUBLICACAO_SEMANAL, SEM_AUTOMACAO),
    CACHE_CURTO
  );
});

test("o prazo e contado da emissao, nao do inicio das leituras", () => {
  // Corpo montado as 13:54 e resposta emitida as 13:56, publicacao as 14:00.
  const datas = { "2026-08-28": `${QUARTA}T14:00` };
  const cabecalho = cacheControlAgendaPublica(`${QUARTA}T13:54`, `${QUARTA}T13:56`, datas, SEM_AUTOMACAO);
  const vida = vidaMaximaCacheSegundos(cabecalho);
  // Sobram 4 minutos a partir da emissao; com o desconto de 1 min, 180s.
  assert.equal(vida, 180);
  // Contando do corpo dariam 6 minutos e a copia atravessaria as 14:00.
  assert.ok(vida < 6 * 60);
});

// ---------------------------------------------------------------------------
// Invariante central
// ---------------------------------------------------------------------------

test("fora da janela de virada, nenhuma copia sobrevive a publicacao", () => {
  const cenarios = [
    { nome: "abertura de segunda", publicarEm: ABERTURA, datas: PUBLICACAO_SEMANAL },
    { nome: "publicacao avulsa no meio da semana", publicarEm: `${QUARTA}T14:00`, datas: { "2026-08-28": `${QUARTA}T14:00` } }
  ];

  for (const cenario of cenarios) {
    for (let faltam = 1; faltam <= 60; faltam++) {
      const agora = somarMinutos(cenario.publicarEm, -faltam);
      // Emissao ate um minuto depois do corpo: pior caso realista de leitura.
      for (const atrasoEmissao of [0, 1]) {
        const emissao = somarMinutos(agora, atrasoEmissao);
        const cabecalho = cacheControlAgendaPublica(agora, emissao, cenario.datas, SEM_AUTOMACAO);
        const vida = vidaMaximaCacheSegundos(cabecalho);

        if (publicacaoAtravessada(cenario.datas, SEM_AUTOMACAO, agora, emissao)) {
          // Corpo de um lado da virada e emissao do outro: nada e guardado.
          assert.equal(cabecalho, CACHE_SEM_ARMAZENAMENTO);
          continue;
        }

        if (emJanelaDeVirada(cenario.datas, SEM_AUTOMACAO, agora, emissao)) {
          // Dentro da janela o compromisso e outro e esta medido no teste
          // seguinte: prazo de segundos em troca de manter o CDN na frente da
          // transacao de rate limit.
          assert.equal(cabecalho, CACHE_CURTO);
          continue;
        }

        // Instantes tem precisao de minuto: o relogio real da emissao pode
        // estar ate 59s a frente do medido.
        const piorEmissao = (atrasoEmissao - faltam) * 60 + 59;
        assert.ok(
          piorEmissao + vida <= 0,
          `${cenario.nome}: em ${agora} (emissao ${emissao}) o cabecalho "${cabecalho}" deixa a copia viva ${piorEmissao + vida}s depois da publicacao`
        );
      }
    }
  }
});

test("dentro da janela de virada o falso fechamento cabe em cinco segundos", () => {
  // Compromisso explicito: trocamos a garantia de zero falso fechamento por um
  // teto de ~5s, porque no-store jogaria cada visitante numa transacao Firestore
  // de rate limit compartilhada por CGNAT durante o pico.
  for (let minuto = -MINUTOS_CACHE_CURTO_ANTES; minuto <= MINUTOS_CACHE_CURTO_DEPOIS; minuto++) {
    const agora = somarMinutos(ABERTURA, minuto);
    const cabecalho = cacheControlAgendaPublica(agora, agora, PUBLICACAO_SEMANAL, SEM_AUTOMACAO);
    assert.equal(vidaMaximaCacheSegundos(cabecalho), SEGUNDOS_CACHE_CURTO, `${agora}: ${cabecalho}`);
  }
  // A janela e finita nos dois lados.
  const antes = somarMinutos(ABERTURA, -(MINUTOS_CACHE_CURTO_ANTES + 1));
  const depois = somarMinutos(ABERTURA, MINUTOS_CACHE_CURTO_DEPOIS + 1);
  assert.notEqual(cacheControlAgendaPublica(antes, antes, PUBLICACAO_SEMANAL, SEM_AUTOMACAO), CACHE_CURTO);
  assert.notEqual(cacheControlAgendaPublica(depois, depois, PUBLICACAO_SEMANAL, SEM_AUTOMACAO), CACHE_CURTO);
});

test("depois da publicacao alcancada a resposta volta a ser armazenavel", () => {
  for (const agora of [ABERTURA, somarMinutos(ABERTURA, 1), somarMinutos(ABERTURA, 30)]) {
    const cabecalho = politica(agora, PUBLICACAO_SEMANAL);
    assert.notEqual(cabecalho, CACHE_SEM_ARMAZENAMENTO, `${agora} deveria voltar a ser cacheavel`);
    assert.ok(vidaMaximaCacheSegundos(cabecalho) > 0);
  }
});

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

test("janela de abertura de segunda usa cache curto e nunca stale-while-revalidate", () => {
  const cabecalho = politica(`${SEGUNDA}T08:30`, {});
  assert.equal(cabecalho, "public, max-age=0, s-maxage=60");
  assert.equal(diretiva(cabecalho, "stale-while-revalidate"), null);
  assert.ok(janelaAberturaSemanal(`${SEGUNDA}T08:30`));
  assert.ok(!janelaAberturaSemanal(`${SEGUNDA}T14:00`));
  assert.ok(!janelaAberturaSemanal(`${QUARTA}T08:30`));
});

test("fora da janela e sem publicacao pendente o cache padrao permanece", () => {
  const padrao = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";
  assert.equal(politica(`${QUARTA}T10:00`, {}), padrao);
  assert.equal(politica(`${SEGUNDA}T15:00`, {}), padrao);
});

// ---------------------------------------------------------------------------
// Leitura de publicacaoDatas
// ---------------------------------------------------------------------------

test("apenas publicacoes ainda nao alcancadas contam", () => {
  const datas = { "2026-08-18": `${SEGUNDA}T07:00`, "2026-08-25": ABERTURA };
  assert.equal(minutosAtePublicacao(datas, `${SEGUNDA}T07:30`, SEM_AUTOMACAO), 30);
  assert.equal(proximaPublicacao(datas, `${SEGUNDA}T08:30`, SEM_AUTOMACAO), null);
  assert.equal(minutosAtePublicacao(datas, `${SEGUNDA}T08:30`, SEM_AUTOMACAO), null);
});

test("a publicacao futura mais proxima manda", () => {
  const datas = {
    "2026-08-25": `${SEGUNDA}T08:00`,
    "2026-08-26": `${SEGUNDA}T09:00`,
    "2026-08-27": `${SEGUNDA}T07:30`
  };
  assert.equal(minutosAtePublicacao(datas, `${SEGUNDA}T07:00`, SEM_AUTOMACAO), 30);
  assert.equal(politica(`${SEGUNDA}T07:28`, datas), CACHE_CURTO);
});

test("entradas invalidas e instante invalido nao abrem brecha", () => {
  const datas = {
    "2026-08-25": "amanha as oito",
    "nao-e-data": ABERTURA,
    "2026-08-26": "2026-02-31T08:00",
    "2026-08-27": ""
  };
  assert.equal(proximaPublicacao(datas, `${SEGUNDA}T07:59`, SEM_AUTOMACAO), null);
  assert.equal(minutosAtePublicacao(null, `${SEGUNDA}T07:59`, SEM_AUTOMACAO), null);

  for (const invalido of ["", null, undefined, "2026-08-24", "2026-08-24T25:00", "ontem"]) {
    assert.equal(cacheControlAgendaPublica(invalido, invalido, PUBLICACAO_SEMANAL, SEM_AUTOMACAO), CACHE_SEM_ARMAZENAMENTO);
    // Emissao invalida tambem barra o armazenamento.
    assert.equal(cacheControlAgendaPublica(`${QUARTA}T10:00`, invalido, {}, SEM_AUTOMACAO), CACHE_SEM_ARMAZENAMENTO);
  }
});

// ---------------------------------------------------------------------------
// Fiacao no backend
// ---------------------------------------------------------------------------

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

test("a leitura publica separa o instante do corpo do instante da emissao", () => {
  const carregar = extrairFuncao(backend, "carregarDisponibilidadePublica");
  assert.match(carregar, /const\s+agora\s*=\s*agoraSaoPauloInput\(\)/);
  assert.match(carregar, /carregarAgenda\(agora,\s*hoje\)/);
  assert.match(carregar, /servidorEm:\s*agora/);
  assert.match(
    carregar,
    /cacheControlAgendaPublica\(\s*agora,\s*agoraSaoPauloInput\(\),\s*agenda\.publicacaoDatas,\s*agenda\.automacaoSemanal\s*\)/
  );
});

test("processarAgenda entrega publicacaoDatas e automacaoSemanal", () => {
  const processar = extrairFuncao(backend, "processarAgenda");
  assert.match(processar, /function processarAgenda\(dadosBrutos,\s*agora\s*=\s*agoraSaoPauloInput\(\),\s*hoje\s*=\s*hojeSaoPauloISO\(\)\)/);
  assert.match(processar, /publicacaoDatas\[dia\]\s*<=\s*agora/);
  assert.match(processar, /\n\s*publicacaoDatas,/);
  assert.match(processar, /automacaoSemanal: normalizarAutomacaoSemanal\(agenda\.automacaoSemanal\)/);
});

test("o handler HTTP publica o cabecalho vindo da mesma leitura", () => {
  assert.match(backend, /require\(["']\.\/agenda-cache-publica["']\)/);
  assert.match(backend, /const\s*\{\s*payload,\s*cacheControl\s*\}\s*=\s*await\s+carregarDisponibilidadePublica\(\)/);
  assert.match(backend, /res\.set\("Cache-Control",\s*cacheControl\)/);
  assert.match(backend, /res\.status\(200\)\.json\(payload\)/);
  assert.equal(backend.includes("function cacheControlAgendaPublica("), false);
});

test("erro da leitura publica tambem sai como no-store", () => {
  const handler = backend.slice(backend.indexOf("exports.carregarAgendaPublicaHttp"));
  const corpo = handler.slice(0, handler.indexOf("exports.", 1));
  assert.match(corpo, /catch\s*\(err\)\s*\{[\s\S]*res\.set\("Cache-Control",\s*CACHE_SEM_ARMAZENAMENTO\)/);
});
