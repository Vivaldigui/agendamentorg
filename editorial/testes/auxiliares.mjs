import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DESCRICAO = "Certidão original, CPF e o que mais levar ao atendimento da CIN na Câmara de Itanhandu, com os casos de casados, divorciados, viúvos e crianças.";
export const RESPOSTA = "Para fazer a CIN em Itanhandu, confira primeiro os documentos exigidos e os dados de quem será atendido. O serviço funciona no Posto de Identificação da Câmara Municipal, enquanto a emissão do documento cabe à Polícia Civil de Minas Gerais. Leia as orientações e confirme qualquer regra local ainda pendente antes de agendar.";

export function dadosValidos(sobrescrever = {}) {
  return {
    tipo: "guia",
    status: "aprovado",
    slug: "documentos",
    titulo: "Documentos para fazer a CIN em Itanhandu",
    titulo_seo: "Documentos para fazer a CIN em Itanhandu (MG)",
    descricao: DESCRICAO,
    resposta: RESPOSTA,
    publicado: "2026-10-06",
    atualizado: "2026-10-06",
    conferido: "2026-10-06",
    conferido_por: "Recepção do Posto de Identificação",
    cluster: "antes-de-agendar",
    escopos: ["nacional", "minas", "local"],
    fatos: ["orgao_emissor", "endereco", "primeira_via", "prazo_emissao"],
    fontes: [{
      orgao: "Governo de Minas Gerais",
      titulo: "Obter Carteira de Identidade Nacional",
      url: "https://www.mg.gov.br/servico/obter-carteira-de-identidade-nacional",
      consultado: "2026-09-11"
    }],
    cta: "ver-datas",
    relacionados: [],
    gerado_por_ia: false,
    ...sobrescrever
  };
}

export function documento(dados = dadosValidos(), corpo = "## Orientação\n\nTexto da orientação.", arquivo = "conteudo/guia/documentos.md") {
  return { arquivo, dados, corpo };
}

export async function bases() {
  const [servico, ctas] = await Promise.all([
    fs.readFile(path.join(RAIZ, "dados", "servico.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(RAIZ, "dados", "ctas.json"), "utf8").then(JSON.parse)
  ]);
  return { servico, ctas, publicDir: path.resolve(RAIZ, "..", "public") };
}

export async function projetoTemporario(documentos = []) {
  const raizProjeto = await fs.mkdtemp(path.join(os.tmpdir(), "guia-cin-teste-"));
  const editorial = path.join(raizProjeto, "editorial");
  const publicDir = path.join(raizProjeto, "public");
  await Promise.all([
    fs.mkdir(path.join(editorial, "dados"), { recursive: true }),
    fs.mkdir(path.join(editorial, "conteudo", "guia"), { recursive: true }),
    fs.mkdir(path.join(editorial, "conteudo", "avisos"), { recursive: true }),
    fs.mkdir(path.join(editorial, "conteudo", "paginas"), { recursive: true }),
    fs.mkdir(path.join(editorial, "estilo"), { recursive: true }),
    fs.mkdir(publicDir, { recursive: true })
  ]);
  const [servico, ctas, css] = await Promise.all([
    fs.readFile(path.join(RAIZ, "dados", "servico.json"), "utf8"),
    fs.readFile(path.join(RAIZ, "dados", "ctas.json"), "utf8"),
    fs.readFile(path.join(RAIZ, "estilo", "guia.css"), "utf8")
  ]);
  await Promise.all([
    fs.writeFile(path.join(editorial, "config.json"), JSON.stringify({ urlBase: "https://agendamento-cin-itanhandu.web.app", gaId: "G-TESTE", analyticsNoGuia: false }, null, 2)),
    fs.writeFile(path.join(editorial, "dados", "servico.json"), servico),
    fs.writeFile(path.join(editorial, "dados", "ctas.json"), ctas),
    fs.writeFile(path.join(editorial, "estilo", "guia.css"), css)
  ]);
  for (const [nome, dados, corpo] of documentos) {
    const grupo = dados.tipo === "aviso" ? "avisos" : dados.tipo === "institucional" ? "paginas" : "guia";
    await fs.writeFile(path.join(editorial, "conteudo", grupo, nome), matter.stringify(corpo, dados), "utf8");
  }
  return { raizProjeto, editorial, publicDir };
}

export async function removerProjeto(projeto) {
  await fs.rm(projeto.raizProjeto, { recursive: true, force: true });
}

export const CORPO_COMPLETO = `## Primeira orientação

Texto direto sobre a primeira orientação.

## Segunda orientação

Texto direto sobre a segunda orientação.

:::local
Esta prática descreve somente o atendimento em Itanhandu.
:::

## Terceira orientação

Texto direto sobre a terceira orientação.

## Quarta orientação

Texto direto sobre a quarta orientação.

## Perguntas frequentes

**Qual documento devo levar?**

Leve os documentos indicados para o seu caso.

**Quem emite a CIN?**

A Polícia Civil de Minas Gerais emite a CIN.

**Onde é o atendimento?**

O atendimento ocorre na Câmara Municipal de Itanhandu.`;
