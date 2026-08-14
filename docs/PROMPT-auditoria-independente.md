# Prompt — auditoria independente (segunda opinião)

Cole o conteúdo abaixo como mensagem para o Codex.

---

Faça uma **auditoria independente** do projeto AgendamentoRG. Isto é uma segunda opinião: outro assistente já auditou partes do sistema e implementou correções, e o objetivo agora é encontrar o que ele deixou passar — **inclusive erros nas decisões que ele tomou**.

Trate as decisões descritas abaixo como hipóteses a serem testadas, não como fatos aceitos. **Se você achar que alguma está errada, diga.** Discordância fundamentada é o produto mais valioso desta tarefa.

## Contexto e o que está em jogo

Sistema de agendamento de RG/CIN da Câmara Municipal de Itanhandu. Firebase Hosting, Cloud Functions v2, Firestore, Realtime Database.

Na **segunda-feira, 17/08/2026 às 08:00** (`America/Sao_Paulo`), a agenda da semana abre automaticamente: terça a sexta, 18 a 21/08, 10 horários por dia, **40 vagas**. É esperado que centenas de pessoas tentem ao mesmo tempo, e a maioria fique sem vaga — 40 vagas é o teto real.

O código **já está implantado em produção** (`main`, commit `46a2b73`). Qualquer defeito que você encontrar está no ar agora.

O que mais importa, em ordem: ninguém receber falso "sem vagas"; ninguém perder dados preenchidos; ninguém ficar preso em tela desatualizada; nenhuma vaga ser vendida duas vezes; nenhum dado pessoal vazar.

## Regras

- **Não altere código.** Esta tarefa é de análise. Produza um relatório.
- **Toda afirmação precisa de evidência**: arquivo e linha, ou saída de comando. Se for hipótese, rotule como hipótese.
- Antes de afirmar que algo é defeito, **verifique se o caminho é alcançável**. Um trecho perigoso que nunca executa é um achado diferente de um que executa a cada requisição.
- Se precisar ler dados de produção, use `gcloud auth application-default login` e leia **somente**. Não escreva, não implante.
- Priorize por risco real para 17/08, não por elegância de código.

## Já foi coberto — só relate se achamos ERRADO

Não gaste esforço redescobrindo isto. Mas **conteste se discordar da solução**:

1. **Grade de horários por data** (`functions/agenda-grade.js`): corte em 2026-08-18, 8 horários legados antes, 10 novos depois. Configuração explícita por dia da semana prevalece sobre o corte.
2. **Telemetria de presença desativada** (`METRICAS_ACESSO_PUBLICO_ATIVAS = false`). Gatilhos RTDB e regras preservados.
3. **Atualização resiliente às 08:00**: retentativas por 60 s com backoff e jitter, hora do servidor via cabeçalhos `Date` + `Age`, retomada em `online`/`visibilitychange`.
4. **`set` com `merge` funde mapas**: corrigido com `FieldValue.delete()` no backend e `update()` no painel.
5. **`getDatabase()` inicializado sob demanda**, não em escopo de módulo.
6. **Ensaio de carga em homologação real**: leitura com p95 de 9 ms até 1500 VUs; disputa por vaga produziu exatamente uma reserva entre 50 tentativas simultâneas.
7. **Conhecido e não corrigido**: `validarFatorExtra` (`functions/index.js:772`) nunca é chamada, então CPF + data de nascimento bastam para consultar e cancelar o agendamento de qualquer pessoa. Está documentado em `docs/HANDOFF.md`.

## Onde eu suspeito que faltou olhar

Estas áreas **não** foram auditadas. Não é uma lista exaustiva — se encontrar algo fora dela, melhor ainda.

**`public/sw.js`** — há um service worker e um `manifest.json`. Um service worker que sirva HTML ou dados em cache pode entregar a página antiga na virada das 08:00, anulando toda a lógica de atualização resiliente. Verifique o que ele cacheia, com que estratégia, e como se comporta quando uma versão nova é implantada.

**Funções nunca revisadas**: `criarEncaixeManual`, `remarcarAgendamentoAdmin`, `atualizarObservacaoAdmin`, `listarLogsAdmin`, `gerarBackupAdmin`, `anonimizarDadosAntigosLGPD`.

**Consistência do modelo de dados.** O mesmo agendamento é representado em `dados_cidadaos`, `vagas_ocupadas` e `cpfs_agendados`. Procure caminhos em que essas três coleções possam divergir — cancelamento, remarcação, substituição, encaixe manual, anonimização — e o que acontece quando divergem.

**Bloqueio por não comparecimento** (`bloqueios_agendamento`): como é aplicado, como expira, se pode bloquear alguém indevidamente e se pode ser contornado.

**LGPD**: `anonimizarDadosAntigosLGPD` roda mensalmente sobre dados pessoais. Verifique se anonimiza o que deveria, se deixa rastro em `logs_admin` ou em backups, e se pode apagar algo em uso.

**`firestore.rules` e `database.rules.json`**: o modelo de admin depende de um documento em `admins/{email}`. Procure caminhos de leitura ou escrita mais permissivos que o pretendido.

**Acessibilidade e formulário**: o público inclui pessoas idosas e com pouca familiaridade digital, em celulares modestos. Contraste, tamanho de alvo de toque, rótulos, mensagens de erro, navegação por teclado.

**Comportamento sob rede ruim**, além do que o item 3 cobre: envio duplicado por clique repetido, estado do botão, o que acontece se a conexão cair no meio da criação do agendamento.

**Fuso horário**: o sistema mistura `Intl.DateTimeFormat` com `America/Sao_Paulo`, comparação de strings ISO e offset fixo `-03:00`. Procure onde isso diverge.

## O que quero receber

Um relatório em `docs/AUDITORIA-CODEX.md` com:

1. **Achados classificados** — para cada um: o que é, arquivo e linha, por que importa, como reproduzir ou verificar, e o risco concreto para 17/08.
2. **Severidade**: bloqueante para segunda / importante mas pode esperar / melhoria.
3. **Discordâncias** — onde você acha que as decisões da lista anterior estão erradas, e por quê.
4. **O que você verificou e estava correto** — tão útil quanto os defeitos, porque delimita a cobertura.
5. **O que você não conseguiu verificar** e o que seria preciso para isso.

Ordene por risco. Se encontrar algo que justifique alterar o sistema antes de segunda, deixe isso no topo e diga explicitamente.

## Comandos úteis

```bash
npm --prefix functions test          # 44 testes
node --check functions/index.js
git log --oneline -15
```

Documentos de contexto: `docs/HANDOFF.md`, `docs/PROMPT-correcoes-17-08.md`, `tests/load/results/2026-08-14-homologacao.md`.

**Não faça deploy, commit nem push.**
