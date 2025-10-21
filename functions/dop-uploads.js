// functions/dop-uploads.js
// Fixed version with proper URLs

const { uploadsStore } = require('./_lib/blobs');
const { randomUUID } = require('crypto');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function jsonResponse(statusCode, data) {
  return {
    statusCode: statusCode,
    headers: Object.assign({}, CORS, { 'content-type': 'application/json' }),
    body: JSON.stringify(data)
  };
}

function stripDataPrefix(dataUrl) {
  if (!dataUrl) return '';
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.substring(commaIndex + 1) : dataUrl;
}

// Trigger video generation for a new DOP
async function triggerVideoGeneration(dopId, persona) {
  console.log('[dop-uploads] Starting video generation for:', dopId);
  
  try {
    // Step 1: Upload photo to HeyGen
    const imageUrl = persona.images[0].url;
    const uploadResponse = await fetch('/.netlify/functions/heygen-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upload_photo',
        imageUrl: imageUrl,
        name: persona.name || 'DOP'
      })
    });
    
    if (!uploadResponse.ok) {
      throw new Error('Photo upload to HeyGen failed');
    }
    
    const uploadData = await uploadResponse.json();
    const imageKey = uploadData.image_key;
    console.log('[dop-uploads] Photo uploaded to HeyGen:', imageKey);
    
    // Step 2: Create avatar group
    const groupResponse = await fetch('/.netlify/functions/heygen-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_avatar_group',
        imageKey: imageKey,
        name: persona.name || 'DOP'
      })
    });
    
    if (!groupResponse.ok) {
      throw new Error('Avatar group creation failed');
    }
    
    const groupData = await groupResponse.json();
    const avatarGroupId = groupData.avatar_group_id;
    console.log('[dop-uploads] Avatar group created:', avatarGroupId);
    
    // Step 3: Get avatar ID
    const avatarResponse = await fetch('/.netlify/functions/heygen-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get_avatar_id',
        avatarGroupId: avatarGroupId
      })
    });
    
    if (!avatarResponse.ok) {
      throw new Error('Failed to get avatar ID');
    }
    
    const avatarData = await avatarResponse.json();
    const avatarId = avatarData.avatar_id;
    console.log('[dop-uploads] Got avatar ID:', avatarId);
    
    // Step 4: Generate videos for each prompt
    const videoPromises = persona.prompts.map(async (prompt, index) => {
      try {
        const videoResponse = await fetch('/.netlify/functions/heygen-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate_video',
            text: prompt.text,
            avatarId: avatarId,
            voiceId: 'default'
          })
        });
        
        if (!videoResponse.ok) {
          throw new Error(`Video generation failed for prompt ${index}`);
        }
        
        const videoData = await videoResponse.json();
        console.log('[dop-uploads] Video generation started for prompt', index, ':', videoData.video_id);
        
        return {
          prompt: prompt.key,
          requestId: videoData.video_id,
          status: 'processing'
        };
      } catch (error) {
        console.error('[dop-uploads] Video generation error for prompt', index, ':', error.message);
        return {
          prompt: prompt.key,
          requestId: null,
          status: 'failed',
          error: error.message
        };
      }
    });
    
    const videoResults = await Promise.all(videoPromises);
    console.log('[dop-uploads] All video generation requests completed');
    
    // Update persona with video request IDs
    const store = uploadsStore();
    const personaKey = 'personas/' + dopId + '.json';
    const updatedPersona = {
      ...persona,
      status: 'processing',
      pending: {
        videoRequests: videoResults.map(result => ({
          prompt: result.prompt,
          requestId: result.requestId,
          status: result.status
        }))
      }
    };
    
    await store.set(personaKey, JSON.stringify(updatedPersona), { 
      contentType: 'application/json'
    });
    
    console.log('[dop-uploads] Persona updated with video requests');
    
  } catch (error) {
    console.error('[dop-uploads] Video generation trigger failed:', error);
    throw error;
  }
}

exports.handler = async (event) => {
  console.log('[dop-uploads] START');
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    console.log('[dop-uploads] Parsing body');
    const body = JSON.parse(event.body || '{}');
    
    const photo = body.photo || body.imageBase64;
    const voice = body.voice || body.audioBase64;
    const name = (body.name || 'My DOP').trim();
    const bio = (body.bio || '').trim();
    const bioFacts = Array.isArray(body.bioFacts) ? body.bioFacts : [];
    const email = (body.email || '').trim();
    
    if (!photo || !voice) {
      return jsonResponse(400, { error: 'Both photo and voice required' });
    }
    
    console.log('[dop-uploads] Generating dopId');
    const dopId = 'dop_' + randomUUID().replace(/-/g, '');
    
    console.log('[dop-uploads] Decoding files');
    const imgBuf = Buffer.from(stripDataPrefix(photo), 'base64');
    const vocBuf = Buffer.from(stripDataPrefix(voice), 'base64');
    console.log('[dop-uploads] Image:', imgBuf.length, 'bytes');
    console.log('[dop-uploads] Voice:', vocBuf.length, 'bytes');
    
    console.log('[dop-uploads] Storing files');
    const store = uploadsStore();
    const imageKey = 'images/' + dopId + '/photo.jpg';
    const voiceKey = 'voices/' + dopId + '/voice.webm';
    
    await store.set(imageKey, imgBuf, { contentType: 'image/jpeg' });
    console.log('[dop-uploads] Image stored');
    
    await store.set(voiceKey, vocBuf, { contentType: 'audio/webm' });
    console.log('[dop-uploads] Voice stored');
    
    console.log('[dop-uploads] Creating persona');
    
    // Helper to generate file URLs
    const fileUrl = function(key) {
      return '/.netlify/functions/dop-file?key=' + encodeURIComponent(key);
    };
    
    const persona = {
      dopId: dopId,
      name: name,
      bio: bio,
      bioFacts: bioFacts,
      ownerEmail: email,
      created: new Date().toISOString(),
      status: 'uploaded',
      images: [{ 
        key: imageKey,
        url: fileUrl(imageKey)
      }],
      voices: [{ 
        key: voiceKey,
        url: fileUrl(voiceKey)
      }],
      prompts: [
        { key: 'fun', text: 'What do you like to do for fun?' },
        { key: 'from', text: 'Where are you from?' },
        { key: 'relax', text: 'What is your favorite way to relax?' }
      ],
      videos: [],
      pending: {
        videoRequests: [
          { prompt: 'What do you like to do for fun?', requestId: null },
          { prompt: 'Where are you from?', requestId: null },
          { prompt: 'What is your favorite way to relax?', requestId: null }
        ]
      }
    };
    
    const personaKey = 'personas/' + dopId + '.json';
    await store.set(personaKey, JSON.stringify(persona), { 
      contentType: 'application/json'
    });
    console.log('[dop-uploads] Persona saved, triggering video generation...');
    
    // Trigger video generation in background
    try {
      await triggerVideoGeneration(dopId, persona);
    } catch (videoError) {
      console.warn('[dop-uploads] Video generation trigger failed:', videoError.message);
      // Don't fail the upload if video generation fails
    }
    
    console.log('[dop-uploads] Success!');
    
    return jsonResponse(200, {
      success: true,
      dopId: dopId,
      message: 'Upload successful! Your avatar will be ready in a few minutes.',
      chatUrl: '/chat.html?id=' + dopId
    });
    
  } catch (error) {
    console.error('[dop-uploads] ERROR:', error.message);
    console.error('[dop-uploads] Stack:', error.stack);
    
    return jsonResponse(500, {
      success: false,
      error: error.message
    });
  }
};
