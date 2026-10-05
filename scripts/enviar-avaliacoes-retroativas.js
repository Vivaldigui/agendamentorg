// Envia o convite de avaliacao Google para atendimentos de datas passadas,
// usando o mesmo servico da funcao diaria (mesma elegibilidade, reserva
// transacional e deduplicacao por destinatario).
//
// Uso:
//   node scripts/enviar-avaliacoes-retroativas.js 2026-09-28 2026-10-02            (simulacao)
//   node scripts/enviar-avaliacoes-retroativas.js 2026-09-28 2026-10-02 --enviar   (envio real)
//
// Credenciais: a sessao atual do gcloud (gcloud auth print-access-token). Os
// segredos sao lidos do Secret Manager e nunca impressos. A saida mostra somente
// contagens. Rode com NODE_PATH=functions/node_modules.

const { execFileSync } = require("node:child_process");
const { Firestore, Timestamp } = require("@google-cloud/firestore");
const { OAuth2Client } = require("google-auth-library");
const {
  COLECAO,
  COLECAO_DESTINATARIOS,
  dataISOValida,
  emailValido,
  identificadorDestinatario,
  criarServicoAvaliacao
} = require("../functions/avaliacao-google");

const PROJETO = "agendamento-cin-itanhandu";
const GOOGLE_URL = "https://g.page/r/CfugOJBgujYPEBM/review";
const TERMINAIS = new Set(["enviando", "enviado", "revisar"]);

const args = process.argv.slice(2);
const enviar = args.includes("--enviar");
const [inicio, fim] = args.filter((a) => !a.startsWith("--"));

if (!dataISOValida(inicio) || !dataISOValida(fim) || inicio > fim) {
  console.error("Informe data inicial e final no formato AAAA-MM-DD.");
  process.exit(1);
}

function gcloud(...argumentos) {
  const comando = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
  return execFileSync(comando, argumentos, {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32"
  }).trim();
}

function lerSegredo(nome) {
  return gcloud("secrets", "versions", "access", "latest", `--secret=${nome}`, `--project=${PROJETO}`);
}

function datasEntre(a, b) {
  const datas = [];
  for (let d = new Date(`${a}T12:00:00Z`); d.toISOString().slice(0, 10) <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    datas.push(d.toISOString().slice(0, 10));
  }
  return datas;
}

async function main() {
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: gcloud("auth", "print-access-token") });
  const db = new Firestore({ projectId: PROJETO, authClient });

  const config = {
    webhookUrl: lerSegredo("AVALIACAO_N8N_WEBHOOK_URL"),
    token: lerSegredo("AVALIACAO_N8N_TOKEN"),
    dedupeKey: lerSegredo("AVALIACAO_DESTINATARIO_CHAVE"),
    googleUrl: GOOGLE_URL
  };

  const vistosNoLote = new Set();
  const totais = { cadastros: 0, compareceu: 0, elegiveis: 0 };

  console.log(enviar ? "MODO ENVIO REAL" : "MODO SIMULACAO (nada sera enviado)");
  for (const data of datasEntre(inicio, fim)) {
    const snap = await db.collection("dados_cidadaos").where("dataISO", "==", data).get();
    const c = { cadastros: snap.size, compareceu: 0, semEmail: 0, jaConvidado: 0, repetidoNoLote: 0, elegiveis: 0 };
    for (const doc of snap.docs) {
      const dados = doc.data();
      if (dados.status !== "compareceu" || dados.anonimizadoLGPD) continue;
      c.compareceu++;
      if (!emailValido(dados.email)) { c.semEmail++; continue; }
      const pedido = await db.collection(COLECAO).doc(doc.id).get();
      if (pedido.exists && TERMINAIS.has(pedido.data().estado)) { c.jaConvidado++; continue; }
      const id = identificadorDestinatario(dados.email, config.dedupeKey);
      const dest = await db.collection(COLECAO_DESTINATARIOS).doc(id).get();
      if (dest.exists && TERMINAIS.has(dest.data().estado)) { c.jaConvidado++; continue; }
      if (vistosNoLote.has(id)) { c.repetidoNoLote++; continue; }
      vistosNoLote.add(id);
      c.elegiveis++;
    }
    totais.cadastros += c.cadastros;
    totais.compareceu += c.compareceu;
    totais.elegiveis += c.elegiveis;
    console.log(`${data}: ${c.cadastros} cadastros | ${c.compareceu} compareceram | ` +
      `${c.semEmail} sem e-mail valido | ${c.jaConvidado} ja convidados | ` +
      `${c.repetidoNoLote} e-mail repetido no lote | ${c.elegiveis} a enviar`);
  }
  console.log(`TOTAL: ${totais.elegiveis} convites a enviar (${totais.compareceu} compareceram, ${totais.cadastros} cadastros)`);

  if (!enviar) return;

  const servico = criarServicoAvaliacao({ db, Timestamp });
  for (const data of datasEntre(inicio, fim)) {
    await servico.processarData(data, config);
  }

  const resultado = {};
  for (const data of datasEntre(inicio, fim)) {
    const snap = await db.collection(COLECAO).where("dataAtendimento", "==", data).get();
    for (const doc of snap.docs) {
      const estado = doc.data().estado;
      resultado[estado] = (resultado[estado] || 0) + 1;
    }
  }
  console.log("Estado da fila no periodo:", JSON.stringify(resultado));
}

main().catch((erro) => {
  console.error("Falha:", erro.message);
  process.exit(1);
});
