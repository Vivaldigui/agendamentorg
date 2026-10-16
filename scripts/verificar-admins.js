// Diagnostico das contas administrativas antes de exigir e-mail verificado
// (auditoria de 16/10/2026, SEG-03).
//
// A partir desta versao, as regras do Firestore e as callables so aceitam
// admin com e-mail VERIFICADO. Conta de e-mail e senha nasce com o e-mail nao
// verificado; se algum admin ativo estiver assim, ele fica fora do painel no
// minuto do deploy. Rode isto ANTES do deploy das regras.
//
// O que mostra, para cada documento de admins:
//   - se ha conta no Firebase Auth com aquele e-mail;
//   - se o e-mail esta verificado, se a conta esta desativada e os provedores;
//   - e-mails listados em admins SEM conta: sao exatamente os que alguem
//     poderia registrar por conta propria. Remova-os de admins ou crie a conta.
//
// Quem estiver com e-mail nao verificado pode confirmar pelo proprio painel
// (botao "Enviar link de confirmacao"), sem depender deste script. Se a pessoa
// nao tiver acesso a caixa de entrada e a Camara confirmar que a conta e dela,
// marque manualmente, um e-mail por vez:
//   node .\scripts\verificar-admins.js --marcar-verificado=pessoa@itanhandu.cam.mg.gov.br
//
// COMO USAR (PowerShell, na pasta do projeto):
//   gcloud auth application-default login
//   node .\scripts\verificar-admins.js                       <- so leitura
//   node .\scripts\verificar-admins.js --projeto=cin-itanhandu-homolog

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const argProjeto = process.argv.find((arg) => arg.startsWith("--projeto="));
const PROJETO = argProjeto ? argProjeto.slice("--projeto=".length) : "agendamento-cin-itanhandu";
const argMarcar = process.argv.find((arg) => arg.startsWith("--marcar-verificado="));
const MARCAR = argMarcar ? argMarcar.slice("--marcar-verificado=".length).trim().toLowerCase() : "";

async function contaPorEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") return null;
    throw err;
  }
}

(async () => {
  initializeApp({ credential: applicationDefault(), projectId: PROJETO });
  const db = getFirestore();
  const auth = getAuth();
  console.log(`\nProjeto: ${PROJETO}\n`);

  if (MARCAR) {
    const adminDoc = await db.collection("admins").doc(MARCAR).get();
    if (!adminDoc.exists || adminDoc.data().ativo !== true) {
      throw new Error(`${MARCAR} nao e admin ativo; nada foi alterado.`);
    }
    const conta = await contaPorEmail(auth, MARCAR);
    if (!conta) throw new Error(`Nao ha conta no Firebase Auth para ${MARCAR}; nada foi alterado.`);
    await auth.updateUser(conta.uid, { emailVerified: true });
    await db.collection("logs_admin").add({
      acao: "admin_email_marcado_verificado",
      detalhes: { email: MARCAR },
      adminEmail: "script:verificar-admins",
      criadoEm: FieldValue.serverTimestamp(),
      criado: new Date().toISOString()
    });
    console.log(`${MARCAR}: e-mail marcado como verificado. A pessoa precisa sair e entrar de novo no painel.\n`);
    return;
  }

  const admins = await db.collection("admins").get();
  let bloqueadosNoDeploy = 0;
  let semConta = 0;
  for (const doc of admins.docs) {
    const email = doc.id;
    const ativo = doc.data().ativo === true;
    const conta = await contaPorEmail(auth, email);
    let situacao;
    if (!conta) {
      situacao = "SEM CONTA no Auth -- remova de admins ou crie a conta";
      semConta += 1;
    } else {
      const provedores = conta.providerData.map((p) => p.providerId).join(", ") || "nenhum";
      situacao = [
        conta.emailVerified ? "e-mail verificado" : "E-MAIL NAO VERIFICADO",
        conta.disabled ? "conta desativada" : "conta ativa",
        `provedores: ${provedores}`
      ].join(" | ");
      if (ativo && !conta.disabled && !conta.emailVerified) bloqueadosNoDeploy += 1;
    }
    console.log(`${ativo ? "[ativo]  " : "[inativo]"} ${email}: ${situacao}`);
  }

  console.log(`\n${admins.size} documento(s) em admins.`);
  console.log(`${bloqueadosNoDeploy} admin(s) ativo(s) ficariam fora do painel no deploy.`);
  console.log(`${semConta} e-mail(s) em admins sem conta no Auth.\n`);
  if (bloqueadosNoDeploy || semConta) process.exitCode = 2;
})().catch((err) => {
  console.error("\nFalha:", err.message);
  process.exitCode = 1;
});
