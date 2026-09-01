# Prompt — auditar a inversão do agendamento e redesenhar a página de dúvidas

Cole o conteúdo abaixo como mensagem para o Codex. São **duas tarefas**
independentes num só passe. Branch: `reorganizacao-painel-recepcao`. **Não faça
deploy, commit ou push sem autorização expressa.**

---

Você tem duas tarefas. Leia `docs/PLANO-agendar-em-um-toque.md` e
`docs/CONTEUDO-duvidas-frequentes.md` antes de começar. Onde este prompt e os
planos divergirem, avise a divergência em vez de decidir sozinho.

Trate cada afirmação minha como hipótese. **Discordância fundamentada é o
produto.** Se algo estiver quebrado ou arriscado demais, reporte em vez de
remendar pela metade.

## Tarefa 1 — Auditar (e corrigir) a inversão do fluxo de agendamento

Foi implementada em `public/index.html` uma inversão do fluxo: antes era
**dia → horário → formulário → finalizar**; agora é **dados → dia → horário**, e o
toque no horário confirma o agendamento. O objetivo é tirar a digitação da janela
de disputa da abertura das 08:00.

A abordagem foi **reusar `confirmarAgendamento` sem reescrever a transação**: a
seção `#dados-pessoais` serve às duas fases por uma classe de modo
(`.modo-preencher` / `.modo-confirmar`), e o toque no horário auto-invoca
`confirmarAgendamento`. Os inputs continuam no DOM; `dataSel`/`horaSel` continuam
globais.

Peças novas em `public/index.html`: `mostrarTelaDados`, `avancarParaDatas`,
`voltarParaDados`, `voltarParaHorarios`, `selecionarHorarioEConfirmar`,
`persistirDadosAgendamento`, `restaurarDadosAgendamento`, `definirModoDados`,
`primeiroHorarioLivre`, `atualizarContadorVagasTopo`. Testes ajustados em
`functions/robustez-agendamento.test.js`. `npm --prefix functions test` deve dar
270/270.

**A parte crítica é a disputa de vagas.** Nada disto pode ter alterado
`criarAgendamentoCidadao`, a transação de vagas, a idempotência por `operationId`,
nem a regra de um agendamento por CPF. **Confirme que não alterou.** Se alterou,
esse é o achado mais importante.

Verifique, e corrija o que encontrar:

### Integridade da transação e do retry

- `confirmarAgendamento`, `abrirAlterarHorario` e o laço de retry ficaram
  **intactos**? A afirmação do plano é que só o gatilho mudou. Confira que nenhuma
  edição vazou para dentro deles.
- No caminho novo, se a criação falhar por rede num toque de horário, o usuário
  para na tela de confirmação com o `FINALIZAR` disponível, e as mensagens "clique
  em FINALIZAR novamente" voltam a fazer sentido? Percorra `unavailable`,
  `internal`, `deadline-exceeded`, `resource-exhausted`, `already-exists`
  (cpf-ja-agendado), `failed-precondition` e slot ocupado. Cada um deixa o usuário
  num estado recuperável?
- A pré-verificação `verificarDisponibilidadeSlotCidadao` saiu do toque, mas
  continua existindo para a reconciliação de slots ocultados
  (`revalidarSlotsOcupadosConfirmados`)? Confirme que não ficou órfã nem foi
  removida por engano.

### Estados e reentrância

- `atualizarBannerVagas`: com o formulário na frente (`#dados-pessoais` em
  `block`), `podeControlarCalendario` é `false` e o banner não força
  `#etapa-selecao` visível? A grade só deve aparecer depois de "Continuar".
- **Agenda fechada:** o formulário aparece primeiro mesmo sem datas. Ao tocar em
  "Continuar", o usuário cai numa grade vazia ("Nenhuma data disponível")? A
  mensagem é clara, ou ele fica sem saber o que fazer? Proponha o que for melhor.
- `agendarAtualizacaoAutomatica`: o reset de slot tomado (dados-pessoais em block
  + `dataSel && horaSel`) ainda funciona sem falso positivo na fase de
  preenchimento (onde `horaSel` é nulo)?
- Trocar de aba (Consultar/Cancelar) e voltar para Novo mantém o estado coerente?
  A classe de modo de `#dados-pessoais` nunca fica presa num estado que esconde o
  que deveria aparecer?
- "Voltar e revisar meus dados" e "Alterar" devolvem o usuário ao lugar certo, com
  os dados preservados?

### Dados no aparelho (LGPD)

- Os dados vão para `sessionStorage` (`cin_dados_agendamento`) antes de existir
  agendamento. Confirme que **nunca sobem ao servidor sem o toque num horário** e
  que somem ao fechar a aba. Isso **precisa** constar de
  `docs/POLITICA-PRIVACIDADE.md`, que hoje não menciona esse armazenamento local —
  anote como pendência (não invente texto de política).

### Validação e acessibilidade

- A validação bloqueante migrou para `avancarParaDatas`. Um campo inválido é
  barrado ali, e não só lá no toque do horário? Cobre nome, CPF, nascimento,
  telefone e o aceite.
- Os botões novos (`Continuar`, `Primeiro horário livre`, `Voltar e revisar`,
  `Alterar`) são `<button>` de verdade, com foco de teclado visível e rótulo
  acessível? O `Primeiro horário livre` (fundo verde `--success`, texto branco)
  passa em contraste AA? **Calcule.**
- Ao trocar de tela, o foco vai para o novo conteúdo (primeiro campo ou título),
  ou fica preso atrás? Hoje só há `scrollTo`. Se faltar gestão de foco, corrija.
- A caixa de declaração única (o `aceite-bloqueio` foi removido e o texto fundido
  no `aceite-lgpd`) ainda cobre as duas ciências — LGPD e bloqueio de 6 meses? E
  `destacarAceitesPendentes` não referencia mais o checkbox removido?

### Formato do relatório da Tarefa 1

Para cada achado: **o que é**, **onde** (`arquivo:linha`), **impacto**,
**correção**. Separe **Defeitos** (corrija), **Riscos** (funciona, mas depende de
suposição não verificada) e **Opiniões de design**. Aplique as correções dos
defeitos; para riscos, decida comigo antes.

## Tarefa 2 — Redesenhar a página de dúvidas (`public/duvidas.html`)

O conteúdo está certo, mas a página **está pesada, com texto demais e confusa**:
29 acordeões em fila, resumos longos, respostas em blocos densos, introdução
genérica. O leitor é municipal, idoso em boa parte, quase todo no celular. Ela
precisa ser **escaneável e leve**, não uma parede de texto.

**Refaça o design. Não reescreva os fatos.** Todo dado, prazo e as quatro
resoluções de conflito de `docs/CONTEUDO-duvidas-frequentes.md` precisam
sobreviver. Você **pode** encurtar frases prolixas — e, quando encurtar,
**atualize `docs/CONTEUDO-duvidas-frequentes.md` no mesmo passe**, porque ele é a
fonte da verdade e a página não pode divergir dele.

Restrições que não mudam:

- Acordeão nativo `<details>`/`<summary>` continua sendo a base. Um filtro de
  busca com JS é bem-vindo como **melhoria progressiva** (a página tem de
  funcionar sem JS).
- O JSON-LD `FAQPage` precisa continuar **estático e idêntico ao texto visível**.
  Se encurtar respostas, atualize o JSON-LD junto.
- Mesmo cabeçalho azul, mesma paleta e fonte de `public/index.html` (site é só
  tema claro — não precisa de dark). Caminho de volta ao agendamento no topo.
- `firebase.json` não muda. Alvos de toque de 44 px. `rel="noopener noreferrer"`
  nos links externos.

Direção de design (é o alvo; melhore se tiver ideia melhor, mas resolva os três
problemas — peso, excesso de texto, confusão):

- **Introdução:** uma linha, não um parágrafo.
- **Navegação por grupos no topo:** chips/âncoras que pulam para "Antes de
  agendar", "No dia", "Depois", "Sobre o documento", "Ainda com dúvida". Só
  `<a href="#...">`, sem JS. Ajuda a não rolar 29 itens.
- **Resposta que começa pela resposta:** a primeira linha responde direto (uma
  frase, com peso visual); o detalhe vem depois, para quem quiser. Hoje é o
  contrário — o leitor lê um parágrafo até achar o "sim" ou o "não".
- **Resumos (`summary`) curtos e diretos.** Corte redundância.
- **Menos moldura.** Hoje é cartão dentro de cartão dentro de cartão. Alivie
  bordas e sombras; deixe o branco trabalhar. Cabeçalho de grupo como sobrescrito
  discreto, não como outro bloco pesado.
- **Busca (opcional, recomendado):** um campo que filtra os `<details>` por texto,
  em JS, escondendo os que não batem. Grande ganho para 29 perguntas. Se
  implementar, mantenha tudo funcionando sem JS e o JSON-LD estático.
- **O aviso da taxa e o link do DAE** continuam visíveis e claros, sem gritar.

Quando terminar a Tarefa 2, me diga o que encurtou no conteúdo e confirme que o
JSON-LD e `docs/CONTEUDO-duvidas-frequentes.md` seguem idênticos ao texto visível.

## Geral

- `npm --prefix functions test` tem de continuar 270/270. Se você mexer em algo
  coberto por teste, ajuste o teste **para o novo contrato**, sem enfraquecê-lo, e
  explique.
- Ao terminar: resumo por arquivo com número de linhas, quanto o `index.html`
  cresceu ou encolheu em bytes, e a lista do que **não** fez e por quê.
- Não faça deploy, commit ou push.
