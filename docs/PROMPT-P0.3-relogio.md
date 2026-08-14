# Prompt — correção do P0.3: sincronização de relógio

Cole o conteúdo abaixo como mensagem para o Codex.

---

O **P0.3 foi aprovado na revisão, com uma ressalva** que precisa ser corrigida antes do deploy. Tudo o mais está certo: janela de 60 s, backoff com jitter, guarda contra concorrência, chave `?atualizar-minuto=` preservada, agenda válida nunca apagada, três estados visuais distintos. **Não mexa nesses pontos.**

Escopo desta tarefa: apenas a correção do relógio, em `public/index.html` e `functions/atualizacao-abertura.test.js`.

**Não altere** `public/recepcao.html`, `functions/agenda-grade.js`, `functions/agenda-automation.js`, nem as correções de `FieldValue.delete()` em `functions/index.js`.

## O problema

`sincronizarRelogioServidor` deriva o desvio de `cfg.servidorEm`, que vem **no corpo** da resposta. Esse corpo é servido pelo CDN. Três erros se somam, todos na mesma direção — empurrar o alvo do contador para **depois**:

| Fonte | Magnitude |
|---|---|
| `agoraSaoPauloInput()` trunca no minuto (`YYYY-MM-DDTHH:MM`) | até 60 s |
| Corpo vindo do cache: `s-maxage=60` na manhã de segunda, `s-maxage=300` fora, mais `stale-while-revalidate` de 120 s / 600 s | 1 a 6 min |
| `RELOGIO_SERVIDOR_SINCRONIZADO` trava na primeira resposta e nunca ressincroniza | permanente na sessão |

O código não distingue “o celular está 5 minutos adiantado” de “a resposta ficou 5 minutos no CDN”. Um cidadão com relógio correto, que abriu a página no domingo à noite e recebeu uma resposta cacheada, tem o contador disparando minutos depois das 08:00 — e fica preso nesse desvio até recarregar.

O atraso de cada pessoa passa a depender da sorte do cache, numa disputa por poucas dezenas de vagas. Antes da mudança todos usavam o relógio local, que na maioria dos celulares está sincronizado por NTP. Do jeito que está, a correção piora o caso comum para proteger o caso raro.

## O que fazer

### 1. Derivar a hora do servidor dos cabeçalhos, não do corpo

`Date` e `Age` são precisos ao segundo e já contabilizam o tempo em cache:

```js
const servidorMs = Date.parse(resposta.headers.get("Date")) + Number(resposta.headers.get("Age") || 0) * 1000;
```

O endpoint `/api/agenda-publica` é same-origin pelo rewrite do Hosting, então os cabeçalhos são legíveis sem CORS.

`buscarAgendaPublicaAtualizada` hoje devolve só `await resposta.json()`. Faça-a devolver também a hora do servidor derivada dos cabeçalhos — decida a forma (objeto com `dados` e `servidorMs`, ou campo extra no retorno), mantendo `carregarConfig` legível e o valor de retorno de `carregarConfig` compatível com quem já o consome (`executarAtualizacaoAbertura` usa `cfg`).

Se `Date` estiver ausente ou não parsear, caia para `cfg.servidorEm`. Se os dois faltarem, não corrija nada.

### 2. Ignorar desvios pequenos

Só aplique a correção quando o desvio absoluto for **maior que 90 segundos**. Abaixo disso é ruído de truncamento e de cache, e mover o alvo faz mais mal que bem. O objetivo é pegar relógio genuinamente errado — minutos ou horas —, não ajustar segundos.

Deixe o limiar numa constante nomeada, com comentário explicando o porquê.

### 3. Permitir ressincronizar

`RELOGIO_SERVIDOR_SINCRONIZADO` travar para sempre é ruim para quem deixa a página aberta por horas. Permita que uma resposta **não cacheada** (`Age` ausente ou `0`) atualize o desvio, mesmo que já tenha havido sincronização. Continue evitando que respostas cacheadas piorem um desvio já calculado.

## Testes

O teste atual **codifica o defeito como comportamento esperado** — precisa ser refeito:

```js
// functions/atualizacao-abertura.test.js:192
test("cliente corrige o alvo pelo relogio do servidor e tolera campo ausente", ...)
assert.equal(calcular("2026-08-17T07:55", localAdiantado), -5 * 60 * 1000);
assert.equal(alvoCorrigido.getTime(), Date.parse("2026-08-17T08:05:00-03:00"));
```

Substitua por cobertura que distinga os dois casos. No mínimo:

- resposta **cacheada** (`Age: 300`) com relógio local correto → desvio resultante ≈ 0, alvo **não** se move
- resposta fresca (`Age: 0`) com relógio local 10 minutos adiantado → correção aplicada, alvo move 10 minutos
- desvio de 40 segundos → **ignorado**, alvo intacto
- `Date` ausente → cai para `servidorEm` sem quebrar
- `Date` e `servidorEm` ausentes → nenhuma correção, sem exceção
- resposta fresca posterior ressincroniza; resposta cacheada não desfaz uma sincronização boa

## Critério de pronto

- `npm --prefix functions test` verde
- `node --check functions/index.js` sem erro
- JavaScript embutido dos dois HTMLs válido
- `git diff --check` limpo
- `git status` mostra apenas `public/index.html` e `functions/atualizacao-abertura.test.js`
- com resposta cacheada de 5 minutos e relógio local correto, o contador dispara às 08:00, não às 08:05

## Regras

Não faça deploy, commit nem push. Pare ao final para revisão. Se algo se mostrar mais arriscado que o descrito, pare e comunique antes de improvisar.
