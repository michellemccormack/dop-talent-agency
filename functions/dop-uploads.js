// functions/dop-uploads.js
// Queues HeyGen video generation (non-blocking) and writes a complete persona.
// Keeps your look & feel unchanged. Works with both photo/voice and imageBase64/audioBase64.

const { uploadsStore } = require('./_lib/blobs');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const ok = (obj) => ({ statusCode: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const bad = (code, msg, extra = {}) => ({ statusCode: code, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ success:false, error: msg, ...extra }) });

const BASE_URL = process.env.URL || 'https://dopple-talent-demo.netlify.app';

// ---------- prompt & persona helpers ----------
function generatePersonaPrompts(bio, name) {
  // You can tweak these later; keys must be stable for the viewer
  return [
    { key: 'fun',   text: 'What do you like to do for fun?' },
    { key: 'from',  text: 'Where are you from?' },
    { key: 'relax', text: 'What’s your favorite way to relax?' },
  ];
}

function generateSystemPrompt(bio, name) {
  const n = name || 'Assistant';
  const core = bio && bio.trim().length > 10 ? `Here's what people should know about you: ${bio.trim()}. ` : '';
  return `You are ${n}. ${core}Stay in character as ${n}. Be conversational, warm, and authentic. Keep responses brief and engaging (1–2 sentences, under 25 words). Never break character or mention you're an AI.`;
}

const stripPrefix = (s = '') => (s.includes(',') ? s.split(',')[1] : s);

// ---------- external API helpers via your proxy ----------
async function heygen(action, payload) {
  const res = await fetch(`${BASE_URL}/.netlify/functions/heygen-proxy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const message = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`[heygen ${action}] ${message}`);
  }
  return data;
}

async function createVoiceClone(voiceBase64, name) {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('[dop-uploads] ElevenLabs key missing; skipping clone');
    return null;
  }
  try {
    const base64 = stripPrefix(voiceBase64);
    const audio = Buffer.from(base64, 'base64');

    // Minimal multipart for ElevenLabs
    const boundary = '----DopForm' + Math.random().toString(36).slice(2);
    const enc = new TextEncoder();
    const nm = (name || 'DOP Voice').replace(/[^a-zA-Z0-9 _-]/g, '');
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${nm}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="voice.webm"\r\nContent-Type: audio/webm\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = new Uint8Array(enc.encode(head).length + audio.length + enc.encode(tail).length);
    body.set(enc.encode(head), 0);
    body.set(audio, enc.encode(head).length);
    body.set(enc.encode(tail), enc.encode(head).length + audio.length);

    const r = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const txt = await r.text();
    if (!r.ok) { console.error('[dop-uploads] ElevenLabs error:', txt); return null; }
    const json = JSON.parse(txt);
    return json.voice_id || null;
  } catch (e) {
    console.error('[dop-uploads] clone error:', e.message);
    return null;
  }
}

async function createHeyGenAvatarFromImageUrl(imageUrl, name) {
  if (!process.env.HEYGEN_API_KEY) { console.log('[dop-uploads] HEYGEN_API_KEY missing; skip'); return null; }
  try {
    const up = await heygen('upload_photo', { imageUrl, name: name || 'DOP Avatar' });
    if (!up?.image_key) throw new Error('upload_photo returned no image_key');
    const grp = await heygen('create_avatar_group', { imageKey: up.image_key, name: name || 'DOP Avatar' });
    if (!grp?.avatar_group_id) throw new Error('create_avatar_group returned no id');
    const aid = await heygen('get_avatar_id', { avatarGroupId: grp.avatar_group_id });
    const avatar_id = aid?.avatar_id;
    if (!avatar_id) throw new Error('get_avatar_id returned no avatar_id');
    // Optional motion/sfx
    try { await heygen('add_motion', { avatarId: avatar_id }); } catch {}
    try { await heygen('add_sound_effect', { avatarId: avatar_id }); } catch {}
    return avatar_id;
  } catch (e) {
    console.error('[dop-uploads] heygen avatar error:', e.message);
    return null;
  }
}

async function queueHeyGenVideo(avatar_id, voice_id, script) {
  try {
    const gen = await heygen('generate_video', { avatar_id, voice_id, script, ratio: '9:16', quality: 'high' });
    // Proxy usually returns {task_id}
    return gen.task_id || gen.data?.task_id || null;
  } catch (e) {
    console.error('[dop-uploads] queue video error:', e.message);
    return null;
  }
}

// ---------- main handler ----------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');

  try {
    const body = JSON.parse(event.body || '{}');

    // Accept both old and new field names
    let {
      name = '',
      bio  = '',
      photo,                 // old
      voice,                 // old
      imageBase64,           // new
      imageType = 'image/jpeg',
      imageName = 'photo.jpg',
      audioBase64,
      audioType = 'audio/webm',
      audioName = 'voice.webm',
      dopId: dopIdIn
    } = body;

    const dopId = dopIdIn || ('dop_' + Math.random().toString(36).slice(2, 10));
    const imgB64 = stripPrefix(photo || imageBase64 || '');
    const vocB64 = stripPrefix(voice || audioBase64 || '');

    if (!imgB64 || !vocB64) return bad(400, 'Photo and voice are required');

    const imgBuf = Buffer.from(imgB64, 'base64');
    const vocBuf = Buffer.from(vocB64, 'base64');

    // --- write blobs (predictable paths + content types) ---
    const store = uploadsStore();
    const imageKey = `images/${dopId}/${imageName}`;
    const voiceKey = `voices/${dopId}/${audioName}`;
    await store.set(imageKey, imgBuf, { contentType: imageType });
    await store.set(voiceKey, vocBuf,   { contentType: audioType });

    const fileUrl = (k) => `/.netlify/functions/dop-file?key=${encodeURIComponent(k)}`;
    const publicImageUrl = `${BASE_URL}${fileUrl(imageKey)}`;

    // --- optional: clone voice + create heygen avatar (fast-ish, but not blocking overall) ---
    let voice_id = null;
    try { voice_id = await createVoiceClone(vocB64, name); } catch {}
    let avatar_id = null;
    try { avatar_id = await createHeyGenAvatarFromImageUrl(publicImageUrl, name); } catch {}

    // --- build persona JSON ---
    const prompts = generatePersonaPrompts(bio, name);
    const pending = {};  // filled below if we can queue jobs

    // Try to queue all three HeyGen renders right now; background processor will finish them.
    if (avatar_id) {
      for (const p of prompts) {
        const script = name ? `Hi, I'm ${name}. ${p.text}` : p.text;
        const task_id = await queueHeyGenVideo(avatar_id, voice_id || 'default', script);
        if (task_id) pending[p.key] = { task_id, started_at: Date.now() };
      }
    }

    const persona = {
      dopId,
      name: name || 'My DOP',
      bio: bio || '',
      created: new Date().toISOString(),
      systemPrompt: generateSystemPrompt(bio, name),

      // Media
      images: [{ key: imageKey, url: fileUrl(imageKey), type: imageType, name: imageName, ts: Date.now() }],
      voices: [{ key: voiceKey, url: fileUrl(voiceKey), type: audioType, name: audioName, ts: Date.now() }],

      // Engines
      voice: { id: voice_id || null },
      heygen: { avatar_id: avatar_id || null },

      // Conversation & video gen
      prompts,                   // [{key,text}]
      status: 'processing',      // viewer will poll; processor will flip to 'ready'
      videos: [],                // to be filled by processor
      pending: Object.keys(pending).length ? pending : undefined,
      failures: undefined
    };

    await store.set(`personas/${dopId}.json`, JSON.stringify(persona), { contentType: 'application/json; charset=utf-8' });

    // Response mirrors your existing shape but indicates queued work
    return ok({
      success: true,
      dopId,
      voiceId: voice_id,
      heygenAvatarId: avatar_id,
      queued: Object.keys(pending).length,
      message: Object.keys(pending).length
        ? `DOP saved. Queued ${Object.keys(pending).length} HeyGen videos.`
        : (avatar_id ? 'DOP saved. Avatar created; videos will be queued by processor.' : 'DOP saved.'),
      chatUrl: `/chat.html?id=${dopId}`
    });

  } catch (e) {
    console.error('[dop-uploads] error:', e);
    return bad(500, 'Upload failed', { message: String(e?.message || e) });
  }
};
