import { esc, dataISO, formatarData, caminhoDocumento } from "../scripts/util.mjs";
import { paginaBase } from "./base.mjs";
import { jsonLdDocumento } from "./jsonld.mjs";
import { faqHtml, fontesHtml, indiceHtml } from "./guia.mjs";
import { NOMES_CLUSTER_BLOG, cartaoHtml, ordenarArtigos } from "./blog.mjs";

const AUTORIA = "Equipe do Posto de Identificação da Câmara Municipal de Itanhandu";
const MAXIMO_RELACIONADOS = 3;

// Mesmo desenho do blog da Sucupira: relacionados declarados primeiro, depois o mesmo tema, depois os mais recentes.
export function artigosRelacionados(documento, documentos) {
  const escolhidos = documento.dados.relacionados.map((slug) => documentos.find((item) => item.dados.slug === slug)).filter(Boolean);
  const artigos = ordenarArtigos(documentos.filter((item) => item.dados.tipo === "artigo" && item !== documento));
  for (const candidato of [...artigos.filter((item) => item.dados.cluster === documento.dados.cluster), ...artigos]) {
    if (escolhidos.length >= MAXIMO_RELACIONADOS) break;
    if (!escolhidos.includes(candidato)) escolhidos.push(candidato);
  }
  return escolhidos;
}

function cabecalho(dados) {
  const atualizado = dataISO(dados.atualizado) !== dataISO(dados.publicado)
    ? ` <span aria-hidden="true">·</span> Atualizado em <time datetime="${dataISO(dados.atualizado)}">${formatarData(dados.atualizado)}</time>`
    : "";
  return `<header class="cabecalho-artigo"><span class="tag-blog">${esc(NOMES_CLUSTER_BLOG[dados.cluster])}</span><h1>${esc(dados.titulo)}</h1><p class="subtitulo-artigo">${esc(dados.descricao)}</p><p class="datas-conteudo">Por ${esc(AUTORIA)} <span aria-hidden="true">·</span> <time datetime="${dataISO(dados.publicado)}">${formatarData(dados.publicado)}</time>${atualizado}</p></header>`;
}

function transparencia(dados) {
  const conferido = dados.conferido ? ` As informações foram conferidas em ${formatarData(dados.conferido)}.` : "";
  return `<aside class="caixa-transparencia" aria-labelledby="transparencia-titulo"><h2 id="transparencia-titulo">Sobre este conteúdo</h2><p>Artigo informativo sobre a regra nacional da Carteira de Identidade Nacional, escrito a partir das normas federais e das páginas oficiais listadas em “Fontes consultadas”.${conferido} Requisitos, taxas e prazos de emissão variam por estado: confirme no órgão de identificação do seu estado antes de ir ao atendimento.</p></aside>`;
}

function relacionadosHtml(itens) {
  if (!itens.length) return "";
  return `<section class="relacionados-blog" aria-labelledby="relacionados-titulo"><h2 id="relacionados-titulo">Leia também</h2><div class="grade-blog">${itens.map((item) => cartaoHtml(item)).join("")}</div></section>`;
}

export function renderizarArtigo({ documento, documentos, config, servico, ctas, renderizado, faq, md, linksInstitucionais }) {
  const caminho = caminhoDocumento(documento);
  const cta = ctas[documento.dados.cta];
  const conteudo = `<article>
      ${cabecalho(documento.dados)}
      <div class="resposta-direta">${esc(documento.dados.resposta)}</div>
      ${indiceHtml(renderizado.indice)}
      <div class="conteudo-editorial">${renderizado.html}</div>
      <aside class="cta-guia" aria-label="Próximo passo"><p>${esc(cta.texto)}</p><a class="botao-guia" href="${esc(cta.destino)}">${esc(cta.rotulo ?? "Saiba mais")}</a></aside>
      ${faqHtml(faq, md)}
      ${transparencia(documento.dados)}
      ${fontesHtml(documento.dados.fontes)}
      ${relacionadosHtml(artigosRelacionados(documento, documentos))}
    </article>`;
  return paginaBase({
    config,
    meta: documento.dados,
    caminho,
    jsonld: jsonLdDocumento(documento, config, servico, faq),
    breadcrumb: [{ nome: "Início", caminho: "/" }, { nome: "Blog", caminho: "/blog/" }, { nome: documento.dados.titulo, caminho }],
    conteudo,
    servico,
    linksInstitucionais,
    ctaFixo: false
  });
}
