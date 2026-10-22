# Plano — avisos e atendimento pelo WhatsApp oficial (Cloud API da Meta)

Proposto em 22/10/2026. Ainda **não implementado**, e quatro pontos dependem de
você e da Câmara (ver "Decisões em aberto"). Preços e regras da Meta foram
conferidos na documentação oficial em 22/10/2026. A Meta mudou a cobrança em
julho e em outubro de 2026: reconfira antes de cada fase.

O que o plano propõe, nesta ordem:

1. **Confirmação automática** pelo WhatsApp logo depois de agendar.
2. **Lembrete na véspera**, com os botões "Vou comparecer" e "Preciso cancelar".
3. **Avisos da Câmara**: remarcação, cancelamento e alteração de uma data
   inteira.
4. **Convite de avaliação** por WhatsApp, no lugar do e-mail ou ao lado dele.
5. **Bot de atendimento**: primeiro responde aos botões, depois ganha menu.

---

## O que existe hoje

- **Lembrete manual.** "Lembretes de amanhã" abre uma aba `wa.me` por pessoa, e
  a recepção aperta enviar em cada uma (`public/recepcao.js:4251`). O texto é
  editável no painel (`configuracoes/agenda.mensagemLembreteTemplate`, padrão
  em `public/recepcao.js:53`).
- **Confirmação pelo próprio cidadão.** Na tela de sucesso, "Enviar no
  WhatsApp" manda o comprovante para o próprio número (`public/index.html:618`),
  e a tela avisa "Nada é enviado automaticamente" (`public/index.html:608`).
- **Fila de envio pronta para copiar.** `functions/avaliacao-google.js` reserva o
  envio em transação, faz no máximo uma tentativa por chave, deixa em `revisar` a
  falha ambígua, deduplica por HMAC (`identificadorDestinatario`), exige
  consentimento próprio e só registra IDs no log. O WhatsApp segue o mesmo molde.
- **Telefone.** Obrigatório (`public/index.html:564`), normalizado com o nono
  dígito por `telefoneCanonico` (`functions/index.js:271`) e indexado em
  `telefones_agendados` (`functions/limites-agendamento.js:94`). O índice serve
  para achar os agendamentos de quem escreve para o número.
- **Política de privacidade.** O telefone serve para "entrar em contato se houver
  mudança no atendimento" (`docs/POLITICA-PRIVACIDADE.md:71`), e só o Google
  aparece como operador.
- **Volume.** Cerca de 30 vagas por abertura semanal
  (`docs/PLANO-agendar-em-um-toque.md`), ou 130 a 170 agendamentos por mês. Esse
  número define custo e limites.

## Regras da Meta que mudam o desenho

Conferidas em 22/10/2026; fontes no fim.

- **Cobrança por mensagem entregue.** Template de utilidade para número
  brasileiro: US$ 0,0068. Marketing: cerca de US$ 0,0625. Cada aviso precisa
  caber em utilidade.
- **Desde 01/10/2026 a utilidade é cobrada também dentro da janela de 24h.** O
  toque num botão abre a janela, mas o template seguinte continua pago.
- **Respostas livres dentro da janela** (o que o bot manda): 1.000 grátis por mês
  por número. Órgão de governo elegível segue isento acima disso até 31/12/2027;
  a Meta promete a consulta de elegibilidade até 30/10/2026. O bot cabe na
  franquia.
- **Faturamento em reais desde 01/07/2026.** Contas de clientes brasileiros
  migram até 30/06/2027, então a conta nasce em BRL. Template exige forma de
  pagamento cadastrada, e a Câmara precisa decidir como paga.
- **Limite de envio.** Portfólio novo escreve para 250 pessoas diferentes a cada
  24h fora da janela; a verificação da empresa sobe para 2.000. Trinta
  agendamentos por semana cabem com folga em 250.
- **Template passa por aprovação e tem corpo de até 1.024 caracteres.** O
  lembrete atual (lista de documentos e aviso da taxa) não cabe, e o texto deixa
  de ser editável no painel: cada mudança volta para aprovação. A lista de
  documentos vira botão de link.
- **Categoria.** Confirmação, lembrete, remarcação e cancelamento são utilidade.
  Pesquisa de satisfação só é utilidade se citar o atendimento específico e não
  tiver tom promocional, e a Meta pode reclassificá-la para marketing (9 vezes
  mais caro). O convite de avaliação é o template com mais risco.
- **Nomes de usuário.** Desde abril/2026 os webhooks trazem `user_id` (BSUID). O
  telefone pode faltar para quem adotou nome de usuário, salvo se houve troca de
  mensagens com aquele número nos últimos 30 dias. Notificação não sofre, porque
  a Câmara escreve primeiro. No bot, quem chega sem contato prévio pode vir sem
  telefone.
- **IA.** Desde 15/01/2026 a Meta proíbe assistente de IA de uso geral na API.
  Bot de atendimento do próprio serviço continua permitido.
- **Armazenamento local.** O conteúdo das mensagens pode ficar guardado no
  Brasil (`data_localization_region: "BR"`), configurado com o número
  **desregistrado**; mudar depois exige desregistrar e registrar de novo. No
  processamento, o conteúdo pode passar até 60 minutos fora do país. Para um
  órgão público, isso simplifica a transferência internacional na LGPD.

## Decisão 1 — qual número

| | Número novo só para a API (recomendado) | Coexistência no (35) 3504-0397 |
|---|---|---|
| Recepção | continua igual no app | perde etiquetas, respostas rápidas e listas de transmissão; WhatsApp para Windows deixa de funcionar como aparelho conectado (o WhatsApp Web segue) |
| Entrada na API | direto pela Meta | só por Solution Partner ou Tech Provider |
| Mensagens guardadas no Brasil | sim | não disponível |
| Para o cidadão | dois números: avisos num, atendimento por pessoa no outro | um número só |

O número novo pode ser um celular em nome da Câmara ou um fixo, verificado por
ligação. O bot sempre oferece "Falar com a recepção", com link para o
(35) 3504-0397. Coexistência ou uma caixa de atendimento própria só entram em
pauta se o número novo passar a receber muita conversa.

---

## Arquitetura

```
criarAgendamentoCidadao, criarEncaixeManual, remarcarAgendamentoAdmin,
cancelamentos, alterarStatusAdmin                         (sem mudança)
            │ gravam dados_cidadaos
            ▼
planejarNotificacoesWhatsApp       onDocumentWritten(dados_cidadaos)
            │ compara antes e depois → create() em notificacoes_whatsapp/{id}
            │
job das 17h ┤ lembretes de amanhã e avaliação de hoje → create() na mesma fila
painel ─────┤ aviso em lote e reenvio, por callable → create() na mesma fila
            ▼
enviarNotificacaoWhatsApp          onDocumentCreated(notificacoes_whatsapp)
              reserva em transação → POST /{phone-number-id}/messages → wamid

webhookWhatsApp                    onRequest em /api/whatsapp (rewrite do Hosting)
            │ valida assinatura → create() em whatsapp_eventos/{id} → 200
            ▼
processarEventoWhatsApp            onDocumentCreated(whatsapp_eventos)
            ├─ status sent/delivered/read/failed → notificacoes_whatsapp
            └─ botão ou texto → bot
```

Todas as funções novas ficam em `southamerica-east1`, junto do Firestore: o
gatilho de Firestore precisa estar na região do banco.

### Regras do desenho

1. **Nada entra no caminho da abertura das 08:00.** `criarAgendamentoCidadao`
   não muda, e o envio roda em outra função. Deploy das funções novas fora da
   segunda de manhã e nunca entre ligar e desligar o pré-aquecimento.
2. **Uma fila, um remetente.** Gatilho, job das 17h e painel só criam documentos
   em `notificacoes_whatsapp`; quem envia é sempre `enviarNotificacaoWhatsApp`.
   O ID é determinístico, `{agendamentoId}_{tipo}_{dataISO}_{hora}`, criado com
   `create()`. O gatilho do Firestore entrega o mesmo evento mais de uma vez, e o
   segundo `create()` falha sem enviar nada.
3. **O gatilho filtra.** `planejarNotificacoesWhatsApp` dispara em toda escrita
   de `dados_cidadaos`, inclusive na anonimização mensal e na manutenção diária.
   Só age quando muda status, data, hora ou consentimento, e ignora anonimizados
   e datas passadas.
4. **Situação de entrega fica na fila.** Gravar sent/delivered/read em
   `dados_cidadaos` redispararia o gatilho três vezes por mensagem. O painel lê
   `notificacoes_whatsapp` por `dataISO`. A exceção é a presença confirmada
   (`presencaConfirmadaEm`): um campo só, que o gatilho ignora e a Fila do dia já
   lê.
5. **Elegibilidade por `agendamentoEstaAtivo`** (`functions/index.js:489`). A
   remarcação grava `status: "remarcado"` no mesmo documento
   (`functions/index.js:1908`) e o agendamento continua ativo; o lembrete manual
   de hoje filtra só `agendado`.
6. **Lembrete no job das 17h que já existe** (`enviarAvaliacoesGooglePendentes`,
   `functions/index.js:68`). Dá entre 21h30 e 23h35 de antecedência para os
   horários de 14h30 a 16h35, sem quinto job no Scheduler. Cada recurso ganha a
   própria chave de liga e desliga dentro da função. Manter o nome da função
   evita que o deploy apague o job e crie outro. Quem agendou no mesmo dia pula o
   lembrete: recebeu a confirmação horas antes.
7. **Telefone.** O envio vai para `55` + `telefoneCanonico`. O `wa_id` devolvido
   é guardado em HMAC, porque em contas antigas ele vem sem o nono dígito. Fixo
   falha com o erro 131026: estado `falhou`, o painel mostra "sem WhatsApp" e o
   botão manual continua como reserva.
8. **Cliente HTTP próprio**, com `fetch`, `AbortSignal.timeout` e
   `redirect: "error"`, como em `avaliacao-google.js`. Nenhum SDK novo entra nas
   dependências auditadas.
9. **Reconciliação.** Todo envio leva `biz_opaque_callback_data` com o ID da
   notificação, e a Meta devolve esse valor no webhook de status. Timeout depois
   do POST vira `revisar`; um status que chega depois resolve o caso sozinho. O
   que continuar em `revisar` aparece no painel com botão de reenvio. Erro
   transitório antes de a Meta aceitar (429, 5xx) ganha até três tentativas com
   backoff na mesma execução.
10. **Webhook.** Confere `X-Hub-Signature-256` com o App Secret sobre
    `req.rawBody`, grava o evento e responde 200. O processamento fica no
    gatilho de `whatsapp_eventos` porque, no Cloud Run, a função perde CPU depois
    de responder. A verificação inicial (GET com `hub.challenge`) responde com
    `Cache-Control: no-store`. App Check não se aplica: quem chama é a Meta.
11. **Chaves por HMAC com segredo**, como `identificadorDestinatario`. SHA-256
    puro de celular se reverte por força bruta, porque há poucos números
    possíveis.
12. **Configuração.** No Secret Manager: token do System User, App Secret,
    verify token e chave HMAC. No `.env.<projeto>`: `WHATSAPP_ATIVO=false`, ID do
    número, ID da conta (WABA) e versão da Graph API. Cada tipo de aviso liga e
    desliga em `configuracoes/agenda.whatsapp`, pelo painel e sem deploy, como
    `limitesAgendamento`.

### Estados de `notificacoes_whatsapp`

| Estado | Significado |
|---|---|
| `pendente` | criada, ainda não enviada |
| `enviando` | reservada em transação; nenhuma outra execução envia |
| `aceita` | a Meta devolveu o `wamid` |
| `entregue`, `lida` | status recebido pelo webhook |
| `falhou` | erro definitivo, com o código da Meta (ex.: 131026, número sem WhatsApp) |
| `revisar` | resultado incerto: timeout depois do POST |
| `cancelada` | deixou de valer antes do envio (cancelamento, opt-out, data passada) |

O documento guarda ID do agendamento, tipo, data, hora, estado, `wamid`, código
de erro e horários. Nome, telefone e texto da mensagem não entram.

---

## Mensagens

Templates em `pt_BR`, categoria utilidade:

| Template | Quando | Botões |
|---|---|---|
| `agendamento_confirmado` | ao agendar no site, ou no encaixe se a pessoa autorizou | Documentos (link) · Preciso cancelar |
| `lembrete_atendimento` | véspera, 17h | Vou comparecer · Preciso cancelar · Documentos |
| `agendamento_remarcado` | remarcação no painel | os mesmos do lembrete |
| `agendamento_cancelado` | cancelamento pela Câmara | Agendar de novo (link) |
| `atendimento_alterado` | aviso em lote para uma data (sistema estadual fora do ar, ponto facultativo) | Falar com a recepção (link) |
| `avaliacao_atendimento` | 17h do dia, para quem compareceu e aceitou | Avaliar (link do Google) |
| `documento_para_retirada` (opcional) | a CIN de morador da zona rural chegou à Câmara | — |

O link "Documentos" aponta para `/cin/documentos/`, porque a lista completa e o
aviso da taxa não cabem em 1.024 caracteres. Cada botão de resposta rápida leva
no payload um token HMAC do agendamento, definido na hora do envio.

Exemplo de confirmação:

> Olá! O atendimento de {{1}} para a Carteira de Identidade (CIN) está
> confirmado para {{2}}, às {{3}}, na Câmara Municipal de Itanhandu. Código do
> comprovante: {{4}}. Ele é pedido para consultar ou cancelar pelo site. Se não
> puder ir, cancele: a falta sem aviso bloqueia novo agendamento por 6 meses.

- "Atendimento de {{1}}" porque o celular muitas vezes é do responsável. O teto
  de 2 agendamentos por celular existe por causa das famílias.
- Só primeiro nome, data, hora e protocolo. CPF e nascimento nunca.
- Sem nome de vereador nem tom de divulgação: impessoalidade (art. 37, §1º, da
  Constituição) e risco de a Meta reclassificar para marketing.
- Poucas mensagens, todas esperadas. Bloqueio e denúncia derrubam a nota de
  qualidade do número.

### O que fica de fora

- **Aviso de falta e bloqueio de 6 meses.** Gera reclamação e bloqueio do
  número. Se um dia entrar, a recepção dispara caso a caso.
- **Aviso de "vagas abertas".** Juntaria mais gente na mesma virada das 08:00
  que o sistema trabalha para aliviar.

---

## Bot de atendimento

Tudo aqui é resposta dentro da janela de 24h que o toque no botão ou a mensagem
do cidadão abre: mensagem de serviço, dentro da franquia.

### Fase 2 — respostas aos botões

- **"Vou comparecer"** grava `presencaConfirmadaEm`, e a Fila do dia mostra.
- **"Preciso cancelar"** pede confirmação em dois botões ("Sim, cancelar" e
  "Não") e cancela com a mesma transação de `cancelarAgendamentoCidadao`
  (`functions/index.js:1717`). Essa transação vira uma função interna comum aos
  dois caminhos, com as checagens da contenção B5: só libera a vaga e o índice de
  CPF que ainda apontam para o agendamento. Vale a regra de
  `validarAgendamentoPublicoFuturo`: horário passado não se cancela.
- **Titularidade.** O token HMAC do payload identifica o agendamento, e o
  telefone de origem precisa bater com o cadastrado. Quem tem dois agendamentos
  no mesmo celular cancela o certo, porque cada mensagem leva o seu token.
- **"SAIR"** grava opt-out em `whatsapp_optout/{HMAC do telefone}`, e a fila
  passa a cancelar os avisos desse número. Um agendamento novo com a caixa do
  WhatsApp marcada desfaz o opt-out.
- **Texto livre** recebe resposta fixa: este número envia avisos do
  agendamento; para falar com a recepção, (35) 3504-0397; para agendar ou
  consultar, o site.

### Fase 3 — menu

Lista interativa: meu agendamento, cancelar, documentos, endereço e horário,
prazo e entrega da CIN, como agendar, falar com a recepção.

- Identificação pelo telefone do webhook contra `telefones_agendados`. Sem
  telefone (nome de usuário e nenhum contato recente), o bot manda para a
  consulta do site.
- O bot não pede CPF nem nascimento no chat.
- As respostas saem de `editorial/dados/servico.json` e do FAQ num passo de
  build, para o bot nunca dizer algo diferente do site. Mudança de texto segue o
  fluxo editorial que já existe: campo `conferido` e
  `npm --prefix editorial run verificar`.
- Estado da conversa em `whatsapp_conversas/{HMAC}`, com TTL de 24h. O texto das
  mensagens recebidas não é guardado.

### Fase 3b — IA, opcional

A IA classifica o texto livre em uma das respostas prontas ou em "encaminhar
para a recepção". Ela não redige resposta. Sequências de dígitos são mascaradas
antes de sair do servidor.

| Opção | Preço | Por mensagem (prompt fixo de ~5 mil tokens) |
|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | US$ 4 / 20 por milhão de tokens (entrada / saída) | US$ 0,02 a 0,03 |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | US$ 0,10 / 0,50 por milhão de tokens | cerca de 40 vezes menos |
| Meta Business Agent | US$ 2 por milhão de tokens | US$ 0,04 a 0,05 |

Meçam Opus e Haiku num conjunto de mensagens reais antes de escolher. Cache de
prompt quase não acerta com mensagens espaçadas. O agente da Meta redige
respostas livres; para orientação oficial sobre documentos, não recomendo. A IA
escolhida entra na política de privacidade como operadora.

---

## Site, painel e LGPD

- **Formulário** (`public/index.html:566`, ao lado do aceite de avaliação):
  caixa opcional e desmarcada, "Quero receber a confirmação, o lembrete e avisos
  deste agendamento no WhatsApp da Câmara Municipal de Itanhandu". O backend
  grava `consentimentoWhatsApp`, a data e a versão do texto, no padrão de
  `consentimentoAvaliacao` (`functions/index.js:1407`), e o campo fica fora do
  `payloadHash`, como `aceiteAvaliacao`. A caixa desmarcada repete a decisão da
  auditoria LGPD-04 para o convite de avaliação.
- **Avaliação.** O aceite atual fala só em e-mail (`public/index.html:569`).
  Convidar por WhatsApp exige texto e aceite novos; aceites antigos não valem
  para o WhatsApp.
- **Tela de sucesso.** "Nada é enviado automaticamente" muda conforme o aceite.
  O botão de autoenvio fica como reserva.
- **Painel:**
  - campo "autorizou WhatsApp" no encaixe manual;
  - situação de cada aviso (enviado, entregue, lido, falhou, sem autorização) e
    presença confirmada na Fila do dia;
  - aviso em lote por data e reenvio do que ficou em `revisar`, por callable;
  - "Lembretes de amanhã" abre só quem ficou sem o automático, para ninguém
    receber dois;
  - liga e desliga de cada tipo de aviso em Configuração.

  Botões novos seguem o registro `data-acao` (travas em
  `functions/painel-delegacao.test.js`). O painel nunca fala com a Meta: tudo
  passa por callable.
- **Privacidade.** `docs/POLITICA-PRIVACIDADE.md` e
  `editorial/conteudo/paginas/privacidade.md` (ainda marcada como rascunho)
  ganham a Meta como operadora, a finalidade de confirmação e lembrete, o
  armazenamento no Brasil e a retenção dos registros de envio. Passa pelo
  encarregado da Câmara.
- **Guias.** `como-agendar` e `consultar-ou-cancelar` citam o número oficial e o
  cancelamento pelo botão, pelo fluxo editorial.
- **Firestore.** `notificacoes_whatsapp`, `whatsapp_eventos`,
  `whatsapp_conversas` e `whatsapp_optout` ficam fechadas em `firestore.rules`;
  o admin só lê `notificacoes_whatsapp`. Todas têm `expiraEm` e entram na
  manutenção diária, menos `whatsapp_optout`, que vale até um novo aceite.
- **Alertas.** Envio em `revisar` ou `falhou` acima do normal e erro 5xx no
  webhook, no mesmo canal de e-mail das políticas atuais.

## Onde encostar no código

| Arquivo | Mudança |
|---|---|
| `functions/whatsapp-cloud.js` (novo) | cliente da Graph API (template, texto, botões, lista), verificação da assinatura, classificação de erro |
| `functions/notificacoes-whatsapp.js` (novo) | regras puras (diferença antes/depois, elegibilidade, ID, parâmetros de cada template) e o serviço da fila, no molde de `criarServicoAvaliacao` |
| `functions/bot-whatsapp.js` (novo) | estado da conversa e respostas |
| `functions/index.js` | `planejarNotificacoesWhatsApp`, `enviarNotificacaoWhatsApp`, `webhookWhatsApp`, `processarEventoWhatsApp`, job das 17h, callables do painel, cancelamento extraído para função interna |
| `firebase.json` | rewrite `/api/whatsapp` para `webhookWhatsApp` em `southamerica-east1` |
| `firestore.rules` | quatro coleções novas |
| `functions/.env.example` | variáveis novas, documentadas |
| `public/index.html` | caixa de aceite e texto da tela de sucesso |
| `public/recepcao.html`, `public/recepcao.js` | situação dos avisos, presença, aviso em lote, reenvio, configuração |
| `docs/POLITICA-PRIVACIDADE.md`, `editorial/` | privacidade e guias |
| `README.md` | seção da integração, no formato da avaliação |

## Testes

- **Unidade** (`node --test`, com `fetch` simulado e banco em memória, como os
  atuais): diferença antes/depois, elegibilidade, ID e idempotência, assinatura
  do webhook (válida, inválida, corpo alterado), classificação de erro,
  reconciliação por `biz_opaque_callback_data` e bot (botões, confirmação do
  cancelamento, SAIR, webhook sem telefone).
- **Emulador** (`tests/emulador/transacoes.test.js`): cancelamento pelo WhatsApp
  disputando a vaga com um agendamento novo.
- **Homologação** (`cin-itanhandu-homolog`): o número de teste da Meta envia
  para até 5 destinatários cadastrados. Ciclo completo com um celular real.
- **Produção.** Um cadastro autorizado antes de ligar para todos, conferindo
  entrega, webhook e painel.

---

## Fases e cronograma

### Fase 0 — Meta e Câmara

Começa já, porque depende de terceiros e de prazo de calendário.

Com a Câmara:

- portfólio empresarial da Meta no CNPJ da Câmara, com administradores da
  Câmara; o desenvolvimento entra como administrador ou parceiro, não como dono;
- verificação da empresa;
- número novo (celular em nome da Câmara ou fixo verificado por ligação);
- forma de pagamento e conta de cobrança em reais;
- revisão da política de privacidade pelo encarregado.

Com o desenvolvimento:

- app em developers.facebook.com, conta do WhatsApp Business (WABA) e número
  com armazenamento no Brasil configurado antes do registro;
- nome de exibição "Câmara Municipal de Itanhandu", logo, site e endereço no
  perfil;
- System User com token permanente (`whatsapp_business_messaging` e
  `whatsapp_business_management`) e PIN da verificação em duas etapas do número;
- webhook assinado no campo `messages`;
- templates enviados para aprovação.

### Fase 1 — confirmação e lembrete

Aceite no site, os três módulos com testes, gatilho, remetente, job das 17h,
webhook de status, painel e política de privacidade. O código pode ser escrito
durante a fase 0, desligado por `WHATSAPP_ATIVO`. A confirmação vai ao ar
sozinha por uma semana; com entregas e falhas conferidas, entra o lembrete.

### Fase 2 — botões e avisos

Presença, cancelamento pelo WhatsApp, avisos de remarcação e de cancelamento
pela Câmara, aviso em lote por data, SAIR e convite de avaliação.

### Fase 3 — menu, e 3b com IA se for aprovada

Nenhuma fase sobe nas horas de uma abertura (segunda, das 07:50 às 09:00) nem
entre ligar e desligar o pré-aquecimento. A medida de sucesso sai dos dados que
já existem: faltas (`nao_compareceu`) por semana antes e depois, cancelamentos
com antecedência e vagas que voltaram para a agenda.

## Custo estimado

Com 130 a 170 agendamentos por mês:

| Item | Por mês |
|---|---|
| Confirmação e lembrete (~300 templates de utilidade) | ~US$ 2 |
| Convite de avaliação (até ~120) | US$ 0,80 como utilidade; US$ 7,50 se virar marketing |
| Respostas do bot | US$ 0 (franquia de 1.000) |
| Firebase | dentro da franquia; nenhum job novo no Scheduler |
| **Total** | **US$ 3 a 10** |

Só mensagem entregue é cobrada. A IA da fase 3b, se entrar, soma pouco: algumas
centenas de mensagens livres por mês dão poucos dólares no Opus e centavos no
Haiku.

---

## Decisões em aberto

1. **Número:** novo, só para a API (recomendado), ou coexistência no
   (35) 3504-0397.
2. **Pagamento:** cartão da Câmara direto na Meta, com fatura em reais, ou
   contrato com um parceiro (BSP) que emite nota fiscal e cobra mensalidade.
   Cabe à contabilidade e ao controle interno.
3. **Avaliação:** passar do e-mail para o WhatsApp ou manter os dois.
4. **IA no bot:** usar ou não, e com qual modelo.

## Fontes

Conferidas em 22/10/2026:

- [Preços, isenção de governo e Meta Business Agent](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Limites de mensagens](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [Categorias de template](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)
- [BSUID e nomes de usuário](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/)
- [Coexistência com o app Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Armazenamento local](https://developers.secure.facebook.com/docs/whatsapp/cloud-api/overview/local-storage/)
- [Webhook de status e `biz_opaque_callback_data`](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status)
- [Armazenamento local indisponível em coexistência (360dialog)](https://docs.360dialog.com/docs/hub/local-storage)
- [Tarifa de marketing no Brasil (MessageCentral)](https://www.messagecentral.com/blog/whatsapp-business-api-pricing-brazil)
- [Política de IA da Meta (TechCrunch)](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform)
