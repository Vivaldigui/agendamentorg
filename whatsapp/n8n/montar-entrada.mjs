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
// Estrutura copiada do robô UAZAPI da Sucupira (15/11/2026):
// - rajada: cada mensagem é guardada na hora e espera CIDINHO_ESPERA_S segundos;
//   só a execução da ÚLTIMA mensagem chama a IA, com todas as que chegaram desde a
//   última resposta. Antes de enviar, confere de novo: se chegou outra mensagem
//   enquanto a IA pensava, descarta a resposta (a execução mais nova responde tudo);
// - mensagem repetida (mesmo id do WhatsApp) não é respondida duas vezes;
// - áudio: baixa do WAHA e transcreve no Whisper local (o mesmo serviço da
//   Sucupira, na rede interna do Easypanel); o filtro barra o que o Whisper inventa
//   em silêncio ou ruído e, nesse caso, pede para repetir.
const CIDINHO_ESPERA_S = 9;
const WHISPER = 'http://sucupira_naturale_whisper:9000/asr';
const TABELA_FALAS = 'cin_cidinho_falas';
const TEXTO_MIDIA = 'Ainda não consigo ver foto, vídeo nem documento. 🙏 Escreva sua dúvida em texto ou mande um áudio, por favor.\n\nSe preferir falar com uma pessoa, chame a recepção da Câmara no WhatsApp *(35) 3504-0397*.';
const TEXTO_AUDIO = 'Não consegui entender o seu áudio. 🙏 Pode mandar de novo ou escrever a sua dúvida?';
const TEXTO_TETO = 'Por hoje eu já respondi bastante por aqui. 🙏 Para continuar, fale com a recepção da Câmara pelo WhatsApp *(35) 3504-0397*.\n\nAgendar, consultar ou cancelar: ' + SITE;
// ---- menu com números (18/11/2026, pedido do responsável: respostas curtas).
// Botões do WAHA estão descontinuados; a lista pode parar a qualquer hora. Números
// funcionam em qualquer celular. Opções 2 a 6 têm resposta fixa (sem IA); a 1
// vai para a IA porque depende da agenda do momento. A 6 avisa o responsável.
const MENU_OPCOES = [
  'Responda com o número:',
  '',
  '1️⃣ Agendar / tem vaga?',
  '2️⃣ O que levar',
  '3️⃣ Consultar ou cancelar',
  '4️⃣ RG de criança',
  '5️⃣ Prazo e entrega',
  '6️⃣ Falar com uma pessoa',
  '',
  'Ou escreva sua dúvida.',
].join('\n');
const MENU_APRESENTACAO = 'Oi! Sou o *Cidinho*, do RG da Câmara de Itanhandu. 👋\n' + MENU_OPCOES;
const OPCAO_1_PERGUNTA = 'Quero agendar o RG. Tem vaga?';
const OPCOES_FIXAS = {
  2: [
    '📄 *O que levar:*',
    '• *Certidão original* ou autenticada em cartório:',
    '   – solteiro: nascimento',
    '   – casado: casamento',
    '   – viúvo ou divorciado: casamento com averbação',
    '• Número do CPF',
    '• Comprovante de endereço',
    'Xerox, foto e PDF da certidão não valem.',
  ].join('\n'),
  3: [
    'Consulte ou cancele aqui (precisa do CPF, data de nascimento e código CIN-):',
    `${SITE}/cin/consultar-ou-cancelar/`,
    'Não dá para trocar o dia: cancele e agende de novo na segunda, às 8h.',
  ].join('\n'),
  4: [
    'A criança *precisa ir*, com pai, mãe ou responsável (com RG ou CNH).',
    'Leve a *certidão de nascimento* dela. Menor de 3 anos: 1 foto 3x4 de fundo branco.',
    'Avó, tio e outros: levem também o termo de guarda.',
  ].join('\n'),
  5: [
    'A carteira chega *pelos Correios* em até 15 dias úteis.',
    'Acompanhe no *MG App*. Zona rural: busque na Câmara 15 dias depois.',
  ].join('\n'),
  6: [
    'Pronto! ✅ Avisei a equipe da Câmara. Uma pessoa vai falar com você assim que possível.',
    'Se preferir, chame a recepção: *(35) 3504-0397*.',
  ].join('\n'),
};
// Quem recebe o aviso da opção 6 (pedido do responsável em 18/11/2026).
const AVISO_ATENDIMENTO_PARA = '5535999901497';
const TEXTO_FALHA_IA ='Desculpe, não consegui responder agora. 🙏 Para falar com a recepção da Câmara, chame no WhatsApp *(35) 3504-0397*. O agendamento é só pelo site: ' + SITE;

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
  resource: 'table', operation: 'create', tableName: TABELA_FALAS,
  columns: colunas([['telefone', 'string'], ['papel', 'string'], ['texto', 'string'], ['quando', 'date'], ['msgid', 'string']]),
  options: { createIfNotExists: true },
}, { executeOnce: true });
// A conversa só vale por 24 h: apaga de todos as falas mais antigas.
no('Apagar conversa antiga', 'n8n-nodes-base.dataTable', 1.1, [2860, 640], {
  resource: 'row', operation: 'deleteRows', dataTableId: tabela(TABELA_FALAS),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'quando', condition: 'lt', keyValue: '={{ new Date(Date.now() - 24 * 3600 * 1000).toISOString() }}' }] },
  options: {},
}, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
no('Tipo da mensagem', 'n8n-nodes-base.code', 2, [3080, 640], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: separa texto, áudio e outra mídia e acerta o link do áudio num passo só.
const p = ($('Hash do segredo').first().json.body || {}).payload || {};
const msgid = String(p.id || '');
const texto = String(p.body || '').trim().slice(0, 2000);
const media = p.media || {};
const mime = String(media.mimetype || '').toLowerCase();
const audio = p.hasMedia === true && mime.startsWith('audio/');
// O WAHA monta o link com o endereço dele mesmo (localhost). Troca SEMPRE pelo
// endereço interno: a chave do WAHA vai junto no pedido e só pode ir para ele.
const urlAudio = audio && media.url ? String(media.url).replace(/^https?:\\/\\/[^/]+/, '${WAHA}') : '';
let tipo = 'midia';
if (audio) tipo = urlAudio ? 'audio' : 'audio_sem_arquivo';
else if (texto) tipo = 'texto';
const resposta = tipo === 'midia' ? ${JSON.stringify(TEXTO_MIDIA)} : (tipo === 'audio_sem_arquivo' ? ${JSON.stringify(TEXTO_AUDIO)} : '');
return [{ json: { tipo, msgid, texto, urlAudio, resposta } }];`,
});
no('Que tipo?', 'n8n-nodes-base.switch', 3.2, [3300, 640], {
  rules: {
    values: [
      { conditions: condicoes([cond('={{ $json.tipo }}', { type: 'string', operation: 'equals' }, 'texto')]), renameOutput: true, outputKey: 'texto' },
      { conditions: condicoes([cond('={{ $json.tipo }}', { type: 'string', operation: 'equals' }, 'audio')]), renameOutput: true, outputKey: 'audio' },
    ],
  },
  options: { fallbackOutput: 'extra', renameFallbackOutput: 'outro' },
});

// ---- áudio: baixar do WAHA e transcrever no Whisper
no('Baixar áudio', 'n8n-nodes-base.httpRequest', 4.2, [3520, 800], {
  method: 'GET',
  url: '={{ $json.urlAudio }}',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  options: { timeout: 30000, response: { response: { responseFormat: 'file' } } },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
no('Transcrever áudio', 'n8n-nodes-base.httpRequest', 4.2, [3740, 800], {
  method: 'POST',
  url: WHISPER,
  sendQuery: true,
  queryParameters: { parameters: [
    { name: 'task', value: 'transcribe' },
    { name: 'language', value: 'pt' },
    { name: 'output', value: 'json' },
    { name: 'encode', value: 'true' },
  ] },
  sendBody: true,
  contentType: 'multipart-form-data',
  bodyParameters: { parameters: [{ parameterType: 'formBinaryData', name: 'audio_file', inputDataFieldName: 'data' }] },
  options: { timeout: 90000, response: { response: { responseFormat: 'json' } } },
}, { onError: 'continueRegularOutput' });
no('Ler transcrição', 'n8n-nodes-base.code', 2, [3960, 800], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: mesmo filtro do robô da Sucupira. O Whisper inventa frase em silêncio ou
// ruído ("Thank you for watching", "Legendas pela comunidade"); aí pede para repetir.
const t = String(($input.first().json || {}).text || '').trim();
const c = t.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\s+/g, ' ').trim();
const palavras = c.split(/[^a-z0-9]+/).filter(Boolean);
const EN = new Set(['the', 'you', 'your', 'thank', 'thanks', 'watching', 'watch', 'much', 'same', 'this', 'that', 'with', 'what', 'are', 'is', 'it', 'and', 'of', 'for', 'my', 'subscribe', 'video', 'please']);
const PT = new Set(['de', 'que', 'o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'em', 'um', 'uma', 'para', 'pra', 'com', 'nao', 'eu', 'voce', 'vc', 'sim', 'quero', 'qual', 'quando', 'como', 'tem', 'no', 'na', 'se', 'mais', 'por', 'me', 'meu', 'minha', 'ta', 'e', 'esse', 'essa', 'isso', 'aqui', 'ai', 'la', 'bom', 'boa', 'dia', 'tarde', 'noite', 'oi', 'ola', 'obrigado', 'obrigada', 'rg', 'identidade', 'agendar', 'agendamento', 'vaga', 'certidao']);
const en = palavras.filter((w) => EN.has(w)).length;
const pt = palavras.filter((w) => PT.has(w)).length;
const alucinacao = /(thank you|thanks for watching|for watching|subscribe|subtitles?|legendas? (pela|por)|legendado|amara\\.org|obrigad[oa] por assistir|inscreva-se)/.test(c) || (en >= 2 && pt === 0);
const audioOk = /[a-z]/.test(c) && !alucinacao;
return [{ json: { audioOk, texto: audioOk ? t.slice(0, 2000) : '', resposta: audioOk ? '' : ${JSON.stringify(TEXTO_AUDIO)} } }];`,
});
no('Áudio entendido?', 'n8n-nodes-base.if', 2.2, [4180, 800], {
  conditions: condicoes([verdadeiro('={{ $json.audioOk }}')]),
  options: {},
});

// ---- rajada: guarda a fala, espera e só a última responde
no('Fala da pessoa', 'n8n-nodes-base.code', 2, [3520, 480], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: junta o texto (digitado ou transcrito) com o id da mensagem para a tabela.
const t = $('Tipo da mensagem').first().json;
const texto = $('Ler transcrição').isExecuted ? $('Ler transcrição').first().json.texto : t.texto;
return [{ json: {
  telefone: $('Telefone').first().json.telefone,
  papel: 'user',
  texto: String(texto || '').slice(0, 2000),
  quando: new Date().toISOString(),
  msgid: t.msgid || ('sem-id-' + Date.now()),
} }];`,
});
no('Mensagem nova?', 'n8n-nodes-base.dataTable', 1.1, [3740, 480], {
  resource: 'row', operation: 'rowNotExists', dataTableId: tabela(TABELA_FALAS),
  filters: { conditions: [{ keyName: 'msgid', keyValue: "={{ $('Fala da pessoa').first().json.msgid }}" }] },
});
no('Campos da fala', 'n8n-nodes-base.set', 3.4, [3960, 480], {
  assignments: { assignments: ['telefone', 'papel', 'texto', 'quando', 'msgid'].map((c) => campo(c, `={{ $('Fala da pessoa').first().json.${c} }}`)) },
  options: {},
});
no('Guardar fala da pessoa', 'n8n-nodes-base.dataTable', 1.1, [4180, 480], {
  resource: 'row', operation: 'insert', dataTableId: tabela(TABELA_FALAS), columns: insercao(), options: {},
});
no('Esperar a pessoa terminar', 'n8n-nodes-base.wait', 1.1, [4400, 480], {
  resume: 'timeInterval', amount: CIDINHO_ESPERA_S, unit: 'seconds',
}, { webhookId: 'c2b17d40-8e2a-4f6b-9c1d-5a3e7f9b2c03' });
no('Conversa recente', 'n8n-nodes-base.dataTable', 1.1, [4620, 480], {
  resource: 'row', operation: 'get', dataTableId: tabela(TABELA_FALAS),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'telefone', condition: 'eq', keyValue: `={{ ${M}.telefone }}` }] },
  returnAll: false, limit: 40, orderBy: true, orderByColumn: 'createdAt', orderByDirection: 'DESC',
}, { executeOnce: true, alwaysOutputData: true });
no('Preparar Cidinho', 'n8n-nodes-base.code', 2, [4840, 480], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: decide se esta execução responde (é a última mensagem?), aplica o teto e
// monta a conversa: as falas desde a última resposta (a rajada) e, antes, as últimas 12.
const minha = $('Fala da pessoa').first().json.msgid;
const limite = Date.now() - 24 * 3600 * 1000;
const falas = $input.all().map((i) => i.json)
  .filter((r) => r && r.telefone && (r.papel === 'user' || r.papel === 'assistant') && new Date(r.quando).getTime() >= limite)
  .sort((a, b) => (new Date(a.quando) - new Date(b.quando)) || ((a.id || 0) - (b.id || 0)));
const daPessoa = falas.filter((r) => r.papel === 'user');
const ultima = daPessoa[daPessoa.length - 1];
// Chegou outra mensagem depois desta: quem responde é a execução da mais nova.
if (!ultima || ultima.msgid !== minha) return [{ json: { minhaVez: false } }];
const respostas = falas.filter((r) => r.papel === 'assistant').length;
if (respostas >= ${CIDINHO_TETO_24H}) return [{ json: { minhaVez: true, usarIa: false, resposta: ${JSON.stringify(TEXTO_TETO)} } }];
let fim = -1;
falas.forEach((f, i) => { if (f.papel === 'assistant') fim = i; });
const anteriores = falas.slice(0, fim + 1).slice(-12);
const rajada = falas.slice(fim + 1);
const primeira = respostas === 0;
// Menu: só cumprimento (ou MENU) mostra as opções; só um número de 1 a 6 escolhe.
const juntas = rajada.map((f) => String(f.texto || '')).join(' ');
const normal = juntas.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
const palavras = normal.split(/[^a-z0-9]+/).filter(Boolean);
const CUMPRIMENTO = new Set(${JSON.stringify(['oi', 'oii', 'oiii', 'ola', 'opa', 'e', 'ai', 'eai', 'bom', 'boa', 'dia', 'tarde', 'noite', 'cidinho', 'menu', 'opcoes', 'opcao', 'inicio', 'ajuda', 'tudo', 'bem'])});
const soNumero = /^\\s*([1-6])\\s*(\\ufe0f)?\\s*(\\u20e3)?\\s*[.)]?\\s*$/.exec(juntas);
let opcao = soNumero ? Number(soNumero[1]) : 0;
if (!opcao && palavras.length === 1 && palavras[0] === 'atendente') opcao = 6;
const ehMenu = !opcao && juntas.length <= 40 && !juntas.includes('?') && palavras.length > 0 && palavras.every((w) => CUMPRIMENTO.has(w));
const fixas = ${JSON.stringify(OPCOES_FIXAS)};
if (ehMenu) return [{ json: { minhaVez: true, usarIa: false, resposta: primeira ? ${JSON.stringify(MENU_APRESENTACAO)} : ${JSON.stringify(MENU_OPCOES)} } }];
if (opcao >= 2) {
  // Opção 6 avisa o responsável uma vez por conversa de 24 h.
  const jaAvisou = falas.some((f) => f.papel === 'assistant' && f.texto === fixas[6]);
  return [{ json: { minhaVez: true, usarIa: false, resposta: fixas[opcao], avisarDono: opcao === 6 && !jaAvisou, ultimas: daPessoa.slice(-4, -1).map((f) => String(f.texto || '').slice(0, 200)) } }];
}
const mensagens = [];
for (const f of [...anteriores, ...rajada]) {
  const ult = mensagens[mensagens.length - 1];
  if (ult && ult.role === f.papel) ult.content += '\\n' + f.texto;
  else mensagens.push({ role: f.papel, content: String(f.texto || '') });
}
while (mensagens.length && mensagens[0].role !== 'user') mensagens.shift();
// Opção 1: a IA responde com a agenda do momento, como se a pessoa tivesse perguntado.
if (opcao === 1 && mensagens.length) mensagens[mensagens.length - 1].content = ${JSON.stringify(OPCAO_1_PERGUNTA)};
return [{ json: { minhaVez: true, usarIa: true, mensagens, primeira, rajada: rajada.length } }];`,
});
no('Minha vez?', 'n8n-nodes-base.if', 2.2, [5060, 480], {
  conditions: condicoes([verdadeiro('={{ $json.minhaVez }}')]),
  options: {},
});
no('Usar a IA?', 'n8n-nodes-base.if', 2.2, [5280, 480], {
  conditions: condicoes([verdadeiro('={{ $json.usarIa }}')]),
  options: {},
});
no('Digitando', 'n8n-nodes-base.httpRequest', 4.2, [5500, 400], {
  method: 'POST',
  url: `${WAHA}/api/startTyping`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: ${M}.chatId }) }}`,
  options: { timeout: 10000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
no('Perguntar ao Cidinho', 'n8n-nodes-base.httpRequest', 4.2, [5720, 400], {
  method: 'POST',
  url: 'http://127.0.0.1:5678/webhook/cidinho',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: "={{ JSON.stringify({ mensagens: $('Preparar Cidinho').first().json.mensagens, primeira: $('Preparar Cidinho').first().json.primeira }) }}",
  options: { timeout: 90000 },
}, { onError: 'continueRegularOutput' });
no('Resposta da IA', 'n8n-nodes-base.set', 3.4, [5940, 400], {
  assignments: { assignments: [campo('resposta', `={{ $json.texto || ${JSON.stringify(TEXTO_FALHA_IA)} }}`)] },
  options: {},
});
// Enquanto a IA pensava, a pessoa mandou outra mensagem? Então esta resposta é
// descartada: a execução da mensagem nova responde tudo junto.
no('Conferir de novo', 'n8n-nodes-base.dataTable', 1.1, [6160, 400], {
  resource: 'row', operation: 'get', dataTableId: tabela(TABELA_FALAS),
  matchType: 'allConditions',
  filters: { conditions: [
    { keyName: 'telefone', condition: 'eq', keyValue: `={{ ${M}.telefone }}` },
    { keyName: 'papel', condition: 'eq', keyValue: 'user' },
  ] },
  returnAll: false, limit: 1, orderBy: true, orderByColumn: 'createdAt', orderByDirection: 'DESC',
}, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
no('Ainda é a última?', 'n8n-nodes-base.if', 2.2, [6380, 400], {
  conditions: condicoes([verdadeiro("={{ !$json.msgid || $json.msgid === $('Fala da pessoa').first().json.msgid }}")]),
  options: {},
});
no('Resposta fixa', 'n8n-nodes-base.set', 3.4, [5500, 760], {
  assignments: { assignments: [campo('resposta', '={{ $json.resposta }}')] },
  options: {},
});
no('Resposta final', 'n8n-nodes-base.set', 3.4, [6600, 560], {
  assignments: { assignments: [campo('resposta', "={{ $('Resposta da IA').isExecuted ? $('Resposta da IA').first().json.resposta : $('Resposta fixa').first().json.resposta }}")] },
  options: {},
});
no('Enviar resposta do Cidinho', 'n8n-nodes-base.httpRequest', 4.2, [6820, 560], {
  method: 'POST',
  url: `${WAHA}/api/sendText`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: ${M}.chatId, text: $json.resposta, linkPreview: false }) }}`,
  options: { timeout: 30000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
no('Resposta para guardar', 'n8n-nodes-base.code', 2, [7040, 560], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: a fala do Cidinho vai para a tabela (a da pessoa já foi guardada antes).
const id = $('Tipo da mensagem').first().json.msgid || String(Date.now());
return [{ json: {
  telefone: $('Telefone').first().json.telefone,
  papel: 'assistant',
  texto: $('Resposta final').first().json.resposta,
  quando: new Date().toISOString(),
  msgid: 'resposta-' + id,
} }];`,
});
no('Guardar resposta', 'n8n-nodes-base.dataTable', 1.1, [7260, 560], {
  resource: 'row', operation: 'insert', dataTableId: tabela(TABELA_FALAS), columns: insercao(), options: {},
}, { onError: 'continueRegularOutput' });

// ---- opção 6: avisa o responsável (uma vez por conversa de 24 h)
no('Avisar o responsável?', 'n8n-nodes-base.if', 2.2, [7480, 560], {
  conditions: condicoes([verdadeiro("={{ $('Preparar Cidinho').isExecuted && $('Preparar Cidinho').first().json.avisarDono === true }}")]),
  options: {},
});
// O WhatsApp pode guardar o número sem o nono dígito: o WAHA diz o chatId certo.
no('Número do responsável', 'n8n-nodes-base.httpRequest', 4.2, [7700, 480], {
  method: 'GET',
  url: `${WAHA}/api/contacts/check-exists`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendQuery: true,
  queryParameters: { parameters: [{ name: 'phone', value: AVISO_ATENDIMENTO_PARA }, { name: 'session', value: SESSAO }] },
  options: { timeout: 15000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
no('Avisar o responsável', 'n8n-nodes-base.httpRequest', 4.2, [7920, 480], {
  method: 'POST',
  url: `${WAHA}/api/sendText`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ (() => {
  const t = String(${M}.telefone || '');
  const tel = t.length === 13 ? '(' + t.slice(2, 4) + ') ' + t.slice(4, 9) + '-' + t.slice(9) : (t || ${M}.chatId);
  const ultimas = ($('Preparar Cidinho').first().json.ultimas || []).filter(Boolean);
  const linhas = ['🔔 *Pedido de atendimento no WhatsApp do RG*', '', 'Uma pessoa respondeu *6* (falar com uma pessoa).', 'Telefone: ' + tel];
  if (t) linhas.push('https://wa.me/' + t);
  if (ultimas.length) linhas.push('', 'Antes ela escreveu:', ...ultimas.map((u) => '• ' + u));
  return JSON.stringify({ session: '${SESSAO}', chatId: $json.chatId || '${AVISO_ATENDIMENTO_PARA}@c.us', text: linhas.join('\n'), linkPreview: false });
})() }}`,
  options: { timeout: 30000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });

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
liga('Apagar conversa antiga', 'Tipo da mensagem');
liga('Tipo da mensagem', 'Que tipo?');
liga('Que tipo?', 'Fala da pessoa', 0);
liga('Que tipo?', 'Baixar áudio', 1);
liga('Que tipo?', 'Resposta fixa', 2);
liga('Baixar áudio', 'Transcrever áudio');
liga('Transcrever áudio', 'Ler transcrição');
liga('Ler transcrição', 'Áudio entendido?');
liga('Áudio entendido?', 'Fala da pessoa', 0);
liga('Áudio entendido?', 'Resposta fixa', 1);
liga('Fala da pessoa', 'Mensagem nova?');
liga('Mensagem nova?', 'Campos da fala');
liga('Campos da fala', 'Guardar fala da pessoa');
liga('Guardar fala da pessoa', 'Esperar a pessoa terminar');
liga('Esperar a pessoa terminar', 'Conversa recente');
liga('Conversa recente', 'Preparar Cidinho');
liga('Preparar Cidinho', 'Minha vez?');
liga('Minha vez?', 'Usar a IA?', 0);
liga('Usar a IA?', 'Digitando', 0);
liga('Usar a IA?', 'Resposta fixa', 1);
liga('Digitando', 'Perguntar ao Cidinho');
liga('Perguntar ao Cidinho', 'Resposta da IA');
liga('Resposta da IA', 'Conferir de novo');
liga('Conferir de novo', 'Ainda é a última?');
liga('Ainda é a última?', 'Resposta final', 0);
liga('Resposta fixa', 'Resposta final');
liga('Resposta final', 'Enviar resposta do Cidinho');
liga('Enviar resposta do Cidinho', 'Resposta para guardar');
liga('Resposta para guardar', 'Guardar resposta');
liga('Guardar resposta', 'Avisar o responsável?');
liga('Avisar o responsável?', 'Número do responsável', 0);
liga('Número do responsável', 'Avisar o responsável');
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
