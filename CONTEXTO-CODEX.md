# Contexto para continuar o AgendamentoRG em outro computador

Última atualização: 13/08/2026.

## Como retomar

No outro computador:

```powershell
git clone https://github.com/Vivaldigui/agendamentorg.git
cd agendamentorg
git switch preparacao-abertura-17-08
npm install
npm --prefix functions install
npm --prefix functions test
```

Depois, abra a pasta no Codex e envie:

> Leia `CONTEXTO-CODEX.md`, `docs/HANDOFF.md` e `docs/PROMPT-correcoes-17-08.md`. Confira o Git e os testes e continue a partir do P0.3. Pare ao final de cada P0 para revisão. Não faça deploy, commit ou push sem autorização expressa.

## Estado do Git

- Repositório: `https://github.com/Vivaldigui/agendamentorg.git`
- Branch de trabalho: `preparacao-abertura-17-08`
- Commit presente localmente e no remoto antes da criação deste arquivo: `77442e5`
- Mensagem do commit: `Preparacao para a abertura de 17/08: grade por data e telemetria desligada`
- Este arquivo foi solicitado separadamente; sua criação não autoriza commit, push ou deploy.

## Contexto operacional

O sistema agenda atendimentos de CIN da Câmara de Itanhandu usando Firebase Hosting, Cloud Functions v2, Firestore e Realtime Database.

Na segunda-feira, 17/08/2026, às 08:00 (`America/Sao_Paulo`), deve abrir automaticamente a agenda de terça a sexta, 18 a 21/08, com 10 horários por dia e 40 vagas no total:

`14:30, 14:45, 15:00, 15:15, 15:30, 15:45, 16:00, 16:15, 16:30, 16:45`

O objetivo prioritário é impedir falso “sem vagas”, tela desatualizada na virada das 08:00, perda de dados preenchidos e sobrecarga causada por componentes que não são essenciais ao agendamento. Manter o custo o mais próximo possível da gratuidade.

## Trabalho concluído

### P0.1 — grade por data

Implementado e aprovado no código:

- Corte em `2026-08-18`.
- Datas anteriores usam a grade legada de 8 horários.
- Datas a partir do corte usam a grade nova de 10 horários.
- Configuração manual explícita em `horariosPorDiaSemana` continua prevalecendo, inclusive lista vazia.
- Regra canônica extraída para `functions/agenda-grade.js` e espelhada no site público e no painel.
- Removidas a migração implícita da grade legada e a união cega das duas grades.
- Testes executam também as funções extraídas dos dois HTMLs para evitar divergência entre backend, site e recepção.

### P0.2 — telemetria pública

Implementado e testado:

- `METRICAS_ACESSO_PUBLICO_ATIVAS = false` no site público.
- Nenhuma presença pública é escrita no RTDB enquanto a flag estiver desligada.
- O painel não inicia o monitoramento e mostra `Medição desativada` nos três cartões.
- Gatilhos e regras foram preservados para uma futura telemetria idempotente e distribuída em shards.
- O caminho de risco `visitante → conexões RTDB → gatilho com leitura O(N)` deixou de ser acionado.
- Testes de regressão estão em `functions/telemetria-publica.test.js`.

Validação registrada após P0.2:

- `npm --prefix functions test`: 18 de 18 testes aprovados.
- JavaScript embutido de `public/index.html` e `public/recepcao.html`: sintaxe válida.
- `git diff --check`: aprovado.

## Próximos itens P0

Executar nesta ordem, parando ao final de cada item para revisão:

1. **P0.3 — atualização resiliente às 08:00:** retry automático por até 60 segundos, backoff, hora do servidor, retomada em `online`/`visibilitychange`, preservação da agenda válida em memória e diferenciação clara entre lotação e falha técnica. Manter a chave compartilhada `?atualizar-minuto=`.
2. **P0.4 — inicialização segura do Firebase Admin:** remover o fallback hardcoded para o RTDB de produção e usar `initializeApp()` adaptado ao projeto.
3. **P0.5 — segurança dos testes de carga:** denylist explícita para impedir que os testes k6 atinjam `agendamento-cin-itanhandu`, independentemente das variáveis de confirmação.

Os P1, itens 6 a 11, somente devem começar após confirmação dos P0. O detalhamento completo está em `docs/PROMPT-correcoes-17-08.md`.

## Pendência bloqueante de dados

O documento versionado `docs/HANDOFF.md` registra que `configuracoes/agenda.horariosPorDiaSemana` contém seis chaves com a grade legada de 8 horários. Como configuração explícita prevalece, isso faria a semana de 18 a 21/08 abrir com 32 vagas, não 40.

A ação proposta é remover o campo inteiro antes da abertura, com backup e validação. Não substituir diretamente pela grade nova, pois o campo é indexado por dia da semana e poderia aplicar horários novos também a datas anteriores ao corte.

Há scripts de leitura e migração em:

- `scripts/ler-grade-agenda.js`
- `scripts/migrar-grade-por-dia.js`

Não executar `--aplicar` nem alterar o Firebase sem autorização expressa e autenticação no projeto correto.

## Armadilha do painel

Depois de remover `horariosPorDiaSemana`, o editor semanal do painel pode exibir o fallback novo. Se a recepção salvar, poderá recriar as chaves por dia da semana e desfazer a correção de dados. Antes de orientar a recepção a usar esse editor, implementar ao menos um aviso claro de que a alteração vale para todas as datas daquele dia da semana, inclusive datas anteriores a 18/08. O ideal é separar visualmente as grades “até 17/08” e “a partir de 18/08”.

## Teste de carga e custos

- O ensaio local em `tests/load/results/2026-08-13-local.md` registrou zero falhas, p95 próximo de 4 segundos e máximo próximo de 15 segundos.
- Esse ensaio não certifica produção: o emulador não reproduz CDN nem escala horizontal das Functions.
- Depois dos P0, executar os cenários descritos em `tests/load/README.md` somente em um projeto Firebase real de homologação.
- A leitura pública deve permanecer em escala zero por padrão para controlar custos; o CDN absorve a maior parte do pico.
- Pré-aquecimento custa enquanto houver instâncias mínimas. Não executar scripts de pré-aquecimento nem deploy sem autorização.

## Regras obrigatórias para a continuação

- Não executar `firebase deploy` sem autorização expressa.
- Não fazer commit nem push sem autorização expressa.
- Preservar alterações existentes e revisar o Git antes de editar.
- Rodar `npm --prefix functions test` após cada alteração no backend.
- Preservar a regra “data já publicada nunca é removida automaticamente”.
- Preservar o retry transiente de `criarAgendamentoCidadao` e os dados digitados pelo cidadão quando uma vaga é perdida.
- Preservar a chave de cache compartilhada por minuto na virada das 08:00.
- Se uma correção se mostrar mais arriscada que o descrito, parar e comunicar antes de improvisar.

## Arquivos de referência

- `docs/HANDOFF.md`: handoff técnico detalhado, incluindo a pendência de dados.
- `docs/PROMPT-correcoes-17-08.md`: plano completo dos P0 e P1 e critérios de aceite.
- `README.md`: operação, automação semanal, monitoramento, custo e testes.
- `functions/agenda-grade.js`: regra canônica da grade por data.
- `functions/agenda-automation.js`: automação semanal.
- `tests/load/README.md`: execução dos testes de carga.

