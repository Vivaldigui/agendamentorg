import { esc } from "../scripts/util.mjs";
import { paginaBase } from "./base.mjs";
import { jsonLdIndiceAvisos } from "./jsonld.mjs";

export function renderizarIndiceAvisos({ avisos, config, servico, linksInstitucionais }) {
  const meta = {
    status: avisos.every((aviso) => aviso.dados.status === "aprovado") ? "aprovado" : "rascunho",
    titulo: "Avisos sobre a CIN em Itanhandu",
    titulo_seo: "Avisos sobre a CIN em Itanhandu",
    descricao: "Avisos com data sobre o atendimento da Carteira de Identidade Nacional na Câmara Municipal de Itanhandu e mudanças que afetam o cidadão."
  };
  const lista = avisos.map((aviso) => `<li><a href="/avisos/${esc(aviso.dados.slug)}/">${esc(aviso.dados.titulo)}</a></li>`).join("");
  return paginaBase({
    config,
    meta,
    caminho: "/avisos/",
    jsonld: jsonLdIndiceAvisos(config, servico),
    breadcrumb: [{ nome: "Início", caminho: "/" }, { nome: "Avisos", caminho: "/avisos/" }],
    conteudo: `<article><h1>${meta.titulo}</h1><div class="resposta-direta">Mudanças pontuais no atendimento e nas regras da CIN são publicadas aqui com data e fonte.</div><ul>${lista}</ul></article>`,
    servico,
    linksInstitucionais
  });
}
