// Why Code: decide se esta execucao responde (e a ultima mensagem da rajada?), aplica
// o teto e escolhe o caminho: silencio (so emoji), resposta fixa (menu, opcoes, midia),
// agendamento (codigo CIN-: consulta e cancelamento) ou IA, com a conversa e o contexto
// (ultimo aviso do WhatsApp e mensagem citada). Tambem decide os avisos ao responsavel.
// Constantes (montar-entrada.mjs): TETO, TEXTO_TETO, MENU_APRESENTACAO, MENU_OPCOES,
// OPCAO_1_PERGUNTA, OPCOES_FIXAS, TEXTOS_OPCAO_6, TEXTO_MIDIA, TEXTO_AUDIO,
// TEXTO_QUAL_CODIGO, BOTAO, CUMPRIMENTO
const minha = $('Fala da pessoa').first().json.msgid;
const agora = Date.now();
const limite = agora - 24 * 3600 * 1000;
const linhas = $('Conversa recente').all().map((i) => i.json)
  .filter((r) => r && r.telefone && r.papel && new Date(r.quando).getTime() >= limite);
const ordem = (a, b) => (new Date(a.quando) - new Date(b.quando)) || ((a.id || 0) - (b.id || 0));
const falas = linhas.filter((r) => r.papel === 'user' || r.papel === 'assistant').sort(ordem);
const alertasJa = new Set(linhas.filter((r) => r.papel === 'alerta').map((r) => String(r.texto || '')));
const daPessoa = falas.filter((r) => r.papel === 'user');
const ultima = daPessoa[daPessoa.length - 1];
// Chegou outra mensagem depois desta: quem responde e a execucao da mais nova.
if (!ultima || ultima.msgid !== minha) return [{ json: { minhaVez: false } }];

const respostas = falas.filter((r) => r.papel === 'assistant');
const ultimas = daPessoa.slice(-4, -1).map((f) => String(f.texto || '').slice(0, 200));
let fim = -1;
falas.forEach((f, i) => { if (f.papel === 'assistant') fim = i; });
const anteriores = falas.slice(0, fim + 1).slice(-12);
const rajada = falas.slice(fim + 1);
const primeira = respostas.length === 0;
const ultimaResposta = respostas[respostas.length - 1] || null;
const textos = rajada.map((f) => String(f.texto || '').trim());
const juntas = textos.join(' ');
const atual = juntas.slice(0, 300);
const normal = juntas.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavras = normal.split(/[^a-z0-9]+/).filter(Boolean);
const frase = palavras.join(' ');

const eventos = [];
const avisar = [];
const saida = (caminho, extra) => [{ json: { minhaVez: true, caminho, eventos, avisar, ultimas, atual, ...extra } }];
const fixa = (resposta, evento) => { if (evento) eventos.push(evento); return saida('fixa', { resposta }); };
const agendamento = (acao, protocolo) => {
  eventos.push(acao === 'cancelar' ? 'protocolo_cancelar' : 'protocolo_consulta');
  return saida('agendamento', { acao, protocolo });
};

if (respostas.length >= TETO) return fixa(TEXTO_TETO, 'teto');

// O que o WhatsApp guarda desta conversa: os avisos (a confirmacao traz o codigo CIN-).
const doWhats = $('Últimas do WhatsApp').isExecuted
  ? $('Últimas do WhatsApp').all().map((i) => i.json).filter((m) => m && m.timestamp)
  : [];
const AVISO = /(RG (está |foi )?agendado|Agendamento do RG confirmado|Agendamento confirmado|seu RG é hoje|Hoje é o seu RG|atendimento do RG é hoje|foi \*cancelado\*|\*cancelou\*|RG chegou|RG está pronto|identidade chegou|Como foi o seu atendimento)/i;
const avisos = doWhats
  .filter((m) => m.fromMe === true && m.source !== 'app' && AVISO.test(String(m.body || ''))
    && agora / 1000 - Number(m.timestamp) < 8 * 86400)
  .sort((a, b) => b.timestamp - a.timestamp);
const RE_COD = /\bcin[\s-]*([a-z0-9]{8})\b/i;
const codigoEm = (t) => { const m = RE_COD.exec(String(t || '')); return m ? 'CIN-' + m[1].toUpperCase() : ''; };
const codigosDosAvisos = [...new Set(avisos.map((a) => codigoEm(a.body)).filter(Boolean))];
const citado = String($('Tipo da mensagem').first().json.citado || '');

// Abertura das vagas (segunda, 8h-10h59): foto ou "nao consigo agendar" pode ser falha do site.
const sp = new Date(new Date(agora).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const abertura = sp.getDay() === 1 && sp.getHours() >= 8 && sp.getHours() < 11;
const temFoto = /\[foto\]/i.test(juntas);
const problemaSite = /\b(nao|n)\s+(consigo|consegui|to conseguindo|estou conseguindo|da pra|deu pra)\s+(finalizar|concluir|terminar|confirmar|agendar|marcar|entrar)|\berro\b|\btravou\b|\btravando\b|nao carrega|site (caiu|fora do ar)/.test(normal);
if (abertura && (temFoto || problemaSite) && !alertasJa.has('site')) avisar.push('site');

// 1) So emoji ou pontuacao (❤️, 👍): nao responde.
if (textos.length && textos.every((t) => t && !/[\p{L}\p{N}]/u.test(t))) {
  eventos.push('silencio');
  return saida('silencio', {});
}

// 2) Confirmacao do cancelamento: a ultima resposta mostrou o codigo e pediu CANCELAR ha menos de 30 min.
const pediuCancelar = ultimaResposta && /responda \*CANCELAR\*/i.test(String(ultimaResposta.texto || ''))
  && agora - new Date(ultimaResposta.quando).getTime() < 30 * 60 * 1000;
const codPendente = pediuCancelar ? codigoEm(ultimaResposta.texto) : '';
if (codPendente && /^(sim|s|pode|pode sim|pode cancelar|sim pode cancelar|cancela|cancelar|cancelar sim|sim cancelar|quero cancelar|confirmo|confirmar|isso)$/.test(frase)) {
  return agendamento('cancelar', codPendente);
}

// 3) Codigo CIN- escrito: consulta (e a resposta pede CANCELAR para cancelar).
const codTexto = codigoEm(juntas);
if (codTexto) return agendamento('consultar', codTexto);

// 4) Quer cancelar ou saber do agendamento sem mandar o codigo: o da mensagem citada,
//    ou o da confirmacao recente (so se houver um). Sem codigo, a IA pede o codigo.
const querCancelar = /\b(cancel\w*|desmarc\w*|desagend\w*)\b|nao vou (poder )?(ir|comparecer)|nao (posso|consigo|vou conseguir) (ir|comparecer)/.test(normal);
const querConsultar = /\b(meu|minha) (agendamento|horario|hora|rg|vaga)\b|\bque (dia|hora|horas) (e|fica|ficou) (o )?meu\b|\bconsult\w*\b|\b(estou|to|fui|ta|esta) agendad/.test(normal);
const opcaoTres = /^\s*3\s*(️)?\s*(⃣)?\s*[.)]?\s*$/.test(juntas);
if (querCancelar || querConsultar || opcaoTres) {
  const codCitado = codigoEm(citado);
  if (codCitado) return agendamento('consultar', codCitado);
  if (codigosDosAvisos.length === 1) return agendamento('consultar', codigosDosAvisos[0]);
  if (codigosDosAvisos.length > 1) return fixa(TEXTO_QUAL_CODIGO, 'protocolo_varios');
  if (opcaoTres) return fixa(OPCOES_FIXAS[3], 'opcao_3');
}

// 5) So midia, ou audio que nao deu para entender.
const MARCA = /^\[(foto|vídeo|video|documento|mídia|midia|áudio não entendido|audio nao entendido)\]$/i;
if (textos.length && textos.every((t) => MARCA.test(t))) {
  return fixa(textos.some((t) => /udio/i.test(t)) ? TEXTO_AUDIO : TEXTO_MIDIA, 'midia');
}

// 6) Menu: so cumprimento (ou MENU) ou o texto pronto do botao do site; um numero de 1 a 6 escolhe.
const CUMPRIMENTOS = new Set(CUMPRIMENTO);
const doBotao = (' ' + frase + ' ').includes(' ' + BOTAO + ' ');
const resto = doBotao ? (' ' + frase + ' ').split(' ' + BOTAO + ' ').join(' ').split(' ').filter(Boolean) : palavras;
const soNumero = /^\s*([1-6])\s*(️)?\s*(⃣)?\s*[.)]?\s*$/.exec(juntas);
let opcao = soNumero ? Number(soNumero[1]) : 0;
const PEDE_PESSOA = /^(quero |queria |preciso |gostaria de )?(falar com |conversar com )?(um |uma |o |a )?(atendente|atendimento|atendimento humano|humano|pessoa|pessoa de verdade|alguem|funcionario)( por favor| pfv| pf)?$/;
if (!opcao && PEDE_PESSOA.test(frase)) opcao = 6;
const ehMenu = !opcao && !juntas.includes('?') && palavras.length > 0 && (doBotao || juntas.length <= 40)
  && resto.every((w) => CUMPRIMENTOS.has(w));
if (ehMenu) return fixa(primeira ? MENU_APRESENTACAO : MENU_OPCOES, 'menu');
if (opcao >= 2) {
  // Opcao 6 avisa o responsavel uma vez por conversa de 24 h.
  if (opcao === 6 && !alertasJa.has('atendimento') && !respostas.some((f) => TEXTOS_OPCAO_6.includes(f.texto))) {
    avisar.push('atendimento');
  }
  return fixa(OPCOES_FIXAS[opcao], 'opcao_' + opcao);
}

// 7) IA, com o contexto do WhatsApp (sem codigo nem nome).
const mensagens = [];
for (const f of [...anteriores, ...rajada]) {
  const ult = mensagens[mensagens.length - 1];
  if (ult && ult.role === f.papel) ult.content += '\n' + f.texto;
  else mensagens.push({ role: f.papel, content: String(f.texto || '') });
}
while (mensagens.length && mensagens[0].role !== 'user') mensagens.shift();
if (opcao === 1 && mensagens.length) mensagens[mensagens.length - 1].content = OPCAO_1_PERGUNTA;
const limpar = (t) => String(t || '').replace(/\*/g, '').replace(/\bcin[\s-]*[a-z0-9]{8}\b/gi, 'CIN-…')
  .replace(/^([^\p{L}]*)\p{Lu}\p{Ll}+, /u, '$1').replace(/\s+/g, ' ').trim();
const hora = (ts) => new Date(Number(ts) * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const contexto = [];
if (avisos[0]) contexto.push('Último aviso que este número mandou à pessoa (' + hora(avisos[0].timestamp) + '): «' + limpar(String(avisos[0].body || '').split('\n')[0]).slice(0, 160) + '».');
if (citado) contexto.push('A pessoa está respondendo a esta mensagem: «' + limpar(citado).slice(0, 200) + '».');
eventos.push(opcao === 1 ? 'opcao_1' : 'ia');
return saida('ia', { mensagens, primeira, contexto: contexto.join('\n') });
