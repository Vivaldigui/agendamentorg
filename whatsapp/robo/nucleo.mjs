// Núcleo do Cidinho: escolhe o modelo e monta o pedido à API da Anthropic.
// O mesmo código roda na bateria (rodar-bateria.mjs) e no intermediário do
// n8n (montar-cidinho.mjs copia estas funções para o nó Code; por isso nada
// aqui usa import, require ou APIs que o nó Code não tem).
//
// Cache igual ao dos robôs da Sucupira: regras + base de conhecimento formam
// um bloco FIXO, marcado com cache de 1 h e compartilhado entre todas as
// conversas. Tudo o que muda (data, aviso recebido, agenda do momento) vai
// numa mensagem de sistema no fim, depois do ponto de cache. Cada modelo tem
// o seu cache: o do Opus e o do Haiku ficam quentes separadamente.

export const MODELO_PRINCIPAL = "claude-opus-5-5";
export const MODELO_SIMPLES = "claude-haiku-5-5";

export function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[!.,;:~*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Mensagem "simples" = cumprimento, agradecimento ou confirmação, sem dúvida.
// Qualquer pergunta, número, link ou texto fora da lista vai para o Opus.
const PALAVRAS_SIMPLES = [
  "oi", "oii", "oiii", "ola", "opa", "e ai", "eai", "bom dia", "boa tarde", "boa noite",
  "cidinho", "ok", "okay", "okk", "blz", "beleza", "certo", "ta bom", "ta", "ta certo",
  "tudo bem", "tudo certo", "combinado", "confirmado", "confirmada", "confirmo", "confirmo presenca",
  "vou sim", "vou", "estarei la", "pode deixar", "obrigado", "obrigada", "muito obrigado",
  "muito obrigada", "obg", "brigado", "brigada", "valeu", "vlw", "amem", "deus abencoe",
  "tchau", "ate mais", "ate logo", "sim", "show", "perfeito", "entendi", "entendido",
  "de nada", "otimo", "maravilha", "joia", "certinho", "ah ta", "hum", "kkk", "kkkk"
];

export function mensagemSimples(texto) {
  const bruto = String(texto || "").trim();
  if (!bruto || bruto.includes("?") || bruto.length > 60) return false;
  // Só emoji ou pontuação, sem letra nem número.
  if (!/[\p{L}\p{N}]/u.test(bruto)) return true;
  let resto = ` ${normalizarTexto(bruto)} `;
  if (/\d|http|www/.test(resto)) return false;
  // Remove, das mais longas para as mais curtas, as expressões conhecidas.
  for (const p of [...PALAVRAS_SIMPLES].sort((a, b) => b.length - a.length)) {
    resto = resto.split(` ${p} `).join(" ");
    resto = resto.split(` ${p} `).join(" ");
  }
  // Sobrou alguma palavra fora da lista (ou emoji/símbolo)? Então não é simples.
  return resto.replace(/[^\p{L}\p{N}]+/gu, "").length === 0;
}

export function escolherModelo(mensagens) {
  const ultima = [...(mensagens || [])].reverse().find((m) => m && m.role === "user");
  const texto = ultima ? (typeof ultima.content === "string" ? ultima.content : "") : "";
  return mensagemSimples(texto) ? MODELO_SIMPLES : MODELO_PRINCIPAL;
}

export function blocoAgenda(vagas) {
  if (!vagas) return "";
  const dias = (vagas.dias || [])
    .map((d) => `${d.data}: ${(d.horarios || []).join(", ")}`)
    .join("; ");
  return `Agenda agora (consultada no site neste momento): ${Number(vagas.totalVagasRestantes) || 0} vaga(s) restante(s).`
    + (dias ? ` Dias com vaga: ${dias}.` : " Nenhum dia com vaga.")
    + (vagas.dataNovasVagas ? ` Próxima abertura de vagas: ${vagas.dataNovasVagas}, às 8h.` : "");
}

// Pedido completo à API /v1/messages. "agora" é o instante (ms) da mensagem.
export function montarPedido({ prompt, conhecimento, mensagens, contexto, vagas, agora, modelo }) {
  const escolhido = modelo || escolherModelo(mensagens);
  const hoje = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short" })
    .format(new Date(agora || Date.now()));
  const extras = [`Agora é ${hoje}.`, contexto || "", blocoAgenda(vagas)].filter(Boolean).join("\n");
  const corpo = {
    model: escolhido,
    max_tokens: 1500,
    output_config: { effort: "low" },
    system: [
      { type: "text", text: prompt },
      { type: "text", text: `# Base de conhecimento\n\n${conhecimento}`, cache_control: { type: "ephemeral", ttl: "1h" } }
    ],
    messages: [...mensagens, { role: "system", content: extras }]
  };
  const cabecalhos = {};
  if (escolhido === MODELO_PRINCIPAL) {
    // Recusa do Opus é refeita no servidor por outro modelo, sem a pessoa ficar sem resposta.
    corpo.fallbacks = "default";
    cabecalhos["anthropic-beta"] = "server-side-fallback-2026-07-01";
  }
  return { corpo, cabecalhos, modelo: escolhido };
}

// Texto da resposta. Vazio quando a API recusou ou não devolveu texto.
export function lerResposta(resposta) {
  if (!resposta || resposta.stop_reason === "refusal") return "";
  return (resposta.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

export const RESPOSTA_DE_FALHA = "Desculpe, não consegui responder agora. 🙏 Para falar com a recepção da Câmara, chame no WhatsApp *(35) 3504-0397*. O agendamento é só pelo site: https://cin.itanhandu.cam.mg.gov.br";
