// functions/heygen-proxy.js
// UPDATED: HeyGen Photo Avatar API v2 Integration

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const HEYGEN_API_BASE = 'https://api.heygen.com';
const HEYGEN_UPLOAD_BASE = 'https://upload.heygen.com';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // Health check
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({ 
        enabled: !!HEYGEN_API_KEY,
        status: 'ready',
        version: 'v2-photo-avatars',
        apiBase: HEYGEN_API_BASE
      }),
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  if (!HEYGEN_API_KEY) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        enabled: false,
        reason: "HEYGEN_API_KEY not configured"
      }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, ...params } = body;

    switch (action) {
      case 'upload_photo':
        return await uploadPhoto(params);
      case 'create_avatar_group':
        return await createAvatarGroup(params);
      case 'add_motion':
        return await addMotion(params);
      case 'add_sound_effect':
        return await addSoundEffect(params);
      case 'generate_video':
        return await generateVideo(params);
      case 'check_video':
        return await checkVideoStatus(params);
      case 'get_avatar_id':
        return await getAvatarId(params);
      default:
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (error) {
    console.error('[heygen-proxy] Error:', error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({ 
        error: 'HeyGen integration error',
        details: error.message 
      })
    };
  }
};

// Upload photo to HeyGen
async function uploadPhoto({ imageUrl, name, imageKey }) {
  if (!imageUrl && !imageKey) {
    throw new Error('imageUrl or imageKey is required');
  }

  console.log('[heygen-proxy] Uploading photo...');

  let imageBlob;
  
  if (imageKey) {
    // Get image directly from Netlify Blobs
    const { uploadsStore } = require('./_lib/blobs');
    const store = uploadsStore();
    imageBlob = await store.get(imageKey);
    if (!imageBlob) {
      throw new Error('Image not found in storage');
    }
  } else {
    // Fetch the image from the URL (fallback)
    console.log('[heygen-proxy] Fetching image from URL:', imageUrl.substring(0, 50) + '...');
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    imageBlob = Buffer.from(imageBuffer);
  }

  // Create FormData for HeyGen API v2
  const formData = new FormData();
  const blob = new Blob([imageBlob], { type: 'image/jpeg' });
  formData.append('file', blob, `${name || 'avatar'}.jpg`);

  const response = await fetch(`${HEYGEN_UPLOAD_BASE}/v1/asset`, {
    method: 'POST',
    headers: {
      'X-Api-Key': HEYGEN_API_KEY
    },
    body: formData
  });

  const responseText = await response.text();
  console.log('[heygen-proxy] Upload response status:', response.status);
  
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    console.error('[heygen-proxy] Failed to parse response:', responseText.substring(0, 500));
    throw new Error(`HeyGen upload returned non-JSON response: ${responseText.substring(0, 200)}`);
  }
  
  if (!response.ok) {
    console.error('[heygen-proxy] Upload error:', data);
    throw new Error(`Photo upload failed: ${data.message || response.statusText}`);
  }

  console.log('[heygen-proxy] Photo uploaded successfully:', data.data?.id);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify({
      success: true,
      image_key: data.data?.id,
      message: 'Photo uploaded successfully'
    })
  };
}

// Create photo avatar group
async function createAvatarGroup({ imageKey, name }) {
  if (!imageKey) {
    throw new Error('imageKey is required');
  }

  console.log('[heygen-proxy] Creating avatar group with image_key:', imageKey);

  const requestBody = {
    name: name || 'User Avatar',
    image_key: imageKey
  };

  const response = await fetch(`${HEYGEN_API_BASE}/v2/photo_avatar/avatar_group/create`, {
    method: 'POST',
    headers: {
      'X-Api-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  console.log('[heygen-proxy] Avatar group response status:', response.status);

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error(`HeyGen API returned non-JSON response: ${responseText.substring(0, 200)}`);
  }
  
  if (!response.ok) {
    console.error('[heygen-proxy] Avatar group error:', data);
    throw new Error(`Avatar group creation failed: ${data.message || response.statusText}`);
  }

  console.log('[heygen-proxy] Avatar group created:', data.data?.avatar_group_id);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify({
      success: true,
      avatar_group_id: data.data?.avatar_group_id,
      message: 'Avatar group created'
    })
  };
}

// Add motion to photo avatar
async function addMotion({ avatarId }) {
  if (!avatarId) {
    throw new Error('avatarId is required');
  }

  console.log('[heygen-proxy] Adding motion to avatar:', avatarId);

  const response = await fetch(`${HEYGEN_API_BASE}/v2/photo_avatar/add_motion`, {
    method: 'POST',
    headers: {
      'X-Api-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ id: avatarId })
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error(`HeyGen API returned non-JSON response: ${responseText.substring(0, 200)}`);
  }
  
  if (!response.ok) {
    throw new Error(`Add motion failed: ${data.message || response.statusText}`);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify({
      success: true,
      message: 'Motion added'
    })
  };
}

// Add sound effect to photo avatar
async function addSoundEffect({ avatarId }) {
  if (!avatarId) {
    throw new Error('avatarId is required');
  }

  console.log('[heygen-proxy] Adding sound effect to avatar:', avatarId);

  const response = await fetch(`${HEYGEN_API_BASE}/v2/photo_avatar/add_sound_effect`, {
    method: 'POST',
    headers: {
      'X-Api-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ id: avatarId })
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error(`HeyGen API returned non-JSON response: ${responseText.substring(0, 200)}`);
  }
  
  if (!response.ok) {
    throw new Error(`Add sound effect failed: ${data.message || response.statusText}`);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify({
      success: true,
      message: 'Sound effect added'
    })
  };
}

// Get avatar ID from group (needed for video generation)
async function getAvatarId({ avatarGroupId }) {
  if (!avatarGroupId) {
    throw new Error('avatarGroupId is required');
  }

  console.log('[heygen-proxy] Getting avatar ID for group:', avatarGroupId);

  const response = await fetch(`${HEYGEN_API_BASE}/v2/avatar_group.list`, {
    method: 'GET',
    headers: {
      'X-Api-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error(`HeyGen API returned non-JSON response: ${responseText.substring(0, 200)}`);
  }
  
  if (!response.ok) {
    throw new Error(`Failed to get avatar groups: ${data.message || response.statusText}`);
  }

  // Find the avatar in the specified group
  const avatarGroup = data.data?.avatar_groups?.find(g => g.avatar_group_id === avatarGroupId);
  if (!avatarGroup || !avatarGroup.avatars || avatarGroup.avatars.length === 0) {
    throw new Error('Avatar not found in group');
  }

  const avatarId = avatarGroup.avatars[0].avatar_id;
  console.log('[heygen-proxy] Found avatar ID:', avatarId);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify({
      success: true,
      avatar_id: avatarId
    })
  };
}

// Generate video with photo avatar
async function generateVideo({ text, avatarId, voiceId }) {
  if (!text || !avatarId) {
    throw new Error('text and avatarId are required');
  }

  console.log('[heygen-proxy] Generating video with avatar:', avatarId);

  const requestBody = {
    video_inputs: [{
      character: {
        type: 'talking_photo',
        talking_photo_id: avatarId,
        scale: 1.0
      },
      voice: {
        type: 'text',
        input_text: text,
        voice_id: voiceId || 'default'
      }
    }],
    dimension: {
      width: 1080,
      height: 1920
    },
    aspect_ratio: '9:16',
    test: false
  };

  const response = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
    method: 'POST',
    headers: {
      'X-Api-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error(`HeyGen API returned non-JSON response: ${responseText.substring(0, 200)}`);
  }
  
  if (!response.ok) {
    throw new Error(`Video generation failed: ${data.message || response.statusText}`);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify({
      success: true,
      video_id: data.data?.video_id,
      status: 'processing',
      message: 'Video generation started'
    })
  };
}

// Check video generation status
async function checkVideoStatus({ videoId }) {
  if (!videoId) {
    throw new Error('videoId is required');
  }

  const response = await fetch(`${HEYGEN_API_BASE}/v1/video_status.get?video_id=${videoId}`, {
    method: 'GET',
    headers: {
      'X-Api-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error(`HeyGen API returned non-JSON response: ${responseText.substring(0, 200)}`);
  }
  
  if (!response.ok) {
    throw new Error(`Status check failed: ${data.message || response.statusText}`);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify({
      success: true,
      status: data.data?.status,
      video_url: data.data?.video_url,
      thumbnail_url: data.data?.thumbnail_url,
      duration: data.data?.duration
    })
  };
}