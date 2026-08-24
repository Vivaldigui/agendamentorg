const crypto = require("crypto");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueCreated, onValueDeleted } = require("firebase-functions/v2/database");
const {
  dataISOValida,
  somarDiasISO,
  segundaDaSemanaISO,
  normalizarAutomacaoSemanal,
  planoSemana,
  proximaSemanaComAtendimento,
  aberturaVigenteDaSemana
} = require("./agenda-automation");
const {
  HORARIOS_NOVOS,
  normalizarHorariosPorDiaSemana,
  horariosParaData,
  horarioPertenceAgenda
} = require("./agenda-grade");
const {
  OPERACAO_AGENDAMENTO_VERSAO,
  OPERACAO_AGENDAMENTO_TTL_MS,
  normalizarOperationId,
  hashPayloadAgendamento,
  resolverOperacaoExistente
} = require("./agendamento-idempotencia");
const {
  CACHE_SEM_ARMAZENAMENTO,
  cacheControlAgendaPublica
} = require("./agenda-cache-publica");

initializeApp();

const db = getFirestore();

// getDatabase() lanca "Can't determine Firebase Database URL" quando o
// FIREBASE_CONFIG do projeto nao traz databaseURL. Em escopo de modulo isso
// derrubaria TODAS as funcoes do arquivo na carga, inclusive o agendamento.
// O Realtime Database so e usado pela telemetria de presenca (hoje desativada),
// entao a inicializacao e adiada: uma URL ausente falha apenas ali.
let _realtimeDb = null;
function obterRealtimeDb() {
  if (!_realtimeDb) _realtimeDb = getDatabase();
  return _realtimeDb;
}
const CANCELAMENTO_TTL_MS = 30 * 60 * 1000;
const DATA_NOVAS_VAGAS_PADRAO = "01/06/2026";
const STATUS_VALIDOS = [
  "agendado",
  "compareceu",
  "vai_voltar",
  "nao_compareceu",
  "cancelado",
  "cancelado_cidadao",
  "cancelado_camara",
  "remarcado"
];
const STATUS_ANONIMIZAR_LGPD = new Set([
  "compareceu",
  "vai_voltar",
  "nao_compareceu",
  "cancelado",
  "cancelado_cidadao",
  "cancelado_camara"
]);
const LGPD_RETENCAO_MESES = 6;
const LGPD_MAX_LEITURAS_POR_EXECUCAO = 5000;
const LGPD_TAMANHO_PAGINA = 250;
const SESSAO_ACESSO_TTL_MS = 24 * 60 * 60 * 1000;
const CONEXAO_ACESSO_MAX_MS = 12 * 60 * 60 * 1000;

const callableOptions = {
  cors: [
    "https://agendamento-cin-itanhandu.web.app",
    "https://agendamento-cin-itanhandu.firebaseapp.com",
    "https://www.itanhandu.cam.mg.gov.br",
    "https://itanhandu.cam.mg.gov.br"
  ],
  maxInstances: 10,
  timeoutSeconds: 120
};

const publicCallableOptions = {
  ...callableOptions,
  enforceAppCheck: true
};

// ATENCAO: esta env var NAO e mais o caminho do pre-aquecimento. Ela so tem
// efeito num `firebase deploy`, que reconstroi conteineres e cria revisao nova
// -- caro e arriscado minutos antes de uma abertura, e que em 24/08/2026 falhou
// por falta de functions/node_modules.
//
// O caminho em uso e o minimo de SERVICO do Cloud Run, aplicado sem build e sem
// revisao nova, pelos scripts em scripts/preaquecer-*.ps1. O valor daqui fica
// como padrao de repouso (zero) e como alternativa caso um dia o pre-aquecimento
// precise viajar junto do deploy.
const PICO_MIN_INSTANCES = Number(process.env.PICO_MIN_INSTANCES) || 0;
// Qualquer pre-aquecimento tem de alcancar a LEITURA tambem. Nos minutos ao
// redor da abertura a resposta publica vale 5s em vez de 60s: o CDN segue
// absorvendo a rajada, mas busca na origem doze vezes mais, e um cold start de
// ~2s numa dessas buscas cai justamente em cima da virada. Esta constante
// tambem configura verificarDisponibilidadeSlotCidadao, no caminho da selecao.
const PICO_MIN_INSTANCES_LEITURA = PICO_MIN_INSTANCES > 0
  ? Math.max(1, Math.ceil(PICO_MIN_INSTANCES / 2))
  : 0;

// O Firestore deste projeto fica em southamerica-east1 e as Functions nasceram
// em us-central1, entao toda leitura e escrita cruzava o continente. Medido em
// 24/08/2026 com instancia quente e cache furado de proposito: ~880ms de
// origem, com apenas 12ms ate a borda do CDN -- ou seja, quase tudo era ida e
// volta ate o banco.
//
// So o caminho critico do pico muda de regiao. As agendadas rodam as 02:00 e
// 07:50, onde latencia nao importa, e duplicar regiao duplicaria os jobs do
// Cloud Scheduler, saindo da franquia de tres. Os gatilhos de RTDB nao podem
// mudar: o banco e uma instancia firebaseio.com, presa a us-central1.
const REGIAO_PICO = "southamerica-east1";

const agendamentoPicoOptions = {
  ...publicCallableOptions,
  region: REGIAO_PICO,
  maxInstances: 80,
  minInstances: PICO_MIN_INSTANCES,
  timeoutSeconds: 300
};

const verificacaoSlotOptions = {
  ...publicCallableOptions,
  region: REGIAO_PICO,
  maxInstances: 50,
  minInstances: PICO_MIN_INSTANCES_LEITURA,
  timeoutSeconds: 30
};
const RATE_LIMIT_VERIFICACAO_FRAGMENTOS = 16;

function normalizarCpf(cpf) {
  const cpfNum = String(cpf || "").replace(/\D/g, "");
  if (cpfNum.length !== 11) {
    throw new HttpsError("invalid-argument", "Informe um CPF valido.");
  }
  if (/^(\d)\1{10}$/.test(cpfNum)) {
    throw new HttpsError("invalid-argument", "Informe um CPF valido.");
  }
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpfNum[i]) * (10 - i);
  let digito1 = 11 - (soma % 11);
  if (digito1 >= 10) digito1 = 0;
  if (parseInt(cpfNum[9]) !== digito1) {
    throw new HttpsError("invalid-argument", "Informe um CPF valido.");
  }
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpfNum[i]) * (11 - i);
  let digito2 = 11 - (soma % 11);
  if (digito2 >= 10) digito2 = 0;
  if (parseInt(cpfNum[10]) !== digito2) {
    throw new HttpsError("invalid-argument", "Informe um CPF valido.");
  }
  return cpfNum;
}

function normalizarTexto(valor, campo, min, max) {
  const texto = String(valor || "").trim().replace(/\s+/g, " ");
  if (texto.length < min || texto.length > max) {
    throw new HttpsError("invalid-argument", `Informe ${campo} corretamente.`);
  }
  return texto;
}

function normalizarTextoOpcional(valor, max) {
  const texto = String(valor || "").trim().replace(/\s+/g, " ");
  if (texto.length > max) {
    throw new HttpsError("invalid-argument", "Texto muito longo.");
  }
  return texto;
}

function normalizarEmail(valor) {
  const email = String(valor || "").trim();
  if (!email) return "";
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Informe um e-mail valido.");
  }
  return email;
}

function normalizarTelefone(valor) {
  const telefone = normalizarTexto(valor, "o telefone", 14, 20);
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 11) {
    throw new HttpsError("invalid-argument", "Informe um telefone valido.");
  }
  return telefone;
}

function normalizarTelefoneOpcional(valor) {
  const telefone = String(valor || "").trim();
  if (!telefone) return "";
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 11) {
    throw new HttpsError("invalid-argument", "Informe um telefone valido.");
  }
  return telefone;
}

function digitosTelefone(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function telefonesConferem(informado, salvo) {
  const a = digitosTelefone(informado);
  const b = digitosTelefone(salvo);
  if (a.length < 10 || b.length < 10) return false;
  return a === b || a.slice(-11) === b.slice(-11);
}

// Chave de rate limit tem de ser a MESMA para todas as grafias do mesmo CPF.
// Passar o texto cru deixava "529...", "a529..." e "529.xxx.xxx-xx" em baldes
// diferentes, e o limite de consulta/cancelamento era contornavel so mudando a
// pontuacao. Nao valida nem lanca: aqui so interessa agrupar.
function digitosCpf(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function normalizarProtocolo(valor) {
  return String(valor || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function formatarCpf(cpfNum) {
  return cpfNum.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function normalizarData(valor, nomeCampo = "data de nascimento") {
  const texto = String(valor || "").trim();
  let ano;
  let mes;
  let dia;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) {
    [dia, mes, ano] = texto.split("/").map(Number);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    [ano, mes, dia] = texto.split("-").map(Number);
  } else {
    throw new HttpsError("invalid-argument", `Informe a ${nomeCampo} corretamente.`);
  }

  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) {
    throw new HttpsError("invalid-argument", `Informe a ${nomeCampo} corretamente.`);
  }

  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function normalizarDataOpcional(valor) {
  const texto = String(valor || "").trim();
  return texto ? normalizarData(texto) : "";
}

function hojeSaoPauloISO() {
  const partes = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const valores = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function agoraSaoPauloInput() {
  const partes = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const valores = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return `${valores.year}-${valores.month}-${valores.day}T${valores.hour}:${valores.minute}`;
}

function dataHoraAgendamentoInput(dataISO, hora) {
  const data = String(dataISO || "");
  const horario = String(hora || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(horario)) return "";
  return `${data}T${horario}`;
}

function horarioAgendamentoFuturo(dataISO, hora, agora = agoraSaoPauloInput()) {
  const dataHora = dataHoraAgendamentoInput(dataISO, hora);
  return Boolean(dataHora && dataHora > agora);
}

function validarAgendamentoPublicoFuturo(dados, mensagem) {
  if (!horarioAgendamentoFuturo(dados && dados.dataISO, dados && dados.hora)) {
    throw new HttpsError("failed-precondition", mensagem || "Este horario ja passou e nao esta mais disponivel pelo site.");
  }
}

function normalizarPublicacaoDatas(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const limpo = {};
  Object.keys(valor).forEach((data) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(data) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(valor[data] || ""))) {
      limpo[data] = String(valor[data]);
    }
  });
  return limpo;
}

async function quantidadeConexoesPublicasAtivas() {
  const snap = await obterRealtimeDb().ref("presenca_publica/conexoes").once("value");
  return snap.numChildren();
}

async function atualizarContagemAcessosAtivos(ativosAgora) {
  const dia = hojeSaoPauloISO();
  const agora = Date.now();
  await obterRealtimeDb().ref("presenca_publica/metricas").transaction((atual) => {
    const base = atual && typeof atual === "object" ? atual : {};
    const mesmoDia = base.dataReferencia === dia;
    return {
      ...base,
      dataReferencia: dia,
      ativosAgora,
      picoHoje: mesmoDia ? Math.max(Number(base.picoHoje) || 0, ativosAgora) : ativosAgora,
      acessosHoje: mesmoDia ? Number(base.acessosHoje) || 0 : 0,
      atualizadoEm: agora
    };
  });
}

function avisoNovasVagasAtivo(agenda, agora = agoraSaoPauloInput()) {
  const avisoProgramado = agenda && agenda.avisoNovasVagasProgramado && typeof agenda.avisoNovasVagasProgramado === "object"
    ? agenda.avisoNovasVagasProgramado
    : null;
  if (avisoProgramado && avisoProgramado.publicarEm && avisoProgramado.publicarEm <= agora && avisoProgramado.dataNovasVagas) {
    return avisoProgramado.dataNovasVagas;
  }
  return (agenda && agenda.dataNovasVagas) || DATA_NOVAS_VAGAS_PADRAO;
}

function normalizarHora(valor) {
  const hora = String(valor || "").trim();
  if (!/^[0-2][0-9]:[0-5][0-9]$/.test(hora)) {
    throw new HttpsError("invalid-argument", "Informe o horario corretamente.");
  }
  return hora;
}

function cpfDocId(cpfNum) {
  return "cpf_" + crypto.createHash("sha256").update(cpfNum).digest("hex");
}

function gerarProtocolo(agendamentoId) {
  const base = String(agendamentoId || crypto.randomBytes(8).toString("hex"))
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
  return `CIN-${base}`;
}

function dataBr(dataISO) {
  const partes = String(dataISO || "").split("-");
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : "";
}

function dataISOParaDate(dataISO) {
  const partes = String(dataISO || "").split("-").map(Number);
  if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n))) return null;
  const data = new Date(partes[0], partes[1] - 1, partes[2]);
  if (data.getFullYear() !== partes[0] || data.getMonth() !== partes[1] - 1 || data.getDate() !== partes[2]) return null;
  return data;
}

function idadeEmAnosNaData(nascimentoISO, referenciaISO) {
  const nascimento = dataISOParaDate(nascimentoISO);
  const referencia = dataISOParaDate(referenciaISO);
  if (!nascimento || !referencia) return null;
  let idade = referencia.getFullYear() - nascimento.getFullYear();
  const fezAniversario = referencia.getMonth() > nascimento.getMonth()
    || (referencia.getMonth() === nascimento.getMonth() && referencia.getDate() >= nascimento.getDate());
  if (!fezAniversario) idade -= 1;
  return idade;
}

function validarIdadeMinimaAgendamento(nascimentoISO, dataISO) {
  // Permite que menores de 3 anos possam marcar pelo sistema.
}

function subtrairMesesISO(dataISO, meses) {
  const partes = String(dataISO || "").split("-").map(Number);
  if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n))) return hojeSaoPauloISO();
  const data = new Date(partes[0], partes[1] - 1, partes[2]);
  data.setMonth(data.getMonth() - meses);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function statusParaAnonimizar(status) {
  return STATUS_ANONIMIZAR_LGPD.has(String(status || ""));
}

function cpfNumeros(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function nomeSeguro(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "Cidadao";
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[partes.length - 1].charAt(0)}.`;
}

function respostaPublica(dados) {
  return {
    nome: String(dados.nome || "").trim() || "Cidadao",
    dataISO: dados.dataISO || "",
    dataBR: dataBr(dados.dataISO),
    hora: dados.hora || "",
    protocolo: dados.protocolo || "",
    status: STATUS_VALIDOS.includes(dados.status) ? dados.status : "agendado"
  };
}

function agendamentoEstaAtivo(dados) {
  if (dados && dados.ativo === false) return false;
  const status = String(dados && dados.status || "agendado");
  return !["cancelado", "cancelado_cidadao", "cancelado_camara", "remarcado"].includes(status);
}

function slotRepresentaOcupacaoAtual(slotExiste, dadosSlot, agendamentoExiste, dadosAgendamento) {
  if (!slotExiste) return false;
  if (!dadosSlot || !dadosSlot.agendamentoId) return true;
  return agendamentoExiste && agendamentoEstaAtivo(dadosAgendamento);
}

function agendamentoCorrespondeAoPedido(dados, pedido) {
  if (!dados || !pedido) return false;
  return String(dados.nome || "").trim().replace(/\s+/g, " ") === pedido.nome &&
    cpfNumeros(dados.cpf) === pedido.cpfNum &&
    digitosTelefone(dados.telefone) === digitosTelefone(pedido.telefone) &&
    String(dados.email || "").trim().toLowerCase() === String(pedido.email || "").trim().toLowerCase() &&
    dados.dataNasc === pedido.dataNasc &&
    dados.dataISO === pedido.dataISO &&
    dados.hora === pedido.hora;
}

function normalizarBloqueadoAte(valor) {
  if (!valor) return null;
  if (typeof valor === "string") {
    const texto = valor.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
      return {
        ativo: texto > hojeSaoPauloISO(),
        dataLiberacao: dataBr(texto),
        comparador: new Date(`${texto}T23:59:59-03:00`).getTime()
      };
    }
    const data = new Date(texto);
    if (!Number.isNaN(data.getTime())) {
      return {
        ativo: data.getTime() > Date.now(),
        dataLiberacao: data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        comparador: data.getTime()
      };
    }
  }
  if (valor && typeof valor.toDate === "function") {
    const data = valor.toDate();
    return {
      ativo: data.getTime() > Date.now(),
      dataLiberacao: data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      comparador: data.getTime()
    };
  }
  return null;
}

async function buscarBloqueioAtivoCpf(cpfNum) {
  const candidatos = [];
  const [docBloqueio, snapCadastro] = await comRetry(() => Promise.all([
    db.collection("bloqueios_agendamento").doc(cpfNum).get(),
    db.collection("dados_cidadaos")
      .where("bloqueioCpf", "==", cpfNum)
      .limit(10)
      .get()
  ]));
  if (docBloqueio.exists) candidatos.push(docBloqueio.data());
  snapCadastro.docs.forEach((doc) => candidatos.push(doc.data()));

  return candidatos
    .filter((dados) => dados && dados.liberado !== true && dados.bloqueioLiberado !== true && dados.bloqueioAtivo !== false)
    .map((dados) => normalizarBloqueadoAte(dados.bloqueadoAte))
    .filter((bloqueio) => bloqueio && bloqueio.ativo)
    .sort((a, b) => b.comparador - a.comparador)[0] || null;
}

function mensagemCpfBloqueado(bloqueio) {
  return `Nao foi possivel realizar novo agendamento.\n\nConsta ausencia em atendimento anterior.\nNovo agendamento permitido a partir de ${bloqueio.dataLiberacao}.\n\nEm caso de justificativa, entre em contato com a Camara Municipal.`;
}

async function assertAdmin(request) {
  const email = String(request.auth && request.auth.token && request.auth.token.email || "").trim().toLowerCase();
  if (!email) {
    throw new HttpsError("permission-denied", "Acesso administrativo negado.");
  }
  const adminDoc = await db.collection("admins").doc(email).get();
  if (!adminDoc.exists || adminDoc.data().ativo !== true) {
    throw new HttpsError("permission-denied", "Acesso administrativo negado.");
  }
  return email;
}

function fingerprintRequisicao(request, extra = "") {
  const raw = request.rawRequest || {};
  const forwarded = String(raw.headers && raw.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || raw.ip || "sem-ip";
  const userAgent = raw.headers && raw.headers["user-agent"] ? String(raw.headers["user-agent"]).slice(0, 120) : "";
  return crypto.createHash("sha256").update(`${ip}|${userAgent}|${extra}`).digest("hex");
}

function ipOrigemConfiavel(request) {
  const raw = request.rawRequest || {};
  const encaminhados = String(raw.headers && raw.headers["x-forwarded-for"] || "")
    .split(",")
    .map((valor) => valor.trim())
    .filter(Boolean);
  // O balanceador acrescenta <client-ip>,<load-balancer-ip> ao final. Valores
  // anteriores podem ter sido fornecidos pelo chamador e nao entram no limite.
  const ipDoCliente = encaminhados.length >= 2 ? encaminhados[encaminhados.length - 2] : "";
  return String(ipDoCliente || raw.ip || "sem-ip").trim().slice(0, 128) || "sem-ip";
}

function fingerprintOrigemRequisicao(request, extra = "") {
  const ip = ipOrigemConfiavel(request);
  return crypto.createHash("sha256").update(`${ip}|${extra}`).digest("hex");
}

function fragmentoRateLimitVerificacao(sessaoId) {
  const hash = crypto.createHash("sha256").update(sessaoId).digest("hex");
  return parseInt(hash.slice(0, 8), 16) % RATE_LIMIT_VERIFICACAO_FRAGMENTOS;
}

async function comRetry(fn, { tentativas = 3, baseMs = 200 } = {}) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimoErro = e;
      if (e instanceof HttpsError) throw e;
      const codigo = e && (e.code || e.status);
      const transiente =
        codigo === 4 || codigo === 8 || codigo === 10 || codigo === 13 || codigo === 14 ||
        codigo === "deadline-exceeded" || codigo === "unavailable" || codigo === "aborted" ||
        codigo === "internal" || codigo === "resource-exhausted" ||
        (e && typeof e.message === "string" && /deadline|unavailable|timeout|ECONNRESET|ETIMEDOUT/i.test(e.message));
      if (!transiente || i === tentativas - 1) throw e;
      const espera = baseMs * Math.pow(2, i) + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimoErro;
}

async function aplicarRateLimitComFingerprint(fingerprint, acao, limite, janelaMs) {
  const chave = crypto.createHash("sha256")
    .update(`${acao}|${fingerprint}`)
    .digest("hex");
  const ref = db.collection("rate_limits").doc(chave);
  const agora = Date.now();

  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const dados = doc.exists ? doc.data() : {};
    const inicio = typeof dados.inicio === "number" ? dados.inicio : 0;
    const contagemAtual = typeof dados.contagem === "number" ? dados.contagem : 0;
    const dentroDaJanela = inicio && (agora - inicio) < janelaMs;
    const proximaContagem = dentroDaJanela ? contagemAtual + 1 : 1;

    if (dentroDaJanela && proximaContagem > limite) {
      throw new HttpsError("resource-exhausted", "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.");
    }

    t.set(ref, {
      acao,
      inicio: dentroDaJanela ? inicio : agora,
      contagem: proximaContagem,
      expiraEm: Timestamp.fromMillis(agora + janelaMs),
      atualizadoEm: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function aplicarRateLimit(request, acao, limite, janelaMs, extra = "") {
  return aplicarRateLimitComFingerprint(
    fingerprintRequisicao(request, extra),
    acao,
    limite,
    janelaMs
  );
}

async function aplicarRateLimitOrigem(request, acao, limite, janelaMs, extra = "") {
  return aplicarRateLimitComFingerprint(
    fingerprintOrigemRequisicao(request, extra),
    acao,
    limite,
    janelaMs
  );
}

async function anonimizarDadosAntigosLGPD() {
  const corte = subtrairMesesISO(hojeSaoPauloISO(), LGPD_RETENCAO_MESES);
  let ultimoDoc = null;
  let totalLidos = 0;
  let totalAnonimizados = 0;
  let totalCpfMapsRemovidos = 0;

  while (totalLidos < LGPD_MAX_LEITURAS_POR_EXECUCAO) {
    let query = db.collection("dados_cidadaos")
      .where("dataISO", "<=", corte)
      .orderBy("dataISO")
      .limit(Math.min(LGPD_TAMANHO_PAGINA, LGPD_MAX_LEITURAS_POR_EXECUCAO - totalLidos));
    if (ultimoDoc) query = query.startAfter(ultimoDoc);

    const snap = await query.get();
    if (snap.empty) break;
    totalLidos += snap.size;
    ultimoDoc = snap.docs[snap.docs.length - 1];

    let batch = db.batch();
    let operacoes = 0;

    const commitSeNecessario = async (forcar = false) => {
      if (!operacoes || (!forcar && operacoes < 430)) return;
      await batch.commit();
      batch = db.batch();
      operacoes = 0;
    };

    for (const doc of snap.docs) {
      const dados = doc.data();
      if (dados.anonimizadoLGPD === true || !statusParaAnonimizar(dados.status)) continue;

      const cpfNum = cpfNumeros(dados.cpf);
      if (dados.status === "nao_compareceu" && cpfNum.length === 11 && dados.bloqueadoAte) {
        batch.set(
          db.collection("bloqueios_agendamento").doc(cpfNum),
          {
            cpf: cpfNum,
            bloqueadoAte: dados.bloqueadoAte,
            motivoBloqueio: "nao_compareceu",
            migradoDeAnonimizacao: true,
            criadoEm: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        operacoes += 1;
      }
      batch.set(doc.ref, {
        nome: "ANONIMIZADO",
        cpf: FieldValue.delete(),
        telefone: FieldValue.delete(),
        email: FieldValue.delete(),
        dataNasc: FieldValue.delete(),
        nascimento: FieldValue.delete(),
        bloqueioCpf: FieldValue.delete(),
        bloqueioNome: FieldValue.delete(),
        bloqueioTelefone: FieldValue.delete(),
        anonimizadoLGPD: true,
        anonimizadoLGPDEm: FieldValue.serverTimestamp(),
        anonimizadoLGPDCorte: corte
      }, { merge: true });
      operacoes += 1;

      if (cpfNum.length === 11) {
        batch.delete(db.collection("cpfs_agendados").doc(cpfDocId(cpfNum)));
        batch.delete(db.collection("cpfs_agendados").doc(cpfNum));
        operacoes += 2;
        totalCpfMapsRemovidos += 2;
      }

      totalAnonimizados += 1;
      await commitSeNecessario();
    }

    await commitSeNecessario(true);
    if (snap.size < LGPD_TAMANHO_PAGINA) break;
  }

  if (totalAnonimizados > 0) {
    await db.collection("configuracoes").doc("estatisticas").set({
      totalAtendimentosHistorico: FieldValue.increment(totalAnonimizados),
      ultimaAtualizacao: new Date().toISOString()
    }, { merge: true });
  }

  await db.collection("logs_admin").add({
    acao: "anonimizacao_lgpd",
    detalhes: {
      corte,
      mesesRetencao: LGPD_RETENCAO_MESES,
      totalLidos,
      totalAnonimizados,
      totalCpfMapsRemovidos,
      totalAtendimentosHistorico: totalAnonimizados
    },
    adminEmail: "sistema",
    criadoEm: FieldValue.serverTimestamp(),
    criado: new Date().toISOString()
  });

  return { corte, totalLidos, totalAnonimizados, totalCpfMapsRemovidos };
}

// `agora` e `hoje` sao parametros para que a leitura publica use um unico
// instante em todo o pedido: corpo, filtro de publicacao e Cache-Control
// precisam cair do mesmo lado da virada das 08:00.
function processarAgenda(dadosBrutos, agora = agoraSaoPauloInput(), hoje = hojeSaoPauloISO()) {
  const agenda = dadosBrutos || {};
  // Agenda vazia significa agenda fechada, nunca "use uma lista embutida". O
  // fallback anterior (DIAS_INICIAIS) so era inofensivo porque todas as suas
  // datas ja tinham passado: bastava alguem colar uma data futura ali para o
  // site publicar vagas que a recepcao nunca cadastrou. E `dias` fica vazio
  // todo fim de semana, entao esse caminho e percorrido o tempo todo.
  const dias = Array.isArray(agenda.dias) ? agenda.dias : [];
  const publicacaoDatas = normalizarPublicacaoDatas(agenda.publicacaoDatas);
  return {
    dias: dias.filter((dia) => typeof dia === "string" && dia >= hoje && (!publicacaoDatas[dia] || publicacaoDatas[dia] <= agora)).sort(),
    // Campo mantido por compatibilidade. A grade efetiva e sempre resolvida por data.
    horarios: [...HORARIOS_NOVOS],
    horariosPorDiaSemana: normalizarHorariosPorDiaSemana(agenda.horariosPorDiaSemana),
    dataNovasVagas: avisoNovasVagasAtivo(agenda, agora),
    // Necessarios para decidir se a resposta publica pode ser armazenada. A
    // automacao entra porque a janela de abertura nao pode depender de
    // publicacaoDatas ja ter sido gravada pelas execucoes de 07:50/07:55.
    publicacaoDatas,
    automacaoSemanal: normalizarAutomacaoSemanal(agenda.automacaoSemanal)
  };
}

const AGENDA_REF = () => db.collection("configuracoes").doc("agenda");

async function carregarAgenda(agora = agoraSaoPauloInput(), hoje = hojeSaoPauloISO()) {
  const agendaDoc = await comRetry(() => AGENDA_REF().get());
  return processarAgenda(agendaDoc.exists ? agendaDoc.data() : {}, agora, hoje);
}

function checarDisponibilidade(agenda, dataISO, hora) {
  if (dataISO < hojeSaoPauloISO()) {
    throw new HttpsError("failed-precondition", "Data indisponivel para agendamento.");
  }
  if (!horarioPertenceAgenda(agenda, dataISO, hora)) {
    throw new HttpsError("failed-precondition", "Horario indisponivel para agendamento.");
  }
  if (!horarioAgendamentoFuturo(dataISO, hora)) {
    throw new HttpsError("failed-precondition", "Este horario ja passou. Escolha outro horario disponivel.");
  }
}

async function validarSlotDisponivel(dataISO, hora) {
  const agenda = await carregarAgenda();
  checarDisponibilidade(agenda, dataISO, hora);
}

function bloqueioAtivoDeDoc(dados) {
  if (!dados) return null;
  if (dados.liberado === true || dados.bloqueioLiberado === true || dados.bloqueioAtivo === false) return null;
  const bloqueio = normalizarBloqueadoAte(dados.bloqueadoAte);
  return bloqueio && bloqueio.ativo ? bloqueio : null;
}

async function buscarPorCpfDireto(cpfNum, dataNasc) {
  const possiveisCpfs = [formatarCpf(cpfNum), cpfNum];

  for (const cpf of possiveisCpfs) {
    const snap = await db.collection("dados_cidadaos")
      .where("cpf", "==", cpf)
      .limit(5)
      .get();

    const encontrado = snap.docs.find((doc) => doc.data().dataNasc === dataNasc && agendamentoEstaAtivo(doc.data()));
    if (encontrado) {
      return {
        agendamentoId: encontrado.id,
        cpfDocIds: [cpfDocId(cpfNum), cpfNum],
        slotId: encontrado.data().slotId || encontrado.id,
        dados: encontrado.data()
      };
    }
  }

  return null;
}

function vagaContaNoSite(vaga) {
  return vaga && vaga.contabilizaVaga !== false && vaga.origem !== "manual";
}

async function carregarDisponibilidadePublica() {
  // Instante unico do pedido. Capturado antes das leituras de proposito: se o
  // relogio virar durante a consulta, o cabecalho fica conservador (janela sem
  // cache um pouco maior) em vez de liberar o armazenamento cedo demais.
  const agora = agoraSaoPauloInput();
  const hoje = hojeSaoPauloISO();
  const agenda = await carregarAgenda(agora, hoje);
  const vagasSnap = await db.collection("vagas_ocupadas").where("dataISO", ">=", hoje).get();
  const ocupados = new Set();

  vagasSnap.docs.forEach((doc) => {
    const vaga = doc.data();
    if (vagaContaNoSite(vaga) && agenda.dias.includes(vaga.dataISO) && horariosParaData(agenda, vaga.dataISO).includes(vaga.hora)) {
      ocupados.add(`${vaga.dataISO}_${vaga.hora}`);
    }
  });

  const dias = agenda.dias.map((dataISO) => {
    const horariosDia = horariosParaData(agenda, dataISO);
    const horarios = horariosDia.map((hora) => {
      const horarioFuturo = horarioAgendamentoFuturo(dataISO, hora, agora);
      return {
        hora,
        disponivel: horarioFuturo && !ocupados.has(`${dataISO}_${hora}`)
      };
    });
    const vagas = horarios.filter((item) => item.disponivel).length;
    return {
      dataISO,
      vagas,
      lotado: vagas <= 0,
      horarios
    };
  });

  return {
    payload: {
      dias,
      horarios: agenda.horarios,
      dataNovasVagas: agenda.dataNovasVagas,
      servidorEm: agora,
      totalVagasRestantes: dias.reduce((total, dia) => total + dia.vagas, 0)
    },
    // O prazo e contado da emissao (agora, depois das leituras), mas a
    // publicacao a evitar e a que o corpo ainda esconde (agora, antes delas).
    cacheControl: cacheControlAgendaPublica(
      agora,
      agoraSaoPauloInput(),
      agenda.publicacaoDatas,
      agenda.automacaoSemanal
    )
  };
}

exports.carregarAgendaPublicaHttp = onRequest({
  cors: callableOptions.cors,
  region: REGIAO_PICO,
  maxInstances: 50,
  minInstances: PICO_MIN_INSTANCES_LEITURA
}, async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ erro: "Metodo nao permitido." });
    return;
  }

  try {
    // 600 e nao 240: com dois URLs ativos (com e sem a chave do minuto) e TTL
    // de 5s na janela de virada, o envelope teorico de buscas na origem chega a
    // ~240 por 10 min, encostando no limite antigo. A leitura e idempotente e
    // fica atras do CDN, entao a folga custa pouco e evita 429 no pico.
    await aplicarRateLimit({ rawRequest: req }, "carregar_agenda_publica_http", 600, 10 * 60 * 1000);
    const { payload, cacheControl } = await carregarDisponibilidadePublica();
    // Cabecalho derivado do mesmo instante que montou o corpo.
    res.set("Cache-Control", cacheControl);
    res.status(200).json(payload);
  } catch (err) {
    const status = err && err.code === "resource-exhausted" ? 429 : 500;
    // Um erro gravado no CDN sob a chave do minuto da abertura seria tao
    // danoso quanto uma agenda fechada armazenada.
    res.set("Cache-Control", CACHE_SEM_ARMAZENAMENTO);
    res.status(status).json({ erro: err && err.message ? err.message : "Erro ao carregar agenda publica." });
  }
});

exports.verificarDisponibilidadeSlotCidadao = onCall(verificacaoSlotOptions, async (request) => {
  const dataISO = normalizarData(request.data && request.data.data, "data do agendamento");
  const hora = normalizarHora(request.data && request.data.hora);
  const sessaoId = normalizarSessaoVerificacaoPublica(request.data && request.data.sessaoId);
  // O identificador do navegador escolhe apenas um de 16 fragmentos fixos. Mesmo
  // rotacionando o valor, uma origem nao cria buckets ilimitados nem supera o teto
  // agregado de 2.000 verificacoes por janela (16 x 125).
  const fragmento = fragmentoRateLimitVerificacao(sessaoId);
  await aplicarRateLimitOrigem(
    request,
    "verificar_disponibilidade_slot_origem",
    125,
    10 * 60 * 1000,
    `fragmento_${fragmento}`
  );
  await validarSlotDisponivel(dataISO, hora);

  const slotRef = db.collection("vagas_ocupadas").doc(`${dataISO}_${hora}`);
  const slotDoc = await slotRef.get();
  let agendamentoDoc = null;
  const agendamentoId = slotDoc.exists && slotDoc.data().agendamentoId;
  if (agendamentoId) {
    agendamentoDoc = await db.collection("dados_cidadaos").doc(agendamentoId).get();
  }

  const ocupado = slotRepresentaOcupacaoAtual(
    slotDoc.exists,
    slotDoc.exists ? slotDoc.data() : null,
    Boolean(agendamentoDoc && agendamentoDoc.exists),
    agendamentoDoc && agendamentoDoc.exists ? agendamentoDoc.data() : null
  );

  return {
    dataISO,
    hora,
    disponivel: !ocupado,
    verificadoEm: new Date().toISOString()
  };
});

exports.verificarBloqueioCpf = onCall(publicCallableOptions, async (request) => {
  const cpfNum = normalizarCpf(request.data && request.data.cpf);
  await aplicarRateLimit(request, "verificar_bloqueio_cpf", 40, 10 * 60 * 1000, cpfNum);
  const bloqueio = await buscarBloqueioAtivoCpf(cpfNum);
  if (!bloqueio) return { bloqueado: false };
  return {
    bloqueado: true,
    dataLiberacao: bloqueio.dataLiberacao,
    mensagem: mensagemCpfBloqueado(bloqueio)
  };
});

// Mensagem unica de propósito: distinguir "fator errado" de "agendamento
// inexistente" confirmaria que aquele CPF tem agendamento, e a enumeracao
// voltaria pela porta dos fundos.
const ERRO_SEM_AGENDAMENTO = "Nenhum agendamento encontrado com os dados informados.";

function validarFatorExtra(dados, telefoneInformado, protocoloInformado) {
  // A guarda anterior era `if (!dados.protocolo) return`, e ela nao devolvia
  // apenas os agendamentos antigos ao comportamento antigo: ignorava TAMBEM o
  // telefone gravado. Ou seja, para todo documento sem protocolo, CPF mais data
  // de nascimento continuavam bastando para consultar e cancelar -- o bypass
  // inteiro seguia aberto. Em 24/08/2026 isso valia para os 40 agendamentos
  // ativos, que eram todos anteriores a gravacao de protocolo.
  //
  // Agora o criterio e o fator que o documento de fato tem:
  //   protocolo + telefone -> qualquer um dos dois serve
  //   so protocolo         -> protocolo (telefonesConferem exige 10+ digitos dos dois lados)
  //   so telefone          -> telefone
  //   nenhum dos dois      -> recusa; o cidadao resolve pela recepcao
  //
  // A ultima linha e a unica que tranca alguem. Conferido em producao antes de
  // implantar: zero agendamentos ativos futuros sem protocolo e sem telefone.
  const protocoloSalvo = normalizarProtocolo(dados && dados.protocolo);
  const temTelefoneSalvo = digitosTelefone(dados && dados.telefone).length >= 10;
  if (!protocoloSalvo && !temTelefoneSalvo) {
    throw new HttpsError("not-found", ERRO_SEM_AGENDAMENTO);
  }

  const protocolo = normalizarProtocolo(protocoloInformado);
  const temProtocoloValido = Boolean(protocoloSalvo) && protocolo === protocoloSalvo;
  const temTelefoneValido = telefonesConferem(telefoneInformado, dados && dados.telefone);

  if (!temProtocoloValido && !temTelefoneValido) {
    throw new HttpsError("not-found", ERRO_SEM_AGENDAMENTO);
  }
}

async function localizarAgendamento(cpfInformado, nascimentoInformado, opcoes = {}) {
  const cpfNum = normalizarCpf(cpfInformado);
  const dataNasc = normalizarData(nascimentoInformado);
  const cpfHashId = cpfDocId(cpfNum);

  let cpfSnap = await db.collection("cpfs_agendados").doc(cpfHashId).get();
  let cpfDocIds = [cpfHashId];

  if (!cpfSnap.exists) {
    cpfSnap = await db.collection("cpfs_agendados").doc(cpfNum).get();
    cpfDocIds.push(cpfNum);
  }

  if (!cpfSnap.exists) {
    const porCpf = await buscarPorCpfDireto(cpfNum, dataNasc);
    if (porCpf) {
      return porCpf;
    }
    throw new HttpsError("not-found", "Nenhum agendamento encontrado com os dados informados.");
  }

  const agendamentoId = cpfSnap.data().agendamentoId;
  if (!agendamentoId) {
    throw new HttpsError("not-found", "Nenhum agendamento encontrado com os dados informados.");
  }

  const agDoc = await db.collection("dados_cidadaos").doc(agendamentoId).get();
  if (!agDoc.exists || agDoc.data().dataNasc !== dataNasc || !agendamentoEstaAtivo(agDoc.data())) {
    throw new HttpsError("not-found", "Nenhum agendamento encontrado com os dados informados.");
  }

  const dados = agDoc.data();
  return {
    agendamentoId,
    cpfDocIds: [...new Set([...cpfDocIds, cpfHashId, cpfNum])],
    slotId: dados.slotId || cpfSnap.data().slotId || `${dados.dataISO}_${dados.hora}`,
    dados
  };
}

exports.consultarAgendamentoCidadao = onCall(publicCallableOptions, async (request) => {
  await aplicarRateLimit(request, "consultar_agendamento", 8, 10 * 60 * 1000, digitosCpf(request.data && request.data.cpf));
  const encontrado = await localizarAgendamento(request.data.cpf, request.data.nascimento);
  // Campo unico no site: a pessoa digita telefone OU protocolo e as duas
  // comparacoes sao tentadas. Um telefone exige 10+ digitos e um protocolo
  // comeca por CIN-, entao nao ha como um valor casar pelo criterio errado.
  validarFatorExtra(encontrado.dados, request.data.fatorExtra, request.data.fatorExtra);
  validarAgendamentoPublicoFuturo(encontrado.dados, "Este agendamento ja passou do horario e nao pode mais ser consultado pelo site.");
  return {
    encontrado: true,
    agendamento: respostaPublica(encontrado.dados)
  };
});

function normalizarOperationIdPublico(valor) {
  try {
    return normalizarOperationId(valor);
  } catch (_) {
    throw new HttpsError(
      "invalid-argument",
      "Esta pagina esta desatualizada. Recarregue-a antes de tentar agendar."
    );
  }
}

function normalizarSessaoVerificacaoPublica(valor) {
  try {
    return normalizarOperationId(valor);
  } catch (_) {
    throw new HttpsError(
      "invalid-argument",
      "Identificador de sessao invalido. Recarregue a pagina e tente novamente."
    );
  }
}

function resolverResultadoOperacaoAgendamento(dados, payloadHash) {
  try {
    return resolverOperacaoExistente(dados, payloadHash);
  } catch (err) {
    if (err && err.code === "operacao-conflitante") {
      throw new HttpsError(
        "failed-precondition",
        "Esta tentativa de agendamento ja foi associada a outros dados. Recarregue a pagina."
      );
    }
    throw new HttpsError(
      "internal",
      "Nao foi possivel validar com seguranca esta tentativa de agendamento."
    );
  }
}

exports.criarAgendamentoCidadao = onCall(agendamentoPicoOptions, async (request) => {
  const dadosRequisicao = request.data || {};
  const nome = normalizarTexto(dadosRequisicao.nome, "o nome completo", 5, 120);
  const cpfNum = normalizarCpf(dadosRequisicao.cpf);
  const telefone = normalizarTelefone(dadosRequisicao.telefone);
  const email = normalizarEmail(dadosRequisicao.email);
  const dataNasc = normalizarData(dadosRequisicao.nascimento);
  const dataISO = normalizarData(dadosRequisicao.data, "data do agendamento");
  const hora = normalizarHora(dadosRequisicao.hora);
  // CONTENCAO B4. O booleano vinha do cliente e nada ligava quem chamava ao CPF
  // informado: com substituirAnterior=true bastava conhecer um CPF para liberar a
  // vaga da vitima, inativar o agendamento dela e criar outro com dados proprios.
  // Ate existir prova de titularidade (token emitido apos autenticacao real do
  // agendamento), a substituicao fica desativada e o cidadao precisa cancelar antes.
  const substituirAnterior = false;
  const operationIdInformado = typeof dadosRequisicao.operationId === "string"
    && dadosRequisicao.operationId.trim() !== "";
  const operationId = operationIdInformado
    ? normalizarOperationIdPublico(dadosRequisicao.operationId)
    : crypto.randomBytes(16).toString("hex");
  validarIdadeMinimaAgendamento(dataNasc, dataISO);

  const payloadHash = hashPayloadAgendamento({
    operationId,
    nome,
    cpfNum,
    telefone,
    email,
    dataNasc,
    dataISO,
    hora,
    substituirAnterior
  });
  const operacaoRef = db.collection("operacoes_agendamento").doc(operationId);
  const operacaoExistenteDoc = await operacaoRef.get();
  if (operacaoExistenteDoc.exists) {
    await aplicarRateLimit(request, "repetir_agendamento", 60, 10 * 60 * 1000, operationId);
    return resolverResultadoOperacaoAgendamento(operacaoExistenteDoc.data(), payloadHash);
  }

  await aplicarRateLimit(request, "criar_agendamento", 20, 10 * 60 * 1000, cpfNum);
  const bloqueio = await buscarBloqueioAtivoCpf(cpfNum);
  if (bloqueio) {
    throw new HttpsError("failed-precondition", mensagemCpfBloqueado(bloqueio));
  }

  const cpfFormatado = formatarCpf(cpfNum);
  const cpfHashId = cpfDocId(cpfNum);
  const slotId = `${dataISO}_${hora}`;
  await validarSlotDisponivel(dataISO, hora);

  const criado = new Date().toISOString();
  const agendamentoRef = db.collection("dados_cidadaos").doc();
  // Segundo fator do agendamento do cidadao. Sem protocolo gravado,
  // validarFatorExtra devolve cedo e CPF + nascimento continuam bastando para
  // consultar e cancelar o agendamento de qualquer pessoa.
  const protocolo = gerarProtocolo(agendamentoRef.id);
  const slotRef = db.collection("vagas_ocupadas").doc(slotId);
  const cpfRef = db.collection("cpfs_agendados").doc(cpfHashId);
  const cpfLegadoRef = db.collection("cpfs_agendados").doc(cpfNum);
  const bloqueioRef = db.collection("bloqueios_agendamento").doc(cpfNum);
  const agendaRef = AGENDA_REF();
  const expiraEmOperacao = Timestamp.fromMillis(Date.now() + OPERACAO_AGENDAMENTO_TTL_MS);

  const resultadoTransacao = await db.runTransaction(async (t) => {
    const operacaoDoc = await t.get(operacaoRef);
    if (operacaoDoc.exists) {
      return resolverResultadoOperacaoAgendamento(operacaoDoc.data(), payloadHash);
    }

    const [slotDoc, cpfDoc, cpfLegadoDoc, bloqueioDoc, agendaDoc] = await Promise.all([
      t.get(slotRef),
      t.get(cpfRef),
      t.get(cpfLegadoRef),
      t.get(bloqueioRef),
      t.get(agendaRef)
    ]);

    const bloqueioRevalidado = bloqueioDoc.exists ? bloqueioAtivoDeDoc(bloqueioDoc.data()) : null;
    if (bloqueioRevalidado) {
      throw new HttpsError("failed-precondition", mensagemCpfBloqueado(bloqueioRevalidado));
    }

    checarDisponibilidade(processarAgenda(agendaDoc.exists ? agendaDoc.data() : {}), dataISO, hora);

    let slotOcupado = slotDoc.exists;
    let limparSlotObsoleto = false;
    let agSlotDoc = null;
    if (slotDoc.exists && slotDoc.data().agendamentoId) {
      agSlotDoc = await t.get(db.collection("dados_cidadaos").doc(slotDoc.data().agendamentoId));
      if (!agSlotDoc.exists || !agendamentoEstaAtivo(agSlotDoc.data())) {
        slotOcupado = false;
        limparSlotObsoleto = true;
      }
    }

    if (slotOcupado) {
      if (!operationIdInformado && agSlotDoc && agSlotDoc.exists && agendamentoCorrespondeAoPedido(agSlotDoc.data(), {
        nome,
        cpfNum,
        telefone,
        email,
        dataNasc,
        dataISO,
        hora
      })) {
        return {
          agendamento: {
            id: agSlotDoc.id,
            dataISO,
            dataBR: dataBr(dataISO),
            hora,
            protocolo: agSlotDoc.data().protocolo || ""
          },
          substituiu: null
        };
      }
      throw new HttpsError("already-exists", "Este horario foi preenchido por outra pessoa. Escolha outro horario.");
    }

    const cpfRefs = [
      { ref: cpfRef, doc: cpfDoc },
      { ref: cpfLegadoRef, doc: cpfLegadoDoc }
    ].filter((item, index, lista) => item.doc.exists && lista.findIndex((outro) => outro.ref.path === item.ref.path) === index);

    let agendamentoAtivoExistente = null;
    let agendamentoAtivoExistenteRef = null;
    const cpfRefsObsoletos = [];
    for (const item of cpfRefs) {
      const agendamentoId = item.doc.data().agendamentoId;
      if (!agendamentoId) {
        cpfRefsObsoletos.push(item.ref);
        continue;
      }
      const agRef = db.collection("dados_cidadaos").doc(agendamentoId);
      const agCpfDoc = await t.get(agRef);
      if (agCpfDoc.exists && agendamentoEstaAtivo(agCpfDoc.data())) {
        if (!agendamentoAtivoExistente) {
          agendamentoAtivoExistente = agCpfDoc.data();
          agendamentoAtivoExistenteRef = agRef;
        }
      } else {
        cpfRefsObsoletos.push(item.ref);
      }
    }

    if (agendamentoAtivoExistente && !substituirAnterior) {
      // CONTENCAO B4. Nao devolver data e hora: quem chama provou apenas conhecer
      // um CPF, e isso revelava quando a pessoa sera atendida. Para ver ou cancelar
      // o proprio agendamento o cidadao usa a consulta, que exige data de nascimento.
      throw new HttpsError(
        "already-exists",
        "Este CPF ja possui um agendamento ativo. Use \"Consultar meu agendamento\" para ver os detalhes ou cancelar.",
        { tipo: "cpf-ja-agendado" }
      );
    }

    let agendamentoSubstituido = null;
    if (agendamentoAtivoExistente && substituirAnterior) {
      const slotAntigoId = agendamentoAtivoExistente.slotId || `${agendamentoAtivoExistente.dataISO}_${agendamentoAtivoExistente.hora}`;
      if (slotAntigoId && slotAntigoId !== slotId && slotAntigoId !== "undefined_undefined") {
        t.delete(db.collection("vagas_ocupadas").doc(slotAntigoId));
      }
      t.set(agendamentoAtivoExistenteRef, {
        status: "remarcado",
        canceladoEm: criado,
        canceladoPor: "cidadao_substituicao",
        statusAtualizadoEm: criado,
        ativo: false,
        remarcadoParaAgendamentoId: agendamentoRef.id
      }, { merge: true });
      agendamentoSubstituido = {
        id: agendamentoAtivoExistenteRef.id,
        dataISO: agendamentoAtivoExistente.dataISO,
        dataBR: dataBr(agendamentoAtivoExistente.dataISO),
        hora: agendamentoAtivoExistente.hora
      };
    }

    if (limparSlotObsoleto) t.delete(slotRef);
    cpfRefsObsoletos.forEach((ref) => t.delete(ref));

    const resultado = {
      agendamento: {
        id: agendamentoRef.id,
        dataISO,
        dataBR: dataBr(dataISO),
        hora,
        protocolo
      },
      substituiu: agendamentoSubstituido
    };

    t.set(slotRef, { dataISO, hora, contabilizaVaga: true, origem: "publico", agendamentoId: agendamentoRef.id, criado });
    t.set(cpfRef, { agendamentoId: agendamentoRef.id, slotId, criado });
    t.set(agendamentoRef, {
      nome,
      cpf: cpfFormatado,
      telefone,
      email,
      dataNasc,
      dataISO,
      hora,
      slotId,
      protocolo,
      status: "agendado",
      criado,
      statusAtualizadoEm: criado
    });
    t.create(operacaoRef, {
      tipo: "criar_agendamento",
      versao: OPERACAO_AGENDAMENTO_VERSAO,
      payloadHash,
      resultado,
      agendamentoId: agendamentoRef.id,
      criadoEm: FieldValue.serverTimestamp(),
      expiraEm: expiraEmOperacao
    });

    return resultado;
  });

  return resultadoTransacao;
});

exports.prepararCancelamentoCidadao = onCall(publicCallableOptions, async (request) => {
  await aplicarRateLimit(request, "preparar_cancelamento", 6, 10 * 60 * 1000, digitosCpf(request.data && request.data.cpf));
  const cpfNum = normalizarCpf(request.data.cpf);
  const encontrado = await localizarAgendamento(request.data.cpf, request.data.nascimento);
  validarFatorExtra(encontrado.dados, request.data.fatorExtra, request.data.fatorExtra);
  validarAgendamentoPublicoFuturo(encontrado.dados, "Este agendamento ja passou do horario e nao pode mais ser cancelado pelo site.");
  const token = crypto.randomBytes(32).toString("hex");
  const expiraEm = Timestamp.fromMillis(Date.now() + CANCELAMENTO_TTL_MS);

  await db.collection("cancelamentos_pendentes").doc(token).set({
    agendamentoId: encontrado.agendamentoId,
    cpfDocIds: [...new Set([...(encontrado.cpfDocIds || []), cpfDocId(cpfNum), cpfNum])],
    slotId: encontrado.slotId,
    criadoEm: FieldValue.serverTimestamp(),
    expiraEm
  });

  return {
    token,
    expiraEm: expiraEm.toMillis(),
    agendamento: respostaPublica(encontrado.dados)
  };
});

exports.cancelarAgendamentoCidadao = onCall(publicCallableOptions, async (request) => {
  await aplicarRateLimit(request, "cancelar_agendamento", 10, 10 * 60 * 1000);
  const token = String(request.data.token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new HttpsError("invalid-argument", "Solicitacao de cancelamento invalida.");
  }

  const tokenRef = db.collection("cancelamentos_pendentes").doc(token);

  await db.runTransaction(async (t) => {
    const tokenDoc = await t.get(tokenRef);
    if (!tokenDoc.exists) {
      throw new HttpsError("not-found", "Solicitacao de cancelamento expirada. Localize o agendamento novamente.");
    }

    const pendente = tokenDoc.data();
    if (!pendente.expiraEm || pendente.expiraEm.toMillis() < Date.now()) {
      t.delete(tokenRef);
      throw new HttpsError("deadline-exceeded", "Solicitacao de cancelamento expirada. Localize o agendamento novamente.");
    }

    const agRef = db.collection("dados_cidadaos").doc(pendente.agendamentoId);
    const agDoc = await t.get(agRef);
    const dados = agDoc.exists ? agDoc.data() : {};
    const slotId = pendente.slotId || dados.slotId || `${dados.dataISO}_${dados.hora}`;

    if (agDoc.exists) {
      validarAgendamentoPublicoFuturo(dados, "Este agendamento ja passou do horario e nao pode mais ser cancelado pelo site.");
    }

    // CONTENCAO B5. O token guarda uma fotografia de 30 minutos. Sem conferir o
    // dono atual, dois tokens irmaos do mesmo agendamento permitiam: cancelar com
    // o primeiro, outra pessoa reservar a vaga liberada, e o segundo apagar a vaga
    // dela -- deixando o agendamento sem vaga e a mesma vaga livre para um terceiro.
    // Toda leitura precisa vir antes de qualquer escrita na transacao.
    const cpfDocIdsUnicos = [...new Set((Array.isArray(pendente.cpfDocIds) ? pendente.cpfDocIds : []).filter(Boolean))];
    const slotRefAlvo = slotId && slotId !== "undefined_undefined"
      ? db.collection("vagas_ocupadas").doc(slotId)
      : null;
    const [slotDoc, cpfDocs] = await Promise.all([
      slotRefAlvo ? t.get(slotRefAlvo) : Promise.resolve(null),
      Promise.all(cpfDocIdsUnicos.map((docId) => t.get(db.collection("cpfs_agendados").doc(docId))))
    ]);

    if (slotRefAlvo && slotDoc.exists && slotDoc.data().agendamentoId === pendente.agendamentoId) {
      t.delete(slotRefAlvo);
    }

    if (agDoc.exists) {
      const agora = new Date().toISOString();
      t.set(agRef, {
        status: "cancelado_cidadao",
        canceladoEm: agora,
        canceladoPor: "cidadao",
        statusAtualizadoEm: agora,
        ativo: false
      }, { merge: true });
    }

    // Mesma regra para os indices de CPF: so remove o que ainda aponta para este
    // agendamento. Um indice ja reapontado pertence a um agendamento posterior.
    cpfDocs.forEach((doc, indice) => {
      if (doc.exists && doc.data().agendamentoId === pendente.agendamentoId) {
        t.delete(db.collection("cpfs_agendados").doc(cpfDocIdsUnicos[indice]));
      }
    });

    t.delete(tokenRef);
  });

  return { cancelado: true };
});

exports.registrarMetricasAcessoPublico = onValueCreated({
  ref: "/presenca_publica/conexoes/{conexaoId}",
  region: "us-central1",
  maxInstances: 20
}, async (event) => {
  const conexaoId = String(event.params.conexaoId || "");
  const conectadoEm = Number(event.data && event.data.val && event.data.val().conectadoEm) || Date.now();
  const agora = Date.now();
  const dia = hojeSaoPauloISO();
  const ativosAgora = await quantidadeConexoesPublicasAtivas();
  const raiz = obterRealtimeDb().ref("presenca_publica");

  await Promise.all([
    raiz.child(`sessoes/${conexaoId}`).set({
      conectadoEm,
      registradoEm: agora,
      expiraEm: agora + SESSAO_ACESSO_TTL_MS
    }),
    raiz.child("metricas").transaction((atual) => {
      const base = atual && typeof atual === "object" ? atual : {};
      const mesmoDia = base.dataReferencia === dia;
      return {
        ...base,
        dataReferencia: dia,
        ativosAgora,
        picoHoje: mesmoDia ? Math.max(Number(base.picoHoje) || 0, ativosAgora) : ativosAgora,
        acessosHoje: (mesmoDia ? Number(base.acessosHoje) || 0 : 0) + 1,
        totalAcessos: (Number(base.totalAcessos) || 0) + 1,
        ultimoAcessoEm: agora,
        atualizadoEm: agora
      };
    })
  ]);
});

exports.atualizarMetricasSaidaAcessoPublico = onValueDeleted({
  ref: "/presenca_publica/conexoes/{conexaoId}",
  region: "us-central1",
  maxInstances: 20
}, async () => {
  await atualizarContagemAcessosAtivos(await quantidadeConexoesPublicasAtivas());
});

exports.criarEncaixeManual = onCall(callableOptions, async (request) => {
  const adminEmail = await assertAdmin(request);
  const nome = normalizarTexto(request.data.nome, "o nome", 2, 120);
  const cpfInformado = String(request.data.cpf || "").replace(/\D/g, "");
  const cpfNum = cpfInformado ? normalizarCpf(cpfInformado) : "";
  const telefone = normalizarTelefoneOpcional(request.data.telefone);
  const dataNasc = normalizarDataOpcional(request.data.nascimento);
  const dataISO = normalizarData(request.data.data, "data do agendamento");
  const hora = normalizarHora(request.data.hora);
  const cpfFormatado = cpfNum ? formatarCpf(cpfNum) : "";
  const cpfHashId = cpfNum ? cpfDocId(cpfNum) : "";

  if (dataISO < hojeSaoPauloISO()) {
    throw new HttpsError("failed-precondition", "Data indisponivel para encaixe.");
  }

  const criado = new Date().toISOString();
  const agendamentoRef = db.collection("dados_cidadaos").doc();
  const protocolo = gerarProtocolo(agendamentoRef.id);
  const slotId = `manual_${agendamentoRef.id}`;
  const slotRef = db.collection("vagas_ocupadas").doc(slotId);
  const cpfRef = cpfHashId ? db.collection("cpfs_agendados").doc(cpfHashId) : null;
  const cpfLegadoRef = cpfNum ? db.collection("cpfs_agendados").doc(cpfNum) : null;

  await db.runTransaction(async (t) => {
    const cpfDoc = cpfRef ? await t.get(cpfRef) : null;
    const cpfLegadoDoc = cpfLegadoRef ? await t.get(cpfLegadoRef) : null;

    if ((cpfDoc && cpfDoc.exists) || (cpfLegadoDoc && cpfLegadoDoc.exists)) {
      throw new HttpsError("already-exists", "Este CPF ja possui um agendamento ativo.");
    }

    t.set(slotRef, { dataISO, hora, contabilizaVaga: false, origem: "manual", agendamentoId: agendamentoRef.id });
    if (cpfRef) {
      t.set(cpfRef, { agendamentoId: agendamentoRef.id, slotId, criado });
    }
    t.set(agendamentoRef, {
      nome,
      cpf: cpfFormatado,
      telefone,
      email: "",
      dataNasc,
      dataISO,
      hora,
      slotId,
      protocolo,
      status: "agendado",
      statusAtualizadoEm: criado,
      insercaoManual: true,
      criado,
      criadoPor: adminEmail
    });
    t.set(db.collection("logs_admin").doc(), {
      acao: "encaixe_manual",
      agendamentoId: agendamentoRef.id,
      protocolo,
      dataISO,
      hora,
      adminEmail,
      criadoEm: FieldValue.serverTimestamp()
    });
  });

  return {
    agendamento: {
      id: agendamentoRef.id,
      dataISO,
      dataBR: dataBr(dataISO),
      hora,
      protocolo
    }
  };
});

exports.atualizarObservacaoAdmin = onCall(callableOptions, async (request) => {
  const adminEmail = await assertAdmin(request);
  const agendamentoId = String(request.data.agendamentoId || "").trim();
  const observacaoInterna = normalizarTextoOpcional(request.data.observacaoInterna, 800);
  if (!agendamentoId) {
    throw new HttpsError("invalid-argument", "Agendamento invalido.");
  }

  const agRef = db.collection("dados_cidadaos").doc(agendamentoId);
  const agDoc = await agRef.get();
  if (!agDoc.exists) {
    throw new HttpsError("not-found", "Agendamento nao encontrado.");
  }

  await agRef.set({
    observacaoInterna,
    observacaoAtualizadaEm: new Date().toISOString(),
    observacaoAtualizadaPor: adminEmail
  }, { merge: true });

  await db.collection("logs_admin").add({
    acao: "atualizar_observacao",
    agendamentoId,
    protocolo: agDoc.data().protocolo || "",
    adminEmail,
    criadoEm: FieldValue.serverTimestamp(),
    criado: new Date().toISOString()
  });

  return { ok: true };
});

exports.remarcarAgendamentoAdmin = onCall(callableOptions, async (request) => {
  const adminEmail = await assertAdmin(request);
  const agendamentoId = String(request.data.agendamentoId || "").trim();
  const dataISO = normalizarData(request.data.data, "data do agendamento");
  const hora = normalizarHora(request.data.hora);
  const contabilizaVaga = request.data.contabilizaVaga === true;

  if (!agendamentoId) {
    throw new HttpsError("invalid-argument", "Agendamento invalido.");
  }
  if (dataISO < hojeSaoPauloISO()) {
    throw new HttpsError("failed-precondition", "Nao e possivel remarcar para data passada.");
  }

  const agRef = db.collection("dados_cidadaos").doc(agendamentoId);
  const novoSlotId = contabilizaVaga ? `${dataISO}_${hora}` : `manual_${agendamentoId}`;
  const novoSlotRef = db.collection("vagas_ocupadas").doc(novoSlotId);
  const agora = new Date().toISOString();
  let retorno = null;

  await db.runTransaction(async (t) => {
    const agDoc = await t.get(agRef);
    if (!agDoc.exists) {
      throw new HttpsError("not-found", "Agendamento nao encontrado.");
    }

    const dados = agDoc.data();
    const slotAntigoId = dados.slotId || `${dados.dataISO}_${dados.hora}`;
    const slotAntigoRef = slotAntigoId ? db.collection("vagas_ocupadas").doc(slotAntigoId) : null;
    const novoSlotDoc = await t.get(novoSlotRef);

    if (contabilizaVaga && novoSlotDoc.exists && novoSlotId !== slotAntigoId) {
      throw new HttpsError("already-exists", "Este horario ja esta ocupado. Escolha outro horario.");
    }

    if (slotAntigoRef && slotAntigoId !== novoSlotId) {
      t.delete(slotAntigoRef);
    }

    t.set(novoSlotRef, {
      dataISO,
      hora,
      contabilizaVaga,
      origem: contabilizaVaga ? "admin_remarcacao" : "manual",
      agendamentoId
    }, { merge: true });

    const remarcacao = {
      deDataISO: dados.dataISO || "",
      deHora: dados.hora || "",
      paraDataISO: dataISO,
      paraHora: hora,
      contabilizaVaga,
      adminEmail,
      criado: agora
    };

    t.set(agRef, {
      dataISO,
      hora,
      slotId: novoSlotId,
      insercaoManual: !contabilizaVaga,
      remarcadoEm: agora,
      remarcadoPor: adminEmail,
      remarcacoes: FieldValue.arrayUnion(remarcacao)
    }, { merge: true });

    const cpfNum = String(dados.cpf || "").replace(/\D/g, "");
    if (cpfNum.length === 11) {
      t.set(db.collection("cpfs_agendados").doc(cpfDocId(cpfNum)), { agendamentoId, slotId: novoSlotId, atualizado: agora }, { merge: true });
      t.set(db.collection("cpfs_agendados").doc(cpfNum), { agendamentoId, slotId: novoSlotId, atualizado: agora }, { merge: true });
    }

    t.set(db.collection("logs_admin").doc(), {
      acao: "remarcar_agendamento",
      agendamentoId,
      protocolo: dados.protocolo || "",
      detalhes: remarcacao,
      adminEmail,
      criadoEm: FieldValue.serverTimestamp(),
      criado: agora
    });

    retorno = {
      id: agendamentoId,
      dataISO,
      dataBR: dataBr(dataISO),
      hora,
      slotId: novoSlotId,
      insercaoManual: !contabilizaVaga
    };
  });

  return { agendamento: retorno };
});

exports.listarLogsAdmin = onCall(callableOptions, async (request) => {
  await assertAdmin(request);
  const limite = Math.min(Math.max(Number(request.data && request.data.limite) || 80, 10), 200);
  const snap = await db.collection("logs_admin").orderBy("criadoEm", "desc").limit(limite).get();
  return {
    logs: snap.docs.map((doc) => {
      const dados = doc.data();
      return {
        id: doc.id,
        acao: dados.acao || "",
        adminEmail: dados.adminEmail || "",
        agendamentoId: dados.agendamentoId || "",
        protocolo: dados.protocolo || "",
        detalhes: dados.detalhes || {},
        criado: dados.criado || (dados.criadoEm && dados.criadoEm.toDate ? dados.criadoEm.toDate().toISOString() : "")
      };
    })
  };
});

exports.gerarBackupAdmin = onCall(callableOptions, async (request) => {
  const adminEmail = await assertAdmin(request);
  const [agendaDoc, agendamentosSnap, logsSnap] = await Promise.all([
    db.collection("configuracoes").doc("agenda").get(),
    db.collection("dados_cidadaos").orderBy("dataISO").orderBy("hora").get(),
    db.collection("logs_admin").orderBy("criadoEm", "desc").limit(300).get()
  ]);

  const criado = new Date().toISOString();
  const backup = {
    geradoEm: criado,
    geradoPor: adminEmail,
    agenda: agendaDoc.exists ? agendaDoc.data() : {},
    agendamentos: agendamentosSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    logsRecentes: logsSnap.docs.map((doc) => {
      const dados = doc.data();
      return {
        id: doc.id,
        ...dados,
        criadoEm: dados.criadoEm && dados.criadoEm.toDate ? dados.criadoEm.toDate().toISOString() : dados.criadoEm || ""
      };
    })
  };

  await db.collection("logs_admin").add({
    acao: "gerar_backup",
    detalhes: { quantidadeAgendamentos: backup.agendamentos.length },
    adminEmail,
    criadoEm: FieldValue.serverTimestamp(),
    criado
  });

  return { backup };
});

exports.anonimizarDadosAntigosLGPD = onSchedule({
  schedule: "0 3 1 * *",
  timeZone: "America/Sao_Paulo",
  maxInstances: 1
}, async () => anonimizarDadosAntigosLGPD());

// Prepara a semana alguns minutos antes do horario de abertura. A funcao roda duas
// vezes de forma intencional e idempotente (07:50, 07:55 e 07:59). A ultima
// execucao tambem aquece a leitura publica imediatamente antes da abertura.
exports.prepararAgendaSemanalAutomatica = onSchedule({
  schedule: "50,55,59 7 * * 1",
  timeZone: "America/Sao_Paulo",
  retryCount: 3,
  minBackoffSeconds: 60,
  maxBackoffSeconds: 300,
  maxRetrySeconds: 900,
  maxInstances: 1,
  timeoutSeconds: 120
}, async () => {
  const agendaRef = AGENDA_REF();
  const hoje = hojeSaoPauloISO();
  const segunda = segundaDaSemanaISO(hoje);
  const agora = agoraSaoPauloInput();
  let resultado = null;

  await db.runTransaction(async (t) => {
    const agendaDoc = await t.get(agendaRef);
    const cfg = agendaDoc.exists ? agendaDoc.data() : {};
    const automacao = normalizarAutomacaoSemanal(cfg.automacaoSemanal);
    const plano = planoSemana(automacao, segunda);
    const proxima = automacao.ativa ? proximaSemanaComAtendimento(automacao, segunda) : null;
    const dias = new Set(Array.isArray(cfg.dias) ? cfg.dias.filter(dataISOValida) : []);
    const publicacaoDatas = normalizarPublicacaoDatas(cfg.publicacaoDatas);
    const geradas = new Set(Array.isArray(cfg.datasGeradasAutomaticamente)
      ? cfg.datasGeradasAutomaticamente.filter(dataISOValida)
      : []);
    const fimSemana = somarDiasISO(segunda, 6);
    const removidasPorExcecao = [];
    const adicionadas = [];

    // Excecoes manuais prevalecem, mas uma data ja publicada nunca e removida
    // automaticamente, pois ela pode conter agendamentos de cidadaos.
    for (const dataISO of [...geradas]) {
      const pertenceSemana = dataISO >= segunda && dataISO <= fimSemana;
      const deixouDeFazerParteDoPlano = pertenceSemana && !plano.datas.includes(dataISO);
      const aindaNaoPublicada = publicacaoDatas[dataISO] && publicacaoDatas[dataISO] > agora;
      if (deixouDeFazerParteDoPlano && aindaNaoPublicada) {
        dias.delete(dataISO);
        delete publicacaoDatas[dataISO];
        geradas.delete(dataISO);
        removidasPorExcecao.push(dataISO);
      }
    }

    for (const dataISO of plano.datas) {
      if (dias.has(dataISO)) continue; // Cadastro manual sempre prevalece.
      dias.add(dataISO);
      publicacaoDatas[dataISO] = plano.publicarEm;
      geradas.add(dataISO);
      adicionadas.push(dataISO);
    }

    // set com merge FUNDE mapas: sem o marcador explicito a data excluida por
    // excecao continuaria com horario de publicacao e voltaria a aparecer.
    for (const dataISO of removidasPorExcecao) {
      publicacaoDatas[dataISO] = FieldValue.delete();
    }

    const atualizacao = {
      automacaoSemanal: automacao,
      dias: [...dias].sort(),
      publicacaoDatas,
      datasGeradasAutomaticamente: [...geradas].sort(),
      ultimaExecucaoAutomacaoSemanal: {
        executadaEm: new Date().toISOString(),
        segunda,
        semanaPausada: plano.semanaPausada,
        adicionadas,
        removidasPorExcecao
      },
      atualizado: new Date().toISOString()
    };

    if (proxima) {
      atualizacao.avisoNovasVagasProgramado = {
        dataNovasVagas: dataBr(proxima.segunda),
        publicarEm: plano.publicarEm
      };
    }

    // O aviso programado acima so passa a valer as 08:00. Entre esta execucao e
    // a virada, avisoNovasVagasAtivo cai no campo de topo -- que ninguem
    // atualizava e por isso guardava a abertura da semana anterior. Resultado
    // observado das 07:50 as 07:59: alvo do contador no passado, contador
    // sumido da tela e tentarAtualizarAbertura() disparando dez minutos cedo,
    // nos minutos de maior audiencia da semana. Escrever a abertura vigente
    // fecha a janela.
    const aberturaVigente = aberturaVigenteDaSemana(automacao, segunda);
    if (aberturaVigente) atualizacao.dataNovasVagas = dataBr(aberturaVigente);

    t.set(agendaRef, atualizacao, { merge: true });
    resultado = {
      ativa: automacao.ativa,
      segunda,
      semanaPausada: plano.semanaPausada,
      adicionadas,
      removidasPorExcecao,
      proximaAbertura: proxima ? proxima.segunda : ""
    };
  });

  // A chamada direta usa uma URL exclusiva, portanto nao coloca a agenda ainda
  // fechada no cache publico. Ela apenas inicia o container de leitura; se o
  // Cloud Run mantiver a instancia ociosa ate 08:00, o primeiro miss do CDN nao
  // paga o cold start. Falha aqui nao impede a abertura da agenda.
  try {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "agendamento-cin-itanhandu";
    // A regiao vem de REGIAO_PICO, nao de literal: carregarAgendaPublicaHttp
    // mudou para southamerica-east1 em 24/08/2026 e esta URL ficou apontando
    // para us-central1, que responde 404. O aquecimento das 07:50/07:55/07:59
    // nao aquecia nada, e como a falha so gravava leituraPreaquecida=false a
    // funcao terminava normal -- saudavel no Scheduler, inutil na pratica.
    const url = `https://${REGIAO_PICO}-${projectId}.cloudfunctions.net/carregarAgendaPublicaHttp?preaquecer=${encodeURIComponent(agora)}`;
    const resposta = await fetch(url, {
      headers: { "User-Agent": "agenda-automacao-preaquecimento" },
      signal: AbortSignal.timeout(10000)
    });
    resultado.leituraPreaquecida = resposta.ok;
  } catch (err) {
    resultado.leituraPreaquecida = false;
    resultado.erroPreaquecimentoLeitura = String(err && err.message || err).slice(0, 180);
  }

  await db.collection("logs_admin").add({
    acao: "agenda_automacao_semanal",
    detalhes: resultado,
    adminEmail: "sistema",
    criadoEm: FieldValue.serverTimestamp(),
    criado: new Date().toISOString()
  });

  return resultado;
});

async function limparDatasPassadasAgenda() {
  try {
    const agendaRef = db.collection("configuracoes").doc("agenda");
    const agendaDoc = await agendaRef.get();
    if (!agendaDoc.exists) return;

    const cfg = agendaDoc.data();
    const hoje = hojeSaoPauloISO();

    const diasOriginais = Array.isArray(cfg.dias) ? cfg.dias : [];
    const diasFuturos = diasOriginais.filter(d => typeof d === "string" && d >= hoje);
    const datasRemovidas = diasOriginais.length - diasFuturos.length;
    const datasAutomaticasFuturas = (Array.isArray(cfg.datasGeradasAutomaticamente) ? cfg.datasGeradasAutomaticamente : [])
      .filter(d => typeof d === "string" && d >= hoje);

    // set com merge FUNDE mapas: sem o marcador explicito de exclusao as datas
    // antigas sobreviveriam e publicacaoDatas cresceria indefinidamente.
    const publicacaoDatasLimpo = {};
    const pubDatas = cfg.publicacaoDatas || {};
    let publicacoesRemovidas = 0;
    Object.keys(pubDatas).forEach(data => {
      if (data >= hoje) {
        publicacaoDatasLimpo[data] = pubDatas[data];
      } else {
        publicacaoDatasLimpo[data] = FieldValue.delete();
        publicacoesRemovidas += 1;
      }
    });

    await agendaRef.set({
      dias: diasFuturos,
      publicacaoDatas: publicacaoDatasLimpo,
      datasGeradasAutomaticamente: datasAutomaticasFuturas
    }, { merge: true });

    await db.collection("logs_admin").add({
      acao: "limpeza_agenda_automatica",
      detalhes: { datasRemovidas, publicacoesRemovidas, totalRestantes: diasFuturos.length },
      adminEmail: "sistema",
      criadoEm: FieldValue.serverTimestamp(),
      criado: new Date().toISOString()
    });
  } catch (err) {
    await db.collection("logs_admin").add({
      acao: "erro_limpeza_agenda",
      detalhes: { mensagem: err.message },
      adminEmail: "sistema",
      criadoEm: FieldValue.serverTimestamp(),
      criado: new Date().toISOString()
    }).catch(() => {});
  }
}

// Remove documentos ja expirados das colecoes auxiliares.
// Esses docs tem campo expiraEm e nao eram apagados por nenhuma rotina, crescendo indefinidamente.
const LIMPEZA_AUXILIARES_PAGINA = 300;
const LIMPEZA_AUXILIARES_MAX = 5000;

async function limparColecaoExpirada(colecao, agoraTimestamp) {
  let total = 0;
  while (total < LIMPEZA_AUXILIARES_MAX) {
    const snap = await db.collection(colecao)
      .where("expiraEm", "<=", agoraTimestamp)
      .limit(LIMPEZA_AUXILIARES_PAGINA)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < LIMPEZA_AUXILIARES_PAGINA) break;
  }
  return total;
}

async function limparAuxiliaresExpirados() {
  const agora = Timestamp.now();
  let rateLimits = 0;
  let cancelamentos = 0;
  let operacoesAgendamento = 0;
  try {
    rateLimits = await limparColecaoExpirada("rate_limits", agora);
    cancelamentos = await limparColecaoExpirada("cancelamentos_pendentes", agora);
    operacoesAgendamento = await limparColecaoExpirada("operacoes_agendamento", agora);
    await db.collection("logs_admin").add({
      acao: "limpeza_auxiliares_expirados",
      detalhes: { rateLimits, cancelamentos, operacoesAgendamento },
      adminEmail: "sistema",
      criadoEm: FieldValue.serverTimestamp(),
      criado: new Date().toISOString()
    });
  } catch (err) {
    await db.collection("logs_admin").add({
      acao: "erro_limpeza_auxiliares",
      detalhes: { mensagem: err.message, rateLimits, cancelamentos, operacoesAgendamento },
      adminEmail: "sistema",
      criadoEm: FieldValue.serverTimestamp(),
      criado: new Date().toISOString()
    }).catch(() => {});
  }
}

async function limparSessoesAcessoPublico() {
  const raiz = obterRealtimeDb().ref("presenca_publica");
  const agora = Date.now();
  const atualizacoes = {};
  const [sessoesSnap, conexoesAntigasSnap] = await Promise.all([
    raiz.child("sessoes").orderByChild("expiraEm").endAt(agora).limitToFirst(1000).once("value"),
    raiz.child("conexoes").orderByChild("conectadoEm").endAt(agora - CONEXAO_ACESSO_MAX_MS).limitToFirst(1000).once("value")
  ]);

  sessoesSnap.forEach((item) => { atualizacoes[`sessoes/${item.key}`] = null; });
  conexoesAntigasSnap.forEach((item) => { atualizacoes[`conexoes/${item.key}`] = null; });
  if (Object.keys(atualizacoes).length) await raiz.update(atualizacoes);
  const ativosAgora = await quantidadeConexoesPublicasAtivas();
  await atualizarContagemAcessosAtivos(ativosAgora);

  await db.collection("logs_admin").add({
    acao: "limpeza_sessoes_acesso_publico",
    detalhes: {
      sessoesRemovidas: sessoesSnap.numChildren(),
      conexoesAntigasRemovidas: conexoesAntigasSnap.numChildren(),
      ativosAgora
    },
    adminEmail: "sistema",
    criadoEm: FieldValue.serverTimestamp(),
    criado: new Date().toISOString()
  });
}

// Um unico job diario substitui os tres agendamentos de limpeza. Junto da
// automacao semanal e da anonimizacao mensal, o projeto passa a ter tres jobs
// do Cloud Scheduler, dentro da franquia gratuita quando a conta nao possui
// outros jobs agendados.
exports.executarManutencaoDiaria = onSchedule({
  schedule: "0 2 * * *",
  timeZone: "America/Sao_Paulo",
  retryCount: 2,
  minBackoffSeconds: 60,
  maxBackoffSeconds: 300,
  maxInstances: 1,
  timeoutSeconds: 540
}, async () => {
  await limparDatasPassadasAgenda();
  await limparAuxiliaresExpirados();
  await limparSessoesAcessoPublico();
});
