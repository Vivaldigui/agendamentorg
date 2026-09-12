import { esc, formatarData, caminhoDocumento } from "../scripts/util.mjs";
import { paginaBase } from "./base.mjs";
import { jsonLdDocumento } from "./jsonld.mjs";

export function renderizarAviso({ documento, config, servico, ctas, renderizado, faq, md, linksInstitucionais }) {
  const caminho = caminhoDocumento(documento);
  const cta = ctas[documento.dados.cta];
  const faqHtml = faq.length
    ? `<section class="faq"><h2 id="perguntas-frequentes">Perguntas frequentes</h2>${faq.map((item) => `<article class="faq-item"><h3>${esc(item.pergunta)}</h3>${md.render(item.markdown)}</article>`).join("")}</section>`
    : "";
  const conteudo = `<article><h1>${esc(documento.dados.titulo)}</h1><p class="datas-conteudo">Publicado em ${formatarData(documento.dados.publicado)} · Atualizado em ${formatarData(documento.dados.atualizado)}</p><div class="resposta-direta">${esc(documento.dados.resposta)}</div><div class="conteudo-editorial">${renderizado.html}</div><aside class="cta-guia"><p>${esc(cta.texto)}</p><a class="botao-guia" href="${esc(cta.destino)}">${esc(cta.texto)}</a></aside>${faqHtml}</article>`;
  return paginaBase({
    config,
    meta: documento.dados,
    caminho,
    jsonld: jsonLdDocumento(documento, config, servico, faq),
    breadcrumb: [{ nome: "Início", caminho: "/" }, { nome: "Avisos", caminho: "/avisos/" }, { nome: documento.dados.titulo, caminho }],
    conteudo,
    servico,
    linksInstitucionais
  });
}
