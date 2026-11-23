"use strict";

// Pular uma semana no painel precisa tirar essa semana do aviso de novas vagas.
// Antes, salvar a automacao gravava a pausa mas o site seguia anunciando
// "Novas vagas em 30/11" ate a execucao automatica da propria segunda pulada.

const test = require("node:test");
const assert = require("node:assert/strict");

const { painelJs } = require("./painel-fonte");

function extrairFuncao(codigo, nome) {
  const marcador = new RegExp(`(?:async )?function ${nome}\\(`).exec(codigo);
  assert.ok(marcador, `Funcao ${nome} nao encontrada.`);
  const abre = codigo.indexOf("{", codigo.indexOf(")", marcador.index));
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(marcador.index, i + 1);
    }
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

const funcoes = [
  "dataISOValidaAutomacao", "segundaDaSemanaPainel", "somarDiasISO", "indiceDiaSemana",
  "dataBrISO", "dataConfigParaInput", "normalizarAutomacaoPainel", "dataPermitidaPelaAutomacao",
  "semanaTemAtendimentoPainel", "primeiraSemanaComAtendimentoPainel", "avisoCorrigidoPelaAutomacao"
].map((nome) => extrairFuncao(painelJs, nome)).join("\n");

const { normalizarAutomacaoPainel, avisoCorrigidoPelaAutomacao } = new Function(
  `${funcoes}\nreturn { normalizarAutomacaoPainel, avisoCorrigidoPelaAutomacao };`
)();

const HOJE = "2026-11-23";

test("semana pausada anunciada passa para a proxima semana com atendimento", () => {
  const cfg = normalizarAutomacaoPainel({ semanasPausadas: ["2026-12-02"] });
  assert.equal(avisoCorrigidoPelaAutomacao(cfg, "30/11/2026", HOJE), "07/12/2026");
});

test("pula varias semanas seguidas e ferias que cobrem a semana inteira", () => {
  const cfg = normalizarAutomacaoPainel({
    semanasPausadas: ["2026-11-30"],
    periodosBloqueados: [{ inicio: "2026-12-08", fim: "2026-12-11" }]
  });
  assert.equal(avisoCorrigidoPelaAutomacao(cfg, "30/11/2026", HOJE), "14/12/2026");
});

test("nao mexe no aviso quando a semana anunciada continua com atendimento", () => {
  const cfg = normalizarAutomacaoPainel({ datasBloqueadas: ["2026-12-01"] });
  assert.equal(avisoCorrigidoPelaAutomacao(cfg, "30/11/2026", HOJE), null);
});

test("nao mexe com automacao desligada, aviso passado ou vazio", () => {
  const pausada = { semanasPausadas: ["2026-11-30"] };
  assert.equal(avisoCorrigidoPelaAutomacao(normalizarAutomacaoPainel({ ...pausada, ativa: false }), "30/11/2026", HOJE), null);
  assert.equal(avisoCorrigidoPelaAutomacao(normalizarAutomacaoPainel(pausada), "30/11/2026", "2026-12-01"), null);
  assert.equal(avisoCorrigidoPelaAutomacao(normalizarAutomacaoPainel(pausada), "", HOJE), null);
});

test("salvar a automacao grava o aviso corrigido junto", () => {
  const corpo = extrairFuncao(painelJs, "salvarAutomacaoSemanal");
  assert.match(corpo, /avisoCorrigidoPelaAutomacao\(cfg, agendaDataNovasVagas\)/);
  assert.match(corpo, /conteudo\.dataNovasVagas = avisoTopoCorrigido/);
  assert.match(corpo, /conteudo\.avisoNovasVagasProgramado = /);
  assert.match(corpo, /gravarAgendaConfig\(conteudo\)/);
});
