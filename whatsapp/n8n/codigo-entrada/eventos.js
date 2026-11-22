// Why Code: uma linha por evento para o resumo diario, sem texto nem telefone
// (so o dia de Sao Paulo, o tipo e 10 caracteres do hash do telefone, para contar pessoas).
const p = $('Preparar Cidinho').first().json;
const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const pessoa = String($('Hash do telefone').first().json.telefoneHash || '').slice(0, 10);
const tipos = ['resposta', ...(p.eventos || [])];
const deu = (nome) => {
  try { return $(nome).isExecuted ? ($(nome).first().json || {}) : null; } catch (e) { return null; }
};
const envio = deu('Enviar resposta do Cidinho');
if (envio && envio.error) tipos.push('falha_envio');
const ia = deu('Perguntar ao Cidinho');
if (ia && (ia.error || ia.falhou === true)) tipos.push('falha_ia');
const agendamento = deu('Resposta do agendamento');
if (agendamento && agendamento.evento) tipos.push(agendamento.evento);
const baixar = deu('Baixar áudio');
const transcrever = deu('Transcrever áudio');
if ((baixar && baixar.error) || (transcrever && transcrever.error)) tipos.push('falha_audio');
for (const m of (p.avisar || [])) tipos.push('alerta_' + m);
return tipos.filter(Boolean).map((tipo) => ({ json: { dia, tipo, pessoa } }));
