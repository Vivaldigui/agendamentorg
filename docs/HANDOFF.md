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

### 0. Estado real da configuração de produção (lido em 13/08/2026)

Leitura direta do documento `configuracoes/agenda`. **Os números que circularam antes estavam errados** — não são 40 vagas nem 32, e não são 6 chaves.

```
dias:            ["2026-08-13","2026-08-14","2026-08-18","2026-08-19","2026-08-20"]
publicacaoDatas:  ... "2026-08-18","2026-08-19","2026-08-20","2026-08-21" → todas "2026-08-17T08:00"
horariosPorDiaSemana: chaves 0 a 6, TODAS com a grade legada de 8 horários
automacaoSemanal: ausente
```

Três consequências:

1. **21/08 (sexta) não está em `dias`.** Tem horário de publicação, mas `processarAgenda` filtra a partir de `dias`, então a data não existe. A entrada em `publicacaoDatas` está órfã — provavelmente causada pelo bug de merge descrito abaixo, que preservou a publicação quando a data foi removida.
2. **São 7 chaves em `horariosPorDiaSemana`**, a semana inteira, não 6.
3. **`automacaoSemanal` está ausente**, mas `normalizarAutomacaoSemanal(undefined)` devolve os padrões (`ativa: true`, terça a sexta, 08:00). A automação funciona sem o campo — desde que esteja implantada.

Estado efetivo hoje: **3 dias × 8 horários = 24 vagas**, não 40.

Para chegar a 40 são necessárias **três** ações, não duas:

| Ação | Sem ela |
|---|---|
| Implantar o código novo | o corte por data não existe em produção |
| Apagar `horariosPorDiaSemana` | config explícita vence o corte: 8 horários por dia |
| Colocar **2026-08-21** em `dias` | a semana abre com 3 dias |

**Não confie na automação para o 21/08.** Ela resolveria (veria 18, 19 e 20 já em `dias`, pularia os três e adicionaria o 21), mas 17/08 seria a primeira execução dela em produção. Adicione a data manualmente pelo painel; o horário de publicação já está correto.

### 1. Apagar `configuracoes/agenda.horariosPorDiaSemana` (BLOQUEANTE)

O campo tem **7 chaves (0 a 6), todas com a grade legada de 8 horários**, gravadas pelo painel antigo. Como configuração explícita por dia da semana prevalece sobre o corte por data, a semana abriria com 8 horários por dia mesmo depois do deploy.

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

## Bug de merge em mapas — corrigido, mas conheça o padrão

`set(..., { merge: true })` **funde mapas**: uma chave removida do objeto em memória **sobrevive no banco**. Arrays são substituídos inteiros, mapas não. Foi por isso que `publicacaoDatas` acumulou 34 entradas de junho e julho apesar da limpeza diária rodar todo dia, e provavelmente foi assim que 21/08 ficou órfã.

Corrigido em cinco pontos:

- `functions/index.js` — `limparDatasPassadasAgenda` e `prepararAgendaSemanalAutomatica` passam a gravar `FieldValue.delete()` nas chaves removidas
- `public/recepcao.html` — as três telas que gravam a agenda (`salvarHorariosSemana`, `salvarAgendaGestao`, `salvarAutomacaoSemanal`) passam pelo helper `gravarAgendaConfig`, que usa `update` e cai para `set/merge` só quando o documento não existe

Gravar `responsavelPosto` ou `avisoNovasVagasProgramado` com `set/merge` **continua correto** — não há chave a remover. A trava em `functions/painel-grade-editor.test.js` só reprova `set/merge` direto quando o payload toca `publicacaoDatas` ou `horariosPorDiaSemana`.

## Primeiro item depois de 17/08 — segundo fator é código morto

Descoberto durante o ensaio de homologação de 14/08, ao conferir no banco o agendamento vencedor
da disputa: o campo `protocolo` veio `undefined`.

Investigando, o problema é maior que o campo ausente. **`validarFatorExtra`
(`functions/index.js:772`) nunca é chamada** — aparece uma única vez no arquivo, a própria
definição. E o cliente envia apenas `{ cpf, nascimento }` nas duas chamadas que a usariam
(`public/index.html:1754` e `1818`).

Consequência: **qualquer pessoa que saiba o CPF e a data de nascimento de outra pode consultar e
cancelar o agendamento dela.** Não há segundo fator, para nenhum agendamento — nem os criados
pela recepção, que têm protocolo. A verificação simplesmente não roda.

**Não é regressão deste trabalho.** O commit `09903c9`, em produção hoje, tem o mesmo
comportamento.

### Tamanho da correção

| # | Onde | O quê |
|---|---|---|
| 1 | `criarAgendamentoCidadao` | gravar `protocolo` no documento (hoje `gerarProtocolo` só é usada em `criarEncaixeManual`) |
| 2 | idem | devolver o protocolo ao cliente |
| 3 | `consultarAgendamentoCidadao:826` | chamar `validarFatorExtra` |
| 4 | `prepararCancelamentoCidadao:989` | chamar `validarFatorExtra` |
| 5 | `public/index.html` | exibir o protocolo no comprovante |
| 6 | `public/index.html` | coletar telefone **ou** protocolo no fluxo de consulta e cancelamento |

A guarda `if (!dados.protocolo) return;` torna a mudança retrocompatível: agendamentos antigos
seguem funcionando com CPF e nascimento, só os novos passam a exigir o segundo fator. Ninguém
fica trancado para fora.

### Por que ficou para depois de 17/08

- Toca `criarAgendamentoCidadao`, a função mais crítica, logo após ela ter sido validada sob 50
  tentativas simultâneas. Alterá-la invalida essa validação.
- O item 6 muda o fluxo de cancelamento do cidadão. Se falhar no dia, gente que quer cancelar não
  consegue — pior do que o risco mitigado.
- A exposição é específica: exige saber CPF e data de nascimento de alguém em particular, e querer
  cancelar o agendamento daquela pessoa.

### Mitigação disponível sem código

Cancelamentos de cidadão **não geram entrada em `logs_admin`**, mas ficam registrados no próprio
agendamento: `status: "cancelado_cidadao"`, `canceladoEm` e `canceladoPor: "cidadao"`. A recepção
consegue detectar cancelamento anômalo pelo painel. Há também rate limit de 10 cancelamentos por
10 minutos por IP e User-Agent — sujeito, porém, ao contorno por User-Agent descrito no item 9 do
plano.

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
