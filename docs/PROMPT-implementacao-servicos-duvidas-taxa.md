# Prompt — implementar a grade de serviços, o aviso da taxa e a página de dúvidas

Cole o conteúdo abaixo como mensagem para quem for codar.

---

Implemente três mudanças no site público do AgendamentoRG. **Leia primeiro
`docs/PLANO-servicos-duvidas-taxa.md` e `docs/CONTEUDO-duvidas-frequentes.md`** —
o plano tem as decisões, o conteúdo tem o texto exato do FAQ. Onde este prompt e
o plano divergirem, o plano está certo; avise a divergência em vez de escolher
sozinho.

Branch de trabalho: `reorganizacao-painel-recepcao`. **Não faça deploy, commit ou
push sem autorização expressa.**

## O sistema

Agendamento de RG/CIN da Câmara Municipal de Itanhandu. O site público é **um
único `public/index.html` com CSS e JS embutidos** — 3.000 linhas, 171 KB. O
painel da recepção é `recepcao.html` + `recepcao.css` + `recepcao.js`, com CSP
próprio e sem `'unsafe-inline'` no `script-src`.

O caminho crítico é a disputa de vagas na abertura semanal: centenas de pessoas
concorrendo a cerca de 30 horários. **Nada aqui deve tocar nesse caminho.** Se
alguma mudança exigir mexer em `criarAgendamentoCidadao`, na seleção de
data/hora, ou no ciclo de atualização do banner de vagas, pare e explique por
quê antes de continuar.

Convenções que o repositório já tem e que valem aqui:

- Ícones em **SVG inline** quando não houver equivalente no Font Awesome já
  carregado. Existem dois exemplos prontos (`.icone-marca`, Instagram e
  WhatsApp) — o comentário ao lado deles explica que é para não baixar a família
  "brands", 102 KB.
- Tokens de cor em `:root` (`--primary`, `--danger`, `--warning`, `--gray-*`).
  Reaproveite; não invente paleta paralela.
- `documentosTexto()` e `documentosComprovanteHTML()` do site são **sem acento**
  de propósito. `TEMPLATE_LEMBRETE_PADRAO` do painel é **com acento**. Mantenha
  cada um como está.
- Comentários no código explicam *por que*, não *o que*. Só comente o que não é
  óbvio pela leitura.

---

## Parte 1 — Aviso da taxa da 2ª via

O texto exato (versão HTML e versão texto puro) está no plano, seção 1. Ele entra
em **oito** pontos:

Em `public/index.html`:

1. `abrirDocumentosNecessarios()` — o modal do atalho.
2. Checklist do formulário (`.docs-container.compacto`, "Confira os documentos
   antes de finalizar").
3. Checklist da tela de confirmação (`.docs-container`, "Documentos
   Obrigatórios").
4. `documentosTexto()` — WhatsApp e `.txt`.
5. `documentosComprovanteHTML()` — comprovante impresso.
6. A linha `DESCRIPTION:` do `.ics` — só a frase curta do plano.

Em `public/recepcao.js`:

7. `TEMPLATE_LEMBRETE_PADRAO`.
8. `documentosComprovanteHTML()` do painel.

**Faça um par de funções por arquivo** — `avisoTaxaHTML()` e `avisoTaxaTexto()`
— com o texto num único lugar, e chame nos pontos acima. Oito cópias literais
divergem na primeira edição seguinte.

Três detalhes que decidem se isto funciona:

- **O modal renderiza com `textContent`.** Link dentro da mensagem não fica
  clicável, e trocar para `innerHTML` reabriria uma via de XSS que já foi
  fechada. Adicione um botão no array `botoes`: "Emitir guia da 2ª via", que abre
  o link.
- **Todo link externo** leva `target="_blank" rel="noopener noreferrer"`.
- **`TEMPLATE_LEMBRETE_PADRAO` é só o padrão.** Se
  `configuracoes/agenda.mensagemLembreteTemplate` já existir no Firestore, o
  texto novo nunca chega ao cidadão. Não tente sobrescrever o Firestore. Deixe
  registrado no resumo final que a recepção precisa colar o texto novo em
  Configurações → "Mensagem de lembrete WhatsApp"; se achar que vale um botão
  "restaurar padrão" no painel, proponha antes de implementar.

**Junto com o aviso**, no mesmo passe: os checklists de documentos ganham a
exigência decidida no conflito 4 do plano — quando o acompanhante de menor de 16
anos não for o pai nem a mãe, apresentar também a documentação que comprove a
representação ou a guarda.

## Parte 2 — Grade de serviços na home

Substitui o box `.instagram-suporte` e as duas tarjas `.atalho-cancelamento` e
`.atalho-documentos`. Seis blocos, na ordem e nas cores da seção 2 do plano.

**Opção A: bloco inteiro na cor**, ícone em selo translúcido
(`rgba(255,255,255,0.2)`), rótulo e dica em branco.

As cores do plano **já são a versão escurecida e verificada** — `#0056b3`,
`#0b7a52`, `#c0392b`, `#a06400`, `#4f5d75`, `#6d4aa8`, todas acima de 4,5:1
contra branco. Não as clareie "para ficar mais bonito": o âmbar original
(`#d18300`) dava 3,0:1 e reprovava em AA. A dica secundária usa
`rgba(255,255,255,0.9)`, nunca menos.

Requisitos:

- Duas colunas no celular, três a partir de 720 px; altura mínima de 96 px.
- Cada bloco é `<button>` ou `<a>`, com foco de teclado visível e rótulo
  acessível que diga o destino. Os que abrem outro site indicam isso.
- A grade aparece **também com a agenda fechada** — é o estado em que a página
  hoje menos serve para alguma coisa. Confira os quatro estados: agenda aberta,
  agenda fechada, formulário preenchido, tela de sucesso.
- `atualizarVisibilidadeAtalhos()` deixa de esconder as tarjas e passa a cuidar
  só da faixa fina que sobra com o aviso "se não puder comparecer, cancele".
  Nenhum `querySelectorAll` pode continuar apontando para elemento que deixou de
  existir.
- O Instagram vira **uma linha no rodapé**: "Acompanhe a Câmara:
  @camaraitanhandu", com o SVG que já existe. O box branco sai.

**O bloco "Taxa da 2ª via" não abre o DAE diretamente.** O toque abre o aviso da
Parte 1; o botão do DAE fica atrás dele. Um atalho direto para o pagamento é
exatamente o erro que a Parte 1 existe para evitar — quem tem o RG antigo lê "2ª
via" e acha que é o caso dele, e a taxa não volta.

Ao terminar, informe quantos bytes o `index.html` cresceu.

## Parte 3 — `public/duvidas.html`

Página nova. Conteúdo integral em `docs/CONTEUDO-duvidas-frequentes.md`: 29
perguntas em cinco grupos. Transcreva o texto **sem reescrever** — ele já passou
por revisão de conteúdo e por quatro decisões de conflito com o checklist do
site.

- Acordeão com `<details>` e `<summary>` nativos. **Sem JavaScript.**
- Mesmo cabeçalho azul, mesma paleta e mesma fonte do `index.html`.
- Um caminho de volta ao agendamento, visível no topo.
- `<title>`, `<meta name="description">`, `lang="pt-br"`.
- JSON-LD `FAQPage` **estático**, correspondendo exatamente ao texto visível.
  Nada de gerar a marcação a partir de dado em tempo de execução.
- As duas respostas que citam o DAE levam o link, com
  `rel="noopener noreferrer"`.

`firebase.json` não muda: a página herda o header `**` e o `Cache-Control` de
`**/*.html`. Se você concluir que precisa mudar, pare e explique.

---

## Ordem de trabalho

Implemente **Parte 3 primeiro**, isolada. É a única que não pode quebrar o
agendamento, e é a que pode ir ao ar antes das outras duas. Depois Parte 1,
depois Parte 2 — a Parte 2 depende do aviso da Parte 1 existir para o bloco
laranja abrir.

## O que entregar

- Resumo do que mudou em cada arquivo, com o número de linhas.
- Quanto o `index.html` cresceu, em bytes.
- Lista do que você **não** fez e por quê.
- Qualquer ponto em que o plano estava errado ou incompleto. Isso é informação
  útil, não falha sua — mas decida junto, não sozinho.

Não faça deploy, commit ou push. Se quiser rodar algo, `npm --prefix functions
test` é o que existe; nenhuma destas três mudanças tem teste automatizado, e se
você achar que alguma precisa, diga qual e por quê.
