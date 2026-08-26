"use strict";

// Aviso em pop-up configurado pela recepcao e exibido no site publico.
//
// A recepcao grava um unico mapa em configuracoes/agenda.avisoPopup com a
// mensagem, a janela de exibicao e o estilo. O backend NAO decide sozinho se o
// aviso aparece: ele publica a janela junto com o conteudo e o site avalia o
// intervalo com o relogio do servidor ja sincronizado.
//
// Isso e proposital. A leitura publica fica atras do CDN por ate
// s-maxage + stale-while-revalidate (300s + 600s no perfil padrao) e ainda por
// 3 minutos no cache local do navegador. Se o corte fosse feito so aqui, uma
// copia gravada antes do fim continuaria mostrando o aviso por ate ~15 minutos
// depois da hora marcada, e um aviso programado apareceria atrasado na mesma
// medida. Com a janela no corpo da resposta, o instante de entrada e o de saida
// sao exatos mesmo quando a copia e velha.
//
// A contrapartida e que um aviso ainda nao iniciado viaja na resposta publica
// antes da hora. Nao ha segredo aqui -- e um comunicado que sera publico de
// qualquer forma --, mas vale lembrar quem for escrever a mensagem.
//
// Aviso ja encerrado nao viaja: economiza corpo e evita que uma copia antiga do
// CDN reviva um texto que a recepcao considera vencido.

const LIMITE_TITULO = 80;
const LIMITE_MENSAGEM = 600;

const TIPOS_AVISO_POPUP = ["informacao", "atencao", "urgente"];
const TIPO_AVISO_POPUP_PADRAO = "informacao";

const REPETICOES_AVISO_POPUP = ["uma-vez", "sempre"];
const REPETICAO_AVISO_POPUP_PADRAO = "uma-vez";

const FORMATO_INSTANTE_POPUP = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const FORMATO_ID_POPUP = /^[a-z0-9]{1,24}$/;

// Texto de painel vira texto de modal: sem caracteres de controle e sem
// sequencias longas de linhas em branco, que empurrariam os botoes do modal
// para fora da tela no celular.
function limparTextoAvisoPopup(valor, limite) {
  return String(valor === null || valor === undefined ? "" : valor)
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, (caractere) => (caractere === "\n" ? caractere : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limite);
}

function instantePopupValido(valor) {
  return FORMATO_INSTANTE_POPUP.test(String(valor || ""));
}

// Devolve o aviso normalizado ou null. null significa "nao existe aviso
// publicavel": desligado, sem mensagem ou com janela impossivel. Quem chama nao
// precisa repetir nenhuma dessas checagens.
function normalizarAvisoPopup(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  if (valor.ativo !== true) return null;

  const mensagem = limparTextoAvisoPopup(valor.mensagem, LIMITE_MENSAGEM);
  if (!mensagem) return null;

  const inicioEm = instantePopupValido(valor.inicioEm) ? String(valor.inicioEm) : null;
  const fimEm = instantePopupValido(valor.fimEm) ? String(valor.fimEm) : null;
  // O fim e obrigatorio de proposito: um aviso sem prazo sobrevive a propria
  // razao de existir e ninguem lembra de desligar.
  if (!inicioEm || !fimEm) return null;
  if (fimEm <= inicioEm) return null;

  const tipo = TIPOS_AVISO_POPUP.includes(String(valor.tipo))
    ? String(valor.tipo)
    : TIPO_AVISO_POPUP_PADRAO;
  const repetir = REPETICOES_AVISO_POPUP.includes(String(valor.repetir))
    ? String(valor.repetir)
    : REPETICAO_AVISO_POPUP_PADRAO;
  // O id identifica a VERSAO do aviso no aparelho do visitante. Sem ele, editar
  // a mensagem nao reapresentaria o pop-up para quem ja tinha dispensado o
  // texto anterior. O painel gera um id novo a cada gravacao.
  const id = FORMATO_ID_POPUP.test(String(valor.id || ""))
    ? String(valor.id)
    : `w${inicioEm.replace(/\D/g, "")}`;

  return {
    id,
    titulo: limparTextoAvisoPopup(valor.titulo, LIMITE_TITULO),
    mensagem,
    tipo,
    inicioEm,
    fimEm,
    repetir
  };
}

// Janela de exibicao, avaliada com o instante de quem pergunta: no backend o
// relogio do servidor, no site o relogio ja sincronizado com ele.
function avisoPopupVisivel(aviso, agora) {
  if (!aviso || !instantePopupValido(agora)) return false;
  if (!instantePopupValido(aviso.inicioEm) || !instantePopupValido(aviso.fimEm)) return false;
  return String(agora) >= aviso.inicioEm && String(agora) <= aviso.fimEm;
}

// O que a resposta publica carrega. Avisos futuros seguem junto para que a
// entrada seja pontual mesmo servida do cache; avisos encerrados ficam de fora.
function avisoPopupPublico(valor, agora) {
  const aviso = normalizarAvisoPopup(valor);
  if (!aviso) return null;
  if (instantePopupValido(agora) && String(agora) > aviso.fimEm) return null;
  return aviso;
}

module.exports = {
  LIMITE_TITULO_AVISO_POPUP: LIMITE_TITULO,
  LIMITE_MENSAGEM_AVISO_POPUP: LIMITE_MENSAGEM,
  TIPOS_AVISO_POPUP,
  TIPO_AVISO_POPUP_PADRAO,
  REPETICOES_AVISO_POPUP,
  REPETICAO_AVISO_POPUP_PADRAO,
  limparTextoAvisoPopup,
  normalizarAvisoPopup,
  avisoPopupVisivel,
  avisoPopupPublico
};
