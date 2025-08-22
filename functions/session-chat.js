// /netlify/functions/session-chat.js
// Task 21: backend session memory (volatile, per-function instance)
// Persists across multiple requests while the function stays warm.
// Later we'll swap this Map for a DB/KV store.

export const config = { path: "/.netlify/functions/session-chat" };

const SESSIONS = new Map(); // sessionId -> { history: [{role, content}], lastUpdated }

const MAX_TURNS = 10;

// crude keyword→clip matcher (same clips you already use)
const CLIP_BY_KEYWORD = [
  { k: ["fun", "do for fun"], clip: "assets/p_fun.mp4" },
  { k: ["from", "where are you from"], clip: "assets/p_from.mp4" },
  { k: ["relax", "favorite way to relax"], clip: "assets/p_relax.mp4" },
];

function pickClip(text = "") {
  const t = text.toLowerCase();
  for (const rule of CLIP_BY_KEYWORD) {
    if (rule.k.some(kw => t.includes(kw))) return rule.clip;
  }
  return null;
}

function ensureSession(sessionId) {
  if (!SESSIONS.has(sessionId)) {
    SESSIONS.set(sessionId, { history: [], lastUpdated: Date.now() });
  }
  return SESSIONS.get(sessionId);
}

function capHistory(arr) {
  if (arr.length > MAX_TURNS) arr.splice(0, arr.length - MAX_TURNS);
  return arr;
}

export default async (req, res) => {
  try {
    const body = await parseJSON(req);
    const sessionId = String(body.sessionId || body.session_id || "anon");
    const userText = String(body.text || body.message || "").trim();

    const sess = ensureSession(sessionId);

    // Accept optional prior turns from client (defensive), then append user
    const clientTurns = Array.isArray(body.history) ? body.history : [];
    if (clientTurns.length) {
      // merge only if server doesn't already have them (simple heuristic)
      if (sess.history.length === 0) {
        sess.history = clientTurns.slice(-MAX_TURNS);
      }
    }

    if (userText) {
      sess.history.push({ role: "user", content: userText });
      capHistory(sess.history);
    }

    // ---- "LLM" reply (demo): either matched clip or a short fallback text ----
    const matchedClip = pickClip(userText);
    let fallbackResponse = "";

    if (matchedClip) {
      // For memory: store a short human-y assistant line
      const line =
        matchedClip.includes("p_fun")   ? "Let me show you what I do for fun. 😄" :
        matchedClip.includes("p_from")  ? "Here’s a bit about where I’m from." :
        matchedClip.includes("p_relax") ? "This is how I like to relax." :
        "Got it — playing a clip.";
      sess.history.push({ role: "assistant", content: line, meta: { clip: matchedClip } });
    } else {
      // No clip → short text reply
      fallbackResponse = userText
        ? `Okay — ${userText}`
        : "Hi! What should we talk about?";
      sess.history.push({ role: "assistant", content: fallbackResponse });
    }

    capHistory(sess.history);
    sess.lastUpdated = Date.now();

    res.setHeader("Content-Type", "application/json");
    res.status(200).end(
      JSON.stringify({
        sessionId,
        matchedClip: matchedClip || undefined,
        fallbackResponse: fallbackResponse || undefined,
        history: sess.history,
      })
    );
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
};

function parseJSON(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
