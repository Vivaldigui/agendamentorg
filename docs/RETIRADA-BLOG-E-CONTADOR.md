# Retirada do blog e do contador de visitas — 12/10/2026

## Autorização

Em 12/10/2026, Guilherme Ribeiro, responsável técnico pelo sistema e autor dos textos do blog, informou que a Câmara Municipal de Itanhandu autorizou:

1. a retirada do blog de `cin.itanhandu.cam.mg.gov.br/blog/`;
2. a transferência dos artigos para o portal Guia do RG (`guiadorg.com.br`);
3. o redirecionamento 301 dos endereços antigos para os artigos equivalentes no Guia do RG.

Anexe aqui a referência do documento de autorização (ofício, despacho ou e-mail institucional):

- Documento: _______________________
- Data: _______________________

## Blog

Os cinco artigos publicados foram transferidos para o Guia do RG com texto, fontes, datas e ilustrações:

| Endereço antigo | Novo endereço |
| --- | --- |
| `/blog/` | `https://guiadorg.com.br/artigos/` |
| `/blog/onde-fica-o-numero-do-rg/` | `https://guiadorg.com.br/artigos/onde-fica-o-numero-do-rg/` |
| `/blog/orgao-emissor-do-rg/` | `https://guiadorg.com.br/artigos/orgao-emissor-do-rg/` |
| `/blog/data-de-expedicao-do-rg/` | `https://guiadorg.com.br/artigos/data-de-expedicao-do-rg/` |
| `/blog/qual-certidao-levar-para-fazer-rg/` | `https://guiadorg.com.br/artigos/qual-certidao-levar-para-fazer-rg/` |
| `/blog/rg-antigo-ainda-vale/` | `https://guiadorg.com.br/artigos/rg-antigo-ainda-vale/` |
| `/assets/blog/<imagem>.svg` | `https://guiadorg.com.br/imagens/blog/<imagem>.svg` |

O que saiu deste repositório:

- `editorial/conteudo/blog/*.md` e `public/assets/blog/`;
- o tipo `artigo` do gerador (`modelos/blog.mjs`, `modelos/artigo.mjs`, ramos em `construir.mjs`, `validar.mjs`, `jsonld.mjs`, `util.mjs`, link "Blog" do menu e estilos);
- o CTA `mais-artigos` e os `relacionados` do guia que apontavam para posts;
- `public/blog/`, regenerado pelo gerador oficial (`construir.mjs --verificar` confere).

O guia `/cin/`, as páginas `/sobre/`, o agendamento e o painel continuam iguais.

## Contador de visitas e aba Estatísticas

Removidos:

- `public/visita.js` e as tags dele em `index.html`, `duvidas.html` e no modelo do editorial;
- a rota `/api/visita` e o cabeçalho de `/visita.js` no `firebase.json`;
- `functions/visitas.js`, `functions/visitas.test.js`, as funções `registrarVisita` e `consultarEstatisticasVisitas` e a consolidação na manutenção diária;
- as regras das coleções `metricas_visitas` e `metricas_visitas_fragmentos` (o acesso cai na negação padrão);
- a aba **Estatísticas** do painel (HTML, JavaScript e CSS) e a marca `cin_nao_contar_visita`.

A aba **Relatórios** (indicadores de atendimento e histórico de ações) continua.

Os documentos já gravados em `metricas_visitas*` não foram apagados. Podem ser removidos pelo console do Firestore quando convier.

## Publicação

Ordem usada: functions (confirmando a exclusão das duas funções) → regras do Firestore → hosting. Os redirecionamentos só foram publicados depois que `guiadorg.com.br` passou a responder.

## Reversão

`git revert` do merge e novo deploy de functions, regras e hosting. O conteúdo do blog continua no histórico do Git.
