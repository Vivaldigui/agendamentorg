# Prompt — auditoria das mudanças de 24/08/2026

Cole o conteúdo abaixo como mensagem para o ChatGPT.

---

Faça uma **auditoria independente** das mudanças feitas hoje no projeto AgendamentoRG. Outro assistente diagnosticou os problemas, escreveu as correções e as implantou em produção no mesmo dia. Seu trabalho é encontrar o que ele deixou passar — **inclusive erros nas decisões que ele tomou e nos números que ele mediu**.

Trate tudo abaixo como hipótese a ser testada, não como fato aceito. **Se algo estiver errado, diga.** Discordância fundamentada é o produto mais valioso desta tarefa. Concordar com o que já está escrito não ajuda ninguém.

## Onde está o código

Repositório público: `https://github.com/Vivaldigui/agendamentorg`, branch `main`.

Os seis commits de hoje, em ordem:

```
2ea6a3b  Segundo fator, aviso da abertura e fim das datas embutidas
48e6fa0  Recupera recusa de App Check e renova o token na volta da aba
8a5396c  Testes do protocolo deixam de depender da quebra de linha do checkout
d98a08a  Adiciona .gitattributes para fixar LF no repositorio
bccc251  Move o caminho critico do pico para southamerica-east1
ae636d5  Pre-aquecimento por Cloud Run, na regiao nova, com conferencia
```

O estado anterior é `51118b4`. O diff do dia: 13 arquivos, +1190/−75. Comece por `git diff 51118b4..ae636d5`.

**Tudo já está no ar.** Qualquer defeito que você encontrar está em produção agora.

## O sistema, em um parágrafo

Agendamento de RG/CIN da Câmara Municipal de Itanhandu. Firebase Hosting, Cloud Functions v2, Firestore (`southamerica-east1`), Realtime Database (`us-central1`). Toda segunda às 08:00 (`America/Sao_Paulo`) a agenda da semana abre automaticamente: terça a sexta, 10 horários por dia, **40 vagas**. Centenas de pessoas tentam ao mesmo tempo e a maioria fica sem vaga — 40 é o teto real, isso é aritmética e não defeito.

Hoje, 24/08, houve uma abertura: 40/40 vagas preenchidas em 26 minutos, zero erro de servidor. As mudanças auditadas aqui foram feitas **depois** dela, com a agenda já esgotada. A próxima abertura é **07/09**.

O que mais importa, em ordem: ninguém receber falso "sem vagas"; ninguém perder dados preenchidos; ninguém ficar preso em tela desatualizada; nenhuma vaga vendida duas vezes; nenhum dado pessoal vazar.

## O que mudou e por quê

### 1. Segundo fator de consulta e cancelamento

`validarFatorExtra` existia em `functions/index.js` mas **nunca era chamada** — aparecia só na própria definição. E `criarAgendamentoCidadao` não gravava `protocolo`. Somados, CPF + data de nascimento bastavam para consultar **e cancelar** o agendamento de qualquer pessoa.

Agora: a criação gera e grava protocolo; `validarFatorExtra` é chamada na consulta e no cancelamento; o site coleta um campo único "telefone ou protocolo" e manda o mesmo valor nas duas posições. A guarda `if (!dados.protocolo) return` mantém agendamentos antigos funcionando só com CPF e nascimento.

**Verifique:** a retrocompatibilidade realmente não tranca ninguém? O campo único pode casar pelo critério errado? O caminho idempotente de `criarAgendamentoCidadao` devolve o protocolo? A mensagem de erro continua indistinguível de "não encontrado" (anti-enumeração)? Telefone/protocolo estático é segundo fator suficiente, ou deveria ser OTP?

### 2. Aviso da abertura

A automação das 07:50 reescrevia `avisoNovasVagasProgramado` apontando para a próxima semana, com `publicarEm` às 08:00 de hoje. Enquanto esse instante era futuro, `avisoNovasVagasAtivo` caía no campo de topo `dataNovasVagas` — que ninguém atualizava e guardava a abertura da semana **anterior**. O alvo do contador nascia no passado, `iniciarContadorRegressivo` caía no ramo `alvo <= new Date()`, não desenhava contador e ainda disparava `tentarAtualizarAbertura()` dez minutos cedo.

Nova função pura `aberturaVigenteDaSemana` em `functions/agenda-automation.js`, gravada na mesma transação.

**Verifique:** semana pausada, período de férias e automação desligada estão certos? A gravação está de fato dentro da transação? Havia solução melhor — separar `aberturaAtualEm` de `proximaAberturaEm`, por exemplo?

### 3. Fim das datas embutidas

`processarAgenda` caía numa constante `DIAS_INICIAIS` com datas de junho/julho quando `dias` estava vazio — o que acontece **todo fim de semana**. Só era inofensivo porque todas já tinham passado.

**Verifique:** algum consumidor dependia daquele fallback?

### 4. App Check na retomada da aba

Na abertura de hoje, **48 recusas de App Check**: 47 em `verificarDisponibilidadeSlotCidadao` entre 08:00 e 08:05, mais uma em `consultarAgendamentoCidadao` as 08:07. As 47 vieram de apenas **dois aparelhos** (25 e 22 tentativas), nao de 47 cidadaos. Backend respondia `app-check/invalid-argument` ("Decoding App Check token failed") — token malformado, não expirado: quando a atestação falha, o SDK web anexa um placeholder de erro no lugar do JWT.

Duas causas: `erroTransiente` não classifica `unauthenticated`/`permission-denied` como transiente, então nenhum laço de retentativa existente se recuperava disso; e o navegador suspende timers de aba oculta, então o auto-refresh do token não roda enquanto a pessoa espera com o celular bloqueado.

Correção: `chamarFuncao` repete **uma vez** após forçar token novo — seguro até nas callables que gravam, porque recusa de App Check significa que a função não executou. E a volta da aba renova o token se a ausência passou de 30 s.

**Verifique com atenção especial:** a premissa "recusa de App Check ⇒ a função não executou" está certa? Há caso em que o backend rejeita **depois** de efeito colateral? A repetição pode duplicar agendamento? 30 s é razoável? A hipótese da aba suspensa explica mesmo os dados, ou há explicação melhor (TTL do token, rate limit do reCAPTCHA, App Check debug token, relógio do aparelho)?

### 5. Migração para `southamerica-east1`

O Firestore fica em `southamerica-east1` e as Functions nasceram em `us-central1`. Três funções do caminho crítico foram movidas: `criarAgendamentoCidadao`, `verificarDisponibilidadeSlotCidadao`, `carregarAgendaPublicaHttp`.

Não foram movidas: os dois gatilhos de RTDB (banco é instância `firebaseio.com`, presa a `us-central1`), as três agendadas (latência irrelevante; duplicar região duplicaria os jobs do Cloud Scheduler, saindo da franquia de três) e as demais callables (exigiria tocar `recepcao.html`, sem verificação).

O site mantém **dois clientes de Functions** e roteia por nome em `clienteFunctions`.

Medição citada, com cache furado de propósito e `time_connect` de ~12 ms nos dois casos:

| | Latência |
|---|---|
| Antes — `us-central1`, instância **quente** (`min=1`) | 0,96 / 0,90 / 0,92 / 0,88 / 0,87 s |
| Depois — `southamerica-east1`, sem pré-aquecimento (só a 1ª amostra é candidata a fria) | 0,79 / 0,53 / 0,44 / 0,46 / 0,46 / 0,48 s |

**Verifique:** a medição sustenta a conclusão, ou há variável confundida (horário, aquecimento residual, rota de rede, tamanho da resposta)? A divisão de regiões deixa algum caminho quebrado? O roteamento por nome no cliente é frágil? Faltou alguma callable na lista? Qual o efeito de as funções ficarem longe do reCAPTCHA/App Check e do CDN? Alguma implicação de LGPD ou custo em ter dados trafegando entre regiões?

### 6. Scripts de pré-aquecimento

Faziam `firebase deploy` só para mudar `minInstances` — e hoje esse deploy abortou por falta de `functions/node_modules`. Agora usam `gcloud run services update --min`, que aplica sem build e sem criar revisão nova, apontam para a região nova e conferem o resultado lendo `minScale` de volta.

Um bug apareceu ao executar: `2>&1` num executável nativo, no PowerShell 5.1, transforma cada linha de stderr em `ErrorRecord` e, com `$ErrorActionPreference = "Stop"`, vira exceção — o `gcloud` escreve `Updating...` em stderr como progresso.

**Verifique:** os scripts são robustos a falha parcial (um serviço atualiza, outro não)? A conferência pode dar falso positivo? `Invoke-Gcloud` trata bem o código de saída? Falta alguma proteção contra rodar no projeto errado?

## Decisões que quero especificamente contestadas

1. **Migrar só três funções** em vez de todas, deixando o sistema com callables em duas regiões.
2. **Repetir a callable** após recusa de App Check, inclusive `criarAgendamentoCidadao`.
3. **Manter telefone/protocolo estático** como segundo fator em vez de OTP.
4. **Não criar projeto de homologação** — a migração foi validada direto em produção, com janelas de 1 a 2 minutos por função.
5. **Deixar o campo "telefone ou protocolo" sem marcar como opcional**, sabendo que 40 pessoas com agendamento sem protocolo o veriam esta semana.
6. **Confiar em travas que leem texto do código-fonte** (regex sobre `index.js` e sobre os HTMLs) em vez de testes de comportamento.

## O que eu quero de volta

Para cada achado: **onde** (arquivo e linha), **o que quebra**, **em que cenário concreto**, e **quanto importa** — separando "quebra na abertura de 07/09" de "dívida técnica".

Ordene por severidade. Diga explicitamente se algum achado é **bloqueante para 07/09**.

Se você concluir que alguma coisa está certa, diga em uma linha e siga — não gaste espaço concordando.

## Regras

- Não proponha reescrita geral. O sistema atende cidadãos reais toda semana.
- Considere que não há ambiente de homologação: qualquer correção sua será validada em produção.
- Se precisar de um dado que não está aqui (log, configuração do Firestore, resposta de API), diga qual e por quê, em vez de supor.
- 189 testes passam hoje. Se um teste está passando mas não prova o que diz provar, isso é um achado.
