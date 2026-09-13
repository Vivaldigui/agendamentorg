"use strict";

// Textos de apoio ao cidadao ajustados antes da abertura de 14/09/2026, a partir
// da auditoria de usabilidade: contraste da ajuda dos campos, caminho para quem
// perdeu o codigo do comprovante, pergunta "Perdi o horario" e a ordem do fluxo
// ensinada no Guia da CIN.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), "utf8");
const sitePublico = ler("public", "index.html");
const duvidas = ler("public", "duvidas.html");

function luminancia(hex) {
  const [r, g, b] = hex.replace("#", "").match(/../g).map((canal) => {
    const v = parseInt(canal, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(corA, corB) {
  const [clara, escura] = [luminancia(corA), luminancia(corB)].sort((x, y) => y - x);
  return (clara + 0.05) / (escura + 0.05);
}

test("a ajuda dos campos tem contraste AA sobre branco", () => {
  // Estava em --gray-400 (#94a3b8): 2,56:1, abaixo do minimo para texto pequeno.
  const regra = /\.ajuda-campo \{ color: var\(--([\w-]+)\);/.exec(sitePublico);
  assert.ok(regra, "regra .ajuda-campo nao encontrada.");
  const token = new RegExp(`--${regra[1]}: (#[0-9a-fA-F]{6});`).exec(sitePublico);
  assert.ok(token, `token --${regra[1]} nao encontrado.`);
  const valor = contraste(token[1], "#ffffff");
  assert.ok(valor >= 4.5, `contraste ${valor.toFixed(2)}:1; o minimo para texto pequeno e 4,5:1.`);
});

test("quem perdeu o codigo encontra o WhatsApp da Camara nos dois formularios", () => {
  for (const id of ["cons-fator", "cancelar-fator"]) {
    const grupo = new RegExp(
      `<input id="${id}"[^>]*/>\\s*<p class="ajuda-campo ajuda-codigo-perdido">([\\s\\S]*?)</p>`
    ).exec(sitePublico);
    assert.ok(grupo, `${id}: orientacao para codigo perdido ausente logo apos o campo.`);
    assert.match(grupo[1], /Perdeu o código\?/);
    assert.match(grupo[1], /href="https:\/\/wa\.me\/553535040397"/);
    assert.match(grupo[1], /rel="noopener noreferrer"/);
  }
  // O link fica dentro de texto pequeno: sem altura minima, vira alvo de toque
  // dificil justamente para quem tem menos pratica com o celular.
  assert.match(sitePublico, /\.ajuda-codigo-perdido a \{[^}]*min-height: 44px;/);
});

test("Perdi o horario orienta pelo WhatsApp e avisa do bloqueio, igual no texto e no schema", () => {
  const visivel = /<summary>Perdi o horário\. O que faço\?<\/summary>\s*<div class="resposta">([\s\S]*?)<\/div>/.exec(duvidas);
  assert.ok(visivel, "resposta visivel nao encontrada.");
  const textoVisivel = visivel[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

  const bloco = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(duvidas);
  assert.ok(bloco, "JSON-LD ausente.");
  const schema = JSON.parse(bloco[1]);
  const faq = [schema, ...(schema["@graph"] || [])].find((item) => item["@type"] === "FAQPage");
  assert.ok(faq, "FAQPage ausente.");
  const pergunta = faq.mainEntity.find((item) => item.name === "Perdi o horário. O que faço?");
  assert.ok(pergunta, "pergunta ausente no schema.");

  assert.equal(pergunta.acceptedAnswer.text, textoVisivel, "o schema precisa repetir exatamente o texto visivel.");
  assert.match(textoVisivel, /\(35\) 3504-0397/);
  assert.match(textoVisivel, /6 meses/);
});

test("o Guia ensina a ordem atual do fluxo: dados, dia e horario, confirmacao", () => {
  const guia = ler("editorial", "conteudo", "guia", "como-agendar.md");
  const secao = /## Passo a passo pelo celular\s+([\s\S]*?)\n## /.exec(guia);
  assert.ok(secao, "secao de passo a passo nao encontrada.");
  const texto = secao[1];
  const posicao = (trecho) => {
    const indice = texto.indexOf(trecho);
    assert.notEqual(indice, -1, `trecho ausente no passo a passo: ${trecho}`);
    return indice;
  };
  const dados = posicao("preencha os dados");
  const continuar = posicao("Continuar para escolher o dia");
  const confirmar = posicao("Confirmar agendamento");
  assert.ok(dados < continuar && continuar < confirmar, "a ordem ensinada precisa ser dados, Continuar e Confirmar.");
  assert.doesNotMatch(texto, /Escolha a data e o horário que estiverem disponíveis\. Preencha o formulário/);
});
