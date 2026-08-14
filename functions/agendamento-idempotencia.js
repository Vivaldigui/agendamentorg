"use strict";

const crypto = require("crypto");

const OPERACAO_AGENDAMENTO_VERSAO = 1;
const OPERACAO_AGENDAMENTO_TTL_MS = 24 * 60 * 60 * 1000;

function criarErroOperacao(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizarOperationId(value) {
  const operationId = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(operationId)) {
    throw criarErroOperacao(
      "operacao-invalida",
      "operationId deve identificar uma operacao aleatoria de 128 bits."
    );
  }
  return operationId;
}

function hashPayloadAgendamento(payload) {
  const payloadCanonico = [
    OPERACAO_AGENDAMENTO_VERSAO,
    normalizarOperationId(payload.operationId),
    String(payload.nome || ""),
    String(payload.cpfNum || ""),
    String(payload.telefone || "").replace(/\D/g, ""),
    String(payload.email || "").trim().toLowerCase(),
    String(payload.dataNasc || ""),
    String(payload.dataISO || ""),
    String(payload.hora || ""),
    payload.substituirAnterior === true,
  ];

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payloadCanonico), "utf8")
    .digest("hex");
}

function resultadoOperacaoValido(resultado) {
  if (!resultado || typeof resultado !== "object") return false;
  const agendamento = resultado.agendamento;
  if (!agendamento || typeof agendamento !== "object") return false;

  const camposAgendamento = ["id", "dataISO", "dataBR", "hora"];
  if (camposAgendamento.some((campo) => typeof agendamento[campo] !== "string" || !agendamento[campo])) {
    return false;
  }

  if (resultado.substituiu == null) return true;
  if (typeof resultado.substituiu !== "object") return false;
  return camposAgendamento.every(
    (campo) => typeof resultado.substituiu[campo] === "string" && resultado.substituiu[campo]
  );
}

function resolverOperacaoExistente(dados, payloadHash) {
  if (!dados) return null;

  const estruturaValida =
    dados.tipo === "criar_agendamento" &&
    dados.versao === OPERACAO_AGENDAMENTO_VERSAO &&
    typeof dados.payloadHash === "string" &&
    /^[a-f0-9]{64}$/.test(dados.payloadHash) &&
    resultadoOperacaoValido(dados.resultado);

  if (!estruturaValida) {
    throw criarErroOperacao(
      "operacao-invalida",
      "O comprovante interno desta operacao e invalido."
    );
  }

  if (dados.payloadHash !== payloadHash) {
    throw criarErroOperacao(
      "operacao-conflitante",
      "O operationId ja foi usado com dados diferentes."
    );
  }

  return dados.resultado;
}

module.exports = {
  OPERACAO_AGENDAMENTO_VERSAO,
  OPERACAO_AGENDAMENTO_TTL_MS,
  normalizarOperationId,
  hashPayloadAgendamento,
  resolverOperacaoExistente,
};
