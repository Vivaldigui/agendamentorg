"use strict";

// Travas das contencoes B4 e B5 da auditoria independente de 14/08/2026.
//
// B4: criarAgendamentoCidadao aceitava substituirAnterior direto do cliente, sem
//     nada ligar quem chamava ao CPF informado. Bastava conhecer um CPF para
//     liberar a vaga da vitima, inativar o agendamento dela e criar outro com
//     dados proprios. O erro de CPF duplicado ainda devolvia data e hora da
//     vitima a quem so tinha o CPF.
//
// B5: cancelarAgendamentoCidadao apagava vaga e indices a partir de uma
//     fotografia de 30 minutos, sem conferir o dono atual. Dois tokens irmaos
//     permitiam cancelar com o primeiro, outra pessoa reservar a vaga liberada,
//     e o segundo apagar a vaga dela -- vendendo o mesmo horario duas vezes.
//
// Sao travas estruturais, nao provas de comportamento: a logica vive dentro de
// transacoes do Firestore e so pode ser exercitada de ponta a ponta no Emulator
// Suite ou em homologacao.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const sitePublico = fs.readFileSync(path.resolve(__dirname, "..", "public", "index.html"), "utf8");

function extrairExport(codigo, nome) {
  const inicio = codigo.indexOf(`exports.${nome} =`);
  assert.notEqual(inicio, -1, `Export ${nome} nao encontrado.`);
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

const criar = extrairExport(backend, "criarAgendamentoCidadao");
const cancelar = extrairExport(backend, "cancelarAgendamentoCidadao");

test("B4: a substituicao nao pode ser decidida por dado vindo do cliente", () => {
  assert.doesNotMatch(
    criar,
    /substituirAnterior\s*=\s*[^;]*request\.data/,
    "substituirAnterior nao pode derivar de request.data: bastaria um CPF para tomar o agendamento alheio."
  );
  assert.match(criar, /const\s+substituirAnterior\s*=\s*false\s*;/);
});

test("B4: o erro de CPF duplicado nao revela quando a pessoa sera atendida", () => {
  const bloco = criar.slice(criar.indexOf("cpf-ja-agendado") - 900, criar.indexOf("cpf-ja-agendado") + 200);
  assert.doesNotMatch(bloco, /dataISO:\s*agendamentoAtivoExistente/);
  assert.doesNotMatch(bloco, /hora:\s*agendamentoAtivoExistente/);
  assert.doesNotMatch(bloco, /dataBr\(agendamentoAtivoExistente/);
});

test("B4: o site publico nao oferece mais substituir o agendamento", () => {
  assert.doesNotMatch(sitePublico, /textoConfirmar:\s*["']Substituir agendamento["']/);
  assert.doesNotMatch(sitePublico, /substituirAnterior\s*=\s*true/);
});

test("B5: a vaga so e apagada se ainda pertencer ao agendamento do token", () => {
  assert.match(
    cancelar,
    /slotDoc\.data\(\)\.agendamentoId\s*===\s*pendente\.agendamentoId/,
    "Sem conferir o dono atual, um token irmao apaga a vaga de outra pessoa."
  );
  assert.doesNotMatch(
    cancelar.replace(/\/\/[^\n]*/g, ""),
    /if\s*\(\s*slotId\s*&&\s*slotId\s*!==\s*"undefined_undefined"\s*\)\s*\{\s*t\.delete/,
    "Exclusao incondicional da vaga reintroduz a venda dupla."
  );
});

test("B5: indices de CPF so sao removidos se ainda apontarem para este agendamento", () => {
  assert.match(cancelar, /doc\.data\(\)\.agendamentoId\s*===\s*pendente\.agendamentoId/);
  assert.doesNotMatch(
    cancelar.replace(/\/\/[^\n]*/g, ""),
    /cpfDocIds\.forEach\(\s*\(docId\)\s*=>\s*\{\s*if\s*\(docId\)\s*t\.delete/,
    "Exclusao incondicional do indice apaga o de um agendamento posterior."
  );
});

test("B5: todas as leituras ocorrem antes das escritas na transacao", () => {
  // A varredura comeca depois da guarda de token expirado. Aquele ramo faz
  // t.delete(tokenRef) e lanca na linha seguinte, entao nunca coexiste em
  // execucao com as leituras posteriores -- contar essa escrita seria um falso
  // positivo. O que importa e o caminho que de fato chega ate as gravacoes.
  const inicio = cancelar.indexOf("const agRef =");
  assert.notEqual(inicio, -1, "Ancora da transacao nao encontrada.");
  const caminhoEfetivo = cancelar.slice(inicio);

  const primeiraEscrita = Math.min(
    ...[caminhoEfetivo.indexOf("t.delete("), caminhoEfetivo.indexOf("t.set(")].filter((i) => i > -1)
  );
  const ultimaLeitura = caminhoEfetivo.lastIndexOf("t.get(");
  assert.ok(
    ultimaLeitura > -1 && ultimaLeitura < primeiraEscrita,
    "O Firestore exige todas as leituras antes de qualquer escrita dentro da transacao."
  );
});
