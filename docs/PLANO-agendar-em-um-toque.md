# Plano — agendamento rápido com confirmação (inversão do fluxo)

Implementado em 31/08/2026 e atualizado em 01/09/2026 no working tree, **não
publicado, não commitado**. Toca o caminho crítico do agendamento e precisa da
auditoria própria descrita no fim antes de ir ao ar.

## O problema

O fluxo antigo tinha quatro passos: dia → horário → formulário (5 campos + 2
caixas) → finalizar. O horário era só **verificado** ao ser tocado, mas só era
**ganho** no envio final. Toda a digitação acontecia dentro da janela em que
outra pessoa podia levar a vaga. Numa abertura de 30 vagas para centenas de
pessoas, é aí que a vaga se perde.

## O que mudou

Três passos: **dados → dia → horário**. O toque no horário abre uma confirmação
com a data e a hora; somente o botão **Confirmar agendamento** envia o pedido.

- A digitação acontece **antes** de escolher o horário — pode ser feita durante a
  contagem regressiva, fora da disputa.
- Depois da confirmação local, o fluxo chama direto `confirmarAgendamento`
  (transacional e idempotente). Continua sem a chamada remota prévia
  `verificarDisponibilidadeSlotCidadao`: **metade das requisições no pico**.
- A janela de perda encolhe de "todo o tempo de digitação" para o tempo de
  conferir o modal mais uma ida e volta ao servidor.

### Como foi feito, sem reescrever a transação

A mesma seção `#dados-pessoais` serve às duas fases, alternada pela classe de
modo:

- `.modo-preencher` (fase 1): formulário + aceite + botão "Continuar para
  escolher o dia" (`avancarParaDatas`, validação bloqueante).
- `.modo-confirmar` (fase 3): resumo + `FINALIZAR`, preenchido depois que a pessoa
  confirma data e hora no modal de `selecionarHorarioEConfirmar`, que então
  invoca `confirmarAgendamento`.

`confirmarAgendamento`, `abrirAlterarHorario` e a lógica de retry **não foram
tocados**. Eles leem os inputs (que continuam no DOM) e `dataSel`/`horaSel`. Toda
a contenção — slot ocupado, `failed-precondition`, retry idempotente por
`operationId` — continua onde estava. Se a criação falhar por rede, o usuário fica
na tela de confirmação com o `FINALIZAR` disponível para o retry seguro, e as
mensagens "clique em FINALIZAR novamente" voltam a fazer sentido.

Os dados ficam em `sessionStorage` (`cin_dados_agendamento`), somem ao fechar a
aba e **nunca sobem ao servidor sem a pessoa confirmar data e horário**.

## Melhorias menores, no mesmo passe

1. **Botão "Primeiro horário livre"** no topo da grade de horários — seleciona o
   primeiro slot livre do dia e abre a mesma confirmação de data e hora.
2. **Uma caixa de declaração em vez de duas.** O aviso do bloqueio de 6 meses
   continua como tarja logo acima; o texto foi fundido no único aceite restante.
   Menos um toque no minuto que mais importa.
3. **Contador "X vagas restantes nesta abertura"** no topo da grade de datas.
4. **Nascimento tolerante a colagem** — `mascaraData` também roda no `blur`, então
   data colada de outro lugar ou digitada em 8 dígitos é reformatada.

## Testes

`npm --prefix functions test` → **276/276**. Três testes em
`robustez-agendamento.test.js` afirmavam o comportamento antigo do toque
(pré-verificação + tratamento de `failed-precondition` dentro de `renderHoras`).
Foram **re-apontados para o novo contrato**, não enfraquecidos: a verificação
continua existindo para a reconciliação; a contenção agora é verificada dentro de
`confirmarAgendamento`.

## O que falta antes de publicar — auditoria própria

Esta mudança entra no caminho crítico. Não pode subir sem verificar, em navegador
real contra o Firebase de verdade:

1. **Disputa durante a confirmação.** O modal evita o toque acidental, mas não
   segura a vaga enquanto está aberto. Se duas pessoas confirmarem o mesmo slot,
   a transação aceita apenas a primeira e devolve o conflito à outra.
2. **Dados no aparelho antes de existir agendamento.** Ficam em `sessionStorage`.
   **Precisa constar da política de privacidade** que está sendo escrita
   (`docs/POLITICA-PRIVACIDADE.md`) — hoje ela não menciona esse armazenamento
   local.
3. **Validação migrou para o começo.** Confirmar que um campo inválido é barrado
   em "Continuar", e não só no toque do horário.
4. **Estados da home:** agenda aberta, fechada, primeiro horário livre, erro de
   rede no meio do toque, voltar e revisar, trocar de aba e voltar.

O que **não** mudou: `criarAgendamentoCidadao`, a transação de vagas, a
idempotência por `operationId`, a regra de um agendamento por CPF.

## Nota de LGPD

O texto do aceite continua o de **consentimento** (`aceite-lgpd`). A
`docs/AUDITORIA-LGPD.md` recomenda trocá-lo por "ciência", porque a base legal
correta é execução de política pública. Essa troca **não foi feita aqui** para
não misturar com esta mudança de fluxo — segue como item da trilha de LGPD.
