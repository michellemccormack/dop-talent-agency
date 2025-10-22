// functions/test-video-process.js
// Test function to manually trigger video processing for a specific DOP

const { getStore } = require('@netlify/blobs');

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
    
    // Get the specific DOP that's failing
    const personaKey = 'personas/dop_58a5878674a64a2a98e48d1fffcf504e.json';
    
    console.log('[test-video-process] Loading persona:', personaKey);
    const personaData = await store.get(personaKey);
    
    if (!personaData) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({ error: 'Persona not found' })
      };
    }
    
    const persona = JSON.parse(personaData);
    console.log('[test-video-process] Persona loaded:', persona.dopId);
    console.log('[test-video-process] Persona status:', persona.status);
    console.log('[test-video-process] Persona images:', persona.images);
    
    // Test the HeyGen proxy directly
    const heygenProxy = require('./heygen-proxy');
    
    console.log('[test-video-process] Testing HeyGen photo upload...');
    const imageKey = persona.images[0].key;
    console.log('[test-video-process] Image key:', imageKey);
    
    const uploadEvent = {
      httpMethod: 'POST',
      body: JSON.stringify({
        action: 'upload_photo',
        imageKey: imageKey,
        name: persona.name || 'DOP'
      })
    };
    
    const uploadResult = await heygenProxy.handler(uploadEvent);
    console.log('[test-video-process] Upload result:', uploadResult);
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: true,
        persona: {
          dopId: persona.dopId,
          status: persona.status,
          imageKey: imageKey,
          uploadResult: uploadResult
        }
      })
    };

  } catch (error) {
    console.error('[test-video-process] Error:', error);
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
