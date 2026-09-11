const TIPOS = {
  nacional: "Regra nacional",
  minas: "Minas Gerais",
  local: "Como funciona em Itanhandu",
  atencao: "Atenção: regra sujeita a mudança"
};

export function pluginContainers(md) {
  md.block.ruler.before("fence", "escopo", (state, startLine, endLine, silent) => {
    const inicio = state.bMarks[startLine] + state.tShift[startLine];
    const fim = state.eMarks[startLine];
    const linha = state.src.slice(inicio, fim).trim();
    const match = /^:::(nacional|minas|local|atencao)$/.exec(linha);
    if (!match) return false;
    if (silent) return true;

    let fechamento = startLine + 1;
    while (fechamento < endLine) {
      const de = state.bMarks[fechamento] + state.tShift[fechamento];
      const ate = state.eMarks[fechamento];
      if (state.src.slice(de, ate).trim() === ":::") break;
      fechamento++;
    }
    if (fechamento >= endLine) return false;

    const tipo = match[1];
    const abre = state.push("escopo_open", "aside", 1);
    abre.block = true;
    abre.attrSet("class", `escopo escopo-${tipo}`);
    abre.attrSet("aria-label", TIPOS[tipo]);
    const rotulo = state.push("html_block", "", 0);
    rotulo.content = `<p class="escopo-rotulo">${TIPOS[tipo]}</p>\n`;
    state.md.block.tokenize(state, startLine + 1, fechamento);
    const fecha = state.push("escopo_close", "aside", -1);
    fecha.block = true;
    state.line = fechamento + 1;
    return true;
  });
}
