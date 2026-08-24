"use strict";

// Travas dos achados da auditoria independente de 24/08/2026, feita depois de
// as mudancas do dia ja estarem em producao. Cada teste aqui corresponde a um
// defeito confirmado por leitura de codigo e por consulta a producao.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const sitePublico = fs.readFileSync(path.join(raiz, "public", "index.html"), "utf8");
const desligar = fs.readFileSync(path.join(raiz, "scripts", "preaquecer-desligar.ps1"), "utf8");

// --- Achado 4: pre-aquecimento da automacao apontava para a regiao removida ---

test("a URL de pre-aquecimento deriva da regiao, nunca de literal", () => {
  // Apos mover carregarAgendaPublicaHttp para southamerica-east1, esta URL
  // continuou em us-central1 e passou a responder 404. A falha era silenciosa:
  // so gravava leituraPreaquecida=false e a funcao terminava normal, entao os
  // aquecimentos de 07:50/07:55/07:59 pareciam saudaveis no Scheduler.
  const linha = backend.split("\n").find((l) => l.includes("cloudfunctions.net"));
  assert.ok(linha, "URL de pre-aquecimento nao encontrada.");
  assert.match(linha, /\$\{REGIAO_PICO\}-\$\{projectId\}/, "A regiao precisa vir de REGIAO_PICO.");
  assert.doesNotMatch(linha, /us-central1|southamerica-east1/, "Regiao fixa no texto volta a divergir na proxima migracao.");
});

// Remove comentario de linha SEM engolir o "//" de "https://". A versao
// anterior usava backend.replace(/\/\/[^\n]*/g, "") e apagava a linha da URL
// inteira: a trava ficava VAZIA e passava mesmo com us-central1 fixo no codigo.
// Apontado por auditoria e verificado -- injetar uma URL literal nao reprovava.
function semComentariosDeLinha(codigo) {
  return codigo.split("\n").map((linha) => {
    const i = linha.indexOf("//");
    if (i === -1) return linha;
    if (i > 0 && linha[i - 1] === ":") return linha; // "https://", "http://"
    return linha.slice(0, i);
  }).join("\n");
}

test("nenhuma URL de funcao fica com regiao fixa no backend", () => {
  const semComentarios = semComentariosDeLinha(backend);
  assert.doesNotMatch(
    semComentarios,
    /https:\/\/[a-z0-9-]+-\$\{projectId\}\.cloudfunctions\.net/,
    "Regiao literal em URL de funcao: e exatamente o que quebrou o pre-aquecimento."
  );
});

// --- Achado 7: chave de rate limit aceitava grafias diferentes do mesmo CPF ---

const digitosCpf = new Function(`${backend.slice(
  backend.indexOf("function digitosCpf("),
  backend.indexOf("}", backend.indexOf("function digitosCpf(")) + 1
)}; return digitosCpf;`)();

test("grafias diferentes do mesmo CPF caem no mesmo balde", () => {
  const esperado = "52998224725";
  for (const grafia of ["52998224725", "529.982.247-25", "a52998224725", " 529 982 247 25 ", "529982247-25"]) {
    assert.equal(digitosCpf(grafia), esperado, `"${grafia}" deveria normalizar para o mesmo balde.`);
  }
  assert.equal(digitosCpf(null), "");
  assert.equal(digitosCpf(undefined), "");
});

test("consulta e cancelamento usam a chave normalizada", () => {
  // Com o texto cru, o limite de 6 preparacoes de cancelamento por 10 min era
  // contornavel so mudando a pontuacao -- e cada tentativa cai no bypass de
  // agendamento legado sem protocolo.
  for (const acao of ["consultar_agendamento", "preparar_cancelamento"]) {
    const i = backend.indexOf(`"${acao}"`);
    assert.notEqual(i, -1, `${acao} nao encontrada.`);
    const chamada = backend.slice(i, backend.indexOf(";", i));
    assert.match(chamada, /digitosCpf\(/, `${acao} deve agrupar pelo CPF normalizado.`);
    assert.doesNotMatch(chamada, /String\(request\.data && request\.data\.cpf/, `${acao} voltou ao texto cru.`);
  }
});

// --- Achado 6: a repeticao de App Check compunha ate quatro POSTs ---

test("chamarFuncao marca o erro quando ja gastou a propria repeticao", () => {
  const i = sitePublico.indexOf("async function chamarFuncao(");
  const corpo = sitePublico.slice(i, sitePublico.indexOf("\n    }", i));
  assert.match(corpo, /appCheckJaRepetido = true/, "Sem a marca, quem chama nao sabe que a repeticao ja aconteceu.");
});

test("o laco de criacao respeita a marca em vez de repetir de novo", () => {
  // chamarFuncao ja faz 2 POSTs. Sem esta guarda o laco externo renovava o
  // token e chamava outra vez: ate 4 POSTs e 4 renovacoes por acao do cidadao
  // justamente quando o App Check ja esta sofrendo.
  const i = sitePublico.indexOf('if (codigo === "unauthenticated" || codigo === "permission-denied") {');
  assert.notEqual(i, -1, "Ramo de App Check do laco de criacao nao encontrado.");
  const ramo = sitePublico.slice(i, sitePublico.indexOf("}", sitePublico.indexOf("continue;", i)));
  assert.match(ramo, /appCheckJaRepetido\) break/, "O laco precisa parar quando a repeticao ja foi gasta.");
  assert.ok(
    ramo.indexOf("appCheckJaRepetido") < ramo.indexOf("tentarRefreshAppCheck"),
    "A guarda tem de vir ANTES de renovar o token, senao a renovacao extra acontece do mesmo jeito."
  );
});

// --- Achado 8: o desligar podia declarar sucesso sem ter conferido ---

test("a conferencia checa o codigo de saida, nao so o texto", () => {
  // No desligar o valor esperado e string VAZIA. Um describe que falha tambem
  // devolve vazio, entao sem checar o codigo o script imprimia "PRONTO" sem
  // ter conferido nada.
  const i = desligar.indexOf('"run","services","describe"');
  assert.notEqual(i, -1, "Consulta de estado nao encontrada.");
  const trecho = desligar.slice(Math.max(0, i - 400), i + 400);
  assert.match(trecho, /\$consulta\.Codigo -ne 0/, "Falha na consulta precisa contar como problema.");
  assert.match(trecho, /\$problemas\+\+/, "Falha na consulta precisa incrementar o contador de problemas.");
});

// --- Documentacao nao pode reensinar a regiao antiga ---

test("nenhum documento manda chamar as funcoes do pico em us-central1", () => {
  for (const doc of ["tests/load/README.md", "docs/RUNBOOK-homologacao.md"]) {
    const texto = fs.readFileSync(path.join(raiz, doc), "utf8");
    assert.doesNotMatch(
      texto,
      /us-central1-[\w-]*\.cloudfunctions\.net\/(criarAgendamentoCidadao|carregarAgendaPublicaHttp|verificarDisponibilidadeSlotCidadao)/,
      `${doc} ainda aponta o caminho critico para us-central1.`
    );
  }
});

// --- Rodada 2 da auditoria ---

test("a trava de URL literal nao e vazia: uma URL fixa injetada reprova", () => {
  // A versao anterior desta trava passava com us-central1 fixo no codigo,
  // porque a remocao de comentarios engolia o "//" de "https://". Aqui a
  // propria trava e exercitada contra um defeito plantado.
  const comDefeito = backend + "\nconst x = `https://us-central1-${projectId}.cloudfunctions.net/qualquer`;\n";
  assert.match(
    semComentariosDeLinha(comDefeito),
    /https:\/\/[a-z0-9-]+-\$\{projectId\}\.cloudfunctions\.net/,
    "A trava precisa enxergar uma URL literal; se nao enxerga, nao protege nada."
  );
  // E continua ignorando o que esta de fato em comentario.
  const soComentario = 'const a = 1; // https://us-central1-${projectId}.cloudfunctions.net/x';
  assert.doesNotMatch(
    semComentariosDeLinha(soComentario),
    /https:\/\/[a-z0-9-]+-\$\{projectId\}\.cloudfunctions\.net/
  );
});

const telefonesConferem = new Function(
  [
    backend.slice(backend.indexOf("function digitosTelefone("), backend.indexOf("}", backend.indexOf("function digitosTelefone(")) + 1),
    backend.slice(backend.indexOf("function telefoneCanonico("), backend.indexOf("\n}", backend.indexOf("function telefoneCanonico(")) + 2),
    backend.slice(backend.indexOf("function telefonesConferem("), backend.indexOf("\n}", backend.indexOf("function telefonesConferem(")) + 2),
    "return telefonesConferem;"
  ].join("\n")
)();

test("o mesmo celular com e sem o nono digito confere", () => {
  // Desde que o telefone virou fator de acesso, essa diferenca tranca o
  // titular. Producao tem hoje 1 agendamento ativo gravado com 10 digitos e
  // 39 com 11: a pessoa dos 10 digita naturalmente a forma atual.
  assert.equal(telefonesConferem("(35) 99999-1234", "(35) 9999-1234"), true, "11 informado, 10 gravado");
  assert.equal(telefonesConferem("(35) 9999-1234", "(35) 99999-1234"), true, "10 informado, 11 gravado");
  assert.equal(telefonesConferem("+55 35 99999-1234", "35999991234"), true, "com codigo do pais");
  assert.equal(telefonesConferem("035 99999-1234", "35999991234"), true, "DDD com zero na frente");
});

test("a tolerancia do nono digito nao aproxima numeros diferentes", () => {
  assert.equal(telefonesConferem("(35) 99999-1234", "(35) 99999-4321"), false, "assinante diferente");
  assert.equal(telefonesConferem("(35) 99999-1234", "(31) 99999-1234"), false, "DDD diferente");
  assert.equal(telefonesConferem("(35) 3361-1234", "(35) 93361-1234"), false, "fixo nao ganha nono digito");
  assert.equal(telefonesConferem("", "35999991234"), false);
  assert.equal(telefonesConferem("123", "35999991234"), false);
});

// --- Achado P2: User-Agent separava baldes de rate limit ---

test("consulta e cancelamento tem teto que a rotacao de User-Agent nao contorna", () => {
  // O limite por SHA256(ip|user-agent|cpf) continua, porque e o User-Agent que
  // espalha a carga no pico: atras de um CGNAT, celulares do mesmo modelo
  // cairiam no mesmo documento e disputariam a transacao. O que faltava era um
  // teto que a rotacao do cabecalho nao reiniciasse.
  for (const acao of ["consultar_agendamento", "preparar_cancelamento"]) {
    const i = backend.indexOf(`"${acao}_origem"`);
    assert.notEqual(i, -1, `${acao} precisa de teto por origem.`);
    const chamada = backend.slice(backend.lastIndexOf("await", i), backend.indexOf(";", i));
    assert.match(chamada, /aplicarRateLimitOrigem/, `${acao}_origem deve usar o fingerprint sem User-Agent.`);
    assert.match(chamada, /digitosCpf\(/, "O teto por origem tambem agrupa pelo CPF normalizado.");
  }
});

test("o fingerprint de origem realmente ignora o User-Agent", () => {
  const corpo = backend.slice(
    backend.indexOf("function fingerprintOrigemRequisicao("),
    backend.indexOf("\n}", backend.indexOf("function fingerprintOrigemRequisicao(")) + 2
  );
  assert.doesNotMatch(corpo, /user-agent|userAgent/i, "Se o User-Agent entrar aqui, o teto some.");
  assert.match(corpo, /ipOrigemConfiavel\(request\)/, "O IP tem de vir da fonte que ignora prefixos do cliente.");
});

test("o caminho quente do pico mantem o User-Agent, de proposito", () => {
  // criar_agendamento e verificar_bloqueio_cpf sao caminho quente de verdade.
  // Tirar o User-Agent deles concentraria a contencao no pico -- e o problema
  // que o proprio projeto documenta em agenda-cache-publica.js.
  for (const acao of ["criar_agendamento", "verificar_bloqueio_cpf"]) {
    const i = backend.indexOf(`"${acao}"`);
    const chamada = backend.slice(backend.lastIndexOf("await", i), backend.indexOf(";", i));
    assert.match(chamada, /aplicarRateLimit\(/, `${acao} deve seguir no limite com User-Agent.`);
    assert.doesNotMatch(chamada, /aplicarRateLimitOrigem/, `${acao} nao deve trocar de mecanismo perto da abertura.`);
  }
});

// --- Aviso obsoleto quando a automacao e desligada ---

test("o painel avisa que desativar a automacao nao limpa o aviso programado", () => {
  // A automacao nao distingue aviso automatico obsoleto de aviso programado a
  // mao -- os dois gravam o mesmo campo. Ate existir marcador de origem, a
  // protecao e o alerta ao lado do proprio controle.
  const painel = fs.readFileSync(path.join(raiz, "public", "recepcao.html"), "utf8");
  const i = painel.indexOf('id="cfg-auto-ativa"');
  assert.notEqual(i, -1, "Controle da automacao nao encontrado.");
  const bloco = painel.slice(i, i + 1200);
  assert.match(bloco, /desativar a automação/i, "O alerta precisa estar junto do controle que desliga.");
  assert.match(bloco, /aviso de novas vagas/i);
});
