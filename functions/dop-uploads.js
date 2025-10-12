// functions/dop-uploads.js
// Simplified version - just store files and create persona record

const { uploadsStore } = require('./_lib/blobs');
const { randomUUID } = require('crypto');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_AUDIO_SIZE = 10 * 1024 * 1024;
const MAX_NAME_LENGTH = 100;
const MAX_BIO_LENGTH = 2000;

const ok = (obj) => ({ 
  statusCode: 200, 
  headers: Object.assign({}, CORS, { 'content-type': 'application/json' }), 
  body: JSON.stringify(obj) 
});

const bad = (code, msg, extra) => ({ 
  statusCode: code, 
  headers: Object.assign({}, CORS, { 'content-type': 'application/json' }), 
  body: JSON.stringify(Object.assign({ success: false, error: msg }, extra || {}))
});

function isValidBase64(str) {
  if (!str || typeof str !== 'string') return false;
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return base64Regex.test(str);
}

function stripPrefix(s) {
  if (!s) return '';
  return s.includes(',') ? s.split(',')[1] : s;
}

function validateAndDecodeBase64(encoded, maxSize, fieldName) {
  const stripped = stripPrefix(encoded);
  
  if (!stripped) {
    throw new Error(fieldName + ' is required');
  }
  
  if (!isValidBase64(stripped)) {
    throw new Error(fieldName + ' is not valid base64');
  }
  
  const buffer = Buffer.from(stripped, 'base64');
  
  if (buffer.length > maxSize) {
    throw new Error(fieldName + ' exceeds maximum size of ' + maxSize + ' bytes');
  }
  
  if (buffer.length === 0) {
    throw new Error(fieldName + ' decoded to empty buffer');
  }
  
  return buffer;
}

function sanitizeInput(str, maxLength, fieldName) {
  if (!str) return '';
  if (typeof str !== 'string') {
    throw new Error(fieldName + ' must be a string');
  }
  if (str.length > maxLength) {
    throw new Error(fieldName + ' exceeds maximum length of ' + maxLength);
  }
  return str.trim();
}

function generatePersonaPrompts() {
  return [
    { key: 'fun',   text: 'What do you like to do for fun?' },
    { key: 'from',  text: 'Where are you from?' },
    { key: 'relax', text: 'What is your favorite way to relax?' },
  ];
}

function generateSystemPrompt(bio, name) {
  const n = name || 'Assistant';
  const core = bio && bio.length > 10 ? 'Here is what people should know about you: ' + bio + '. ' : '';
  return 'You are ' + n + '. ' + core + 'Stay in character as ' + n + '. Be conversational, warm, and authentic. Keep responses brief and engaging (1-2 sentences, under 25 words). Never break character or mention you are an AI.';
}

exports.handler = async (event) => {
  console.log('[dop-uploads] Function started');
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  
  if (event.httpMethod !== 'POST') {
    return bad(405, 'Method not allowed');
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
    console.log('[dop-uploads] Request body parsed');
  } catch (e) {
    console.error('[dop-uploads] JSON parse error:', e);
    return bad(400, 'Invalid JSON in request body');
  }

  try {
    let name = body.name || '';
    let bio = body.bio || '';
    const photo = body.photo || body.imageBase64;
    const voice = body.voice || body.audioBase64;
    const imageType = body.imageType || 'image/jpeg';
    const imageName = body.imageName || 'photo.jpg';
    const audioType = body.audioType || 'audio/webm';
    const audioName = body.audioName || 'voice.webm';
    const dopIdIn = body.dopId;

    console.log('[dop-uploads] Validating inputs...');

    name = sanitizeInput(name, MAX_NAME_LENGTH, 'name');
    bio = sanitizeInput(bio, MAX_BIO_LENGTH, 'bio');
    
    const dopId = dopIdIn || ('dop_' + randomUUID().replace(/-/g, ''));
    console.log('[dop-uploads] Generated dopId:', dopId);
    
    console.log('[dop-uploads] Decoding image...');
    const imgBuf = validateAndDecodeBase64(photo, MAX_IMAGE_SIZE, 'photo/imageBase64');
    console.log('[dop-uploads] Image decoded:', imgBuf.length, 'bytes');
    
    console.log('[dop-uploads] Decoding voice...');
    const vocBuf = validateAndDecodeBase64(voice, MAX_AUDIO_SIZE, 'voice/audioBase64');
    console.log('[dop-uploads] Voice decoded:', vocBuf.length, 'bytes');

    console.log('[dop-uploads] Storing files in Blobs...');
    const store = uploadsStore();
    const imageKey = 'images/' + dopId + '/' + imageName;
    const voiceKey = 'voices/' + dopId + '/' + audioName;
    
    await store.set(imageKey, imgBuf, { contentType: imageType });
    console.log('[dop-uploads] Image stored:', imageKey);
    
    await store.set(voiceKey, vocBuf, { contentType: audioType });
    console.log('[dop-uploads] Voice stored:', voiceKey);

    const fileUrl = function(k) {
      return '/.netlify/functions/dop-file?key=' + encodeURIComponent(k);
    };

    const prompts = generatePersonaPrompts();
    
    const persona = {
      dopId: dopId,
      name: name || 'My DOP',
      bio: bio || '',
      created: new Date().toISOString(),
      systemPrompt: generateSystemPrompt(bio, name),
      images: [{ 
        key: imageKey, 
        url: fileUrl(imageKey), 
        type: imageType, 
        name: imageName, 
        ts: Date.now() 
      }],
      voices: [{ 
        key: voiceKey, 
        url: fileUrl(voiceKey), 
        type: audioType, 
        name: audioName, 
        ts: Date.now() 
      }],
      prompts: prompts,
      status: 'uploaded',
      videos: [],
      voice: { id: null, status: 'pending' },
      heygen: { avatar_id: null, status: 'pending' }
    };

    console.log('[dop-uploads] Storing persona JSON...');
    const personaKey = 'personas/' + dopId + '.json';
    await store.set(personaKey, JSON.stringify(persona), { 
      contentType: 'application/json; charset=utf-8' 
    });
    console.log('[dop-uploads] Persona stored successfully');

    return ok({
      success: true,
      dopId: dopId,
      message: 'DOP files uploaded successfully! Processing will complete in the background.',
      chatUrl: '/chat.html?id=' + dopId,
      status: 'uploaded'
    });

  } catch (e) {
    console.error('[dop-uploads] Error:', e);
    return bad(500, 'Upload failed', { 
      message: String(e && e.message ? e.message : e),
      details: e && e.stack ? e.stack : undefined
    });
  }
};
