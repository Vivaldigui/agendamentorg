"use strict";

// Segundo fator de consulta e cancelamento do cidadao.
//
// Ate esta versao, validarFatorExtra existia mas nunca era chamada: aparecia
// uma unica vez em index.js, a propria definicao. E criarAgendamentoCidadao nao
// gravava protocolo -- so criarEncaixeManual gravava. Somadas, as duas coisas
// significavam que CPF + data de nascimento bastavam para consultar E cancelar
// o agendamento de qualquer pessoa. Registrado no handoff de 13/08/2026 e ainda
// presente no commit que atendeu a abertura de 24/08.
//
// A guarda `if (!dados.protocolo) return;` mantem a retrocompatibilidade:
// agendamentos criados antes desta versao seguem funcionando so com CPF e
// nascimento. Ninguem fica trancado para fora.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

function extrairFuncao(codigo, nome) {
  const inicio = codigo.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  const abre = codigo.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(inicio, i + 1);
    }
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

function extrairBlocoExport(codigo, nome) {
  const inicio = codigo.indexOf(`exports.${nome} =`);
  assert.notEqual(inicio, -1, `Export ${nome} nao encontrado.`);
  const resto = codigo.slice(inicio + 1);
  const proxima = resto.search(/\n(?:exports\.|(?:async )?function |const )/);
  return proxima === -1 ? codigo.slice(inicio) : codigo.slice(inicio, inicio + 1 + proxima);
}

class ErroFalso extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const validarFatorExtra = new Function(
  "HttpsError",
  [
    extrairFuncao(backend, "digitosTelefone"),
    extrairFuncao(backend, "telefonesConferem"),
    extrairFuncao(backend, "normalizarProtocolo"),
    extrairFuncao(backend, "validarFatorExtra"),
    "return validarFatorExtra;"
  ].join("\n")
)(ErroFalso);

const gerarProtocolo = new Function(
  "crypto",
  `${extrairFuncao(backend, "gerarProtocolo")}; return gerarProtocolo;`
)(require("node:crypto"));

const NOVO = { protocolo: "CIN-ABC12345", telefone: "(35) 99999-1234" };
const LEGADO = { telefone: "(35) 99999-1234" };

test("agendamento sem protocolo continua acessivel so com CPF e nascimento", () => {
  assert.doesNotThrow(() => validarFatorExtra(LEGADO, "", ""));
  assert.doesNotThrow(() => validarFatorExtra(LEGADO, "qualquer coisa", "qualquer coisa"));
});

test("agendamento com protocolo exige telefone ou protocolo corretos", () => {
  assert.throws(() => validarFatorExtra(NOVO, "", ""), /Nenhum agendamento encontrado/);
  assert.throws(() => validarFatorExtra(NOVO, "(35) 98888-0000", "(35) 98888-0000"), /Nenhum agendamento encontrado/);
  assert.throws(() => validarFatorExtra(NOVO, "CIN-ZZZ00000", "CIN-ZZZ00000"), /Nenhum agendamento encontrado/);
});

test("o campo unico do site aceita tanto o telefone quanto o protocolo", () => {
  // O site manda o MESMO valor nas duas posicoes; cada comparacao so casa com
  // o formato que lhe cabe.
  assert.doesNotThrow(() => validarFatorExtra(NOVO, "(35) 99999-1234", "(35) 99999-1234"));
  assert.doesNotThrow(() => validarFatorExtra(NOVO, "CIN-ABC12345", "CIN-ABC12345"));
  assert.doesNotThrow(() => validarFatorExtra(NOVO, "35999991234", "35999991234"));
  assert.doesNotThrow(() => validarFatorExtra(NOVO, "cin-abc12345", "cin-abc12345"));
});

test("o erro nao distingue fator errado de agendamento inexistente", () => {
  // Mensagem diferente confirmaria que aquele CPF tem agendamento, e a
  // enumeracao voltaria pela porta dos fundos.
  const bloco = extrairFuncao(backend, "validarFatorExtra");
  assert.match(bloco, /"not-found"/);
  assert.match(bloco, /Nenhum agendamento encontrado com os dados informados\./);
});

test("validarFatorExtra deixou de ser codigo morto", () => {
  const chamadas = backend.split("validarFatorExtra(").length - 1;
  assert.ok(chamadas >= 3, `validarFatorExtra aparece ${chamadas}x: definicao sem nenhuma chamada.`);
  assert.match(
    extrairBlocoExport(backend, "consultarAgendamentoCidadao"),
    /validarFatorExtra\(\s*encontrado\.dados/,
    "Consulta sem segundo fator: CPF e nascimento bastam para ver o agendamento alheio."
  );
  assert.match(
    extrairBlocoExport(backend, "prepararCancelamentoCidadao"),
    /validarFatorExtra\(\s*encontrado\.dados/,
    "Cancelamento sem segundo fator: CPF e nascimento bastam para cancelar o agendamento alheio."
  );
});

test("o agendamento do cidadao passa a nascer com protocolo", () => {
  const criar = extrairBlocoExport(backend, "criarAgendamentoCidadao");
  assert.match(criar, /const protocolo = gerarProtocolo\(agendamentoRef\.id\)/);
  assert.match(
    criar,
    /slotId,\n\s*protocolo,\n\s*status: "agendado"/,
    "Sem gravar o protocolo no documento, validarFatorExtra devolve cedo e nada e exigido."
  );
  assert.match(criar, /hora,\n\s*protocolo\n\s*\},\n\s*substituiu: agendamentoSubstituido/);
  assert.match(
    criar,
    /protocolo: agSlotDoc\.data\(\)\.protocolo \|\| ""/,
    "O caminho idempotente tambem precisa devolver o protocolo, senao um reenvio perde o codigo."
  );
});

test("o protocolo gerado tem o formato que o site instrui a guardar", () => {
  assert.match(gerarProtocolo("abc123def456"), /^CIN-[A-Z0-9]{1,8}$/);
});

test("quem consulta com sucesso recebe o protocolo de volta", () => {
  assert.match(extrairFuncao(backend, "respostaPublica"), /protocolo: dados\.protocolo \|\| ""/);
});

test("o site publico coleta e envia o fator extra nas duas chamadas", () => {
  assert.match(sitePublico, /id="cons-fator"/);
  assert.match(sitePublico, /id="cancelar-fator"/);
  assert.match(
    sitePublico,
    /chamarFuncao\("consultarAgendamentoCidadao",\s*\{ cpf, nascimento: nascISO, fatorExtra \}\)/
  );
  assert.match(
    sitePublico,
    /chamarFuncao\("prepararCancelamentoCidadao",\s*\{ cpf, nascimento: nascISO, fatorExtra \}\)/
  );
});

test("o site publico mostra o protocolo para a pessoa poder guarda-lo", () => {
  assert.match(sitePublico, /id="ticket-protocolo-valor"/);
  assert.match(sitePublico, /mostrarProtocoloConfirmado\(ultimoAgendamentoConfirmado\.protocolo\)/);
  assert.match(sitePublico, /protocolo: ag\.protocolo \|\| ""/);
});

test("quem acabou de agendar nao precisa redigitar o fator para cancelar", () => {
  const preencher = extrairFuncao(sitePublico, "preencherFatorDoUltimoAgendamento");
  assert.match(preencher, /ag\.protocolo \|\| ag\.telefone/);
  assert.match(
    extrairFuncao(sitePublico, "abrirAbaCancelar"),
    /preencherFatorDoUltimoAgendamento\(\)/,
    "Sem isso, quem clica em 'Cancelar horario' na tela de sucesso trava no proprio segundo fator."
  );
  // Nao pode sobrescrever o que a pessoa ja digitou a mao.
  assert.match(preencher, /if \(!campo \|\| campo\.value\.trim\(\) \|\| !ag\) return;/);
});

test("o protocolo acompanha o comprovante em PDF e a mensagem de WhatsApp", () => {
  // Sao os dois lugares onde a pessoa de fato guarda o comprovante. Sem o
  // codigo ali, exigir o segundo fator depois vira barreira para o dono.
  assert.match(sitePublico, /\$\{ag\.protocolo \? linhaComprovante\("Protocolo", ag\.protocolo\) : ""\}/);
  assert.match(extrairFuncao(sitePublico, "mensagemConfirmacao"), /Protocolo: \$\{ag\.protocolo\}/);
});

test("nada exige protocolo de quem agendou antes desta versao", () => {
  // A linha do PDF, o trecho do WhatsApp e o bloco do ticket sao todos
  // condicionais. Um agendamento legado renderiza igual ao que era antes.
  assert.match(extrairFuncao(sitePublico, "mostrarProtocoloConfirmado"), /bloco\.style\.display = texto \? "block" : "none"/);
  assert.match(extrairFuncao(backend, "validarFatorExtra"), /if \(!dados\.protocolo\) return;/);
});
