"use strict";

// Scripts de pre-aquecimento.
//
// Em 24/08/2026 o preaquecer-ligar.ps1 nao funcionava: fazia `firebase deploy`
// so para mudar minInstances, e o deploy abortava por falta de
// functions/node_modules. O pre-aquecimento acabou sendo feito na mao, com o
// minimo de SERVICO do Cloud Run -- aplicado sem build e sem criar revisao
// nova. Os scripts passaram a usar esse mesmo caminho.
//
// Na mesma data o caminho critico mudou para southamerica-east1. Um script
// apontando para us-central1 falharia reclamando de servico inexistente, as
// 07:00 de uma segunda-feira, com o pico correndo frio. Estas travas existem
// para esse erro ser pego aqui e nao la.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const ligar = fs.readFileSync(path.join(raiz, "scripts", "preaquecer-ligar.ps1"), "utf8");
const desligar = fs.readFileSync(path.join(raiz, "scripts", "preaquecer-desligar.ps1"), "utf8");
const scripts = { "preaquecer-ligar.ps1": ligar, "preaquecer-desligar.ps1": desligar };

const REGIAO_BACKEND = (backend.match(/const REGIAO_PICO = "([\w-]+)"/) || [])[1];

test("a regiao dos scripts acompanha a do backend", () => {
  assert.ok(REGIAO_BACKEND, "REGIAO_PICO nao encontrada no backend.");
  for (const [nome, texto] of Object.entries(scripts)) {
    const regiao = (texto.match(/\$regiao\s*=\s*"([\w-]+)"/) || [])[1];
    assert.equal(
      regiao,
      REGIAO_BACKEND,
      `${nome} aponta para ${regiao}, mas o caminho critico vive em ${REGIAO_BACKEND}.`
    );
  }
});

test("os scripts cobrem exatamente as tres funcoes do caminho critico", () => {
  // Os nomes de servico do Cloud Run sao a versao minuscula do nome da funcao.
  const esperados = ["criarAgendamentoCidadao", "carregarAgendaPublicaHttp", "verificarDisponibilidadeSlotCidadao"]
    .map((n) => n.toLowerCase()).sort();
  for (const [nome, texto] of Object.entries(scripts)) {
    const bloco = texto.slice(texto.indexOf("$servicos"), texto.indexOf(")", texto.indexOf("$servicos")));
    const encontrados = [...bloco.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(encontrados, esperados, `${nome} nao cobre as tres funcoes do pico.`);
  }
});

// Os comentarios dos scripts explicam POR QUE nao se usa firebase deploy, e
// citam o comando. A trava tem de olhar o codigo executavel, nao a prosa.
function semComentarios(texto) {
  return texto.split("\n").filter((linha) => !/^\s*#/.test(linha)).join("\n");
}

test("os scripts nao voltaram a usar firebase deploy", () => {
  for (const [nome, texto] of Object.entries(scripts)) {
    const codigo = semComentarios(texto);
    assert.doesNotMatch(
      codigo,
      /firebase(\.cmd)?\s+deploy|firebase-tools@[\d.]+\s+deploy/,
      `${nome} voltou ao deploy completo: reconstroi conteiner e cria revisao nova as vesperas do pico.`
    );
    // Os argumentos viajam em array por Invoke-Gcloud, entao a trava olha o
    // verbo e nao a linha de comando literal.
    assert.match(codigo, /& gcloud @Argumentos/, `${nome} deveria chamar o gcloud.`);
    assert.match(codigo, /"run","services","update"/, `${nome} deveria usar o minimo de servico do Cloud Run.`);
  }
});

test("ligar pede 1 instancia e desligar volta ao padrao", () => {
  assert.match(ligar, /--min=1\b/);
  assert.doesNotMatch(ligar, /--min=default/);
  assert.match(desligar, /--min=default/);
  assert.doesNotMatch(desligar, /--min=1\b/);
});

test("os dois conferem o resultado em vez de confiar no comando", () => {
  // Foi assim que se descobriu, na abertura de 24/08, que o painel do Firebase
  // mostrava 0 enquanto o Cloud Run ja estava em 1: quem manda e o describe.
  for (const [nome, texto] of Object.entries(scripts)) {
    const codigo = semComentarios(texto);
    assert.match(codigo, /"run","services","describe"/, `${nome} precisa conferir o estado real.`);
    assert.match(codigo, /run\.googleapis\.com\/minScale/, `${nome} deve ler a anotacao de minimo do servico.`);
    assert.match(codigo, /throw /, `${nome} precisa falhar alto quando a conferencia nao bate.`);
  }
});

test("o backend avisa que a env var deixou de ser o caminho do pre-aquecimento", () => {
  const trecho = backend.slice(
    backend.indexOf("PICO_MIN_INSTANCES") - 800,
    backend.indexOf("const PICO_MIN_INSTANCES")
  );
  assert.match(trecho, /scripts\/preaquecer/, "O comentario deve apontar para o caminho que de fato funciona.");
});

test("os scripts nao mesclam stderr de comando nativo no fluxo de sucesso", () => {
  // PowerShell 5.1: "2>&1" num executavel nativo transforma CADA linha de
  // stderr num ErrorRecord e, com $ErrorActionPreference = "Stop", a primeira
  // vira excecao. O gcloud escreve "Updating..." em stderr como progresso
  // normal -- a primeira versao destes scripts morria no primeiro servico por
  // causa disso, e so apareceria as 07:00 de uma segunda-feira.
  for (const [nome, texto] of Object.entries(scripts)) {
    const codigo = semComentarios(texto);
    assert.doesNotMatch(codigo, /2>&1/, `${nome} mescla stderr no fluxo de sucesso.`);
    assert.match(codigo, /\$ErrorActionPreference = "Continue"/,
      `${nome} deve baixar a guarda ao redor da chamada nativa e decidir pelo codigo de saida.`);
    assert.match(codigo, /\$LASTEXITCODE/, `${nome} precisa checar o codigo de saida do gcloud.`);
  }
});
