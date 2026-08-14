# Auditoria independente — AgendamentoRG

**Data da auditoria:** 14/08/2026  
**Código auditado:** `d8d4a8c` (o código de aplicação é o mesmo de produção, `46a2b73`; a diferença é apenas a inclusão de `docs/PROMPT-auditoria-independente.md`)  
**Evento prioritário:** abertura de 40 vagas em 17/08/2026 às 08:00, `America/Sao_Paulo`  
**Método:** revisão estática independente, rastreamento de caminhos alcançáveis, testes existentes, simulações locais sem escrita, inspeção em navegador móvel, auditoria de dependências e leitura **somente** da configuração de agenda em produção.

## Conclusão executiva

**Há defeitos que justificam alterar o sistema antes de segunda-feira.** Eu não consideraria a abertura adequadamente protegida sem, no mínimo:

1. separar a leitura geral cacheada de uma verificação realmente fresca usada ao selecionar uma vaga e após conflito;
2. tratar falha da primeira leitura como erro técnico com retentativa imediata, nunca como “Agenda fechada”;
3. tornar a criação idempotente, para reconciliar uma resposta perdida depois de a transação já ter sido confirmada;
4. impedir substituição de agendamento com apenas CPF e um booleano enviado pelo cliente;
5. vincular tokens de cancelamento à versão e ao proprietário atual do slot/índice;
6. suspender remarcação, cancelamento e liberação de bloqueio pelo painel atual até essas ações passarem por transações no backend; a remarcação normal também não pode gravar o registro corrente como `remarcado`/inativo.

Os três primeiros pontos atingem diretamente usuários legítimos sob a concorrência prevista. Os três últimos permitem tomada de agendamento, corrupção das três coleções e, em sequências concretas, dupla venda de uma vaga.

## Estado de produção verificado

Foi lido somente `configuracoes/agenda`, sem acessar documentos de cidadãos. A saída da verificação foi:

```text
dias_18_a_21=["2026-08-18","2026-08-19","2026-08-20","2026-08-21"]
horariosPorDiaSemana_chaves=[]
2026-08-18 ... total=10 publicacao="2026-08-17T08:00"
2026-08-19 ... total=10 publicacao="2026-08-17T08:00"
2026-08-20 ... total=10 publicacao="2026-08-17T08:00"
2026-08-21 ... total=10 publicacao="2026-08-17T08:00"
total_slots=40
automacao={"ativa":true,"horaAbertura":"08:00","diasSemana":[2,3,4,5],"semanasPausadas":[],"datasBloqueadas":[],"periodosBloqueados":[]}
```

Portanto, **a configuração atual resolve corretamente para 40 vagas**, e não há override explícito de `horariosPorDiaSemana` anulando o corte. O script diagnóstico existente confirmou ainda `dias cadastrados: 5` e `automacaoSemanal.ativa: true`.

## Achados — bloqueantes para segunda

### B1. A verificação “fresca” pode reutilizar a mesma resposta obsoleta do CDN

**O que é.** Na segunda de manhã, a API autoriza `s-maxage=60` e mais `stale-while-revalidate=120` (`functions/index.js:721-736`). O cache-buster é compartilhado por todos durante um minuto (`public/index.html:645-654`). A mesma URL é usada para validar a vaga ao selecioná-la (`public/index.html:1406-1418`) e para recuperar o estado depois de erro (`public/index.html:1514-1526`, `1566-1577`, `1667-1679`). Uma reserva não invalida a resposta do CDN.

**Por que importa.** O backend transacional impede que duas criações públicas limpas ganhem o mesmo documento de slot, mas o navegador pode continuar oferecendo uma vaga já preenchida. Após receber conflito, a recuperação pode obter o mesmo objeto cacheado e reapresentar a mesma vaga; o usuário fica preso numa tela desatualizada enquanto as outras 39 vagas desaparecem.

**Alcançabilidade e verificação.** Esse é o fluxo normal de seleção e conflito. O ensaio de homologação confirma que quase todas as 248.317 leituras foram servidas na borda (`tests/load/results/2026-08-14-homologacao.md:18-29`) e declara que o primeiro *miss* da chave por minuto não foi medido (`tests/load/results/2026-08-14-homologacao.md:37-38`). Para reproduzir sem produção: coloque um proxy que respeite o `Cache-Control`, leia a chave do minuto, ocupe o slot por outro cliente e repita seleção/recuperação antes da troca de chave.

**Risco em 17/08.** Alto e concentrado exatamente no pico. A propriedade “um vencedor por slot” continua correta, mas a propriedade “usuário não fica preso em estado obsoleto” não foi certificada.

**Correção recomendada.** Manter uma leitura geral compartilhada para proteger a origem, mas usar uma rota/callable de verificação de um único slot sem cache compartilhado na seleção e após conflito. A recuperação deve retirar localmente a vaga que o backend declarou ocupada, mesmo se a leitura geral ainda estiver antiga.

### B2. Falha da primeira leitura vira falso “Agenda fechada” por até três minutos

**O que é.** O estado inicial tem zero vagas e `DATA_NOVAS_VAGAS = "data a definir"` (`public/index.html:473-478`). Se a primeira chamada falha e não existe cache local, `carregarConfig` conserva esse zero e não propaga o erro (`public/index.html:669-724`). O `init` renderiza o estado como se fosse válido (`public/index.html:2087-2095`), e o banner diz “Agenda fechada” (`public/index.html:1284-1335`). Como “data a definir” não produz alvo válido, as retomadas de abertura por `online`/visibilidade também retornam sem tentar (`public/index.html:2030-2066`). Resta apenas o *polling* de três minutos (`public/index.html:437`, `1480-1483`).

**Por que importa.** Uma indisponibilidade transitória da API no primeiro acesso é indistinguível de agenda realmente fechada. Isso viola diretamente a prioridade “ninguém receber falso sem vagas”.

**Alcançabilidade e verificação.** Reproduzido em navegador local, viewport 360×800, sem cache e com `/api/agenda-publica` indisponível: a tela exibiu “Agenda fechada” e “data a definir”. A simulação isolada de `carregarConfig` terminou sem lançar erro e deixou `DIAS_DISPONIVEIS=[]` e total `0`. O teste atual cobre apenas a preservação de uma agenda **já válida** (`functions/atualizacao-abertura.test.js:143-174`), não a primeira carga vazia.

**Risco em 17/08.** Um usuário que chegue às 08:00 durante uma falha curta pode esperar até 180 segundos, tempo suficiente para as 40 vagas acabarem.

**Correção recomendada.** Introduzir estado explícito `desconhecido/erro`, iniciar imediatamente a janela de retentativas mesmo sem data conhecida e nunca renderizar “fechada/lotada” a partir de falha técnica.

### B3. Resposta perdida após *commit* produz falso fracasso; falta idempotência

**O que é.** O cliente retenta até três vezes, mas não envia identificador estável da operação (`public/index.html:1529-1590`). Cada invocação cria um novo ID aleatório (`functions/index.js:855-860`) e não há registro `operationId -> resultado` na transação (`functions/index.js:865-973`).

**Sequência reproduzível.** Em emulador/homologação, deixe a transação confirmar e derrube somente a resposta. A nova leitura verá o slot — ocupado pelo próprio solicitante — como indisponível; o cliente informa que outra pessoa concluiu primeiro (`public/index.html:1571-1577`, `1681-1685`).

**Risco em 17/08.** O cidadão pode sair sem confirmação embora tenha consumido uma vaga, gerar falta operacional ou tentar outro horário/substituição. É exatamente o caso de rede ruim que a retentativa deveria resolver.

**Correção recomendada.** Gerar um `operationId` aleatório antes do primeiro envio, reutilizá-lo em todas as tentativas e gravar atomicamente o resultado. Repetição idêntica deve devolver o sucesso original; reutilização com payload diferente deve falhar.

### B4. Qualquer pessoa que saiba um CPF pode substituir o agendamento da vítima

**O que é.** `criarAgendamentoCidadao` aceita `substituirAnterior` diretamente do cliente (`functions/index.js:834-853`). O agendamento anterior é encontrado só pelos documentos de índice do CPF e seus data/hora são devolvidos (`functions/index.js:895-931`). Se o booleano for `true`, a função libera a vaga da vítima, marca seu registro inativo e cria novo registro com nome, nascimento, telefone e e-mail fornecidos pelo atacante (`functions/index.js:934-972`). A data de nascimento nova é apenas validada sintaticamente (`functions/index.js:843-849`); não é comparada com a vítima.

**Alcançabilidade.** É uma callable pública com App Check. A própria interface alcança o ramo após a resposta de CPF duplicado (`public/index.html:1627-1643`); um chamador direto não precisa do modal.

**Como verificar sem dano.** Em emulador ou projeto isolado: crie A; invoque criação B com o CPF de A, dados pessoais diferentes e `substituirAnterior:true`; confirme que A fica `remarcado/ativo:false`, o slot de A é liberado e o índice aponta para B.

**Risco em 17/08.** Cancelamento/tomada de agendamento e vazamento de data/hora. Isso é mais grave que o problema conhecido de CPF + nascimento: para substituir, **basta o CPF**.

**Correção recomendada.** Trocar o booleano por token curto emitido após autenticação real do agendamento, vinculado ao ID e à versão corrente. Não revelar data/hora do registro anterior a um chamador autenticado apenas por CPF.

### B5. Token de cancelamento antigo pode apagar a vaga de outra pessoa e permitir dupla venda

**O que é.** A preparação grava por 30 minutos uma fotografia com `agendamentoId`, `cpfDocIds` e `slotId`, sem versão (`functions/index.js:986-1000`). Na execução, o servidor não exige que o registro continue ativo nem lê slot/índices para verificar seus atuais `agendamentoId`; simplesmente apaga os IDs fotografados (`functions/index.js:1018-1059`). Substituição/remarcação não invalida tokens pendentes (`functions/index.js:934-960`, `1214-1308`).

**Sequência reproduzível.** Prepare tokens T1 e T2 para A; use T1 para cancelar; deixe B reservar o slot liberado; use T2. T2 apaga o documento de slot que agora pertence a B. Em seguida C consegue reservar o mesmo horário, embora B continue com agendamento. Outra sequência — preparar token, substituir A por B e resgatar o token antigo — remove o índice corrente de B.

**Risco em 17/08.** Dupla venda real, registro órfão e CPF com múltiplos agendamentos. O token aleatório, o TTL e o consumo transacional impedem adivinhação/reuso do mesmo token, mas não impedem dois tokens irmãos válidos.

**Correção recomendada.** Versionar o agendamento; invalidar tokens em toda transição; e, dentro da transação de cancelamento, ler e apagar slot/índice somente se ainda apontarem para o `agendamentoId` e versão do token.

### B6. O painel ignora o backend transacional e quebra invariantes; a remarcação sempre inativa o registro corrente

**O que é.** As regras permitem ao admin escrever diretamente em todas as coleções do invariante (`firestore.rules:19-37`). O botão normal chama `salvarRemarcacao` (`public/recepcao.html:1544`), que faz leitura do novo slot, exclusão do antigo, criação do novo, atualização do agendamento e do índice em requisições separadas (`public/recepcao.html:3932-3987`). Existe uma callable transacional pronta (`functions/index.js:1214-1308`), mas a tela não a usa. Cancelamento também marca o registro inativo antes de apagar slot/índices e engole erros de exclusão (`public/recepcao.html:4070-4098`). Liberação de bloqueio declara sucesso mesmo se a exclusão dedicada falhar (`public/recepcao.html:4386-4404`).

Além disso, a remarcação grava sempre `status: "remarcado"` no próprio registro atual (`public/recepcao.html:3967-3979`), enquanto o backend define `remarcado` como inativo (`functions/index.js:372-375`). O criador público passa então a tratar seu índice de CPF como obsoleto (`functions/index.js:903-918`), mas seu slot continua ocupado.

**Sequências concretas.** Dois operadores podem ler o mesmo novo slot como livre e sobrescrever um ao outro. No cancelamento, depois de o registro ficar inativo, uma criação pública pode reclamar o slot; a exclusão seguinte do painel apaga a vaga do novo cidadão. Mesmo sem concorrência, toda remarcação pelo painel torna consulta/cancelamento público inconsistentes e permite novo agendamento para o CPF.

**Risco em 17/08.** Dupla venda, vaga fantasma, perda de índice e falso bloqueio/liberação. O caminho é alcançável pela operação normal da recepção.

**Correção/mitigação.** Antes de segunda, impedir operacionalmente esses três comandos durante o pico. Em código, negar escrita direta nas coleções do invariante e criar callables transacionais de remarcação, cancelamento e liberação. O registro movido deve continuar `agendado`/ativo; histórico de remarcação deve ficar em campos de histórico, não no status terminal.

## Achados — importantes, mas podem esperar se houver mitigação operacional

### I1. “Telemetria desativada” é apenas uma condição do cliente

O flag impede o navegador fornecido de escrever (`public/index.html:434-491`), mas as regras autorizam criação e exclusão anônimas em `presenca_publica/conexoes` (`database.rules.json:5-18`). Os gatilhos continuam exportados e, a cada evento, leem o nó completo e atualizam contador compartilhado (`functions/index.js:259-278`, `1065-1105`). A limpeza diária limita cada consulta a 1.000 (`functions/index.js:1594-1607`). Um cliente RTDB direto pode gerar amplificação, custo e disputa de quota no mesmo projeto. Enquanto estiver desligada, a regra de escrita e os gatilhos também devem estar desligados.

### I2. A anonimização pode apagar o índice de um agendamento novo e ativo

O job mensal deriva o CPF de um registro terminal antigo e apaga incondicionalmente os dois documentos determinísticos de `cpfs_agendados` (`functions/index.js:532-570`). Ele não lê o índice para verificar se ainda aponta para aquele registro. Se A cancelado envelhecer seis meses e o cidadão tiver B atual, a anonimização de A apaga o índice de B; a criação pública, que depende do índice (`functions/index.js:895-959`), aceita C. O job é alcançável pelo agendamento mensal (`functions/index.js:1365-1369`). A exclusão deve ser condicional a `mapping.agendamentoId === registroAntigo.id`.

### I3. A retenção LGPD não cobre todos os depósitos de dados pessoais

`remarcado` não entra nos status anonimizáveis e há teto de 5.000 leituras (`functions/index.js:47-58`). Cada execução reinicia pela faixa mais antiga e documentos já anonimizados/ignorados consomem o teto (`functions/index.js:503-579`), podendo impedir progresso para registros posteriores. Bloqueios dedicados recebem CPF, nome e telefone (`public/recepcao.html:4003-4017`); credenciais de estacionamento gravam nome, telefone e a categoria idoso/deficiente, e copiam o nome para logs (`public/recepcao.html:4200-4227`, `4319-4327`); logs de bloqueio copiam CPF (`public/recepcao.html:4375-4383`). A limpeza diária cobre somente `rate_limits` e `cancelamentos_pendentes` (`functions/index.js:1547-1575`). `logs_admin` não podem ser apagados pelo cliente (`firestore.rules:43-45`) e não existe rotina privilegiada de retenção. É preciso política e job por finalidade/coleção, além de cursor que garanta progresso.

### I4. Os limites de consulta/cancelamento podem ser contornados variando CPF textual e `User-Agent`

O fingerprint inclui `User-Agent`, controlado pelo chamador (`functions/index.js:444-500`). Além disso, consulta e preparação de cancelamento aplicam limite com o CPF **antes** de normalizá-lo (`functions/index.js:824-826`, `986-990`), enquanto `normalizarCpf` remove todos os não dígitos (`functions/index.js:90-91`). Variações de pontuação/espaços criam buckets diferentes e resolvem para a mesma pessoa; variar `User-Agent` cria ainda mais buckets. Isso enfraquece a mitigação do problema conhecido CPF + nascimento. Normalizar antes do limite e não usar cabeçalho mutável como identidade de segurança.

### I5. Correção de “não compareceu” não remove o bloqueio; liberação pode mentir sucesso

Ao mudar para `nao_compareceu`, o painel grava campos no registro e um documento dedicado (`public/recepcao.html:4023-4055`). Ao corrigir o status para qualquer outro valor, nenhum desses campos/documentos é removido. O backend considera tanto o documento dedicado quanto os campos históricos (`functions/index.js:409-425`), então o cidadão continua bloqueado. A liberação manual engole falha ao excluir o documento dedicado e mesmo assim mostra “Bloqueio liberado” (`public/recepcao.html:4386-4404`). A correção de status e a liberação precisam ser uma transação única e idempotente.

### I6. Logout e persistência do painel são inadequados para estação compartilhada

O login usa persistência `LOCAL` (`public/recepcao.html:1625-1627`). O limite de oito horas é só um timer da página, reiniciado quando o usuário persistido volta (`public/recepcao.html:1682-1700`, `2756-2783`); fechar o navegador não consome o prazo. O logout apenas chama `signOut` e esconde a tela (`public/recepcao.html:2785-2794`, `2831`), sem limpar `agendamentosCache`, credenciais, logs nem DOM. Em falha de leitura, a tela deliberadamente conserva e renderiza o cache anterior (`public/recepcao.html:3213-3275`). Usar persistência de sessão, prazo absoluto/reauth e purgar memória/DOM no logout.

### I7. Endpoint de agenda tem limite de origem baseado em identidade controlável

`carregarAgendaPublicaHttp` aceita GET e POST sem autenticação/App Check explícito, faz uma transação de rate limit e lê as vagas futuras (`functions/index.js:680-718`, `739-758`). Como o bucket inclui `User-Agent` (`functions/index.js:444-500`), um chamador direto pode criar buckets/documentos ilimitados. O CDN reduz tráfego normal, mas não é controle contra chamadas únicas/diretas. Remover POST, limitar em borda por identidade confiável e evitar uma escrita Firestore por leitura pública.

### I8. CPF sozinho revela falta anterior e data de liberação

`verificarBloqueioCpf` recebe somente CPF e devolve `bloqueado`, data e mensagem que afirma ausência anterior (`functions/index.js:428-429`, `760-769`). App Check identifica uma instância do aplicativo, não o titular do CPF. A função auxiliar da tela não tem chamada encontrada, mas a callable exportada continua alcançável. Remover o oráculo ou exigir o mesmo fator real de titularidade; na criação, responder genericamente antes da verificação de identidade.

## Melhorias

### M1. Diálogo global não tem semântica nem gestão de foco

O modal não declara `role="dialog"`, `aria-modal`, nome acessível nem relação de descrição (`public/index.html:262-268`). A abertura insere botões e apenas remove `oculto`; não move foco, não o prende e não o devolve (`public/index.html:735-764`). Em teste local, o foco permaneceu no botão atrás do diálogo. `Escape` fecha corretamente (`public/index.html:766-770`). Adicionar semântica, foco inicial, *trap* e restauração.

### M2. Em até 400 px, as abas perdem nomes úteis para tecnologia assistiva

O CSS esconde `.aba-texto` (`public/index.html:248-251`); os botões dependem de ícone, conteúdo oculto e `title`, sem `aria-label` (`public/index.html:279-282`). No snapshot de acessibilidade a 360 px, os nomes apareceram como glifos da fonte de ícones. Manter texto apenas visualmente oculto ou adicionar `aria-label` explícito e `aria-current/aria-selected` conforme o padrão escolhido.

### M3. Dois atalhos ficam abaixo do alvo de toque recomendado

Os botões “Cancelar horário” e “Ver documentos necessários” usam apenas `padding: 7px 12px` (`public/index.html:143-146`) e mediram aproximadamente 35 px de altura no navegador a 360×800; as abas, por contraste, já recebem `min-height: 44px` (`public/index.html:248-250`). Dar aos atalhos altura mínima de 44 px.

### M4. Correção do relógio do servidor não governa toda a filtragem local

O desvio é calculado (`public/index.html:545-564`), mas `hojeISO`, `agoraSaoPauloInput` e a filtragem dos horários continuam usando o relógio bruto do aparelho (`public/index.html:493-520`, `593-620`). Um celular muito adiantado pode esconder vaga válida; um atrasado pode oferecer vaga que o backend recusará. O backend permanece autoritativo, então a gravidade é baixa. Usar o desvio em todos os cálculos de disponibilidade ou confiar no campo do servidor.

## Discordâncias com as decisões anteriores

1. **Grade por data — confirmada.** O corte, as grades 8/10 e a precedência do override explícito estão corretos e cobertos por testes. A configuração de produção resulta em 40 vagas.
2. **Telemetria “desativada” — discordo.** Está desativada apenas na interface. A superfície anônima RTDB e seus gatilhos O(N) permanecem externamente acionáveis; isso não é uma desativação de segurança.
3. **Atualização resiliente às 08:00 — parcialmente correta.** O retry de 60 s, jitter, `Date` + `Age` e retomadas existem e passam nos testes (`functions/atualizacao-abertura.test.js:49-141`, `176-190`). Porém, o fluxo não começa após falha da primeira carga sem data conhecida e a validação “fresca” continua sujeita à mesma chave cacheada do minuto. A conclusão de resiliência era ampla demais.
4. **Remoção de chaves de mapas — confirmada.** Os testes verificam `FieldValue.delete()`/`update()` e nenhuma união cega restante nas superfícies da agenda.
5. **`getDatabase()` sob demanda — confirmada.** O teste correspondente passa e não foi encontrado acesso em carga de módulo.
6. **Ensaio de carga — resultado correto, conclusão limitada.** Ele demonstra baixa latência de leitura cacheada e um vencedor no documento de slot (`tests/load/results/2026-08-14-homologacao.md:18-29`, `44-64`). Não testa frescor após cada reserva, resposta perdida depois de *commit*, token antigo, substituição por CPF nem operações do painel. Portanto, não certifica os objetivos completos da abertura.
7. **Problema conhecido CPF + nascimento — gravidade subestimada.** A consulta/cancelamento fracos continuam verdadeiros, mas há dois caminhos adicionais: substituição exige somente CPF (B4), e tokens irmãos antigos podem apagar slot/índice de estado posterior (B5). O rate limit também aceita variações textuais do mesmo CPF e `User-Agent`.

## O que foi verificado e estava correto

- **Testes:** `npm.cmd --prefix functions test` terminou com `44 pass`, `0 fail`.
- **Sintaxe:** `node --check functions/index.js` terminou com código 0 e sem saída.
- **Dependências:** `npm.cmd audit --omit=dev --omit=optional` na raiz e em `functions` retornou `found 0 vulnerabilities`.
- **Escopo de código:** `git diff --name-status 46a2b73..HEAD` mostrou apenas `A docs/PROMPT-auditoria-independente.md`; os achados se aplicam ao código informado como produção.
- **Service worker:** não intercepta requisições; no `activate` apaga todos os caches e assume os clientes (`public/sw.js:1-20`). `sw.js` é servido `no-store`, e HTML exige revalidação (`firebase.json:50-55`, `81-91`). A suspeita de HTML/API antigo servido pelo service worker não se confirmou.
- **Criação pública limpa:** a transação usa documento determinístico do slot e faz leitura antes da escrita (`functions/index.js:865-893`, `958-973`). A disputa normal por uma vaga serializa em um vencedor; os caminhos de dupla venda encontrados vêm de cancelamento antigo e mutações administrativas fora desse controle.
- **Duplo clique comum:** o botão é desativado antes do primeiro `await` (`public/index.html:1558-1560`). O defeito restante é resposta ambígua, não clique duplo ordinário.
- **Firestore público:** não foi encontrado caminho direto não autenticado; o *catch-all* nega acesso (`firestore.rules:61-62`). A exceção anônima relevante está no RTDB.
- **Saídas:** os caminhos revisados escapam texto de usuário antes de `innerHTML` e protegem exportação CSV contra prefixos de fórmula (`public/recepcao.html:1760-1774`). Não foi sustentado achado de SQL/NoSQL injection, XSS, SSRF, upload irrestrito, traversal, execução de comando ou segredo privado no repositório.
- **Fuso da abertura:** para 17/08/2026, `2026-08-17T08:00:00-03:00` corresponde a `2026-08-17T11:00:00.000Z`, e `America/Sao_Paulo` também resolve para GMT-3. Não há divergência do offset fixo nesse evento específico.
- **Formulário:** rótulos de consulta estão associados aos inputs; a grade usa botões nativos; os campos digitados permanecem no DOM ao voltar para escolher outro slot. A mensagem de preservação é verdadeira nesse caminho específico.
- **Cache local público:** `cin_agenda_cache` armazena a agenda pública, não PII (`public/index.html:669-714`).

## O que não foi possível verificar

- **Configuração efetivamente implantada de segurança:** IAM da função HTTP, enforcement de App Check por produto, MFA, verificação de e-mail, política de criação de contas e revogação de tokens exigem leitura das consoles Firebase/Google Cloud ou export oficial dessas configurações.
- **Dados já divergentes:** não foram lidos CPFs/agendamentos reais. Para medir incidência, seria necessário um diagnóstico privilegiado e somente leitura que compare `dados_cidadaos`, `vagas_ocupadas` e `cpfs_agendados`, emitindo apenas contagens anonimizadas.
- **Provas destrutivas:** tomada de agendamento, tokens irmãos e corridas do painel foram validados por fluxo de código, mas não executados em produção. Devem ser reproduzidos no Emulator Suite ou homologação isolada com dados sintéticos.
- **Comportamento exato dos PoPs no pico:** os cabeçalhos permitem a obsolescência descrita e o ensaio comprova uso de borda, mas quantos usuários receberão cada versão depende do CDN. É necessário teste de frescor: reservar slots enquanto clientes em múltiplas redes consultam a mesma chave do minuto.
- **Backups baixados:** o repositório não consegue demonstrar onde arquivos devolvidos por `gerarBackupAdmin` são armazenados, criptografados ou destruídos. É necessária política operacional e inventário externo.
- **Acessibilidade completa:** não foi executada auditoria formal WCAG com leitor de tela real, teclado em todos os fluxos e medição automática de contraste. A inspeção móvel confirmou os problemas pontuais M1–M3.

## Evidência de execução

```text
npm.cmd --prefix functions test
  tests 44 | pass 44 | fail 0

node --check functions/index.js
  exit 0

npm.cmd audit --omit=dev --omit=optional
  found 0 vulnerabilities

npm.cmd --prefix functions audit --omit=dev --omit=optional
  found 0 vulnerabilities

node scripts/ler-grade-agenda.js
  horariosPorDiaSemana: nenhuma chave
  horarios (lista plana): GRADE LEGADA (8)
  dias cadastrados: 5
  automacaoSemanal.ativa: true
```

Foi também produzido um relatório canônico do Codex Security, scan `dc038068-3562-4a79-90f8-b94cdbb938c7`, com 13 achados: 5 altos, 6 médios e 2 baixos. Ele complementa este parecer com rastreamentos de fonte a destino e artefatos JSON/SARIF.
