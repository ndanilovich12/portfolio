// Runs ONE agent step for Agent Studio. The page calls this once per agent, in order,
// so every handoff stays visible and each call stays well under the time limit.
//
// Provider: the first key that is set wins.
//   GROQ_API_KEY       free tier at https://console.groq.com  (default model openai/gpt-oss-120b)
//   GEMINI_API_KEY     free tier at https://aistudio.google.com (default model gemini-3.1-flash-lite)
//   ANTHROPIC_API_KEY  paid, https://console.anthropic.com     (default model claude-haiku-4-5)
// Optional: GROQ_MODEL, GEMINI_MODEL, ANTHROPIC_MODEL to pick a different model,
//   AGENT_DAILY_CAP   (default 300 model calls per day across all visitors)
//   AGENT_VISITOR_CAP (default 24 model calls per visitor per day, about 3 full runs)
// POST /api/agent  { goal, task, role: {name, job, rules[], output}, inbox: [{from, text}] }

const env = (k) => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
const memory = new Map(); // fallback counter if Netlify Blobs is unavailable
const MAX_OUT = 600;
const TIMEOUT_MS = 24000;

function provider() {
  if (env("GROQ_API_KEY")) {
    const model = env("GROQ_MODEL") || "openai/gpt-oss-120b";
    return { id: "groq", key: env("GROQ_API_KEY"), model, label: `${model.replace(/^openai\//, "")} on Groq` };
  }
  if (env("GEMINI_API_KEY")) {
    const model = env("GEMINI_MODEL") || "gemini-3.1-flash-lite";
    return { id: "gemini", key: env("GEMINI_API_KEY"), model, label: `${model} (Google)` };
  }
  if (env("ANTHROPIC_API_KEY")) {
    const model = env("ANTHROPIC_MODEL") || "claude-haiku-4-5";
    return { id: "anthropic", key: env("ANTHROPIC_API_KEY"), model, label: `${model} (Anthropic)` };
  }
  return null;
}

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

async function post(url, headers, body, signal) {
  const r = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j };
}
const errMsg = (res) => (res.j && (res.j.error?.message || res.j.error?.status || (typeof res.j.error === "string" && res.j.error))) || `The model returned ${res.status}.`;

// Each returns { text, model, usage } or throws { message }
async function callGroq(p, system, user, signal) {
  const res = await post("https://api.groq.com/openai/v1/chat/completions", { authorization: `Bearer ${p.key}` }, {
    model: p.model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.3,
    max_completion_tokens: MAX_OUT * 3, // reasoning models spend some tokens thinking first
    ...(/gpt-oss/.test(p.model) ? { reasoning_effort: "low", include_reasoning: false } : {}),
  }, signal);
  if (!res.ok || !res.j) throw { message: errMsg(res) };
  const c = res.j.choices && res.j.choices[0];
  const text = String((c && c.message && c.message.content) || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const u = res.j.usage;
  return { text, model: res.j.model || p.model, usage: u ? { input: u.prompt_tokens, output: u.completion_tokens } : null };
}

async function callGemini(p, system, user, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`;
  const res = await post(url, { "x-goog-api-key": p.key }, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: MAX_OUT * 2 },
  }, signal);
  if (!res.ok || !res.j) throw { message: errMsg(res) };
  const parts = (res.j.candidates && res.j.candidates[0] && res.j.candidates[0].content && res.j.candidates[0].content.parts) || [];
  const text = parts.filter((x) => x.text && !x.thought).map((x) => x.text).join("\n").trim();
  const u = res.j.usageMetadata;
  return { text, model: res.j.modelVersion || p.model, usage: u ? { input: u.promptTokenCount, output: u.candidatesTokenCount } : null };
}

async function callAnthropic(p, system, user, signal) {
  const res = await post("https://api.anthropic.com/v1/messages", { "x-api-key": p.key, "anthropic-version": "2023-06-01" }, {
    model: p.model, max_tokens: MAX_OUT, temperature: 0.3, system, messages: [{ role: "user", content: user }],
  }, signal);
  if (!res.ok || !res.j) throw { message: errMsg(res) };
  const text = (res.j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  const u = res.j.usage;
  return { text, model: res.j.model || p.model, usage: u ? { input: u.input_tokens, output: u.output_tokens } : null };
}

const CALL = { groq: callGroq, gemini: callGemini, anthropic: callAnthropic };

export default async (req, context) => {
  const p = provider();
  if (req.method === "GET") {
    return json({ live: Boolean(p), provider: p ? p.id : null, model: p ? p.model : null, label: p ? p.label : null });
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!p) return json({ error: "Live runs are not switched on for this site yet.", code: "not_configured" }, 503);

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
    "Hard rules: stay inside your job; never invent numbers, quotes, names or sources. If a fact was not handed to you, say it is missing. Be brief: at most 180 words. Plain text, no tables, no preamble.",
  ].filter(Boolean).join("\n\n");

  const user = [
    `Task: ${clip(body.task, 600)}`,
    inbox ? `Handoffs you received:\n\n${inbox}` : "You are first in line. No handoffs yet.",
  ].join("\n\n");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const out = await CALL[p.id](p, system, user, ctl.signal);
    if (!out.text) return json({ error: "The model sent back an empty answer. Try again.", code: "model_error" }, 502);
    return json(out);
  } catch (e) {
    if (e && e.name === "AbortError") return json({ error: "The model took too long to answer. Try again.", code: "timeout" }, 504);
    return json({ error: (e && e.message) || "The model call failed.", code: "model_error" }, 502);
  } finally {
    clearTimeout(timer);
  }
};

export const config = { path: "/api/agent" };
