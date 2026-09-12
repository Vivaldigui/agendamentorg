import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import { pluginContainers } from "./containers.mjs";
import { extrairFaq } from "./faq.mjs";
import { validarColecao, validarDocumento } from "./validar.mjs";
import { caminhoDocumento, gravarTexto, listarMarkdown, slugifyHeading, urlAbsoluta, esc, dataISO } from "./util.mjs";
import { renderizarGuia } from "../modelos/guia.mjs";
import { renderizarPilar } from "../modelos/pilar.mjs";
import { renderizarAviso } from "../modelos/aviso.mjs";
import { renderizarIndiceAvisos } from "../modelos/avisos.mjs";
import { renderizarInstitucional } from "../modelos/institucional.mjs";
import { renderizarErro404 } from "../modelos/erro404.mjs";
import { gerarPendencias } from "./pendencias.mjs";

const DIRETORIO_ATUAL = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_EDITORIAL = path.resolve(DIRETORIO_ATUAL, "..");
const ARQUIVOS_RAIZ = ["404.html", "robots.txt", "sitemap.xml"];
const DIRETORIOS_GERADOS = ["cin", "avisos", "sobre", "privacidade"];

async function json(arquivo) {
  return JSON.parse(await fs.readFile(arquivo, "utf8"));
}

export function criarMarkdown() {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  md.use(pluginContainers);
  md.renderer.rules.table_open = (tokens, idx) => `<div class="tabela-rolavel"><table><caption>${esc(tokens[idx].meta?.caption ?? "Informações do serviço")}</caption>\n`;
  md.renderer.rules.th_open = () => '<th scope="col">';
  md.renderer.rules.table_close = () => "</table></div>\n";
  return md;
}

export function renderizarMarkdown(md, corpo) {
  const tokens = md.parse(corpo, {});
  const usados = new Map();
  const indice = [];
  let secao = "Informações do serviço";
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "table_open") token.meta = { caption: secao };
    if (token.type !== "heading_open" || !["h2", "h3"].includes(token.tag)) continue;
    const texto = tokens[i + 1]?.content ?? "";
    secao = texto;
    const base = slugifyHeading(texto) || "secao";
    const quantidade = usados.get(base) ?? 0;
    usados.set(base, quantidade + 1);
    const id = quantidade ? `${base}-${quantidade + 1}` : base;
    token.attrSet("id", id);
    if (token.tag === "h2") indice.push({ id, texto });
  }
  return { html: md.renderer.render(tokens, md.options, {}), indice };
}

export function lerFrontmatter(fonte, arquivo = "conteudo") {
  const texto = fonte.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(texto);
  if (!match) throw new Error(`${arquivo}: frontmatter exige delimitadores --- sem linguagem; somente YAML seguro`);
  // Chama apenas o parser YAML seguro; nunca o detector de engines do gray-matter.
  const data = matter.engines.yaml.parse(match[1]);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${arquivo}: frontmatter precisa ser objeto YAML`);
  return { data, content: texto.slice(match[0].length) };
}

export async function carregarDocumentos(raizEditorial, servico, ctas) {
  const conteudoDir = path.join(raizEditorial, "conteudo");
  const arquivos = await listarMarkdown(conteudoDir);
  const publicDir = path.resolve(raizEditorial, "..", "public");
  const documentos = [];
  for (const arquivo of arquivos) {
    const fonte = await fs.readFile(arquivo, "utf8");
    const parsed = lerFrontmatter(fonte, arquivo);
    const documento = {
      arquivo: path.relative(raizEditorial, arquivo).replaceAll(path.sep, "/"),
      arquivoAbsoluto: arquivo,
      dados: parsed.data,
      corpo: parsed.content.replace(/\r\n?/g, "\n").trim()
    };
    validarDocumento(documento, { servico, ctas, publicDir });
    documentos.push(documento);
  }
  validarColecao(documentos);
  return documentos.sort((a, b) => caminhoDocumento(a).localeCompare(caminhoDocumento(b), "pt-BR"));
}

function destinoDocumento(saida, documento) {
  const caminho = caminhoDocumento(documento).replace(/^\/+|\/+$/g, "");
  return path.join(saida, caminho, "index.html");
}

function sitemap(config, documentos, temIndiceAvisos) {
  const entradas = [{ caminho: "/", atualizado: "" }];
  for (const documento of documentos) {
    entradas.push({ caminho: caminhoDocumento(documento), atualizado: dataISO(documento.dados.atualizado) });
  }
  if (temIndiceAvisos) {
    const maisRecente = documentos.filter((item) => item.dados.tipo === "aviso").map((item) => dataISO(item.dados.atualizado)).sort().at(-1) ?? "";
    entradas.push({ caminho: "/avisos/", atualizado: maisRecente });
  }
  entradas.sort((a, b) => a.caminho === "/" ? -1 : b.caminho === "/" ? 1 : a.caminho.localeCompare(b.caminho, "pt-BR"));
  const urls = entradas.map((entrada) => `  <url>\n    <loc>${urlAbsoluta(config.urlBase, entrada.caminho)}</loc>${entrada.atualizado ? `\n    <lastmod>${entrada.atualizado}</lastmod>` : ""}\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

async function limparPublico(saida) {
  for (const diretorio of DIRETORIOS_GERADOS) {
    const alvo = path.resolve(saida, diretorio);
    const relativo = path.relative(saida, alvo);
    if (!relativo || relativo.startsWith("..") || path.isAbsolute(relativo)) throw new Error(`Recusa ao limpar destino fora da saída: ${alvo}`);
    await fs.rm(alvo, { recursive: true, force: true });
  }
  await fs.rm(path.join(saida, "assets", "cin", "guia.css"), { force: true });
}

function extrairLinksHtml(html) {
  return [...html.matchAll(/href="(\/[^"#?]*)/g)].map((item) => item[1]);
}

export async function construir({ raizEditorial = RAIZ_EDITORIAL, saida, incluirRascunhos = false, limpar = false } = {}) {
  const editorial = path.resolve(raizEditorial);
  const publicDir = path.resolve(editorial, "..", "public");
  const destino = path.resolve(saida ?? publicDir);
  const relativoAoPublico = path.relative(publicDir, destino);
  const dentroDoPublico = !relativoAoPublico.startsWith("..") && !path.isAbsolute(relativoAoPublico);
  if (incluirRascunhos && (!saida || dentroDoPublico)) {
    throw new Error("--rascunhos exige --saida apontando para uma pasta fora de public/");
  }

  const [config, servico, ctas] = await Promise.all([
    json(path.join(editorial, "config.json")),
    json(path.join(editorial, "dados", "servico.json")),
    json(path.join(editorial, "dados", "ctas.json"))
  ]);
  const todos = await carregarDocumentos(editorial, servico, ctas);
  if (destino === publicDir && !incluirRascunhos) await gravarTexto(path.join(editorial, "PENDENCIAS.md"), gerarPendencias(todos, servico));
  const documentos = todos.filter((item) => incluirRascunhos || item.dados.status === "aprovado");
  if (limpar && destino === publicDir) await limparPublico(destino);
  await fs.mkdir(destino, { recursive: true });

  const md = criarMarkdown();
  const linksInstitucionais = {
    cin: documentos.some((item) => item.pilar),
    avisos: documentos.some((item) => item.dados.tipo === "aviso"),
    sobre: documentos.some((item) => item.dados.tipo === "institucional" && item.dados.slug === "sobre"),
    privacidade: documentos.some((item) => item.dados.tipo === "institucional" && item.dados.slug === "privacidade")
  };
  const gerados = [];
  for (const documento of documentos) {
    const { corpo, faq } = extrairFaq(documento.corpo, documento.arquivo);
    const renderizado = renderizarMarkdown(md, corpo);
    const opcoes = { documento, documentos, config, servico, ctas, renderizado, faq, md, linksInstitucionais };
    const html = documento.pilar
      ? renderizarPilar(opcoes)
      : documento.dados.tipo === "guia"
        ? renderizarGuia(opcoes)
        : documento.dados.tipo === "aviso"
          ? renderizarAviso(opcoes)
          : renderizarInstitucional(opcoes);
    const arquivo = destinoDocumento(destino, documento);
    const bytes = await gravarTexto(arquivo, html);
    gerados.push({ caminho: caminhoDocumento(documento), arquivo, bytes, html });
  }

  const avisos = documentos.filter((item) => item.dados.tipo === "aviso");
  if (avisos.length) {
    const html = renderizarIndiceAvisos({ avisos, config, servico, linksInstitucionais });
    const arquivo = path.join(destino, "avisos", "index.html");
    const bytes = await gravarTexto(arquivo, html);
    gerados.push({ caminho: "/avisos/", arquivo, bytes, html });
  }

  const tecnicos = [
    ["/404.html", path.join(destino, "404.html"), renderizarErro404(servico, linksInstitucionais.cin)],
    ["/sitemap.xml", path.join(destino, "sitemap.xml"), sitemap(config, documentos.filter((item) => item.dados.status === "aprovado"), avisos.some((item) => item.dados.status === "aprovado"))],
    ["/robots.txt", path.join(destino, "robots.txt"), incluirRascunhos ? "User-agent: *\nDisallow: /" : `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${urlAbsoluta(config.urlBase, "/sitemap.xml")}`]
  ];
  for (const [caminho, arquivo, conteudo] of tecnicos) {
    const bytes = await gravarTexto(arquivo, conteudo);
    gerados.push({ caminho, arquivo, bytes, html: conteudo });
  }
  const cssOrigem = path.join(editorial, "estilo", "guia.css");
  const css = await fs.readFile(cssOrigem, "utf8");
  const cssArquivo = path.join(destino, "assets", "cin", "guia.css");
  const cssBytes = await gravarTexto(cssArquivo, css);
  gerados.push({ caminho: "/assets/cin/guia.css", arquivo: cssArquivo, bytes: cssBytes, html: css });

  const entradas = new Map(gerados.map((item) => [item.caminho, 0]));
  for (const item of gerados) {
    for (const link of extrairLinksHtml(item.html)) {
      if (link !== "/" && !entradas.has(link) && !/^\/assets\//.test(link)) throw new Error(`${item.caminho}: link gerado sem destino: ${link}`);
      if (entradas.has(link)) entradas.set(link, entradas.get(link) + 1);
    }
  }
  return {
    destino,
    documentos,
    gerados: gerados.map((item) => ({
      caminho: item.caminho,
      arquivo: item.arquivo,
      bytes: item.bytes,
      linksSaida: extrairLinksHtml(item.html).length,
      linksEntrada: entradas.get(item.caminho) ?? 0
    }))
  };
}

async function mapaArquivos(diretorio) {
  const mapa = new Map();
  const candidatos = [...ARQUIVOS_RAIZ, "assets/cin/guia.css"];
  for (const diretorioGerado of DIRETORIOS_GERADOS) {
    const raiz = path.join(diretorio, diretorioGerado);
    try {
      for (const arquivo of await listarTodos(raiz)) candidatos.push(path.relative(diretorio, arquivo));
    } catch (erro) {
      if (erro.code !== "ENOENT") throw erro;
    }
  }
  for (const relativo of [...new Set(candidatos)].sort()) {
    try {
      const buffer = await fs.readFile(path.join(diretorio, relativo));
      mapa.set(relativo.replaceAll(path.sep, "/"), crypto.createHash("sha256").update(buffer).digest("hex"));
    } catch (erro) {
      if (erro.code !== "ENOENT") throw erro;
    }
  }
  return mapa;
}

async function listarTodos(diretorio) {
  const arquivos = [];
  for (const entrada of await fs.readdir(diretorio, { withFileTypes: true })) {
    const alvo = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...await listarTodos(alvo));
    if (entrada.isFile()) arquivos.push(alvo);
  }
  return arquivos;
}

export async function compararSaidas(esperada, atual) {
  const [a, b] = await Promise.all([mapaArquivos(esperada), mapaArquivos(atual)]);
  const nomes = [...new Set([...a.keys(), ...b.keys()])].sort();
  return nomes.filter((nome) => a.get(nome) !== b.get(nome));
}

export async function verificar(raizEditorial = RAIZ_EDITORIAL) {
  const temporario = await fs.mkdtemp(path.join(os.tmpdir(), "guia-cin-verificar-"));
  try {
    await construir({ raizEditorial, saida: temporario });
    const publicDir = path.resolve(raizEditorial, "..", "public");
    const diferentes = await compararSaidas(temporario, publicDir);
    if (diferentes.length) throw new Error(`public/ está desatualizado: ${diferentes.join(", ")}`);
    return true;
  } finally {
    await fs.rm(temporario, { recursive: true, force: true });
  }
}

function argumentos(argv) {
  const opcoes = { incluirRascunhos: false, verificar: false, saida: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rascunhos") opcoes.incluirRascunhos = true;
    else if (argv[i] === "--verificar") opcoes.verificar = true;
    else if (argv[i] === "--saida") opcoes.saida = argv[++i];
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  return opcoes;
}

async function principal() {
  const opcoes = argumentos(process.argv.slice(2));
  if (opcoes.verificar) {
    await verificar();
    console.log("public/ corresponde às fontes editoriais.");
    return;
  }
  const resultado = await construir({ saida: opcoes.saida, incluirRascunhos: opcoes.incluirRascunhos, limpar: !opcoes.saida });
  console.log(`Saída: ${resultado.destino}`);
  for (const item of resultado.gerados) {
    console.log(`${item.caminho} — ${item.bytes} bytes — ${item.linksEntrada} links de entrada — ${item.linksSaida} links de saída`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => {
    console.error(erro.message);
    process.exitCode = 1;
  });
}
