# Prompt — certidão (original ou cópia autenticada + estado civil) e avisos só na confirmação

Cole o conteúdo abaixo como mensagem para o Codex.

---

Implemente **duas mudanças** no site público do AgendamentoRG. Detalhe completo em
`docs/PLANO-estado-civil-documento.md` — **leia antes de começar**. Onde este
prompt e o plano divergirem, o plano está certo; avise a divergência em vez de
decidir sozinho.

Branch: `reorganizacao-painel-recepcao` (é a que tem o fluxo invertido e a tela de
confirmação). **Não faça deploy, commit ou push sem autorização expressa.**

## Contexto que não pode ser quebrado

O fluxo já foi invertido: `#dados-pessoais` serve às duas fases por classe de modo
(`.modo-preencher` / `.modo-confirmar`, com `.so-preencher` / `.so-confirmar`), e a
tela de sucesso é `#sucesso-docs`.

**A parte crítica é a disputa de vagas.** Nada aqui pode tocar
`criarAgendamentoCidadao`, a transação de vagas, a idempotência por `operationId`
nem o payload do agendamento. As duas mudanças são **de interface e de texto**;
nenhuma grava dado novo. Se precisar mexer no caminho crítico, pare e explique.

Convenções: `documentosTexto()` e `documentosComprovanteHTML()` **do site** são sem
acento; `TEMPLATE_LEMBRETE_PADRAO` e o comprovante **do painel** (`recepcao.js`)
são com acento — mantenha cada um. Nada de `innerHTML` com valor vindo do usuário.

---

## Mudança 1 — Certidão: "original ou cópia autenticada" + estado civil

### 1a. Texto "original ou cópia autenticada"

Hoje as superfícies dizem só "Certidão original". A regra é **original OU cópia
autenticada**, sem exceção. Corrija nas **sete superfícies** que citam a certidão,
com o mesmo sentido em todas:

1. checklist da tela de sucesso (`.docs-container`, `#sucesso-docs`);
2. `documentosTexto()` do site — WhatsApp e `.txt` (sem acento);
3. `documentosComprovanteHTML()` do site (sem acento);
4. `documentosComprovanteHTML()` do painel (`public/recepcao.js`, com acento);
5. `TEMPLATE_LEMBRETE_PADRAO` do painel (`public/recepcao.js`, com acento);
6. `docs/CONTEUDO-duvidas-frequentes.md` — resposta "Quais documentos preciso
   levar?" e onde mais a certidão apareça;
7. `public/duvidas.html` — o texto visível **e** o JSON-LD `FAQPage`, que precisam
   continuar idênticos entre si.

Ao aplicar, **tire o "original" repetido** nas linhas que dizem qual certidão levar
por estado civil (ex.: "certidão de nascimento original" → "certidão de
nascimento"). A regra de original-ou-cópia já fica na primeira linha; repetir
"original" ali contradiz a correção.

### 1b. Seletor de estado civil na tela de sucesso

Na `#sucesso-docs`, **logo antes** da lista de documentos, um `<fieldset>` com
`<legend>Qual é o seu estado civil?</legend>` e cinco opções em `radio`, cada
`<input>` envolvido pelo `<label>` (área de toque de 44 px): **Solteiro(a)**,
**União estável**, **Casado(a)**, **Viúvo(a)**, **Divorciado(a)**.

- **Opcional.** Sem seleção, a lista mostra a linha genérica.
- **Não guardar.** Vive só no cliente, para escolher a dica. Nada vai para
  `confirmarAgendamento`, para o payload, para o Firestore ou para a anonimização.
- Uma função `atualizarDicaCertidao(estadoCivil)` substitui **a primeira `<li>`**
  da lista (a da certidão) pela versão específica:

| Estado civil | Linha |
|---|---|
| Solteiro(a) | **Certidão de nascimento** — original ou cópia autenticada, sem rasgos, rasuras ou alterações. |
| União estável | **Certidão de nascimento** — original ou cópia autenticada, sem rasgos, rasuras ou alterações. |
| Casado(a) | **Certidão de casamento** — original ou cópia autenticada, sem rasgos, rasuras ou alterações. |
| Viúvo(a) | **Certidão de casamento com averbação do óbito** — original ou cópia autenticada. |
| Divorciado(a) | **Certidão de casamento com averbação do divórcio** — original ou cópia autenticada. |

- Texto fixo, montado por `textContent`/nós, mantendo os `<strong>` por elemento.
- A `<li>` alterada precisa ser anunciada por leitor de tela (`role="status"` ou
  `aria-live="polite"`), senão a troca passa despercebida.
- Foco de teclado visível em cada opção.

## Mudança 2 — Documentos e aviso da taxa só na confirmação

Na tela de preenchimento ninguém lê a lista, na pressa de agendar. Ela já existe
completa na tela de sucesso.

- **Remova** o bloco `.docs-container.compacto` inteiro de `#dados-pessoais`, com o
  `data-aviso-taxa` que vive dentro dele.
- **Remova** a tarja dos 6 meses logo abaixo. A ciência do bloqueio já está no
  texto do aceite `#aceite-lgpd`; não a repita.
- Não mexa no aceite nem no botão Continuar.

A tela de preenchimento fica com: tarja "dados de quem vai fazer o RG", os cinco
campos, o aceite e o botão. Confirme que `avancarParaDatas` e a validação
bloqueante seguem funcionando sem o bloco removido, e que nenhum seletor aponta
para o que deixou de existir.

**Nada se perde:** a lista e o aviso da taxa continuam na `#sucesso-docs`, no
comprovante, no WhatsApp, no lembrete e no bloco "Documentos necessários" da grade.
O cidadão recebe o que levar depois de ter a vaga na mão, não durante a corrida.

## Entrega

- `firebase.json` não muda. `npm --prefix functions test` tem de continuar
  passando.
- Verifique a sintaxe do JS carregando a página, não só por inspeção.
- Resumo por arquivo com número de linhas, e quanto o `index.html` cresceu ou
  encolheu em bytes.
- Lista do que você **não** fez e por quê.
- Não faça deploy, commit ou push.
