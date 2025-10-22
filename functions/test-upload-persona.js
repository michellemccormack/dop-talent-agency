// functions/test-upload-persona.js
// Test function to manually upload a photo for a specific persona

const { getStore } = require('@netlify/blobs');
const heygenProxy = require('./heygen-proxy');

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
    const store = getStore({
      name: 'dop-uploads',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
      consistency: 'strong'
    });
    
    // Get a specific persona to test
    const personaKey = 'personas/9a575701-6edd-456a-86f9-ea5a2c0f4413.json';
    
    console.log('[test-upload-persona] Loading persona:', personaKey);
    const personaData = await store.get(personaKey);
    
    if (!personaData) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({ error: 'Persona not found' })
      };
    }
    
    const persona = JSON.parse(personaData);
    console.log('[test-upload-persona] Persona loaded:', persona.dopId);
    
    // Test photo upload
    const imageKey = persona.images[0].key;
    console.log('[test-upload-persona] Uploading photo with key:', imageKey);
    
    const uploadEvent = {
      httpMethod: 'POST',
      body: JSON.stringify({
        action: 'upload_photo',
        imageKey: imageKey,
        name: persona.name || 'DOP'
      })
    };
    
    const uploadResult = await heygenProxy.handler(uploadEvent);
    console.log('[test-upload-persona] Upload result status:', uploadResult.statusCode);
    console.log('[test-upload-persona] Upload result body:', uploadResult.body);
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: true,
        persona: {
          dopId: persona.dopId,
          imageKey: imageKey,
          uploadResult: {
            statusCode: uploadResult.statusCode,
            body: uploadResult.body
          }
        }
      })
    };

  } catch (error) {
    console.error('[test-upload-persona] Error:', error);
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
