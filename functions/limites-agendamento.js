"use strict";

// Limites de criacao de agendamento pelo site (auditoria de 16/10/2026, CON-01).
//
// Ate aqui o unico limite de criacao era por IP + User-Agent + CPF, com o IP
// tirado do primeiro X-Forwarded-For, que o cliente escreve. Com uma lista de
// CPFs validos, um so computador reservava quantas vagas a abertura tivesse.
// Dois tetos fecham isso, ambos conferidos DENTRO da transacao da reserva, para
// que uma rajada em paralelo nao passe inteira por uma checagem feita antes:
//
//   - por telefone: agendamentos ativos e futuros com o mesmo celular;
//   - por origem: agendamentos criados no dia (fuso de Sao Paulo) a partir do
//     mesmo IP confiavel. IPv6 conta pelo prefixo /64, que e o que uma
//     operadora entrega a um aparelho; contar pelo endereco inteiro deixaria
//     trocar de endereco dentro do proprio prefixo.
//
// Os valores ficam em configuracoes/agenda.limitesAgendamento, que a transacao
// ja le: a recepcao ajusta pelo console sem deploy. Zero desliga o teto.

const crypto = require("crypto");

const LIMITES_AGENDAMENTO_PADRAO = Object.freeze({
  // Mae que agenda o proprio atendimento e o de um filho cabe; uma lista de
  // CPFs com o mesmo celular, nao.
  porTelefone: 2,
  // Familia atras do mesmo roteador cabe. CGNAT de operadora pode juntar
  // estranhos no mesmo IP: com 24 vagas por semana, cinco reservas do mesmo
  // endereco no mesmo dia ja sao sinal de automacao.
  porOrigemDia: 4
});

const LIMITE_MAXIMO_CONFIGURAVEL = 50;

const TIPO_LIMITE_TELEFONE = "limite-telefone";
const TIPO_LIMITE_ORIGEM = "limite-origem";

function normalizarTeto(valor, padrao) {
  if (valor === undefined || valor === null || valor === "") return padrao;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0) return padrao;
  return Math.min(numero, LIMITE_MAXIMO_CONFIGURAVEL);
}

function normalizarLimitesAgendamento(valor) {
  const cfg = valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
  return {
    porTelefone: normalizarTeto(cfg.porTelefone, LIMITES_AGENDAMENTO_PADRAO.porTelefone),
    porOrigemDia: normalizarTeto(cfg.porOrigemDia, LIMITES_AGENDAMENTO_PADRAO.porOrigemDia)
  };
}

// Prefixo /64 de um IPv6, ja expandido. Devolve "" se o texto nao for IPv6.
function prefixoIPv6(ip) {
  let texto = String(ip || "").trim().toLowerCase();
  const zona = texto.indexOf("%");
  if (zona !== -1) texto = texto.slice(0, zona);
  if (!texto.includes(":") || !/^[0-9a-f:.]+$/.test(texto)) return "";
  const partesDuplas = texto.split("::");
  if (partesDuplas.length > 2) return "";
  const esquerda = partesDuplas[0] ? partesDuplas[0].split(":") : [];
  const direita = partesDuplas.length === 2 && partesDuplas[1] ? partesDuplas[1].split(":") : [];
  // IPv4 embutido no fim (::ffff:1.2.3.4) ocupa dois grupos.
  const ultimo = direita.length ? direita[direita.length - 1] : esquerda[esquerda.length - 1];
  const gruposDoUltimo = ultimo && ultimo.includes(".") ? 2 : 1;
  const informados = esquerda.length + direita.length + (gruposDoUltimo - 1);
  if (partesDuplas.length === 1 && informados !== 8) return "";
  if (informados > 8) return "";
  const grupos = [...esquerda, ...Array(8 - informados).fill("0"), ...direita];
  const primeiros = grupos.slice(0, 4);
  if (primeiros.some((grupo) => !/^[0-9a-f]{1,4}$/.test(grupo))) return "";
  return primeiros.map((grupo) => grupo.padStart(4, "0")).join(":");
}

// Chave da origem para o teto diario. "" quando nao ha IP utilizavel: juntar
// todos os pedidos sem IP num mesmo balde bloquearia gente sem relacao entre si.
function chaveOrigemLimite(ip) {
  const texto = String(ip || "").trim().toLowerCase();
  if (!texto || texto === "sem-ip") return "";
  const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(texto);
  if (mapeado) return `v4:${mapeado[1]}`;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(texto)) return `v4:${texto}`;
  const prefixo = prefixoIPv6(texto);
  return prefixo ? `v6:${prefixo}::/64` : "";
}

function hash(texto) {
  return crypto.createHash("sha256").update(texto).digest("hex");
}

function limiteOrigemDocId(chaveOrigem, dataISO) {
  return `origem_${hash(`${chaveOrigem}|${dataISO}`)}`;
}

function telefoneDocId(telefoneCanonico) {
  return `tel_${hash(String(telefoneCanonico || ""))}`;
}

// Quantos agendamentos listados no indice do telefone ainda valem: ativos e com
// data de hoje em diante. O indice se corrige sozinho: cancelados e passados
// saem na proxima gravacao, sem depender de cada fluxo de cancelamento.
function agendamentosQueContamNoTelefone(docs, hojeISO, estaAtivo) {
  return (Array.isArray(docs) ? docs : [])
    .filter((doc) => doc && doc.exists)
    .filter((doc) => {
      const dados = doc.data() || {};
      return estaAtivo(dados) && String(dados.dataISO || "") >= hojeISO;
    })
    .map((doc) => ({ id: doc.id, dataISO: String(doc.data().dataISO || "") }));
}

function excedeTeto(quantidadeAtual, teto) {
  return teto > 0 && quantidadeAtual >= teto;
}

function mensagemLimiteTelefone(teto) {
  return `Este celular ja esta em ${teto} ${teto === 1 ? "agendamento ativo" : "agendamentos ativos"}. `
    + "Para agendar mais pessoas da familia, use outro numero de celular ou fale com a Camara pelo WhatsApp (35) 3504-0397.";
}

function mensagemLimiteOrigem() {
  return "Esta conexao ja fez o numero maximo de agendamentos de hoje. "
    + "Se voce esta agendando para varias pessoas, fale com a Camara pelo WhatsApp (35) 3504-0397.";
}

// Fim do dia seguinte a data, em ms: prazo para a limpeza diaria apagar o doc.
function expiracaoAposData(dataISO) {
  const ms = Date.parse(`${dataISO}T23:59:59-03:00`);
  return (Number.isFinite(ms) ? ms : Date.now()) + 24 * 60 * 60 * 1000;
}

module.exports = {
  LIMITES_AGENDAMENTO_PADRAO,
  LIMITE_MAXIMO_CONFIGURAVEL,
  TIPO_LIMITE_TELEFONE,
  TIPO_LIMITE_ORIGEM,
  normalizarLimitesAgendamento,
  prefixoIPv6,
  chaveOrigemLimite,
  limiteOrigemDocId,
  telefoneDocId,
  agendamentosQueContamNoTelefone,
  excedeTeto,
  mensagemLimiteTelefone,
  mensagemLimiteOrigem,
  expiracaoAposData
};
