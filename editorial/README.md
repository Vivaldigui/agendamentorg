# Guia da CIN — operação editorial

O diretório `editorial/` transforma Markdown com frontmatter em páginas HTML estáticas. O agendamento continua isolado na home; as páginas do guia não carregam Firebase, App Check, reCAPTCHA, Font Awesome, Google Fonts nem recursos externos.

## Fluxo de publicação

1. Escreva o conteúdo com `status: rascunho`.
2. Envie o texto e os fatos locais para a recepção revisar.
3. Mude para `status: aprovado` somente depois da conferência humana. Preencha `conferido` e `conferido_por`.
4. Rode `npm --prefix editorial run construir`.
5. Rode `npm --prefix editorial test`.
6. Rode `npm --prefix functions test`.
7. Revise o diff, inclusive o HTML gerado em `public/`.

O build público aceita somente conteúdo aprovado. Para revisar rascunhos, use uma saída fora de `public/`:

```powershell
npm --prefix editorial run construir -- --rascunhos --saida C:\caminho\temporario\guia-cin
```

O comando `npm --prefix editorial run verificar` reconstrói tudo em uma pasta temporária e falha quando `public/` não corresponde às fontes editoriais.

## Publicação e janela proibida

A publicação é feita somente com:

```powershell
firebase deploy --only hosting --project agendamento-cin-itanhandu
```

Nunca publique:

- às segundas-feiras entre 06:00 e 10:00;
- entre a execução de `scripts/preaquecer-ligar.ps1` e `scripts/preaquecer-desligar.ps1`.

Não há `predeploy` no `firebase.json`. A saída gerada é versionada para que o deploy de uma correção urgente da home não dependa do motor editorial.

## URLs permanentes

Um slug publicado não muda. Se uma alteração for inevitável, adicione um redirecionamento 301 em `firebase.json` no mesmo commit.

## Bloco futuro da home

Atualização de 11/09/2026: os dez guias e Sobre foram aprovados pelo responsável em conversa. O bloco abaixo já foi aplicado, com H1 visível, após o atalho de documentos. Privacidade continua em rascunho. Para a publicação deste lote, siga `docs/PUBLICAR-EDITORIAL-CIN.md`; a auditoria e as evidências estão em `docs/AUDITORIA-SEO-CIN.md`.

Aplicar somente quando o pilar, Documentos, Como agendar e Consultar ou cancelar estiverem aprovados. O bloco fica logo após `.atalho-documentos`:

```html
<nav class="atalhos-guia-cin" aria-label="Orientações sobre a CIN" style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:12px 20px;border-bottom:1px solid #fde68a;background:#fffbeb;">
  <a href="/cin/" style="display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;border-radius:999px;color:#003d82;font-weight:800;">Guia da CIN</a>
  <a href="/cin/documentos/" style="display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;border-radius:999px;color:#003d82;font-weight:800;">Documentos</a>
  <a href="/cin/como-agendar/" style="display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;border-radius:999px;color:#003d82;font-weight:800;">Como agendar</a>
</nav>
```

## Pendência da home

A imagem social de 1200 × 630 px foi criada e revisada: `public/assets/cin/guia-social.png`. A fonte vetorial está em `estilo/guia-social.svg`; o asset é versionado e não precisa ser renderizado no deploy.

## Contrato de segurança editorial

- `[A CONFIRMAR: ...]` é permitido em rascunho e bloqueia conteúdo aprovado.
- Fato com `status: a_confirmar` em `dados/servico.json` bloqueia conteúdo aprovado que o declare em `fatos`.
- O HTML é determinístico e usa LF.
- O guia aceita links externos somente para domínios oficiais permitidos ou fontes declaradas no frontmatter.
- A FAQ precisa ter o heading exato `## Perguntas frequentes`, de três a seis perguntas em negrito e terminadas por `?`.

- Frontmatter aceita somente delimitadores `---` sem linguagem e YAML seguro. Não há execução do engine JavaScript.
- `verificar` e build em saída alternativa não escrevem `PENDENCIAS.md`; somente o build público normal o atualiza.
- Preview de rascunhos recebe noindex, robots bloqueado e sitemap sem rascunhos. Nunca copiar a pasta de preview para publicação.
- Institucionais têm slugs limitados a `sobre` e `privacidade`; links de navegação só aparecem se o destino existe.
- A FAQ continua descritiva e visível, mas não se promete resultado enriquecido: o Google descontinuou esse recurso em maio de 2026.
