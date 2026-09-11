import { caminhoDocumento } from "./util.mjs";

const GRUPOS = ["Recepção", "Polícia Civil de Minas Gerais (PCMG)", "Câmara / decisão institucional", "Prefeituras vizinhas"];

export function gerarPendencias(documentos, servico) {
  const itens = new Map();
  for (const [chave, fato] of Object.entries(servico.fatos)) {
    if (fato.status !== "a_confirmar") continue;
    itens.set(chave, {
      pergunta: fato.pergunta ?? `Confirmar o valor do fato ${chave}.`,
      grupo: fato.responsavel ?? "Câmara / decisão institucional",
      campos: [`fatos.${chave}`],
      paginas: new Set(documentos.filter((doc) => doc.dados.fatos.includes(chave)).map(caminhoDocumento))
    });
  }
  for (const doc of documentos) {
    const texto = JSON.stringify(doc.dados) + "\n" + doc.corpo;
    for (const match of texto.matchAll(/\[A CONFIRMAR:\s*([^\]]+)\]/g)) {
      const pergunta = match[1].trim();
      // A pergunta declarada no fato vincula o marcador sem heuristicas de palavras.
      const encontrado = [...itens.entries()].find(([, item]) => item.pergunta === pergunta);
      const chave = encontrado?.[0] ?? `marcador:${pergunta}`;
      const item = itens.get(chave) ?? { pergunta, grupo: "Câmara / decisão institucional", campos: [], paginas: new Set() };
      item.paginas.add(caminhoDocumento(doc));
      itens.set(chave, item);
    }
  }
  const secoes = GRUPOS.map((grupo) => {
    const linhas = [...itens.values()].filter((item) => item.grupo === grupo).sort((a, b) => a.pergunta.localeCompare(b.pergunta, "pt-BR"));
    return `## ${grupo}\n\n` + (linhas.map((item) =>
      `### ${item.pergunta}\n\n- Páginas afetadas: ${[...item.paginas].sort().map((p) => `\`${p}\``).join(", ") || "nenhuma; decisão ou pesquisa futura"}\n- Campo em servico.json: ${item.campos.map((c) => `\`${c}\``).join(", ") || "definir um fato explícito antes de aprovar"}`
    ).join("\n\n") || "Nenhuma pendência.");
  });
  return "# Pendências editoriais do Guia da CIN\n\nGerado a partir dos fatos pendentes e dos marcadores dos rascunhos. Edite as fontes, não este arquivo.\n\n" + secoes.join("\n\n");
}
