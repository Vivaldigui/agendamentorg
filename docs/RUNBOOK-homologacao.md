# Runbook — homologação e ensaio de carga antes de 17/08/2026

Objetivo: medir o comportamento real do sistema sob carga num projeto Firebase separado, antes de implantar em produção.

**Nunca aponte nenhum passo deste runbook para `agendamento-cin-itanhandu`.**

## Antes de começar

O nome do projeto **não pode conter** `agendamento-cin-itanhandu`, senão a denylist dos cenários k6 recusa a execução. Sugestão: **`cin-itanhandu-homolog`**.

Ferramentas já instaladas nesta máquina: `firebase` 15.26.0 (logado como gui.rib.pi@gmail.com), `gcloud` 580.0.0 com ADC, `k6` 2.2.0.

---

## Parte 1 — o que só você pode fazer

### 1.1 Criar o projeto

Firebase Console → Adicionar projeto → ID `cin-itanhandu-homolog`. Pode desativar o Analytics.

### 1.2 Ativar o faturamento Blaze

Cloud Functions v2 roda sobre Cloud Run e **exige Blaze**. Sem isso o deploy falha.

**Defina um orçamento com alerta** em Google Cloud Console → Faturamento → Orçamentos e alertas. Algo como US$ 20 já protege contra surpresa. O ensaio em si deve custar poucos dólares — o CDN absorve a maior parte da leitura e o teste de disputa são 50 invocações —, mas orçamento é barato e engano é caro.

### 1.3 Provisionar os serviços

- **Firestore**: modo nativo, mesma região da produção
- **Realtime Database**: instância padrão
- **Authentication**: ativar e-mail/senha (o painel precisa)
- **Hosting**: ativar

### 1.4 Criar o app web e anotar os dados

Configurações do projeto → Seus apps → Web. Guarde o bloco `firebaseConfig` inteiro, e separadamente:

- `PROJECT_NUMBER` (Configurações → Geral → Número do projeto)
- `APP_ID` (o `appId` do bloco)
- `API_KEY` (o `apiKey` do bloco)

### 1.5 Criar o debug token do App Check

App Check → Apps → seu app web → Gerenciar tokens de depuração → adicionar.

**Guarde o valor só em variável de ambiente e revogue ao final do ensaio.**

### 1.6 Me passar

- o ID do projeto
- o bloco `firebaseConfig`
- `PROJECT_NUMBER`, `APP_ID`, `API_KEY`
- o debug token do App Check

---

## Parte 2 — o que eu faço

1. Adicionar o alias `homolog` ao `.firebaserc`
2. Trocar **localmente e sem commitar** o `firebaseConfig` dos dois HTMLs pelo da homologação, para que o site de lá não converse com produção
3. Rodar `scripts/semear-homologacao.js` para criar `configuracoes/agenda`, o documento de admin e uma data de teste exclusiva
4. Implantar: `firebase deploy --project homolog`
5. **Conferir os logs de inicialização antes de qualquer outra coisa** — é onde apareceria um `databaseURL` ausente derrubando as funções
6. Rodar os cenários k6
7. Registrar o resultado em `tests/load/results/`
8. Reverter a troca local do `firebaseConfig`

Cada deploy e cada execução de carga eu peço sua confirmação antes.

---

## Parte 3 — os ensaios

### 3.1 Leitura da agenda, em escada

```powershell
$env:BASE_URL = "https://cin-itanhandu-homolog.web.app"
$env:CONFIRM_HOMOLOGATION = "SIM"
$env:MAX_VUS = "50";   k6 run .\tests\load\agenda-read.js
$env:MAX_VUS = "300";  k6 run .\tests\load\agenda-read.js
$env:MAX_VUS = "800";  k6 run .\tests\load\agenda-read.js
$env:MAX_VUS = "1500"; k6 run .\tests\load\agenda-read.js
```

Entre uma execução e outra, observe no Google Cloud Console: instâncias do Cloud Run, latência, erros, e leituras do Firestore.

Limites configurados: falhas < 1%, p95 < 1 s, p99 < 2,5 s.

### 3.2 Disputa pela mesma vaga

Este é o ensaio que mais importa: verifica que **exatamente uma pessoa** ganha cada vaga quando 50 tentam ao mesmo tempo. É correção, não desempenho — e nenhum ajuste de infraestrutura conserta se estiver errado.

Use a data e o horário exclusivos criados pelo script de carga inicial.

```powershell
$env:CONFIRM_HOMOLOGATION = "SIM"
$env:FUNCTION_URL = "https://us-central1-cin-itanhandu-homolog.cloudfunctions.net/criarAgendamentoCidadao"
$env:PROJECT_NUMBER = "..."
$env:APP_ID = "..."
$env:API_KEY = "..."
$env:APP_CHECK_DEBUG_TOKEN = "..."
$env:TEST_DATE = "2026-09-15"
$env:TEST_TIME = "14:30"
$env:VUS = "50"
k6 run .\tests\load\booking-contention.js
```

Verificar ao final:

1. `agendamentos_criados` foi exatamente **1**
2. `resultados_inesperados` foi **0**
3. os demais retornaram conflito, não erro genérico
4. p95 e p99, e a ausência de `RESOURCE_EXHAUSTED`

---

## Critério para liberar produção

- leitura: falhas < 1%, p95 < 1 s, p99 < 2,5 s em 1500 VUs
- disputa: exatamente uma reserva por vaga, zero resultados inesperados
- nenhum erro persistente de quota, contenção ou índice ausente
- duas execuções consecutivas com resultados semelhantes

---

## Ao terminar

1. Revogar o debug token do App Check na homologação
2. Reverter a troca local do `firebaseConfig` (`git checkout public/`)
3. Registrar o resultado em `tests/load/results/`
4. **Avaliar se vale apagar o projeto de homologação** — ele continua gerando custo de Cloud Scheduler (três jobs) e de armazenamento enquanto existir

---

## Coisas que vão aparecer e não são defeito

**Cloud Scheduler na homologação.** O deploy cria os mesmos três jobs agendados. A franquia gratuita é por conta de faturamento e a produção já usa três, então os da homologação são cobrados — centavos por mês. Se o projeto for viver alguns dias, ignore; se for ficar, apague o projeto ao final.

**`prepararAgendaSemanalAutomatica` rodando segunda 07:50 na homologação.** Inofensivo, e na verdade útil: é a primeira execução real dela em qualquer ambiente. Vale conferir o log `agenda_automacao_semanal` em `logs_admin` para ver se ela acrescentou a sexta-feira como esperado.

**Erros de índice ausente.** O `firebase.json` não implanta `firestore.indexes.json`. As consultas usadas são de campo único e indexadas automaticamente, mas se aparecer `FAILED_PRECONDITION` pedindo índice nos logs, é isso — e é bom descobrir na homologação.

**App Check falhando no navegador da homologação.** Esperado: a chave reCAPTCHA está amarrada ao domínio de produção. Não afeta os testes k6, que usam o debug token.

---

## Pendência não relacionada, mas do mesmo tipo

`functions/index.js:1470` ainda tem `process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "agendamento-cin-itanhandu"` no pré-aquecimento interno. `GCLOUD_PROJECT` sempre existe em Cloud Functions, então na prática não dispara — mas é o mesmo padrão que o P0.4 removeu. Vale limpar numa próxima rodada.
