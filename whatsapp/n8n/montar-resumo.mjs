// Gera whatsapp/n8n/cin-whatsapp-resumo.json: o resumo diario do WhatsApp da CIN
// para o responsavel (22/11/2026, auditoria do Cidinho, item P2: falhas caladas e
// queda do numero).
//
// Todo dia as 21h10 (Sao Paulo) conta os eventos do dia em cin_cidinho_eventos
// (gravados pelo fluxo de entrada, sem texto nem telefone), pergunta a function
// cinRoboAgendamento (acao "status") pelo disjuntor e pelos avisos enviados hoje,
// e le o estado da sessao no WAHA. Manda pelo proprio numero da CIN: se o numero
// cair, o resumo nao chega, e a falta dele e o aviso.
//
// Uso: node whatsapp/n8n/montar-resumo.mjs
// Tambem roda na hora por POST http://127.0.0.1:5678/webhook/cin-resumo (so 127.0.0.1).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarFluxo } from './validar-fluxo.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
let n = 0;
const uid = () => `c4000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const nos = [];
const no = (nome, tipo, versao, posicao, parametros, extra = {}) => {
  nos.push({ id: uid(), name: nome, type: tipo, typeVersion: versao, position: posicao, parameters: parametros, ...extra });
};
const tabela = (nome) => ({ __rl: true, mode: 'name', value: nome });

const WAHA = 'http://camara-itanhandu_waha-cin:3000';
const SESSAO = 'cin';
const ROBO_URL = 'https://southamerica-east1-agendamento-cin-itanhandu.cloudfunctions.net/cinRoboAgendamento';
const AVISO_PARA = '5535999901497';
const credencialWaha = { credentials: { httpHeaderAuth: { id: 'CinWahaKey000001', name: 'WAHA da CIN' } } };
const credencialRobo = { credentials: { httpHeaderAuth: { id: 'CinRoboToken0001', name: 'Robô da CIN (functions)' } } };

no('Todo dia às 21h10', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 100], {
  rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 21, triggerAtMinute: 10 }] },
});
no('Rodar agora', 'n8n-nodes-base.webhook', 2, [0, 300], {
  httpMethod: 'POST',
  path: 'cin-resumo',
  responseMode: 'lastNode',
  options: { ipWhitelist: '127.0.0.1,::1,::ffff:127.0.0.1' },
}, { webhookId: 'c4a1e2d4-6b7f-4c21-9a3e-7d2b8e4f1d04' });
no('Eventos de hoje', 'n8n-nodes-base.dataTable', 1.1, [240, 200], {
  resource: 'row', operation: 'get', dataTableId: tabela('cin_cidinho_eventos'),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'dia', condition: 'eq', keyValue: "={{ new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) }}" }] },
  returnAll: true,
}, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
no('Situação dos avisos', 'n8n-nodes-base.httpRequest', 4.2, [480, 200], {
  method: 'POST',
  url: ROBO_URL,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify({ acao: "status" }) }}',
  options: { timeout: 20000 },
}, { ...credencialRobo, executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
no('Sessão do WhatsApp', 'n8n-nodes-base.httpRequest', 4.2, [720, 200], {
  method: 'GET',
  url: `${WAHA}/api/sessions/${SESSAO}`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  options: { timeout: 15000 },
}, { ...credencialWaha, executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
no('Montar resumo', 'n8n-nodes-base.code', 2, [960, 200], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: conta os eventos do dia (sem texto nem telefone) e monta o resumo.
const linhas = $('Eventos de hoje').all().map((i) => i.json).filter((r) => r && r.tipo);
const conta = {};
const pessoas = new Set();
for (const r of linhas) {
  conta[r.tipo] = (conta[r.tipo] || 0) + 1;
  if (r.pessoa && r.tipo === 'resposta') pessoas.add(r.pessoa);
}
const n = (t) => conta[t] || 0;
const avisos = $('Situação dos avisos').first().json || {};
const sessao = $('Sessão do WhatsApp').first().json || {};
const dia = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' });
const opcoes = [2, 3, 4, 5, 6].map((o) => o + ': ' + n('opcao_' + o)).join(', ');
const mudancas = Object.keys(conta).filter((t) => t.startsWith('sessao_') && t !== 'sessao_working').reduce((s, t) => s + conta[t], 0);
const disjuntor = avisos.ok === true ? (avisos.disjuntor ? '*LIGADO* ⚠️ (apague whatsapp_controle/disjuntor depois de conferir o celular)' : 'desligado') : 'sem resposta';
const texto = [
  '📊 *WhatsApp do RG — ' + dia + '*',
  'Pessoas que o Cidinho atendeu: ' + pessoas.size + ' · respostas: ' + n('resposta'),
  'Menu: ' + n('menu') + ' · opções ' + opcoes + ' · IA: ' + (n('ia') + n('opcao_1')),
  'Consultas pelo código: ' + n('consulta') + ' · cancelamentos: ' + n('cancelamento') + (n('protocolo_nao_encontrado') ? ' · código não achado: ' + n('protocolo_nao_encontrado') : ''),
  'Pedidos de atendimento (6): ' + n('alerta_atendimento') + ' · alertas da abertura: ' + n('alerta_site'),
  'Você respondeu pelo celular (robô em pausa): ' + n('pausa_humano'),
  'Mídia: ' + n('midia') + ' · teto do dia: ' + n('teto'),
  'Falhas: envio ' + n('falha_envio') + ' · IA ' + n('falha_ia') + ' · áudio ' + n('falha_audio') + ' · consulta ' + n('falha_agendamento'),
  'Avisos do agendamento hoje: ' + (avisos.ok === true ? avisos.enviadosHoje : '?') + ' · disjuntor: ' + disjuntor,
  'WhatsApp: ' + (sessao.status || 'sem resposta') + (mudancas ? ' · ' + mudancas + ' mudança(s) de estado hoje' : ''),
].join('\\n');
return [{ json: { texto } }];`,
});
no('Número do responsável', 'n8n-nodes-base.httpRequest', 4.2, [1200, 200], {
  method: 'GET',
  url: `${WAHA}/api/contacts/check-exists`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendQuery: true,
  queryParameters: { parameters: [{ name: 'phone', value: AVISO_PARA }, { name: 'session', value: SESSAO }] },
  options: { timeout: 15000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
no('Enviar resumo', 'n8n-nodes-base.httpRequest', 4.2, [1440, 200], {
  method: 'POST',
  url: `${WAHA}/api/sendText`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: $json.chatId || '${AVISO_PARA}@c.us', text: $('Montar resumo').first().json.texto, linkPreview: false }) }}`,
  options: { timeout: 30000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });

const ligacoes = [
  ['Todo dia às 21h10', 'Eventos de hoje'],
  ['Rodar agora', 'Eventos de hoje'],
  ['Eventos de hoje', 'Situação dos avisos'],
  ['Situação dos avisos', 'Sessão do WhatsApp'],
  ['Sessão do WhatsApp', 'Montar resumo'],
  ['Montar resumo', 'Número do responsável'],
  ['Número do responsável', 'Enviar resumo'],
];
const connections = {};
for (const [de, para] of ligacoes) {
  connections[de] ??= { main: [[]] };
  connections[de].main[0].push({ node: para, type: 'main', index: 0 });
}
const fluxo = {
  id: 'CinWhatsResumo1',
  name: 'CIN — resumo diário do WhatsApp para o responsável (21h10)',
  active: false,
  nodes: nos,
  connections,
  // Sem texto nem telefone: o sucesso pode ficar guardado para conferir.
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' },
  pinData: {},
  tags: [],
};
validarFluxo(fluxo);
writeFileSync(join(aqui, 'cin-whatsapp-resumo.json'), `${JSON.stringify(fluxo, null, 2)}\n`);
console.log(`cin-whatsapp-resumo.json: ${nos.length} nós`);
