import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = String(__ENV.BASE_URL || "").replace(/\/$/, "");
const MAX_VUS = Number(__ENV.MAX_VUS || 300);

export function bloquearAlvoProducao(url, nomeVariavel) {
  const alvo = String(url || "").toLowerCase();
  if (alvo.includes("agendamento-cin-itanhandu")) {
    throw new Error(`${nomeVariavel || "URL"} aponta para producao e foi bloqueada pela denylist fixa.`);
  }
}

bloquearAlvoProducao(BASE_URL, "BASE_URL");

const CONFIRMADO = __ENV.CONFIRM_HOMOLOGATION === "SIM";

if (!BASE_URL) throw new Error("Informe BASE_URL do ambiente de homologacao.");
if (!/localhost|127\.0\.0\.1|homolog|staging|teste/i.test(BASE_URL) && !CONFIRMADO) {
  throw new Error("Alvo nao identificado como homologacao. Use CONFIRM_HOMOLOGATION=SIM somente apos conferir a URL.");
}

export const options = {
  scenarios: {
    leitura_agenda: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Math.min(50, MAX_VUS) },
        { duration: "1m", target: MAX_VUS },
        { duration: "2m", target: MAX_VUS },
        { duration: "30s", target: 0 }
      ],
      gracefulRampDown: "15s"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000", "p(99)<2500"],
    checks: ["rate>0.99"]
  }
};

export default function () {
  // A chave e compartilhada por toda a execucao para medir o ganho do CDN.
  const resposta = http.get(`${BASE_URL}/api/agenda-publica?teste-carga=${__ENV.RUN_ID || "homologacao"}`, {
    headers: {
      // Evita que o ensaio local trate todos os VUs como um unico navegador no
      // rate limit (todos compartilham o mesmo IP de loopback).
      "User-Agent": `k6-agendamento-vu-${__VU}`
    },
    tags: { fluxo: "agenda_publica" }
  });
  check(resposta, {
    "agenda respondeu 200": (r) => r.status === 200,
    "resposta possui dias": (r) => {
      try { return Array.isArray(r.json("dias")); } catch (_) { return false; }
    }
  });
  sleep(1);
}
