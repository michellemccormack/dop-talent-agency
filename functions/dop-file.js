// functions/dop-file.js
// Streams a blob (image or audio) from the dop-uploads store.
// Fixed to handle Netlify Blobs API internal error with 200 response.

const { uploadsStore } = require('./_lib/blobs');

const guessType = (key = '') => {
  const k = key.toLowerCase();
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg';
  if (k.endsWith('.webp')) return 'image/webp';
  if (k.endsWith('.mp3') || k.endsWith('.mpeg')) return 'audio/mpeg';
  if (k.endsWith('.wav')) return 'audio/wav';
  if (k.endsWith('.webm')) return 'audio/webm';
  return 'application/octet-stream';
};

exports.handler = async (event) => {
  try {
    const key = event.queryStringParameters?.key;
    if (!key) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing key parameter' })
      };
    }

    console.log(`[dop-file] Attempting to retrieve key: "${key}"`);

    const store = uploadsStore();

    // Try to get the blob with explicit error handling for the "200 response" internal error
    let raw;
    
    try {
      // Method 1: Try without any options first
      console.log('[dop-file] Trying store.get() with no options...');
      raw = await store.get(key);
      console.log('[dop-file] Raw response type:', typeof raw, 'isBuffer:', Buffer.isBuffer(raw));
      
      if (raw === null || raw === undefined) {
        console.log('[dop-file] Key not found (null response)');
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'File not found' })
        };
      }

    } catch (error1) {
      console.log('[dop-file] Method 1 failed:', error1.message);
      
      try {
        // Method 2: Try with arrayBuffer option
        console.log('[dop-file] Trying store.get() with arrayBuffer...');
        raw = await store.get(key, { type: 'arrayBuffer' });
        console.log('[dop-file] ArrayBuffer response, length:', raw?.byteLength);
        
        if (raw) {
          raw = Buffer.from(raw);
        }
        
      } catch (error2) {
        console.log('[dop-file] Method 2 failed:', error2.message);
        
        try {
          // Method 3: Try with text and assume it's base64
          console.log('[dop-file] Trying store.get() as text...');
          raw = await store.get(key, { type: 'text' });
          console.log('[dop-file] Text response length:', raw?.length);
          
          if (raw && typeof raw === 'string') {
            // Try to decode as base64
            raw = Buffer.from(raw, 'base64');
          }
          
        } catch (error3) {
          console.error('[dop-file] All methods failed:', {
            error1: error1.message,
            error2: error2.message,
            error3: error3.message
          });
          
          return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              error: 'Failed to retrieve file from storage',
              key: key,
              details: `Tried multiple methods: ${error1.message}` 
            })
          };
        }
      }
    }

    // Handle the response based on what we got
    let buffer;
    
    if (Buffer.isBuffer(raw)) {
      buffer = raw;
      console.log('[dop-file] Using Buffer directly, size:', buffer.length);
    } else if (raw instanceof Uint8Array) {
      buffer = Buffer.from(raw);
      console.log('[dop-file] Converted Uint8Array to Buffer, size:', buffer.length);
    } else if (raw instanceof ArrayBuffer) {
      buffer = Buffer.from(raw);
      console.log('[dop-file] Converted ArrayBuffer to Buffer, size:', buffer.length);
    } else if (typeof raw === 'string') {
      // Assume base64 encoded
      try {
        buffer = Buffer.from(raw, 'base64');
        console.log('[dop-file] Decoded base64 string to Buffer, size:', buffer.length);
      } catch (b64Error) {
        console.error('[dop-file] Failed to decode base64:', b64Error.message);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Failed to decode file data' })
        };
      }
    } else if (raw && typeof raw === 'object' && raw.body) {
      // Handle { body: Buffer, contentType: string } format
      buffer = Buffer.isBuffer(raw.body) ? raw.body : Buffer.from(raw.body);
      console.log('[dop-file] Extracted buffer from response object, size:', buffer.length);
    } else {
      console.error('[dop-file] Unexpected data format:', typeof raw, raw);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Unexpected file data format',
          dataType: typeof raw
        })
      };
    }

    // Validate we have a non-empty buffer
    if (!buffer || buffer.length === 0) {
      console.error('[dop-file] Empty or invalid buffer');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'File data is empty or invalid' })
      };
    }

    console.log(`[dop-file] Successfully retrieved file, size: ${buffer.length} bytes`);

    // Return as base64-encoded response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': guessType(key),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': buffer.length.toString(),
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };

  } catch (err) {
    console.error('[dop-file] Unhandled error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        message: err.message || String(err),
        stack: err.stack
      })
    };
  }
};