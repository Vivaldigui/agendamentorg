"use strict";

// Metricas de cada abertura (auditoria de 16/10/2026, item I-1).
//
// Sem elas a Camara nao sabe quantas pessoas disputam as vagas, quantas perdem
// o horario, nem se ha reserva em massa -- e e esse numero que decide entre
// manter a disputa, reservar cota presencial ou adotar sorteio.
//
// Cada pedido a criarAgendamentoCidadao soma em metricas_abertura/{segunda},
// onde {segunda} e a segunda-feira da semana do PEDIDO (fuso de Sao Paulo):
// a abertura e na segunda e as vagas sao da mesma semana. Nenhum dado pessoal:
// so contadores por motivo e um histograma por minuto.
//
// O documento seria disputado por todos os pedidos dos primeiros segundos, que
// e justamente o pico. Por isso os contadores ficam espalhados em
// FRAGMENTOS_METRICAS documentos (fragmentos/0..N-1) somados na leitura, e a
// gravacao fica fora da transacao da reserva, com prazo curto e erro engolido:
// metrica nunca pode atrasar nem derrubar um agendamento.

const FRAGMENTOS_METRICAS = 20;
const PRAZO_GRAVACAO_METRICA_MS = 400;

// Motivos de resultado. Os nomes viram campos no Firestore e colunas no painel.
const MOTIVOS = Object.freeze([
  "sucesso",
  "conflitoHorario",
  "cpfJaAgendado",
  "cpfBloqueado",
  "limiteExcedido",
  "muitasTentativas",
  "horarioIndisponivel",
  "dadosInvalidos",
  "erro"
]);

function codigoErro(err) {
  return String(err && err.code || "").replace(/^functions\//, "");
}

function motivoMetricaAgendamento(err) {
  if (!err) return "sucesso";
  const codigo = codigoErro(err);
  const tipo = String(err.details && err.details.tipo || "");
  const mensagem = String(err.message || "").toLowerCase();
  if (tipo === "horario-preenchido") return "conflitoHorario";
  if (tipo === "cpf-ja-agendado") return "cpfJaAgendado";
  if (tipo === "cpf-bloqueado") return "cpfBloqueado";
  if (tipo.startsWith("limite-")) return "limiteExcedido";
  if (codigo === "resource-exhausted") return "muitasTentativas";
  if (codigo === "invalid-argument") return "dadosInvalidos";
  if (codigo === "failed-precondition") {
    return mensagem.includes("ausencia em atendimento anterior") ? "cpfBloqueado" : "horarioIndisponivel";
  }
  if (codigo === "already-exists") return "conflitoHorario";
  return "erro";
}

// "2026-10-19T08:00" no fuso de Sao Paulo: chave do histograma por minuto.
function minutoSaoPaulo(ms) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}

function segundaDaSemana(dataISO) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const diaSemana = data.getUTCDay();
  data.setUTCDate(data.getUTCDate() + (diaSemana === 0 ? -6 : 1 - diaSemana));
  return data.toISOString().slice(0, 10);
}

// Campos a somar num fragmento. `incremento` e FieldValue.increment.
function camposMetrica(motivo, ms, incremento) {
  const minuto = minutoSaoPaulo(ms);
  const campos = {
    segunda: segundaDaSemana(minuto.slice(0, 10)),
    tentativas: incremento(1),
    [MOTIVOS.includes(motivo) ? motivo : "erro"]: incremento(1),
    tentativasPorMinuto: { [minuto]: incremento(1) }
  };
  if (motivo === "sucesso") campos.sucessosPorMinuto = { [minuto]: incremento(1) };
  return campos;
}

function criarRegistradorMetricas({ db, FieldValue, agora = Date.now, aleatorio = Math.random, logger = console }) {
  return async function registrarMetricaAbertura(motivo) {
    let timer = null;
    try {
      const ms = agora();
      const campos = camposMetrica(motivo, ms, (n) => FieldValue.increment(n));
      const fragmento = Math.floor(aleatorio() * FRAGMENTOS_METRICAS) % FRAGMENTOS_METRICAS;
      const gravacao = db.collection("metricas_abertura").doc(campos.segunda)
        .collection("fragmentos").doc(String(fragmento))
        .set(campos, { merge: true })
        .catch((err) => { logger.warn("Metrica de abertura nao gravada.", err && err.message); });
      const prazo = new Promise((resolve) => { timer = setTimeout(resolve, PRAZO_GRAVACAO_METRICA_MS); });
      await Promise.race([gravacao, prazo]);
    } catch (err) {
      logger.warn("Metrica de abertura nao gravada.", err && err.message);
    } finally {
      clearTimeout(timer);
    }
  };
}

// Envolve o handler: conta o resultado e devolve exatamente o que ele devolveu
// ou lancou. Repeticao do mesmo pedido (retentativa de rede) tambem conta.
function comMetricaAbertura(registrar, handler) {
  return async (request) => {
    let resultado;
    try {
      resultado = await handler(request);
    } catch (err) {
      await registrar(motivoMetricaAgendamento(err));
      throw err;
    }
    await registrar("sucesso");
    return resultado;
  };
}

// Soma os fragmentos de uma abertura (usado pelo painel, espelhado la).
function somarFragmentos(fragmentos) {
  const total = { tentativas: 0, tentativasPorMinuto: {}, sucessosPorMinuto: {} };
  MOTIVOS.forEach((motivo) => { total[motivo] = 0; });
  for (const dados of fragmentos) {
    if (!dados || typeof dados !== "object") continue;
    total.tentativas += Number(dados.tentativas) || 0;
    MOTIVOS.forEach((motivo) => { total[motivo] += Number(dados[motivo]) || 0; });
    for (const mapa of ["tentativasPorMinuto", "sucessosPorMinuto"]) {
      const origem = dados[mapa] && typeof dados[mapa] === "object" ? dados[mapa] : {};
      for (const [minuto, valor] of Object.entries(origem)) {
        total[mapa][minuto] = (total[mapa][minuto] || 0) + (Number(valor) || 0);
      }
    }
  }
  return total;
}

module.exports = {
  FRAGMENTOS_METRICAS,
  PRAZO_GRAVACAO_METRICA_MS,
  MOTIVOS,
  motivoMetricaAgendamento,
  minutoSaoPaulo,
  segundaDaSemana,
  camposMetrica,
  criarRegistradorMetricas,
  comMetricaAbertura,
  somarFragmentos
};
