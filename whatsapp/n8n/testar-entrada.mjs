// Testa, sem n8n, o codigo dos nos do fluxo de entrada (cin-whatsapp-entrada.json):
// leitura do evento do WAHA, tipo da mensagem, decisao do Cidinho (menu, opcoes,
// codigo CIN-, cancelamento, midia, emoji, pausa, contexto), resposta do agendamento,
// alertas e eventos. Roda o codigo gerado, com $ e $input falsos.
//
// Uso: node whatsapp/n8n/testar-entrada.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const aqui = dirname(fileURLToPath(import.meta.url));
const fluxo = JSON.parse(readFileSync(join(aqui, 'cin-whatsapp-entrada.json'), 'utf8'));
const codigoDe = (nome) => {
  const n = fluxo.nodes.find((x) => x.name === nome);
  if (!n) throw new Error('nó não existe: ' + nome);
  return n.parameters.jsCode;
};

// Relogio fixo para os testes que dependem da hora (abertura de segunda, 8h).
const DateReal = Date;
function relogio(iso) {
  const fixo = new DateReal(iso).getTime();
  globalThis.Date = class extends DateReal {
    constructor(...a) { super(...(a.length ? a : [fixo])); }
    static now() { return fixo; }
  };
}
function relogioReal() { globalThis.Date = DateReal; }

async function rodar(nome, { nos = {}, input = [], estatico = {} } = {}) {
  const $ = (n) => {
    const itens = nos[n];
    return {
      isExecuted: Array.isArray(itens),
      first: () => ({ json: (itens || [])[0] }),
      all: () => (itens || []).map((json) => ({ json })),
      item: { json: (itens || [])[0] },
    };
  };
  const $input = { first: () => ({ json: input[0] }), all: () => input.map((json) => ({ json })) };
  const fn = new Function('$', '$input', '$getWorkflowStaticData', `return (async () => {\n${codigoDe(nome)}\n})();`);
  const r = await fn($, $input, () => estatico);
  return (r || []).map((i) => i.json);
}

let ok = 0;
let falhas = 0;
async function caso(nome, f) {
  try { await f(); ok++; console.log('ok    ' + nome); } catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + String(e.message).split('\n').slice(0, 6).join('\n      ')); } finally { relogioReal(); }
}

// ---------- Ler mensagem
const segredo = /HASH_SEGREDO = "([0-9a-f]{64})"/.exec(codigoDe('Ler mensagem'))[1];
const evento = (corpo, hash = segredo) => rodar('Ler mensagem', { nos: { 'Hash do segredo': [{ segredoHash: hash, body: corpo }] } });

await caso('Ler mensagem: SAIR de alguém', async () => {
  const [r] = await evento({ event: 'message.any', session: 'cin', payload: { from: '553599990000@c.us', fromMe: false, body: 'Sair!' } });
  assert.equal(r.valido, true); assert.equal(r.comando, 'sair'); assert.equal(r.chatId, '553599990000@c.us');
});
await caso('Ler mensagem: digitada no celular do número pausa', async () => {
  const [r] = await evento({ event: 'message.any', session: 'cin', me: { id: '553584215361@c.us' }, payload: { from: '553599990000@c.us', fromMe: true, source: 'app', body: 'oi, tudo bem?' } });
  assert.equal(r.valido, true); assert.equal(r.comando, 'pausar'); assert.equal(r.chatId, '553599990000@c.us');
});
await caso('Ler mensagem: o chat vem em "to" quando "from" é o próprio número', async () => {
  const [r] = await evento({ event: 'message.any', session: 'cin', me: { id: '553584215361@c.us' }, payload: { from: '553584215361@c.us', to: '10000000000001@lid', fromMe: true, source: 'app', body: 'x' } });
  assert.equal(r.chatId, '10000000000001@lid'); assert.equal(r.ehLid, true); assert.equal(r.comando, 'pausar');
});
await caso('Ler mensagem: o que o próprio fluxo mandou (API) é ignorado', async () => {
  const [r] = await evento({ event: 'message.any', session: 'cin', payload: { from: '553599990000@c.us', fromMe: true, source: 'api', body: 'aviso' } });
  assert.equal(r.valido, false);
});
await caso('Ler mensagem: sem source (origem desconhecida) não pausa', async () => {
  const [r] = await evento({ event: 'message.any', session: 'cin', payload: { from: '553599990000@c.us', fromMe: true, body: 'x' } });
  assert.equal(r.valido, false);
});
await caso('Ler mensagem: evento da sessão e segredo errado', async () => {
  const [s] = await evento({ event: 'session.status', session: 'cin', payload: { status: 'FAILED' } });
  assert.equal(s.tipoEvento, 'sessao'); assert.equal(s.status, 'FAILED'); assert.equal(s.valido, true);
  const [e] = await evento({ event: 'message', session: 'cin', payload: { from: '553599990000@c.us', body: 'oi' } }, 'f'.repeat(64));
  assert.equal(e.valido, false);
});
await caso('Ler mensagem: grupo e status ficam de fora', async () => {
  const [g] = await evento({ event: 'message', session: 'cin', payload: { from: '1203630@g.us', body: 'oi' } });
  const [st] = await evento({ event: 'message', session: 'cin', payload: { from: 'status@broadcast', body: 'oi' } });
  assert.equal(g.valido, false); assert.equal(st.valido, false);
});

// ---------- Pausa (IF "Sem pausa?": le as pausas da conversa e compara a data)
await caso('Pausa: segura com "ate" no futuro (ISO ou formato do banco); vencida ou vazia, não', async () => {
  const no = fluxo.nodes.find((x) => x.name === 'Sem pausa?');
  const expr = no.parameters.conditions.conditions[0].leftValue.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const semPausa = (linhas) => new Function('$', `return (${expr});`)(() => ({ all: () => linhas.map((json) => ({ json })) }));
  relogio('2026-11-22T15:20:00Z');
  assert.equal(semPausa([{ chave: 'x', ate: '2026-11-23 15:15:24.208' }]), false, 'formato do banco, UTC sem Z');
  assert.equal(semPausa([{ chave: 'x', ate: '2026-11-23T15:15:24.208Z' }]), false, 'ISO');
  assert.equal(semPausa([{ chave: 'x', ate: '2026-11-22 10:00:00.000' }]), true, 'vencida');
  assert.equal(semPausa([{}]), true, 'sem pausa');
  assert.equal(semPausa([{ error: { message: 'x' } }]), true, 'falha na leitura: responde');
});

// ---------- Telefone
await caso('Telefone: celular sem o nono dígito, LID e fixo (fixo vira chave do chat)', async () => {
  const [a] = await rodar('Telefone', { nos: { 'Ler mensagem': [{ chatId: '553599901497@c.us', ehLid: false }] }, input: [{}] });
  assert.equal(a.telefone, '5535999901497'); assert.equal(a.conversa, '5535999901497');
  const [b] = await rodar('Telefone', { nos: { 'Ler mensagem': [{ chatId: '123@lid', ehLid: true }] }, input: [{ lid: '123@lid', pn: '553599990000@c.us' }] });
  assert.equal(b.telefone, '5535999990000');
  const [c] = await rodar('Telefone', { nos: { 'Ler mensagem': [{ chatId: '553535040397@c.us', ehLid: false }] }, input: [{}] });
  assert.equal(c.telefone, ''); assert.equal(c.conversa, 'chat_553535040397@c.us');
});

// ---------- Tipo da mensagem
const tipo = (payload) => rodar('Tipo da mensagem', { nos: { 'Hash do segredo': [{ body: { payload } }] } });
await caso('Tipo: foto com legenda, figurinha, áudio, localização e mensagem citada', async () => {
  const [foto] = await tipo({ id: 'm1', hasMedia: true, media: { mimetype: 'image/jpeg' }, body: 'não consigo finalizar' });
  assert.equal(foto.tipo, 'texto'); assert.equal(foto.texto, '[foto] não consigo finalizar');
  const [fig] = await tipo({ id: 'm2', hasMedia: true, media: { mimetype: 'image/webp' } });
  assert.equal(fig.tipo, 'figurinha');
  const [aud] = await tipo({ id: 'm3', hasMedia: true, media: { mimetype: 'audio/ogg; codecs=opus', url: 'http://localhost:3000/api/files/x.oga' } });
  assert.equal(aud.tipo, 'audio'); assert.equal(aud.urlAudio, 'http://camara-itanhandu_waha-cin:3000/api/files/x.oga');
  const [loc] = await tipo({ id: 'm4', body: '' });
  assert.equal(loc.texto, '[mídia]');
  const [cit] = await tipo({ id: 'm5', body: 'cancelar', replyTo: { body: '✅ *Maria, seu RG está agendado: quinta, 27/11, às 14h30*\nCódigo: CIN-AB12CD34' } });
  assert.match(cit.citado, /CIN-AB12CD34/);
});

// ---------- Preparar Cidinho
// Datas relativas ao relogio em uso (o real ou o fixo de relogio()), para o teste valer em qualquer dia.
const iso = (minAtras) => new Date(Date.now() - minAtras * 60000).toISOString();
let seq = 0;
const fala = (papel, texto, minAtras) => ({ id: ++seq, telefone: '5535999990000', papel, texto, quando: iso(minAtras), msgid: 'm' + seq });
const aviso = (texto, horasAtras) => ({ fromMe: true, source: 'api', body: texto, timestamp: Math.floor((Date.now() - horasAtras * 3600000) / 1000) });
const CONF = (cod) => `✅ *Maria, seu RG está agendado: quinta, 27/11, às 14h30*\n📍 Câmara de Itanhandu\nCódigo: ${cod}\n\nLeve:`;
async function preparar(rajada, { historico = [], whats = [], citado = '' } = {}) {
  const falas = [...historico];
  rajada.forEach((t, i) => falas.push(fala('user', t, 0.5 - i * 0.1)));
  const ultimaUser = [...falas].reverse().find((f) => f.papel === 'user');
  const [r] = await rodar('Preparar Cidinho', { nos: {
    'Fala da pessoa': [{ msgid: ultimaUser.msgid }],
    'Conversa recente': falas,
    'Últimas do WhatsApp': whats.length ? whats : [{}],
    'Tipo da mensagem': [{ citado }],
  } });
  return r;
}
const BOTAO = 'Olá! Tenho uma dúvida sobre o RG.';

await caso('Preparar: botão do site abre o menu com apresentação, sem IA', async () => {
  const r = await preparar([BOTAO]);
  assert.equal(r.caminho, 'fixa'); assert.match(r.resposta, /^Oi! Sou o \*Cidinho\*/); assert.deepEqual(r.eventos, ['menu']);
});
await caso('Preparar: "6" avisa o responsável uma vez e diz o horário', async () => {
  const r = await preparar(['6']);
  assert.equal(r.caminho, 'fixa'); assert.match(r.resposta, /terça a sexta, das 14h às 17h/); assert.deepEqual(r.avisar, ['atendimento']);
  const de = await preparar(['6'], { historico: [fala('alerta', 'atendimento', 30)] });
  assert.deepEqual(de.avisar, [], 'mesmo motivo nao repete em 24 h');
});
await caso('Preparar: "atendimento" e "quero falar com uma pessoa" viram opção 6', async () => {
  assert.match((await preparar(['Atendimento'])).resposta, /Avisei a equipe/);
  assert.match((await preparar(['Quero falar com uma pessoa'])).resposta, /Avisei a equipe/);
});
await caso('Preparar: código escrito consulta (mesmo junto de "cancelar")', async () => {
  const a = await preparar(['CIN-ab12cd34']);
  assert.equal(a.caminho, 'agendamento'); assert.equal(a.acao, 'consultar'); assert.equal(a.protocolo, 'CIN-AB12CD34');
  const b = await preparar(['quero cancelar cin ab12cd34']);
  assert.equal(b.acao, 'consultar'); assert.equal(b.protocolo, 'CIN-AB12CD34');
});
await caso('Preparar: CANCELAR depois da consulta cancela; passada meia hora, não', async () => {
  const consulta = 'Seu RG (CIN-AB12CD34) está marcado para *quinta, 27/11, às 14h30*, na Câmara.\nPara cancelar e liberar a vaga, responda *CANCELAR*.';
  const r = await preparar(['cancelar'], { historico: [fala('user', 'CIN-AB12CD34', 6), fala('assistant', consulta, 5)] });
  assert.equal(r.caminho, 'agendamento'); assert.equal(r.acao, 'cancelar'); assert.equal(r.protocolo, 'CIN-AB12CD34');
  const sim = await preparar(['Sim, pode cancelar'], { historico: [fala('user', 'CIN-AB12CD34', 6), fala('assistant', consulta, 5)] });
  assert.equal(sim.acao, 'cancelar');
  const velho = await preparar(['cancelar'], { historico: [fala('user', 'CIN-AB12CD34', 41), fala('assistant', consulta, 40)] });
  assert.equal(velho.caminho, 'ia', 'sem pedido pendente e sem confirmacao no WhatsApp: a IA pede o codigo');
});
await caso('Preparar: "não vou poder ir" usa o código da confirmação recente', async () => {
  const r = await preparar(['Não vou poder ir amanhã'], { whats: [aviso(CONF('CIN-ZX98YU76'), 20)] });
  assert.equal(r.caminho, 'agendamento'); assert.equal(r.acao, 'consultar'); assert.equal(r.protocolo, 'CIN-ZX98YU76');
});
await caso('Preparar: mensagem citando a confirmação usa o código dela', async () => {
  const r = await preparar(['quero cancelar'], { citado: CONF('CIN-QW12ER34') });
  assert.equal(r.protocolo, 'CIN-QW12ER34');
});
await caso('Preparar: dois agendamentos no mesmo WhatsApp pedem o código', async () => {
  const r = await preparar(['quero cancelar'], { whats: [aviso(CONF('CIN-AAAAAAA1'), 30), aviso(CONF('CIN-BBBBBBB2'), 20)] });
  assert.equal(r.caminho, 'fixa'); assert.match(r.resposta, /mais de um agendamento/);
});
await caso('Preparar: opção 3 consulta direto com o código; sem código, texto fixo', async () => {
  const a = await preparar(['3'], { whats: [aviso(CONF('CIN-ZX98YU76'), 20)] });
  assert.equal(a.acao, 'consultar');
  const b = await preparar(['3']);
  assert.equal(b.caminho, 'fixa'); assert.match(b.resposta, /código do agendamento/);
});
await caso('Preparar: confirmação de mais de 8 dias não conta', async () => {
  const r = await preparar(['quero cancelar'], { whats: [aviso(CONF('CIN-ZX98YU76'), 24 * 9)] });
  assert.equal(r.caminho, 'ia');
});
await caso('Preparar: só foto, áudio ruim e emoji', async () => {
  assert.match((await preparar(['[foto]'])).resposta, /Não consigo ver foto/);
  assert.match((await preparar(['[áudio não entendido]'])).resposta, /entender o seu áudio/);
  const e = await preparar(['❤️']);
  assert.equal(e.caminho, 'silencio');
});
await caso('Preparar: na abertura de segunda, foto ou "não consigo finalizar" avisa o responsável', async () => {
  relogio('2026-11-23T11:30:00Z'); // segunda, 8h30 em Sao Paulo
  const r = await preparar(['[foto] não consigo finalizar o agendamento']);
  assert.deepEqual(r.avisar, ['site']); assert.equal(r.caminho, 'ia');
  relogio('2026-11-24T11:30:00Z'); // terca
  const t = await preparar(['[foto] não consigo finalizar o agendamento']);
  assert.deepEqual(t.avisar, []);
});
await caso('Preparar: IA recebe o último aviso sem nome nem código, e a mensagem citada', async () => {
  const lembrete = '⏰ *Francisca, seu atendimento do RG é hoje, às 16h10*\n📍 Câmara de Itanhandu.';
  const r = await preparar(['Foi ótimo atendimento'], { whats: [aviso(CONF('CIN-ZX98YU76'), 30), aviso(lembrete, 2)], citado: 'Francisca, como foi o seu atendimento do RG? Conte no Google' });
  assert.equal(r.caminho, 'ia');
  assert.match(r.contexto, /Último aviso .*seu atendimento do RG é hoje, às 16h10/);
  assert.doesNotMatch(r.contexto, /Francisca/); assert.doesNotMatch(r.contexto, /ZX98YU76/);
  assert.match(r.contexto, /respondendo a esta mensagem: «como foi o seu atendimento/);
});
await caso('Preparar: teto e rajada', async () => {
  const historico = [];
  for (let i = 0; i < 20; i++) { historico.push(fala('user', 'p' + i, 300 - i * 2)); historico.push(fala('assistant', 'r' + i, 299 - i * 2)); }
  assert.match((await preparar(['mais uma'], { historico })).resposta, /já respondi bastante/);
  const falas = [fala('user', 'oi', 1), fala('user', 'tudo bem?', 0.1)];
  const [r] = await rodar('Preparar Cidinho', { nos: { 'Fala da pessoa': [{ msgid: falas[0].msgid }], 'Conversa recente': falas, 'Últimas do WhatsApp': [{}], 'Tipo da mensagem': [{}] } });
  assert.equal(r.minhaVez, false);
});

// ---------- Resposta do agendamento
const respostaAg = (acao, protocolo, resposta) => rodar('Resposta do agendamento', { nos: { 'Preparar Cidinho': [{ acao, protocolo }] }, input: [resposta] });
await caso('Resposta do agendamento: consulta, cancelamento, não achado e falha', async () => {
  const [c] = await respostaAg('consultar', 'CIN-AB12CD34', { ok: true, situacao: 'agendado', quando: 'quinta, 27/11, às 14h30', podeCancelar: true });
  assert.match(c.resposta, /\(CIN-AB12CD34\).*\*quinta, 27\/11, às 14h30\*/); assert.match(c.resposta, /responda \*CANCELAR\*/); assert.equal(c.evento, 'consulta');
  const [x] = await respostaAg('cancelar', 'CIN-AB12CD34', { ok: true, cancelado: true, situacao: 'cancelado', quando: 'quinta, 27/11, às 14h30' });
  assert.match(x.resposta, /foi \*cancelado\* e a vaga foi liberada/); assert.equal(x.evento, 'cancelamento');
  const [n] = await respostaAg('consultar', 'CIN-AB12CD34', { ok: false, motivo: 'nao_encontrado' });
  assert.match(n.resposta, /Não achei o agendamento CIN-AB12CD34/); assert.equal(n.evento, 'protocolo_nao_encontrado');
  const [f] = await respostaAg('consultar', 'CIN-AB12CD34', { error: { message: 'timeout' } });
  assert.equal(f.evento, 'falha_agendamento');
  const [p] = await respostaAg('cancelar', 'CIN-AB12CD34', { ok: false, motivo: 'nao_pode_cancelar', situacao: 'passou', quando: 'ontem' });
  assert.match(p.resposta, /já passou/); assert.equal(p.evento, 'cancelamento_recusado');
});

// ---------- Alertas e eventos
await caso('Alertas: um item por motivo, com telefone e o que a pessoa escreveu', async () => {
  const r = await rodar('Alertas', { nos: {
    'Preparar Cidinho': [{ avisar: ['atendimento', 'site'], ultimas: ['Olá! Tenho uma dúvida sobre o RG.'], atual: '[foto] não consigo finalizar' }],
    'Telefone': [{ telefone: '5535999990000', chatId: '553599990000@c.us' }],
  } });
  assert.equal(r.length, 2);
  assert.match(r[0].texto, /Pedido de atendimento[\s\S]*\(35\) 99999-0000[\s\S]*wa\.me\/5535999990000[\s\S]*• Olá!/);
  assert.match(r[1].texto, /Abertura das vagas[\s\S]*Ela escreveu: \[foto\] não consigo finalizar/);
  assert.deepEqual(await rodar('Alertas', { nos: { 'Preparar Cidinho': [{ avisar: [] }], 'Telefone': [{}] } }), []);
});
await caso('Eventos: resposta, caminho, falhas e alertas, sem texto nem telefone', async () => {
  const r = await rodar('Eventos', { nos: {
    'Preparar Cidinho': [{ eventos: ['protocolo_consulta'], avisar: ['atendimento'] }],
    'Hash do telefone': [{ telefoneHash: 'abcdef0123456789' }],
    'Enviar resposta do Cidinho': [{ error: { message: 'x' } }],
    'Resposta do agendamento': [{ evento: 'consulta' }],
  } });
  assert.deepEqual(r.map((x) => x.tipo), ['resposta', 'protocolo_consulta', 'falha_envio', 'consulta', 'alerta_atendimento']);
  assert.ok(r.every((x) => x.pessoa === 'abcdef0123' && /^\d{4}-\d{2}-\d{2}$/.test(x.dia)));
});
await caso('Evento da sessão: avisa só quando o número volta', async () => {
  const estatico = {};
  const [caiu] = await rodar('Evento da sessão', { nos: { 'Ler mensagem': [{ status: 'FAILED' }] }, estatico });
  assert.equal(caiu.avisar, false); assert.equal(caiu.tipo, 'sessao_failed');
  const [voltou] = await rodar('Evento da sessão', { nos: { 'Ler mensagem': [{ status: 'WORKING' }] }, estatico });
  assert.equal(voltou.avisar, true); assert.match(voltou.texto, /voltou a funcionar\. Estava FAILED desde/);
  const [denovo] = await rodar('Evento da sessão', { nos: { 'Ler mensagem': [{ status: 'WORKING' }] }, estatico });
  assert.equal(denovo.avisar, false);
});

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
