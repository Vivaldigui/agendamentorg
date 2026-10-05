"use strict";

const crypto = require("node:crypto");

const COLECAO = "pedidos_avaliacao_google";
const COLECAO_DESTINATARIOS = "destinatarios_avaliacao_google";
const TERMINAIS = new Set(["enviando", "enviado", "revisar"]);
const FUSO_HORARIO = "America/Sao_Paulo";

function emailValido(valor) {
  if (typeof valor !== "string") return false;
  const email = valor.trim();
  // Um destinatario apenas: o campo To do SMTP aceita listas separadas por virgula.
  return email.length <= 120 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email);
}

function identificadorDestinatario(email, chave) {
  const chaveNormalizada = typeof chave === "string" ? chave.trim() : "";
  if (!emailValido(email) || chaveNormalizada.length < 32 || /[\r\n]/.test(chaveNormalizada)) {
    throw new Error("Destinatario ou chave de deduplicacao invalida.");
  }
  return crypto.createHmac("sha256", chaveNormalizada)
    .update(email.trim().toLowerCase(), "utf8").digest("hex");
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

function validarConfiguracao({ webhookUrl, token, googleUrl, dedupeKey }) {
  for (const valor of [webhookUrl, googleUrl]) {
    const url = new URL(valor);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("A integracao exige URLs HTTPS sem credenciais na URL.");
    }
  }
  if (typeof token !== "string" || token.trim().length < 32 || /[\r\n]/.test(token)) {
    throw new Error("Configure um token de webhook com pelo menos 32 caracteres.");
  }
  const chaveNormalizada = typeof dedupeKey === "string" ? dedupeKey.trim() : "";
  if (chaveNormalizada.length < 32 || /[\r\n]/.test(chaveNormalizada)) {
    throw new Error("Configure uma chave de deduplicacao com pelo menos 32 caracteres.");
  }
}

function criarServicoAvaliacao({ db, Timestamp, fetchImpl = fetch, logger = console, agora = Date.now }) {
  const fila = db.collection(COLECAO);
  const destinatarios = db.collection(COLECAO_DESTINATARIOS);

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

      const destinatarioRef = destinatarios.doc(identificadorDestinatario(dados.email, config.dedupeKey));
      const destinatarioSnap = await tx.get(destinatarioRef);
      const destinatario = destinatarioSnap.exists ? destinatarioSnap.data() : null;
      if (destinatario && TERMINAIS.has(destinatario.estado)) {
        tx.set(pedidoRef, {
          estado: "cancelado",
          motivo: "destinatario_ja_processado",
          dataAtendimento,
          alteradoEm: Timestamp.fromMillis(agora())
        });
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
      tx.set(destinatarioRef, {
        estado: "enviando",
        pedidoId: cadastroRef.id,
        dataAtendimento,
        tentativaEm: Timestamp.fromMillis(agora())
      });
      return {
        destinatarioRef,
        body: {
          evento: "avaliacao_google",
          versao: 1,
          idempotencyKey: `avaliacao-google-v1:${cadastroRef.id}`,
          email: dados.email.trim(),
          nome: String(dados.nome || "").trim().slice(0, 120),
          confirmadoEm,
          dataAtendimento,
          avaliacaoUrl: config.googleUrl
        }
      };
    });
    if (!payload) return;
    const { body, destinatarioRef } = payload;

    // SMTP nao oferece exactly-once. Depois da reserva, uma falha ambigua exige
    // reconciliacao humana no n8n; reenviar cegamente pode duplicar o convite.
    try {
      const response = await fetchImpl(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Avaliacao-Token": config.token },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(25000)
      });
      if (!response.ok) throw new Error("webhook_recusado");
      const recibo = await response.json();
      if (recibo.enviado !== true || recibo.idempotencyKey !== body.idempotencyKey) {
        throw new Error("recibo_invalido");
      }
      const enviadoEm = Timestamp.fromMillis(agora());
      await Promise.all([
        pedidoRef.update({ estado: "enviado", enviadoEm }),
        destinatarioRef.update({ estado: "enviado", enviadoEm })
      ]);
    } catch (_) {
      // Nunca registra email, nome, token, URL secreta ou corpo da resposta.
      logger.error("avaliacao_google_requer_revisao", { pedidoId: cadastroRef.id });
      const revisarEm = Timestamp.fromMillis(agora());
      await Promise.all([
        pedidoRef.update({ estado: "revisar", revisarEm }),
        destinatarioRef.update({ estado: "revisar", revisarEm })
      ]);
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
  COLECAO_DESTINATARIOS,
  FUSO_HORARIO,
  emailValido,
  identificadorDestinatario,
  dataISOValida,
  dataEmSaoPaulo,
  validarConfiguracao,
  criarServicoAvaliacao
};
