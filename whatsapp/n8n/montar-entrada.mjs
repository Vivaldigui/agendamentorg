// Gera whatsapp/n8n/cin-whatsapp-entrada.json: o fluxo do n8n da Camara que
// recebe do WAHA da CIN (sessao cin) as mensagens que chegam no numero.
//
// Uso: node whatsapp/n8n/montar-entrada.mjs <sha256 do segredo>
// O WAHA manda o segredo no cabecalho X-Cin-Entrada (configurado na sessao);
// o fluxo guarda so o SHA-256 dele.
//
// O que faz:
// - "SAIR" (ou PARAR, PARE, STOP): poe o numero em cin_whatsapp_saida e confirma.
//   O fluxo de envio consulta essa tabela e nao manda mais nada.
// - "VOLTAR": tira o numero da tabela e confirma.
// - Qualquer outra mensagem: o Cidinho (robo de IA, whatsapp/robo/) responde aos
//   numeros liberados em CIDINHO_LIBERADOS; os demais recebem uma resposta padrao
//   por dia e por numero, registrada em cin_whatsapp_respondidos.
// - Ignora grupo, status, canal e mensagem do proprio numero.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hashSegredo = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[0-9a-f]{64}$/.test(hashSegredo)) {
  console.error('Informe o SHA-256 (64 hex) do segredo.');
  process.exit(1);
}

const aqui = dirname(fileURLToPath(import.meta.url));
let n = 0;
const uid = () => `c2000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const cond = (esquerda, operador, direita) => ({ id: uid(), leftValue: esquerda, rightValue: direita ?? '', operator: operador });
const condicoes = (lista) => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: lista,
  combinator: 'and',
});
const verdadeiro = (expr) => cond(expr, { type: 'boolean', operation: 'true', singleValue: true });
const campo = (nome, valor, tipo = 'string') => ({ id: uid(), name: nome, value: valor, type: tipo });
const tabela = (nome) => ({ __rl: true, mode: 'name', value: nome });
const insercao = () => ({
  mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [],
  attemptToConvertTypes: false, convertFieldsToString: false,
});
const colunas = (lista) => ({ column: lista.map(([name, type]) => ({ name, type })) });
const nos = [];
const no = (nome, tipo, versao, posicao, parametros, extra = {}) => {
  nos.push({ id: uid(), name: nome, type: tipo, typeVersion: versao, position: posicao, parameters: parametros, ...extra });
};
const ligacoes = [];
const liga = (de, para, saida = 0) => ligacoes.push({ de, para, saida });

const WAHA = 'http://camara-itanhandu_waha-cin:3000';
const SESSAO = 'cin';
const SITE = 'https://cin.itanhandu.cam.mg.gov.br';
const credencialWaha = { credentials: { httpHeaderAuth: { id: 'CinWahaKey000001', name: 'WAHA da CIN' } } };
const M = "$('Telefone').first().json";

const TEXTO_SAIR = '✅ *Pronto!* Você não vai mais receber avisos do agendamento do RG por aqui.\n\nSe mudar de ideia, responda *VOLTAR*.';
const TEXTO_VOLTAR = '🔔 *Pronto!* Você volta a receber por aqui os avisos do agendamento do RG.\n\nPara parar, responda *SAIR*.';
const TEXTO_PADRAO = [
  'Olá! 👋 Este número envia os *avisos do agendamento do RG* da Câmara de Itanhandu e ainda não responde mensagens.',
  '',
  `🗓️ Agendar, consultar ou cancelar: ${SITE}`,
  `📄 O que levar: ${SITE}/cin/dia-do-atendimento/`,
  '📞 Dúvidas: (35) 3504-0397',
  '',
  'Para não receber mais avisos, responda *SAIR*.',
].join('\n');

const enviarTexto = (nome, posicao, texto) => no(nome, 'n8n-nodes-base.httpRequest', 4.2, posicao, {
  method: 'POST',
  url: `${WAHA}/api/sendText`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: ${M}.chatId, text: ${JSON.stringify(texto)} }) }}`,
  options: { timeout: 30000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });

// ---- entrada e conferencia
no('Receber do WAHA', 'n8n-nodes-base.webhook', 2, [0, 300], {
  httpMethod: 'POST',
  path: 'cin-whatsapp-entrada',
  responseMode: 'onReceived',
  options: {},
}, { webhookId: 'c2b17d40-8e2a-4f6b-9c1d-5a3e7f9b2c02' });

no('Hash do segredo', 'n8n-nodes-base.crypto', 1, [220, 300], {
  action: 'hash',
  type: 'SHA256',
  value: "={{ String($json.headers['x-cin-entrada'] || '') }}",
  dataPropertyName: 'segredoHash',
  encoding: 'hex',
});

no('Ler mensagem', 'n8n-nodes-base.code', 2, [880, 300], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: normaliza o comando (acentos, pontuacao, caixa) e filtra o evento do WAHA num passo so.
const entrada = $('Hash do segredo').first().json;
const corpo = entrada.body || {};
const p = corpo.payload || {};
const de = String(p.from || '');
const autorizado = entrada.segredoHash === '${hashSegredo}';
const valido = autorizado && corpo.event === 'message' && corpo.session === '${SESSAO}' && p.fromMe !== true
  && /@(c\\.us|lid|s\\.whatsapp\\.net)$/.test(de);
const normal = String(p.body || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
let comando = 'outro';
if (['SAIR', 'PARAR', 'PARE', 'STOP'].includes(normal)) comando = 'sair';
else if (['VOLTAR', 'VOLTA'].includes(normal)) comando = 'voltar';
return [{ json: { valido, autorizado, chatId: de, ehLid: de.endsWith('@lid'), comando } }];`,
});

no('Mensagem válida?', 'n8n-nodes-base.if', 2.2, [1100, 300], {
  conditions: condicoes([verdadeiro('={{ $json.valido }}')]),
  options: {},
});

// Tabelas criadas em toda chamada, antes da conferencia (o envio depende delas).
no('Tabela de quem saiu', 'n8n-nodes-base.dataTable', 1.1, [440, 300], {
  resource: 'table', operation: 'create', tableName: 'cin_whatsapp_saida',
  columns: colunas([['telefone', 'string'], ['em', 'string']]),
  options: { createIfNotExists: true },
}, { executeOnce: true });
no('Tabela de respondidos', 'n8n-nodes-base.dataTable', 1.1, [660, 300], {
  resource: 'table', operation: 'create', tableName: 'cin_whatsapp_respondidos',
  columns: colunas([['chave', 'string'], ['em', 'string']]),
  options: { createIfNotExists: true },
}, { executeOnce: true });

// O WhatsApp pode mandar o contato como LID (identificador sem telefone). O
// WAHA traduz o LID no telefone, que e a chave da tabela de quem saiu.
no('É LID?', 'n8n-nodes-base.if', 2.2, [1320, 220], {
  conditions: condicoes([verdadeiro("={{ $('Ler mensagem').first().json.ehLid }}")]),
  options: {},
});
no('Telefone do LID', 'n8n-nodes-base.httpRequest', 4.2, [1540, 140], {
  method: 'GET',
  url: `={{ '${WAHA}/api/${SESSAO}/lids/' + encodeURIComponent($('Ler mensagem').first().json.chatId) }}`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  options: { timeout: 15000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });

no('Telefone', 'n8n-nodes-base.code', 2, [1760, 220], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: mesma regra de telefoneWhatsApp em functions/whatsapp-cin.js (55 + DDD + nono digito).
const m = $('Ler mensagem').first().json;
const lid = $input.first().json || {};
const origem = m.ehLid ? String(lid.pn || lid.phoneNumber || '') : m.chatId;
let d = origem.split('@')[0].replace(/\\D/g, '');
if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = d.slice(0, 2) + '9' + d.slice(2);
const telefone = /^[1-9]{2}9\\d{8}$/.test(d) ? '55' + d : '';
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
return [{ json: { ...m, telefone, chave: (telefone || m.chatId) + '_' + hoje, em: new Date().toISOString() } }];`,
});

no('Comando', 'n8n-nodes-base.switch', 3.2, [1980, 220], {
  rules: {
    values: [
      { conditions: condicoes([cond('={{ $json.comando }}', { type: 'string', operation: 'equals' }, 'sair')]), renameOutput: true, outputKey: 'sair' },
      { conditions: condicoes([cond('={{ $json.comando }}', { type: 'string', operation: 'equals' }, 'voltar')]), renameOutput: true, outputKey: 'voltar' },
    ],
  },
  options: { fallbackOutput: 'extra', renameFallbackOutput: 'outro' },
});

// ---- SAIR
enviarTexto('Confirmar saída', [2200, 40], TEXTO_SAIR);
no('Ainda não saiu?', 'n8n-nodes-base.dataTable', 1.1, [2420, 40], {
  resource: 'row', operation: 'rowNotExists', dataTableId: tabela('cin_whatsapp_saida'),
  filters: { conditions: [{ keyName: 'telefone', keyValue: `={{ ${M}.telefone }}` }] },
});
no('Campos de quem saiu', 'n8n-nodes-base.set', 3.4, [2640, 40], {
  assignments: { assignments: [campo('telefone', `={{ ${M}.telefone }}`), campo('em', `={{ ${M}.em }}`)] },
  options: {},
});
no('Registrar saída', 'n8n-nodes-base.dataTable', 1.1, [2860, 40], {
  resource: 'row', operation: 'insert', dataTableId: tabela('cin_whatsapp_saida'), columns: insercao(), options: {},
});

// ---- VOLTAR
no('Apagar saída', 'n8n-nodes-base.dataTable', 1.1, [2200, 220], {
  resource: 'row', operation: 'deleteRows', dataTableId: tabela('cin_whatsapp_saida'),
  filters: { conditions: [{ keyName: 'telefone', keyValue: `={{ ${M}.telefone }}` }] },
}, { alwaysOutputData: true });
enviarTexto('Confirmar volta', [2420, 220], TEXTO_VOLTAR);

// ---- qualquer outra mensagem: o Cidinho (robô de IA) responde aos números
// liberados; os demais recebem a resposta padrão uma vez por dia.
// Liberados: SHA-256 do telefone (55 + DDD + número), para o número não ir
// para o git. Para abrir a todos, troque a lista por ['todos'].
// Robô: whatsapp/robo/ (intermediário CinCidinhoIA0001, webhook interno).
// Liberado para todos em 15/11/2026, a pedido do responsável (botão "Dúvidas? WhatsApp" no site).
// Para voltar a só o celular de teste: troque por ['a34df2e6d776e0d9b5cb7ebe45db6d8a28d3e8f4756d48cdc86e6a56a9f3854d'].
const CIDINHO_LIBERADOS = ['todos'];
const CIDINHO_TETO_24H = 20;
const TEXTO_MIDIA = 'Ainda não consigo ouvir áudio nem ver foto ou documento. 🙏 Escreva sua dúvida em texto, por favor.\n\nSe preferir falar com uma pessoa, chame a recepção da Câmara no WhatsApp *(35) 3504-0397*.';
const TEXTO_TETO = 'Por hoje eu já respondi bastante por aqui. 🙏 Para continuar, fale com a recepção da Câmara pelo WhatsApp *(35) 3504-0397*.\n\nAgendar, consultar ou cancelar: ' + SITE;
const TEXTO_FALHA_IA = 'Desculpe, não consegui responder agora. 🙏 Para falar com a recepção da Câmara, chame no WhatsApp *(35) 3504-0397*. O agendamento é só pelo site: ' + SITE;

no('Hash do telefone', 'n8n-nodes-base.crypto', 1, [2200, 560], {
  action: 'hash',
  type: 'SHA256',
  value: `={{ String(${M}.telefone || '') }}`,
  dataPropertyName: 'telefoneHash',
  encoding: 'hex',
});
no('Cidinho atende?', 'n8n-nodes-base.if', 2.2, [2420, 560], {
  conditions: condicoes([verdadeiro(`={{ ${JSON.stringify(CIDINHO_LIBERADOS)}.includes('todos') || ${JSON.stringify(CIDINHO_LIBERADOS)}.includes($json.telefoneHash) }}`)]),
  options: {},
});
no('Tabela da conversa', 'n8n-nodes-base.dataTable', 1.1, [2640, 640], {
  resource: 'table', operation: 'create', tableName: 'cin_cidinho_conversa',
  columns: colunas([['telefone', 'string'], ['papel', 'string'], ['texto', 'string'], ['quando', 'date']]),
  options: { createIfNotExists: true },
}, { executeOnce: true });
// A conversa só vale por 24 h: apaga de todos as falas mais antigas.
no('Apagar conversa antiga', 'n8n-nodes-base.dataTable', 1.1, [2860, 640], {
  resource: 'row', operation: 'deleteRows', dataTableId: tabela('cin_cidinho_conversa'),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'quando', condition: 'lt', keyValue: '={{ new Date(Date.now() - 24 * 3600 * 1000).toISOString() }}' }] },
  options: {},
}, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
no('Conversa recente', 'n8n-nodes-base.dataTable', 1.1, [3080, 640], {
  resource: 'row', operation: 'get', dataTableId: tabela('cin_cidinho_conversa'),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'telefone', condition: 'eq', keyValue: `={{ ${M}.telefone }}` }] },
  returnAll: false, limit: 40, orderBy: true, orderByColumn: 'createdAt', orderByDirection: 'DESC',
}, { executeOnce: true, alwaysOutputData: true });
no('Preparar Cidinho', 'n8n-nodes-base.code', 2, [3300, 640], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: monta a conversa (24 h, últimas 12 falas), barra mídia e aplica o teto, num passo só.
const p = ($('Hash do segredo').first().json.body || {}).payload || {};
const texto = String(p.body || '').trim().slice(0, 2000);
const midia = p.hasMedia === true || (!texto);
const limite = Date.now() - 24 * 3600 * 1000;
const falas = $input.all().map((i) => i.json)
  .filter((r) => r && r.telefone && (r.papel === 'user' || r.papel === 'assistant') && new Date(r.quando).getTime() >= limite)
  .sort((a, b) => new Date(a.quando) - new Date(b.quando));
const respostas = falas.filter((r) => r.papel === 'assistant').length;
if (midia) return [{ json: { usarIa: false, resposta: ${JSON.stringify(TEXTO_MIDIA)}, textoPessoa: texto || '[mídia]' } }];
if (respostas >= ${CIDINHO_TETO_24H}) return [{ json: { usarIa: false, resposta: ${JSON.stringify(TEXTO_TETO)}, textoPessoa: texto } }];
// Últimas 12 falas, juntando falas seguidas do mesmo lado, e a mensagem de agora no fim.
const mensagens = [];
for (const f of [...falas.slice(-12), { papel: 'user', texto }]) {
  const ultima = mensagens[mensagens.length - 1];
  if (ultima && ultima.role === f.papel) ultima.content += '\\n' + f.texto;
  else mensagens.push({ role: f.papel, content: String(f.texto || '') });
}
while (mensagens.length && mensagens[0].role !== 'user') mensagens.shift();
return [{ json: { usarIa: true, mensagens, primeira: falas.length === 0, textoPessoa: texto } }];`,
});
no('Usar a IA?', 'n8n-nodes-base.if', 2.2, [3520, 640], {
  conditions: condicoes([verdadeiro('={{ $json.usarIa }}')]),
  options: {},
});
no('Digitando', 'n8n-nodes-base.httpRequest', 4.2, [3740, 560], {
  method: 'POST',
  url: `${WAHA}/api/startTyping`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: ${M}.chatId }) }}`,
  options: { timeout: 10000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
no('Perguntar ao Cidinho', 'n8n-nodes-base.httpRequest', 4.2, [3960, 560], {
  method: 'POST',
  url: 'http://127.0.0.1:5678/webhook/cidinho',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: "={{ JSON.stringify({ mensagens: $('Preparar Cidinho').first().json.mensagens, primeira: $('Preparar Cidinho').first().json.primeira }) }}",
  options: { timeout: 90000 },
}, { onError: 'continueRegularOutput' });
no('Resposta da IA', 'n8n-nodes-base.set', 3.4, [4180, 560], {
  assignments: { assignments: [campo('resposta', `={{ $json.texto || ${JSON.stringify(TEXTO_FALHA_IA)} }}`)] },
  options: {},
});
no('Resposta fixa', 'n8n-nodes-base.set', 3.4, [3740, 760], {
  assignments: { assignments: [campo('resposta', '={{ $json.resposta }}')] },
  options: {},
});
no('Enviar resposta do Cidinho', 'n8n-nodes-base.httpRequest', 4.2, [4400, 640], {
  method: 'POST',
  url: `${WAHA}/api/sendText`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: ${M}.chatId, text: $json.resposta, linkPreview: false }) }}`,
  options: { timeout: 30000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
no('Falas para guardar', 'n8n-nodes-base.code', 2, [4620, 640], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: duas linhas (a pessoa e o Cidinho) a partir de nós diferentes.
const telefone = $('Telefone').first().json.telefone;
const pessoa = $('Preparar Cidinho').first().json.textoPessoa;
const resposta = $('Preparar Cidinho').first().json.usarIa ? $('Resposta da IA').first().json.resposta : $('Resposta fixa').first().json.resposta;
const agora = Date.now();
return [
  { json: { telefone, papel: 'user', texto: pessoa, quando: new Date(agora).toISOString() } },
  { json: { telefone, papel: 'assistant', texto: resposta, quando: new Date(agora + 1).toISOString() } },
];`,
});
no('Guardar conversa', 'n8n-nodes-base.dataTable', 1.1, [4840, 640], {
  resource: 'row', operation: 'insert', dataTableId: tabela('cin_cidinho_conversa'), columns: insercao(), options: {},
}, { onError: 'continueRegularOutput' });

no('Não respondido hoje?', 'n8n-nodes-base.dataTable', 1.1, [2200, 400], {
  resource: 'row', operation: 'rowNotExists', dataTableId: tabela('cin_whatsapp_respondidos'),
  filters: { conditions: [{ keyName: 'chave', keyValue: `={{ ${M}.chave }}` }] },
});
no('Campos do respondido', 'n8n-nodes-base.set', 3.4, [2420, 400], {
  assignments: { assignments: [campo('chave', `={{ ${M}.chave }}`), campo('em', `={{ ${M}.em }}`)] },
  options: {},
});
no('Registrar respondido', 'n8n-nodes-base.dataTable', 1.1, [2640, 400], {
  resource: 'row', operation: 'insert', dataTableId: tabela('cin_whatsapp_respondidos'), columns: insercao(), options: {},
});
enviarTexto('Resposta padrão', [2860, 400], TEXTO_PADRAO);

liga('Receber do WAHA', 'Hash do segredo');
liga('Hash do segredo', 'Tabela de quem saiu');
liga('Tabela de quem saiu', 'Tabela de respondidos');
liga('Tabela de respondidos', 'Ler mensagem');
liga('Ler mensagem', 'Mensagem válida?');
liga('Mensagem válida?', 'É LID?', 0);
liga('É LID?', 'Telefone do LID', 0);
liga('É LID?', 'Telefone', 1);
liga('Telefone do LID', 'Telefone');
liga('Telefone', 'Comando');
liga('Comando', 'Confirmar saída', 0);
liga('Comando', 'Apagar saída', 1);
liga('Comando', 'Hash do telefone', 2);
liga('Hash do telefone', 'Cidinho atende?');
liga('Cidinho atende?', 'Tabela da conversa', 0);
liga('Cidinho atende?', 'Não respondido hoje?', 1);
liga('Tabela da conversa', 'Apagar conversa antiga');
liga('Apagar conversa antiga', 'Conversa recente');
liga('Conversa recente', 'Preparar Cidinho');
liga('Preparar Cidinho', 'Usar a IA?');
liga('Usar a IA?', 'Digitando', 0);
liga('Usar a IA?', 'Resposta fixa', 1);
liga('Digitando', 'Perguntar ao Cidinho');
liga('Perguntar ao Cidinho', 'Resposta da IA');
liga('Resposta da IA', 'Enviar resposta do Cidinho');
liga('Resposta fixa', 'Enviar resposta do Cidinho');
liga('Enviar resposta do Cidinho', 'Falas para guardar');
liga('Falas para guardar', 'Guardar conversa');
liga('Confirmar saída', 'Ainda não saiu?');
liga('Ainda não saiu?', 'Campos de quem saiu');
liga('Campos de quem saiu', 'Registrar saída');
liga('Apagar saída', 'Confirmar volta');
liga('Não respondido hoje?', 'Campos do respondido');
liga('Campos do respondido', 'Registrar respondido');
liga('Registrar respondido', 'Resposta padrão');

const connections = {};
for (const { de, para, saida } of ligacoes) {
  connections[de] ??= { main: [] };
  while (connections[de].main.length <= saida) connections[de].main.push([]);
  connections[de].main[saida].push({ node: para, type: 'main', index: 0 });
}
const fluxo = {
  id: 'CinWhatsEntrada1',
  name: 'CIN — receber mensagens do WhatsApp (SAIR e resposta padrão)',
  active: false,
  nodes: nos,
  connections,
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' },
  pinData: {},
  tags: [],
};
writeFileSync(join(aqui, 'cin-whatsapp-entrada.json'), `${JSON.stringify(fluxo, null, 2)}\n`);
console.log(`cin-whatsapp-entrada.json: ${nos.length} nós, ${ligacoes.length} ligações`);
