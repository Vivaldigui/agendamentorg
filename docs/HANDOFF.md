# Handoff — preparação para a abertura de 17/08/2026

Documento de continuidade. Última atualização: 13/08/2026.

## Situação em uma frase

Auditoria feita, P0.1 e P0.2 aplicados e revisados, **nada implantado**. Produção ainda roda o commit `09903c9` com a grade legada de 8 horários.

## Estado do trabalho

| Item | Estado |
|---|---|
| P0.1 — grade de horários por data (corte 18/08/2026) | ✅ aplicado e revisado |
| P0.2 — desativar telemetria pública | ✅ aplicado e revisado |
| P0.3 — atualização resiliente na virada das 08:00 | ⬜ **próximo** |
| P0.4 — remover fallback do RTDB de produção | ⬜ pendente |
| P0.5 — bloquear produção no teste de contenção | ⬜ pendente |
| P1 (itens 6 a 11) | ⬜ pendentes, ver `PROMPT-correcoes-17-08.md` |

O plano completo, com critérios de aceite por item, está em [`PROMPT-correcoes-17-08.md`](PROMPT-correcoes-17-08.md).

## Duas pendências fora do código

### 1. Apagar `configuracoes/agenda.horariosPorDiaSemana` (BLOQUEANTE)

O campo tem **6 chaves, todas com a grade legada de 8 horários**, gravadas pelo painel antigo. Como configuração explícita por dia da semana prevalece sobre o corte por data, a semana de 18 a 21/08 abriria com **32 vagas em vez de 40**.

Console → Firestore → `configuracoes` → `agenda` → apagar o campo `horariosPorDiaSemana` inteiro (tirar print antes como backup).

```
https://console.firebase.google.com/project/agendamento-cin-itanhandu/firestore/databases/-default-/data/~2Fconfiguracoes~2Fagenda
```

Alternativa por script, com simulação por padrão:

```bash
gcloud auth application-default login
node scripts/migrar-grade-por-dia.js            # simula, não grava
node scripts/migrar-grade-por-dia.js --aplicar  # grava
```

**Por que remover a chave em vez de gravar a grade nova:** `horariosPorDiaSemana` é indexado por dia da semana, não por data. Sobrescrever terça com os 10 horários novos faria as terças *anteriores* ao corte oferecerem 14:30, 14:45 etc., reintroduzindo a sobreposição que o P0.1 fechou. Removendo, a regra por data governa os dois lados do corte corretamente.

**Sequenciamento:** apagar o campo agora é seguro (produção só conhece a grade legada, então nada muda visivelmente). Mas as 40 vagas só aparecem quando **as duas** coisas acontecerem — campo apagado **e** código novo implantado. Uma sem a outra não produz efeito.

### 2. Armadilha do painel (fazer antes de 17/08)

Depois que o campo for apagado, `horariosEditaveisDiaSemana` (`public/recepcao.html:2044`) cai no fallback `[...HORARIOS_PADRAO]`, que é a grade **nova**. O editor semanal vai exibir os 10 horários para todos os dias, e **um clique em "Salvar horários" regrava as chaves e desfaz a migração**, quebrando também as datas anteriores ao corte.

Correção mínima aceitável: aviso visível no editor de que salvar ali vale para todas as datas daquele dia da semana, inclusive as anteriores a 18/08. Ideal: exibir as duas grades com rótulo de vigência.

Até isso existir, **a recepção não deve abrir "Horários disponíveis por dia da semana"**.

## Decisões tomadas, e por quê

- **Corte por data em `2026-08-18`**, com regra canônica em `functions/agenda-grade.js` e espelhos nos dois HTMLs. Sem isso, dias já publicados com os 8 slots legados ocupados ganhariam mais 8 slots livres, chegando a 16 atendimentos com pares separados por 10 minutos.
- **Configuração manual por dia da semana prevalece** sobre o corte, inclusive lista vazia (= sem atendimento). É o que torna a pendência 1 necessária.
- **Telemetria pública desligada**, com gatilhos e regras preservados. O caminho `visitante → conexões RTDB → gatilho O(N)` era o único componente com risco real de saturação no pico. Só religar depois de reimplementar com idempotência e shards (P1 item 6).
- **`agenda-grade-surfaces.test.js` extrai as funções dos HTMLs e as executa** contra as constantes canônicas — é a trava contra a regra triplicada divergir.

## Correções a conselhos anteriores (não repetir os erros)

- **`preaquecer-ligar.ps1` sobrescreve `PICO_MIN_INSTANCES` para `"1"`** e faz deploy apenas de `criarAgendamentoCidadao`. Definir a variável antes de chamar o script não tem efeito, e a leitura nunca recebe instância quente por ele. Manter a leitura em escala zero é decisão de custo correta (o CDN absorve); o item 11 do plano é só parametrizar.
- **"Firestore sustenta 1 escrita/s por documento" é número obsoleto.** A contenção nos 40 documentos de `vagas_ocupadas` é real, mas não é previsível por essa regra.
- **Trocar o `once("value")` por um contador único não basta.** Functions orientadas a eventos têm entrega *at-least-once*; o contador precisa ser idempotente e dividido em shards.
- **O cache-buster por minuto em `public/index.html` deve ser mantido.** Carregamento inicial e polling usam URL limpa (chave única de CDN); o parâmetro só entra após uma reserva ou no botão manual, e é o que impede alguém de receber por 60 segundos a resposta fechada das 07:59.
- **RTDB cobra banda, não leitura por documento.** A leitura do nó inteiro continua sendo O(N²) e desperdício, mas a unidade de cobrança é outra.

## Contexto de capacidade

40 vagas na semana (10 horários × terça a sexta). Com 500 pessoas, 460 ficam sem vaga — isso é aritmética, não defeito. O objetivo das correções é garantir que ninguém receba falso "sem vagas", fique preso em tela desatualizada ou perca dados preenchidos.

Ensaio local em `tests/load/results/2026-08-13-local.md`: zero falhas, p95 ~4 s, máximo ~15 s. **Não certifica produção** — o emulador não reproduz CDN nem escala horizontal. Falta ensaio em homologação Firebase real.

## Continuando em outra máquina

```bash
git clone https://github.com/Vivaldigui/agendamentorg.git
cd agendamentorg
git checkout preparacao-abertura-17-08
npm install
cd functions && npm install
```

Verificação de que está tudo são:

```bash
cd functions && npm test
```

Devem passar 18 testes. `node --check functions/index.js` também deve passar.

**Não copie `firebase-debug.log`** — tem ~570 MB, está no `.gitignore` e pode ser apagado com segurança.

## Ordem sugerida a partir daqui

1. P0.3 (o item que mais afeta o cidadão no minuto da abertura; reserve mais tempo de revisão)
2. P0.4 e P0.5
3. Correção da armadilha do painel
4. Apagar `horariosPorDiaSemana` no Console
5. Deploy em homologação e ensaio k6 conforme `tests/load/README.md`
6. Deploy em produção + `scripts/preaquecer-ligar.ps1` na noite de 16/08
