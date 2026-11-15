// Gera whatsapp/n8n/cin-whatsapp-limpeza.json: apaga, de hora em hora, o que
// as tabelas do WhatsApp da CIN guardam com telefone, mesmo quando a pessoa
// não volta a escrever.
// - cin_cidinho_falas: falas do Cidinho com mais de 24 h (coluna quando, data).
//   (Até 15/11/2026 era cin_cidinho_conversa, sem a coluna msgid.)
// - cin_whatsapp_respondidos: marcas da resposta padrão com mais de 2 dias
//   (coluna em, texto ISO; a marca só serve para "uma resposta por dia").
// cin_whatsapp_saida NÃO é limpa: é o pedido de SAIR e tem de durar.
//
// Uso: node whatsapp/n8n/montar-limpeza.mjs
// Também roda na hora por POST http://127.0.0.1:5678/webhook/cin-limpeza (só 127.0.0.1).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
let n = 0;
const uid = () => `c3000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const nos = [];
const no = (nome, tipo, versao, posicao, parametros, extra = {}) => {
  nos.push({ id: uid(), name: nome, type: tipo, typeVersion: versao, position: posicao, parameters: parametros, ...extra });
};
const tabela = (nome) => ({ __rl: true, mode: 'name', value: nome });

no('De hora em hora', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 100], {
  rule: { interval: [{ field: 'hours', hoursInterval: 1, triggerAtMinute: 17 }] },
}, { notes: 'Minuto 17: longe das rodadas de envio (:00, :05, :10…).', notesInFlow: true });
no('Rodar agora', 'n8n-nodes-base.webhook', 2, [0, 300], {
  httpMethod: 'POST',
  path: 'cin-limpeza',
  responseMode: 'lastNode',
  options: { ipWhitelist: '127.0.0.1,::1,::ffff:127.0.0.1' },
}, { webhookId: 'c3a1e2d4-6b7f-4c21-9a3e-7d2b8e4f1d03' });
no('Apagar conversas do Cidinho', 'n8n-nodes-base.dataTable', 1.1, [240, 200], {
  resource: 'row', operation: 'deleteRows', dataTableId: tabela('cin_cidinho_falas'),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'quando', condition: 'lt', keyValue: '={{ new Date(Date.now() - 24 * 3600 * 1000).toISOString() }}' }] },
  options: {},
}, { executeOnce: true, alwaysOutputData: true });
no('Apagar respondidos antigos', 'n8n-nodes-base.dataTable', 1.1, [480, 200], {
  resource: 'row', operation: 'deleteRows', dataTableId: tabela('cin_whatsapp_respondidos'),
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'em', condition: 'lt', keyValue: '={{ new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() }}' }] },
  options: {},
}, { executeOnce: true, alwaysOutputData: true });
// Resposta do "Rodar agora": só contagens, sem telefone nem texto.
no('Resumo', 'n8n-nodes-base.code', 2, [720, 200], {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Why Code: devolve só quantas linhas cada passo apagou.
const conta = (nome) => $(nome).all().filter((i) => i.json && Object.keys(i.json).length).length;
return [{ json: { conversas: conta('Apagar conversas do Cidinho'), respondidos: conta('Apagar respondidos antigos'), em: new Date().toISOString() } }];`,
});

const ligacoes = [
  ['De hora em hora', 'Apagar conversas do Cidinho'],
  ['Rodar agora', 'Apagar conversas do Cidinho'],
  ['Apagar conversas do Cidinho', 'Apagar respondidos antigos'],
  ['Apagar respondidos antigos', 'Resumo'],
];
const connections = {};
for (const [de, para] of ligacoes) {
  connections[de] ??= { main: [[]] };
  connections[de].main[0].push({ node: para, type: 'main', index: 0 });
}
const fluxo = {
  id: 'CinWhatsLimpeza1',
  name: 'CIN — limpeza das tabelas do WhatsApp (24 h e 2 dias)',
  active: false,
  nodes: nos,
  connections,
  // Sucesso não fica guardado: a saída dos passos de apagar traz telefone e texto.
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' },
  pinData: {},
  tags: [],
};
writeFileSync(join(aqui, 'cin-whatsapp-limpeza.json'), `${JSON.stringify(fluxo, null, 2)}\n`);
console.log(`cin-whatsapp-limpeza.json: ${nos.length} nós`);
