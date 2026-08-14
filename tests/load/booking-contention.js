import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const FUNCTION_URL = String(__ENV.FUNCTION_URL || "");
const PROJECT_NUMBER = String(__ENV.PROJECT_NUMBER || "");
const APP_ID = String(__ENV.APP_ID || "");
const API_KEY = String(__ENV.API_KEY || "");
const DEBUG_TOKEN = String(__ENV.APP_CHECK_DEBUG_TOKEN || "");
const TEST_DATE = String(__ENV.TEST_DATE || "");
const TEST_TIME = String(__ENV.TEST_TIME || "");
const VUS = Number(__ENV.VUS || 50);

export function bloquearAlvoProducao(url, nomeVariavel) {
  const alvo = String(url || "").toLowerCase();
  if (alvo.includes("agendamento-cin-itanhandu")) {
    throw new Error(`${nomeVariavel || "URL"} aponta para producao e foi bloqueada pela denylist fixa.`);
  }
}

bloquearAlvoProducao(FUNCTION_URL, "FUNCTION_URL");

if (!__ENV.CONFIRM_HOMOLOGATION || __ENV.CONFIRM_HOMOLOGATION !== "SIM") {
  throw new Error("Defina CONFIRM_HOMOLOGATION=SIM depois de confirmar que FUNCTION_URL nao e producao.");
}
if (!FUNCTION_URL || !PROJECT_NUMBER || !APP_ID || !API_KEY || !DEBUG_TOKEN || !/^\d{4}-\d{2}-\d{2}$/.test(TEST_DATE) || !/^\d{2}:\d{2}$/.test(TEST_TIME)) {
  throw new Error("Informe FUNCTION_URL, PROJECT_NUMBER, APP_ID, API_KEY, APP_CHECK_DEBUG_TOKEN, TEST_DATE e TEST_TIME.");
}

const sucessos = new Counter("agendamentos_criados");
const conflitos = new Counter("conflitos_de_vaga");
const inesperados = new Counter("resultados_inesperados");

export const options = {
  scenarios: {
    disputa_mesma_vaga: {
      executor: "per-vu-iterations",
      vus: VUS,
      iterations: 1,
      maxDuration: "2m"
    }
  },
  thresholds: {
    agendamentos_criados: ["count==1"],
    resultados_inesperados: ["count==0"],
    http_req_duration: ["p(95)<5000"]
  }
};

function cpfValido(semente) {
  const base = String(100000000 + (semente % 899999999)).padStart(9, "0").slice(-9);
  const digito = (texto, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < texto.length; i++) soma += Number(texto[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(base, 10);
  const d2 = digito(`${base}${d1}`, 11);
  return `${base}${d1}${d2}`;
}

export function setup() {
  const appResource = `projects/${PROJECT_NUMBER}/apps/${APP_ID}`;
  const url = `https://firebaseappcheck.googleapis.com/v1/${appResource}:exchangeDebugToken?key=${API_KEY}`;
  const resposta = http.post(url, JSON.stringify({ debugToken: DEBUG_TOKEN, limitedUse: false }), {
    headers: { "Content-Type": "application/json" }
  });
  if (resposta.status !== 200 || !resposta.json("token")) {
    throw new Error(`Falha ao trocar o debug token do App Check: HTTP ${resposta.status}.`);
  }
  return { appCheckToken: resposta.json("token") };
}

export default function (dados) {
  const identificador = (__VU * 100000) + __ITER;
  const cpf = cpfValido(identificador);
  const corpo = JSON.stringify({
    data: {
      nome: `Cidadao Teste Carga ${identificador}`,
      cpf,
      telefone: "(35) 99999-9999",
      email: `carga${identificador}@example.test`,
      nascimento: "1990-01-01",
      data: TEST_DATE,
      hora: TEST_TIME,
      substituirAnterior: false,
      operationId: identificador.toString(16).padStart(32, "0").slice(-32)
    }
  });
  const resposta = http.post(FUNCTION_URL, corpo, {
    headers: {
      "Content-Type": "application/json",
      "X-Firebase-AppCheck": dados.appCheckToken
    },
    tags: { fluxo: "disputa_mesma_vaga" }
  });

  let payload = {};
  try { payload = resposta.json(); } catch (_) {}
  const criou = resposta.status === 200 && payload && payload.result && payload.result.agendamento;
  const statusErro = payload && payload.error && String(payload.error.status || "");
  const conflito = statusErro === "ALREADY_EXISTS" || resposta.status === 409;
  if (criou) sucessos.add(1);
  else if (conflito) conflitos.add(1);
  else inesperados.add(1);

  check(resposta, {
    "resultado foi criacao ou conflito esperado": () => Boolean(criou || conflito)
  });
}
