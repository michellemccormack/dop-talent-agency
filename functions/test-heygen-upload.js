// Test HeyGen photo upload with a simple image
const { uploadsStore } = require('./_lib/blobs');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    console.log('[test-heygen-upload] Testing HeyGen photo upload...');
    
    // Get a test image from storage
    const store = uploadsStore();
    const testImageKey = 'images/dop_3c9d7cba6e724439bd5706afee785772/photo.jpg';
    
    console.log('[test-heygen-upload] Getting image from storage...');
    const imageBlob = await store.get(testImageKey);
    
    if (!imageBlob) {
      return {
        statusCode: 404,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Test image not found' })
      };
    }
    
    console.log('[test-heygen-upload] Image found, size:', imageBlob.length, 'bytes');
    
    // Test HeyGen upload
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    
    let formData = '';
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="file"; filename="test.jpg"\r\n`;
    formData += `Content-Type: image/jpeg\r\n\r\n`;
    
    const textEncoder = new TextEncoder();
    const formDataStart = textEncoder.encode(formData);
    const formDataEnd = textEncoder.encode(`\r\n--${boundary}--\r\n`);
    
    const fullBody = new Uint8Array(formDataStart.length + imageBlob.length + formDataEnd.length);
    fullBody.set(formDataStart, 0);
    fullBody.set(new Uint8Array(imageBlob), formDataStart.length);
    fullBody.set(formDataEnd, formDataStart.length + imageBlob.length);

    console.log('[test-heygen-upload] Uploading to HeyGen...');
    const response = await fetch('https://upload.heygen.com/v2/asset', {
      method: 'POST',
      headers: {
        'X-Api-Key': process.env.HEYGEN_API_KEY,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: fullBody
    });

    const responseText = await response.text();
    console.log('[test-heygen-upload] HeyGen response status:', response.status);
    console.log('[test-heygen-upload] HeyGen response:', responseText.substring(0, 500));
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'HeyGen returned non-JSON response',
          response: responseText.substring(0, 500),
          status: response.status
        })
      };
    }
    
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: response.ok,
        status: response.status,
        data: data,
        imageSize: imageBlob.length
      })
    };

  } catch (error) {
    console.error('[test-heygen-upload] Error:', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Test failed', details: error.message })
    };
  }
};
