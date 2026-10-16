"use strict";

// Regras do Firestore contra o emulador (auditoria de 16/10/2026, QA-01).
//
// Os testes em functions/ conferem o TEXTO de firestore.rules. Aqui as regras
// sao avaliadas de verdade pelo emulador, com tokens de admin ativo, inativo,
// nao verificado e anonimo. Rode da raiz do projeto:
//   npm --prefix tests/emulador test
// (precisa de Java no PATH; o emulador usa um projeto demo-, sem tocar na nuvem)

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp, setLogLevel
} = require("firebase/firestore");

// As recusas esperadas viram erro no log do SDK; aqui so poluiriam a saida.
setLogLevel("silent");

const PROJETO = "demo-agendamento-cin";
const ADMIN = "recepcao@camara.gov.br";
const INATIVO = "antigo@camara.gov.br";

let ambiente;

test.before(async () => {
  ambiente = await initializeTestEnvironment({
    projectId: PROJETO,
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8") }
  });
});

test.after(async () => {
  if (ambiente) await ambiente.cleanup();
});

test.beforeEach(async () => {
  await ambiente.clearFirestore();
  await ambiente.withSecurityRulesDisabled(async (contexto) => {
    const db = contexto.firestore();
    await setDoc(doc(db, "admins", ADMIN), { ativo: true });
    await setDoc(doc(db, "admins", INATIVO), { ativo: false });
    await setDoc(doc(db, "dados_cidadaos", "A"), { nome: "Maria", cpf: "529.982.247-25", status: "agendado" });
    await setDoc(doc(db, "vagas_ocupadas", "2026-10-20_14:30"), { agendamentoId: "A" });
    await setDoc(doc(db, "cpfs_agendados", "cpf_x"), { agendamentoId: "A" });
    await setDoc(doc(db, "bloqueios_agendamento", "52998224725"), { cpf: "52998224725", bloqueadoAte: "2027-01-01" });
    await setDoc(doc(db, "configuracoes", "agenda"), { dias: [] });
    await setDoc(doc(db, "metricas_abertura", "2026-10-19", "fragmentos", "0"), { tentativas: 3 });
    await setDoc(doc(db, "logs_admin", "L1"), { acao: "x", adminEmail: ADMIN });
  });
});

const admin = () => ambiente.authenticatedContext("uid-admin", { email: ADMIN, email_verified: true }).firestore();
const adminSemVerificar = () => ambiente.authenticatedContext("uid-admin", { email: ADMIN, email_verified: false }).firestore();
const inativo = () => ambiente.authenticatedContext("uid-inativo", { email: INATIVO, email_verified: true }).firestore();
const estranho = () => ambiente.authenticatedContext("uid-estranho", { email: "qualquer@gmail.com", email_verified: true }).firestore();
const anonimo = () => ambiente.unauthenticatedContext().firestore();

// ---- Leitura ------------------------------------------------------------------

test("admin ativo e verificado le agendamentos, vagas, indices, bloqueios, logs e metricas", async () => {
  const db = admin();
  for (const caminho of [
    ["dados_cidadaos", "A"], ["vagas_ocupadas", "2026-10-20_14:30"], ["cpfs_agendados", "cpf_x"],
    ["bloqueios_agendamento", "52998224725"], ["configuracoes", "agenda"], ["logs_admin", "L1"],
    ["metricas_abertura", "2026-10-19", "fragmentos", "0"]
  ]) {
    await assertSucceeds(getDoc(doc(db, ...caminho)));
  }
  await assertSucceeds(getDocs(collection(db, "dados_cidadaos")));
});

test("e-mail nao verificado, admin inativo, estranho e anonimo nao leem dados pessoais", async () => {
  for (const [nome, db] of [["nao verificado", adminSemVerificar()], ["inativo", inativo()], ["estranho", estranho()], ["anonimo", anonimo()]]) {
    await assertFails(getDoc(doc(db, "dados_cidadaos", "A")), nome);
    await assertFails(getDocs(collection(db, "dados_cidadaos")), nome);
    await assertFails(getDoc(doc(db, "logs_admin", "L1")), nome);
  }
});

// ---- SEG-02: escrita so pelo servidor -------------------------------------------

test("nem o admin grava agendamento, vaga, indice de CPF ou bloqueio pelo navegador", async () => {
  const db = admin();
  await assertFails(updateDoc(doc(db, "dados_cidadaos", "A"), { status: "compareceu" }));
  await assertFails(setDoc(doc(db, "dados_cidadaos", "NOVO"), { nome: "X" }));
  await assertFails(deleteDoc(doc(db, "dados_cidadaos", "A")));
  await assertFails(setDoc(doc(db, "vagas_ocupadas", "2026-10-20_15:00"), { agendamentoId: "A" }));
  await assertFails(deleteDoc(doc(db, "vagas_ocupadas", "2026-10-20_14:30")));
  await assertFails(setDoc(doc(db, "cpfs_agendados", "cpf_y"), { agendamentoId: "A" }));
  await assertFails(deleteDoc(doc(db, "bloqueios_agendamento", "52998224725")));
});

test("admin segue configurando a agenda e as credenciais", async () => {
  const db = admin();
  await assertSucceeds(setDoc(doc(db, "configuracoes", "agenda"), { dias: ["2026-10-20"] }, { merge: true }));
  await assertSucceeds(addDoc(collection(db, "credenciais_estacionamento"), { nome: "Teste" }));
  await assertFails(setDoc(doc(estranho(), "configuracoes", "agenda"), { dias: [] }));
});

// ---- SEG-01: admins ------------------------------------------------------------

test("cada conta le so o proprio documento de admins, e ninguem grava", async () => {
  await assertSucceeds(getDoc(doc(admin(), "admins", ADMIN)));
  await assertSucceeds(getDoc(doc(estranho(), "admins", "qualquer@gmail.com")), "ler o proprio, mesmo inexistente");
  await assertFails(getDoc(doc(admin(), "admins", INATIVO)));
  await assertFails(getDocs(collection(admin(), "admins")));
  await assertFails(getDoc(doc(adminSemVerificar(), "admins", ADMIN)));
  await assertFails(setDoc(doc(admin(), "admins", "novo@gmail.com"), { ativo: true }), "admin nao cria admin");
  await assertFails(updateDoc(doc(inativo(), "admins", INATIVO), { ativo: true }), "inativo nao se reativa");
  await assertFails(setDoc(doc(estranho(), "admins", "qualquer@gmail.com"), { ativo: true }), "estranho nao se cadastra");
});

test("e-mail com maiusculas no token le o documento em minusculas", async () => {
  const db = ambiente.authenticatedContext("uid-admin", { email: "Recepcao@Camara.gov.br", email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(db, "admins", ADMIN)));
});

// ---- Logs ----------------------------------------------------------------------

test("log do navegador so com o proprio e-mail e a hora do servidor; nunca editavel", async () => {
  const db = admin();
  await assertSucceeds(addDoc(collection(db, "logs_admin"), { acao: "emitir_comprovante", adminEmail: ADMIN, criadoEm: serverTimestamp() }));
  await assertFails(addDoc(collection(db, "logs_admin"), { acao: "x", adminEmail: "outro@camara.gov.br", criadoEm: serverTimestamp() }), "e-mail de outro");
  await assertFails(addDoc(collection(db, "logs_admin"), { acao: "x", adminEmail: ADMIN, criadoEm: new Date("2020-01-01") }), "hora do cliente");
  await assertFails(addDoc(collection(db, "logs_admin"), { acao: "x", adminEmail: ADMIN }), "sem hora");
  await assertFails(updateDoc(doc(db, "logs_admin", "L1"), { acao: "apagado" }));
  await assertFails(deleteDoc(doc(db, "logs_admin", "L1")));
});

// ---- Colecoes so do servidor ----------------------------------------------------

test("colecoes internas ficam fechadas ate para o admin", async () => {
  const db = admin();
  for (const colecao of ["rate_limits", "limites_origem", "telefones_agendados", "operacoes_agendamento", "cancelamentos_pendentes", "pedidos_avaliacao_google", "colecao_inexistente"]) {
    await assertFails(getDoc(doc(db, colecao, "x")), colecao);
    await assertFails(setDoc(doc(db, colecao, "x"), { a: 1 }), colecao);
  }
  await assertFails(setDoc(doc(db, "metricas_abertura", "2026-10-19", "fragmentos", "0"), { tentativas: 999 }), "metricas so leitura");
});
