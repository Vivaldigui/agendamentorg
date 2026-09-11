import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { carregarDocumentos } from "../scripts/construir.mjs";
import { caminhoDocumento } from "../scripts/util.mjs";
import { bases, RAIZ } from "./auxiliares.mjs";

test("lote aprovado tem metadados unicos, destinos existentes e nenhum marcador", async () => {
  const contexto = await bases();
  const documentos = await carregarDocumentos(RAIZ, contexto.servico, contexto.ctas);
  const aprovados = documentos.filter((doc) => doc.dados.status === "aprovado");
  assert.equal(aprovados.length, 11);
  assert.equal(new Set(aprovados.map((doc) => doc.dados.titulo_seo)).size, 11);
  assert.equal(new Set(aprovados.map((doc) => doc.dados.descricao)).size, 11);
  for (const doc of aprovados) {
    const url = caminhoDocumento(doc);
    const html = await fs.readFile(path.join(contexto.publicDir, url, "index.html"), "utf8");
    assert.doesNotMatch(html, /\[A CONFIRMAR|noindex|recepção ainda deve/);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, /property="og:image"/);
    assert.ok(Buffer.byteLength(html) <= 60 * 1024);
    for (const [, destino] of html.matchAll(/href="(\/[^"#?]*)/g)) {
      const arquivo = destino.endsWith("/") ? `${destino}index.html` : destino;
      await fs.access(path.join(contexto.publicDir, arquivo));
    }
    const jsonld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
    const faq = jsonld["@graph"].find((n) => n["@type"] === "FAQPage");
    if (faq) for (const pergunta of faq.mainEntity) assert.ok(html.includes(pergunta.name.replaceAll("&", "&amp;").replaceAll('"', "&quot;")), pergunta.name);
  }
  await assert.rejects(() => fs.access(path.join(contexto.publicDir, "privacidade/index.html")));
  const sitemap = await fs.readFile(path.join(contexto.publicDir, "sitemap.xml"), "utf8");
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 12);
  assert.doesNotMatch(sitemap, /privacidade|avisos/);
});
