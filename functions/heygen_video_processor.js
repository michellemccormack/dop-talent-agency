// functions/heygen-video-processor.js
// Poll pending HeyGen tasks stored in persona blobs and write back video_url.
// Runs on demand and via Netlify schedule (see netlify.toml snippet below).

const { getStore } = require('@netlify/blobs');

// IMPORTANT: STORE_NAME must match the name used in your existing blobs helper.
// If your app uses a different store name, change it here.
const STORE_NAME = 'dop-uploads';
const PERSONA_PREFIX = 'personas/'; // personas/<dopId>.json
const POLL_LIMIT_MS = 180000;       // max time per invocation ~3min
const SLEEP_MS = 3500;

function cors(extra={}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
    ...extra
  };
}

const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const ok  = (b)=>({ statusCode:200, headers:cors(), body:JSON.stringify(b) });
const err = (c,m,x={})=>({ statusCode:c, headers:cors(), body:JSON.stringify({ error:m, ...x }) });

async function checkHeygenTask({ task_id, video_id }){
  // Support either v2 (task_id) or v1 (video_id)
  let url;
  if (task_id) {
    url = `https://api.heygen.com/v2/video/status?task_id=${encodeURIComponent(task_id)}`;
  } else if (video_id) {
    url = `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(video_id)}`;
  } else {
    throw new Error('task_id or video_id required');
  }
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${process.env.HEYGEN_API_KEY}` } });
  const j = await resp.json().catch(()=>({}));
  if (!resp.ok) throw new Error(`heygen status ${resp.status}`);
  const status = j.status || j?.data?.status || j?.code || null;
  const video_url = j.video_url || j?.data?.video_url || null;
  const thumbnail_url = j.thumbnail_url || j?.data?.thumbnail_url || null;
  const duration = j.duration || j?.data?.duration || null;
  return { status, video_url, thumbnail_url, duration, raw:j };
}

function hasAllVideos(persona){
  const want = (persona.prompts || []).map(p => (p.key || '').toString().toLowerCase()).filter(Boolean);
  if (!want.length) return false;
  const got = new Set((persona.videos || []).map(v => (v.key || v.prompt || '').toString().toLowerCase()));
  return want.every(k => got.has(k));
}

async function processPersona(store, key){
  const raw = await store.get(key, { type:'text' });
  if (!raw) return { key, status:'skip', reason:'missing blob' };
  let p;
  try { p = JSON.parse(raw); } catch { return { key, status:'skip', reason:'bad json' }; }

  p.videos  = Array.isArray(p.videos) ? p.videos : [];
  p.prompts = Array.isArray(p.prompts) && p.prompts.length ? p.prompts : [
    { key:'fun',  text:'What do you like to do for fun?' },
    { key:'from', text:'Where are you from?' },
    { key:'relax',text:'What’s your favorite way to relax?' }
  ];
  p.pending = p.pending || {}; // { fun:{task_id} } or { fun:{video_id} }

  // If nothing is pending and we already have all videos → mark ready and exit
  if (!Object.keys(p.pending).length && hasAllVideos(p)) {
    if (p.status !== 'ready') {
      p.status = 'ready';
      await store.set(key, JSON.stringify(p), { contentType:'application/json' });
    }
    return { key, status:'ready' };
  }

  const start = Date.now();
  let changed = false;

  while (Date.now() - start < POLL_LIMIT_MS) {
    let remaining = 0;

    for (const [k, info] of Object.entries(p.pending)) {
      if (!info) continue;

      // already captured?
      if ((p.videos||[]).some(v => (v.key||v.prompt) === k)) continue;

      try {
        const res = await checkHeygenTask({ task_id: info.task_id, video_id: info.video_id });
        if ((res.status === 'completed' || res.status === 'succeed' || res.video_url) && res.video_url) {
          p.videos.push({ key:k, url:res.video_url, thumbnail_url:res.thumbnail_url, duration:res.duration });
          delete p.pending[k];
          changed = true;
        } else if (res.status === 'failed' || res.status === 'error') {
          p.failures ||= {};
          p.failures[k] = 'render failed';
          delete p.pending[k];
          changed = true;
        } else {
          remaining++;
        }
      } catch (e) {
        remaining++; // transient error → try later
      }
    }

    if (!remaining) break;
    await sleep(SLEEP_MS);
  }

  p.status = hasAllVideos(p) ? 'ready' : 'processing';
  if (changed) {
    await store.set(key, JSON.stringify(p), { contentType:'application/json' });
  }
  return { key, status: p.status };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:cors(), body:'' };
  try {
    const store = getStore({
      name: STORE_NAME,
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
      consistency: 'strong'
    });

    const list = await store.list({ prefix: PERSONA_PREFIX });
    const items = (list?.blobs || list || []).filter(x => String(x.key || x).endsWith('.json'));

    const results = [];
    for (const item of items) {
      const key = item.key || item;
      const res = await processPersona(store, key);
      results.push(res);
    }
    return ok({ processed: results.length, results });
  } catch (e) {
    return err(500, 'processor_failed', { message: String(e?.message||e) });
  }
};
