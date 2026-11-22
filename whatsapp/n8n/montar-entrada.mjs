// Gera whatsapp/n8n/cin-whatsapp-entrada.json: o fluxo do n8n da Camara que
// recebe do WAHA da CIN (sessao cin) as mensagens do numero.
//
// Uso: node whatsapp/n8n/montar-entrada.mjs <sha256 do segredo>
// O WAHA manda o segredo no cabecalho X-Cin-Entrada (configurado na sessao);
// o fluxo guarda so o SHA-256 dele.
//
// O que faz:
// - "SAIR" (ou PARAR, PARE, STOP): poe o numero em cin_whatsapp_saida e confirma.
//   O fluxo de envio consulta essa tabela e nao manda mais nada.
// - "VOLTAR": tira o numero da tabela e confirma.
// - Mensagem digitada no celular do proprio numero (WAHA message.any, source "app"):
//   o robo para de responder aquela conversa por 24 h, renovadas a cada mensagem
//   (22/11/2026, pedido do responsavel: "similar ao bot 1010 da Sucupira").
// - Evento session.status do WAHA: entra no resumo diario e, quando o numero volta,
//   avisa o responsavel.
// - Qualquer outra mensagem: o Cidinho (whatsapp/robo/) responde, com rajada,
//   teto, menu, consulta e cancelamento pelo codigo CIN- (function cinRoboAgendamento)
//   e IA com o contexto do ultimo aviso. O codigo dos nos fica em codigo-entrada/.
// - Ignora grupo, status, canal e as mensagens que o proprio fluxo mandou (API).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarFluxo } from './validar-fluxo.mjs';

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
const igual = (expr, valor) => cond(expr, { type: 'string', operation: 'equals' }, valor);
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
// Codigo de no Code lido de codigo-entrada/, com as constantes no comeco.
const codigo = (arquivo, constantes = {}) => {
  const cabecalho = Object.entries(constantes).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join('\n');
  const corpo = readFileSync(join(aqui, 'codigo-entrada', arquivo), 'utf8').replace(/\r\n/g, '\n');
  return (cabecalho ? `${cabecalho}\n` : '') + corpo;
};
const noCodigo = (nome, posicao, jsCode, extra = {}) => no(nome, 'n8n-nodes-base.code', 2, posicao, {
  mode: 'runOnceForAllItems', language: 'javaScript', jsCode,
}, extra);

const WAHA = 'http://camara-itanhandu_waha-cin:3000';
const SESSAO = 'cin';
const NUMERO_PROPRIO = '553584215361';
const SITE = 'https://cin.itanhandu.cam.mg.gov.br';
const LINK_CONSULTAR = `${SITE}/cin/consultar-ou-cancelar/`;
const TELEFONE_RECEPCAO = '(35) 3504-0397';
// Consulta e cancelamento pelo codigo CIN- (functions/whatsapp-cin-robo.js), com o
// token do robo na credencial "Robo da CIN (functions)"; a function guarda so o SHA-256.
const ROBO_URL = 'https://southamerica-east1-agendamento-cin-itanhandu.cloudfunctions.net/cinRoboAgendamento';
const credencialWaha = { credentials: { httpHeaderAuth: { id: 'CinWahaKey000001', name: 'WAHA da CIN' } } };
const credencialRobo = { credentials: { httpHeaderAuth: { id: 'CinRoboToken0001', name: 'Robô da CIN (functions)' } } };
const M = "$('Telefone').first().json";
const P = "$('Preparar Cidinho').first().json";
// Quem recebe os avisos (pedido de atendimento, problema na abertura, numero de volta).
const AVISO_ATENDIMENTO_PARA = '5535999901497';
const DIA_SP = "new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })";

const TEXTO_SAIR = '✅ *Pronto!* Você não vai mais receber avisos do agendamento do RG por aqui.\n\nSe mudar de ideia, responda *VOLTAR*.';
const TEXTO_VOLTAR = '🔔 *Pronto!* Você volta a receber por aqui os avisos do agendamento do RG.\n\nPara parar, responda *SAIR*.';

// Liberados: SHA-256 do telefone (55 + DDD + numero), para o numero nao ir para o git.
// Liberado para todos em 15/11/2026. Para voltar a so o celular de teste:
// ['a34df2e6d776e0d9b5cb7ebe45db6d8a28d3e8f4756d48cdc86e6a56a9f3854d'] (os demais ficam sem resposta).
const CIDINHO_LIBERADOS = ['todos'];
const CIDINHO_TETO_24H = 20;
const CIDINHO_ESPERA_S = 9;
const PAUSA_HUMANO_H = 24;
const WHISPER = 'http://sucupira_naturale_whisper:9000/asr';
const TABELA_FALAS = 'cin_cidinho_falas';
const TABELA_PAUSA = 'cin_cidinho_pausa';
const TABELA_EVENTOS = 'cin_cidinho_eventos';
const TEXTO_MIDIA = 'Não consigo ver foto, vídeo nem documento. 🙏 Escreva sua dúvida em texto ou mande um áudio, por favor.\nSe preferir falar com uma pessoa, responda *6*.';
const TEXTO_AUDIO = 'Não consegui entender o seu áudio. 🙏 Pode mandar de novo ou escrever a sua dúvida?';
const TEXTO_TETO = 'Por hoje eu já respondi bastante por aqui. 🙏 Para continuar, fale com a recepção da Câmara pelo WhatsApp *(35) 3504-0397*.\n\nAgendar, consultar ou cancelar: ' + SITE;
const TEXTO_QUAL_CODIGO = 'Achei mais de um agendamento neste WhatsApp. Mande o *código* (começa com CIN-) do que você quer consultar ou cancelar. Ele está em cada mensagem de confirmação.';
const TEXTO_FALHA_IA = 'Desculpe, não consegui responder agora. 🙏 Para falar com a recepção da Câmara, chame no WhatsApp *(35) 3504-0397*. O agendamento é só pelo site: ' + SITE;
// ---- menu com numeros (18/11/2026). Opcoes 2 a 6 com resposta fixa (sem IA); a 1 vai
// para a IA (depende da agenda do momento); a 3 consulta direto quando a confirmacao
// recente tem o codigo; a 6 avisa o responsavel.
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
// Texto pronto do botao "Duvidas? WhatsApp" do site (editorial/modelos/base.mjs e
// public/index.html). Sozinho ou com cumprimento, abre o menu sem gastar IA.
const TEXTO_DO_BOTAO_SITE = 'Olá! Tenho uma dúvida sobre o RG.';
const TEXTO_DO_BOTAO_NORMAL = TEXTO_DO_BOTAO_SITE.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter(Boolean).join(' ');
const CUMPRIMENTO = ['oi', 'oii', 'oiii', 'ola', 'opa', 'e', 'ai', 'eai', 'bom', 'boa', 'dia', 'tarde', 'noite', 'cidinho', 'menu', 'opcoes', 'opcao', 'inicio', 'ajuda', 'tudo', 'bem'];
const OPCOES_FIXAS = {
  2: [
    '📄 *O que levar:*',
    '• *Certidão* original, digital ou autenticada em cartório:',
    '   – solteiro: nascimento',
    '   – casado: casamento',
    '   – viúvo ou divorciado: casamento com averbação',
    '• Número do CPF',
    '• Comprovante de endereço',
    'Xerox e foto da certidão de papel não valem.',
  ].join('\n'),
  3: [
    'Para consultar ou cancelar por aqui, mande o *código do agendamento* (começa com CIN-). Ele está na mensagem de confirmação que enviamos neste WhatsApp.',
    `Ou pelo site, com CPF, data de nascimento e código: ${LINK_CONSULTAR}`,
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
    'Pronto! ✅ Avisei a equipe da Câmara. O atendimento é de *terça a sexta, das 14h às 17h*: uma pessoa vai falar com você nesse horário.',
    'Se preferir, chame a recepção: *(35) 3504-0397*.',
  ].join('\n'),
};
// Textos da opcao 6 (o atual e o de 18/11): o aviso ao responsavel sai uma vez por 24 h.
const TEXTOS_OPCAO_6 = [
  OPCOES_FIXAS[6],
  'Pronto! ✅ Avisei a equipe da Câmara. Uma pessoa vai falar com você assim que possível.\nSe preferir, chame a recepção: *(35) 3504-0397*.',
];

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
// O WhatsApp pode guardar o numero do responsavel sem o nono digito: o WAHA diz o chatId certo.
const numeroDoResponsavel = (nome, posicao) => no(nome, 'n8n-nodes-base.httpRequest', 4.2, posicao, {
  method: 'GET',
  url: `${WAHA}/api/contacts/check-exists`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendQuery: true,
  queryParameters: { parameters: [{ name: 'phone', value: AVISO_ATENDIMENTO_PARA }, { name: 'session', value: SESSAO }] },
  options: { timeout: 15000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
const avisarResponsavel = (nome, posicao, textoExpr) => no(nome, 'n8n-nodes-base.httpRequest', 4.2, posicao, {
  method: 'POST',
  url: `${WAHA}/api/sendText`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: $json.chatId || '${AVISO_ATENDIMENTO_PARA}@c.us', text: ${textoExpr}, linkPreview: false }) }}`,
  options: { timeout: 30000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
const criarTabela = (nome, posicao, tabelaNome, cols) => no(nome, 'n8n-nodes-base.dataTable', 1.1, posicao, {
  resource: 'table', operation: 'create', tableName: tabelaNome, columns: colunas(cols),
  options: { createIfNotExists: true },
}, { executeOnce: true });
const inserir = (nome, posicao, tabelaNome, extra = {}) => no(nome, 'n8n-nodes-base.dataTable', 1.1, posicao, {
  resource: 'row', operation: 'insert', dataTableId: tabela(tabelaNome), columns: insercao(), options: {},
}, extra);

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
noCodigo('Ler mensagem', [440, 300], codigo('ler-mensagem.js', { HASH_SEGREDO: hashSegredo, SESSAO, NUMERO_PROPRIO }));
no('Mensagem válida?', 'n8n-nodes-base.if', 2.2, [660, 300], {
  conditions: condicoes([verdadeiro('={{ $json.valido }}')]),
  options: {},
});
// Tabelas criadas depois de conferir o segredo (antes, um pedido sem segredo tambem as criava).
criarTabela('Tabela de quem saiu', [880, 300], 'cin_whatsapp_saida', [['telefone', 'string'], ['em', 'string']]);
criarTabela('Tabela da pausa', [1100, 300], TABELA_PAUSA, [['chave', 'string'], ['ate', 'date']]);
criarTabela('Tabela da conversa', [1320, 300], TABELA_FALAS, [['telefone', 'string'], ['papel', 'string'], ['texto', 'string'], ['quando', 'date'], ['msgid', 'string']]);
criarTabela('Tabela de eventos', [1540, 300], TABELA_EVENTOS, [['dia', 'string'], ['tipo', 'string'], ['pessoa', 'string']]);
no('Sessão?', 'n8n-nodes-base.if', 2.2, [1760, 300], {
  conditions: condicoes([igual("={{ $('Ler mensagem').first().json.tipoEvento }}", 'sessao')]),
  options: {},
});

// ---- evento da sessao do WhatsApp
noCodigo('Evento da sessão', [1980, 40], codigo('evento-da-sessao.js'));
no('Campos do evento da sessão', 'n8n-nodes-base.set', 3.4, [2200, 40], {
  assignments: { assignments: [campo('dia', '={{ $json.dia }}'), campo('tipo', '={{ $json.tipo }}'), campo('pessoa', '={{ $json.pessoa }}')] },
  options: {},
});
inserir('Registrar evento da sessão', [2420, 40], TABELA_EVENTOS, { onError: 'continueRegularOutput', alwaysOutputData: true });
no('Avisar a volta?', 'n8n-nodes-base.if', 2.2, [2640, 40], {
  conditions: condicoes([verdadeiro("={{ $('Evento da sessão').first().json.avisar === true }}")]),
  options: {},
});
numeroDoResponsavel('Número do responsável (sessão)', [2860, 40]);
avisarResponsavel('Avisar a volta do WhatsApp', [3080, 40], "$('Evento da sessão').first().json.texto");

// ---- mensagem: telefone (o WhatsApp pode mandar o contato como LID)
no('É LID?', 'n8n-nodes-base.if', 2.2, [1980, 300], {
  conditions: condicoes([verdadeiro("={{ $('Ler mensagem').first().json.ehLid }}")]),
  options: {},
});
no('Telefone do LID', 'n8n-nodes-base.httpRequest', 4.2, [2200, 220], {
  method: 'GET',
  url: `={{ '${WAHA}/api/${SESSAO}/lids/' + encodeURIComponent($('Ler mensagem').first().json.chatId) }}`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  options: { timeout: 15000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
noCodigo('Telefone', [2420, 300], codigo('telefone.js'));
no('Hash do telefone', 'n8n-nodes-base.crypto', 1, [2640, 300], {
  action: 'hash',
  type: 'SHA256',
  value: `={{ String(${M}.telefone || '') }}`,
  dataPropertyName: 'telefoneHash',
  encoding: 'hex',
});
no('Comando', 'n8n-nodes-base.switch', 3.2, [2860, 300], {
  rules: {
    values: ['sair', 'voltar', 'pausar'].map((c) => ({
      conditions: condicoes([igual(`={{ ${M}.comando }}`, c)]), renameOutput: true, outputKey: c,
    })),
  },
  options: { fallbackOutput: 'extra', renameFallbackOutput: 'outro' },
});

// ---- SAIR
enviarTexto('Confirmar saída', [3080, 0], TEXTO_SAIR);
no('Ainda não saiu?', 'n8n-nodes-base.dataTable', 1.1, [3300, 0], {
  resource: 'row', operation: 'rowNotExists', dataTableId: tabela('cin_whatsapp_saida'),
  filters: { conditions: [{ keyName: 'telefone', keyValue: `={{ ${M}.telefone }}` }] },
});
no('Campos de quem saiu', 'n8n-nodes-base.set', 3.4, [3520, 0], {
  assignments: { assignments: [campo('telefone', `={{ ${M}.telefone }}`), campo('em', `={{ ${M}.em }}`)] },
  options: {},
});
inserir('Registrar saída', [3740, 0], 'cin_whatsapp_saida');

// ---- VOLTAR
no('Apagar saída', 'n8n-nodes-base.dataTable', 1.1, [3080, 160], {
  resource: 'row', operation: 'deleteRows', dataTableId: tabela('cin_whatsapp_saida'),
  filters: { conditions: [{ keyName: 'telefone', keyValue: `={{ ${M}.telefone }}` }] },
}, { alwaysOutputData: true });
enviarTexto('Confirmar volta', [3300, 160], TEXTO_VOLTAR);

// ---- mensagem digitada no celular do numero: robo em silencio nesta conversa por 24 h
no('Campos da pausa', 'n8n-nodes-base.set', 3.4, [3080, 320], {
  assignments: { assignments: [
    campo('chave', `={{ ${M}.conversa }}`),
    campo('ate', `={{ new Date(Date.now() + ${PAUSA_HUMANO_H} * 3600 * 1000).toISOString() }}`),
  ] },
  options: {},
});
inserir('Registrar pausa', [3300, 320], TABELA_PAUSA, { onError: 'continueRegularOutput' });
noCodigo('Evento da pausa', [3520, 320], `// Why Code: evento do resumo diario quando o responsavel responde pelo celular do numero.
return [{ json: { dia: ${DIA_SP}, tipo: 'pausa_humano', pessoa: String($('Hash do telefone').first().json.telefoneHash || '').slice(0, 10) } }];`);
inserir('Registrar evento da pausa', [3740, 320], TABELA_EVENTOS, { onError: 'continueRegularOutput' });

// ---- qualquer outra mensagem: o Cidinho, se a conversa nao estiver em pausa.
// Le as pausas da conversa e compara a data aqui: o "existe linha?" das data tables
// so compara igualdade (testado em 22/11/2026: com "ate > agora" a pausa nao segurava).
no('Pausa da conversa', 'n8n-nodes-base.dataTable', 1.1, [2970, 560], {
  resource: 'row', operation: 'get', dataTableId: tabela(TABELA_PAUSA),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'chave', condition: 'eq', keyValue: `={{ ${M}.conversa }}` }] },
  returnAll: false, limit: 5, orderBy: true, orderByColumn: 'createdAt', orderByDirection: 'DESC',
}, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
// "ate" volta como ISO ou como "AAAA-MM-DD hh:mm:ss" (UTC, sem o Z): os dois viram UTC.
const EXPR_PAUSADO = "$('Pausa da conversa').all().some((i) => { const a = String((i.json || {}).ate || ''); if (!a) return false; const t = new Date(/[zZ]$|[+-]\\d\\d:?\\d\\d$/.test(a) ? a : a.replace(' ', 'T') + 'Z').getTime(); return t > Date.now(); })";
no('Sem pausa?', 'n8n-nodes-base.if', 2.2, [3190, 560], {
  conditions: condicoes([verdadeiro(`={{ !(${EXPR_PAUSADO}) }}`)]),
  options: {},
});
no('Cidinho atende?', 'n8n-nodes-base.if', 2.2, [3300, 560], {
  conditions: condicoes([verdadeiro(`={{ ${JSON.stringify(CIDINHO_LIBERADOS)}.includes('todos') || ${JSON.stringify(CIDINHO_LIBERADOS)}.includes($('Hash do telefone').first().json.telefoneHash) }}`)]),
  options: {},
});
// A conversa so vale por 24 h: apaga de todos as falas mais antigas.
no('Apagar conversa antiga', 'n8n-nodes-base.dataTable', 1.1, [3520, 560], {
  resource: 'row', operation: 'deleteRows', dataTableId: tabela(TABELA_FALAS),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'quando', condition: 'lt', keyValue: '={{ new Date(Date.now() - 24 * 3600 * 1000).toISOString() }}' }] },
  options: {},
}, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
noCodigo('Tipo da mensagem', [3740, 560], codigo('tipo-da-mensagem.js', { WAHA }));
no('Que tipo?', 'n8n-nodes-base.switch', 3.2, [3960, 560], {
  rules: {
    values: ['texto', 'audio'].map((t) => ({
      conditions: condicoes([igual('={{ $json.tipo }}', t)]), renameOutput: true, outputKey: t,
    })),
  },
  // Figurinha (e o que mais nao for texto nem audio) fica sem resposta.
  options: {},
});

// ---- audio: baixar do WAHA e transcrever no Whisper
no('Baixar áudio', 'n8n-nodes-base.httpRequest', 4.2, [4180, 720], {
  method: 'GET',
  url: '={{ $json.urlAudio }}',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  options: { timeout: 30000, response: { response: { responseFormat: 'file' } } },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
no('Transcrever áudio', 'n8n-nodes-base.httpRequest', 4.2, [4400, 720], {
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
noCodigo('Ler transcrição', [4620, 720], codigo('ler-transcricao.js'));

// ---- rajada: guarda a fala, espera e so a ultima responde
noCodigo('Fala da pessoa', [4840, 480], `// Why Code: junta o texto (digitado, transcrito ou a marca da midia) com o id da mensagem para a tabela.
const t = $('Tipo da mensagem').first().json;
const texto = $('Ler transcrição').isExecuted ? $('Ler transcrição').first().json.texto : t.texto;
return [{ json: {
  telefone: $('Telefone').first().json.conversa,
  papel: 'user',
  texto: String(texto || '').slice(0, 2000),
  quando: new Date().toISOString(),
  msgid: t.msgid || ('sem-id-' + Date.now()),
} }];`);
no('Mensagem nova?', 'n8n-nodes-base.dataTable', 1.1, [5060, 480], {
  resource: 'row', operation: 'rowNotExists', dataTableId: tabela(TABELA_FALAS),
  filters: { conditions: [{ keyName: 'msgid', keyValue: "={{ $('Fala da pessoa').first().json.msgid }}" }] },
});
no('Campos da fala', 'n8n-nodes-base.set', 3.4, [5280, 480], {
  assignments: { assignments: ['telefone', 'papel', 'texto', 'quando', 'msgid'].map((c) => campo(c, `={{ $('Fala da pessoa').first().json.${c} }}`)) },
  options: {},
});
inserir('Guardar fala da pessoa', [5500, 480], TABELA_FALAS);
no('Esperar a pessoa terminar', 'n8n-nodes-base.wait', 1.1, [5720, 480], {
  resume: 'timeInterval', amount: CIDINHO_ESPERA_S, unit: 'seconds',
}, { webhookId: 'c2b17d40-8e2a-4f6b-9c1d-5a3e7f9b2c03' });
no('Conversa recente', 'n8n-nodes-base.dataTable', 1.1, [5940, 480], {
  resource: 'row', operation: 'get', dataTableId: tabela(TABELA_FALAS),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'telefone', condition: 'eq', keyValue: `={{ ${M}.conversa }}` }] },
  returnAll: false, limit: 40, orderBy: true, orderByColumn: 'createdAt', orderByDirection: 'DESC',
}, { executeOnce: true, alwaysOutputData: true });
// Avisos e respostas que o numero mandou nesta conversa (o codigo CIN- vem da confirmacao).
no('Últimas do WhatsApp', 'n8n-nodes-base.httpRequest', 4.2, [6160, 480], {
  method: 'GET',
  url: `={{ '${WAHA}/api/${SESSAO}/chats/' + encodeURIComponent(${M}.chatId) + '/messages' }}`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendQuery: true,
  queryParameters: { parameters: [{ name: 'limit', value: '20' }, { name: 'downloadMedia', value: 'false' }] },
  options: { timeout: 10000 },
}, { ...credencialWaha, executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
noCodigo('Preparar Cidinho', [6380, 480], codigo('preparar-cidinho.js', {
  TETO: CIDINHO_TETO_24H, TEXTO_TETO, MENU_APRESENTACAO, MENU_OPCOES, OPCAO_1_PERGUNTA, OPCOES_FIXAS,
  TEXTOS_OPCAO_6, TEXTO_MIDIA, TEXTO_AUDIO, TEXTO_QUAL_CODIGO, BOTAO: TEXTO_DO_BOTAO_NORMAL, CUMPRIMENTO,
}));
no('Minha vez?', 'n8n-nodes-base.if', 2.2, [6600, 480], {
  conditions: condicoes([verdadeiro('={{ $json.minhaVez }}')]),
  options: {},
});
// Marca como lida antes de responder (o WAHA recomenda, contra bloqueio).
no('Marcar como lida', 'n8n-nodes-base.httpRequest', 4.2, [6820, 480], {
  method: 'POST',
  url: `${WAHA}/api/sendSeen`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: ${M}.chatId }) }}`,
  options: { timeout: 10000 },
}, { ...credencialWaha, executeOnce: true, onError: 'continueRegularOutput' });
no('Caminho', 'n8n-nodes-base.switch', 3.2, [7040, 480], {
  rules: {
    values: ['ia', 'fixa', 'agendamento'].map((c) => ({
      conditions: condicoes([igual(`={{ ${P}.caminho }}`, c)]), renameOutput: true, outputKey: c,
    })),
  },
  // "silencio" (so emoji) nao tem saida: nada e enviado.
  options: {},
});

// ---- IA
no('Digitando', 'n8n-nodes-base.httpRequest', 4.2, [7260, 320], {
  method: 'POST',
  url: `${WAHA}/api/startTyping`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: ${M}.chatId }) }}`,
  options: { timeout: 10000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
no('Perguntar ao Cidinho', 'n8n-nodes-base.httpRequest', 4.2, [7480, 320], {
  method: 'POST',
  url: 'http://127.0.0.1:5678/webhook/cidinho',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ mensagens: ${P}.mensagens, primeira: ${P}.primeira, contexto: ${P}.contexto || '' }) }}`,
  options: { timeout: 90000 },
}, { onError: 'continueRegularOutput' });
no('Resposta da IA', 'n8n-nodes-base.set', 3.4, [7700, 320], {
  assignments: { assignments: [campo('resposta', `={{ $json.texto || ${JSON.stringify(TEXTO_FALHA_IA)} }}`)] },
  options: {},
});
// Enquanto a IA pensava, a pessoa mandou outra mensagem? Entao esta resposta e
// descartada: a execucao da mensagem nova responde tudo junto.
no('Conferir de novo', 'n8n-nodes-base.dataTable', 1.1, [7920, 320], {
  resource: 'row', operation: 'get', dataTableId: tabela(TABELA_FALAS),
  matchType: 'allConditions',
  filters: { conditions: [
    { keyName: 'telefone', condition: 'eq', keyValue: `={{ ${M}.conversa }}` },
    { keyName: 'papel', condition: 'eq', keyValue: 'user' },
  ] },
  returnAll: false, limit: 1, orderBy: true, orderByColumn: 'createdAt', orderByDirection: 'DESC',
}, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
no('Ainda é a última?', 'n8n-nodes-base.if', 2.2, [8140, 320], {
  conditions: condicoes([verdadeiro("={{ !$json.msgid || $json.msgid === $('Fala da pessoa').first().json.msgid }}")]),
  options: {},
});

// ---- resposta fixa (menu, opcoes, midia, teto)
no('Resposta fixa', 'n8n-nodes-base.set', 3.4, [7260, 520], {
  assignments: { assignments: [campo('resposta', `={{ ${P}.resposta }}`)] },
  options: {},
});

// ---- consulta e cancelamento pelo codigo CIN-
no('Agendamento pelo protocolo', 'n8n-nodes-base.httpRequest', 4.2, [7260, 700], {
  method: 'POST',
  url: ROBO_URL,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ acao: ${P}.acao, protocolo: ${P}.protocolo, telefone: ${M}.telefone }) }}`,
  options: { timeout: 20000 },
}, { ...credencialRobo, onError: 'continueRegularOutput' });
noCodigo('Resposta do agendamento', [7480, 700], codigo('resposta-do-agendamento.js', { SITE, LINK_CONSULTAR, TELEFONE_RECEPCAO }));

// ---- envio e registro
no('Resposta final', 'n8n-nodes-base.set', 3.4, [8360, 520], {
  assignments: { assignments: [campo('resposta', "={{ $('Resposta do agendamento').isExecuted ? $('Resposta do agendamento').first().json.resposta : ($('Resposta da IA').isExecuted ? $('Resposta da IA').first().json.resposta : $('Resposta fixa').first().json.resposta) }}")] },
  options: {},
});
no('Enviar resposta do Cidinho', 'n8n-nodes-base.httpRequest', 4.2, [8580, 520], {
  method: 'POST',
  url: `${WAHA}/api/sendText`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ session: '${SESSAO}', chatId: ${M}.chatId, text: $json.resposta, linkPreview: false }) }}`,
  options: { timeout: 30000 },
}, { ...credencialWaha, onError: 'continueRegularOutput' });
noCodigo('Resposta para guardar', [8800, 520], `// Why Code: a fala do Cidinho vai para a tabela (a da pessoa ja foi guardada antes).
const id = $('Tipo da mensagem').first().json.msgid || String(Date.now());
return [{ json: {
  telefone: $('Telefone').first().json.conversa,
  papel: 'assistant',
  texto: $('Resposta final').first().json.resposta,
  quando: new Date().toISOString(),
  msgid: 'resposta-' + id,
} }];`);
inserir('Guardar resposta', [9020, 520], TABELA_FALAS, { onError: 'continueRegularOutput' });
noCodigo('Eventos', [9240, 520], codigo('eventos.js'));
inserir('Registrar eventos', [9460, 520], TABELA_EVENTOS, { onError: 'continueRegularOutput', alwaysOutputData: true });

// ---- avisos ao responsavel (opcao 6; problema no site na abertura), um por motivo a cada 24 h
noCodigo('Alertas', [9680, 520], codigo('alertas.js'));
numeroDoResponsavel('Número do responsável', [9900, 520]);
avisarResponsavel('Avisar o responsável', [10120, 520], "$('Alertas').item.json.texto");
noCodigo('Campos do alerta', [10340, 520], `// Why Code: marca na conversa que o aviso saiu (o mesmo motivo nao repete em 24 h).
const conversa = $('Telefone').first().json.conversa;
return $('Alertas').all().map((a, i) => ({ json: {
  telefone: conversa,
  papel: 'alerta',
  texto: a.json.motivo,
  quando: new Date().toISOString(),
  msgid: 'alerta-' + a.json.motivo + '-' + Date.now() + '-' + i,
} }));`);
inserir('Registrar alerta', [10560, 520], TABELA_FALAS, { onError: 'continueRegularOutput' });

liga('Receber do WAHA', 'Hash do segredo');
liga('Hash do segredo', 'Ler mensagem');
liga('Ler mensagem', 'Mensagem válida?');
liga('Mensagem válida?', 'Tabela de quem saiu', 0);
liga('Tabela de quem saiu', 'Tabela da pausa');
liga('Tabela da pausa', 'Tabela da conversa');
liga('Tabela da conversa', 'Tabela de eventos');
liga('Tabela de eventos', 'Sessão?');
liga('Sessão?', 'Evento da sessão', 0);
liga('Evento da sessão', 'Campos do evento da sessão');
liga('Campos do evento da sessão', 'Registrar evento da sessão');
liga('Registrar evento da sessão', 'Avisar a volta?');
liga('Avisar a volta?', 'Número do responsável (sessão)', 0);
liga('Número do responsável (sessão)', 'Avisar a volta do WhatsApp');
liga('Sessão?', 'É LID?', 1);
liga('É LID?', 'Telefone do LID', 0);
liga('É LID?', 'Telefone', 1);
liga('Telefone do LID', 'Telefone');
liga('Telefone', 'Hash do telefone');
liga('Hash do telefone', 'Comando');
liga('Comando', 'Confirmar saída', 0);
liga('Comando', 'Apagar saída', 1);
liga('Comando', 'Campos da pausa', 2);
liga('Comando', 'Pausa da conversa', 3);
liga('Pausa da conversa', 'Sem pausa?');
liga('Confirmar saída', 'Ainda não saiu?');
liga('Ainda não saiu?', 'Campos de quem saiu');
liga('Campos de quem saiu', 'Registrar saída');
liga('Apagar saída', 'Confirmar volta');
liga('Campos da pausa', 'Registrar pausa');
liga('Registrar pausa', 'Evento da pausa');
liga('Evento da pausa', 'Registrar evento da pausa');
liga('Sem pausa?', 'Cidinho atende?', 0);
liga('Cidinho atende?', 'Apagar conversa antiga', 0);
liga('Apagar conversa antiga', 'Tipo da mensagem');
liga('Tipo da mensagem', 'Que tipo?');
liga('Que tipo?', 'Fala da pessoa', 0);
liga('Que tipo?', 'Baixar áudio', 1);
liga('Baixar áudio', 'Transcrever áudio');
liga('Transcrever áudio', 'Ler transcrição');
liga('Ler transcrição', 'Fala da pessoa');
liga('Fala da pessoa', 'Mensagem nova?');
liga('Mensagem nova?', 'Campos da fala');
liga('Campos da fala', 'Guardar fala da pessoa');
liga('Guardar fala da pessoa', 'Esperar a pessoa terminar');
liga('Esperar a pessoa terminar', 'Conversa recente');
liga('Conversa recente', 'Últimas do WhatsApp');
liga('Últimas do WhatsApp', 'Preparar Cidinho');
liga('Preparar Cidinho', 'Minha vez?');
liga('Minha vez?', 'Marcar como lida', 0);
liga('Marcar como lida', 'Caminho');
liga('Caminho', 'Digitando', 0);
liga('Caminho', 'Resposta fixa', 1);
liga('Caminho', 'Agendamento pelo protocolo', 2);
liga('Digitando', 'Perguntar ao Cidinho');
liga('Perguntar ao Cidinho', 'Resposta da IA');
liga('Resposta da IA', 'Conferir de novo');
liga('Conferir de novo', 'Ainda é a última?');
liga('Ainda é a última?', 'Resposta final', 0);
liga('Resposta fixa', 'Resposta final');
liga('Agendamento pelo protocolo', 'Resposta do agendamento');
liga('Resposta do agendamento', 'Resposta final');
liga('Resposta final', 'Enviar resposta do Cidinho');
liga('Enviar resposta do Cidinho', 'Resposta para guardar');
liga('Resposta para guardar', 'Guardar resposta');
liga('Guardar resposta', 'Eventos');
liga('Eventos', 'Registrar eventos');
liga('Registrar eventos', 'Alertas');
liga('Alertas', 'Número do responsável');
liga('Número do responsável', 'Avisar o responsável');
liga('Avisar o responsável', 'Campos do alerta');
liga('Campos do alerta', 'Registrar alerta');

const nomes = new Set(nos.map((x) => x.name));
for (const { de, para } of ligacoes) {
  if (!nomes.has(de) || !nomes.has(para)) throw new Error(`Ligação com nó inexistente: ${de} -> ${para}`);
}
const connections = {};
for (const { de, para, saida } of ligacoes) {
  connections[de] ??= { main: [] };
  while (connections[de].main.length <= saida) connections[de].main.push([]);
  connections[de].main[saida].push({ node: para, type: 'main', index: 0 });
}
const fluxo = {
  id: 'CinWhatsEntrada1',
  name: 'CIN — receber mensagens do WhatsApp (SAIR, pausa e Cidinho)',
  active: false,
  nodes: nos,
  connections,
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' },
  pinData: {},
  tags: [],
};
validarFluxo(fluxo);
writeFileSync(join(aqui, 'cin-whatsapp-entrada.json'), `${JSON.stringify(fluxo, null, 2)}\n`);
console.log(`cin-whatsapp-entrada.json: ${nos.length} nós, ${ligacoes.length} ligações`);
