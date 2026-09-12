"use strict";

// Ajustes de tela pequena e acessibilidade do site do cidadao, mais as duas
// animacoes que rodavam sem parar durante a espera pela abertura.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");

function extrairFuncao(codigo, nome) {
  const marcador = `function ${nome}(`;
  const inicio = codigo.indexOf(marcador);
  assert.notEqual(inicio, -1, `Funcao ${nome} nao encontrada.`);
  const inicioCompleto = codigo.slice(Math.max(0, inicio - 6), inicio) === "async " ? inicio - 6 : inicio;
  const abre = codigo.indexOf("{", codigo.indexOf(")", inicio));
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") nivel++;
    if (codigo[i] === "}") {
      nivel--;
      if (nivel === 0) return codigo.slice(inicioCompleto, i + 1);
    }
  }
  throw new Error(`Fim da funcao ${nome} nao encontrado.`);
}

function blocoMedia(condicao) {
  const marcador = `@media ${condicao} {`;
  const inicio = sitePublico.indexOf(marcador);
  assert.notEqual(inicio, -1, `Media query ${condicao} nao encontrada.`);
  const abre = sitePublico.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < sitePublico.length; i++) {
    if (sitePublico[i] === "{") nivel++;
    if (sitePublico[i] === "}") {
      nivel--;
      if (nivel === 0) return sitePublico.slice(inicio, i + 1);
    }
  }
  throw new Error(`Fim da media query ${condicao} nao encontrado.`);
}

// ---------------------------------------------------------------------------
// Modal em tela estreita
// ---------------------------------------------------------------------------

test("botoes do modal nao dependem de caber lado a lado no celular", () => {
  // Dois rotulos longos estouravam a caixa em 320px: conteudo de 227px numa
  // area util de 216px.
  assert.match(sitePublico, /\.modal-botoes \{[^}]*flex-wrap: wrap;/);

  const estreito = blocoMedia("(max-width: 520px)");
  // Empilhar e a garantia; a quebra sozinha deixava o resultado no limite.
  assert.match(estreito, /\.modal-botoes \{ flex-direction: column; \}/);
  assert.match(estreito, /\.modal-btn \{ padding: 14px 18px;/);
  assert.match(estreito, /\.modal-caixa \{ padding: 28px 20px/);
});

// ---------------------------------------------------------------------------
// Nome acessivel das abas
// ---------------------------------------------------------------------------

test("o topo mantem somente o caminho acessivel para novo agendamento", () => {
  // Consultar e Cancelar agora ficam apenas nos cards de servicos. O rotulo do
  // unico controle do topo continua visivel ate nas telas estreitas.
  assert.doesNotMatch(blocoMedia("(max-width: 400px)"), /\.aba-texto \{ display: none; \}/);
  const abas = sitePublico.match(/<button class="aba[^"]*" id="aba-[\w-]+"[^>]*>/g) || [];
  assert.equal(abas.length, 1);
  assert.match(abas[0], /id="aba-novo"/);
  assert.doesNotMatch(sitePublico, /id="aba-(?:consultar|cancelar)"/);
  for (const aba of abas) {
    assert.match(aba, /aria-label="[^"]+"/, `aba sem aria-label: ${aba}`);
    assert.match(aba, /aria-pressed="(true|false)"/, `aba sem aria-pressed: ${aba}`);
    assert.match(aba, /type="button"/);
  }
  // Exatamente uma comeca pressionada.
  assert.equal(abas.filter((a) => /aria-pressed="true"/.test(a)).length, 1);

  // O icone e decorativo: o nome vem do aria-label.
  const marcacaoAbas = sitePublico.slice(sitePublico.indexOf('<div class="abas">'));
  const icones = marcacaoAbas.slice(0, marcacaoAbas.indexOf("</div>")).match(/<i class="fa-solid[^>]*>/g) || [];
  assert.equal(icones.length, 1);
  for (const icone of icones) assert.match(icone, /aria-hidden="true"/);

  // A simplificacao do topo nao pode remover os dois caminhos pelos cards.
  const cardConsultar = sitePublico.match(/<button class="servico-card servico-consultar"[^>]*>/)?.[0] || "";
  const cardCancelar = sitePublico.match(/<button class="servico-card servico-cancelar"[^>]*>/)?.[0] || "";
  assert.match(cardConsultar, /onclick="abrirAbaConsultar\(\)"/);
  assert.match(cardCancelar, /onclick="abrirAbaCancelar\(\)"/);
});

test("mudarAba mantem o aria-pressed coerente", () => {
  const mudar = extrairFuncao(sitePublico, "mudarAba");
  assert.match(mudar, /a\.setAttribute\('aria-pressed', 'false'\)/);
  assert.match(mudar, /btn\.setAttribute\('aria-pressed', 'true'\)/);
  // Limpa todas antes de marcar a escolhida.
  assert.ok(
    mudar.indexOf("'aria-pressed', 'false'") < mudar.indexOf("'aria-pressed', 'true'"),
    "o reset precisa vir antes de marcar a aba ativa."
  );
});

// ---------------------------------------------------------------------------
// Alvos de toque
// ---------------------------------------------------------------------------

test("controles tocaveis declaram ao menos 44px de altura", () => {
  // A grade de servicos substituiu os dois atalhos do topo e usa um alvo ainda
  // maior. .btn-alterar e .acao-atualizar-agenda so existem em estados que a
  // varredura inicial nao alcancou (formulario aberto e banner de erro).
  const alvos = [
    /\.servico-card \{[^}]*min-height: 96px;/,
    /\.aba \{[^}]*min-height: 44px;/,
    /\.modal-btn \{[^}]*min-height: 44px;/,
    /\.btn-alterar \{[^}]*min-height: 44px;/,
    /\.acao-atualizar-agenda \{[^}]*min-height: 44px;/
  ];
  for (const alvo of alvos) assert.match(sitePublico, alvo);

  // touch-action evita o atraso de 300ms e o zoom por duplo toque.
  assert.match(sitePublico, /\.servico-card \{[^}]*touch-action: manipulation;/);

  // Os controles e os destinos programaticos das transicoes mantem foco visivel.
  assert.match(sitePublico, /\.btn-principal:focus-visible,[\s\S]*?outline: 3px solid #0f172a;/);
  for (const id of ["titulo-escolher-dia", "titulo-escolher-horario", "resumo-confirmacao", "titulo-sucesso"]) {
    assert.match(sitePublico, new RegExp(`id="${id}"[^>]*tabindex="-1"`));
  }
  assert.match(extrairFuncao(sitePublico, "mostrarTelaDados"), /focarConteudo\("inp-nome"\)/);
  assert.match(extrairFuncao(sitePublico, "avancarParaDatas"), /focarConteudo\("titulo-escolher-dia"\)/);
  assert.match(extrairFuncao(sitePublico, "selecionarHorarioEConfirmar"), /focarConteudo\("resumo-confirmacao"\)/);

  // Branco sobre #047857 = 5,48:1; o antigo #10b981 dava apenas 2,54:1.
  const luminancia = (hex) => {
    const canais = hex.match(/[0-9a-f]{2}/gi).map((parte) => parseInt(parte, 16) / 255)
      .map((valor) => valor <= 0.04045 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4);
    return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
  };
  const contrasteComBranco = 1.05 / (luminancia("047857") + 0.05);
  assert.ok(contrasteComBranco >= 4.5, `contraste insuficiente: ${contrasteComBranco.toFixed(2)}:1`);
  assert.match(sitePublico, /\.btn-hora\.primeiro-livre \{[^}]*background: #047857;[^}]*color: white;/);
});

// ---------------------------------------------------------------------------
// Animacoes
// ---------------------------------------------------------------------------

test("a barra de carregamento anima transform, nao left", () => {
  const keyframes = sitePublico.match(/@keyframes loading-anim \{[^}]*\}[^}]*\}/);
  assert.ok(keyframes, "keyframes loading-anim nao encontrado.");
  // Animar left forcava layout a cada quadro, e a barra roda durante toda a
  // janela de "Liberando vagas".
  assert.match(keyframes[0], /transform: translateX\(-100%\)/);
  assert.match(keyframes[0], /transform: translateX\(314\.3%\)/);
  assert.equal(/left:\s*-?\d/.test(keyframes[0]), false, "loading-anim nao pode mais animar left.");
});

test("quem pede menos movimento nao recebe animacao infinita", () => {
  const reduzido = blocoMedia("(prefers-reduced-motion: reduce)");
  for (const seletor of [".loading-bar", ".skeleton-card", ".skeleton-hora", ".confetti-piece", ".ripple-wave"]) {
    assert.ok(reduzido.includes(seletor), `${seletor} deveria estar coberto por prefers-reduced-motion.`);
  }
  assert.match(reduzido, /animation: none !important;/);
});

test("confete e ripple nem chegam a ser criados com movimento reduzido", () => {
  // So o CSS nao basta: os dois elementos sao removidos no evento animationend,
  // e com animation: none esse evento nunca dispara. Ficariam para sempre no
  // DOM — 90 divs fixas no caso do confete.
  assert.match(sitePublico, /el\.addEventListener\('animationend', \(\) => el\.remove\(\)\)/);
  assert.match(sitePublico, /r\.addEventListener\('animationend', \(\) => r\.remove\(\)\)/);

  const reduzido = extrairFuncao(sitePublico, "movimentoReduzido");
  assert.match(reduzido, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  // Navegador sem matchMedia nao pode quebrar a tela de sucesso.
  assert.match(reduzido, /typeof window\.matchMedia === "function"/);

  const confete = extrairFuncao(sitePublico, "dispararConfete");
  assert.match(confete, /^\s*function dispararConfete\(\) \{\s*\n\s*if \(movimentoReduzido\(\)\) return;/);
  const ripple = extrairFuncao(sitePublico, "inicializarRipple");
  assert.match(ripple, /if \(movimentoReduzido\(\)\) return;/);
});

// ---------------------------------------------------------------------------
// Semantica de dialogo
// ---------------------------------------------------------------------------

test("o modal se anuncia como dialogo e recebe o foco", () => {
  assert.match(
    sitePublico,
    /<div class="modal-caixa" role="dialog" aria-modal="true" aria-labelledby="modal-titulo" aria-describedby="modal-mensagem" tabindex="-1">/
  );
  // O icone e decorativo e nao deve ser lido antes do titulo.
  assert.match(sitePublico, /<div id="modal-icone" class="modal-icone" aria-hidden="true">/);

  const abrir = extrairFuncao(sitePublico, "modal");
  // Guarda o foco anterior antes de abrir, e so na primeira abertura.
  assert.match(abrir, /if \(!modalEstaAberto\(\)\) focoAntesDoModal = document\.activeElement;/);
  // Leva o foco para o primeiro botao.
  assert.match(abrir, /cont\.querySelector\("\.modal-btn"\)/);
  assert.match(abrir, /primeiro\.focus\(\)/);

  const esconder = extrairFuncao(sitePublico, "esconderModalGlobal");
  assert.match(esconder, /anterior\.focus\(\)/);
  // Nao tenta focar um elemento que saiu da pagina.
  assert.match(esconder, /document\.contains\(anterior\)/);

  // Fechar pelos botoes tambem devolve o foco.
  assert.match(abrir, /esconderModalGlobal\(\);/);

  // Tab e Shift+Tab ficam dentro do dialogo; assim o teclado nao alcanca um
  // controle da pagina capaz de substituir uma confirmacao ainda pendente.
  assert.match(sitePublico, /e\.key !== "Tab"/);
  assert.match(sitePublico, /dialogo\.querySelectorAll\("\.modal-btn:not\(\[disabled\]\)"\)/);
  assert.match(sitePublico, /ultimo\.focus\(\)/);
  assert.match(sitePublico, /primeiro\.focus\(\)/);
  assert.match(abrir, /const dispensarAnterior = modalEstaAberto\(\) \? modalOnDismiss : null;/);
  assert.match(abrir, /dispensarAnterior\(\);/);
});

test("Escape usa o caminho de dispensa, sem escolher acao pelo usuario", () => {
  // Ja existia um unico tratador de Escape: ele chama fecharModalGlobal, que
  // dispara o onDismiss em vez de acionar um dos botoes. E o comportamento
  // certo para um modal de confirmacao, e nao pode ser duplicado.
  const tratadores = sitePublico.split("\n").filter((linha) => /e\.key === "Escape"|e\.key !== "Escape"/.test(linha));
  assert.equal(tratadores.length, 1, `Escape deveria ter um unico tratador: ${tratadores.join(" | ")}`);
  assert.match(sitePublico, /if \(e\.key === "Escape" && !modalGlobal\.classList\.contains\("oculto"\)\) fecharModalGlobal\(\);/);

  // E fecharModalGlobal precisa devolver o foco, senao Escape deixa o foco solto.
  const fechar = extrairFuncao(sitePublico, "fecharModalGlobal");
  assert.match(fechar, /esconderModalGlobal\(\);/);
});

// ---------------------------------------------------------------------------
// Contador regressivo
// ---------------------------------------------------------------------------

test("o tique do contador nao reconstroi o bloco inteiro", () => {
  const contador = extrairFuncao(sitePublico, "iniciarContadorRegressivo");
  const atualizar = extrairFuncao(contador, "atualizar");
  const montar = extrairFuncao(contador, "montarBlocos");

  // innerHTML so na montagem; o tique de 1s nao pode tocar nele.
  assert.match(montar, /el\.innerHTML =/);
  assert.equal(atualizar.includes("innerHTML"), false, "o tique nao pode reconstruir o innerHTML.");
  assert.match(atualizar, /escreverUnidade\('seg', s\)/);
  // Remonta apenas quando o bloco de dias entra/sai ou o container foi trocado.
  assert.match(atualizar, /mostrandoDias !== comDias \|\| !campos \|\| !campos\.seg \|\| !el\.contains\(campos\.seg\)/);
});

test("escreverUnidade so toca no DOM quando o valor muda", () => {
  function campoEspiao(valorInicial) {
    const estado = { valor: valorInicial, escritas: 0 };
    return {
      estado,
      campo: {
        get textContent() { return estado.valor; },
        set textContent(v) { estado.escritas++; estado.valor = v; }
      }
    };
  }

  const seg = campoEspiao("07");
  const horas = campoEspiao("03");
  const campos = { seg: seg.campo, horas: horas.campo };
  const escreverUnidade = new Function(
    "campos",
    `${extrairFuncao(extrairFuncao(sitePublico, "iniciarContadorRegressivo"), "escreverUnidade")}; return escreverUnidade;`
  )(campos);

  escreverUnidade("seg", 7);       // mesmo valor apos padStart
  assert.equal(seg.estado.escritas, 0);
  escreverUnidade("seg", 8);
  assert.equal(seg.estado.escritas, 1);
  assert.equal(seg.estado.valor, "08");

  // Horas ficam paradas durante 3600 tiques seguidos.
  for (let i = 0; i < 10; i++) escreverUnidade("horas", 3);
  assert.equal(horas.estado.escritas, 0);

  // Unidade ausente (bloco de dias escondido) nao quebra.
  assert.doesNotThrow(() => escreverUnidade("dias", 2));
});
