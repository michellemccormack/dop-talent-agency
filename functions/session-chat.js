// functions/session-chat.js
// Updated to handle BOTH pre-recorded personas AND user-generated DOPs

const path = require("path");
const { readFile } = require("fs/promises");

// For user-generated DOPs
const { uploadsStore } = require('./_lib/blobs');

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
    const userMessage = (body.message ?? body.text ?? "").toString();
    const personaId = body.personaId || body.persona || null;
    const meta = body.meta || {};
    const forceLLM = !!body.forceLLM;

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

    const sessions = getSessionsStore();
    let session = (await sessions.get(sessionId).catch(() => null)) || { sessionId, messages: [] };

    // Store user message
    session.messages.push({
      role: "user",
      content: userMessage,
      meta,
      ts: nowTs(),
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
    await sessions.set(sessionId, session);

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