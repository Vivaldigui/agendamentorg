# Contexto para continuar o AgendamentoRG em outro computador

Última atualização: 27/08/2026.

## Como retomar

```powershell
git clone https://github.com/Vivaldigui/agendamentorg.git
cd agendamentorg
git switch reorganizacao-painel-recepcao
npm install
npm --prefix functions install
npm --prefix functions test
```

Devem passar **246 testes**. Se passar menos, o clone não está na branch certa.

Depois, abra a pasta no assistente e envie:

> Leia `CONTEXTO-CODEX.md`. Confira o Git e os testes. O painel da recepção foi
> reorganizado, separado em três arquivos e ficou sem código embutido; falta
> validar as três funções callable e decidir o deploy. Não faça deploy, commit
> ou push sem autorização expressa.

## Estado do Git

- Repositório: `https://github.com/Vivaldigui/agendamentorg.git`
- Branch de trabalho: `reorganizacao-painel-recepcao`, publicada no remoto
- Último commit: `1320527` — `Corrige a lista vazia: filtro rapido lia o proprio onclick`
- Seis commits à frente de `main`; `main` continua sendo o que está em produção

Os seis, do mais antigo para o mais novo:

```
1428ecb  Painel da recepcao dividido em operacao, configuracao e relatorios
c6feb70  Painel separado em tres arquivos e sem codigo embutido no HTML
22c2803  CSP proprio para o painel, sem 'unsafe-inline' no script-src
cb339b3  Registra o comportamento real de precedencia de headers do Hosting
419621e  Libera no connect-src do painel a chamada que o reCAPTCHA faz de verdade
1320527  Corrige a lista vazia: filtro rapido lia o proprio onclick
```

Cada mensagem de commit traz o raciocínio completo da mudança. Leia-as antes de
mexer: elas registram o que foi medido e o que foi decidido, não só o que mudou.

## Contexto operacional

O sistema agenda atendimentos de CIN da Câmara de Itanhandu usando Firebase
Hosting, Cloud Functions v2, Firestore e Realtime Database. O painel da recepção
é operado por uma ou duas pessoas no balcão, durante o atendimento. Falha
silenciosa custa fila.

## O que mudou nesta branch

### Reorganização da interface

A aba "Lista e gestão" acumulava dez blocos numa rolagem só. Agora são cinco
áreas: **Fila de hoje**, **Agendamentos** e **Credenciais** (operação diária),
mais **Configuração** e **Relatórios** (uso eventual). A Configuração é um hub de
ícones que abre cinco painéis: datas, pop-up, automação, horários, preferências.

Acrescentados: barra institucional com o operador logado; faixa de estado no topo
mostrando o que está publicado no site agora (automação, pop-up, vagas), lida dos
controles já carregados, sem consulta nova ao Firestore; cabeçalho da fila com
data por extenso e barra de progresso. Os três cartões de acesso em tempo real
passam a ficar ocultos enquanto `METRICAS_ACESSO_PUBLICO_ATIVAS` for `false`.

### Três arquivos

`public/recepcao.html` tinha 5.474 linhas. Virou:

| arquivo | linhas |
| --- | --- |
| `public/recepcao.html` | 625 |
| `public/recepcao.css` | 1.430 |
| `public/recepcao.js` | 3.547 |

Nenhuma linha de estilo ou script foi reescrita nesse passo. Os `<style>` e
`<script>` que aparecem dentro do JS pertencem às janelas de comprovante,
declaração e lista do dia — são template literals.

Seis testes liam `public/recepcao.html` para verificar JS que morava lá dentro.
`functions/painel-fonte.js` remonta a superfície (markup + estilo + script,
markup primeiro) e as asserções continuam valendo sem reescrita.

### Delegação de eventos

133 manipuladores embutidos removidos: 114 `onclick`, 8 `oninput`, 11 `onchange`.
Cada gatilho declara `data-acao` (ou `data-input` / `data-change`) e os argumentos
em `data-*`; um ouvinte por tipo de evento resolve a chave contra `ACOES_CLIQUE`
ou `ACOES_CAMPO`, no fim de `public/recepcao.js`. As funções de negócio mantiveram
as assinaturas: quem converte `dataset` em argumento é o registro.

Dois pontos exigiram mais que troca de atributo:

- Os menus dependiam de `event.stopPropagation()` no próprio `onclick` para não
  serem fechados pelo ouvinte de documento que existia para fechá-los. Com um
  ouvinte único isso não funciona. Fechar e abrir passaram a viver na mesma
  função, em ordem explícita.
- As janelas de impressão são documentos de mesma origem escritos por
  `document.write` e herdam o CSP do painel, então não podiam manter `<script>`
  nem `onclick`. `prepararJanelaImpressao` liga os botões pelo opener.

### CSP próprio para o painel

`/recepcao.html` ganhou política própria em `firebase.json`, sem `'unsafe-inline'`
em `script-src`. O cabeçalho global vale para `**` e **não pode** ser apertado
junto: `public/index.html` ainda tem 3 scripts embutidos e 34 handlers inline.

Precedência **medida** em canal de pré-visualização: quando duas entradas casam, o
Hosting acumula as chaves diferentes e resolve a chave repetida pela **última**.
A entrada do painel é a última da lista — mover para cima devolve a política
permissiva a ele, em silêncio. Há trava para isso.

`style-src` continua com `'unsafe-inline'`: o markup usa `style="..."` em vários
pontos e as janelas de impressão levam `<style>` próprio.

## O defeito que escapou, e a lição

Depois da delegação, o painel montava mas **todas as listas ficavam vazias, sem
mensagem**. `marcarFiltroRapidoVisual` descobria a qual filtro cada botão
pertencia lendo o texto do próprio `onclick`. Sem `onclick`, `getAttribute`
devolve `null`; a exceção subia por `listarAgendamentos` antes de a tabela
renderizar.

Passou pelos testes porque eles conferiam markup contra registro, e a verificação
no navegador substituiu `filtroRapidoPainel` por um espião em vez de executá-la no
fluxo de quem faz login. **Conferir markup não substitui rodar o fluxo.**

Há trava para a classe do defeito — nenhum código pode voltar a ler atributo de
manipulador embutido — e os cinco seletores literais do script foram conferidos.
Mas assuma que pode haver irmãos em caminhos que ninguém percorreu.

## Validação já feita

- 246 testes (`npm --prefix functions test`).
- Publicado em canal de pré-visualização, com login real: listas carregam,
  navegação entre as cinco áreas, claro e escuro, sem rolagem lateral em 375x812.
- Canal ativo até **02/09/2026**:
  `https://agendamento-cin-itanhandu--revisao-painel-hmupkekk.web.app/recepcao.html`

## O que falta

### 1. As três funções callable, não exercitadas

`callableOptions.cors` em `functions/index.js` é uma lista explícita de quatro
origens, e o domínio do canal não está nela. Então no canal falham:

- `criarEncaixeManual` — Inserir Encaixe Manual
- `atualizarObservacaoAdmin` — Observação interna
- `listarLogsAdmin` — Histórico de ações

Nessas três o modal abre, as máscaras funcionam e a validação roda; só a chamada
final falha, e isso é esperado no canal. Todo o resto do painel vai direto ao
Firestore e funciona lá.

Para exercitá-las seria preciso acrescentar a origem do canal a `callableOptions`
e fazer deploy das functions — mudança em produção, decisão do responsável.

### 2. Deploy em produção

Não feito. Substitui o painel que a recepção usa. Vale escolher horário sem
atendimento. Requer autorização expressa.

### 3. Aberto, sem relação com esta branch

- O reCAPTCHA do App Check tenta `https://www.google.com/recaptcha/api2/clr` e o
  CSP **global** bloqueia — a produção de hoje registra o mesmo. Corrigido apenas
  na política do painel. Mexer no global atinge o site público.
- No Firefox aparece `default-src 'self'` bloqueando `recaptcha/api.js`, embora
  `www.google.com` esteja em `script-src`. Não reproduzido em navegador baseado em
  Chromium. Comparar com a produção no mesmo Firefox decide se é pré-existente.
- App Check devolve 403 ao pedir token em navegador automatizado, nos dois
  domínios. Com login real as listas carregam, então não é bloqueante.

## Regras obrigatórias para a continuação

- Não executar `firebase deploy` sem autorização expressa.
- Não fazer commit nem push sem autorização expressa.
- Preservar alterações existentes e revisar o Git antes de editar.
- Rodar `npm --prefix functions test` após cada alteração.
- Preservar a regra "data já publicada nunca é removida automaticamente".
- Preservar o retry transiente de `criarAgendamentoCidadao` e os dados digitados
  pelo cidadão quando uma vaga é perdida.
- Preservar a chave de cache compartilhada por minuto na virada das 08:00.
- Ao mexer no painel: nenhum `onclick`/`oninput`/`onchange` embutido volta, e todo
  `data-acao` novo precisa de entrada no registro. As travas cobrem os dois lados.
- Se uma correção se mostrar mais arriscada que o descrito, parar e comunicar
  antes de improvisar.

## Arquivos de referência

- `public/recepcao.js`: comportamento do painel; registros de ação no fim.
- `functions/painel-delegacao.test.js`: travas da delegação.
- `functions/csp-painel.test.js`: travas do CSP e do cache dos arquivos novos.
- `functions/painel-fonte.js`: remonta a superfície do painel para os testes.
- `README.md`: operação, automação semanal, monitoramento, custo e testes.
- `functions/agenda-grade.js`: regra canônica da grade por data.
- `functions/agenda-automation.js`: automação semanal.
- `docs/HANDOFF.md`: handoff técnico da fase anterior.
- `tests/load/README.md`: execução dos testes de carga.

---

# Fase anterior — abertura de 17/08/2026

Conteúdo registrado em 13/08/2026. As datas citadas já passaram; **confirmar na
produção antes de agir sobre qualquer item desta seção.**

## Trabalho concluído naquela fase

### P0.1 — grade por data

- Corte em `2026-08-18`.
- Datas anteriores usam a grade legada de 8 horários.
- Datas a partir do corte usam a grade nova de 10 horários.
- Configuração manual explícita em `horariosPorDiaSemana` continua prevalecendo,
  inclusive lista vazia.
- Regra canônica extraída para `functions/agenda-grade.js` e espelhada no site
  público e no painel.
- Removidas a migração implícita da grade legada e a união cega das duas grades.

### P0.2 — telemetria pública

- `METRICAS_ACESSO_PUBLICO_ATIVAS = false` no site público.
- Nenhuma presença pública é escrita no RTDB enquanto a flag estiver desligada.
- O painel não inicia o monitoramento. Nesta branch, os três cartões passaram a
  ficar ocultos em vez de repetir "Medição desativada".
- Gatilhos e regras preservados para uma futura telemetria idempotente em shards.
- Testes em `functions/telemetria-publica.test.js`.

## Pendência de dados — reverificar

Leitura direta da produção em 13/08/2026: `horariosPorDiaSemana` tinha **sete**
chaves (0 a 6), todas com a grade legada de 8 horários; `dias` não continha
`2026-08-21`; `automacaoSemanal` estava ausente, valendo os padrões.

A ação proposta era remover o campo inteiro, com backup e validação — não
substituir pela grade nova, já que o campo é indexado por dia da semana e
aplicaria horários novos também a datas anteriores ao corte.

Scripts: `scripts/ler-grade-agenda.js` e `scripts/migrar-grade-por-dia.js`. Não
executar `--aplicar` sem autorização expressa e autenticação no projeto correto.

## Armadilha do painel

Removido `horariosPorDiaSemana`, o editor semanal pode exibir o fallback novo. Se
a recepção salvar, recria as chaves por dia da semana e desfaz a correção. O aviso
que explica que a alteração vale para **todas as datas daquele dia da semana**,
inclusive anteriores a 18/08, foi preservado na reorganização e hoje vive no
painel **Configuração → Horários da semana**. A separação visual entre as grades
"até 17/08" e "a partir de 18/08" continua não implementada.

## Teste de carga e custos

- O ensaio local em `tests/load/results/2026-08-13-local.md` registrou zero
  falhas, p95 próximo de 4 segundos e máximo próximo de 15 segundos.
- Esse ensaio não certifica produção: o emulador não reproduz CDN nem escala
  horizontal das Functions.
- A leitura pública deve permanecer em escala zero por padrão para controlar
  custos; o CDN absorve a maior parte do pico.
- Pré-aquecimento custa enquanto houver instâncias mínimas.
