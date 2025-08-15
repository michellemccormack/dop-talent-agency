// functions/dop-chat.js
// GPT-powered intent router for Phase 1 (no embeddings yet)

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { text } = JSON.parse(event.body || '{}');
    const user = (text || '').trim();
    if (!user) return json({ error: 'Missing text' }, 400);

    // Candidate prompts (map to your existing files)
    const options = [
      { id: 'fun',   label: 'What do you like to do for fun?', clip: 'assets/p_fun.mp4' },
      { id: 'from',  label: 'Where are you from?',              clip: 'assets/p_from.mp4' },
      { id: 'relax', label: 'What’s your favorite way to relax?', clip: 'assets/p_relax.mp4' },
    ];

    // Quick keyword guard (fast path) — still useful
    const q = user.toLowerCase();
    if (q.includes('where') && q.includes('from'))     return json({ matchedClip: clipOf(options, 'from') });
    if (q.includes('relax'))                           return json({ matchedClip: clipOf(options, 'relax') });
    if (q.includes('what') && q.includes('fun') || q.includes('for fun')) {
      return json({ matchedClip: clipOf(options, 'fun') });
    }

    // GPT classification (structured JSON)
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      // No key? keep working with a friendly fallback
      return json({ fallbackResponse: genericFallback(options) });
    }

    const sys = [
      "You are an intent router. Given a user's question, pick the best match from OPTIONS.",
      "Return strictly JSON: {\"id\": \"fun|from|relax\", \"confidence\": 0..1, \"reason\": \"...\"}.",
      "If none match with confidence >= 0.6, return {\"id\":\"none\",\"confidence\":x,\"reason\":\"...\"}."
    ].join(' ');

    const msg = [
      { role: 'system', content: sys },
      { role: 'user', content:
        `OPTIONS: ${options.map(o => `${o.id}: ${o.label}`).join(' | ')}\nUSER: ${user}\nJSON:` }
    ];

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: msg
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(()=>'');
      console.error('OpenAI error:', errText || resp.statusText);
      return json({ fallbackResponse: genericFallback(options) });
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || '{}';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const choice = (parsed.id || '').toLowerCase();
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;

    if (choice && choice !== 'none' && confidence >= 0.6) {
      const found = options.find(o => o.id === choice);
      if (found) return json({ matchedClip: found.clip, routerMeta: { choice, confidence } });
    }

    // No confident match → friendly spoken fallback
    return json({ fallbackResponse: genericFallback(options), routerMeta: { choice, confidence } });

  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: 'Server error' };
  }
};

function clipOf(options, id){ return options.find(o => o.id === id)?.clip; }

function genericFallback(options){
  const list = options.map(o => o.label).join(', ');
  return `Ask me something like: ${list}. I’ll show you a clip.`;
}

function json(obj, status=200){
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}
