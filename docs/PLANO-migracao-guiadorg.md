# Plano — levar o agendamento da CIN para o domínio do Guia do RG

Proposto em 22/10/2026, a partir do código dos dois repositórios (`agendamentorg`
e `guiadorg`) nessa data. Nada foi implementado. A Fase 0 depende da Câmara e
segura todas as outras; o que cabe a você decidir está no fim, em "Decisões em
aberto". O enquadramento jurídico da Fase 0 é ponto de partida para o jurídico
ou o controle interno da Câmara, que devem revisá-lo.

O que o plano propõe:

1. **Endereço novo em subdomínio**, `itanhandu.guiadorg.com.br`, servido pelo
   mesmo projeto Firebase de hoje. Firestore, functions, App Check e painel
   ficam onde estão: nenhum dado de cidadão muda de lugar.
2. **A Câmara continua controladora dos dados**, e a mudança sai por ofício e
   termo antes de qualquer deploy.
3. **Nenhum anúncio e nenhum rastreamento publicitário no agendamento**, com
   trava em teste para isso não voltar por descuido.
4. **O `.gov.br` vira redirecionamento 301** para o mesmo caminho no endereço
   novo, sem mexer no DNS da Câmara. Voltar atrás custa um deploy.

---

## Decisão 1 — subdomínio ou caminho

Decidido em 22/10/2026: subdomínio `itanhandu.guiadorg.com.br`.

A ideia inicial era `guiadorg.com.br/agendamento`. O Firebase não monta isso
sozinho: um domínio aponta para um único site de Hosting, e o rewrite de
`/api/agenda-publica`, que põe o CDN na frente da agenda no pico das 08:00, só
alcança functions do mesmo projeto. O guiadorg e o agendamento estão em
projetos diferentes.

| | `itanhandu.guiadorg.com.br` (escolhido) | `guiadorg.com.br/agendamento` |
|---|---|---|
| Como é servido | mais um site de Hosting no projeto atual | proxy (ex.: Cloudflare Worker) na frente do guiadorg inteiro |
| Código do agendamento | troca de endereço em uns 25 arquivos, como em 15/09 | a mesma troca, mais prefixar todo caminho absoluto: `/painel`, `/api/agenda-publica`, `/cin/`, `/sobre/`, `/duvidas.html`, `/sw.js` (escopo `/`), `manifest.json` e o gerador do editorial |
| Pico das 08:00 | igual a hoje | um salto a mais (o proxy) em toda requisição da abertura |
| Separação dos anúncios | origem diferente: script de anúncio do blog não lê o armazenamento do agendamento | mesma origem: script das páginas com anúncio lê o que o agendamento guarda no aparelho (`CHAVE_ULTIMO_AGENDAMENTO`, `cin_agenda_cache`) |
| Voltar atrás | um deploy | desfazer proxy, caminhos e DNS |

O caminho passaria um pouco mais da autoridade do `guiadorg.com.br` para o
agendamento. Para um serviço local que já apareceu em primeiro na busca orgânica
por "agendamento rg itanhandu" (`docs/AUDITORIA-SEO-CIN.md:51`), esse ganho não
paga um proxy no caminho da abertura nem a origem compartilhada com anúncios.

`itanhandu.` em vez de `agendamento.`: o serviço só atende Itanhandu, e
`agendamento.guiadorg.com.br` sugere agendamento de RG para o país inteiro, que
é a promessa dos sites de golpe que cobram taxa.

## O que existe hoje

- **Endereço oficial:** `cin.itanhandu.cam.mg.gov.br` desde 15/09/2026 (commit
  `e81fcba`), com DNS criado pela hospedagem da Câmara.
  `agendamento-cin-itanhandu.web.app` e `.firebaseapp.com` continuam servindo o
  mesmo site, e só o canonical aponta o Google para o `.gov.br`.
- **Onde o domínio aparece:** CORS das callables (`functions/index.js:101`);
  canonical, `og:url` e `@id` do JSON-LD da home; `urlBase` do editorial
  (`editorial/config.json`), que gera guia, sitemap e robots; denylist de
  produção dos testes de carga (`tests/load/`, `functions/producao-safety.test.js`);
  link do e-mail de avaliação (`docs/n8n/avaliacao-google.workflow.json`); e as
  travas de `functions/dominio-cin.test.js`. Fora do repositório: domínio no
  Hosting, chave reCAPTCHA do App Check e domínios autorizados do login.
- **LGPD:** a documentação inteira trata a Câmara como controladora, com base no
  art. 7º, III, e no art. 23 da LGPD (`docs/POLITICA-PRIVACIDADE.md`). A política
  ainda não foi publicada e o encarregado não foi designado
  (`docs/AUDITORIA-LGPD.md`, itens 3 e 4).
- **Guia do RG:** Next.js com exportação estática, projeto Firebase `guiadorg`
  (plano Spark), contas pessoais. O `docs/PUBLICACAO.md` de lá diz que nenhuma
  conta, projeto ou dado da Câmara entra no projeto, e o site se declara sem
  vínculo com órgãos governamentais (`src/lib/site.ts`). Os anúncios só carregam
  com `NEXT_PUBLIC_ADSENSE_ATIVO=true`; até lá, o script do AdSense vai no `head`
  de todas as páginas para a verificação do site (`src/app/layout.tsx`). O GA4
  carrega em todas.
- **Ligações que já existem:** os artigos do antigo blog foram para o guiadorg em
  12/10/2026 com autorização da Câmara, mas o campo do documento de autorização
  segue em branco (`docs/RETIRADA-BLOG-E-CONTADOR.md`). A home do agendamento tem
  três cards para artigos do guiadorg, exceção autorizada em 15/10/2026
  (`editorial/README.md:65`).

O plano mantém verdadeira a regra do `docs/PUBLICACAO.md` do guiadorg: o
agendamento continua no projeto e nas contas de hoje, e o guiadorg só empresta o
nome de domínio, que é um registro DNS no Registro.br.

## Como fica

```
itanhandu.guiadorg.com.br           → site novo de Hosting → mesmas functions e Firestore
cin.itanhandu.cam.mg.gov.br         ┐
agendamento-cin-itanhandu.web.app   ├ site padrão de hoje → 301 para itanhandu.guiadorg.com.br/<mesmo caminho>
agendamento-cin-itanhandu.firebaseapp.com ┘
guiadorg.com.br                     → projeto guiadorg, sem mudança
```

O DNS da Câmara continua apontando para o mesmo lugar. Muda o conteúdo do site
padrão, que deixa de servir páginas e passa a só redirecionar, e isso tira a
Câmara do caminho técnico da virada. O `web.app` e o `firebaseapp.com`
redirecionam junto, então as cópias que hoje dependem só do canonical deixam de
existir. Os caminhos reservados `/__/` do Firebase, como o link de confirmação de
e-mail do painel, continuam funcionando, porque o Hosting atende esses caminhos
antes de qualquer redirecionamento.

## Fase 0 — Câmara

Nenhuma outra fase vai ao ar sem esta. Pode correr junto com a Fase 1, que só
mexe em branch. Se a Câmara não autorizar, o plano para aqui, e o que sobra é um
link do guiadorg para o agendamento no `.gov.br`, que já resolve a divulgação.

O ofício ou termo precisa dizer:

1. que a Câmara autoriza o endereço `itanhandu.guiadorg.com.br` e o
   redirecionamento de `cin.itanhandu.cam.mg.gov.br`;
2. que o sistema é de sua autoria e está cedido à Câmara para uso gratuito. Se
   um dia houver pagamento da Câmara a você pelo sistema, entra a vedação ao
   servidor do próprio órgão (Lei 14.133/2021, art. 9º, §1º);
3. que a Câmara continua controladora dos dados, com a mesma finalidade e a
   mesma base legal, e qual é o seu papel no tratamento: servidor que mantém o
   sistema em nome da Câmara ou operador, conforme o jurídico enquadrar;
4. que o agendamento não exibe anúncio, não carrega rastreamento publicitário e
   não compartilha dado com o Guia do RG;
5. que a Câmara mantém o registro DNS de `cin.itanhandu.cam.mg.gov.br` apontando
   para o Firebase por pelo menos 12 meses. É ele que leva links antigos,
   cartazes e QR codes ao endereço novo;
6. como a Câmara volta ao `.gov.br` se quiser (ver "Voltar atrás") e quem faz
   isso se você não estiver disponível.

Junto com o ofício:

- **Política de privacidade publicada antes da virada**, com os campos
  `[[PREENCHER]]` de `docs/POLITICA-PRIVACIDADE.md` resolvidos, o encarregado
  designado e o endereço novo no texto. Sair do `.gov.br` sem política publicada,
  com o formulário de CPF num domínio pessoal, é a combinação mais difícil de
  defender.
- **Conta institucional da Câmara como Proprietária do projeto**
  `agendamento-cin-itanhandu`. Registre também quem é dono do projeto e da conta
  de faturamento hoje. Sem esse acesso, a Câmara depende de você para voltar
  atrás ou exportar os próprios dados.
- **Decisão sobre os três cards do guiadorg na home** (ver "Decisões em aberto").
- **Aprovação do texto do rodapé** (proposta em "Decisões em aberto"), que fala
  em nome da Câmara.
- **Número do documento** anotado neste arquivo e no campo em branco de
  `docs/RETIRADA-BLOG-E-CONTADOR.md`.
- **Divulgação pela Câmara** no dia da virada: site institucional, Instagram e
  perfil no Google. Um `.com.br` pedindo CPF para agendar RG tem o formato dos
  golpes com taxa, e a desconfiança só passa quando a própria Câmara anuncia o
  endereço.

## Fase 1 — código, em branch e sem deploy

No `agendamentorg`:

- `functions/index.js`: incluir `https://itanhandu.guiadorg.com.br` na lista
  `cors` de `callableOptions`, mantendo as atuais. Sem a origem, a página abre no
  endereço novo e agendar, consultar, cancelar e o painel falham no navegador.
- `functions/dominio-cin.test.js`: `NOVO` passa a ser o endereço novo, e um teste
  novo exige que o `.gov.br` e os endereços do Firebase continuem no CORS durante
  a transição.
- `editorial/config.json`: `urlBase` novo. Regerar com
  `npm --prefix editorial run construir` (guia, `sobre`, sitemap, robots) e
  conferir com `npm --prefix editorial run verificar`.
- `public/index.html`: canonical, `og:url` e os `@id` do JSON-LD. O
  `GovernmentService` continua com a Câmara como operadora e a Polícia Civil como
  prestadora, porque isso não muda.
- Aviso no rodapé de todas as páginas, com o texto aprovado na Fase 0.
- `tests/load/agenda-read.js`, `tests/load/booking-contention.js` e
  `functions/producao-safety.test.js`: a denylist de produção passa a bloquear o
  endereço novo, para nenhum k6 rodar contra a produção por ele.
- **Trava contra anúncio:** teste novo que falha se alguma página de `public/`
  citar `adsbygoogle`, `pagead2.googlesyndication.com` ou o ID do GA4 do guiadorg,
  ou se o `script-src` ou o `frame-src` do CSP em `firebase.json` liberar domínio
  de anúncio. O CSP de hoje já barra o script do AdSense; o teste segura isso.
- **Analytics isolado:** o GA4 grava o cookie `_ga` no domínio mais alto
  possível, que passa a ser `.guiadorg.com.br`. Sem ajuste, o Analytics do
  agendamento (`G-KWKF7NCJHK`) e o do blog, que vai ser ligado ao AdSense,
  dividiriam o mesmo identificador de visitante. Configurar `cookie_domain` com
  o subdomínio exato e um `cookie_prefix` próprio. Conferir se o SDK compat
  12.19.0 aceita a opção na chamada atual (`public/index.html:792`); se não
  aceitar, trocar por `initializeAnalytics` do SDK modular ou desligar o
  Analytics no agendamento.
- `legado/firebase.json` (novo): configuração do site padrão depois da virada,
  só com redirecionamentos e `"site": "agendamento-cin-itanhandu"`, e uma pasta
  pública que só tem o arquivo de verificação do Search Console. Primeiro as
  regras do blog, que levam direto ao artigo no guiadorg sem passar pelo endereço
  novo; depois a regra geral `^/(.*)$` → `https://itanhandu.guiadorg.com.br/:1`.
  A regra geral não pode engolir `google25bd37777c493d15.html`, senão a
  propriedade antiga do Search Console perde a verificação. No Hosting,
  redirecionamento vence arquivo, e o RE2 não tem lookahead: a exclusão sai por
  regex de prefixo ou por uma verificação DNS pedida à Câmara.
- `docs/n8n/avaliacao-google.workflow.json` e `docs/AVALIACAO-GOOGLE-N8N.md`:
  link do e-mail. O workflow precisa ser reimportado no n8n depois da virada.
- `README.md` e `editorial/README.md`: endereço de produção, deploy dos dois
  sites e a janela proibida (segunda, das 06:00 às 10:00).

O `firebase.json` só ganha `"site"` no dia da virada (Fase 4). Até lá, o deploy
continua indo para o site padrão.

No `guiadorg`:

- `src/lib/site.ts` (`avisoIndependencia`) e página Sobre: o portal segue sem
  vínculo institucional, mas o autor desenvolveu o agendamento da Câmara, servido
  sem anúncios em `itanhandu.guiadorg.com.br`. Dizer isso antes evita que alguém
  descubra sozinho e leia como ocultação.
- Política de privacidade do guiadorg: o subdomínio tem política própria, com a
  Câmara como controladora, e nenhum dado dele chega ao Analytics ou ao AdSense
  do portal.
- Link para o agendamento, se quiser (a página de MG em `/estados/` é o lugar
  natural), longe dos blocos de anúncio, como o `docs/MONETIZACAO-E-MEDICAO.md` de
  lá já exige para links de ação.

Rodar `npm --prefix functions test` e `npm --prefix editorial test`; no guiadorg,
`npm run verificar`. Regras e transações não mudam, então o emulador
(`tests/emulador/`) só entra se alguma mudança escapar desse escopo.

## Fase 2 — ensaio do redirecionamento

O fluxo do cidadão não dá para ensaiar na homologação, porque a chave reCAPTCHA
está amarrada ao domínio de produção (`docs/RUNBOOK-homologacao.md:143`). Dá para
ensaiar a parte de Hosting, que é a novidade:

- **No emulador**, com `--config legado/firebase.json`: `/`, `/painel`,
  `/cin/documentos/`, `/duvidas.html`, `/api/agenda-publica` e `/blog/<slug>/`
  respondem 301 para o destino certo, com caminho e query inteiros; o blog vai
  direto ao guiadorg; o arquivo de verificação responde 200.
- **No projeto `cin-itanhandu-homolog`**: criar um segundo site, publicar nele uma
  cópia do `legado/` com o ID desse site e conferir os 301 de verdade. Depois,
  treinar a volta (publicar a configuração completa de novo) e cronometrar.
- Confirmar que `firebase deploy --only hosting --config legado/firebase.json`
  publica no site indicado em `"site"`, e não no padrão do projeto.

## Fase 3 — endereço novo no ar, sem anunciar

1. Console do Firebase, projeto `agendamento-cin-itanhandu`, site padrão:
   Hosting → Adicionar domínio personalizado → `itanhandu.guiadorg.com.br`. Criar
   no Registro.br os registros que o console mostrar e esperar o certificado. O
   HSTS do guiadorg vale para subdomínios (`includeSubDomains`), então o
   navegador de quem já visitou o blog recusa o endereço até o HTTPS sair.
2. Chave reCAPTCHA do App Check e Authentication → domínios autorizados: incluir
   o endereço novo, como em 15/09.
3. Merge da Fase 1 na `main` e deploy das functions. A mudança no CORS é só
   aditiva. Fora da janela proibida e nunca entre ligar e desligar o
   pré-aquecimento.
4. Teste no endereço novo, com o seu CPF, num dia sem abertura: a agenda carrega,
   o App Check gera token, um agendamento é criado e cancelado, a consulta acha o
   agendamento, o painel faz login, lista o dia, grava uma observação e abre as
   janelas de impressão. Sem vaga livre, um encaixe manual pelo painel seguido de
   consulta e cancelamento pelo site cobre quase o mesmo caminho. Console do
   navegador sem erro de CSP ou CORS.
5. Deploy do hosting, com o canonical novo. Os dois endereços servem o site, e o
   Google começa a consolidar no novo. Se a propriedade de domínio
   `guiadorg.com.br` existir no Search Console (o `docs/PUBLICACAO.md` do guiadorg
   manda criar), ela já cobre o subdomínio; crie também a propriedade de prefixo
   `https://itanhandu.guiadorg.com.br/`, para os relatórios não se misturarem com
   os do blog, e envie o sitemap.
6. A recepção passa a abrir o painel pelo endereço novo por pelo menos uma
   semana, com uma abertura no meio. É o uso real do login e das callables
   administrativas antes de os cidadãos chegarem.

## Fase 4 — virada

Numa terça de manhã, depois de uma abertura sem incidente. Assim, uma semana
inteira de tráfego normal (consultas, cancelamentos, vagas que voltam, painel)
passa pelo endereço novo antes da próxima abertura, e a manhã fica livre porque o
atendimento é à tarde.

1. Criar o site novo:
   `firebase hosting:sites:create <id> --project agendamento-cin-itanhandu`
   (ex.: `cin-itanhandu-guiadorg`; o ID precisa estar livre no Firebase inteiro).
2. `firebase.json` ganha `"site": "<id>"`; deploy do hosting. O site aparece em
   `<id>.web.app`.
3. Mover o domínio: remover `itanhandu.guiadorg.com.br` do site padrão e
   adicionar no site novo, com os registros que o console pedir no Registro.br.
   Até o certificado sair, o endereço novo fica fora do ar, e ninguém depende
   dele ainda, porque o `.gov.br` segue servindo o site. Avise a recepção para
   usar o painel pelo endereço antigo nessa manhã.
4. Repetir no endereço novo o teste curto: agenda, consulta e login do painel.
5. Publicar o redirecionamento:
   `firebase deploy --only hosting --config legado/firebase.json --project agendamento-cin-itanhandu`.
   Daqui em diante, `.gov.br`, `web.app` e `firebaseapp.com` respondem 301.
6. Conferir de fora com `curl -I` na home, em `/painel`, em
   `/cin/documentos/` e num endereço antigo do blog, no `.gov.br`: 301 para o
   mesmo caminho no endereço novo (o blog, para o guiadorg).
7. Search Console: ferramenta Mudança de endereço da propriedade antiga para a
   nova, se ela aceitar o par de propriedades. Se não aceitar, os 301 bastam.
   Enviar o sitemap novo.
8. Pop-up de aviso pelo painel, por duas a quatro semanas: o endereço mudou, o
   antigo continua trazendo para cá, e o agendamento segue gratuito e da Câmara.
9. Atualizar o que a Câmara controla (site institucional, Instagram, perfil no
   Google), reimportar o workflow do n8n e trocar o endereço no projeto do
   OpenSEO e no fluxo web do Analytics.

### Voltar atrás

- **Antes do passo 5:** nada a desfazer, o `.gov.br` nunca deixou de servir o
  site.
- **Depois do passo 5:** `git revert` do commit da virada, que tira o `"site"` do
  `firebase.json`, e deploy do hosting. Em poucos minutos o `.gov.br` volta a
  servir o site. Para desistir da migração inteira, reverter também o canonical
  da Fase 1.
- **Pela Câmara, sem você:** com o acesso de Proprietária da Fase 0, o mesmo
  deploy. No limite, ela aponta `cin.itanhandu.cam.mg.gov.br` para outro lugar no
  DNS dela.

## Fase 5 — acompanhamento

- **Primeira abertura depois da virada:** alertas de 5xx e 429 do Cloud
  Monitoring, e Relatórios → Últimas aberturas comparando tentativas e agendados
  com as quatro semanas anteriores (`metricas_abertura`). Tentativas em queda
  forte com o sistema estável indicam gente que não chegou ao site: hora de
  reforçar a divulgação.
- **Search Console por oito semanas:** indexação do endereço novo, cliques e
  posição em "agendamento rg itanhandu" e nas páginas do guia. É a segunda troca
  de endereço em pouco mais de um mês, então espere oscilação nas primeiras
  semanas.
- **301 por pelo menos um ano**, que é o mínimo recomendado pelo Google numa
  mudança de site. O ideal é nunca tirar: cartaz e QR code impressos não
  expiram.
- O `.gov.br` fica no CORS durante esse ano. Depois, sai junto com o teste que o
  exige.

## O que o cidadão percebe

- Links, QR codes e favoritos antigos continuam funcionando, pelo 301.
- O protocolo guardado no aparelho (`CHAVE_ULTIMO_AGENDAMENTO`, em
  `localStorage`) fica no endereço antigo, porque o navegador separa o
  armazenamento por endereço. A consulta por CPF e data de nascimento continua
  achando o agendamento.
- Quem instalou o site como app (PWA) abre o endereço antigo e cai no navegador,
  já no endereço novo.
- Uma aba aberta antes da virada pode falhar na ação seguinte até ser
  recarregada.

## Relação com outros planos

- **WhatsApp** (`docs/PLANO-whatsapp-cloud-api.md`): o perfil leva um site, e os
  templates podem ter botão com URL. Defina o endereço antes de mandar templates
  para aprovação, porque mudar a URL de um template aprovado o manda de volta para
  revisão.
- **Política de privacidade** (`docs/POLITICA-PRIVACIDADE.md`): vira pré-requisito
  da virada.
- **Avaliação Google** (`docs/AVALIACAO-GOOGLE-N8N.md`): link do e-mail, nas
  Fases 1 e 4.

## Custo

Nenhum custo fixo novo. Domínio personalizado e segundo site de Hosting não são
cobrados à parte, o `guiadorg.com.br` já está registrado e não entra proxy pago.
A agenda continua no mesmo CDN e na mesma franquia, e o site de redirecionamento
só devolve cabeçalhos.

## Cronograma

| Quando | O quê |
|---|---|
| Semana 1 | Fase 0 com a Câmara; Fase 1 em branch, em paralelo |
| Logo depois | Fase 2, em um dia |
| Com a autorização assinada e a política publicada | Fase 3 |
| Terça depois de uma abertura sem incidente, com ao menos uma semana de Fase 3 | Fase 4 |
| Oito semanas depois da virada | Fim da Fase 5 |

A Fase 0 é o caminho crítico: depende da agenda da Câmara, não do código.

---

## Decisões em aberto

1. **Cards do guiadorg na home:** o plano recomenda tirar quando os anúncios do
   guiadorg forem ligados. Com o agendamento sob a marca Guia do RG e o blog com
   anúncio, os cards viram o caminho do serviço público até as páginas que dão
   receita, e é isso que a Câmara e o controle interno vão olhar primeiro.
   Mantê-los exige o aval renovado no ofício.
2. **Analytics no agendamento:** isolar o cookie (recomendado) ou desligar.
3. **Projeto e faturamento:** quem é dono hoje, e se a Câmara entra como
   Proprietária (recomendado).
4. **Texto do rodapé.** Proposta, sujeita à aprovação da Câmara:

   > Agendamento gratuito do atendimento da Carteira de Identidade Nacional na
   > Câmara Municipal de Itanhandu. A emissão é feita pela Polícia Civil de Minas
   > Gerais. Sistema desenvolvido por Guilherme Ribeiro e cedido à Câmara, que é
   > a responsável pelos dados (veja a Política de Privacidade). Este endereço
   > fica no domínio do Guia do RG e não exibe anúncios.

## Autorização

- Documento: _______________________
- Data: _______________________
