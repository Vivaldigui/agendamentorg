# Prompt — estado civil, documentos só após confirmar, certidão original ou cópia autenticada

Cole o conteúdo abaixo como mensagem para o Codex.

---

Implemente as mudanças descritas em `docs/PLANO-estado-civil-documento.md`. **Leia
o plano primeiro.** Onde este prompt e o plano divergirem, o plano está certo;
avise a divergência em vez de decidir sozinho.

Branch: `reorganizacao-painel-recepcao`. **Não faça deploy, commit ou push sem
autorização expressa.**

## O sistema, no que importa aqui

Agendamento de RG/CIN da Câmara Municipal de Itanhandu. O site público é um único
`public/index.html` com CSS e JS embutidos. O painel é `recepcao.html` +
`recepcao.css` + `recepcao.js`.

O fluxo de agendamento já foi invertido: a seção `#dados-pessoais` serve às duas
fases por classe de modo (`.modo-preencher` / `.modo-confirmar`, com
`.so-preencher` / `.so-confirmar`), e a tela de sucesso é `#sucesso-docs`.

**A parte crítica é a disputa de vagas.** Nada aqui pode tocar
`criarAgendamentoCidadao`, a transação de vagas, a idempotência por `operationId`,
nem o payload do agendamento. Se você achar que precisa, pare e explique. Estas
mudanças são **todas de interface e de texto**; nenhuma grava dado novo.

Convenções do repositório que valem aqui:

- `documentosTexto()` e `documentosComprovanteHTML()` **do site** são sem acento
  de propósito. `TEMPLATE_LEMBRETE_PADRAO` e o `documentosComprovanteHTML()` **do
  painel** são com acento. Mantenha cada um como está.
- Nada de `innerHTML` com valor vindo do usuário. Texto fixo pode ser montado por
  `textContent`/nós, preservando os `<strong>` por elemento.
- Comentário no código explica o porquê, não o quê.

## Mudança 1 — tirar documentos e aviso da taxa da tela de preenchimento

Na tela de preenchimento ninguém lê a lista, na pressa de agendar. Ela já existe,
completa, na tela de sucesso.

- **Remova** o bloco `.docs-container.compacto` inteiro de `#dados-pessoais`
  (`public/index.html:396-406`), com o `data-aviso-taxa` que vive dentro dele.
- **Remova** a tarja dos 6 meses logo abaixo (`public/index.html:407-410`). A
  ciência do bloqueio já está no texto do aceite `#aceite-lgpd`; não a repita.
- Não mexa no aceite nem no botão Continuar.

A tela de preenchimento fica com: tarja "dados de quem vai fazer o RG", os cinco
campos, o aceite e o botão. Confirme que `avancarParaDatas` e a validação
bloqueante continuam funcionando sem o bloco removido, e que nenhum seletor
aponta para o que deixou de existir.

## Mudança 2 — estado civil na tela de sucesso, orientando a certidão

Toda a personalização vive em `#sucesso-docs`, onde os documentos agora ficam.

- Adicione, **logo antes** da `.docs-container` de `#sucesso-docs`
  (`public/index.html:459`), um `<fieldset>` com `<legend>Qual é o seu estado
  civil?</legend>` e cinco opções em `radio`, cada `<input>` envolvido pelo
  `<label>` (área de toque de 44 px): **Solteiro(a)**, **União estável**,
  **Casado(a)**, **Viúvo(a)**, **Divorciado(a)**.
- É **opcional**. Sem seleção, a lista mostra a linha genérica atual.
- **Não guardar.** O estado civil vive só no cliente e serve só para escolher a
  dica. Nada vai para `confirmarAgendamento`, para o payload, para o Firestore ou
  para a anonimização.
- Uma função `atualizarDicaCertidao(estadoCivil)` substitui **a primeira `<li>`**
  da lista de `#sucesso-docs` (a da certidão) pela versão específica:

| Estado civil | Linha |
|---|---|
| Solteiro(a) | **Certidão de nascimento** — original ou cópia autenticada, sem rasgos, rasuras ou alterações. |
| União estável | **Certidão de nascimento** — original ou cópia autenticada, sem rasgos, rasuras ou alterações. |
| Casado(a) | **Certidão de casamento** — original ou cópia autenticada, sem rasgos, rasuras ou alterações. |
| Viúvo(a) | **Certidão de casamento com averbação do óbito** — original ou cópia autenticada. |
| Divorciado(a) | **Certidão de casamento com averbação do divórcio** — original ou cópia autenticada. |

- A `<li>` alterada precisa ser anunciada por leitor de tela: use `role="status"`
  ou `aria-live="polite"` nela, senão a troca passa despercebida.
- Foco de teclado visível em cada opção (o site já tem `:focus-visible`).

## Mudança 3 — "original ou cópia autenticada" em todas as superfícies

Hoje o texto diz só "Certidão original". A regra é **original ou cópia
autenticada**, sem exceção. Corrija a linha da certidão nas **sete** superfícies,
com o mesmo sentido em todas (com acento onde já há acento, sem acento onde o
arquivo é sem acento):

1. lista de `#sucesso-docs` (`.docs-container`, `public/index.html:459`);
2. `documentosTexto()` do site — WhatsApp e `.txt` (sem acento);
3. `documentosComprovanteHTML()` do site (sem acento);
4. `documentosComprovanteHTML()` do painel (`public/recepcao.js`, com acento);
5. `TEMPLATE_LEMBRETE_PADRAO` do painel (`public/recepcao.js`, com acento);
6. `docs/CONTEUDO-duvidas-frequentes.md` — resposta "Quais documentos preciso
   levar?" e onde mais a certidão for citada;
7. `public/duvidas.html` — o texto visível **e** o JSON-LD `FAQPage`, que precisam
   continuar idênticos entre si.

A linha genérica (sem estado civil escolhido) passa a ser algo como: "Certidão
original ou cópia autenticada, sem rasgos, rasuras ou alterações. Solteiros e em
união estável apresentam certidão de nascimento; casados, viúvos ou divorciados,
certidão de casamento, com averbação quando houver."

## Entrega

- `firebase.json` não muda. `npm --prefix functions test` tem de continuar
  passando (270/270).
- Resumo por arquivo com número de linhas, e quanto o `index.html` cresceu ou
  encolheu em bytes.
- Lista do que você **não** fez e por quê.
- Não faça deploy, commit ou push.
