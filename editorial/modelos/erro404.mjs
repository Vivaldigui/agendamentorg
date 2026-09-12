import { esc } from "../scripts/util.mjs";

export function renderizarErro404(servico, temGuia = false) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Página não encontrada</title>
  <meta name="description" content="A página solicitada não foi encontrada.">
  <link rel="stylesheet" href="/assets/cin/guia.css">
</head>
<body>
  <a class="pular-conteudo" href="#conteudo">Pular para o conteúdo</a>
  <main id="conteudo" class="pagina-guia"><div class="coluna-leitura"><article><h1>Página não encontrada</h1><p class="resposta-direta">O endereço pode ter mudado ou sido digitado incorretamente.</p><p><a class="botao-guia" href="/">Voltar ao agendamento</a></p>${temGuia ? '<p><a href="/cin/">Consultar o Guia da CIN</a></p>' : ""}<p>${esc(servico.organizacoes.camara.nome)}</p></article></div></main>
</body>
</html>`;
}
