// functions/simple-test.js
// Ultra-simple test without any dependencies

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

exports.handler = async (event) => {
  console.log('[simple-test] START');
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    
    return {
      statusCode: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Simple test works!',
        timestamp: new Date().toISOString(),
        received: {
          hasPhoto: !!body.photo,
          hasVoice: !!body.voice,
          name: body.name || 'No name'
        }
      })
    };
    
  } catch (error) {
    console.error('[simple-test] ERROR:', error);
    
    return {
      statusCode: 500,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
