const APP_CHECK_RECAPTCHA_SITE_KEY = "6LdoYfcsAAAAALyCdBKewXtFLB1e9biRnXTWqNv0";
const METRICAS_ACESSO_PUBLICO_ATIVAS = false;
var firebaseConfig = { apiKey: "AIzaSyBqmzQw8CtTD6O2C3fiXcm7_GBmkgite_c", authDomain: "agendamento-cin-itanhandu.firebaseapp.com", databaseURL: "https://agendamento-cin-itanhandu-default-rtdb.firebaseio.com", projectId: "agendamento-cin-itanhandu", storageBucket: "agendamento-cin-itanhandu.firebasestorage.app", messagingSenderId: "144820039253", appId: "1:144820039253:web:af179156ce8da4b73a6edc", measurementId: "G-KWKF7NCJHK" };
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
if (firebase.appCheck) firebase.appCheck().activate(APP_CHECK_RECAPTCHA_SITE_KEY, true);
const db = firebase.firestore(); const auth = firebase.auth(); const functions = firebase.functions(); const realtimeDbAdmin = firebase.database();
// Mantem o login salvo entre fechamentos do navegador.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => console.warn("Persistencia de login indisponivel", e));
const HORARIOS_LEGADOS = ["14:20","14:40","15:00","15:20","15:40","16:00","16:20","16:40"];
const HORARIOS_PADRAO = ["14:30","14:45","15:00","15:15","15:30","15:45","16:00","16:15","16:30","16:45"];
const DATA_CORTE_GRADE_NOVA = "2026-08-18";
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const RESPONSAVEL_POSTO_PADRAO = "Guilherme Ribeiro Pinto";
const TEMPLATE_LEMBRETE_PADRAO = `Olá, {nome}!

Passando para lembrar que seu atendimento para emissão do RG/CIN está agendado para *{data} às {hora}* na *Câmara Municipal de Itanhandu*.

Não se esqueça de levar os documentos necessários:

1. A certidão deve ser ORIGINAL, sem rasgos, rasuras ou alterações.
2. Certidão de nascimento original (se solteiro), certidão de casamento original (se casado). Se viúvo ou divorciado, a certidão de casamento deve estar averbada.
3. CPF.
4. Comprovante de residência.
5. Se for menor de 3 anos, além dos documentos acima, levar 1 foto 3x4 recente.

Menores de 16 anos devem estar acompanhados do responsável legal com documento (RG ou CNH).

Protocolo: {protocolo}.

Até logo!`;
const STATUS_LABELS = {
    agendado: "Agendado",
    compareceu: "Compareceu",
    vai_voltar: "Vai voltar depois",
    nao_compareceu: "Não compareceu",
    cancelado: "Cancelado",
    remarcado: "Remarcado"
};
const STATUS_ORDEM = ["agendado", "compareceu", "vai_voltar", "nao_compareceu", "cancelado", "remarcado"];
let agendaDias = [];
let agendaHorarios = HORARIOS_PADRAO;
let agendaHorariosPorDiaSemana = {};
let agendaPublicacaoDatas = {};
let agendaAutomacaoSemanal = { ativa: true, horaAbertura: "08:00", diasSemana: [2, 3, 4, 5], semanasPausadas: [], datasBloqueadas: [], periodosBloqueados: [] };
let agendaDatasAutomaticas = [];
// Aviso em pop-up do site. Espelha functions/aviso-popup.js.
const LIMITE_TITULO_AVISO_POPUP = 80;
const LIMITE_MENSAGEM_AVISO_POPUP = 600;
const TIPOS_AVISO_POPUP = ["informacao", "atencao", "urgente"];
const TIPO_AVISO_POPUP_PADRAO = "informacao";
const REPETICOES_AVISO_POPUP = ["uma-vez", "sempre"];
const REPETICAO_AVISO_POPUP_PADRAO = "uma-vez";
const FORMATO_INSTANTE_POPUP = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const FORMATO_ID_POPUP = /^[a-z0-9]{1,24}$/;
// Ultimo aviso lido do banco, com o campo `ativo`. O formulario edita uma
// copia; so o que foi gravado entra aqui.
let agendaAvisoPopup = null;
let responsavelPosto = RESPONSAVEL_POSTO_PADRAO;
let templateLembrete = TEMPLATE_LEMBRETE_PADRAO;
let agendamentosCache = [];
// Origem atual do cache para o auto-refresh nao sobrescrever resultados de busca/bloqueados.
// Valores: "lista" (periodo carregado), "historico" (busca por CPF/protocolo), "bloqueados".
let origemAgendamentosCache = "lista";
let filtroRapidoAtual = "";
let vistaPainelAtual = "hoje";
let mostrarDatasPassadas = false;
let agendaGestaoCarregada = false;
let listaAgendamentosCarregada = false;
let totalAtendimentosRealizados = null;
let totalAtendimentosCarregado = false;
let totalAtendimentosIndisponivel = false;
let estatisticasHistoricas = { cin: [], faltas: [] };
let credenciaisCache = [];
let credenciaisCarregadas = false;
let filtroCredencialAtual = "ativas";
let monitoramentoAcessosRef = null;
const INATIVIDADE_AVISO_MS = 7 * 60 * 60 * 1000 + 55 * 60 * 1000; // 7h55min
const INATIVIDADE_LOGOUT_MS = 8 * 60 * 60 * 1000; // 8h (jornada completa)
const ATUALIZACAO_AUTOMATICA_MS = 2 * 60 * 1000;
let timerAviso = null, timerLogout = null, timerSessaoContagem = null, timerAtualizacaoAutomatica = null;
let ultimaAtualizacaoLista = null;
let carregamentoListaEmAndamento = false;
let atualizacaoDiasEmAndamento = false;
let geracaoConsultaAgendamentos = 0;
let logsRecentes = [];
const ACOES_MUTACAO_AGENDA = new Set([
    "adicionarDataAgenda", "salvarLoteFlexivel", "salvarAvisoNovasVagas",
    "salvarAvisoPopup", "desativarAvisoPopup", "salvarAutomacaoSemanal",
    "salvarHorariosSemana", "salvarPreferenciasOperacionais",
    "adicionarSemanaPausada", "removerSemanaPausada",
    "adicionarDataBloqueada", "removerDataBloqueada",
    "adicionarPeriodoBloqueado", "removerPeriodoBloqueado",
    "personalizarDiaSemana", "voltarDiaSemanaAoAutomatico",
    "adicionarHorarioSemana", "removerHorarioSemana", "removerDataAgenda"
]);
try {
    mostrarDatasPassadas = localStorage.getItem("cin_mostrar_datas_passadas") === "true";
} catch (e) {}

function erroDeAutorizacao(erro) {
    const codigo = String(erro && erro.code || "").toLowerCase();
    return codigo.includes("permission-denied") || codigo.includes("unauthenticated");
}

function mostrarErroLogin(mensagem) {
    const erroEl = document.getElementById("login-erro");
    if (!erroEl) return;
    erroEl.textContent = mensagem;
    erroEl.style.display = "block";
}

async function validarAdministradorAtivo(user) {
    const email = String(user && user.email || "").trim().toLowerCase();
    if (!email) {
        const erro = new Error("Conta sem e-mail administrativo.");
        erro.code = "unauthenticated";
        throw erro;
    }
    const doc = await db.collection("admins").doc(email).get({ source: "server" });
    if (!doc.exists || doc.data().ativo !== true) {
        const erro = new Error("Administrador inativo.");
        erro.code = "permission-denied";
        throw erro;
    }
}

async function encerrarSessaoPorAcessoRevogado(erro) {
    if (!erroDeAutorizacao(erro)) return false;
    clearInterval(timerAtualizacaoAutomatica);
    pararMonitoramentoAcessos();
    try { await auth.signOut(); } catch (e) { console.warn("Falha ao encerrar sessao revogada", e); }
    mostrarErroLogin("Seu acesso administrativo foi revogado ou está inativo. Entre em contato com o responsável pelo sistema.");
    return true;
}

function definirMutacoesAgendaHabilitadas(habilitadas) {
    document.querySelectorAll("#vista-config input, #vista-config select, #vista-config textarea").forEach(campo => {
        campo.disabled = !habilitadas;
    });
    document.querySelectorAll("[data-acao]").forEach(controle => {
        if (ACOES_MUTACAO_AGENDA.has(controle.dataset.acao)) controle.disabled = !habilitadas;
    });
}

function exigirAgendaGestaoCarregada() {
    if (agendaGestaoCarregada) return true;
    avisoPainel("A configuração ainda não foi carregada. Tente novamente antes de fazer alterações.");
    return false;
}

function resetarTimerInatividade() {
    clearTimeout(timerAviso);
    clearTimeout(timerLogout);
    removerAvisoSessao();
    timerAviso = setTimeout(mostrarAvisoSessao, INATIVIDADE_AVISO_MS);
    timerLogout = setTimeout(fazerLogout, INATIVIDADE_LOGOUT_MS);
}

function removerAvisoSessao() {
    clearInterval(timerSessaoContagem);
    timerSessaoContagem = null;
    const toast = document.getElementById("toast-sessao");
    if (toast) toast.remove();
}

function mostrarAvisoSessao() {
    if (document.getElementById("toast-sessao")) return;
    const toast = document.createElement("div");
    toast.id = "toast-sessao";
    toast.className = "toast-painel toast-sessao";
    const expiraEm = Date.now() + (INATIVIDADE_LOGOUT_MS - INATIVIDADE_AVISO_MS);
    const atualizar = () => {
        const segundos = Math.max(0, Math.ceil((expiraEm - Date.now()) / 1000));
        toast.innerHTML = `<i class="fa-solid fa-clock"></i><span>Sessão expira em <strong>${segundos}s</strong> por inatividade.</span><button type="button" data-acao="resetarTimerInatividade">Continuar</button>`;
    };
    document.getElementById("toast-container").appendChild(toast);
    atualizar();
    timerSessaoContagem = setInterval(atualizar, 1000);
}

["mousemove","keydown","click","touchstart","scroll"].forEach(event =>
    document.addEventListener(event, () => {
        resetarTimerInatividade();
    }, { passive: true })
);

function atualizarBotaoTema() {
    const btn = document.getElementById("btn-tema");
    if (!btn) return;
    const escuro = document.body.classList.contains("modo-escuro");
    btn.innerHTML = escuro
        ? '<i class="fa-solid fa-sun"></i> Modo claro'
        : '<i class="fa-solid fa-moon"></i> Modo escuro';
}

function aplicarTemaPreferido() {
    let tema = "escuro";
    try {
        tema = localStorage.getItem("gestaov6-tema") || "escuro";
    } catch (e) {}
    document.body.classList.toggle("modo-escuro", tema !== "claro");
    atualizarBotaoTema();
}

function alternarTema() {
    const escuro = !document.body.classList.contains("modo-escuro");
    document.body.classList.toggle("modo-escuro", escuro);
    try {
        localStorage.setItem("gestaov6-tema", escuro ? "escuro" : "claro");
    } catch (e) {}
    atualizarBotaoTema();
}

aplicarTemaPreferido();

function textoSeguro(valor) {
    return String(valor || "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[c]));
}

function csvCampo(valor) {
    let texto = String(valor || "");
    if (/^[=+\-@\t\r]/.test(texto)) texto = "'" + texto;
    return `"${texto.replace(/"/g, '""')}"`;
}

function hojeISO() {
    const partes = new Intl.DateTimeFormat("en", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());
    const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
    return `${valores.year}-${valores.month}-${valores.day}`;
}

function agoraSaoPauloInput() {
    const partes = new Intl.DateTimeFormat("en", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());
    const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
    return `${valores.year}-${valores.month}-${valores.day}T${valores.hour}:${valores.minute}`;
}

function dataBrISO(dataISO) {
    const p = String(dataISO || "").split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : dataISO;
}

function dataHoraBr(valor) {
    const texto = String(valor || "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto)) return "";
    return `${dataBrISO(texto.slice(0, 10))} às ${texto.slice(11, 16)}`;
}

function normalizarPublicacaoDatas(valor) {
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
    const limpo = {};
    Object.keys(valor).forEach(data => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(data) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(valor[data] || ""))) {
            limpo[data] = String(valor[data]);
        }
    });
    return limpo;
}

function estaProgramada(dataISO) {
    const publicarEm = agendaPublicacaoDatas[dataISO];
    return publicarEm && publicarEm > agoraSaoPauloInput();
}

function alternarProgramacaoData() {
    const programar = document.getElementById("cfg-disponibilidade-data").value === "programar";
    document.getElementById("box-cfg-publicar-em-data").style.display = programar ? "block" : "none";
}

function alternarProgramacaoAviso() {
    const programar = document.getElementById("cfg-disponibilidade-aviso").value === "programar";
    document.getElementById("box-cfg-publicar-em-aviso").style.display = programar ? "block" : "none";
}

// --- Pop-up de aviso no site -------------------------------------
// limparTextoAvisoPopup, normalizarAvisoPopup e avisoPopupVisivel sao
// copias fieis de functions/aviso-popup.js: o painel precisa prever
// exatamente o que o backend vai publicar, senao a recepcao salva um
// aviso que o site descarta em silencio.
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

function normalizarAvisoPopup(valor) {
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
    if (valor.ativo !== true) return null;
    const mensagem = limparTextoAvisoPopup(valor.mensagem, LIMITE_MENSAGEM_AVISO_POPUP);
    if (!mensagem) return null;
    const inicioEm = instantePopupValido(valor.inicioEm) ? String(valor.inicioEm) : null;
    const fimEm = instantePopupValido(valor.fimEm) ? String(valor.fimEm) : null;
    if (!inicioEm || !fimEm) return null;
    if (fimEm <= inicioEm) return null;
    const tipo = TIPOS_AVISO_POPUP.includes(String(valor.tipo))
        ? String(valor.tipo)
        : TIPO_AVISO_POPUP_PADRAO;
    const repetir = REPETICOES_AVISO_POPUP.includes(String(valor.repetir))
        ? String(valor.repetir)
        : REPETICAO_AVISO_POPUP_PADRAO;
    const id = FORMATO_ID_POPUP.test(String(valor.id || ""))
        ? String(valor.id)
        : `w${inicioEm.replace(/\D/g, "")}`;
    return {
        id,
        titulo: limparTextoAvisoPopup(valor.titulo, LIMITE_TITULO_AVISO_POPUP),
        mensagem,
        tipo,
        inicioEm,
        fimEm,
        repetir
    };
}

function avisoPopupVisivel(aviso, agora) {
    if (!aviso || !instantePopupValido(agora)) return false;
    if (!instantePopupValido(aviso.inicioEm) || !instantePopupValido(aviso.fimEm)) return false;
    return String(agora) >= aviso.inicioEm && String(agora) <= aviso.fimEm;
}

// Leitura tolerante, so para preencher o formulario: preserva o texto de
// um aviso desligado ou expirado para a recepcao reaproveitar.
function lerAvisoPopupPainel(valor) {
    const bruto = valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
    return {
        ativo: bruto.ativo === true,
        titulo: limparTextoAvisoPopup(bruto.titulo, LIMITE_TITULO_AVISO_POPUP),
        mensagem: limparTextoAvisoPopup(bruto.mensagem, LIMITE_MENSAGEM_AVISO_POPUP),
        tipo: TIPOS_AVISO_POPUP.includes(String(bruto.tipo)) ? String(bruto.tipo) : TIPO_AVISO_POPUP_PADRAO,
        repetir: REPETICOES_AVISO_POPUP.includes(String(bruto.repetir)) ? String(bruto.repetir) : REPETICAO_AVISO_POPUP_PADRAO,
        inicioEm: instantePopupValido(bruto.inicioEm) ? String(bruto.inicioEm) : "",
        fimEm: instantePopupValido(bruto.fimEm) ? String(bruto.fimEm) : "",
        id: FORMATO_ID_POPUP.test(String(bruto.id || "")) ? String(bruto.id) : ""
    };
}

// Id novo a cada gravacao: e ele que faz o site reapresentar o aviso para
// quem ja tinha fechado a versao anterior.
function gerarIdAvisoPopup() {
    return `p${Date.now().toString(36)}`.slice(0, 24);
}

// Estado do que ESTA GRAVADO, nao do formulario: e o que o cidadao ve.
function descreverStatusAvisoPopup(bruto, agora) {
    const aviso = normalizarAvisoPopup(bruto);
    if (!aviso) {
        const guardado = bruto && typeof bruto === "object" && limparTextoAvisoPopup(bruto.mensagem, LIMITE_MENSAGEM_AVISO_POPUP);
        return {
            classe: "",
            texto: guardado
                ? "Pop-up desligado. O site não mostra nenhum aviso; o texto abaixo fica guardado para quando você quiser ligar de novo."
                : "Nenhum pop-up configurado. O site não mostra nenhum aviso."
        };
    }
    if (String(agora) < aviso.inicioEm) {
        return {
            classe: "programado",
            texto: `Programado: aparece em ${dataHoraBr(aviso.inicioEm)} e sai do ar em ${dataHoraBr(aviso.fimEm)}.`
        };
    }
    if (String(agora) > aviso.fimEm) {
        return {
            classe: "encerrado",
            texto: `Encerrado em ${dataHoraBr(aviso.fimEm)}. O site não mostra mais este aviso.`
        };
    }
    return {
        classe: "no-ar",
        texto: `No ar agora. Sai do ar em ${dataHoraBr(aviso.fimEm)}.`
    };
}

function preencherFormularioAvisoPopup(bruto) {
    const dados = lerAvisoPopupPainel(bruto);
    document.getElementById("popup-ativo").checked = dados.ativo;
    document.getElementById("popup-titulo").value = dados.titulo;
    document.getElementById("popup-mensagem").value = dados.mensagem;
    document.getElementById("popup-tipo").value = dados.tipo;
    document.getElementById("popup-repetir").value = dados.repetir;
    document.getElementById("popup-inicio").value = dados.inicioEm;
    document.getElementById("popup-fim").value = dados.fimEm;
    atualizarPreviaAvisoPopup();
}

function avisoPopupDoFormulario() {
    return {
        ativo: document.getElementById("popup-ativo").checked,
        titulo: limparTextoAvisoPopup(document.getElementById("popup-titulo").value, LIMITE_TITULO_AVISO_POPUP),
        mensagem: limparTextoAvisoPopup(document.getElementById("popup-mensagem").value, LIMITE_MENSAGEM_AVISO_POPUP),
        tipo: document.getElementById("popup-tipo").value,
        repetir: document.getElementById("popup-repetir").value,
        inicioEm: document.getElementById("popup-inicio").value,
        fimEm: document.getElementById("popup-fim").value
    };
}

function aparenciaAvisoPopup(tipo) {
    if (tipo === "urgente") return { icone: "fa-circle-exclamation", cor: "#dc2626", tituloPadrao: "Aviso importante" };
    if (tipo === "atencao") return { icone: "fa-triangle-exclamation", cor: "#d97706", tituloPadrao: "Atenção" };
    return { icone: "fa-circle-info", cor: "#2563eb", tituloPadrao: "Aviso" };
}

function atualizarPreviaAvisoPopup() {
    const dados = avisoPopupDoFormulario();
    const contador = document.getElementById("popup-contador");
    if (contador) contador.textContent = `${dados.mensagem.length}/${LIMITE_MENSAGEM_AVISO_POPUP} caracteres`;
    const previa = document.getElementById("popup-previa");
    if (previa) {
        const aparencia = aparenciaAvisoPopup(dados.tipo);
        previa.innerHTML = dados.mensagem
            ? `<div class="previa-icone"><i class="fa-solid ${aparencia.icone}" style="color:${aparencia.cor};"></i></div>
               <div class="previa-titulo">${textoSeguro(dados.titulo || aparencia.tituloPadrao)}</div>
               <div class="previa-mensagem">${textoSeguro(dados.mensagem)}</div>`
            : '<span class="previa-vazia">Escreva a mensagem para ver como ela vai aparecer.</span>';
    }
    const status = document.getElementById("popup-status");
    if (status) {
        const descricao = descreverStatusAvisoPopup(agendaAvisoPopup, agoraSaoPauloInput());
        status.className = `popup-status ${descricao.classe}`.trim();
        status.textContent = descricao.texto;
    }
}

async function salvarAvisoPopup() {
    if (!exigirAgendaGestaoCarregada()) return;
    const dados = avisoPopupDoFormulario();
    if (!dados.mensagem) return avisoPainel("Escreva a mensagem do pop-up.");
    // Com a exibicao desligada o texto e so um rascunho guardado: exigir
    // a janela ai impediria escrever o recado antes de decidir a data.
    if (dados.ativo) {
        if (!instantePopupValido(dados.inicioEm)) return avisoPainel("Informe a data e a hora em que o aviso começa a aparecer.");
        if (!instantePopupValido(dados.fimEm)) return avisoPainel("Informe a data e a hora em que o aviso para de aparecer.");
        if (dados.fimEm <= dados.inicioEm) return avisoPainel("O fim do aviso precisa ser depois do início.");
    }
    const agora = agoraSaoPauloInput();
    if (dados.ativo && dados.fimEm <= agora) return avisoPainel("Esse período já terminou. Escolha um fim no futuro.");
    if (dados.ativo && dados.inicioEm <= agora) {
        const confirmou = await confirmarPainel(
            "O aviso entra no ar imediatamente e pode levar até 15 minutos para chegar a todos os visitantes. Continuar?",
            { titulo: "Publicar agora", textoConfirmar: "Publicar" }
        );
        if (!confirmou) return;
    }
    const avisoPopup = {
        ativo: dados.ativo,
        titulo: dados.titulo,
        mensagem: dados.mensagem,
        tipo: TIPOS_AVISO_POPUP.includes(dados.tipo) ? dados.tipo : TIPO_AVISO_POPUP_PADRAO,
        repetir: REPETICOES_AVISO_POPUP.includes(dados.repetir) ? dados.repetir : REPETICAO_AVISO_POPUP_PADRAO,
        inicioEm: dados.inicioEm,
        fimEm: dados.fimEm,
        id: gerarIdAvisoPopup(),
        atualizadoEm: new Date().toISOString()
    };
    try {
        await gravarAgendaConfig({ avisoPopup, atualizado: new Date().toISOString() });
        agendaAvisoPopup = avisoPopup;
        preencherFormularioAvisoPopup(avisoPopup);
        avisoPainel(dados.ativo ? "Pop-up salvo." : "Pop-up salvo e desligado.");
        registrarLog("agenda_salvar_aviso_popup", {
            ativo: avisoPopup.ativo,
            tipo: avisoPopup.tipo,
            inicioEm: avisoPopup.inicioEm,
            fimEm: avisoPopup.fimEm,
            repetir: avisoPopup.repetir
        });
    } catch (e) {
        avisoPainel("Erro ao salvar o pop-up.");
    }
}

// Desligar preserva o texto: e comum o mesmo recado voltar semanas depois.
async function desativarAvisoPopup() {
    if (!exigirAgendaGestaoCarregada()) return;
    const atual = lerAvisoPopupPainel(agendaAvisoPopup);
    if (!agendaAvisoPopup || !atual.ativo) {
        document.getElementById("popup-ativo").checked = false;
        atualizarPreviaAvisoPopup();
        return avisoPainel("O pop-up já está desligado.");
    }
    if (!(await confirmarPainel("Desligar o pop-up de aviso do site agora?", { titulo: "Desativar pop-up", perigo: true, textoConfirmar: "Desativar" }))) return;
    const avisoPopup = { ...agendaAvisoPopup, ativo: false, atualizadoEm: new Date().toISOString() };
    try {
        await gravarAgendaConfig({ avisoPopup, atualizado: new Date().toISOString() });
        agendaAvisoPopup = avisoPopup;
        preencherFormularioAvisoPopup(avisoPopup);
        avisoPainel("Pop-up desativado.");
        registrarLog("agenda_desativar_aviso_popup", { inicioEm: avisoPopup.inicioEm || "", fimEm: avisoPopup.fimEm || "" });
    } catch (e) {
        avisoPainel("Erro ao desativar o pop-up.");
    }
}

function dataConfigParaInput(valor) {
    const texto = String(valor || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) {
        const p = texto.split("/");
        return `${p[2]}-${p[1]}-${p[0]}`;
    }
    return "";
}

function dataISOValidaAutomacao(valor) {
    const texto = String(valor || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const [ano, mes, dia] = texto.split("-").map(Number);
    const data = new Date(ano, mes - 1, dia);
    return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
}

function segundaDaSemanaPainel(dataISO) {
    if (!dataISOValidaAutomacao(dataISO)) return "";
    const [ano, mes, dia] = dataISO.split("-").map(Number);
    const data = new Date(ano, mes - 1, dia);
    const diaSemana = data.getDay();
    return somarDiasISO(dataISO, diaSemana === 0 ? -6 : 1 - diaSemana);
}

function normalizarAutomacaoPainel(valor) {
    const origem = valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
    const diasOrigem = Array.isArray(origem.diasSemana) ? origem.diasSemana : [2, 3, 4, 5];
    const diasSemana = [...new Set(diasOrigem.map(Number).filter(dia => Number.isInteger(dia) && dia >= 1 && dia <= 5))].sort((a, b) => a - b);
    const listaDatas = lista => [...new Set((Array.isArray(lista) ? lista : []).filter(dataISOValidaAutomacao).map(String))].sort();
    const semanasPausadas = [...new Set(listaDatas(origem.semanasPausadas).map(segundaDaSemanaPainel).filter(Boolean))].sort();
    const periodosBloqueados = (Array.isArray(origem.periodosBloqueados) ? origem.periodosBloqueados : [])
        .filter(item => item && dataISOValidaAutomacao(item.inicio) && dataISOValidaAutomacao(item.fim) && item.fim >= item.inicio)
        .map(item => ({ inicio: String(item.inicio), fim: String(item.fim), motivo: String(item.motivo || "").trim().slice(0, 120) }))
        .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fim.localeCompare(b.fim));
    return {
        ativa: origem.ativa !== false,
        horaAbertura: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(origem.horaAbertura || "")) ? String(origem.horaAbertura) : "08:00",
        diasSemana,
        semanasPausadas,
        datasBloqueadas: listaDatas(origem.datasBloqueadas),
        periodosBloqueados
    };
}

function renderAutomacaoSemanal() {
    const cfg = normalizarAutomacaoPainel(agendaAutomacaoSemanal);
    agendaAutomacaoSemanal = cfg;
    document.getElementById("cfg-auto-ativa").checked = cfg.ativa;
    document.getElementById("cfg-auto-hora").value = cfg.horaAbertura;
    document.querySelectorAll("#cfg-auto-dias input[type='checkbox']").forEach(input => {
        input.checked = cfg.diasSemana.includes(Number(input.value));
    });
    const vazio = '<span class="detalhe-pessoal">Nenhuma exceção cadastrada.</span>';
    document.getElementById("lista-semanas-pausadas").innerHTML = cfg.semanasPausadas.length
        ? cfg.semanasPausadas.map((segunda, indice) => `<span class="chip-excecao">Semana de ${textoSeguro(dataBrISO(segunda))}<button type="button" title="Remover exceção" data-acao="removerSemanaPausada" data-indice="${indice}">x</button></span>`).join("")
        : vazio;
    document.getElementById("lista-datas-bloqueadas").innerHTML = cfg.datasBloqueadas.length
        ? cfg.datasBloqueadas.map((dataISO, indice) => `<span class="chip-excecao">${textoSeguro(dataBrISO(dataISO))}<button type="button" title="Remover exceção" data-acao="removerDataBloqueada" data-indice="${indice}">x</button></span>`).join("")
        : vazio;
    document.getElementById("lista-periodos-bloqueados").innerHTML = cfg.periodosBloqueados.length
        ? cfg.periodosBloqueados.map((periodo, indice) => `<span class="chip-excecao">${textoSeguro(dataBrISO(periodo.inicio))} a ${textoSeguro(dataBrISO(periodo.fim))}${periodo.motivo ? ` · ${textoSeguro(periodo.motivo)}` : ""}<button type="button" title="Remover pausa" data-acao="removerPeriodoBloqueado" data-indice="${indice}">x</button></span>`).join("")
        : vazio;
}

function adicionarSemanaPausada() {
    if (!exigirAgendaGestaoCarregada()) return;
    const input = document.getElementById("cfg-auto-semana-pausada");
    const segunda = segundaDaSemanaPainel(input.value);
    if (!segunda) return avisoPainel("Escolha uma data válida da semana que não terá abertura.");
    agendaAutomacaoSemanal.semanasPausadas = [...new Set([...(agendaAutomacaoSemanal.semanasPausadas || []), segunda])].sort();
    input.value = "";
    renderAutomacaoSemanal();
}

function removerSemanaPausada(indice) {
    if (!exigirAgendaGestaoCarregada()) return;
    agendaAutomacaoSemanal.semanasPausadas.splice(indice, 1);
    renderAutomacaoSemanal();
}

function adicionarDataBloqueada() {
    if (!exigirAgendaGestaoCarregada()) return;
    const input = document.getElementById("cfg-auto-data-bloqueada");
    if (!dataISOValidaAutomacao(input.value)) return avisoPainel("Escolha um dia válido para bloquear.");
    agendaAutomacaoSemanal.datasBloqueadas = [...new Set([...(agendaAutomacaoSemanal.datasBloqueadas || []), input.value])].sort();
    input.value = "";
    renderAutomacaoSemanal();
}

function removerDataBloqueada(indice) {
    if (!exigirAgendaGestaoCarregada()) return;
    agendaAutomacaoSemanal.datasBloqueadas.splice(indice, 1);
    renderAutomacaoSemanal();
}

function adicionarPeriodoBloqueado() {
    if (!exigirAgendaGestaoCarregada()) return;
    const inicio = document.getElementById("cfg-auto-ferias-inicio").value;
    const fim = document.getElementById("cfg-auto-ferias-fim").value;
    const motivo = document.getElementById("cfg-auto-ferias-motivo").value.trim();
    if (!dataISOValidaAutomacao(inicio) || !dataISOValidaAutomacao(fim)) return avisoPainel("Informe o início e o fim da pausa.");
    if (fim < inicio) return avisoPainel("O fim da pausa deve ser igual ou posterior ao início.");
    agendaAutomacaoSemanal.periodosBloqueados = [...(agendaAutomacaoSemanal.periodosBloqueados || []), { inicio, fim, motivo }];
    document.getElementById("cfg-auto-ferias-inicio").value = "";
    document.getElementById("cfg-auto-ferias-fim").value = "";
    document.getElementById("cfg-auto-ferias-motivo").value = "";
    renderAutomacaoSemanal();
}

function removerPeriodoBloqueado(indice) {
    if (!exigirAgendaGestaoCarregada()) return;
    agendaAutomacaoSemanal.periodosBloqueados.splice(indice, 1);
    renderAutomacaoSemanal();
}

function automacaoDaTela() {
    const diasSemana = Array.from(document.querySelectorAll("#cfg-auto-dias input[type='checkbox']:checked")).map(input => Number(input.value));
    return normalizarAutomacaoPainel({
        ...agendaAutomacaoSemanal,
        ativa: document.getElementById("cfg-auto-ativa").checked,
        horaAbertura: document.getElementById("cfg-auto-hora").value,
        diasSemana
    });
}

function dataPermitidaPelaAutomacao(cfg, dataISO) {
    if (!cfg.ativa || !cfg.diasSemana.includes(indiceDiaSemana(dataISO))) return false;
    if (cfg.semanasPausadas.includes(segundaDaSemanaPainel(dataISO))) return false;
    if (cfg.datasBloqueadas.includes(dataISO)) return false;
    return !cfg.periodosBloqueados.some(periodo => dataISO >= periodo.inicio && dataISO <= periodo.fim);
}

async function salvarAutomacaoSemanal() {
    if (!exigirAgendaGestaoCarregada()) return;
    const cfg = automacaoDaTela();
    if (cfg.ativa && !cfg.diasSemana.length) return avisoPainel("Marque ao menos um dia normal de atendimento ou desative a automação.");
    const btn = document.getElementById("btn-salvar-automacao");
    btn.disabled = true;
    const htmlOriginal = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    const agora = agoraSaoPauloInput();
    const dias = new Set(agendaDias);
    const geradas = new Set(agendaDatasAutomaticas);
    const publicacoes = { ...agendaPublicacaoDatas };
    const removidas = [];
    const mantidasPorSeguranca = [];

    for (const dataISO of [...geradas]) {
        if (dataPermitidaPelaAutomacao(cfg, dataISO)) continue;
        if (publicacoes[dataISO] && publicacoes[dataISO] > agora) {
            dias.delete(dataISO);
            geradas.delete(dataISO);
            delete publicacoes[dataISO];
            removidas.push(dataISO);
        } else {
            mantidasPorSeguranca.push(dataISO);
        }
    }

    try {
        await gravarAgendaConfig({
            automacaoSemanal: cfg,
            dias: [...dias].sort(),
            publicacaoDatas: publicacoes,
            datasGeradasAutomaticamente: [...geradas].sort(),
            atualizado: new Date().toISOString()
        });
        agendaAutomacaoSemanal = cfg;
        agendaDias = [...dias].sort();
        agendaPublicacaoDatas = publicacoes;
        agendaDatasAutomaticas = [...geradas].sort();
        renderAutomacaoSemanal();
        renderAgendaDatas();
        await registrarLog("agenda_salvar_automacao_semanal", { removidas, mantidasPorSeguranca, automacao: cfg });
        if (mantidasPorSeguranca.length) {
            mostrarToast("Configuração salva. Datas já publicadas foram mantidas para proteger agendamentos existentes; revise-as manualmente.", "aviso");
        } else {
            mostrarToast(removidas.length ? `Automação salva; ${removidas.length} data(s) ainda não publicada(s) foram removidas.` : "Automação semanal salva.");
        }
    } catch (e) {
        mostrarToast("Erro ao salvar a automação semanal.", "erro");
    } finally {
        btn.disabled = false;
        btn.innerHTML = htmlOriginal;
    }
}

// Grava a configuracao da agenda com update, nao com set/merge.
// set com merge FUNDE mapas: chaves removidas de publicacaoDatas ou de
// horariosPorDiaSemana sobreviveriam no banco, e a remocao nao teria efeito.
// Foi assim que 2026-08-21 ficou com horario de publicacao sem estar em dias.
async function gravarAgendaConfig(conteudo) {
    if (!exigirAgendaGestaoCarregada()) {
        throw new Error("Configuracao da agenda ainda nao carregada.");
    }
    const ref = db.collection("configuracoes").doc("agenda");
    try {
        await ref.update(conteudo);
    } catch (e) {
        // Documento ainda nao existe: nao ha chave antiga a remover.
        if (e && e.code === "not-found") await ref.set(conteudo, { merge: true });
        else throw e;
    }
}

function ordenarDatas(dias) {
    return [...new Set((dias || []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}

function ordenarHorarios(horarios) {
    const base = Array.isArray(horarios) ? horarios : [];
    return [...new Set(base.filter(h => /^\d{2}:\d{2}$/.test(String(h || ""))).map(String))].sort();
}

function ordenarHorariosEditaveis(horarios) {
    const base = Array.isArray(horarios) ? horarios : [];
    return [...new Set(base.filter(h => /^\d{2}:\d{2}$/.test(String(h || ""))).map(String))].sort();
}

function normalizarHorariosSemana(valor) {
    const origem = valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
    const limpo = {};
    for (let dia = 0; dia <= 6; dia++) {
        const chave = String(dia);
        if (Object.prototype.hasOwnProperty.call(origem, chave) && Array.isArray(origem[chave])) {
            // Lista vazia e explicita significa sem atendimento nesse dia.
            limpo[chave] = ordenarHorariosEditaveis(origem[chave]);
        }
    }
    return limpo;
}

function indiceDiaSemana(dataISO) {
    const [ano, mes, dia] = String(dataISO || "").split("-").map(Number);
    if (!ano || !mes || !dia) return -1;
    return new Date(ano, mes - 1, dia).getDay();
}

// Espelho da regra canonica em functions/agenda-grade.js::horariosParaData.
function horariosPadraoParaDataPainel(dataISO) {
    return String(dataISO || "") < DATA_CORTE_GRADE_NOVA
        ? [...HORARIOS_LEGADOS]
        : [...HORARIOS_PADRAO];
}

function horariosDaData(dataISO) {
    const chave = String(indiceDiaSemana(dataISO));
    return Object.prototype.hasOwnProperty.call(agendaHorariosPorDiaSemana, chave)
        ? agendaHorariosPorDiaSemana[chave]
        : horariosPadraoParaDataPainel(dataISO);
}

// Devolve a lista personalizada do dia da semana, ou null quando o dia esta em
// modo automatico. Nesse modo a grade e resolvida por data (ver horariosDaData
// e o espelho canonico em functions/agenda-grade.js::horariosParaData), o que
// mantem 8 horarios antes do corte e 10 a partir dele.
function horariosEditaveisDiaSemana(dia) {
    const chave = String(dia);
    return Object.prototype.hasOwnProperty.call(agendaHorariosPorDiaSemana, chave)
        ? agendaHorariosPorDiaSemana[chave]
        : null;
}

function diaSemanaPersonalizado(dia) {
    return horariosEditaveisDiaSemana(dia) !== null;
}

function linhaDiaAutomatico(nome, dia) {
    return `
            <div class="horario-dia automatico">
                <strong>${textoSeguro(nome)}</strong>
                <div class="horario-auto-info">
                    <span class="horario-auto-etiqueta">Automático</span>
                    até 17/08/2026: <strong>${HORARIOS_LEGADOS.length} horários</strong>
                    &middot; a partir de 18/08/2026: <strong>${HORARIOS_PADRAO.length} horários</strong>
                </div>
                <button type="button" class="btn btn-atualizar" data-acao="personalizarDiaSemana" data-dia="${dia}"><i class="fa-solid fa-pen"></i> Personalizar</button>
            </div>
        `;
}

function linhaDiaPersonalizado(nome, dia, horarios) {
    const chips = horarios.length
        ? horarios.map(hora => `<span class="chip-horario">${textoSeguro(hora)}<button type="button" title="Remover horário" data-acao="removerHorarioSemana" data-dia="${dia}" data-hora="${textoSeguro(hora)}">x</button></span>`).join("")
        : '<span class="detalhe-pessoal">Sem horários públicos neste dia.</span>';
    return `
            <div class="horario-dia">
                <strong>${textoSeguro(nome)}</strong>
                <div class="horario-chips">${chips}</div>
                <input type="time" id="novo-horario-${dia}" aria-label="Novo horário de ${textoSeguro(nome)}">
                <button type="button" class="btn btn-atualizar" data-acao="adicionarHorarioSemana" data-dia="${dia}"><i class="fa-solid fa-plus"></i> Adicionar</button>
                <p class="horario-personalizado-aviso">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Personalizado: esta lista vale para <strong>todas</strong> as datas de ${textoSeguro(nome.toLowerCase())},
                    inclusive as anteriores a 18/08/2026.
                    <button type="button" data-acao="voltarDiaSemanaAoAutomatico" data-dia="${dia}">Voltar ao automático</button>
                </p>
            </div>
        `;
}

function renderHorariosSemana() {
    const box = document.getElementById("horarios-semana");
    if (!box) return;
    box.innerHTML = DIAS_SEMANA.map((nome, dia) => {
        const horarios = horariosEditaveisDiaSemana(dia);
        return horarios === null
            ? linhaDiaAutomatico(nome, dia)
            : linhaDiaPersonalizado(nome, dia, horarios);
    }).join("");
}

async function personalizarDiaSemana(dia) {
    if (!exigirAgendaGestaoCarregada()) return;
    const nome = DIAS_SEMANA[dia] || "este dia";
    const confirmou = await confirmarPainel(
        `Personalizar ${nome} faz a lista escolhida valer para TODAS as datas desse dia da semana, inclusive as anteriores a 18/08/2026 que já estejam publicadas.\n\nEm datas já publicadas isso pode criar atendimentos sobrepostos. Deseja continuar?`,
        { titulo: `Personalizar ${nome}`, perigo: true, textoConfirmar: "Personalizar" }
    );
    if (!confirmou) return;
    agendaHorariosPorDiaSemana[String(dia)] = [...HORARIOS_PADRAO];
    renderHorariosSemana();
}

function voltarDiaSemanaAoAutomatico(dia) {
    if (!exigirAgendaGestaoCarregada()) return;
    delete agendaHorariosPorDiaSemana[String(dia)];
    renderHorariosSemana();
}

function adicionarHorarioSemana(dia) {
    if (!exigirAgendaGestaoCarregada()) return;
    const input = document.getElementById(`novo-horario-${dia}`);
    const hora = input ? input.value : "";
    if (!/^\d{2}:\d{2}$/.test(hora)) return avisoPainel("Informe um horário válido.");
    const chave = String(dia);
    agendaHorariosPorDiaSemana[chave] = ordenarHorariosEditaveis([...(horariosEditaveisDiaSemana(dia) || []), hora]);
    renderHorariosSemana();
}

function removerHorarioSemana(dia, hora) {
    if (!exigirAgendaGestaoCarregada()) return;
    const chave = String(dia);
    agendaHorariosPorDiaSemana[chave] = (horariosEditaveisDiaSemana(dia) || []).filter(item => item !== hora);
    renderHorariosSemana();
}

async function salvarHorariosSemana() {
    if (!exigirAgendaGestaoCarregada()) return;
    const personalizados = DIAS_SEMANA.filter((nome, dia) => diaSemanaPersonalizado(dia));
    const resumo = personalizados.length
        ? `Dias personalizados: ${personalizados.join(", ")}.\n\nEsses dias deixam de seguir a regra por data e passam a valer para todas as datas do respectivo dia da semana, inclusive antes de 18/08/2026.`
        : "Nenhum dia personalizado. Todos seguem a regra por data: 8 horários até 17/08/2026 e 10 a partir de 18/08/2026.";
    if (!(await confirmarPainel(`${resumo}\n\nSalvar assim?`, { titulo: "Salvar horários", textoConfirmar: "Salvar" }))) return;
    const conteudo = {
        horariosPorDiaSemana: agendaHorariosPorDiaSemana,
        atualizado: new Date().toISOString()
    };
    try {
        await gravarAgendaConfig(conteudo);
    } catch (e) {
        mostrarToast("Erro ao salvar horários.", "erro");
        return;
    }
    try {
        await registrarLog("agenda_salvar_horarios_semana", { horariosPorDiaSemana: agendaHorariosPorDiaSemana, personalizados });
        atualizarResumo();
        mostrarToast(personalizados.length
            ? `Horários salvos. ${personalizados.length} dia(s) personalizado(s).`
            : "Horários salvos. Todos os dias seguem a regra por data.");
    } catch (e) {
        mostrarToast("Horários salvos, mas houve erro ao registrar o log.", "aviso");
    }
}

function somarDiasISO(dataISO, dias) {
    const [a, m, d] = dataISO.split("-").map(Number);
    const data = new Date(a, m - 1, d + dias);
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function somarMesesISO(dataISO, meses) {
    const [a, m, d] = dataISO.split("-").map(Number);
    const data = new Date(a, m - 1, d);
    data.setMonth(data.getMonth() + meses);
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function amanhaISO() {
    return somarDiasISO(hojeISO(), 1);
}

function ontemISO() {
    return somarDiasISO(hojeISO(), -1);
}

function fimPeriodoPadraoISO() {
    return somarDiasISO(hojeISO(), 90);
}

function configurarPeriodoPadraoLista() {
    const inicio = document.getElementById("consulta-inicio");
    const fim = document.getElementById("consulta-fim");
    if (inicio && !inicio.value) inicio.value = ontemISO();
    if (fim && !fim.value) fim.value = fimPeriodoPadraoISO();
}

function cpfNumeros(valor) {
    return String(valor || "").replace(/\D/g, "");
}

function cpfFormatado(cpf) {
    const n = cpfNumeros(cpf);
    return n.length === 11 ? `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}` : String(cpf || "");
}

function protocoloNormalizado(valor) {
    return String(valor || "").trim().toUpperCase();
}

function ordenarAgendamentosCache() {
    agendamentosCache.sort((a, b) => {
        const da = `${a.dados.dataISO || ""}_${a.dados.hora || ""}`;
        const dbb = `${b.dados.dataISO || ""}_${b.dados.hora || ""}`;
        return da.localeCompare(dbb);
    });
}

function deduplicarAgendamentos(lista) {
    const mapa = new Map();
    lista.forEach(ag => {
        if (ag && ag.id && !mapa.has(ag.id)) mapa.set(ag.id, ag);
    });
    return [...mapa.values()];
}

function dataHoraAtendimento(dados) {
    return `${dataBrISO(dados.dataISO)} ${dados.hora || ""}`.trim();
}

function semanaFimISO() {
    return somarDiasISO(hojeISO(), 6);
}

function bloqueioAtivo(dados) {
    return dados.bloqueioAtivo === true && (!dados.bloqueadoAte || dados.bloqueadoAte >= hojeISO());
}

function criarDadosBloqueio(dados) {
    const cpf = cpfNumeros(dados.cpf);
    return {
        bloqueioAtivo: true,
        bloqueioCpf: cpf,
        bloqueioNome: dados.nome || "",
        bloqueioTelefone: dados.telefone || "",
        bloqueioMotivo: "Não comparecimento",
        bloqueioDataFalta: dataHoraAtendimento(dados),
        bloqueadoAte: somarMesesISO(hojeISO(), 6),
        bloqueioCriadoEm: new Date().toISOString(),
        bloqueioOrigem: "gestaov6",
        bloqueioLiberado: false
    };
}

async function gerarCpfDocId(cpf) {
    const limpo = cpfNumeros(cpf);
    if (!limpo) return "";
    if (!window.crypto || !window.crypto.subtle) return limpo;
    const bytes = new TextEncoder().encode(limpo);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return "cpf_" + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function statusValor(dados) {
    const status = dados.status;
    if (status === "cancelado_cidadao" || status === "cancelado_camara") return "cancelado";
    return STATUS_LABELS[status] ? status : "agendado";
}

function statusLabel(status) {
    return STATUS_LABELS[status] || STATUS_LABELS.agendado;
}

function dataNascBR(valor) {
    return String(valor || "").split("-").reverse().join("/");
}

function textoBusca(ag) {
    const d = ag.dados;
    return [
        d.nome,
        d.cpf,
        cpfNumeros(d.cpf),
        d.telefone,
        cpfNumeros(d.telefone),
        d.email,
        d.protocolo,
        dataBrISO(d.dataISO),
        d.hora
    ].join(" ").toLowerCase();
}

function mostrarToast(mensagem, tipo = "sucesso", duracao = 4200) {
    const box = document.getElementById("toast-container");
    if (!box) return;
    const toast = document.createElement("div");
    const classeTipo = tipo === "erro" ? " erro" : (tipo === "aviso" ? " aviso" : "");
    const icone = tipo === "erro" ? "fa-circle-exclamation" : (tipo === "aviso" ? "fa-circle-info" : "fa-circle-check");
    toast.className = `toast-painel${classeTipo}`;
    toast.innerHTML = `<i class="fa-solid ${icone}"></i><span>${textoSeguro(mensagem)}</span>`;
    box.appendChild(toast);
    setTimeout(() => toast.remove(), duracao);
}

// Substitui os antigos alertas nativos: erro vira toast vermelho, informativo vira toast âmbar.
function avisoPainel(mensagem, tipo) {
    const texto = String(mensagem || "");
    const tipoFinal = tipo || (/^(erro|falha|n[aã]o foi|acesso negado)/i.test(texto.trim()) ? "erro" : "aviso");
    mostrarToast(texto, tipoFinal, 5600);
}

// Substitui as confirmações nativas por um modal com promessa (true = confirmou).
let confirmacaoResolver = null;
function confirmarPainel(mensagem, opcoes = {}) {
    return new Promise(resolve => {
        if (confirmacaoResolver) confirmacaoResolver(false);
        confirmacaoResolver = resolve;
        document.getElementById("confirmacao-titulo").innerHTML =
            `<i class="fa-solid fa-triangle-exclamation" style="color:#d97706;"></i> ${textoSeguro(opcoes.titulo || "Confirmar ação")}`;
        document.getElementById("confirmacao-mensagem").textContent = mensagem;
        const ok = document.getElementById("btn-confirmacao-ok");
        ok.textContent = opcoes.textoConfirmar || "Confirmar";
        ok.style.background = opcoes.perigo ? "linear-gradient(135deg, #dc2626, #ef4444)" : "";
        document.getElementById("modal-confirmacao").style.display = "flex";
    });
}
function resolverConfirmacao(valor) {
    document.getElementById("modal-confirmacao").style.display = "none";
    const resolver = confirmacaoResolver;
    confirmacaoResolver = null;
    if (resolver) resolver(valor);
}

// Todos os modais fecham com Esc ou clique fora da caixa.
const FECHADORES_MODAIS = {
    "modal-manual": () => fecharModal(),
    "modal-remarcar": () => fecharRemarcacao(),
    "modal-lote-flexivel": () => fecharModalLoteFlex(),
    "modal-observacao": () => fecharObservacao(),
    "modal-confirmacao": () => resolverConfirmacao(false)
};
Object.keys(FECHADORES_MODAIS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", e => { if (e.target === el) FECHADORES_MODAIS[id](); });
});
document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    Object.keys(FECHADORES_MODAIS).forEach(id => {
        const el = document.getElementById(id);
        if (el && el.style.display === "flex") FECHADORES_MODAIS[id]();
    });
});

function destacarAtendimento(id) {
    ["row-ag-", "fila-ag-"].forEach(prefixo => {
        const el = document.getElementById(`${prefixo}${id}`);
        if (!el) return;
        el.classList.remove("linha-destaque");
        void el.offsetWidth;
        el.classList.add("linha-destaque");
    });
}

function aplicarVariaveisTemplate(template, dados) {
    const valores = {
        nome: dados.nome || "",
        data: dataBrISO(dados.dataISO),
        hora: dados.hora || "",
        protocolo: dados.protocolo || "não informado"
    };
    return String(template || TEMPLATE_LEMBRETE_PADRAO).replace(/\{(nome|data|hora|protocolo)\}/g, (_, chave) => valores[chave]);
}

function mensagemLembrete(d) {
    return aplicarVariaveisTemplate(templateLembrete, d);
}

async function salvarPreferenciasOperacionais() {
    if (!exigirAgendaGestaoCarregada()) return;
    const responsavel = document.getElementById("cfg-responsavel-posto").value.trim();
    const template = document.getElementById("cfg-template-lembrete").value.trim();
    if (responsavel.length < 3) return avisoPainel("Informe o nome do responsável do posto.");
    if (!template || template.length > 2500) return avisoPainel("Informe uma mensagem de lembrete válida.");
    responsavelPosto = responsavel;
    templateLembrete = template;
    try {
        await db.collection("configuracoes").doc("agenda").set({
            responsavelPosto,
            mensagemLembreteTemplate: templateLembrete,
            atualizado: new Date().toISOString()
        }, { merge: true });
        await registrarLog("agenda_salvar_preferencias", {});
        mostrarToast("Preferências operacionais salvas.");
    } catch (e) {
        mostrarToast("Erro ao salvar preferências.", "erro");
    }
}

function documentosComprovanteHTML(nascBR) {
    let fotoLI = '';
    if (nascBR && /^\d{2}\/\d{2}\/\d{4}$/.test(nascBR)) {
        const partes = nascBR.split("/");
        const dia = parseInt(partes[0], 10);
        const mes = parseInt(partes[1], 10);
        const ano = parseInt(partes[2], 10);
        
        const nascDate = new Date(ano, mes - 1, dia);
        const hoje = new Date();
        let idade = hoje.getFullYear() - nascDate.getFullYear();
        const m = hoje.getMonth() - nascDate.getMonth();
        if (m < 0 || (m === 0 && hoje.getDate() < nascDate.getDate())) {
            idade--;
        }
        if (idade < 3) {
            fotoLI = '<li style="color:#b45309; font-weight:bold;">ATENÇÃO: Por ser menor de 3 anos, além dos documentos acima, é OBRIGATÓRIO levar 1 foto 3x4 recente.</li>';
        }
    } else {
        fotoLI = '<li>Menores de 3 anos: além dos documentos acima, levar 1 foto 3x4 recente.</li>';
    }
    return `
        <ul>
            <li><strong>A certidão deve ser ORIGINAL, sem rasgos, rasuras ou alterações.</strong></li>
            <li>Certidão de nascimento original, se solteiro, ou certidão de casamento original, se casado.</li>
            <li>Se viúvo ou divorciado, a certidão de casamento deve estar averbada.</li>
            <li>CPF e comprovante de residência.</li>
            <li>Menores de 16 anos devem estar acompanhados do responsável legal com RG ou CNH.</li>
            ${fotoLI}
        </ul>
    `;
}

function linhaComprovante(rotulo, valor) {
    if (!valor) return "";
    return `<div class="linha"><span>${textoSeguro(rotulo)}</span><strong>${textoSeguro(valor)}</strong></div>`;
}

function emitirComprovantePDF(dados) {
    const dataBR = dados.dataBR || dataBrISO(dados.dataISO);
    const nascBR = dados.nascimentoBR || dataNascBR(dados.dataNasc);
    const protocolo = dados.protocolo || "Não informado";
    const janela = window.open("", "_blank");
    if (!janela) {
        avisoPainel("O navegador bloqueou a janela do comprovante. Permita pop-ups para emitir o PDF.");
        return false;
    }

    janela.document.write(`<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <title>Comprovante ${textoSeguro(protocolo)}</title>
    <style>
* { box-sizing: border-box; }
body { font-family: Arial, sans-serif; margin: 0; background: #f1f5f9; color: #0f172a; }
.pagina { max-width: 760px; margin: 24px auto; background: white; padding: 34px; border: 1px solid #e2e8f0; }
.topo { text-align: center; border-bottom: 3px solid #0056b3; padding-bottom: 18px; margin-bottom: 24px; }
.topo img { max-width: 190px; margin-bottom: 12px; }
h1 { margin: 0; font-size: 22px; color: #003d82; text-transform: uppercase; }
.sub { margin: 6px 0 0; color: #475569; font-size: 14px; }
.protocolo { margin: 22px 0; padding: 16px; text-align: center; border: 1px dashed #94a3b8; border-radius: 10px; }
.protocolo strong { display: block; font-size: 24px; color: #0056b3; margin-top: 4px; letter-spacing: 1px; }
.linha { display: flex; justify-content: space-between; gap: 18px; padding: 11px 0; border-bottom: 1px solid #e2e8f0; }
.linha span { color: #64748b; font-weight: 700; }
.linha strong { text-align: right; color: #0f172a; }
.box { margin-top: 24px; background: #fffbeb; border: 1px solid #fde68a; border-left: 5px solid #f59e0b; padding: 16px 18px; border-radius: 10px; }
.box h2 { margin: 0 0 8px; font-size: 16px; color: #92400e; }
.box ul { margin: 0; padding-left: 20px; line-height: 1.55; color: #78350f; }
.rodape { margin-top: 26px; color: #64748b; font-size: 12px; text-align: center; }
.acoes { max-width: 760px; margin: 0 auto 24px; display: flex; justify-content: center; gap: 10px; }
button { border: none; border-radius: 8px; padding: 11px 18px; font-weight: 700; cursor: pointer; }
.imprimir { background: #0056b3; color: white; }
.fechar { background: #e2e8f0; color: #0f172a; }
@media print {
    body { background: white; }
    .pagina { margin: 0; max-width: none; border: none; }
    .acoes { display: none; }
}
    </style>
</head>
<body>
    <div class="pagina">
<div class="topo">
    <img src="/assets/header-logo.png" alt="Câmara Municipal de Itanhandu">
    <h1>Comprovante de Agendamento</h1>
    <p class="sub">Carteira de Identidade Nacional - CIN</p>
</div>
<div class="protocolo">Protocolo<strong>${textoSeguro(protocolo)}</strong></div>
${linhaComprovante("Nome", dados.nome)}
${linhaComprovante("Data", dataBR)}
${linhaComprovante("Horário", dados.hora)}
${linhaComprovante("CPF", dados.cpf)}
${linhaComprovante("Nascimento", nascBR)}
${linhaComprovante("Telefone", dados.telefone)}
${linhaComprovante("Local", "Câmara Municipal de Itanhandu")}
<div class="box">
    <h2>Documentos necessários</h2>
    ${documentosComprovanteHTML(nascBR)}
</div>
<div class="rodape">Comprovante emitido em ${new Date().toLocaleString("pt-BR")} pelo sistema de agendamento da Câmara Municipal de Itanhandu.</div>
    </div>
    <div class="acoes">
<button class="imprimir" id="acao-imprimir">Imprimir / Salvar em PDF</button>
<button class="fechar" id="acao-fechar">Fechar</button>
    </div>
</body>
</html>`);
    janela.document.close();
    prepararJanelaImpressao(janela, { autoImprimir: true });
    return true;
}

function emitirComprovanteDaLista(id) {
    const ag = buscarAgendamentoCache(id);
    if (!ag) return avisoPainel("Agendamento não encontrado na lista atual.");
    if (!emitirComprovantePDF(ag.dados)) return;
    registrarLog("emitir_comprovante", { agendamentoId: id, protocolo: ag.dados.protocolo || "" });
}

function emitirDeclaracaoComparecimentoPDF(dados) {
    const dataBR = dados.dataBR || dataBrISO(dados.dataISO);
    const nascBR = dados.nascimentoBR || dataNascBR(dados.dataNasc);
    const protocolo = dados.protocolo || "Nao informado";
    const emitidoEm = new Date().toLocaleString("pt-BR");
    const janela = window.open("", "_blank");
    if (!janela) {
        avisoPainel("O navegador bloqueou a janela da declaracao. Permita pop-ups para emitir o PDF.");
        return false;
    }

    janela.document.write(`<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <title>Declaracao de Comparecimento ${textoSeguro(protocolo)}</title>
    <style>
* { box-sizing: border-box; }
body { font-family: Arial, sans-serif; margin: 0; background: #f1f5f9; color: #0f172a; }
.pagina { max-width: 760px; min-height: 1040px; margin: 24px auto; background: white; padding: 46px 44px; border: 1px solid #e2e8f0; }
.topo { text-align: center; border-bottom: 3px solid #0056b3; padding-bottom: 18px; margin-bottom: 34px; }
.topo img { max-width: 190px; margin-bottom: 12px; }
h1 { margin: 0; font-size: 23px; color: #003d82; text-transform: uppercase; letter-spacing: 0.4px; }
.sub { margin: 7px 0 0; color: #475569; font-size: 14px; }
.dados { margin: 22px 0 28px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.linha { display: flex; justify-content: space-between; gap: 18px; padding: 11px 14px; border-bottom: 1px solid #e2e8f0; }
.linha:last-child { border-bottom: none; }
.linha span { color: #64748b; font-weight: 700; }
.linha strong { text-align: right; color: #0f172a; }
.texto-declaracao { margin: 36px 0; font-size: 16px; line-height: 1.85; text-align: justify; color: #111827; }
.texto-declaracao p { margin: 0 0 18px; }
.assinatura { margin: 72px auto 0; max-width: 360px; text-align: center; color: #334155; }
.assinatura .linha-assinatura { border-top: 1px solid #334155; padding-top: 9px; font-weight: 700; }
.rodape { margin-top: 42px; color: #64748b; font-size: 12px; text-align: center; line-height: 1.5; }
.acoes { max-width: 760px; margin: 0 auto 24px; display: flex; justify-content: center; gap: 10px; }
button { border: none; border-radius: 8px; padding: 11px 18px; font-weight: 700; cursor: pointer; }
.imprimir { background: #0056b3; color: white; }
.fechar { background: #e2e8f0; color: #0f172a; }
@page { size: A4; margin: 14mm; }
@media print {
    body { background: white; }
    .pagina { margin: 0; max-width: none; min-height: auto; border: none; padding: 0; }
    .acoes { display: none; }
}
    </style>
</head>
<body>
    <div class="pagina">
<div class="topo">
    <img src="/assets/header-logo.png" alt="Camara Municipal de Itanhandu">
    <h1>Declaracao de Comparecimento</h1>
    <p class="sub">Atendimento para emissao da Carteira de Identidade Nacional - CIN/RG</p>
</div>
<div class="dados">
    ${linhaComprovante("Nome", dados.nome)}
    ${linhaComprovante("CPF", dados.cpf)}
    ${linhaComprovante("Nascimento", nascBR)}
    ${linhaComprovante("Data do atendimento", dataBR)}
    ${linhaComprovante("Horario", dados.hora)}
    ${linhaComprovante("Protocolo", protocolo)}
</div>
<div class="texto-declaracao">
    <p>Declaramos, para os devidos fins, que <strong>${textoSeguro(dados.nome || "cidadao")}</strong>${dados.cpf ? `, inscrito(a) no CPF <strong>${textoSeguro(dados.cpf)}</strong>` : ""}, compareceu a <strong>Camara Municipal de Itanhandu</strong> no dia <strong>${textoSeguro(dataBR || "____/____/______")}</strong>${dados.hora ? `, as <strong>${textoSeguro(dados.hora)}</strong>` : ""}, para atendimento referente a emissao da Carteira de Identidade Nacional - CIN/RG.</p>
    <p>A presente declaracao e emitida a pedido do(a) interessado(a), para fins de comprovacao de comparecimento.</p>
</div>
<div class="assinatura">
    <div class="linha-assinatura">${textoSeguro(responsavelPosto)}</div>
    <div style="font-size:12px; margin-top:4px;">Identificador do Posto</div>
</div>
<div class="rodape">Declaracao emitida em ${textoSeguro(emitidoEm)} pelo sistema de agendamento da Camara Municipal de Itanhandu.</div>
    </div>
    <div class="acoes">
<button class="imprimir" id="acao-imprimir">Imprimir / Salvar em PDF</button>
<button class="fechar" id="acao-fechar">Fechar</button>
    </div>
</body>
</html>`);
    janela.document.close();
    prepararJanelaImpressao(janela, { autoImprimir: true });
    return true;
}

async function emitirDeclaracaoComparecimentoDaLista(id) {
    const ag = buscarAgendamentoCache(id);
    if (!ag) return avisoPainel("Agendamento nao encontrado na lista atual.");
    if (statusValor(ag.dados) !== "compareceu" && !(await confirmarPainel("Este atendimento ainda não está marcado como Compareceu. Deseja emitir a declaração mesmo assim?", { titulo: "Declaração de comparecimento", textoConfirmar: "Emitir declaração" }))) {
        return;
    }
    if (!emitirDeclaracaoComparecimentoPDF(ag.dados)) return;
    registrarLog("emitir_declaracao_comparecimento", { agendamentoId: id, protocolo: ag.dados.protocolo || "" });
}

async function registrarLog(acao, detalhes) {
    try {
        const log = {
            acao,
            detalhes: detalhes || {},
            adminEmail: auth.currentUser ? auth.currentUser.email : "",
            criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            criado: new Date().toISOString()
        };
        await db.collection("logs_admin").add(log);
        logsRecentes.unshift(log);
        logsRecentes = logsRecentes.slice(0, 20);
        renderLogsAdmin();
    } catch (e) {
        console.warn("Falha ao registrar log", e);
    }
}

function acaoLogLabel(acao) {
    return ({
        alterar_status: "Status atualizado",
        atualizar_observacao: "Observação atualizada",
        whatsapp_lembrete: "Lembrete WhatsApp",
        lembrete_lote: "Lembrete em lote",
        liberar_bloqueio: "Bloqueio liberado",
        cancelar_agendamento_painel: "Agendamento cancelado",
        remarcacao_painel: "Agendamento remarcado",
        agenda_adicionar_data: "Data adicionada",
        agenda_remover_data: "Data removida",
        agenda_automacao_semanal: "Automação semanal executada",
        agenda_salvar_automacao_semanal: "Automação semanal salva",
        agenda_salvar_horarios_semana: "Horários salvos",
        agenda_salvar_preferencias: "Preferências salvas",
        agenda_salvar_aviso_popup: "Pop-up de aviso salvo",
        agenda_desativar_aviso_popup: "Pop-up de aviso desativado",
        credencial_cadastrar: "Credencial cadastrada",
        credencial_pronta: "Credencial pronta",
        credencial_aviso_whatsapp: "Aviso WhatsApp credencial",
        credencial_entregue: "Credencial entregue",
        credencial_reabrir: "Credencial reaberta",
        credencial_remover: "Credencial removida"
    })[acao] || String(acao || "Ação administrativa").replace(/_/g, " ");
}

function logEhDeHoje(log) {
    if (!log.criado) return true;
    return new Date(log.criado).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) === hojeISO();
}

function nomeCidadaoDoLog(log) {
    const id = log.agendamentoId || (log.detalhes && log.detalhes.agendamentoId) || "";
    const ag = buscarAgendamentoCache(id);
    return ag ? ag.dados.nome : (id ? `Registro ${id.slice(0, 8)}` : "Configuração do painel");
}

function renderLogsAdmin() {
    const box = document.getElementById("logs-lista");
    if (!box) return;
    const logs = logsRecentes.filter(logEhDeHoje).slice(0, 20);
    if (!logs.length) {
        box.innerHTML = '<span class="detalhe-pessoal">Nenhuma ação registrada hoje.</span>';
        return;
    }
    box.innerHTML = logs.map(log => {
        const hora = log.criado ? new Date(log.criado).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--";
        return `<div class="log-item"><strong>${textoSeguro(hora)}</strong><span>${textoSeguro(acaoLogLabel(log.acao))}</span><span>${textoSeguro(nomeCidadaoDoLog(log))}</span><span>${textoSeguro(log.adminEmail || "sistema")}</span></div>`;
    }).join("");
}

async function carregarLogsAdmin() {
    const box = document.getElementById("logs-lista");
    if (box) box.innerHTML = '<span class="detalhe-pessoal"><i class="fa-solid fa-spinner fa-spin"></i> Carregando histórico...</span>';
    try {
        const listarLogs = functions.httpsCallable("listarLogsAdmin");
        const resposta = await listarLogs({ limite: 80 });
        logsRecentes = Array.isArray(resposta.data.logs) ? resposta.data.logs : [];
        renderLogsAdmin();
    } catch (e) {
        if (box) box.innerHTML = '<span class="detalhe-pessoal">Não foi possível carregar o histórico.</span>';
    }
}

function alternarCardsAcesso(visivel) {
    const box = document.getElementById("acessos-tempo-real");
    if (box) box.style.display = visivel ? "" : "none";
}

function atualizarMetricasAcessoPainel(dados) {
    const metricas = dados && typeof dados === "object" ? dados : {};
    alternarCardsAcesso(true);
    document.getElementById("acessos-agora").textContent = Number(metricas.ativosAgora) || 0;
    document.getElementById("acessos-pico-hoje").textContent = Number(metricas.picoHoje) || 0;
    document.getElementById("acessos-total-hoje").textContent = Number(metricas.acessosHoje) || 0;
}

function mostrarMetricasAcessoDesativadas() {
    // Sem medicao os tres cards so repetiam "Medicao desativada" no topo
    // da tela de operacao; melhor nao ocupar o espaco.
    alternarCardsAcesso(false);
    ["acessos-agora", "acessos-pico-hoje", "acessos-total-hoje"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "Medição desativada";
    });
}

function iniciarMonitoramentoAcessos() {
    if (!METRICAS_ACESSO_PUBLICO_ATIVAS) {
        pararMonitoramentoAcessos();
        mostrarMetricasAcessoDesativadas();
        return;
    }
    if (monitoramentoAcessosRef) return;
    monitoramentoAcessosRef = realtimeDbAdmin.ref("presenca_publica/metricas");
    monitoramentoAcessosRef.on("value", snapshot => atualizarMetricasAcessoPainel(snapshot.val()), erro => {
        console.warn("Monitoramento de acessos indisponível", erro);
        ["acessos-agora", "acessos-pico-hoje", "acessos-total-hoje"].forEach(id => { document.getElementById(id).textContent = "Indisponível"; });
    });
}

function pararMonitoramentoAcessos() {
    if (!monitoramentoAcessosRef) return;
    monitoramentoAcessosRef.off();
    monitoramentoAcessosRef = null;
}

auth.onAuthStateChanged(async user => {
    const splash = document.getElementById('boot-splash');
    if (user) {
        document.getElementById('login-screen').style.display='none';
        document.getElementById('painel-screen').style.display='none';
        if (splash) {
            splash.style.display = 'flex';
            const texto = splash.querySelector('span');
            if (texto) texto.textContent = 'Validando acesso administrativo...';
        }
        try {
            await validarAdministradorAtivo(user);
        } catch (e) {
            if (splash) splash.style.display = 'none';
            if (await encerrarSessaoPorAcessoRevogado(e)) return;
            try { await auth.signOut(); } catch (erroLogout) { console.warn("Falha ao reiniciar login", erroLogout); }
            document.getElementById('login-screen').style.display='block';
            mostrarErroLogin("Não foi possível validar seu acesso agora. Verifique a conexão e tente entrar novamente.");
            return;
        }
        if (splash) splash.style.display = 'none';
        document.getElementById('login-screen').style.display='none';
        document.getElementById('painel-screen').style.display='block';
        resetarTimerInatividade();
        // Impede selecionar datas passadas no input de nova data.
        document.getElementById('cfg-data').min = hojeISO();
        document.getElementById('m-data').min = hojeISO();
        document.getElementById('remarcar-data').min = hojeISO();
        document.getElementById('cfg-publicar-em-data').min = agoraSaoPauloInput();
        document.getElementById('cfg-publicar-em-aviso').min = agoraSaoPauloInput();
        // popup-inicio e popup-fim ficam sem `min` de proposito: a
        // recepcao precisa poder reabrir um aviso antigo para
        // reaproveitar o texto, e a validacao de fim futuro esta em
        // salvarAvisoPopup.
        ["cfg-auto-semana-pausada", "cfg-auto-data-bloqueada", "cfg-auto-ferias-inicio", "cfg-auto-ferias-fim"].forEach(id => {
            document.getElementById(id).min = hojeISO();
        });
        configurarPeriodoPadraoLista();
        agendaGestaoCarregada = false;
        definirMutacoesAgendaHabilitadas(false);
        listaAgendamentosCarregada = false;
        totalAtendimentosCarregado = false;
        totalAtendimentosIndisponivel = false;
        document.getElementById("kpi-atendidos").textContent = "...";
        marcarIndicadoresHistoricosCarregando();
        await carregarAgendaGestao();
        await Promise.all([listarAgendamentos(), carregarTotalAtendimentosRealizados()]);
        await carregarLogsAdmin();
        iniciarMonitoramentoAcessos();
        const apelido = String(user.email || "").split("@")[0];
        const quem = document.getElementById("quem-nome");
        if (quem && apelido) quem.textContent = apelido;
        atualizarEstadoConfigHub();
        mostrarVistaPainel("hoje");
        agendarAtualizacaoAutomatica();
    }
    else {
        if (splash) splash.style.display = 'none';
        geracaoConsultaAgendamentos++;
        carregamentoListaEmAndamento = false;
        atualizacaoDiasEmAndamento = false;
        clearInterval(timerAtualizacaoAutomatica);
        pararMonitoramentoAcessos();
        agendaGestaoCarregada = false;
        definirMutacoesAgendaHabilitadas(false);
        document.getElementById('login-screen').style.display='block';
        document.getElementById('painel-screen').style.display='none';
        document.title = "Recepção CIN — Câmara de Itanhandu";
    }
});

async function fazerLogin() {
    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;
    const btn = document.getElementById("btn-login");
    const erroEl = document.getElementById("login-erro");
    erroEl.style.display = "none";
    if (!email || !senha) {
        erroEl.textContent = "Informe e-mail e senha para entrar.";
        erroEl.style.display = "block";
        return;
    }
    const htmlOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ENTRANDO...';
    try {
        await auth.signInWithEmailAndPassword(email, senha);
    } catch (e) {
        const codigo = (e && e.code) || "";
        let msg;
        if (codigo === "auth/invalid-email") msg = "E-mail inválido. Confira o endereço digitado.";
        else if (["auth/user-not-found", "auth/wrong-password", "auth/invalid-credential", "auth/invalid-login-credentials"].includes(codigo)) msg = "E-mail ou senha incorretos.";
        else if (codigo === "auth/too-many-requests") msg = "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.";
        else if (codigo === "auth/network-request-failed") msg = "Sem conexão com a internet. Verifique a rede e tente novamente.";
        else msg = "Não foi possível entrar. Tente novamente.";
        erroEl.textContent = msg;
        erroEl.style.display = "block";
    } finally {
        btn.disabled = false;
        btn.innerHTML = htmlOriginal;
    }
}
["email", "senha"].forEach(id => document.getElementById(id).addEventListener("keydown", e => {
    if (e.key === "Enter") fazerLogin();
}));
function fazerLogout() { clearTimeout(timerAviso); clearTimeout(timerLogout); clearInterval(timerAtualizacaoAutomatica); pararMonitoramentoAcessos(); removerAvisoSessao(); auth.signOut(); }
function abrirModal() { marcarErroManual([]); document.getElementById('modal-manual').style.display='flex'; }
function fecharModal() { marcarErroManual([]); document.getElementById('modal-manual').style.display='none'; }
function fecharRemarcacao() { document.getElementById('modal-remarcar').style.display='none'; }
function fecharObservacao() { document.getElementById("modal-observacao").style.display = "none"; }

function abrirObservacao(id) {
    const ag = buscarAgendamentoCache(id);
    if (!ag) return avisoPainel("Agendamento não encontrado.");
    document.getElementById("observacao-id").value = id;
    document.getElementById("observacao-nome").value = ag.dados.nome || "";
    document.getElementById("observacao-texto").value = ag.dados.observacaoInterna || "";
    document.getElementById("observacao-meta").textContent = ag.dados.observacaoAtualizadaPor
        ? `Última atualização por ${ag.dados.observacaoAtualizadaPor}.`
        : "Sem observação registrada.";
    document.getElementById("modal-observacao").style.display = "flex";
    document.getElementById("observacao-texto").focus();
}

async function salvarObservacao() {
    const id = document.getElementById("observacao-id").value;
    const texto = document.getElementById("observacao-texto").value.trim();
    const ag = buscarAgendamentoCache(id);
    if (!ag) return avisoPainel("Agendamento não encontrado.");
    const btn = document.getElementById("btnSalvarObservacao");
    btn.disabled = true;
    try {
        const atualizarObservacao = functions.httpsCallable("atualizarObservacaoAdmin");
        await atualizarObservacao({ agendamentoId: id, observacaoInterna: texto });
        ag.dados.observacaoInterna = texto;
        ag.dados.observacaoAtualizadaPor = auth.currentUser ? auth.currentUser.email : "";
        ag.dados.observacaoAtualizadaEm = new Date().toISOString();
        fecharObservacao();
        renderTabelaAgendamentos();
        renderFilaHoje();
        mostrarToast("Observação interna salva.");
        carregarLogsAdmin();
    } catch (e) {
        mostrarToast("Erro ao salvar observação.", "erro");
    } finally {
        btn.disabled = false;
    }
}

function renderAgendaDatas() {
    const lista = document.getElementById("lista-datas-agenda");
    const acoes = document.getElementById("datas-encerradas-acoes");
    const hoje = hojeISO();
    const datasFuturas = agendaDias.filter(dataISO => dataISO >= hoje);
    const datasPassadas = agendaDias.filter(dataISO => dataISO < hoje);
    const datasVisiveis = mostrarDatasPassadas ? [...datasFuturas, ...datasPassadas] : datasFuturas;
    lista.innerHTML = "";
    if (acoes) acoes.innerHTML = "";
    if (!agendaDias.length) {
        lista.innerHTML = '<span style="color:#64748b; font-size:0.9rem;">Nenhuma data cadastrada.</span>';
        return;
    }
    if (!datasVisiveis.length) {
        lista.innerHTML = '<span style="color:#64748b; font-size:0.9rem;">Nenhuma data futura cadastrada.</span>';
    }
    datasVisiveis.forEach(dataISO => {
        const chip = document.createElement("span");
        chip.className = "chip-data" + (dataISO < hoje ? " passada" : "") + (estaProgramada(dataISO) ? " programada" : "");
        const label = document.createElement("span");
        label.textContent = dataBrISO(dataISO)
            + (dataISO < hoje ? " - encerrada" : "")
            + (agendaDatasAutomaticas.includes(dataISO) ? " - automática" : "")
            + (estaProgramada(dataISO) ? ` - libera ${dataHoraBr(agendaPublicacaoDatas[dataISO])}` : "");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = "Remover data";
        btn.textContent = "x";
        btn.onclick = () => removerDataAgenda(dataISO);
        chip.appendChild(label);
        chip.appendChild(btn);
        lista.appendChild(chip);
    });
    if (acoes && datasPassadas.length) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn-toggle-datas";
        toggle.textContent = `${mostrarDatasPassadas ? "Ocultar" : "Mostrar"} datas encerradas (${datasPassadas.length})`;
        toggle.onclick = alternarDatasPassadasAgenda;
        acoes.appendChild(toggle);
    }
}

function alternarDatasPassadasAgenda() {
    mostrarDatasPassadas = !mostrarDatasPassadas;
    try {
        localStorage.setItem("cin_mostrar_datas_passadas", mostrarDatasPassadas ? "true" : "false");
    } catch (e) {}
    renderAgendaDatas();
}

async function carregarAgendaGestao() {
    const lista = document.getElementById("lista-datas-agenda");
    lista.innerHTML = '<span style="color:#64748b; font-size:0.9rem;">Carregando datas...</span>';
    agendaGestaoCarregada = false;
    definirMutacoesAgendaHabilitadas(false);
    try {
        const doc = await db.collection("configuracoes").doc("agenda").get({ source: "server" });
        const cfg = doc.exists ? doc.data() : {};
        agendaDias = ordenarDatas(Array.isArray(cfg.dias) ? cfg.dias : []);
        agendaHorarios = ordenarHorarios(cfg.horarios);
        agendaHorariosPorDiaSemana = normalizarHorariosSemana(cfg.horariosPorDiaSemana);
        agendaPublicacaoDatas = normalizarPublicacaoDatas(cfg.publicacaoDatas);
        agendaAutomacaoSemanal = normalizarAutomacaoPainel(cfg.automacaoSemanal);
        agendaDatasAutomaticas = ordenarDatas(Array.isArray(cfg.datasGeradasAutomaticamente) ? cfg.datasGeradasAutomaticamente : []);
        responsavelPosto = String(cfg.responsavelPosto || RESPONSAVEL_POSTO_PADRAO).trim();
        templateLembrete = String(cfg.mensagemLembreteTemplate || TEMPLATE_LEMBRETE_PADRAO);
        document.getElementById("cfg-responsavel-posto").value = responsavelPosto;
        document.getElementById("cfg-template-lembrete").value = templateLembrete;
        agendaAvisoPopup = cfg.avisoPopup && typeof cfg.avisoPopup === "object" && !Array.isArray(cfg.avisoPopup)
            ? cfg.avisoPopup
            : null;
        preencherFormularioAvisoPopup(agendaAvisoPopup);
        const avisoProgramado = cfg.avisoNovasVagasProgramado && typeof cfg.avisoNovasVagasProgramado === "object" ? cfg.avisoNovasVagasProgramado : null;
        const agora = agoraSaoPauloInput();
        document.getElementById("cfg-data-novas-vagas").value = dataConfigParaInput(
            avisoProgramado && avisoProgramado.publicarEm && avisoProgramado.publicarEm <= agora
                ? avisoProgramado.dataNovasVagas
                : cfg.dataNovasVagas
        );
        if (avisoProgramado && avisoProgramado.publicarEm && avisoProgramado.publicarEm > agora) {
            document.getElementById("cfg-data-novas-vagas").value = dataConfigParaInput(avisoProgramado.dataNovasVagas);
            document.getElementById("cfg-disponibilidade-aviso").value = "programar";
            document.getElementById("cfg-publicar-em-aviso").value = avisoProgramado.publicarEm;
        } else {
            document.getElementById("cfg-disponibilidade-aviso").value = "agora";
            document.getElementById("cfg-publicar-em-aviso").value = "";
        }
        alternarProgramacaoAviso();
        renderAgendaDatas();
        renderAutomacaoSemanal();
        renderHorariosSemana();
        agendaGestaoCarregada = true;
        definirMutacoesAgendaHabilitadas(true);
        atualizarResumo();
    } catch (e) {
        definirMutacoesAgendaHabilitadas(false);
        if (await encerrarSessaoPorAcessoRevogado(e)) return;
        lista.innerHTML = '<span style="color:#dc2626; font-size:0.9rem;">Erro ao carregar a configuração.</span> <button type="button" class="btn btn-atualizar" data-acao="carregarAgendaGestao"><i class="fa-solid fa-rotate"></i> Tentar novamente</button>';
    }
}

async function salvarAgendaGestao(msg) {
    if (!exigirAgendaGestaoCarregada()) throw new Error("Configuracao da agenda ainda nao carregada.");
    agendaPublicacaoDatas = normalizarPublicacaoDatas(agendaPublicacaoDatas);
    Object.keys(agendaPublicacaoDatas).forEach(data => {
        if (!agendaDias.includes(data)) delete agendaPublicacaoDatas[data];
    });
    await gravarAgendaConfig({
        dias: agendaDias,
        horarios: agendaHorarios.length ? agendaHorarios : HORARIOS_PADRAO,
        horariosPorDiaSemana: agendaHorariosPorDiaSemana,
        publicacaoDatas: agendaPublicacaoDatas,
        automacaoSemanal: agendaAutomacaoSemanal,
        datasGeradasAutomaticamente: agendaDatasAutomaticas,
        atualizado: new Date().toISOString()
    });
    renderAgendaDatas();
    if (msg) avisoPainel(msg);
}

async function adicionarDataAgenda() {
    if (!exigirAgendaGestaoCarregada()) return;
    const input = document.getElementById("cfg-data");
    const data = input.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return avisoPainel("Escolha uma data valida.");
    if (data < hojeISO()) return avisoPainel("Nao e possivel adicionar data que ja passou.");
    if (agendaDias.includes(data)) return avisoPainel("Esta data ja esta cadastrada.");
    const modo = document.getElementById("cfg-disponibilidade-data").value;
    const publicarEm = document.getElementById("cfg-publicar-em-data").value;
    if (modo === "programar") {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(publicarEm)) return avisoPainel("Informe a data e hora de liberacao.");
        if (publicarEm <= agoraSaoPauloInput()) return avisoPainel("Escolha uma data e hora futura para liberar a data.");
        agendaPublicacaoDatas[data] = publicarEm;
    } else {
        delete agendaPublicacaoDatas[data];
    }
    agendaDias = ordenarDatas([...agendaDias, data]);
    input.value = "";
    try {
        await salvarAgendaGestao("Data adicionada.");
        document.getElementById("cfg-disponibilidade-data").value = "agora";
        document.getElementById("cfg-publicar-em-data").value = "";
        alternarProgramacaoData();
        registrarLog("agenda_adicionar_data", { dataISO: data, publicarEm: agendaPublicacaoDatas[data] || "agora" });
    }
    catch (e) { avisoPainel("Erro ao salvar data."); carregarAgendaGestao(); }
}

async function removerDataAgenda(data) {
    if (!exigirAgendaGestaoCarregada()) return;
    if (!(await confirmarPainel(`Remover a data ${dataBrISO(data)} da agenda?`, { titulo: "Remover data", perigo: true, textoConfirmar: "Remover" }))) return;
    agendaDias = agendaDias.filter(d => d !== data);
    delete agendaPublicacaoDatas[data];
    if (agendaDatasAutomaticas.includes(data)) {
        agendaDatasAutomaticas = agendaDatasAutomaticas.filter(d => d !== data);
        agendaAutomacaoSemanal.datasBloqueadas = [...new Set([...(agendaAutomacaoSemanal.datasBloqueadas || []), data])].sort();
    }
    try {
        await salvarAgendaGestao("Data removida.");
        renderAutomacaoSemanal();
        registrarLog("agenda_remover_data", { dataISO: data, bloqueadaNaAutomacao: agendaAutomacaoSemanal.datasBloqueadas.includes(data) });
    }
    catch (e) { avisoPainel("Erro ao remover data."); carregarAgendaGestao(); }
}

function abrirModalLoteFlex() {
    const inicio = document.getElementById("lote-flex-inicio");
    const fim = document.getElementById("lote-flex-fim");
    if (inicio) {
        inicio.min = hojeISO();
        inicio.value = "";
    }
    if (fim) {
        fim.min = hojeISO();
        fim.value = "";
    }
    document.getElementById("lote-flex-disp").value = "agora";
    document.getElementById("lote-flex-pub-data").value = "";
    alternarProgLoteFlex();
    document.getElementById("box-previa-lote").style.display = "none";
    document.getElementById("box-previa-lote").innerHTML = "";
    document.getElementById("modal-lote-flexivel").style.display = "flex";
}

function fecharModalLoteFlex() {
    document.getElementById("modal-lote-flexivel").style.display = "none";
}

function alternarProgLoteFlex() {
    const prog = document.getElementById("lote-flex-disp").value === "programar";
    document.getElementById("box-lote-flex-pub").style.display = prog ? "block" : "none";
}

function gerarPreviaLote() {
    const inicio = document.getElementById("lote-flex-inicio").value;
    const fim = document.getElementById("lote-flex-fim").value;
    const box = document.getElementById("box-previa-lote");

    if (!inicio || !fim) return avisoPainel("Informe a data inicial e a data final.");
    if (fim < inicio) return avisoPainel("A data final deve ser igual ou posterior a inicial.");

    box.innerHTML = "";
    let dataAtual = inicio;
    let qtd = 0;

    while (dataAtual <= fim) {
        const [ano, mes, dia] = dataAtual.split("-").map(Number);
        const diaSem = new Date(ano, mes - 1, dia).getDay();

        if (diaSem !== 0 && diaSem !== 6) {
            const label = document.createElement("label");
            label.className = "filtro-check lote-data-item";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = dataAtual;
            checkbox.className = "cb-data-previa";

            if (agendaDias.includes(dataAtual)) {
                checkbox.disabled = true;
                checkbox.checked = false;
                label.classList.add("data-existente");
                label.title = "Ja cadastrada na agenda";
            } else {
                checkbox.checked = true;
            }

            const nomesDias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
            const texto = document.createElement("span");
            texto.textContent = `${nomesDias[diaSem]}, ${dataBrISO(dataAtual)}${checkbox.disabled ? " (ja cadastrada)" : ""}`;

            label.appendChild(checkbox);
            label.appendChild(texto);
            box.appendChild(label);
            qtd++;
        }
        dataAtual = somarDiasISO(dataAtual, 1);
    }

    box.style.display = qtd > 0 ? "grid" : "none";
    if (qtd === 0) avisoPainel("Nenhum dia util (segunda a sexta) encontrado neste periodo.");
}

async function salvarLoteFlexivel() {
    if (!exigirAgendaGestaoCarregada()) return;
    const checkboxes = document.querySelectorAll(".cb-data-previa:checked:not(:disabled)");
    const datasSelecionadas = Array.from(checkboxes).map(cb => cb.value);

    if (datasSelecionadas.length === 0) return avisoPainel("Nenhuma data nova foi selecionada.");

    const modo = document.getElementById("lote-flex-disp").value;
    const publicarEm = document.getElementById("lote-flex-pub-data").value;

    if (modo === "programar") {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(publicarEm)) return avisoPainel("Informe a data e hora para liberacao.");
        if (publicarEm <= agoraSaoPauloInput()) return avisoPainel("Escolha uma data/hora futura para publicar.");
    }

    const btn = document.getElementById("btnSalvarLoteFlex");
    btn.disabled = true;
    btn.innerText = "Salvando...";

    try {
        datasSelecionadas.forEach(dataISO => {
            if (!agendaDias.includes(dataISO)) {
                agendaDias.push(dataISO);
                if (modo === "programar") {
                    agendaPublicacaoDatas[dataISO] = publicarEm;
                } else {
                    delete agendaPublicacaoDatas[dataISO];
                }
            }
        });

        agendaDias = ordenarDatas(agendaDias);
        await salvarAgendaGestao(`${datasSelecionadas.length} data(s) adicionada(s) com sucesso.`);
        registrarLog("agenda_adicionar_lote_flexivel", { qtd: datasSelecionadas.length, modo });
        fecharModalLoteFlex();
    } catch (e) {
        avisoPainel("Erro ao salvar multiplas datas.");
        carregarAgendaGestao();
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 2. Salvar Datas Marcadas';
    }
}

async function salvarAvisoNovasVagas() {
    if (!exigirAgendaGestaoCarregada()) return;
    const input = document.getElementById("cfg-data-novas-vagas");
    const data = input.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return avisoPainel("Escolha uma data valida para o aviso.");
    const modo = document.getElementById("cfg-disponibilidade-aviso").value;
    const publicarEm = document.getElementById("cfg-publicar-em-aviso").value;
    const payload = { atualizado: new Date().toISOString() };
    if (modo === "programar") {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(publicarEm)) return avisoPainel("Informe a data e hora para exibir o aviso.");
        if (publicarEm <= agoraSaoPauloInput()) return avisoPainel("Escolha uma data e hora futura para exibir o aviso.");
        payload.avisoNovasVagasProgramado = {
            dataNovasVagas: dataBrISO(data),
            publicarEm
        };
    } else {
        payload.dataNovasVagas = dataBrISO(data);
        payload.avisoNovasVagasProgramado = null;
    }
    try {
        await db.collection("configuracoes").doc("agenda").set(payload, { merge: true });
        avisoPainel(modo === "programar" ? "Aviso de novas vagas programado." : "Aviso de novas vagas atualizado.");
        registrarLog("agenda_salvar_aviso_novas_vagas", {
            dataNovasVagas: dataBrISO(data),
            publicarEm: modo === "programar" ? publicarEm : "agora"
        });
    } catch (e) {
        avisoPainel("Erro ao salvar aviso.");
    }
}

function aguardar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function consultarFirestoreServidorComRetentativa(consulta, tentativas = 3) {
    let ultimoErro = null;
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
        try {
            // Nunca substitui a tela por um snapshot vazio do cache offline.
            return await consulta.get({ source: "server" });
        } catch (e) {
            ultimoErro = e;
            const codigo = String(e && e.code || "");
            if (codigo.includes("permission-denied") || codigo.includes("unauthenticated") || tentativa === tentativas) break;
            await aguardar(350 * (2 ** (tentativa - 1)));
        }
    }
    throw ultimoErro || new Error("Não foi possível consultar o servidor.");
}

function marcarFalhaAtualizacaoLista() {
    const horaAnterior = ultimaAtualizacaoLista
        ? ultimaAtualizacaoLista.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        : "ainda não concluída";
    ["fila-atualizado", "lista-atualizado"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.color = "#b45309";
        el.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Sem conexão; mantendo dados de ${textoSeguro(horaAnterior)}`;
    });
}

async function listarAgendamentos(opcoes = {}) {
    const silencioso = opcoes.silencioso === true;
    const preservarFiltros = opcoes.preservarFiltros === true;
    const corpo = document.getElementById("corpo-tabela");
    const tinhaDadosVisiveis = listaAgendamentosCarregada || agendamentosCache.length > 0;
    if (!silencioso && !tinhaDadosVisiveis) {
        corpo.innerHTML = "<tr><td colspan='6' style='text-align:center;'><i class='fa-solid fa-spinner fa-spin'></i> Carregando...</td></tr>";
        listaAgendamentosCarregada = false;
    }
    configurarPeriodoPadraoLista();
    const inicio = document.getElementById("consulta-inicio").value || ontemISO();
    const fim = document.getElementById("consulta-fim").value || fimPeriodoPadraoISO();
    const info = document.getElementById("info-periodo-lista");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
        avisoPainel("Informe um período válido.");
        return;
    }
    if (fim < inicio) {
        avisoPainel("A data final precisa ser igual ou posterior à data inicial.");
        return;
    }
    const geracao = ++geracaoConsultaAgendamentos;
    carregamentoListaEmAndamento = true;
    try {
        const consulta = db.collection("dados_cidadaos")
            .where("dataISO", ">=", inicio)
            .where("dataISO", "<=", fim)
            .orderBy("dataISO")
            .limit(900);
        const snap = await consultarFirestoreServidorComRetentativa(consulta);
        if (geracao !== geracaoConsultaAgendamentos) return;
        agendamentosCache = snap.docs.map(doc => ({ id: doc.id, dados: doc.data() }));
        origemAgendamentosCache = "lista";
        ordenarAgendamentosCache();
        listaAgendamentosCarregada = true;
        if (!preservarFiltros) {
            filtroRapidoAtual = "";
            marcarFiltroRapidoVisual("");
        }
        if (info) {
            info.textContent = `Carregados ${agendamentosCache.length} agendamentos de ${dataBrISO(inicio)} até ${dataBrISO(fim)}.`
                + (snap.size >= 900 ? " Resultado limitado a 900 registros; reduza o período se faltar algo." : "");
        }
        atualizarResumo();
        renderTabelaAgendamentos();
        marcarAtualizacaoLista();
    } catch (e) {
        console.warn("Erro ao carregar lista", e);
        if (geracao !== geracaoConsultaAgendamentos) return;
        if (await encerrarSessaoPorAcessoRevogado(e)) return;
        marcarFalhaAtualizacaoLista();
        if (tinhaDadosVisiveis) {
            listaAgendamentosCarregada = true;
            atualizarResumo();
            renderTabelaAgendamentos();
            renderFilaHoje();
            if (!silencioso) avisoPainel("Falha de conexão. A lista anterior foi mantida e será atualizada automaticamente.");
        } else {
            corpo.innerHTML = "<tr><td colspan='6' style='text-align:center;'>Sem conexão com o servidor. Tentando novamente...</td></tr>";
            if (!silencioso) avisoPainel("Falha de conexão. Tentaremos novamente automaticamente.");
            setTimeout(() => {
                if (auth.currentUser && !listaAgendamentosCarregada) {
                    listarAgendamentos({ silencioso: true, preservarFiltros: true });
                }
            }, 5000);
        }
    } finally {
        if (geracao === geracaoConsultaAgendamentos) carregamentoListaEmAndamento = false;
    }
}

function marcarIndicadoresHistoricosCarregando() {
    ["ind-total-cin", "ind-total-faltas", "ind-taxa-faltas", "ind-melhor-dia", "ind-media-dia"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "...";
    });
    ["ind-cin-mes-top", "ind-faltas-mes-top", "ind-melhor-dia-data"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "Carregando...";
    });
    const cinMes = document.getElementById("ind-cin-mes");
    const faltasMes = document.getElementById("ind-faltas-mes");
    if (cinMes) cinMes.innerHTML = '<span class="indicador-vazio">Carregando...</span>';
    if (faltasMes) faltasMes.innerHTML = '<span class="indicador-vazio">Carregando...</span>';
}

function marcarIndicadoresHistoricosIndisponiveis() {
    ["ind-total-cin", "ind-total-faltas", "ind-taxa-faltas", "ind-melhor-dia", "ind-media-dia"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "Indisponível";
    });
    ["ind-cin-mes-top", "ind-faltas-mes-top", "ind-melhor-dia-data"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "Histórico indisponível";
    });
    const cinMes = document.getElementById("ind-cin-mes");
    const faltasMes = document.getElementById("ind-faltas-mes");
    if (cinMes) cinMes.innerHTML = '<span class="indicador-vazio">Histórico indisponível. Tente recarregar o painel.</span>';
    if (faltasMes) faltasMes.innerHTML = '<span class="indicador-vazio">Histórico indisponível. Tente recarregar o painel.</span>';
}

function mesLabel(mes) {
    const partes = String(mes || "").split("-").map(Number);
    if (partes.length !== 2 || !partes[0] || !partes[1]) return mes;
    return new Date(partes[0], partes[1] - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "");
}

function contadorPorCampo(lista, obterCampo) {
    return lista.reduce((acc, item) => {
        const chave = obterCampo(item.dados || {});
        if (!chave) return acc;
        acc[chave] = (acc[chave] || 0) + 1;
        return acc;
    }, {});
}

function maiorEntrada(contagem) {
    return Object.entries(contagem).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
}

function renderSerieMensal(id, contagem) {
    const el = document.getElementById(id);
    if (!el) return;
    const entradas = Object.entries(contagem).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
    if (!entradas.length) {
        el.innerHTML = '<span class="indicador-vazio">Sem registros.</span>';
        return;
    }
    const maior = Math.max(...entradas.map(([, total]) => total), 1);
    el.innerHTML = entradas.map(([mes, total]) => `
        <div class="linha-serie">
            <span>${textoSeguro(mesLabel(mes))}</span>
            <div class="barra-serie"><span style="width:${Math.max(6, Math.round((total / maior) * 100))}%"></span></div>
            <strong>${total}</strong>
        </div>
    `).join("");
}

function renderIndicadoresHistoricos() {
    const cin = estatisticasHistoricas.cin;
    const faltas = estatisticasHistoricas.faltas;
    const cinPorMes = contadorPorCampo(cin, d => /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataISO || "")) ? d.dataISO.slice(0, 7) : "");
    const faltasPorMes = contadorPorCampo(faltas, d => /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataISO || "")) ? d.dataISO.slice(0, 7) : "");
    const cinPorDia = contadorPorCampo(cin, d => /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataISO || "")) ? d.dataISO : "");
    const melhorMesCin = maiorEntrada(cinPorMes);
    const piorMesFaltas = maiorEntrada(faltasPorMes);
    const melhorDia = maiorEntrada(cinPorDia);
    const totalBase = cin.length + faltas.length;
    const taxaFaltas = totalBase ? Math.round((faltas.length / totalBase) * 100) : 0;
    const diasComAtendimento = Object.keys(cinPorDia).length;
    const mediaDia = diasComAtendimento ? (cin.length / diasComAtendimento).toFixed(1).replace(".", ",") : "0";

    document.getElementById("ind-total-cin").textContent = cin.length;
    document.getElementById("ind-total-faltas").textContent = faltas.length;
    document.getElementById("ind-taxa-faltas").textContent = `${taxaFaltas}%`;
    document.getElementById("ind-melhor-dia").textContent = melhorDia ? melhorDia[1] : 0;
    document.getElementById("ind-media-dia").textContent = mediaDia;
    document.getElementById("ind-cin-mes-top").textContent = melhorMesCin ? `${mesLabel(melhorMesCin[0])}: ${melhorMesCin[1]}` : "Sem registros";
    document.getElementById("ind-faltas-mes-top").textContent = piorMesFaltas ? `${mesLabel(piorMesFaltas[0])}: ${piorMesFaltas[1]}` : "Sem registros";
    document.getElementById("ind-melhor-dia-data").textContent = melhorDia ? dataBrISO(melhorDia[0]) : "Sem registros";
    renderSerieMensal("ind-cin-mes", cinPorMes);
    renderSerieMensal("ind-faltas-mes", faltasPorMes);
}

// Cache diario dos indicadores historicos. A consulta original lia TODO o historico
// (compareceu + nao_compareceu, que cresce sem limite) a cada login/recarga. Os indicadores
// so usam dataISO, entao guardamos uma versao enxuta no navegador valida pelo dia corrente:
// a varredura completa roda no maximo 1x/dia/navegador, e mudancas de status feitas na sessao
// atualizam o cache na hora (atualizarEstatisticasLocalmente). Indicadores sao de tendencia,
// entao defasagem de ate 1 dia entre dispositivos diferentes e aceitavel.
const STATS_HIST_CACHE_KEY = "statsHistoricas_v1";

function persistirStatsHistoricas() {
    try {
        const enxugar = bucket => (estatisticasHistoricas[bucket] || []).map(ag => ({
            id: ag.id,
            dataISO: (ag.dados && ag.dados.dataISO) || ""
        }));
        localStorage.setItem(STATS_HIST_CACHE_KEY, JSON.stringify({
            dia: hojeISO(),
            cin: enxugar("cin"),
            faltas: enxugar("faltas")
        }));
    } catch (e) { /* localStorage indisponivel: segue sem cache */ }
}

function lerStatsHistoricasCache() {
    try {
        const bruto = localStorage.getItem(STATS_HIST_CACHE_KEY);
        if (!bruto) return null;
        const dados = JSON.parse(bruto);
        if (!dados || dados.dia !== hojeISO() || !Array.isArray(dados.cin) || !Array.isArray(dados.faltas)) return null;
        const hidratar = lista => lista.map(item => ({ id: item.id, dados: { dataISO: item.dataISO || "" } }));
        return { cin: hidratar(dados.cin), faltas: hidratar(dados.faltas) };
    } catch (e) {
        return null;
    }
}

async function carregarTotalAtendimentosRealizados() {
    const historicoAnteriorValido = totalAtendimentosCarregado && !totalAtendimentosIndisponivel;
    totalAtendimentosCarregado = false;
    totalAtendimentosIndisponivel = false;
    document.getElementById("kpi-atendidos").textContent = "...";
    marcarIndicadoresHistoricosCarregando();

    const cache = lerStatsHistoricasCache();
    if (cache) {
        estatisticasHistoricas = cache;
        totalAtendimentosRealizados = estatisticasHistoricas.cin.length;
        totalAtendimentosCarregado = true;
        totalAtendimentosIndisponivel = false;
        renderIndicadoresHistoricos();
        atualizarResumo();
        return;
    }

    try {
        const [cinSnap, faltasSnap] = await Promise.all([
            db.collection("dados_cidadaos").where("status", "==", "compareceu").get(),
            db.collection("dados_cidadaos").where("status", "==", "nao_compareceu").get()
        ]);
        estatisticasHistoricas = {
            cin: cinSnap.docs.map(doc => ({ id: doc.id, dados: doc.data() })),
            faltas: faltasSnap.docs.map(doc => ({ id: doc.id, dados: doc.data() }))
        };
        totalAtendimentosRealizados = estatisticasHistoricas.cin.length;
        totalAtendimentosCarregado = true;
        totalAtendimentosIndisponivel = false;
        persistirStatsHistoricas();
        renderIndicadoresHistoricos();
        atualizarResumo();
    } catch (e) {
        console.warn("Erro ao carregar total historico de atendimentos realizados", e);
        if (await encerrarSessaoPorAcessoRevogado(e)) return;
        if (historicoAnteriorValido) {
            totalAtendimentosRealizados = estatisticasHistoricas.cin.length;
            totalAtendimentosCarregado = true;
            renderIndicadoresHistoricos();
            atualizarResumo();
            return;
        }
        totalAtendimentosRealizados = null;
        totalAtendimentosCarregado = false;
        totalAtendimentosIndisponivel = true;
        atualizarResumo();
        document.getElementById("kpi-atendidos").textContent = "Indisponível";
        marcarIndicadoresHistoricosIndisponiveis();
    }
}

function atualizarEstatisticasLocalmente(id, novoStatus, dadosAtualizados) {
    if (!totalAtendimentosCarregado) return;
    ["cin", "faltas"].forEach(bucket => {
        estatisticasHistoricas[bucket] = estatisticasHistoricas[bucket].filter(ag => ag.id !== id);
    });
    if (novoStatus === "compareceu") {
        estatisticasHistoricas.cin.push({ id, dados: dadosAtualizados });
    } else if (novoStatus === "nao_compareceu") {
        estatisticasHistoricas.faltas.push({ id, dados: dadosAtualizados });
    }
    totalAtendimentosRealizados = estatisticasHistoricas.cin.length;
    persistirStatsHistoricas();
    renderIndicadoresHistoricos();
    atualizarResumo();
}

async function buscarHistoricoAgendamento() {
    const termo = document.getElementById("filtro-busca").value.trim();
    const cpf = cpfNumeros(termo);
    const protocolo = protocoloNormalizado(termo);
    const corpo = document.getElementById("corpo-tabela");
    const info = document.getElementById("info-periodo-lista");
    if (cpf.length !== 11 && protocolo.length < 6) {
        avisoPainel("Digite um CPF completo ou protocolo no campo Buscar.");
        return;
    }
    const geracao = ++geracaoConsultaAgendamentos;
    carregamentoListaEmAndamento = false;
    corpo.innerHTML = "<tr><td colspan='6' style='text-align:center;'><i class='fa-solid fa-spinner fa-spin'></i> Buscando histórico...</td></tr>";
    try {
        const consultas = [];
        if (cpf.length === 11) {
            consultas.push(consultarFirestoreServidorComRetentativa(db.collection("dados_cidadaos").where("cpf", "==", cpfFormatado(cpf)).limit(20)));
            consultas.push(consultarFirestoreServidorComRetentativa(db.collection("dados_cidadaos").where("cpf", "==", cpf).limit(20)));
            consultas.push(consultarFirestoreServidorComRetentativa(db.collection("dados_cidadaos").where("bloqueioCpf", "==", cpf).limit(20)));
        } else {
            consultas.push(consultarFirestoreServidorComRetentativa(db.collection("dados_cidadaos").where("protocolo", "==", protocolo).limit(20)));
        }
        const snaps = await Promise.all(consultas);
        if (geracao !== geracaoConsultaAgendamentos) return;
        agendamentosCache = deduplicarAgendamentos(snaps.flatMap(snap => snap.docs.map(doc => ({ id: doc.id, dados: doc.data() }))));
        origemAgendamentosCache = "historico";
        ordenarAgendamentosCache();
        filtroRapidoAtual = "";
        marcarFiltroRapidoVisual("");
        document.getElementById("filtro-futuros").checked = false;
        if (info) info.textContent = `Busca histórica retornou ${agendamentosCache.length} registro(s) para ${cpf.length === 11 ? cpfFormatado(cpf) : protocolo}.`;
        atualizarResumo();
        renderTabelaAgendamentos();
    } catch (e) {
        console.error("Erro na busca histórica", e);
        if (geracao !== geracaoConsultaAgendamentos) return;
        renderTabelaAgendamentos();
        marcarFalhaAtualizacaoLista();
        avisoPainel("Erro ao buscar histórico.");
    }
}

async function carregarBloqueadosAtivos() {
    const corpo = document.getElementById("corpo-tabela");
    const info = document.getElementById("info-periodo-lista");
    const geracao = ++geracaoConsultaAgendamentos;
    carregamentoListaEmAndamento = false;
    corpo.innerHTML = "<tr><td colspan='6' style='text-align:center;'><i class='fa-solid fa-spinner fa-spin'></i> Carregando bloqueios...</td></tr>";
    try {
        const consulta = db.collection("dados_cidadaos")
            .where("bloqueioAtivo", "==", true)
            .limit(500);
        const snap = await consultarFirestoreServidorComRetentativa(consulta);
        if (geracao !== geracaoConsultaAgendamentos) return;
        agendamentosCache = snap.docs
            .map(doc => ({ id: doc.id, dados: doc.data() }))
            .filter(ag => bloqueioAtivo(ag.dados));
        origemAgendamentosCache = "bloqueados";
        ordenarAgendamentosCache();
        filtroRapidoAtual = "bloqueados";
        document.getElementById("filtro-futuros").checked = false;
        marcarFiltroRapidoVisual("bloqueados");
        if (info) info.textContent = `Carregados ${agendamentosCache.length} CPF(s) com bloqueio ativo.`;
        atualizarResumo();
        renderTabelaAgendamentos();
    } catch (e) {
        console.error("Erro ao carregar bloqueios", e);
        if (geracao !== geracaoConsultaAgendamentos) return;
        renderTabelaAgendamentos();
        marcarFalhaAtualizacaoLista();
        avisoPainel("Erro ao carregar bloqueios.");
    }
}

// Lista independente do periodo carregado: quem foi atendido mas nao conseguiu fazer o RG
// na hora fica aqui ate ser marcado como compareceu (ou outro status) num retorno.
async function carregarRetornosPendentes() {
    const corpo = document.getElementById("corpo-tabela");
    const info = document.getElementById("info-periodo-lista");
    const geracao = ++geracaoConsultaAgendamentos;
    carregamentoListaEmAndamento = false;
    corpo.innerHTML = "<tr><td colspan='6' style='text-align:center;'><i class='fa-solid fa-spinner fa-spin'></i> Carregando lista de retorno...</td></tr>";
    try {
        const consulta = db.collection("dados_cidadaos")
            .where("status", "==", "vai_voltar")
            .limit(500);
        const snap = await consultarFirestoreServidorComRetentativa(consulta);
        if (geracao !== geracaoConsultaAgendamentos) return;
        agendamentosCache = snap.docs.map(doc => ({ id: doc.id, dados: doc.data() }));
        origemAgendamentosCache = "retornos";
        ordenarAgendamentosCache();
        filtroRapidoAtual = "retornos";
        document.getElementById("filtro-data").value = "";
        document.getElementById("filtro-status").value = "";
        document.getElementById("filtro-futuros").checked = false;
        marcarFiltroRapidoVisual("retornos");
        if (info) info.textContent = `${agendamentosCache.length} cidadão(s) marcado(s) para voltar depois.`;
        renderTabelaAgendamentos();
    } catch (e) {
        console.error("Erro ao carregar lista de retorno", e);
        if (geracao !== geracaoConsultaAgendamentos) return;
        renderTabelaAgendamentos();
        marcarFalhaAtualizacaoLista();
        avisoPainel("Erro ao carregar a lista de quem vai voltar depois.");
    }
}

function atualizarResumo() {
    if (!agendaGestaoCarregada || !listaAgendamentosCarregada) return;
    const hoje = hojeISO();
    const amanha = amanhaISO();
    const ativos = agendamentosCache.filter(ag => statusValor(ag.dados) !== "cancelado");
    const totalHoje = ativos.filter(ag => ag.dados.dataISO === hoje).length;
    const totalAmanha = ativos.filter(ag => ag.dados.dataISO === amanha).length;
    const atendimentosRealizados = totalAtendimentosCarregado
        ? totalAtendimentosRealizados
        : (totalAtendimentosIndisponivel ? "Indisponível" : "...");
    // diasAtivos ja filtra apenas datas >= hojeISO(), entao o KPI de vagas restantes ignora datas encerradas.
    const diasAtivos = agendaDias.filter(d => d >= hoje);
    const vagasOcupadasAgenda = ativos.filter(ag => !ag.dados.insercaoManual && diasAtivos.includes(ag.dados.dataISO) && horariosDaData(ag.dados.dataISO).includes(ag.dados.hora)).length;
    const vagasConfiguradas = diasAtivos.reduce((total, data) => total + horariosDaData(data).length, 0);
    const vagasRestantes = Math.max(0, vagasConfiguradas - vagasOcupadasAgenda);
    const lotadas = diasAtivos.filter(data => {
        const horariosDia = horariosDaData(data);
        const ocupadas = ativos.filter(ag => !ag.dados.insercaoManual && ag.dados.dataISO === data && horariosDia.includes(ag.dados.hora)).length;
        return horariosDia.length && ocupadas >= horariosDia.length;
    }).length;
    document.getElementById("kpi-hoje").textContent = totalHoje;
    document.getElementById("kpi-amanha").textContent = totalAmanha;
    document.getElementById("kpi-vagas").textContent = vagasRestantes;
    document.getElementById("kpi-lotadas").textContent = lotadas;
    document.getElementById("kpi-atendidos").textContent = atendimentosRealizados;
    atualizarTituloPainel(totalHoje, ativos.filter(ag => ag.dados.dataISO === hoje && statusValor(ag.dados) === "nao_compareceu").length);
    renderFilaHoje();
}

function atualizarTituloPainel(totalHoje = 0, faltasHoje = 0) {
    document.title = `(${totalHoje} hoje | ${faltasHoje} faltaram) — Recepção CIN`;
}

function horarioMaisProximoHoje(lista) {
    const agora = agoraSaoPauloInput().slice(11, 16);
    return lista
        .filter(ag => ["agendado", "remarcado"].includes(statusValor(ag.dados)) && String(ag.dados.hora || "") >= agora)
        .sort((a, b) => String(a.dados.hora || "").localeCompare(String(b.dados.hora || "")))[0] || null;
}

function acoesStatusDiretas(ag) {
    const status = statusValor(ag.dados);
    const id = textoSeguro(ag.id);
    // Quem esta na lista de retorno so precisa do atalho de conclusao quando voltar.
    if (status === "vai_voltar") {
        return `<button type="button" class="btn-status-direto btn-status-ok" title="Voltou e foi atendido: marcar compareceu" data-acao="alterar-status" data-id="${id}" data-status="compareceu"><i class="fa-solid fa-check"></i></button>`;
    }
    if (!["agendado", "remarcado"].includes(status)) return "";
    return `
        <button type="button" class="btn-status-direto btn-status-ok" title="Marcar compareceu" data-acao="alterar-status" data-id="${id}" data-status="compareceu"><i class="fa-solid fa-check"></i></button>
        <button type="button" class="btn-status-direto btn-status-voltar" title="Marcar que vai voltar depois" data-acao="alterar-status" data-id="${id}" data-status="vai_voltar"><i class="fa-solid fa-arrow-rotate-left"></i></button>
        <button type="button" class="btn-status-direto btn-status-falta" title="Marcar não compareceu" data-acao="alterar-status" data-id="${id}" data-status="nao_compareceu"><i class="fa-solid fa-user-xmark"></i></button>
    `;
}

async function copiarContatoFila(botao) {
    const valor = decodeURIComponent(String(botao && botao.dataset && botao.dataset.copia || ""));
    const rotulo = String(botao && botao.dataset && botao.dataset.rotulo || "Contato");
    if (!valor) return mostrarToast(`${rotulo} não informado.`, "aviso");
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(valor);
        } else {
            const campo = document.createElement("textarea");
            campo.value = valor;
            campo.setAttribute("readonly", "");
            campo.style.position = "fixed";
            campo.style.opacity = "0";
            document.body.appendChild(campo);
            campo.select();
            if (!document.execCommand("copy")) throw new Error("Cópia não suportada");
            campo.remove();
        }
        mostrarToast(`${rotulo} copiado.`);
    } catch (e) {
        mostrarToast(`Não foi possível copiar ${rotulo.toLowerCase()}.`, "erro");
    }
}

function renderFilaHoje() {
    const box = document.getElementById("fila-hoje-cards");
    if (!box) return;
    const busca = String(document.getElementById("busca-fila-hoje").value || "").trim().toLowerCase();
    const listaHoje = agendamentosCache
        .filter(ag => ag.dados.dataISO === hojeISO() && statusValor(ag.dados) !== "cancelado")
        .sort((a, b) => String(a.dados.hora || "").localeCompare(String(b.dados.hora || "")));
    const atendidos = listaHoje.filter(ag => statusValor(ag.dados) === "compareceu").length;
    const faltas = listaHoje.filter(ag => statusValor(ag.dados) === "nao_compareceu").length;
    const retornos = listaHoje.filter(ag => statusValor(ag.dados) === "vai_voltar").length;
    const aguardando = Math.max(0, listaHoje.length - atendidos - faltas - retornos);
    document.getElementById("fila-contagem").textContent =
        `${atendidos} atendido${atendidos === 1 ? "" : "s"} · ${faltas} falta${faltas === 1 ? "" : "s"} · ${retornos} volta${retornos === 1 ? "" : "m"} depois · ${aguardando} aguardando`;
    atualizarCabecalhoFila(listaHoje.length, atendidos, faltas);
    const proximo = horarioMaisProximoHoje(listaHoje);
    const filtrados = busca ? listaHoje.filter(ag => textoBusca(ag).includes(busca)) : listaHoje;
    if (!filtrados.length) {
        box.innerHTML = '<div class="fila-card"><strong>Nenhum agendamento encontrado na fila de hoje.</strong></div>';
        return;
    }
    box.innerHTML = filtrados.map(ag => {
        const d = ag.dados;
        const status = statusValor(d);
        const proximoClass = proximo && proximo.id === ag.id ? " proximo" : "";
        const observacao = d.observacaoInterna
            ? `<i class="fa-solid fa-note-sticky observacao-icone" title="${textoSeguro(d.observacaoInterna)}"></i>`
            : "";
        return `
            <article class="fila-card ${textoSeguro(status)}${proximoClass}" id="fila-ag-${textoSeguro(ag.id)}">
                <div class="fila-card-topo">
                    <span class="fila-hora">${textoSeguro(d.hora || "--:--")}</span>
                    <span class="badge-status st-${textoSeguro(status)}">${textoSeguro(statusLabel(status))}</span>
                </div>
                <div class="fila-nome">${textoSeguro(d.nome)}${observacao}</div>
                <div class="fila-detalhe"><i class="fa-solid fa-id-card"></i> ${textoSeguro(cpfFormatado(d.cpf) || "CPF não informado")}</div>
                <div class="fila-detalhe-linha">
                    <div class="fila-detalhe"><i class="fa-solid fa-phone"></i> ${textoSeguro(d.telefone || "Sem telefone")}</div>
                    ${d.telefone ? `<button type="button" class="btn-copiar-contato" title="Copiar telefone" aria-label="Copiar telefone" data-rotulo="Telefone" data-copia="${encodeURIComponent(String(d.telefone))}" data-acao="copiar-contato"><i class="fa-regular fa-copy"></i></button>` : ""}
                </div>
                ${d.email ? `<div class="fila-detalhe-linha"><div class="fila-detalhe"><i class="fa-solid fa-envelope"></i> ${textoSeguro(d.email)}</div><button type="button" class="btn-copiar-contato" title="Copiar e-mail" aria-label="Copiar e-mail" data-rotulo="E-mail" data-copia="${encodeURIComponent(String(d.email))}" data-acao="copiar-contato"><i class="fa-regular fa-copy"></i></button></div>` : ""}
                <div class="fila-acoes">
                    ${acoesStatusDiretas(ag)}
                    <button type="button" class="btn-status-direto btn-status-obs" title="Observação interna" data-acao="abrirObservacao" data-id="${textoSeguro(ag.id)}"><i class="fa-solid fa-note-sticky"></i></button>
                </div>
            </article>
        `;
    }).join("");
}

// Cinco areas: tres de operacao diaria (hoje/lista/credenciais) e duas de
// uso eventual (config/relatorios). A configuracao saiu da lista para que
// a tela de operacao nao carregue mais dez blocos numa rolagem so.
const VISTAS_PAINEL = ["hoje", "lista", "credenciais", "config", "relatorios"];

function mostrarVistaPainel(vista) {
    vistaPainelAtual = VISTAS_PAINEL.includes(vista) ? vista : "hoje";
    document.getElementById("vista-hoje").classList.toggle("ativo", vistaPainelAtual === "hoje");
    VISTAS_PAINEL.forEach(nome => {
        if (nome === "hoje") return;
        const alvo = document.getElementById("vista-" + nome);
        if (alvo) alvo.style.display = vistaPainelAtual === nome ? "block" : "none";
    });
    VISTAS_PAINEL.forEach(nome => {
        const btn = document.getElementById("btn-vista-" + nome);
        if (!btn) return;
        const ativa = vistaPainelAtual === nome;
        btn.classList.toggle("ativo", ativa);
        btn.setAttribute("aria-selected", ativa ? "true" : "false");
    });
    if (vistaPainelAtual === "hoje") renderFilaHoje();
    if (vistaPainelAtual === "credenciais" && !credenciaisCarregadas) carregarCredenciais();
    if (vistaPainelAtual === "config") atualizarEstadoConfigHub();
    atualizarFaixaEstado();
}

// ---- Configuracao: hub de icones e paineis de detalhe -----------------
const PAINEIS_CONFIG = ["datas", "popup", "automacao", "horarios", "preferencias"];

function abrirConfig(painel) {
    mostrarVistaPainel("config");
    const alvo = PAINEIS_CONFIG.includes(painel) ? painel : "";
    document.getElementById("config-hub").style.display = alvo ? "none" : "block";
    PAINEIS_CONFIG.forEach(nome => {
        const box = document.getElementById("pane-" + nome);
        if (box) box.style.display = nome === alvo ? "block" : "none";
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function voltarConfigHub() {
    abrirConfig("");
    atualizarEstadoConfigHub();
}

function irParaConfiguracaoAgenda() {
    abrirConfig("datas");
}

// Etiquetas de estado nos tiles: leem so o que ja esta carregado na tela,
// sem nenhuma leitura extra no Firestore.
function atualizarEstadoConfigHub() {
    const marcarEstado = (id, texto, classe) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = texto;
        el.className = "cfg-estado " + (classe || "");
    };
    const totalDatas = Array.isArray(agendaDias) ? agendaDias.length : 0;
    marcarEstado("est-datas", totalDatas ? `${totalDatas} data${totalDatas === 1 ? "" : "s"} cadastrada${totalDatas === 1 ? "" : "s"}` : "Nenhuma data cadastrada", totalDatas ? "" : "e-off");

    const autoAtiva = !!(document.getElementById("cfg-auto-ativa") || {}).checked;
    const hora = (document.getElementById("cfg-auto-hora") || {}).value || "08:00";
    marcarEstado("est-automacao", autoAtiva ? `Ativa · segunda ${hora}` : "Desligada", autoAtiva ? "e-on" : "e-off");

    const popAtivo = !!(document.getElementById("popup-ativo") || {}).checked;
    marcarEstado("est-popup", popAtivo ? "Publicado" : "Sem aviso no ar", popAtivo ? "e-on" : "");

    const totalHorarios = Array.isArray(agendaHorarios) ? agendaHorarios.length : 0;
    marcarEstado("est-horarios", totalHorarios ? `${totalHorarios} horários padrão` : "Grade automática", "");

    const responsavel = String((document.getElementById("cfg-responsavel-posto") || {}).value || "").trim();
    marcarEstado("est-preferencias", responsavel || "Sem responsável definido", responsavel ? "" : "e-off");
}

// ---- Faixa de estado no topo -----------------------------------------
// Responde a pergunta que antes exigia descer ate a configuracao:
// o que esta publicado no site agora?
function dataHoraCurta(valorInput) {
    const bruto = String(valorInput || "");
    const m = bruto.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : "";
}

function atualizarFaixaEstado() {
    const faixa = document.getElementById("faixa-estado");
    if (!faixa) return;
    const sinais = [];

    const autoAtiva = !!(document.getElementById("cfg-auto-ativa") || {}).checked;
    const hora = (document.getElementById("cfg-auto-hora") || {}).value || "08:00";
    sinais.push(autoAtiva
        ? `<span class="sinal ok"><i class="dot"></i> Automação semanal <b>ativa</b> · abre segunda às ${textoSeguro(hora)}</span>`
        : `<span class="sinal warn"><i class="dot"></i> Automação semanal <b>desligada</b> · confira o aviso de novas vagas <button type="button" class="sinal-link" data-acao="abrir-config" data-painel="automacao">ajustar</button></span>`);

    const popAtivo = !!(document.getElementById("popup-ativo") || {}).checked;
    if (popAtivo) {
        const fim = dataHoraCurta((document.getElementById("popup-fim") || {}).value);
        sinais.push(`<span class="sinal warn"><i class="dot"></i> Pop-up publicado no site${fim ? " até <b>" + textoSeguro(fim) + "</b>" : ""} <button type="button" class="sinal-link" data-acao="abrir-config" data-painel="popup">ver</button></span>`);
    }

    const vagas = String((document.getElementById("kpi-vagas") || {}).textContent || "0");
    const lotadas = String((document.getElementById("kpi-lotadas") || {}).textContent || "0");
    sinais.push(`<span class="sinal info"><i class="dot"></i> Vagas abertas: <b>${textoSeguro(vagas)}</b>${Number(lotadas) > 0 ? " · " + textoSeguro(lotadas) + " data(s) lotada(s)" : ""}</span>`);

    faixa.innerHTML = sinais.join("");
}

// ---- Controles da tela de agendamentos --------------------------------
function alternarMaisFiltros() {
    const box = document.getElementById("filtros-avancados");
    const btn = document.getElementById("btn-mais-filtros");
    if (!box || !btn) return;
    const abrindo = box.hasAttribute("hidden");
    if (abrindo) box.removeAttribute("hidden"); else box.setAttribute("hidden", "");
    btn.setAttribute("aria-expanded", abrindo ? "true" : "false");
    btn.innerHTML = abrindo
        ? 'Menos filtros <i class="fa-solid fa-chevron-up"></i>'
        : 'Mais filtros <i class="fa-solid fa-chevron-down"></i>';
}

function alternarAcoesDaLista() {
    const lista = document.getElementById("acoes-lista-menu");
    const btn = document.getElementById("btn-acoes-lista");
    if (!lista || !btn) return;
    const abrindo = lista.hasAttribute("hidden");
    if (abrindo) lista.removeAttribute("hidden"); else lista.setAttribute("hidden", "");
    btn.setAttribute("aria-expanded", abrindo ? "true" : "false");
}

function fecharAcoesDaLista() {
    const lista = document.getElementById("acoes-lista-menu");
    const btn = document.getElementById("btn-acoes-lista");
    if (lista && !lista.hasAttribute("hidden")) {
        lista.setAttribute("hidden", "");
        if (btn) btn.setAttribute("aria-expanded", "false");
    }
}

document.addEventListener("keydown", evento => {
    if (evento.key === "Escape") fecharAcoesDaLista();
    if (evento.key !== "/" || evento.ctrlKey || evento.altKey || evento.metaKey) return;
    const foco = document.activeElement;
    if (foco && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName)) return;
    const alvo = vistaPainelAtual === "hoje"
        ? document.getElementById("busca-fila-hoje")
        : document.getElementById("filtro-busca");
    if (alvo && alvo.offsetParent !== null) {
        evento.preventDefault();
        alvo.focus();
    }
});

// ---- Cabecalho da fila de hoje ---------------------------------------
function atualizarCabecalhoFila(total, atendidos, faltas) {
    const titulo = document.getElementById("fila-data-titulo");
    const detalhe = document.getElementById("fila-data-detalhe");
    const barraOk = document.getElementById("fila-barra-ok");
    const barraFalta = document.getElementById("fila-barra-falta");
    const hoje = new Date();
    if (titulo) {
        const texto = hoje.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
        titulo.textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
    }
    if (detalhe) {
        detalhe.textContent = total
            ? `${total} agendamento${total === 1 ? "" : "s"} na agenda de hoje`
            : "Nenhum agendamento para hoje";
    }
    const base = total || 1;
    if (barraOk) barraOk.style.width = `${Math.round((atendidos / base) * 100)}%`;
    if (barraFalta) barraFalta.style.width = `${Math.round((faltas / base) * 100)}%`;
}

function marcarAtualizacaoLista() {
    atualizarFaixaEstado();
    ultimaAtualizacaoLista = new Date();
    const hora = ultimaAtualizacaoLista.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    ["fila-atualizado", "lista-atualizado"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.color = "";
            el.innerHTML = `<i class="fa-solid fa-check"></i> Atualizado às ${textoSeguro(hora)}`;
        }
    });
}

// Refresh automatico leve: re-le apenas hoje/amanha (poucos documentos) e mescla no cache,
// preservando o restante do periodo ja carregado. Antes relia a janela inteira (ate 900 docs)
// a cada ciclo; agora le ~dezenas, reduzindo drasticamente as leituras do Firestore.
async function atualizarDiasVisiveisSilencioso() {
    if (atualizacaoDiasEmAndamento || carregamentoListaEmAndamento) return;
    const inicio = hojeISO();
    const fim = amanhaISO();
    const origemNoInicio = origemAgendamentosCache;
    const geracaoNoInicio = geracaoConsultaAgendamentos;
    atualizacaoDiasEmAndamento = true;
    try {
        const consulta = db.collection("dados_cidadaos")
            .where("dataISO", ">=", inicio)
            .where("dataISO", "<=", fim)
            .orderBy("dataISO")
            .limit(400);
        const snap = await consultarFirestoreServidorComRetentativa(consulta, 2);
        if (origemAgendamentosCache !== origemNoInicio || geracaoConsultaAgendamentos !== geracaoNoInicio) return;
        const novos = snap.docs.map(doc => ({ id: doc.id, dados: doc.data() }));
        const idsNovos = new Set(novos.map(ag => ag.id));
        // Mantem o que esta fora do intervalo recarregado; remove ids reaparecidos (ex.: remarcados
        // para hoje/amanha) e as entradas antigas do proprio intervalo, depois aplica as versoes novas.
        agendamentosCache = agendamentosCache.filter(ag => {
            if (idsNovos.has(ag.id)) return false;
            const data = String(ag.dados.dataISO || "");
            return data < inicio || data > fim;
        }).concat(novos);
        ordenarAgendamentosCache();
        atualizarResumo();
        renderTabelaAgendamentos();
        marcarAtualizacaoLista();
    } catch (e) {
        console.warn("Falha no refresh automatico leve", e);
        marcarFalhaAtualizacaoLista();
    } finally {
        atualizacaoDiasEmAndamento = false;
    }
}

function agendarAtualizacaoAutomatica() {
    clearInterval(timerAtualizacaoAutomatica);
    timerAtualizacaoAutomatica = setInterval(() => {
        const filtroCurto = filtroRapidoAtual === "hoje" || filtroRapidoAtual === "amanha";
        // Nao sobrescreve cache quando o admin esta vendo busca historica ou bloqueados.
        if (origemAgendamentosCache !== "lista") return;
        if (auth.currentUser && (vistaPainelAtual === "hoje" || filtroCurto)) {
            atualizarDiasVisiveisSilencioso();
        }
    }, ATUALIZACAO_AUTOMATICA_MS);
}

function atualizarPainelAoReconectar() {
    if (!auth.currentUser || origemAgendamentosCache !== "lista") return;
    const filtroCurto = filtroRapidoAtual === "hoje" || filtroRapidoAtual === "amanha";
    if (vistaPainelAtual === "hoje" || filtroCurto) {
        atualizarDiasVisiveisSilencioso();
    } else {
        listarAgendamentos({ silencioso: true, preservarFiltros: true });
    }
}

window.addEventListener("online", atualizarPainelAoReconectar);
document.addEventListener("visibilitychange", () => {
    const listaDesatualizada = !ultimaAtualizacaoLista
        || Date.now() - ultimaAtualizacaoLista.getTime() > ATUALIZACAO_AUTOMATICA_MS;
    if (document.visibilityState === "visible" && listaDesatualizada) atualizarPainelAoReconectar();
});

function agendamentosFiltrados() {
    const busca = document.getElementById("filtro-busca").value.trim().toLowerCase();
    const data = document.getElementById("filtro-data").value;
    const status = document.getElementById("filtro-status").value;
    const soFuturos = document.getElementById("filtro-futuros").checked;
    const hoje = hojeISO();
    const fimSemana = semanaFimISO();
    return agendamentosCache.filter(ag => {
        const d = ag.dados;
        const statusAtual = statusValor(d);
        const exibindoCancelados = status === "cancelado" || filtroRapidoAtual === "cancelados";
        if (busca && !textoBusca(ag).includes(busca)) return false;
        // Nos filtros rapidos "hoje" e "amanha", exibindoCancelados permanece false, entao cancelados seguem ocultos.
        if (statusAtual === "cancelado" && !exibindoCancelados) return false;
        if (filtroRapidoAtual === "bloqueados" && !bloqueioAtivo(d)) return false;
        if (filtroRapidoAtual === "retornos" && statusAtual !== "vai_voltar") return false;
        if (filtroRapidoAtual === "manuais" && !d.insercaoManual) return false;
        if (filtroRapidoAtual === "semana" && (d.dataISO < hoje || d.dataISO > fimSemana)) return false;
        if (data && d.dataISO !== data) return false;
        if (status && statusAtual !== status) return false;
        if (soFuturos && d.dataISO < hoje && !["bloqueados", "retornos"].includes(filtroRapidoAtual)) return false;
        return true;
    });
}

function menuAcoes(ag) {
    const id = textoSeguro(ag.id);
    const liberar = bloqueioAtivo(ag.dados)
        ? `<button type="button" data-acao="liberarBloqueio" data-id="${id}"><i class="fa-solid fa-unlock"></i> Liberar bloqueio</button>`
        : "";
    return `
        <div class="acoes-menu-wrap">
            <button type="button" class="btn-pequeno btn-acoes" data-acao="menu-linha" data-id="${id}">
                <i class="fa-solid fa-ellipsis-vertical"></i> Ações
            </button>
            <div class="acoes-menu" id="menu-acoes-${id}">
                <button type="button" data-acao="abrirZapLembrete" data-id="${id}"><i class="fa-brands fa-whatsapp"></i> Enviar lembrete</button>
                <button type="button" data-acao="emitirComprovanteDaLista" data-id="${id}"><i class="fa-solid fa-file-pdf"></i> Gerar comprovante</button>
                <button type="button" data-acao="emitirDeclaracaoComparecimentoDaLista" data-id="${id}"><i class="fa-solid fa-file-signature"></i> Declaracao comparecimento</button>
                <button type="button" data-acao="abrirRemarcacao" data-id="${id}"><i class="fa-solid fa-pen-to-square"></i> Remarcar</button>
                <button type="button" data-acao="abrirObservacao" data-id="${id}"><i class="fa-solid fa-note-sticky"></i> Observação interna</button>
                <button type="button" data-acao="alterar-status" data-id="${id}" data-status="compareceu"><i class="fa-solid fa-check"></i> Marcar compareceu</button>
                <button type="button" data-acao="alterar-status" data-id="${id}" data-status="vai_voltar"><i class="fa-solid fa-arrow-rotate-left"></i> Marcar que vai voltar depois</button>
                <button type="button" data-acao="alterar-status" data-id="${id}" data-status="nao_compareceu"><i class="fa-solid fa-user-xmark"></i> Marcar não compareceu</button>
                ${liberar}
                <button type="button" class="perigo" data-acao="cancelarAgendamentoPainel" data-id="${id}"><i class="fa-solid fa-ban"></i> Cancelar</button>
            </div>
        </div>
    `;
}

// As janelas de comprovante, declaracao e lista do dia sao documentos de
// mesma origem escritos por document.write. Elas herdam o CSP do painel, entao
// nao podem mais trazer <script> nem onclick embutidos: os ouvintes vao daqui.
function prepararJanelaImpressao(janela, opcoes = {}) {
    if (!janela || !janela.document) return;
    const autoImprimir = opcoes.autoImprimir === true;
    let timerAutoImpressao = null;
    const imprimir = janela.document.getElementById("acao-imprimir");
    if (imprimir) imprimir.addEventListener("click", () => {
        if (timerAutoImpressao !== null) {
            janela.clearTimeout(timerAutoImpressao);
            timerAutoImpressao = null;
        }
        janela.print();
    });
    const fechar = janela.document.getElementById("acao-fechar");
    if (fechar) fechar.addEventListener("click", () => janela.close());
    if (autoImprimir) {
        timerAutoImpressao = janela.setTimeout(() => {
            timerAutoImpressao = null;
            janela.print();
        }, 600);
    }
}

function fecharMenusAcoes() {
    document.querySelectorAll(".acoes-menu.aberto").forEach(menu => menu.classList.remove("aberto"));
}

function alternarMenuAcoes(id) {
    const menu = document.getElementById(`menu-acoes-${id}`);
    if (!menu) return;
    const aberto = menu.classList.contains("aberto");
    fecharMenusAcoes();
    if (!aberto) menu.classList.add("aberto");
}


function renderTabelaAgendamentos() {
    const corpo = document.getElementById("corpo-tabela");
    if (filtroRapidoAtual === "bloqueados") {
        renderTabelaBloqueados(corpo);
        return;
    }
    const lista = agendamentosFiltrados();
    corpo.innerHTML = "";
    if (!lista.length) {
        corpo.innerHTML = filtroRapidoAtual === "retornos"
            ? "<tr><td colspan='6'>Ninguém marcado para voltar depois.</td></tr>"
            : "<tr><td colspan='6'>Nenhum agendamento encontrado para os filtros atuais.</td></tr>";
        return;
    }

    const linhas = lista.map(ag => {
        const d = ag.dados;
        const dataBr = dataBrISO(d.dataISO);
        const manual = d.insercaoManual ? '<br><span class="badge-manual">MANUAL</span>' : '';
        const status = statusValor(d);
        const statusOptions = STATUS_ORDEM.map(s => `<option value="${s}" ${s === status ? "selected" : ""}>${statusLabel(s)}</option>`).join("");
        const bloqueado = bloqueioAtivo(d) ? `<span class="bloqueio-badge">Bloqueado até ${textoSeguro(dataBrISO(d.bloqueadoAte))}</span>` : "";
        const bloqueioStatus = bloqueioAtivo(d) ? '<br><span class="bloqueio-badge"><i class="fa-solid fa-lock"></i> Bloqueio aplicado</span>' : "";
        const observacao = d.observacaoInterna ? `<i class="fa-solid fa-note-sticky observacao-icone" title="${textoSeguro(d.observacaoInterna)}"></i>` : "";
        const alteradoPor = d.alteradoPor || d.statusAtualizadoPor || "";
        const statusTitle = alteradoPor ? `Última alteração por ${alteradoPor}${d.statusAtualizadoEm ? ` em ${d.statusAtualizadoEm}` : ""}` : "Sem informação de última alteração";
        return `
            <tr id="row-ag-${textoSeguro(ag.id)}">
                <td data-label="Data/Hora"><strong>${textoSeguro(dataBr)}</strong><br>${textoSeguro(d.hora)}${manual}</td>
                <td data-label="Cidadão" style="font-weight:700;">${textoSeguro(d.nome)}${observacao}<span class="detalhe-pessoal">${textoSeguro(d.protocolo || "sem protocolo")}</span>${bloqueado}</td>
                <td data-label="CPF / Nasc">${textoSeguro(d.cpf || "CPF não informado")}<span class="detalhe-pessoal">${textoSeguro(dataNascBR(d.dataNasc) || "Nascimento não informado")}</span></td>
                <td data-label="Contato">${textoSeguro(d.telefone || "Sem telefone")}<span class="detalhe-pessoal">${textoSeguro(d.email || "")}</span></td>
                <td data-label="Status">
                    <span class="badge-status st-${textoSeguro(status)}" title="${textoSeguro(statusTitle)}">${textoSeguro(statusLabel(status))}</span>${bloqueioStatus}<br>
                    <select class="select-status" data-change="status-select" data-id="${textoSeguro(ag.id)}">
                        ${statusOptions}
                    </select>
                </td>
                <td data-label="Ações"><div class="acoes-linha-rapida">${acoesStatusDiretas(ag)}${menuAcoes(ag)}</div></td>
            </tr>
        `;
    });
    corpo.innerHTML = linhas.join("");
}

function renderTabelaBloqueados(corpo) {
    const lista = agendamentosFiltrados().sort((a, b) => String(a.dados.bloqueadoAte || "").localeCompare(String(b.dados.bloqueadoAte || "")));
    corpo.innerHTML = "";
    if (!lista.length) {
        corpo.innerHTML = "<tr><td colspan='6'>Nenhum CPF bloqueado ativo encontrado.</td></tr>";
        return;
    }
    corpo.innerHTML = lista.map(ag => {
        const d = ag.dados;
        return `
            <tr>
                <td data-label="Data da falta"><strong>${textoSeguro(d.bloqueioDataFalta || dataHoraAtendimento(d))}</strong></td>
                <td data-label="Cidadão" style="font-weight:700;">${textoSeguro(d.bloqueioNome || d.nome)}<span class="bloqueio-badge">Bloqueado até ${textoSeguro(dataBrISO(d.bloqueadoAte))}</span></td>
                <td data-label="CPF">${textoSeguro(d.bloqueioCpf || cpfNumeros(d.cpf) || "CPF não informado")}</td>
                <td data-label="Telefone">${textoSeguro(d.bloqueioTelefone || d.telefone || "Sem telefone")}</td>
                <td data-label="Motivo"><span class="badge-status st-nao_compareceu">${textoSeguro(d.bloqueioMotivo || "Não comparecimento")}</span></td>
                <td data-label="Ações">
                    <div class="acoes-linha">
                        <button type="button" class="btn-pequeno btn-lembrete" data-acao="abrirZapBloqueio" data-id="${textoSeguro(ag.id)}"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
                        <button type="button" class="btn-pequeno btn-atualizar" data-acao="liberarBloqueio" data-id="${textoSeguro(ag.id)}"><i class="fa-solid fa-unlock"></i> Liberar bloqueio</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

function filtroRapidoPainel(tipo) {
    mostrarVistaPainel("lista");
    if (tipo === "bloqueados") {
        carregarBloqueadosAtivos();
        return;
    }
    if (tipo === "retornos") {
        carregarRetornosPendentes();
        return;
    }
    filtroRapidoAtual = tipo;
    document.getElementById("filtro-data").value = "";
    document.getElementById("filtro-status").value = "";
    document.getElementById("filtro-futuros").checked = false;
    if (tipo === "hoje") document.getElementById("filtro-data").value = hojeISO();
    if (tipo === "amanha") document.getElementById("filtro-data").value = amanhaISO();
    if (tipo === "agendados") document.getElementById("filtro-status").value = "agendado";
    if (tipo === "compareceram") document.getElementById("filtro-status").value = "compareceu";
    if (tipo === "faltaram") document.getElementById("filtro-status").value = "nao_compareceu";
    if (tipo === "cancelados") document.getElementById("filtro-status").value = "cancelado";
    marcarFiltroRapidoVisual(tipo);
    renderTabelaAgendamentos();
}

function marcarFiltroRapidoVisual(tipo) {
    // Lia o texto do onclick para descobrir o filtro de cada botao. Sem onclick,
    // getAttribute devolvia null e a excecao derrubava listarAgendamentos antes
    // de renderizar a tabela. O tipo agora vem do mesmo data-tipo que a
    // delegacao usa para chamar filtroRapidoPainel.
    document.querySelectorAll(".filtros-rapidos button").forEach(btn => {
        btn.classList.toggle("ativo", !!tipo && btn.dataset.tipo === tipo);
    });
}

function limparFiltros() {
    filtroRapidoAtual = "";
    document.getElementById("filtro-busca").value = "";
    document.getElementById("filtro-data").value = "";
    document.getElementById("filtro-status").value = "";
    document.getElementById("filtro-futuros").checked = true;
    marcarFiltroRapidoVisual("");
    renderTabelaAgendamentos();
}

function buscarAgendamentoCache(id) {
    return agendamentosCache.find(ag => ag.id === id);
}

function abrirRemarcacao(id) {
    const ag = buscarAgendamentoCache(id);
    if (!ag) return avisoPainel("Agendamento não encontrado.");
    document.getElementById("remarcar-id").value = id;
    document.getElementById("remarcar-nome").value = ag.dados.nome || "";
    document.getElementById("remarcar-data").value = ag.dados.dataISO || "";
    document.getElementById("remarcar-hora").value = ag.dados.hora || "";
    document.getElementById("remarcar-contabiliza").checked = !ag.dados.insercaoManual;
    document.getElementById("modal-remarcar").style.display = "flex";
}

async function salvarRemarcacao() {
    const btn = document.getElementById("btnSalvarRemarcacao");
    const id = document.getElementById("remarcar-id").value;
    const data = document.getElementById("remarcar-data").value;
    const hora = document.getElementById("remarcar-hora").value;
    const contabilizaVaga = document.getElementById("remarcar-contabiliza").checked;
    const ag = buscarAgendamentoCache(id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
        return avisoPainel("Informe data e horário para remarcar.");
    }
    if (!ag) return avisoPainel("Agendamento não encontrado.");
    btn.disabled = true;
    btn.innerText = "Remarcando...";
    try {
        const slotAntigo = ag.dados.slotId || `${ag.dados.dataISO}_${ag.dados.hora}`;
        const novoSlot = `${data}_${hora}`;
        if (contabilizaVaga) {
            const slotDoc = await db.collection("vagas_ocupadas").doc(novoSlot).get();
            if (slotDoc.exists && novoSlot !== slotAntigo) {
                throw new Error("Este horário já está ocupado. Escolha outro horário.");
            }
        }
        if (slotAntigo && slotAntigo !== novoSlot) {
            await db.collection("vagas_ocupadas").doc(slotAntigo).delete().catch(() => {});
        }
        if (contabilizaVaga) {
            await db.collection("vagas_ocupadas").doc(novoSlot).set({
                dataISO: data,
                hora,
                agendamentoId: id,
                origem: "gestaov6_remarcacao",
                atualizadoEm: new Date().toISOString()
            }, { merge: true });
        }

        const atualizacao = {
            dataISO: data,
            hora,
            slotId: contabilizaVaga ? novoSlot : null,
            insercaoManual: !contabilizaVaga,
            status: "remarcado",
            remarcadoEm: new Date().toISOString(),
            remarcadoPor: auth.currentUser ? auth.currentUser.email : "",
            statusAtualizadoEm: new Date().toISOString(),
            statusAtualizadoPor: auth.currentUser ? auth.currentUser.email : "",
            alteradoPor: auth.currentUser ? auth.currentUser.email : ""
        };
        await db.collection("dados_cidadaos").doc(id).set(atualizacao, { merge: true });
        const cpfId = await gerarCpfDocId(ag.dados.cpf);
        if (cpfId) {
            await db.collection("cpfs_agendados").doc(cpfId).set({
                agendamentoId: id,
                dataISO: data,
                hora,
                atualizadoEm: new Date().toISOString()
            }, { merge: true });
        }
        Object.assign(ag.dados, atualizacao);
        fecharRemarcacao();
        await registrarLog("remarcacao_painel", { agendamentoId: id, dataISO: data, hora, contabilizaVaga });
        atualizarResumo();
        renderTabelaAgendamentos();
        renderFilaHoje();
        mostrarToast("Agendamento remarcado.");
    } catch (e) {
        avisoPainel(e.message || "Erro ao remarcar.");
    }
    btn.disabled = false;
    btn.innerText = "Salvar Remarcação";
}

async function tentarGravarBloqueioDedicado(dadosBloqueio) {
    const cpf = dadosBloqueio.bloqueioCpf;
    if (cpf.length !== 11) return;
    try {
        await db.collection("bloqueios_agendamento").doc(cpf).set({
            cpf,
            nome: dadosBloqueio.bloqueioNome,
            telefone: dadosBloqueio.bloqueioTelefone,
            motivo: dadosBloqueio.bloqueioMotivo,
            dataFalta: dadosBloqueio.bloqueioDataFalta,
            bloqueadoAte: dadosBloqueio.bloqueadoAte,
            criadoEm: dadosBloqueio.bloqueioCriadoEm,
            origem: "gestaov6",
            liberado: false
        }, { merge: true });
    } catch (e) {
        console.warn("Bloqueio mantido no cadastro do cidadão; coleção dedicada sem permissão no momento.", e);
    }
}

async function alterarStatus(id, status) {
    if (!STATUS_LABELS[status]) return avisoPainel("Status inválido.");
    if (status === "cancelado") {
        await cancelarAgendamentoPainel(id);
        return;
    }
    const ag = buscarAgendamentoCache(id);
    if (!ag) return avisoPainel("Agendamento não encontrado.");
    if (status === "nao_compareceu" && statusValor(ag.dados) !== "nao_compareceu") {
        const confirmar = await confirmarPainel("Confirmar não comparecimento? Este CPF será bloqueado por 6 meses para novos agendamentos.", { titulo: "Registrar falta", perigo: true, textoConfirmar: "Confirmar falta" });
        if (!confirmar) {
            renderTabelaAgendamentos();
            renderFilaHoje();
            return;
        }
    }
    const agora = new Date().toISOString();
    const atualizacao = {
        status,
        statusAtualizadoEm: agora,
        statusAtualizadoPor: auth.currentUser ? auth.currentUser.email : "",
        alteradoPor: auth.currentUser ? auth.currentUser.email : ""
    };
    let dadosBloqueio = null;
    if (status === "nao_compareceu") {
        dadosBloqueio = criarDadosBloqueio(ag.dados);
        Object.assign(atualizacao, dadosBloqueio);
    }
    try {
        await db.collection("dados_cidadaos").doc(id).set(atualizacao, { merge: true });
        if (dadosBloqueio) await tentarGravarBloqueioDedicado(dadosBloqueio);
        Object.assign(ag.dados, atualizacao);
        await registrarLog("alterar_status", { agendamentoId: id, status, bloqueadoAte: dadosBloqueio ? dadosBloqueio.bloqueadoAte : "" });
        atualizarEstatisticasLocalmente(id, status, ag.dados);
        renderTabelaAgendamentos();
        renderFilaHoje();
        destacarAtendimento(id);
        const mensagem = dadosBloqueio
            ? `${ag.dados.nome} marcado como não compareceu. CPF bloqueado até ${dataBrISO(dadosBloqueio.bloqueadoAte)}.`
            : `${ag.dados.nome} marcado como ${statusLabel(status)}.`;
        mostrarToast(mensagem);
    } catch (e) {
        avisoPainel("Erro ao atualizar status.");
        listarAgendamentos();
    }
}

async function cancelarAgendamentoPainel(id) {
    const ag = buscarAgendamentoCache(id);
    if (!ag) return avisoPainel("Agendamento não encontrado.");
    if (!(await confirmarPainel("Cancelar este agendamento? A vaga será liberada quando houver data e horário vinculados.", { titulo: "Cancelar agendamento", perigo: true, textoConfirmar: "Cancelar agendamento" }))) {
        renderTabelaAgendamentos();
        return;
    }
    const d = ag.dados;
    try {
        const slotId = d.slotId || (d.dataISO && d.hora ? `${d.dataISO}_${d.hora}` : "");
        await db.collection("dados_cidadaos").doc(id).set({
            status: "cancelado",
            canceladoEm: new Date().toISOString(),
            canceladoPor: auth.currentUser ? auth.currentUser.email : "gestaov6",
            statusAtualizadoEm: new Date().toISOString(),
            statusAtualizadoPor: auth.currentUser ? auth.currentUser.email : "",
            alteradoPor: auth.currentUser ? auth.currentUser.email : ""
        }, { merge: true });
        if (slotId && !d.insercaoManual) await db.collection("vagas_ocupadas").doc(slotId).delete().catch(() => {});
        const cpfId = await gerarCpfDocId(d.cpf);
        const cpfLimpo = cpfNumeros(d.cpf);
        if (cpfId) await db.collection("cpfs_agendados").doc(cpfId).delete().catch(() => {});
        if (cpfLimpo && cpfLimpo !== cpfId) await db.collection("cpfs_agendados").doc(cpfLimpo).delete().catch(() => {});
        ag.dados.status = "cancelado";
        await registrarLog("cancelar_agendamento_painel", { agendamentoId: id, dataISO: d.dataISO, hora: d.hora });
        atualizarEstatisticasLocalmente(id, "cancelado", ag.dados);
        renderTabelaAgendamentos();
        renderFilaHoje();
        mostrarToast(`${d.nome} teve o agendamento cancelado.`);
    } catch (e) {
        avisoPainel("Erro ao cancelar agendamento.");
        listarAgendamentos();
    }
}

function credencialTipoLabel(tipo) {
    return tipo === "deficiente" ? "Pessoa com deficiência" : "Idoso";
}

function credencialStatusLabel(status) {
    return ({ ativa: "Em produção", pronta: "Pronta para entrega", entregue: "Entregue" })[status] || "Em produção";
}

function mensagemCredencialPronta(cred) {
    const tipoTexto = cred.tipo === "deficiente" ? "pessoa com deficiência" : "idoso";
    const primeiroNome = String(cred.nome || "").trim().split(/\s+/)[0] || "";
    const saudacao = primeiroNome ? `${primeiroNome}, ` : "";
    return `Olá, ${saudacao}aqui é da Câmara Municipal de Itanhandu. Sua credencial de estacionamento (${tipoTexto}) já está pronta para retirada. Por favor, compareça à Câmara para retirar o documento. Atendimento de segunda a sexta, das 12h às 18h.`;
}

function dataHoraBrTimestamp(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function carregarCredenciais() {
    const corpo = document.getElementById("corpo-credenciais");
    const info = document.getElementById("info-credenciais");
    if (corpo) corpo.innerHTML = "<tr><td colspan='6' style='text-align:center;'><i class='fa-solid fa-spinner fa-spin'></i> Carregando credenciais...</td></tr>";
    try {
        const snap = await db.collection("credenciais_estacionamento").orderBy("criadoEm", "desc").limit(500).get();
        credenciaisCache = snap.docs.map(doc => ({ id: doc.id, dados: doc.data() }));
        credenciaisCarregadas = true;
        if (info) info.textContent = `${credenciaisCache.length} credencial(is) registrada(s) no total.`;
        renderCredenciais();
    } catch (e) {
        console.warn("Erro ao carregar credenciais", e);
        if (corpo) corpo.innerHTML = "<tr><td colspan='6' style='text-align:center;color:#b91c1c;'>Erro ao carregar credenciais. Tente novamente.</td></tr>";
        if (info) info.textContent = "Erro ao carregar credenciais.";
    }
}

function filtroCredenciais(tipo) {
    filtroCredencialAtual = tipo;
    ["ativas", "prontas", "entregues", "todas"].forEach(t => {
        const btn = document.getElementById(`btn-cred-${t}`);
        if (btn) btn.classList.toggle("ativo", t === tipo);
    });
    renderCredenciais();
}

function credenciaisFiltradas() {
    return credenciaisCache.filter(c => {
        const status = c.dados.status || "ativa";
        if (filtroCredencialAtual === "ativas") return status === "ativa";
        if (filtroCredencialAtual === "prontas") return status === "pronta";
        if (filtroCredencialAtual === "entregues") return status === "entregue";
        return true;
    });
}

function renderCredenciais() {
    const corpo = document.getElementById("corpo-credenciais");
    if (!corpo) return;
    const lista = credenciaisFiltradas();
    if (!lista.length) {
        corpo.innerHTML = "<tr><td colspan='6' style='text-align:center;'>Nenhuma credencial neste filtro.</td></tr>";
        return;
    }
    corpo.innerHTML = lista.map(c => {
        const d = c.dados;
        const id = textoSeguro(c.id);
        const status = d.status || "ativa";
        const telFmt = textoSeguro(d.telefone || "");
        const acoes = [];
        if (status === "ativa") {
            acoes.push(`<button type="button" class="btn-pequeno btn-atualizar" data-acao="marcarCredencialPronta" data-id="${id}"><i class="fa-solid fa-check"></i> Marcar pronta</button>`);
        }
        if (status === "pronta") {
            acoes.push(`<button type="button" class="btn-pequeno btn-lembrete" data-acao="abrirZapCredencial" data-id="${id}"><i class="fa-brands fa-whatsapp"></i> Avisar WhatsApp</button>`);
            acoes.push(`<button type="button" class="btn-pequeno btn-atualizar" data-acao="marcarCredencialEntregue" data-id="${id}"><i class="fa-solid fa-handshake"></i> Entregue</button>`);
        }
        if (status === "entregue") {
            acoes.push(`<button type="button" class="btn-pequeno btn-lembrete" data-acao="reabrirCredencial" data-id="${id}"><i class="fa-solid fa-rotate-left"></i> Reabrir</button>`);
        }
        acoes.push(`<button type="button" class="btn-pequeno" style="background:#b91c1c;" data-acao="removerCredencial" data-id="${id}"><i class="fa-solid fa-trash"></i> Remover</button>`);
        return `
            <tr>
                <td data-label="Nome" style="font-weight:700;">${textoSeguro(d.nome || "Sem nome")}</td>
                <td data-label="Tipo">${textoSeguro(credencialTipoLabel(d.tipo))}</td>
                <td data-label="Telefone">${telFmt || "Sem telefone"}</td>
                <td data-label="Cadastrada em">${textoSeguro(dataHoraBrTimestamp(d.criado))}</td>
                <td data-label="Status"><span class="badge-status st-${status === "entregue" ? "compareceu" : (status === "pronta" ? "agendado" : "remarcado")}">${textoSeguro(credencialStatusLabel(status))}</span>${d.avisadoEm ? `<br><small>Aviso enviado em ${textoSeguro(dataHoraBrTimestamp(d.avisadoEm))}</small>` : ""}</td>
                <td data-label="Ações"><div class="acoes-linha-rapida">${acoes.join("")}</div></td>
            </tr>
        `;
    }).join("");
}

async function salvarCredencial() {
    const nome = document.getElementById("cred-nome").value.trim();
    const tipo = document.getElementById("cred-tipo").value;
    const telBruto = document.getElementById("cred-tel").value;
    const telLimpo = String(telBruto).replace(/\D/g, "");
    if (nome.length < 3) return avisoPainel("Informe o nome completo do requerente.");
    if (!["idoso", "deficiente"].includes(tipo)) return avisoPainel("Selecione o tipo da credencial.");
    if (telLimpo.length < 10) return avisoPainel("Informe um telefone válido com DDD.");
    const agora = new Date().toISOString();
    const dados = {
        nome,
        tipo,
        telefone: telBruto,
        telefoneLimpo: telLimpo,
        status: "ativa",
        criado: agora,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        criadoPor: auth.currentUser ? auth.currentUser.email : ""
    };
    try {
        const ref = await db.collection("credenciais_estacionamento").add(dados);
        credenciaisCache.unshift({ id: ref.id, dados: { ...dados, criadoEm: null } });
        document.getElementById("cred-nome").value = "";
        document.getElementById("cred-tel").value = "";
        document.getElementById("cred-tipo").value = "idoso";
        filtroCredencialAtual = "ativas";
        filtroCredenciais("ativas");
        await registrarLog("credencial_cadastrar", { credencialId: ref.id, nome, tipo });
        mostrarToast(`Credencial de ${nome} cadastrada.`);
        const info = document.getElementById("info-credenciais");
        if (info) info.textContent = `${credenciaisCache.length} credencial(is) registrada(s) no total.`;
    } catch (e) {
        console.error("Erro ao salvar credencial", e);
        avisoPainel("Erro ao salvar credencial. Tente novamente.");
    }
}

async function marcarCredencialPronta(id) {
    const cred = credenciaisCache.find(c => c.id === id);
    if (!cred) return;
    try {
        const agora = new Date().toISOString();
        await db.collection("credenciais_estacionamento").doc(id).set({
            status: "pronta",
            prontaEm: agora,
            prontaPor: auth.currentUser ? auth.currentUser.email : ""
        }, { merge: true });
        cred.dados.status = "pronta";
        cred.dados.prontaEm = agora;
        await registrarLog("credencial_pronta", { credencialId: id, nome: cred.dados.nome });
        renderCredenciais();
        mostrarToast(`Credencial de ${cred.dados.nome} marcada como pronta.`);
    } catch (e) {
        console.error("Erro ao marcar como pronta", e);
        avisoPainel("Erro ao marcar como pronta.");
    }
}

async function abrirZapCredencial(id) {
    const cred = credenciaisCache.find(c => c.id === id);
    if (!cred) return;
    const telLimpo = String(cred.dados.telefoneLimpo || cred.dados.telefone || "").replace(/\D/g, "");
    if (telLimpo.length < 10) return avisoPainel("Telefone inválido para WhatsApp.");
    try {
        const agora = new Date().toISOString();
        await db.collection("credenciais_estacionamento").doc(id).set({
            avisadoEm: agora,
            avisadoPor: auth.currentUser ? auth.currentUser.email : ""
        }, { merge: true });
        cred.dados.avisadoEm = agora;
        await registrarLog("credencial_aviso_whatsapp", { credencialId: id, nome: cred.dados.nome });
        renderCredenciais();
    } catch (e) {
        console.warn("Não foi possível registrar o aviso", e);
    }
    window.open(`https://wa.me/55${telLimpo}?text=${encodeURIComponent(mensagemCredencialPronta(cred.dados))}`, "_blank", "noopener,noreferrer");
}

async function marcarCredencialEntregue(id) {
    const cred = credenciaisCache.find(c => c.id === id);
    if (!cred) return;
    if (!(await confirmarPainel(`Confirmar entrega da credencial de ${cred.dados.nome}?`, { titulo: "Entregar credencial", textoConfirmar: "Confirmar entrega" }))) return;
    try {
        const agora = new Date().toISOString();
        await db.collection("credenciais_estacionamento").doc(id).set({
            status: "entregue",
            entregueEm: agora,
            entreguePor: auth.currentUser ? auth.currentUser.email : ""
        }, { merge: true });
        cred.dados.status = "entregue";
        cred.dados.entregueEm = agora;
        await registrarLog("credencial_entregue", { credencialId: id, nome: cred.dados.nome });
        renderCredenciais();
        mostrarToast(`Credencial de ${cred.dados.nome} marcada como entregue.`);
    } catch (e) {
        console.error("Erro ao marcar como entregue", e);
        avisoPainel("Erro ao marcar como entregue.");
    }
}

async function reabrirCredencial(id) {
    const cred = credenciaisCache.find(c => c.id === id);
    if (!cred) return;
    if (!(await confirmarPainel(`Reabrir a credencial de ${cred.dados.nome}? Ela voltará para "Pronta para entrega".`, { titulo: "Reabrir credencial", textoConfirmar: "Reabrir" }))) return;
    try {
        await db.collection("credenciais_estacionamento").doc(id).set({
            status: "pronta",
            entregueEm: firebase.firestore.FieldValue.delete()
        }, { merge: true });
        cred.dados.status = "pronta";
        delete cred.dados.entregueEm;
        await registrarLog("credencial_reabrir", { credencialId: id, nome: cred.dados.nome });
        renderCredenciais();
    } catch (e) {
        console.error("Erro ao reabrir credencial", e);
        avisoPainel("Erro ao reabrir credencial.");
    }
}

async function removerCredencial(id) {
    const cred = credenciaisCache.find(c => c.id === id);
    if (!cred) return;
    if (!(await confirmarPainel(`Remover permanentemente a credencial de ${cred.dados.nome}?`, { titulo: "Remover credencial", perigo: true, textoConfirmar: "Remover" }))) return;
    try {
        await db.collection("credenciais_estacionamento").doc(id).delete();
        credenciaisCache = credenciaisCache.filter(c => c.id !== id);
        await registrarLog("credencial_remover", { credencialId: id, nome: cred.dados.nome });
        renderCredenciais();
        const info = document.getElementById("info-credenciais");
        if (info) info.textContent = `${credenciaisCache.length} credencial(is) registrada(s) no total.`;
        mostrarToast(`Credencial de ${cred.dados.nome} removida.`);
    } catch (e) {
        console.error("Erro ao remover credencial", e);
        avisoPainel("Erro ao remover credencial.");
    }
}

async function abrirZapLembrete(id) {
    const ag = buscarAgendamentoCache(id);
    if (!ag) return;
    const d = ag.dados;
    const telLimpo = cpfNumeros(d.telefone);
    if (telLimpo.length < 10) return avisoPainel("Telefone inválido para WhatsApp.");
    await registrarLog("whatsapp_lembrete", { agendamentoId: id, protocolo: d.protocolo || "", dataISO: d.dataISO, hora: d.hora });
    window.open(`https://wa.me/55${telLimpo}?text=${encodeURIComponent(mensagemLembrete(d))}`, "_blank", "noopener,noreferrer");
}

async function enviarLembretesAmanha() {
    if (!agendamentosCache.length) {
        avisoPainel("Carregue a lista de agendamentos primeiro.");
        return;
    }
    const amanha = amanhaISO();
    const deAmanha = agendamentosCache.filter(ag =>
        ag.dados.dataISO === amanha &&
        statusValor(ag.dados) === "agendado" &&
        ag.dados.telefone &&
        String(ag.dados.telefone).replace(/\D/g,"").length >= 10
    );
    if (!deAmanha.length) {
        avisoPainel("Nenhum agendamento com telefone encontrado para amanhã.");
        return;
    }
    if (!(await confirmarPainel(`Abrir ${deAmanha.length} janela(s) do WhatsApp Web para enviar lembretes de amanhã?`, { titulo: "Lembretes de amanhã", textoConfirmar: "Abrir WhatsApp" }))) return;
    for (let i = 0; i < deAmanha.length; i++) {
        const ag = deAmanha[i];
        const tel = String(ag.dados.telefone).replace(/\D/g,"");
        const msg = mensagemLembrete(ag.dados);
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 1500));
        window.open(`https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
        await registrarLog("lembrete_lote", { agendamentoId: ag.id, protocolo: ag.dados.protocolo || "" });
    }
    avisoPainel(`${deAmanha.length} lembrete(s) aberto(s). Confirme o envio em cada aba do WhatsApp Web.`);
}

async function abrirZapBloqueio(id) {
    const ag = buscarAgendamentoCache(id);
    if (!ag) return;
    const d = ag.dados;
    const telLimpo = cpfNumeros(d.bloqueioTelefone || d.telefone);
    if (telLimpo.length < 10) return avisoPainel("Telefone inválido para WhatsApp.");
    const msg = `Olá, ${d.bloqueioNome || d.nome}! Precisamos falar sobre seu agendamento de RG/CIN na Câmara Municipal de Itanhandu. Por favor, entre em contato com a recepção.`;
    await registrarLog("whatsapp_bloqueio", { agendamentoId: id, cpf: d.bloqueioCpf || cpfNumeros(d.cpf) });
    window.open(`https://wa.me/55${telLimpo}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
}

async function liberarBloqueio(id) {
    const ag = buscarAgendamentoCache(id);
    if (!ag) return avisoPainel("Registro não encontrado.");
    if (!(await confirmarPainel("Tem certeza que deseja liberar este CPF para novo agendamento?", { titulo: "Liberar bloqueio", textoConfirmar: "Liberar CPF" }))) return;
    const cpf = ag.dados.bloqueioCpf || cpfNumeros(ag.dados.cpf);
    const liberacao = {
        bloqueioAtivo: false,
        bloqueioLiberado: true,
        dataLiberacao: new Date().toISOString(),
        usuarioLiberacao: auth.currentUser ? auth.currentUser.email : ""
    };
    try {
        await db.collection("dados_cidadaos").doc(id).set(liberacao, { merge: true });
        if (cpf.length === 11) await db.collection("bloqueios_agendamento").doc(cpf).delete().catch(() => {});
        Object.assign(ag.dados, liberacao);
        await registrarLog("liberar_bloqueio", { agendamentoId: id, cpf });
        renderTabelaAgendamentos();
        renderFilaHoje();
        mostrarToast("Bloqueio liberado.");
    } catch (e) {
        avisoPainel("Erro ao liberar bloqueio.");
    }
}

async function salvarManual() {
    const btn = document.getElementById("btnSalvar");
    if (!validarManual()) return;
    const nome = document.getElementById("m-nome").value.trim(), cpf = document.getElementById("m-cpf").value.trim(), tel = document.getElementById("m-tel").value.trim(), data = document.getElementById("m-data").value, hora = document.getElementById("m-hora").value, nasc = document.getElementById("m-nasc").value.trim();
    
    btn.disabled = true; btn.innerText = "Salvando...";

    try {
        const criarEncaixe = functions.httpsCallable("criarEncaixeManual");
        const resposta = await criarEncaixe({
            nome,
            cpf,
            telefone: tel,
            nascimento: nasc,
            data,
            hora
        });
        const agendamento = resposta.data.agendamento || {};
        const dadosComprovante = {
            nome,
            cpf,
            telefone: tel,
            dataNasc: nasc ? nasc.split("/").reverse().join("-") : "",
            dataISO: agendamento.dataISO || data,
            dataBR: agendamento.dataBR || dataBrISO(data),
            hora: agendamento.hora || hora,
            protocolo: agendamento.protocolo || ""
        };
        avisoPainel(`Encaixe realizado! Protocolo: ${dadosComprovante.protocolo}`);
        await registrarLog("encaixe_manual_painel", { protocolo: dadosComprovante.protocolo, dataISO: data, hora });
        if (await confirmarPainel("Deseja emitir o comprovante em PDF agora?", { titulo: "Comprovante do encaixe", textoConfirmar: "Emitir PDF" })) {
            emitirComprovantePDF(dadosComprovante);
        }
        fecharModal(); listarAgendamentos();
    } catch (e) { avisoPainel(e.message || "Erro ao salvar."); }
    btn.disabled = false; btn.innerText = "Salvar Encaixe";
}

function mascaraCPF(i){ let v=i.value.replace(/\D/g,""); v=v.replace(/(\d{3})(\d)/,"$1.$2"); v=v.replace(/(\d{3})(\d)/,"$1.$2"); i.value=v.replace(/(\d{3})(\d{1,2})$/,"$1-$2"); }
function mascaraData(i){ let v=i.value.replace(/\D/g,""); v=v.replace(/(\d{2})(\d)/,"$1/$2"); i.value=v.replace(/(\d{2})(\d)/,"$1/$2"); }
function mascaraTel(i){ let v=i.value.replace(/\D/g,""); v=v.replace(/^(\d{2})(\d)/g,"($1) $2"); i.value=v.replace(/(\d)(\d{4})$/,"$1-$2"); }
function cpfValido(cpf) {
    const cpfNum = String(cpf || "").replace(/\D/g, "");
    if (cpfNum.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpfNum)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpfNum[i]) * (10 - i);
    let digito1 = 11 - (soma % 11);
    if (digito1 >= 10) digito1 = 0;
    if (parseInt(cpfNum[9]) !== digito1) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpfNum[i]) * (11 - i);
    let digito2 = 11 - (soma % 11);
    if (digito2 >= 10) digito2 = 0;
    return parseInt(cpfNum[10]) === digito2;
}

function marcarErroManual(ids) {
    ["m-data", "m-hora", "m-nome", "m-cpf", "m-nasc", "m-tel"].forEach(id => {
        document.getElementById(id).classList.toggle("erro", ids.includes(id));
    });
}

function validarManual() {
    const campos = [
        { id: "m-data", nome: "data" },
        { id: "m-hora", nome: "hora" },
        { id: "m-nome", nome: "nome" }
    ];
    const faltando = campos.filter(c => !document.getElementById(c.id).value.trim());
    if (faltando.length) {
        marcarErroManual(faltando.map(c => c.id));
        document.getElementById(faltando[0].id).focus();
        avisoPainel("Preencha os campos obrigatórios: " + faltando.map(c => c.nome).join(", ") + ".");
        return false;
    }

    const erros = [];
    const cpfManual = document.getElementById("m-cpf").value.replace(/\D/g, "");
    const nascManual = document.getElementById("m-nasc").value.trim();
    const telManual = document.getElementById("m-tel").value.replace(/\D/g, "");
    if (cpfManual && !cpfValido(cpfManual)) erros.push({ id: "m-cpf", msg: "CPF válido" });
    if (nascManual && !/^\d{2}\/\d{2}\/\d{4}$/.test(nascManual)) erros.push({ id: "m-nasc", msg: "nascimento no formato DD/MM/AAAA" });
    if (telManual && telManual.length < 10) erros.push({ id: "m-tel", msg: "celular/WhatsApp válido" });
    if (erros.length) {
        marcarErroManual(erros.map(e => e.id));
        document.getElementById(erros[0].id).focus();
        avisoPainel("Corrija: " + erros.map(e => e.msg).join(", ") + ".");
        return false;
    }

    marcarErroManual([]);
    return true;
}

function semanaAno(dataISO) {
    const [ano, mes, dia] = String(dataISO || "").split("-").map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (Number.isNaN(data.getTime())) return "";
    const diaSemana = data.getUTCDay() || 7;
    data.setUTCDate(data.getUTCDate() + 4 - diaSemana);
    const inicioAno = new Date(Date.UTC(data.getUTCFullYear(), 0, 1));
    const semana = Math.ceil((((data - inicioAno) / 86400000) + 1) / 7);
    return `${data.getUTCFullYear()}-S${String(semana).padStart(2, "0")}`;
}

function imprimirListaHoje() {
    const lista = agendamentosCache
        .filter(ag => ag.dados.dataISO === hojeISO() && statusValor(ag.dados) !== "cancelado")
        .sort((a, b) => String(a.dados.hora || "").localeCompare(String(b.dados.hora || "")));
    if (!lista.length) return avisoPainel("Nenhum agendamento encontrado para hoje.");
    const janela = window.open("", "_blank");
    if (!janela) return avisoPainel("O navegador bloqueou a janela de impressão. Permita pop-ups para continuar.");
    const linhas = lista.map(ag => {
        const d = ag.dados;
        return `<tr><td>${textoSeguro(d.hora)}</td><td>${textoSeguro(d.nome)}</td><td>${textoSeguro(cpfFormatado(d.cpf))}</td><td>${textoSeguro(statusLabel(statusValor(d)))}</td><td></td></tr>`;
    }).join("");
    janela.document.write(`<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><title>Lista do dia ${textoSeguro(dataBrISO(hojeISO()))}</title><style>
        body{font-family:Arial,sans-serif;color:#111827;margin:28px}h1{font-size:20px;margin:0 0 4px;color:#003d82}p{margin:0 0 18px;color:#475569}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left;font-size:12px}th{background:#eff6ff}td:last-child{width:180px;height:34px}.acoes{margin-top:18px}button{padding:10px 16px;border:0;border-radius:6px;background:#0056b3;color:white;font-weight:700;cursor:pointer}@media print{.acoes{display:none}}
    </style></head><body><h1>Lista de atendimentos CIN</h1><p>${textoSeguro(dataBrISO(hojeISO()))} · ${lista.length} agendamento(s)</p><table><thead><tr><th>Horário</th><th>Cidadão</th><th>CPF</th><th>Status</th><th>Assinatura</th></tr></thead><tbody>${linhas}</tbody></table><div class="acoes"><button id="acao-imprimir">Imprimir / Salvar em PDF</button></div></body></html>`);
    janela.document.close();
    prepararJanelaImpressao(janela, { autoImprimir: false });
    registrarLog("imprimir_lista_dia", { dataISO: hojeISO(), quantidade: lista.length });
}

function exportarExcel() {
    const lista = agendamentosFiltrados();
    let csv = "\uFEFFSemana;Mes;Data;Hora;Status;Protocolo;Nome;CPF;Nascimento;Telefone;Email;Manual;Bloqueado Ate;Alterado Por;Observacao Interna\n";
    lista.forEach(ag => {
        const d = ag.dados;
        csv += [
            semanaAno(d.dataISO),
            String(d.dataISO || "").slice(0, 7),
            dataBrISO(d.dataISO),
            d.hora,
            statusLabel(statusValor(d)),
            d.protocolo || "",
            d.nome,
            d.cpf,
            dataNascBR(d.dataNasc),
            d.telefone,
            d.email || "",
            d.insercaoManual ? "Sim" : "Não",
            d.bloqueadoAte ? dataBrISO(d.bloqueadoAte) : "",
            d.alteradoPor || d.statusAtualizadoPor || "",
            d.observacaoInterna || ""
        ].map(csvCampo).join(";") + "\n";
    });
    const contar = status => lista.filter(ag => statusValor(ag.dados) === status).length;
    csv += `\n${csvCampo("TOTALIZADORES")}\n`;
    csv += `${csvCampo("Total visível")};${lista.length}\n`;
    csv += `${csvCampo("Agendados")};${contar("agendado")}\n`;
    csv += `${csvCampo("Compareceram")};${contar("compareceu")}\n`;
    csv += `${csvCampo("Vão voltar depois")};${contar("vai_voltar")}\n`;
    csv += `${csvCampo("Não compareceram")};${contar("nao_compareceu")}\n`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = "Agendamentos_Filtrados_Recepcao_CIN.csv"; link.click();
    registrarLog("exportar_excel", { quantidade: lista.length });
}


// ---------------------------------------------------------------------------
// Delegacao de cliques
//
// Nenhum elemento do painel carrega onclick embutido: cada botao declara
// data-acao (e os argumentos em data-*), e este ouvinte unico resolve a chave
// contra o registro abaixo. E o que permite tirar 'unsafe-inline' do
// script-src no CSP -- com onclick no atributo, o navegador precisa avaliar
// codigo vindo do HTML.
//
// As funcoes continuam com a assinatura que sempre tiveram; quem converte o
// dataset em argumento e o registro, nao elas.
// ---------------------------------------------------------------------------

const ACOES_CLIQUE = {
    // Sessao e navegacao
    fazerLogin, fazerLogout, alternarTema,
    vista: el => mostrarVistaPainel(el.dataset.vista),

    // Lista de agendamentos
    listarAgendamentos, exportarExcel, imprimirListaHoje, enviarLembretesAmanha,
    buscarHistoricoAgendamento, limparFiltros, alternarMaisFiltros,
    "filtro-rapido": el => filtroRapidoPainel(el.dataset.tipo),
    "acoes-lista": () => alternarAcoesDaLista(),
    "menu-linha": el => alternarMenuAcoes(el.dataset.id),

    // Acoes sobre um agendamento
    "alterar-status": el => alterarStatus(el.dataset.id, el.dataset.status),
    "copiar-contato": el => copiarContatoFila(el),
    abrirObservacao: el => abrirObservacao(el.dataset.id),
    abrirRemarcacao: el => abrirRemarcacao(el.dataset.id),
    abrirZapLembrete: el => abrirZapLembrete(el.dataset.id),
    abrirZapBloqueio: el => abrirZapBloqueio(el.dataset.id),
    liberarBloqueio: el => liberarBloqueio(el.dataset.id),
    cancelarAgendamentoPainel: el => cancelarAgendamentoPainel(el.dataset.id),
    emitirComprovanteDaLista: el => emitirComprovanteDaLista(el.dataset.id),
    emitirDeclaracaoComparecimentoDaLista: el => emitirDeclaracaoComparecimentoDaLista(el.dataset.id),

    // Encaixe manual, remarcacao e observacao
    abrirModal, fecharModal, salvarManual,
    fecharRemarcacao, salvarRemarcacao,
    fecharObservacao, salvarObservacao,
    confirmacao: el => resolverConfirmacao(el.dataset.valor === "true"),
    resetarTimerInatividade,

    // Credenciais de estacionamento
    carregarCredenciais, salvarCredencial,
    "filtro-credenciais": el => filtroCredenciais(el.dataset.tipo),
    marcarCredencialPronta: el => marcarCredencialPronta(el.dataset.id),
    marcarCredencialEntregue: el => marcarCredencialEntregue(el.dataset.id),
    abrirZapCredencial: el => abrirZapCredencial(el.dataset.id),
    reabrirCredencial: el => reabrirCredencial(el.dataset.id),
    removerCredencial: el => removerCredencial(el.dataset.id),

    // Configuracao
    irParaConfiguracaoAgenda, voltarConfigHub,
    "abrir-config": el => abrirConfig(el.dataset.painel),
    carregarAgendaGestao, adicionarDataAgenda, abrirModalLoteFlex,
    fecharModalLoteFlex, gerarPreviaLote, salvarLoteFlexivel,
    salvarAvisoNovasVagas, salvarAvisoPopup, desativarAvisoPopup,
    salvarAutomacaoSemanal, salvarHorariosSemana, salvarPreferenciasOperacionais,
    adicionarSemanaPausada, adicionarDataBloqueada, adicionarPeriodoBloqueado,
    removerSemanaPausada: el => removerSemanaPausada(Number(el.dataset.indice)),
    removerDataBloqueada: el => removerDataBloqueada(Number(el.dataset.indice)),
    removerPeriodoBloqueado: el => removerPeriodoBloqueado(Number(el.dataset.indice)),
    personalizarDiaSemana: el => personalizarDiaSemana(Number(el.dataset.dia)),
    adicionarHorarioSemana: el => adicionarHorarioSemana(Number(el.dataset.dia)),
    voltarDiaSemanaAoAutomatico: el => voltarDiaSemanaAoAutomatico(Number(el.dataset.dia)),
    removerHorarioSemana: el => removerHorarioSemana(Number(el.dataset.dia), el.dataset.hora),

    // Relatorios
    carregarLogsAdmin
};

// Campos de formulario seguem a mesma regra: data-input e data-change em vez
// de oninput/onchange embutidos. As duas chaves saem do mesmo registro porque
// a mesma acao aparece nos dois eventos, conforme o tipo do campo.
const ACOES_CAMPO = {
    renderFilaHoje, renderTabelaAgendamentos, atualizarPreviaAvisoPopup,
    alternarProgramacaoData, alternarProgramacaoAviso, alternarProgLoteFlex,
    mascaraCPF: el => mascaraCPF(el),
    mascaraTel: el => mascaraTel(el),
    mascaraData: el => mascaraData(el),
    "status-select": el => alterarStatus(el.dataset.id, el.value)
};

function despacharCampo(evento, atributo) {
    const alvo = evento.target instanceof Element ? evento.target : null;
    const campo = alvo ? alvo.closest(`[data-${atributo}]`) : null;
    if (!campo) return;
    const executar = ACOES_CAMPO[campo.dataset[atributo]];
    if (typeof executar !== "function") {
        console.warn("Acao de campo desconhecida:", campo.dataset[atributo]);
        return;
    }
    executar(campo, evento);
}

document.addEventListener("input", evento => despacharCampo(evento, "input"));
document.addEventListener("change", evento => despacharCampo(evento, "change"));

document.addEventListener("click", evento => {
    const alvo = evento.target instanceof Element ? evento.target : null;
    const gatilho = alvo ? alvo.closest("[data-acao]") : null;
    const acao = gatilho ? gatilho.dataset.acao : "";

    // Fecha os menus abertos, menos quando o clique foi no proprio gatilho do
    // menu. Antes isso vinha de event.stopPropagation() no onclick; agora a
    // ordem e explicita, o que tambem evita depender da ordem de registro dos
    // ouvintes.
    if (acao !== "menu-linha") fecharMenusAcoes();
    if (acao !== "acoes-lista") fecharAcoesDaLista();

    if (!gatilho) return;
    if (ACOES_MUTACAO_AGENDA.has(acao) && !exigirAgendaGestaoCarregada()) return;
    const executar = ACOES_CLIQUE[acao];
    if (typeof executar !== "function") {
        console.warn("Acao de clique desconhecida:", acao);
        return;
    }
    executar(gatilho, evento);
});
