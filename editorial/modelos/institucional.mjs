import { esc, formatarData, caminhoDocumento } from "../scripts/util.mjs";
import { paginaBase } from "./base.mjs";
import { jsonLdDocumento } from "./jsonld.mjs";

export function renderizarInstitucional({ documento, config, servico, renderizado, faq, linksInstitucionais }) {
  const caminho = caminhoDocumento(documento);
  const conteudo = `<article><h1>${esc(documento.dados.titulo)}</h1><p class="datas-conteudo">Atualizado em ${formatarData(documento.dados.atualizado)}</p><div class="resposta-direta">${esc(documento.dados.resposta)}</div><div class="conteudo-editorial">${renderizado.html}</div></article>`;
  return paginaBase({
    config,
    meta: documento.dados,
    caminho,
    jsonld: jsonLdDocumento(documento, config, servico, faq),
    breadcrumb: [{ nome: "Início", caminho: "/" }, { nome: documento.dados.titulo, caminho }],
    conteudo,
    servico,
    linksInstitucionais
  });
}
