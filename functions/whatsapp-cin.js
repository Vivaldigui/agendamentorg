"use strict";

// Mensagens de utilidade do agendamento pelo WhatsApp de teste da CIN.
// Caminho: fila no Firestore -> rotina a cada 10 min -> webhook do n8n da
// Camara -> WAHA (servico waha-cin). Plano em docs/PLANO-WHATSAPP-WAHA.md.
//
// Regras:
// - so sai para quem marcou a caixa do WhatsApp no formulario (avisoWhatsapp);
// - modo "desligado" nao faz nada; "ensaio" so envia para os telefones de teste;
//   "ativo" envia para todos os que aceitaram;
// - nada sai na hora: o gatilho so poe na fila. A abertura das vagas (8h) gera
//   uma rajada de agendamentos, e a rotina (a cada 5 min) manda aos poucos, com
//   pausa de 15 a 30 s entre mensagens e so das 7h as 21h, para o numero nao
//   ser bloqueado;
// - cada mensagem tem uma chave unica em whatsapp_envios e nunca sai duas
//   vezes; falha ambigua fica em "revisar";
// - na hora de enviar, o agendamento e relido: confirmacao de quem ja cancelou
//   ou lembrete de horario que mudou e descartado;
// - a fila nao guarda telefone nem texto, e a mensagem nunca leva CPF nem
//   data de nascimento;
// - remarcacao nao gera aviso: com poucas vagas, a recepcao nao remarca.

const crypto = require("node:crypto");

const COLECAO_ENVIOS = "whatsapp_envios";
// Um convite de avaliacao por celular em todo o historico (HMAC do telefone,
// sem guardar o numero). Familia que agenda varias pessoas no mesmo celular
// recebe um so.
const COLECAO_AVALIACAO_DESTINATARIOS = "whatsapp_avaliacao_destinatarios";
const LINK_AVALIACAO_PADRAO = "https://g.page/r/CfugOJBgujYPEBM/review";
const SITE = "https://cin.itanhandu.cam.mg.gov.br";
const LINK_DOCUMENTOS = `${SITE}/cin/dia-do-atendimento/`;
const LINK_CANCELAR = `${SITE}/cin/consultar-ou-cancelar/`;
const ENDERECO = "Rua Eng. Paulo Franco da Rosa, 298, Centro";
const TELEFONE_CAMARA = "(35) 3504-0397";
const RODAPE = "Para não receber mais avisos por aqui, responda SAIR.";
const MODOS = new Set(["desligado", "ensaio", "ativo"]);
const TIPOS = new Set(["confirmacao", "lembrete", "cancelado_camara", "cancelado_cidadao", "avaliacao", "rg_pronto"]);
// Aviso de "RG pronto para retirar": a recepcao marca no painel (aba RG pronto)
// quando a carteira chega. Vai para todo cadastro com celular, mesmo sem o
// aceite do WhatsApp (agendamentos antes de 15/11/2026): o telefone foi pedido
// "para a Camara entrar em contato", e e exatamente isso. Quem respondeu SAIR
// nao recebe (o n8n confere).
const TIPOS_SEM_ACEITE = new Set(["rg_pronto"]);
const HORARIO_RETIRADA = "de segunda a sexta, das *8h às 12h* e das *14h às 17h*";
const STATUS_VALENDO = new Set(["agendado", "remarcado"]);
const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const FUSO_HORARIO = "America/Sao_Paulo";

// Ritmo do envio (numero novo, sem API oficial: cuidado com bloqueio).
// - Pausa de 45 a 90 s entre mensagens. A rotina roda a cada 5 min e so comeca
//   uma mensagem se a pausa e o envio cabem em 3,5 min, longe do limite de 300 s
//   da function: ~3 a 4 mensagens por rodada. Com ~25 agendamentos na abertura
//   das 8h, as confirmacoes terminam por volta das 8h40.
// - Teto de 60 mensagens por dia (contagem em whatsapp_controle/dia_AAAA-MM-DD);
//   o que passar fica na fila para o dia seguinte.
// - Disjuntor: 3 falhas seguidas (erro ou revisar, o que inclui o WhatsApp
//   desconectado) param o envio e gravam whatsapp_controle/disjuntor com
//   ativo: true. Nada sai ate alguem apagar esse documento (ou por ativo: false)
//   no console do Firebase, depois de conferir o celular e o WAHA.
const PAUSA_MIN_MS = 45000;
const PAUSA_MAX_MS = 90000;
const ORCAMENTO_RODADA_MS = 3.5 * 60 * 1000;
const LIMITE_DIARIO = 60;
const FALHAS_PARA_DISJUNTOR = 3;
const COLECAO_CONTROLE = "whatsapp_controle";
const STATUS_FALHA = new Set(["erro", "revisar"]);
const HORA_INICIO_ENVIO = 7;
const HORA_FIM_ENVIO = 21; // ate 21h59
// Lembrete no dia do atendimento, 6 h antes do horario. Atendimento cedo (antes
// das 13h) recebe as 7h, que e o comeco da janela de envio.
const ANTECEDENCIA_LEMBRETE_MIN = 6 * 60;
// Convite de avaliacao: a partir das 17h do dia, para quem a recepcao marcou
// "Compareceu" (mesma hora do convite por e-mail).
const HORA_AVALIACAO = 17;

function minutosDoDia(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Minuto do dia a partir do qual o lembrete pode sair.
function inicioDoLembrete(hora) {
  const minutos = minutosDoDia(hora);
  if (minutos === null) return null;
  return Math.max(HORA_INICIO_ENVIO * 60, minutos - ANTECEDENCIA_LEMBRETE_MIN);
}

function dataISOValida(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T12:00:00Z`);
  return Number.isFinite(data.getTime()) && data.toISOString().startsWith(valor);
}

function agoraEmSaoPaulo(ms = Date.now()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_HORARIO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { dataISO: `${partes.year}-${partes.month}-${partes.day}`, hora: Number(partes.hour), minuto: Number(partes.hour) * 60 + Number(partes.minute) };
}

function somarDias(dataISO, dias) {
  const data = new Date(`${dataISO}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

// "sexta-feira, 20/11". Sem o ano: o agendamento e sempre para as proximas semanas.
function dataPorExtenso(dataISO) {
  if (!dataISOValida(dataISO)) return "";
  const [, mes, dia] = dataISO.split("-");
  const semana = DIAS_SEMANA[new Date(`${dataISO}T12:00:00Z`).getUTCDay()];
  return `${semana}, ${dia}/${mes}`;
}

// "09:30" -> "9h30"; "14:00" -> "14h"
function horaFalada(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || "").trim());
  if (!m) return "";
  const h = String(Number(m[1]));
  return m[2] === "00" ? `${h}h` : `${h}h${m[2]}`;
}

function primeiroNome(nome) {
  const primeiro = String(nome || "").trim().split(/\s+/)[0] || "";
  if (!primeiro) return "";
  return primeiro.charAt(0).toLocaleUpperCase("pt-BR") + primeiro.slice(1).toLocaleLowerCase("pt-BR");
}

// Celular brasileiro no formato do WhatsApp: 55 + DDD + 9 digitos.
// Fixo e numero incompleto voltam vazios (nao ha WhatsApp para avisar).
function telefoneWhatsApp(valor) {
  let digitos = String(valor || "").replace(/\D/g, "");
  if (digitos.length > 11 && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length === 10 && /^[6-9]/.test(digitos.slice(2))) {
    digitos = `${digitos.slice(0, 2)}9${digitos.slice(2)}`;
  }
  if (!/^[1-9]{2}9\d{8}$/.test(digitos)) return "";
  return `55${digitos}`;
}

function listaTelefonesTeste(texto) {
  return new Set(String(texto || "").split(/[,;\s]+/).map(telefoneWhatsApp).filter(Boolean));
}

// Documentos que a pessoa leva (confirmacao e lembrete). Asteriscos = negrito
// no WhatsApp.
const O_QUE_LEVAR = [
  "📄 *O que levar:*",
  "• *Certidão de nascimento ou de casamento*, *original ou cópia autenticada*, sem rasgos nem rasuras, de acordo com o seu estado civil:",
  "   – solteiro(a) ou união estável: *nascimento*",
  "   – casado(a): *casamento*",
  "   – viúvo(a) ou divorciado(a): *casamento com a averbação*",
  "• *Número do CPF*",
  "• *Comprovante de endereço*"
];
// Um link so por mensagem (o de cancelar): mensagem de numero novo cheia de
// links tem cara de propaganda.

// Variacoes de texto, para nao sair a mesma mensagem para todo mundo. A
// variante 0 e o texto de referencia; a rotina escolhe pela chave do envio.
function escolher(lista, variante) {
  const n = Math.abs(Math.floor(Number(variante) || 0));
  return lista[n % lista.length];
}
function varianteDaChave(chave) {
  return parseInt(require("node:crypto").createHash("sha1").update(String(chave)).digest("hex").slice(0, 8), 16);
}

function montarMensagem(tipo, dados, extras = {}) {
  const nome = primeiroNome(dados.nome);
  const v = extras.variante || 0;
  const ola = escolher(nome
    ? [`Olá, *${nome}*!`, `Oi, *${nome}*!`, `*${nome}*, tudo bem?`]
    : ["Olá!", "Oi!", "Tudo bem?"], v);
  const quando = `*${dataPorExtenso(dados.dataISO)}, às ${horaFalada(dados.hora)}*`;
  const detalhes = [
    `📅 ${quando}`,
    `📍 ${ENDERECO}`,
    ...(dados.protocolo ? [`🔖 Protocolo: *${dados.protocolo}*`] : [])
  ];
  const cancelar = `⚠️ *Não vai poder ir?* Cancele para liberar a vaga: ${LINK_CANCELAR}`;
  const linhas = (...partes) => partes.flat().join("\n");

  switch (tipo) {
    case "confirmacao":
      return linhas(
        escolher(["✅ *Agendamento confirmado*", "✅ *Seu agendamento está confirmado*", "📌 *Agendamento confirmado*"], v),
        "",
        `${ola} ${escolher([
          "Seu agendamento do *RG (Carteira de Identidade)* na Câmara de Itanhandu está confirmado.",
          "Está confirmado o seu agendamento do *RG (Carteira de Identidade)* na Câmara de Itanhandu.",
          "Recebemos e confirmamos o seu agendamento do *RG (Carteira de Identidade)* na Câmara de Itanhandu."
        ], v / 3)}`,
        "",
        detalhes,
        "",
        O_QUE_LEVAR,
        "",
        cancelar,
        "",
        escolher(["🔔 No dia do atendimento, mandamos um lembrete por aqui.", "🔔 No dia do atendimento, você recebe um lembrete por aqui.", "🔔 No dia, mandamos um lembrete por aqui."], v / 9),
        RODAPE
      );
    case "lembrete":
      return linhas(
        escolher(["🔔 *Lembrete: seu atendimento é HOJE*", "🔔 *Seu atendimento é HOJE*", "⏰ *Lembrete: seu atendimento é HOJE*"], v),
        "",
        `${ola} ${escolher([
          "Hoje é o seu atendimento do *RG (Carteira de Identidade)* na Câmara de Itanhandu.",
          "O seu atendimento do *RG (Carteira de Identidade)* na Câmara de Itanhandu é hoje.",
          "Passando para lembrar: hoje é o seu atendimento do *RG (Carteira de Identidade)* na Câmara de Itanhandu."
        ], v / 3)}`,
        "",
        detalhes,
        "",
        "‼️ *NÃO ESQUEÇA A CERTIDÃO!* ‼️",
        "Sem a *certidão de nascimento ou de casamento* (original ou cópia autenticada), *não dá para fazer o RG*.",
        "",
        O_QUE_LEVAR,
        "",
        cancelar,
        "",
        RODAPE
      );
    case "cancelado_camara":
      return linhas(
        "🚫 *Agendamento cancelado*",
        "",
        `${ola} Seu agendamento do RG de ${quando} foi *cancelado pela Câmara de Itanhandu*.`,
        "",
        `🗓️ Para marcar outro dia: ${SITE}`,
        `📞 Dúvidas: ${TELEFONE_CAMARA}`,
        "",
        RODAPE
      );
    case "cancelado_cidadao":
      return linhas(
        "🚫 *Agendamento cancelado*",
        "",
        `${ola} Seu agendamento do RG de ${quando} foi *cancelado*, como você pediu.`,
        "",
        `🗓️ Para marcar outro dia: ${SITE}`,
        "",
        RODAPE
      );
    case "rg_pronto":
      return linhas(
        escolher(["🎉 *Seu RG está pronto!*", "🎉 *Sua carteira de identidade chegou!*", "📬 *Seu RG está pronto para retirar*"], v),
        "",
        `${ola} ${escolher([
          "A sua *Carteira de Identidade (CIN)* chegou na Câmara de Itanhandu e já pode ser retirada.",
          "A sua *Carteira de Identidade (CIN)* já está na Câmara de Itanhandu, pronta para retirar.",
          "Chegou na Câmara de Itanhandu a sua *Carteira de Identidade (CIN)*. Já pode buscar."
        ], v / 3)}`,
        "",
        `🕗 *Retirada:* ${HORARIO_RETIRADA}`,
        `📍 ${ENDERECO}`,
        "",
        `📞 Dúvidas: ${TELEFONE_CAMARA}`,
        "",
        RODAPE
      );
    case "avaliacao":
      return linhas(
        "⭐ *Como foi o seu atendimento?*",
        "",
        `${ola} Você fez seu *RG (Carteira de Identidade)* na Câmara de Itanhandu. Se puder, conte como foi no Google. Leva menos de 1 minuto:`,
        `👉 ${extras.googleUrl || LINK_AVALIACAO_PADRAO}`,
        "",
        "É voluntário e nos ajuda a melhorar o atendimento. Este é um convite único.",
        "",
        RODAPE
      );
    default:
      throw new Error(`Tipo de mensagem desconhecido: ${tipo}`);
  }
}

// O convite vai primeiro pelo WhatsApp; o e-mail (avaliacao-google.js, 18h) so
// sai para quem o WhatsApp nao alcancou. Estes status contam como alcancado
// (ou ainda a caminho): o e-mail nao repete.
const CONVITE_WHATSAPP_ALCANCOU = new Set(["pendente", "enviando", "enviado", "revisar", "ja_convidado"]);

// Decide, pela mudanca no documento de dados_cidadaos, qual aviso entra na fila.
function eventoDoAgendamento(antes, depois, hojeISO) {
  // RG pronto: a recepcao marcou no painel (o atendimento ja passou).
  if (depois && depois.rgPronto === true && (!antes || antes.rgPronto !== true)
    && depois.status === "compareceu" && depois.telefone) return "rg_pronto";
  if (!depois || depois.avisoWhatsapp !== true) return null;
  if (!dataISOValida(depois.dataISO) || depois.dataISO < hojeISO) return null;
  if (!antes) return depois.status === "agendado" ? "confirmacao" : null;
  if (antes.status !== depois.status) {
    if (depois.status === "cancelado") return "cancelado_camara";
    if (depois.status === "cancelado_cidadao") return "cancelado_cidadao";
  }
  return null;
}

// Na hora do envio: a mensagem ainda faz sentido para o agendamento como esta?
function aindaValido(tipo, envio, dados, hojeISO, minutoAgora = 0) {
  if (tipo === "rg_pronto") {
    // Desmarcado no painel antes de sair, ou cadastro anonimizado: descarta.
    return Boolean(dados && dados.telefone && dados.rgPronto === true && dados.status === "compareceu");
  }
  if (!dados || dados.avisoWhatsapp !== true || !dados.telefone) return false;
  if (dados.dataISO !== envio.dataISO || (dados.hora || "") !== envio.hora) return false;
  if (dados.dataISO < hojeISO) return false;
  switch (tipo) {
    case "confirmacao": return dados.status === "agendado" && dados.ativo !== false;
    case "lembrete":
      // Lembrete e do dia, e nao sai depois do horario do atendimento.
      return STATUS_VALENDO.has(dados.status) && dados.ativo !== false
        && dados.dataISO === hojeISO && minutosDoDia(dados.hora) > minutoAgora;
    case "cancelado_camara": return dados.status === "cancelado";
    case "cancelado_cidadao": return dados.status === "cancelado_cidadao";
    case "avaliacao": return dados.status === "compareceu";
    default: return false;
  }
}

function chaveEnvio(tipo, agendamentoId, dados) {
  // RG pronto: a chave leva a hora da marcacao, para uma nova marcacao (depois
  // de desfazer) gerar outro aviso.
  if (tipo === "rg_pronto") return `rg_pronto_${agendamentoId}_${String(dados.rgProntoEm || "").replace(/\D/g, "").slice(0, 14)}`;
  const hora = String(dados.hora || "").replace(/\D/g, "");
  return `${tipo}_${agendamentoId}_${dados.dataISO}_${hora}`;
}

function validarConfiguracao(config) {
  const modo = String(config && config.modo || "desligado").trim();
  if (!MODOS.has(modo)) throw new Error(`WHATSAPP_CIN_MODO invalido: ${modo}`);
  if (modo === "desligado") return { modo };
  const webhookUrl = String(config.webhookUrl || "").trim();
  if (!/^https:\/\/[^\s]+$/.test(webhookUrl)) throw new Error("WHATSAPP_CIN_WEBHOOK_URL invalida.");
  const token = String(config.token || "").trim();
  if (token.length < 32 || /[\r\n]/.test(token)) throw new Error("WHATSAPP_CIN_N8N_TOKEN invalido.");
  const telefonesTeste = config.telefonesTeste instanceof Set
    ? config.telefonesTeste
    : listaTelefonesTeste(config.telefonesTeste);
  if (modo === "ensaio" && telefonesTeste.size === 0) {
    throw new Error("Modo ensaio sem WHATSAPP_CIN_TELEFONES_TESTE.");
  }
  const googleUrl = /^https:\/\/[^\s]+$/.test(String(config.googleUrl || "")) ? String(config.googleUrl) : LINK_AVALIACAO_PADRAO;
  return { modo, webhookUrl, token, telefonesTeste, googleUrl };
}

// O gatilho nao precisa do token: valida so o modo e a lista de teste.
function configuracaoDaFila(config) {
  const modo = String(config && config.modo || "desligado").trim();
  if (!MODOS.has(modo)) throw new Error(`WHATSAPP_CIN_MODO invalido: ${modo}`);
  const telefonesTeste = config.telefonesTeste instanceof Set
    ? config.telefonesTeste
    : listaTelefonesTeste(config.telefonesTeste);
  return { modo, telefonesTeste };
}

function criarServicoWhatsappCin({
  db,
  FieldValue,
  fetchImpl = fetch,
  logger = console,
  agora = Date.now,
  esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  sortear = Math.random
}) {
  // Poe uma mensagem na fila. Nao envia nada.
  // opcoes.chaveTelefone: so para o convite de avaliacao (um por celular).
  async function enfileirar(tipo, agendamentoId, dados, configBruta, opcoes = {}) {
    if (!TIPOS.has(tipo)) throw new Error(`Tipo de mensagem desconhecido: ${tipo}`);
    const config = configuracaoDaFila(configBruta);
    if (config.modo === "desligado") return { status: "desligado" };
    if (!dados || (dados.avisoWhatsapp !== true && !TIPOS_SEM_ACEITE.has(tipo))) return { status: "sem_aceite" };
    const telefone = telefoneWhatsApp(dados.telefone);
    if (!telefone) return { status: "sem_celular" };
    if (config.modo === "ensaio" && !config.telefonesTeste.has(telefone)) return { status: "fora_do_ensaio" };

    const chave = chaveEnvio(tipo, agendamentoId, dados);
    const envioRef = db.collection(COLECAO_ENVIOS).doc(chave);
    const telRef = opcoes.chaveTelefone
      ? db.collection(COLECAO_AVALIACAO_DESTINATARIOS).doc(opcoes.chaveTelefone)
      : null;
    const resultado = await db.runTransaction(async (t) => {
      const atual = await t.get(envioRef);
      const telDoc = telRef ? await t.get(telRef) : null;
      if (atual.exists) return "repetido";
      const jaConvidado = Boolean(telDoc && telDoc.exists);
      if (telRef && !jaConvidado) t.set(telRef, { agendamentoId, criadoEm: FieldValue.serverTimestamp() });
      t.set(envioRef, {
        tipo,
        agendamentoId,
        dataISO: dados.dataISO,
        hora: dados.hora || "",
        modo: config.modo,
        // ja_convidado fica registrado (fora da fila) para o e-mail nao repetir.
        status: jaConvidado ? "ja_convidado" : "pendente",
        ordem: agora(),
        criadoEm: FieldValue.serverTimestamp()
      });
      return jaConvidado ? "ja_convidado" : "na_fila";
    });
    return { status: resultado, chave };
  }

  // Convites de avaliacao de hoje: todos que compareceram (o e-mail e reserva).
  async function enfileirarAvaliacoes(hojeISO, config) {
    const resumo = { total: 0, na_fila: 0 };
    if (!dataISOValida(hojeISO)) throw new Error("Data da avaliacao invalida.");
    const consulta = await db.collection("dados_cidadaos")
      .where("dataISO", "==", hojeISO)
      .where("avisoWhatsapp", "==", true)
      .get();
    for (const doc of consulta.docs) {
      const dados = doc.data();
      if (dados.status !== "compareceu") continue;
      const telefone = telefoneWhatsApp(dados.telefone);
      if (!telefone) continue;
      resumo.total += 1;
      const chaveTelefone = crypto.createHmac("sha256", config.token).update(telefone, "utf8").digest("hex");
      const r = await enfileirar("avaliacao", doc.id, dados, config, { chaveTelefone });
      if (r.status === "na_fila") resumo.na_fila += 1;
    }
    return resumo;
  }

  // Lembretes de hoje cuja hora de sair ja chegou (6 h antes do atendimento).
  async function enfileirarLembretes(hojeISO, minutoAgora, configBruta) {
    const resumo = { total: 0, na_fila: 0 };
    if (!dataISOValida(hojeISO)) throw new Error("Data do lembrete invalida.");
    const consulta = await db.collection("dados_cidadaos")
      .where("dataISO", "==", hojeISO)
      .where("avisoWhatsapp", "==", true)
      .get();
    for (const doc of consulta.docs) {
      const dados = doc.data();
      if (!STATUS_VALENDO.has(dados.status) || dados.ativo === false) continue;
      const inicio = inicioDoLembrete(dados.hora);
      if (inicio === null || minutoAgora < inicio || minutoAgora >= minutosDoDia(dados.hora)) continue;
      resumo.total += 1;
      const r = await enfileirar("lembrete", doc.id, dados, configBruta);
      if (r.status === "na_fila") resumo.na_fila += 1;
    }
    return resumo;
  }

  async function enviarAoN8n(config, corpo) {
    try {
      const resposta = await fetchImpl(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Cin-Token": config.token },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(60000)
      });
      let json = {};
      try { json = await resposta.json(); } catch (_) { json = {}; }
      if (resposta.ok && json.enviado === true) {
        return { status: "enviado", mensagemId: String(json.mensagemId || "").slice(0, 200) };
      }
      if (resposta.ok && typeof json.motivo === "string") {
        // Recusa definitiva do n8n: numero sem WhatsApp ou pessoa que pediu para sair.
        return { status: json.motivo.slice(0, 40) };
      }
      if (resposta.status >= 400 && resposta.status < 500) return { status: "erro", detalhe: `HTTP ${resposta.status}` };
      return { status: "revisar", detalhe: `HTTP ${resposta.status}` };
    } catch (erro) {
      // Tempo esgotado ou rede: a mensagem pode ter saido. Nao reenvia sozinho.
      return { status: "revisar", detalhe: String(erro && erro.message || erro).slice(0, 200) };
    }
  }

  // Pega a vez de uma mensagem: relida em transacao, so uma rodada envia.
  async function reservar(envioRef, hojeISO, minutoAgora) {
    return db.runTransaction(async (t) => {
      const envioDoc = await t.get(envioRef);
      if (!envioDoc.exists) return null;
      const envio = envioDoc.data();
      if (envio.status !== "pendente") return null;
      const agRef = db.collection("dados_cidadaos").doc(envio.agendamentoId);
      const agDoc = await t.get(agRef);
      const dados = agDoc.exists ? agDoc.data() : null;
      if (!aindaValido(envio.tipo, envio, dados, hojeISO, minutoAgora)) {
        t.update(envioRef, { status: "descartado", atualizadoEm: FieldValue.serverTimestamp() });
        return { envio, dados: null };
      }
      t.update(envioRef, { status: "enviando", atualizadoEm: FieldValue.serverTimestamp() });
      return { envio, dados };
    });
  }

  // Uma rodada da rotina: lembretes do dia (6 h antes) e envio da fila, aos poucos.
  async function processarFila(configBruta) {
    const inicio = agora();
    const resumo = { lembretes: null, avaliacoes: null, enviados: 0, descartados: 0, outros: {}, restantes: 0 };
    const config = validarConfiguracao(configBruta);
    if (config.modo === "desligado") return resumo;
    const { dataISO: hojeISO, hora, minuto } = agoraEmSaoPaulo(inicio);
    if (hora < HORA_INICIO_ENVIO || hora > HORA_FIM_ENVIO) return resumo;

    const disjuntorRef = db.collection(COLECAO_CONTROLE).doc("disjuntor");
    const contagemRef = db.collection(COLECAO_CONTROLE).doc(`dia_${hojeISO}`);
    const controle = await db.runTransaction(async (t) => {
      const d = await t.get(disjuntorRef);
      const c = await t.get(contagemRef);
      return {
        disjuntor: d.exists && d.data().ativo === true,
        enviadosHoje: c.exists ? Number(c.data().enviados) || 0 : 0
      };
    });
    if (controle.disjuntor) {
      resumo.disjuntor = true;
      logger.error("whatsapp-cin: disjuntor ligado, nada sai (apague whatsapp_controle/disjuntor depois de conferir o celular e o WAHA)");
      return resumo;
    }
    let enviadosHoje = controle.enviadosHoje;
    let falhasSeguidas = 0;

    resumo.lembretes = await enfileirarLembretes(hojeISO, minuto, config);
    if (hora >= HORA_AVALIACAO) resumo.avaliacoes = await enfileirarAvaliacoes(hojeISO, config);

    const consulta = await db.collection(COLECAO_ENVIOS).where("status", "==", "pendente").limit(200).get();
    const fila = consulta.docs
      .map((doc) => ({ ref: doc.ref, ordem: Number(doc.data().ordem) || 0 }))
      .sort((a, b) => a.ordem - b.ordem);

    let enviouAlgum = false;
    for (let i = 0; i < fila.length; i += 1) {
      if (enviadosHoje >= LIMITE_DIARIO) {
        resumo.limiteDiario = true;
        resumo.restantes = fila.length - i;
        break;
      }
      // A pausa e sorteada antes: so comeca a mensagem se pausa + envio cabem.
      const pausa = enviouAlgum ? PAUSA_MIN_MS + Math.floor(sortear() * (PAUSA_MAX_MS - PAUSA_MIN_MS)) : 0;
      if (agora() - inicio + pausa > ORCAMENTO_RODADA_MS) {
        resumo.restantes = fila.length - i;
        break;
      }
      const vez = await reservar(fila[i].ref, hojeISO, agoraEmSaoPaulo(agora()).minuto);
      if (!vez) continue;
      if (!vez.dados) { resumo.descartados += 1; continue; }

      if (pausa) await esperar(pausa);
      const telefone = telefoneWhatsApp(vez.dados.telefone);
      const resultado = telefone
        ? await enviarAoN8n(config, {
          chave: fila[i].ref.id,
          tipo: vez.envio.tipo,
          telefone,
          texto: montarMensagem(vez.envio.tipo, vez.dados, { googleUrl: config.googleUrl, variante: varianteDaChave(fila[i].ref.id) })
        })
        : { status: "sem_celular" };
      enviouAlgum = true;
      await fila[i].ref.update({ ...resultado, atualizadoEm: FieldValue.serverTimestamp() });
      if (resultado.status === "enviado") {
        resumo.enviados += 1;
        enviadosHoje += 1;
        falhasSeguidas = 0;
        await db.runTransaction(async (t) => {
          t.set(contagemRef, { dataISO: hojeISO, enviados: enviadosHoje, atualizadoEm: FieldValue.serverTimestamp() });
        });
        continue;
      }
      resumo.outros[resultado.status] = (resumo.outros[resultado.status] || 0) + 1;
      logger.warn("whatsapp-cin: envio nao concluido", { chave: fila[i].ref.id, status: resultado.status, detalhe: resultado.detalhe || "" });
      falhasSeguidas = STATUS_FALHA.has(resultado.status) ? falhasSeguidas + 1 : 0;
      if (falhasSeguidas >= FALHAS_PARA_DISJUNTOR) {
        await db.runTransaction(async (t) => {
          t.set(disjuntorRef, {
            ativo: true,
            motivo: `${falhasSeguidas} falhas seguidas; ultima: ${resultado.status} ${resultado.detalhe || ""}`.trim().slice(0, 300),
            em: FieldValue.serverTimestamp()
          });
        });
        resumo.disjuntor = true;
        resumo.restantes = fila.length - i - 1;
        logger.error("whatsapp-cin: disjuntor ligado depois de falhas seguidas; envio parado", { ultima: resultado.status, detalhe: resultado.detalhe || "" });
        break;
      }
    }
    return resumo;
  }

  return { enfileirar, enfileirarLembretes, enfileirarAvaliacoes, processarFila };
}

// Limpeza da fila (manutencao diaria em index.js): apaga os registros de
// whatsapp_envios com data de atendimento anterior ao corte (6 meses, o mesmo
// prazo da anonimizacao do agendamento). Os registros so tem tipo, data, status
// e o id do agendamento, mas nao precisam durar mais que o proprio agendamento.
// whatsapp_avaliacao_destinatarios fica: e o que garante o convite unico por
// celular e guarda so um HMAC do numero, como os destinatarios do e-mail.
const LIMPEZA_PAGINA = 300;
const LIMPEZA_MAX_POR_EXECUCAO = 5000;

async function limparEnviosAntigos(db, corteISO, { pagina = LIMPEZA_PAGINA, maximo = LIMPEZA_MAX_POR_EXECUCAO } = {}) {
  if (!dataISOValida(corteISO)) throw new Error("Data de corte invalida.");
  let apagados = 0;
  while (apagados < maximo) {
    const consulta = await db.collection(COLECAO_ENVIOS)
      .where("dataISO", "<", corteISO)
      .limit(Math.min(pagina, maximo - apagados))
      .get();
    if (consulta.empty || consulta.docs.length === 0) break;
    const lote = db.batch();
    consulta.docs.forEach((doc) => lote.delete(doc.ref));
    await lote.commit();
    apagados += consulta.docs.length;
    if (consulta.docs.length < pagina) break;
  }
  return apagados;
}

module.exports = {
  limparEnviosAntigos,
  COLECAO_CONTROLE,
  LIMITE_DIARIO,
  FALHAS_PARA_DISJUNTOR,
  varianteDaChave,
  COLECAO_ENVIOS,
  COLECAO_AVALIACAO_DESTINATARIOS,
  CONVITE_WHATSAPP_ALCANCOU,
  LINK_DOCUMENTOS,
  LINK_CANCELAR,
  RODAPE,
  PAUSA_MIN_MS,
  PAUSA_MAX_MS,
  ORCAMENTO_RODADA_MS,
  dataISOValida,
  agoraEmSaoPaulo,
  somarDias,
  dataPorExtenso,
  horaFalada,
  primeiroNome,
  telefoneWhatsApp,
  listaTelefonesTeste,
  montarMensagem,
  eventoDoAgendamento,
  aindaValido,
  chaveEnvio,
  inicioDoLembrete,
  validarConfiguracao,
  criarServicoWhatsappCin
};
