// Why Code: separa texto, audio, figurinha e outra midia; marca o que o Cidinho nao ve
// ([foto], [vídeo], [documento], [mídia]) para tudo passar pela mesma rajada, teto e
// historico; acerta o link do audio e guarda a mensagem citada (contexto da IA).
// Constantes (montar-entrada.mjs): WAHA
const p = ($('Hash do segredo').first().json.body || {}).payload || {};
const msgid = String(p.id || '');
const legenda = String(p.body || '').trim().slice(0, 2000);
const media = p.media || {};
const mime = String(media.mimetype || '').toLowerCase();
const temMidia = p.hasMedia === true || Boolean(mime);
const audio = temMidia && mime.startsWith('audio/');
const figurinha = temMidia && mime === 'image/webp';
let marca = '[mídia]';
if (mime.startsWith('image/')) marca = '[foto]';
else if (mime.startsWith('video/')) marca = '[vídeo]';
else if (mime.startsWith('application/') || mime.startsWith('text/')) marca = '[documento]';
// O WAHA monta o link com o endereco dele mesmo (localhost). Troca SEMPRE pelo
// endereco interno: a chave do WAHA vai junto no pedido e so pode ir para ele.
const urlAudio = audio && media.url ? String(media.url).replace(/^https?:\/\/[^/]+/, WAHA) : '';
let tipo = 'texto';
let texto = legenda;
if (figurinha) tipo = 'figurinha';
else if (audio) {
  tipo = urlAudio ? 'audio' : 'texto';
  texto = urlAudio ? '' : '[áudio não entendido]';
} else if (temMidia) texto = (marca + ' ' + legenda).trim();
else if (!legenda) texto = '[mídia]';
const citado = String((p.replyTo && p.replyTo.body) || '').trim().slice(0, 300);
return [{ json: { tipo, msgid, texto, urlAudio, citado } }];
