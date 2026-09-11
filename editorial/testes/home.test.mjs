import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { serializarJsonLd } from "../modelos/base.mjs";
import { jsonLdHome } from "../modelos/jsonld.mjs";
import { RAIZ } from "./auxiliares.mjs";

test("a home tem canonical absoluta e JSON-LD igual ao módulo editorial", async () => {
  const raizProjeto = path.resolve(RAIZ, "..");
  const [html, configTexto, servicoTexto] = await Promise.all([
    fs.readFile(path.join(raizProjeto, "public", "index.html"), "utf8"),
    fs.readFile(path.join(RAIZ, "config.json"), "utf8"),
    fs.readFile(path.join(RAIZ, "dados", "servico.json"), "utf8")
  ]);
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>") + 7);
  const canonical = '<link rel="canonical" href="https://agendamento-cin-itanhandu.web.app/">';
  const blocos = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

  assert.equal(head.split(canonical).length - 1, 1);
  assert.equal(blocos.length, 1);
  assert.equal(
    blocos[0][1].trim(),
    serializarJsonLd(jsonLdHome(JSON.parse(configTexto), JSON.parse(servicoTexto)))
  );
  assert.match(head, /<meta property="og:image" content="https:\/\/agendamento-cin-itanhandu\.web\.app\/assets\/cin\/guia-social\.png">/);
  const corpoEstatico = html.slice(html.indexOf("<body"), html.indexOf("<script", html.indexOf("<body")));
  assert.equal((corpoEstatico.match(/<h1\b/g) ?? []).length, 1);
  for (const caminho of ["cin", "cin/documentos", "cin/como-agendar"]) {
    assert.ok(corpoEstatico.includes(`href="/${caminho}/"`));
    await fs.access(path.join(raizProjeto, "public", caminho, "index.html"));
  }
});
