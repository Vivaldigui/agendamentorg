// Roda a bateria de perguntas (perguntas.json) contra o Cidinho (prompt.md +
// conhecimento.md, montados por nucleo.mjs, o mesmo código do intermediário
// do n8n) e grava as respostas e a conferência em resultados/.
//
// Uso (na pasta whatsapp/robo, depois de npm install):
//   ANTHROPIC_API_KEY=... [MODELO=auto|claude-opus-5-5|claude-haiku-5-5] node rodar-bateria.mjs [filtro-de-id]
// MODELO=auto (padrão) faz como o robô: Haiku nas mensagens simples, Opus no resto.
// A chave nunca fica no repositório.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { montarPedido, lerResposta } from "./nucleo.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const ler = (f) => fs.readFileSync(path.join(aqui, f), "utf8");
const MODELO = process.env.MODELO || "auto";
const filtro = process.argv[2] || "";

const prompt = ler("prompt.md");
const conhecimento = ler("conhecimento.md");
const { casos } = JSON.parse(ler("perguntas.json"));

const client = new Anthropic({
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined
});

// "PROXIMA_SEGUNDA" nos casos vira a data real da próxima segunda-feira.
function proximaSegunda() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d.toLocaleDateString("pt-BR");
}

function conferir(caso, texto) {
  const falhas = [];
  for (const p of caso.deve || []) if (!new RegExp(p, "iu").test(texto)) falhas.push(`faltou /${p}/`);
  for (const p of caso.nao_deve || []) if (new RegExp(p, "iu").test(texto)) falhas.push(`não podia ter /${p}/`);
  const palavras = texto.trim().split(/\s+/).length;
  if (caso.max_palavras && palavras > caso.max_palavras) falhas.push(`${palavras} palavras (máx. ${caso.max_palavras})`);
  return { ok: falhas.length === 0, falhas, palavras };
}

async function responder(caso) {
  const mensagens = caso.historico ? [...caso.historico] : [{ role: "user", content: caso.mensagem }];
  const vagas = caso.vagas && caso.vagas.dataNovasVagas === "PROXIMA_SEGUNDA"
    ? { ...caso.vagas, dataNovasVagas: proximaSegunda() }
    : caso.vagas;
  const { corpo, cabecalhos, modelo } = montarPedido({
    prompt, conhecimento, mensagens, contexto: caso.contexto, vagas,
    agora: Date.now(), modelo: MODELO === "auto" ? undefined : MODELO
  });
  const r = await client.beta.messages.create(corpo, { headers: cabecalhos });
  return { texto: lerResposta(r), recusa: r.stop_reason === "refusal", usage: r.usage, modelo, modeloQueRespondeu: r.model };
}

const selecionados = casos.filter((c) => !filtro || c.id.startsWith(filtro));
const resultados = [];
const fila = [...selecionados];
async function processar(caso) {
  try {
    const resposta = await responder(caso);
    resultados.push({ id: caso.id, categoria: caso.categoria, mensagem: caso.mensagem || caso.historico.at(-1).content, ...resposta, conferencia: conferir(caso, resposta.texto) });
  } catch (e) {
    resultados.push({ id: caso.id, categoria: caso.categoria, erro: `${e.status || ""} ${e.message}`.slice(0, 300) });
  }
  process.stdout.write(".");
}
async function trabalhador() {
  while (fila.length) await processar(fila.shift());
}
// Aquece o cache de cada modelo antes de abrir em paralelo.
if (fila.length) await processar(fila.shift());
await Promise.all([1, 2, 3, 4].map(() => trabalhador()));
console.log("");

resultados.sort((a, b) => a.id.localeCompare(b.id));
const ok = resultados.filter((r) => r.conferencia && r.conferencia.ok).length;
const uso = {};
for (const r of resultados) {
  if (!r.usage) continue;
  const u = r.usage;
  const s = (uso[r.modelo] ||= { chamadas: 0, entrada: 0, cache_leitura: 0, cache_escrita: 0, saida: 0 });
  s.chamadas += 1; s.entrada += u.input_tokens || 0; s.cache_leitura += u.cache_read_input_tokens || 0;
  s.cache_escrita += u.cache_creation_input_tokens || 0; s.saida += u.output_tokens || 0;
}

const pasta = path.join(aqui, "resultados");
fs.mkdirSync(pasta, { recursive: true });
const carimbo = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${MODELO}`;
fs.writeFileSync(path.join(pasta, `${carimbo}.json`), JSON.stringify({ modelo: MODELO, ok, total: resultados.length, uso, resultados }, null, 2));
const linhas = [`# Bateria ${carimbo}`, "", `${ok} de ${resultados.length} dentro do esperado.`, "", "Uso por modelo: `" + JSON.stringify(uso) + "`", ""];
for (const r of resultados) {
  const marca = r.erro ? "ERRO" : r.conferencia.ok ? "ok" : "REVER";
  linhas.push(`## ${r.id} (${r.categoria}) — ${marca}${r.modelo ? ` — ${r.modelo}` : ""}`, "", `> ${String(r.mensagem).replace(/\n/g, " ")}`, "");
  if (r.erro) linhas.push(r.erro, "");
  else {
    linhas.push(r.texto || "(sem texto)", "");
    if (!r.conferencia.ok) linhas.push(`**Conferência:** ${r.conferencia.falhas.join("; ")}`, "");
  }
}
fs.writeFileSync(path.join(pasta, `${carimbo}.md`), linhas.join("\n"));
console.log(`${ok}/${resultados.length} ok. Uso: ${JSON.stringify(uso)}. Relatório: resultados/${carimbo}.md`);
