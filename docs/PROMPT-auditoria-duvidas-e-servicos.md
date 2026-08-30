# Prompt — auditoria da grade de serviços, do aviso da taxa e da página de dúvidas

Use depois que a implementação estiver feita e commitada. Antes de colar, substitua
`<SHA_BASE>..<SHA_TOPO>` pelo intervalo real e confira a contagem de testes.

Cole o conteúdo abaixo como mensagem para o auditor.

---

Faça uma **auditoria independente** de três mudanças no site público do AgendamentoRG, todas voltadas ao cidadão que nunca usou o sistema. Trate cada afirmação minha como hipótese. **Discordância fundamentada é o produto.** Concordar não ajuda.

## O que foi feito

**1. Aviso da taxa da 2ª via.** Em todo lugar que lista documentos necessários, entrou um aviso de que a 1ª via da CIN é gratuita — inclusive para quem já tem o RG do modelo antigo — e que só a 2ª via da CIN é paga, com link para a guia do DAE de Minas Gerais.

**2. Grade de serviços na home.** O box do Instagram e as duas tarjas de atalho (`.atalho-cancelamento` e `.atalho-documentos`) deram lugar a uma grade de blocos: documentos necessários, consultar, cancelar, taxa da 2ª via, como chegar, dúvidas frequentes.

**3. Página `public/duvidas.html`.** 29 perguntas frequentes sobre a CIN, em acordeão `<details>/<summary>`, com JSON-LD `FAQPage`.

Escopo: `git diff <SHA_BASE>..<SHA_TOPO>`. Arquivos esperados: `public/index.html`, `public/duvidas.html`, `public/recepcao.js`.

## O sistema, no que interessa aqui

Agendamento de RG/CIN da Câmara Municipal de Itanhandu. Firebase Hosting, Cloud Functions v2, Firestore, RTDB. O site público é **um único `index.html` com CSS e JS embutidos**; o painel da recepção é `recepcao.html` + `recepcao.css` + `recepcao.js`, com CSP próprio e sem `'unsafe-inline'` no `script-src`.

Este código passou por auditorias independentes que encontraram, somadas, mais de vinte defeitos — vários **introduzidos durante a correção de outros defeitos**, e alguns cobertos por testes que consagravam a falha como se fosse a intenção. Nenhuma dessas três mudanças tem teste automatizado hoje; se você concluir que alguma precisa de um, diga qual e por quê, mas não aceite a existência de um teste como prova de nada.

**A parte crítica do sistema é a disputa de vagas na abertura semanal**, quando centenas de pessoas concorrem a cerca de 30 horários. Nada nestas três mudanças deveria tocar esse caminho. **Confirme que não tocou.** Se tocou, isso é o achado mais importante da auditoria, acima de qualquer questão de texto ou de layout.

## O que quero que você verifique

### Regressão no caminho crítico

- A grade e o aviso alteraram alguma função do fluxo de agendar, consultar ou cancelar? Em especial: `mudarAba`, `atualizarVisibilidadeAtalhos`, `atualizarBannerVagas`, `abrirAbaCancelar`, e o que depende de `dados-pessoais` / `sucesso-docs` estarem visíveis.
- As tarjas removidas eram alvo de `querySelectorAll(".atalho-cancelamento, .atalho-documentos")`. Sobrou seletor apontando para elemento que não existe mais? O código morre em silêncio ou lança?
- Peso do `index.html` antes e depois, em bytes. Cresceu quanto? Justifica-se no arquivo que todo mundo baixa ao mesmo tempo às 08:00 da abertura?
- O aviso e a grade aparecem/desaparecem corretamente nos quatro estados da home: agenda aberta, agenda fechada, formulário preenchido, tela de sucesso.

### Segurança

- `public/duvidas.html` herda o header `**` do `firebase.json` (CSP com `'unsafe-inline'` em `script-src` e `style-src`). O que a página nova usa exige isso, ou dá para viver sem? Se a página tem JS próprio, ele precisa existir?
- O JSON-LD é injetado ou é estático? Se alguma parte do FAQ vier de dado, e não de literal no arquivo, isso é XSS.
- Todo link externo — DAE, GOV.BR, Google Maps, Instagram — tem `rel="noopener noreferrer"` junto com `target="_blank"`?
- O link do DAE (`daeonline1.fazenda.mg.gov.br`) aparece em quantos lugares? Está idêntico em todos, sem redirecionador, encurtador ou parâmetro colado?
- Algum texto novo é inserido via `innerHTML` com valor que veio do agendamento (nome, protocolo, telefone)? O site já tem `textoSeguro`; foi usado onde precisava?

### A regra do dinheiro — trate como requisito, não como detalhe

O objetivo declarado desta mudança é **impedir pagamento indevido**. Quem tem o RG antigo lê "2ª via" e acha que é o caso dele; a taxa é do Estado e não volta.

- O bloco "Taxa da 2ª via" leva direto ao site do DAE, ou abre primeiro a explicação? **Se levar direto, isso é um defeito**, não uma escolha de layout.
- O texto explica como a pessoa distingue os dois documentos? A pista prometida é que na CIN o número principal é o CPF.
- Alguém que só lê o rótulo do bloco, sem abrir nada, é induzido a pagar?
- O aviso está em **todos** os pontos que listam documentos, com o mesmo sentido? Confira os oito: o modal de documentos, o checklist do formulário, o checklist da tela de sucesso, `documentosTexto()`, `documentosComprovanteHTML()` do site, a descrição do `.ics`, o `TEMPLATE_LEMBRETE_PADRAO` do painel e o `documentosComprovanteHTML()` do painel.
- `TEMPLATE_LEMBRETE_PADRAO` é só o **padrão**: se `configuracoes/agenda.mensagemLembreteTemplate` já existir no Firestore, o texto novo nunca chega ao cidadão. A mudança tratou disso, ou criou a ilusão de ter tratado?

### Coerência entre os textos

O FAQ e o checklist do site precisam dizer a mesma coisa. Quatro conflitos foram identificados e resolvidos antes de codar (`docs/PLANO-servicos-duvidas-taxa.md`, seção "Conflitos resolvidos"). **Confirme que a resolução chegou ao código, nos dois lados:**

- **CPF** — obrigatório. O FAQ não pode ter sobrado com "caso já possua" nem com a frase de que o CPF é emitido durante o atendimento.
- **Comprovante de residência** — obrigatório, e o FAQ deve dar o motivo: a CIN vai pelos Correios para o endereço informado.
- **Foto 3x4** — obrigatória para menores de 3 anos, sem "em regra" e sem "poderá ser necessária".
- **Representante legal** — documento com foto sempre; comprovação de guarda quando o acompanhante não for pai nem mãe. **Esta é a única que muda o site**: a exigência tinha de entrar nos oito pontos do checklist, não só no FAQ. Confira os oito.

Compare também `public/duvidas.html` com `docs/CONTEUDO-duvidas-frequentes.md`, que é a fonte da verdade do texto. Divergência aqui não é questão de estilo: é a pessoa voltando para casa sem atendimento.

### Acessibilidade e uso real

O público é municipal, muita gente idosa, quase todo mundo no celular, boa parte no sol.

- Cada bloco da grade tem alvo de toque de 44 px ou mais, e é `<button>` ou `<a>` de verdade — não `<div onclick>`?
- Contraste do texto branco sobre a cor de fundo de cada bloco: passa em AA (4.5:1 para texto normal)? **Calcule, não estime.** As seis cores foram escolhidas já verificadas — `#0056b3` 7,0:1, `#0b7a52` 5,4:1, `#c0392b` 5,4:1, `#a06400` 4,9:1, `#4f5d75` 6,7:1, `#6d4aa8` 6,6:1. Confirme que são essas que estão no código: se alguém clareou o âmbar de volta para algo como `#d18300`, isso dá 3,0:1 e reprova. A dica secundária deve estar em `rgba(255,255,255,0.9)` ou mais opaca — meça o composto sobre o âmbar.
- Foco de teclado visível em todos os blocos e em todo `<summary>`?
- Rótulo acessível descreve o destino, ou repete o texto visível sem dizer que abre outro site?
- `<details>` fechado esconde o conteúdo do Ctrl+F em alguns navegadores. Isso prejudica quem procura uma pergunta específica entre 29? Há alternativa melhor?
- A grade em 320 px de largura: estoura, quebra rótulo no meio da palavra, ou aparece rolagem horizontal no `body`?
- `prefers-reduced-motion` foi respeitado se houve transição nova?

### A página de dúvidas

- O JSON-LD `FAQPage` corresponde exatamente ao texto visível? Divergência entre marcação e conteúdo é penalizada pelo Google e é, na prática, informação errada indexada.
- A página tem `<title>`, `<meta name="description">`, `lang="pt-br"`, e um caminho de volta ao agendamento?
- O CSS foi duplicado do `index.html`. As cores e a fonte batem com as do site, ou a página nova destoa?
- O FAQ afirma prazos e datas — validade do modelo antigo até fevereiro de 2032, prazo de 15 dias úteis, validade por faixa etária. Não julgue o mérito jurídico; **verifique se o texto se contradiz internamente** e se algum prazo aparece com dois valores diferentes em perguntas diferentes.

## Formato da resposta

Para cada achado: **o que é**, **onde** (`arquivo:linha`), **como reproduzir ou por que é verdade**, **impacto**, **correção sugerida**. Ordene por impacto, não por ordem de leitura.

Separe explicitamente:

1. **Defeitos** — está errado e precisa mudar.
2. **Riscos** — funciona, mas depende de suposição que ninguém verificou.
3. **Opiniões de design** — você faria diferente, sem defeito envolvido.

Não misture as três. Se não achar nada em alguma categoria, diga que não achou.

**Não faça deploy, commit ou push.** Se precisar rodar algo, `npm --prefix functions test` é o que existe; nenhuma destas mudanças tem teste próprio.
