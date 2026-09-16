"use strict";

const COLECAO = "pedidos_avaliacao_google";
const TERMINAIS = new Set(["enviando", "enviado", "revisar"]);
const FUSO_HORARIO = "America/Sao_Paulo";

function emailValido(valor) {
  if (typeof valor !== "string") return false;
  const email = valor.trim();
  // Um destinatario apenas: o campo To do SMTP aceita listas separadas por virgula.
  return email.length <= 120 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email);
}

function dataISOValida(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T12:00:00Z`);
  return Number.isFinite(data.getTime()) && data.toISOString().startsWith(valor);
}

function dataEmSaoPaulo(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_HORARIO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ms));
}

function validarConfiguracao({ webhookUrl, token, googleUrl }) {
  for (const valor of [webhookUrl, googleUrl]) {
    const url = new URL(valor);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("A integracao exige URLs HTTPS sem credenciais na URL.");
    }
  }
  if (typeof token !== "string" || token.trim().length < 32 || /[\r\n]/.test(token)) {
    throw new Error("Configure um token de webhook com pelo menos 32 caracteres.");
  }
}

function criarServicoAvaliacao({ db, Timestamp, fetchImpl = fetch, logger = console, agora = Date.now }) {
  const fila = db.collection(COLECAO);

  async function processarCadastro(cadastroRef, dataAtendimento, config) {
    validarConfiguracao(config);
    if (!dataISOValida(dataAtendimento)) throw new Error("Data de atendimento invalida.");
    const pedidoRef = fila.doc(cadastroRef.id);
    const payload = await db.runTransaction(async (tx) => {
      const cadastroSnap = await tx.get(cadastroRef);
      const pedidoSnap = await tx.get(pedidoRef);
      const pedido = pedidoSnap.exists ? pedidoSnap.data() : null;
      if (pedido && TERMINAIS.has(pedido.estado)) return null;

      const dados = cadastroSnap.exists ? cadastroSnap.data() : null;
      const elegivel = dados && dados.dataISO === dataAtendimento &&
        dados.status === "compareceu" && !dados.anonimizadoLGPD && emailValido(dados.email);
      if (!elegivel) {
        if (pedidoSnap.exists) {
          tx.set(pedidoRef, {
            estado: "cancelado",
            dataAtendimento,
            alteradoEm: Timestamp.fromMillis(agora())
          });
        }
        return null;
      }

      const confirmadoMs = Date.parse(dados.statusAtualizadoEm);
      const confirmadoEm = Number.isFinite(confirmadoMs) && confirmadoMs <= agora() + 5 * 60 * 1000
        ? new Date(confirmadoMs).toISOString()
        : new Date(agora()).toISOString();
      tx.set(pedidoRef, {
        estado: "enviando",
        dataAtendimento,
        confirmadoEm: Timestamp.fromMillis(Date.parse(confirmadoEm)),
        tentativaEm: Timestamp.fromMillis(agora())
      });
      return {
        evento: "avaliacao_google",
        versao: 1,
        idempotencyKey: `avaliacao-google-v1:${cadastroRef.id}`,
        email: dados.email.trim(),
        nome: String(dados.nome || "").trim().slice(0, 120),
        confirmadoEm,
        dataAtendimento,
        avaliacaoUrl: config.googleUrl
      };
    });
    if (!payload) return;

    // SMTP nao oferece exactly-once. Depois da reserva, uma falha ambigua exige
    // reconciliacao humana no n8n; reenviar cegamente pode duplicar o convite.
    try {
      const response = await fetchImpl(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Avaliacao-Token": config.token },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(25000)
      });
      if (!response.ok) throw new Error("webhook_recusado");
      const recibo = await response.json();
      if (recibo.enviado !== true || recibo.idempotencyKey !== payload.idempotencyKey) {
        throw new Error("recibo_invalido");
      }
      await pedidoRef.update({ estado: "enviado", enviadoEm: Timestamp.fromMillis(agora()) });
    } catch (_) {
      // Nunca registra email, nome, token, URL secreta ou corpo da resposta.
      logger.error("avaliacao_google_requer_revisao", { pedidoId: cadastroRef.id });
      await pedidoRef.update({ estado: "revisar", revisarEm: Timestamp.fromMillis(agora()) });
    }
  }

  async function processarData(dataAtendimento, config) {
    validarConfiguracao(config);
    if (!dataISOValida(dataAtendimento)) throw new Error("Data de atendimento invalida.");
    const snapshot = await db.collection("dados_cidadaos")
      .where("dataISO", "==", dataAtendimento).get();
    for (let i = 0; i < snapshot.docs.length; i += 5) {
      await Promise.all(snapshot.docs.slice(i, i + 5)
        .map((doc) => processarCadastro(doc.ref, dataAtendimento, config)));
    }
  }

  return { processarCadastro, processarData };
}

module.exports = {
  COLECAO,
  FUSO_HORARIO,
  emailValido,
  dataISOValida,
  dataEmSaoPaulo,
  validarConfiguracao,
  criarServicoAvaliacao
};
