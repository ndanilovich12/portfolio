// Runs ONE agent step for Agent Studio with Claude. The page calls this once per agent,
// in order, so every handoff stays visible and each call stays well under the time limit.
// Netlify environment variables:
//   ANTHROPIC_API_KEY  (required)
//   ANTHROPIC_MODEL    (optional, default claude-haiku-4-5)
//   AGENT_DAILY_CAP    (optional, default 300 model calls per day across all visitors)
//   AGENT_VISITOR_CAP  (optional, default 24 model calls per visitor per day = about 3 full runs)
// POST /api/agent  { goal, task, role: {name, job, rules[], output}, inbox: [{from, text}] }

const env = (k) => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
const memory = new Map(); // fallback counter if Netlify Blobs is unavailable

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
const clip = (s, n) => String(s ?? "").replace(/\s+\n/g, "\n").slice(0, n);

async function bump(key) {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("agent-limits");
    const now = Number((await store.get(key)) || 0) + 1;
    await store.set(key, String(now));
    return now;
  } catch {
    const now = (memory.get(key) || 0) + 1;
    memory.set(key, now);
    return now;
  }
}

export default async (req, context) => {
  if (req.method === "GET") {
    return json({ live: Boolean(env("ANTHROPIC_API_KEY")), model: env("ANTHROPIC_MODEL") || "claude-haiku-4-5" });
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const key = env("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "Live runs are not switched on for this site yet.", code: "not_configured" }, 503);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
  const role = body && body.role;
  if (!role || !role.name || !role.job) return json({ error: "Missing the agent role." }, 400);

  const today = new Date().toISOString().slice(0, 10);
  const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "unknown";
  const dayCap = Number(env("AGENT_DAILY_CAP") || 300);
  const ipCap = Number(env("AGENT_VISITOR_CAP") || 24);
  if ((await bump(`day:${today}`)) > dayCap) {
    return json({ error: "The site has used today's live runs. The blueprint still works, and live runs reset tomorrow.", code: "daily_cap" }, 429);
  }
  if ((await bump(`ip:${today}:${ip}`)) > ipCap) {
    return json({ error: "You've used your live runs for today. Try again tomorrow.", code: "visitor_cap" }, 429);
  }

  const rules = (Array.isArray(role.rules) ? role.rules : []).slice(0, 8).map((r) => "- " + clip(r, 200)).join("\n");
  const inbox = (Array.isArray(body.inbox) ? body.inbox : [])
    .slice(-8)
    .map((m) => `[from ${clip(m.from, 40)}]\n${clip(m.text, 2500)}`)
    .join("\n\n");

  const system = [
    `You are the "${clip(role.name, 60)}" agent on a small AI team.`,
    `Team goal: ${clip(body.goal, 400)}`,
    `Your job: ${clip(role.job, 300)}`,
    role.output ? `Return exactly this: ${clip(role.output, 300)}` : "",
    rules ? `Rules:\n${rules}` : "",
    "Hard rules: stay inside your job; never invent numbers, quotes, names or sources. If a fact was not handed to you, say it is missing. Be brief: at most 180 words. No preamble.",
  ].filter(Boolean).join("\n\n");

  const user = [
    `Task: ${clip(body.task, 600)}`,
    inbox ? `Handoffs you received:\n\n${inbox}` : "You are first in line. No handoffs yet.",
  ].join("\n\n");

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 24000);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env("ANTHROPIC_MODEL") || "claude-haiku-4-5",
        max_tokens: 450,
        temperature: 0.3,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    clearTimeout(timer);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) {
      return json({ error: (j && j.error && j.error.message) || `The model returned ${r.status}.`, code: "model_error" }, 502);
    }
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return json({
      text,
      model: j.model,
      usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens } : null,
    });
  } catch (e) {
    return json({ error: "The model took too long to answer. Try again.", code: "timeout" }, 504);
  }
};

export const config = { path: "/api/agent" };
