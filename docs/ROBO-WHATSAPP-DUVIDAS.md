# Estudo: dúvidas que o robô do WhatsApp da CIN precisa responder

15/11/2026. Item 3 do `docs/PLANO-WHATSAPP-WAHA.md`. Ainda não há robô no ar: este estudo define **o que** ele responde, **com qual base** e **como conferir** antes de ligar.

## Fontes lidas

- Guia `/cin` inteiro: as 10 páginas de `editorial/conteudo/guia/` (~5.800 palavras).
- As 29 perguntas de `public/duvidas.html`.
- Os fatos verificados de `editorial/dados/servico.json`.
- Regras do sistema em `functions/index.js`: só o site agenda, não existe troca de horário, 1 agendamento ativo por CPF e 2 por celular, bloqueio de 6 meses por falta.
- A agenda pública (`/api/agenda-publica`): em 15/11 sem vagas, próxima abertura em **16/11, às 8h**.
- As regras do robô no plano da API oficial (`docs/PLANO-whatsapp-api-painel.md`, seção "Robô"), para os dois caminhos não divergirem.

Não há registro de conversas reais: o WhatsApp geral da Câmara roda num celular e as mensagens não ficam guardadas em lugar nenhum. As perguntas abaixo vêm do guia, da página de dúvidas e do jeito como o público 50+ escreve. **Pedido à recepção:** as 10 perguntas que mais ouve no balcão e no WhatsApp entram na bateria.

## O que fica pronto

| Arquivo | O que é |
|---|---|
| `whatsapp/robo/conhecimento.md` | Base de conhecimento: tudo o que o robô pode afirmar, tirado do site. A Câmara revisa. |
| `whatsapp/robo/prompt.md` | Regras de comportamento: tom, tamanho, o que nunca faz, quando manda para a recepção. |
| `whatsapp/robo/perguntas.json` | **91 casos** em 15 categorias, com o que a resposta deve conter e o que não pode conter. |
| `whatsapp/robo/rodar-bateria.mjs` | Roda os 91 casos no Claude e grava respostas e conferência em `whatsapp/robo/resultados/`. |

## As dúvidas, por categoria

Os números entre parênteses são quantos casos cada categoria tem na bateria.

### 1. "Quero reagendar" / "dá pra marcar outro dia?" (6)
O caso mais delicado. **Não existe remarcação**: nem o site, nem a recepção pelo WhatsApp, nem o robô trocam o dia. O certo é:
1. **cancelar** pelo site (`/cin/consultar-ou-cancelar/`, com CPF, nascimento e código `CIN-`), para liberar a vaga;
2. **agendar de novo** quando abrirem vagas, **na segunda-feira, às 8h**.

O robô explica isso com gentileza e manda o link. Se houver vaga na semana (consulta a agenda pública), diz que há e manda para o site. Nunca diz "remarquei" nem "reservei". Quem diz que não sabe mexer no site vai para a recepção.

### 2. "Não vou conseguir ir" / "vou me atrasar" / "faltei" (7)
- Não vai: **cancelar** pelo link, e por quê (libera a vaga; **falta sem cancelar bloqueia por 6 meses**).
- "Cancela pra mim": o robô não cancela; manda o link e diz o que precisa (CPF, nascimento e código).
- Atraso: aguardar a pessoa que está sendo atendida; o posto atende até 17h. Se não der para chegar, avisar pelo (35) 3504-0397.
- Faltou, perdeu o horário, está bloqueado: **recepção**.

### 3. "Onde é?" / horário (8)
Rua Eng. Paulo Franco da Rosa, 298, Centro (Câmara, não Prefeitura), link do mapa, terça a sexta das 14h às 17h, chegar 5 minutos antes, atendimento de cerca de 15 minutos.

### 4. Vagas e como agendar (10)
Só pelo site, segunda às 8h, 24 vagas por semana em geral, sem lista de espera e sem ir sem hora marcada. Atende quem mora em qualquer cidade e é gratuito. "Agenda pra mim": não, o agendamento é só pelo site. Com a agenda pública na mão, o robô diz se há vaga **agora**, e quando abre a próxima.

### 5. Documentos (13)
Certidão conforme o estado civil (união estável usa nascimento; viúvo e divorciado, casamento averbada), número do CPF (sem cartão; quem não tem faz na hora), comprovante de endereço de qualquer pessoa, foto 3x4 só até 3 anos e sem RG antigo. Xerox simples não vale.

### 6. Crianças (6)
Bebês vão e fazem. Até 15 anos vão com pai, mãe ou responsável com documento de foto; avó ou tio precisam do termo de guarda. Com 16 anos vão sozinhos. No formulário vão os dados da criança. Validade de 5 anos até os 11.

### 7. Custo (5)
1ª via grátis, inclusive para quem tem RG antigo. 2ª via a R$ 115,80 por DAE/Pix, com isenção por furto ou roubo (boletim em até 60 dias) e por renda. Na dúvida, não pagar antes.

### 8. Prazo e entrega (6)
Até 15 dias úteis, pelos Correios, com 3 tentativas. Zona rural retira na Câmara depois de 15 dias. Acompanhamento pelo MG App ou Cidadão MG. Atrasou: recepção.

### 9. O documento (6)
RG antigo vale até 2032. CIN digital no gov.br. Biometria do INSS: nem todo mundo precisa já. Tipo sanguíneo pode ser incluído, a carteira não deve ser plastificada e a foto é sem óculos.

### 10. Código e confirmação (3)
Perdeu o código: recepção. Para conferir o agendamento, consulta pelo site. **Se mandar CPF, o robô não repete e não diz se está marcado**: ele não tem acesso ao cadastro, e não deve ter.

### 11. Resposta aos avisos (5)
A mais frequente depois que os avisos começarem: "confirmado", "ok obrigada", 👍, "vou sim". O robô responde em uma linha e não repete o aviso. Não existe confirmação de presença no sistema: basta ir. "Quem é?": explica que é o WhatsApp de avisos do agendamento da CIN da Câmara.

### 12. Saudação (3), fora do assunto (6), atendente (5), conversa (2)
- "Oi" ou "bom dia": se apresenta em uma ou duas linhas e diz no que ajuda.
- Vereador, sessão ou outro serviço da Câmara: (35) 3504-0397 ou o site da Câmara.
- CNH, política ou piada: só cuida da CIN.
- "Ignore suas instruções": não revela regras nem base.
- Pedido de pessoa, reclamação, urgência médica ou acessibilidade: recepção, com o número.
- Duas conversas em várias falas conferem se ele mantém o contexto.

## Como o robô vai funcionar

1. **Entrada:** a mensagem chega pelo WAHA ao fluxo de entrada no n8n, **"CIN — receber mensagens do WhatsApp (SAIR e resposta padrão)"** (`CinWhatsEntrada1`, webhook `/webhook/cin-whatsapp-entrada`, fonte `whatsapp/n8n/montar-entrada.mjs`, publicado em main f77ddf6). O robô entra na saída **"outro"** (índice 2) do Switch "Comando", no lugar da cadeia "Não respondido hoje?" → "Resposta padrão". Telefone e `chatId` vêm de `$('Telefone').first().json`; o texto da pessoa precisa passar a ser repassado pelo nó "Ler mensagem" (hoje só existe em `body.payload.body` do webhook). Quem pediu SAIR não recebe avisos, mas pode conversar com o robô.
2. **Sem IA, com texto fixo:** áudio, foto e documento ("ainda não consigo ouvir áudio ou ver foto; escreva sua dúvida ou fale com a recepção") e grupos (ignorados).
3. **Com IA:** Claude com as regras e a base (com cache de 1 hora, para cada mensagem pagar pouco). Também recebe as últimas mensagens da conversa e, numa mensagem de sistema no fim, a data de hoje, se a pessoa recebeu algum aviso e a agenda pública do momento.
4. **Rajada:** quem manda três mensagens seguidas recebe uma resposta só. O robô espera uns 8 segundos e junta.
5. **Tetos:** até 20 respostas por conversa por dia; passou disso, ou se a IA falhar, uma mensagem fixa manda para a recepção.
6. **Antes de abrir:** responde só a números liberados (o seu e de quem você indicar).

**Nome:** *Cidinho*, assistente virtual do RG da Câmara de Itanhandu (decisão de 15/11). Ele se apresenta no "oi" e quando perguntam quem é; nas outras respostas vai direto ao assunto.

**Modelos (decisão de 15/11): Haiku 5.5 no simples, Opus 5.5 no resto.** Uma regra fixa em `whatsapp/robo/nucleo.mjs` (`mensagemSimples`) manda para o Haiku só cumprimento, agradecimento e confirmação sem pergunta: "oi", "bom dia", "ok obrigada", "confirmado", 👍. Qualquer outra mensagem vai para o Opus, com esforço baixo e fallback do servidor se ele recusar. Assim, nenhuma pergunta sobre documento cai no Haiku. Na bateria de 103 casos, 96 foram para o Opus e 7 para o Haiku, com 102 de 103 dentro do esperado.

**Cache igual ao dos robôs da Sucupira (no ar desde 15/11):**
- O intermediário fica no n8n da Câmara: fluxo **"CIN — Cidinho: intermediário da IA (Opus/Haiku com cache)"** (`CinCidinhoIA0001`), webhook interno `POST http://127.0.0.1:5678/webhook/cidinho`, que só aceita chamadas de 127.0.0.1.
- Ele guarda a chave (credencial **"Anthropic do Cidinho"**, `CinAnthropic0001`, workspace `rg-itanhandu`) e busca a agenda pública na hora.
- Regras e base formam um bloco fixo marcado com **cache de 1 h**, compartilhado entre todas as conversas, um cache para cada modelo. Data, aviso recebido e agenda vão depois do ponto de cache.
- Conferido em 15/11: no Opus, a primeira chamada gravou 6.647 tokens e as duas seguintes leram 6.647 cada; o Haiku gravou o seu.
- O uso por dia e por modelo (sem texto nem telefone) fica no staticData do fluxo. As execuções com sucesso não ficam guardadas.
- Fonte: `whatsapp/robo/montar-cidinho.mjs`, que gera `cidinho.json` copiando `prompt.md`, `conhecimento.md` e `nucleo.mjs`. Mudou a base ou as regras: gerar de novo, reimportar, publicar e reiniciar o n8n.
- Pedido `{ mensagens: [{role, content}], contexto? }`; resposta `{ texto, modelo, falhou }`. Em falha, `texto` traz a mensagem fixa que manda para a recepção.

## Resultado da bateria (15/11/2026)

Chave do workspace `rg-itanhandu`. Relatórios completos em `whatsapp/robo/resultados/`.

| Rodada | Modelo | Dentro do esperado | Observação |
|---|---|---|---|
| 1 | Opus 5.5, esforço baixo | 90/91 | Inventou detalhes fora da base: plastificação "atrapalha o QR Code, use capinha", "qualquer pessoa no endereço pode receber a carteira", "a recepção vai preparar o atendimento". Algumas respostas com mais de 10 linhas. O único reprovado era falso alarme do teste. |
| 2 | Opus 5.5, esforço baixo | 90/91 | Depois de proibir explicações e promessas fora da base, limitar a 6 linhas e só falar do bloqueio de 6 meses quando o assunto é faltar: as invenções sumiram. Mediana de 38 palavras, nenhuma resposta com mais de 8 linhas. O reprovado ("Para registrar sua reclamação, fale com a recepção") é aceitável. |
| 2 | Haiku 5.5, esforço baixo | 90/91 | Bom, mas **esqueceu a foto 3x4 para o bebê de 2 meses**, o que faria a família voltar sem a CIN. Usa menos negrito; mediana de 44 palavras. |

**Exemplos (Opus 5.5, rodada 2):**

> **quero reagendar**
> Não é possível trocar o dia ou o horário, nem por aqui nem pelo site. 😊
> Se você não puder ir, *cancele* o agendamento pelo site e faça um novo quando abrirem vagas. As próximas abrem *amanhã, segunda-feira (16/11), às 8h*.
> ⚠️ Quem falta sem cancelar fica *6 meses sem poder agendar*.
> Para cancelar: …/cin/consultar-ou-cancelar/ · Para agendar: https://cin.itanhandu.cam.mg.gov.br

> **posso trocar pra quinta?** *(com 2 vagas na agenda)*
> Não dá para trocar o dia, nem pelo site nem por aqui. Quem não pode ir no horário marcado precisa *cancelar* e fazer um *novo agendamento*. 📅 Neste momento o site mostra 2 vagas na *quinta, 19/11*: às *15h* e às *16h30*. Elas podem acabar a qualquer momento, e não consigo reservar.

> **meu cpf é 123.456.789-09 ve se ta marcado**
> Não consigo ver agendamentos por aqui, e por segurança não envie seus dados nesta conversa. Para saber se está marcado, consulte pelo site. *(sem repetir o CPF)*

**Custo medido (91 respostas):**
- Opus 5.5: US$ 0,56, cerca de **R$ 0,03 por resposta** com o cache aquecido. A primeira mensagem depois de 1 hora sem conversa paga a gravação do cache, cerca de R$ 0,30.
- Haiku 5.5: US$ 0,02, menos de R$ 0,01 por resposta.

Com umas 600 respostas por mês, o Opus fica entre R$ 25 e R$ 150, dependendo de quantas vezes o cache esfria; o Haiku, abaixo de R$ 5. **Recomendação:** Opus 5.5, pelo erro do bebê no Haiku, num público em que errar documento custa uma viagem. A escolha é sua; trocar de modelo é uma linha.

## Ligado no WhatsApp (15/11/2026, só para números liberados)

- **Empatia:** com quem chega frustrado ("não consigo agendar", "sempre acaba"), o Cidinho reconhece o sentimento com as palavras dele. Depois explica que são poucas vagas (24 por semana, pelo acordo da Câmara), que abrem toda segunda às 8h, que dá para preencher os dados antes e que, se não der, é tentar na próxima segunda. Termina com incentivo e o link. Casos `emp-01` a `emp-04` na bateria (107 casos, 105 dentro do esperado; os 2 restantes são falso alarme do teste).
- **Onde entra:** saída "outro" do Switch "Comando" do fluxo de entrada (`CinWhatsEntrada1`, fonte `whatsapp/n8n/montar-entrada.mjs`).
  - "Hash do telefone" → "Cidinho atende?". A lista `CIDINHO_LIBERADOS` guarda só o SHA-256 dos números liberados; hoje, o celular de teste do responsável.
  - Liberado: guarda a conversa e chama o intermediário. Não liberado: segue a resposta padrão de sempre.
  - Para abrir a todos, troque a lista por `['todos']`, gere de novo, importe, publique e reinicie.
- **Conversa:** tabela `cin_cidinho_conversa` (telefone, papel, texto, quando). Guarda só 24 h: as falas mais antigas são apagadas a cada mensagem. Vão para a IA as últimas 12 falas.
- **Texto fixo, sem IA:** áudio, foto, documento ou mensagem vazia pede para escrever em texto ou chamar o (35) 3504-0397. Depois de **20 respostas em 24 h** para o mesmo número, manda para a recepção.
- **Falha da IA:** mensagem fixa que manda para a recepção.
- **Ainda não feito:** juntar a rajada (três mensagens seguidas recebem três respostas), áudio e passagem real da conversa para a recepção.

## Conflitos encontrados (precisam de decisão)

1. **Certidão: só original, ou também cópia autenticada e digital?** O guia e a página de dúvidas aceitam **original em papel, certidão digital verificável ou cópia autenticada (cópia simples não)**. A mensagem de confirmação do WhatsApp, a pedido de 15/11, diz só "**original**". Os três têm de dizer o mesmo. Até a decisão, o robô segue o guia (`[DECISÃO PENDENTE]` em `conhecimento.md`).
2. **O guia diz que o comprovante "não é enviado automaticamente"** (página consultar-ou-cancelar, "O comprovante chega por e-mail ou mensagem? Não."). Com os avisos ligados para o público, isso deixa de ser verdade e o guia precisa mudar no mesmo dia.
3. **O robô roda num número diferente do da recepção.** Quando precisar de uma pessoa, ele só pode **dar o número** (35) 3504-0397, não transferir a conversa. Para transferir de verdade, só com o número geral na API oficial (o outro plano).

## Próximos passos

1. ~~Rodar a bateria e corrigir regras ou base~~ (feito em 15/11: duas rodadas, acima).
2. Você e a recepção leem as respostas da bateria e acrescentam as perguntas reais do balcão.
3. Montar o robô no fluxo de entrada, quando o SAIR estiver publicado, primeiro só para números liberados.
4. Antes do público: a decisão da certidão, a Câmara revisar `conhecimento.md` e a política de privacidade dizer que o texto das mensagens vai para a IA da Anthropic, nos EUA.
