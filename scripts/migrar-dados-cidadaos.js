const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
const commit = process.argv.includes("--commit");
const agora = () => new Date().toISOString();

function cpfDocId(cpf) {
  const cpfNum = String(cpf || "").replace(/\D/g, "");
  if (cpfNum.length !== 11) return null;
  return "cpf_" + crypto.createHash("sha256").update(cpfNum).digest("hex");
}

function isLegacySlotDocId(id) {
  return /^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/.test(id);
}

async function migrarDocumento(doc) {
  const dados = doc.data();
  const antigoId = doc.id;
  const novoRef = db.collection("dados_cidadaos").doc();
  const slotId = dados.slotId || antigoId;
  const cpfHashId = cpfDocId(dados.cpf);
  const [dataISOFromId, horaFromId] = antigoId.split("_");

  if (!commit) {
    console.log(`[teste] ${antigoId} -> ${novoRef.id}${cpfHashId ? ` | ${cpfHashId}` : ""}`);
    return;
  }

  await db.runTransaction(async (t) => {
    const atual = await t.get(doc.ref);
    if (!atual.exists) return;

    const dadosAtuais = atual.data();

    t.set(novoRef, {
      ...dadosAtuais,
      slotId,
      migradoDe: antigoId,
      migradoEm: agora()
    });

    if (cpfHashId) {
      t.set(db.collection("cpfs_agendados").doc(cpfHashId), {
        agendamentoId: novoRef.id,
        slotId,
        criado: dadosAtuais.criado || agora(),
        migradoEm: agora()
      });

      t.delete(db.collection("cpfs_agendados").doc(String(dadosAtuais.cpf || "").replace(/\D/g, "")));
    }

    t.set(db.collection("vagas_ocupadas").doc(slotId), {
      dataISO: dadosAtuais.dataISO || dataISOFromId,
      hora: dadosAtuais.hora || horaFromId
    }, { merge: true });

    t.delete(doc.ref);
  });

  console.log(`Migrado ${antigoId} -> ${novoRef.id}`);
}

async function main() {
  const snap = await db.collection("dados_cidadaos").get();
  let migrados = 0;
  let ignorados = 0;

  for (const doc of snap.docs) {
    if (!isLegacySlotDocId(doc.id)) {
      ignorados++;
      continue;
    }

    await migrarDocumento(doc);
    migrados++;
  }

  console.log(`${commit ? "Concluido" : "Teste concluido"}. Documentos legados encontrados: ${migrados}. Ignorados: ${ignorados}.`);
  if (!commit) console.log("Rode novamente com --commit para aplicar a migracao.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
