// functions/session-chat.js
// Updated to handle BOTH pre-recorded personas AND user-generated DOPs

const path = require("path");
const crypto = require("crypto");
const { readFile } = require("fs/promises");

// For user-generated DOPs
const { uploadsStore } = require('./_lib/blobs');

// ---------- Guardrails (MVP: abuse/cost control, no PII) ----------
const MAX_MESSAGE_CHARS = 4000;
const RATE_PER_MIN = 30;
const RATE_BURST = 10;
const RATE_BURST_WINDOW_MS = 10000;
const RATE_MIN_WINDOW_MS = 60000;
const RATE_PER_SESSION_PER_MIN = 20;
const TOKEN_BUDGET_ROLLING_24H = 100000;
const DUPLICATE_WINDOW_MS = 30000;
const TOKEN_LIMIT_MESSAGE = "You've hit today's limit. Try again tomorrow.";
const RATE_LIMIT_MESSAGE = "Please slow down and try again.";
const SLOW_DOWN_MESSAGE = "Please slow down and try again.";

function getClientIp(event) {
  const h = event.headers || {};
  const ip = h["x-nf-client-connection-ip"] || (h["x-forwarded-for"] || "").split(",")[0].trim();
  return ip || "unknown";
}

function hashForLog(s) {
  if (!s || typeof s !== "string") return "n/a";
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
}

function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil((text.length || 0) / 4);
}

function logGuardrail(payload) {
  const { sessionIdHash, route, rateLimitHit, tokenLimitHit, duplicateHit, tokenEstimate } = payload;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      route: route || "session-chat",
      session_id_hash: sessionIdHash,
      rate_limit_hit: !!rateLimitHit,
      token_limit_hit: !!tokenLimitHit,
      duplicate_hit: !!duplicateHit,
      token_estimate: tokenEstimate == null ? undefined : tokenEstimate,
    })
  );
}

function getRateLimitStore() {
  if (typeof getStore !== "function") return null;
  try {
    return getStore({ name: "sessions" });
  } catch {
    return null;
  }
}

async function checkRateLimit(ip, sessionId) {
  const store = getRateLimitStore();
  if (!store) return { allowed: true };

  const now = Date.now();
  const ipHash = crypto.createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 16);
  const ipKey = `rl/ip/${ipHash}`;
  const sessKey = `rl/session/${sessionId}`;

  const trim = (data) => {
    if (!data || typeof data !== "object") return { minWindow: now, minCount: 0, burstWindow: now, burstCount: 0 };
    let { minWindow, minCount, burstWindow, burstCount } = data;
    if (now - minWindow > RATE_MIN_WINDOW_MS) { minWindow = now; minCount = 0; }
    if (now - burstWindow > RATE_BURST_WINDOW_MS) { burstWindow = now; burstCount = 0; }
    return { minWindow, minCount: minCount || 0, burstWindow, burstCount: burstCount || 0 };
  };

  try {
    const [ipRaw, sessRaw] = await Promise.all([
      store.get(ipKey, { type: "text" }).catch(() => null),
      store.get(sessKey, { type: "text" }).catch(() => null),
    ]);
    const ipData = trim(ipRaw ? JSON.parse(ipRaw) : null);
    const sessData = trim(sessRaw ? JSON.parse(sessRaw) : null);

    ipData.minCount++;
    ipData.burstCount++;
    sessData.minCount++;
    sessData.burstCount++;

    if (
      ipData.minCount > RATE_PER_MIN ||
      ipData.burstCount > RATE_BURST ||
      sessData.minCount > RATE_PER_SESSION_PER_MIN
    ) {
      return { allowed: false };
    }

    await Promise.all([
      store.set(ipKey, JSON.stringify(ipData), { contentType: "application/json" }).catch(() => {}),
      store.set(sessKey, JSON.stringify(sessData), { contentType: "application/json" }).catch(() => {}),
    ]);
  } catch {
    return { allowed: true };
  }
  return { allowed: true };
}

// Deterministic intent → clip map (keep for pre-recorded personas)
let intentMap = {};
try {
  intentMap = require("../assets/intentMap.json");
} catch {
  intentMap = {};
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const VERSION = "24.1.0-dual-persona";

// Prefer Blobs API for sessions
let getStore;
try {
  ({ getStore } = require("@netlify/blobs"));
} catch {
  getStore = undefined;
}

/* ------------------------- Utils ------------------------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Content-Type": "application/json; charset=utf-8",
  };
}

const nowTs = () => Date.now();

function getSessionsStore() {
  if (typeof getStore === "function") {
    try {
      const store = getStore({ name: "sessions" });
      return {
        async get(id) {
          const text = await store.get(id);
          return text ? JSON.parse(text) : null;
        },
        async set(id, val) {
          return store.set(id, JSON.stringify(val), {
            contentType: "application/json",
          });
        },
      };
    } catch (err) {
      console.warn("[session-chat] getStore threw; fallback to memory:", err?.message || err);
    }
  }
  console.warn("[session-chat] storage: in-memory (no persistence between cold starts)");
  const mem = new Map();
  return {
    async get(id) { return mem.get(id) || null; },
    async set(id, val) { mem.set(id, val); },
  };
}

/* ------------------------- Persona Loading ------------------------- */

// Load pre-recorded persona from filesystem (existing system)
async function loadFilePersona(personaId) {
  if (!personaId) return null;
  try {
    const personaPath = path.join(__dirname, "..", "personas", `${personaId}.json`);
    const buf = await readFile(personaPath, "utf-8");
    return { ...JSON.parse(buf), type: 'file', source: 'filesystem' };
  } catch {
    return null;
  }
}

// Load user-generated persona from Blobs (new system)
async function loadUserPersona(dopId) {
  if (!dopId) return null;
  try {
    const store = uploadsStore();
    const personaKey = `personas/${dopId}.json`;
    const rawData = await store.get(personaKey, { type: 'text' });
    if (!rawData) return null;
    
    const persona = JSON.parse(rawData);
    return { ...persona, type: 'user', source: 'blobs' };
  } catch (err) {
    console.warn(`[session-chat] Failed to load user persona ${dopId}:`, err?.message);
    return null;
  }
}

// Try both persona systems
async function loadPersona(personaId) {
  if (!personaId) return null;

  // Try user-generated first (UUIDs are typically longer)
  if (personaId.length > 10 || personaId.includes('-')) {
    const userPersona = await loadUserPersona(personaId);
    if (userPersona) {
      console.log(`[session-chat] Loaded user persona: ${personaId}`);
      return userPersona;
    }
  }

  // Fall back to file-based persona
  const filePersona = await loadFilePersona(personaId);
  if (filePersona) {
    console.log(`[session-chat] Loaded file persona: ${personaId}`);
    return filePersona;
  }

  console.warn(`[session-chat] No persona found for: ${personaId}`);
  return null;
}

/* ------------------------- Message Building ------------------------- */

function buildChatMessagesForLLM({ persona, history }) {
  const MAX_MESSAGES = 14;
  const recent = (history || []).slice(-MAX_MESSAGES);

  const system = (() => {
    if (persona) {
      // Use persona's system prompt
      const systemPrompt = persona.system || persona.instructions || persona.description;
      if (systemPrompt) return systemPrompt;
      
      // Generate from persona info
      const name = persona.name || persona.displayName || "Assistant";
      const desc = persona.description || "";
      return `You are ${name}. ${desc} Be conversational, warm, and authentic. Keep responses brief and engaging.`;
    }
    
    // Default fallback
    return [
      "You are Sasha — warm, playful, confident.",
      "Stay in character; never say you are an AI.",
      "Keep responses brief: 1–2 sentences (≤ 25 words).",
      "If you don't know, pivot lightly and invite another question.",
      "Be respectful and avoid personal claims you can't know."
    ].join(" ");
  })();

  const msgs = [{ role: "system", content: system }];
  for (const m of recent) {
    if (m && (m.role === "user" || m.role === "assistant" || m.role === "system")) {
      msgs.push({ role: m.role, content: String(m.content ?? "") });
    }
  }
  return msgs;
}

async function llmChat({ messages, model = DEFAULT_MODEL, temperature = 0.7 }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature }),
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 600)}`);
  }
  
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

/* ------------------------- Handler ------------------------- */

module.exports.handler = async (event) => {
  try {
    if ((event.httpMethod || "").toUpperCase() === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }
    if ((event.httpMethod || "").toUpperCase() !== "POST") {
      return {
        statusCode: 405,
        headers: corsHeaders(),
        body: JSON.stringify({ version: VERSION, error: "Method Not Allowed" }),
      };
    }

    // Parse input
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    
    const sessionId = body.sessionId || body.id || null;
    const userMessageRaw = (body.message ?? body.text ?? "").toString();
    const userMessage = userMessageRaw.trim();
    const personaId = body.personaId || body.persona || null;
    const meta = body.meta || {};
    const forceLLM = !!body.forceLLM;
    const sessionIdHash = hashForLog(sessionId);

    if (!sessionId) {
      return { 
        statusCode: 400, 
        headers: corsHeaders(), 
        body: JSON.stringify({ version: VERSION, error: "sessionId is required" }) 
      };
    }
    if (!userMessage) {
      return { 
        statusCode: 400, 
        headers: corsHeaders(), 
        body: JSON.stringify({ version: VERSION, error: "message is required" }) 
      };
    }
    if (userMessage.length > MAX_MESSAGE_CHARS) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ version: VERSION, error: "Message is too long. Please shorten and try again." }),
      };
    }

    const ip = getClientIp(event);
    const rateLimitResult = await checkRateLimit(ip, sessionId);
    if (!rateLimitResult.allowed) {
      logGuardrail({ sessionIdHash, route: "session-chat", rateLimitHit: true });
      return {
        statusCode: 429,
        headers: corsHeaders(),
        body: JSON.stringify({ version: VERSION, error: RATE_LIMIT_MESSAGE }),
      };
    }

    const sessions = getSessionsStore();
    let session = (await sessions.get(sessionId).catch(() => null)) || { sessionId, messages: [] };

    const lastUser = session.messages.filter((m) => m && m.role === "user").pop();
    if (lastUser && lastUser.content === userMessage && (nowTs() - (lastUser.ts || 0)) < DUPLICATE_WINDOW_MS) {
      logGuardrail({ sessionIdHash, route: "session-chat", duplicateHit: true });
      return {
        statusCode: 429,
        headers: corsHeaders(),
        body: JSON.stringify({ version: VERSION, error: SLOW_DOWN_MESSAGE }),
      };
    }

    const now = nowTs();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    if (!session.tokenBudgetResetAt || now > session.tokenBudgetResetAt) {
      session.tokenBudgetResetAt = now + twentyFourHoursMs;
      session.tokenBudgetUsed = 0;
    }
    if ((session.tokenBudgetUsed || 0) >= TOKEN_BUDGET_ROLLING_24H) {
      session.messages.push({
        role: "user",
        content: userMessage,
        meta,
        ts: now,
      });
      const limitReply = TOKEN_LIMIT_MESSAGE;
      session.messages.push({
        role: "assistant",
        content: limitReply,
        meta: { tokenLimit: true },
        ts: nowTs(),
      });
      await sessions.set(sessionId, session).catch(() => {});
      logGuardrail({ sessionIdHash, route: "session-chat", tokenLimitHit: true, tokenEstimate: session.tokenBudgetUsed });
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          version: VERSION,
          sessionId,
          messages: session.messages,
          reply: limitReply,
          personaType: "unknown",
        }),
      };
    }

    session.messages.push({
      role: "user",
      content: userMessage,
      meta,
      ts: now,
    });
    await sessions.set(sessionId, session).catch(() => {});

    // Load persona (try both systems)
    const persona = await loadPersona(personaId);

    // For file-based personas, try clip matching first (unless forceLLM)
    if (persona?.type === 'file' && !forceLLM) {
      const q = userMessage.toLowerCase();
      let matchedClip = null;
      
      try {
        for (const key of Object.keys(intentMap)) {
          const entry = intentMap[key];
          if (entry?.keywords?.some((w) => q.includes(w))) { 
            matchedClip = entry.clip; 
            break; 
          }
        }
      } catch {}
      
      if (matchedClip) {
        const clipMsg = {
          role: "assistant",
          content: `[clip:${matchedClip}]`,
          meta: { clip: matchedClip },
          ts: nowTs(),
        };
        session.messages.push(clipMsg);
        await sessions.set(sessionId, session);
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({ 
            version: VERSION, 
            sessionId, 
            messages: session.messages, 
            matchedClip,
            personaType: 'file'
          }),
        };
      }
    }

    // LLM chat path (for user personas or when no clip matched)
    const llmMessages = buildChatMessagesForLLM({ persona, history: session.messages });

    let assistantText = "";
    try {
      assistantText = await llmChat({ 
        messages: llmMessages, 
        model: DEFAULT_MODEL, 
        temperature: 0.8 
      });
    } catch (err) {
      console.error("[session-chat] LLM call failed:", err?.message || err);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ 
          version: VERSION, 
          sessionId, 
          messages: session.messages, 
          reply: null, 
          error: "llm_failed" 
        }),
      };
    }

    const assistantMsg = {
      role: "assistant",
      content: assistantText,
      meta: { 
        model: DEFAULT_MODEL, 
        personaId: personaId || null,
        personaType: persona?.type || 'unknown'
      },
      ts: nowTs(),
    };
    session.messages.push(assistantMsg);

    const userTokens = estimateTokens(userMessage);
    const assistantTokens = estimateTokens(assistantText);
    session.tokenBudgetUsed = (session.tokenBudgetUsed || 0) + userTokens + assistantTokens;
    await sessions.set(sessionId, session);

    logGuardrail({
      sessionIdHash,
      route: "session-chat",
      rateLimitHit: false,
      tokenLimitHit: false,
      tokenEstimate: session.tokenBudgetUsed,
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ 
        version: VERSION, 
        sessionId, 
        messages: session.messages, 
        reply: assistantText,
        personaType: persona?.type || 'unknown'
      }),
    };
  } catch (err) {
    console.error("[session-chat] unhandled:", err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ version: VERSION, error: "internal_error" }),
    };
  }
};