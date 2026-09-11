import assert from "node:assert/strict";
import test from "node:test";
import { extrairFaq } from "../scripts/faq.mjs";
import { criarMarkdown, renderizarMarkdown } from "../scripts/construir.mjs";
import { CORPO_COMPLETO } from "./auxiliares.mjs";

test("FAQ exige o heading exato", () => {
  assert.equal(extrairFaq("## Perguntas Frequentes\n\n**Pergunta?**\n\nResposta.").faq.length, 0);
});

test("FAQ extrai de três a seis perguntas visíveis", () => {
  const extraida = extrairFaq(CORPO_COMPLETO);
  assert.equal(extraida.faq.length, 3);
  assert.equal(extraida.faq[0].pergunta, "Qual documento devo levar?");
  assert.ok(!extraida.corpo.includes("Perguntas frequentes"));
});

test("pergunta sem ? ou em H3 não conta", () => {
  const corpo = "## Perguntas frequentes\n\n**Pergunta sem sinal**\n\nResposta.\n\n### Outra pergunta?\n\nResposta.";
  assert.throws(() => extrairFaq(corpo), /3 a 6 perguntas/);
});

test("FAQ com menos de três ou mais de seis falha", () => {
  assert.throws(() => extrairFaq("## Perguntas frequentes\n\n**Uma?**\n\nResposta."), /3 a 6/);
  const sete = Array.from({ length: 7 }, (_, i) => `**Pergunta ${i}?**\n\nResposta ${i}.`).join("\n\n");
  assert.throws(() => extrairFaq(`## Perguntas frequentes\n\n${sete}`), /3 a 6/);
});

test("containers recebem classe e rótulo textual", () => {
  const md = criarMarkdown();
  const { html } = renderizarMarkdown(md, ":::nacional\nRegra.\n:::\n\n:::minas\nRegra.\n:::\n\n:::local\nRegra.\n:::\n\n:::atencao\nRegra.\n:::");
  for (const tipo of ["nacional", "minas", "local", "atencao"]) assert.match(html, new RegExp(`escopo-${tipo}`));
  for (const rotulo of ["Regra nacional", "Minas Gerais", "Como funciona em Itanhandu", "Atenção: regra sujeita a mudança"]) assert.ok(html.includes(rotulo));
});

test("H2 e H3 ganham ids e índice nasce com quatro H2", () => {
  const md = criarMarkdown();
  const renderizado = renderizarMarkdown(md, "## Um título\n\n### Subtítulo\n\n## Dois\n\n## Três\n\n## Quatro");
  assert.match(renderizado.html, /<h2 id="um-titulo">/);
  assert.match(renderizado.html, /<h3 id="subtitulo">/);
  assert.equal(renderizado.indice.length, 4);
});
