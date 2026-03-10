const http = require('https');
const BASE_URL = 'https://n8n-dev.noyecode.com';
const BJQ_ID = 'eW5SRNY5r4zfRjIqTw9eP';

function request(method, path, body, cookies) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = { method, hostname: url.hostname, path: url.pathname + url.search, headers: { 'Accept': 'application/json', 'User-Agent': 'n8n-fix/1.0', 'browser-id': 'fix-bjq' } };
    if (body) { const d = JSON.stringify(body); options.headers['Content-Type'] = 'application/json'; options.headers['Content-Length'] = Buffer.byteLength(d); }
    if (cookies) options.headers['Cookie'] = cookies;
    const req = http.request(options, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d })); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  const loginRes = await request('POST', '/rest/login', { emailOrLdapLoginId: 'andersonbarbosadev@outlook.com', password: 't5x]oIs{7=ISZ}sS' });
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  console.log('Login OK');

  // Get current workflow
  const getRes = await request('GET', `/rest/workflows/${BJQ_ID}`, null, cookies);
  const currentWf = JSON.parse(getRes.body).data;
  console.log('Current nodes:', currentWf.nodes.map(n => n.name).join(', '));

  // Build new workflow: Set nodes (no Code) following the working pattern
  const newNodes = [
    // === SCHEDULE TRIGGERS (unchanged) ===
    {
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 7 * * *" }] } },
      id: "cab2af20-1763-4b80-a242-28b0607bf001",
      name: "Trigger 7AM - Noticias Dev",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, -256],
    },
    {
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 12 * * *" }] } },
      id: "9779972c-35bd-4383-ab6a-203a532809ad",
      name: "Trigger 12PM - Presentacion",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
    },
    {
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 16 * * *" }] } },
      id: "2aede1a7-b31b-4eb0-ac48-aeed142d2216",
      name: "Trigger 4PM - Servicios",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 256],
    },

    // === SET NODES per trigger (like "Borrador - Noticias Dev" pattern) ===
    {
      parameters: {
        assignments: { assignments: [
          { id: "slot-7am", name: "slot", value: "7am", type: "string" },
          { id: "campaign-7am", name: "campaign", value: "noticias_dev", type: "string" },
          { id: "action-7am", name: "action", value: "run_full_cycle", type: "string" },
          { id: "source-7am", name: "source", value: "schedule", type: "string" },
          { id: "trigger-7am", name: "trigger_name", value: "Trigger 7AM - Noticias Dev", type: "string" },
        ] },
        options: {},
      },
      id: "a1000001-0000-4000-8000-000000000001",
      name: "Job 7AM - Noticias Dev",
      type: "n8n-nodes-base.set",
      typeVersion: 3.4,
      position: [256, -256],
    },
    {
      parameters: {
        assignments: { assignments: [
          { id: "slot-12pm", name: "slot", value: "12pm", type: "string" },
          { id: "campaign-12pm", name: "campaign", value: "presentacion", type: "string" },
          { id: "action-12pm", name: "action", value: "run_full_cycle", type: "string" },
          { id: "source-12pm", name: "source", value: "schedule", type: "string" },
          { id: "trigger-12pm", name: "trigger_name", value: "Trigger 12PM - Presentacion", type: "string" },
        ] },
        options: {},
      },
      id: "a1000001-0000-4000-8000-000000000002",
      name: "Job 12PM - Presentacion",
      type: "n8n-nodes-base.set",
      typeVersion: 3.4,
      position: [256, 0],
    },
    {
      parameters: {
        assignments: { assignments: [
          { id: "slot-4pm", name: "slot", value: "4pm", type: "string" },
          { id: "campaign-4pm", name: "campaign", value: "servicios", type: "string" },
          { id: "action-4pm", name: "action", value: "run_full_cycle", type: "string" },
          { id: "source-4pm", name: "source", value: "schedule", type: "string" },
          { id: "trigger-4pm", name: "trigger_name", value: "Trigger 4PM - Servicios", type: "string" },
        ] },
        options: {},
      },
      id: "a1000001-0000-4000-8000-000000000003",
      name: "Job 4PM - Servicios",
      type: "n8n-nodes-base.set",
      typeVersion: 3.4,
      position: [256, 256],
    },

    // === MERGE: Prepare Job (like "Preparar Borrador") ===
    {
      parameters: {
        assignments: { assignments: [
          { id: "prep-jobid", name: "job_id", value: "=job_{{ $now.format('yyyyMMdd_HHmmss') }}_{{ Math.random().toString(36).slice(2, 8) }}", type: "string" },
          { id: "prep-action", name: "action", value: "={{ $json.action }}", type: "string" },
          { id: "prep-source", name: "source", value: "={{ $json.source }}", type: "string" },
          { id: "prep-payload", name: "payload_json", value: "={{ JSON.stringify({ trigger_name: $json.trigger_name, trigger_slot: $json.slot, campaign: $json.campaign }) }}", type: "string" },
          { id: "prep-status", name: "status", value: "pending", type: "string" },
          { id: "prep-created", name: "created_at", value: "={{ $now.toISO() }}", type: "string" },
          { id: "prep-updated", name: "updated_at", value: "={{ $now.toISO() }}", type: "string" },
          { id: "prep-worker", name: "worker_id", value: "", type: "string" },
          { id: "prep-attempts", name: "attempts", value: "0", type: "string" },
          { id: "prep-lease", name: "lease_expires_at", value: "", type: "string" },
          { id: "prep-result", name: "result_json", value: "", type: "string" },
          { id: "prep-error", name: "error_text", value: "", type: "string" },
        ] },
        options: {},
      },
      id: "a1000001-0000-4000-8000-000000000010",
      name: "Preparar Job",
      type: "n8n-nodes-base.set",
      typeVersion: 3.4,
      position: [512, 0],
    },

    // === HTTP Request: Login to n8n ===
    {
      parameters: {
        method: "POST",
        url: "https://n8n-dev.noyecode.com/rest/login",
        authentication: "none",
        sendBody: true,
        contentType: "json",
        specifyBody: "json",
        jsonBody: JSON.stringify({
          emailOrLdapLoginId: "andersonbarbosadev@outlook.com",
          password: "t5x]oIs{7=ISZ}sS",
        }),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "browser-id", value: "bot-job-enqueue" },
          ],
        },
        options: {
          response: { response: { fullResponse: true } },
        },
      },
      id: "a1000001-0000-4000-8000-000000000020",
      name: "Login n8n",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.3,
      position: [768, 0],
    },

    // === HTTP Request: Insert row into Data Table ===
    {
      parameters: {
        method: "POST",
        url: "https://n8n-dev.noyecode.com/rest/projects/bkrM241Q8UeW2zme/data-tables/LFM69EeeF7pa8yiO/insert",
        authentication: "none",
        sendBody: true,
        contentType: "json",
        specifyBody: "json",
        jsonBody: `={{ JSON.stringify({ returnType: "all", data: [{ job_id: $('Preparar Job').item.json.job_id, action: $('Preparar Job').item.json.action, payload_json: $('Preparar Job').item.json.payload_json, source: $('Preparar Job').item.json.source, status: $('Preparar Job').item.json.status, created_at: $('Preparar Job').item.json.created_at, updated_at: $('Preparar Job').item.json.updated_at, worker_id: "", attempts: 0, lease_expires_at: "", result_json: "", error_text: "" }] }) }}`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "browser-id", value: "bot-job-enqueue" },
            { name: "Cookie", value: "={{ $json.headers['set-cookie'] ? $json.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '' }}" },
          ],
        },
        options: {},
      },
      id: "a1000001-0000-4000-8000-000000000030",
      name: "Insertar Job en DataTable",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.3,
      position: [1024, 0],
    },

    // === WEBHOOK: Enqueue Job (keep existing) ===
    {
      parameters: {
        httpMethod: "POST",
        path: "bot-job-enqueue",
        responseMode: "lastNode",
        options: {},
      },
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 512],
      id: "8c5e6d62-cf2d-4c65-9db1-8a90d9a50001",
      name: "Enqueue Job Webhook",
      webhookId: "bot-job-enqueue-webhook",
    },

    // === SET: Prepare Webhook Job ===
    {
      parameters: {
        assignments: { assignments: [
          { id: "wh-jobid", name: "job_id", value: "=job_{{ $now.format('yyyyMMdd_HHmmss') }}_{{ Math.random().toString(36).slice(2, 8) }}", type: "string" },
          { id: "wh-action", name: "action", value: "={{ $json.body.action || 'run_full_cycle' }}", type: "string" },
          { id: "wh-source", name: "source", value: "={{ $json.body.source || 'telegram' }}", type: "string" },
          { id: "wh-payload", name: "payload_json", value: "={{ JSON.stringify($json.body.payload || {}) }}", type: "string" },
          { id: "wh-status", name: "status", value: "pending", type: "string" },
          { id: "wh-created", name: "created_at", value: "={{ $now.toISO() }}", type: "string" },
          { id: "wh-updated", name: "updated_at", value: "={{ $now.toISO() }}", type: "string" },
        ] },
        options: {},
      },
      id: "a1000001-0000-4000-8000-000000000040",
      name: "Preparar Webhook Job",
      type: "n8n-nodes-base.set",
      typeVersion: 3.4,
      position: [256, 512],
    },

    // === HTTP Request: Login for webhook path ===
    {
      parameters: {
        method: "POST",
        url: "https://n8n-dev.noyecode.com/rest/login",
        authentication: "none",
        sendBody: true,
        contentType: "json",
        specifyBody: "json",
        jsonBody: JSON.stringify({
          emailOrLdapLoginId: "andersonbarbosadev@outlook.com",
          password: "t5x]oIs{7=ISZ}sS",
        }),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "browser-id", value: "bot-job-enqueue" },
          ],
        },
        options: {
          response: { response: { fullResponse: true } },
        },
      },
      id: "a1000001-0000-4000-8000-000000000050",
      name: "Login n8n Webhook",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.3,
      position: [512, 512],
    },

    // === HTTP Request: Insert webhook job ===
    {
      parameters: {
        method: "POST",
        url: "https://n8n-dev.noyecode.com/rest/projects/bkrM241Q8UeW2zme/data-tables/LFM69EeeF7pa8yiO/insert",
        authentication: "none",
        sendBody: true,
        contentType: "json",
        specifyBody: "json",
        jsonBody: `={{ JSON.stringify({ returnType: "all", data: [{ job_id: $('Preparar Webhook Job').item.json.job_id, action: $('Preparar Webhook Job').item.json.action, payload_json: $('Preparar Webhook Job').item.json.payload_json, source: $('Preparar Webhook Job').item.json.source, status: "pending", created_at: $('Preparar Webhook Job').item.json.created_at, updated_at: $('Preparar Webhook Job').item.json.updated_at, worker_id: "", attempts: 0, lease_expires_at: "", result_json: "", error_text: "" }] }) }}`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "browser-id", value: "bot-job-enqueue" },
            { name: "Cookie", value: "={{ $json.headers['set-cookie'] ? $json.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '' }}" },
          ],
        },
        options: {},
      },
      id: "a1000001-0000-4000-8000-000000000060",
      name: "Insertar Webhook Job en DataTable",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.3,
      position: [768, 512],
    },

    // === Webhook: Next Job (keep for poller compatibility) ===
    {
      parameters: { httpMethod: "POST", path: "bot-job-next", responseMode: "lastNode", options: {} },
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 768],
      id: "8c5e6d62-cf2d-4c65-9db1-8a90d9a50004",
      name: "Next Job Webhook",
      webhookId: "bot-job-next-webhook",
    },

    // === Webhook: Update Job (keep for poller compatibility) ===
    {
      parameters: { httpMethod: "POST", path: "bot-job-update", responseMode: "lastNode", options: {} },
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 960],
      id: "8c5e6d62-cf2d-4c65-9db1-8a90d9a50007",
      name: "Update Job Webhook",
      webhookId: "bot-job-update-webhook",
    },
  ];

  const newConnections = {
    // Schedule trigger path
    "Trigger 7AM - Noticias Dev": { main: [[{ node: "Job 7AM - Noticias Dev", type: "main", index: 0 }]] },
    "Trigger 12PM - Presentacion": { main: [[{ node: "Job 12PM - Presentacion", type: "main", index: 0 }]] },
    "Trigger 4PM - Servicios": { main: [[{ node: "Job 4PM - Servicios", type: "main", index: 0 }]] },
    "Job 7AM - Noticias Dev": { main: [[{ node: "Preparar Job", type: "main", index: 0 }]] },
    "Job 12PM - Presentacion": { main: [[{ node: "Preparar Job", type: "main", index: 0 }]] },
    "Job 4PM - Servicios": { main: [[{ node: "Preparar Job", type: "main", index: 0 }]] },
    "Preparar Job": { main: [[{ node: "Login n8n", type: "main", index: 0 }]] },
    "Login n8n": { main: [[{ node: "Insertar Job en DataTable", type: "main", index: 0 }]] },

    // Webhook enqueue path
    "Enqueue Job Webhook": { main: [[{ node: "Preparar Webhook Job", type: "main", index: 0 }]] },
    "Preparar Webhook Job": { main: [[{ node: "Login n8n Webhook", type: "main", index: 0 }]] },
    "Login n8n Webhook": { main: [[{ node: "Insertar Webhook Job en DataTable", type: "main", index: 0 }]] },
  };

  // Save the updated workflow
  console.log('\n=== Actualizando BOT_JOB_QUEUE ===');
  console.log('Nuevos nodos:', newNodes.map(n => n.name).join(', '));

  const saveRes = await request('PATCH', `/rest/workflows/${BJQ_ID}`, {
    nodes: newNodes,
    connections: newConnections,
    settings: { executionOrder: "v1", availableInMCP: false },
    versionId: currentWf.versionId,
  }, cookies);

  const savedWf = JSON.parse(saveRes.body).data;
  console.log('PATCH status:', saveRes.status);
  console.log('Saved nodes:', savedWf?.nodes?.map(n => n.name).join(', '));

  // Activate
  const actRes = await request('POST', `/rest/workflows/${BJQ_ID}/activate`, { versionId: savedWf.versionId }, cookies);
  console.log('Activate status:', actRes.status);
  const actWf = JSON.parse(actRes.body).data;
  console.log('Active:', actWf.active);
  console.log('Trigger count:', actWf.triggerCount);

  console.log('\n=== RESUMEN ===');
  console.log('CERO nodos Code - todo con Set + HTTP Request nativos');
  console.log('Schedule: Trigger → Set (job data) → Set (prepare) → HTTP Login → HTTP Insert');
  console.log('Webhook: Webhook → Set (parse body) → HTTP Login → HTTP Insert');
})().catch(e => { console.error(e.message); process.exit(1); });
