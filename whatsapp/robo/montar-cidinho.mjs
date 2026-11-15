// Gera whatsapp/robo/cidinho.json: o intermediário do Cidinho no n8n da Câmara.
// Mesmo esquema dos robôs da Sucupira: um webhook interno (só 127.0.0.1) que
// guarda a chave da Anthropic, marca o prompt fixo com cache de 1 h e conta o
// uso. Quem chama (o fluxo de entrada do WhatsApp) manda só a conversa.
//
// Uso: node whatsapp/robo/montar-cidinho.mjs
// Pedido:   POST http://127.0.0.1:5678/webhook/cidinho
//           { "mensagens": [{ "role": "user"|"assistant", "content": "..." }], "contexto": "opcional" }
// Resposta: { "texto": "...", "modelo": "claude-opus-5-5"|"claude-haiku-5-5", "falhou": false }
//           Em falha, "texto" traz a mensagem fixa que manda para a recepção.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const ler = (f) => readFileSync(join(aqui, f), "utf8");
const prompt = ler("prompt.md");
const conhecimento = ler("conhecimento.md");
// O nó Code não aceita export: as funções do núcleo entram como estão, sem a palavra.
const nucleo = ler("nucleo.mjs").replace(/^export /gm, "");

let n = 0;
const uid = () => `c1d00000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const nos = [];
const no = (nome, tipo, versao, posicao, parametros, extra = {}) => {
  nos.push({ id: uid(), name: nome, type: tipo, typeVersion: versao, position: posicao, parameters: parametros, ...extra });
};
const ligacoes = [];
const liga = (de, para, saida = 0) => ligacoes.push({ de, para, saida });

no("Receber pedido", "n8n-nodes-base.webhook", 2, [0, 200], {
  httpMethod: "POST",
  path: "cidinho",
  responseMode: "responseNode",
  options: { ipWhitelist: "127.0.0.1,::1,::ffff:127.0.0.1" }
}, { webhookId: "c1d0a6e2-5b7d-4c11-9a3e-7d2b8e4f1c01", notes: "Só aceita chamadas de dentro do próprio n8n (127.0.0.1).", notesInFlow: true });

no("Agenda agora", "n8n-nodes-base.httpRequest", 4.2, [220, 200], {
  method: "GET",
  url: "https://cin.itanhandu.cam.mg.gov.br/api/agenda-publica",
  options: { timeout: 8000, response: { response: { responseFormat: "json" } } }
}, { onError: "continueRegularOutput", notes: "Se o site não responder, o Cidinho segue sem a agenda do momento.", notesInFlow: true });

const codigoMontar = `// Why Code: monta o pedido à Anthropic com o mesmo núcleo da bateria (whatsapp/robo/nucleo.mjs).
const PROMPT = ${JSON.stringify(prompt)};
const CONHECIMENTO = ${JSON.stringify(conhecimento)};
${nucleo}

const corpoPedido = $('Receber pedido').first().json.body || {};
const brutas = Array.isArray(corpoPedido.mensagens) ? corpoPedido.mensagens : [];
// Só falas válidas, as últimas 20, começando por uma fala da pessoa.
let mensagens = brutas
  .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
  .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
  .slice(-20);
while (mensagens.length && mensagens[0].role !== 'user') mensagens.shift();
if (!mensagens.length || mensagens[mensagens.length - 1].role !== 'user') {
  return [{ json: { invalido: true } }];
}
const agenda = $input.first().json;
const vagas = agenda && Array.isArray(agenda.dias) ? agenda : null;
const contexto = typeof corpoPedido.contexto === 'string' ? corpoPedido.contexto.slice(0, 500) : '';
const { corpo, modelo } = montarPedido({ prompt: PROMPT, conhecimento: CONHECIMENTO, mensagens, contexto, vagas, agora: Date.now() });
return [{ json: { corpo, modelo } }];`;
no("Montar pedido", "n8n-nodes-base.code", 2, [440, 200], { jsCode: codigoMontar });

no("Pedido válido?", "n8n-nodes-base.if", 2.2, [660, 200], {
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
    conditions: [{ id: uid(), leftValue: "={{ $json.invalido === true }}", rightValue: "", operator: { type: "boolean", operation: "false", singleValue: true } }],
    combinator: "and"
  },
  options: {}
});

no("Chamar Anthropic", "n8n-nodes-base.httpRequest", 4.2, [880, 120], {
  method: "POST",
  url: "https://api.anthropic.com/v1/messages",
  authentication: "genericCredentialType",
  genericAuthType: "httpHeaderAuth",
  sendHeaders: true,
  headerParameters: { parameters: [
    { name: "anthropic-version", value: "2023-06-01" },
    // Fallback do servidor: se o Opus recusar, outro modelo responde na mesma chamada.
    // O Haiku aceita o cabeçalho e simplesmente não usa.
    { name: "anthropic-beta", value: "server-side-fallback-2026-07-01" }
  ] },
  sendBody: true,
  specifyBody: "json",
  jsonBody: "={{ JSON.stringify($json.corpo) }}",
  options: { timeout: 60000 }
}, { credentials: { httpHeaderAuth: { id: "CinAnthropic0001", name: "Anthropic do Cidinho" } }, onError: "continueErrorOutput", retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 });

const codigoResposta = `// Why Code: lê a resposta e soma o uso por dia e modelo (staticData), sem guardar texto nem telefone.
const RESPOSTA_DE_FALHA = ${JSON.stringify("Desculpe, não consegui responder agora. 🙏 Para falar com a recepção da Câmara, chame no WhatsApp *(35) 3504-0397*. O agendamento é só pelo site: https://cin.itanhandu.cam.mg.gov.br")};
const r = $input.first().json;
const modelo = $('Montar pedido').first().json.modelo;
const texto = (!r || r.stop_reason === 'refusal') ? '' : (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
const u = (r && r.usage) || {};
const dados = $getWorkflowStaticData('global');
const dia = new Date().toISOString().slice(0, 10);
dados.uso = dados.uso || {};
const chave = dia + ' ' + modelo;
const s = dados.uso[chave] || { chamadas: 0, entrada: 0, cache_leitura: 0, cache_escrita: 0, saida: 0, recusas: 0 };
s.chamadas += 1;
s.entrada += u.input_tokens || 0;
s.cache_leitura += u.cache_read_input_tokens || 0;
s.cache_escrita += u.cache_creation_input_tokens || 0;
s.saida += u.output_tokens || 0;
if (!texto) s.recusas += 1;
dados.uso[chave] = s;
// Guarda só os últimos 60 dias.
for (const k of Object.keys(dados.uso)) if (k.slice(0, 10) < new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)) delete dados.uso[k];
return [{ json: { texto: texto || RESPOSTA_DE_FALHA, modelo: (r && r.model) || modelo, falhou: !texto } }];`;
no("Resposta e uso", "n8n-nodes-base.code", 2, [1100, 60], { jsCode: codigoResposta });

no("Responder", "n8n-nodes-base.respondToWebhook", 1.1, [1320, 60], {
  respondWith: "json",
  responseBody: "={{ JSON.stringify({ texto: $json.texto, modelo: $json.modelo, falhou: $json.falhou }) }}",
  options: { responseCode: 200 }
});

no("Responder falha", "n8n-nodes-base.respondToWebhook", 1.1, [1100, 300], {
  respondWith: "json",
  responseBody: `={{ JSON.stringify({ texto: ${JSON.stringify("Desculpe, não consegui responder agora. 🙏 Para falar com a recepção da Câmara, chame no WhatsApp *(35) 3504-0397*. O agendamento é só pelo site: https://cin.itanhandu.cam.mg.gov.br")}, modelo: '', falhou: true, erro: String(($json.error && ($json.error.message || JSON.stringify($json.error))) || 'pedido inválido').slice(0, 200) }) }}`,
  options: { responseCode: 200 }
});

liga("Receber pedido", "Agenda agora");
liga("Agenda agora", "Montar pedido");
liga("Montar pedido", "Pedido válido?");
liga("Pedido válido?", "Chamar Anthropic", 0);
liga("Pedido válido?", "Responder falha", 1);
liga("Chamar Anthropic", "Resposta e uso", 0);
liga("Chamar Anthropic", "Responder falha", 1);
liga("Resposta e uso", "Responder");

const connections = {};
for (const { de, para, saida } of ligacoes) {
  connections[de] ??= { main: [] };
  while (connections[de].main.length <= saida) connections[de].main.push([]);
  connections[de].main[saida].push({ node: para, type: "main", index: 0 });
}
const fluxo = {
  id: "CinCidinhoIA0001",
  name: "CIN — Cidinho: intermediário da IA (Opus/Haiku com cache)",
  active: false,
  nodes: nos,
  connections,
  // Execuções com sucesso não ficam guardadas: têm o texto da conversa.
  settings: { executionOrder: "v1", timezone: "America/Sao_Paulo", saveDataSuccessExecution: "none", saveDataErrorExecution: "all" },
  pinData: {},
  tags: []
};
writeFileSync(join(aqui, "cidinho.json"), `${JSON.stringify(fluxo, null, 2)}\n`);
console.log(`cidinho.json: ${nos.length} nós, ${ligacoes.length} ligações, ${(JSON.stringify(fluxo).length / 1024).toFixed(0)} KB`);
