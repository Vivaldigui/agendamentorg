import { esc, urlAbsoluta } from "../scripts/util.mjs";

export function serializarJsonLd(valor) {
  return JSON.stringify(valor, null, 2).replace(/</g, "\\u003c");
}

function breadcrumbHtml(itens) {
  return `<nav class="breadcrumb" aria-label="Navegação estrutural"><ol>${itens.map((item, indice) => {
    const atual = indice === itens.length - 1;
    return `<li>${atual ? `<span aria-current="page">${esc(item.nome)}</span>` : `<a href="${esc(item.caminho)}">${esc(item.nome)}</a>`}</li>`;
  }).join("")}</ol></nav>`;
}

export function paginaBase({ config, meta, caminho, jsonld, breadcrumb, conteudo, servico, linksInstitucionais = {} }) {
  const canonical = urlAbsoluta(config.urlBase, caminho);
  const imagem = meta.imagem ? `\n  <meta property="og:image" content="${esc(urlAbsoluta(config.urlBase, meta.imagem))}">\n  <meta property="og:image:alt" content="${esc(meta.imagem_alt)}">\n  <meta name="twitter:image" content="${esc(urlAbsoluta(config.urlBase, meta.imagem))}">\n  <meta name="twitter:image:alt" content="${esc(meta.imagem_alt)}">` : "";
  const analytics = config.analyticsNoGuia
    ? `\n  <script async src="https://www.googletagmanager.com/gtag/js?id=${esc(config.gaId)}"></script>\n  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(config.gaId)}');</script>`
    : "";
  const endereco = servico.fatos.endereco.valor;
  const institucionais = [
    linksInstitucionais.sobre ? '<a href="/sobre/">Sobre o serviço</a>' : "",
    linksInstitucionais.privacidade ? '<a href="/privacidade/">Privacidade</a>' : "",
    '<a href="https://www.instagram.com/camaraitanhandu/">Instagram da Câmara</a>'
  ].filter(Boolean).join(" · ");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(meta.titulo_seo)}</title>
  <meta name="description" content="${esc(meta.descricao)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="${["guia", "aviso"].includes(meta.tipo) ? "article" : "website"}">
  ${meta.status && meta.status !== "aprovado" ? '<meta name="robots" content="noindex, nofollow">' : ""}
  <meta property="og:title" content="${esc(meta.titulo)}">
  <meta property="og:description" content="${esc(meta.descricao)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:locale" content="pt_BR">${imagem}
  <meta name="twitter:card" content="${meta.imagem ? "summary_large_image" : "summary"}">
  <link rel="stylesheet" href="/assets/cin/guia.css">${analytics}
  <script type="application/ld+json">${serializarJsonLd(jsonld)}</script>
</head>
<body>
  <a class="pular-conteudo" href="#conteudo">Pular para o conteúdo</a>
  <header class="topo-guia">
    <div class="topo-guia-interno">
      <a class="marca-guia" href="/" aria-label="Agendamento CIN — início"><img src="/assets/header-logo.png" alt="Câmara Municipal de Itanhandu" width="514" height="120"></a>
      <nav class="nav-guia" aria-label="Principal">${linksInstitucionais.cin ? '<a href="/cin/">Guia da CIN</a>' : ""}${linksInstitucionais.avisos ? '<a href="/avisos/">Avisos</a>' : ""}<a class="acao-topo" href="/">Agendar</a></nav>
    </div>
  </header>
  <main id="conteudo" class="pagina-guia">
    <div class="coluna-leitura">
      ${breadcrumbHtml(breadcrumb)}
      ${conteudo}
    </div>
  </main>
  <footer class="rodape-guia"><div class="rodape-guia-interno"><strong>${esc(servico.organizacoes.camara.nome)}</strong><br>${esc(endereco.rua)}, ${esc(endereco.bairro)}, ${esc(endereco.cidade)} — ${esc(endereco.uf)}<p>${institucionais}</p></div></footer>
  <a class="cta-fixo" href="/">Agendar atendimento</a>
</body>
</html>`;
}
