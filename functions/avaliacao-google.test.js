"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const workflow = require("../docs/n8n/avaliacao-google.workflow.json");
const {
  COLECAO,
  COLECAO_DESTINATARIOS,
  emailValido,
  identificadorDestinatario,
  dataISOValida,
  dataEmSaoPaulo,
  validarConfiguracao,
  criarServicoAvaliacao
} = require("./avaliacao-google");

class Timestamp {
  constructor(ms) { this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1000000; }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1000000; }
  static fromMillis(ms) { return new Timestamp(ms); }
}

const AGORA = Date.parse("2026-09-16T20:00:00Z");
const DATA = "2026-09-16";
const CONFIG = {
  webhookUrl: "https://n8n.example.test/webhook/avaliacao",
  token: "x".repeat(32),
  dedupeKey: "d".repeat(32),
  googleUrl: "https://g.page/r/exemplo/review"
};

function ambiente() {
  const registros = new Map();
  const chamadas = [];
  const logs = [];
  let enviar = async (_url, options) => ({
    ok: true,
    json: async () => ({ enviado: true, idempotencyKey: JSON.parse(options.body).idempotencyKey })
  });
  let serial = Promise.resolve();
  const referencia = (path) => ({
    id: path.split("/").at(-1),
    path,
    async update(dados) {
      assert.ok(registros.has(path));
      registros.set(path, { ...registros.get(path), ...dados });
    }
  });
  const snapshot = (ref) => ({ ref, exists: registros.has(ref.path), data: () => registros.get(ref.path) });
  const db = {
    collection(nome) {
      return {
        doc(id) { return referencia(`${nome}/${id}`); },
        where(campo, op, valor) {
          assert.equal(campo, "dataISO");
          assert.equal(op, "==");
          return { async get() {
            return {
              docs: [...registros]
                .filter(([path, dados]) => path.startsWith(`${nome}/`) && dados[campo] === valor)
                .map(([path]) => snapshot(referencia(path)))
            };
          } };
        }
      };
    },
    runTransaction(fn) {
      const executar = async () => {
        const escritas = [];
        let escreveu = false;
        const resultado = await fn({
          async get(ref) {
            assert.equal(escreveu, false, "Firestore exige leituras antes de escritas");
            return snapshot(ref);
          },
          set(ref, dados) {
            escreveu = true;
            escritas.push(() => registros.set(ref.path, dados));
          }
        });
        escritas.forEach((escrever) => escrever());
        return resultado;
      };
      const operacao = serial.then(executar);
      serial = operacao.catch(() => {});
      return operacao;
    }
  };
  const servico = criarServicoAvaliacao({
    db,
    Timestamp,
    agora: () => AGORA,
    logger: { error: (...args) => logs.push(args) },
    fetchImpl: async (...args) => { chamadas.push(args); return enviar(...args); }
  });
  const cadastro = {
    dataISO: DATA,
    status: "compareceu",
    statusAtualizadoEm: "2026-09-16T19:58:00.000Z",
    email: "pessoa@example.test",
    nome: "Pessoa de Teste",
    cpf: "nao-compartilhar",
    telefone: "nao-compartilhar"
  };
  registros.set("dados_cidadaos/ag1", cadastro);
  return {
    ...servico,
    chamadas,
    logs,
    registros,
    cadastro,
    pedido: (id = "ag1") => registros.get(`${COLECAO}/${id}`),
    destinatario: (email = cadastro.email) => registros.get(
      `${COLECAO_DESTINATARIOS}/${identificadorDestinatario(email, CONFIG.dedupeKey)}`
    ),
    responder: (fn) => { enviar = fn; }
  };
}

test("processa às 17h todos os comparecimentos do dia com email valido", async () => {
  const a = ambiente();
  a.registros.set("dados_cidadaos/ag2", { ...a.cadastro, email: "segunda@example.test" });
  a.registros.set("dados_cidadaos/outro-dia", { ...a.cadastro, dataISO: "2026-09-15" });
  a.registros.set("dados_cidadaos/sem-email", { ...a.cadastro, email: "" });
  a.registros.set("dados_cidadaos/faltou", { ...a.cadastro, status: "nao_compareceu" });
  await a.processarData(DATA, CONFIG);
  assert.equal(a.chamadas.length, 2);
  assert.equal(a.pedido().estado, "enviado");
  assert.equal(a.pedido("ag2").estado, "enviado");
  assert.equal(a.pedido("outro-dia"), undefined);
  assert.equal(a.pedido("sem-email"), undefined);
});

test("revalida o cadastro dentro da transacao e nao envia registro inelegivel", async () => {
  for (const alteracao of [
    { status: "cancelado" },
    { email: "invalido" },
    { anonimizadoLGPD: true },
    { dataISO: "2026-09-15" }
  ]) {
    const a = ambiente();
    a.registros.set("dados_cidadaos/ag1", { ...a.cadastro, ...alteracao });
    await a.processarCadastro({ id: "ag1", path: "dados_cidadaos/ag1" }, DATA, CONFIG);
    assert.equal(a.chamadas.length, 0);
  }
});

test("concorrencia e repeticao do lote enviam apenas uma vez por agendamento", async () => {
  const a = ambiente();
  const ref = { id: "ag1", path: "dados_cidadaos/ag1" };
  await Promise.all(Array.from({ length: 8 }, () => a.processarCadastro(ref, DATA, CONFIG)));
  await a.processarData(DATA, CONFIG);
  assert.equal(a.chamadas.length, 1);
  assert.equal(a.pedido().estado, "enviado");
  assert.equal(a.destinatario().estado, "enviado");
});

test("dois agendamentos com o mesmo email recebem um unico convite", async () => {
  const a = ambiente();
  a.registros.set("dados_cidadaos/ag2", { ...a.cadastro, nome: "Outro cadastro" });
  await a.processarData(DATA, CONFIG);
  assert.equal(a.chamadas.length, 1);
  assert.deepEqual([a.pedido("ag1").estado, a.pedido("ag2").estado].sort(), ["cancelado", "enviado"]);
  assert.equal(a.destinatario().estado, "enviado");
});

test("trava migrada impede novo agendamento de repetir email historico", async () => {
  const a = ambiente();
  const id = identificadorDestinatario(a.cadastro.email, CONFIG.dedupeKey);
  a.registros.set(`${COLECAO_DESTINATARIOS}/${id}`, { estado: "enviado", pedidoId: "historico" });
  await a.processarData(DATA, CONFIG);
  assert.equal(a.chamadas.length, 0);
  assert.equal(a.pedido().estado, "cancelado");
  assert.equal(a.pedido().motivo, "destinatario_ja_processado");
});

test("fila antiga pendente e cancelada pode ser reconciliada pelo lote diário", async () => {
  for (const estado of ["pendente", "cancelado"]) {
    const a = ambiente();
    a.registros.set(`${COLECAO}/ag1`, { estado, enviarEm: Timestamp.fromMillis(AGORA + 9999999) });
    await a.processarData(DATA, CONFIG);
    assert.equal(a.chamadas.length, 1);
    assert.equal(a.pedido().estado, "enviado");
  }
});

test("payload minimo usa o email atual e registra a data do atendimento", async () => {
  const a = ambiente();
  a.registros.set("dados_cidadaos/ag1", { ...a.cadastro, email: " novo@example.test " });
  await a.processarData(DATA, CONFIG);
  const [url, options] = a.chamadas[0];
  const body = JSON.parse(options.body);
  assert.equal(url, CONFIG.webhookUrl);
  assert.equal(options.headers["X-Avaliacao-Token"], CONFIG.token);
  assert.deepEqual(Object.keys(body).sort(), [
    "avaliacaoUrl", "confirmadoEm", "dataAtendimento", "email", "evento",
    "idempotencyKey", "nome", "versao"
  ]);
  assert.equal(body.dataAtendimento, DATA);
  assert.equal(body.email, "novo@example.test");
  assert.equal(JSON.stringify(a.pedido()).includes("novo@example.test"), false);
  assert.equal(JSON.stringify(a.destinatario("novo@example.test")).includes("novo@example.test"), false);
});

test("falha ambigua exige revisao e nao dispara novamente", async () => {
  const a = ambiente();
  a.responder(async () => { throw new Error("timeout"); });
  await a.processarData(DATA, CONFIG);
  await a.processarData(DATA, CONFIG);
  assert.equal(a.chamadas.length, 1);
  assert.equal(a.pedido().estado, "revisar");
  assert.equal(a.destinatario().estado, "revisar");
  assert.deepEqual(a.logs, [["avaliacao_google_requer_revisao", { pedidoId: "ag1" }]]);
});

test("validadores recusam lista de destinatarios, datas e configuracao insegura", () => {
  assert.equal(emailValido(" pessoa+teste@example.test "), true);
  for (const email of [null, "", "a@b.com\nBcc: x@y.com", "a@b.com;c@d.com", "Pessoa <a@b.com>"]) {
    assert.equal(emailValido(email), false);
  }
  assert.equal(dataISOValida(DATA), true);
  assert.equal(dataISOValida("2026-02-30"), false);
  assert.equal(dataISOValida("2026-99-99"), false);
  assert.equal(dataEmSaoPaulo(Date.parse("2026-09-17T01:30:00Z")), "2026-09-16");
  assert.equal(
    identificadorDestinatario(" Pessoa@Example.Test ", CONFIG.dedupeKey),
    identificadorDestinatario("pessoa@example.test", CONFIG.dedupeKey)
  );
  assert.equal(
    identificadorDestinatario("pessoa@example.test", `${CONFIG.dedupeKey}\r\n`),
    identificadorDestinatario("pessoa@example.test", CONFIG.dedupeKey)
  );
  assert.doesNotMatch(identificadorDestinatario("pessoa@example.test", CONFIG.dedupeKey), /pessoa|example/);
  for (const config of [
    { ...CONFIG, webhookUrl: "http://n8n.example.test" },
    { ...CONFIG, googleUrl: "javascript:alert(1)" },
    { ...CONFIG, token: "curto" },
    { ...CONFIG, dedupeKey: "curta" }
  ]) assert.throws(() => validarConfiguracao(config));
});

function executarNode(nome, entrada, preparado) {
  const codigo = workflow.nodes.find((node) => node.name === nome).parameters.jsCode;
  return vm.runInNewContext(`(function () { ${codigo}\n })()`, {
    Date,
    $input: { first: () => ({ json: entrada }) },
    $: () => ({ first: () => ({ json: preparado }) })
  });
}

test("workflow aceita confirmacao recente no lote das 17h e confirma o SMTP", () => {
  const body = {
    evento: "avaliacao_google",
    versao: 1,
    idempotencyKey: "avaliacao-google-v1:ag1",
    email: "pessoa@example.test",
    nome: "Pessoa",
    confirmadoEm: new Date(Date.now() - 60 * 1000).toISOString(),
    dataAtendimento: DATA,
    avaliacaoUrl: CONFIG.googleUrl
  };
  const preparado = executarNode("Preparar convite", { body })[0].json;
  assert.match(preparado.mensagem, /participação é voluntária/);
  assert.match(preparado.mensagem, /Você fez seu RG/);
  assert.match(preparado.mensagem, /convite único/);
  assert.equal(preparado.assunto, "Como foi fazer seu RG na Câmara de Itanhandu?");
  const recibo = executarNode("Conferir SMTP", { accepted: [body.email.toUpperCase()] }, preparado)[0].json;
  assert.equal(recibo.enviado, true);
  assert.throws(() => executarNode("Conferir SMTP", { accepted: [] }, preparado));
  assert.throws(() => executarNode("Preparar convite", { body: { ...body, confirmadoEm: new Date(Date.now() + 10 * 60 * 1000).toISOString() } }));
});

test("scheduler está configurado para 17h de São Paulo", () => {
  const index = fs.readFileSync(require.resolve("./index"), "utf8");
  assert.match(index, /schedule:\s*"0 17 \* \* \*"/);
  assert.match(index, /timeZone:\s*"America\/Sao_Paulo"/);
  assert.doesNotMatch(index, /exports\.agendarAvaliacaoGoogle/);
});

test("workflow fica autenticado e sem retry automatico de SMTP", () => {
  assert.equal(workflow.active, false);
  const webhook = workflow.nodes.find((node) => node.type === "n8n-nodes-base.webhook");
  assert.equal(webhook.parameters.authentication, "headerAuth");
  assert.equal(webhook.parameters.responseMode, "responseNode");
  assert.equal(workflow.nodes.find((node) => node.type === "n8n-nodes-base.emailSend").retryOnFail, false);
});
