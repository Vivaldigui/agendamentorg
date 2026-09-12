import fs from "node:fs/promises";
import path from "node:path";
import MarkdownIt from "markdown-it";

export function esc(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function semAcentos(valor) {
  return String(valor ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function slugifyHeading(valor) {
  return semAcentos(valor)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function contarPalavras(valor) {
  const texto = String(valor ?? "").trim();
  return texto ? texto.split(/\s+/u).length : 0;
}

export function dataISO(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.valueOf())) {
    return valor.toISOString().slice(0, 10);
  }
  const texto = String(valor ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : "";
}

export function formatarData(valor) {
  const iso = dataISO(valor);
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function caminhoDocumento(documento) {
  const { tipo, slug } = documento.dados;
  if (tipo === "guia") return slug === "cin" || documento.pilar ? "/cin/" : `/cin/${slug}/`;
  if (tipo === "aviso") return `/avisos/${slug}/`;
  return `/${slug}/`;
}

export function urlAbsoluta(urlBase, caminho = "/") {
  return `${String(urlBase).replace(/\/$/, "")}${caminho.startsWith("/") ? caminho : `/${caminho}`}`;
}

export async function listarMarkdown(diretorio) {
  let entradas;
  try {
    entradas = await fs.readdir(diretorio, { withFileTypes: true });
  } catch (erro) {
    if (erro.code === "ENOENT") return [];
    throw erro;
  }
  const arquivos = [];
  for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))) {
    const destino = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...await listarMarkdown(destino));
    if (entrada.isFile() && entrada.name.endsWith(".md")) arquivos.push(destino);
  }
  return arquivos;
}

export async function gravarTexto(arquivo, conteudo) {
  const normalizado = `${String(conteudo).replace(/\r\n?/g, "\n").replace(/^[ \t]+$/gm, "").replace(/\s*$/, "")}\n`;
  await fs.mkdir(path.dirname(arquivo), { recursive: true });
  await fs.writeFile(arquivo, normalizado, "utf8");
  return Buffer.byteLength(normalizado);
}

export function linksMarkdown(corpo) {
  return [...String(corpo).matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)].map((item) => item[1]);
}

export function limparMarkdown(valor) {
  const md = new MarkdownIt({ html: false });
  const texto = (tokens) => tokens.map((token) => {
    if (token.children) return texto(token.children);
    if (["text", "code_inline", "code_block", "fence"].includes(token.type)) return token.content;
    if (token.block || ["softbreak", "hardbreak"].includes(token.type)) return " ";
    return "";
  }).join("");
  return texto(md.parse(String(valor ?? ""), {})).replace(/\s+/g, " ").trim();
}
