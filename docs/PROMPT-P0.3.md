# Prompt — P0.3: atualização resiliente na virada das 08:00

Cole o conteúdo abaixo como mensagem para o Codex.

---

Implemente o **P0.3** do projeto AgendamentoRG. Leia antes `docs/HANDOFF.md` (seção “Estado real da configuração de produção”) e a descrição do P0.3 em `docs/PROMPT-correcoes-17-08.md`.

## Situação

Na segunda-feira 17/08/2026 às 08:00 (`America/Sao_Paulo`) a agenda da semana é liberada. Muita gente vai estar com a página aberta esperando o contador zerar. Hoje, quem esperou é justamente quem corre mais risco de ficar preso numa tela desatualizada.

P0.1 e P0.2 já estão aplicados e revisados. A suíte tem **26 testes passando** — mantenha-a verde.

## Arquivos

**Pode alterar:** `public/index.html`, `functions/index.js`, e um arquivo de teste novo em `functions/`.

**Não altere:** `public/recepcao.html` (está sendo trabalhado em paralelo — qualquer edição sua ali vai conflitar), `functions/agenda-grade.js`, `functions/agenda-automation.js`.

Em `functions/index.js` há correções recentes de `FieldValue.delete()` em `limparDatasPassadasAgenda` e `prepararAgendaSemanalAutomatica`. **Não as reverta.**

## O problema

`iniciarContadorRegressivo` ([public/index.html:1863](public/index.html:1863)) faz **uma única tentativa** quando o contador zera:

```js
carregarConfig({ ignorarCache: true }).then(...).catch(() => {
    el.innerHTML = '... 🎉 Vagas liberadas! <a href="#" onclick="location.reload()">Clique aqui para atualizar</a>';
});
```

Uma oscilação de rede de dois segundos às 08:00:00 empurra o cidadão para um link manual. Pior: o alvo do contador vem de `alvoContadorNovasVagas` ([public/index.html:527](public/index.html:527)), que usa o **relógio local** — um celular adiantado dispara antes da hora, falha, e cai no mesmo beco.

## Requisitos

### 1. Retentativas por até 60 segundos, com jitter

Ao zerar o contador, tentar repetidamente até obter datas disponíveis, por no máximo 60 segundos. Backoff crescente (por exemplo 0s, 2s, 4s, 7s, 11s, 16s, 22s).

**Some um jitter aleatório de até 1,5 s a cada tentativa.** Sem isso, milhares de navegadores retentam em uníssono e o próprio mecanismo de resiliência vira um ataque sincronizado contra a origem no pior segundo possível. Este item não é opcional.

Interromper assim que a resposta trouxer datas. Só depois de esgotados os 60 segundos exibir o link manual.

### 2. Manter a chave de cache compartilhada

As retentativas devem usar `carregarConfig({ ignorarCache: true })`, que gera `?atualizar-minuto=N` em `buscarAgendaPublicaAtualizada` ([public/index.html:593](public/index.html:593)). Todos os clientes do mesmo minuto compartilham a chave, então o CDN serve a mesma resposta.

**Não remova nem altere esse mecanismo.** Ele é o que impede alguém de receber por 60 segundos a resposta fechada das 07:59.

### 3. Mensagem de espera

Durante as tentativas, exibir `Liberando vagas, mantenha esta página aberta` com indicador de progresso. Nada de mensagem de erro enquanto ainda há tentativas pela frente.

### 4. Nunca descartar agenda válida

O `catch` de `carregarConfig` ([public/index.html:655](public/index.html:655)) só zera `DISPONIBILIDADE_PUBLICA` quando `!DIAS_DISPONIVEIS.length`. Isso está correto — **garanta que o novo fluxo preserve essa propriedade**. Uma falha de rede nunca pode apagar do ecrã uma agenda que já estava carregada.

### 5. Retomar em `online` e `visibilitychange`

Disparar nova tentativa quando a conexão voltar ou a aba voltar ao foco. **Use uma guarda para não empilhar execuções concorrentes** — os dois eventos podem disparar juntos.

### 6. Hora do servidor

Adicionar `servidorEm` (formato `YYYY-MM-DDTHH:MM`, `America/Sao_Paulo`) ao retorno de `carregarDisponibilidadePublica` ([functions/index.js:706](functions/index.js:706)); já existe `agoraSaoPauloInput()` no arquivo.

No cliente, calcular o desvio em relação ao relógio local na primeira resposta e usar o horário corrigido em `alvoContadorNovasVagas`. Se o campo não vier, cair no relógio local sem quebrar.

### 7. Lotação não pode parecer falha técnica

Quando as vagas realmente acabarem, a mensagem deve ser inequívoca e **diferenciada visualmente** de um erro de carregamento.

**Não escreva “40 vagas” em lugar nenhum.** Esse número não é fixo: hoje a produção tem 3 dias cadastrados, e o quarto depende de ações ainda pendentes. Use `DISPONIBILIDADE_PUBLICA.totalVagasRestantes` e a contagem real vinda da API. Se precisar do total do dia, derive de `porData[dataISO].horarios.length`.

Três estados distintos, sem ambiguidade entre eles:

| Estado | Como deve aparecer |
|---|---|
| ainda carregando / retentando | “Liberando vagas, mantenha esta página aberta” |
| carregou e não há vaga | mensagem de lotação, com a próxima data de abertura |
| falhou depois de 60 s | erro técnico, com ação manual |

## Não quebre

- `METRICAS_ACESSO_PUBLICO_ATIVAS` continua `false`. Não reative.
- `agendarAtualizacaoAutomatica` ([public/index.html:1380](public/index.html:1380)) tem lógica cuidadosa para quando o cidadão está no meio do formulário: se o horário escolhido some, ele preserva os dados digitados e devolve à seleção com aviso. **Preserve isso.**
- O retry transiente de `criarAgendamentoCidadao` e a preservação de dados na perda de vaga.

## Testes

Crie `functions/atualizacao-abertura.test.js` seguindo o padrão de `functions/telemetria-publica.test.js` e `functions/painel-grade-editor.test.js`: extraia funções de `public/index.html` e execute-as. O script `npm test` usa `node --test`, então o arquivo é descoberto sozinho.

Cubra no mínimo:

- a janela de retentativa é de 60 s e existe jitter no cálculo do intervalo
- há tratamento para `online` e `visibilitychange`, com guarda contra concorrência
- o backend devolve `servidorEm`
- o cliente usa `servidorEm` no cálculo do alvo e tem fallback quando o campo falta
- nenhuma string com “40 vagas” ou número fixo de vagas no HTML
- a chave `?atualizar-minuto=` continua presente

## Critério de pronto

- `npm --prefix functions test` verde, com os testes novos
- `node --check functions/index.js` sem erro
- JavaScript embutido dos dois HTMLs com sintaxe válida
- `git diff --check` limpo
- `public/recepcao.html` **não** aparece em `git status`
- simulação de falha de rede na virada: a página se recupera sozinha e a agenda válida nunca é apagada

## Regras

Não faça deploy, commit nem push. Pare ao final para revisão. Se algum item se mostrar mais arriscado do que o descrito aqui, pare e comunique antes de improvisar.
