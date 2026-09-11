import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compararSaidas, construir, verificar } from "../scripts/construir.mjs";
import { CORPO_COMPLETO, dadosValidos, projetoTemporario, removerProjeto } from "./auxiliares.mjs";

function documentosTeste() {
  const pilar = dadosValidos({
    slug: "cin",
    titulo: "Como fazer a CIN em Itanhandu",
    titulo_seo: "Como fazer a CIN, o novo RG, em Itanhandu",
    relacionados: []
  });
  const filha = dadosValidos({ slug: "documentos", relacionados: [] });
  const rascunho = dadosValidos({
    status: "rascunho",
    slug: "pagina-em-rascunho",
    titulo: "Página em rascunho do Guia da CIN",
    titulo_seo: "Página em rascunho do Guia da CIN"
  });
  delete rascunho.conferido;
  delete rascunho.conferido_por;
  return [
    ["_pilar.md", pilar, CORPO_COMPLETO],
    ["documentos.md", filha, CORPO_COMPLETO],
    ["pagina-em-rascunho.md", rascunho, CORPO_COMPLETO]
  ];
}

async function ler(arquivo) {
  return fs.readFile(arquivo, "utf8");
}

test("build publica só aprovadas, gera pilar e preserva arquivo fora do escopo", async (t) => {
  const projeto = await projetoTemporario(documentosTeste());
  t.after(() => removerProjeto(projeto));
  await fs.writeFile(path.join(projeto.publicDir, "preservar.txt"), "não remover");
  await fs.mkdir(path.join(projeto.publicDir, "cin", "obsoleto"), { recursive: true });
  await fs.writeFile(path.join(projeto.publicDir, "cin", "obsoleto", "index.html"), "obsoleto");

  const resultado = await construir({ raizEditorial: projeto.editorial, limpar: true });
  assert.equal(resultado.documentos.length, 2);
  await assert.doesNotReject(() => fs.access(path.join(projeto.publicDir, "cin", "index.html")));
  await assert.doesNotReject(() => fs.access(path.join(projeto.publicDir, "cin", "documentos", "index.html")));
  await assert.rejects(() => fs.access(path.join(projeto.publicDir, "cin", "pagina-em-rascunho", "index.html")));
  await assert.rejects(() => fs.access(path.join(projeto.publicDir, "cin", "obsoleto", "index.html")));
  assert.equal(await ler(path.join(projeto.publicDir, "preservar.txt")), "não remover");

  const pilar = await ler(path.join(projeto.publicDir, "cin", "index.html"));
  assert.match(pilar, /href="\/cin\/documentos\/"/);
});

test("rascunhos exigem saída fora de public", async (t) => {
  const projeto = await projetoTemporario(documentosTeste());
  t.after(() => removerProjeto(projeto));
  await assert.rejects(() => construir({ raizEditorial: projeto.editorial, incluirRascunhos: true }), /fora de public/);
  await assert.rejects(() => construir({ raizEditorial: projeto.editorial, incluirRascunhos: true, saida: projeto.publicDir }), /fora de public/);
});

test("HTML gerado é isolado, acessível e fica dentro do orçamento", async (t) => {
  const projeto = await projetoTemporario(documentosTeste());
  t.after(() => removerProjeto(projeto));
  const saida = path.join(projeto.raizProjeto, "revisao");
  await construir({ raizEditorial: projeto.editorial, saida });
  const html = await ler(path.join(saida, "cin", "documentos", "index.html"));
  const css = await ler(path.join(saida, "assets", "cin", "guia.css"));

  assert.ok(Buffer.byteLength(html) <= 60 * 1024);
  assert.ok(Buffer.byteLength(css) <= 15 * 1024);
  for (const proibido of ["firebasejs", "app-check", "recaptcha", "fontawesome", "fonts.googleapis"]) assert.ok(!html.toLowerCase().includes(proibido));
  assert.doesNotMatch(html, /<(?:script|img)[^>]+(?:src)="https?:\/\//i);
  assert.doesNotMatch(html, /<link[^>]+rel="(?:stylesheet|preload|icon|manifest)"[^>]+href="https?:\/\//i);
  assert.match(html, /<html lang="pt-BR">/);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(html, /class="pular-conteudo" href="#conteudo"/);
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
    assert.match(img, /\balt="[^"]*"/);
    assert.match(img, /\bwidth="\d+"/);
    assert.match(img, /\bheight="\d+"/);
  }
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /prefers-reduced-motion/);
});

test("JSON-LD espelha FAQ e datas visíveis sem fatos pendentes", async (t) => {
  const projeto = await projetoTemporario(documentosTeste());
  t.after(() => removerProjeto(projeto));
  const saida = path.join(projeto.raizProjeto, "schema");
  await construir({ raizEditorial: projeto.editorial, saida });
  const html = await ler(path.join(saida, "cin", "documentos", "index.html"));
  const bloco = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(bloco);
  const schema = JSON.parse(bloco[1]);
  const faq = schema["@graph"].find((item) => item["@type"] === "FAQPage");
  const artigo = schema["@graph"].find((item) => item["@type"] === "Article");
  assert.equal(artigo.datePublished, "2026-10-06");
  assert.equal(artigo.dateModified, "2026-10-06");
  assert.match(html, /Publicado em 06\/10\/2026/);
  assert.match(html, /Atualizado em 06\/10\/2026/);
  for (const item of faq.mainEntity) assert.ok(html.includes(item.name));
  const serializado = JSON.stringify(schema);
  assert.ok(!serializado.includes("telephone"));
  assert.ok(!serializado.includes("openingHoursSpecification"));
  const cidades = [...serializado.matchAll(/"addressLocality":"([^"]+)"/g)].map((item) => item[1]);
  assert.ok(cidades.every((cidade) => cidade === "Itanhandu"));
});

test("sitemap e robots contêm somente home e aprovadas", async (t) => {
  const projeto = await projetoTemporario(documentosTeste());
  t.after(() => removerProjeto(projeto));
  const saida = path.join(projeto.raizProjeto, "seo");
  await construir({ raizEditorial: projeto.editorial, saida });
  const mapa = await ler(path.join(saida, "sitemap.xml"));
  const urls = [...mapa.matchAll(/<loc>([^<]+)<\/loc>/g)].map((item) => item[1]);
  assert.deepEqual(urls, [
    "https://agendamento-cin-itanhandu.web.app/",
    "https://agendamento-cin-itanhandu.web.app/cin/",
    "https://agendamento-cin-itanhandu.web.app/cin/documentos/"
  ]);
  assert.ok(!mapa.includes("changefreq"));
  assert.deepEqual([...mapa.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]), ["2026-10-06", "2026-10-06"]);
  assert.ok(!mapa.includes("priority"));
  assert.equal(await ler(path.join(saida, "robots.txt")), "User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://agendamento-cin-itanhandu.web.app/sitemap.xml\n");
});

test("dois builds seguidos são idênticos", async (t) => {
  const projeto = await projetoTemporario(documentosTeste());
  t.after(() => removerProjeto(projeto));
  const a = path.join(projeto.raizProjeto, "a");
  const b = path.join(projeto.raizProjeto, "b");
  await construir({ raizEditorial: projeto.editorial, saida: a });
  await construir({ raizEditorial: projeto.editorial, saida: b });
  assert.deepEqual(await compararSaidas(a, b), []);
});

test("verificar detecta public desatualizado", async (t) => {
  const projeto = await projetoTemporario(documentosTeste());
  t.after(() => removerProjeto(projeto));
  await construir({ raizEditorial: projeto.editorial, limpar: true });
  assert.equal(await verificar(projeto.editorial), true);
  await fs.appendFile(path.join(projeto.publicDir, "robots.txt"), "alterado");
  await assert.rejects(() => verificar(projeto.editorial), /public\/ está desatualizado/);
});

test("modelos de aviso e página institucional geram tipos e caminhos corretos", async (t) => {
  const aviso = dadosValidos({
    tipo: "aviso",
    slug: "mudanca-de-atendimento",
    titulo: "Mudança no atendimento da CIN",
    titulo_seo: "Mudança no atendimento da CIN em Itanhandu",
    relacionados: []
  });
  const sobre = dadosValidos({
    tipo: "institucional",
    slug: "sobre",
    titulo: "Sobre o atendimento da CIN",
    titulo_seo: "Sobre o atendimento da CIN em Itanhandu",
    relacionados: []
  });
  const projeto = await projetoTemporario([
    ["mudanca-de-atendimento.md", aviso, CORPO_COMPLETO],
    ["sobre.md", sobre, "## Quem atende\n\nA Câmara opera o posto e a Polícia Civil emite a CIN."]
  ]);
  t.after(() => removerProjeto(projeto));
  const saida = path.join(projeto.raizProjeto, "modelos");
  await construir({ raizEditorial: projeto.editorial, saida });
  const htmlAviso = await ler(path.join(saida, "avisos", "mudanca-de-atendimento", "index.html"));
  const htmlIndice = await ler(path.join(saida, "avisos", "index.html"));
  const htmlSobre = await ler(path.join(saida, "sobre", "index.html"));
  assert.match(htmlAviso, /"@type": "NewsArticle"/);
  assert.match(htmlIndice, /href="\/avisos\/mudanca-de-atendimento\/"/);
  assert.match(htmlSobre, /"@type": "AboutPage"/);
});
