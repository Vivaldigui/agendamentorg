import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { gerarPendencias } from "../scripts/pendencias.mjs";
import { carregarDocumentos } from "../scripts/construir.mjs";
import { RAIZ } from "./auxiliares.mjs";

test("PENDENCIAS reúne todos os fatos pendentes e marcadores dos rascunhos", async () => {
  const [servico, ctas] = await Promise.all([
    fs.readFile(path.join(RAIZ, "dados", "servico.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(RAIZ, "dados", "ctas.json"), "utf8").then(JSON.parse)
  ]);
  const documentos = await carregarDocumentos(RAIZ, servico, ctas);
  const pendencias = gerarPendencias(documentos, servico);

  for (const [chave, fato] of Object.entries(servico.fatos)) {
    if (fato.status === "a_confirmar") assert.match(pendencias, new RegExp(`fatos\\.${chave}\\b`));
  }
  for (const documento of documentos) {
    const texto = `${JSON.stringify(documento.dados)}\n${documento.corpo}`;
    for (const resultado of texto.matchAll(/\[A CONFIRMAR:\s*([^\]]+)\]/g)) {
      assert.ok(pendencias.includes(resultado[1].trim()), `${documento.arquivo}: marcador ausente`);
    }
  }
  for (const grupo of ["Recepção", "Polícia Civil de Minas Gerais (PCMG)", "Câmara / decisão institucional", "Prefeituras vizinhas"]) {
    assert.ok(pendencias.includes(`## ${grupo}`));
  }
  assert.match(
    pendencias,
    /A Câmara valida a hipótese legal[\s\S]*`fatos\.privacidade_base_legal`/
  );
  assert.match(pendencias, /## Recepção\n\nNenhuma pendência\./);
  assert.doesNotMatch(pendencias, /fatos\.espera_atendimento/);
});
