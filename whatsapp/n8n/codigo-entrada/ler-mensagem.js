// Why Code: confere o segredo e separa, num passo so, mensagem de alguem, mensagem
// digitada no celular do proprio numero (pausa o robo) e evento da sessao do WhatsApp;
// normaliza o comando (SAIR/VOLTAR).
// Constantes (montar-entrada.mjs): HASH_SEGREDO, SESSAO, NUMERO_PROPRIO
const entrada = $('Hash do segredo').first().json;
const corpo = entrada.body || {};
const p = corpo.payload || {};
const autorizado = entrada.segredoHash === HASH_SEGREDO;
const evento = String(corpo.event || '');
const daSessao = corpo.session === SESSAO;

if (evento === 'session.status') {
  return [{ json: { valido: autorizado && daSessao, autorizado, tipoEvento: 'sessao', status: String(p.status || ''), chatId: '', ehLid: false, comando: 'sessao' } }];
}

const deMim = p.fromMe === true;
const origem = String(p.source || '');
// O WAHA poe o chat em "from" tambem nas mensagens do proprio numero. Se vier o
// proprio numero ali, o chat esta em "to".
let chat = String(p.from || '');
const proprio = String((corpo.me && corpo.me.id) || NUMERO_PROPRIO).split('@')[0].split(':')[0];
if (deMim && p.to && (!chat || chat.split('@')[0].split(':')[0] === proprio)) chat = String(p.to);
const ehChat = /@(c\.us|lid|s\.whatsapp\.net)$/.test(chat);
const ehMensagem = evento === 'message' || evento === 'message.any';
// Do proprio numero, so a mensagem digitada no celular (source "app") conta: ela
// pausa o robo naquela conversa. A que saiu pela API (avisos e respostas) e ignorada.
const valido = autorizado && ehMensagem && daSessao && ehChat && (!deMim || origem === 'app');
const normal = String(p.body || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
let comando = 'outro';
if (deMim) comando = 'pausar';
else if (['SAIR', 'PARAR', 'PARE', 'STOP'].includes(normal)) comando = 'sair';
else if (['VOLTAR', 'VOLTA'].includes(normal)) comando = 'voltar';
return [{ json: { valido, autorizado, tipoEvento: 'mensagem', chatId: chat, ehLid: chat.endsWith('@lid'), comando } }];
