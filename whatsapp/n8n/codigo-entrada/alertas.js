// Why Code: um item por aviso ao responsavel decidido em Preparar Cidinho: pedido de
// atendimento (opcao 6) e, na abertura das vagas, sinal de problema no site.
const p = $('Preparar Cidinho').isExecuted ? $('Preparar Cidinho').first().json : {};
const motivos = Array.isArray(p.avisar) ? p.avisar : [];
if (!motivos.length) return [];
const t = String($('Telefone').first().json.telefone || '');
const tel = t.length === 13 ? '(' + t.slice(2, 4) + ') ' + t.slice(4, 9) + '-' + t.slice(9) : (t || $('Telefone').first().json.chatId);
const ultimas = (p.ultimas || []).filter(Boolean);
const TITULO = {
  atendimento: '🔔 *Pedido de atendimento no WhatsApp do RG*',
  site: '⚠️ *Abertura das vagas: alguém não consegue agendar*',
};
const MOTIVO = {
  atendimento: 'Uma pessoa pediu para falar com uma pessoa (opção 6).',
  site: 'A pessoa mandou foto ou disse que não consegue agendar. Pode ser problema no site.',
};
return motivos.map((motivo) => {
  const linhas = [TITULO[motivo] || '🔔 *Aviso do WhatsApp do RG*', '', MOTIVO[motivo] || motivo, 'Telefone: ' + tel];
  if (t) linhas.push('https://wa.me/' + t);
  if (motivo === 'site' && p.atual) linhas.push('', 'Ela escreveu: ' + p.atual);
  else if (ultimas.length) linhas.push('', 'Antes ela escreveu:', ...ultimas.map((u) => '• ' + u));
  return { json: { motivo, texto: linhas.join('\n') } };
});
