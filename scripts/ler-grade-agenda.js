// Leitura DIAGNOSTICA do documento configuracoes/agenda.
// Este script SOMENTE LE. Nao escreve, nao apaga, nao faz deploy.
//
// Como usar (PowerShell, na pasta do projeto):
//   gcloud auth application-default login
//   node "CAMINHO_DESTE_ARQUIVO"

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const LEGADOS = ["14:20", "14:40", "15:00", "15:20", "15:40", "16:00", "16:20", "16:40"];
const NOVOS = ["14:30", "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30", "16:45"];
const NOMES = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

function classificar(lista) {
  if (!Array.isArray(lista)) return "ausente";
  const ordenada = [...lista].sort().join(",");
  if (ordenada === [...LEGADOS].sort().join(",")) return "GRADE LEGADA (8)";
  if (ordenada === [...NOVOS].sort().join(",")) return "grade nova (10)";
  if (!lista.length) return "vazia (sem atendimento)";
  return "personalizada";
}

(async () => {
  initializeApp({ credential: applicationDefault(), projectId: "agendamento-cin-itanhandu" });
  const doc = await getFirestore().collection("configuracoes").doc("agenda").get();

  if (!doc.exists) {
    console.log("Documento configuracoes/agenda NAO EXISTE.");
    return;
  }

  const dados = doc.data();
  const porDia = dados.horariosPorDiaSemana;

  console.log("\n=== horariosPorDiaSemana ===");
  if (!porDia || typeof porDia !== "object") {
    console.log("CAMPO AUSENTE -> o corte por data funciona. Nada a fazer.\n");
  } else {
    const chaves = Object.keys(porDia).sort();
    console.log(`Chaves presentes: ${chaves.join(", ") || "(nenhuma)"}\n`);
    for (const chave of chaves) {
      const lista = porDia[chave];
      const marca = ["2", "3", "4", "5"].includes(chave) ? " <-- dia aberto pela automacao" : "";
      console.log(`  ${chave} (${NOMES[Number(chave)] || "?"}): ${classificar(lista)}${marca}`);
      console.log(`      ${JSON.stringify(lista)}`);
    }
  }

  console.log("\n=== outros campos relevantes ===");
  console.log(`horarios (lista plana): ${classificar(dados.horarios)}`);
  console.log(`dias cadastrados: ${(dados.dias || []).length}`);
  console.log(`automacaoSemanal.ativa: ${dados.automacaoSemanal ? dados.automacaoSemanal.ativa : "(nao configurada)"}`);
  console.log("");
})().catch((e) => {
  console.error("\nFalha ao ler:", e.message);
  console.error("Se for erro de credencial, rode antes: gcloud auth application-default login\n");
  process.exit(1);
});
