// Why Code: mesma regra de telefoneWhatsApp em functions/whatsapp-cin.js (55 + DDD + nono digito).
// "conversa" e a chave das tabelas do Cidinho (falas, pausa): o telefone, ou o chat quando
// nao ha celular brasileiro (fixo com WhatsApp Business, numero estrangeiro, LID sem
// traducao). Antes essas pessoas caiam todas na mesma conversa (telefone vazio).
const m = $('Ler mensagem').first().json;
const lid = $input.first().json || {};
const origem = m.ehLid ? String(lid.pn || lid.phoneNumber || '') : m.chatId;
let d = origem.split('@')[0].replace(/\D/g, '');
if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = d.slice(0, 2) + '9' + d.slice(2);
const telefone = /^[1-9]{2}9\d{8}$/.test(d) ? '55' + d : '';
return [{ json: { ...m, telefone, conversa: telefone || ('chat_' + m.chatId), em: new Date().toISOString() } }];
