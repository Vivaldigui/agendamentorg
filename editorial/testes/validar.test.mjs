import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import { validarColecao, validarDocumento } from "../scripts/validar.mjs";
import { bases, dadosValidos, documento, RAIZ } from "./auxiliares.mjs";

const contexto = await bases();

test("frontmatter válido passa", () => {
  assert.doesNotThrow(() => validarDocumento(documento(), contexto));
});

for (const [nome, alterar, trecho] of [
  ["campo obrigatório", (d) => { delete d.titulo; }, "campo titulo"],
  ["campo desconhecido", (d) => { d.inventado = true; }, "campo inventado"],
  ["titulo_seo acima de 60", (d) => { d.titulo_seo = "x".repeat(61); }, "máximo de 60"],
  ["descrição curta", (d) => { d.descricao = "curta"; }, "140 a 165"],
  ["descrição longa", (d) => { d.descricao = "x".repeat(166); }, "140 a 165"],
  ["resposta curta", (d) => { d.resposta = "poucas palavras"; }, "40 a 90"],
  ["resposta longa", (d) => { d.resposta = Array(91).fill("palavra").join(" "); }, "40 a 90"],
  ["slug inválido", (d) => { d.slug = "Com Espaço"; }, "minúsculas"],
  ["status inválido", (d) => { d.status = "publicado"; }, "rascunho, revisao ou aprovado"],
  ["aprovado sem conferido", (d) => { delete d.conferido; }, "campo conferido"],
  ["IA sem conferido_por", (d) => { d.status = "rascunho"; d.gerado_por_ia = true; delete d.conferido_por; }, "campo conferido_por"]
]) {
  test(`frontmatter rejeita ${nome}`, () => {
    const dados = dadosValidos();
    alterar(dados);
    assert.throws(() => validarDocumento(documento(dados), contexto), new RegExp(trecho));
  });
}

test("trava recusa marcador A CONFIRMAR em página aprovada", async () => {
  const fonte = await fs.readFile(path.join(RAIZ, "testes", "fixtures", "aprovado-a-confirmar.md"), "utf8");
  const parsed = matter(fonte);
  assert.throws(() => validarDocumento(documento(parsed.data, parsed.content), contexto), /não pode conter \[A CONFIRMAR/);
});

test("trava recusa fato a_confirmar em página aprovada", async () => {
  const fonte = await fs.readFile(path.join(RAIZ, "testes", "fixtures", "aprovado-fato-pendente.md"), "utf8");
  const parsed = matter(fonte);
  assert.throws(() => validarDocumento(documento(parsed.data, parsed.content), contexto), /ainda não está verificado/);
});

test("H1 no corpo é recusado", () => {
  assert.throws(() => validarDocumento(documento(dadosValidos(), "# Título indevido"), contexto), /não use H1/);
});

test("links externos precisam ser oficiais ou declarados nas fontes", () => {
  assert.throws(() => validarDocumento(documento(dadosValidos(), "[site](https://example.com/pagina)"), contexto), /link externo não permitido/);
  const dados = dadosValidos({ fontes: [{ orgao: "Fonte", titulo: "Página", url: "https://example.com/pagina", consultado: "2026-09-11" }] });
  assert.doesNotThrow(() => validarDocumento(documento(dados, "[site](https://example.com/pagina)"), contexto));
});

test("link interno inexistente é recusado", () => {
  const doc = documento(dadosValidos({ status: "rascunho", conferido: undefined }), "[Outra página](/cin/inexistente/)");
  validarDocumento(doc, contexto);
  assert.throws(() => validarColecao([doc]), /link interno inexistente/);
});

test("página aprovada sem pilar ou link de entrada é órfã", () => {
  const doc = documento();
  validarDocumento(doc, contexto);
  assert.throws(() => validarColecao([doc]), /órfã/);
});
