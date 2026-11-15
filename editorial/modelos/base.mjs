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

export function paginaBase({ config, meta, caminho, jsonld, breadcrumb, conteudo, servico, linksInstitucionais = {}, ctaFixo = true }) {
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
  ${ctaFixo ? '<a class="cta-fixo" href="/">Agendar atendimento</a>' : ""}
  <a class="zap-duvidas" href="https://wa.me/5535984215361?text=Ol%C3%A1!%20Tenho%20uma%20d%C3%BAvida%20sobre%20o%20RG." target="_blank" rel="noopener noreferrer" aria-label="Tirar dúvidas pelo WhatsApp da CIN, (35) 98421-5361"><svg viewBox="0 0 448 512" width="26" height="26" aria-hidden="true" focusable="false"><path fill="currentColor" d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg><span>Dúvidas? <strong>WhatsApp</strong></span></a>
</body>
</html>`;
}
