# Auditoria e preparação SEO — Guia da CIN

Conferência: 11/09/2026. Branch: `feat/guia-da-cin`. Nenhum commit, push ou deploy realizado.

## Resultado

Os dez guias e a página Sobre foram aprovados pelo responsável em conversa e gerados em `public/`. Privacidade permanece em rascunho e não integra o sitemap nem a navegação. A aprovação foi registrada sem inventar nome pessoal. O lote está preparado para publicação de Hosting pelo responsável, conforme `PUBLICAR-EDITORIAL-CIN.md`.

O agendamento foi preservado: comparação dos scripts da home com HEAD encontrou conteúdo idêntico, exceto a adição do JSON-LD não executável. Não houve edição de functions, regras, recepção, service worker, manifest ou scripts operacionais. A home recebeu metadados, H1 visível e navegação estática após o atalho de documentos, agora com destinos existentes.

## Pesquisa utilizada

- Projeto OpenSEO: [Agendamento RG e CIN — Itanhandu](https://app.openseo.so/p/6cbbba0c-c711-47e9-a6d1-a83c9a020cfc). Criado, contexto preenchido e relido. Search Console conectado pelo responsável e validado por consulta.
- A pasta `Google ADS` forneceu documentação de integração, cliente MCP e cliente ATP já configurados. Nenhuma campanha, orçamento ou projeto comercial foi alterado. As pesquisas de sucupira e serviços domésticos não foram reutilizadas como evidência de demanda por RG.
- OpenSEO: métricas Brasil, português. 19 termos solicitados, 12 retornados. Ausência de retorno não significa volume zero. Não há estimativa municipal confiável nesses dados.
- ATP: uma pesquisa `carteira de identidade`, português/Brasil; 71 sugestões em perguntas, incluindo duplicatas. Foram aproveitadas dúvidas pertinentes a documentos, agendamento, infância, entrega e versão digital, não consultas de outras cidades ou profissões.
- Evidências locais: `seo-cin-evidencias-2026-09-11.json`, `seo-cin-search-console-2026-09-11.json` e `seo-cin-search-console-paginas-2026-09-11.json`. A primeira consulta GSC, antes da conexão, está preservada como histórico; as duas últimas representam a conexão concluída.

### Search Console: histórico real do site

Período 08/06/2026 a 08/09/2026, pesquisa web, agrupamento por página:

| Página | Cliques | Impressões | CTR | Posição média |
|---|---:|---:|---:|---:|
| Home | 171 | 476 | 35,92% | 4,11 |

No agrupamento consulta/página foram retornadas apenas 12 consultas, com 3 cliques e 145 impressões detalhados. O Google omite consultas por privacidade; essa soma não substitui o agregado por página. Consultas institucionais como “camara itanhandu” e “câmara municipal de itanhandu” sustentam a identificação explícita da Câmara. Não existem dados de desempenho das novas páginas, ainda não publicadas.

### Mapa de intenção e decisões

Volumes abaixo são estimativas nacionais do OpenSEO, não previsões de visitas.

| Termo / demanda | Volume | Destino e ajuste |
|---|---:|---|
| agendamento rg | 135.000 | Home transacional; H1 e metadados com Itanhandu/Câmara |
| carteira de identidade nacional | 201.000 | `/cin/`: visão geral, novo RG, etapas e links para o guia |
| agendamento cin | 5.400 | `/cin/como-agendar/`: segunda às 8h, vagas variáveis, sem lista de espera |
| documentos para tirar identidade | 4.400 | `/cin/documentos/`: título com “tirar CIN”, formatos aceitos e comprovante |
| documentos para tirar cin | 3.600 | Mesma página, evitando outra URL com intenção duplicada |
| cancelar agendamento identidade | 880 | `/cin/consultar-ou-cancelar/`: código CIN- preservado e cancelamento |
| identidade para criança | 260 | `/cin/criancas-e-adolescentes/`: identidade infantil, responsáveis e foto |
| cin digital | 33.100 | Seção em `/cin/prazo-e-entrega/`: gov.br depois de receber a carteira |
| segunda via identidade mg | 1.900 | `/cin/gratuidade-e-segunda-via/`: taxa e hipóteses de isenção |

ATP trouxe, entre outras, “como agendar carteira de identidade”, “o que precisa para tirar carteira de identidade”, “onde tirar carteira de identidade infantil” e “como rastrear carteira de identidade”. As respostas priorizam o procedimento local e a fonte estadual. A pergunta sobre identidade “na hora” foi atendida pela distinção entre atendimento de quinze minutos e prazo de emissão/entrega, sem prometer serviço imediato.

## Auditoria remota versus teste local

[Auditoria OpenSEO do site publicado](https://app.openseo.so/p/6cbbba0c-c711-47e9-a6d1-a83c9a020cfc/audit?auditId=416a9d93-2c6c-4460-a386-d62233b9c349): concluída, uma página rastreada, HTTP 200, 554 palavras detectadas, zero links internos, página não encontrada em sitemap e um aviso `missing-h1`. Não houve Lighthouse nessa chamada. Isso descreve a produção anterior, não o lote local corrigido.

Amostra SERP “agendamento rg itanhandu”: home apareceu como primeiro resultado orgânico, posição geral 2 depois do bloco de IA. Não equivale a posição estável nem substitui o Search Console. Um resultado municipal antigo descrevia agendamento mensal presencial, reforçando a necessidade de informação local atualizada. Não alteramos sites de terceiros.

No lote local: 11 páginas com títulos e descriptions únicos, H1 único, links válidos e sem marcadores pendentes; sitemap com 12 URLs (home mais 11 aprovadas). Maior HTML editorial: 16.271 bytes; CSS: 6.832 bytes. Imagem social PNG: 51.826 bytes, 1200 × 630, fonte vetorial em `editorial/estilo/guia-social.svg`.

## Tratamento dos achados anteriores

| Achados | Tratamento |
|---|---|
| P1-1, P2-1 | Telefone internacional e `OpeningHoursSpecification` estruturados; testes em home e pilar, com fatos verificados e pendentes |
| P1-2 | Frontmatter exige delimitador YAML sem engine; parser YAML seguro chamado diretamente; teste recusa js/javascript e tags executáveis |
| P1-3 | Links de Guia/Avisos/404 condicionais; validação final dos destinos; home só recebeu links depois da aprovação |
| P1-4 | Verificar e preview não regravam PENDENCIAS; teste de conteúdo e mtime |
| P2-2 | Texto da FAQ limpo com parser Markdown, preservando CIN- e salvá-lo |
| P2-3 | Área atendida vem de `servico.json` e é omitida quando não verificada |
| P2-4 | Retirada a prosa de pendências do conteúdo público; não se inventaram postos vizinhos |
| P2-5 | Separados atendimento regular por hora e emissão emergencial; não publicada negativa de direitos ou acessibilidade |
| P2-6 | Isenções por furto/roubo e insuficiência de renda incluídas, com fonte e condições |
| P2-7 | Procedimento após 90 dias, incluindo lista por mais 30 dias; sem afirmar destruição automática no dia 90 |
| P2-8 | Acompanhamento de menores sustentado pelo serviço estadual e informação local, não pela portaria de entrega |
| P2-9 | Rascunho de privacidade descreve cron mensal, elegibilidade e CPF em bloqueios; Google/Firebase/reCAPTCHA identificados; aprovação institucional ainda pendente |
| P2-10 | Frase explicativa e rótulo curto de CTA, sem repetição |
| P2-11, P3-8 | Pendências por chave, pergunta e responsável explícitos; deduplicação sem 35 regex e sem marcadores de célula |
| P3-1 | OG article apenas em guia/aviso; website nas institucionais/índice |
| P3-2 | Imagem social local adicionada às 11 páginas e à home |
| P3-3 | CSS/arte CIN com revalidação, sem cache cego de 30 dias; conferir cabeçalho após deploy |
| P3-4 | Institucionais limitadas aos slugs sobre/privacidade; colisões rejeitadas |
| P3-5 | Pilar de fato gera links para as guias; teste verifica destino. A regra foi explicitada, sem exigir links editoriais redundantes |
| P3-6 | Quatro superfícies da home, incluindo comprovante, testadas por termos de categorias vindos da base; não se alega equivalência semântica integral |
| P3-7 | Caption, scope e nome acessível nos blocos |
| P3-9 | Horário de funcionamento 14h–17h separado dos slots reserváveis, definidos na agenda; grade crítica não modificada |
| P3-10 | Exceção para URL HTTPS exata declarada em fontes preservada conforme contrato original; protocolos inseguros rejeitados. A declaração da fonte continua sujeita à revisão humana |
| P3-11 | Preview tem noindex e robots bloqueado; rascunhos excluídos do sitemap, inclusive avisos |
| P3-12 | Prompt de auditoria transferido para `docs/` |

Observação sobre a auditoria anterior: a Portaria 02/2022 examinada trata de emissão emergencial em situações específicas, não comprova recursos físicos de acessibilidade no prédio nem estabelece a fila regular descrita no relatório. O texto público foi corrigido sem transformar essa inferência em regra.

## Verificação executada

- Editorial: 44 testes passaram, zero falhas.
- Functions: 231 testes passaram, zero falhas.
- `construir`, `verificar` e `git diff --check`: passaram.
- `npm --prefix editorial audit --omit=dev`: zero vulnerabilidades.
- Runtime das functions continua `nodejs22`; testes/build local em Node 24 autorizado.
- Hosting emulator 15.19.1: `/cin/` e `/cin/documentos/` 200; `/cin/documentos` 301 para `/cin/documentos/`; URL inexistente e `/privacidade/` 404; sitemap 200.
- Limitação observada: emulador não enviou os cabeçalhos customizados em recepção/CSS. Configuração foi inspecionada, mas não se declara validação HTTP desses cabeçalhos em produção.
- Edge headless: pilar, Documentos, Dia do atendimento e Sobre sem overflow horizontal a 320 px; Documentos sem overflow a 390 px, sem imagens quebradas e sem requisições externas. Pilar também inspecionado em 1280 px. Não é auditoria exaustiva WCAG.
- Imagem social inspecionada visualmente. Nenhuma dependência adicionada ao runtime para produzi-la.

## Fontes e limites

Fonte estadual indicada pelo responsável: [Obter Carteira de Identidade Nacional](https://www.mg.gov.br/servico/obter-carteira-de-identidade-nacional), lida em 11/09/2026. O acesso por uma ferramenta recebeu bloqueio; a leitura HTTP direta funcionou. Portarias anexadas: `documento-2.pdf`, `documento-4.pdf`, `documento-5.pdf`, `documento-6.pdf`, páginas renderizadas e conferidas; links oficiais das portarias 04/06/07 incluídos nas páginas pertinentes. Informações operacionais locais vêm das respostas do responsável, não de inferência do SEO.

O RG antigo tem orientação federal de validade até 28/02/2032, enquanto a página estadual informa outra data; prevalece a [orientação federal](https://www.gov.br/gestao/pt-br/identidade-nacional) para a regra nacional. Biometria foi reconferida no [FAQ oficial atualizado em 16/07/2026](https://www.gov.br/governodigital/pt-br/identidade/cin/faq_biometria).

Não se promete indexação nem posição. [Sitemap ajuda a descoberta, mas não garante indexação](https://developers.google.com/search/help/crawling-index-faq?hl=en). O Google [descontinuou os resultados enriquecidos de FAQ em maio de 2026](https://developers.google.com/search/updates); o schema foi mantido por compatibilidade com o contrato e para descrever as perguntas visíveis, sem promessa de destaque. Não foram criadas páginas artificiais por município nem llms.txt como suposto requisito de ranking.

Pendências não escondidas: aviso de privacidade ainda não publicável; inventário institucional de compartilhamento e base legal; prazo de correção não prometido; informação sobre postos de outras cidades não publicada. As listas antigas do aplicativo ainda usam redação resumida “certidão original”; não foram alterados os scripts operacionais da home. O guia detalha os formatos aceitos. Vulnerabilidade moderada preexistente de `qs` nas functions consta da auditoria anterior e não foi corrigida neste escopo.
