// functions/dop-uploads.js
// Updated to auto-generate persona.json for uploaded DOPs (Task 29)

const { uploadsStore } = require('./_lib/blobs');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// Generate persona prompts based on bio
function generatePersonaPrompts(bio, name) {
  const baseName = name || 'Your DOP';
  
  // Default prompts that work for any personality
  const defaultPrompts = [
    "What do you like to do for fun?",
    "Tell me about yourself",
    "What's your personality like?"
  ];
  
  // If bio is provided, create more personalized prompts
  if (bio && bio.trim().length > 10) {
    return [
      "What do you like to do for fun?",
      "Tell me about your background",
      "What makes you unique?",
      "What are you passionate about?"
    ];
  }
  
  return defaultPrompts;
}

// Generate system prompt based on bio and name
function generateSystemPrompt(bio, name) {
  const baseName = name || 'Assistant';
  
  let systemPrompt = `You are ${baseName}. `;
  
  if (bio && bio.trim().length > 10) {
    systemPrompt += `Here's what people should know about you: ${bio.trim()}. `;
  }
  
  systemPrompt += `Stay in character as ${baseName}. Be conversational, warm, and authentic. Keep responses brief and engaging (1-2 sentences, under 25 words when possible). Never break character or mention you're an AI. If you don't know something specific about yourself, redirect gracefully and keep the conversation flowing.`;
  
  return systemPrompt;
}

// Map uploaded voice to ElevenLabs voice ID
function getVoiceIdForDOP(dopId, audioType) {
  // For now, we'll use the fallback voice since we need to clone the uploaded voice
  // In a full implementation, this would trigger voice cloning with the uploaded sample
  return process.env.DEFAULT_VOICE_ID || 'kDIJK53VQMjfQj3fCrML';
}

// Create persona.json for the DOP
function createPersonaConfig(dopId, name, bio, imageKey, voiceKey) {
  const dopName = name || `DOP_${dopId.slice(0, 8)}`;
  const systemPrompt = generateSystemPrompt(bio, dopName);
  const prompts = generatePersonaPrompts(bio, dopName);
  const voiceId = getVoiceIdForDOP(dopId, 'audio/mpeg');
  
  return {
    id: dopId,
    name: dopName,
    displayName: dopName,
    title: `${dopName}'s DOP`,
    system: systemPrompt,
    instructions: systemPrompt,
    description: bio || `I'm ${dopName}, your AI doppelganger. Ask me anything!`,
    
    // Media assets
    image: imageKey,
    avatar: imageKey, // Use same image for avatar
    voice: voiceKey,
    voiceId: voiceId,
    
    // Conversation prompts
    prompts: prompts,
    
    // Metadata
    createdAt: new Date().toISOString(),
    type: 'user-generated',
    version: '1.0'
  };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // Accept either base64 pairs OR data URLs (backward compatible)
    const hasBase64Pair = body.imageBase64 && body.audioBase64;
    const hasDataUrls = body.image && body.voice;

    if (!hasBase64Pair && !hasDataUrls) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Missing image/audio (expected imageBase64+audioBase64 OR data URLs)' 
        }),
      };
    }

    const store = uploadsStore();

    // Generate unique DOP ID
    const dopId = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID()
      : String(Date.now());

    const safe = (s) => String(s || '').trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'file';
    const stripExt = (s) => String(s || '').replace(/\.[^./\\]+$/i, '');
    const extFromMime = (mime) => (mime.split('/')[1] || 'bin').toLowerCase();

    const parseDataUrl = (dataUrl) => {
      const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
      if (!m) throw new Error('Bad data URL');
      return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
    };

    // Normalize inputs -> buffers + mimes + names
    let imgBuf, imgMime, imgName;
    let audBuf, audMime, audName;

    if (hasBase64Pair) {
      imgBuf = Buffer.from(body.imageBase64, 'base64');
      imgMime = body.imageType || 'image/png';
      imgName = safe(stripExt(body.imageName) || 'photo');

      audBuf = Buffer.from(body.audioBase64, 'base64');
      audMime = body.audioType || 'audio/mpeg';
      audName = safe(stripExt(body.audioName) || 'voice');
    } else {
      const i = parseDataUrl(body.image);
      const a = parseDataUrl(body.voice);
      imgBuf = i.buffer;
      imgMime = i.mime;
      imgName = safe(stripExt(body.imageName) || 'photo');

      audBuf = a.buffer;
      audMime = a.mime;
      audName = safe(stripExt(body.voiceName) || 'voice');
    }

    // Create storage keys
    const imgKey = `images/${dopId}/${imgName}.${extFromMime(imgMime)}`;
    const voiceKey = `voices/${dopId}/${audName}.${extFromMime(audMime)}`;

    // Write image and voice files
    await store.set(imgKey, imgBuf, { contentType: imgMime });
    await store.set(voiceKey, audBuf, { contentType: audMime });

    // NEW: Generate persona.json automatically
    const dopName = body.dopName || body.name || null;
    const bio = body.bio || body.description || '';
    
    const personaConfig = createPersonaConfig(dopId, dopName, bio, imgKey, voiceKey);
    const personaKey = `personas/${dopId}.json`;
    
    await store.set(personaKey, JSON.stringify(personaConfig, null, 2), { 
      contentType: 'application/json' 
    });

    // Write comprehensive metadata
    const meta = {
      dopId,
      name: dopName,
      bio: bio,
      createdAt: new Date().toISOString(),
      
      // File info
      image: { key: imgKey, contentType: imgMime, bytes: imgBuf.length },
      voice: { key: voiceKey, contentType: audMime, bytes: audBuf.length },
      persona: { key: personaKey, contentType: 'application/json' },
      
      // Status
      status: 'ready', // Mark as ready for conversation
      version: '1.0'
    };
    
    const metaKey = `metas/${dopId}.json`;
    await store.set(metaKey, JSON.stringify(meta, null, 2), { 
      contentType: 'application/json' 
    });

    console.log(`[dop-uploads] Created DOP ${dopId} with persona auto-build`);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ 
        ok: true, 
        dopId, 
        name: dopName,
        files: { 
          image: imgKey, 
          voice: voiceKey, 
          persona: personaKey 
        },
        status: 'ready',
        conversationUrl: `/chat/${dopId}` // Where people can talk to this DOP
      }),
    };
  } catch (err) {
    console.error('[dop-uploads] Error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};