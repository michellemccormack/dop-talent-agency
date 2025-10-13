// functions/dop-uploads.js
// MINIMAL DEBUG VERSION - helps identify exact failure point

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
  console.log('[dop-uploads] === START ===');
  console.log('[dop-uploads] Method:', event.httpMethod);
  
  if (event.httpMethod === 'OPTIONS') {
    console.log('[dop-uploads] OPTIONS request, returning 204');
    return { statusCode: 204, headers: CORS };
  }
  
  if (event.httpMethod !== 'POST') {
    console.log('[dop-uploads] Wrong method:', event.httpMethod);
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    console.log('[dop-uploads] Step 1: Parse body');
    const body = JSON.parse(event.body || '{}');
    console.log('[dop-uploads] Body parsed OK');
    
    console.log('[dop-uploads] Step 2: Extract fields');
    const photo = body.photo || body.imageBase64;
    const voice = body.voice || body.audioBase64;
    const name = (body.name || 'My DOP').trim();
    const bio = (body.bio || '').trim();
    
    if (!photo || !voice) {
      console.log('[dop-uploads] Missing photo or voice');
      return jsonResponse(400, { error: 'Both photo and voice are required' });
    }
    
    console.log('[dop-uploads] Step 3: Generate dopId');
    const dopId = 'dop_' + randomUUID().replace(/-/g, '');
    console.log('[dop-uploads] DopId:', dopId);
    
    console.log('[dop-uploads] Step 4: Decode base64');
    const photoStripped = stripDataPrefix(photo);
    const voiceStripped = stripDataPrefix(voice);
    console.log('[dop-uploads] Stripped prefixes');
    
    const imgBuf = Buffer.from(photoStripped, 'base64');
    console.log('[dop-uploads] Image decoded:', imgBuf.length, 'bytes');
    
    const vocBuf = Buffer.from(voiceStripped, 'base64');
    console.log('[dop-uploads] Voice decoded:', vocBuf.length, 'bytes');
    
    console.log('[dop-uploads] Step 5: Initialize store');
    const store = uploadsStore();
    console.log('[dop-uploads] Store initialized');
    
    console.log('[dop-uploads] Step 6: Store image');
    const imageKey = 'images/' + dopId + '/photo.jpg';
    await store.set(imageKey, imgBuf, { contentType: 'image/jpeg' });
    console.log('[dop-uploads] Image stored at:', imageKey);
    
    console.log('[dop-uploads] Step 7: Store voice');
    const voiceKey = 'voices/' + dopId + '/voice.webm';
    await store.set(voiceKey, vocBuf, { contentType: 'audio/webm' });
    console.log('[dop-uploads] Voice stored at:', voiceKey);
    
    console.log('[dop-uploads] Step 8: Create persona JSON');
    const persona = {
      dopId: dopId,
      name: name,
      bio: bio,
      created: new Date().toISOString(),
      status: 'uploaded',
      images: [{ key: imageKey }],
      voices: [{ key: voiceKey }],
      prompts: [
        { key: 'fun', text: 'What do you like to do for fun?' },
        { key: 'from', text: 'Where are you from?' },
        { key: 'relax', text: 'What is your favorite way to relax?' }
      ],
      videos: []
    };
    console.log('[dop-uploads] Persona object created');
    
    console.log('[dop-uploads] Step 9: Store persona');
    const personaKey = 'personas/' + dopId + '.json';
    await store.set(personaKey, JSON.stringify(persona), { 
      contentType: 'application/json'
    });
    console.log('[dop-uploads] Persona stored at:', personaKey);
    
    console.log('[dop-uploads] === SUCCESS ===');
    return jsonResponse(200, {
      success: true,
      dopId: dopId,
      message: 'Upload successful!',
      chatUrl: '/chat.html?id=' + dopId
    });
    
  } catch (error) {
    console.error('[dop-uploads] === ERROR ===');
    console.error('[dop-uploads] Error:', error);
    console.error('[dop-uploads] Stack:', error.stack);
    
    return jsonResponse(500, {
      success: false,
      error: 'Upload failed: ' + error.message,
      step: 'Check Netlify function logs for details'
    });
  }
};
