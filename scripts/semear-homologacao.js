// Carga inicial de um projeto Firebase de HOMOLOGACAO para o ensaio de carga.
//
// Este script RECUSA rodar contra producao. A verificacao e fixa e nao pode ser
// desativada por variavel de ambiente -- e o mesmo criterio dos cenarios k6.
//
// COMO USAR (PowerShell, na pasta do projeto):
//   gcloud auth application-default login
//   $env:PROJETO_HOMOLOG = "cin-itanhandu-homolog"
//   $env:ADMIN_EMAIL     = "gui.rib.pi@gmail.com"
//   node scripts/semear-homologacao.js              <- simula, nao grava
//   node scripts/semear-homologacao.js --aplicar    <- grava

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const PROJETO = String(process.env.PROJETO_HOMOLOG || "").trim();
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim();
const APLICAR = process.argv.includes("--aplicar");

// Denylist fixa, igual a dos cenarios k6. Nenhuma variavel a destrava.
if (!PROJETO) {
  console.error("\nDefina PROJETO_HOMOLOG com o ID do projeto de homologacao.\n");
  process.exit(1);
}
if (PROJETO.toLowerCase().includes("agendamento-cin-itanhandu")) {
  console.error(`\nBLOQUEADO: "${PROJETO}" e o projeto de producao.`);
  console.error("Este script so roda em homologacao.\n");
  process.exit(1);
}
if (!ADMIN_EMAIL.includes("@")) {
  console.error("\nDefina ADMIN_EMAIL com o e-mail que vai administrar a homologacao.\n");
  process.exit(1);
}

// Grade nova (a partir do corte de 2026-08-18), igual a functions/agenda-grade.js.
const HORARIOS_NOVOS = ["14:30", "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30", "16:45"];

// Espelha a semana real de 17/08 para o ensaio de leitura: terca a sexta,
// ja publicadas, para que /api/agenda-publica devolva conteudo.
const DIAS_ABERTOS = ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];

// Data exclusiva do teste de disputa. Fica longe da semana real para que os 50
// CPFs sinteticos nao poluam a medicao de leitura.
const DATA_DISPUTA = "2026-09-15";
const HORA_DISPUTA = "14:30";

(async () => {
  initializeApp({ credential: applicationDefault(), projectId: PROJETO });
  const db = getFirestore();

  const agenda = {
    dias: [...DIAS_ABERTOS, DATA_DISPUTA].sort(),
    horarios: [...HORARIOS_NOVOS],
    // Ausente de proposito: sem configuracao por dia da semana, a grade e
    // resolvida pelo corte por data -- exatamente o que queremos exercitar.
    publicacaoDatas: {},
    dataNovasVagas: "24/08/2026",
    responsavelPosto: "Ensaio de carga",
    atualizado: new Date().toISOString()
  };

  console.log(`\nProjeto: ${PROJETO}`);
  console.log(`Admin:   ${ADMIN_EMAIL}`);
  console.log("\n=== configuracoes/agenda ===");
  console.log(`  dias: ${agenda.dias.join(", ")}`);
  console.log(`  horarios: ${HORARIOS_NOVOS.length} por dia (grade nova)`);
  console.log(`  publicacaoDatas: {} (tudo ja publicado)`);
  console.log("\n=== vaga do teste de disputa ===");
  console.log(`  TEST_DATE=${DATA_DISPUTA}  TEST_TIME=${HORA_DISPUTA}`);
  console.log(`\n=== admins/${ADMIN_EMAIL} ===`);
  console.log("  ativo: true");

  const capacidade = DIAS_ABERTOS.length * HORARIOS_NOVOS.length;
  console.log(`\nCapacidade da semana simulada: ${DIAS_ABERTOS.length} dias x ${HORARIOS_NOVOS.length} = ${capacidade} vagas.`);

  if (!APLICAR) {
    console.log("\n>>> MODO SIMULACAO. Nada foi gravado.");
    console.log(">>> Para aplicar, rode o mesmo comando com  --aplicar\n");
    return;
  }

  await db.collection("configuracoes").doc("agenda").set(agenda);
  await db.collection("admins").doc(ADMIN_EMAIL).set({
    ativo: true,
    criadoEm: FieldValue.serverTimestamp(),
    origem: "semear-homologacao"
  });

  // Limpa uma eventual reserva remanescente de um ensaio anterior, para que a
  // disputa comece com a vaga livre e o resultado seja comparavel.
  const slotId = `${DATA_DISPUTA}_${HORA_DISPUTA}`;
  await db.collection("vagas_ocupadas").doc(slotId).delete().catch(() => {});

  const conferencia = await db.collection("configuracoes").doc("agenda").get();
  console.log("\n=== APLICADO ===");
  console.log(`  dias gravados: ${(conferencia.data().dias || []).length}`);
  console.log(`  vaga ${slotId} liberada para o ensaio de disputa`);
  console.log("\nProximo passo: firebase deploy --project homolog\n");
})().catch((e) => {
  console.error("\nFalha:", e.message);
  console.error("Se for erro de credencial, rode antes: gcloud auth application-default login\n");
  process.exit(1);
});
