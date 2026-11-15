// Gera whatsapp/n8n/cin-whatsapp-enviar.json: o fluxo do n8n da Camara que
// recebe da function processarFilaWhatsappCin uma mensagem pronta e a envia
// pelo WAHA da CIN (servico waha-cin, sessao cin).
//
// Uso: node whatsapp/n8n/montar-enviar.mjs <sha256 do token>
// O token em claro fica so no segredo WHATSAPP_CIN_N8N_TOKEN do Firebase; o
// fluxo guarda apenas o SHA-256 dele e compara o hash do cabecalho X-Cin-Token.
//
// Respostas (a function grava o resultado em whatsapp_envios):
//   200 { enviado: true, mensagemId }           -> enviado
//   200 { enviado: false, motivo: "sem_whatsapp" } -> numero sem WhatsApp
//   401 { erro }                                -> pedido recusado (erro)
//   502 { erro }                                -> WAHA falhou (revisar)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hashToken = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[0-9a-f]{64}$/.test(hashToken)) {
  console.error('Informe o SHA-256 (64 hex) do token.');
  process.exit(1);
}

const aqui = dirname(fileURLToPath(import.meta.url));
let n = 0;
const uid = () => `c1000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const cond = (esquerda, operador, direita) => ({ id: uid(), leftValue: esquerda, rightValue: direita ?? '', operator: operador });
const condicoes = (lista) => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: lista,
  combinator: 'and',
});
const nos = [];
const no = (nome, tipo, versao, posicao, parametros, extra = {}) => {
  nos.push({ id: uid(), name: nome, type: tipo, typeVersion: versao, position: posicao, parameters: parametros, ...extra });
};
const ligacoes = [];
const liga = (de, para, saida = 0) => ligacoes.push({ de, para, saida });

const WAHA = 'http://camara-itanhandu_waha-cin:3000';
const SESSAO = 'cin';
const credencialWaha = { credentials: { httpHeaderAuth: { id: 'CinWahaKey000001', name: 'WAHA da CIN' } } };
const corpo = "$('Receber pedido').first().json.body";
const responder = (nome, posicao, codigo, expressao) => no(nome, 'n8n-nodes-base.respondToWebhook', 1.1, posicao, {
  respondWith: 'json',
  responseBody: `={{ JSON.stringify(${expressao}) }}`,
  options: { responseCode: codigo },
});
const ID_WAHA = "($json.id && typeof $json.id === 'object' ? ($json.id._serialized || $json.id.id || '') : ($json.id || ($json.key && $json.key.id) || ''))";

no('Receber pedido', 'n8n-nodes-base.webhook', 2, [0, 200], {
  httpMethod: 'POST',
  path: 'cin-whatsapp-enviar',
  responseMode: 'responseNode',
  options: {},
}, { webhookId: 'c1a0f6e2-5b7d-4c11-9a3e-7d2b8e4f1a01' });

no('Hash do token', 'n8n-nodes-base.crypto', 1, [220, 200], {
  action: 'hash',
  type: 'SHA256',
  value: "={{ String($json.headers['x-cin-token'] || '') }}",
  dataPropertyName: 'tokenHash',
  encoding: 'hex',
});

no('Pedido válido?', 'n8n-nodes-base.if', 2.2, [440, 200], {
  conditions: condicoes([
    cond(`={{ $json.tokenHash === '${hashToken}' }}`, { type: 'boolean', operation: 'true', singleValue: true }),
    cond(`={{ /^55\\d{10,11}$/.test(String(${corpo}.telefone || '')) }}`, { type: 'boolean', operation: 'true', singleValue: true }),
    cond(`={{ typeof ${corpo}.texto === 'string' && ${corpo}.texto.length > 0 && ${corpo}.texto.length <= 3000 }}`, { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  options: {},
}, { notes: 'Confere o hash do cabeçalho X-Cin-Token (o token fica só no Firebase) e o pedido.', notesInFlow: true });

responder('Recusar pedido', [660, 360], 401, "{ erro: 'nao_autorizado' }");

no('Conferir número no WhatsApp', 'n8n-nodes-base.httpRequest', 4.2, [660, 120], {
  method: 'GET',
  url: `${WAHA}/api/contacts/check-exists`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendQuery: true,
  queryParameters: { parameters: [{ name: 'phone', value: `={{ ${corpo}.telefone }}` }, { name: 'session', value: SESSAO }] },
  options: { timeout: 20000 },
}, { ...credencialWaha, onError: 'continueErrorOutput' });

no('Número tem WhatsApp?', 'n8n-nodes-base.if', 2.2, [880, 60], {
  conditions: condicoes([cond('={{ $json.numberExists }}', { type: 'boolean', operation: 'true', singleValue: true })]),
  options: {},
});
responder('Sem WhatsApp', [1100, 200], 200, "{ enviado: false, motivo: 'sem_whatsapp' }");

no('Digitando', 'n8n-nodes-base.httpRequest', 4.2, [1100, -40], {
  method: 'POST',
  url: `${WAHA}/api/startTyping`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: $('Conferir número no WhatsApp').first().json.chatId }) }}`,
  options: { timeout: 10000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });

no('Esperar 3 a 6 s', 'n8n-nodes-base.wait', 1.1, [1320, -40], {
  amount: '={{ 3 + Math.floor(Math.random() * 4) }}',
  unit: 'seconds',
}, { notes: 'O intervalo entre mensagens fica na function (15 a 30 s). Aqui é só o "digitando".', notesInFlow: true });

no('Enviar pelo WAHA', 'n8n-nodes-base.httpRequest', 4.2, [1540, -40], {
  method: 'POST',
  url: `${WAHA}/api/sendText`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: $('Conferir número no WhatsApp').first().json.chatId, text: ${corpo}.texto, linkPreview: false }) }}`,
  options: { timeout: 30000 },
}, { ...credencialWaha, onError: 'continueErrorOutput' });

responder('Enviado', [1760, -100], 200, `{ enviado: true, mensagemId: ${ID_WAHA} }`);
responder('Falha no WAHA', [1760, 140], 502, "{ erro: 'waha', detalhe: String(($json.error && ($json.error.message || JSON.stringify($json.error))) || 'sem detalhe').slice(0, 200) }");

liga('Receber pedido', 'Hash do token');
liga('Hash do token', 'Pedido válido?');
liga('Pedido válido?', 'Conferir número no WhatsApp', 0);
liga('Pedido válido?', 'Recusar pedido', 1);
liga('Conferir número no WhatsApp', 'Número tem WhatsApp?', 0);
liga('Conferir número no WhatsApp', 'Falha no WAHA', 1);
liga('Número tem WhatsApp?', 'Digitando', 0);
liga('Número tem WhatsApp?', 'Sem WhatsApp', 1);
liga('Digitando', 'Esperar 3 a 6 s');
liga('Esperar 3 a 6 s', 'Enviar pelo WAHA');
liga('Enviar pelo WAHA', 'Enviado', 0);
liga('Enviar pelo WAHA', 'Falha no WAHA', 1);

const connections = {};
for (const { de, para, saida } of ligacoes) {
  connections[de] ??= { main: [] };
  while (connections[de].main.length <= saida) connections[de].main.push([]);
  connections[de].main[saida].push({ node: para, type: 'main', index: 0 });
}
const fluxo = {
  id: 'CinWhatsEnviar01',
  name: 'CIN — enviar aviso do agendamento pelo WhatsApp (WAHA)',
  active: false,
  nodes: nos,
  connections,
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' },
  pinData: {},
  tags: [],
};
writeFileSync(join(aqui, 'cin-whatsapp-enviar.json'), `${JSON.stringify(fluxo, null, 2)}\n`);
console.log(`cin-whatsapp-enviar.json: ${nos.length} nós, ${ligacoes.length} ligações`);
