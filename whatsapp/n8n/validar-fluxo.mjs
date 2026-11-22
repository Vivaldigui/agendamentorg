// Confere a sintaxe de um fluxo do n8n antes de o gerador gravar o JSON: toda
// expressão ({{ ... }} em parâmetro que começa com "=") e todo código de nó Code
// têm de compilar. Os geradores (montar-*.mjs) chamam validarFluxo(fluxo) e param
// com erro se algo não compilar.
//
// Por quê (22/11/2026): no aviso da opção 6, um '\n' escrito dentro de template
// literal virou quebra de linha de verdade, a expressão do nó "Avisar o
// responsável" não compilava e o nó, com "continuar em erro", falhava calado desde
// a publicação. Ninguém era avisado.

// Para cada "{{", o "}}" que fecha é o primeiro que deixa o trecho compilável
// (um objeto dentro da expressão também tem "}}").
function expressoes(texto) {
  const achadas = [];
  let inicio = texto.indexOf('{{');
  while (inicio !== -1) {
    let fim = texto.indexOf('}}', inicio + 2);
    let primeiro = null;
    let valido = null;
    while (fim !== -1) {
      const trecho = texto.slice(inicio + 2, fim);
      if (!primeiro) primeiro = { trecho, fim };
      try {
        new Function(`return (${trecho});`);
        valido = { trecho, fim };
        break;
      } catch {
        fim = texto.indexOf('}}', fim + 1);
      }
    }
    const escolhido = valido || primeiro || { trecho: texto.slice(inicio + 2), fim: texto.length };
    achadas.push({ ...escolhido, ok: Boolean(valido) });
    inicio = texto.indexOf('{{', escolhido.fim + 2);
  }
  return achadas;
}

function erroDeSintaxe(fonte) {
  try {
    new Function(fonte);
    return '';
  } catch (e) {
    return e.message;
  }
}

export function validarFluxo(fluxo) {
  const erros = [];
  const visitar = (valor, onde) => {
    if (typeof valor === 'string') {
      if (!valor.startsWith('=')) return;
      for (const { trecho, ok } of expressoes(valor)) {
        if (!ok) erros.push(`${onde}: expressão não compila (${erroDeSintaxe(`return (${trecho});`)})`);
      }
    } else if (valor && typeof valor === 'object') {
      for (const [chave, item] of Object.entries(valor)) visitar(item, `${onde}.${chave}`);
    }
  };
  for (const no of fluxo.nodes) {
    const { jsCode, ...resto } = no.parameters || {};
    if (typeof jsCode === 'string') {
      // O nó Code roda o código dentro de uma função assíncrona (aceita return e await).
      const erro = erroDeSintaxe(`return (async () => {\n${jsCode}\n});`);
      if (erro) erros.push(`${no.name}: código não compila (${erro})`);
    }
    visitar(resto, no.name);
  }
  if (erros.length) {
    console.error(`Fluxo "${fluxo.name}" não foi gravado. Erro de sintaxe:\n- ${erros.join('\n- ')}`);
    process.exit(1);
  }
}
