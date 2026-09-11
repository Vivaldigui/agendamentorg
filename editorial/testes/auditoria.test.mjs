import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { construir, verificar, lerFrontmatter, carregarDocumentos, criarMarkdown, renderizarMarkdown } from "../scripts/construir.mjs";
import { jsonLdHome, jsonLdDocumento } from "../modelos/jsonld.mjs";
import { extrairFaq } from "../scripts/faq.mjs";
import { validarDocumento } from "../scripts/validar.mjs";
import { bases, dadosValidos, documento, projetoTemporario, removerProjeto } from "./auxiliares.mjs";

test("frontmatter aceita somente YAML seguro e nunca executa engines", async (t) => {
  const projeto = await projetoTemporario();
  t.after(() => removerProjeto(projeto));
  const { servico, ctas } = await bases();
  for (const engine of ["js", "javascript"]) {
    const fonte = `---${engine}\n(globalThis.cinPayloadExecutado = true)\n---\nTexto`;
    await fs.writeFile(path.join(projeto.editorial, "conteudo/guia/payload.md"), fonte);
    await assert.rejects(() => carregarDocumentos(projeto.editorial, servico, ctas), /somente YAML seguro/);
    assert.equal(globalThis.cinPayloadExecutado, undefined);
  }
  assert.throws(() => lerFrontmatter("---\nx: !!js/function 'function () { return 1; }'\n---\nTexto"));
  assert.deepEqual(lerFrontmatter("---\ntitulo: CIN-\n---\nTexto").data, { titulo: "CIN-" });
});

test("home e pilar usam telefone e horario estruturados e respeitam fatos pendentes", async () => {
  const { servico } = await bases();
  const config = { urlBase: "https://agendamento-cin-itanhandu.web.app" };
  const pilar = { ...documento(dadosValidos({ slug: "cin" })), pilar: true };
  for (const gerar of [() => jsonLdHome(config, servico), () => jsonLdDocumento(pilar, config, servico)]) {
    const grafo = gerar()["@graph"];
    const posto = grafo.find((n) => n["@type"] === "GovernmentOffice");
    assert.equal(posto.telephone, "+553535040397");
    assert.equal(posto.openingHoursSpecification["@type"], "OpeningHoursSpecification");
    assert.equal(posto.openingHoursSpecification.opens, "14:00");
    assert.equal(posto.openingHoursSpecification.closes, "17:00");
    assert.equal(posto.openingHoursSpecification.dayOfWeek.length, 4);
  }
  for (const chave of ["telefone_posto", "horario_atendimento_cin", "aceita_outras_cidades"]) servico.fatos[chave].status = "a_confirmar";
  for (const schema of [jsonLdHome(config, servico), jsonLdDocumento(pilar, config, servico)]) {
    assert.doesNotMatch(JSON.stringify(schema), /telephone|openingHoursSpecification|areaServed/);
  }
});

test("FAQ preserva hifens no texto e no schema", () => {
  const { faq } = extrairFaq("## Perguntas frequentes\n\n**Onde encontro o código CIN-?**\n\nVocê pode salvá-lo em PDF.\n\n**O RG é gratuito?**\n\nA primeira CIN é gratuita.\n\n**Onde agendar?**\n\nNo site.");
  assert.equal(faq[0].pergunta, "Onde encontro o código CIN-?");
  assert.equal(faq[0].resposta, "Você pode salvá-lo em PDF.");
});

test("verificacao e preview nao regravam PENDENCIAS", async (t) => {
  const projeto = await projetoTemporario();
  t.after(() => removerProjeto(projeto));
  await construir({ raizEditorial: projeto.editorial });
  const arquivo = path.join(projeto.editorial, "PENDENCIAS.md");
  await fs.utimes(arquivo, 1000, 1000);
  const antes = await fs.readFile(arquivo);
  await verificar(projeto.editorial);
  await construir({ raizEditorial: projeto.editorial, incluirRascunhos: true, saida: path.join(projeto.raizProjeto, "preview") });
  assert.equal((await fs.stat(arquivo)).mtimeMs, 1000000);
  assert.deepEqual(await fs.readFile(arquivo), antes);
});

test("404 sem guia nao oferece destino inexistente", async (t) => {
  const projeto = await projetoTemporario();
  t.after(() => removerProjeto(projeto));
  await construir({ raizEditorial: projeto.editorial });
  const html = await fs.readFile(path.join(projeto.publicDir, "404.html"), "utf8");
  assert.doesNotMatch(html, /href="\/cin\/"/);
});

test("preview de avisos recebe noindex e nao entra no sitemap", async (t) => {
  const projeto = await projetoTemporario([["teste.md", dadosValidos({ tipo: "aviso", slug: "teste", status: "rascunho" }), "## Aviso\n\nTexto."]]);
  t.after(() => removerProjeto(projeto));
  const saida = path.join(projeto.raizProjeto, "preview");
  await construir({ raizEditorial: projeto.editorial, saida, incluirRascunhos: true });
  for (const arquivo of ["avisos/index.html", "avisos/teste/index.html"]) assert.match(await fs.readFile(path.join(saida, arquivo), "utf8"), /name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(await fs.readFile(path.join(saida, "sitemap.xml"), "utf8"), /\/avisos\//);
  assert.match(await fs.readFile(path.join(saida, "robots.txt"), "utf8"), /Disallow: \//);
});

test("tabelas e blocos possuem nomes acessiveis", () => {
  const { html } = renderizarMarkdown(criarMarkdown(), "## Documentos\n\n| Tipo | Regra |\n|---|---|\n| CIN | Gratuita |\n\n:::local\nOrientação.\n:::");
  assert.match(html, /<caption>Documentos<\/caption>/);
  assert.match(html, /<th scope="col">/);
  assert.match(html, /<aside[^>]*aria-label="Como funciona em Itanhandu"/);
});

test("fontes nao permitem protocolos executaveis e institucional tem escopo limitado", async () => {
  const contexto = await bases();
  for (const url of ["javascript:alert(1)", "data:text/html,teste", "http://example.com"]) {
    const dados = dadosValidos();
    dados.fontes[0].url = url;
    assert.throws(() => validarDocumento(documento(dados), contexto), /HTTPS/);
  }
  assert.throws(() => validarDocumento(documento(dadosValidos({ tipo: "institucional", slug: "pasta-livre" })), contexto), /institucionais permitidos/);
});
