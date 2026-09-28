"use strict";

// Disputa da abertura (28/09/2026). As pessoas relatavam: "clico no horario,
// indisponivel; tento outro, indisponivel; perdi". Tres mudancas, e a pessoa
// continua sempre escolhendo o proprio horario:
//   A. sai o atalho "Primeiro horario livre", que apontava o MESMO horario em
//      todos os celulares e juntava a abertura inteira numa vaga so;
//   B. quem perde a vaga recebe, junto com o erro, a agenda lida agora e ve os
//      horarios ainda livres num aviso com "Agendar as HH:MM";
//   C. nos 5 minutos depois da abertura a grade atualiza a cada 2s, no lugar,
//      sem esconder a grade de horarios de quem esta escolhendo.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

function extrairFuncao(codigo, nome) {
  const marcador = new RegExp(`(?:async )?function ${nome}\\(`).exec(codigo);
  assert.ok(marcador, `Funcao ${nome} nao encontrada.`);
  const abreParametros = codigo.indexOf("(", marcador.index);
  let nivelParametros = 0;
  let fechaParametros = -1;
  for (let i = abreParametros; i < codigo.length; i++) {
    if (codigo[i] === "(") nivelParametros++;
    if (codigo[i] === ")") {
      nivelParametros--;
      if (nivelParametros === 0) { fechaParametros = i; break; }
    }
  }
  const abre = codigo.indexOf("{", fechaParametros);
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(marcador.index, i + 1);
    }
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

// ---------------------------------------------------------------------------
// A. Sem atalho que junta todo mundo no mesmo horario
// ---------------------------------------------------------------------------

test("A: o atalho 'Primeiro horario livre' saiu do site", () => {
  assert.doesNotMatch(sitePublico, /Primeiro horário livre/);
  assert.doesNotMatch(sitePublico, /primeiroHorarioLivre/);
  assert.doesNotMatch(sitePublico, /primeiro-livre/);
  const renderHoras = extrairFuncao(sitePublico, "renderHoras");
  // Um botao por horario da grade, e nada alem deles.
  assert.equal(renderHoras.match(/document\.createElement\("button"\)/g).length, 1);
  assert.match(renderHoras, /infoDia\.horarios\.forEach\(/);
});

// ---------------------------------------------------------------------------
// B. Horario preenchido: o que ainda esta livre, agora
// ---------------------------------------------------------------------------

function montarAgendaFrescaDoConflito() {
  return new Function(
    "configAgendaPublicaValida",
    `${extrairFuncao(sitePublico, "agendaFrescaDoConflito")}; return agendaFrescaDoConflito;`
  )((cfg) => Boolean(cfg && Array.isArray(cfg.dias) && Array.isArray(cfg.horarios)));
}

test("B: so o conflito de vaga com agenda valida vira aviso de horarios livres", () => {
  const extrair = montarAgendaFrescaDoConflito();
  const agenda = { dias: [], horarios: [] };
  assert.equal(extrair({ code: "functions/already-exists", details: { tipo: "horario-preenchido", agenda } }), agenda);
  // Servidor antigo, leitura lenta ou corpo estranho: fluxo anterior.
  assert.equal(extrair({ code: "functions/already-exists", details: { tipo: "horario-preenchido" } }), null);
  assert.equal(extrair({ code: "functions/already-exists", details: { tipo: "horario-preenchido", agenda: { dias: "x" } } }), null);
  assert.equal(extrair({ code: "functions/already-exists", details: { tipo: "cpf-ja-agendado", agenda } }), null);
  assert.equal(extrair({ code: "functions/already-exists" }), null);
  assert.equal(extrair(null), null);
});

test("B: o conflito marca a vaga, tenta o aviso fresco e cai no fluxo antigo sem ele", () => {
  const confirmar = extrairFuncao(sitePublico, "confirmarAgendamento");
  const inicio = confirmar.indexOf("if (erroHorarioOcupado(e))");
  assert.notEqual(inicio, -1);
  const ramo = confirmar.slice(inicio, confirmar.indexOf("else if (erroCpfBloqueado(e))", inicio));
  const ordem = [
    "marcarSlotIndisponivelLocalmente(dataOperacao, horaOperacao)",
    "operacaoAgendamentoPendente = null",
    "agendaFrescaDoConflito(e)",
    "await mostrarHorariosLivresAgora(agendaFresca, dataOperacao, horaOperacao)) return;",
    "await abrirAlterarHorario()",
    "erro(\"Outra pessoa concluiu"
  ].map((trecho) => {
    const posicao = ramo.indexOf(trecho);
    assert.notEqual(posicao, -1, `faltou: ${trecho}`);
    return posicao;
  });
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, "a ordem do tratamento do conflito mudou");
});

test("B: o aviso so oferece horarios livres e so agenda com toque explicito", () => {
  const mostrar = extrairFuncao(sitePublico, "mostrarHorariosLivresAgora");
  assert.match(mostrar, /\.filter\(hora => horarioLivreAgora\(dataISO, hora\)\)/);
  assert.match(mostrar, /texto:\s*`Agendar às \$\{hora\}`/);
  // A unica chamada de agendamento vive dentro da acao do botao.
  const chamadas = mostrar.match(/selecionarHorarioEConfirmar\(/g) || [];
  assert.equal(chamadas.length, 1);
  assert.match(mostrar, /acao:\s*\(\)\s*=>\s*selecionarHorarioEConfirmar\(dataISO,\s*hora,\s*\{\s*jaConfirmado:\s*true\s*\}\)/);
  // Nenhum horario de outro dia e agendado direto: outros dias so abrem a grade.
  assert.match(mostrar, /acao:\s*\(\)\s*=>\s*selecionarDia\(dia\)/);
  // Toque acumulado durante a espera nao agenda sem querer.
  assert.match(mostrar, /caixaBotoes\.style\.pointerEvents = "none"/);
  assert.match(mostrar, /setTimeout\(\(\) => \{ caixaBotoes\.style\.pointerEvents = ""; \}, 600\)/);
  // Falha ao montar a tela devolve false para o fluxo antigo assumir.
  assert.match(mostrar, /catch \(erroTela\) \{[\s\S]*?return false;/);
});

function montarSelecionar({ confirmou }) {
  const registro = { modais: 0, confirmacoes: 0, estado: {} };
  const elementos = {};
  const documento = {
    getElementById: (id) => {
      if (!elementos[id]) elementos[id] = { id, style: {}, textContent: "" };
      return elementos[id];
    }
  };
  const selecionar = new Function(
    "confirmarModalAsync", "confirmarAgendamento", "document", "window",
    "definirModoDados", "atualizarEtapasFluxo", "atualizarVisibilidadeAtalhos",
    "validarNascimentoAgendamento", "focarConteudo", "dataBrTela", "registro",
    `let selecionandoHora = false; let dataSel = null; let horaSel = null;
     ${extrairFuncao(sitePublico, "selecionarHorarioEConfirmar")}
     return async (...args) => {
       await selecionarHorarioEConfirmar(...args);
       registro.estado = { dataSel, horaSel, selecionandoHora };
     };`
  )(
    async () => { registro.modais++; return confirmou; },
    async () => { registro.confirmacoes++; },
    documento,
    { scrollTo: () => {} },
    () => {}, () => {}, () => {}, () => {}, () => {},
    (d) => d.split("-").reverse().join("/"),
    registro
  );
  return { selecionar, registro, elementos };
}

test("B: o toque no aviso agenda sem segundo modal; o toque na grade continua pedindo confirmacao", async () => {
  const grade = montarSelecionar({ confirmou: false });
  await grade.selecionar("2026-09-29", "14:55");
  assert.equal(grade.registro.modais, 1);
  assert.equal(grade.registro.confirmacoes, 0, "sem confirmar, nada e enviado");
  assert.equal(grade.registro.estado.horaSel, null);

  const aviso = montarSelecionar({ confirmou: false });
  await aviso.selecionar("2026-09-29", "14:55", { jaConfirmado: true });
  assert.equal(aviso.registro.modais, 0);
  assert.equal(aviso.registro.confirmacoes, 1);
  assert.equal(aviso.registro.estado.dataSel, "2026-09-29");
  assert.equal(aviso.registro.estado.horaSel, "14:55");
  assert.equal(aviso.registro.estado.selecionandoHora, false);
  assert.equal(aviso.elementos["resumo-data-txt"].textContent, "29/09/2026");
  assert.equal(aviso.elementos["resumo-hora-txt"].textContent, "14:55");
});

// ---------------------------------------------------------------------------
// C. Atualizacao rapida, no lugar
// ---------------------------------------------------------------------------

function montarAtualizacaoRapida(estadoInicial = {}) {
  const estado = {
    ATUALIZACAO_RAPIDA_ATE: "2026-09-28T08:05",
    agora: "2026-09-28T08:01",
    ESTADO_AGENDA_PUBLICA: "valido",
    DIAS_DISPONIVEIS: ["2026-09-29"],
    totalVagasRestantes: 10,
    visibilityState: "visible",
    atualizacaoAberturaEmCurso: null,
    operacaoAgendamentoPendente: null,
    sucessoVisivel: false,
    podeRedesenhar: true,
    noLugar: true,
    buscaFalha: false,
    duranteBusca: null,
    ...estadoInicial
  };
  const registro = { buscas: 0, aplicadas: 0, noLugar: 0, redesenhos: 0, banners: 0, cacheLocal: 0, modal: 0 };
  let soltarBusca = null;
  const documento = {
    get visibilityState() { return estado.visibilityState; },
    getElementById: (id) => ({ style: { display: id === "sucesso-docs" && estado.sucessoVisivel ? "block" : "none" } })
  };
  const codigo = ["atualizacaoRapidaAtiva", "atualizacaoRapidaPermitidaAgora", "atualizarGradeRapido"]
    .map((nome) => extrairFuncao(sitePublico, nome))
    .join("\n");
  const api = new Function(
    "estado", "registro", "document", "controle",
    `
    const LIMITE_BUSCA_ATUALIZACAO_RAPIDA_MS = 4000;
    let atualizacaoRapidaEmCurso = false;
    const agoraSaoPauloInput = () => estado.agora;
    const podeRedesenharAgenda = () => estado.podeRedesenhar;
    const sincronizarRelogioServidor = () => {};
    const aplicarConfigAgendaPublica = () => { registro.aplicadas++; };
    const guardarAgendaNoCacheLocal = () => { registro.cacheLocal++; };
    const atualizarGradeNoLugar = () => { registro.noLugar++; return estado.noLugar; };
    const redesenharGradePreservandoDia = async () => { registro.redesenhos++; };
    const atualizarBotoesLivresNoModal = () => { registro.modal++; };
    const atualizarBannerVagas = () => { registro.banners++; };
    const buscarAgendaPublicaAtualizada = async (opcoes) => {
      registro.buscas++;
      registro.ultimaBusca = opcoes;
      if (estado.duranteBusca) estado.duranteBusca();
      if (controle.segurar) await new Promise((resolve) => { controle.soltar = resolve; });
      if (estado.buscaFalha) throw new Error("rede");
      return { dados: {}, relogioServidor: {} };
    };
    const variaveis = {
      get ATUALIZACAO_RAPIDA_ATE() { return estado.ATUALIZACAO_RAPIDA_ATE; },
      get ESTADO_AGENDA_PUBLICA() { return estado.ESTADO_AGENDA_PUBLICA; },
      get DIAS_DISPONIVEIS() { return estado.DIAS_DISPONIVEIS; },
      get DISPONIBILIDADE_PUBLICA() { return { totalVagasRestantes: estado.totalVagasRestantes }; },
      get atualizacaoAberturaEmCurso() { return estado.atualizacaoAberturaEmCurso; },
      get operacaoAgendamentoPendente() { return estado.operacaoAgendamentoPendente; }
    };
    with (variaveis) {
      ${codigo}
      return { atualizarGradeRapido, atualizacaoRapidaAtiva, emCurso: () => atualizacaoRapidaEmCurso };
    }
    `
  );
  const controle = { segurar: false, soltar: null };
  return { ...api(estado, registro, documento, controle), estado, registro, controle };
}

test("C: dentro da janela busca a grade e atualiza no lugar, sem redesenhar", async () => {
  const c = montarAtualizacaoRapida();
  assert.equal(await c.atualizarGradeRapido(), true);
  assert.equal(c.registro.buscas, 1);
  assert.equal(c.registro.ultimaBusca.timeoutMs, 4000);
  assert.equal(c.registro.aplicadas, 1);
  assert.equal(c.registro.cacheLocal, 1);
  assert.equal(c.registro.noLugar, 1);
  assert.equal(c.registro.redesenhos, 0);
  assert.equal(c.registro.modal, 1);
  assert.equal(c.emCurso(), false);
});

test("C: fora da janela, aba oculta, envio em curso, sucesso ou vagas esgotadas nao buscam", async () => {
  const casos = {
    "sem janela": { ATUALIZACAO_RAPIDA_ATE: "" },
    "janela acabou": { agora: "2026-09-28T08:05" },
    "agenda em erro": { ESTADO_AGENDA_PUBLICA: "erro" },
    "sem dias": { DIAS_DISPONIVEIS: [] },
    "vagas esgotadas": { totalVagasRestantes: 0 },
    "aba oculta": { visibilityState: "hidden" },
    "abertura em curso": { atualizacaoAberturaEmCurso: Promise.resolve() },
    "agendamento sendo enviado": { operacaoAgendamentoPendente: { emEnvio: true } },
    "tela de sucesso": { sucessoVisivel: true }
  };
  for (const [nome, estado] of Object.entries(casos)) {
    const c = montarAtualizacaoRapida(estado);
    assert.equal(await c.atualizarGradeRapido(), false, nome);
    assert.equal(c.registro.buscas, 0, nome);
  }
  // Resultado incerto sem envio em andamento nao trava a grade.
  const incerto = montarAtualizacaoRapida({ operacaoAgendamentoPendente: { emEnvio: false, resultadoIncerto: true } });
  assert.equal(await incerto.atualizarGradeRapido(), true);
});

test("C: nunca duas buscas ao mesmo tempo", async () => {
  const c = montarAtualizacaoRapida();
  c.controle.segurar = true;
  const primeira = c.atualizarGradeRapido();
  assert.equal(await c.atualizarGradeRapido(), false);
  assert.equal(c.registro.buscas, 1);
  c.controle.soltar();
  assert.equal(await primeira, true);
  c.controle.segurar = false;
  assert.equal(await c.atualizarGradeRapido(), true);
  assert.equal(c.registro.buscas, 2);
});

test("C: agendamento que comeca durante a busca nao tem a tela mexida", async () => {
  const c = montarAtualizacaoRapida();
  c.estado.duranteBusca = () => { c.estado.operacaoAgendamentoPendente = { emEnvio: true }; };
  assert.equal(await c.atualizarGradeRapido(), false);
  assert.equal(c.registro.buscas, 1);
  assert.equal(c.registro.aplicadas, 0);
  assert.equal(c.registro.noLugar, 0);
});

test("C: falha de rede e silenciosa e libera a proxima volta", async () => {
  const c = montarAtualizacaoRapida({ buscaFalha: true });
  assert.equal(await c.atualizarGradeRapido(), false);
  assert.equal(c.registro.aplicadas, 0);
  assert.equal(c.emCurso(), false);
  c.estado.buscaFalha = false;
  assert.equal(await c.atualizarGradeRapido(), true);
});

test("C: dias diferentes dos desenhados redesenham preservando o dia aberto", async () => {
  const c = montarAtualizacaoRapida({ noLugar: false });
  await c.atualizarGradeRapido();
  assert.equal(c.registro.redesenhos, 1);
  const naConfirmacao = montarAtualizacaoRapida({ noLugar: false, podeRedesenhar: false });
  await naConfirmacao.atualizarGradeRapido();
  assert.equal(naConfirmacao.registro.noLugar, 0, "na tela de confirmacao a grade escondida nao e tocada");
  assert.equal(naConfirmacao.registro.redesenhos, 0);
});

test("C: o laco roda a cada 2s e a volta da aba atualiza na hora", () => {
  assert.match(sitePublico, /const ATUALIZACAO_RAPIDA_MS = 2000;/);
  const iniciar = extrairFuncao(sitePublico, "iniciarAtualizacaoAutomatica");
  assert.match(iniciar, /setInterval\(atualizarGradeRapido,\s*ATUALIZACAO_RAPIDA_MS\)/);
  const visibilidade = sitePublico.slice(
    sitePublico.indexOf('document.addEventListener("visibilitychange"'),
    sitePublico.indexOf('document.addEventListener("visibilitychange"') + 1400
  );
  assert.match(visibilidade, /atualizarGradeRapido\(\)/);
});

test("C: a atualizacao de 3 minutos tambem atualiza no lugar", () => {
  const agendar = extrairFuncao(sitePublico, "agendarAtualizacaoAutomatica");
  assert.match(agendar, /await carregarConfig\(\{ atualizarInterface: false \}\)/);
  assert.match(agendar, /if \(podeRedesenharAgenda\(\) && !atualizarGradeNoLugar\(\)\) await redesenharGradePreservandoDia\(\);/);
  // O redesenho puro escondia a grade de horarios aberta a cada 3 minutos.
  assert.doesNotMatch(agendar, /if \(podeRedesenharAgenda\(\)\) await renderDatas\(\);/);
  assert.match(agendar, /mostrarAvisoPopupSePreciso\(\)/);
});

test("C: a atualizacao no lugar nao redesenha nem esconde a grade de horarios", () => {
  const noLugar = extrairFuncao(sitePublico, "atualizarGradeNoLugar");
  assert.doesNotMatch(noLugar, /renderDatas\(|renderHoras\(|innerHTML\s*=|style\.display\s*=/);
  assert.match(noLugar, /preencherBotaoDia\(btn, btn\.dataset\.data\)/);
  assert.match(noLugar, /preencherBotaoHora\(btn, dataHoras,/);
  // Dias diferentes dos desenhados: devolve false para quem chama redesenhar.
  assert.match(noLugar, /join\("\|"\) !== DIAS_DISPONIVEIS\.join\("\|"\)\) \{\s*return false;/);
});

test("C: o site guarda o fim da janela vindo do servidor e ignora formato estranho", () => {
  const aplicar = extrairFuncao(sitePublico, "aplicarConfigAgendaPublica");
  const executar = (cfg) => new Function(
    "cfg", "configAgendaPublicaValida", "normalizarListaHorariosPublica", "normalizarDisponibilidadePublica",
    "datasAtivas", "normalizarAvisoPopup", "DATA_NOVAS_VAGAS_PADRAO",
    `let HORARIOS, DISPONIBILIDADE_PUBLICA, DIAS_DISPONIVEIS, DATA_NOVAS_VAGAS, AVISO_POPUP, ESTADO_AGENDA_PUBLICA;
     let ATUALIZACAO_RAPIDA_ATE = "sentinela";
     ${aplicar}
     aplicarConfigAgendaPublica(cfg);
     return ATUALIZACAO_RAPIDA_ATE;`
  )(cfg, () => true, () => [], () => ({ porData: {} }), () => [], () => null, "data a definir");
  assert.equal(executar({ atualizacaoRapidaAte: "2026-09-28T08:05" }), "2026-09-28T08:05");
  assert.equal(executar({ atualizacaoRapidaAte: "" }), "");
  assert.equal(executar({}), "", "servidor antigo, sem o campo: sem atualizacao rapida");
  assert.equal(executar({ atualizacaoRapidaAte: "amanha" }), "");
});
