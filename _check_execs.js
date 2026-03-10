const https = require("https");
function req(m, p, b, c) {
  return new Promise((ok, ko) => {
    const u = new URL(p, "https://n8n-dev.noyecode.com");
    const o = { method: m, hostname: u.hostname, path: u.pathname + u.search, headers: { Accept: "application/json", "browser-id": "chk" } };
    if (b) { const d = JSON.stringify(b); o.headers["Content-Type"] = "application/json"; o.headers["Content-Length"] = Buffer.byteLength(d); }
    if (c) o.headers["Cookie"] = c;
    const r = https.request(o, res => { let d = ""; res.on("data", ch => d += ch); res.on("end", () => ok({ s: res.statusCode, h: res.headers, b: d })); });
    r.on("error", ko);
    if (b) r.write(JSON.stringify(b));
    r.end();
  });
}
(async () => {
  const l = await req("POST", "/rest/login", { emailOrLdapLoginId: "andersonbarbosadev@outlook.com", password: "t5x]oIs{7=ISZ}sS" });
  const c = (l.h["set-cookie"] || []).map(x => x.split(";")[0]).join("; ");
  const r = await req("GET", "/rest/executions?limit=30", null, c);
  const body = JSON.parse(r.b);
  const results = (body.data || {}).results || [];
  let found = false;
  for (const e of results) {
    if (e.workflowId === "eW5SRNY5r4zfRjIqTw9eP") {
      console.log(`ID:${e.id} status:${e.status} started:${e.startedAt}`);
      found = true;
    }
  }
  if (!found) console.log("No BOT_JOB_QUEUE executions in last 30");
})().catch(e => console.error(e.message));
