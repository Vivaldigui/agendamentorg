"use strict";

// Aviso em pop-up configurado pela recepcao.
//
// Tres superficies escrevem ou leem o mesmo mapa: o backend (que publica), o
// site do cidadao (que decide a hora de mostrar) e o painel (que grava e precisa
// prever o resultado). Se as regras divergirem, a recepcao salva um aviso que o
// site descarta em silencio -- exatamente o tipo de falha que ninguem percebe
// ate alguem perguntar por que o recado nao apareceu.
//
// Por isso os testes extraem e executam as funcoes dos dois HTMLs, no mesmo
// padrao de agenda-grade-surfaces.test.js e aviso-novas-vagas.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  LIMITE_TITULO_AVISO_POPUP,
  LIMITE_MENSAGEM_AVISO_POPUP,
  TIPOS_AVISO_POPUP,
  TIPO_AVISO_POPUP_PADRAO,
  REPETICOES_AVISO_POPUP,
  REPETICAO_AVISO_POPUP_PADRAO,
  limparTextoAvisoPopup,
  normalizarAvisoPopup,
  avisoPopupVisivel,
  avisoPopupPublico
} = require("./aviso-popup");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");
const painel = fs.readFileSync(path.join(raiz, "public", "recepcao.html"), "utf8");

const FORMATO_INSTANTE_POPUP = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const FORMATO_ID_POPUP = /^[a-z0-9]{1,24}$/;

function extrairFuncao(codigo, nome) {
  const inicio = codigo.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  const abre = codigo.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(inicio, i + 1);
    }
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

function constanteLista(codigo, nome) {
  const match = codigo.match(new RegExp(`const\\s+${nome}\\s*=\\s*(\\[[^\\];]+\\])`));
  assert.ok(match, `Constante ${nome} nao encontrada.`);
  return JSON.parse(match[1].replace(/'/g, '"'));
}

function constanteNumero(codigo, nome) {
  const match = codigo.match(new RegExp(`const\\s+${nome}\\s*=\\s*(\\d+)\\s*;`));
  assert.ok(match, `Constante ${nome} nao encontrada.`);
  return Number(match[1]);
}

function constanteTexto(codigo, nome) {
  const match = codigo.match(new RegExp(`const\\s+${nome}\\s*=\\s*"([^"]*)"\\s*;`));
  assert.ok(match, `Constante ${nome} nao encontrada.`);
  return match[1];
}

function constanteRegex(codigo, nome) {
  const match = codigo.match(new RegExp(`const\\s+${nome}\\s*=\\s*(/[^\\n]+/)\\s*;`));
  assert.ok(match, `Constante ${nome} nao encontrada.`);
  return match[1];
}

// Recria, fora do navegador, o trio de funcoes que a superficie usa para
// interpretar o aviso.
function superficieAvisoPopup(codigo, extras = []) {
  const corpo = [
    extrairFuncao(codigo, "limparTextoAvisoPopup"),
    extrairFuncao(codigo, "instantePopupValido"),
    extrairFuncao(codigo, "normalizarAvisoPopup"),
    extrairFuncao(codigo, "avisoPopupVisivel"),
    ...extras.map((nome) => extrairFuncao(codigo, nome))
  ].join("\n");
  const exportados = ["limparTextoAvisoPopup", "normalizarAvisoPopup", "avisoPopupVisivel", ...extras];
  return new Function(
    "LIMITE_TITULO_AVISO_POPUP",
    "LIMITE_MENSAGEM_AVISO_POPUP",
    "TIPOS_AVISO_POPUP",
    "TIPO_AVISO_POPUP_PADRAO",
    "REPETICOES_AVISO_POPUP",
    "REPETICAO_AVISO_POPUP_PADRAO",
    "FORMATO_INSTANTE_POPUP",
    "FORMATO_ID_POPUP",
    `${corpo}; return { ${exportados.join(", ")} };`
  )(
    LIMITE_TITULO_AVISO_POPUP,
    LIMITE_MENSAGEM_AVISO_POPUP,
    TIPOS_AVISO_POPUP,
    TIPO_AVISO_POPUP_PADRAO,
    REPETICOES_AVISO_POPUP,
    REPETICAO_AVISO_POPUP_PADRAO,
    FORMATO_INSTANTE_POPUP,
    FORMATO_ID_POPUP
  );
}

const AVISO_BASE = {
  ativo: true,
  titulo: "Atendimento suspenso",
  mensagem: "Nao havera atendimento na quinta-feira.",
  tipo: "atencao",
  repetir: "uma-vez",
  inicioEm: "2026-08-27T08:00",
  fimEm: "2026-08-28T18:00",
  id: "p1a2b3"
};

// Entradas compartilhadas pelas comparacoes de paridade. Todas trazem `ativo`
// explicito porque e ai que backend e painel precisam concordar campo a campo.
const CASOS_PARIDADE = [
  AVISO_BASE,
  { ...AVISO_BASE, ativo: false },
  { ...AVISO_BASE, mensagem: "   " },
  { ...AVISO_BASE, mensagem: 42 },
  { ...AVISO_BASE, inicioEm: "2026-08-27T24:00" },
  { ...AVISO_BASE, fimEm: "" },
  { ...AVISO_BASE, fimEm: AVISO_BASE.inicioEm },
  { ...AVISO_BASE, fimEm: "2026-08-27T07:59" },
  { ...AVISO_BASE, tipo: "roxo" },
  { ...AVISO_BASE, repetir: "as-vezes" },
  { ...AVISO_BASE, id: "MAIUSCULO" },
  { ...AVISO_BASE, id: "" },
  { ...AVISO_BASE, titulo: "T".repeat(200) },
  { ...AVISO_BASE, mensagem: "M".repeat(900) },
  { ...AVISO_BASE, titulo: null, tipo: undefined },
  null,
  [],
  "texto"
];

const INSTANTES_PARIDADE = [
  "2026-08-27T07:59",
  "2026-08-27T08:00",
  "2026-08-28T12:00",
  "2026-08-28T18:00",
  "2026-08-28T18:01",
  "ontem",
  ""
];

test("aviso so e publicado com mensagem, janela coerente e chave ligada", () => {
  assert.deepEqual(normalizarAvisoPopup(AVISO_BASE), {
    id: "p1a2b3",
    titulo: "Atendimento suspenso",
    mensagem: "Nao havera atendimento na quinta-feira.",
    tipo: "atencao",
    inicioEm: "2026-08-27T08:00",
    fimEm: "2026-08-28T18:00",
    repetir: "uma-vez"
  });

  assert.equal(normalizarAvisoPopup({ ...AVISO_BASE, ativo: false }), null);
  assert.equal(normalizarAvisoPopup({ ...AVISO_BASE, ativo: "sim" }), null);
  assert.equal(normalizarAvisoPopup({ ...AVISO_BASE, mensagem: "  \n  " }), null);
  // Fim ausente ou anterior ao inicio: um aviso sem prazo sobrevive a propria
  // razao de existir e ninguem lembra de desligar.
  assert.equal(normalizarAvisoPopup({ ...AVISO_BASE, fimEm: "" }), null);
  assert.equal(normalizarAvisoPopup({ ...AVISO_BASE, fimEm: AVISO_BASE.inicioEm }), null);
  assert.equal(normalizarAvisoPopup({ ...AVISO_BASE, inicioEm: "27/08/2026 08:00" }), null);
  assert.equal(normalizarAvisoPopup(null), null);
  assert.equal(normalizarAvisoPopup([AVISO_BASE]), null);
});

test("valores fora da lista caem no padrao em vez de derrubar o aviso", () => {
  const aviso = normalizarAvisoPopup({ ...AVISO_BASE, tipo: "roxo", repetir: "as-vezes", id: "COM MAIUSCULA" });
  assert.equal(aviso.tipo, TIPO_AVISO_POPUP_PADRAO);
  assert.equal(aviso.repetir, REPETICAO_AVISO_POPUP_PADRAO);
  // Sem id valido, a chave de dispensa deriva do inicio da janela: continua
  // estavel entre visitas, o que importa para o modo "uma vez por aparelho".
  assert.equal(aviso.id, "w202608270800");
  assert.match(aviso.id, FORMATO_ID_POPUP);
});

test("texto do painel vira texto de modal sem controle nem espaco em branco solto", () => {
  const bruto = `  Aviso\r\n\n\n\nlinha final  ${String.fromCharCode(7)}`;
  assert.equal(limparTextoAvisoPopup(bruto, 600), "Aviso\n\nlinha final");
  assert.equal(limparTextoAvisoPopup("abcdef", 3), "abc");
  assert.equal(limparTextoAvisoPopup(null, 600), "");
  assert.equal(limparTextoAvisoPopup(undefined, 600), "");

  const cortado = normalizarAvisoPopup({ ...AVISO_BASE, titulo: "T".repeat(200), mensagem: "M".repeat(900) });
  assert.equal(cortado.titulo.length, LIMITE_TITULO_AVISO_POPUP);
  assert.equal(cortado.mensagem.length, LIMITE_MENSAGEM_AVISO_POPUP);
});

test("a janela inclui as duas pontas e o aviso encerrado nao viaja na resposta", () => {
  const aviso = normalizarAvisoPopup(AVISO_BASE);
  assert.equal(avisoPopupVisivel(aviso, "2026-08-27T07:59"), false);
  assert.equal(avisoPopupVisivel(aviso, "2026-08-27T08:00"), true);
  assert.equal(avisoPopupVisivel(aviso, "2026-08-28T18:00"), true);
  assert.equal(avisoPopupVisivel(aviso, "2026-08-28T18:01"), false);
  assert.equal(avisoPopupVisivel(aviso, "quinta"), false);
  assert.equal(avisoPopupVisivel(null, "2026-08-27T09:00"), false);

  // Aviso futuro VIAJA: o corpo pode vir do CDN com ate ~15 minutos de idade e
  // e o site que decide a hora exata de mostrar. Sem isso, um aviso programado
  // so apareceria quando o cache expirasse.
  assert.deepEqual(avisoPopupPublico(AVISO_BASE, "2026-08-20T10:00"), normalizarAvisoPopup(AVISO_BASE));
  assert.deepEqual(avisoPopupPublico(AVISO_BASE, "2026-08-28T17:59"), normalizarAvisoPopup(AVISO_BASE));
  // Encerrado nao viaja: uma copia antiga do CDN reviveria o texto vencido.
  assert.equal(avisoPopupPublico(AVISO_BASE, "2026-08-28T18:01"), null);
  assert.equal(avisoPopupPublico({ ...AVISO_BASE, ativo: false }, "2026-08-27T09:00"), null);
});

test("a leitura publica publica o aviso normalizado junto com a agenda", () => {
  assert.match(backend, /require\("\.\/aviso-popup"\)/);
  // processarAgenda normaliza uma unica vez, com o mesmo instante que monta o
  // corpo e escolhe o Cache-Control.
  assert.match(backend, /avisoPopup: avisoPopupPublico\(agenda\.avisoPopup, agora\)/);
  // E o payload publico carrega o resultado.
  assert.match(backend, /avisoPopup: agenda\.avisoPopup/);
});

test("site publico e painel espelham as constantes do modulo canonico", () => {
  for (const codigo of [sitePublico, painel]) {
    assert.equal(constanteNumero(codigo, "LIMITE_TITULO_AVISO_POPUP"), LIMITE_TITULO_AVISO_POPUP);
    assert.equal(constanteNumero(codigo, "LIMITE_MENSAGEM_AVISO_POPUP"), LIMITE_MENSAGEM_AVISO_POPUP);
    assert.deepEqual(constanteLista(codigo, "TIPOS_AVISO_POPUP"), TIPOS_AVISO_POPUP);
    assert.equal(constanteTexto(codigo, "TIPO_AVISO_POPUP_PADRAO"), TIPO_AVISO_POPUP_PADRAO);
    assert.deepEqual(constanteLista(codigo, "REPETICOES_AVISO_POPUP"), REPETICOES_AVISO_POPUP);
    assert.equal(constanteTexto(codigo, "REPETICAO_AVISO_POPUP_PADRAO"), REPETICAO_AVISO_POPUP_PADRAO);
    // Os literais precisam bater com os do modulo: a paridade abaixo injeta as
    // expressoes do backend nas funcoes extraidas e nao veria a diferenca.
    assert.equal(constanteRegex(codigo, "FORMATO_INSTANTE_POPUP"), String(FORMATO_INSTANTE_POPUP));
    assert.equal(constanteRegex(codigo, "FORMATO_ID_POPUP"), String(FORMATO_ID_POPUP));
  }
});

test("painel preve exatamente o que o backend vai publicar", () => {
  const superficie = superficieAvisoPopup(painel);
  for (const caso of CASOS_PARIDADE) {
    assert.deepEqual(
      superficie.normalizarAvisoPopup(caso),
      normalizarAvisoPopup(caso),
      `Painel divergiu do backend para ${JSON.stringify(caso)}`
    );
  }
  const aviso = normalizarAvisoPopup(AVISO_BASE);
  for (const instante of INSTANTES_PARIDADE) {
    assert.equal(superficie.avisoPopupVisivel(aviso, instante), avisoPopupVisivel(aviso, instante), instante);
  }
});

test("site publico aceita o aviso ja filtrado e rejeita o que o backend rejeitaria", () => {
  const superficie = superficieAvisoPopup(sitePublico);
  const publicado = avisoPopupPublico(AVISO_BASE, "2026-08-27T09:00");

  // Divergencia proposital: o corpo publico nao carrega o campo `ativo`, entao
  // o site nao pode exigi-lo -- exigir descartaria todo aviso valido.
  assert.deepEqual(superficie.normalizarAvisoPopup(publicado), publicado);
  assert.equal(normalizarAvisoPopup(publicado), null);

  // Fora isso as regras sao as mesmas, inclusive a limpeza do texto.
  for (const caso of CASOS_PARIDADE.filter((item) => !item || item.ativo !== true)) {
    assert.equal(superficie.normalizarAvisoPopup(caso), null, `Site aceitou ${JSON.stringify(caso)}`);
  }
  for (const caso of CASOS_PARIDADE.filter((item) => item && item.ativo === true)) {
    assert.deepEqual(superficie.normalizarAvisoPopup(caso), normalizarAvisoPopup(caso));
  }
  for (const instante of INSTANTES_PARIDADE) {
    assert.equal(superficie.avisoPopupVisivel(publicado, instante), avisoPopupVisivel(publicado, instante), instante);
  }
});

test("site publico decide a exibicao com o relogio do servidor e sem interromper quem ja escolheu", () => {
  assert.match(sitePublico, /AVISO_POPUP = normalizarAvisoPopup\(cfg\.avisoPopup\)/);
  const funcao = extrairFuncao(sitePublico, "mostrarAvisoPopupSePreciso");
  // O relogio local cru atrasaria ou adiantaria a janela num aparelho
  // desacertado; agoraSaoPauloInput ja aplica o desvio medido do servidor.
  assert.match(funcao, /avisoPopupVisivel\(aviso, agoraSaoPauloInput\(\)\)/);
  assert.match(funcao, /avisoPopupExibidoNestaVisita/);
  assert.match(funcao, /modalEstaAberto\(\)/);
  assert.match(funcao, /dataSel \|\| horaSel/);
  // O texto vem da recepcao: so pode entrar na tela por textContent, que o
  // modal global ja garante. Nenhuma interpolacao em innerHTML.
  assert.match(funcao, /mensagem: aviso\.mensagem/);
  assert.doesNotMatch(sitePublico, /innerHTML[^\n]*aviso\.mensagem/);
  // A carga da agenda chama o pop-up nos dois caminhos: cache local e resposta
  // ao vivo. So o segundo deixaria o aviso invisivel ate a rede responder.
  assert.equal((sitePublico.match(/mostrarAvisoPopupSePreciso\(\);/g) || []).length >= 2, true);
});

test("painel grava o aviso no mesmo documento da agenda e mostra o estado real", () => {
  ["popup-ativo", "popup-titulo", "popup-mensagem", "popup-tipo", "popup-repetir", "popup-inicio", "popup-fim"]
    .forEach((id) => assert.match(painel, new RegExp(`id="${id}"`), `Campo ${id} ausente no painel.`));
  // update, nao set/merge: e o que apaga chaves antigas do mapa.
  assert.match(painel, /gravarAgendaConfig\(\{ avisoPopup, atualizado: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(painel, /agendaAvisoPopup = cfg\.avisoPopup/);
  // A previa escapa o texto: o painel monta HTML, diferente do site.
  assert.match(painel, /textoSeguro\(dados\.mensagem\)/);

  const superficie = superficieAvisoPopup(painel, ["lerAvisoPopupPainel", "gerarIdAvisoPopup"]);
  assert.match(superficie.gerarIdAvisoPopup(), FORMATO_ID_POPUP);
  // Leitura tolerante: preserva o texto de um aviso desligado para reaproveitar.
  const desligado = superficie.lerAvisoPopupPainel({ ...AVISO_BASE, ativo: false });
  assert.equal(desligado.ativo, false);
  assert.equal(desligado.mensagem, AVISO_BASE.mensagem);
  assert.equal(desligado.fimEm, AVISO_BASE.fimEm);
  assert.deepEqual(superficie.lerAvisoPopupPainel(null), {
    ativo: false,
    titulo: "",
    mensagem: "",
    tipo: TIPO_AVISO_POPUP_PADRAO,
    repetir: REPETICAO_AVISO_POPUP_PADRAO,
    inicioEm: "",
    fimEm: "",
    id: ""
  });
});

test("o painel diz em que fase o aviso esta, nao apenas que foi salvo", () => {
  const codigo = [
    extrairFuncao(painel, "dataBrISO"),
    extrairFuncao(painel, "dataHoraBr"),
    extrairFuncao(painel, "limparTextoAvisoPopup"),
    extrairFuncao(painel, "instantePopupValido"),
    extrairFuncao(painel, "normalizarAvisoPopup"),
    extrairFuncao(painel, "descreverStatusAvisoPopup")
  ].join("\n");
  const descrever = new Function(
    "LIMITE_TITULO_AVISO_POPUP",
    "LIMITE_MENSAGEM_AVISO_POPUP",
    "TIPOS_AVISO_POPUP",
    "TIPO_AVISO_POPUP_PADRAO",
    "REPETICOES_AVISO_POPUP",
    "REPETICAO_AVISO_POPUP_PADRAO",
    "FORMATO_INSTANTE_POPUP",
    "FORMATO_ID_POPUP",
    `${codigo}; return descreverStatusAvisoPopup;`
  )(
    LIMITE_TITULO_AVISO_POPUP,
    LIMITE_MENSAGEM_AVISO_POPUP,
    TIPOS_AVISO_POPUP,
    TIPO_AVISO_POPUP_PADRAO,
    REPETICOES_AVISO_POPUP,
    REPETICAO_AVISO_POPUP_PADRAO,
    FORMATO_INSTANTE_POPUP,
    FORMATO_ID_POPUP
  );

  assert.equal(descrever(AVISO_BASE, "2026-08-26T10:00").classe, "programado");
  assert.match(descrever(AVISO_BASE, "2026-08-26T10:00").texto, /27\/08\/2026 às 08:00/);
  assert.equal(descrever(AVISO_BASE, "2026-08-27T08:00").classe, "no-ar");
  assert.match(descrever(AVISO_BASE, "2026-08-27T08:00").texto, /28\/08\/2026 às 18:00/);
  assert.equal(descrever(AVISO_BASE, "2026-08-28T18:01").classe, "encerrado");
  // Desligado com texto guardado nao pode parecer "no ar", e o campo vazio
  // precisa dizer que nao ha nada configurado.
  assert.match(descrever({ ...AVISO_BASE, ativo: false }, "2026-08-27T09:00").texto, /desligado/i);
  assert.match(descrever(null, "2026-08-27T09:00").texto, /Nenhum pop-up/i);
});
