import { limparMarkdown } from "./util.mjs";

function falha(arquivo, regra) {
  throw new Error(`${arquivo}: campo corpo: ${regra}`);
}

export function extrairFaq(markdown, arquivo = "conteudo") {
  const linhas = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const inicio = linhas.findIndex((linha) => linha === "## Perguntas frequentes");
  if (inicio === -1) return { corpo: linhas.join("\n"), faq: [] };

  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i++) {
    if (/^##\s+/.test(linhas[i]) || linhas[i] === "---") {
      fim = i;
      break;
    }
  }

  const trecho = linhas.slice(inicio + 1, fim);
  const faq = [];
  let atual = null;
  for (const linha of trecho) {
    const pergunta = /^\*\*(.+?\?)\*\*$/.exec(linha);
    if (pergunta) {
      if (atual) faq.push(atual);
      atual = { pergunta: limparMarkdown(pergunta[1]), linhas: [] };
    } else if (atual) {
      atual.linhas.push(linha);
    }
  }
  if (atual) faq.push(atual);

  if (faq.length < 3 || faq.length > 6) {
    falha(arquivo, "a seção 'Perguntas frequentes' precisa ter de 3 a 6 perguntas válidas em negrito terminadas por ?");
  }
  for (const item of faq) {
    item.markdown = item.linhas.join("\n").trim();
    item.resposta = limparMarkdown(item.markdown);
    delete item.linhas;
    if (!item.resposta) falha(arquivo, `a pergunta '${item.pergunta}' precisa de resposta`);
  }

  return {
    corpo: [...linhas.slice(0, inicio), ...linhas.slice(fim)].join("\n").trim(),
    faq
  };
}
