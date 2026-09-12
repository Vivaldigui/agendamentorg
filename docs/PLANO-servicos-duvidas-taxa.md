# Plano — grade de serviços, aviso da taxa e página de dúvidas

Decidido em 30/08/2026. Implementação preparada no worktree, ainda **não
publicada**. Publicação prevista para depois da abertura de 31/08/2026 (ver
"Cronograma").

Três mudanças, todas no site público:

1. **Aviso da taxa da 2ª via** em todo lugar que lista documentos necessários.
2. **Grade de serviços** na home, no lugar do box do Instagram e das duas tarjas
   de atalho.
3. **`public/duvidas.html`** — 29 perguntas frequentes, conteúdo em
   `docs/CONTEUDO-duvidas-frequentes.md`.

---

## 1. Aviso da taxa da 2ª via

### Por que existe

Muita gente na cidade tem o RG do modelo antigo. Ao ler "2ª via", conclui que o
seu caso é esse e paga a taxa do Estado — que não volta. A primeira emissão da
CIN é gratuita mesmo para quem já teve carteiras do modelo antigo.

### Os oito pontos

Site público — `public/index.html`:

| # | Onde | Referência |
|---|------|-----------|
| 1 | Modal do atalho "Ver documentos necessários" | `abrirDocumentosNecessarios()` |
| 2 | Checklist do formulário, "Confira os documentos antes de finalizar" | `.docs-container.compacto` |
| 3 | Checklist da tela de confirmação, "Documentos Obrigatórios" | `.docs-container` |
| 4 | Texto do WhatsApp e do `.txt` baixado | `documentosTexto()` |
| 5 | Comprovante impresso do site | `documentosComprovanteHTML()` |
| 6 | Descrição do arquivo `.ics` | `DESCRIPTION:` |

Painel da recepção — `public/recepcao.js`:

| # | Onde | Referência |
|---|------|-----------|
| 7 | Lembrete de WhatsApp | `TEMPLATE_LEMBRETE_PADRAO` |
| 8 | Comprovante em PDF do painel | `documentosComprovanteHTML()` |

### Texto — versão HTML

> **Vai tirar o novo RG (CIN) pela primeira vez? É de graça** — mesmo que você já
> tenha o RG antigo.
> Só paga quem **já tem o novo RG** e precisa de **2ª via** (perda, roubo ou
> dano).
> **Como saber qual é o seu:** no novo RG o número principal é o seu **CPF**. Se
> o seu documento tem um número de RG diferente do CPF, ele é o antigo — e a sua
> CIN será 1ª via, gratuita.
> Guia de pagamento da 2ª via: *emitir guia (DAE)*
> **Na dúvida, não pague antes.** Traga o documento que a recepção confere na
> hora.

### Texto — versão em texto puro

Sem acento nos arquivos que já são sem acento (`documentosTexto()`,
`documentosComprovanteHTML()` do site). Com acento no `TEMPLATE_LEMBRETE_PADRAO`,
que já usa.

```
Sobre a taxa:
- A 1a via do novo RG (CIN) e gratuita, mesmo que voce ja tenha o RG antigo.
- So paga quem ja tem o novo RG (CIN) e precisa de 2a via (perda, roubo ou dano).
- Como saber: no novo RG, o numero principal e o seu CPF.
- Guia da 2a via: https://daeonline1.fazenda.mg.gov.br/daeonline/executeEmissaoDocumentoArrecadacaoCarteiraIdentidade.action
- Na duvida, nao pague antes: a recepcao confere no atendimento.
```

No `.ics`, uma linha só: `1a via do novo RG e gratuita. Na duvida, nao pague antes.`

### Duas armadilhas

**O modal renderiza com `textContent`.** Link dentro da mensagem não fica
clicável. A saída é um botão extra no array `botoes`, "Emitir guia da 2ª via",
que abre o link — mantendo a proteção contra HTML injetado.

**`TEMPLATE_LEMBRETE_PADRAO` é só o padrão.** Se
`configuracoes/agenda.mensagemLembreteTemplate` já existir no Firestore, o texto
novo nunca chega ao cidadão. A recepção precisa colar o texto novo em
Configurações → "Mensagem de lembrete WhatsApp", ou o painel ganha um botão
"restaurar padrão". Sem isso a mudança fica invisível em produção.

---

## 2. Grade de serviços

### O que sai e o que entra

| Região atual | Destino |
|---|---|
| Cabeçalho + card de status da agenda | fica |
| Abas Novo · Consultar · Cancelar | fica |
| Tarja laranja `.atalho-cancelamento` | vira bloco (o aviso de texto continua, em faixa fina) |
| Tarja azul `.atalho-documentos` | vira bloco |
| Box branco `.instagram-suporte` | vira **uma linha no rodapé** |
| — | **grade de serviços**, seis blocos |

### Os seis blocos, em ordem

| Bloco | Ação | Cor |
|---|---|---|
| Documentos necessários | abre o modal existente | `#0056b3` |
| Consultar agendamento | vai para a aba Consultar | `#0b7a52` |
| Cancelar horário | vai para a aba Cancelar | `#c0392b` |
| Taxa da 2ª via | **abre o aviso**, e só depois o DAE | `#a06400` |
| Como chegar | abre o mapa da Câmara | `#4f5d75` |
| Dúvidas frequentes | abre `/duvidas.html` | `#6d4aa8` |

### Opção A — bloco inteiro colorido

Escolhida. Fundo na cor cheia, ícone em selo translúcido, rótulo e dica em
branco.

As cores acima **já são a versão escurecida**: os tons originais da maquete
reprovavam em contraste com texto branco. Razões de contraste calculadas contra
`#ffffff`:

| Cor | Razão | AA (4.5:1) |
|---|---|---|
| `#0056b3` | 7,0:1 | passa |
| `#0b7a52` | 5,4:1 | passa |
| `#c0392b` | 5,4:1 | passa |
| `#a06400` | 4,9:1 | passa |
| `#4f5d75` | 6,7:1 | passa |
| `#6d4aa8` | 6,6:1 | passa |

O âmbar era o caso crítico: `#d18300` dá 3,0:1 e reprova. A dica secundária usa
branco sólido. A auditoria final mostrou que `rgba(255,255,255,0.9)` sobre o
âmbar escurecido ainda fica em aproximadamente 4,29:1 e reprova em AA.

### Regras de layout

- Duas colunas no celular, três a partir de 720 px.
- Altura mínima de 96 px por bloco, alvo de toque bem acima dos 44 px que a
  auditoria de mobile cobrou.
- Cada bloco é `<button>` ou `<a>` de verdade, nunca `<div onclick>`.
- Ícones em SVG inline, como os do Instagram e do WhatsApp que já existem — não
  puxar a família "brands" do Font Awesome (102 KB).
- A grade fica visível **também com a agenda fechada**. É justamente o estado em
  que a página hoje não serve para nada.

### A regra do bloco laranja

O bloco "Taxa da 2ª via" **não pode abrir o DAE diretamente**. O toque abre o
aviso; o botão do DAE fica atrás dele. Um atalho direto para o pagamento é
exatamente o erro que a mudança 1 existe para evitar.

O rótulo já avisa na home: **"Taxa da 2ª via — só para quem já tem a CIN"**.

---

## 3. Página `public/duvidas.html`

Conteúdo: `docs/CONTEUDO-duvidas-frequentes.md`. 29 perguntas em cinco grupos.

### Por que página separada, e não um bloco no index

- **O caminho crítico não engorda.** `index.html` já tem 171 KB e é o arquivo que
  centenas de pessoas baixam ao mesmo tempo na abertura. As ~8 KB do FAQ não
  precisam estar lá.
- **Não pode quebrar o agendamento.** Um arquivo novo é incapaz de derrubar a
  tela de agendar.
- **Acordeão sem JavaScript.** `<details>` e `<summary>` nativos: abrem, fecham e
  funcionam no leitor de tela sem uma linha de script.
- **Google.** Com `FAQPage` em JSON-LD, as perguntas podem aparecer no resultado
  de busca de quem procura "RG Itanhandu". Dentro de um modal isso é invisível.
- **Dá para mandar o link.** A recepção cola `/duvidas.html` no WhatsApp em vez
  de digitar a mesma resposta.

Custo: duplicar ~60 linhas de CSS, já que o CSS do site é embutido no
`index.html`.

### Infraestrutura

`firebase.json` **não muda**. A página nova herda o header `**` (CSP com
`'unsafe-inline'` em `script-src` e `style-src`) e o `Cache-Control` de
`**/*.html`.

---

## Conflitos resolvidos

O FAQ escrito pela Câmara discordava do checklist do site em quatro pontos. Em
todos, **a regra do balcão prevalece e o FAQ foi corrigido**:

| # | Assunto | Site dizia | FAQ dizia | Resolução |
|---|---|---|---|---|
| 1 | CPF | obrigatório | "caso já possua", emite na hora | **obrigatório; basta informar o número** |
| 2 | Comprovante de residência | obrigatório | não mencionava | **obrigatório**, com o motivo (Correios) |
| 3 | Foto 3x4, menor de 3 anos | obrigatório | "em regra, não" | **obrigatória** |
| 4 | Representante legal | doc. com foto | + comprovação de guarda | **doc. com foto; guarda quando não for pai nem mãe** |

O conflito 4 é o único que muda o **site**, não o FAQ: a exigência de comprovação
de guarda entra no checklist, nos mesmos oito pontos do aviso da taxa.

---

## Cronograma

A agenda abriu em **31/08/2026 às 08:00** com 30 vagas para três dias, disputadas
por centenas de pessoas. Nada disto deveria subir nas horas anteriores a uma
abertura: é o único momento em que a página precisa estar exatamente como foi
testada.

Ordem recomendada:

1. `public/duvidas.html` sozinha, **sem link no index** — arquivo novo, incapaz
   de afetar o agendamento, já divulgável no Instagram.
2. Depois da abertura: aviso da taxa nos oito pontos.
3. Depois da abertura: grade de serviços e o link para `/duvidas.html`.

Auditoria antes de publicar 2 e 3: `docs/PROMPT-auditoria-duvidas-e-servicos.md`.
