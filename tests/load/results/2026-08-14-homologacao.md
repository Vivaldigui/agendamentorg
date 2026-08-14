# Ensaio de carga em homologação — 14/08/2026

Projeto: `cin-itanhandu-homolog` (Firebase real, Blaze, us-central1), separado da produção.
Código: branch `preparacao-abertura-17-08`, commit `968e0d7` (P0.1 a P0.5 aplicados).
Ferramenta: k6 2.2.0, executado de uma única máquina Windows.

Dados semeados: 4 dias (18 a 21/08/2026) × 10 horários da grade nova, mais uma data exclusiva
para o ensaio de disputa (15/09/2026 às 14:30). Sem `horariosPorDiaSemana`, de modo que a grade
foi resolvida pelo corte por data.

---

## 1. Leitura da agenda pública

Cenário `agenda-read.js` contra `https://cin-itanhandu-homolog.web.app/api/agenda-publica`,
sempre na mesma URL — o caminho que o carregamento inicial e o polling de 3 minutos usam.

| VUs | req/s | p95 | p90 | máx | Falhas HTTP | Checks |
|---|---|---|---|---|---|---|
| 50 | 43 | 8,77 ms | 8,61 ms | 1,98 s | 0 de 10.431 | 20.862 / 0 |
| 300 | 213 | 8,90 ms | 8,64 ms | 2,23 s | 0 de 51.417 | 102.834 / 0 |
| 800 | 554 | 9,01 ms | 8,68 ms | 2,29 s | 0 de 133.455 | 266.910 / 0 |
| 1500 | 1.031 | 8,92 ms | 8,68 ms | 2,36 s | 0 de 248.317 | 496.634 / 0 |

Total: 443.620 requisições, **zero falhas**, 887.240 checks aprovados e nenhum reprovado.

Vazão 24× maior entre o primeiro e o último degrau, com latência **plana**. O máximo de ~2 s em
cada execução é o primeiro *miss* do CDN pagando o cold start da origem; todo o resto foi servido
da borda. Os limites configurados (falhas < 1%, p95 < 1 s, p99 < 2,5 s) passaram com folga de
três ordens de grandeza.

**Conclusão:** a leitura não é gargalo. O `s-maxage=60` com a chave compartilhada por minuto
absorve o pico, e manter `minInstances = 0` na leitura está correto — o pré-aquecimento econômico
não precisa mudar.

**Ressalva:** o cenário não exercita as retentativas do P0.3, que usam `?atualizar-minuto=N`.
Na virada de cada minuto essa chave é nova para o CDN e gera um *miss* por PoP. Com a origem
ociosa e p95 de 9 ms isso não preocupa, mas não foi medido aqui.

---

## 2. Disputa pela mesma vaga — o ensaio decisivo

Cenário `booking-contention.js`: 50 CPFs válidos e distintos tentando **a mesma vaga** ao mesmo
tempo, com App Check por debug token, contra `criarAgendamentoCidadao`.

```
agendamentos_criados......: 1
conflitos_de_vaga.........: 49
resultados_inesperados....: 0
checks....................: 50 / 50
```

Conferido diretamente no Firestore, sem depender do contador do k6:

```
vagas_ocupadas/2026-09-15_14:30 existe: true
agendamentos nessa vaga: 1
total de agendamentos na homologacao: 1
```

**A propriedade de correção se sustenta.** Exatamente uma reserva por vaga sob 50 tentativas
simultâneas, e os 49 perdedores receberam conflito de vaga — não erro genérico, que é o que o
cliente precisa para exibir "outra pessoa concluiu primeiro" e preservar os dados digitados.

O `http_req_failed` de 96% é esperado e não é defeito: as 49 respostas de conflito têm status HTTP
de erro, e o k6 as contabiliza como falha de requisição. Os *checks* é que medem o comportamento
correto, e passaram todos.

### Latência sob contenção

| | |
|---|---|
| p95 | 6,90 s |
| média geral | 5,58 s |
| média das respostas bem-sucedidas | 2,18 s |
| mínimo | 0,97 s |
| máximo | 7,03 s |

O limite do cenário (`p95 < 5 s`) foi ultrapassado, e o k6 encerrou com código 99 por isso.

Isso **não** é defeito: são 50 transações do Firestore disputando o mesmo documento, e a
retentativa automática é justamente o que garante que só uma vença. Quem perde espera mais porque
retentou mais.

Dois atenuantes para segunda-feira: o ensaio rodou **sem pré-aquecimento** (`minInstances = 0`),
e concentra 50 pessoas num único horário. Na abertura real a disputa se distribui entre os
horários do dia, ainda que os mais procurados vejam contenção parecida.

**Implicação prática:** quem perde uma vaga disputada pode esperar até ~7 s para receber o aviso.
A mensagem e a preservação dos dados digitados, entregues no P0.3, são o que torna essa espera
aceitável.

---

## 3. Achado colateral — agendamentos públicos não recebem protocolo

Ao conferir o agendamento vencedor no banco, o campo `protocolo` veio `undefined`.

Rastreando: `gerarProtocolo()` (`functions/index.js:303`) só é chamada em `criarEncaixeManual`
(`functions/index.js:1126`), o encaixe manual feito pela recepção. O fluxo público,
`criarAgendamentoCidadao`, nunca grava o campo.

A consequência está em `validarFatorExtra` (`functions/index.js:773`):

```js
if (!dados.protocolo) return;
```

Sem protocolo, o segundo fator é **inteiramente ignorado**. Para consultar ou cancelar um
agendamento criado pelo site basta **CPF + data de nascimento** — dados que não são secretos no
Brasil. Agendamentos criados pela recepção têm protocolo e ficam protegidos; os dos cidadãos, que
serão a totalidade na segunda-feira, não.

**Não é regressão deste trabalho:** o commit `09903c9`, que roda em produção hoje, tem exatamente
o mesmo comportamento. Está fora do escopo dos P0 e a decisão de corrigir antes de 17/08 é do
responsável pelo sistema.

---

## Veredito

| Critério | Resultado |
|---|---|
| Leitura: falhas < 1%, p95 < 1 s, p99 < 2,5 s em 1500 VUs | **aprovado**, com folga enorme |
| Disputa: exatamente uma reserva por vaga | **aprovado**, confirmado no banco |
| Disputa: zero resultados inesperados | **aprovado** |
| Nenhum erro de quota, contenção fatal ou índice ausente | **aprovado** |
| Disputa: p95 < 5 s | **não atingido** (6,90 s) — comportamento esperado sob contenção |

Falta repetir os cenários uma segunda vez para confirmar reprodutibilidade, conforme o critério
original.

---

## Nota de infraestrutura

O deploy avisou que **não há política de limpeza no Artifact Registry**. As imagens de container
se acumulam a cada deploy e geram cobrança mensal pequena e permanente. Irrelevante na
homologação, que será apagada — mas a mesma mensagem vai aparecer no deploy de produção, e lá
convém rodar uma vez:

```bash
firebase functions:artifacts:setpolicy --project agendamento-cin-itanhandu
```

Os gatilhos `registrarMetricasAcessoPublico` e `atualizarMetricasSaidaAcessoPublico` não foram
implantados na homologação por não existir instância de Realtime Database no projeto. Isso foi
deliberado: serviu para validar em ambiente real que a inicialização adiada do `getDatabase()`
(commit `968e0d7`) impede que a ausência de `databaseURL` derrube todas as funções do arquivo.
As 14 demais funções, incluindo todo o caminho do cidadão, subiram normalmente.
