const crypto = require("crypto");
const admin = require("firebase-admin");
const { getDatabaseWithUrl } = require("firebase-admin/database");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueCreated } = require("firebase-functions/v2/database");

admin.initializeApp();

const db = admin.firestore();
const RTDB_INSTANCE = "agendamento-cin-itanhandu-default-rtdb";
const RTDB_URL = `https://${RTDB_INSTANCE}.firebaseio.com`;
const realtimeDb = getDatabaseWithUrl(RTDB_URL);
const CANCELAMENTO_TTL_MS = 10 * 60 * 1000;
const DIAS_INICIAIS = ["2026-06-02", "2026-06-03", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-28", "2026-07-29", "2026-07-30"];
const HORAS_FALLBACK = ["14:20", "14:40", "15:00", "15:20", "15:40", "16:00", "16:20", "16:40"];
const DATA_NOVAS_VAGAS_PADRAO = "01/06/2026";
const STATUS_VALIDOS = [
  "agendado",
  "compareceu",
  "nao_compareceu",
  "cancelado",
  "cancelado_cidadao",
  "cancelado_camara",
  "remarcado"
];
const STATUS_ANONIMIZAR_LGPD = new Set([
  "compareceu",
  "nao_compareceu",
  "cancelado",
  "cancelado_cidadao",
  "cancelado_camara"
]);
const LGPD_RETENCAO_MESES = 6;
const LGPD_MAX_LEITURAS_POR_EXECUCAO = 5000;
const LGPD_TAMANHO_PAGINA = 250;

const callableOptions = {
  cors: [
    "https://agendamento-cin-itanhandu.web.app",
    "https://agendamento-cin-itanhandu.firebaseapp.com",
    "https://www.itanhandu.cam.mg.gov.br",
    "https://itanhandu.cam.mg.gov.br"
  ],
  maxInstances: 10
};

const publicCallableOptions = {
  ...callableOptions,
  enforceAppCheck: true
};

const agendamentoPicoOptions = {
  ...publicCallableOptions,
  maxInstances: 30
};

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

function normalizarListaHorarios(valor) {
  const base = Array.isArray(valor) ? valor : [];
  return [...new Set(base
    .filter((hora) => /^\d{2}:\d{2}$/.test(String(hora || "")))
    .map((hora) => String(hora)))].sort();
}

function normalizarHorariosPorDiaSemana(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const limpo = {};
  for (let dia = 0; dia <= 6; dia++) {
    const chave = String(dia);
    if (Object.prototype.hasOwnProperty.call(valor, chave) && Array.isArray(valor[chave])) {
      limpo[chave] = normalizarListaHorarios(valor[chave]);
    }
  }
  return limpo;
}

function diaSemanaISO(dataISO) {
  const data = new Date(`${dataISO}T12:00:00-03:00`);
  return Number.isNaN(data.getTime()) ? -1 : data.getDay();
}

function horariosParaData(agenda, dataISO) {
  const chave = String(diaSemanaISO(dataISO));
  if (agenda.horariosPorDiaSemana && Object.prototype.hasOwnProperty.call(agenda.horariosPorDiaSemana, chave)) {
    return agenda.horariosPorDiaSemana[chave];
  }
  return agenda.horarios;
}

function avisoNovasVagasAtivo(agenda) {
  const avisoProgramado = agenda && agenda.avisoNovasVagasProgramado && typeof agenda.avisoNovasVagasProgramado === "object"
    ? agenda.avisoNovasVagasProgramado
    : null;
  if (avisoProgramado && avisoProgramado.publicarEm && avisoProgramado.publicarEm <= agoraSaoPauloInput() && avisoProgramado.dataNovasVagas) {
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
  const idade = idadeEmAnosNaData(nascimentoISO, dataISO);
  if (idade !== null && idade < 3) {
    throw new HttpsError("failed-precondition", "Nao e possivel realizar agendamento para menores de 3 anos pelo sistema.");
  }
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
    status: STATUS_VALIDOS.includes(dados.status) ? dados.status : "agendado"
  };
}

function agendamentoEstaAtivo(dados) {
  const status = String(dados && dados.status || "agendado");
  return !["cancelado", "cancelado_cidadao", "cancelado_camara"].includes(status);
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
  const docBloqueio = await db.collection("bloqueios_agendamento").doc(cpfNum).get();
  if (docBloqueio.exists) candidatos.push(docBloqueio.data());

  const snapCadastro = await db.collection("dados_cidadaos")
    .where("bloqueioCpf", "==", cpfNum)
    .limit(10)
    .get();
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

async function aplicarRateLimit(request, acao, limite, janelaMs, extra = "") {
  const chave = crypto.createHash("sha256")
    .update(`${acao}|${fingerprintRequisicao(request, extra)}`)
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
      expiraEm: admin.firestore.Timestamp.fromMillis(agora + janelaMs),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
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
            criadoEm: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        operacoes += 1;
      }
      batch.set(doc.ref, {
        nome: "ANONIMIZADO",
        cpf: admin.firestore.FieldValue.delete(),
        telefone: admin.firestore.FieldValue.delete(),
        email: admin.firestore.FieldValue.delete(),
        dataNasc: admin.firestore.FieldValue.delete(),
        nascimento: admin.firestore.FieldValue.delete(),
        bloqueioCpf: admin.firestore.FieldValue.delete(),
        bloqueioNome: admin.firestore.FieldValue.delete(),
        bloqueioTelefone: admin.firestore.FieldValue.delete(),
        anonimizadoLGPD: true,
        anonimizadoLGPDEm: admin.firestore.FieldValue.serverTimestamp(),
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
      totalAtendimentosHistorico: admin.firestore.FieldValue.increment(totalAnonimizados),
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
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    criado: new Date().toISOString()
  });

  return { corte, totalLidos, totalAnonimizados, totalCpfMapsRemovidos };
}

async function carregarAgenda() {
  const agendaDoc = await db.collection("configuracoes").doc("agenda").get();
  const agenda = agendaDoc.exists ? agendaDoc.data() : {};
  const hoje = hojeSaoPauloISO();
  const dias = Array.isArray(agenda.dias) && agenda.dias.length ? agenda.dias : DIAS_INICIAIS;
  const horariosConfig = Array.isArray(agenda.horarios) ? agenda.horarios : [];
  const horarios = normalizarListaHorarios([...horariosConfig, ...HORAS_FALLBACK]);
  const publicacaoDatas = normalizarPublicacaoDatas(agenda.publicacaoDatas);
  const agora = agoraSaoPauloInput();
  return {
    dias: dias.filter((dia) => typeof dia === "string" && dia >= hoje && (!publicacaoDatas[dia] || publicacaoDatas[dia] <= agora)).sort(),
    horarios,
    horariosPorDiaSemana: normalizarHorariosPorDiaSemana(agenda.horariosPorDiaSemana),
    dataNovasVagas: avisoNovasVagasAtivo(agenda)
  };
}

async function validarSlotDisponivel(dataISO, hora) {
  const agenda = await carregarAgenda();
  if (dataISO < hojeSaoPauloISO()) {
    throw new HttpsError("failed-precondition", "Data indisponivel para agendamento.");
  }
  if (!agenda.dias.includes(dataISO) || !horariosParaData(agenda, dataISO).includes(hora)) {
    throw new HttpsError("failed-precondition", "Horario indisponivel para agendamento.");
  }
  if (!horarioAgendamentoFuturo(dataISO, hora)) {
    throw new HttpsError("failed-precondition", "Este horario ja passou. Escolha outro horario disponivel.");
  }
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
  const agenda = await carregarAgenda();
  const vagasSnap = await db.collection("vagas_ocupadas").get();
  const ocupados = new Set();
  const agora = agoraSaoPauloInput();

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
    dias,
    horarios: agenda.horarios,
    dataNovasVagas: agenda.dataNovasVagas,
    totalVagasRestantes: dias.reduce((total, dia) => total + dia.vagas, 0)
  };
}

exports.carregarAgendaPublica = onCall(publicCallableOptions, async (request) => {
  await aplicarRateLimit(request, "carregar_agenda_publica", 120, 10 * 60 * 1000);
  return carregarDisponibilidadePublica();
});

exports.carregarAgendaPublicaHttp = onRequest({
  cors: callableOptions.cors,
  maxInstances: 50
}, async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ erro: "Metodo nao permitido." });
    return;
  }

  try {
    await aplicarRateLimit({ rawRequest: req }, "carregar_agenda_publica_http", 120, 10 * 60 * 1000);
    const dados = await carregarDisponibilidadePublica();
    res.set("Cache-Control", "public, max-age=30, s-maxage=60");
    res.status(200).json(dados);
  } catch (err) {
    const status = err && err.code === "resource-exhausted" ? 429 : 500;
    res.status(status).json({ erro: err && err.message ? err.message : "Erro ao carregar agenda publica." });
  }
});

exports.registrarMetricasAcessoPublico = onValueCreated({
  ref: "/presenca_publica/conexoes/{conexaoId}",
  instance: RTDB_INSTANCE,
  region: "us-central1",
  maxInstances: 10
}, async (event) => {
  const agora = Date.now();
  const agoraLocal = agoraSaoPauloInput();
  const dataISO = agoraLocal.slice(0, 10);
  const hora = agoraLocal.slice(11, 13);
  const sessaoRef = realtimeDb.ref(`presenca_publica/sessoes/${dataISO}/${event.params.conexaoId}`);
  const sessaoNova = await sessaoRef.transaction((valorAtual) => valorAtual ? undefined : agora);
  const contarAbertura = sessaoNova.committed;
  const conexoesSnap = await realtimeDb.ref("presenca_publica/conexoes").once("value");
  const totalOnline = conexoesSnap.numChildren();
  const metricasRef = realtimeDb.ref(`presenca_publica/metricas/${dataISO}`);

  await metricasRef.transaction((valorAtual) => {
    const metricas = valorAtual && typeof valorAtual === "object" ? valorAtual : {};
    const acessosPorHora = metricas.acessosPorHora && typeof metricas.acessosPorHora === "object"
      ? { ...metricas.acessosPorHora }
      : {};
    const picoAtual = Number(metricas.picoSimultaneo) || 0;
    const proximo = {
      ...metricas,
      totalAcessos: (Number(metricas.totalAcessos) || 0) + (contarAbertura ? 1 : 0),
      acessosPorHora: {
        ...acessosPorHora,
        [hora]: (Number(acessosPorHora[hora]) || 0) + (contarAbertura ? 1 : 0)
      },
      picoSimultaneo: Math.max(picoAtual, totalOnline),
      ultimaAtualizacao: agora
    };

    if (totalOnline > picoAtual) proximo.picoEm = agora;
    return proximo;
  });
});

exports.verificarBloqueioCpf = onCall(publicCallableOptions, async (request) => {
  const cpfNum = normalizarCpf(request.data && request.data.cpf);
  await aplicarRateLimit(request, "verificar_bloqueio_cpf", 20, 10 * 60 * 1000, cpfNum);
  const bloqueio = await buscarBloqueioAtivoCpf(cpfNum);
  if (!bloqueio) return { bloqueado: false };
  return {
    bloqueado: true,
    dataLiberacao: bloqueio.dataLiberacao,
    mensagem: mensagemCpfBloqueado(bloqueio)
  };
});

function validarFatorExtra(dados, telefoneInformado, protocoloInformado) {
  if (!dados.protocolo) return;

  const protocolo = normalizarProtocolo(protocoloInformado);
  const temProtocoloValido = protocolo && normalizarProtocolo(dados.protocolo) === protocolo;
  const temTelefoneValido = telefonesConferem(telefoneInformado, dados.telefone);

  if (!temProtocoloValido && !temTelefoneValido) {
    throw new HttpsError("not-found", "Nenhum agendamento encontrado com os dados informados.");
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
  await aplicarRateLimit(request, "consultar_agendamento", 8, 10 * 60 * 1000, String(request.data && request.data.cpf || ""));
  const encontrado = await localizarAgendamento(request.data.cpf, request.data.nascimento);
  validarAgendamentoPublicoFuturo(encontrado.dados, "Este agendamento ja passou do horario e nao pode mais ser consultado pelo site.");
  return {
    encontrado: true,
    agendamento: respostaPublica(encontrado.dados)
  };
});

exports.criarAgendamentoCidadao = onCall(agendamentoPicoOptions, async (request) => {
  const nome = normalizarTexto(request.data.nome, "o nome completo", 5, 120);
  const cpfNum = normalizarCpf(request.data.cpf);
  await aplicarRateLimit(request, "criar_agendamento", 6, 10 * 60 * 1000, cpfNum);
  const bloqueio = await buscarBloqueioAtivoCpf(cpfNum);
  if (bloqueio) {
    throw new HttpsError("failed-precondition", mensagemCpfBloqueado(bloqueio));
  }
  const telefone = normalizarTelefone(request.data.telefone);
  const email = normalizarEmail(request.data.email);
  const dataNasc = normalizarData(request.data.nascimento);
  const dataISO = normalizarData(request.data.data, "data do agendamento");
  const hora = normalizarHora(request.data.hora);
  validarIdadeMinimaAgendamento(dataNasc, dataISO);
  const cpfFormatado = formatarCpf(cpfNum);
  const cpfHashId = cpfDocId(cpfNum);
  const slotId = `${dataISO}_${hora}`;

  await validarSlotDisponivel(dataISO, hora);

  const criado = new Date().toISOString();
  const agendamentoRef = db.collection("dados_cidadaos").doc();
  const slotRef = db.collection("vagas_ocupadas").doc(slotId);
  const cpfRef = db.collection("cpfs_agendados").doc(cpfHashId);
  const cpfLegadoRef = db.collection("cpfs_agendados").doc(cpfNum);

  await db.runTransaction(async (t) => {
    const [slotDoc, cpfDoc, cpfLegadoDoc] = await Promise.all([
      t.get(slotRef),
      t.get(cpfRef),
      t.get(cpfLegadoRef)
    ]);

    let slotOcupado = slotDoc.exists;
    let limparSlotObsoleto = false;
    if (slotDoc.exists && slotDoc.data().agendamentoId) {
      const agSlotDoc = await t.get(db.collection("dados_cidadaos").doc(slotDoc.data().agendamentoId));
      if (!agSlotDoc.exists || !agendamentoEstaAtivo(agSlotDoc.data())) {
        slotOcupado = false;
        limparSlotObsoleto = true;
      }
    }

    if (slotOcupado) {
      throw new HttpsError("already-exists", "Este horario foi preenchido por outra pessoa. Escolha outro horario.");
    }

    const cpfRefs = [
      { ref: cpfRef, doc: cpfDoc },
      { ref: cpfLegadoRef, doc: cpfLegadoDoc }
    ].filter((item, index, lista) => item.doc.exists && lista.findIndex((outro) => outro.ref.path === item.ref.path) === index);

    let cpfAtivo = false;
    const cpfRefsObsoletos = [];
    for (const item of cpfRefs) {
      const agendamentoId = item.doc.data().agendamentoId;
      if (!agendamentoId) {
        cpfRefsObsoletos.push(item.ref);
        continue;
      }
      const agCpfDoc = await t.get(db.collection("dados_cidadaos").doc(agendamentoId));
      if (agCpfDoc.exists && agendamentoEstaAtivo(agCpfDoc.data())) {
        cpfAtivo = true;
      } else {
        cpfRefsObsoletos.push(item.ref);
      }
    }

    if (cpfAtivo) {
      throw new HttpsError("already-exists", "Este CPF ja possui um agendamento ativo.");
    }

    if (limparSlotObsoleto) t.delete(slotRef);
    cpfRefsObsoletos.forEach((ref) => t.delete(ref));

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
      status: "agendado",
      criado,
      statusAtualizadoEm: criado
    });
  });

  return {
    agendamento: {
      id: agendamentoRef.id,
      dataISO,
      dataBR: dataBr(dataISO),
      hora
    }
  };
});

exports.prepararCancelamentoCidadao = onCall(publicCallableOptions, async (request) => {
  await aplicarRateLimit(request, "preparar_cancelamento", 6, 10 * 60 * 1000, String(request.data && request.data.cpf || ""));
  const cpfNum = normalizarCpf(request.data.cpf);
  const encontrado = await localizarAgendamento(request.data.cpf, request.data.nascimento);
  validarAgendamentoPublicoFuturo(encontrado.dados, "Este agendamento ja passou do horario e nao pode mais ser cancelado pelo site.");
  const token = crypto.randomBytes(32).toString("hex");
  const expiraEm = admin.firestore.Timestamp.fromMillis(Date.now() + CANCELAMENTO_TTL_MS);

  await db.collection("cancelamentos_pendentes").doc(token).set({
    agendamentoId: encontrado.agendamentoId,
    cpfDocIds: [...new Set([...(encontrado.cpfDocIds || []), cpfDocId(cpfNum), cpfNum])],
    slotId: encontrado.slotId,
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
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

    if (slotId && slotId !== "undefined_undefined") {
      t.delete(db.collection("vagas_ocupadas").doc(slotId));
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

    const cpfDocIds = Array.isArray(pendente.cpfDocIds) ? pendente.cpfDocIds : [];
    cpfDocIds.forEach((docId) => {
      if (docId) t.delete(db.collection("cpfs_agendados").doc(docId));
    });

    t.delete(tokenRef);
  });

  return { cancelado: true };
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
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
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
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
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
      remarcacoes: admin.firestore.FieldValue.arrayUnion(remarcacao)
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
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
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
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    criado
  });

  return { backup };
});

exports.anonimizarDadosAntigosLGPD = onSchedule({
  schedule: "0 3 1 * *",
  timeZone: "America/Sao_Paulo",
  maxInstances: 1
}, async () => anonimizarDadosAntigosLGPD());

exports.limparDatasPassadasAgenda = onSchedule({
  schedule: "0 2 * * *",
  timeZone: "America/Sao_Paulo",
  maxInstances: 1
}, async () => {
  try {
    const agendaRef = db.collection("configuracoes").doc("agenda");
    const agendaDoc = await agendaRef.get();
    if (!agendaDoc.exists) return;

    const cfg = agendaDoc.data();
    const hoje = hojeSaoPauloISO();

    const diasOriginais = Array.isArray(cfg.dias) ? cfg.dias : [];
    const diasFuturos = diasOriginais.filter(d => typeof d === "string" && d >= hoje);
    const datasRemovidas = diasOriginais.length - diasFuturos.length;

    const publicacaoDatasLimpo = {};
    const pubDatas = cfg.publicacaoDatas || {};
    Object.keys(pubDatas).forEach(data => {
      if (data >= hoje) publicacaoDatasLimpo[data] = pubDatas[data];
    });

    await agendaRef.set({
      dias: diasFuturos,
      publicacaoDatas: publicacaoDatasLimpo
    }, { merge: true });

    await db.collection("logs_admin").add({
      acao: "limpeza_agenda_automatica",
      detalhes: { datasRemovidas, totalRestantes: diasFuturos.length },
      adminEmail: "sistema",
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      criado: new Date().toISOString()
    });
  } catch (err) {
    await db.collection("logs_admin").add({
      acao: "erro_limpeza_agenda",
      detalhes: { mensagem: err.message },
      adminEmail: "sistema",
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      criado: new Date().toISOString()
    }).catch(() => {});
  }
});

exports.limparSessoesAcessoPublico = onSchedule({
  schedule: "15 4 * * *",
  timeZone: "America/Sao_Paulo",
  maxInstances: 1
}, async () => {
  const hoje = hojeSaoPauloISO();
  const sessoesRef = realtimeDb.ref("presenca_publica/sessoes");
  const sessoesSnap = await sessoesRef.once("value");
  const atualizacoes = {};

  sessoesSnap.forEach((diaSnap) => {
    if (diaSnap.key < hoje) atualizacoes[diaSnap.key] = null;
  });

  if (Object.keys(atualizacoes).length) await sessoesRef.update(atualizacoes);
});
