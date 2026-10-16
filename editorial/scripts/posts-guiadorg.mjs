// Atualiza os cards "Leia no Guia do RG" da home com os últimos artigos do
// feed do guiadorg.com.br. Os cards ficam em HTML estático, entre os
// marcadores abaixo, para que os links sejam lidos sem JavaScript.
//
// Uso: npm run posts-guiadorg            (busca o feed e grava public/index.html)
//      npm run posts-guiadorg -- --verificar   (só diz se a home está desatualizada)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FEED = "https://guiadorg.com.br/feed.xml";
export const QUANTIDADE = 3;
export const INICIO = "<!-- posts-guiadorg:inicio -->";
export const FIM = "<!-- posts-guiadorg:fim -->";

const RAIZ_PROJETO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOME = path.join(RAIZ_PROJETO, "public", "index.html");

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificar(texto) {
  return texto
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (inteira, nome) => {
      if (nome[0] === "#") {
        const codigo = nome[1].toLowerCase() === "x" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
        return String.fromCodePoint(codigo);
      }
      return ENTIDADES[nome] ?? inteira;
    })
    .trim();
}

function escapar(texto) {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function lerFeed(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const campo = (nome) => decodificar(item.match(new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`))?.[1] ?? "");
    return { titulo: campo("title"), link: campo("link"), resumo: campo("description"), categoria: campo("category") };
  });
}

export function montarCards(artigos) {
  const validos = artigos.filter((a) => a.titulo && /^https:\/\/guiadorg\.com\.br\/artigos\/[a-z0-9-]+\/$/.test(a.link));
  if (validos.length < QUANTIDADE) throw new Error(`o feed trouxe ${validos.length} artigos válidos; são necessários ${QUANTIDADE}`);
  const cards = validos.slice(0, QUANTIDADE).map((a) => `                    <li><a class="post-guiadorg" href="${escapar(a.link)}" target="_blank" rel="noopener">
                        ${a.categoria ? `<span class="post-guiadorg-categoria">${escapar(a.categoria)}</span>\n                        ` : ""}<strong class="post-guiadorg-titulo">${escapar(a.titulo)}</strong>
                        <span class="post-guiadorg-resumo">${escapar(a.resumo)}</span>
                        <span class="post-guiadorg-ler">Ler no Guia do RG <span aria-hidden="true">↗</span><span class="sr-only"> (abre em nova aba)</span></span>
                    </a></li>`);
  return `${INICIO}
                <section class="posts-guiadorg so-preencher" aria-labelledby="titulo-posts-guiadorg">
                <h2 id="titulo-posts-guiadorg" class="posts-guiadorg-titulo-secao">Tire dúvidas sobre o RG no Guia do RG</h2>
                <ul class="posts-guiadorg-lista">
${cards.join("\n")}
                </ul>
                </section>
                ${FIM}`;
}

export function substituirBloco(html, bloco) {
  const inicio = html.indexOf(INICIO);
  const fim = html.indexOf(FIM);
  if (inicio < 0 || fim < inicio) throw new Error("marcadores dos posts do guiadorg não encontrados em public/index.html");
  return html.slice(0, inicio) + bloco + html.slice(fim + FIM.length);
}

async function principal() {
  const resposta = await fetch(FEED);
  if (!resposta.ok) throw new Error(`feed respondeu ${resposta.status}`);
  const bloco = montarCards(lerFeed(await resposta.text()));
  const atual = await fs.readFile(HOME, "utf8");
  const novo = substituirBloco(atual, bloco);
  if (process.argv.includes("--verificar")) {
    console.log(novo === atual ? "Home em dia com o feed do guiadorg." : "Home desatualizada: rode npm run posts-guiadorg.");
    process.exitCode = novo === atual ? 0 : 1;
    return;
  }
  if (novo === atual) return console.log("Nada mudou: a home já mostra os últimos artigos.");
  await fs.writeFile(HOME, novo);
  console.log("public/index.html atualizado com os últimos artigos do guiadorg.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => {
    console.error(`Erro: ${erro.message}`);
    process.exitCode = 1;
  });
}
