// functions/session-chat.js
// Phase 1/2 baseline — non-streaming chat endpoint (CommonJS)
// - Intent → clip short-circuit using assets/intentMap.json
// - Persona loader from /personas
// - Session memory persisted with Netlify Blobs getStore("sessions") when available
// - Fallback to in-memory store if Blobs isn’t available (local dev)
// - Returns JSON: { version, sessionId, messages, matchedClip? , reply? }

const path = require("path");
const { readFile } = require("fs/promises");

// Deterministic intent → clip map (keep file next to assets/)
let intentMap = {};
try {
  intentMap = require("../assets/intentMap.json");
} catch {
  intentMap = {};
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL =
  process.env.OPENAI_MODEL ||
  process.env.OPENAI_CHAT_MODEL ||
  "gpt-4o-mini";

const VERSION = "24.0.0-session-chat";

// Prefer widely-available Blobs API (no tokens needed inside Netlify Functions)
let getStore;
try {
  ({ getStore } = require("@netlify/blobs"));
} catch {
  getStore = undefined;
}

/* ------------------------- tiny utils ------------------------- */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Content-Type": "application/json; charset=utf-8",
  };
}
const nowTs = () => Date.now();

/** sessions store (getStore if available, else in-memory) */
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
    async get(id) {
      return mem.get(id) || null;
    },
    async set(id, val) {
      mem.set(id, val);
    },
  };
}

async function loadPersona(personaId) {
  if (!personaId) return null;
  try {
    const personaPath = path.join(__dirname, "..", "personas", `${personaId}.json`);
    const buf = await readFile(personaPath, "utf-8");
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

function buildChatMessagesForLLM({ persona, history }) {
  const MAX_MESSAGES = 14;
  const recent = (history || []).slice(-MAX_MESSAGES);

  const system = (() => {
    if (persona && (persona.system || persona.description || persona.instructions)) {
      const name = persona.name ? `You are ${persona.name}. ` : "";
      const instr = persona.system || persona.instructions || persona.description || "";
      return `${name}${instr}`.trim();
    }
    // Safe, concise default
    return [
      "You are Sasha — warm, playful, confident.",
      "Stay in character; never say you are an AI.",
      "Keep responses brief: 1–2 sentences (≤ 25 words).",
      "If you don’t know, pivot lightly and invite another question.",
      "Be respectful and avoid personal claims you can’t know."
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

/* ------------------------- handler ------------------------- */

module.exports.handler = async (event) => {
  try {
    // Preflight
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
    const userMessage = (body.message ?? body.text ?? "").toString();
    const personaId = body.personaId || body.persona || null;
    const meta = body.meta || {};
    const forceLLM = !!body.forceLLM;

    if (!sessionId) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ version: VERSION, error: "sessionId is required" }) };
    }
    if (!userMessage) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ version: VERSION, error: "message is required" }) };
    }

    const sessions = getSessionsStore();
    let session = (await sessions.get(sessionId).catch(() => null)) || { sessionId, messages: [] };

    // 1) Store the user message
    session.messages.push({
      role: "user",
      content: userMessage,
      meta,
      ts: nowTs(),
    });
    await sessions.set(sessionId, session).catch(() => {});

    // 2) Deterministic intent → clip (unless forceLLM explicitly demands LLM first)
    if (!forceLLM) {
      const q = userMessage.toLowerCase();
      let matchedClip = null;
      try {
        for (const key of Object.keys(intentMap)) {
          const entry = intentMap[key];
          if (entry?.keywords?.some((w) => q.includes(w))) { matchedClip = entry.clip; break; }
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
          body: JSON.stringify({ version: VERSION, sessionId, messages: session.messages, matchedClip }),
        };
      }
    }

    // 3) LLM path (non-streaming)
    const persona = await loadPersona(personaId);
    const llmMessages = buildChatMessagesForLLM({ persona, history: session.messages });

    let assistantText = "";
    try {
      assistantText = await llmChat({ messages: llmMessages, model: DEFAULT_MODEL, temperature: 0.8 });
    } catch (err) {
      console.error("[session-chat] LLM call failed:", err?.message || err);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ version: VERSION, sessionId, messages: session.messages, reply: null, error: "llm_failed" }),
      };
    }

    const assistantMsg = {
      role: "assistant",
      content: assistantText,
      meta: { model: DEFAULT_MODEL, personaId: personaId || null },
      ts: nowTs(),
    };
    session.messages.push(assistantMsg);
    await sessions.set(sessionId, session);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ version: VERSION, sessionId, messages: session.messages, reply: assistantText }),
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
