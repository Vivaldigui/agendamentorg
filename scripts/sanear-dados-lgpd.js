// Saneamento pontual de dados pessoais (auditoria de 16/10/2026, LGPD-03)
//
// O que as rotinas passam a fazer sozinhas depois do deploy:
//   - anonimizacao mensal: inclui "agendado" e "remarcado" e apaga a
//     observacao interna dos registros que ela anonimizar daqui em diante;
//   - manutencao diaria: apaga bloqueios vencidos ou liberados e tira nome e
//     telefone dos que ainda valem.
//
// O que nenhuma rotina alcanca, e este script trata:
//   1. logs_admin "whatsapp_bloqueio" e "liberar_bloqueio" gravados pelo
//      painel com o CPF em detalhes.cpf. Os logs nunca sao anonimizados.
//   2. registros ja anonimizados antes desta versao que ainda guardam a
//      observacao interna (texto livre da recepcao).
//
// SEGURANCA:
//   - roda em modo SIMULACAO por padrao; so grava com --aplicar
//   - so remove os campos listados acima; nao apaga documentos
//   - mostra apenas contagens e ids, nunca o conteudo removido
//   - registra a operacao em logs_admin
//
// ATENCAO: a remocao e irreversivel. Antes de --aplicar, faca um export do
// Firestore (gcloud firestore export gs://BUCKET) e tenha a aprovacao da Camara.
//
// COMO USAR (PowerShell, na pasta do projeto):
//   gcloud auth application-default login
//   node .\scripts\sanear-dados-lgpd.js                       <- simulacao
//   node .\scripts\sanear-dados-lgpd.js --aplicar             <- grava
//   node .\scripts\sanear-dados-lgpd.js --projeto=cin-itanhandu-homolog

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const APLICAR = process.argv.includes("--aplicar");
const argProjeto = process.argv.find((arg) => arg.startsWith("--projeto="));
const PROJETO = argProjeto ? argProjeto.slice("--projeto=".length) : "agendamento-cin-itanhandu";
const ACOES_LOG_COM_CPF = ["whatsapp_bloqueio", "liberar_bloqueio"];
const TAMANHO_LOTE = 400;

async function gravarEmLotes(db, atualizacoes) {
  for (let i = 0; i < atualizacoes.length; i += TAMANHO_LOTE) {
    const batch = db.batch();
    atualizacoes.slice(i, i + TAMANHO_LOTE).forEach(({ ref, campos }) => batch.update(ref, campos));
    await batch.commit();
  }
}

(async () => {
  initializeApp({ credential: applicationDefault(), projectId: PROJETO });
  const db = getFirestore();
  const agora = new Date().toISOString();

  console.log(`\nProjeto: ${PROJETO}`);
  console.log(APLICAR ? "Modo: APLICAR (grava)\n" : "Modo: SIMULACAO (nao grava nada)\n");

  // 1. CPF nos logs do painel.
  const logs = await db.collection("logs_admin").where("acao", "in", ACOES_LOG_COM_CPF).get();
  const logsComCpf = logs.docs.filter((doc) => {
    const detalhes = doc.data().detalhes;
    return detalhes && typeof detalhes === "object" && detalhes.cpf !== undefined;
  });
  console.log(`logs_admin (${ACOES_LOG_COM_CPF.join(", ")}): ${logs.size} lidos, ${logsComCpf.length} com CPF`);

  // 2. Observacao interna em registros ja anonimizados.
  const anonimizados = await db.collection("dados_cidadaos").where("anonimizadoLGPD", "==", true).get();
  const comObservacao = anonimizados.docs.filter((doc) => doc.data().observacaoInterna !== undefined);
  console.log(`dados_cidadaos anonimizados: ${anonimizados.size} lidos, ${comObservacao.length} com observacao interna`);

  if (!APLICAR) {
    console.log("\nSimulacao concluida. Para gravar, repita com --aplicar.\n");
    return;
  }

  await gravarEmLotes(db, [
    ...logsComCpf.map((doc) => ({
      ref: doc.ref,
      campos: { "detalhes.cpf": FieldValue.delete(), saneadoLGPDEm: agora }
    })),
    ...comObservacao.map((doc) => ({
      ref: doc.ref,
      campos: { observacaoInterna: FieldValue.delete(), saneadoLGPDEm: agora }
    }))
  ]);

  await db.collection("logs_admin").add({
    acao: "saneamento_lgpd_pontual",
    detalhes: {
      logsSemCpf: logsComCpf.length,
      observacoesRemovidas: comObservacao.length
    },
    adminEmail: "script:sanear-dados-lgpd",
    criadoEm: FieldValue.serverTimestamp(),
    criado: agora
  });

  console.log(`\nGravado: ${logsComCpf.length} logs sem CPF, ${comObservacao.length} observacoes removidas.\n`);
})().catch((err) => {
  console.error("\nFalha no saneamento:", err.message);
  process.exitCode = 1;
});
