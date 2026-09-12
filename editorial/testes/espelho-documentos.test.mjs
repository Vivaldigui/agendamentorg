import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { RAIZ } from "./auxiliares.mjs";

function semAcentos(texto) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function extrairFuncao(codigo, nome) {
  const inicio = codigo.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1);
  const abre = codigo.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}" && --nivel === 0) return codigo.slice(inicio, i + 1);
  }
  throw new Error(`Fim da função ${nome} não encontrado`);
}

test("as quatro superficies da home espelham categorias definidas em servico.json", async () => {
  const html = await fs.readFile(path.resolve(RAIZ, "..", "public", "index.html"), "utf8");
  const inicioChecklist = html.indexOf('<div class="docs-container compacto">');
  const fimChecklist = html.indexOf("</ul>", inicioChecklist);
  const superficies = [
    html.slice(inicioChecklist, fimChecklist),
    extrairFuncao(html, "abrirDocumentosNecessarios"),
    extrairFuncao(html, "documentosTexto"),
    extrairFuncao(html, "documentosComprovanteHTML")
  ].map(semAcentos);
  const servico = JSON.parse(await fs.readFile(path.join(RAIZ, "dados/servico.json"), "utf8"));
  const categorias = Object.entries(servico.fatos).filter(([, fato]) => fato.termos_espelho);
  assert.equal(categorias.length, 5);
  for (const superficie of superficies) {
    const encontradas = categorias.filter(([, fato]) => fato.termos_espelho.every((termo) => superficie.includes(semAcentos(termo))));
    assert.equal(encontradas.length, categorias.length, `lista incompleta; encontradas: ${encontradas.map(([nome]) => nome).join(", ")}`);
  }
});
