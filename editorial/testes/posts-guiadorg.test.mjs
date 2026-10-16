import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { FIM, INICIO, QUANTIDADE, lerFeed, montarCards, substituirBloco } from "../scripts/posts-guiadorg.mjs";
import { RAIZ } from "./auxiliares.mjs";

const item = (slug, titulo) => `<item><title>${titulo}</title><link>https://guiadorg.com.br/artigos/${slug}/</link>
<description>Resumo de ${slug}</description><category>Documentação</category></item>`;

test("lê o feed e monta só os últimos artigos, com texto escapado", () => {
  const xml = `<rss><channel>${item("a", "RG &amp; CPF")}${item("b", "B")}${item("c", "C")}${item("d", "D")}</channel></rss>`;
  const artigos = lerFeed(xml);
  assert.equal(artigos[0].titulo, "RG & CPF");
  const bloco = montarCards(artigos);
  assert.ok(bloco.startsWith(INICIO) && bloco.endsWith(FIM));
  assert.equal((bloco.match(/<a class="post-guiadorg"/g) ?? []).length, QUANTIDADE);
  assert.ok(bloco.includes("RG &amp; CPF"));
  assert.ok(!bloco.includes("/artigos/d/"));
});

test("recusa feed com poucos artigos ou link fora do guiadorg", () => {
  const xml = item("a", "A") + item("b", "B") + item("c", "C").replace("guiadorg.com.br", "exemplo.com");
  assert.throws(() => montarCards(lerFeed(xml)), /artigos válidos/);
});

test("substitui só o que está entre os marcadores", () => {
  const html = `antes ${INICIO} velho ${FIM} depois`;
  assert.equal(substituirBloco(html, `${INICIO}novo${FIM}`), `antes ${INICIO}novo${FIM} depois`);
  assert.throws(() => substituirBloco("sem marcadores", "x"), /marcadores/);
});

test("a home tem os cards do guiadorg logo abaixo dos botões do formulário", async () => {
  const html = await fs.readFile(path.join(RAIZ, "..", "public", "index.html"), "utf8");
  const bloco = html.slice(html.indexOf(INICIO), html.indexOf(FIM));
  const links = [...bloco.matchAll(/<a class="post-guiadorg" href="([^"]+)" target="_blank" rel="noopener">/g)];
  assert.equal(links.length, QUANTIDADE);
  for (const [, href] of links) assert.match(href, /^https:\/\/guiadorg\.com\.br\/artigos\/[a-z0-9-]+\/$/);
  assert.ok(html.indexOf('id="btnContinuarDados"') < html.indexOf(INICIO));
  assert.ok(html.indexOf(FIM) < html.indexOf('id="sucesso-docs"'));
  assert.match(bloco, /class="posts-guiadorg so-preencher"/);
});
