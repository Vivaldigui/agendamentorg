"use strict";

// Politica de cache da leitura publica da agenda.
//
// O site compartilha o CDN usando a chave "atualizar-minuto", que e previsivel
// e escolhida pelo cliente. Sem contencao, uma unica requisicao feita pouco
// antes da virada grava uma resposta "agenda fechada" que continua sendo
// servida depois do horario de abertura. Basta um relogio adiantado, ou alguem
// pedindo de proposito o minuto seguinte.
//
// Tres cuidados sustentam a regra:
//   1. As camadas de cache SOMAM. O CDN segura por s-maxage (+ o periodo de
//      stale-while-revalidate) e so entao entrega ao navegador, que ainda
//      guardaria a copia por max-age. Por isso max-age e sempre 0: o navegador
//      revalida sempre e a unica camada com prazo e o CDN.
//   2. O orcamento de validade e medido a partir da EMISSAO da resposta, nao do
//      inicio das leituras, senao a copia vive alguns segundos a mais do que o
//      cabecalho promete.
//   3. A janela de abertura semanal nao depende de publicacaoDatas ja estar
//      escrita. Se as execucoes de 07:50 e 07:55 falharem, o mapa ainda esta
//      vazio as 07:59 e uma requisicao adiantada cacharia a agenda fechada.

// Janela de virada: alguns minutos antes e depois de cada publicacao.
//
// ANTES, porque uma copia pre-abertura nao pode ser fixada no CDN.
// DEPOIS, porque as execucoes de 07:50/07:55/07:59 podem atrasar: as 08:00 em
// ponto a publicacao deixa de ser "futura" e a agenda ainda fechada voltaria a
// ser cacheavel por 60s.
const MINUTOS_CACHE_CURTO_ANTES = 3;
const MINUTOS_CACHE_CURTO_DEPOIS = 5;

// Enquanto a publicacao programada ainda NAO aparece em publicacaoDatas, a
// janela se estende: prepararAgendaSemanalAutomatica tem maxRetrySeconds 900 e
// timeoutSeconds 120, entao a execucao das 07:59 pode so ter sucesso perto de
// 08:16. Cinco minutos deixariam a agenda ainda fechada voltar a 60s no meio
// desse intervalo. O teto existe para o caso de agenda montada a mao, em que a
// publicacao programada nunca chega ao mapa.
const MINUTOS_CACHE_CURTO_AGUARDANDO_PUBLICACAO = 20;

// Nao usamos no-store nessa janela. Sem CDN, cada visitante executa uma
// transacao Firestore de rate limit cuja chave e SHA256(ip|user-agent): atras
// de um mesmo CGNAT, celulares do mesmo modelo caem no mesmo documento e
// disputam a transacao, rendendo ABORTED e 429 justamente no pico. Cinco
// segundos de cache limitam um falso "sem vagas" a ~5s e devolvem a rajada
// para o CDN.
const SEGUNDOS_CACHE_CURTO = 5;
const CACHE_CURTO = `public, max-age=0, s-maxage=${SEGUNDOS_CACHE_CURTO}`;

const CACHE_SEM_ARMAZENAMENTO = "no-store";

// Segunda de manha e a janela semanal de abertura: cache curto para a
// disponibilidade refletir quase em tempo real. Sem stale-while-revalidate,
// porque uma entrada gravada antes da janela sem cache poderia continuar sendo
// servida ja dentro dela.
const PERFIL_JANELA_ABERTURA = { sMaxAge: 60, swr: 0 };

// No resto da semana o CDN pode segurar a resposta por mais tempo, cortando
// invocacoes. A selecao revalida um unico slot por callable sem CDN, e a
// transacao continua sendo a autoridade final da reserva.
const PERFIL_PADRAO = { sMaxAge: 300, swr: 600 };

const DIAS_ATENDIMENTO_HORA_PADRAO = "08:00";

const FORMATO_INSTANTE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

// Os instantes ("YYYY-MM-DDTHH:MM") ja estao no fuso de Sao Paulo. Date.UTC e
// usado apenas como aritmetica de calendario sobre esses componentes, entao a
// diferenca entre dois instantes e exata em minutos de relogio de parede.
function partesInstante(valor) {
  const match = FORMATO_INSTANTE.exec(String(valor || ""));
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const hora = Number(match[4]);
  const minuto = Number(match[5]);
  const ms = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const data = new Date(ms);
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    return null;
  }
  return {
    dataISO: `${match[1]}-${match[2]}-${match[3]}`,
    hora,
    minutos: Math.floor(ms / 60000),
    diaSemana: data.getUTCDay()
  };
}

function somarDias(dataISO, quantidade) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1, dia + quantidade));
  return `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, "0")}-${String(alvo.getUTCDate()).padStart(2, "0")}`;
}

function segundaDaSemana(dataISO) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const diaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  return somarDias(dataISO, diaSemana === 0 ? -6 : 1 - diaSemana);
}

// Instantes de abertura previstos pela automacao semanal, derivados so da
// configuracao. Independem de publicacaoDatas ja ter sido gravada.
function aberturasProgramadas(automacaoSemanal, agora) {
  const referencia = partesInstante(agora);
  if (!referencia) return [];
  const cfg = automacaoSemanal && typeof automacaoSemanal === "object" && !Array.isArray(automacaoSemanal)
    ? automacaoSemanal
    : {};
  if (cfg.ativa === false) return [];

  const horaAbertura = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(cfg.horaAbertura || ""))
    ? String(cfg.horaAbertura)
    : DIAS_ATENDIMENTO_HORA_PADRAO;
  const pausadas = Array.isArray(cfg.semanasPausadas)
    ? cfg.semanasPausadas.filter((data) => FORMATO_DATA.test(String(data))).map(String)
    : [];

  const segundaAtual = segundaDaSemana(referencia.dataISO);
  return [segundaAtual, somarDias(segundaAtual, 7)]
    .filter((segunda) => !pausadas.includes(segunda))
    .map((segunda) => `${segunda}T${horaAbertura}`);
}

function instantesDePublicacao(publicacaoDatas, automacaoSemanal, agora) {
  const origem = publicacaoDatas && typeof publicacaoDatas === "object" && !Array.isArray(publicacaoDatas)
    ? publicacaoDatas
    : {};
  const doMapa = Object.keys(origem)
    // Mesma exigencia de normalizarPublicacaoDatas: chave e valor validos.
    .filter((data) => FORMATO_DATA.test(data))
    .map((data) => origem[data]);
  return [...doMapa, ...aberturasProgramadas(automacaoSemanal, agora)];
}

// A publicacao relevante e a mais proxima que o CORPO da resposta ainda esconde.
function proximaPublicacao(publicacaoDatas, agora, automacaoSemanal) {
  const referencia = partesInstante(agora);
  if (!referencia) return null;
  let proxima = null;
  for (const valor of instantesDePublicacao(publicacaoDatas, automacaoSemanal, agora)) {
    const instante = partesInstante(valor);
    if (!instante) continue;
    // Publicacao ja alcancada: a data ja aparece no corpo da resposta.
    if (instante.minutos <= referencia.minutos) continue;
    if (!proxima || instante.minutos < proxima.minutos) proxima = instante;
  }
  return proxima;
}

// Aberturas previstas pela automacao que ainda nao foram gravadas no mapa.
// Enquanto estiverem pendentes, a agenda pode continuar fechada por atraso ou
// retentativa do Scheduler.
function aberturasProgramadasPendentes(publicacaoDatas, automacaoSemanal, agora) {
  const origem = publicacaoDatas && typeof publicacaoDatas === "object" && !Array.isArray(publicacaoDatas)
    ? publicacaoDatas
    : {};
  const gravadas = new Set(
    Object.keys(origem).filter((data) => FORMATO_DATA.test(data)).map((data) => String(origem[data]))
  );
  return aberturasProgramadas(automacaoSemanal, agora).filter((instante) => !gravadas.has(instante));
}

// Verdadeiro quando a EMISSAO cai perto de alguma publicacao — antes ou depois.
// Diferente de proximaPublicacao, aqui instantes ja alcancados tambem contam.
function emJanelaDeVirada(publicacaoDatas, automacaoSemanal, agoraCorpo, agoraEmissao) {
  const emissao = partesInstante(agoraEmissao);
  if (!emissao) return false;

  const pendentes = new Set(aberturasProgramadasPendentes(publicacaoDatas, automacaoSemanal, agoraCorpo));
  for (const valor of instantesDePublicacao(publicacaoDatas, automacaoSemanal, agoraCorpo)) {
    const instante = partesInstante(valor);
    if (!instante) continue;
    const distancia = emissao.minutos - instante.minutos;
    if (distancia < -MINUTOS_CACHE_CURTO_ANTES) continue;
    const depoisMaximo = pendentes.has(valor)
      ? MINUTOS_CACHE_CURTO_AGUARDANDO_PUBLICACAO
      : MINUTOS_CACHE_CURTO_DEPOIS;
    if (distancia <= depoisMaximo) return true;
  }
  return false;
}

// Verdadeiro quando uma publicacao aconteceu ENTRE a montagem do corpo e a
// emissao: o corpo nasceu fechado e a agenda ja abriu. Guardar isso, mesmo por
// cinco segundos, somaria o tempo das leituras ao prazo do cache. E uma
// resposta de transicao, entao nao recria a rajada.
function publicacaoAtravessada(publicacaoDatas, automacaoSemanal, agoraCorpo, agoraEmissao) {
  const corpo = partesInstante(agoraCorpo);
  const emissao = partesInstante(agoraEmissao);
  if (!corpo || !emissao) return false;
  for (const valor of instantesDePublicacao(publicacaoDatas, automacaoSemanal, agoraCorpo)) {
    const instante = partesInstante(valor);
    if (!instante) continue;
    if (instante.minutos > corpo.minutos && instante.minutos <= emissao.minutos) return true;
  }
  return false;
}

function minutosAtePublicacao(publicacaoDatas, agora, automacaoSemanal) {
  const referencia = partesInstante(agora);
  const proxima = proximaPublicacao(publicacaoDatas, agora, automacaoSemanal);
  if (!referencia || !proxima) return null;
  return proxima.minutos - referencia.minutos;
}

function janelaAberturaSemanal(agora) {
  const referencia = partesInstante(agora);
  if (!referencia) return false;
  return referencia.diaSemana === 1 && referencia.hora < 14;
}

function formatarCacheControl(perfil) {
  // max-age=0 e proposital: as camadas somam, e uma copia privada do navegador
  // sobreviveria ao prazo do CDN. Quem guarda prazo aqui e so o CDN.
  const partes = ["public", "max-age=0", `s-maxage=${perfil.sMaxAge}`];
  if (perfil.swr > 0) partes.push(`stale-while-revalidate=${perfil.swr}`);
  return partes.join(", ");
}

// `agoraCorpo`  - instante que determinou o conteudo da resposta.
// `agoraEmissao`- instante em que a resposta esta saindo (>= agoraCorpo).
//
// Os dois sao necessarios: a publicacao a evitar e a que o CORPO ainda esconde,
// mas o prazo precisa ser contado da EMISSAO. Usar so o corpo deixa a copia
// viva alem da virada; usar so a emissao libera cache para um corpo que ja
// nasceu velho quando a leitura atravessa as 08:00.
function cacheControlAgendaPublica(agoraCorpo, agoraEmissao, publicacaoDatas, automacaoSemanal) {
  const corpo = partesInstante(agoraCorpo);
  const emissao = partesInstante(agoraEmissao);
  // Sem instantes confiaveis nao ha como afirmar que a copia expira antes da
  // proxima publicacao.
  if (!corpo || !emissao) return CACHE_SEM_ARMAZENAMENTO;

  // Corpo montado antes da virada e resposta emitida depois: guardar somaria o
  // tempo das leituras ao prazo do cache.
  if (publicacaoAtravessada(publicacaoDatas, automacaoSemanal, agoraCorpo, agoraEmissao)) {
    return CACHE_SEM_ARMAZENAMENTO;
  }

  // Perto de uma virada o prazo cai para segundos, mas o CDN continua
  // absorvendo a rajada.
  if (emJanelaDeVirada(publicacaoDatas, automacaoSemanal, agoraCorpo, agoraEmissao)) return CACHE_CURTO;

  const proxima = proximaPublicacao(publicacaoDatas, agoraCorpo, automacaoSemanal);
  let limite = Infinity;
  if (proxima) {
    // Fora da janela de virada sobram mais de MINUTOS_CACHE_CURTO_ANTES.
    const minutos = proxima.minutos - emissao.minutos;
    // Os instantes tem precisao de minuto, entao o relogio real pode estar ate
    // 59s a frente. Descontar um minuto inteiro garante que nenhuma copia
    // sobreviva a virada, inclusive a servida por stale-while-revalidate.
    limite = Math.max(SEGUNDOS_CACHE_CURTO, (minutos - 1) * 60);
  }

  const base = janelaAberturaSemanal(agoraEmissao) ? PERFIL_JANELA_ABERTURA : PERFIL_PADRAO;
  const sMaxAge = Math.min(base.sMaxAge, limite);
  return formatarCacheControl({
    sMaxAge,
    swr: Math.min(base.swr, limite - sMaxAge)
  });
}

// Vida maxima, em segundos, de uma copia gravada a partir deste cabecalho.
// As camadas SOMAM: o CDN pode segurar por s-maxage e ainda servir durante o
// periodo de stale-while-revalidate; so entao o navegador recebe a copia e a
// guarda por mais max-age.
function vidaMaximaCacheSegundos(cacheControl) {
  const texto = String(cacheControl || "");
  if (/(^|,\s*)no-store(\s*,|$)/.test(texto)) return 0;
  const numero = (nome) => {
    const match = new RegExp(`(?:^|[,\\s])${nome}=(\\d+)`).exec(texto);
    return match ? Number(match[1]) : 0;
  };
  return numero("s-maxage") + numero("stale-while-revalidate") + numero("max-age");
}

module.exports = {
  MINUTOS_CACHE_CURTO_ANTES,
  MINUTOS_CACHE_CURTO_DEPOIS,
  MINUTOS_CACHE_CURTO_AGUARDANDO_PUBLICACAO,
  SEGUNDOS_CACHE_CURTO,
  CACHE_CURTO,
  CACHE_SEM_ARMAZENAMENTO,
  aberturasProgramadasPendentes,
  publicacaoAtravessada,
  emJanelaDeVirada,
  PERFIL_JANELA_ABERTURA,
  PERFIL_PADRAO,
  partesInstante,
  aberturasProgramadas,
  proximaPublicacao,
  minutosAtePublicacao,
  janelaAberturaSemanal,
  cacheControlAgendaPublica,
  vidaMaximaCacheSegundos
};
