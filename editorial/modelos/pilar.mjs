import { esc, caminhoDocumento } from "../scripts/util.mjs";
import { renderizarGuia } from "./guia.mjs";

const NOMES_CLUSTER = {
  "antes-de-agendar": "Antes de agendar",
  agendamento: "Agendamento",
  "atendimento-e-depois": "Atendimento e depois",
  "regras-e-contexto": "Regras e contexto"
};

export function renderizarPilar(opcoes) {
  const filhas = opcoes.documentos.filter((item) => item.dados.tipo === "guia" && !item.pilar);
  const grupos = Object.entries(NOMES_CLUSTER).map(([cluster, nome]) => {
    const itens = filhas.filter((item) => item.dados.cluster === cluster);
    if (!itens.length) return "";
    return `<section><h3>${esc(nome)}</h3><ul>${itens.map((item) => `<li><a href="${caminhoDocumento(item)}">${esc(item.dados.titulo)}</a></li>`).join("")}</ul></section>`;
  }).filter(Boolean).join("");
  return renderizarGuia({ ...opcoes, aposConteudo: `<div class="lista-pilar">${grupos}</div>` });
}
