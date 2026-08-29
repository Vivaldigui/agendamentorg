# Prompt — auditoria antes da abertura de 31/08/2026

Cole o conteúdo abaixo como mensagem para o auditor.

---

Faça uma **auditoria independente** do projeto AgendamentoRG. Isto é urgente e tem data: **a abertura é segunda-feira, 31/08/2026, às 08:00** (`America/Sao_Paulo`). Hoje é sábado, 29/08. Você tem cerca de dois dias, e o que passar entra numa abertura com gente real disputando vaga.

## Por que a desconfiança é o ponto de partida

Este código passou por **três auditorias independentes em 24/08**, que juntas encontraram **vinte e um defeitos** — dois deles graves, e vários introduzidos *durante correções de outros defeitos*. A rodada 2 mostrou que uma trava de teste deste repositório era **comprovadamente vazia** e que outro teste **consagrava a própria vulnerabilidade** como se fosse a intenção. Ambos verdes.

Depois disso, entrou trabalho grande que **nunca foi auditado**: o painel da recepção foi partido em três arquivos, ganhou CSP próprio, um pop-up configurável e correções de uma auditoria interna.

Trate tudo como hipótese. **Discordância fundamentada é o produto.** Concordar não ajuda.

## Escopo

Repositório: `https://github.com/Vivaldigui/agendamentorg`, branch **`reorganizacao-painel-recepcao`** (é ela que está em produção, não a `main`).

Audite `git diff 4468911..f2ca4d7` — dez commits, 20 arquivos, +6742/−4370:

```
0b87268  Pop-up de aviso configuravel pela recepcao
1428ecb  Painel da recepcao dividido em operacao, configuracao e relatorios
c6feb70  Painel separado em tres arquivos e sem codigo embutido no HTML
22c2803  CSP proprio para o painel, sem 'unsafe-inline' no script-src
cb339b3  Registra o comportamento real de precedencia de headers do Hosting
419621e  Libera no connect-src do painel a chamada que o reCAPTCHA faz de verdade
1320527  Corrige a lista vazia: filtro rapido lia o proprio onclick
d2e2642  Atualiza o contexto de retomada
696be17  Corrige falhas da auditoria do painel da recepcao
f2ca4d7  Libera no CSP publico o fetch que o reCAPTCHA faz de verdade
```

259 testes passam.

## O sistema

Agendamento de RG/CIN da Câmara Municipal de Itanhandu. Firebase Hosting, Cloud Functions v2, Firestore (`southamerica-east1`), RTDB (`us-central1`).

Três funções do caminho crítico rodam em `southamerica-east1`: `criarAgendamentoCidadao`, `verificarDisponibilidadeSlotCidadao`, `carregarAgendaPublicaHttp`. As outras 14 em `us-central1`. O site mantém dois clientes de Functions e roteia por nome.

**Segunda 31/08 às 08:00 abrem 30 vagas** — 01, 02 e 03/09, dez horários cada. Sexta 04/09 está em `datasBloqueadas`, por isso três dias e não quatro. Centenas de pessoas, a maioria fica sem vaga: 30 é o teto real.

O que mais importa, em ordem: ninguém receber falso "sem vagas"; ninguém perder dados preenchidos; ninguém ficar preso em tela desatualizada; nenhuma vaga vendida duas vezes; nenhum dado pessoal vazar.

## Estado que você deve conferir, não assumir

Lido em produção em 29/08:

```
automacaoSemanal: ativa, 08:00, dias [2,3,4,5]
                  semanasPausadas: ["2026-09-07"]
                  datasBloqueadas: ["2026-08-28", "2026-09-04"]
dias: []          publicacaoDatas: {}
dataNovasVagas: "31/08/2026"    avisoNovasVagasProgramado: null
```

**Pergunta central: esta configuração produz o que se espera às 08:00 de 31/08?** Confira o plano da semana, o horário de publicação, o aviso que passa a valer depois da virada, e o cache na virada.

## O que mudou e onde olhar

### 1. Painel partido em três arquivos

`recepcao.html` perdeu ~4.500 linhas; nasceram `recepcao.js` (3.700 linhas) e `recepcao.css`. O HTML não tem mais script nem handler embutido, e a delegação de eventos passou a ser explícita.

**Verifique:** algum `onclick` do HTML antigo ficou sem par na delegação nova? Botões que existiam e deixaram de funcionar? A recepção usa isto **na manhã da abertura** para encaixes, remarcação e check-in — um botão morto ali é problema real. Ordem de carregamento: `recepcao.js` depende de algo que ainda não existe quando roda?

### 2. CSP próprio do painel, sem `'unsafe-inline'`

O painel ganhou política própria em `firebase.json`, com `script-src` sem `'unsafe-inline'`. A global continua permitindo, porque o site público ainda tem código embutido.

**Verifique:** a política do painel cobre tudo que ele de fato carrega e chama? Há precedência entre o bloco `**` e o `/recepcao.html` — qual vence, e o resultado é o pretendido? O commit `cb339b3` afirma ter registrado o comportamento real de precedência do Hosting: essa afirmação está certa?

### 3. Pop-up de aviso configurável

Novo módulo `functions/aviso-popup.js` e ~139 linhas no site público, com funções de normalização, validade por instante e marcação de dispensa.

**Verifique com atenção — isto roda no site público às 08:00:** se a configuração do pop-up estiver malformada, o que acontece? Uma exceção no carregamento derruba o restante da página? Ele pode aparecer por cima do calendário no minuto da abertura e atrapalhar o clique? A dispensa usa armazenamento local — e se estiver indisponível?

### 4. Liberação do reCAPTCHA no CSP

O reCAPTCHA do App Check faz um fetch do documento pai para `https://www.google.com/recaptcha/api2/clr`. Nenhuma das políticas permitia. O painel liberou em `419621e`; o site público só agora, em `f2ca4d7`.

Verificado no navegador contra produção, antes e depois: antes, oito erros de CSP por carregamento; depois, **zero**, com App Check emitindo JWT válido e chamada à região nova respondendo `failed-precondition` em 324 ms.

**Verifique:** liberar `www.google.com` em `connect-src` amplia superfície de forma relevante, considerando que o domínio já estava em `script-src` e `frame-src`? A hipótese de que o bloqueio degradava a atestação do App Check se sustenta, ou é especulação? (Na abertura de 24/08 houve 47 recusas de App Check vindas de **dois aparelhos**, e a causa nunca foi demonstrada.)

### 5. Origem temporária no CORS

`696be17` adicionou `https://agendamento-cin-itanhandu--revisao-painel-hmupkekk.web.app` à lista de origens das callables, com comentário dizendo para remover após 02/09.

**Verifique:** um canal de preview na allowlist de CORS de callables de produção é aceitável? O que ele permite que antes não permitia? Há risco de ficar esquecido?

## Um fato operacional que você precisa saber

**O commit `696be17` está no git mas NÃO está implantado.** Confirmei que `recepcao.js` em produção difere do HEAD. Ou seja, as correções da auditoria interna do painel existem no repositório e não no ar, e a origem temporária de CORS também não foi implantada.

**Diga se isso deve ser implantado antes de segunda ou não.** É uma decisão de risco: são correções de defeitos reais, mas entram a dois dias de uma abertura, sem ambiente de homologação.

## Sobre os testes — leia antes de olhar qualquer um

259 passam. Isso não significa quase nada aqui, e há prova disso: na rodada 2, um auditor injetou **oito defeitos simultâneos** e a suíte continuou inteiramente verde.

A maioria das travas lê texto do código-fonte com regex ou `indexOf`. **Trate cada uma como suspeita.** Para cada teste novo, pergunte:

1. Prova comportamento, ou só presença de string?
2. Um refactor legítimo o quebraria sem quebrar o sistema?
3. Um defeito real passaria por ele?
4. O nome promete mais do que a asserção entrega?

Reverter a correção e ver o teste reprovar prova **reação a uma mutação específica**, não cobertura da propriedade anunciada. Foi exatamente assim que a trava vazia passou despercebida.

## O que eu quero de volta

Para cada achado: **onde** (arquivo e linha), **o que quebra**, **em que cenário concreto**, **quanto importa**.

Separe explicitamente:

- **Bloqueante para 31/08** — impede ou degrada a abertura
- **Bloqueante para a recepção na manhã de 31/08** — o painel é usado ao vivo
- **Dívida** — corrigir depois

E responda diretamente: **implantar `696be17` antes de segunda, ou não?**

Se algo estiver certo, uma linha basta.

## Regras

- Não proponha reescrita geral. O sistema atende cidadãos reais toda semana.
- Não há ambiente de homologação. Qualquer correção sua será validada em produção, a dois dias da abertura.
- Se precisar de um dado que não está aqui (log, documento do Firestore, cabeçalho), diga qual e por quê, em vez de supor.
- Três auditorias anteriores acharam vinte e um defeitos neste mesmo trabalho. Assuma que ainda há.
