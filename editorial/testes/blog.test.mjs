import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { construir } from "../scripts/construir.mjs";
import { validarColecao, validarDocumento } from "../scripts/validar.mjs";
import { bases, CORPO_COMPLETO, dadosValidos, documento, projetoTemporario, removerProjeto } from "./auxiliares.mjs";

const contexto = await bases();

const CORPO_ARTIGO = CORPO_COMPLETO.replace(":::local\nEsta prática descreve somente o atendimento em Itanhandu.\n:::", ":::nacional\nRegra válida em todo o país.\n:::");

function dadosArtigo(sobrescrever = {}) {
  return dadosValidos({
    tipo: "artigo",
    slug: "cin-e-rg-diferencas",
    titulo: "CIN e RG: qual a diferença",
    titulo_seo: "CIN e RG: qual a diferença entre os documentos",
    cluster: "entendendo-a-cin",
    escopos: ["nacional"],
    fatos: [],
    cta: "guia-cin",
    relacionados: [],
    ...sobrescrever
  });
}

test("artigo do blog válido passa", () => {
  assert.doesNotThrow(() => validarDocumento(documento(dadosArtigo(), CORPO_ARTIGO, "conteudo/blog/a.md"), contexto));
});

for (const [nome, alterar, corpo, trecho] of [
  ["escopo estadual", (d) => { d.escopos = ["nacional", "minas"]; }, CORPO_ARTIGO, "somente \\[nacional\\]"],
  ["cluster do guia", (d) => { d.cluster = "agendamento"; }, CORPO_ARTIGO, "cluster inválido"],
  ["bloco local no corpo", () => {}, CORPO_COMPLETO, ":::minas ou :::local"]
]) {
  test(`artigo recusa ${nome}`, () => {
    const dados = dadosArtigo();
    alterar(dados);
    assert.throws(() => validarDocumento(documento(dados, corpo, "conteudo/blog/a.md"), contexto), new RegExp(trecho));
  });
}

test("slug repetido entre guia e blog é recusado", () => {
  const guia = documento(dadosValidos({ slug: "documentos" }), CORPO_COMPLETO, "conteudo/guia/documentos.md");
  const artigo = documento(dadosArtigo({ slug: "documentos" }), CORPO_ARTIGO, "conteudo/blog/documentos.md");
  assert.throws(() => validarColecao([guia, artigo]), /já usado/);
});

test("build gera artigo, índice do blog, link no menu e entrada no sitemap", async (t) => {
  const rascunho = dadosArtigo({ status: "rascunho", slug: "artigo-em-rascunho", titulo: "Artigo em rascunho" });
  delete rascunho.conferido;
  const projeto = await projetoTemporario([
    ["_pilar.md", dadosValidos({ slug: "cin", relacionados: [] }), CORPO_COMPLETO],
    ["cin-e-rg-diferencas.md", dadosArtigo({ atualizado: "2026-10-08" }), CORPO_ARTIGO],
    ["artigo-em-rascunho.md", rascunho, CORPO_ARTIGO],
    ["validade-da-cin.md", dadosArtigo({ slug: "validade-da-cin", titulo: "Validade da CIN por idade", cluster: "dados-no-documento" }), CORPO_ARTIGO]
  ]);
  t.after(() => removerProjeto(projeto));
  const saida = path.join(projeto.raizProjeto, "blog-saida");
  await construir({ raizEditorial: projeto.editorial, saida });

  const artigo = await fs.readFile(path.join(saida, "blog", "cin-e-rg-diferencas", "index.html"), "utf8");
  const indice = await fs.readFile(path.join(saida, "blog", "index.html"), "utf8");
  const pilar = await fs.readFile(path.join(saida, "cin", "index.html"), "utf8");
  const mapa = await fs.readFile(path.join(saida, "sitemap.xml"), "utf8");

  assert.match(artigo, /"@type": "BlogPosting"/);
  assert.doesNotMatch(artigo, /class="ficha-servico"/);
  assert.doesNotMatch(artigo, /#servico"/);
  assert.match(artigo, /href="\/blog\/">Blog<\/a>/);
  assert.match(indice, /"@type": "Blog"/);
  assert.doesNotMatch(artigo, /class="cta-fixo"/);
  assert.doesNotMatch(indice, /class="cta-fixo"/);
  assert.match(pilar, /class="cta-fixo"/);
  assert.match(indice, /href="\/blog\/cin-e-rg-diferencas\/"/);
  assert.doesNotMatch(indice, /artigo-em-rascunho/);
  assert.match(artigo, /class="caixa-transparencia"/);
  assert.match(artigo, /Leia também<\/h2><div class="grade-blog"><a class="cartao-blog" href="\/blog\/validade-da-cin\/"/);
  assert.doesNotMatch(artigo, /href="\/blog\/artigo-em-rascunho\/"/);
  assert.match(pilar, /<nav class="nav-guia"[^>]*>.*href="\/blog\/"/);
  assert.match(mapa, /<loc>https:\/\/agendamento-cin-itanhandu\.web\.app\/blog\/<\/loc>\n    <lastmod>2026-10-08<\/lastmod>/);
  assert.doesNotMatch(mapa, /artigo-em-rascunho/);
});

test("sem artigo aprovado não há índice nem link do blog", async (t) => {
  const projeto = await projetoTemporario([["_pilar.md", dadosValidos({ slug: "cin", relacionados: [] }), CORPO_COMPLETO]]);
  t.after(() => removerProjeto(projeto));
  const saida = path.join(projeto.raizProjeto, "sem-blog");
  await construir({ raizEditorial: projeto.editorial, saida });
  await assert.rejects(() => fs.access(path.join(saida, "blog", "index.html")));
  assert.doesNotMatch(await fs.readFile(path.join(saida, "cin", "index.html"), "utf8"), /href="\/blog\//);
});
