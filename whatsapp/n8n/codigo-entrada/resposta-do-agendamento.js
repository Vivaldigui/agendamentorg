// Why Code: transforma a resposta da function cinRoboAgendamento (consulta ou
// cancelamento pelo codigo CIN-) no texto curto do WhatsApp. O codigo vai na resposta
// da consulta: e dele que sai o CANCELAR seguinte (preparar-cidinho.js, passo 2).
// Constantes (montar-entrada.mjs): SITE, LINK_CONSULTAR, TELEFONE_RECEPCAO
const p = $('Preparar Cidinho').first().json;
const r = $input.first().json || {};
const cod = p.protocolo;
const quando = r.quando ? '*' + r.quando + '*' : 'desse agendamento';
const semResposta = r.error || typeof r.ok !== 'boolean' || (r.ok === false && r.motivo === 'erro');
let resposta;
let evento;
if (semResposta) {
  evento = 'falha_agendamento';
  resposta = 'Não consegui consultar agora. 🙏 Tente de novo daqui a pouco ou use o site (CPF, data de nascimento e código): ' + LINK_CONSULTAR + '\nSe preferir, responda *6* para falar com uma pessoa.';
} else if (r.ok === false && r.motivo === 'nao_encontrado') {
  evento = 'protocolo_nao_encontrado';
  resposta = 'Não achei o agendamento ' + cod + ' ligado a este WhatsApp. Confira o código na mensagem de confirmação, ou consulte pelo site (CPF, data de nascimento e código): ' + LINK_CONSULTAR + '\nSe precisar, responda *6*.';
} else if (p.acao === 'cancelar' && r.ok === true && r.cancelado === true) {
  evento = 'cancelamento';
  resposta = 'Pronto! ✅ Seu RG de ' + quando + ' foi *cancelado* e a vaga foi liberada.\nNovas vagas toda segunda, às 8h: ' + SITE;
} else {
  evento = p.acao === 'cancelar' ? 'cancelamento_recusado' : 'consulta';
  switch (r.situacao) {
    case 'agendado':
      resposta = 'Seu RG (' + cod + ') está marcado para ' + quando + ', na Câmara.\nLeve a certidão (original, digital ou autenticada), o CPF e o comprovante de endereço.\nPara cancelar e liberar a vaga, responda *CANCELAR*.';
      break;
    case 'passou':
      resposta = 'O horário desse agendamento (' + (r.quando || cod) + ') já passou. Se precisar de ajuda, responda *6*.';
      break;
    case 'atendido':
      resposta = 'Esse atendimento (' + (r.quando || cod) + ') já foi feito. A carteira chega pelos Correios em até 15 dias úteis; acompanhe no MG App.';
      break;
    case 'faltou':
      resposta = 'Consta falta nesse agendamento (' + (r.quando || cod) + '). Para orientação, fale com a recepção: ' + TELEFONE_RECEPCAO + ', ou responda *6*.';
      break;
    case 'cancelado':
      resposta = 'Esse agendamento (' + (r.quando || cod) + ') está *cancelado*. Novas vagas toda segunda, às 8h: ' + SITE;
      break;
    default:
      resposta = 'Não consegui ver a situação desse agendamento. Consulte pelo site: ' + LINK_CONSULTAR + ', ou responda *6*.';
  }
}
return [{ json: { resposta, evento } }];
