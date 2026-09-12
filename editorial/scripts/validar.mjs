import fs from "node:fs";
import path from "node:path";
import { contarPalavras, dataISO, linksMarkdown, caminhoDocumento } from "./util.mjs";
import { extrairFaq } from "./faq.mjs";

const CAMPOS = new Set([
  "tipo", "status", "slug", "titulo", "titulo_seo", "descricao", "resposta",
  "publicado", "atualizado", "conferido", "conferido_por", "cluster", "escopos",
  "fatos", "fontes", "cta", "relacionados", "imagem", "imagem_alt", "gerado_por_ia"
]);
const OBRIGATORIOS = [
  "tipo", "status", "slug", "titulo", "titulo_seo", "descricao", "resposta",
  "publicado", "atualizado", "cluster", "escopos", "fatos", "fontes", "cta",
  "relacionados", "gerado_por_ia"
];
const TIPOS = new Set(["guia", "aviso", "institucional"]);
const STATUS = new Set(["rascunho", "revisao", "aprovado"]);
const CLUSTERS = new Set(["antes-de-agendar", "agendamento", "atendimento-e-depois", "regras-e-contexto"]);
const ESCOPOS = new Set(["nacional", "minas", "local"]);
const DOMINIOS = ["gov.br", "mg.gov.br", "planalto.gov.br", "policiacivil.mg.gov.br", "pc.mg.gov.br", "itanhandu.cam.mg.gov.br"];

function erro(arquivo, campo, regra) {
  throw new Error(`${arquivo}: campo ${campo}: ${regra}`);
}

function texto(dados, arquivo, campo) {
  if (typeof dados[campo] !== "string" || !dados[campo].trim()) erro(arquivo, campo, "precisa ser texto não vazio");
}

function dominioPermitido(hostname) {
  return DOMINIOS.some((dominio) => hostname === dominio || hostname.endsWith(`.${dominio}`));
}

export function validarDocumento(documento, contexto) {
  const { arquivo, dados, corpo } = documento;
  for (const campo of Object.keys(dados)) {
    if (!CAMPOS.has(campo)) erro(arquivo, campo, "campo desconhecido");
  }
  for (const campo of OBRIGATORIOS) {
    if (!(campo in dados)) erro(arquivo, campo, "campo obrigatório ausente");
  }

  if (!TIPOS.has(dados.tipo)) erro(arquivo, "tipo", "use guia, aviso ou institucional");
  if (!STATUS.has(dados.status)) erro(arquivo, "status", "use rascunho, revisao ou aprovado");
  if (!CLUSTERS.has(dados.cluster)) erro(arquivo, "cluster", "cluster inválido");
  const pilar = dados.tipo === "guia" && (dados.slug === "cin" || path.basename(arquivo) === "_pilar.md");
  documento.pilar = pilar;
  if (!(pilar && dados.slug === "") && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dados.slug)) {
    erro(arquivo, "slug", "use letras minúsculas, números e hífens");
  }
  if (pilar && !["", "cin"].includes(dados.slug)) erro(arquivo, "slug", "o pilar usa slug vazio ou cin");
  if (dados.tipo === "institucional" && !["sobre", "privacidade"].includes(dados.slug)) erro(arquivo, "slug", "institucionais permitidos: sobre ou privacidade");

  for (const campo of ["titulo", "titulo_seo", "descricao", "resposta"]) texto(dados, arquivo, campo);
  if (dados.titulo_seo.length > 60) erro(arquivo, "titulo_seo", "máximo de 60 caracteres");
  if (dados.descricao.length < 140 || dados.descricao.length > 165) erro(arquivo, "descricao", "use de 140 a 165 caracteres");
  const palavras = contarPalavras(dados.resposta);
  if (palavras < 40 || palavras > 90) erro(arquivo, "resposta", "use de 40 a 90 palavras");
  for (const campo of ["publicado", "atualizado"]) {
    if (!dataISO(dados[campo])) erro(arquivo, campo, "use uma data no formato AAAA-MM-DD");
  }
  if (dados.conferido !== undefined && !dataISO(dados.conferido)) erro(arquivo, "conferido", "use uma data no formato AAAA-MM-DD");
  if (dados.status === "aprovado" && !dataISO(dados.conferido)) erro(arquivo, "conferido", "é obrigatório em conteúdo aprovado");
  if ((dados.status === "aprovado" || dados.gerado_por_ia === true) && !String(dados.conferido_por ?? "").trim()) {
    erro(arquivo, "conferido_por", "é obrigatório em conteúdo aprovado ou gerado por IA");
  }
  if (typeof dados.gerado_por_ia !== "boolean") erro(arquivo, "gerado_por_ia", "use true ou false");

  for (const campo of ["escopos", "fatos", "fontes", "relacionados"]) {
    if (!Array.isArray(dados[campo])) erro(arquivo, campo, "precisa ser uma lista");
  }
  if (dados.escopos.some((item) => !ESCOPOS.has(item))) erro(arquivo, "escopos", "use somente nacional, minas e local");
  if (!contexto.ctas[dados.cta]) erro(arquivo, "cta", "chave não existe em ctas.json");
  for (const chave of dados.fatos) {
    const fato = contexto.servico.fatos[chave];
    if (!fato) erro(arquivo, "fatos", `chave '${chave}' não existe em servico.json`);
    if (dados.status === "aprovado" && fato.status !== "verificado") erro(arquivo, "fatos", `fato '${chave}' ainda não está verificado`);
  }
  for (const fonte of dados.fontes) {
    if (!fonte || typeof fonte !== "object") erro(arquivo, "fontes", "cada fonte precisa ser um objeto");
    for (const campo of ["orgao", "titulo", "url", "consultado"]) {
      if (!fonte[campo]) erro(arquivo, "fontes", `fonte sem '${campo}'`);
    }
    try { if (new URL(fonte.url).protocol !== "https:") throw new Error(); } catch { erro(arquivo, "fontes", `URL HTTPS inválida: ${fonte.url}`); }
    if (!dataISO(fonte.consultado)) erro(arquivo, "fontes", "consultado precisa usar AAAA-MM-DD");
  }
  if (dados.imagem && !dados.imagem_alt) erro(arquivo, "imagem_alt", "é obrigatório quando imagem existe");
  if (dados.imagem && contexto.publicDir) {
    const imagem = path.join(contexto.publicDir, dados.imagem.replace(/^\/+/, ""));
    if (!fs.existsSync(imagem)) erro(arquivo, "imagem", "arquivo não encontrado em public/");
  }
  if (/^#\s+/m.test(corpo)) erro(arquivo, "corpo", "não use H1; o título vem do frontmatter");
  extrairFaq(corpo, arquivo);

  const fontes = new Set(dados.fontes.map((fonte) => new URL(fonte.url).href));
  for (const link of linksMarkdown(corpo)) {
    if (link.startsWith("/")) {
      if (!/^\/$|^\/avisos\/$|^\/sobre\/$|^\/privacidade\/$|^\/cin\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?$/.test(link)) {
        erro(arquivo, "corpo", `link interno fora do formato permitido: ${link}`);
      }
      continue;
    }
    let url;
    try { url = new URL(link); } catch { erro(arquivo, "corpo", `link inválido: ${link}`); }
    if (url.protocol !== "https:" || (!dominioPermitido(url.hostname) && !fontes.has(url.href))) {
      erro(arquivo, "corpo", `link externo não permitido: ${link}`);
    }
  }
  if (dados.status === "aprovado" && JSON.stringify(dados).concat("\n", corpo).includes("[A CONFIRMAR")) {
    erro(arquivo, "corpo", "conteúdo aprovado não pode conter [A CONFIRMAR");
  }
  return documento;
}

export function validarColecao(documentos) {
  const todos = new Map(documentos.map((doc) => [caminhoDocumento(doc), doc]));
  if (todos.size !== documentos.length) throw new Error("coleção: colisão de caminhos entre documentos");
  const aprovados = new Map(documentos.filter((doc) => doc.dados.status === "aprovado").map((doc) => [caminhoDocumento(doc), doc]));
  for (const doc of documentos) {
    const universo = doc.dados.status === "aprovado" ? aprovados : todos;
    for (const slug of doc.dados.relacionados) {
      const alvo = documentos.find((item) => item.dados.slug === slug);
      if (!alvo || (doc.dados.status === "aprovado" && alvo.dados.status !== "aprovado")) {
        erro(doc.arquivo, "relacionados", `slug inexistente ou não publicado: ${slug}`);
      }
    }
    for (const link of linksMarkdown(doc.corpo).filter((item) => item.startsWith("/") && item !== "/")) {
      const existe = link === "/avisos/"
        ? [...universo.values()].some((item) => item.dados.tipo === "aviso")
        : universo.has(link);
      if (!existe) erro(doc.arquivo, "corpo", `link interno inexistente ou não publicado: ${link}`);
    }
  }

  const paginasAprovadas = [...aprovados.values()].filter((doc) => doc.dados.tipo === "guia" && !doc.pilar);
  const pilar = [...aprovados.values()].find((doc) => doc.pilar);
  for (const pagina of paginasAprovadas) {
    const caminho = caminhoDocumento(pagina);
    // O modelo do pilar lista todas as guias aprovadas por cluster.
    const temEntrada = Boolean(pilar) || [...aprovados.values()].some((origem) => origem !== pagina && (
      linksMarkdown(origem.corpo).includes(caminho) || origem.dados.relacionados.includes(pagina.dados.slug)
    ));
    if (!temEntrada) erro(pagina.arquivo, "corpo", "página aprovada órfã, sem link de entrada");
  }
}
