// Why Code: registra a mudanca de estado da sessao do WhatsApp (WAHA, evento
// session.status) e decide se avisa que o numero voltou. Caido, ele nao consegue
// avisar: a falta do resumo das 21h e o sinal.
const s = String($('Ler mensagem').first().json.status || '').toUpperCase();
const dados = $getWorkflowStaticData('global');
const antes = dados.sessao || { status: 'WORKING', desde: '' };
const agoraISO = new Date().toISOString();
const voltou = s === 'WORKING' && antes.status && antes.status !== 'WORKING';
if (s && s !== antes.status) dados.sessao = { status: s, desde: agoraISO };
const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const hora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?');
const texto = voltou ? '✅ O WhatsApp do RG voltou a funcionar. Estava ' + antes.status + ' desde ' + hora(antes.desde) + '.' : '';
return [{ json: { dia, tipo: 'sessao_' + (s || 'desconhecido').toLowerCase(), pessoa: '', avisar: voltou, texto } }];
