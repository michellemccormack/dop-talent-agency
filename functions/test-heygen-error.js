// functions/test-heygen-error.js
// Test function to get detailed HeyGen API error information

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    const HEYGEN_API_BASE = 'https://api.heygen.com';
    const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
    
    console.log('[test-heygen-error] Testing HeyGen video generation API...');
    console.log('[test-heygen-error] API Key present:', !!HEYGEN_API_KEY);
    console.log('[test-heygen-error] API Key prefix:', HEYGEN_API_KEY ? HEYGEN_API_KEY.substring(0, 10) + '...' : 'none');
    
    const avatarId = '4dec45df16bf489dad02071e0141476e';
    const text = 'What do you like to do for fun?';
    
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
          voice_id: 'default'
        }
      }],
      dimension: {
        width: 1080,
        height: 1920
      },
      aspect_ratio: '9:16',
      test: false
    };

    console.log('[test-heygen-error] Request body:', JSON.stringify(requestBody, null, 2));
    console.log('[test-heygen-error] Making request to:', `${HEYGEN_API_BASE}/v2/video/generate`);

    const response = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
      method: 'POST',
      headers: {
        'X-Api-Key': HEYGEN_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    console.log('[test-heygen-error] Response status:', response.status);
    console.log('[test-heygen-error] Response headers:', Object.fromEntries(response.headers.entries()));
    console.log('[test-heygen-error] Response body:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[test-heygen-error] Failed to parse response as JSON:', responseText);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({
          success: false,
          error: 'Non-JSON response',
          status: response.status,
          responseText: responseText,
          requestBody: requestBody
        })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: response.ok,
        status: response.status,
        data: data,
        requestBody: requestBody,
        responseText: responseText
      })
    };

  } catch (error) {
    console.error('[test-heygen-error] Error:', error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      })
    };
  }
};
