// functions/manual-process.js
// Manual trigger for video processor to debug stuck personas

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
    
    // Get a specific persona to debug
    const personaKey = 'personas/9a575701-6edd-456a-86f9-ea5a2c0f4413.json';
    
    console.log('[manual-process] Loading persona:', personaKey);
    const personaData = await store.get(personaKey);
    
    if (!personaData) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({ error: 'Persona not found' })
      };
    }
    
    const persona = JSON.parse(personaData);
    console.log('[manual-process] Persona status:', persona.status);
    console.log('[manual-process] Persona pending:', persona.pending);
    console.log('[manual-process] Persona videos:', persona.videos);
    
    // Check if HeyGen IDs are already set
    console.log('[manual-process] HeyGen Image Key:', persona.heygenImageKey);
    console.log('[manual-process] HeyGen Avatar Group ID:', persona.heygenAvatarGroupId);
    console.log('[manual-process] HeyGen Avatar ID:', persona.heygenAvatarId);
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: true,
        persona: {
          dopId: persona.dopId,
          status: persona.status,
          heygenImageKey: persona.heygenImageKey,
          heygenAvatarGroupId: persona.heygenAvatarGroupId,
          heygenAvatarId: persona.heygenAvatarId,
          pending: persona.pending,
          videos: persona.videos,
          prompts: persona.prompts,
          images: persona.images,
          voices: persona.voices,
          bioFacts: persona.bioFacts,
          ownerEmail: persona.ownerEmail
        }
      })
    };

  } catch (error) {
    console.error('[manual-process] Error:', error);
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
