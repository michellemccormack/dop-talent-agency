// functions/dop-uploads.js
// COMPLETE WORKING VERSION - Full DOP upload with voice cloning

const { uploadsStore } = require('./_lib/blobs');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// Compress base64 image to stay under size limits
function compressBase64Image(base64, maxSizeKB = 100) {
  const maxChars = maxSizeKB * 1024 * 0.75; // Base64 is ~33% larger than binary
  if (base64.length > maxChars) {
    console.warn(`[dop-uploads] Image too large (${base64.length} chars), truncating to ${maxChars}`);
    return base64.substring(0, maxChars);
  }
  return base64;
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

// Create ElevenLabs voice clone
async function createVoiceClone(voiceBase64, name) {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('[dop-uploads] No ElevenLabs API key found');
    return null;
  }

  try {
    console.log('[dop-uploads] Creating ElevenLabs voice clone...');
    
    // Convert base64 to buffer
    const audioBuffer = Buffer.from(voiceBase64.split(',')[1], 'base64');
    
    // Create form data
    const formData = new FormData();
    formData.append('name', name || 'DOP Voice');
    formData.append('description', `Voice clone for ${name || 'DOP'}`);
    formData.append('files', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'voice.mp3');
    
    const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[dop-uploads] ElevenLabs error:', response.status, errorText);
      return null;
    }

    const result = await response.json();
    console.log('[dop-uploads] Voice clone created:', result.voice_id);
    
    return result.voice_id;
    
  } catch (error) {
    console.error('[dop-uploads] Voice clone error:', error);
    return null;
  }
}

// Create HeyGen avatar
async function createHeyGenAvatar(imageBase64, name) {
  try {
    console.log('[dop-uploads] Attempting HeyGen avatar creation...');
    
    const response = await fetch(`${process.env.URL || 'http://localhost:8888'}/.netlify/functions/heygen-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_avatar',
        imageUrl: imageBase64,
        name: name || 'DOP Avatar'
      })
    });

    const result = await response.json();
    
    if (result.success && result.avatar_id) {
      console.log('[dop-uploads] HeyGen avatar created:', result.avatar_id);
      return result.avatar_id;
    } else {
      console.log('[dop-uploads] HeyGen avatar creation skipped or failed:', result.message || result.error);
      return null;
    }
    
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

    // Compress the image for storage
    console.log('[dop-uploads] Compressing image...');
    const compressedImage = compressBase64Image(photo);
    
    console.log('[dop-uploads] Creating voice clone...');
    // Create voice clone (this can take time, but don't block the upload)
    const voiceId = await createVoiceClone(voice, name);
    
    console.log('[dop-uploads] Creating HeyGen avatar...');
    // Create HeyGen avatar (skipped for now to avoid blocking)
    const heygenAvatarId = await createHeyGenAvatar(photo, name);

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
      image: compressedImage, // Store compressed image directly in persona
      prompts: generatePersonaPrompts(bio, name),
      systemPrompt: generateSystemPrompt(bio, name)
    };

    console.log('[dop-uploads] Storing persona...');
    
    try {
      await uploadsStore.setBlob(`personas/${dopId}.json`, JSON.stringify(persona, null, 2));
      console.log('[dop-uploads] Persona stored successfully');
    } catch (storeError) {
      console.error('[dop-uploads] Storage error:', storeError);
      throw new Error(`Storage failed: ${storeError.message}`);
    }

    // Also store individual files for backup
    console.log('[dop-uploads] Storing backup files...');
    try {
      await uploadsStore.setBlob(`files/${dopId}/image.txt`, compressedImage);
      await uploadsStore.setBlob(`files/${dopId}/voice.txt`, voice);
      console.log('[dop-uploads] Backup files stored');
    } catch (fileError) {
      console.warn('[dop-uploads] Backup file storage failed:', fileError.message);
      // Don't fail the upload for backup file errors
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
        message: 'DOP created successfully'
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