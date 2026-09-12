import { caminhoDocumento, dataISO, urlAbsoluta } from "../scripts/util.mjs";

function endereco(servico) {
  const valor = servico.fatos.endereco.valor;
  return {
    "@type": "PostalAddress",
    streetAddress: valor.rua,
    addressLocality: valor.cidade,
    addressRegion: valor.uf,
    postalCode: valor.cep,
    addressCountry: "BR"
  };
}

function organizacoes(config, servico) {
  const base = config.urlBase.replace(/\/$/, "");
  return [
    {
      "@type": "GovernmentOrganization",
      "@id": `${base}/#camara`,
      name: servico.organizacoes.camara.nome,
      url: servico.organizacoes.camara.url,
      address: endereco(servico),
      sameAs: servico.organizacoes.camara.sameAs
    },
    {
      "@type": "GovernmentOrganization",
      "@id": `${base}/#pcmg`,
      name: servico.organizacoes.pcmg.nome,
      url: servico.organizacoes.pcmg.url
    }
  ];
}

function postoEServico(config, servico) {
  const base = config.urlBase.replace(/\/$/, "");
  const posto = {
    "@type": "GovernmentOffice",
    "@id": `${base}/#posto`,
    name: "Posto de Identificação da Câmara Municipal de Itanhandu",
    parentOrganization: { "@id": `${base}/#camara` },
    address: endereco(servico)
  };
  if (servico.fatos.telefone_posto?.status === "verificado") {
    const numero = servico.fatos.telefone_posto.numero;
    if (!/^\+[1-9]\d{7,14}$/.test(numero)) throw new Error("telefone_posto.numero exige formato internacional");
    posto.telephone = numero;
    posto.contactPoint = { "@type": "ContactPoint", telephone: numero, contactType: "Orientações pelo WhatsApp", url: `https://wa.me/${numero.slice(1)}`, availableLanguage: "pt-BR" };
  }
  if (servico.fatos.horario_atendimento_cin?.status === "verificado") {
    const horario = servico.fatos.horario_atendimento_cin;
    const dias = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    if (!Array.isArray(horario.dias) || !horario.dias.length || horario.dias.some((dia) => !dias.has(dia)) || ![horario.abre, horario.fecha].every((hora) => /^([01]\d|2[0-3]):[0-5]\d$/.test(hora))) throw new Error("horario_atendimento_cin exige dias, abre e fecha válidos");
    posto.openingHoursSpecification = { "@type": "OpeningHoursSpecification", dayOfWeek: horario.dias.map((dia) => `https://schema.org/${dia}`), opens: horario.abre, closes: horario.fecha };
  }
  const atendimento = {
    "@type": "GovernmentService",
    "@id": `${base}/#servico`,
    name: "Emissão da Carteira de Identidade Nacional (CIN) em Itanhandu",
    serviceType: "Emissão de documento de identidade",
    provider: { "@id": `${base}/#pcmg` },
    serviceOperator: { "@id": `${base}/#camara` },
    availableChannel: {
      "@type": "ServiceChannel",
      serviceUrl: `${base}/`,
      serviceLocation: { "@id": `${base}/#posto` }
    },
    offers: { "@type": "Offer", price: "0", priceCurrency: "BRL", description: "Primeira via gratuita" }
  };
  if (servico.fatos.aceita_outras_cidades?.status === "verificado") {
    atendimento.areaServed = servico.fatos.aceita_outras_cidades.cidades.map((name) => ({ "@type": "City", name }));
  }
  return [posto, atendimento];
}

function breadcrumb(config, itens) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: itens.map((item, indice) => ({
      "@type": "ListItem",
      position: indice + 1,
      name: item.nome,
      item: urlAbsoluta(config.urlBase, item.caminho)
    }))
  };
}

export function jsonLdHome(config, servico) {
  const base = config.urlBase.replace(/\/$/, "");
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${base}/#site`, url: `${base}/`, name: servico.site.nome, inLanguage: "pt-BR" },
      { "@type": "WebPage", "@id": `${base}/#pagina`, url: `${base}/`, name: "Agendamento de RG - CIN Itanhandu", isPartOf: { "@id": `${base}/#site` }, inLanguage: "pt-BR" },
      ...organizacoes(config, servico),
      ...postoEServico(config, servico)
    ]
  };
}

export function jsonLdDocumento(documento, config, servico, faq = []) {
  const base = config.urlBase.replace(/\/$/, "");
  const caminho = caminhoDocumento(documento);
  const itens = [{ nome: "Início", caminho: "/" }];
  if (documento.dados.tipo === "guia") itens.push({ nome: "Guia da CIN", caminho: "/cin/" });
  if (documento.dados.tipo === "aviso") itens.push({ nome: "Avisos", caminho: "/avisos/" });
  if (!documento.pilar) itens.push({ nome: documento.dados.titulo, caminho });

  const tipo = documento.dados.tipo === "aviso"
    ? "NewsArticle"
    : documento.dados.tipo === "institucional"
      ? (documento.dados.slug === "sobre" ? "AboutPage" : "WebPage")
      : "Article";
  const pagina = {
    "@type": tipo,
    "@id": `${urlAbsoluta(base, caminho)}#conteudo`,
    url: urlAbsoluta(base, caminho),
    name: documento.dados.titulo,
    description: documento.dados.descricao,
    inLanguage: "pt-BR"
  };
  if (["Article", "NewsArticle"].includes(tipo)) {
    pagina.headline = documento.dados.titulo;
    pagina.datePublished = dataISO(documento.dados.publicado);
    pagina.dateModified = dataISO(documento.dados.atualizado);
    pagina.author = { "@id": `${base}/#camara` };
    pagina.publisher = { "@id": `${base}/#camara` };
    pagina.about = { "@id": `${base}/#servico` };
    pagina.citation = documento.dados.fontes.map((fonte) => fonte.url);
  }
  if (documento.dados.imagem) pagina.image = urlAbsoluta(base, documento.dados.imagem);

  const grafo = [...organizacoes(config, servico), breadcrumb(config, itens)];
  if (documento.pilar) grafo.push(...postoEServico(config, servico));
  grafo.push(pagina);
  if (faq.length) {
    grafo.push({
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.pergunta,
        acceptedAnswer: { "@type": "Answer", text: item.resposta }
      }))
    });
  }
  return { "@context": "https://schema.org", "@graph": grafo };
}

export function jsonLdIndiceAvisos(config, servico) {
  const documento = {
    arquivo: "avisos",
    pilar: false,
    dados: {
      tipo: "institucional", slug: "avisos", titulo: "Avisos sobre a CIN",
      descricao: "Avisos com data sobre o atendimento da Carteira de Identidade Nacional na Câmara Municipal de Itanhandu.",
      publicado: "2026-09-11", atualizado: "2026-09-11", fontes: []
    }
  };
  return jsonLdDocumento(documento, config, servico, []);
}
