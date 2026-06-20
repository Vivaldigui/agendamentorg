# Agendamento CIN — Câmara Municipal de Itanhandu

Sistema web de **agendamento da Carteira de Identidade Nacional (CIN/RG)** para a Câmara Municipal de Itanhandu (MG). O cidadão escolhe data e horário, informa seus dados e recebe a confirmação; a recepção administra a fila do dia, remarcações, encaixes e relatórios.

- **Produção:** https://agendamento-cin-itanhandu.web.app
- **Projeto Firebase:** `agendamento-cin-itanhandu`
- **Repositório:** https://github.com/Vivaldigui/agendamentorg

---

## Visão geral

O sistema tem duas faces, servidas como site estático pelo Firebase Hosting e apoiadas por Cloud Functions:

| Página | Quem usa | Função |
|---|---|---|
| [`public/index.html`](public/index.html) | Cidadão | Agendar, consultar e cancelar agendamento |
| [`public/recepcao.html`](public/recepcao.html) | Recepção / Admin | Fila do dia, check-in, encaixes, remarcação, configuração da agenda, logs e backup |

Toda gravação de dados passa por **Cloud Functions** — o frontend nunca escreve diretamente nas coleções sensíveis. As operações críticas (criar, cancelar, remarcar) rodam em **transações atômicas do Firestore**, garantindo que uma vaga nunca seja vendida duas vezes mesmo sob acesso simultâneo.

---

## Stack

- **Firebase Hosting** — frontend estático + PWA ([`manifest.json`](public/manifest.json), [`sw.js`](public/sw.js))
- **Cloud Functions (2ª geração, Node.js 22)** — `firebase-functions ^7`, `firebase-admin ^13`
- **Cloud Firestore** — dados de agendamento e configuração
- **Realtime Database** — métricas de presença/acesso em tempo real
- **Firebase App Check** (reCAPTCHA v3) — proteção das funções públicas contra abuso
- **Firebase Analytics** (`G-KWKF7NCJHK`)
- **Frontend** — HTML/CSS/JS puro, Firebase JS SDK 8.10.1, Font Awesome (servido localmente em `public/vendor`)

---

## Estrutura do projeto

```
agendamentorg/
├── firebase.json            # Hosting, rewrites, headers (CSP), Functions, regras
├── .firebaserc              # Projeto padrão: agendamento-cin-itanhandu
├── firestore.rules          # Regras de segurança do Firestore
├── database.rules.json      # Regras do Realtime Database
├── functions/
│   ├── index.js             # Todas as Cloud Functions e regras de negócio
│   └── package.json         # Runtime Node 22
├── public/
│   ├── index.html           # App público (cidadão)
│   ├── recepcao.html        # Painel administrativo
│   ├── 404.html
│   ├── sw.js                # Service worker (pass-through)
│   ├── manifest.json        # PWA
│   ├── icons/ , vendor/     # Ícones e libs servidas localmente
└── scripts/
    ├── preaquecer-ligar.ps1     # Sobe instâncias quentes antes de um pico
    ├── preaquecer-desligar.ps1  # Volta ao repouso após o pico
    └── migrar-dados-cidadaos.js # Migração pontual de dados legados
```

---

## Cloud Functions

Definidas em [`functions/index.js`](functions/index.js).

### Públicas (`onCall`, exigem App Check)
| Função | Descrição |
|---|---|
| `carregarAgendaPublica` | Datas e horários disponíveis (callable) |
| `carregarAgendaPublicaHttp` | Mesma agenda via HTTP, exposta em `/api/agenda-publica` com cache de CDN |
| `verificarBloqueioCpf` | Informa se um CPF está temporariamente bloqueado |
| `consultarAgendamentoCidadao` | Localiza agendamento por CPF + data de nascimento |
| `criarAgendamentoCidadao` | Cria o agendamento (transação atômica; suporta substituição do agendamento anterior do mesmo CPF) |
| `prepararCancelamentoCidadao` | Gera token temporário para cancelamento |
| `cancelarAgendamentoCidadao` | Efetiva o cancelamento e libera a vaga |

### Administrativas (`onCall`, exigem admin autenticado)
| Função | Descrição |
|---|---|
| `criarEncaixeManual` | Encaixe manual fora da grade pública |
| `atualizarObservacaoAdmin` | Observação interna no agendamento |
| `remarcarAgendamentoAdmin` | Remarca data/horário |
| `listarLogsAdmin` | Auditoria de ações administrativas |
| `gerarBackupAdmin` | Exportação de dados |

### Gatilho e tarefas agendadas
| Função | Gatilho |
|---|---|
| `registrarMetricasAcessoPublico` | RTDB `onValueCreated` em `presenca_publica/conexoes` |
| `limparDatasPassadasAgenda` | Cron diário `0 2 * * *` (America/Sao_Paulo) |
| `anonimizarDadosAntigosLGPD` | Cron mensal `0 3 1 * *` — anonimiza dados com retenção > 6 meses |
| `limparSessoesAcessoPublico` | Cron diário `15 4 * * *` |

---

## Modelo de dados

### Firestore
| Coleção | Conteúdo |
|---|---|
| `dados_cidadaos` | Agendamentos (nome, CPF, contato, data/hora, status) |
| `vagas_ocupadas` | Slots ocupados, doc id `AAAA-MM-DD_HH:MM` — fonte da verdade da disponibilidade |
| `cpfs_agendados` | Índice CPF → agendamento ativo (chave por hash SHA-256 do CPF) |
| `bloqueios_agendamento` | CPFs bloqueados temporariamente (ex.: ausência em atendimento anterior) |
| `cancelamentos_pendentes` | Tokens de cancelamento com expiração |
| `rate_limits` | Contadores de limitação por ação/fingerprint |
| `configuracoes/agenda` | Dias, horários e avisos configurados pela recepção |
| `admins` | E-mails autorizados a acessar o painel |
| `logs_admin` | Trilha de auditoria das ações administrativas |

### Realtime Database
`presenca_publica/` — `conexoes`, `sessoes` e `metricas` para acompanhar acessos simultâneos em tempo real.

---

## Robustez e segurança

- **Validação de CPF** com dígitos verificadores, no frontend e no backend.
- **App Check obrigatório** (`enforceAppCheck: true`) em todas as funções públicas.
- **Rate limiting** por fingerprint (IP + User-Agent + ação/CPF), em transação.
- **Transações atômicas** para criar/cancelar/remarcar — disponibilidade, bloqueio de CPF e duplicidade são revalidados *dentro* da transação (sem janelas de corrida).
- **Substituição por CPF**: ao agendar com um CPF que já tem agendamento ativo, o anterior é cancelado e o novo criado na mesma transação, mediante confirmação do cidadão.
- **Retry com backoff exponencial** no backend (leituras auxiliares) e no frontend (envio do agendamento).
- **LGPD**: anonimização automática de dados após 6 meses.
- **Pré-aquecimento configurável** via `PICO_MIN_INSTANCES` para eventos de alta demanda.

---

## Pré-requisitos

- [Node.js 22](https://nodejs.org/)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm i -g firebase-tools`) autenticado com acesso ao projeto
- Dependências das functions:

```bash
cd functions
npm install
```

---

## Deploy

> O frontend deve ir ao ar **antes** das functions quando há mudanças de contrato, para que o cliente novo já esteja disponível.

```bash
# Frontend (Hosting)
firebase deploy --only hosting --project agendamento-cin-itanhandu

# Backend (Cloud Functions)
firebase deploy --only functions --project agendamento-cin-itanhandu

# Uma função específica
firebase deploy --only functions:criarAgendamentoCidadao --project agendamento-cin-itanhandu
```

Após um deploy de Hosting, force a atualização do service worker incrementando o `CACHE_NAME` em [`public/sw.js`](public/sw.js) quando necessário.

---

## Preparação para picos de acesso

Aberturas de agenda com hora marcada geram pico simultâneo (efeito manada). Os scripts em `scripts/` ajustam o número de instâncias "quentes" sem editar código:

```powershell
# ~30-45 min antes do pico — sobe minInstances
.\scripts\preaquecer-ligar.ps1

# ~1h depois — volta ao repouso
.\scripts\preaquecer-desligar.ps1
```

Internamente eles definem a variável de ambiente `PICO_MIN_INSTANCES` e fazem deploy de `criarAgendamentoCidadao` e `carregarAgendaPublicaHttp`. **Não execute outros `firebase deploy` entre ligar e desligar**, pois o pré-aquecimento seria desfeito.

---

## Migração de dados legados

[`scripts/migrar-dados-cidadaos.js`](scripts/migrar-dados-cidadaos.js) converte agendamentos no formato antigo (doc id de slot `AAAA-MM-DD_HH:MM`) para a estrutura atual (`dados_cidadaos` + `vagas_ocupadas` + `cpfs_agendados` indexado por hash). Roda em modo simulação por padrão; use `--commit` para aplicar.

```bash
# Simulação (não grava)
node scripts/migrar-dados-cidadaos.js

# Aplicar de fato
node scripts/migrar-dados-cidadaos.js --commit
```

Requer credenciais de aplicação (`GOOGLE_APPLICATION_CREDENTIALS`) com acesso ao Firestore do projeto.

---

## Monitoramento

```bash
# Logs de uma função em tempo real
firebase functions:log --only criarAgendamentoCidadao --project agendamento-cin-itanhandu
```

Métricas de uso e acessos em tempo real ficam no Realtime Database (`presenca_publica`) e no Firebase Analytics.
