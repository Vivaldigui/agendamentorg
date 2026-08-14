# Prompt — P0.4, P0.5 e um teste que ficou faltando

Cole o conteúdo abaixo como mensagem para o Codex.

---

Três tarefas pequenas e independentes. P0.1, P0.2 e P0.3 estão concluídos e revisados; o último commit é `f648ebb` e a suíte tem **38 testes passando**. Rode `git pull` antes de começar.

**Não altere** `public/recepcao.html`, `functions/agenda-grade.js`, `functions/agenda-automation.js`, nem as correções de `FieldValue.delete()` em `limparDatasPassadasAgenda` e `prepararAgendaSemanalAutomatica`.

Faça as três na ordem abaixo e pare ao final para revisão. Não faça deploy, commit nem push.

---

## 1. Teste que ficou faltando do P0.3

Em `functions/atualizacao-abertura.test.js`, todos os casos de relógio fornecem o cabeçalho `Age`. **A única forma que a produção realmente devolve não é testada.**

Verifiquei ao vivo contra `https://agendamento-cin-itanhandu.web.app/api/agenda-publica`: em `X-Cache: HIT`, o Google Frontend **regenera o `Date`** a cada resposta e **não envia `Age`**. Três medições, todas com `Date` igual à hora real, sobre uma resposta cacheada mais de um minuto antes.

Acrescente cobertura para `Date` presente e `Age` ausente — `respostaHttp("Mon, 17 Aug 2026 11:00:00 GMT", null)`:

- com relógio local correto, o desvio resultante deve ser `0` e o alvo não se move
- com relógio local 10 minutos adiantado, a correção deve ser aplicada
- `respostaFresca` deve ser `true` (é o comportamento esperado quando `Age` falta)

Deixe um comentário no teste registrando que esta é a forma real de produção, para que ninguém a remova por parecer redundante.

---

## 2. P0.4 — remover o fallback que aponta para o RTDB de produção

`functions/index.js`, no topo:

```js
initializeApp({
  databaseURL: process.env.FIREBASE_DATABASE_URL
    || "https://agendamento-cin-itanhandu-default-rtdb.firebaseio.com"
});
```

Um deploy em homologação sem `FIREBASE_DATABASE_URL` definida grava presença e sessões **em produção** — contradizendo o aviso de `tests/load/README.md`.

Em Cloud Functions, `FIREBASE_CONFIG` já traz o `databaseURL` do projeto correto, então `initializeApp()` sem argumentos resolve sozinho e se adapta por projeto.

Faça a troca e confirme que `getDatabase()` continua funcionando. Rode `node --check functions/index.js` e verifique que nada mais no arquivo depende da URL explícita.

Acrescente um teste garantindo que a URL de produção não reapareça codificada em `functions/index.js`. A URL **continua legítima** em `.firebaserc` e no `firebaseConfig` dos dois HTMLs — o teste deve mirar só o backend.

---

## 3. P0.5 — impedir que os testes de carga atinjam produção

`tests/load/booking-contention.js` **cria agendamentos reais** e sua única trava é `CONFIRM_HOMOLOGATION=SIM`. Como o `README.md` instrui a definir isso com `$env:` no PowerShell, a variável persiste na sessão inteira: trocar `FUNCTION_URL` por engano depois disso roda sem nenhuma guarda.

Adicione uma **denylist explícita** que aborte se a URL contiver `agendamento-cin-itanhandu`, **independentemente de qualquer variável de confirmação**. Uma variável de ambiente não pode destravar a denylist — esse é o ponto.

Espelhe a mesma proteção em `tests/load/agenda-read.js`, que hoje só tem uma allowlist por padrão de nome (`localhost|homolog|staging|teste`) e aceita qualquer outra URL mediante confirmação.

Atualize `tests/load/README.md` descrevendo a proteção e deixando claro que ela não é contornável por variável de ambiente.

Se der para testar as guardas sem depender do k6 (por exemplo, extraindo a validação para uma função pura ou verificando o texto dos scripts), acrescente cobertura. Se não der, explique por quê em vez de improvisar um teste frágil.

---

## Critério de pronto

- `npm --prefix functions test` verde, com os testes novos
- `node --check functions/index.js` sem erro
- JavaScript embutido dos dois HTMLs válido
- `git diff --check` limpo
- `public/recepcao.html` **não** aparece em `git status`
- `grep -rn "agendamento-cin-itanhandu-default-rtdb" functions/` não retorna nada

## Regras

Pare ao final para revisão. Se algum item se mostrar mais arriscado do que o descrito, pare e comunique antes de improvisar.
