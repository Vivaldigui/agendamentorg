# Testes de carga do Agendamento CIN

Execute somente em um projeto Firebase de homologação ou nos emuladores. Nunca aponte estes scripts para produção: o teste de disputa cria um agendamento real no ambiente escolhido e dezenas de requisições concorrentes podem consumir quota ou afetar cidadãos.

Os dois scripts aplicam uma **denylist fixa e explícita**: qualquer URL que contenha `agendamento-cin-itanhandu` é recusada antes da confirmação de homologação. A denylist não pode ser contornada por variável de ambiente; `CONFIRM_HOMOLOGATION=SIM` apenas autoriza ambientes de homologação cujo nome não corresponda ao padrão reconhecido automaticamente.

## 1. Instalar o k6 no Windows

Com `winget` disponível:

```powershell
winget install --id GrafanaLabs.k6 -e --source winget
k6 version
```

Também é possível usar a imagem Docker oficial, conforme a documentação do k6.

## 2. Testar leitura da agenda/CDN

O teste sobe gradualmente até 300 usuários virtuais, mantém a carga por dois minutos e exige menos de 1% de falhas, p95 abaixo de 1 segundo e p99 abaixo de 2,5 segundos.

```powershell
$env:BASE_URL = "https://SEU-PROJETO-DE-HOMOLOGACAO.web.app"
$env:CONFIRM_HOMOLOGATION = "SIM"
$env:MAX_VUS = "300"
$env:RUN_ID = "ensaio-2026-08-17"
k6 run .\tests\load\agenda-read.js
```

Repita com `MAX_VUS=50`, `300`, `800` e `1500`, observando também Cloud Functions/Cloud Run e Firestore no Console do Google Cloud.

Para uma verificação isolada nos emuladores, o repositório também inclui `run-agenda-local.cmd`. O último resultado local registrado está em [`results/2026-08-13-local.md`](results/2026-08-13-local.md). O emulador não possui o CDN de produção, portanto esse ensaio é deliberadamente mais próximo de uma carga direta na origem e não substitui homologação implantada.

## 3. Testar concorrência na mesma vaga

Este cenário envia 50 CPFs válidos e diferentes para exatamente o mesmo dia/horário. O resultado correto é **um único agendamento criado** e todos os demais retornando conflito de vaga.

Como `criarAgendamentoCidadao` exige App Check, crie um debug token somente no app de homologação em Firebase Console → App Check → Gerenciar tokens de depuração. Guarde-o apenas em variável de ambiente e remova-o após o ensaio.

Cadastre no painel de homologação uma data futura e um horário exclusivos para o teste. Depois execute:

```powershell
$env:CONFIRM_HOMOLOGATION = "SIM"
$env:FUNCTION_URL = "https://us-central1-SEU-PROJETO.cloudfunctions.net/criarAgendamentoCidadao"
$env:PROJECT_NUMBER = "NUMERO_DO_PROJETO"
$env:APP_ID = "ID_DO_APP_WEB"
$env:API_KEY = "CHAVE_PUBLICA_DO_APP_WEB"
$env:APP_CHECK_DEBUG_TOKEN = "SEGREDO_DO_TOKEN_DEBUG"
$env:TEST_DATE = "2026-08-25"
$env:TEST_TIME = "14:30"
$env:VUS = "50"
k6 run .\tests\load\booking-contention.js
```

Ao terminar:

1. confirme que `agendamentos_criados` foi exatamente 1;
2. confirme que `resultados_inesperados` foi 0;
3. verifique p95/p99, erros `ABORTED`, `429`, instâncias e leituras/gravações do Firestore;
4. exclua/cancele o agendamento de teste na homologação;
5. revogue o debug token do App Check.

## Critério sugerido para liberar produção

- leitura da agenda: falhas < 1%, p95 < 1 s e p99 < 2,5 s;
- criação em disputa: exatamente uma reserva por vaga e nenhum erro inesperado;
- nenhum erro persistente de quota, `RESOURCE_EXHAUSTED` ou contenção;
- funcionamento confirmado com o pré-aquecimento ligado e desligado;
- duas execuções consecutivas com resultados semelhantes.
