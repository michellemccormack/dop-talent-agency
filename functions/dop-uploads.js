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
// Run voice + HeyGen in parallel so total time = max(voice, heygen), not sum.
const VOICE_CLONE_TIMEOUT_MS = 18000;   // 18s – ElevenLabs clone can be slow
const HEYGEN_AVATAR_TIMEOUT_MS = 18000; // 18s – run in parallel with voice
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
  console.log(`[heygen] calling ${action} with`, JSON.stringify(payload).substring(0, 200));
  const res = await fetch(`${BASE_URL}/.netlify/functions/heygen-proxy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const message = data?.details || data?.message || data?.error || `HTTP ${res.status}`;
    console.error(`[heygen ${action}] FAILED:`, message, 'full response:', JSON.stringify(data));
    throw new Error(`[heygen ${action}] ${message}`);
  }
  return data;
}

async function createVoiceClone(voiceBuffer, name, audioType = 'audio/webm', audioName = 'voice.webm') {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('[dop-uploads] ElevenLabs key missing; skipping clone');
    return null;
  }
  try {
    const boundary = '----DopForm' + randomUUID().replace(/-/g, '');
    const enc = new TextEncoder();
    const nm = (name || 'DOP Voice').replace(/[^a-zA-Z0-9 _-]/g, '');
    const mime = (audioType && audioType.startsWith('audio/')) ? audioType : 'audio/webm';
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${nm}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${(audioName || 'voice.webm').replace(/[^a-zA-Z0-9._-]/g, '_')}"\r\nContent-Type: ${mime}\r\n\r\n`;
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

async function queueHeyGenVideo(avatarId, voiceId, text) {
  if (!avatarId || !text) return null;
  try {
    const gen = await heygen('generate_video', { text, avatarId, voiceId: voiceId || undefined });
    return { task_id: gen.task_id, video_id: gen.video_id };
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

    // --- save persona to Blobs IMMEDIATELY so chat can load it even if we timeout below ---
    const personaKey = `personas/${dopId}.json`;
    const prompts = generatePersonaPrompts(bio, name);
    const minimalPersona = {
      dopId,
      name: name || 'My DOP',
      bio: bio || '',
      created: new Date().toISOString(),
      systemPrompt: generateSystemPrompt(bio, name),
      ...(paid ? { paid: true } : {}),
      image: imgBuf.toString('base64'),  // Add base64 image for immediate display
      images: [{ key: imageKey, url: fileUrl(imageKey), type: imageType, name: imageName, ts: Date.now() }],
      voices: [{ key: voiceKey, url: fileUrl(voiceKey), type: audioType, name: audioName, ts: Date.now() }],
      voiceId: null,  // Will be filled if ElevenLabs succeeds
      voice: { id: null },
      heygen: { avatar_id: null },
      prompts,
      status: 'pending',
      videos: []
    };
    await store.set(personaKey, JSON.stringify(minimalPersona), { contentType: 'application/json; charset=utf-8' });
    console.log('[dop-uploads] saved minimal persona:', personaKey);

    // --- Run voice clone and HeyGen avatar in parallel (with timeouts) ---
    const [voiceResult, avatarResult] = await Promise.allSettled([
      withTimeout(VOICE_CLONE_TIMEOUT_MS, createVoiceClone(vocBuf, name, audioType, audioName)),
      withTimeout(HEYGEN_AVATAR_TIMEOUT_MS, createHeyGenAvatarFromImageUrl(publicImageUrl, name))
    ]);

    const voiceId = voiceResult.status === 'fulfilled' && voiceResult.value ? voiceResult.value : null;
    const avatarId = avatarResult.status === 'fulfilled' && avatarResult.value ? avatarResult.value : null;

    if (voiceResult.status === 'rejected') {
      console.log('[dop-uploads] voice clone error:', voiceResult.reason?.message || voiceResult.reason);
    } else {
      console.log('[dop-uploads] voice clone result:', voiceId || 'timeout/failed');
    }
    if (avatarResult.status === 'rejected') {
      console.log('[dop-uploads] HeyGen avatar error:', avatarResult.reason?.message || avatarResult.reason);
    } else {
      console.log('[dop-uploads] HeyGen avatar result:', avatarId || 'timeout/failed');
    }

    // --- Update persona with voice/avatar if we got them ---
    if (voiceId || avatarId) {
      const updatedPersona = {
        ...minimalPersona,
        voiceId: voiceId || null,
        voice: { id: voiceId || null },
        heygen: { avatar_id: avatarId || null },
        pending: {}  // HeyGen video task_ids for heygen_video_processor to poll
      };

      // Queue HeyGen videos for the 3 prompts (moving avatar) – processor will fill URLs later
      const videoScripts = [
        { key: 'fun', text: "I love having fun! What do you like to do?" },
        { key: 'from', text: "I'm from all over. Where are you from?" },
        { key: 'relax', text: (bio && bio.length > 10) ? `I like to relax by ${bio.slice(0, 80)}. What's your favorite way to relax?` : "I like to relax. What's your favorite way to relax?" }
      ];

      const queueTimeoutMs = 6000;  // 6s total for 3 parallel calls
      const queueResults = await Promise.allSettled(
        videoScripts.map(({ key, text }) =>
          withTimeout(queueTimeoutMs, queueHeyGenVideo(avatarId, voiceId, text))
        )
      );

      for (let i = 0; i < queueResults.length; i++) {
        const res = queueResults[i];
        const key = videoScripts[i].key;
        if (res.status === 'fulfilled' && res.value && (res.value.task_id || res.value.video_id)) {
          updatedPersona.pending[key] = { task_id: res.value.task_id, video_id: res.value.video_id };
          console.log('[dop-uploads] queued video for', key, res.value.task_id || res.value.video_id);
        }
      }
      if (Object.keys(updatedPersona.pending).length > 0) {
        updatedPersona.status = 'processing';  // chat will poll until videos are ready
      }

      await store.set(personaKey, JSON.stringify(updatedPersona), { contentType: 'application/json; charset=utf-8' });
      console.log('[dop-uploads] updated persona with voice/avatar and', Object.keys(updatedPersona.pending).length, 'pending videos');

      return ok({
        success: true,
        dopId,
        persona: updatedPersona,
        message: 'DOP created! Videos will appear when ready.',
        chatUrl: `/chat.html?id=${dopId}`
      });
    }

    // Return minimal persona if voice/avatar failed
    return ok({
      success: true,
      dopId,
      persona: minimalPersona,
      message: 'DOP saved. Voice/avatar processing in progress.',
      chatUrl: `/chat.html?id=${dopId}`
    });

  } catch (e) {
    console.error('[dop-uploads] error:', e);
    return bad(500, 'Upload failed', { message: String(e?.message || e) });
  }
};