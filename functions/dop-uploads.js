// functions/dop-uploads.js
// Fixed: Store image separately to avoid size limits

const { uploadsStore } = require('./_lib/blobs');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// Generate persona prompts based on bio
function generatePersonaPrompts(bio, name) {
  const defaultPrompts = [
    "What do you like to do for fun?",
    "Tell me about yourself",
    "What's your personality like?"
  ];
  
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

// Create HeyGen avatar from image (with error handling)
async function createHeyGenAvatar(imageBase64, name) {
  try {
    // Convert base64 to data URL for HeyGen
    const imageDataUrl = `data:image/jpeg;base64,${imageBase64}`;
    
    const response = await fetch(`${process.env.URL || 'https://dopple-talent-demo.netlify.app'}/.netlify/functions/heygen-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_avatar',
        imageUrl: imageDataUrl,
        name: name || 'User Avatar'
      })
    });

    const result = await response.json();
    
    if (result.success) {
      return result.avatar_id;
    } else {
      console.warn('[dop-uploads] HeyGen avatar creation failed:', result);
      return null;
    }
  } catch (error) {
    console.warn('[dop-uploads] HeyGen avatar creation error:', error);
    return null;
  }
}

// Create persona.json for the DOP (without large base64 image)
function createPersonaConfig(dopId, name, bio, imageKey, voiceKey, avatarId) {
  const dopName = name || `DOP_${dopId.slice(0, 8)}`;
  const systemPrompt = generateSystemPrompt(bio, dopName);
  const prompts = generatePersonaPrompts(bio, dopName);
  const voiceId = process.env.DEFAULT_VOICE_ID || 'kDIJK53VQMjfQj3fCrML';
  
  return {
    id: dopId,
    name: dopName,
    displayName: dopName,
    title: `${dopName}'s DOP`,
    system: systemPrompt,
    instructions: systemPrompt,
    description: bio || `I'm ${dopName}, your AI doppelganger. Ask me anything!`,
    
    // Media assets - reference keys instead of embedding data
    image: imageKey,
    avatar: imageKey,
    voice: voiceKey,
    voiceId: voiceId,
    
    // HeyGen integration
    heygenAvatarId: avatarId,
    heygenEnabled: !!avatarId,
    
    // Conversation prompts
    prompts: prompts,
    
    // Metadata
    createdAt: new Date().toISOString(),
    type: 'user-generated',
    version: '2.1'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

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

    // Normalize inputs
    let imgBuf, imgMime, imgName, imgBase64;
    let audBuf, audMime, audName;

    if (hasBase64Pair) {
      imgBase64 = body.imageBase64;
      imgBuf = Buffer.from(imgBase64, 'base64');
      imgMime = body.imageType || 'image/jpeg';
      imgName = safe(stripExt(body.imageName) || 'photo');

      audBuf = Buffer.from(body.audioBase64, 'base64');
      audMime = body.audioType || 'audio/mpeg';
      audName = safe(stripExt(body.audioName) || 'voice');
    } else {
      const i = parseDataUrl(body.image);
      const a = parseDataUrl(body.voice);
      imgBuf = i.buffer;
      imgBase64 = imgBuf.toString('base64');
      imgMime = i.mime;
      imgName = safe(stripExt(body.imageName) || 'photo');

      audBuf = a.buffer;
      audMime = a.mime;
      audName = safe(stripExt(body.voiceName) || 'voice');
    }

    // Store image and voice files
    const imgKey = `images/${dopId}/${imgName}.${extFromMime(imgMime)}`;
    const voiceKey = `voices/${dopId}/${audName}.${extFromMime(audMime)}`;
    
    await store.set(imgKey, imgBuf, { contentType: imgMime });
    await store.set(voiceKey, audBuf, { contentType: audMime });

    // Store base64 image separately for instant display
    const imgBase64Key = `images/${dopId}/base64.txt`;
    await store.set(imgBase64Key, imgBase64, { contentType: 'text/plain' });

    // Create HeyGen avatar (with error tolerance)
    const dopName = body.dopName || body.name || null;
    console.log('[dop-uploads] Creating HeyGen avatar...');
    
    let avatarId = null;
    try {
      avatarId = await createHeyGenAvatar(imgBase64, dopName);
      if (avatarId) {
        console.log('[dop-uploads] HeyGen avatar created:', avatarId);
      }
    } catch (error) {
      console.warn('[dop-uploads] HeyGen avatar creation failed, continuing without avatar:', error);
    }

    // Generate persona.json (small, without embedded image)
    const bio = body.bio || body.description || '';
    const personaConfig = createPersonaConfig(dopId, dopName, bio, imgBase64Key, voiceKey, avatarId);
    const personaKey = `personas/${dopId}.json`;
    
    await store.set(personaKey, JSON.stringify(personaConfig, null, 2), { 
      contentType: 'application/json' 
    });

    // Write metadata
    const meta = {
      dopId,
      name: dopName,
      bio: bio,
      createdAt: new Date().toISOString(),
      
      image: { key: imgKey, contentType: imgMime, bytes: imgBuf.length },
      imageBase64: { key: imgBase64Key, contentType: 'text/plain' },
      voice: { key: voiceKey, contentType: audMime, bytes: audBuf.length },
      persona: { key: personaKey, contentType: 'application/json' },
      
      // HeyGen info
      heygenAvatarId: avatarId,
      heygenEnabled: !!avatarId,
      
      status: 'ready',
      version: '2.1'
    };
    
    const metaKey = `metas/${dopId}.json`;
    await store.set(metaKey, JSON.stringify(meta, null, 2), { 
      contentType: 'application/json' 
    });

    console.log(`[dop-uploads] Created DOP ${dopId} with HeyGen integration`);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ 
        ok: true, 
        dopId, 
        name: dopName,
        heygenEnabled: !!avatarId,
        files: { 
          image: imgKey,
          imageBase64: imgBase64Key,
          voice: voiceKey, 
          persona: personaKey 
        },
        status: 'ready',
        conversationUrl: `/chat/${dopId}`
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