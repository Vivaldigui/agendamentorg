// Why Code: mesmo filtro do robo da Sucupira. O Whisper inventa frase em silencio ou
// ruido ("Thank you for watching", "Legendas pela comunidade"); ai a fala vira
// [áudio não entendido] e a resposta fixa pede para repetir.
const t = String(($input.first().json || {}).text || '').trim();
const c = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const palavras = c.split(/[^a-z0-9]+/).filter(Boolean);
const EN = new Set(['the', 'you', 'your', 'thank', 'thanks', 'watching', 'watch', 'much', 'same', 'this', 'that', 'with', 'what', 'are', 'is', 'it', 'and', 'of', 'for', 'my', 'subscribe', 'video', 'please']);
const PT = new Set(['de', 'que', 'o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'em', 'um', 'uma', 'para', 'pra', 'com', 'nao', 'eu', 'voce', 'vc', 'sim', 'quero', 'qual', 'quando', 'como', 'tem', 'no', 'na', 'se', 'mais', 'por', 'me', 'meu', 'minha', 'ta', 'e', 'esse', 'essa', 'isso', 'aqui', 'ai', 'la', 'bom', 'boa', 'dia', 'tarde', 'noite', 'oi', 'ola', 'obrigado', 'obrigada', 'rg', 'identidade', 'agendar', 'agendamento', 'vaga', 'certidao']);
const en = palavras.filter((w) => EN.has(w)).length;
const pt = palavras.filter((w) => PT.has(w)).length;
const alucinacao = /(thank you|thanks for watching|for watching|subscribe|subtitles?|legendas? (pela|por)|legendado|amara\.org|obrigad[oa] por assistir|inscreva-se)/.test(c) || (en >= 2 && pt === 0);
const audioOk = /[a-z]/.test(c) && !alucinacao;
return [{ json: { audioOk, texto: audioOk ? t.slice(0, 2000) : '[áudio não entendido]' } }];
