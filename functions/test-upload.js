// functions/test-upload.js
// Simple test function to debug 502 errors

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

exports.handler = async (event) => {
  console.log('[test-upload] START');
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    console.log('[test-upload] Parsing body');
    const body = JSON.parse(event.body || '{}');
    
    console.log('[test-upload] Body received:', {
      hasPhoto: !!body.photo,
      hasVoice: !!body.voice,
      name: body.name,
      bio: body.bio
    });
    
    // Test environment variables
    const envCheck = {
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      ELEVENLABS_API_KEY: !!process.env.ELEVENLABS_API_KEY,
      HEYGEN_API_KEY: !!process.env.HEYGEN_API_KEY,
      NETLIFY_SITE_ID: !!process.env.NETLIFY_SITE_ID,
      NETLIFY_BLOBS_TOKEN: !!process.env.NETLIFY_BLOBS_TOKEN
    };
    
    console.log('[test-upload] Environment check:', envCheck);
    
    return jsonResponse(200, {
      success: true,
      message: 'Test upload successful!',
      envCheck: envCheck,
      receivedData: {
        hasPhoto: !!body.photo,
        hasVoice: !!body.voice,
        name: body.name || 'No name',
        bio: body.bio ? body.bio.substring(0, 50) + '...' : 'No bio'
      }
    });
    
  } catch (error) {
    console.error('[test-upload] ERROR:', error.message);
    console.error('[test-upload] Stack:', error.stack);
    
    return jsonResponse(500, {
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};
