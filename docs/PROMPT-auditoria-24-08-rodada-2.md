# Prompt — auditoria da rodada 2 (correções da própria auditoria)

Cole o conteúdo abaixo como mensagem para o auditor.

---

Faça uma **auditoria independente** de duas correções feitas no projeto AgendamentoRG. O que as torna especiais: elas **corrigem achados de uma auditoria anterior**, feita no mesmo dia. Ou seja, são correções de correções.

Isso importa porque há histórico. Na rodada anterior, um assistente implantou seis commits em produção declarando-os verificados; a auditoria seguinte encontrou **seis defeitos reais**, dois deles graves — uma URL apontando para uma região que tinha acabado de ser esvaziada, e uma correção de segurança declarada "fechada" que não protegia ninguém. **A taxa de defeito introduzido durante correções, neste projeto, é demonstravelmente alta.** Audite com essa expectativa.

Trate tudo abaixo como hipótese a ser testada. **Discordância fundamentada é o produto.** Não gaste espaço concordando.

## Escopo

Repositório: `https://github.com/Vivaldigui/agendamentorg`, branch `main`.

Audite **apenas** `git diff ae636d5..2107ce3`. O que veio antes já foi auditado.

```
41a5783  Correcoes da auditoria independente de 24/08
2107ce3  Fecha o bypass de agendamento sem protocolo
```

10 arquivos, +384/−27. Tudo já está em produção. 200 testes passam.

## O sistema

Agendamento de RG/CIN da Câmara Municipal de Itanhandu. Firebase Hosting, Cloud Functions v2, Firestore (`southamerica-east1`), RTDB (`us-central1`). Toda segunda às 08:00 (`America/Sao_Paulo`) abre a agenda da semana: 4 dias, 10 horários, **40 vagas**, com centenas de pessoas tentando ao mesmo tempo.

Três funções do caminho crítico vivem em `southamerica-east1`; as outras 14 em `us-central1`. O site mantém dois clientes de Functions e roteia por nome.

**Próxima abertura: 07/09.** Antes dela, em **31/08 às 07:50**, a automação roda numa semana pausada — é o primeiro exercício real de duas das correções abaixo.

## O que a rodada anterior encontrou, e o que foi feito

| # | Achado anterior | Ação |
|---|---|---|
| 4 | URL de pré-aquecimento na automação apontava para `us-central1` (404 após a migração), falhando em silêncio | corrigido |
| 2 | `if (!dados.protocolo) return` ignorava também o telefone gravado — bypass aberto para 40 agendamentos ativos | corrigido |
| 7 | Chave de rate limit usava o texto cru do CPF; grafias diferentes = baldes diferentes | corrigido |
| 6 | A repetição de App Check compunha até 4 POSTs por ação, não 2 | corrigido |
| 8 | `preaquecer-desligar.ps1` podia imprimir "PRONTO" com a conferência falhando | corrigido |
| 3 | Telefone estático não é fator de posse; deveria ser OTP | **não feito** |
| 5 | Desligar a automação não remove `avisoNovasVagasProgramado` obsoleto | **não feito** |
| 9 | A conclusão de latência é mais forte que a medição | **não feito** |

**Avalie também as três não feitas.** Adiar foi certo? Alguma delas vira problema em 31/08 ou 07/09?

## O que verificar em cada correção

### #4 — URL de pré-aquecimento

Agora a região vem de `REGIAO_PICO` em vez de literal, e há trava contra regiões fixas em URLs de função.

**Verifique:** a URL montada está correta para Functions v2 em `southamerica-east1`? A automação roda em `us-central1` e chama uma função em outra região — isso tem implicação de rede, autenticação ou IAM que não existia antes? Se a chamada falhar, o comportamento (`leituraPreaquecida=false`, função conclui normal) ainda esconde o problema? **Isso só será exercitado em 31/08 — há como provar antes que funciona?**

### #2 — bypass de agendamento sem protocolo

Critério novo pelo fator que o documento tem: protocolo+telefone → qualquer um; só protocolo → protocolo; só telefone → telefone; nenhum → recusa.

Estado de produção verificado antes de implantar, sobre agendamentos **ativos e futuros**: 3 só com protocolo, 40 só com telefone, 0 sem nenhum.

**Verifique com atenção máxima:**
- `telefonesConferem` compara os últimos 11 dígitos. Isso aceita telefone de outra pessoa em algum caso realista? Números com e sem o nono dígito, com DDI, com DDD repetido?
- A contagem "0 sem nenhum dos dois" cobriu o universo certo? E agendamentos **passados**, ou os que a rotina de anonimização LGPD já tocou — ela apaga telefone?
- A checagem `digitosTelefone(...).length >= 10` decide entre "recusar sempre" e "aceitar telefone". Um telefone gravado malformado (9 dígitos) tranca a pessoa. Isso existe em produção?
- O site agora exige o campo localmente. Alguém com agendamento legado consegue passar? O painel da recepção consulta por outro caminho — ficou inconsistente?
- A mensagem única foi extraída para `ERRO_SEM_AGENDAMENTO`. Continua indistinguível de "não encontrado" em **todos** os caminhos, inclusive o novo de recusa por ausência de fator?

### #7 — chave de rate limit

Novo helper `digitosCpf` agrupa por dígitos, aplicado em `consultar_agendamento` e `preparar_cancelamento`.

**Verifique:** ficou algum ponto usando o texto cru? A troca muda a ordem das validações de forma que crie outro contorno? O fingerprint por User-Agent continua contornável — isso anula o ganho?

### #6 — quatro POSTs

`chamarFuncao` marca o erro com `appCheckJaRepetido` e o laço externo de criação para.

**Verifique:** a marca sobrevive ao objeto de erro que o SDK de Functions propaga? Se o SDK criar um erro novo, a propriedade se perde e o comportamento antigo volta em silêncio. Os outros fluxos (consulta, cancelamento) ainda compõem repetições? A guarda vem antes da renovação do token, ou a renovação extra acontece do mesmo jeito?

### #8 — script de desligar

A conferência passa a checar o código de saída do `describe`.

**Verifique:** falha parcial deixa estado misto e o script não reconcilia — isso é aceitável? Reexecutar é sempre seguro? Há como o script rodar contra o projeto errado?

## Sobre os testes

200 passam, mas na rodada anterior o auditor mostrou que **um teste deste repositório consagrava a própria vulnerabilidade** como se fosse a intenção, e passava verde. Ele foi reescrito.

Muitas travas aqui leem texto do código-fonte com regex. **Trate isso como suspeito por padrão.** Para cada teste novo em `functions/auditoria-24-08.test.js` e nos reescritos de `functions/segundo-fator.test.js`, pergunte: ele prova comportamento ou só a presença de uma string? Um refactor legítimo o quebraria sem quebrar o sistema? Um defeito real passaria por ele?

Foi verificado que cada trava nova reprova ao reverter a correção correspondente. **Isso prova que ela reage a uma mutação específica, não que ela cobre a propriedade que o nome promete.** Ataque essa distinção.

## O que eu quero de volta

Para cada achado: **onde** (arquivo e linha), **o que quebra**, **em que cenário concreto**, **quanto importa**.

Ordene por severidade e diga explicitamente o que é **bloqueante para 31/08** e o que é **bloqueante para 07/09** — são datas diferentes com riscos diferentes.

Se uma correção estiver certa, uma linha basta.

## Regras

- Não proponha reescrita geral. O sistema atende cidadãos reais.
- Não há ambiente de homologação. Qualquer correção sua será validada em produção.
- Se precisar de um dado que não está aqui (log, documento do Firestore, configuração), diga qual e por quê, em vez de supor.
- Considere que quem escreveu estas correções já errou seis vezes hoje no mesmo tipo de trabalho.
