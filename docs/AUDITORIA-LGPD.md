# Auditoria LGPD — sistema de agendamento da CIN

Feita em 30/08/2026 sobre a branch `reorganizacao-painel-recepcao`. Lê o código,
não a intenção: cada afirmação abaixo aponta o arquivo e a linha.

**Controlador:** Câmara Municipal de Itanhandu.
**Operador:** Google (Firebase Hosting, Firestore, Cloud Functions, Realtime
Database, Analytics).
**Titulares:** cidadãos que agendam a emissão da CIN, incluindo crianças.

---

## Dados pessoais tratados

| Dado | Origem | Onde vive | Sensível? |
|---|---|---|---|
| Nome | formulário | `dados_cidadaos` | não |
| CPF | formulário | `dados_cidadaos`, `cpfs_agendados`, `bloqueios_agendamento` | não |
| Data de nascimento | formulário | `dados_cidadaos` | não |
| Telefone / WhatsApp | formulário | `dados_cidadaos` | não |
| E-mail | formulário, **opcional** | `dados_cidadaos` | não |
| Protocolo | gerado | `dados_cidadaos`, `localStorage` do aparelho | não |
| Nome + telefone + categoria **idoso / deficiente** | painel da recepção | `credenciais_estacionamento` | **sim** (art. 5º, II — dado referente à saúde) |
| Nome e ações do operador | painel | `logs_admin` | não |
| IP e User-Agent | requisição | **só como SHA256**, nunca em claro (`functions/index.js:543-564`) | pseudonimizado |

Menores de idade são titulares frequentes aqui: a CIN é emitida inclusive para
bebês. O art. 14 exige que o tratamento de dados de crianças seja feito no melhor
interesse delas e com informação clara aos responsáveis.

---

## O que já existe, e está certo

Este sistema não começa do zero em proteção de dados. O que segue já é
conformidade real, não promessa:

1. **Minimização (art. 6º, III).** Cinco campos, e o e-mail é opcional. Não há
   endereço, RG, filiação nem renda no formulário.
2. **Retenção definida e automatizada (art. 15 e 16).** `anonimizarDadosAntigosLGPD`
   roda mensalmente e, passados **6 meses**, apaga CPF, telefone, e-mail e data de
   nascimento e substitui o nome por `ANONIMIZADO`
   (`functions/index.js:641-742`). Poucos sistemas municipais têm isso rodando
   sozinho.
3. **IP nunca é armazenado em claro.** O controle de abuso usa
   `SHA256(ip|user-agent|cpf)` como chave, e o IP bruto é descartado
   (`functions/index.js:543-564`). Isso é privacidade desde a concepção
   (art. 46, §2º) em código, não em texto.
4. **Tudo fechado por padrão.** `firestore.rules` termina em
   `match /{document=**} { allow read, write: if false; }`. As coleções internas
   — `rate_limits`, `operacoes_agendamento`, `cancelamentos_pendentes` — são
   inacessíveis a qualquer cliente, inclusive autenticado.
5. **Acesso administrativo verificado.** O painel exige usuário autenticado que
   exista em `admins` **e** esteja `ativo == true`, checado a cada operação.
6. **Autoatendimento do titular.** Consultar e cancelar exigem CPF + data de
   nascimento + segundo fator (protocolo ou telefone). Na prática, os direitos de
   acesso e de eliminação do agendamento já são exercíveis sem intervenção humana.
7. **Segurança de transporte e de aplicação.** HSTS, CSP restritivo,
   `X-Frame-Options: DENY`, `nosniff`, App Check com reCAPTCHA e limitação de
   taxa por origem.
8. **Trilha de auditoria imutável.** `logs_admin` aceita criação e leitura, mas
   `update` e `delete` são negados a qualquer cliente — atende ao art. 37.
9. **Dados no Brasil, no caminho principal.** Firestore e as funções críticas
   rodam em `southamerica-east1` (São Paulo).
10. **Higiene automática do descartável.** A manutenção diária limpa
    `rate_limits`, `cancelamentos_pendentes` e `operacoes_agendamento`
    (`functions/index.js:2072-2074`).

---

## O que falta

Ordenado por gravidade.

### 1. A política de privacidade citada no formulário não existe — GRAVE

O formulário exige aceite de um texto que diz "conforme a **Política de
Privacidade LGPD da Câmara de Itanhandu**" (`public/index.html:389-391`). Essa
política não existe no site, não tem link e não está publicada em lugar nenhum.

Não é omissão neutra: o sistema afirma ao cidadão que existe um documento que
rege o tratamento dos seus dados, e não o entrega. Do ponto de vista do art. 9º,
é transparência prometida e não cumprida — pior do que não ter mencionado.

### 2. A base legal está errada — GRAVE

O checkbox é de **consentimento** (art. 7º, I). Para a Câmara, quase certamente
não é essa a base.

O tratamento aqui é execução de política pública de identificação civil por órgão
do Poder Público — art. 7º, III combinado com o art. 23. E o consentimento, para
ser válido, precisa ser **livre** (art. 8º): quem recusar o checkbox simplesmente
não consegue agendar a CIN. Consentimento que não pode ser negado não é
consentimento.

Consequência prática: se a base declarada é o consentimento, o titular pode
revogá-lo a qualquer tempo (art. 8º, §5º) e exigir eliminação — inclusive de
registro necessário à prestação do serviço. A Câmara estaria se obrigando a algo
que a lei não exige dela.

**Correção:** o checkbox deixa de ser "concordo com a coleta" e passa a ser
"**estou ciente** de como meus dados serão tratados", com link para a política.

### 3. Encarregado (DPO) não identificado — GRAVE

O art. 41 obriga o controlador a indicar encarregado e a **divulgar publicamente,
de forma clara e objetiva, sua identidade e informações de contato**. Não há nada
no site.

Isso é decisão da Câmara, não do sistema: alguém precisa ser designado por ato
formal.

### 4. Não há canal para os direitos do titular — GRAVE

O art. 18 dá ao titular nove direitos. Hoje o sistema atende dois, e só dentro do
agendamento: acesso e eliminação, pela aba Consultar/Cancelar.

Não existe caminho para: **correção** de nome grafado errado, confirmação da
existência de tratamento, informação sobre com quem os dados são compartilhados,
ou eliminação antes dos 6 meses. Quem quiser exercer esses direitos hoje não tem
para onde escrever.

### 5. Analytics ativo sem qualquer aviso — MÉDIO

`firebase.analytics()` é ativado em `public/index.html:533`, e o CSP libera
`googletagmanager.com`, `google-analytics.com`, `analytics.google.com` e
`stats.g.doubleclick.net`. Isso grava identificador no navegador do cidadão e
envia dados de navegação para a Google, fora do país.

Não há aviso, não há menção em política e não há como recusar. Em site de órgão
público, medição de audiência é defensável — mas precisa ser declarada, e o
cidadão precisa saber que existe.

### 6. Duas lacunas na retenção — MÉDIO

**`remarcado` nunca é anonimizado.** `STATUS_ANONIMIZAR_LGPD`
(`functions/index.js:62-70`) lista `compareceu`, `vai_voltar`, `nao_compareceu`,
`cancelado`, `cancelado_cidadao` e `cancelado_camara`. Falta `remarcado`, que é
status terminal e existe na lista geral de status. Todo registro remarcado fica
com CPF, telefone e nascimento **para sempre**.

**`logs_admin`, `credenciais_estacionamento` e `bloqueios_agendamento` não têm
prazo.** A limpeza diária não os alcança. `logs_admin` recebe cópia do nome do
cidadão em toda ação de credencial (`public/recepcao.js:3289-3392`) e, em
bloqueios, do CPF. Como o cliente não pode apagar log, esses nomes ficam
indefinidamente. O art. 16 exige eliminação após o fim da finalidade — e
"auditoria" não é finalidade eterna sem prazo declarado.

### 7. Dado sensível tratado como dado comum — MÉDIO

`credenciais_estacionamento` guarda a categoria **idoso ou deficiente**. Informação
sobre deficiência é dado referente à saúde, portanto **dado pessoal sensível**
(art. 5º, II), e exige base legal do art. 11 — mais estrita que a dos demais.

Hoje esse dado está na mesma prateleira do resto: mesmas regras, sem prazo de
eliminação, e com o nome do titular copiado para os logs.

### 8. Falta o registro das operações de tratamento — MÉDIO

O art. 37 obriga o controlador a manter registro das operações que realiza. Este
documento é um bom começo, mas o registro formal — finalidade, base legal,
categorias de dados e de titulares, prazo, compartilhamentos — não existe.

### 9. Transferência internacional não declarada — BAIXO

Firestore e as funções críticas estão em São Paulo, mas o Realtime Database está
em `us-central1` e o Analytics processa fora do país. O art. 33 exige que
transferência internacional tenha fundamento e seja informada.

Atenuante: a telemetria de presença que usaria o RTDB está **desligada**
(`METRICAS_ACESSO_PUBLICO_ATIVAS = false`). Se for religada, passa a haver dado de
acesso saindo do país — e aí precisa estar na política antes, não depois.

### 10. Sem procedimento para incidente de segurança — BAIXO

O art. 48 exige comunicação à ANPD e aos titulares em caso de incidente com risco
relevante. Não há procedimento escrito: quem decide, em quanto tempo, por qual
canal, com que texto.

---

## O que melhorar, além do que falta

- **Aviso em camadas no formulário.** Uma linha curta acima dos campos — "seus
  dados são usados só para o agendamento e apagados em 6 meses" — com link para a
  política. Ninguém lê política; quase todo mundo lê uma linha.
- **Tornar a conformidade visível.** Bloco "Privacidade e LGPD" na grade de
  serviços e linha no rodapé. Hoje o sistema faz mais pela privacidade do que
  aparenta: anonimização automática e IP hasheado não aparecem em lugar nenhum
  para o cidadão.
- **Dizer o prazo em números.** "Seus dados são apagados 6 meses após o
  atendimento" é mais forte, e mais verificável, do que "pelo tempo necessário".
- **Explicar o bloqueio de 6 meses.** É o tratamento que mais gera dúvida e
  reclamação. Precisa constar da política: qual dado fica, por quanto tempo, e
  como contestar.
- **Reter menos no log.** `registrarLog` poderia gravar o id da credencial em vez
  do nome do cidadão. O log continua auditável e deixa de acumular nome.

---

## Minha recomendação sobre a ordem

**Publicar uma política antes de fechar as lacunas aumenta o risco em vez de
reduzir.** A política é declaração pública do controlador: se ela afirmar que o
titular pode pedir eliminação a qualquer momento e não houver canal para isso,
o documento vira prova contra a Câmara, não a favor.

Ordem sugerida:

1. **Corrigir a base legal no formulário** — checkbox de consentimento vira
   ciência. É código, meia hora.
2. **A Câmara define o encarregado e o canal de contato.** Bloqueia a publicação
   da política; não há como escrever o documento sem isso.
3. **Publicar `public/privacidade.html`**, com o texto de
   `docs/POLITICA-PRIVACIDADE.md`.
4. **Fechar as lacunas de retenção** — incluir `remarcado`, dar prazo a
   `logs_admin`, `credenciais_estacionamento` e `bloqueios_agendamento`.
5. **Registro das operações de tratamento**, documento interno.

Os itens 1 e 3 já deixam o sistema em situação muito melhor que a atual. O item 4
é o que sustenta o que a política vai afirmar.

---

## Decisões que só a Câmara pode tomar

Nenhuma delas é técnica, e nenhuma pode ser inventada por quem escreve o código:

1. **Quem é o encarregado pelo tratamento de dados**, com nome e canal de
   contato para publicação.
2. **Qual o canal oficial para os direitos do titular** — e-mail, protocolo
   presencial, ou os dois.
3. **O Analytics fica?** Se ficar, entra na política e ganha aviso. Se não for
   usado para nada de fato, desligar é a saída mais limpa: elimina a
   transferência internacional de dado de navegação e uma seção inteira da
   política.
4. **Qual o prazo de guarda dos logs administrativos**, considerando que servem à
   fiscalização da própria Câmara.
