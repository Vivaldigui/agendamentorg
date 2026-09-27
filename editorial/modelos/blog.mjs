import { esc, dataISO, formatarData, caminhoDocumento } from "../scripts/util.mjs";
import { paginaBase } from "./base.mjs";
import { jsonLdIndiceBlog } from "./jsonld.mjs";

export const NOMES_CLUSTER_BLOG = {
  "entendendo-a-cin": "Entendendo a CIN",
  "dados-no-documento": "Dados no documento",
  "casos-especificos": "Casos específicos",
  "uso-e-seguranca": "Uso e segurança"
};

export function ordenarArtigos(artigos) {
  return [...artigos].sort((a, b) => dataISO(b.dados.publicado).localeCompare(dataISO(a.dados.publicado)) || a.dados.slug.localeCompare(b.dados.slug, "pt-BR"));
}

function rotulo(item) {
  return item.dados.tipo === "artigo" ? NOMES_CLUSTER_BLOG[item.dados.cluster] : "Guia da CIN";
}

export function cartaoHtml(item, nivel = "h3") {
  return `<a class="cartao-blog" href="${caminhoDocumento(item)}"><span class="tag-blog">${esc(rotulo(item))}</span><${nivel}>${esc(item.dados.titulo)}</${nivel}><p>${esc(item.dados.descricao)}</p><span class="cartao-rodape"><time datetime="${dataISO(item.dados.publicado)}">${formatarData(item.dados.publicado)}</time><span class="ler-mais">Ler artigo</span></span></a>`;
}

export function renderizarIndiceBlog({ artigos, config, servico, linksInstitucionais }) {
  const meta = {
    status: artigos.every((artigo) => artigo.dados.status === "aprovado") ? "aprovado" : "rascunho",
    titulo: "Blog do RG: tudo sobre a Carteira de Identidade Nacional",
    titulo_seo: "Blog do RG: tudo sobre a nova Carteira de Identidade",
    descricao: "Artigos sobre o RG e a Carteira de Identidade Nacional: o que muda, validade, dados, versão digital, casos específicos e como se proteger de golpes."
  };
  const ordenados = ordenarArtigos(artigos);
  const guia = linksInstitucionais.cin ? '<a class="botao-guia" href="/cin/">Fazer a CIN em Itanhandu</a>' : "";
  const capa = `<section class="capa-blog" aria-labelledby="titulo-blog"><p class="sobretitulo">Conteúdo informativo</p><h1 id="titulo-blog">${esc(meta.titulo)}</h1><p>Regras nacionais do RG e da Carteira de Identidade Nacional explicadas com fonte oficial e data de conferência.</p><div class="capa-acoes">${guia}<span>Requisitos e taxas variam por estado.</span></div></section>`;
  return paginaBase({
    config,
    meta,
    caminho: "/blog/",
    jsonld: jsonLdIndiceBlog(ordenados, config, servico),
    breadcrumb: [{ nome: "Início", caminho: "/" }, { nome: "Blog", caminho: "/blog/" }],
    conteudo: `${capa}<section aria-label="Artigos"><div class="grade-blog">${ordenados.map((item) => cartaoHtml(item, "h2")).join("")}</div></section>`,
    servico,
    linksInstitucionais,
    ctaFixo: false
  });
}
