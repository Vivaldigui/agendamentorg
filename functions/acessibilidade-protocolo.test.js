"use strict";

// Erros de campo acessiveis e protocolo guardado no aparelho (auditoria de
// 16/10/2026, UX-01 e UX-02).
//
// UX-01: o erro so mudava a cor e mostrava a mensagem; o leitor de tela ouvia
// "corrija os campos em destaque" sem saber quais. UX-02: o protocolo ficava
// no aparelho para sempre, junto do nome; em celular emprestado, quem viesse
// depois via o codigo que, com CPF e nascimento, permite cancelar.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sitePublico = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

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

// Elemento minimo: classList e atributos.
function elemento(attrs = {}) {
  const classes = new Set();
  const atributos = { ...attrs };
  return {
    classList: {
      toggle: (c, ligar) => (ligar ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c)
    },
    setAttribute: (k, v) => { atributos[k] = String(v); },
    getAttribute: (k) => (k in atributos ? atributos[k] : null),
    removeAttribute: (k) => { delete atributos[k]; },
    atributos
  };
}

const setErroCampo = (doc) => new Function("document", `${extrairFuncao(sitePublico, "setErroCampo")}; return setErroCampo;`)(doc);

// ---- UX-01 ------------------------------------------------------------------

test("campo com erro fica aria-invalid e descrito pela propria mensagem", () => {
  const input = elemento();
  const msg = elemento();
  const set = setErroCampo({ getElementById: (id) => ({ "inp-cpf": input, "erro-cpf": msg })[id] });
  set("inp-cpf", "erro-cpf", true);
  assert.equal(input.atributos["aria-invalid"], "true");
  assert.equal(input.atributos["aria-describedby"], "erro-cpf");
  assert.ok(input.classList.contains("erro") && msg.classList.contains("visivel"));
  set("inp-cpf", "erro-cpf", false);
  assert.equal(input.atributos["aria-invalid"], undefined);
  assert.equal(input.atributos["aria-describedby"], undefined, "Mensagem oculta tambem seria lida: sai junto.");
  assert.ok(!input.classList.contains("erro") && !msg.classList.contains("visivel"));
});

test("descricao que o campo ja tinha e preservada, sem duplicar a do erro", () => {
  const input = elemento({ "aria-describedby": "ajuda-cpf" });
  const set = setErroCampo({ getElementById: (id) => ({ "inp-cpf": input, "erro-cpf": elemento() })[id] });
  set("inp-cpf", "erro-cpf", true);
  set("inp-cpf", "erro-cpf", true);
  assert.equal(input.atributos["aria-describedby"], "ajuda-cpf erro-cpf");
  set("inp-cpf", "erro-cpf", false);
  assert.equal(input.atributos["aria-describedby"], "ajuda-cpf");
});

test("o aviso diz quais campos corrigir, com o nome que a pessoa le na tela", () => {
  const rotulos = {
    "inp-nome": "Nome Completo: *",
    "inp-cpf": "CPF: *",
    "inp-tel": "Celular / WhatsApp: (para a Câmara entrar em contato, se precisar) *",
    "inp-email": "E-mail (Opcional)"
  };
  const invalidos = (ids) => ({
    querySelector: (sel) => {
      const id = /label\[for="([^"]+)"\]/.exec(sel)[1];
      return { textContent: rotulos[id] };
    },
    querySelectorAll: () => ids.map((id) => ({ id }))
  });
  const montar = (ids) => new Function(
    "document",
    `${extrairFuncao(sitePublico, "rotuloDoCampo")}; ${extrairFuncao(sitePublico, "mensagemCamposComErro")}; return mensagemCamposComErro;`
  )(invalidos(ids));
  assert.equal(montar(["inp-cpf"])("#dados-pessoais"), "Corrija o campo CPF.");
  assert.equal(montar(["inp-nome", "inp-cpf", "inp-tel"])("#dados-pessoais"),
    "Corrija os campos Nome Completo, CPF e Celular / WhatsApp.");
  assert.equal(montar(["inp-email"])("#dados-pessoais", ["Estado civil"]), "Corrija os campos E-mail e Estado civil.");
  assert.equal(montar([])("#dados-pessoais"), "Corrija os campos em destaque para continuar.");
});

test("as duas validacoes focam o primeiro campo e nomeiam os campos", () => {
  for (const nome of ["avancarParaDatas", "confirmarAgendamento"]) {
    const corpo = extrairFuncao(sitePublico, nome);
    assert.match(corpo, /aviso\(mensagemCamposComErro\("#dados-pessoais"/, nome);
    assert.match(corpo, /primeiro\.focus\(\{ preventScroll: true \}\)/, nome);
    assert.doesNotMatch(corpo, /aviso\("Corrija os campos em destaque/, nome);
  }
});

test("estado civil so descreve o erro enquanto ha erro", () => {
  assert.match(sitePublico, /<fieldset class="estado-civil so-preencher" aria-describedby="estado-civil-ajuda">/);
  const marcar = extrairFuncao(sitePublico, "marcarErroEstadoCivil");
  assert.match(marcar, /comErro \? "estado-civil-ajuda erro-estado-civil" : "estado-civil-ajuda"/);
});

// ---- UX-02 ------------------------------------------------------------------

function memoria() {
  const mapa = new Map();
  return {
    setItem: (k, v) => mapa.set(k, String(v)),
    getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
    removeItem: (k) => mapa.delete(k),
    mapa
  };
}

function persistencia(ls, hoje) {
  const chave = /const CHAVE_ULTIMO_AGENDAMENTO = "([^"]+)"/.exec(sitePublico)[1];
  const corpo = ["guardarAgendamentoLocalmente", "esquecerAgendamentoLocal", "dataISODoAgendamentoLocal", "lerAgendamentoLocal"]
    .map((n) => extrairFuncao(sitePublico, n)).join("\n");
  return new Function("localStorage", "CHAVE_ULTIMO_AGENDAMENTO", "hojeISO",
    `${corpo}; return { guardar: guardarAgendamentoLocalmente, ler: lerAgendamentoLocal };`
  )(ls, chave, () => hoje);
}

test("o codigo guardado nao leva o nome da pessoa", () => {
  const ls = memoria();
  persistencia(ls, "2026-10-16").guardar({ protocolo: "CIN-ABC12345", dataISO: "2026-10-20", dataBR: "20/10/2026", hora: "14:30", nome: "Maria da Silva" });
  const bruto = [...ls.mapa.values()][0];
  assert.doesNotMatch(bruto, /Maria/);
  assert.match(bruto, /"dataISO":"2026-10-20"/);
});

test("depois da data do atendimento o codigo sai do aparelho sozinho", () => {
  const ls = memoria();
  persistencia(ls, "2026-10-16").guardar({ protocolo: "CIN-ABC12345", dataISO: "2026-10-20", dataBR: "20/10/2026", hora: "14:30" });
  assert.ok(persistencia(ls, "2026-10-20").ler(), "No dia do atendimento ainda vale.");
  assert.equal(persistencia(ls, "2026-10-21").ler(), null);
  assert.equal(ls.mapa.size, 0, "Removido, nao so escondido.");
});

test("registro antigo, so com dataBR, tambem expira", () => {
  const ls = memoria();
  const chave = /const CHAVE_ULTIMO_AGENDAMENTO = "([^"]+)"/.exec(sitePublico)[1];
  ls.setItem(chave, JSON.stringify({ protocolo: "CIN-OLD", dataBR: "25/08/2026", hora: "14:30", nome: "Fulano" }));
  assert.equal(persistencia(ls, "2026-10-16").ler(), null);
  assert.equal(ls.mapa.size, 0);
});

test("a pessoa pode esquecer o codigo; cancelar pelo site tambem apaga", () => {
  const lembrete = extrairFuncao(sitePublico, "mostrarLembreteProtocoloSalvo");
  assert.match(lembrete, /onclick="esquecerAgendamentoNesteAparelho\(\)"[^>]*>Esquecer neste aparelho<\/button>/);
  assert.match(lembrete, /min-height:32px/, "Alvo de toque com altura minima.");
  const esquecer = extrairFuncao(sitePublico, "esquecerAgendamentoNesteAparelho");
  assert.match(esquecer, /esquecerAgendamentoLocal\(\)/);
  assert.match(esquecer, /aviso\(/);
  const posCancelamento = sitePublico.slice(sitePublico.indexOf('await chamarFuncao("cancelarAgendamentoCidadao"'));
  assert.match(posCancelamento.slice(0, 600), /local\.protocolo === ag\.protocolo\) esquecerAgendamentoLocal\(\)/);
});
