// functions/heygen-proxy.js
// Fixed HeyGen integration with correct API endpoints and error handling

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const HEYGEN_API_BASE = 'https://api.heygen.com/v1'; // Changed from v2 to v1

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
        version: '3.0',
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
      case 'create_avatar':
        return await createAvatar(params);
      case 'generate_video':
        return await generateVideo(params);
      case 'check_video':
        return await checkVideoStatus(params);
      default:
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
          body: JSON.stringify({ error: 'Invalid action. Use: create_avatar, generate_video, check_video' })
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

// Create avatar from uploaded photo
async function createAvatar({ imageUrl, name }) {
  if (!imageUrl) {
    throw new Error('imageUrl is required for avatar creation');
  }

  console.log('[heygen-proxy] Creating avatar with URL:', imageUrl.substring(0, 50) + '...');

  const requestBody = {
    avatar_name: name || 'User Avatar',
    avatar_image_url: imageUrl
  };

  console.log('[heygen-proxy] Request body:', JSON.stringify(requestBody, null, 2));

  const response = await fetch(`${HEYGEN_API_BASE}/avatar/create_avatar`, {
    method: 'POST',
    headers: {
      'X-API-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  console.log('[heygen-proxy] Response status:', response.status);
  console.log('[heygen-proxy] Response headers:', Object.fromEntries(response.headers.entries()));

  const responseText = await response.text();
  console.log('[heygen-proxy] Raw response:', responseText.substring(0, 500));

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    console.error('[heygen-proxy] Failed to parse response as JSON:', parseError);
    throw new Error(`HeyGen API returned non-JSON response: ${responseText.substring(0, 200)}`);
  }
  
  if (!response.ok) {
    console.error('[heygen-proxy] API error:', data);
    throw new Error(`HeyGen avatar creation failed: ${data.message || response.statusText}`);
  }

  console.log('[heygen-proxy] Avatar creation response:', data);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify({
      success: true,
      avatar_id: data.data?.avatar_id,
      status: data.data?.status || 'processing',
      message: 'Avatar creation started'
    })
  };
}

// Generate talking video
async function generateVideo({ text, avatarId, voiceId }) {
  if (!text || !avatarId) {
    throw new Error('text and avatarId are required for video generation');
  }

  const requestBody = {
    video_inputs: [{
      character: {
        type: 'avatar',
        avatar_id: avatarId,
        scale: 1.0
      },
      voice: {
        type: 'text',
        input_text: text,
        voice_id: voiceId || 'default'
      }
    }],
    aspect_ratio: '16:9',
    test: false
  };

  const response = await fetch(`${HEYGEN_API_BASE}/video/generate`, {
    method: 'POST',
    headers: {
      'X-API-Key': HEYGEN_API_KEY,
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
    throw new Error(`HeyGen video generation failed: ${data.message || response.statusText}`);
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

  const response = await fetch(`${HEYGEN_API_BASE}/video/${videoId}`, {
    method: 'GET',
    headers: {
      'X-API-Key': HEYGEN_API_KEY,
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
    throw new Error(`HeyGen status check failed: ${data.message || response.statusText}`);
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