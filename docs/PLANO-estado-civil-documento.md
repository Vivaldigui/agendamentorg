# Plano — estado civil orienta o documento, e documentos só após confirmar

Decidido em 18/09/2026. Ainda **não implementado**. Mexe no formulário público,
então entra junto da revisão do fluxo (`docs/PLANO-agendar-em-um-toque.md`), nunca
solto nas horas de uma abertura.

São **duas mudanças** que se completam:

1. Tirar a lista de documentos e o aviso da taxa da tela de preenchimento —
   ninguém lê isso na pressa de agendar. Documentos aparecem **só depois de
   confirmar**.
2. Na tela de confirmação, perguntar o **estado civil** e mostrar **a certidão
   daquela pessoa**, em vez da linha genérica que cobre todos os casos.

---

## Mudança 1 — documentos saem da tela de preenchimento

Hoje a tela de preenchimento (`#dados-pessoais`, fase `.modo-preencher`) mostra a
`.docs-container.compacto` — "Confira os documentos antes de finalizar" — com a
lista inteira e o aviso da taxa dentro (`public/index.html:396-406`). É o que a
pessoa vê enquanto está com pressa de digitar e reservar. Ninguém lê.

**Remover o bloco `.docs-container.compacto` inteiro** de `#dados-pessoais`,
com o `data-aviso-taxa` que vive dentro dele. A tela de preenchimento fica só com:
tarja "dados de quem vai fazer o RG", os cinco campos, o aceite e o botão
Continuar.

**Não se perde informação.** A lista completa já existe na tela de sucesso
(`.docs-container`, "Documentos Obrigatórios", `public/index.html:459-469`), e
ainda vai para o comprovante em PDF, o texto do WhatsApp, o lembrete e o bloco
"Documentos necessários" da grade. O cidadão recebe o que levar **depois de ter a
vaga na mão** — no momento em que efetivamente lê —, não durante a corrida.

**Remover também a tarja dos 6 meses** (`public/index.html:407-410`): o texto dela
já está repetido dentro do próprio aceite (`#aceite-lgpd`), então a tarja separada
é redundante. Decisão sua. O aceite continua carregando a ciência do bloqueio.

## Mudança 2 — estado civil na tela de sucesso

Com os documentos agora só na tela de sucesso, é lá que entra a personalização.

Um grupo de opção **acima** da lista "Documentos Obrigatórios", dentro de
`#sucesso-docs`:

```
Qual é o seu estado civil?
( ) Solteiro(a)   ( ) União estável   ( ) Casado(a)   ( ) Viúvo(a)   ( ) Divorciado(a)
```

- **Botão de opção (`radio`), não texto nem `<select>`.** Um toque. Cinco opções
  em `<label>` que envolvem o `<input>`, área de toque de 44 px.
- **Opcional.** Sem marcar, a lista mostra o texto genérico atual, que já cobre
  todos os casos. Estado civil *estreita* a orientação, não bloqueia nada —
  marcar errado só mostra uma dica um pouco fora, risco baixo.
- **Não é guardado.** Decisão sua confirmada: o estado civil vive só no navegador,
  para escolher a dica. Nada vai para `confirmarAgendamento`, nada é gravado, nada
  entra na anonimização nem na política de privacidade. A minimização de dados
  (art. 6º, III) que a auditoria elogiou continua intacta.

### Como a dica reage

Ao marcar, a **primeira `<li>`** da lista (a da certidão) é substituída pela
versão específica:

| Estado civil | Linha exibida |
|---|---|
| Solteiro(a) | **Certidão de nascimento** — original ou cópia autenticada, sem rasgos, rasuras ou alterações. |
| União estável | **Certidão de nascimento** — original ou cópia autenticada, sem rasgos, rasuras ou alterações. |
| Casado(a) | **Certidão de casamento** — original ou cópia autenticada, sem rasgos, rasuras ou alterações. |
| Viúvo(a) | **Certidão de casamento com averbação do óbito** — original ou cópia autenticada. |
| Divorciado(a) | **Certidão de casamento com averbação do divórcio** — original ou cópia autenticada. |
| nenhum marcado | o texto genérico, listando todos os casos. |

União estável leva certidão de nascimento, como solteiro — decisão sua.

A averbação é o detalhe que não pode cair: é o caso que mais faz viúvo e
divorciado voltarem para casa. As duas linhas carregam a palavra "averbação"; o
texto genérico também.

## Mudança de conteúdo: "original ou cópia autenticada"

Hoje todas as superfícies dizem só **"Certidão original"**. A regra confirmada é
que vale **original OU cópia autenticada**, sem exceção. Isso é correção de
conteúdo, e — como já brigamos com divergência entre telas — precisa ficar
**igual nas sete superfícies de documento**, senão uma tela diz uma coisa e outra
diz outra:

- lista da tela de sucesso (`.docs-container`, `public/index.html:459`);
- `documentosTexto()` — WhatsApp e `.txt`;
- `documentosComprovanteHTML()` do site;
- `documentosComprovanteHTML()` do painel (`public/recepcao.js`);
- `TEMPLATE_LEMBRETE_PADRAO` do painel (`public/recepcao.js`);
- a resposta "Quais documentos preciso levar?" e a linha da certidão em
  `docs/CONTEUDO-duvidas-frequentes.md`;
- `public/duvidas.html` e o seu JSON-LD `FAQPage` (que espelha o item acima).

Onde o texto é sem acento de propósito (`documentosTexto` e
`documentosComprovanteHTML` do site), escrever "original ou copia autenticada".

## Onde encostar no código

Tudo em `public/index.html`, tudo no cliente:

- **Remover** `.docs-container.compacto` de `#dados-pessoais`
  (`public/index.html:396-406`) e a tarja dos 6 meses logo abaixo
  (`public/index.html:407-410`).
- **Adicionar** o `<fieldset>` de estado civil dentro de `#sucesso-docs`, logo
  antes da `.docs-container` (`public/index.html:459`).
- **Função `atualizarDicaCertidao(estadoCivil)`** troca o conteúdo da primeira
  `<li>` da lista de sucesso. Texto fixo, montado por `textContent` de cada trecho,
  mantendo o `<strong>` por elemento — **nada de `innerHTML` com valor do
  usuário**, no cuidado de sempre.
- **Reset:** ao "Voltar ao Início" a página recarrega (`location.reload()`), então
  a seleção zera sozinha.
- **Envio intocado:** `confirmarAgendamento` não muda. Nenhum campo novo no
  payload, no `payloadHash`, no backend, na anonimização.

## Acessibilidade

- `<fieldset>` com `<legend>Qual é o seu estado civil?</legend>`, para o leitor de
  tela anunciar o conjunto.
- Foco de teclado visível em cada opção (o site já tem `:focus-visible`).
- A troca da linha da certidão precisa ser anunciada: a `<li>` alterada num
  `role="status"` ou `aria-live="polite"`, senão quem usa leitor não percebe a
  mudança.

## Uma consequência que vale ter em mente

Tirar os documentos da tela de preenchimento significa que a pessoa **reserva o
horário antes de ver a lista**. Isso é aceitável — e provavelmente melhor —
porque a lista chega pela tela de sucesso, pelo comprovante, pelo WhatsApp, pelo
lembrete e pelo bloco "Documentos necessários" da grade. A informação não some;
ela para de disputar atenção com o botão de agendar. Se em uso aparecer gente
chegando sem documento, o caminho de volta é um lembrete curto de uma linha na
tela de preenchimento ("depois de agendar, confira os documentos"), não a lista
inteira.

## Decisões fechadas

- Estado civil **não é guardado** — só no navegador, para escolher a dica.
- Orientação **inline** (a lista reage), não popup.
- **União estável** entra na lista → certidão de nascimento.
- Certidão é **"original ou cópia autenticada"**, sem exceção, propagado nas sete
  superfícies.
- A **tarja dos 6 meses** sai da tela de preenchimento; o aceite mantém a ciência.
