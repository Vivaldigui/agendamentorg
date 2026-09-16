# Pedido de avaliação após o atendimento

Link de avaliação configurado:
https://g.page/r/CfugOJBgujYPEBM/review

Webhook de produção:
https://sucupira-naturale-n8n.kip816.easypanel.host/webhook/cin-avaliacao-google

Em **16/09/2026**, o backend diário foi publicado no projeto
`agendamento-cin-itanhandu`. A função está `ACTIVE`; o Scheduler está `ENABLED`
com cron `0 17 * * *` e fuso `America/Sao_Paulo`; o antigo gatilho de três horas
foi removido. O lote excepcional autorizado do dia encontrou 8 elegíveis e
obteve 8 recibos de aceitação SMTP, sem falhas nem duplicidades. A fila foi
conferida com 8 registros `enviado`.

O workflow JSON deste repositório contém a validação e a redação atuais. O
responsável atualizou o workflow ativo no n8n; o painel permaneceu sem sessão
disponível para o agente e o endpoint MCP respondeu HTTP 401.

Após a atualização do workflow pelo responsável, o lote histórico autorizado
foi executado em **16/09/2026**. Foram deduplicados os cadastros por endereço de
e-mail e processados 197 destinatários referentes a atendimentos entre 11/05 e
15/09/2026: **196** tiveram aceitação confirmada pelo SMTP e **1** ficou em
`revisar`. A conferência final não encontrou destinatários históricos elegíveis
sem processamento. O registro em revisão não é reenviado automaticamente.

Todos os dias, às **17h** no fuso `America/Sao_Paulo`, a função consulta os
agendamentos daquele dia. O convite é enviado somente para cadastros que ainda
estejam com status **Compareceu**, tenham um único e-mail válido e não tenham
sido anonimizados. O painel pode estar fechado durante a execução.

As coleções privadas `pedidos_avaliacao_google/{agendamentoId}` e
`destinatarios_avaliacao_google/{identificador}` registram a reserva e o
resultado. A primeira protege o agendamento; a segunda usa HMAC do e-mail, sem
guardar o endereço, e impede repetição para o mesmo destinatário mesmo que ele
apareça em outro documento ou data.

## Comportamento

- A seleção usa a data do atendimento, o status e o e-mail existentes às 17h.
- Cada execução relê o cadastro dentro da transação que reserva o envio.
- Registros sem e-mail, com e-mail inválido, ausentes, anonimizados ou com outro
  status não são enviados.
- Uma nova execução do mesmo dia processa somente pessoas ainda não reservadas.
- Um mesmo endereço de e-mail recebe no máximo um convite em todo o histórico.
  Cadastros diferentes com o mesmo e-mail são reservados de forma transacional,
  inclusive quando duas execuções concorrem.
- Um cadastro marcado como Compareceu depois da execução das 17h fica fora do
  lote automático daquele dia.
- Cada agendamento recebe no máximo uma tentativa automática no n8n. Falha
  ambígua fica em `revisar`, porque um reenvio cego poderia duplicar o e-mail.

O convite pede uma opinião livre, sem solicitar nota específica. O n8n recebe
somente nome, e-mail, data do atendimento, horário da confirmação, link e chave
técnica. CPF, nascimento, telefone e observações não são enviados. A fila guarda
somente metadados e o ID do agendamento; o navegador não pode acessá-la.

O texto informa que a pessoa fez seu RG (Carteira de Identidade) na Câmara de
Itanhandu, pede uma avaliação voluntária no Google e esclarece que se trata de
um convite único. A mesma redação serve ao lote diário e ao envio histórico.

## Configuração no n8n

1. Importe [`n8n/avaliacao-google.workflow.json`](n8n/avaliacao-google.workflow.json).
   O arquivo começa inativo e não contém credenciais.
2. Em **Receber pedido**, selecione a credencial **Header Auth** com cabeçalho
   `X-Avaliacao-Token` e o mesmo valor de `AVALIACAO_N8N_TOKEN` no Firebase.
3. Em **Enviar email**, selecione a credencial SMTP institucional autorizada a
   enviar como `identificacao@itanhandu.cam.mg.gov.br`.
4. Preserve **Using Respond to Webhook node**. A resposta de sucesso deve ocorrer
   depois da confirmação SMTP. Não habilite `Continue On Fail` ou retry automático.
5. Ative o workflow e use a Production URL HTTPS em
   `AVALIACAO_N8N_WEBHOOK_URL`.

O workflow aceita confirmações recentes porque o horário de envio é controlado
pelo Scheduler das 17h. Ele ainda valida o token, o formato do destinatário, a
data do atendimento, o horário da confirmação e o link HTTPS.

O modelo limita cada execução a 20 segundos e não salva payloads de sucesso ou
erro no n8n, pois eles incluem contato pessoal. O Firebase aguarda no máximo 25
segundos por destinatário.

## Configuração no Firebase

`functions/.env.<ID_DO_PROJETO>`:

```dotenv
AVALIACAO_GOOGLE_ATIVA=true
AVALIACAO_GOOGLE_URL=https://g.page/r/CfugOJBgujYPEBM/review
```

Segredos:

```powershell
firebase functions:secrets:set AVALIACAO_N8N_WEBHOOK_URL --project <ID_DO_PROJETO>
firebase functions:secrets:set AVALIACAO_N8N_TOKEN --project <ID_DO_PROJETO>
firebase functions:secrets:set AVALIACAO_DESTINATARIO_CHAVE --project <ID_DO_PROJETO>
```

`AVALIACAO_DESTINATARIO_CHAVE` deve ser aleatória, ter pelo menos 32 caracteres
e permanecer estável. Antes de rotacioná-la, migre os identificadores existentes;
trocar a chave sem migração perderia a proteção histórica contra repetição.

Implantação:

```powershell
firebase deploy --only "functions:enviarAvaliacoesGooglePendentes,firestore:rules" --project <ID_DO_PROJETO>
```

A função fica em `southamerica-east1` e cria um job diário no Cloud Scheduler.
São necessários faturamento, Functions v2, Scheduler e Secret Manager. Não há
índice composto novo. Para desativar, defina `AVALIACAO_GOOGLE_ATIVA=false` e
reimplante a função.

## Contrato do webhook

```json
{
  "evento": "avaliacao_google",
  "versao": 1,
  "idempotencyKey": "avaliacao-google-v1:ID_DO_AGENDAMENTO",
  "email": "destinatario@example.test",
  "nome": "Pessoa de Teste",
  "confirmadoEm": "2026-09-16T19:58:00.000Z",
  "dataAtendimento": "2026-09-16",
  "avaliacaoUrl": "https://g.page/r/CfugOJBgujYPEBM/review"
}
```

Resposta HTTP 2xx somente depois que o SMTP aceitar o destinatário:

```json
{
  "enviado": true,
  "idempotencyKey": "avaliacao-google-v1:ID_DO_AGENDAMENTO"
}
```

`enviado` significa aceito pelo servidor SMTP; não comprova entrega na caixa.
Devoluções e bloqueios de spam pertencem ao monitoramento do provedor.

## Falhas e recuperação

| Estado | Significado |
| --- | --- |
| `enviando` | Tentativa reservada atomicamente; nenhuma outra execução envia. |
| `enviado` | Recibo válido após aceitação SMTP. |
| `revisar` | Resposta inválida, erro HTTP ou resultado incerto. |
| `cancelado` | Estado legado ou cadastro inelegível reconciliado. |

O log `avaliacao_google_requer_revisao` contém somente o ID do pedido. Antes de
qualquer reenvio manual, confirme no provedor SMTP que não houve aceitação. Se
houve, reconcilie o estado para `enviado`. Se comprovadamente não houve, altere
o estado para `cancelado` e execute novamente o job; o cadastro será revalidado.

## Validação

```powershell
npm --prefix functions ci
npm --prefix functions test
```

Os testes usam banco e HTTP simulados e não enviam e-mails. Em produção, valide
com um cadastro autorizado, execute o job manualmente e confirme um único
convite e o estado `enviado`.

Referências do n8n: [Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/),
[envio SMTP](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.sendemail/) e
[Respond to Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/).
