// Painel da recepcao rodando 100% local, com dados ficticios.
//
// Sobe os emuladores (Auth, Firestore, Functions) num projeto demo-, semeia
// um dia de atendimento inventado e serve public/ em http://localhost:5050.
// Abra http://localhost:5050/painel?emulador e entre com a conta de teste
// abaixo. Nada aqui toca a nuvem: o projeto demo- nao existe no Google, e o
// painel so usa os emuladores com ?emulador em localhost (ver recepcao.js).
//
// Uso (na raiz do projeto, com Java 11+ no PATH e functions/node_modules):
//   node scripts/painel-local.js
//
// O servidor estatico nao aplica a CSP do firebase.json de proposito: ela
// bloquearia as conexoes com os emuladores em 127.0.0.1. A CSP de producao e
// verificada pelos testes (functions/csp-painel.test.js).

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const RAIZ = path.resolve(__dirname, "..");
const PUBLICO = path.join(RAIZ, "public");
const PORTA = Number(process.env.PORTA_PAINEL || 5050);
const PROJETO = "demo-agendamento-cin";

// Conta de teste do emulador (so existe no Auth emulado).
const CONTA_TESTE = { email: "recepcao@teste.local", senha: "painel-local-2026", nome: "Recepção Teste" };

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml"
};

function servir() {
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    // Mesmo rewrite do firebase.json: o site publico le a agenda por
    // /api/agenda-publica, que aqui vai para o emulador de Functions.
    if (url.pathname === "/api/agenda-publica") {
      const destino = `http://127.0.0.1:5001/${PROJETO}/southamerica-east1/carregarAgendaPublicaHttp${url.search}`;
      const repasse = http.request(destino, { method: req.method, headers: { accept: req.headers.accept || "*/*" } }, resposta => {
        res.writeHead(resposta.statusCode, resposta.headers);
        resposta.pipe(res);
      });
      repasse.on("error", () => res.writeHead(502).end());
      req.pipe(repasse);
      return;
    }
    let caminho = decodeURIComponent(url.pathname);
    if (caminho === "/painel") caminho = "/recepcao.html";
    if (caminho.endsWith("/")) caminho += "index.html";
    const arquivo = path.normalize(path.join(PUBLICO, caminho));
    if (!arquivo.startsWith(PUBLICO)) { res.writeHead(403).end(); return; }
    fs.readFile(arquivo, (erro, conteudo) => {
      if (erro) { res.writeHead(404, { "Content-Type": "text/plain" }).end("404"); return; }
      res.writeHead(200, { "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(conteudo);
    });
  });
  servidor.listen(PORTA, () => {
    console.log(`\nPainel local: http://localhost:${PORTA}/painel?emulador`);
    console.log(`Site publico local: http://localhost:${PORTA}/?emulador`);
  });
}

function esperarPorta(porta, limiteMs = 120000) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const tentar = () => {
      const s = net.connect(porta, "127.0.0.1");
      s.once("connect", () => { s.end(); resolve(); });
      s.once("error", () => {
        s.destroy();
        if (Date.now() - inicio > limiteMs) reject(new Error(`Porta ${porta} nao respondeu.`));
        else setTimeout(tentar, 1000);
      });
    };
    tentar();
  });
}

function hojeSaoPaulo(deslocamentoDias = 0) {
  const d = new Date(Date.now() + deslocamentoDias * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

function minutosAgoraSaoPaulo() {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date()).split(":").map(Number);
  return h * 60 + m;
}

const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function cpfValido(semente) {
  const base = String(100000000 + semente * 7919).slice(-9).split("").map(Number);
  const dig = (nums, peso) => { const r = 11 - (nums.reduce((t, n, i) => t + n * (peso - i), 0) % 11); return r >= 10 ? 0 : r; };
  const d1 = dig(base, 10);
  const d2 = dig([...base, d1], 11);
  const c = [...base, d1, d2].join("");
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}

// Nomes inventados: nenhum dado real.
const NOMES = [
  "Ana Paula Ficticia", "Bruno Exemplo Souza", "Carla Demonstracao Lima", "Diego Teste Ferreira",
  "Eduarda Modelo Rocha", "Fabio Simulado Alves", "Gabriela Prova Nunes", "Heitor Amostra Dias",
  "Isabela Ensaio Moreira", "Joao Fantasia Castro", "Karen Rascunho Pires", "Lucas Esboco Ramos",
  "Marina Teste Campos", "Nicolas Exemplo Melo", "Olivia Ficticia Barros", "Paulo Demonstracao Cruz"
];

async function semear() {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  const modulos = path.join(RAIZ, "functions", "node_modules");
  const { initializeApp } = require(path.join(modulos, "firebase-admin", "lib", "app"));
  const { getAuth } = require(path.join(modulos, "firebase-admin", "lib", "auth"));
  const { getFirestore } = require(path.join(modulos, "firebase-admin", "lib", "firestore"));
  initializeApp({ projectId: PROJETO });
  const auth = getAuth();
  const db = getFirestore();

  try { await auth.deleteUser((await auth.getUserByEmail(CONTA_TESTE.email)).uid); } catch (_) {}
  await auth.createUser({ email: CONTA_TESTE.email, password: CONTA_TESTE.senha, emailVerified: true, displayName: CONTA_TESTE.nome });
  await db.collection("admins").doc(CONTA_TESTE.email).set({ ativo: true });

  const hoje = hojeSaoPaulo();
  const dias = [0, 1, 2, 3].map(hojeSaoPaulo);
  const agora = minutosAgoraSaoPaulo();
  // Grade de hoje em volta da hora atual, para existir "proximo atendimento".
  const inicio = Math.max(8 * 60, Math.floor((agora - 120) / 15) * 15);
  const horasHoje = Array.from({ length: 10 }, (_, i) => hhmm(Math.min(inicio + i * 25, 23 * 60 + 30)));
  const horasOutros = ["14:30", "14:55", "15:20", "15:45", "16:10", "16:35"];
  await db.collection("configuracoes").doc("agenda").set({
    dias,
    gradesAtendimento: [
      { inicio: hojeSaoPaulo(-30), horarios: horasOutros.map((hora) => ({ hora, vagas: 1 })), porDiaSemana: {} },
      { inicio: hoje, horarios: horasHoje.map((hora) => ({ hora, vagas: 1 })), porDiaSemana: {} },
      { inicio: dias[1], horarios: horasOutros.map((hora) => ({ hora, vagas: 1 })), porDiaSemana: {} }
    ],
    automacaoSemanal: { ativa: true, horaAbertura: "08:00", diasSemana: [2, 3, 4, 5], semanasPausadas: [], datasBloqueadas: [], periodosBloqueados: [] },
    dataNovasVagas: "02/11/2026",
    responsavelPosto: "Responsável Teste",
    atualizado: new Date().toISOString()
  });

  const status = ["compareceu", "compareceu", "nao_compareceu", "vai_voltar", "agendado", "agendado", "agendado", "agendado", "cancelado", "agendado"];
  let n = 0;
  const lote = db.batch();
  const criar = (dataISO, hora, st, extra = {}) => {
    const id = `demo${String(++n).padStart(3, "0")}`;
    const dados = {
      nome: NOMES[(n - 1) % NOMES.length], cpf: cpfValido(n), telefone: `(35) 9${String(8000 + n).padStart(4, "0")}-${String(1000 + n * 37).slice(-4)}`,
      email: n % 3 === 0 ? `pessoa${n}@exemplo.test` : "", dataNasc: `19${60 + (n % 40)}-0${1 + (n % 9)}-1${n % 9}`,
      dataISO, hora, slotId: `${dataISO}_${hora}`, protocolo: `CIN-DEMO${String(n).padStart(4, "0")}`, status: st,
      criado: new Date(Date.now() - n * 3600000).toISOString(), statusAtualizadoEm: new Date().toISOString(), ...extra
    };
    if (st === "cancelado") dados.ativo = false;
    if (st === "nao_compareceu") Object.assign(dados, { bloqueioAtivo: true, bloqueioCpf: dados.cpf.replace(/\D/g, ""), bloqueadoAte: hojeSaoPaulo(182), bloqueioMotivo: "Não comparecimento", bloqueioDataFalta: `${dataISO.split("-").reverse().join("/")} ${hora}` });
    lote.set(db.collection("dados_cidadaos").doc(id), dados);
    if (st !== "cancelado") lote.set(db.collection("vagas_ocupadas").doc(dados.slotId), { dataISO, hora, agendamentoId: id, contabilizaVaga: true, origem: "publico" });
  };
  horasHoje.forEach((hora, i) => criar(hoje, hora, status[i], i === 5 ? { observacaoInterna: "Trazer certidão de casamento atualizada." } : {}));
  criar(hoje, hhmm(Math.min(inicio + 60, 23 * 60)), "agendado", { insercaoManual: true, slotId: "manual_x" });
  horasOutros.slice(0, 4).forEach((hora) => criar(dias[1], hora, "agendado"));
  horasOutros.slice(0, 2).forEach((hora) => criar(dias[2], hora, "agendado"));
  await lote.commit();
  console.log(`Semeado: ${n} agendamentos ficticios (${hoje} e proximos dias) e a conta de teste.`);
}

// No Windows, o JDK instalado pelo winget pode ainda nao estar no PATH do
// processo atual.
function javaNoPath() {
  if (process.platform !== "win32") return process.env.PATH;
  const base = "C:\\Program Files\\Microsoft";
  try {
    const jdk = fs.readdirSync(base).filter((d) => /^jdk-/.test(d)).sort().pop();
    if (jdk) return `${path.join(base, jdk, "bin")};${process.env.PATH}`;
  } catch (_) {}
  return process.env.PATH;
}

// O emulador de Functions pergunta os parametros (defineBoolean etc.) que
// nao achar em .env; sem terminal, ele trava. functions/.env.local so e lido
// pelo emulador (e esta no .gitignore): convite de avaliacao desligado.
function garantirEnvLocalDoEmulador() {
  const cabecalho = "# Criado por scripts/painel-local.js; so o emulador le este arquivo.\n";
  const env = path.join(RAIZ, "functions", ".env.local");
  const atual = fs.existsSync(env) ? fs.readFileSync(env, "utf8") : cabecalho;
  const faltando = ["AVALIACAO_GOOGLE_ATIVA=false", "AVALIACAO_GOOGLE_URL=https://example.test/avaliacao"]
    .filter((linha) => !atual.includes(linha.split("=")[0] + "="));
  if (faltando.length) fs.writeFileSync(env, atual.replace(/\n?$/, "\n") + faltando.join("\n") + "\n");
  // Segredos ficticios: o emulador nao vai ao Secret Manager com eles.
  const segredos = path.join(RAIZ, "functions", ".secret.local");
  if (!fs.existsSync(segredos)) {
    const ficticio = "valor-ficticio-do-emulador-com-mais-de-32-caracteres";
    fs.writeFileSync(segredos, `${cabecalho}AVALIACAO_N8N_WEBHOOK_URL=https://example.test/webhook\nAVALIACAO_N8N_TOKEN=${ficticio}\nAVALIACAO_DESTINATARIO_CHAVE=${ficticio}\n`);
  }
}

async function principal() {
  process.env.PATH = javaNoPath();
  garantirEnvLocalDoEmulador();
  const emuladores = spawn(`firebase emulators:start --only auth,firestore,functions --project ${PROJETO}`, {
    cwd: RAIZ, shell: true, stdio: ["ignore", "inherit", "inherit"]
  });
  const encerrar = () => { emuladores.kill(); process.exit(0); };
  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);
  await Promise.all([esperarPorta(9099), esperarPorta(8080), esperarPorta(5001)]);
  await semear();
  servir();
  console.log(`Conta de teste: ver CONTA_TESTE em scripts/painel-local.js`);
}

principal().catch((erro) => { console.error(erro); process.exit(1); });
