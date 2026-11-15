# Plano: WhatsApp do agendamento da CIN pelo WAHA

Escrito em 15/11/2026. Nada foi montado ainda.

Objetivo: um número próprio do agendamento, ligado ao WAHA, que (1) manda mensagens de utilidade sobre o agendamento e (2) responde dúvidas com IA. É um número de teste, comprado só para isso. Nunca o (35) 3504-0397 nem o chip do robô dos vereadores.

## O que já existe e vai ser reaproveitado

| Peça | Onde | Uso aqui |
|---|---|---|
| n8n da Câmara | Easypanel, projeto `camara-itanhandu`, serviço `n8n` (https://camara-itanhandu-n8n.kip816.easypanel.host) | Orquestra envio e robô |
| WAHA GOWS (CORE) | mesmo projeto, serviço `waha`, sessão `camara` | Modelo para um **segundo** serviço, `waha-cin` |
| Padrão Function → webhook do n8n com token | `functions/avaliacao-google.js` (convite de avaliação) | Mesmo padrão para as mensagens de utilidade |
| Telefone do cidadão | já gravado no agendamento; anonimizado em 6 meses | Destino das mensagens |
| Guia `/cin/` | `editorial/conteudo/` | Base de conhecimento do robô |
| Agenda pública | `carregarAgendaPublicaHttp` | O robô consulta se há vagas |

**Por que um WAHA separado:** o CORE (grátis) roda uma sessão por contêiner, e a sessão `camara` já é do aviso aos vereadores. Um contêiner `waha-cin` (mesma imagem `devlikeapro/waha:gows-2026.10.1`, volume próprio, sem domínio público) mantém os dois números independentes: cair um não derruba o outro.

## Arquitetura

```
Cidadão agenda no site
   └─ Function grava em mensagens_whatsapp (fila no Firestore)
        └─ gatilho onDocumentCreated → POST no webhook do n8n (com token)
             └─ n8n: confere opt-in, check-exists, espera, sendText no waha-cin
                  └─ devolve enviado/erro → Function marca o documento

Cidadão escreve no número
   └─ waha-cin → webhook "message" → n8n
        └─ filtro (sem grupo, sem status, sem eco do próprio número, sem chat pausado)
             └─ Agente de IA (Claude) + ferramentas → resposta pelo sendText
```

Regra de ouro: **o site continua sendo o único lugar que cria, remarca ou cancela agendamento.** O robô informa e manda o link. Agendar pelo robô contornaria App Check, reCAPTCHA e os tetos por celular e por conexão que protegem a abertura das vagas.

## Mensagens de utilidade

Todas só para quem marcou a caixa nova no formulário: "Quero receber avisos deste agendamento no WhatsApp" (desmarcada por padrão, como a do convite de avaliação).

| # | Quando | Conteúdo | Gatilho |
|---|---|---|---|
| U1 | Logo depois de agendar | Data, hora, endereço, protocolo, documentos a levar, link para cancelar | `criarAgendamentoCidadao` grava na fila |
| U2 | Véspera, 18h | Lembrete + "se não puder ir, cancele pelo link e libere a vaga" | rotina diária |
| U3 | Dia, 7h (opcional, decidir no teste) | Lembrete curto com horário | rotina diária |
| U4 | Remarcado pela Câmara | Nova data e hora | `remarcarAgendamentoAdmin` |
| U5 | Cancelado pela Câmara | Motivo curto + link para agendar de novo | `cancelarAgendamentoAdmin` |
| U6 | Cancelado pelo cidadão | Confirmação do cancelamento | `cancelarAgendamentoCidadao` |
| U7 | Status "vai voltar" | O que falta e como voltar | `alterarStatusAdmin` |
| U8 | Depois do atendimento | Convite de avaliação no Google (hoje só por e-mail) | `enviarAvaliacoesGooglePendentes` |
| U9 | Novas vagas abertas (lista própria, opt-in separado) | "Abriram vagas para a semana de …" | `prepararAgendaSemanalAutomatica` |

Regras de texto:
- nunca CPF nem data de nascimento na mensagem; protocolo pode;
- link sempre para `https://cin.itanhandu.cam.mg.gov.br`;
- rodapé fixo: "Responda SAIR para não receber mais avisos";
- textos curtos, letra comum, sem emoji em excesso; aprovação da Câmara antes de ligar.

Para U2/U3: o Cloud Scheduler já tem quatro jobs (o quarto custa ~US$ 0,10/mês). Duas saídas: um job novo `enviarLembretesWhatsApp` às 18h, ou o n8n disparar às 18h uma Function HTTPS com token que devolve os lembretes do dia seguinte. Prefiro a primeira: a lógica fica testada junto com o resto em `functions/`.

## Robô de IA

**Escopo:** tirar dúvidas sobre a CIN em Itanhandu — documentos, gratuidade, criança, segunda via, horário, endereço, se há vagas, como agendar/cancelar. Fora disso: "não consigo ajudar com isso aqui" e o contato da Câmara.

**Montagem no n8n:**
1. Webhook do `waha-cin` (eventos `message`; ignorar `@g.us`, `status@broadcast` e `fromMe`).
2. Tabela `cin_conversas` (Data table): telefone (hash), última mensagem, pausado_ate, opt_out.
3. "SAIR" → opt_out e confirmação; "ATENDENTE" → pausa o robô 24 h no chat e avisa a recepção (e-mail ou grupo da recepção).
4. Agente de IA (nó AI Agent, modelo Claude Haiku 5.5 para custo; Sonnet 5.5 se a qualidade pedir) com:
   - prompt de sistema com o guia `/cin/` inteiro (é pequeno; com prompt caching sai barato);
   - ferramenta `ver_vagas` → `carregarAgendaPublicaHttp`;
   - ferramenta `link_agendar` / `link_cancelar` (texto fixo);
   - memória das últimas 10 mensagens do chat.
5. Resposta com "digitando…" e espera proporcional ao tamanho (WAHA `startTyping`).
6. Horário: responde 24 h; fora do expediente avisa que atendente humano só no horário da Câmara.
7. Áudio: no começo responde "por enquanto só leio texto". Transcrição fica para depois.

**O que o robô não faz:** consultar agendamento por CPF (dado pessoal pelo WhatsApp, sem a verificação do site), prometer prazo de entrega da carteira, dar informação que não está no guia.

**Registro:** cada conversa grava pergunta, resposta e se escalou, para ler a cada semana e corrigir o guia ou o prompt. Apagar depois de 90 dias.

## Fases

### Fase 0 — Número e infraestrutura (você + eu, ~1 dia)
- [ ] **Você:** comprar o chip, pôr num celular Android dedicado, instalar o WhatsApp Business, perfil "CIN Itanhandu — Agendamento", foto e horário.
- [x] **Eu:** criar o serviço `waha-cin` no Easypanel. Feito em 15/11/2026: `devlikeapro/waha:gows-2026.10.1`, volume `sessions`, 512 MB, só rede interna (`http://camara-itanhandu_waha-cin:3000`). A chave foi gerada dentro do n8n: o WAHA guarda só o hash e a chave em claro está na credencial **"WAHA da CIN"** (`CinWahaKey000001`, Header Auth `X-Api-Key`). Conferido: 401 sem chave, 200 com chave, nenhuma sessão.
- [x] **Eu:** fluxo **"CIN — conectar o celular do WhatsApp (WAHA)"** (`CinWahaConectar1`, cópia do `CamaraWahaConect`; fonte em `whatsapp/n8n/waha-conectar-cin.json`). Importado em 15/11/2026. Conferido pela API: a sessão `cin` sobe, chega a `SCAN_QR_CODE` e o QR sai em PNG; depois foi parada (`STOPPED`) até o chip chegar.
- [x] Celular conectado em 15/11/2026 pelo código de pareamento (o QR do n8n vence antes de ser lido: o WhatsApp troca o código a cada ~20 s). Sessão `cin` em `WORKING`, número final 5361, nome de perfil "Câmara Municipal de Itanhandu".
- [x] ~~**Você:** com o celular na mão, abrir o fluxo~~ no n8n da Câmara e clicar em **Testar fluxo**. Abrir a saída do nó **QR Code**, clicar na imagem e ler no WhatsApp do chip (*Aparelhos conectados › Conectar aparelho*). O QR vale 1 minuto; se passar, rode de novo. Outra opção: preencher `numero_do_chip` no nó "Dados" e usar o código do nó **Código de pareamento**. Rodar de novo deve mostrar "Conectado — tudo certo"; com `telefone_teste` preenchido, chega uma mensagem de teste.
- [ ] **Eu:** teste de envio para o seu número.

### Fase 1 — Mensagens de utilidade em ensaio (~2–3 dias)

**Decisões de 15/11/2026 (do usuário):** sem aviso de remarcação (poucas vagas, a recepção não remarca). A abertura das 8h gera ~25 agendamentos de uma vez: as confirmações saem aos poucos, sem demorar.

**Montado em 15/11/2026 (código local, sem commit nem deploy):**
- `functions/whatsapp-cin.js` + `whatsapp-cin.test.js` (12 testes; suíte inteira 512/512).
  - Gatilho `avisarWhatsappAgendamento` em `dados_cidadaos` só **enfileira** em `whatsapp_envios` (confirmação, cancelado pela Câmara, cancelado pelo cidadão).
  - Rotina `processarFilaWhatsappCin` a cada 5 min, das 7h às 21h55: a partir das 18h enfileira os lembretes de amanhã; envia a fila com 15–30 s entre mensagens e no máximo 4 min por rodada. 25 confirmações das 8h saem em 3 rodadas, até ~8h20.
  - Na hora de enviar relê o agendamento: confirmação de quem já cancelou é descartada.
  - A fila não guarda telefone nem texto; falha ambígua fica em `revisar` e não é reenviada.
  - Parâmetros: `WHATSAPP_CIN_MODO` (desligado/ensaio/ativo), `WHATSAPP_CIN_TELEFONES_TESTE`, `WHATSAPP_CIN_WEBHOOK_URL`; segredo `WHATSAPP_CIN_N8N_TOKEN` (gravado no Secret Manager em 15/11, versão 1).
- `criarAgendamentoCidadao` grava `avisoWhatsapp: true` só com a caixa marcada (`aceiteWhatsapp`), fora do hash de idempotência.
- `public/index.html`: caixa opcional e desmarcada, **escondida** para o público; aparece só com `?whatsapp=teste` no endereço.
- `firestore.rules`: `whatsapp_envios` fechada para o navegador.
- n8n da Câmara: fluxo **"CIN — enviar aviso do agendamento pelo WhatsApp (WAHA)"** (`CinWhatsEnviar01`, webhook `/webhook/cin-whatsapp-enviar`), publicado. Fonte: `whatsapp/n8n/montar-enviar.mjs` (recebe o SHA-256 do token). Confere o hash do cabeçalho `X-Cin-Token`, o número no WhatsApp, mostra "digitando" 3–6 s e envia. Não guarda execução com sucesso (telefone e texto). Testado: token errado → 401; número sem WhatsApp → `sem_whatsapp`.

**Falta antes de ligar para o público (modo `ativo`):** tratar o **SAIR** (as mensagens já pedem), textos aprovados pela Câmara e a política de privacidade.
- [ ] Caixa de opt-in no formulário + campo `avisoWhatsapp` no agendamento; testes em `functions/`.
- [ ] Coleção `mensagens_whatsapp` + regras do Firestore fechadas para o navegador.
- [ ] Gatilho e webhook do n8n (token em secret, como o da avaliação).
- [ ] U1, U2, U4, U5, U6 primeiro.
- [ ] Interruptor `WHATSAPP_ATIVO` (padrão false) e modo `ensaio`: tudo vai só para `telefone_teste`.
- [ ] Deploy com o cuidado de sempre: `git fetch`, `main` em dia com `origin/main`, nunca segunda das 6h às 10h.

### Fase 2 — Robô de IA em ensaio (~2–3 dias)
- [ ] **Você:** chave da API da Anthropic (ou reaproveitar a do intermediário dos robôs da Sucupira, se fizer sentido separar o custo por projeto).
- [ ] Fluxo do robô com SAIR/ATENDENTE, ferramentas e memória.
- [ ] Bateria de 40 perguntas reais (as que a recepção mais ouve) rodada antes de abrir.
- [ ] Só responde a números de uma lista branca (você e quem você indicar).

### Fase 3 — Abrir para o público (decisão da Câmara)
- [ ] Textos aprovados pela Câmara.
- [ ] Ligar `WHATSAPP_ATIVO=true`, depois abrir o robô para todos.
- [ ] Número no site (página de confirmação e `/cin/`), só depois de uma semana estável.
- [ ] Medir por 2 semanas: faltas antes × depois do lembrete U2 (o painel já tem `nao_compareceu`), cancelamentos que liberaram vaga, conversas escaladas.

### Fase 4 — Depois (se valer)
- U3, U7, U8 (avaliação pelo WhatsApp), U9 (lista de novas vagas).
- Transcrição de áudio no robô.
- Migrar para a API oficial da Meta se o teste der certo e a Câmara quiser número definitivo.

## Custos

| Item | Custo |
|---|---|
| Chip | o que você pagar + recarga mínima para não perder a linha |
| Celular | um Android que você já tenha |
| WAHA CORE | grátis (só RAM da VPS, ~150 MB) |
| n8n | já existe |
| IA | Haiku com cache: centavos por conversa; estimar com o volume real da Fase 2 |
| Cloud Scheduler | +US$ 0,10/mês se criar o job de lembrete |

## O que preciso de você para começar

1. O chip ativo no celular (Fase 0).
2. Um telefone de teste para o modo ensaio.
3. OK para criar o `waha-cin` no projeto `camara-itanhandu` do Easypanel.
4. Depois: a chave da API de IA e o aval da Câmara nos textos.
