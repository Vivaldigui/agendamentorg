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
// A primeira correcao usou `if (!dados.protocolo) return;` como suposta
// retrocompatibilidade. A auditoria independente do mesmo dia mostrou que isso
// nao devolvia os antigos ao comportamento antigo: ignorava TAMBEM o telefone
// gravado, entao o bypass seguia aberto para todo documento sem protocolo --
// os 40 agendamentos ativos de 24/08. Pior, um teste deste arquivo consagrava
// esse comportamento como se fosse a intencao.
//
// O criterio agora e o fator que o documento de fato tem:
//   protocolo + telefone -> qualquer um dos dois
//   so protocolo         -> protocolo
//   so telefone          -> telefone
//   nenhum dos dois      -> recusa; a recepcao resolve
//
// Conferido em producao antes de implantar: 3 registros so com protocolo,
// 40 so com telefone, e ZERO sem nenhum dos dois.

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
  "ERRO_SEM_AGENDAMENTO",
  [
    extrairFuncao(backend, "digitosTelefone"),
    extrairFuncao(backend, "telefoneCanonico"),
    extrairFuncao(backend, "telefonesConferem"),
    extrairFuncao(backend, "normalizarProtocolo"),
    extrairFuncao(backend, "validarFatorExtra"),
    "return validarFatorExtra;"
  ].join("\n")
)(ErroFalso, "Nenhum agendamento encontrado com os dados informados.");

const gerarProtocolo = new Function(
  "crypto",
  `${extrairFuncao(backend, "gerarProtocolo")}; return gerarProtocolo;`
)(require("node:crypto"));

// Os quatro casos que existem em producao, pelo fator que o documento TEM.
const AMBOS   = { protocolo: "CIN-ABC12345", telefone: "(35) 99999-1234" };
const SO_PROT = { protocolo: "CIN-ABC12345" };                    // encaixes manuais sem telefone
const SO_TEL  = { telefone: "(35) 99999-1234" };                  // os 40 anteriores ao protocolo
const NENHUM  = {};

// Mantido com o nome NOVO para os testes que ja existiam abaixo.
const NOVO = AMBOS;

test("REGRESSAO: agendamento sem protocolo NAO libera com fator arbitrario", () => {
  // A guarda antiga era `if (!dados.protocolo) return`, e ela ignorava tambem o
  // telefone gravado: CPF mais nascimento bastavam para consultar e cancelar.
  // Em 24/08/2026 isso valia para os 40 agendamentos ativos. Um teste deste
  // arquivo chegou a consagrar o comportamento como se fosse retrocompatibilidade.
  assert.throws(() => validarFatorExtra(SO_TEL, "", ""), /Nenhum agendamento encontrado/);
  assert.throws(() => validarFatorExtra(SO_TEL, "qualquer coisa", "qualquer coisa"), /Nenhum agendamento encontrado/);
  assert.throws(() => validarFatorExtra(SO_TEL, "(35) 98888-0000", "(35) 98888-0000"), /Nenhum agendamento encontrado/);
});

test("so telefone: o telefone gravado abre, e so ele", () => {
  assert.doesNotThrow(() => validarFatorExtra(SO_TEL, "(35) 99999-1234", "(35) 99999-1234"));
  assert.doesNotThrow(() => validarFatorExtra(SO_TEL, "35999991234", "35999991234"));
});

test("so protocolo: o protocolo abre, telefone qualquer nao", () => {
  assert.doesNotThrow(() => validarFatorExtra(SO_PROT, "CIN-ABC12345", "CIN-ABC12345"));
  assert.throws(() => validarFatorExtra(SO_PROT, "(35) 99999-1234", "(35) 99999-1234"), /Nenhum agendamento encontrado/);
});

test("sem protocolo e sem telefone: recusa, e a recepcao resolve", () => {
  // Unico caso que tranca alguem. Conferido em producao antes de implantar:
  // zero agendamentos ativos futuros nesta situacao.
  assert.throws(() => validarFatorExtra(NENHUM, "", ""), /Nenhum agendamento encontrado/);
  assert.throws(() => validarFatorExtra(NENHUM, "qualquer", "qualquer"), /Nenhum agendamento encontrado/);
  assert.throws(() => validarFatorExtra({ telefone: "123" }, "123", "123"), /Nenhum agendamento encontrado/);
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
  // Mensagem unica, numa constante compartilhada pelos dois pontos de recusa.
  assert.match(backend, /const ERRO_SEM_AGENDAMENTO = "Nenhum agendamento encontrado com os dados informados\.";/);
  assert.doesNotMatch(bloco, /"[^"]*nao confere[^"]*"|"[^"]*fator[^"]*"/i, "Mensagem especifica confirmaria que o CPF tem agendamento.");
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
  // \s em vez de \n literal: o repo nao tem .gitattributes, entao o mesmo
  // arquivo chega com LF ou CRLF conforme o checkout. Exigir "\n" logo apos a
  // virgula reprovava por causa do \r, com o codigo intacto.
  assert.match(
    criar,
    /slotId,\s*protocolo,\s*status: "agendado"/,
    "Sem gravar o protocolo no documento, validarFatorExtra devolve cedo e nada e exigido."
  );
  assert.match(criar, /hora,\s*protocolo\s*\},\s*substituiu: agendamentoSubstituido/);
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

test("quem tem protocolo ve o codigo, e a guarda do bypass nao voltou", () => {
  // A linha do PDF, o trecho do WhatsApp e o bloco do ticket sao todos
  // condicionais. Um agendamento legado renderiza igual ao que era antes.
  assert.match(extrairFuncao(sitePublico, "mostrarProtocoloConfirmado"), /bloco\.style\.display = texto \? "block" : "none"/);
  // A guarda antiga NAO pode voltar: ela ignorava tambem o telefone gravado.
  assert.doesNotMatch(extrairFuncao(backend, "validarFatorExtra"), /if \(!dados\.protocolo\) return;/);
});
