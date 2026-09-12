# Publicar o Guia da CIN

## Lote preparado

Onze páginas já geradas em `public/`: pilar CIN, Documentos, Como agendar, Consultar ou cancelar, Crianças e adolescentes, Dia do atendimento, Prazo e entrega, Cidades vizinhas, Gratuidade e segunda via, Benefícios sociais e Sobre.

Aprovação do responsável registrada em conversa em 11/09/2026. Privacidade permanece em rascunho: não publicar manualmente a pasta de revisão nem remover suas travas.

Não houve commit, push ou deploy. O relatório completo está em `AUDITORIA-SEO-CIN.md`.

## Antes de publicar

Hosting publica `public/` inteira. Antes de qualquer publicação, use a `main`
atualizada e confira também `/recepcao.html`, `/recepcao.css` e `/recepcao.js`.
As branches editoriais anteriores à reintegração de 12/09/2026 contêm o painel
antigo e não devem ser usadas para deploy. Uma mudança apenas editorial ainda
pode regredir outras páginas e os cabeçalhos de segurança do site.

Na pasta `C:\Users\Users\Documents\agendamentorg`, execute:

```powershell
rtk npm --prefix editorial run construir
rtk npm --prefix editorial test
rtk npm --prefix functions test
rtk npm --prefix editorial run verificar
rtk git diff --check
rtk git status --short
```

Revise também arquivos novos: `git diff` sozinho não exibe o conteúdo dos não rastreados. Inclua fontes e saída gerada ao versionar o lote. Não faça `git add .` sem revisar mudanças alheias ao editorial.

Não publicar às segundas entre 06h e 10h, nem durante a janela dos scripts de pré-aquecimento. Não publicar functions ou regras junto com este lote.

## Comando de publicação — executar somente por decisão do responsável

```powershell
rtk proxy firebase deploy --only hosting --project agendamento-cin-itanhandu
```

## Logo após o deploy

1. Abrir `/`, `/cin/`, `/cin/documentos/`, `/cin/como-agendar/` e `/sobre/`; conferir carregamento, logo, CTA e retorno ao agendamento. Não enviar um agendamento de teste em produção.
2. Conferir `/cin/documentos` redirecionando para `/cin/documentos/`, erro real com status 404 e ausência de `/privacidade/`.
3. Conferir `Cache-Control` de `/assets/cin/guia.css` como `public, max-age=0, must-revalidate` e `X-Robots-Tag: noindex, nofollow` de `/recepcao.html`. O emulador local não reproduziu esses cabeçalhos; não ignorar esta etapa.
4. Abrir `/sitemap.xml`: deve conter 12 URLs, sem privacidade nem avisos vazios. Conferir canonical no domínio `agendamento-cin-itanhandu.web.app`, inclusive se acessar pelo alias firebaseapp.com.
5. Na propriedade já conectada do Search Console, enviar `https://agendamento-cin-itanhandu.web.app/sitemap.xml`. Usar Inspeção de URL para a home e o pilar e solicitar indexação se os testes ao vivo passarem. Não submeter URLs ainda não publicadas.
6. Rodar nova auditoria no projeto OpenSEO depois que a produção estiver atualizada; o relatório remoto atual descreve apenas a home antiga.
7. Comparar cliques/impressões por página e consulta depois de haver dados suficientes. A linha de base é 171 cliques e 476 impressões da home entre 08/06 e 08/09/2026; não comparar volumes nacionais de ferramentas com visitas locais.

Se aparecer falha material, usar a versão anterior do Hosting pelo console Firebase ou um deploy da versão anterior revisada, mediante decisão do responsável. Não fazer reset destrutivo na árvore de trabalho.

## Manutenção

- Atualizar taxa e datas de benefícios a partir das fontes oficiais antes de mudar o texto.
- Mudou slug publicado? Incluir redirecionamento 301 no mesmo lote.
- Nova aprovação requer responsável e data reais; não trocar datas só para sugerir frescor ao Google.
- Para alterar a arte social, editar `editorial/estilo/guia-social.svg`, exportar PNG 1200 × 630 para `public/assets/cin/guia-social.png` e revisar visualmente. O PNG é asset estático versionado, não depende de exportação durante o deploy.
- Aprovar privacidade somente depois das respostas em `editorial/PENDENCIAS.md`; a publicação do guia não resolve a adequação LGPD do sistema.
