# Prompt — auditoria da rodada 3

Cole o conteúdo abaixo como mensagem para o auditor.

---

Faça uma **auditoria independente** de três commits do projeto AgendamentoRG. Contexto que muda como você deve ler isto: **esta é a terceira rodada no mesmo dia.**

- Rodada 1 auditou seis commits recém-implantados e achou **seis defeitos**, dois graves.
- Rodada 2 auditou as correções da rodada 1 e achou **oito**, incluindo uma trava de teste **comprovadamente vazia** — o `//` de `https://` era lido como início de comentário, a linha da URL sumia e o teste passava mesmo com o defeito presente.
- Estes três commits são as correções da rodada 2, mais duas decisões tomadas a partir dela.

Ou seja: **em duas tentativas seguidas, quem escreveu este código introduziu defeitos enquanto corrigia defeitos.** Audite com essa taxa de base. Concordar não ajuda; ache o que passou.

## Escopo

Repositório: `https://github.com/Vivaldigui/agendamentorg`, branch `main`.

Audite **apenas** `git diff 2107ce3..4da4506`. O anterior já foi auditado duas vezes.

```
272e144  Correcoes da rodada 2 da auditoria
8d14210  Protocolo passa a ter precedencia sobre o telefone
4da4506  Teto de rate limit por origem e alerta ao desligar a automacao
```

7 arquivos, +333/−39. Tudo em produção. 208 testes passam.

## O sistema

Agendamento de RG/CIN da Câmara Municipal de Itanhandu. Firebase Hosting, Cloud Functions v2, Firestore (`southamerica-east1`), RTDB (`us-central1`). Segundas às 08:00 (`America/Sao_Paulo`) abrem 40 vagas para centenas de pessoas.

Três funções do caminho crítico vivem em `southamerica-east1`; as outras 14 em `us-central1`.

**31/08 às 07:50** — a automação roda numa semana pausada. **07/09** — próxima abertura real.

## O que mudou

### A. Correções da rodada 2 (`272e144`)

- **Trava vazia:** novo `semComentariosDeLinha` que não engole `://`, e um teste que exercita a própria trava contra um defeito plantado.
- **Telefone 10 vs 11 dígitos:** novo `telefoneCanonico` tira o código do país e insere o nono dígito quando o assinante começa em 6-9. Fixo (2-5) fica intacto. Motivo: há 1 agendamento ativo gravado com 10 dígitos contra 39 com 11, e o telefone virou fator de acesso.
- Números corrigidos em comentários e documentos.

**Verifique:** `semComentariosDeLinha` tem falso negativo? Um `//` dentro de string, regex ou template literal quebra o resultado? `telefoneCanonico` pode aproximar números de pessoas diferentes? DDDs que começam com dígitos diferentes, números com 12 dígitos, `0800`, portabilidade entre DDDs?

### B. Precedência do protocolo (`8d14210`) — decisão, não correção

Antes: `protocolo OU telefone`. Agora, quando o agendamento **tem** protocolo, **só o protocolo abre**. Telefone vale apenas para os legados que nunca tiveram protocolo.

Motivo: CPF, nascimento e telefone são três dados estáticos; quem os obtiver num vazamento consulta e cancela sem possuir nada da vítima.

Impacto medido antes de implantar, sobre agendamentos ativos futuros: **0** com protocolo e telefone, 3 só com protocolo, 40 só com telefone. Ninguém com horário marcado perdeu acesso.

**Verifique com atenção máxima — o protocolo agora é o único fator para todo agendamento novo:**

- **Entropia.** `gerarProtocolo` pega os 8 primeiros caracteres alfanuméricos do ID do documento Firestore e **passa para maiúsculas**. IDs do Firestore são base62; o `toUpperCase()` colapsa `a-z` em `A-Z`. Qual é a entropia real? É suficiente agora que o protocolo é o único fator? Colisões entre dois agendamentos são possíveis, e o que aconteceria?
- **Perda de acesso ao longo do tempo.** `anonimizarDadosAntigosLGPD` roda mensalmente sobre dados com mais de 6 meses. Ela apaga `telefone` ou `protocolo`? Pode criar registros ativos sem nenhum fator? `remarcarAgendamentoAdmin` preserva o protocolo?
- **Entrega.** O protocolo aparece no ticket, no PDF e na mensagem de WhatsApp. Se a pessoa fechar a aba sem salvar nada, perdeu? A recepção consegue recuperar por CPF — isso é suficiente ou vira gargalo em 07/09?
- **Encaixes manuais.** `criarEncaixeManual` gera protocolo mas telefone é opcional. Alguém pode sair da recepção sem nenhum dos dois na mão?
- **A mensagem de erro** continua indistinguível de "não encontrado" em todos os caminhos, inclusive na recusa por ausência de fator?

### C. Teto de rate limit por origem (`4da4506`)

A chave era `SHA256(ip|user-agent|cpf)` e o User-Agent vem do cliente. Foi adicionado um **segundo** limite, sobre `aplicarRateLimitOrigem` (só IP, mecanismo já existente em produção):

```
consultar_agendamento     8/10min por dispositivo + 20/10min por origem
preparar_cancelamento     6/10min por dispositivo + 15/10min por origem
```

O User-Agent **não** foi removido: é ele que espalha a carga no pico — atrás de um CGNAT, celulares do mesmo modelo cairiam no mesmo documento e disputariam a transação. `criar_agendamento` e `verificar_bloqueio_cpf` não mudaram, por serem caminho quente.

**Verifique:** dois limites significam **duas transações Firestore por requisição** — qual o custo em latência e contenção? Os tetos (20 e 15) são altos demais para conter, ou baixos demais para uma família atrás do mesmo IP? Uma escola, lan house ou órgão público com dezenas de pessoas no mesmo IP fica travado? A ordem dos dois limites importa? `ipOrigemConfiavel` é realmente confiável atrás do Cloud Run?

### D. Alerta no painel (`4da4506`)

Aviso ao lado do controle que desliga a automação, porque a automação não distingue um aviso automático obsoleto de um programado à mão — os dois gravam `avisoNovasVagasProgramado`.

**Verifique:** um alerta em texto é proteção suficiente, ou era melhor um marcador de origem já? O texto está correto sobre o que de fato acontece?

## Sobre os testes — leia isto antes de olhar qualquer teste

208 passam. Na rodada 2 ficou provado que **uma trava deste repositório era vazia** e que **um teste consagrava a própria vulnerabilidade** como se fosse a intenção. Ambos verdes.

Quase toda trava nova aqui lê texto do código-fonte com regex ou `indexOf`. **Trate cada uma como suspeita.** Para cada teste em `functions/auditoria-24-08.test.js` e `functions/segundo-fator.test.js`, pergunte:

1. Prova comportamento ou só presença de string?
2. Um refactor legítimo o quebraria sem quebrar o sistema?
3. Um defeito real passaria por ele?
4. O nome promete mais do que a asserção entrega?

Foi verificado que cada trava nova reprova ao reverter a correção correspondente. **Isso prova reação a uma mutação específica, não cobertura da propriedade anunciada.** Ataque essa diferença — foi exatamente assim que a trava vazia passou despercebida.

## O que eu quero de volta

Para cada achado: **onde** (arquivo e linha), **o que quebra**, **em que cenário concreto**, **quanto importa**.

Separe explicitamente **bloqueante para 31/08** de **bloqueante para 07/09**.

Diga também, com franqueza: **a precedência do protocolo foi a decisão certa?** Ela troca risco de segurança por risco de perda de acesso, numa prefeitura pequena onde quem perde o código liga para a recepção. Se você acha que foi errado, diga.

Se algo estiver certo, uma linha basta.

## Regras

- Não proponha reescrita geral. O sistema atende cidadãos reais toda semana.
- Não há ambiente de homologação. Qualquer correção sua será validada em produção.
- Se precisar de um dado que não está aqui (log, documento do Firestore, configuração), diga qual e por quê, em vez de supor.
- Duas auditorias anteriores acharam catorze defeitos neste mesmo trabalho. Assuma que ainda há.
