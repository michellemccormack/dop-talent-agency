// functions/heygen-video-processor.js
// Poll pending HeyGen tasks stored in persona blobs and write back video_url.
// Runs on demand and via Netlify schedule (see netlify.toml snippet below).

const { getStore } = require('@netlify/blobs');

// IMPORTANT: STORE_NAME must match the name used in your existing blobs helper.
const STORE_NAME = 'dop-uploads';
const PERSONA_PREFIX = 'personas/'; // personas/<dopId>.json
const POLL_LIMIT_MS = 180000;       // max time per invocation ~3min (for scheduled runs)
const NETLIFY_TIMEOUT_MS = 10000;   // Netlify function timeout (10s, leave 2s buffer)
const SLEEP_MS = 3500;              // delay between HeyGen API calls
const MAX_CONCURRENT = 3;           // max concurrent persona processing

function cors(extra={}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
    ...extra
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ok = (b) => ({ statusCode: 200, headers: cors(), body: JSON.stringify(b) });
const err = (c, m, x={}) => ({ statusCode: c, headers: cors(), body: JSON.stringify({ error: m, ...x }) });

/**
 * Check HeyGen video status via API
 */
async function checkHeygenTask({ task_id, video_id }) {
  let url;
  if (task_id) {
    url = `https://api.heygen.com/v2/video/status?task_id=${encodeURIComponent(task_id)}`;
  } else if (video_id) {
    url = `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(video_id)}`;
  } else {
    throw new Error('task_id or video_id required');
  }

  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${process.env.HEYGEN_API_KEY}` }
  });

  const j = await resp.json().catch(() => ({}));
  
  if (!resp.ok) {
    throw new Error(`HeyGen API error: ${resp.status} - ${JSON.stringify(j)}`);
  }

  const status = j.status || j?.data?.status || j?.code || null;
  const video_url = j.video_url || j?.data?.video_url || null;
  const thumbnail_url = j.thumbnail_url || j?.data?.thumbnail_url || null;
  const duration = j.duration || j?.data?.duration || null;

  return { status, video_url, thumbnail_url, duration, raw: j };
}

/**
 * Check if persona has videos for all prompts
 */
function hasAllVideos(persona) {
  const want = (persona.prompts || [])
    .map(p => (p.key || '').toString().toLowerCase())
    .filter(Boolean);
  
  if (!want.length) return false;
  
  const got = new Set(
    (persona.videos || []).map(v => (v.key || v.prompt || '').toString().toLowerCase())
  );
  
  return want.every(k => got.has(k));
}

/**
 * Process a single persona blob
 */
async function processPersona(store, key, timeLimit) {
  const startTime = Date.now();
  
  try {
    // Read persona data
    const raw = await store.get(key, { type: 'text' });
    if (!raw) {
      console.log(`[${key}] Blob not found, skipping`);
      return { key, status: 'skip', reason: 'missing blob' };
    }

    let persona;
    try {
      persona = JSON.parse(raw);
    } catch (parseError) {
      console.error(`[${key}] Invalid JSON:`, parseError);
      return { key, status: 'skip', reason: 'bad json' };
    }

    // Initialize defaults
    persona.videos = Array.isArray(persona.videos) ? persona.videos : [];
    persona.prompts = Array.isArray(persona.prompts) && persona.prompts.length 
      ? persona.prompts 
      : [
          { key: 'fun', text: 'What do you like to do for fun?' },
          { key: 'from', text: 'Where are you from?' },
          { key: 'relax', text: 'What is your favorite way to relax?' }
        ];
    persona.pending = persona.pending || {};

    // Check if already complete
    if (!Object.keys(persona.pending).length && hasAllVideos(persona)) {
      if (persona.status !== 'ready') {
        console.log(`[${key}] All videos present, marking ready`);
        persona.status = 'ready';
        await store.set(key, JSON.stringify(persona), { contentType: 'application/json' });
        return { key, status: 'ready', changed: true };
      }
      console.log(`[${key}] Already ready`);
      return { key, status: 'ready', changed: false };
    }

    // If this is a new upload (status: 'uploaded'), start video generation
    if (persona.status === 'uploaded') {
      console.log(`[${key}] New upload detected, starting video generation...`);
      try {
        await startVideoGenerationForPersona(store, key, persona);
        return { key, status: 'processing', changed: true };
      } catch (error) {
        console.error(`[${key}] Failed to start video generation:`, error);
        return { key, status: 'error', error: error.message };
      }
    }

    // Process pending videos
    let changed = false;
    let completed = 0;
    let failed = 0;
    let stillPending = 0;

    console.log(`[${key}] Processing ${Object.keys(persona.pending).length} pending videos`);

    for (const [promptKey, info] of Object.entries(persona.pending || {})) {
      // Check time limit
      if (Date.now() - startTime > timeLimit) {
        console.warn(`[${key}] Time limit reached for this persona, stopping`);
        break;
      }

      if (!info) continue;

      // Skip if video already exists
      if ((persona.videos || []).some(v => (v.key || v.prompt) === promptKey)) {
        console.log(`[${key}] Video for '${promptKey}' already exists, removing from pending`);
        delete persona.pending[promptKey];
        changed = true;
        continue;
      }

      try {
        console.log(`[${key}] Checking HeyGen status for '${promptKey}' (task_id: ${info.task_id || info.video_id})`);
        
        const res = await checkHeygenTask({
          task_id: info.task_id,
          video_id: info.video_id
        });

        console.log(`[${key}] '${promptKey}' status: ${res.status}`);

        if ((res.status === 'completed' || res.status === 'succeed') && res.video_url) {
          // Video is ready!
          persona.videos.push({
            key: promptKey,
            url: res.video_url,
            thumbnail_url: res.thumbnail_url,
            duration: res.duration
          });
          delete persona.pending[promptKey];
          changed = true;
          completed++;
          console.log(`[${key}] [OK] Video for '${promptKey}' completed: ${res.video_url}`);

        } else if (res.status === 'failed' || res.status === 'error') {
          // Failed permanently
          persona.failures = persona.failures || {};
          persona.failures[promptKey] = `HeyGen render failed: ${res.status}`;
          delete persona.pending[promptKey];
          changed = true;
          failed++;
          console.error(`[${key}] [FAIL] Video for '${promptKey}' failed: ${res.status}`);

        } else {
          // Still processing
          stillPending++;
          console.log(`[${key}] [PENDING] Video for '${promptKey}' still processing (${res.status})`);
        }

        // Rate limiting between API calls
        await sleep(SLEEP_MS);

      } catch (apiError) {
        // Transient error - try again next run
        console.error(`[${key}] Error checking '${promptKey}':`, apiError.message);
        stillPending++;
        
        // Still add a small delay to avoid hammering on errors
        await sleep(SLEEP_MS / 2);
      }
    }

    // Update status
    const wasReady = persona.status === 'ready';
    persona.status = hasAllVideos(persona) ? 'ready' : 'processing';

    // Save if changed
    if (changed) {
      console.log(`[${key}] Saving changes (completed: ${completed}, failed: ${failed}, pending: ${stillPending})`);
      await store.set(key, JSON.stringify(persona), { contentType: 'application/json' });
      
      // Send notification if just became ready
      if (!wasReady && persona.status === 'ready') {
        try {
          // Call send-notification function directly
          const sendNotification = require('./send-notification');
          const mockEvent = {
            httpMethod: 'POST',
            body: JSON.stringify({
              dopId: persona.dopId,
              email: persona.ownerEmail,
              name: persona.name
            })
          };
          
          await sendNotification.handler(mockEvent);
          console.log(`[${key}] Notification sent for completed DOP`);
        } catch (notifyError) {
          console.warn(`[${key}] Failed to send notification:`, notifyError.message);
        }
      }
    } else {
      console.log(`[${key}] No changes (pending: ${stillPending})`);
    }

    return {
      key,
      status: persona.status,
      changed,
      completed,
      failed,
      stillPending
    };

  } catch (error) {
    console.error(`[${key}] Fatal error processing persona:`, error);
    return {
      key,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Start video generation for a new persona
 */
async function startVideoGenerationForPersona(store, key, persona) {
  console.log(`[${key}] ===== STARTING VIDEO GENERATION =====`);
  console.log(`[${key}] Persona status:`, persona.status);
  console.log(`[${key}] Persona dopId:`, persona.dopId);
  console.log(`[${key}] Persona name:`, persona.name);
  console.log(`[${key}] Persona images count:`, persona.images ? persona.images.length : 0);
  console.log(`[${key}] Persona prompts count:`, persona.prompts ? persona.prompts.length : 0);
  
  try {
    // Import heygen-proxy functions directly
    const heygenProxy = require('./heygen-proxy');
    console.log(`[${key}] HeyGen proxy imported successfully`);
    
    // Step 1: Upload photo to HeyGen (skip if already uploaded)
    let uploadedImageKey = persona.heygenImageKey; // Check if already uploaded
    
    if (!uploadedImageKey) {
      console.log(`[${key}] Uploading photo to HeyGen...`);
      const imageKey = persona.images[0].key;
      const uploadEvent = {
        httpMethod: 'POST',
        body: JSON.stringify({
          action: 'upload_photo',
          imageKey: imageKey,
          name: persona.name || 'DOP'
        })
      };
      
      const uploadResult = await heygenProxy.handler(uploadEvent);
      if (uploadResult.statusCode !== 200) {
        throw new Error('Photo upload to HeyGen failed');
      }
      
      const uploadData = JSON.parse(uploadResult.body);
      uploadedImageKey = uploadData.image_key;
      console.log(`[${key}] Photo uploaded to HeyGen:`, uploadedImageKey);
      
      // Save the HeyGen image key to avoid re-uploading
      persona.heygenImageKey = uploadedImageKey;
      await store.set(key, JSON.stringify(persona), { contentType: 'application/json' });
    } else {
      console.log(`[${key}] Photo already uploaded to HeyGen:`, uploadedImageKey);
    }
    
    // Step 2: Create avatar group (skip if already created)
    let avatarGroupId = persona.heygenAvatarGroupId; // Check if already created
    
    if (!avatarGroupId) {
      console.log(`[${key}] Creating avatar group...`);
      const groupEvent = {
        httpMethod: 'POST',
        body: JSON.stringify({
          action: 'create_avatar_group',
          imageKey: uploadedImageKey,
          name: persona.name || 'DOP'
        })
      };
      
      const groupResult = await heygenProxy.handler(groupEvent);
      if (groupResult.statusCode !== 200) {
        throw new Error('Avatar group creation failed');
      }
      
      const groupData = JSON.parse(groupResult.body);
      avatarGroupId = groupData.avatar_group_id;
      console.log(`[${key}] Avatar group created:`, avatarGroupId);
      
      // Save the avatar group ID to avoid re-creating
      persona.heygenAvatarGroupId = avatarGroupId;
      await store.set(key, JSON.stringify(persona), { contentType: 'application/json' });
    } else {
      console.log(`[${key}] Avatar group already created:`, avatarGroupId);
    }
    
    // Step 3: Get avatar ID (skip if already retrieved)
    let avatarId = persona.heygenAvatarId; // Check if already retrieved
    
    if (!avatarId) {
      console.log(`[${key}] Getting avatar ID...`);
      const avatarEvent = {
        httpMethod: 'POST',
        body: JSON.stringify({
          action: 'get_avatar_id',
          avatarGroupId: avatarGroupId
        })
      };
      
      const avatarResult = await heygenProxy.handler(avatarEvent);
      if (avatarResult.statusCode !== 200) {
        throw new Error('Failed to get avatar ID');
      }
      
      const avatarData = JSON.parse(avatarResult.body);
      avatarId = avatarData.avatar_id;
      console.log(`[${key}] Got avatar ID:`, avatarId);
      
      // Save the avatar ID to avoid re-retrieving
      persona.heygenAvatarId = avatarId;
      await store.set(key, JSON.stringify(persona), { contentType: 'application/json' });
    } else {
      console.log(`[${key}] Avatar ID already retrieved:`, avatarId);
    }
    
    // Step 4: Generate videos for each prompt
    const videoResults = [];
    for (const prompt of persona.prompts) {
      try {
        const videoEvent = {
          httpMethod: 'POST',
          body: JSON.stringify({
            action: 'generate_video',
            text: prompt.text,
            avatarId: avatarId,
            voiceId: 'default'
          })
        };
        
        const videoResult = await heygenProxy.handler(videoEvent);
        if (videoResult.statusCode !== 200) {
          throw new Error(`Video generation failed for prompt: ${prompt.key}`);
        }
        
        const videoData = JSON.parse(videoResult.body);
        console.log(`[${key}] Video generation started for prompt ${prompt.key}:`, videoData.video_id);
        
        videoResults.push({
          prompt: prompt.key,
          requestId: videoData.video_id,
          status: 'processing'
        });
      } catch (error) {
        console.error(`[${key}] Video generation error for prompt ${prompt.key}:`, error.message);
        videoResults.push({
          prompt: prompt.key,
          requestId: null,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Update persona with video request IDs
    persona.status = 'processing';
    persona.pending = {
      videoRequests: videoResults
    };
    
    await store.set(key, JSON.stringify(persona), { contentType: 'application/json' });
    console.log(`[${key}] Persona updated with video requests`);
    
  } catch (error) {
    console.error(`[${key}] Video generation setup failed:`, error);
    throw error;
  }
}

/**
 * Process personas with concurrency control
 */
async function processWithConcurrency(store, keys, timeLimit) {
  const results = [];
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < keys.length; i += MAX_CONCURRENT) {
    // Check global time limit
    const elapsed = Date.now() - startTime;
    if (elapsed > timeLimit - 5000) { // Leave 5s buffer
      console.warn(`Approaching time limit (${elapsed}ms), stopping early. Processed ${i}/${keys.length} personas.`);
      break;
    }

    const batch = keys.slice(i, i + MAX_CONCURRENT);
    console.log(`\nProcessing batch ${Math.floor(i/MAX_CONCURRENT) + 1}: ${batch.length} personas`);

    // Process batch concurrently
    const batchResults = await Promise.all(
      batch.map(key => processPersona(store, key, timeLimit - elapsed))
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Main handler
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }

  const startTime = Date.now();
  const isScheduled = event.headers['x-nf-event'] === 'schedule';
  
  // Use longer timeout for scheduled runs, shorter for HTTP
  const timeLimit = isScheduled ? POLL_LIMIT_MS : NETLIFY_TIMEOUT_MS;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`HeyGen Video Processor started`);
  console.log(`Mode: ${isScheduled ? 'SCHEDULED' : 'HTTP'}`);
  console.log(`Time limit: ${timeLimit}ms`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Initialize blob store
    const store = getStore({
      name: STORE_NAME,
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
      consistency: 'strong'
    });

    // List all persona blobs
    console.log('Fetching persona list...');
    const list = await store.list({ prefix: PERSONA_PREFIX });
    const items = (list?.blobs || list || []).filter(x => 
      String(x.key || x).endsWith('.json')
    );

    console.log(`Found ${items.length} persona(s)\n`);

    if (items.length === 0) {
      return ok({
        processed: 0,
        results: [],
        message: 'No personas found'
      });
    }

    // Process all personas - prioritize newer ones first
    const keys = items.map(item => item.key || item);
    
    // Sort by creation time (newest first) to prioritize recent DOPs
    const sortedKeys = await Promise.all(keys.map(async (key) => {
      try {
        const data = await store.get(key);
        if (data) {
          const persona = JSON.parse(data);
          return { key, created: new Date(persona.created || '1970-01-01') };
        }
      } catch (error) {
        console.warn(`Failed to read persona ${key}:`, error.message);
      }
      return { key, created: new Date('1970-01-01') };
    }));
    
    // Sort by creation date (newest first)
    sortedKeys.sort((a, b) => b.created - a.created);
    const prioritizedKeys = sortedKeys.map(item => item.key);
    
    console.log(`Processing ${prioritizedKeys.length} personas, newest first...`);
    const results = await processWithConcurrency(store, prioritizedKeys, timeLimit);

    // Calculate summary stats
    const summary = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      if (r.completed) acc.videosCompleted = (acc.videosCompleted || 0) + r.completed;
      if (r.failed) acc.videosFailed = (acc.videosFailed || 0) + r.failed;
      if (r.stillPending) acc.videosPending = (acc.videosPending || 0) + r.stillPending;
      return acc;
    }, {});

    const elapsed = Date.now() - startTime;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing complete in ${elapsed}ms`);
    console.log(`Summary:`, summary);
    console.log(`${'='.repeat(60)}\n`);

    return ok({
      processed: results.length,
      elapsed,
      summary,
      results
    });

  } catch (error) {
    console.error('Fatal error:', error);
    return err(500, 'processor_failed', {
      message: String(error?.message || error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
};