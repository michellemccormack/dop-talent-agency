// functions/dop-uploads.js
// UPDATED: Creates 3 HeyGen videos during upload (takes 2-3 minutes)

const { uploadsStore } = require('./_lib/blobs');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// Generate persona prompts based on bio
function generatePersonaPrompts(bio, name) {
  if (bio && bio.trim().length > 10) {
    return [
      "What do you like to do for fun?",
      "Tell me about your background",
      "What makes you unique?"
    ];
  }
  
  return [
    "What do you like to do for fun?",
    "Tell me about yourself",
    "What's your personality like?"
  ];
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
    const base64Data = voiceBase64.includes(',') ? voiceBase64.split(',')[1] : voiceBase64;
    const audioBuffer = Buffer.from(base64Data, 'base64');
    
    // Create multipart form data manually
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

    if (!response.ok) {
      console.error('[dop-uploads] ElevenLabs error:', response.status, responseText);
      return null;
    }

    const result = JSON.parse(responseText);
    const voiceId = result.voice_id;
    console.log('[dop-uploads] ✅ Voice clone created:', voiceId);
    
    return voiceId;
    
  } catch (error) {
    console.error('[dop-uploads] Voice clone error:', error);
    return null;
  }
}

// Create HeyGen avatar from public image URL
async function createHeyGenAvatar(imageUrl, name) {
  if (!process.env.HEYGEN_API_KEY) {
    console.log('[dop-uploads] No HeyGen API key found');
    return null;
  }

  try {
    console.log('[dop-uploads] Creating HeyGen avatar from:', imageUrl.substring(0, 50) + '...');
    
    const baseUrl = process.env.URL || 'https://dopple-talent-demo.netlify.app';
    const response = await fetch(`${baseUrl}/.netlify/functions/heygen-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_avatar',
        imageUrl: imageUrl,
        name: name || 'DOP Avatar'
      })
    });

    const result = await response.json();
    console.log('[dop-uploads] HeyGen avatar response:', result);
    
    if (result.success && result.avatar_id) {
      console.log('[dop-uploads] ✅ HeyGen avatar created:', result.avatar_id);
      return result.avatar_id;
    } else {
      console.log('[dop-uploads] ⚠️ HeyGen avatar creation failed:', result);
      return null;
    }
    
  } catch (error) {
    console.error('[dop-uploads] HeyGen avatar error:', error);
    return null;
  }
}

// Generate a HeyGen video for a prompt
async function generateHeyGenVideo(avatarId, voiceId, promptText, name) {
  if (!process.env.HEYGEN_API_KEY) {
    return null;
  }

  try {
    console.log('[dop-uploads] Generating video for prompt:', promptText.substring(0, 50));
    
    // Generate response text using simple logic (could use GPT later)
    const responseText = `Hi, I'm ${name || 'your DOP'}. ${promptText}`;
    
    const baseUrl = process.env.URL || 'https://dopple-talent-demo.netlify.app';
    const response = await fetch(`${baseUrl}/.netlify/functions/heygen-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generate_video',
        text: responseText,
        avatarId: avatarId,
        voiceId: voiceId || 'default'
      })
    });

    const result = await response.json();
    
    if (result.success && result.video_id) {
      console.log('[dop-uploads] ✅ Video generation started:', result.video_id);
      return result.video_id;
    } else {
      console.log('[dop-uploads] ⚠️ Video generation failed:', result);
      return null;
    }
    
  } catch (error) {
    console.error('[dop-uploads] Video generation error:', error);
    return null;
  }
}

// Poll for video completion
async function waitForVideo(videoId, maxWaitSeconds = 180) {
  if (!videoId) return null;
  
  console.log('[dop-uploads] Waiting for video:', videoId);
  const baseUrl = process.env.URL || 'https://dopple-talent-demo.netlify.app';
  
  const startTime = Date.now();
  
  while ((Date.now() - startTime) < maxWaitSeconds * 1000) {
    try {
      const response = await fetch(`${baseUrl}/.netlify/functions/heygen-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check_video',
          videoId: videoId
        })
      });

      const result = await response.json();
      
      if (result.success && result.status === 'completed' && result.video_url) {
        console.log('[dop-uploads] ✅ Video ready:', result.video_url.substring(0, 50) + '...');
        return result.video_url;
      } else if (result.status === 'failed') {
        console.log('[dop-uploads] ⚠️ Video generation failed');
        return null;
      }
      
      // Still processing, wait and retry
      console.log('[dop-uploads] Video still processing, waiting...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
    } catch (error) {
      console.error('[dop-uploads] Video check error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  console.log('[dop-uploads] ⚠️ Video timed out after', maxWaitSeconds, 'seconds');
  return null;
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

    // Store image as separate file in blobs
    console.log('[dop-uploads] Storing image file...');
    const imageKey = `images/${dopId}.jpg`;
    const base64Data = photo.includes(',') ? photo.split(',')[1] : photo;
    await uploadsStore.setBlob(imageKey, base64Data);
    
    // Generate public URL for image
    const baseUrl = process.env.URL || 'https://dopple-talent-demo.netlify.app';
    const publicImageUrl = `${baseUrl}/.netlify/functions/dop-file?key=${imageKey}`;
    console.log('[dop-uploads] Public image URL:', publicImageUrl);
    
    // Create voice clone
    console.log('[dop-uploads] Creating voice clone...');
    const voiceId = await createVoiceClone(voice, name);
    
    if (voiceId) {
      console.log('[dop-uploads] ✅ Voice clone created successfully:', voiceId);
    } else {
      console.log('[dop-uploads] ⚠️ Voice clone creation failed');
    }
    
    // Create HeyGen avatar
    console.log('[dop-uploads] Creating HeyGen avatar...');
    const heygenAvatarId = await createHeyGenAvatar(publicImageUrl, name);
    
    let videoUrls = {};
    
    if (heygenAvatarId) {
      console.log('[dop-uploads] ✅ HeyGen avatar created, generating videos...');
      
      // Generate prompts
      const prompts = generatePersonaPrompts(bio, name);
      
      // Generate 3 videos (this will take 2-3 minutes total)
      for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        console.log(`[dop-uploads] Generating video ${i + 1}/3 for:`, prompt);
        
        const videoId = await generateHeyGenVideo(heygenAvatarId, voiceId, prompt, name);
        
        if (videoId) {
          const videoUrl = await waitForVideo(videoId);
          if (videoUrl) {
            videoUrls[`prompt${i}`] = videoUrl;
            console.log(`[dop-uploads] ✅ Video ${i + 1}/3 ready`);
          }
        }
      }
      
      console.log('[dop-uploads] Generated', Object.keys(videoUrls).length, 'videos');
    } else {
      console.log('[dop-uploads] ⚠️ HeyGen avatar creation skipped or failed');
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
      heygenEnabled: !!heygenAvatarId && Object.keys(videoUrls).length > 0,
      imageKey: imageKey,
      imageUrl: publicImageUrl,
      image: photo, // Keep base64 for avatar display
      prompts: generatePersonaPrompts(bio, name),
      videoUrls: videoUrls, // Store video URLs
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
    
    const videosCreated = Object.keys(videoUrls).length;
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        success: true, 
        dopId: dopId,
        voiceId: voiceId,
        heygenAvatarId: heygenAvatarId,
        videosCreated: videosCreated,
        message: videosCreated > 0 
          ? `DOP created with ${videosCreated} HeyGen videos!` 
          : 'DOP created (HeyGen videos failed)',
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