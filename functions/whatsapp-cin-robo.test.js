"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  normalizarProtocoloRobo,
  tokenConfere,
  sha256Hex,
  situacaoDoAgendamento,
  criarServicoRoboAgendamento
} = require("./whatsapp-cin-robo");

const TOKEN = "t".repeat(40);
const HASH = sha256Hex(TOKEN);
const TEL = "5535998765432";
const AG = {
  nome: "MARIA da silva",
  cpf: "123.456.789-09",
  telefone: "(35) 99876-5432",
  dataISO: "2026-11-27",
  hora: "14:30",
  protocolo: "CIN-AB12CD34",
  status: "agendado",
  ativo: true,
  slotId: "2026-11-27_14:30"
};
const cpfDocId = (cpf) => "cpf_" + crypto.createHash("sha256").update(cpf).digest("hex");
const ativo = (d) => d.ativo !== false && !["cancelado", "cancelado_cidadao", "cancelado_camara"].includes(d.status);

// Firestore falso: colecao/documento, where("=="), transacao com leituras antes das escritas.
function ambiente({ futuro = true } = {}) {
  const registros = new Map();
  const referencia = (path) => ({ id: path.split("/").at(-1), path });
  const snapshot = (ref) => ({ exists: registros.has(ref.path), data: () => registros.get(ref.path) });
  const db = {
    collection(nome) {
      const filtros = [];
      const consulta = {
        where(campo, op, valor) { assert.equal(op, "=="); filtros.push([campo, valor]); return consulta; },
        limit() { return consulta; },
        async get() {
          return {
            docs: [...registros]
              .filter(([path, dados]) => path.startsWith(`${nome}/`) && filtros.every(([c, v]) => dados[c] === v))
              .map(([path, dados]) => ({ id: path.split("/").at(-1), ref: referencia(path), data: () => dados }))
          };
        },
        doc(id) {
          const ref = referencia(`${nome}/${id}`);
          return { ...ref, get: async () => snapshot(ref) };
        }
      };
      return consulta;
    },
    async runTransaction(fn) {
      const escritas = [];
      const r = await fn({
        async get(ref) { assert.equal(escritas.length, 0, "leituras antes das escritas"); return snapshot(ref); },
        set(ref, dados, opcoes) { escritas.push(() => registros.set(ref.path, opcoes && opcoes.merge ? { ...registros.get(ref.path), ...dados } : dados)); },
        delete(ref) { escritas.push(() => registros.delete(ref.path)); }
      });
      escritas.forEach((e) => e());
      return r;
    }
  };
  const servico = criarServicoRoboAgendamento({
    db,
    hashTokenEsperado: HASH,
    cpfDocId,
    agendamentoEstaAtivo: ativo,
    horarioFuturo: () => futuro,
    hojeISO: () => "2026-11-22",
    agora: () => new Date("2026-11-22T15:00:00Z")
  });
  return { registros, servico };
}

function agendar(registros, id, dados = {}) {
  const ag = { ...AG, ...dados };
  registros.set(`dados_cidadaos/${id}`, ag);
  registros.set(`vagas_ocupadas/${ag.slotId}`, { agendamentoId: id });
  const cpfNum = ag.cpf.replace(/\D/g, "");
  registros.set(`cpfs_agendados/${cpfDocId(cpfNum)}`, { agendamentoId: id });
  return ag;
}

function pedido(corpo, token = TOKEN) {
  const saida = {};
  const req = { method: "POST", body: corpo, get: (h) => (h.toLowerCase() === "x-cin-robo" ? token : undefined) };
  const res = {
    set() { return res; },
    status(s) { saida.status = s; return res; },
    json(j) { saida.json = j; return res; }
  };
  return { req, res, saida };
}

test("protocolo: aceita com ou sem hifen e em minusculas; recusa o resto", () => {
  assert.equal(normalizarProtocoloRobo("CIN-AB12CD34"), "CIN-AB12CD34");
  assert.equal(normalizarProtocoloRobo(" cin ab12cd34 "), "CIN-AB12CD34");
  assert.equal(normalizarProtocoloRobo("cinab12cd34"), "CIN-AB12CD34");
  assert.equal(normalizarProtocoloRobo("CIN-AB12"), "");
  assert.equal(normalizarProtocoloRobo("CIN-AB12CD345"), "");
  assert.equal(normalizarProtocoloRobo(""), "");
});

test("token: confere pelo SHA-256 e recusa vazio, curto ou hash ausente", () => {
  assert.equal(tokenConfere(TOKEN, HASH), true);
  assert.equal(tokenConfere(TOKEN, HASH.toUpperCase()), true);
  assert.equal(tokenConfere("x".repeat(40), HASH), false);
  assert.equal(tokenConfere("curto", sha256Hex("curto")), false);
  assert.equal(tokenConfere(TOKEN, ""), false, "sem hash configurado, nada passa");
  assert.equal(tokenConfere(undefined, HASH), false);
});

test("situacao: agendado, passou, atendido, faltou, cancelado", () => {
  assert.equal(situacaoDoAgendamento({ status: "agendado" }, true, true), "agendado");
  assert.equal(situacaoDoAgendamento({ status: "remarcado" }, true, false), "passou");
  assert.equal(situacaoDoAgendamento({ status: "compareceu" }, true, false), "atendido");
  assert.equal(situacaoDoAgendamento({ status: "nao_compareceu" }, true, false), "faltou");
  assert.equal(situacaoDoAgendamento({ status: "cancelado_cidadao" }, false, true), "cancelado");
});

test("consulta: protocolo + celular do cadastro; sem CPF nem nome inteiro na resposta", async () => {
  const { registros, servico } = ambiente();
  agendar(registros, "ag1");
  const r = await servico.consultar({ protocolo: "CIN-AB12CD34", telefone: TEL });
  assert.deepEqual(r, {
    ok: true, situacao: "agendado", dataISO: "2026-11-27", hora: "14:30",
    quando: "sexta, 27/11, às 14h30", primeiroNome: "Maria", podeCancelar: true
  });
  assert.equal(JSON.stringify(r).includes("123"), false, "nada do CPF");
});

test("consulta: celular diferente ou protocolo errado dao a mesma resposta", async () => {
  const { registros, servico } = ambiente();
  agendar(registros, "ag1");
  const outroCelular = await servico.consultar({ protocolo: "CIN-AB12CD34", telefone: "5535911112222" });
  const outroProtocolo = await servico.consultar({ protocolo: "CIN-ZZZZZZZZ", telefone: TEL });
  assert.deepEqual(outroCelular, { ok: false, motivo: "nao_encontrado" });
  assert.deepEqual(outroProtocolo, outroCelular);
});

test("cancelamento: libera a vaga e o CPF, marca canceladoPor whatsapp", async () => {
  const { registros, servico } = ambiente();
  agendar(registros, "ag1");
  const r = await servico.cancelar({ protocolo: "CIN-AB12CD34", telefone: TEL });
  assert.equal(r.ok, true);
  assert.equal(r.cancelado, true);
  assert.equal(r.quando, "sexta, 27/11, às 14h30");
  const ag = registros.get("dados_cidadaos/ag1");
  assert.equal(ag.status, "cancelado_cidadao");
  assert.equal(ag.canceladoPor, "whatsapp");
  assert.equal(ag.ativo, false);
  assert.equal(registros.has("vagas_ocupadas/2026-11-27_14:30"), false, "vaga liberada");
  assert.equal(registros.has(`cpfs_agendados/${cpfDocId("12345678909")}`), false, "CPF liberado");
  const deNovo = await servico.cancelar({ protocolo: "CIN-AB12CD34", telefone: TEL });
  assert.equal(deNovo.ok, false);
  assert.equal(deNovo.motivo, "nao_pode_cancelar");
  assert.equal(deNovo.situacao, "cancelado");
});

test("cancelamento: vaga e CPF ja reapontados para outro agendamento ficam (B5)", async () => {
  const { registros, servico } = ambiente();
  agendar(registros, "ag1");
  registros.set("vagas_ocupadas/2026-11-27_14:30", { agendamentoId: "ag2" });
  registros.set(`cpfs_agendados/${cpfDocId("12345678909")}`, { agendamentoId: "ag2" });
  const r = await servico.cancelar({ protocolo: "CIN-AB12CD34", telefone: TEL });
  assert.equal(r.ok, true);
  assert.deepEqual(registros.get("vagas_ocupadas/2026-11-27_14:30"), { agendamentoId: "ag2" });
  assert.deepEqual(registros.get(`cpfs_agendados/${cpfDocId("12345678909")}`), { agendamentoId: "ag2" });
});

test("cancelamento: horario que ja passou nao cancela", async () => {
  const { registros, servico } = ambiente({ futuro: false });
  agendar(registros, "ag1");
  const r = await servico.cancelar({ protocolo: "CIN-AB12CD34", telefone: TEL });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "nao_pode_cancelar");
  assert.equal(r.situacao, "passou");
  assert.equal(registros.get("dados_cidadaos/ag1").status, "agendado");
});

test("http: token, metodo e acao; status do disjuntor e dos envios do dia", async () => {
  const { registros, servico } = ambiente();
  agendar(registros, "ag1");
  registros.set("whatsapp_controle/disjuntor", { ativo: true });
  registros.set("whatsapp_controle/dia_2026-11-22", { enviados: 7 });

  let p = pedido({ acao: "consultar", protocolo: "CIN-AB12CD34", telefone: TEL }, "errado".repeat(8));
  await servico.atender(p.req, p.res);
  assert.equal(p.saida.status, 401);

  p = pedido({ acao: "apagar" });
  await servico.atender(p.req, p.res);
  assert.equal(p.saida.status, 400);

  p = pedido({ acao: "consultar", protocolo: "cin ab12cd34", telefone: "(35) 99876-5432" });
  await servico.atender(p.req, p.res);
  assert.equal(p.saida.status, 200);
  assert.equal(p.saida.json.situacao, "agendado");

  p = pedido({ acao: "status" });
  await servico.atender(p.req, p.res);
  assert.deepEqual(p.saida.json, { ok: true, disjuntor: true, enviadosHoje: 7 });

  const get = pedido({});
  get.req.method = "GET";
  await servico.atender(get.req, get.res);
  assert.equal(get.saida.status, 405);
});
