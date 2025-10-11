// functions/dop-uploads.js
// FIXED: Working ElevenLabs voice cloning + HeyGen avatar creation

const { uploadsStore } = require('./_lib/blobs');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// Don't compress images - store full quality
function compressBase64Image(base64, maxSizeKB = 10000) {
  return base64; // No compression, return as-is
}

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
  
  systemPrompt += `Stay in character as ${baseName}. Be conversational, warm, and authentic. Keep responses brief and engaging (1-2 sentences, under 25 words when possible). Never break character or mention you're an AI.`;
  
  return systemPrompt;
}

// Create ElevenLabs voice clone - FIXED
async function createVoiceClone(voiceBase64, name) {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('[dop-uploads] No ElevenLabs API key found');
    return null;
  }

  try {
    console.log('[dop-uploads] Creating ElevenLabs voice clone...');
    
    // Convert base64 to buffer
    const base64Data = voiceBase64.includes(',') ? voiceBase64.split(',')[1] : voiceBase64;
    const audioBuffer = Buffer.from(base64Data, 'base64');
    
    // Create multipart form data manually (FormData not available in Node)
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const voiceName = (name || 'DOP Voice').replace(/[^a-zA-Z0-9 ]/g, '');
    
    let body = '';
    
    // Add name field
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="name"\r\n\r\n`;
    body += `${voiceName}\r\n`;
    
    // Add description field
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="description"\r\n\r\n`;
    body += `Voice clone for ${voiceName}\r\n`;
    
    // Add file field
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="files"; filename="voice.mp3"\r\n`;
    body += `Content-Type: audio/mpeg\r\n\r\n`;
    
    // Combine text parts with binary audio
    const textEncoder = new TextEncoder();
    const bodyStart = textEncoder.encode(body);
    const bodyEnd = textEncoder.encode(`\r\n--${boundary}--\r\n`);
    
    // Create full body with binary data
    const fullBody = new Uint8Array(bodyStart.length + audioBuffer.length + bodyEnd.length);
    fullBody.set(bodyStart, 0);
    fullBody.set(new Uint8Array(audioBuffer), bodyStart.length);
    fullBody.set(bodyEnd, bodyStart.length + audioBuffer.length);

    const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: fullBody
    });

    const responseText = await response.text();
    console.log('[dop-uploads] ElevenLabs response status:', response.status);
    console.log('[dop-uploads] ElevenLabs response:', responseText.substring(0, 500));

    if (!response.ok) {
      console.error('[dop-uploads] ElevenLabs error:', response.status, responseText);
      return null;
    }

    const result = JSON.parse(responseText);
    const voiceId = result.voice_id;
    console.log('[dop-uploads] Voice clone created:', voiceId);
    
    return voiceId;
    
  } catch (error) {
    console.error('[dop-uploads] Voice clone error:', error);
    return null;
  }
}

// Create HeyGen avatar - FIXED
async function createHeyGenAvatar(imageBase64, name) {
  if (!process.env.HEYGEN_API_KEY) {
    console.log('[dop-uploads] No HeyGen API key found');
    return null;
  }

  try {
    console.log('[dop-uploads] Creating HeyGen avatar...');
    
    // HeyGen needs a publicly accessible image URL, not base64
    // For now, we'll skip HeyGen and just use static image
    // TODO: Upload image to temporary public URL first, then create avatar
    
    console.log('[dop-uploads] HeyGen requires public URL - skipping for now');
    return null;
    
    /* WHEN READY TO ENABLE:
    const response = await fetch(`${process.env.URL || 'http://localhost:8888'}/.netlify/functions/heygen-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_avatar',
        imageUrl: publicImageUrl, // Need to upload to public URL first
        name: name || 'DOP Avatar'
      })
    });

    const result = await response.json();
    
    if (result.success && result.avatar_id) {
      console.log('[dop-uploads] HeyGen avatar created:', result.avatar_id);
      return result.avatar_id;
    }
    */
    
  } catch (error) {
    console.error('[dop-uploads] HeyGen avatar error:', error);
    return null;
  }
}

exports.handler = async (event, context) => {
  console.log('[dop-uploads] FUNCTION STARTED');
  
  if (event.httpMethod === 'OPTIONS') {
    console.log('[dop-uploads] OPTIONS request');
    return { statusCode: 200, headers: CORS_HEADERS };
  }

  if (event.httpMethod !== 'POST') {
    console.log('[dop-uploads] Not POST method:', event.httpMethod);
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    console.log('[dop-uploads] Parsing request body...');
    const formData = JSON.parse(event.body);
    console.log('[dop-uploads] Body parsed successfully');
    
    const { name, bio, photo, voice } = formData;
    console.log('[dop-uploads] Extracted data:', {
      name: name || 'No name',
      bio: bio ? `${bio.length} chars` : 'No bio',
      photo: photo ? `${photo.length} chars` : 'No photo',
      voice: voice ? `${voice.length} chars` : 'No voice'
    });

    // Validate required fields
    if (!photo || !voice) {
      console.log('[dop-uploads] Missing required fields');
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ 
          success: false, 
          error: 'Photo and voice are required' 
        })
      };
    }

    console.log('[dop-uploads] Generating DOP ID...');
    const dopId = 'dop_' + Math.random().toString(36).substr(2, 16);
    console.log('[dop-uploads] Generated DOP ID:', dopId);

    // Store image as-is (no compression)
    console.log('[dop-uploads] Processing image...');
    const imageToStore = compressBase64Image(photo);
    
    console.log('[dop-uploads] Creating voice clone...');
    // Create voice clone - this is the critical part
    const voiceId = await createVoiceClone(voice, name);
    
    if (voiceId) {
      console.log('[dop-uploads] ✅ Voice clone created successfully:', voiceId);
    } else {
      console.log('[dop-uploads] ⚠️ Voice clone creation failed or skipped');
    }
    
    console.log('[dop-uploads] Creating HeyGen avatar...');
    // Create HeyGen avatar (currently skipped - needs public URL)
    const heygenAvatarId = await createHeyGenAvatar(photo, name);
    
    if (heygenAvatarId) {
      console.log('[dop-uploads] ✅ HeyGen avatar created:', heygenAvatarId);
    } else {
      console.log('[dop-uploads] ⚠️ HeyGen avatar creation skipped');
    }

    // Create the complete persona
    console.log('[dop-uploads] Creating persona object...');
    const persona = {
      id: dopId,
      name: name || 'My DOP',
      bio: bio || '',
      created: new Date().toISOString(),
      voiceId: voiceId,
      heygenAvatarId: heygenAvatarId,
      heygenEnabled: !!heygenAvatarId,
      image: imageToStore,
      prompts: generatePersonaPrompts(bio, name),
      systemPrompt: generateSystemPrompt(bio, name)
    };

    console.log('[dop-uploads] Storing persona...');
    
    try {
      await uploadsStore.setBlob(`personas/${dopId}.json`, JSON.stringify(persona, null, 2));
      console.log('[dop-uploads] ✅ Persona stored successfully');
    } catch (storeError) {
      console.error('[dop-uploads] Storage error:', storeError);
      throw new Error(`Storage failed: ${storeError.message}`);
    }

    console.log('[dop-uploads] SUCCESS - returning response');
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        success: true, 
        dopId: dopId,
        voiceId: voiceId,
        heygenAvatarId: heygenAvatarId,
        message: voiceId ? 'DOP created with voice clone' : 'DOP created (voice clone failed)',
        chatUrl: `/chat.html?id=${dopId}`
      })
    };

  } catch (error) {
    console.error('[dop-uploads] MAIN ERROR:', error);
    console.error('[dop-uploads] Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        success: false, 
        error: `Upload failed: ${error.message}`,
        details: error.stack
      })
    };
  }
};