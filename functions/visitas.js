"use strict";

// Contador de visitas do site publico (agendamento, blog e guia da CIN).
//
// Substitui a telemetria de presenca no Realtime Database, desligada porque
// cada acesso lia o no inteiro de conexoes e disputava uma transacao num unico
// contador. Aqui o caminho quente e uma unica gravacao por visita, sem leitura
// e sem transacao: um incremento num de FRAGMENTOS documentos do dia, escolhido
// ao acaso, para nao encostar no limite de ~1 gravacao/s por documento no
// minuto da abertura.
//
// Nada pessoal e guardado: nem IP, nem navegador, nem identificador do
// aparelho. So numeros somados por dia, secao e pagina. A distincao entre
// "visita" (um aparelho conta uma vez por dia) e "pagina vista" vem de uma
// marca que o proprio navegador guarda em localStorage (public/visita.js).
//
// A consolidacao (fragmentos -> resumo) roda quando o painel abre a aba
// Estatisticas e uma vez por dia na manutencao. Ela grava valores absolutos
// por dia, recalculados dos fragmentos, entao repetir nao conta duas vezes.

const COLECAO_FRAGMENTOS = "metricas_visitas_fragmentos";
const COLECAO_RESUMO = "metricas_visitas";
const DOC_RESUMO = "resumo";
const FRAGMENTOS = 10;
const SECOES = ["agendamento", "blog", "guia", "outros"];
// Dias guardados um a um no resumo. Os mais antigos viram "acumulado" e so
// entram no total. Precisa cobrir a janela de 30 dias com folga.
const RETENCAO_DIAS = 60;
// Teto de dias relidos numa consolidacao (10 leituras por dia).
const MAX_DIAS_RECALCULO = 45;
const MAX_CORPO_BYTES = 1024;
const MAX_CAMINHO = 200;
const MAIS_LIDAS_LIMITE = 10;

// Paginas que entram no ranking de mais lidas. Lista fechada de proposito: um
// mapa aberto deixaria qualquer um criar campos no documento ate o limite de
// 1 MB e travar a contagem. A trava em visitas.test.js cobra que toda pagina
// gerada em public/ esteja aqui. Caminho fora da lista ainda conta na secao.
const PAGINAS = {
  "/": { secao: "agendamento", titulo: "Agendamento (página inicial)" },
  "/duvidas.html": { secao: "outros", titulo: "Dúvidas frequentes" },
  "/sobre/": { secao: "outros", titulo: "Sobre o Guia da CIN" },
  "/blog/": { secao: "blog", titulo: "Blog do RG (capa)" },
  "/blog/onde-fica-o-numero-do-rg/": { secao: "blog", titulo: "Onde fica o número do RG" },
  "/blog/orgao-emissor-do-rg/": { secao: "blog", titulo: "Órgão emissor do RG" },
  "/blog/qual-certidao-levar-para-fazer-rg/": { secao: "blog", titulo: "Qual certidão levar para fazer o RG" },
  "/blog/rg-antigo-ainda-vale/": { secao: "blog", titulo: "RG antigo ainda vale?" },
  "/cin/": { secao: "guia", titulo: "Guia da CIN (capa)" },
  "/cin/beneficios-sociais/": { secao: "guia", titulo: "Benefícios sociais" },
  "/cin/cidades-vizinhas/": { secao: "guia", titulo: "Cidades vizinhas" },
  "/cin/como-agendar/": { secao: "guia", titulo: "Como agendar" },
  "/cin/consultar-ou-cancelar/": { secao: "guia", titulo: "Consultar ou cancelar" },
  "/cin/criancas-e-adolescentes/": { secao: "guia", titulo: "Crianças e adolescentes" },
  "/cin/dia-do-atendimento/": { secao: "guia", titulo: "Dia do atendimento" },
  "/cin/documentos/": { secao: "guia", titulo: "Documentos" },
  "/cin/gratuidade-e-segunda-via/": { secao: "guia", titulo: "Gratuidade e segunda via" },
  "/cin/prazo-e-entrega/": { secao: "guia", titulo: "Prazo e entrega" }
};

// Robos que executam JavaScript. Os que nao executam nem chegam a enviar.
const USER_AGENT_ROBO = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|preview|facebookexternalhit|bingpreview|phantomjs|selenium|puppeteer|playwright/i;

// Nome de campo simples (sem "/", "." nem "-") dispensa escape de FieldPath.
function idPagina(caminho) {
  if (caminho === "/") return "inicio";
  return caminho.replace(/^\/|\/$/g, "").replace(/\.html$/, "").replace(/\//g, "__").replace(/-/g, "_");
}

const PAGINAS_POR_ID = Object.fromEntries(
  Object.entries(PAGINAS).map(([caminho, dados]) => [idPagina(caminho), { caminho, ...dados }])
);

function normalizarCaminho(valor) {
  if (typeof valor !== "string") return null;
  let caminho = valor.split(/[?#]/)[0].trim().toLowerCase();
  if (!caminho.startsWith("/") || caminho.length > MAX_CAMINHO) return null;
  if (!/^[a-z0-9/._-]+$/.test(caminho) || caminho.includes("..") || caminho.includes("//")) return null;
  caminho = caminho.replace(/\/index\.html$/, "/");
  // /blog/x e /blog/x/ sao a mesma pagina; .html fica como esta.
  if (!caminho.endsWith("/") && !/\.[a-z0-9]+$/.test(caminho)) caminho += "/";
  return caminho;
}

function secaoDoCaminho(caminho) {
  if (PAGINAS[caminho]) return PAGINAS[caminho].secao;
  if (caminho.startsWith("/blog/")) return "blog";
  if (caminho.startsWith("/cin/")) return "guia";
  return "outros";
}

function ehRobo(userAgent) {
  const ua = String(userAgent || "");
  return !ua || USER_AGENT_ROBO.test(ua);
}

function lerCorpo(corpo) {
  let valor = corpo;
  if (Buffer.isBuffer(valor)) valor = valor.toString("utf8");
  if (typeof valor === "string") {
    if (Buffer.byteLength(valor) > MAX_CORPO_BYTES) return null;
    try {
      valor = JSON.parse(valor);
    } catch (_) {
      return null;
    }
  }
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  return valor;
}

// Corpo enviado por public/visita.js: { p: caminho, n: 1 se primeira visita do
// aparelho no dia, s: 1 se primeira visita do aparelho a esta secao no dia }.
function classificarVisita(corpo) {
  const dados = lerCorpo(corpo);
  if (!dados) return null;
  const caminho = normalizarCaminho(dados.p);
  if (!caminho) return null;
  const novoVisitante = dados.n === 1 || dados.n === true;
  // Primeira visita do dia e, por definicao, primeira visita a secao.
  const novaSecao = novoVisitante || dados.s === 1 || dados.s === true;
  return {
    caminho,
    secao: secaoDoCaminho(caminho),
    pagina: PAGINAS[caminho] ? idPagina(caminho) : null,
    novoVisitante,
    novaSecao
  };
}

function idFragmento(dia, indice) {
  return `${dia}_${indice}`;
}

// Objeto para set(..., { merge: true }): mapas aninhados com incrementos.
function incrementoDaVisita(visita, dia, incremento) {
  const um = incremento(1);
  const dados = {
    dia,
    paginas: { total: um, [visita.secao]: um }
  };
  if (visita.novaSecao) {
    dados.visitantes = { [visita.secao]: um };
    if (visita.novoVisitante) dados.visitantes.total = um;
  }
  if (visita.pagina) dados.porPagina = { [visita.pagina]: um };
  return dados;
}

function totaisVazios() {
  const zero = () => Object.fromEntries(["total", ...SECOES].map((chave) => [chave, 0]));
  return { paginas: zero(), visitantes: zero(), porPagina: {} };
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function somarTotais(destino, origem) {
  if (!origem) return destino;
  for (const grupo of ["paginas", "visitantes"]) {
    for (const chave of ["total", ...SECOES]) {
      destino[grupo][chave] += numero(origem[grupo] && origem[grupo][chave]);
    }
  }
  const porPagina = origem.porPagina && typeof origem.porPagina === "object" ? origem.porPagina : {};
  for (const [id, valor] of Object.entries(porPagina)) {
    if (!PAGINAS_POR_ID[id]) continue;
    destino.porPagina[id] = (destino.porPagina[id] || 0) + numero(valor);
  }
  return destino;
}

function somarFragmentos(fragmentos) {
  return fragmentos.reduce((acc, dados) => somarTotais(acc, dados), totaisVazios());
}

function diaVazio(totais) {
  return !totais || (totais.paginas.total === 0 && totais.visitantes.total === 0);
}

function somarDiasISO(dataISO, quantidade) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + quantidade));
  return data.toISOString().slice(0, 10);
}

function dataISOValida(valor) {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)
    && new Date(`${valor}T12:00:00Z`).toISOString().startsWith(valor);
}

// Relemos sempre ontem e hoje (a ultima consolidacao de ontem pode ter sido
// antes da meia-noite) e, se o painel ficou dias fechado e a manutencao falhou,
// tudo desde a ultima consolidacao. Cada rodada le no maximo
// MAX_DIAS_RECALCULO dias seguidos e so avanca a marca ate onde leu: um buraco
// maior e fechado em rodadas sucessivas, nunca pulado. Hoje entra sempre, para
// o painel nao mostrar zero enquanto o atraso e recuperado.
function diasParaRecalcular(ultimoDia, hoje) {
  const primeiro = somarDiasISO(hoje, -(MAX_DIAS_RECALCULO - 1));
  const inicio = dataISOValida(ultimoDia) && ultimoDia <= hoje ? somarDiasISO(ultimoDia, -1) : primeiro;
  let ateDia = somarDiasISO(inicio, MAX_DIAS_RECALCULO - 1);
  if (ateDia > hoje) ateDia = hoje;
  const dias = [];
  for (let dia = inicio; dia <= ateDia; dia = somarDiasISO(dia, 1)) dias.push(dia);
  if (ateDia < hoje) dias.push(hoje);
  return { dias, ateDia };
}

// Os fragmentos so crescem, entao o valor certo de um dia e sempre o maior ja
// visto. Tomar o maximo campo a campo deixa a ordem das consolidacoes
// irrelevante: uma rodada lenta, com leitura mais velha, nao desfaz outra.
function maiorDosTotais(a, b) {
  const resultado = totaisVazios();
  for (const grupo of ["paginas", "visitantes"]) {
    for (const chave of ["total", ...SECOES]) {
      resultado[grupo][chave] = Math.max(a[grupo][chave], b[grupo][chave]);
    }
  }
  for (const id of new Set([...Object.keys(a.porPagina), ...Object.keys(b.porPagina)])) {
    resultado.porPagina[id] = Math.max(a.porPagina[id] || 0, b.porPagina[id] || 0);
  }
  return resultado;
}

// resumoAtual: documento salvo. recalculados: { dia: totais } relidos dos
// fragmentos. ateDia: ultimo dia lido sem buraco (a nova marca). Nao conta nada
// duas vezes: cada dia guarda o maior valor visto, e um dia que ja foi para o
// acumulado nao e aceito de novo.
function consolidarResumo(resumoAtual, recalculados, hoje, ateDia = null) {
  const base = resumoAtual && typeof resumoAtual === "object" ? resumoAtual : {};
  const ultimoAnterior = dataISOValida(base.ultimoDiaConsolidado) ? base.ultimoDiaConsolidado : null;
  const corte = somarDiasISO(hoje, -(RETENCAO_DIAS - 1));
  const dias = {};
  for (const [dia, totais] of Object.entries(base.dias || {})) {
    if (dataISOValida(dia)) dias[dia] = somarTotais(totaisVazios(), totais);
  }
  for (const [dia, totais] of Object.entries(recalculados || {})) {
    if (!dataISOValida(dia) || diaVazio(totais)) continue;
    // Fora da retencao e ja consolidado antes: esta somado no acumulado.
    if (dia < corte && !dias[dia] && ultimoAnterior && dia <= ultimoAnterior) continue;
    const lido = somarTotais(totaisVazios(), totais);
    dias[dia] = dias[dia] ? maiorDosTotais(dias[dia], lido) : lido;
  }

  // A marca nunca volta: duas rodadas simultaneas nao reabrem dias ja lidos.
  const marcas = [ultimoAnterior, dataISOValida(ateDia) ? ateDia : null].filter(Boolean).sort();
  const marca = marcas[marcas.length - 1] || null;

  // So vai para o acumulado o dia que a leitura em sequencia ja cobriu. Um dia
  // lido fora da sequencia (o "hoje" de uma rodada de recuperacao) fica em
  // dias ate a marca alcanca-lo; se fosse acumulado antes, a leitura em
  // sequencia o aceitaria de novo e ele contaria duas vezes.
  const limiteAcumulo = marca || hoje;
  const acumulado = somarTotais(totaisVazios(), base.acumulado);
  acumulado.porPagina = {};
  for (const dia of Object.keys(dias)) {
    if (dia >= corte || dia > limiteAcumulo) continue;
    somarTotais(acumulado, { paginas: dias[dia].paginas, visitantes: dias[dia].visitantes });
    delete dias[dia];
  }

  const conhecidos = Object.keys(dias).sort();
  const inicio = [base.inicio, conhecidos[0]].filter(dataISOValida).sort()[0] || null;
  return { dias, acumulado, inicio, ultimoDiaConsolidado: marca };
}

function somaJanela(dias, hoje, quantidade) {
  const desde = somarDiasISO(hoje, -(quantidade - 1));
  const totais = totaisVazios();
  for (const [dia, valores] of Object.entries(dias)) {
    if (dia >= desde && dia <= hoje) somarTotais(totais, valores);
  }
  return totais;
}

function maisLidas(porPagina) {
  return Object.entries(porPagina)
    .filter(([id, total]) => PAGINAS_POR_ID[id] && total > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAIS_LIDAS_LIMITE)
    .map(([id, paginas]) => ({
      caminho: PAGINAS_POR_ID[id].caminho,
      titulo: PAGINAS_POR_ID[id].titulo,
      secao: PAGINAS_POR_ID[id].secao,
      paginas
    }));
}

function semPorPagina(totais) {
  return { paginas: totais.paginas, visitantes: totais.visitantes };
}

// O que o painel mostra. Calculado na leitura para "hoje" sempre ser o dia
// corrente, mesmo que o resumo salvo seja de ontem.
function visaoDoResumo(resumo, hoje) {
  const consolidado = consolidarResumo(resumo, {}, hoje);
  const { dias, acumulado } = consolidado;
  const total = somarTotais(totaisVazios(), acumulado);
  Object.values(dias).forEach((valores) => somarTotais(total, valores));
  const ultimos7 = somaJanela(dias, hoje, 7);
  const ultimos30 = somaJanela(dias, hoje, 30);
  const serie = [];
  for (let i = 29; i >= 0; i--) {
    const dia = somarDiasISO(hoje, -i);
    const valores = dias[dia] || totaisVazios();
    serie.push({ dia, paginas: valores.paginas.total, visitantes: valores.visitantes.total });
  }
  return {
    hoje: semPorPagina(dias[hoje] || totaisVazios()),
    ultimos7: semPorPagina(ultimos7),
    ultimos30: semPorPagina(ultimos30),
    total: semPorPagina(total),
    maisLidas7: maisLidas(ultimos7.porPagina),
    maisLidas30: maisLidas(ultimos30.porPagina),
    serie30: serie,
    inicio: consolidado.inicio,
    dia: hoje
  };
}

// Limite por IP em memoria, por instancia. Nao protege contra quem quiser
// inflar os numeros de verdade (e nao ha dado a proteger), mas corta laco de
// script e recarga em massa sem custar leitura no Firestore a cada visita.
function criarLimitador({ limite = 120, janelaMs = 10 * 60 * 1000, maxChaves = 5000 } = {}) {
  const contagens = new Map();
  return function permitido(chave, agora = Date.now()) {
    const atual = contagens.get(chave);
    if (!atual || agora - atual.inicio >= janelaMs) {
      if (contagens.size >= maxChaves) contagens.clear();
      contagens.set(chave, { inicio: agora, total: 1 });
      return true;
    }
    atual.total += 1;
    return atual.total <= limite;
  };
}

function criarContadorVisitas({ db, FieldValue, hoje, origensPermitidas = [], aleatorio = Math.random, limitador = criarLimitador() }) {
  const origens = new Set(origensPermitidas);

  async function registrar(req, res, { ativo = true, chaveCliente = "" } = {}) {
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.status(405).end();
      return;
    }
    const origem = req.headers && req.headers.origin;
    if (origem && !origens.has(origem)) {
      res.status(403).end();
      return;
    }
    const visita = classificarVisita(req.body);
    if (!visita) {
      res.status(400).end();
      return;
    }
    // Daqui em diante a resposta e sempre 204: o navegador nao faz nada com
    // ela e um erro aqui nunca pode virar aviso para o cidadao.
    if (!ativo || ehRobo(req.headers && req.headers["user-agent"]) || !limitador(chaveCliente)) {
      res.status(204).end();
      return;
    }
    const dia = hoje();
    const indice = Math.floor(aleatorio() * FRAGMENTOS) % FRAGMENTOS;
    try {
      await db.collection(COLECAO_FRAGMENTOS).doc(idFragmento(dia, indice))
        .set(incrementoDaVisita(visita, dia, (n) => FieldValue.increment(n)), { merge: true });
    } catch (err) {
      console.warn("Nao foi possivel registrar a visita.", err && err.message);
    }
    res.status(204).end();
  }

  async function lerDia(dia) {
    const refs = [];
    for (let i = 0; i < FRAGMENTOS; i++) refs.push(db.collection(COLECAO_FRAGMENTOS).doc(idFragmento(dia, i)));
    const docs = await db.getAll(...refs);
    return somarFragmentos(docs.filter((doc) => doc.exists).map((doc) => doc.data()));
  }

  // Le os fragmentos fora da transacao: ler dentro travaria os documentos que
  // as visitas estao incrementando. A transacao cobre so o resumo.
  async function consolidar() {
    const dia = hoje();
    const resumoRef = db.collection(COLECAO_RESUMO).doc(DOC_RESUMO);
    const anterior = await resumoRef.get();
    const ultimo = anterior.exists ? anterior.data().ultimoDiaConsolidado : null;
    const { dias, ateDia } = diasParaRecalcular(ultimo, dia);
    const lidos = await Promise.all(dias.map(lerDia));
    const recalculados = Object.fromEntries(dias.map((d, i) => [d, lidos[i]]));

    return db.runTransaction(async (t) => {
      const atual = await t.get(resumoRef);
      const novo = consolidarResumo(atual.exists ? atual.data() : null, recalculados, dia, ateDia);
      t.set(resumoRef, { ...novo, atualizadoEm: new Date().toISOString() });
      return visaoDoResumo(novo, dia);
    });
  }

  return { registrar, consolidar, lerDia };
}

module.exports = {
  COLECAO_FRAGMENTOS,
  COLECAO_RESUMO,
  FRAGMENTOS,
  MAX_DIAS_RECALCULO,
  PAGINAS,
  RETENCAO_DIAS,
  SECOES,
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
};
