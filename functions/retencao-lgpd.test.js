"use strict";

// Retencao de dados pessoais (auditoria de 16/10/2026, LGPD-01/02/03).
//
//   - a anonimizacao mensal deixava "agendado" e "remarcado" para sempre;
//   - comecava sempre do registro mais antigo, sem excluir os ja tratados: com
//     o teto por execucao, um dia deixaria de alcancar os novos;
//   - apagava o indice de CPF mesmo quando ele ja apontava para um
//     agendamento novo do mesmo CPF, liberando um segundo agendamento ativo;
//   - bloqueios_agendamento nunca era limpo e guardava nome e telefone;
//   - logs do painel guardavam CPF.
// As rotinas sao exercitadas de verdade contra um Firestore falso.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { dataISOValida, somarDiasISO } = require("./agenda-automation");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const painel = fs.readFileSync(path.join(raiz, "public", "recepcao.js"), "utf8");

function extrairFuncao(codigo, nome) {
  const marcador = new RegExp(`(?:async )?function ${nome}\\(`).exec(codigo);
  assert.ok(marcador, `Funcao ${nome} nao encontrada.`);
  let nivel = 0;
  for (let i = codigo.indexOf("{", codigo.indexOf(")", marcador.index)); i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}" && --nivel === 0) return codigo.slice(marcador.index, i + 1);
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

// ---- Firestore falso com consultas -----------------------------------------

const APAGAR = Symbol("delete");
const FieldValue = {
  delete: () => APAGAR,
  serverTimestamp: () => "TS",
  increment: (n) => ({ __increment: n })
};
const DOCUMENT_ID = Symbol("documentId");
const FieldPath = { documentId: () => DOCUMENT_ID };

function aplicarCampos(atual, campos) {
  const resultado = { ...(atual || {}) };
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === APAGAR) delete resultado[chave];
    else if (valor && valor.__increment !== undefined) resultado[chave] = (resultado[chave] || 0) + valor.__increment;
    else resultado[chave] = valor;
  }
  return resultado;
}

function montarFirestore(docs) {
  let sequencia = 0;
  const estat = { leiturasDadosCidadaos: 0 };
  const snapDe = (caminho) => {
    const id = caminho.split("/")[1];
    const dados = docs[caminho];
    return { id, exists: dados !== undefined, data: () => dados, ref: ref(caminho.split("/")[0], id) };
  };
  function ref(colecao, id) {
    const caminho = `${colecao}/${id}`;
    return {
      id,
      path: caminho,
      get: async () => snapDe(caminho),
      set: async (v, opcoes) => {
        docs[caminho] = opcoes && opcoes.merge ? aplicarCampos(docs[caminho], v) : aplicarCampos({}, v);
      }
    };
  }
  function consulta(colecao, filtros = [], ordem = null, limite = Infinity, depois = null) {
    return {
      where: (campo, op, valor) => consulta(colecao, [...filtros, { campo, op, valor }], ordem, limite, depois),
      orderBy: (campo) => consulta(colecao, filtros, campo, limite, depois),
      limit: (n) => consulta(colecao, filtros, ordem, n, depois),
      startAfter: (snap) => consulta(colecao, filtros, ordem, limite, snap),
      get: async () => {
        let lista = Object.keys(docs)
          .filter((p) => p.split("/").length === 2 && p.startsWith(`${colecao}/`))
          .map(snapDe)
          .filter((s) => filtros.every(({ campo, op, valor }) => {
            const v = s.data()[campo];
            if (op === "<=") return v !== undefined && v <= valor;
            if (op === ">=") return v !== undefined && v >= valor;
            if (op === "==") return v === valor;
            if (op === "in") return valor.includes(v);
            throw new Error(`op ${op}`);
          }));
        const chave = (s) => (ordem === DOCUMENT_ID || !ordem ? "" : String(s.data()[ordem])) + "\u0000" + s.id;
        lista.sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
        if (depois) lista = lista.filter((s) => chave(s) > chave(depois));
        lista = lista.slice(0, limite);
        if (colecao === "dados_cidadaos") estat.leiturasDadosCidadaos += lista.length;
        return { empty: lista.length === 0, size: lista.length, docs: lista };
      }
    };
  }
  const db = {
    collection: (colecao) => ({
      ...consulta(colecao),
      doc: (id) => ref(colecao, id || `auto${++sequencia}`),
      add: async (dados) => { docs[`${colecao}/auto${++sequencia}`] = dados; }
    }),
    getAll: async (...refs) => refs.map((r) => snapDe(r.path)),
    batch: () => {
      const pendentes = [];
      return {
        set: (r, v, opcoes) => pendentes.push(() => {
          docs[r.path] = opcoes && opcoes.merge ? aplicarCampos(docs[r.path], v) : aplicarCampos({}, v);
        }),
        update: (r, v) => pendentes.push(() => {
          assert.ok(docs[r.path], `update em documento inexistente: ${r.path}`);
          docs[r.path] = aplicarCampos(docs[r.path], v);
        }),
        delete: (r) => pendentes.push(() => { delete docs[r.path]; }),
        commit: async () => { pendentes.splice(0).forEach((aplicar) => aplicar()); }
      };
    }
  };
  db.collection("configuracoes"); // garante a forma
  return { db, estat };
}

// ---- Rotinas reais do index.js ----------------------------------------------

const subtrairMesesISO = new Function(
  "hojeSaoPauloISO",
  `${extrairFuncao(backend, "subtrairMesesISO")}; return subtrairMesesISO;`
)(() => "2026-10-16");

function montarRotinas(docs, { hoje = "2026-10-16", maxLeituras = 5000, pagina = 250, paginaBloqueios = 300 } = {}) {
  const { db, estat } = montarFirestore(docs);
  const hojeSaoPauloISO = () => hoje;
  const dataBr = new Function(`${extrairFuncao(backend, "dataBr")}; return dataBr;`)();
  const normalizarBloqueadoAte = new Function(
    "hojeSaoPauloISO", "dataBr",
    `${extrairFuncao(backend, "normalizarBloqueadoAte")}; return normalizarBloqueadoAte;`
  )(hojeSaoPauloISO, dataBr);
  const bloqueioAtivoDeDoc = new Function(
    "normalizarBloqueadoAte",
    `${extrairFuncao(backend, "bloqueioAtivoDeDoc")}; return bloqueioAtivoDeDoc;`
  )(normalizarBloqueadoAte);
  const subtrair = new Function(
    "hojeSaoPauloISO",
    `${extrairFuncao(backend, "subtrairMesesISO")}; return subtrairMesesISO;`
  )(hojeSaoPauloISO);
  const cpfNumeros = (v) => String(v || "").replace(/\D/g, "");

  const dependencias = {
    db,
    FieldValue,
    FieldPath,
    hojeSaoPauloISO,
    subtrairMesesISO: subtrair,
    cpfNumeros,
    cpfDocId: (cpf) => `cpf_hash_${cpf}`,
    bloqueioAtivoDeDoc,
    dataISOValida,
    somarDiasISO,
    LGPD_CURSOR_REF: () => db.collection("configuracoes").doc("lgpd"),
    LGPD_RETENCAO_MESES: 6,
    LGPD_MAX_LEITURAS_POR_EXECUCAO: maxLeituras,
    LGPD_TAMANHO_PAGINA: pagina,
    BLOQUEIOS_PAGINA: paginaBloqueios,
    BLOQUEIOS_MAX_LEITURAS: 5000,
    CAMPOS_PESSOAIS_BLOQUEIO: ["nome", "telefone"]
  };
  const rotinas = new Function(
    ...Object.keys(dependencias),
    `${extrairFuncao(backend, "anonimizarDadosAntigosLGPD")}
     ${extrairFuncao(backend, "limparBloqueiosVencidos")}
     return { anonimizarDadosAntigosLGPD, limparBloqueiosVencidos };`
  )(...Object.values(dependencias));
  return { ...rotinas, estat };
}

// Corte em 16/10/2026: 2026-04-16.
function registro(extra = {}) {
  return {
    nome: "Maria da Silva",
    cpf: "529.982.247-25",
    telefone: "(35) 99999-0000",
    email: "maria@exemplo.com",
    dataNasc: "1980-01-01",
    dataISO: "2026-03-10",
    hora: "14:30",
    protocolo: "CIN-ABCD1234",
    status: "compareceu",
    ...extra
  };
}

function anonimizado(dados) {
  return dados.anonimizadoLGPD === true
    && dados.nome === "ANONIMIZADO"
    && ["cpf", "telefone", "email", "dataNasc", "observacaoInterna"].every((campo) => dados[campo] === undefined);
}

// ---- subtrairMesesISO (BUG-05) -----------------------------------------------

test("seis meses antes de fim de mes nao transborda para o mes seguinte", () => {
  assert.equal(subtrairMesesISO("2026-08-31", 6), "2026-02-28");
  assert.equal(subtrairMesesISO("2028-08-31", 6), "2028-02-29");
  assert.equal(subtrairMesesISO("2026-10-16", 6), "2026-04-16");
  assert.equal(subtrairMesesISO("2026-01-15", 6), "2025-07-15");
  assert.equal(subtrairMesesISO("2026-03-31", 1), "2026-02-28");
});

// ---- LGPD-01: todos os status -------------------------------------------------

test("LGPD-01: registro antigo e anonimizado qualquer que seja o status", async () => {
  const status = ["agendado", "remarcado", "compareceu", "vai_voltar", "nao_compareceu", "cancelado", "cancelado_cidadao", "", "desconhecido"];
  const docs = {};
  status.forEach((s, i) => { docs[`dados_cidadaos/R${i}`] = registro({ status: s, cpf: "" }); });
  const { anonimizarDadosAntigosLGPD } = montarRotinas(docs);
  const r = await anonimizarDadosAntigosLGPD();
  assert.equal(r.totalAnonimizados, status.length);
  status.forEach((s, i) => assert.ok(anonimizado(docs[`dados_cidadaos/R${i}`]), `status "${s}" ficou com dados`));
});

test("registro com menos de seis meses nao e tocado", async () => {
  const docs = { "dados_cidadaos/N": registro({ dataISO: "2026-04-17", status: "agendado" }) };
  const antes = JSON.stringify(docs["dados_cidadaos/N"]);
  await montarRotinas(docs).anonimizarDadosAntigosLGPD();
  assert.equal(JSON.stringify(docs["dados_cidadaos/N"]), antes);
});

test("observacao interna sai junto, protocolo e data ficam para estatistica", async () => {
  const docs = { "dados_cidadaos/A": registro({ observacaoInterna: "Mae da Maria, tel 9999" }) };
  await montarRotinas(docs).anonimizarDadosAntigosLGPD();
  const d = docs["dados_cidadaos/A"];
  assert.equal(d.observacaoInterna, undefined);
  assert.equal(d.protocolo, "CIN-ABCD1234");
  assert.equal(d.dataISO, "2026-03-10");
  assert.equal(docs["configuracoes/estatisticas"].totalAtendimentosHistorico, 1);
});

// ---- Indice de CPF --------------------------------------------------------------

test("REGRESSAO: indice de CPF que aponta para agendamento novo e preservado", async () => {
  const docs = {
    "dados_cidadaos/VELHO": registro(),
    "dados_cidadaos/NOVO": registro({ dataISO: "2026-10-20", status: "agendado" }),
    "cpfs_agendados/cpf_hash_52998224725": { agendamentoId: "NOVO" },
    "cpfs_agendados/52998224725": { agendamentoId: "NOVO" }
  };
  const r = await montarRotinas(docs).anonimizarDadosAntigosLGPD();
  assert.ok(anonimizado(docs["dados_cidadaos/VELHO"]));
  assert.equal(docs["cpfs_agendados/cpf_hash_52998224725"].agendamentoId, "NOVO", "Sem o indice, o CPF agendaria duas vezes.");
  assert.equal(docs["cpfs_agendados/52998224725"].agendamentoId, "NOVO");
  assert.equal(r.totalCpfMapsPreservados, 2);
  assert.equal(r.totalCpfMapsRemovidos, 0);
});

test("indice de CPF do proprio registro (ou sem dono) e apagado", async () => {
  const docs = {
    "dados_cidadaos/VELHO": registro(),
    "cpfs_agendados/cpf_hash_52998224725": { agendamentoId: "VELHO" },
    "cpfs_agendados/52998224725": {}
  };
  const r = await montarRotinas(docs).anonimizarDadosAntigosLGPD();
  assert.equal(docs["cpfs_agendados/cpf_hash_52998224725"], undefined);
  assert.equal(docs["cpfs_agendados/52998224725"], undefined);
  assert.equal(r.totalCpfMapsRemovidos, 2);
});

// ---- Bloqueio por falta ---------------------------------------------------------

test("falta com bloqueio valendo: so CPF, motivo e data vao para o registro separado", async () => {
  const docs = {
    "dados_cidadaos/F": registro({
      status: "nao_compareceu",
      bloqueioAtivo: true,
      bloqueioCpf: "52998224725",
      bloqueioNome: "Maria da Silva",
      bloqueioTelefone: "(35) 99999-0000",
      bloqueadoAte: "2026-11-30"
    })
  };
  await montarRotinas(docs).anonimizarDadosAntigosLGPD();
  const bloqueio = docs["bloqueios_agendamento/52998224725"];
  assert.ok(bloqueio, "O bloqueio ainda valendo precisa sobreviver a anonimizacao.");
  assert.deepEqual(Object.keys(bloqueio).sort(), ["bloqueadoAte", "cpf", "criadoEm", "migradoDeAnonimizacao", "motivoBloqueio"]);
  assert.equal(bloqueio.bloqueadoAte, "2026-11-30");
  assert.ok(anonimizado(docs["dados_cidadaos/F"]));
  assert.equal(docs["dados_cidadaos/F"].bloqueioNome, undefined);
});

test("falta com bloqueio vencido ou liberado nao gera registro separado", async () => {
  const docs = {
    "dados_cidadaos/V": registro({ status: "nao_compareceu", bloqueioAtivo: true, bloqueadoAte: "2026-09-30" }),
    "dados_cidadaos/L": registro({ cpf: "111.444.777-35", status: "nao_compareceu", bloqueioAtivo: false, bloqueioLiberado: true, bloqueadoAte: "2026-12-30" })
  };
  await montarRotinas(docs).anonimizarDadosAntigosLGPD();
  assert.ok(!Object.keys(docs).some((p) => p.startsWith("bloqueios_agendamento/")));
});

// ---- LGPD-02: cursor --------------------------------------------------------------

test("LGPD-02: com o teto atingido, a proxima execucao continua de onde parou", async () => {
  const docs = {};
  ["2026-01-05", "2026-01-12", "2026-02-02", "2026-02-09", "2026-03-02"].forEach((data, i) => {
    docs[`dados_cidadaos/R${i}`] = registro({ dataISO: data, cpf: "" });
  });
  const primeira = await montarRotinas(docs, { maxLeituras: 2, pagina: 2 }).anonimizarDadosAntigosLGPD();
  assert.equal(primeira.totalAnonimizados, 2);
  assert.equal(primeira.concluiuAteCorte, false);
  assert.equal(docs["configuracoes/lgpd"].proximaDataISO, "2026-01-12");

  const segunda = await montarRotinas(docs, { maxLeituras: 2, pagina: 2 }).anonimizarDadosAntigosLGPD();
  assert.equal(segunda.inicio, "2026-01-12");
  assert.ok(segunda.totalAnonimizados >= 1);

  for (let i = 0; i < 3; i++) await montarRotinas(docs, { maxLeituras: 2, pagina: 2 }).anonimizarDadosAntigosLGPD();
  for (let i = 0; i < 5; i++) assert.ok(anonimizado(docs[`dados_cidadaos/R${i}`]), `R${i}`);
  assert.equal(docs["configuracoes/lgpd"].proximaDataISO, "2026-04-17", "Concluido: comeca no dia seguinte ao corte.");
});

test("LGPD-02: historico ja anonimizado maior que o teto nao trava os registros novos", async () => {
  // O codigo antigo releria sempre os 3 mais antigos e nunca chegaria ao novo.
  const docs = {};
  for (let i = 0; i < 6; i++) {
    docs[`dados_cidadaos/OLD${i}`] = { nome: "ANONIMIZADO", dataISO: `2025-0${i + 1}-01`, anonimizadoLGPD: true };
  }
  docs["dados_cidadaos/NOVO"] = registro({ dataISO: "2026-04-01", cpf: "" });
  for (let execucao = 0; execucao < 4 && !anonimizado(docs["dados_cidadaos/NOVO"]); execucao++) {
    const { anonimizarDadosAntigosLGPD, estat } = montarRotinas(docs, { maxLeituras: 3, pagina: 3 });
    await anonimizarDadosAntigosLGPD();
    assert.ok(estat.leiturasDadosCidadaos <= 3, "Cada execucao respeita o teto de leituras.");
  }
  assert.ok(anonimizado(docs["dados_cidadaos/NOVO"]));
});

test("execucao concluida nao rele o historico no mesmo mes", async () => {
  const docs = { "dados_cidadaos/A": registro({ cpf: "" }) };
  await montarRotinas(docs).anonimizarDadosAntigosLGPD();
  const { anonimizarDadosAntigosLGPD, estat } = montarRotinas(docs);
  const r = await anonimizarDadosAntigosLGPD();
  assert.equal(r.totalLidos, 0);
  assert.equal(estat.leiturasDadosCidadaos, 0);
});

test("no mes seguinte so a faixa nova e lida", async () => {
  const docs = {
    "dados_cidadaos/A": registro({ dataISO: "2026-03-10", cpf: "" }),
    "dados_cidadaos/B": registro({ dataISO: "2026-05-10", cpf: "" })
  };
  await montarRotinas(docs).anonimizarDadosAntigosLGPD();
  assert.ok(!anonimizado(docs["dados_cidadaos/B"]));
  const { anonimizarDadosAntigosLGPD, estat } = montarRotinas(docs, { hoje: "2026-11-16" });
  const r = await anonimizarDadosAntigosLGPD();
  assert.equal(r.inicio, "2026-04-17");
  assert.equal(estat.leiturasDadosCidadaos, 1);
  assert.ok(anonimizado(docs["dados_cidadaos/B"]));
});

test("a execucao registra log sem dado pessoal", async () => {
  const docs = { "dados_cidadaos/A": registro() };
  await montarRotinas(docs).anonimizarDadosAntigosLGPD();
  const log = Object.entries(docs).find(([p, d]) => p.startsWith("logs_admin/") && d.acao === "anonimizacao_lgpd")[1];
  assert.ok(!JSON.stringify(log).includes("52998224725"));
  assert.ok(!JSON.stringify(log).includes("Maria"));
});

// ---- LGPD-03: bloqueios ----------------------------------------------------------

test("LGPD-03: limpeza diaria apaga bloqueio vencido ou liberado e tira nome e telefone do resto", async () => {
  const docs = {
    "bloqueios_agendamento/11111111111": { cpf: "11111111111", bloqueadoAte: "2026-10-01", nome: "A", telefone: "1" },
    "bloqueios_agendamento/22222222222": { cpf: "22222222222", bloqueadoAte: "2026-12-01", liberado: true },
    "bloqueios_agendamento/33333333333": { cpf: "33333333333", bloqueadoAte: "2026-12-01", nome: "C", telefone: "3", motivo: "Nao comparecimento" },
    "bloqueios_agendamento/44444444444": { cpf: "44444444444", bloqueadoAte: "2026-12-01" },
    "bloqueios_agendamento/55555555555": { cpf: "55555555555" }
  };
  const r = await montarRotinas(docs, { paginaBloqueios: 2 }).limparBloqueiosVencidos();
  assert.deepEqual(r, { lidos: 5, removidos: 3, saneados: 1 });
  assert.equal(docs["bloqueios_agendamento/11111111111"], undefined);
  assert.equal(docs["bloqueios_agendamento/22222222222"], undefined);
  assert.equal(docs["bloqueios_agendamento/55555555555"], undefined, "Sem data, o bloqueio ja nao era aplicado.");
  assert.deepEqual(docs["bloqueios_agendamento/33333333333"], { cpf: "33333333333", bloqueadoAte: "2026-12-01", motivo: "Nao comparecimento" });
  assert.deepEqual(docs["bloqueios_agendamento/44444444444"], { cpf: "44444444444", bloqueadoAte: "2026-12-01" });
});

test("bloqueio que vence hoje ja nao vale e sai", async () => {
  const docs = { "bloqueios_agendamento/11111111111": { cpf: "11111111111", bloqueadoAte: "2026-10-16" } };
  await montarRotinas(docs).limparBloqueiosVencidos();
  assert.equal(docs["bloqueios_agendamento/11111111111"], undefined);
});

test("manutencao diaria chama a limpeza de bloqueios", () => {
  const inicio = backend.indexOf("exports.executarManutencaoDiaria");
  const manutencao = backend.slice(inicio, backend.indexOf("});", inicio));
  assert.match(manutencao, /await limparBloqueiosVencidos\(\);/);
});

// ---- Painel -------------------------------------------------------------------------

test("painel nao grava nome nem telefone no bloqueio dedicado", () => {
  const gravar = extrairFuncao(painel, "tentarGravarBloqueioDedicado");
  assert.doesNotMatch(gravar.replace(/\/\/[^\n]*/g, ""), /nome:|telefone:/);
});

test("logs do painel sobre bloqueio nao levam CPF", () => {
  for (const acao of ["whatsapp_bloqueio", "liberar_bloqueio"]) {
    const chamada = new RegExp(`registrarLog\\("${acao}", \\{([^}]*)\\}\\)`).exec(painel);
    assert.ok(chamada, acao);
    assert.doesNotMatch(chamada[1], /cpf/i, acao);
  }
});

test("script de saneamento roda em simulacao por padrao", () => {
  const script = fs.readFileSync(path.join(raiz, "scripts", "sanear-dados-lgpd.js"), "utf8");
  assert.match(script, /const APLICAR = process\.argv\.includes\("--aplicar"\);/);
  const antesDeGravar = script.slice(0, script.indexOf("await gravarEmLotes(db"));
  assert.match(antesDeGravar, /if \(!APLICAR\) \{[\s\S]*return;\s*\}/);
});
