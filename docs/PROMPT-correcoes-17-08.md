# Prompt — correções para a abertura de 17/08/2026

Cole o conteúdo abaixo como mensagem inicial para o agente.

---

Você vai aplicar correções no projeto **AgendamentoRG** (`C:\Users\Camara\Desktop\AgendamentoRG\agendamentorg`), um sistema de agendamento de CIN da Câmara de Itanhandu em Firebase (Hosting + Cloud Functions v2 + Firestore + Realtime Database).

**Contexto operacional:** na segunda-feira 17/08/2026 às 08:00 (America/Sao_Paulo) a agenda da semana abre automaticamente com **40 vagas** (terça a sexta, 18 a 21/08, 10 horários por dia). Espera-se de centenas a alguns milhares de acessos simultâneos. A maioria das pessoas ficará sem vaga — isso é aritmética, não defeito. O objetivo das correções é garantir que **ninguém receba um falso "sem vagas", fique preso numa tela desatualizada ou perca os dados preenchidos**, e que nenhum efeito colateral operacional atinja o posto.

As alterações estão todas no working tree (não commitadas). Trabalhe sobre o estado atual dos arquivos.

## Regras de trabalho

- Idioma do código e dos comentários: português sem acentuação nos arquivos `.js` do backend (siga o padrão existente em `functions/index.js`). No frontend, siga o padrão de cada arquivo.
- Não faça commit nem push sem eu pedir.
- Não rode `firebase deploy` em hipótese alguma.
- Rode `node --test` em `functions/` após cada alteração no backend e mantenha a suíte verde.
- Ao final de cada item, resuma o que mudou e por quê. Se um item se mostrar inviável ou mais arriscado do que o descrito, **pare e me avise antes de prosseguir** em vez de improvisar.
- Preserve o comportamento já correto: a proteção "data já publicada nunca é removida automaticamente", o retry com classificação de erro transiente em `criarAgendamentoCidadao`, e a chave de cache compartilhada por minuto (ver item 3).

---

## P0 — obrigatórios antes de 17/08

### 1. Grade de horários por data, com corte em 18/08/2026

**Problema.** A grade nova de 10 horários (`14:30, 14:45, 15:00, 15:15, 15:30, 15:45, 16:00, 16:15, 16:30, 16:45`) está sendo aplicada também a datas antigas, que usam a grade legada de 8 (`14:20, 14:40, 15:00, 15:20, 15:40, 16:00, 16:20, 16:40`). Só `15:00` e `16:00` são comuns. Numa data já publicada com os 8 slots legados ocupados, os 8 novos horários livres voltam a ser agendáveis: o dia pode chegar a **16 atendimentos**, com pares separados por 10 minutos (14:20 e 14:30, 14:40 e 14:45, 15:20 e 15:30…). É um risco de superlotação do posto.

**Pontos onde a união indevida acontece:**
- `functions/index.js:642` — `normalizarListaHorarios([...horariosConfig, ...HORAS_FALLBACK])` dentro de `processarAgenda`
- `functions/index.js:281-284` — `migrarGradeLegada()`, que troca a grade legada pela nova sempre que a lista armazenada for exatamente igual à legada
- `functions/index.js:286-296` — `normalizarHorariosPorDiaSemana()`, que chama `migrarGradeLegada`
- `public/index.html:542-545` — `horariosAtivos()`
- `public/recepcao.html` — `ordenarHorarios()` e `normalizarHorariosSemana()`

**O que fazer.**

Introduza uma constante de corte, `DATA_CORTE_GRADE_NOVA = "2026-08-18"`, e faça a grade ser resolvida **por data**:

- `dataISO < DATA_CORTE_GRADE_NOVA` → grade legada (ou a grade configurada para aquela data, se houver uma explícita em `horariosPorDiaSemana`)
- `dataISO >= DATA_CORTE_GRADE_NOVA` → grade nova

Requisitos:

1. **Remova `migrarGradeLegada` inteiramente.** A tradução em memória a cada leitura é a origem do problema; a resolução passa a ser por data, não por igualdade de lista.
2. **Elimine a união cega com `HORAS_FALLBACK`.** O fallback só deve valer quando não existir grade configurada para a data, e nesse caso deve ser a grade correspondente ao lado do corte.
3. **`checarDisponibilidade` (`functions/index.js:662-673`) e `horariosParaData` (`functions/index.js:303-309`) devem usar exatamente a mesma resolução por data** que a listagem pública. Isso é o que impede que um horário novo apareça numa data antiga e que um agendamento legado se torne irremarcável.
4. Aplique a mesma lógica no frontend público e no painel da recepção, para que os três concordem. Extraia a resolução para uma função única no backend e espelhe-a nos dois HTMLs (não há bundler no projeto; a duplicação é aceita, mas deixe um comentário cruzado apontando para a função canônica em `functions/index.js`).
5. Datas com grade explícita salva em `horariosPorDiaSemana` continuam mandando: o corte só decide o **padrão**, nunca sobrescreve configuração manual da recepção.

**Testes obrigatórios** em `functions/agenda-automation.test.js` (ou num novo `functions/agenda-grade.test.js`, se a lógica não couber no módulo de automação — nesse caso extraia-a para um módulo próprio e puro, no mesmo estilo de `agenda-automation.js`):

- data 17/08/2026 → exatamente a grade legada de 8, sem nenhum horário novo
- data 18/08/2026 → exatamente a grade nova de 10, sem nenhum horário legado
- data anterior ao corte com grade explícita configurada → devolve a configurada, ignorando o corte
- um agendamento existente às `14:20` numa data anterior ao corte continua passando por `checarDisponibilidade`
- `14:30` numa data anterior ao corte é **rejeitado**

### 2. Desativar a telemetria de presença pública

**Problema.** Cada visitante escreve um nó em `presenca_publica/conexoes`; cada escrita dispara `registrarMetricasAcessoPublico` (`functions/index.js:1095`), e cada invocação lê o nó `conexoes` **inteiro** (`functions/index.js:255-258`) e disputa uma transação no nó único `presenca_publica/metricas`. É O(N²) em banda de RTDB e todas as invocações contendem no mesmo nó. Não traz benefício ao cidadão e é o único componente com risco real de saturação no pico.

**O que fazer.**

- Trocar `METRICAS_ACESSO_PUBLICO_ATIVAS` para `false` em `public/index.html:438`.
- **Não remover** o código dos gatilhos, das regras nem do painel — a funcionalidade volta no item 6.
- Em `public/recepcao.html`, os três cartões de acesso (`acessos-agora`, `acessos-pico-hoje`, `acessos-total-hoje`) devem exibir um estado explícito de "medição desativada" em vez de `—` ou `0`, para que a recepção não interprete zero como "ninguém acessou".
- Registre no `README.md`, na seção de monitoramento, que a telemetria está desativada e sob qual condição volta (item 6 concluído).

### 3. Atualização resiliente na virada das 08:00

**Problema.** `iniciarContadorRegressivo` (`public/index.html:1852-1870`) faz **uma única tentativa** quando o contador zera. No `catch`, degrada para `🎉 Vagas liberadas! Clique aqui para atualizar`. Uma oscilação de rede de 2 segundos deixa preso exatamente quem esperou a abertura. O alvo do contador vem do relógio local, então um celular adiantado dispara antes da hora e falha.

**O que fazer.**

- **Manter a chave de cache compartilhada por minuto** (`?atualizar-minuto=`, `public/index.html:585-591`). Ela é o que impede que alguém receba por até 60 segundos a resposta fechada das 07:59. Não remova nem altere esse mecanismo.
- Substituir a tentativa única por **retentativas automáticas por até 60 segundos**, com backoff (por exemplo 0s, 2s, 4s, 7s, 11s, 16s…), parando assim que a resposta trouxer datas disponíveis.
- Durante a espera, exibir `Liberando vagas, mantenha esta página aberta` com indicador de progresso. O link manual de atualizar só aparece **depois** de esgotados os 60 segundos.
- **Nunca zerar `DISPONIBILIDADE_PUBLICA`, `DIAS_DISPONIVEIS` ou `HORARIOS` em caso de erro** quando já houver agenda válida em memória. Verifique o bloco `catch` de `carregarConfig` (`public/index.html:641-648`): hoje ele só limpa quando `!DIAS_DISPONIVEIS.length`, o que está correto — confirme que o novo fluxo de retry preserva essa garantia.
- Disparar uma nova tentativa quando a aba voltar ao foco (`visibilitychange`) ou a conexão retornar (`online`), com guarda para não empilhar chamadas concorrentes.
- **Usar hora do servidor.** Adicione um campo `servidorEm` (ISO, America/Sao_Paulo) à resposta de `carregarDisponibilidadePublica` em `functions/index.js`, calcule o desvio em relação ao relógio local na primeira resposta e use o horário corrigido em `alvoContadorNovasVagas`. Se o campo não vier, caia no relógio local sem quebrar.
- Quando as 40 vagas realmente acabarem, a mensagem deve ser inequívoca — `As 40 vagas desta semana foram preenchidas` com a data da próxima abertura — e **nunca** se parecer com falha técnica. Diferencie visualmente "lotado" de "erro ao carregar".

### 4. Remover o fallback que aponta para o RTDB de produção

`functions/index.js:17-20` tem:

```js
databaseURL: process.env.FIREBASE_DATABASE_URL || "https://agendamento-cin-itanhandu-default-rtdb.firebaseio.com"
```

Um deploy em homologação sem a variável definida grava em **produção**. Em Cloud Functions, `FIREBASE_CONFIG` já traz o `databaseURL` do projeto correto, então `initializeApp()` sem argumentos resolve sozinho e se adapta por projeto. Faça essa troca e confirme que `getDatabase()` continua funcionando (rode `node --check` e valide que nada mais no arquivo depende da URL explícita).

### 5. Bloquear produção no teste de contenção

`tests/load/booking-contention.js` cria agendamentos reais e sua única trava é `CONFIRM_HOMOLOGATION=SIM`. Como as instruções do `README.md` usam `$env:` no PowerShell, a variável persiste na sessão — uma `FUNCTION_URL` trocada por engano depois disso roda sem guarda.

Adicione uma **denylist explícita** que aborte se a URL contiver `agendamento-cin-itanhandu`, independentemente de qualquer variável de confirmação. Espelhe a mesma proteção em `tests/load/agenda-read.js`, que hoje só tem uma allowlist por padrão de nome. Atualize `tests/load/README.md` descrevendo a proteção.

---

## P1 — depois da abertura, ou antes se houver folga

### 6. Telemetria de presença correta (pré-requisito para religar o item 2)

Não basta trocar o `once("value")` por um contador único: Functions orientadas a eventos têm entrega **at-least-once**, e um nó único mantém a contenção. Requisitos:

- **Idempotência.** Use o `conexaoId` como chave de deduplicação; grave um marcador em `presenca_publica/sessoes/{conexaoId}` e ignore o evento se o marcador já existir com o mesmo estado. Um evento reentregue não pode contar duas vezes.
- **Sharding.** Distribua o contador em N shards (por exemplo 10), escolhendo o shard por hash do `conexaoId`. O painel soma os shards na leitura.
- **Sem leitura O(N).** `quantidadeConexoesPublicasAtivas()` (`functions/index.js:255-258`) deve deixar de existir no caminho quente. A contagem real fica para a reconciliação da rotina diária.
- **Reconciliação.** Em `limparSessoesAcessoPublico`, após a limpeza, recalcule a contagem verdadeira uma vez por dia e reescreva os shards.
- Só religue `METRICAS_ACESSO_PUBLICO_ATIVAS` depois de validar em homologação com carga.

### 7. Limpeza de sessões em laço

`functions/index.js:1610-1616` usa `limitToFirst(1000)` **uma vez por dia, sem laço**. Uma abertura com 1.500 acessos leva mais de um dia para ser limpa; com média acima de 1.000/dia o acúmulo é permanente. Converta para laço até esvaziar, com teto de segurança e paginação, no mesmo padrão de `limparColecaoExpirada` (`functions/index.js:1550-1566`).

Atenção ao efeito colateral: o `raiz.update()` que remove conexões dispara `atualizarMetricasSaidaAcessoPublico` para cada uma. Com o item 6 aplicado o custo por evento cai, mas avalie suprimir o gatilho durante a manutenção (por exemplo, marcando a limpeza num nó de controle que o gatilho consulta antes de agir).

### 8. Aviso de novas vagas não pode congelar

Em `prepararAgendaSemanalAutomatica` (`functions/index.js:1404`), quando `proximaSemanaComAtendimento()` devolve `null` (limite de 104 semanas ou tudo bloqueado), `avisoNovasVagasProgramado` não é atualizado e `avisoNovasVagasAtivo()` (`functions/index.js:311-319`) continua servindo a data antiga indefinidamente. Trate o caso: limpe o aviso programado ou substitua por um texto neutro do tipo "data a definir", e registre em `logs_admin`.

### 9. Rate limit por User-Agent — avaliar antes de mexer

`fingerprintRequisicao` (`functions/index.js:474-480`) usa `hash(ip | user-agent | extra)`. Rotacionar o User-Agent zera o contador, e `carregarAgendaPublicaHttp` não tem App Check, então esse rate limit é o único controle de abuso do endpoint público.

**Não remova o User-Agent sem análise.** Itanhandu é uma cidade pequena; muitos cidadãos podem estar atrás do mesmo IP (rede da prefeitura, lan house, CGNAT da operadora móvel). Um limite de 240/10min por IP puro pode bloquear gente legítima justamente às 08:00 — o oposto do objetivo.

Entregue primeiro uma **análise escrita** com as opções (manter como está; separar limites por endpoint; usar App Check no endpoint HTTP; limite por IP com teto mais alto e janela menor) e o risco de falso positivo de cada uma. Só implemente depois que eu escolher.

### 10. Regras do RTDB alinhadas ao modelo de admin

`database.rules.json` libera leitura de `presenca_publica/*` para `auth != null`, enquanto todo o resto do sistema usa `isAdmin()` (`firestore.rules:8-12`, que exige documento ativo em `admins/{email}`). As regras do RTDB não conseguem consultar o Firestore; avalie replicar uma lista de admins no RTDB ou mover a leitura das métricas para uma callable com `assertAdmin`. Sem PII envolvida, então é prioridade baixa — mas a inconsistência deve ficar registrada.

### 11. Script de pré-aquecimento parametrizável

`scripts/preaquecer-ligar.ps1:16` fixa `$env:PICO_MIN_INSTANCES = "1"` e faz deploy **somente** de `criarAgendamentoCidadao`. Consequência: `PICO_MIN_INSTANCES_LEITURA` (`functions/index.js:70`) é `PICO_MIN_INSTANCES > 1 ? ... : 0`, logo a leitura **nunca** recebe instância quente por esse script, e definir a variável antes de chamá-lo não tem efeito algum.

Isso é coerente com a estratégia de custo documentada no `README.md` (leitura em escala zero, absorvida pelo CDN) e **deve permanecer o padrão** — instâncias mínimas custam mesmo ociosas.

O que fazer: aceitar parâmetros (`-MinInstances`, `-IncluirLeitura`) sem alterar o comportamento padrão, e documentar no cabeçalho do script que, sem `-IncluirLeitura`, a leitura permanece em zero por decisão de custo. Atualize também `preaquecer-desligar.ps1` para simetria.

---

## Ordem de execução

Faça 1 → 2 → 3 → 4 → 5, parando ao fim de cada item para eu revisar. Os itens P1 só depois que eu confirmar os P0.

## Critério de pronto para os P0

- `cd functions && node --test agenda-automation.test.js` verde, incluindo os novos testes de grade por data
- `node --check functions/index.js` sem erro
- Nenhum horário da grade nova aparece em data anterior a 18/08/2026, em nenhuma das três superfícies (API pública, `index.html`, `recepcao.html`)
- Um agendamento legado às `14:20` continua visível, remarcável e cancelável
- Simulação da virada das 08:00 com falha de rede injetada: a página se recupera sozinha e a agenda válida nunca é apagada
- `grep` não encontra mais a URL do RTDB de produção fora de `.firebaserc` e `firebaseConfig` do frontend

## Verificação final antes da abertura

O ensaio local anterior (`tests/load/results/2026-08-13-local.md`) teve zero falhas, mas p95 de ~4 s e máximo de ~15 s, e não reproduz CDN nem escala horizontal — **não certifica produção**. Depois dos P0, rode os cenários de `tests/load/README.md` num projeto Firebase de homologação real, com a mesma configuração de Hosting, Functions e Firestore, e registre o resultado em `tests/load/results/`.
