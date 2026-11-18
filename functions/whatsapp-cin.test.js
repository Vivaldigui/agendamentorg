"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  COLECAO_ENVIOS,
  COLECAO_AVALIACAO_DESTINATARIOS,
  LINK_CANCELAR,
  RODAPE,
  PAUSA_MIN_MS,
  PAUSA_MAX_MS,
  LIMITE_DIARIO,
  FALHAS_PARA_DISJUNTOR,
  varianteDaChave,
  agoraEmSaoPaulo,
  dataPorExtenso,
  horaFalada,
  primeiroNome,
  telefoneWhatsApp,
  listaTelefonesTeste,
  montarMensagem,
  eventoDoAgendamento,
  inicioDoLembrete,
  validarConfiguracao,
  criarServicoWhatsappCin
} = require("./whatsapp-cin");

const HOJE = "2026-11-16";
const AG = {
  nome: "MARIA da silva",
  cpf: "123.456.789-09",
  dataNasc: "1960-05-04",
  telefone: "(35) 99876-5432",
  dataISO: "2026-11-20",
  hora: "09:30",
  protocolo: "CIN-ABC123",
  status: "agendado",
  avisoWhatsapp: true
};
const TEL = "5535998765432";
const CONFIG = {
  modo: "ensaio",
  webhookUrl: "https://n8n.example.test/webhook/cin-whatsapp-enviar",
  token: "t".repeat(40),
  telefonesTeste: TEL
};
// 16/11/2026 08:05 em Sao Paulo (UTC-3).
const AS_8H05 = Date.parse("2026-11-16T11:05:00Z");

test("formatos de data, hora, nome e telefone", () => {
  assert.equal(dataPorExtenso("2026-11-20"), "sexta-feira, 20/11");
  assert.equal(horaFalada("09:30"), "9h30");
  assert.equal(horaFalada("14:00"), "14h");
  assert.equal(primeiroNome("MARIA da silva"), "Maria");
  assert.equal(telefoneWhatsApp("(35) 99876-5432"), TEL);
  assert.equal(telefoneWhatsApp("5535998765432"), TEL);
  assert.equal(telefoneWhatsApp("(35) 9876-5432"), TEL, "celular antigo ganha o nono digito");
  assert.equal(telefoneWhatsApp("(35) 3504-0397"), "", "fixo nao tem WhatsApp para avisar");
  assert.equal(telefoneWhatsApp("123"), "");
  assert.deepEqual([...listaTelefonesTeste("35998765432, 5511987654321")], [TEL, "5511987654321"]);
  assert.deepEqual(agoraEmSaoPaulo(AS_8H05), { dataISO: HOJE, hora: 8, minuto: 8 * 60 + 5 });
  assert.deepEqual(agoraEmSaoPaulo(Date.parse("2026-11-17T01:30:00Z")), { dataISO: HOJE, hora: 22, minuto: 22 * 60 + 30 });
});

test("mensagens curtas: nome, data, nada de CPF nem nascimento", () => {
  for (const tipo of ["confirmacao", "lembrete", "cancelado_camara", "cancelado_cidadao", "rg_pronto", "avaliacao"]) {
    for (let v = 0; v < 3; v += 1) {
      const texto = montarMensagem(tipo, AG, { variante: v });
      assert.match(texto, /Maria/, tipo);
      assert.ok(texto.split("\n").length <= 11, `${tipo} longo demais`);
      assert.ok((texto.match(/https?:\/\//g) || []).length <= 1, `${tipo} com mais de um link`);
      assert.doesNotMatch(texto, /‼️|⚠️/, tipo);
      assert.doesNotMatch(texto, /123\.456|12345678909|1960|04\/05/, `${tipo} vazou dado pessoal`);
    }
  }
  for (const tipo of ["confirmacao", "cancelado_camara", "cancelado_cidadao"]) {
    assert.match(montarMensagem(tipo, AG), /sexta, 20\/11, às 9h30/, tipo);
  }
  const confirmacao = montarMensagem("confirmacao", AG);
  assert.match(confirmacao, /^✅ \*Maria, seu RG está agendado: sexta, 20\/11, às 9h30\*/);
  assert.match(confirmacao, /Código: CIN-ABC123/);
  assert.match(confirmacao, /\*Certidão original\* ou autenticada \(nascimento ou casamento\)/);
  assert.match(confirmacao, /Número do CPF/);
  assert.match(confirmacao, /Comprovante de endereço/);
  assert.match(confirmacao, /Responda \*MENU\*/);
  assert.ok(confirmacao.includes(LINK_CANCELAR));
  assert.ok(confirmacao.endsWith(RODAPE), "SAIR na confirmacao");
  const lembrete = montarMensagem("lembrete", AG);
  assert.match(lembrete, /^⏰ \*Maria, seu RG é hoje, às 9h30\*/);
  assert.match(lembrete, /Sem a certidão original \(ou autenticada\), não dá para fazer/);
  assert.ok(lembrete.includes(LINK_CANCELAR));
  for (const tipo of ["lembrete", "cancelado_camara", "cancelado_cidadao", "avaliacao"]) {
    assert.ok(!montarMensagem(tipo, AG).includes("SAIR"), `${tipo} sem rodape SAIR`);
  }
  assert.match(montarMensagem("confirmacao", { ...AG, nome: "" }), /^✅ \*Seu RG está agendado:/);
  assert.match(montarMensagem("cancelado_camara", AG), /\(35\) 3504-0397/);
  assert.throws(() => montarMensagem("remarcado", AG), "remarcacao nao gera aviso");
});

test("evento: criacao e cancelamentos; remarcacao nao avisa", () => {
  assert.equal(eventoDoAgendamento(null, AG, HOJE), "confirmacao");
  assert.equal(eventoDoAgendamento(null, { ...AG, avisoWhatsapp: false }, HOJE), null, "sem aceite");
  assert.equal(eventoDoAgendamento(null, { ...AG, dataISO: "2026-11-10" }, HOJE), null, "data passada");
  assert.equal(eventoDoAgendamento(AG, { ...AG, status: "cancelado", ativo: false }, HOJE), "cancelado_camara");
  assert.equal(eventoDoAgendamento(AG, { ...AG, status: "cancelado_cidadao", ativo: false }, HOJE), "cancelado_cidadao");
  assert.equal(eventoDoAgendamento(AG, { ...AG, status: "remarcado", ativo: true, dataISO: "2026-11-23" }, HOJE), null);
  assert.equal(eventoDoAgendamento(AG, { ...AG, observacaoAdmin: "x" }, HOJE), null, "outra alteracao");
  assert.equal(eventoDoAgendamento(AG, { ...AG, status: "compareceu" }, HOJE), null);
  assert.equal(eventoDoAgendamento(AG, null, HOJE), null, "documento apagado");
  const { telefone, ...anonimizado } = AG;
  assert.equal(eventoDoAgendamento(AG, anonimizado, HOJE), null, "anonimizacao nao avisa");
});

test("configuracao: modo e segredos", () => {
  assert.deepEqual(validarConfiguracao({ modo: "desligado" }), { modo: "desligado" });
  assert.throws(() => validarConfiguracao({ modo: "ligado" }));
  assert.throws(() => validarConfiguracao({ ...CONFIG, token: "curto" }));
  assert.throws(() => validarConfiguracao({ ...CONFIG, webhookUrl: "http://n8n" }));
  assert.throws(() => validarConfiguracao({ ...CONFIG, telefonesTeste: "" }), /ensaio/);
  assert.equal(validarConfiguracao({ ...CONFIG, modo: "ativo", telefonesTeste: "" }).modo, "ativo");
});

function ambiente({ resposta = { ok: true, status: 200, corpo: { enviado: true, mensagemId: "wamid.1" } }, agora = AS_8H05 } = {}) {
  const registros = new Map();
  const chamadas = [];
  const pausas = [];
  let relogio = agora;
  const referencia = (path) => ({
    id: path.split("/").at(-1),
    path,
    async update(dados) { registros.set(path, { ...registros.get(path), ...dados }); }
  });
  const snapshot = (ref) => ({ exists: registros.has(ref.path), data: () => registros.get(ref.path) });
  let serial = Promise.resolve();
  const db = {
    collection(nome) {
      const filtros = [];
      const consulta = {
        where(campo, op, valor) { assert.equal(op, "=="); filtros.push([campo, valor]); return consulta; },
        limit() { return consulta; },
        async get() {
          return {
            docs: [...registros]
              .filter(([path, dados]) => path.startsWith(`${nome}/`) && path.split("/").length === 2 && filtros.every(([c, v]) => dados[c] === v))
              .map(([path, dados]) => ({ id: path.split("/").at(-1), ref: referencia(path), data: () => dados }))
          };
        },
        doc(id) { return referencia(`${nome}/${id}`); }
      };
      return consulta;
    },
    runTransaction(fn) {
      const executar = async () => {
        const escritas = [];
        const r = await fn({
          async get(ref) { assert.equal(escritas.length, 0, "leituras antes das escritas"); return snapshot(ref); },
          set(ref, dados) { escritas.push(() => registros.set(ref.path, dados)); },
          update(ref, dados) { escritas.push(() => registros.set(ref.path, { ...registros.get(ref.path), ...dados })); }
        });
        escritas.forEach((e) => e());
        return r;
      };
      serial = serial.then(executar, executar);
      return serial;
    }
  };
  const FieldValue = { serverTimestamp: () => "agora" };
  const fetchImpl = async (url, options) => {
    chamadas.push({ url, options, corpo: JSON.parse(options.body) });
    relogio += 2000;
    if (resposta instanceof Error) throw resposta;
    return { ok: resposta.ok, status: resposta.status, json: async () => resposta.corpo };
  };
  const servico = criarServicoWhatsappCin({
    db,
    FieldValue,
    fetchImpl,
    logger: { warn() {}, error() {} },
    agora: () => relogio,
    esperar: async (ms) => { pausas.push(ms); relogio += ms; },
    sortear: () => 0.5
  });
  return { registros, chamadas, pausas, servico, avancar: (ms) => { relogio += ms; } };
}

function agendar(registros, id, dados) {
  registros.set(`dados_cidadaos/${id}`, { ...AG, ...dados });
  return registros.get(`dados_cidadaos/${id}`);
}

test("fila: o gatilho so enfileira, sem telefone nem texto, e nao repete", async () => {
  const { registros, chamadas, servico } = ambiente();
  const dados = agendar(registros, "ag1", {});
  const r = await servico.enfileirar("confirmacao", "ag1", dados, CONFIG);
  assert.equal(r.status, "na_fila");
  assert.equal(chamadas.length, 0, "nada sai na hora");
  const envio = registros.get(`${COLECAO_ENVIOS}/confirmacao_ag1_2026-11-20_0930`);
  assert.equal(envio.status, "pendente");
  assert.doesNotMatch(JSON.stringify(envio), /9876|Maria|CIN-ABC/, "fila sem telefone, nome ou texto");
  assert.equal((await servico.enfileirar("confirmacao", "ag1", dados, CONFIG)).status, "repetido");
});

test("fila: filtros de modo, aceite, celular e ensaio", async () => {
  const { servico } = ambiente();
  assert.equal((await servico.enfileirar("confirmacao", "a", AG, { modo: "desligado" })).status, "desligado");
  assert.equal((await servico.enfileirar("confirmacao", "a", { ...AG, avisoWhatsapp: false }, CONFIG)).status, "sem_aceite");
  assert.equal((await servico.enfileirar("confirmacao", "a", { ...AG, telefone: "(35) 3504-0397" }, CONFIG)).status, "sem_celular");
  assert.equal((await servico.enfileirar("confirmacao", "a", { ...AG, telefone: "(11) 98888-7777" }, CONFIG)).status, "fora_do_ensaio");
  assert.equal((await servico.enfileirar("confirmacao", "a", { ...AG, telefone: "(11) 98888-7777" }, { ...CONFIG, modo: "ativo" })).status, "na_fila");
});

test("rodada: 25 confirmacoes da abertura saem aos poucos, na ordem, sem estourar o tempo", async () => {
  const { registros, chamadas, pausas, servico } = ambiente();
  const config = { ...CONFIG, modo: "ativo" };
  for (let i = 0; i < 25; i += 1) {
    const id = `ag${String(i).padStart(2, "0")}`;
    await servico.enfileirar("confirmacao", id, agendar(registros, id, {}), config);
  }
  const primeira = await servico.processarFila(config);
  assert.ok(primeira.enviados >= 3 && primeira.enviados <= 5, `rodada mandou ${primeira.enviados}`);
  assert.equal(primeira.restantes, 25 - primeira.enviados);
  assert.ok(pausas.every((ms) => ms >= PAUSA_MIN_MS && ms <= PAUSA_MAX_MS), "pausa entre mensagens");
  assert.equal(pausas.length, primeira.enviados - 1, "sem pausa antes da primeira");
  assert.deepEqual(chamadas.map((c) => c.corpo.chave.split("_")[1]), [...Array(primeira.enviados).keys()].map((i) => `ag${String(i).padStart(2, "0")}`));
  assert.equal(chamadas[0].options.headers["X-Cin-Token"], CONFIG.token);
  assert.equal(chamadas[0].corpo.telefone, TEL);
  assert.match(chamadas[0].corpo.texto, /confirma/i);

  // Rodadas a cada 5 min (8h05, 8h10...): com 45 a 90 s entre mensagens, as 25
  // confirmacoes acabam em ate 8 rodadas (~8h40).
  let total = primeira.enviados;
  let rodadas = 1;
  while (total < 25 && rodadas < 8) {
    total += (await servico.processarFila(config)).enviados;
    rodadas += 1;
  }
  assert.equal(total, 25, `${rodadas} rodadas terminam a fila`);
  assert.equal(chamadas.length, 25, "ninguem recebe duas vezes");
  assert.equal(registros.get(`whatsapp_controle/dia_${HOJE}`).enviados, 25, "contagem do dia");
  const textos = new Set(chamadas.map((c) => c.corpo.texto.replace(/ag\d+|CIN-ABC123/g, "")));
  assert.ok(textos.size >= 3, `textos variam (${textos.size} versoes)`);
  for (const c of chamadas) {
    assert.equal((c.corpo.texto.match(/https?:\/\//g) || []).length, 1, "um link so (o de cancelar)");
  }
});

test("rodada: confirmacao de quem ja cancelou e descartada; o cancelamento sai", async () => {
  const { registros, chamadas, servico } = ambiente();
  const dados = agendar(registros, "ag1", {});
  await servico.enfileirar("confirmacao", "ag1", dados, CONFIG);
  const cancelado = agendar(registros, "ag1", { status: "cancelado_cidadao", ativo: false });
  await servico.enfileirar("cancelado_cidadao", "ag1", cancelado, CONFIG);
  const r = await servico.processarFila(CONFIG);
  assert.equal(r.descartados, 1);
  assert.equal(r.enviados, 1);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].corpo.texto, /foi \*cancelado\*\./);
});

test("rodada: fora do horario nao envia nada", async () => {
  const noite = ambiente({ agora: Date.parse("2026-11-17T01:30:00Z") });
  await noite.servico.enfileirar("confirmacao", "ag1", agendar(noite.registros, "ag1", {}), CONFIG);
  const r = await noite.servico.processarFila(CONFIG);
  assert.equal(r.enviados, 0);
  assert.equal(noite.chamadas.length, 0);
});

test("lembrete: sai no dia, 6 h antes; atendimento cedo recebe as 7h", () => {
  assert.equal(inicioDoLembrete("14:30"), 8 * 60 + 30);
  assert.equal(inicioDoLembrete("16:35"), 10 * 60 + 35);
  assert.equal(inicioDoLembrete("09:00"), 7 * 60, "nunca antes das 7h");
  assert.equal(inicioDoLembrete("x"), null);
});

test("rodada: lembretes de hoje entram 6 h antes e so de agendamento valendo", async () => {
  // 16/11 08:30 em Sao Paulo.
  const { registros, chamadas, servico } = ambiente({ agora: Date.parse("2026-11-16T11:30:00Z") });
  agendar(registros, "a", { dataISO: HOJE, hora: "14:30" });
  agendar(registros, "b", { dataISO: HOJE, hora: "15:00", status: "remarcado", ativo: true });
  agendar(registros, "c", { dataISO: HOJE, hora: "14:30", status: "cancelado", ativo: false });
  agendar(registros, "d", { dataISO: HOJE, hora: "14:30", avisoWhatsapp: false });
  agendar(registros, "e", { dataISO: "2026-11-17", hora: "14:30" });
  agendar(registros, "f", { dataISO: HOJE, hora: "09:00" });
  const r = await servico.processarFila(CONFIG);
  assert.deepEqual(r.lembretes, { total: 2, na_fila: 2 }, "a (14h30) e f (9h, desde as 7h); b so as 9h");
  assert.equal(r.enviados, 2);
  assert.ok(chamadas.every((c) => c.corpo.tipo === "lembrete"));
  assert.match(chamadas[0].corpo.texto, /RG é hoje|hoje é o seu RG|RG é hoje/);
  assert.match(chamadas[0].corpo.texto, /Sem a certidão original/);
  const deNovo = await servico.processarFila(CONFIG);
  assert.deepEqual(deNovo.lembretes, { total: 2, na_fila: 0 }, "a rodada seguinte nao repete");
  assert.equal(chamadas.length, 2);
});

test("rodada: lembrete nao sai depois do horario do atendimento", async () => {
  // 16/11 09:05 em Sao Paulo: o lembrete das 9h ficou na fila e o horario passou.
  const a = ambiente({ agora: Date.parse("2026-11-16T12:05:00Z") });
  const dados = agendar(a.registros, "f", { dataISO: HOJE, hora: "09:00" });
  await a.servico.enfileirar("lembrete", "f", dados, CONFIG);
  const r = await a.servico.processarFila(CONFIG);
  assert.equal(r.descartados, 1);
  assert.equal(a.chamadas.length, 0);
  assert.deepEqual(r.lembretes, { total: 0, na_fila: 0 });
});

test("rodada: recusa do n8n, erro e falha ambigua", async () => {
  const casos = [
    [{ ok: true, status: 200, corpo: { enviado: false, motivo: "sem_whatsapp" } }, "sem_whatsapp"],
    [{ ok: false, status: 401, corpo: {} }, "erro"],
    [{ ok: false, status: 502, corpo: {} }, "revisar"],
    [new Error("timeout"), "revisar"]
  ];
  for (const [resposta, esperado] of casos) {
    const a = ambiente({ resposta });
    const { chave } = await a.servico.enfileirar("confirmacao", "ag1", agendar(a.registros, "ag1", {}), CONFIG);
    const r = await a.servico.processarFila(CONFIG);
    assert.equal(r.outros[esperado], 1, esperado);
    assert.equal(a.registros.get(`${COLECAO_ENVIOS}/${chave}`).status, esperado);
    await a.servico.processarFila(CONFIG);
    assert.equal(a.chamadas.length, 1, `${esperado}: nao reenvia sozinho`);
  }
});

test("formulario e backend: aceite do WhatsApp vem da declaracao obrigatoria e e gravado no agendamento", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const site = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  assert.doesNotMatch(site, /id="aceite-whatsapp"/, "sem caixa propria desde 15/11/2026");
  assert.match(site, /<input type="checkbox" id="aceite-lgpd" onchange="limparErroAceite\('aceite-lgpd'\)">/, "declaracao comeca desmarcada");
  assert.match(site, /aceiteWhatsapp: \(document\.getElementById\("aceite-lgpd"\) \|\| \{\}\)\.checked === true/);
  assert.match(site, /const pendentes = \["aceite-lgpd"\]\.filter\(id => \{/);
  assert.match(site, /var WHATSAPP_AVISOS_PARA_TODOS = (true|false);/, "chave do aviso na tela de sucesso");
  const criar = backend.slice(backend.indexOf("exports.criarAgendamentoCidadao"), backend.indexOf("exports.prepararCancelamentoCidadao"));
  assert.match(criar, /const consentimentoWhatsapp = dadosRequisicao\.aceiteWhatsapp === true;/);
  assert.match(criar, /\.\.\.\(consentimentoWhatsapp \? \{ avisoWhatsapp: true, avisoWhatsappEm: criado \} : \{\}\)/);
  const regras = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  assert.match(regras, /match \/whatsapp_envios\/\{documentId\} \{\s*allow read, write: if false;/);
});

test("avaliacao: texto curto com o link e sem dado pessoal", () => {
  const texto = montarMensagem("avaliacao", AG, { googleUrl: "https://g.page/r/exemplo/review" });
  assert.match(texto, /^Maria, como foi o seu atendimento do RG\?/);
  assert.match(texto, /https:\/\/g\.page\/r\/exemplo\/review/);
  assert.doesNotMatch(texto, /123\.456|1960|CIN-ABC/);
  assert.match(montarMensagem("avaliacao", AG), /g\.page\/r\/CfugOJBgujYPEBM\/review/, "link padrao");
});

test("rodada: convite de avaliacao as 17h para todos que compareceram, um por celular", async () => {
  // 16/11 17:10 em Sao Paulo.
  const config = { ...CONFIG, modo: "ativo", googleUrl: "https://g.page/r/exemplo/review" };
  const { registros, chamadas, servico } = ambiente({ agora: Date.parse("2026-11-16T20:10:00Z") });
  agendar(registros, "a", { dataISO: HOJE, status: "compareceu" });
  agendar(registros, "b", { dataISO: HOJE, status: "compareceu", telefone: "(11) 97777-6666", consentimentoAvaliacao: true, email: "b@exemplo.test" });
  agendar(registros, "c", { dataISO: HOJE, status: "agendado", telefone: "(11) 96666-5555" });
  agendar(registros, "d", { dataISO: HOJE, status: "compareceu" }); // mesmo celular de "a" (familia)
  agendar(registros, "f", { dataISO: HOJE, status: "compareceu", telefone: "(11) 98888-7777" });
  agendar(registros, "g", { dataISO: HOJE, status: "nao_compareceu", telefone: "(11) 95555-4444" });
  const r = await servico.processarFila(config);
  assert.deepEqual(r.avaliacoes, { total: 4, na_fila: 3 }, "a, b e f; d e o mesmo celular de a; b vai pelo WhatsApp mesmo com e-mail");
  assert.equal(r.enviados, 3);
  assert.equal(registros.get(`${COLECAO_ENVIOS}/avaliacao_d_${HOJE}_0930`).status, "ja_convidado", "registrado para o e-mail nao repetir");
  assert.ok(chamadas.every((c) => c.corpo.tipo === "avaliacao"));
  assert.match(chamadas[0].corpo.texto, /g\.page\/r\/exemplo\/review/);
  const destinatarios = [...registros.keys()].filter((k) => k.startsWith(`${COLECAO_AVALIACAO_DESTINATARIOS}/`));
  assert.equal(destinatarios.length, 3);
  assert.ok(destinatarios.every((k) => !k.includes("98765") && !k.includes("98888")), "sem o numero em claro");
  const deNovo = await servico.processarFila(config);
  assert.deepEqual(deNovo.avaliacoes, { total: 4, na_fila: 0 });
  assert.equal(chamadas.length, 3);
});

test("rodada: antes das 17h nao entra convite de avaliacao", async () => {
  const a = ambiente({ agora: Date.parse("2026-11-16T19:55:00Z") });
  agendar(a.registros, "a", { dataISO: HOJE, status: "compareceu" });
  const r = await a.servico.processarFila(CONFIG);
  assert.equal(r.avaliacoes, null);
  assert.equal(a.chamadas.length, 0);
});

test("limpeza: apaga so os envios com atendimento antes do corte, em lotes", async () => {
  const { limparEnviosAntigos } = require("./whatsapp-cin");
  const registros = new Map();
  for (let i = 0; i < 7; i += 1) registros.set(`whatsapp_envios/velho${i}`, { dataISO: "2026-04-10", status: "enviado" });
  registros.set("whatsapp_envios/novo", { dataISO: "2026-06-01", status: "enviado" });
  registros.set("whatsapp_avaliacao_destinatarios/x", { agendamentoId: "a" });
  let lotes = 0;
  const db = {
    collection(nome) {
      let filtro = null;
      let limite = Infinity;
      const consulta = {
        where(campo, op, valor) { assert.equal(campo, "dataISO"); assert.equal(op, "<"); filtro = valor; return consulta; },
        limit(n) { limite = n; return consulta; },
        async get() {
          const docs = [...registros]
            .filter(([path, d]) => path.startsWith(`${nome}/`) && d.dataISO < filtro)
            .slice(0, limite)
            .map(([path]) => ({ ref: { path } }));
          return { empty: docs.length === 0, docs };
        }
      };
      return consulta;
    },
    batch() {
      const apagar = [];
      return { delete(ref) { apagar.push(ref.path); }, async commit() { lotes += 1; apagar.forEach((p) => registros.delete(p)); } };
    }
  };
  const apagados = await limparEnviosAntigos(db, "2026-05-15", { pagina: 3 });
  assert.equal(apagados, 7);
  assert.equal(lotes, 3);
  assert.ok(registros.has("whatsapp_envios/novo"));
  assert.ok(registros.has("whatsapp_avaliacao_destinatarios/x"), "o convite unico por celular fica");
  assert.equal(await limparEnviosAntigos(db, "2026-05-15", { pagina: 3, maximo: 2 }), 0);
  await assert.rejects(() => limparEnviosAntigos(db, "ontem"));
});

test("manutencao diaria chama a limpeza da fila com o prazo da LGPD", () => {
  const index = require("node:fs").readFileSync(require.resolve("./index"), "utf8");
  const manutencao = index.slice(index.indexOf("exports.executarManutencaoDiaria"), index.indexOf("async function limparFilaWhatsappAntiga"));
  assert.match(manutencao, /await limparFilaWhatsappAntiga\(\);/);
  assert.match(index, /subtrairMesesISO\(hojeSaoPauloISO\(\), LGPD_RETENCAO_MESES\);\s*let apagados = 0;\s*try \{\s*apagados = await limparEnviosAntigos\(db, corte\);/);
});

test("rodada: teto de mensagens por dia deixa o resto na fila", async () => {
  const { registros, chamadas, servico } = ambiente();
  const config = { ...CONFIG, modo: "ativo" };
  registros.set(`whatsapp_controle/dia_${HOJE}`, { enviados: LIMITE_DIARIO - 1 });
  for (const id of ["a1", "a2", "a3"]) await servico.enfileirar("confirmacao", id, agendar(registros, id, {}), config);
  const r = await servico.processarFila(config);
  assert.equal(r.enviados, 1);
  assert.equal(r.limiteDiario, true);
  assert.equal(r.restantes, 2);
  assert.equal(chamadas.length, 1);
  assert.equal(registros.get(`whatsapp_controle/dia_${HOJE}`).enviados, LIMITE_DIARIO);
});

test("rodada: disjuntor para depois de falhas seguidas e segura as rodadas seguintes", async () => {
  const a = ambiente({ resposta: { ok: false, status: 502, corpo: {} } });
  const config = { ...CONFIG, modo: "ativo" };
  for (const id of ["b1", "b2", "b3", "b4", "b5"]) await a.servico.enfileirar("confirmacao", id, agendar(a.registros, id, {}), config);
  const r = await a.servico.processarFila(config);
  assert.equal(r.disjuntor, true);
  assert.equal(a.chamadas.length, FALHAS_PARA_DISJUNTOR, "para na terceira falha");
  assert.equal(a.registros.get("whatsapp_controle/disjuntor").ativo, true);
  const depois = await a.servico.processarFila(config);
  assert.equal(depois.disjuntor, true);
  assert.equal(a.chamadas.length, FALHAS_PARA_DISJUNTOR, "nada sai com o disjuntor ligado");
  assert.equal(a.registros.get("whatsapp_envios/confirmacao_b4_2026-11-20_0930").status, "pendente", "o resto espera na fila");
});

test("rodada: numero sem WhatsApp ou que saiu nao arma o disjuntor", async () => {
  const a = ambiente({ resposta: { ok: true, status: 200, corpo: { enviado: false, motivo: "sem_whatsapp" } } });
  const config = { ...CONFIG, modo: "ativo" };
  for (const id of ["c1", "c2", "c3", "c4"]) await a.servico.enfileirar("confirmacao", id, agendar(a.registros, id, {}), config);
  const r = await a.servico.processarFila(config);
  assert.notEqual(r.disjuntor, true);
  assert.equal(a.registros.has("whatsapp_controle/disjuntor"), false);
});

test("variacoes: a variante 0 e o texto de referencia e as outras mudam a primeira linha", () => {
  assert.equal(montarMensagem("confirmacao", AG), montarMensagem("confirmacao", AG, { variante: 0 }));
  assert.match(montarMensagem("confirmacao", AG, { variante: 1 }), /Maria, seu RG foi agendado/);
  assert.match(montarMensagem("confirmacao", AG, { variante: 2 }), /Maria, agendamento do RG confirmado/);
  assert.match(montarMensagem("lembrete", AG, { variante: 1 }), /Maria, hoje é o seu RG, às 9h30/);
  for (let v = 0; v < 27; v += 1) {
    for (const tipo of ["confirmacao", "lembrete"]) {
      const t = montarMensagem(tipo, AG, { variante: v });
      assert.match(t, /9h30/);
      assert.equal((t.match(/https?:\/\//g) || []).length, 1);
    }
    assert.match(montarMensagem("confirmacao", AG, { variante: v }), /sexta, 20\/11, às 9h30\*\n.*\nCódigo: CIN-ABC123/);
  }
  assert.equal(varianteDaChave("x"), varianteDaChave("x"), "mesma chave, mesmo texto");
});

test("rg pronto: evento, mensagem, envio sem aceite e descarte ao desfazer", async () => {
  const atendido = { ...AG, dataISO: "2026-10-01", status: "compareceu", avisoWhatsapp: undefined };
  const marcado = { ...atendido, rgPronto: true, rgProntoEm: "2026-11-16T13:05:00.000Z" };
  assert.equal(eventoDoAgendamento(atendido, marcado, HOJE), "rg_pronto", "atendimento passado e sem aceite");
  assert.equal(eventoDoAgendamento(marcado, { ...marcado, observacaoAdmin: "x" }, HOJE), null, "so na marcacao");
  assert.equal(eventoDoAgendamento(atendido, { ...marcado, status: "vai_voltar" }, HOJE), null);
  const { telefone, ...semTelefone } = marcado;
  assert.equal(eventoDoAgendamento(atendido, semTelefone, HOJE), null);

  for (let v = 0; v < 9; v += 1) {
    const texto = montarMensagem("rg_pronto", marcado, { variante: v });
    assert.match(texto, /8h às 12h\* e \*14h às 17h/);
    assert.match(texto, /Rua Eng\. Paulo Franco da Rosa, 298/);
    assert.match(texto, /Maria/);
    assert.ok(texto.endsWith(RODAPE));
    assert.doesNotMatch(texto, /https?:\/\//, "sem link");
    assert.doesNotMatch(texto, /123\.456|1960/);
  }

  const { registros, chamadas, servico } = ambiente();
  const config = { ...CONFIG, modo: "ativo" };
  registros.set("dados_cidadaos/r1", marcado);
  const fila = await servico.enfileirar("rg_pronto", "r1", marcado, config);
  assert.equal(fila.status, "na_fila", "vai mesmo sem o aceite do WhatsApp");
  assert.match(fila.chave, /^rg_pronto_r1_20261116130500/);
  const r = await servico.processarFila(config);
  assert.equal(r.enviados, 1);
  assert.match(chamadas[0].corpo.texto, /pronta|chegou|pronto/i);

  // Marcou, desfez antes da rodada: descartado. Marcou de novo: outro aviso.
  const b = ambiente();
  b.registros.set("dados_cidadaos/r2", marcado);
  await b.servico.enfileirar("rg_pronto", "r2", marcado, config);
  b.registros.set("dados_cidadaos/r2", { ...marcado, rgPronto: false });
  const r2 = await b.servico.processarFila(config);
  assert.equal(r2.descartados, 1);
  assert.equal(b.chamadas.length, 0);
  const remarcado = { ...marcado, rgProntoEm: "2026-11-16T14:00:00.000Z" };
  b.registros.set("dados_cidadaos/r2", remarcado);
  assert.equal((await b.servico.enfileirar("rg_pronto", "r2", remarcado, config)).status, "na_fila");
});

test("rg pronto: backend so marca quem compareceu e registra no historico", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  const trecho = backend.slice(backend.indexOf("exports.marcarRgProntoAdmin"), backend.indexOf("exports.alterarStatusAdmin"));
  assert.match(trecho, /const adminEmail = await assertAdmin\(request\);/);
  assert.match(trecho, /dados\.status !== "compareceu"/);
  assert.match(trecho, /acao: desfazer \? "rg_pronto_desfeito" : "rg_pronto"/);
});

test("painel: aba RG pronto acha pelo nome e chama a callable", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const js = fs.readFileSync(path.join(__dirname, "..", "public", "recepcao.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "recepcao.html"), "utf8");
  assert.match(html, /id="btn-vista-retirada"[^>]*data-vista="retirada"/);
  assert.match(html, /<section id="vista-retirada"/);
  assert.match(html, /data-input="buscarRgPronto"/);
  assert.match(js, /functions\.httpsCallable\("marcarRgProntoAdmin"\)/);
  assert.match(js, /marcarRgPronto: el => alterarRgPronto\(el\.dataset\.id, false\)/);
  const trecho = (nome) => {
    const i = js.indexOf(`function ${nome}(`);
    let fim = js.indexOf("\nfunction ", i + 10);
    return js.slice(i, fim);
  };
  const ctx = {};
  vm.runInNewContext(trecho("normalizarNomeBusca") + "\n" + trecho("filtrarCandidatosRg") + "\nthis.f = filtrarCandidatosRg;", ctx);
  const c = [
    { id: "1", dados: { nome: "José da Silva Araújo", dataISO: "2026-10-01" } },
    { id: "2", dados: { nome: "Maria José Silva", dataISO: "2026-10-05" } },
    { id: "3", dados: { nome: "Jose Silva Araujo", dataISO: "2026-09-01" } }
  ];
  assert.deepEqual(Array.from(ctx.f(c, "JOSE DA SILVA ARAUJO"), x => x.id), ["1", "3"], "sem acento e sem caixa; identico primeiro");
  assert.deepEqual(Array.from(ctx.f(c, "silva maria"), x => x.id), ["2"], "qualquer ordem");
  assert.deepEqual(Array.from(ctx.f(c, "silva"), x => x.id), [], "precisa de duas partes do nome");
});
