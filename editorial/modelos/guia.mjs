import { esc, formatarData, caminhoDocumento } from "../scripts/util.mjs";
import { paginaBase } from "./base.mjs";
import { jsonLdDocumento } from "./jsonld.mjs";

function datas(dados) {
  const conferido = dados.conferido ? ` · Informações conferidas em ${formatarData(dados.conferido)}` : "";
  return `<p class="datas-conteudo">Publicado em ${formatarData(dados.publicado)} · Atualizado em ${formatarData(dados.atualizado)}${conferido}</p>`;
}

function ficha(servico) {
  const fatos = servico.fatos;
  const endereco = fatos.endereco.valor;
  const itens = [
    ["Serviço", "Emissão da Carteira de Identidade Nacional (CIN)"],
    ["Órgão emissor", fatos.orgao_emissor.valor],
    ["Local", `${endereco.rua}, ${endereco.bairro}, ${endereco.cidade} — ${endereco.uf}`],
    ["Quem atende", fatos.operador_posto.valor],
    ["Primeira via", fatos.primeira_via.valor],
    ["Prazo informado", fatos.prazo_emissao.valor]
  ];
  return `<section class="ficha-servico" aria-labelledby="ficha-titulo"><h2 id="ficha-titulo">Ficha do serviço</h2><dl>${itens.map(([termo, valor]) => `<div><dt>${esc(termo)}</dt><dd>${esc(valor)}</dd></div>`).join("")}</dl></section>`;
}

function indiceHtml(indice) {
  if (indice.length < 4) return "";
  return `<nav class="indice" aria-labelledby="indice-titulo"><h2 id="indice-titulo">Nesta página</h2><ol>${indice.map((item) => `<li><a href="#${esc(item.id)}">${esc(item.texto)}</a></li>`).join("")}</ol></nav>`;
}

function faqHtml(faq, md) {
  if (!faq.length) return "";
  return `<section class="faq" aria-labelledby="perguntas-frequentes"><h2 id="perguntas-frequentes">Perguntas frequentes</h2>${faq.map((item) => `<article class="faq-item"><h3>${esc(item.pergunta)}</h3>${md.render(item.markdown)}</article>`).join("")}</section>`;
}

function fontesHtml(fontes) {
  if (!fontes.length) return "";
  return `<section class="fontes"><h2>Fontes consultadas</h2><ul>${fontes.map((fonte) => `<li><a href="${esc(fonte.url)}">${esc(fonte.titulo)}</a> — ${esc(fonte.orgao)}. Consultado em ${formatarData(fonte.consultado)}.</li>`).join("")}</ul></section>`;
}

function relacionadosHtml(documento, documentos) {
  const relacionados = documento.dados.relacionados.map((slug) => documentos.find((item) => item.dados.slug === slug)).filter(Boolean);
  if (!relacionados.length) return "";
  return `<section class="relacionados"><h2>Leia também</h2><ul>${relacionados.map((item) => `<li><a href="${caminhoDocumento(item)}">${esc(item.dados.titulo)}</a></li>`).join("")}</ul></section>`;
}

export function renderizarGuia({ documento, documentos, config, servico, ctas, renderizado, faq, md, linksInstitucionais, aposConteudo = "" }) {
  const caminho = caminhoDocumento(documento);
  const cta = ctas[documento.dados.cta];
  const breadcrumb = [{ nome: "Início", caminho: "/" }, { nome: "Guia da CIN", caminho: "/cin/" }];
  if (!documento.pilar) breadcrumb.push({ nome: documento.dados.titulo, caminho });
  const conteudo = `<article>
      <h1>${esc(documento.dados.titulo)}</h1>
      ${datas(documento.dados)}
      <div class="resposta-direta">${esc(documento.dados.resposta)}</div>
      ${ficha(servico)}
      ${indiceHtml(renderizado.indice)}
      <div class="conteudo-editorial">${renderizado.html}</div>
      ${aposConteudo}
      <aside class="cta-guia" aria-label="Próximo passo"><p>${esc(cta.texto)}</p><a class="botao-guia" href="${esc(cta.destino)}">${esc(cta.rotulo ?? "Ver datas disponíveis")}</a></aside>
      ${faqHtml(faq, md)}
      ${fontesHtml(documento.dados.fontes)}
      ${relacionadosHtml(documento, documentos)}
    </article>`;
  return paginaBase({
    config,
    meta: documento.dados,
    caminho,
    jsonld: jsonLdDocumento(documento, config, servico, faq),
    breadcrumb,
    conteudo,
    servico,
    linksInstitucionais
  });
}
