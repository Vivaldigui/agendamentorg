// Contador de visitas do site publico. Um aviso curto por pagina aberta para
// /api/visita (functions/visitas.js). Nao usa cookie e nao envia nada que
// identifique a pessoa: so o caminho da pagina e duas marcas, "primeira visita
// do aparelho hoje" e "primeira visita hoje a esta secao", guardadas aqui
// mesmo em localStorage.
//
// O envio espera a pagina terminar de carregar e ficar visivel (aba aberta em
// segundo plano ou pre-carregada so conta quando alguem olha). Navegador
// automatizado e o painel da recepcao no mesmo aparelho nao contam.
(function () {
    "use strict";

    var CHAVE_MARCA = "cin_visita";
    var CHAVE_NAO_CONTAR = "cin_nao_contar_visita";
    var ESPERA_MS = 1500;

    function armazenamento() {
        try {
            var teste = "__cin_teste__";
            window.localStorage.setItem(teste, teste);
            window.localStorage.removeItem(teste);
            return window.localStorage;
        } catch (e) {
            return null;
        }
    }

    function diaSaoPaulo() {
        try {
            // en-CA formata como AAAA-MM-DD.
            return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
        } catch (e) {
            return new Date().toISOString().slice(0, 10);
        }
    }

    function secaoDe(caminho) {
        if (caminho === "/" || caminho === "/index.html") return "agendamento";
        if (caminho.indexOf("/blog/") === 0) return "blog";
        if (caminho.indexOf("/cin/") === 0) return "guia";
        return "outros";
    }

    function lerMarca(local, dia) {
        if (!local) return null;
        try {
            var marca = JSON.parse(local.getItem(CHAVE_MARCA) || "null");
            if (marca && marca.d === dia && Object.prototype.toString.call(marca.s) === "[object Array]") return marca;
        } catch (e) { /* marca corrompida conta como dia novo */ }
        return null;
    }

    function enviar() {
        var local = armazenamento();
        if (local && local.getItem(CHAVE_NAO_CONTAR) === "1") return;

        var caminho = window.location.pathname || "/";
        var secao = secaoDe(caminho);
        var dia = diaSaoPaulo();
        var marca = lerMarca(local, dia);
        var novoVisitante = !marca;
        var novaSecao = novoVisitante || marca.s.indexOf(secao) === -1;
        // Sem localStorage nao ha como saber se ja contou: conta so a pagina.
        if (!local) { novoVisitante = false; novaSecao = false; }

        var corpo = JSON.stringify({ p: caminho, n: novoVisitante ? 1 : 0, s: novaSecao ? 1 : 0 });
        var enviado = false;
        try {
            if (navigator.sendBeacon) enviado = navigator.sendBeacon("/api/visita", corpo);
        } catch (e) { enviado = false; }
        if (!enviado && window.fetch) {
            try {
                window.fetch("/api/visita", { method: "POST", body: corpo, keepalive: true, credentials: "omit", headers: { "Content-Type": "text/plain" } })
                    .catch(function () {});
                enviado = true;
            } catch (e) { enviado = false; }
        }
        if (!enviado || !local) return;

        var secoes = marca ? marca.s : [];
        if (secoes.indexOf(secao) === -1) secoes.push(secao);
        try { local.setItem(CHAVE_MARCA, JSON.stringify({ d: dia, s: secoes })); } catch (e) { /* sem espaco */ }
    }

    function agendar() {
        if (navigator.webdriver) return;
        if (/bot|crawl|spider|slurp|headless|lighthouse/i.test(navigator.userAgent || "")) return;
        var feito = false;
        function quandoVisivel() {
            if (feito || document.visibilityState === "hidden" || document.visibilityState === "prerender") return;
            feito = true;
            document.removeEventListener("visibilitychange", quandoVisivel);
            setTimeout(enviar, ESPERA_MS);
        }
        document.addEventListener("visibilitychange", quandoVisivel);
        quandoVisivel();
    }

    if (document.readyState === "complete") agendar();
    else window.addEventListener("load", agendar);
})();
