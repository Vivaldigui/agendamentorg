// Migracao pontual de configuracoes/agenda.horariosPorDiaSemana
//
// PROBLEMA: o painel antigo gravava os 7 dias da semana preenchidos com a grade
// legada de 8 horarios. Como configuracao explicita prevalece sobre o corte por
// data, os dias 18 a 21/08/2026 abririam com a grade legada (32 vagas) em vez da
// grade nova (40 vagas).
//
// SOLUCAO: remover as chaves cujo conteudo seja EXATAMENTE a grade legada. Assim
// a regra por data volta a governar:
//   data <  2026-08-18 -> grade legada (8)
//   data >= 2026-08-18 -> grade nova  (10)
//
// Por que remover em vez de sobrescrever com a grade nova: sobrescrever faria as
// datas ANTERIORES ao corte passarem a oferecer 14:30, 14:45 etc., reintroduzindo
// exatamente a sobreposicao que o P0.1 acabou de fechar.
//
// SEGURANCA:
//   - roda em modo SIMULACAO por padrao; so grava com --aplicar
//   - so remove chave cujo conteudo for exatamente a grade legada
//   - qualquer configuracao personalizada e preservada e reportada
//   - a escrita acontece dentro de uma transacao, sem race com o painel
//   - registra a operacao em logs_admin
//
// COMO USAR (PowerShell, na pasta do projeto):
//   gcloud auth application-default login
//   node "CAMINHO_DESTE_ARQUIVO"              <- simulacao, nao grava nada
//   node "CAMINHO_DESTE_ARQUIVO" --aplicar    <- grava

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const PROJETO = "agendamento-cin-itanhandu";
const LEGADOS = ["14:20", "14:40", "15:00", "15:20", "15:40", "16:00", "16:20", "16:40"];
const NOVOS = ["14:30", "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30", "16:45"];
const NOMES = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
const DIAS_AUTOMACAO = ["2", "3", "4", "5"];

const APLICAR = process.argv.includes("--aplicar");

function chave(lista) {
  return Array.isArray(lista) ? [...lista].map(String).sort().join(",") : null;
}

const CHAVE_LEGADA = chave(LEGADOS);
const CHAVE_NOVA = chave(NOVOS);

function classificar(lista) {
  const k = chave(lista);
  if (k === null) return "ausente";
  if (k === CHAVE_LEGADA) return "GRADE LEGADA (8)";
  if (k === CHAVE_NOVA) return "grade nova (10)";
  if (!lista.length) return "vazia (sem atendimento)";
  return "PERSONALIZADA";
}

(async () => {
  initializeApp({ credential: applicationDefault(), projectId: PROJETO });
  const db = getFirestore();
  const ref = db.collection("configuracoes").doc("agenda");

  const snap = await ref.get();
  if (!snap.exists) {
    console.log("\nDocumento configuracoes/agenda NAO EXISTE. Nada a fazer.\n");
    return;
  }

  const porDia = snap.data().horariosPorDiaSemana;
  if (!porDia || typeof porDia !== "object" || Array.isArray(porDia)) {
    console.log("\nCampo horariosPorDiaSemana ausente. O corte por data ja governa. Nada a fazer.\n");
    return;
  }

  const chaves = Object.keys(porDia).sort();
  const remover = [];
  const preservar = [];

  console.log(`\n=== ESTADO ATUAL (${chaves.length} chaves) ===`);
  for (const c of chaves) {
    const tipo = classificar(porDia[c]);
    const marca = DIAS_AUTOMACAO.includes(c) ? "  <-- aberto pela automacao" : "";
    console.log(`  ${c} (${NOMES[Number(c)] || "?"}): ${tipo}${marca}`);
    console.log(`      ${JSON.stringify(porDia[c])}`);
    if (tipo === "GRADE LEGADA (8)") remover.push(c);
    else preservar.push(c);
  }

  console.log("\n=== PLANO ===");
  if (!remover.length) {
    console.log("  Nenhuma chave com a grade legada exata. Nada a migrar.");
  } else {
    console.log(`  Remover ${remover.length} chave(s): ${remover.map(c => `${c} (${NOMES[Number(c)]})`).join(", ")}`);
    console.log("  Efeito: datas antes de 18/08/2026 continuam com 8 horarios legados;");
    console.log("          datas a partir de 18/08/2026 passam a ter os 10 horarios novos.");
  }
  if (preservar.length) {
    console.log(`  Preservar intactas: ${preservar.map(c => `${c} (${NOMES[Number(c)]})`).join(", ")}`);
  }

  const semCobertura = DIAS_AUTOMACAO.filter(c => !chaves.includes(c));
  if (semCobertura.length) {
    console.log(`  Ja sem configuracao (corte por data ja vale): ${semCobertura.map(c => NOMES[Number(c)]).join(", ")}`);
  }
  const aindaLegado = DIAS_AUTOMACAO.filter(c => preservar.includes(c));
  if (aindaLegado.length) {
    console.log(`\n  ATENCAO: ${aindaLegado.map(c => NOMES[Number(c)]).join(", ")} tem configuracao PERSONALIZADA`);
    console.log("  e nao sera tocada. Reveja manualmente no painel se for intencional.");
  }

  if (!remover.length) {
    console.log("");
    return;
  }

  if (!APLICAR) {
    console.log("\n>>> MODO SIMULACAO. Nada foi gravado.");
    console.log(">>> Para aplicar, rode o mesmo comando com  --aplicar\n");
    return;
  }

  await db.runTransaction(async (t) => {
    const atual = await t.get(ref);
    const mapa = (atual.exists && atual.data().horariosPorDiaSemana) || {};
    const novo = {};
    for (const c of Object.keys(mapa)) {
      if (chave(mapa[c]) !== CHAVE_LEGADA) novo[c] = mapa[c];
    }
    // update (sem merge) substitui o campo inteiro, entao as chaves somem de fato.
    t.update(ref, {
      horariosPorDiaSemana: novo,
      atualizado: new Date().toISOString()
    });
  });

  await db.collection("logs_admin").add({
    acao: "migracao_grade_por_dia_semana",
    detalhes: { removidas: remover, preservadas: preservar, corte: "2026-08-18" },
    adminEmail: "migracao-manual",
    criadoEm: FieldValue.serverTimestamp(),
    criado: new Date().toISOString()
  });

  const conferencia = await ref.get();
  console.log("\n=== APLICADO ===");
  console.log(`  horariosPorDiaSemana agora: ${JSON.stringify(conferencia.data().horariosPorDiaSemana)}`);
  console.log("  Registrado em logs_admin como 'migracao_grade_por_dia_semana'.\n");
})().catch((e) => {
  console.error("\nFalha:", e.message);
  console.error("Se for erro de credencial, rode antes: gcloud auth application-default login\n");
  process.exit(1);
});
