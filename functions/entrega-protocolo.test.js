"use strict";

// Entrega do protocolo.
//
// Com a precedencia do protocolo, ele virou a UNICA credencial de consulta e
// cancelamento para todo agendamento novo. E o sistema nao envia nada: nao ha
// e-mail nem SMS neste projeto. Ate 24/08/2026 o campo de telefone dizia
// "(para receber o comprovante)" -- promessa falsa. Quem fechasse a aba
// confiando nela perdia o acesso ao proprio agendamento, inclusive para
// cancelar e devolver a vaga.
//
// Estes testes EXECUTAM as funcoes com um DOM minimo. Auditoria de 24/08
// demonstrou que oito defeitos injetados passavam por travas que so liam o
// texto do codigo; aqui o criterio e comportamento.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

function extrairFuncao(codigo, nome) {
  let inicio = codigo.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  if (codigo.slice(inicio - 6, inicio) === "async ") inicio -= 6;
  const abre = codigo.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(inicio, i + 1);
    }
  }
  throw new Error(`Fim de ${nome} nao encontrado.`);
}

function memoriaLocal() {
  const dados = {};
  return {
    setItem: (k, v) => { dados[k] = String(v); },
    getItem: (k) => (k in dados ? dados[k] : null),
    _dados: dados
  };
}

function montarPersistencia(localStorage) {
  const corpo = ["guardarAgendamentoLocalmente", "lerAgendamentoLocal"]
    .map((n) => extrairFuncao(sitePublico, n)).join("\n");
  const chave = (sitePublico.match(/const CHAVE_ULTIMO_AGENDAMENTO = "([^"]+)"/) || [])[1];
  assert.ok(chave, "CHAVE_ULTIMO_AGENDAMENTO nao encontrada.");
  return new Function("localStorage", "CHAVE_ULTIMO_AGENDAMENTO",
    `${corpo}; return { guardar: guardarAgendamentoLocalmente, ler: lerAgendamentoLocal };`
  )(localStorage, chave);
}

test("o site nao promete mais entrega automatica do comprovante", () => {
  // Nao existe envio no backend; a legenda antiga levava a pessoa a fechar a
  // aba achando que receberia o codigo.
  assert.doesNotMatch(sitePublico, /para receber o comprovante/i);
  assert.match(sitePublico, /Nada é enviado automaticamente/,
    "A tela de sucesso precisa dizer explicitamente que nada e enviado.");
});

test("o protocolo sobrevive ao fechamento da aba", () => {
  const ls = memoriaLocal();
  const api = montarPersistencia(ls);
  api.guardar({ protocolo: "CIN-ABC12345", dataBR: "25/08/2026", hora: "14:30", nome: "Fulano" });
  const lido = api.ler();
  assert.equal(lido.protocolo, "CIN-ABC12345");
  assert.equal(lido.dataBR, "25/08/2026");
  assert.equal(lido.hora, "14:30");
});

test("agendamento sem protocolo nao e guardado", () => {
  const ls = memoriaLocal();
  const api = montarPersistencia(ls);
  api.guardar({ dataBR: "25/08/2026", hora: "14:30" });
  api.guardar(null);
  assert.equal(api.ler(), null);
});

test("armazenamento indisponivel nao derruba o agendamento", () => {
  // Modo privativo, cota cheia ou cookies bloqueados. Perder o cache local e
  // aceitavel; quebrar a confirmacao de uma vaga conquistada, nao.
  const quebrado = {
    setItem: () => { throw new Error("QuotaExceededError"); },
    getItem: () => { throw new Error("SecurityError"); }
  };
  const api = montarPersistencia(quebrado);
  assert.doesNotThrow(() => api.guardar({ protocolo: "CIN-ABC12345" }));
  assert.equal(api.ler(), null);
});

test("dado corrompido no armazenamento nao quebra a leitura", () => {
  const ls = memoriaLocal();
  const chave = (sitePublico.match(/const CHAVE_ULTIMO_AGENDAMENTO = "([^"]+)"/) || [])[1];
  ls.setItem(chave, "{isto nao e json");
  assert.equal(montarPersistencia(ls).ler(), null);
});

test("a tela de sucesso mostra o codigo e pede reconhecimento", () => {
  const bloco = { style: {}, };
  const valor = { textContent: "" };
  const aceite = { checked: true };
  const fn = new Function("document",
    `${extrairFuncao(sitePublico, "mostrarProtocoloConfirmado")}; return mostrarProtocoloConfirmado;`
  )({ getElementById: (id) => ({
      "ticket-protocolo": bloco, "ticket-protocolo-valor": valor, "aceite-protocolo": aceite
    }[id] || null) });

  fn("CIN-ABC12345");
  assert.equal(valor.textContent, "CIN-ABC12345");
  assert.equal(bloco.style.display, "block");
  assert.equal(aceite.checked, false, "O reconhecimento tem de comecar desmarcado a cada agendamento.");

  // Agendamento legado, sem protocolo: o bloco inteiro fica oculto.
  fn("");
  assert.equal(bloco.style.display, "none");
});

test("quem volta ao site reencontra o proprio codigo", () => {
  const ls = memoriaLocal();
  montarPersistencia(ls).guardar({ protocolo: "CIN-ABC12345", dataBR: "25/08/2026", hora: "14:30" });
  const alvo = { innerHTML: "", style: {} };
  const chave = (sitePublico.match(/const CHAVE_ULTIMO_AGENDAMENTO = "([^"]+)"/) || [])[1];
  const fn = new Function("document", "localStorage", "CHAVE_ULTIMO_AGENDAMENTO", "textoSeguro",
    [extrairFuncao(sitePublico, "lerAgendamentoLocal"),
     extrairFuncao(sitePublico, "mostrarLembreteProtocoloSalvo"),
     "return mostrarLembreteProtocoloSalvo;"].join("\n")
  )({ getElementById: (id) => (id === "lembrete-protocolo" ? alvo : null) }, ls, chave, (t) => String(t));

  fn();
  assert.match(alvo.innerHTML, /CIN-ABC12345/);
  assert.match(alvo.innerHTML, /25\/08\/2026/);
  assert.equal(alvo.style.display, "block");
});

test("sem nada guardado, o lembrete nao aparece", () => {
  const alvo = { innerHTML: "", style: { display: "none" } };
  const chave = (sitePublico.match(/const CHAVE_ULTIMO_AGENDAMENTO = "([^"]+)"/) || [])[1];
  const fn = new Function("document", "localStorage", "CHAVE_ULTIMO_AGENDAMENTO", "textoSeguro",
    [extrairFuncao(sitePublico, "lerAgendamentoLocal"),
     extrairFuncao(sitePublico, "mostrarLembreteProtocoloSalvo"),
     "return mostrarLembreteProtocoloSalvo;"].join("\n")
  )({ getElementById: (id) => (id === "lembrete-protocolo" ? alvo : null) }, memoriaLocal(), chave, (t) => String(t));

  fn();
  assert.equal(alvo.innerHTML, "");
  assert.equal(alvo.style.display, "none");
});

test("a confirmacao acontece no momento do agendamento", () => {
  const trecho = sitePublico.slice(sitePublico.indexOf("mostrarProtocoloConfirmado(ultimoAgendamentoConfirmado.protocolo)"));
  assert.match(trecho.slice(0, 200), /guardarAgendamentoLocalmente\(ultimoAgendamentoConfirmado\)/,
    "Guardar tem de acontecer junto de exibir, ou o reload perde o codigo.");
});
