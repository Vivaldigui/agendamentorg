# Plano: mensagens curtas no WhatsApp da CIN (Cidinho e avisos)

18/11/2026. Pedido: "as mensagens estão muito grandes, poluídas, muita informação, ninguém lê".
**Aplicado em 18/11/2026 ~15h15** (main 1191ce2 + 9cf3ce5): functions `processarFilaWhatsappCin` e `avisarWhatsappAgendamento` publicadas; fluxos `CinWhatsEntrada1` e `CinCidinhoIA0001` importados, publicados e n8n reiniciado. Decisões do responsável: certidão por estado civil só na opção 2; SAIR só na confirmação (e no RG pronto, que vai também para quem não marcou a caixa); **só números**, sem lista nem botões. A opção 6 (ou ATENDENTE) avisa o responsável pelo WhatsApp (5535999901497), uma vez por conversa de 24 h, com o telefone, link wa.me e as últimas mensagens da pessoa.

## O que está errado hoje

- **Confirmação:** ~17 linhas. Título, saudação, frase longa, data, endereço, protocolo,
  bloco da certidão por estado civil (5 linhas), link de cancelar, aviso do lembrete, rodapé SAIR.
- **Lembrete:** ~19 linhas. Repete a lista inteira e ainda soma o "‼️ NÃO ESQUEÇA A CERTIDÃO ‼️".
- **Cidinho:** média de 356 caracteres e 6 linhas por resposta (bateria de 15/11). Quase toda
  resposta começa com "Olá! Sou o Cidinho, assistente virtual do RG da Câmara de Itanhandu.",
  junta coisa que não foi perguntada e fecha com frase de efeito ("Força, você consegue!").
- **Rodapé SAIR** em todo aviso.

## Regras novas

1. **Uma mensagem, um assunto.** No máximo **5 linhas** nos avisos e **3 frases curtas** no Cidinho.
2. **O mais importante na 1ª linha** (dia e hora, ou a resposta "sim/não").
3. Detalhe só quando a pessoa pede: vai para o **menu**.
4. Um emoji por bloco, no máximo 3 por mensagem. Sem ‼️, sem ⚠️ em toda resposta.
5. Link só quando a pessoa precisa fazer algo no site.
6. SAIR só na **confirmação** (primeiro contato). Nos outros avisos sai do rodapé
   (o comando continua funcionando).

## Avisos automáticos (functions/whatsapp-cin.js)

### Confirmação (17 → 9 linhas)

```
✅ *RG agendado: terça, 25/11, às 14h30*
📍 Câmara de Itanhandu – Rua Eng. Paulo Franco da Rosa, 298

Leve:
• *Certidão original* ou autenticada (nascimento ou casamento)
• Número do CPF
• Comprovante de endereço

Não pode ir? Cancele aqui: https://cin.itanhandu.cam.mg.gov.br/cin/consultar-ou-cancelar/
Dúvida? Responda *MENU*. Para parar os avisos, *SAIR*.
```

A regra da certidão por estado civil sai daqui e vira a opção 2 do menu.

### Lembrete do dia (19 → 6 linhas)

```
⏰ *Hoje, às 14h30*, é o seu RG na Câmara.
Chegue 5 minutos antes.

📄 *Sem a certidão original (ou autenticada), não dá para fazer.*
Leve também o CPF e o comprovante de endereço.

Não vai? Cancele: https://cin.itanhandu.cam.mg.gov.br/cin/consultar-ou-cancelar/
```

### Cancelado pela pessoa (3 linhas)

```
Seu RG de terça, 25/11, às 14h30 foi *cancelado*.
Novas vagas: toda segunda, às 8h, em https://cin.itanhandu.cam.mg.gov.br
```

### Cancelado pela Câmara (3 linhas)

```
A Câmara *cancelou* seu RG de terça, 25/11, às 14h30.
Para marcar de novo: https://cin.itanhandu.cam.mg.gov.br
Dúvidas: (35) 3504-0397
```

### RG pronto (3 linhas)

```
🎉 *Seu RG chegou!* Já pode buscar na Câmara.
Seg a sex, 8h–12h e 14h–17h. Rua Eng. Paulo Franco da Rosa, 298.
```

### Avaliação (3 linhas)

```
Como foi o seu atendimento do RG? Conte no Google, leva 1 minuto:
https://g.page/r/CfugOJBgujYPEBM/review
```

As variações de texto (anti-bloqueio) continuam, mas curtas: só a 1ª linha muda
("RG agendado" / "Agendamento confirmado" / "Tudo certo com seu RG").

## Cidinho

### Menu com opções

Aparece na **1ª mensagem do dia**, quando a pessoa manda só "oi"/"bom dia", ou escreve **MENU**:

```
Oi! Sou o *Cidinho*, do RG da Câmara de Itanhandu. 👋
Responda com o número:

1️⃣ Agendar / tem vaga?
2️⃣ O que levar
3️⃣ Consultar ou cancelar
4️⃣ RG de criança
5️⃣ Prazo e entrega
6️⃣ Falar com uma pessoa

Ou escreva sua dúvida.
```

As opções 1 a 6 têm **resposta fixa** (sem IA): saem iguais, curtas, sem custo.
Pergunta escrita continua indo para a IA.

Respostas fixas:

| Nº | Resposta |
|---|---|
| 1 | As vagas abrem *toda segunda, às 8h*, para terça a sexta. Acabam rápido. Agende só pelo site: link. *(+ linha "Agora: X vagas" ou "Próximas: segunda, 8h", da "Agenda agora")* |
| 2 | *Certidão original ou autenticada* (solteiro: nascimento; casado: casamento; viúvo/divorciado: casamento com averbação). CPF (só o número). Comprovante de endereço. Xerox, foto e PDF não valem. |
| 3 | Consulte ou cancele aqui (precisa do CPF, nascimento e código CIN-): link. Não dá para trocar o dia: cancele e agende de novo na segunda. |
| 4 | A criança precisa ir, com pai, mãe ou responsável (com RG ou CNH). Leve a certidão dela. Menor de 3 anos: 1 foto 3x4 de fundo branco. |
| 5 | Chega pelos Correios em até 15 dias úteis. Acompanhe no MG App. Zona rural: busque na Câmara. |
| 6 | Fale com a recepção: WhatsApp *(35) 3504-0397*, terça a sexta, 14h–17h. |

### Botões: o que dá e o que não dá

O número usa WAHA (motor GOWS), não a API oficial da Meta.

- **Botões de resposta:** o próprio WAHA marca como *descontinuado, não funcionam*. Não usar.
- **Lista** (`/api/sendList`, um botão "Ver opções" que abre as 6 opções): funciona no GOWS,
  mas o WAHA avisa que pode parar a qualquer momento.
- **Números (1 a 6):** sempre funcionam, em qualquer celular.

**Proposta:** testar a lista no seu celular. Se abrir certinho, o menu sai como lista, e o
texto com números fica como reserva (se o envio da lista der erro, manda o texto). Se não abrir,
fica só com os números. O robô entende os dois: o clique da lista e o número digitado.

### Prompt da IA (whatsapp/robo/prompt.md)

- Apresentação só no menu; nas respostas da IA, **nunca**.
- **Até 3 frases curtas** (hoje: "até 6 linhas"). Responder só o perguntado.
- Empatia em **meia frase** quando a pessoa reclama ("Entendo, acaba rápido mesmo."), sem frase
  de incentivo no fim.
- Sem ⚠️ e sem listas, a não ser na lista de documentos.
- Fechar com "Responda *MENU* para ver as opções" **só** quando a dúvida for vaga.

Antes e depois (perguntas reais da bateria):

**"vcs estao agendando rg?"**
- Hoje (6 linhas): apresentação + regra + bloco 📅 + link.
- Novo: `Sim! Só pelo site, toda segunda às 8h. Próximas vagas: segunda, 24/11. https://cin.itanhandu.cam.mg.gov.br`

**"sou divorciado"**
- Hoje (7 linhas): apresentação + certidão + ⚠️ autenticada + outros documentos.
- Novo: `Leve a *certidão de casamento com a averbação do divórcio*, original ou autenticada em cartório.`

**"posso plastificar?"**
- Hoje: apresentação + ⚠️.
- Novo: `Não. Não plastifique a CIN.`

## Fases

1. **Avisos** (functions/whatsapp-cin.js + testes): textos novos, SAIR só na confirmação.
   Deploy das duas functions. Conferir na abertura de segunda, 24/11, 8h.
2. **Prompt do Cidinho:** regras novas + bateria (`rodar-bateria.mjs`) com dois critérios
   novos: até 250 caracteres e nenhuma apresentação fora da 1ª mensagem. Meta: média < 200.
3. **Menu no n8n** (montar-entrada.mjs): reconhecer MENU/1–6/clique da lista antes da IA,
   respostas fixas, "Agenda agora" na opção 1. Teste da lista no seu celular.
4. **Conferência** depois de uma semana: tamanho médio das respostas, quantos usam o menu,
   quantos pedem "pessoa".

## Decisões suas

1. Tirar a regra da certidão por estado civil da confirmação (fica no menu, opção 2)?
2. SAIR só na confirmação?
3. Testar a lista com botão ou ir direto só com números?
