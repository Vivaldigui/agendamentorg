"use strict";

// Remarcacao pela recepcao.
//
// Ate 16/10/2026 o painel remarcava escrevendo direto no Firestore:
//   - lia as vagas do horario fora de transacao e gravava com merge, entao um
//     cidadao que reservasse aquela vaga no intervalo tinha o agendamentoId
//     sobrescrito -- duas pessoas no mesmo horario;
//   - apagava a vaga antiga sem conferir o dono. Com a lista desatualizada, a
//     vaga de quem reservou depois sumia e o horario voltava a ser oferecido;
//   - aceitava horario fora da grade contando vaga (capacidade minima 1).
// Agora o painel chama remarcarAgendamentoAdmin. A transacao e exercitada de
// verdade, com um Firestore falso: exclusao condicional nao se prova lendo texto.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizarGradesAtendimento, vagasDoHorario, slotIdsDoHorario } = require("./agenda-grade");

const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

function extrairExport(codigo, nome) {
  const inicio = codigo.indexOf("exports." + nome + " =");
  assert.notEqual(inicio, -1, "Export " + nome + " nao encontrado.");
  const resto = codigo.slice(inicio + 1);
  const proxima = resto.search(/\n(?:exports\.|(?:async )?function |const |\/\/ )/);
  return proxima === -1 ? codigo.slice(inicio) : codigo.slice(inicio, inicio + 1 + proxima);
}

// Inclui o "async" quando houver: lerVagasDoHorario e assincrona.
function extrairFuncao(codigo, nome) {
  const marcador = new RegExp(`(?:async )?function ${nome}\\(`).exec(codigo);
  assert.ok(marcador, "Funcao " + nome + " nao encontrada.");
  const inicio = marcador.index;
  let nivel = 0;
  for (let i = codigo.indexOf("{", codigo.indexOf(")", inicio)); i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}" && --nivel === 0) return codigo.slice(inicio, i + 1);
  }
  throw new Error("Fim da funcao " + nome + " nao encontrado.");
}

class ErroFalso extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const FieldValue = {
  serverTimestamp: () => "TS",
  arrayUnion: (...itens) => ({ __arrayUnion: itens })
};

// Firestore falso: transacao aplica as escritas so no fim, respeita merge e
// registra se alguma leitura aconteceu depois de uma escrita.
function montarFirestore(docs) {
  let sequencia = 0;
  const controle = { leituraDepoisDeEscrita: false, escritas: 0 };
  const snap = (r) => {
    const dados = docs[r.path];
    return { exists: dados !== undefined, id: r.id, data: () => dados };
  };
  const ref = (colecao, id) => ({ path: `${colecao}/${id}`, id });
  const aplicarMerge = (atual, novo) => {
    const resultado = { ...(atual || {}) };
    for (const [chave, valor] of Object.entries(novo)) {
      resultado[chave] = valor && valor.__arrayUnion
        ? [...(Array.isArray(resultado[chave]) ? resultado[chave] : []), ...valor.__arrayUnion]
        : valor;
    }
    return resultado;
  };
  const db = {
    collection: (colecao) => ({ doc: (id) => ref(colecao, id || `auto${++sequencia}`) }),
    getAll: async (...refs) => refs.map(snap),
    runTransaction: async (fn) => {
      const pendentes = [];
      const ler = (r) => {
        if (pendentes.length) controle.leituraDepoisDeEscrita = true;
        return snap(r);
      };
      const t = {
        get: async (r) => ler(r),
        getAll: async (...refs) => refs.map(ler),
        set: (r, v, opcoes) => pendentes.push(() => {
          docs[r.path] = opcoes && opcoes.merge ? aplicarMerge(docs[r.path], v) : v;
        }),
        delete: (r) => pendentes.push(() => { delete docs[r.path]; })
      };
      const resultado = await fn(t);
      controle.escritas += pendentes.length;
      pendentes.forEach((aplicar) => aplicar());
      return resultado;
    }
  };
  return { db, controle };
}

function montarRemarcar(docs) {
  const { db, controle } = montarFirestore(docs);
  const agendamentoEstaAtivo = new Function(`${extrairFuncao(backend, "agendamentoEstaAtivo")}; return agendamentoEstaAtivo;`)();
  const slotRepresentaOcupacaoAtual = new Function(
    "agendamentoEstaAtivo",
    `${extrairFuncao(backend, "slotRepresentaOcupacaoAtual")}; return slotRepresentaOcupacaoAtual;`
  )(agendamentoEstaAtivo);
  const lerVagasDoHorario = new Function(
    "db", "slotIdsDoHorario", "slotRepresentaOcupacaoAtual",
    `${extrairFuncao(backend, "lerVagasDoHorario")}; return lerVagasDoHorario;`
  )(db, slotIdsDoHorario, slotRepresentaOcupacaoAtual);

  let handler = null;
  const dependencias = {
    exports: {},
    onCall: (_opcoes, fn) => { handler = fn; },
    callableOptions: {},
    assertAdmin: async () => "recepcao@camara",
    HttpsError: ErroFalso,
    normalizarData: (v) => String(v),
    normalizarHora: (v) => String(v),
    hojeSaoPauloISO: () => "2026-09-28",
    db,
    agendamentoEstaAtivo,
    cpfDocId: (cpf) => `cpf_hash_${cpf}`,
    AGENDA_REF: () => db.collection("configuracoes").doc("agenda"),
    lerVagasDoHorario,
    processarAgenda: (bruto) => ({
      dias: bruto.dias || [],
      horariosPorDiaSemana: {},
      gradesAtendimento: normalizarGradesAtendimento(bruto.gradesAtendimento)
    }),
    vagasDoHorario,
    dataBr: (v) => v,
    FieldValue
  };
  new Function(...Object.keys(dependencias), extrairExport(backend, "remarcarAgendamentoAdmin"))(
    ...Object.values(dependencias)
  );
  assert.ok(handler, "Handler nao capturado.");
  return {
    remarcar: (data) => handler({ data }),
    controle
  };
}

const AGENDA = {
  dias: ["2026-09-29", "2026-09-30"],
  gradesAtendimento: [{
    inicio: "2026-09-28",
    horarios: [{ hora: "14:00", vagas: 1 }, { hora: "15:00", vagas: 2 }]
  }]
};

const CPF_A = "52998224725";

function agendamentoA(extra = {}) {
  return {
    nome: "Fulano A",
    cpf: "529.982.247-25",
    dataISO: "2026-09-29",
    hora: "14:00",
    slotId: "2026-09-29_14:00",
    protocolo: "CIN-AAAA",
    status: "agendado",
    ...extra
  };
}

function cenarioBase(extra = {}) {
  return {
    "configuracoes/agenda": AGENDA,
    "dados_cidadaos/A": agendamentoA(),
    "vagas_ocupadas/2026-09-29_14:00": { dataISO: "2026-09-29", hora: "14:00", agendamentoId: "A", origem: "publico" },
    [`cpfs_agendados/cpf_hash_${CPF_A}`]: { agendamentoId: "A", slotId: "2026-09-29_14:00" },
    ...extra
  };
}

function logs(docs) {
  return Object.entries(docs).filter(([p]) => p.startsWith("logs_admin/")).map(([, d]) => d);
}

test("remarcacao normal move a vaga, atualiza o agendamento, o indice e registra log", async () => {
  const docs = cenarioBase();
  const { remarcar, controle } = montarRemarcar(docs);
  const { agendamento } = await remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "14:00", contabilizaVaga: true });

  assert.equal(agendamento.slotId, "2026-09-30_14:00");
  assert.equal(agendamento.vagaAntigaLiberada, true);
  assert.equal(docs["vagas_ocupadas/2026-09-29_14:00"], undefined);
  assert.equal(docs["vagas_ocupadas/2026-09-30_14:00"].agendamentoId, "A");
  assert.equal(docs["vagas_ocupadas/2026-09-30_14:00"].contabilizaVaga, true);
  assert.equal(docs["dados_cidadaos/A"].dataISO, "2026-09-30");
  assert.equal(docs["dados_cidadaos/A"].slotId, "2026-09-30_14:00");
  assert.equal(docs["dados_cidadaos/A"].status, "remarcado");
  assert.equal(docs["dados_cidadaos/A"].ativo, true);
  assert.equal(docs["dados_cidadaos/A"].remarcacoes.length, 1);
  assert.equal(docs[`cpfs_agendados/cpf_hash_${CPF_A}`].slotId, "2026-09-30_14:00");
  // Nao cria indice novo com o CPF em texto no id.
  assert.equal(docs[`cpfs_agendados/${CPF_A}`], undefined);
  const [log] = logs(docs);
  assert.equal(log.acao, "remarcar_agendamento");
  assert.equal(log.adminEmail, "recepcao@camara");
  assert.equal(controle.leituraDepoisDeEscrita, false, "Toda leitura precisa vir antes das escritas.");
});

test("REGRESSAO: linha velha NAO apaga a vaga antiga que ja pertence a outra pessoa", async () => {
  // A ja tinha sido remarcado para 30/09; B reservou as 14:00 de 29/09. A tela
  // velha ainda mostra A em 29/09 14:00 e a recepcao remarca de novo.
  const docs = cenarioBase({
    "dados_cidadaos/A": agendamentoA({ dataISO: "2026-09-29", hora: "14:00", slotId: "2026-09-29_14:00" }),
    "vagas_ocupadas/2026-09-29_14:00": { dataISO: "2026-09-29", hora: "14:00", agendamentoId: "B", origem: "publico" },
    "dados_cidadaos/B": { nome: "B", cpf: "111.444.777-35", dataISO: "2026-09-29", hora: "14:00", slotId: "2026-09-29_14:00", status: "agendado" }
  });
  const { remarcar } = montarRemarcar(docs);
  const { agendamento } = await remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "15:00", contabilizaVaga: true });

  assert.equal(agendamento.vagaAntigaLiberada, false);
  assert.equal(docs["vagas_ocupadas/2026-09-29_14:00"].agendamentoId, "B", "A vaga de B tem de sobreviver.");
  assert.equal(docs["vagas_ocupadas/2026-09-30_15:00"].agendamentoId, "A");
});

test("REGRESSAO: vaga antiga de outra pessoa no MESMO horario nao e tratada como propria", async () => {
  // O slotId gravado em A aponta para a posicao 1 das 14:00, que agora e de B.
  const docs = cenarioBase({
    "vagas_ocupadas/2026-09-29_14:00": { dataISO: "2026-09-29", hora: "14:00", agendamentoId: "B", origem: "publico" },
    "dados_cidadaos/B": { nome: "B", cpf: "111.444.777-35", dataISO: "2026-09-29", hora: "14:00", slotId: "2026-09-29_14:00", status: "agendado" }
  });
  const { remarcar } = montarRemarcar(docs);
  // 14:00 tem uma vaga, e ela e de B: a remarcacao tem de ser recusada.
  await assert.rejects(
    () => remarcar({ agendamentoId: "A", data: "2026-09-29", hora: "14:00", contabilizaVaga: true }),
    (e) => e.code === "already-exists"
  );
  assert.equal(docs["vagas_ocupadas/2026-09-29_14:00"].agendamentoId, "B");
});

test("horario cheio e recusado sem nenhuma escrita", async () => {
  const docs = cenarioBase({
    "vagas_ocupadas/2026-09-30_14:00": { dataISO: "2026-09-30", hora: "14:00", agendamentoId: "C", origem: "publico" },
    "dados_cidadaos/C": { nome: "C", cpf: "111.444.777-35", dataISO: "2026-09-30", hora: "14:00", status: "agendado" }
  });
  const antes = JSON.stringify(docs);
  const { remarcar, controle } = montarRemarcar(docs);
  await assert.rejects(
    () => remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "14:00", contabilizaVaga: true }),
    (e) => e.code === "already-exists"
  );
  assert.equal(controle.escritas, 0);
  assert.equal(JSON.stringify(docs), antes);
});

test("vaga de agendamento cancelado e reaproveitada e sobrescrita por inteiro", async () => {
  const docs = cenarioBase({
    "vagas_ocupadas/2026-09-30_14:00": { dataISO: "2026-09-30", hora: "14:00", agendamentoId: "C", origem: "publico", criado: "antigo" },
    "dados_cidadaos/C": { nome: "C", dataISO: "2026-09-30", hora: "14:00", status: "cancelado_cidadao", ativo: false }
  });
  const { remarcar } = montarRemarcar(docs);
  await remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "14:00", contabilizaVaga: true });
  const vaga = docs["vagas_ocupadas/2026-09-30_14:00"];
  assert.equal(vaga.agendamentoId, "A");
  assert.equal(vaga.origem, "admin_remarcacao");
  assert.equal(vaga.criado, undefined, "set sem merge: nada da vaga anterior sobrevive.");
});

test("horario com duas vagas usa a segunda quando a primeira esta ocupada", async () => {
  const docs = cenarioBase({
    "vagas_ocupadas/2026-09-30_15:00": { dataISO: "2026-09-30", hora: "15:00", agendamentoId: "C", origem: "publico" },
    "dados_cidadaos/C": { nome: "C", dataISO: "2026-09-30", hora: "15:00", status: "agendado" }
  });
  const { remarcar } = montarRemarcar(docs);
  const { agendamento } = await remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "15:00", contabilizaVaga: true });
  assert.equal(agendamento.slotId, "2026-09-30_15:00_2");
  assert.equal(docs["vagas_ocupadas/2026-09-30_15:00"].agendamentoId, "C");
});

test("remarcar para o mesmo horario mantem a propria vaga", async () => {
  const docs = cenarioBase();
  const { remarcar } = montarRemarcar(docs);
  const { agendamento } = await remarcar({ agendamentoId: "A", data: "2026-09-29", hora: "14:00", contabilizaVaga: true });
  assert.equal(agendamento.slotId, "2026-09-29_14:00");
  assert.equal(agendamento.vagaAntigaLiberada, false);
  assert.equal(docs["vagas_ocupadas/2026-09-29_14:00"].agendamentoId, "A");
});

test("BUG-03: horario fora da grade contando vaga e recusado", async () => {
  const docs = cenarioBase();
  const antes = JSON.stringify(docs);
  const { remarcar } = montarRemarcar(docs);
  await assert.rejects(
    () => remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "09:00", contabilizaVaga: true }),
    (e) => e.code === "failed-precondition" && /grade/.test(e.message)
  );
  assert.equal(JSON.stringify(docs), antes);
});

test("encaixe fora da grade (sem contar vaga) usa vaga manual e libera a vaga publica", async () => {
  const docs = cenarioBase();
  const { remarcar } = montarRemarcar(docs);
  const { agendamento } = await remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "09:00", contabilizaVaga: false });
  assert.equal(agendamento.slotId, "manual_A");
  assert.equal(agendamento.insercaoManual, true);
  assert.equal(docs["vagas_ocupadas/2026-09-29_14:00"], undefined);
  assert.equal(docs["vagas_ocupadas/manual_A"].contabilizaVaga, false);
  assert.equal(docs["vagas_ocupadas/manual_A"].origem, "manual");
});

test("BUG-03: data passada e recusada", async () => {
  const { remarcar } = montarRemarcar(cenarioBase());
  await assert.rejects(
    () => remarcar({ agendamentoId: "A", data: "2026-09-27", hora: "14:00", contabilizaVaga: true }),
    (e) => e.code === "failed-precondition"
  );
});

test("reativar agendamento cancelado funciona quando o CPF nao tem outro ativo", async () => {
  const docs = cenarioBase({
    "dados_cidadaos/A": agendamentoA({ status: "cancelado_cidadao", ativo: false, canceladoPor: "cidadao" })
  });
  delete docs["vagas_ocupadas/2026-09-29_14:00"];
  delete docs[`cpfs_agendados/cpf_hash_${CPF_A}`];
  const { remarcar } = montarRemarcar(docs);
  const { agendamento } = await remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "14:00", contabilizaVaga: true });
  assert.equal(agendamento.reativado, true);
  assert.equal(docs["dados_cidadaos/A"].ativo, true);
  assert.equal(docs[`cpfs_agendados/cpf_hash_${CPF_A}`].agendamentoId, "A");
});

test("reativar agendamento cancelado e recusado se o CPF ja tem outro ativo", async () => {
  const docs = cenarioBase({
    "dados_cidadaos/A": agendamentoA({ status: "cancelado", ativo: false }),
    "dados_cidadaos/A2": agendamentoA({ dataISO: "2026-09-30", hora: "15:00", slotId: "2026-09-30_15:00" }),
    [`cpfs_agendados/cpf_hash_${CPF_A}`]: { agendamentoId: "A2", slotId: "2026-09-30_15:00" }
  });
  delete docs["vagas_ocupadas/2026-09-29_14:00"];
  const antes = JSON.stringify(docs);
  const { remarcar } = montarRemarcar(docs);
  await assert.rejects(
    () => remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "14:00", contabilizaVaga: true }),
    (e) => e.code === "failed-precondition" && /CPF/.test(e.message)
  );
  assert.equal(JSON.stringify(docs), antes);
});

test("agendamento substituido pelo cidadao nao pode ser remarcado", async () => {
  const docs = cenarioBase({
    "dados_cidadaos/A": agendamentoA({ status: "remarcado", ativo: false, remarcadoParaAgendamentoId: "A2" })
  });
  const { remarcar } = montarRemarcar(docs);
  await assert.rejects(
    () => remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "14:00", contabilizaVaga: true }),
    (e) => e.code === "failed-precondition"
  );
});

test("indice legado com CPF em texto so e atualizado se ja existir", async () => {
  const docs = cenarioBase({ [`cpfs_agendados/${CPF_A}`]: { agendamentoId: "A", slotId: "2026-09-29_14:00" } });
  const { remarcar } = montarRemarcar(docs);
  await remarcar({ agendamentoId: "A", data: "2026-09-30", hora: "14:00", contabilizaVaga: true });
  assert.equal(docs[`cpfs_agendados/${CPF_A}`].slotId, "2026-09-30_14:00");
});

test("agendamento inexistente devolve not-found", async () => {
  const { remarcar } = montarRemarcar(cenarioBase());
  await assert.rejects(
    () => remarcar({ agendamentoId: "X", data: "2026-09-30", hora: "14:00", contabilizaVaga: true }),
    (e) => e.code === "not-found"
  );
});
