"use strict";

// Consulta e cancelamento do agendamento pelo WhatsApp da CIN (Cidinho).
// Pedido do responsavel em 22/11/2026: "cancelar e consultar pelo chat, para
// aqueles que nao conseguem. O bot consulta/cancela pelo protocolo."
//
// Quem chama: o fluxo de entrada do n8n da Camara (CinWhatsEntrada1), com o
// token no cabecalho X-Cin-Robo. Aqui fica so o SHA-256 dele
// (WHATSAPP_CIN_ROBO_TOKEN_SHA256 no .env do projeto); sem ele, tudo e recusado.
//
// Dois fatores, como no site (onde o protocolo e o fator que manda):
//   - o protocolo CIN-XXXXXXXX, que esta no comprovante e na confirmacao do WhatsApp;
//   - o celular que escreve no WhatsApp, que tem de ser o do cadastro.
// Celular diferente recebe a mesma resposta de "nao encontrado": nao confirma
// que o protocolo existe. A resposta nunca leva CPF, nascimento nem nome inteiro.
//
// O cancelamento repete a transacao do site (cancelarAgendamentoCidadao): so
// horario futuro, e so apaga a vaga e os indices de CPF que ainda apontam para
// este agendamento (contencao B5). canceladoPor "whatsapp": o gatilho dos
// avisos nao manda a mensagem de cancelamento, que o Cidinho ja deu na conversa.

const crypto = require("node:crypto");
const { telefoneWhatsApp, dataPorExtenso, horaFalada, primeiroNome } = require("./whatsapp-cin");

const ACOES = new Set(["consultar", "cancelar", "status"]);

// "CIN-AB12CD34", "cin ab12cd34", "CIN AB12CD34" -> "CIN-AB12CD34"; o resto, vazio.
function normalizarProtocoloRobo(valor) {
  const m = /^\s*CIN[\s-]*([A-Za-z0-9]{8})\s*$/i.exec(String(valor || ""));
  return m ? `CIN-${m[1].toUpperCase()}` : "";
}

function sha256Hex(texto) {
  return crypto.createHash("sha256").update(String(texto), "utf8").digest("hex");
}

// Compara em tempo constante o SHA-256 do token recebido com o esperado.
function tokenConfere(recebido, hashEsperado) {
  const esperado = String(hashEsperado || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(esperado) || typeof recebido !== "string" || recebido.length < 32) return false;
  const a = Buffer.from(sha256Hex(recebido), "hex");
  const b = Buffer.from(esperado, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function quandoFalado(dataISO, hora) {
  const dia = dataPorExtenso(dataISO).replace("-feira", "");
  const h = horaFalada(hora);
  return dia && h ? `${dia}, às ${h}` : dia;
}

// agendado: vale e o horario ainda nao chegou (pode cancelar)
// passou: vale, mas o horario ja passou; atendido; faltou; cancelado
function situacaoDoAgendamento(dados, ativo, futuro) {
  const status = String(dados && dados.status || "agendado");
  if (status === "compareceu") return "atendido";
  if (status === "nao_compareceu") return "faltou";
  if (!ativo) return "cancelado";
  return futuro ? "agendado" : "passou";
}

function criarServicoRoboAgendamento({
  db,
  hashTokenEsperado,
  cpfDocId,
  agendamentoEstaAtivo,
  horarioFuturo,
  hojeISO = () => new Date().toISOString().slice(0, 10),
  agora = () => new Date(),
  registrar = () => {}
}) {
  function resumo(dados) {
    const ativo = agendamentoEstaAtivo(dados);
    const futuro = horarioFuturo(dados.dataISO, dados.hora);
    const situacao = situacaoDoAgendamento(dados, ativo, futuro);
    return {
      situacao,
      dataISO: dados.dataISO || "",
      hora: dados.hora || "",
      quando: quandoFalado(dados.dataISO, dados.hora),
      primeiroNome: primeiroNome(dados.nome),
      podeCancelar: situacao === "agendado"
    };
  }

  // Protocolo + celular do cadastro. Mais de um documento com o mesmo protocolo
  // (colisao, quase impossivel): fica o que ainda vale, depois o mais recente.
  async function localizar(protocolo, telefone) {
    if (!protocolo || !telefone) return null;
    const snap = await db.collection("dados_cidadaos").where("protocolo", "==", protocolo).limit(5).get();
    const docs = snap.docs
      .filter((doc) => telefoneWhatsApp((doc.data() || {}).telefone) === telefone)
      .sort((x, y) => (Number(agendamentoEstaAtivo(y.data())) - Number(agendamentoEstaAtivo(x.data())))
        || String(y.data().dataISO || "").localeCompare(String(x.data().dataISO || "")));
    return docs.length ? { ref: docs[0].ref, id: docs[0].id, dados: docs[0].data() } : null;
  }

  async function consultar({ protocolo, telefone }) {
    const achado = await localizar(protocolo, telefone);
    if (!achado) return { ok: false, motivo: "nao_encontrado" };
    return { ok: true, ...resumo(achado.dados) };
  }

  async function cancelar({ protocolo, telefone }) {
    const achado = await localizar(protocolo, telefone);
    if (!achado) return { ok: false, motivo: "nao_encontrado" };
    let resultado = { ok: false, motivo: "erro" };
    await db.runTransaction(async (t) => {
      const agDoc = await t.get(achado.ref);
      const dados = agDoc.exists ? agDoc.data() : null;
      // Relido dentro da transacao: protocolo e celular ainda conferem?
      if (!dados || normalizarProtocoloRobo(dados.protocolo) !== protocolo || telefoneWhatsApp(dados.telefone) !== telefone) {
        resultado = { ok: false, motivo: "nao_encontrado" };
        return;
      }
      const atual = resumo(dados);
      if (!atual.podeCancelar) {
        resultado = { ok: false, motivo: "nao_pode_cancelar", ...atual };
        return;
      }
      const slotId = dados.slotId || `${dados.dataISO}_${dados.hora}`;
      const slotRef = slotId && slotId !== "undefined_undefined" ? db.collection("vagas_ocupadas").doc(slotId) : null;
      const cpfNum = String(dados.cpf || "").replace(/\D/g, "");
      const cpfDocIds = cpfNum.length === 11 ? [...new Set([cpfDocId(cpfNum), cpfNum])] : [];
      // Toda leitura antes de qualquer escrita na transacao.
      const [slotDoc, cpfDocs] = await Promise.all([
        slotRef ? t.get(slotRef) : Promise.resolve(null),
        Promise.all(cpfDocIds.map((id) => t.get(db.collection("cpfs_agendados").doc(id))))
      ]);
      if (slotRef && slotDoc && slotDoc.exists && (slotDoc.data() || {}).agendamentoId === achado.id) {
        t.delete(slotRef);
      }
      const agoraISO = agora().toISOString();
      t.set(achado.ref, {
        status: "cancelado_cidadao",
        canceladoEm: agoraISO,
        canceladoPor: "whatsapp",
        statusAtualizadoEm: agoraISO,
        ativo: false
      }, { merge: true });
      cpfDocs.forEach((doc, i) => {
        if (doc.exists && (doc.data() || {}).agendamentoId === achado.id) {
          t.delete(db.collection("cpfs_agendados").doc(cpfDocIds[i]));
        }
      });
      resultado = { ok: true, cancelado: true, ...atual, situacao: "cancelado", podeCancelar: false };
    });
    return resultado;
  }

  // Para o resumo diario do n8n: disjuntor dos avisos e quantos sairam hoje.
  async function status() {
    const controle = db.collection("whatsapp_controle");
    const [disjuntor, dia] = await Promise.all([
      controle.doc("disjuntor").get(),
      controle.doc(`dia_${hojeISO()}`).get()
    ]);
    const d = dia.exists ? dia.data() || {} : {};
    return {
      ok: true,
      disjuntor: disjuntor.exists && (disjuntor.data() || {}).ativo === true,
      enviadosHoje: Number(d.enviados) || 0
    };
  }

  async function atender(req, res) {
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, motivo: "metodo" });
      return;
    }
    if (!tokenConfere(req.get("x-cin-robo"), hashTokenEsperado)) {
      res.status(401).json({ ok: false, motivo: "nao_autorizado" });
      return;
    }
    const corpo = req.body && typeof req.body === "object" ? req.body : {};
    const acao = String(corpo.acao || "");
    if (!ACOES.has(acao)) {
      res.status(400).json({ ok: false, motivo: "acao" });
      return;
    }
    try {
      if (acao === "status") {
        res.status(200).json(await status());
        return;
      }
      const protocolo = normalizarProtocoloRobo(corpo.protocolo);
      const telefone = telefoneWhatsApp(corpo.telefone);
      const r = acao === "cancelar"
        ? await cancelar({ protocolo, telefone })
        : await consultar({ protocolo, telefone });
      registrar({ acao, ok: r.ok, motivo: r.motivo || "", situacao: r.situacao || "" });
      res.status(200).json(r);
    } catch (err) {
      registrar({ acao, ok: false, motivo: "erro", erro: String(err && err.message || err).slice(0, 200) });
      res.status(500).json({ ok: false, motivo: "erro" });
    }
  }

  return { consultar, cancelar, status, atender, localizar, resumo };
}

module.exports = {
  normalizarProtocoloRobo,
  tokenConfere,
  sha256Hex,
  quandoFalado,
  situacaoDoAgendamento,
  criarServicoRoboAgendamento
};
