// functions/dop-uploads.js
// Queues HeyGen video generation (non-blocking) and writes a complete persona.
// Keeps your look & feel unchanged. Works with both photo/voice and imageBase64/audioBase64.

const { uploadsStore } = require('./_lib/blobs');
const { randomUUID } = require('crypto');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// Input size limits (adjust as needed)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_NAME_LENGTH = 100;
const MAX_BIO_LENGTH = 2000;

const ok = (obj) => ({ statusCode: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const bad = (code, msg, extra = {}) => ({ statusCode: code, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ success:false, error: msg, ...extra }) });

const BASE_URL = process.env.URL || 'https://dopple-talent-demo.netlify.app';

// Cap time spent on external APIs so the function returns before Netlify timeout (~10–26s).
const VOICE_CLONE_TIMEOUT_MS = 5000;
const HEYGEN_AVATAR_TIMEOUT_MS = 6000;
const HEYGEN_QUEUE_TIMEOUT_MS = 4000;

function withTimeout(ms, promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
  ]);
}

// ---------- validation helpers ----------
function isValidBase64(str) {
  if (!str || typeof str !== 'string') return false;
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return base64Regex.test(str);
}

function stripPrefix(s = '') {
  if (!s) return '';
  return s.includes(',') ? s.split(',')[1] : s;
}

function validateAndDecodeBase64(encoded, maxSize, fieldName) {
  const stripped = stripPrefix(encoded);
  
  if (!stripped) {
    throw new Error(`${fieldName} is required`);
  }
  
  if (!isValidBase64(stripped)) {
    throw new Error(`${fieldName} is not valid base64`);
  }
  
  const buffer = Buffer.from(stripped, 'base64');
  
  if (buffer.length > maxSize) {
    throw new Error(`${fieldName} exceeds maximum size of ${maxSize} bytes`);
  }
  
  if (buffer.length === 0) {
    throw new Error(`${fieldName} decoded to empty buffer`);
  }
  
  return buffer;
}

function sanitizeInput(str, maxLength, fieldName) {
  if (!str) return '';
  if (typeof str !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  if (str.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength}`);
  }
  return str.trim();
}

// ---------- prompt & persona helpers ----------
function generatePersonaPrompts(bio, name) {
  return [
    { key: 'fun',   text: 'What do you like to do for fun?' },
    { key: 'from',  text: 'Where are you from?' },
    { key: 'relax', text: "What's your favorite way to relax?" },
  ];
}

function generateSystemPrompt(bio, name) {
  const n = name || 'Assistant';
  const core = bio && bio.length > 10 ? `Here's what people should know about you: ${bio}. ` : '';
  return `You are ${n}. ${core}Stay in character as ${n}. Be conversational, warm, and authentic. Keep responses brief and engaging (1–2 sentences, under 25 words). Never break character or mention you're an AI.`;
}

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

async function createVoiceClone(voiceBuffer, name) {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('[dop-uploads] ElevenLabs key missing; skipping clone');
    return null;
  }
  try {
    // Minimal multipart for ElevenLabs
    const boundary = '----DopForm' + randomUUID().replace(/-/g, '');
    const enc = new TextEncoder();
    const nm = (name || 'DOP Voice').replace(/[^a-zA-Z0-9 _-]/g, '');
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${nm}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="voice.webm"\r\nContent-Type: audio/webm\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = new Uint8Array(enc.encode(head).length + voiceBuffer.length + enc.encode(tail).length);
    body.set(enc.encode(head), 0);
    body.set(voiceBuffer, enc.encode(head).length);
    body.set(enc.encode(tail), enc.encode(head).length + voiceBuffer.length);

    const r = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const txt = await r.text();
    if (!r.ok) { 
      console.error('[dop-uploads] ElevenLabs error:', txt); 
      return null; 
    }
    const json = JSON.parse(txt);
    return json.voice_id || null;
  } catch (e) {
    console.error('[dop-uploads] clone error:', e.message);
    return null;
  }
}

async function createHeyGenAvatarFromImageUrl(imageUrl, name) {
  if (!process.env.HEYGEN_API_KEY) { 
    console.log('[dop-uploads] HEYGEN_API_KEY missing; skip'); 
    return null; 
  }
  try {
    const up = await heygen('upload_photo', { imageUrl, name: name || 'DOP Avatar' });
    if (!up?.image_key) throw new Error('upload_photo returned no image_key');
    
    const grp = await heygen('create_avatar_group', { imageKey: up.image_key, name: name || 'DOP Avatar' });
    if (!grp?.avatar_group_id) throw new Error('create_avatar_group returned no id');
    
    const aid = await heygen('get_avatar_id', { avatarGroupId: grp.avatar_group_id });
    const avatar_id = aid?.avatar_id;
    if (!avatar_id) throw new Error('get_avatar_id returned no avatar_id');
    
    // Optional motion/sfx - log failures but don't block
    try { 
      await heygen('add_motion', { avatarId: avatar_id }); 
    } catch (e) {
      console.warn('[dop-uploads] add_motion failed:', e.message);
    }
    try { 
      await heygen('add_sound_effect', { avatarId: avatar_id }); 
    } catch (e) {
      console.warn('[dop-uploads] add_sound_effect failed:', e.message);
    }
    
    return avatar_id;
  } catch (e) {
    console.error('[dop-uploads] heygen avatar error:', e.message);
    return null;
  }
}

async function queueHeyGenVideo(avatar_id, voice_id, script) {
  try {
    const gen = await heygen('generate_video', { avatar_id, voice_id, script, ratio: '9:16', quality: 'high' });
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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return bad(400, 'Invalid JSON in request body');
  }

  try {
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
      dopId: dopIdIn,
      session_id: sessionId   // optional: from pay-success flow; must be verified to set paid: true
    } = body;

    // Validate and sanitize inputs
    name = sanitizeInput(name, MAX_NAME_LENGTH, 'name');
    bio = sanitizeInput(bio, MAX_BIO_LENGTH, 'bio');
    
    // Use crypto for secure ID generation
    const dopId = dopIdIn || ('dop_' + randomUUID().replace(/-/g, ''));

    // If session_id provided, verify payment blob and set paid on persona (one-time use)
    let paid = false;
    if (sessionId && typeof sessionId === 'string' && sessionId.trim()) {
      const paymentStore = uploadsStore();
      const paymentKey = `payments/${sessionId.trim()}`;
      let paymentData;
      try {
        paymentData = await paymentStore.get(paymentKey, { type: 'text' });
      } catch (_) {
        paymentData = null;
      }
      if (!paymentData) {
        return bad(403, 'Invalid or already used payment session. Please pay first.');
      }
      let parsed;
      try {
        parsed = typeof paymentData === 'string' ? JSON.parse(paymentData) : paymentData;
      } catch (_) {
        return bad(403, 'Invalid payment session.');
      }
      if (!parsed || parsed.paid !== true) {
        return bad(403, 'Payment not verified.');
      }
      paid = true;
      await paymentStore.delete(paymentKey);
    }

    // Validate and decode base64 with size limits
    const imgBuf = validateAndDecodeBase64(
      photo || imageBase64, 
      MAX_IMAGE_SIZE, 
      'photo/imageBase64'
    );
    const vocBuf = validateAndDecodeBase64(
      voice || audioBase64, 
      MAX_AUDIO_SIZE, 
      'voice/audioBase64'
    );

    // --- write blobs (predictable paths + content types) ---
    const store = uploadsStore();
    const imageKey = `images/${dopId}/${imageName}`;
    const voiceKey = `voices/${dopId}/${audioName}`;
    await store.set(imageKey, imgBuf, { contentType: imageType });
    await store.set(voiceKey, vocBuf, { contentType: audioType });

    const fileUrl = (k) => `/.netlify/functions/dop-file?key=${encodeURIComponent(k)}`;
    const publicImageUrl = `${BASE_URL}${fileUrl(imageKey)}`;

    // --- optional: clone voice + create heygen avatar (with timeouts so we return before Netlify kills the function) ---
    let voice_id = null;
    let voiceCloneError = null;
    try {
      voice_id = await withTimeout(VOICE_CLONE_TIMEOUT_MS, createVoiceClone(vocBuf, name));
    } catch (e) {
      voiceCloneError = e.message || 'Voice clone timed out or failed';
      console.error('[dop-uploads] voice clone failed:', e);
    }

    let avatar_id = null;
    let avatarError = null;
    try {
      avatar_id = await withTimeout(HEYGEN_AVATAR_TIMEOUT_MS, createHeyGenAvatarFromImageUrl(publicImageUrl, name));
    } catch (e) {
      avatarError = e.message || 'Avatar creation timed out or failed';
      console.error('[dop-uploads] avatar creation failed:', e);
    }

    // --- build persona JSON ---
    const prompts = generatePersonaPrompts(bio, name);
    const pending = {};
    const failures = [];

    // Try to queue all three HeyGen renders in parallel (with timeout so we don't block the response)
    if (avatar_id) {
      const queuePromises = prompts.map((p) => {
        const script = name ? `Hi, I'm ${name}. ${p.text}` : p.text;
        return withTimeout(HEYGEN_QUEUE_TIMEOUT_MS, queueHeyGenVideo(avatar_id, voice_id || 'default', script))
          .then((task_id) => ({ key: p.key, task_id }))
          .catch(() => ({ key: p.key, task_id: null }));
      });

      const results = await Promise.all(queuePromises);
      
      for (const { key, task_id } of results) {
        if (task_id) {
          pending[key] = { task_id, started_at: Date.now() };
        } else {
          failures.push(`Failed to queue video for prompt: ${key}`);
        }
      }
    } else {
      failures.push('Avatar creation failed; cannot queue videos');
    }

    // Determine realistic status
    const hasQueuedVideos = Object.keys(pending).length > 0;
    const status = hasQueuedVideos ? 'processing' : (avatar_id ? 'pending' : 'partial');

    const persona = {
      dopId,
      name: name || 'My DOP',
      bio: bio || '',
      created: new Date().toISOString(),
      systemPrompt: generateSystemPrompt(bio, name),
      ...(paid ? { paid: true } : {}),

      // Media
      images: [{ key: imageKey, url: fileUrl(imageKey), type: imageType, name: imageName, ts: Date.now() }],
      voices: [{ key: voiceKey, url: fileUrl(voiceKey), type: audioType, name: audioName, ts: Date.now() }],

      // Engines
      voice: { id: voice_id || null, error: voiceCloneError || undefined },
      heygen: { avatar_id: avatar_id || null, error: avatarError || undefined },

      // Conversation & video gen
      prompts,
      status,
      videos: [],
      pending: hasQueuedVideos ? pending : undefined,
      failures: failures.length > 0 ? failures : undefined
    };

    await store.set(`personas/${dopId}.json`, JSON.stringify(persona), { contentType: 'application/json; charset=utf-8' });

    // Build accurate response message
    let message;
    if (hasQueuedVideos) {
      message = `DOP saved. Queued ${Object.keys(pending).length} HeyGen videos.`;
    } else if (avatar_id) {
      message = 'DOP saved. Avatar created but video queueing failed.';
    } else {
      message = 'DOP saved with media files. Avatar/video generation unavailable.';
    }

    return ok({
      success: true,
      dopId,
      voiceId: voice_id,
      heygenAvatarId: avatar_id,
      queued: Object.keys(pending).length,
      message,
      chatUrl: `/chat.html?id=${dopId}`,
      warnings: failures.length > 0 ? failures : undefined
    });

  } catch (e) {
    console.error('[dop-uploads] error:', e);
    return bad(500, 'Upload failed', { message: String(e?.message || e) });
  }
};