// functions/heygen-proxy.js
// Complete HeyGen integration for avatar creation and video generation

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const HEYGEN_API_BASE = 'https://api.heygen.com/v2';

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
        status: 'ready'
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

  const response = await fetch(`${HEYGEN_API_BASE}/avatars`, {
    method: 'POST',
    headers: {
      'X-API-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      avatar_name: name || 'User Avatar',
      avatar_image_url: imageUrl,
      // Use instant avatar for faster processing
      avatar_type: 'instant_avatar'
    })
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`HeyGen avatar creation failed: ${data.message || response.statusText}`);
  }

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
        voice_id: voiceId || 'default' // Use uploaded voice or default
      }
    }],
    aspect_ratio: '16:9',
    test: false // Set to true for testing
  };

  const response = await fetch(`${HEYGEN_API_BASE}/video/generate`, {
    method: 'POST',
    headers: {
      'X-API-Key': HEYGEN_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();
  
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

  const data = await response.json();
  
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