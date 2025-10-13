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
      videos: []
    };
    
    const personaKey = 'personas/' + dopId + '.json';
    await store.set(personaKey, JSON.stringify(persona), { 
      contentType: 'application/json'
    });
    console.log('[dop-uploads] Success!');
    
    return jsonResponse(200, {
      success: true,
      dopId: dopId,
      message: 'Upload successful!',
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
