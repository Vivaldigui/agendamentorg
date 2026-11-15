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
// - Qualquer outra mensagem: uma resposta padrao por dia e por numero (ate o
//   robo de IA existir), registrada em cin_whatsapp_respondidos.
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

// ---- qualquer outra mensagem: resposta padrao uma vez por dia
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
liga('Comando', 'Não respondido hoje?', 2);
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
