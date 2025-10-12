/* chat-glue.js — Non-destructive add-on for DOP flow
   - Adds prompt → LLM → HeyGen → poll → play
   - Leaves your existing chat.html (838 lines) untouched
   - Looks for window.routeToBackend / handlePrompt and augments them
   - Safe to include multiple times (no double-binding)
*/
(() => {
  if (window.__chatGlueLoaded) return; window.__chatGlueLoaded = true;

  const HEYGEN_POLL_MS = 3000;
  const HEYGEN_POLL_MAX = 80;

  function log(...args){ try{ console.log("[chat-glue]", ...args);}catch{} }

  // Robust fetch JSON
  async function j(url, opts){ const r = await fetch(url, opts); if(!r.ok) throw new Error(r.status+" "+r.statusText); return r.json(); }

  // Try common globals that your file already defines
  const qs = new URLSearchParams(location.search);
  const dopId = qs.get('id') || (window.dopId || 'demo');

  // Media helpers: prefer existing ones if present
  const showSpinner = window.showOverlay || window.showSpinner || (s => {
    const el = document.getElementById('respOverlay') || document.getElementById('mediaSpinner');
    if (el) el.style.display = s ? 'grid' : 'none';
  });
  const hideSpinner = s => showSpinner(false);

  function playVideo(url){
    // Prefer your existing play function
    if (typeof window.playHeyGenVideo === 'function') return window.playHeyGenVideo(url);
    // Fallback: replace #resp src or inject a <video> into #dopHero/#mediaBox
    const resp = document.getElementById('resp');
    if (resp && resp.tagName === 'VIDEO'){ resp.src = url; resp.muted = true; resp.loop = true; resp.playsInline = true; resp.autoplay = true; resp.play().catch(()=>{}); hideSpinner(); return; }
    const mediaBox = document.getElementById('mediaBox') || document.getElementById('dopHero');
    if (mediaBox){
      mediaBox.querySelectorAll('video,img').forEach(n => n.remove());
      const v = document.createElement('video');
      v.src = url; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      v.addEventListener('canplay', () => hideSpinner());
      mediaBox.appendChild(v);
    } else {
      window.open(url, "_blank");
    }
  }

  async function pollHeygenJob(jobId){
    for (let i=0;i<HEYGEN_POLL_MAX;i++){
      await new Promise(r => setTimeout(r, HEYGEN_POLL_MS));
      try{
        const stat = await j(`/.netlify/functions/heygen-proxy?job_id=${encodeURIComponent(jobId)}&id=${encodeURIComponent(dopId)}`);
        if (stat.status === 'completed' && stat.url){ playVideo(stat.url); return true; }
        if (stat.status === 'failed') throw new Error('heygen failed');
      }catch(e){ /* continue polling */ }
    }
    return false;
  }

  async function llmReply(text){
    const res = await j('/.netlify/functions/session-chat', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ id:dopId, message:text, sessionId: (window.sessionId || 's') })
    });
    return (res && res.reply) || text;
  }

  async function startHeygen(script){
    const start = await j('/.netlify/functions/heygen-proxy', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ id:dopId, script })
    });
    return start.job_id;
  }

  // Core: ask → LLM → HeyGen → poll → play
  async function askAndRender(inputText){
    try{
      showSpinner(true);
      const script = await llmReply(inputText);
      const job = await startHeygen(script);
      const ok = await pollHeygenJob(job);
      if (!ok) hideSpinner();
      return ok;
    } catch(e){
      log('askAndRender fallback to TTS', e);
      hideSpinner();
      // Optional: try existing speak function if available
      if (typeof window.speak === 'function') window.speak(inputText);
      return false;
    }
  }

  // 1) Patch window.routeToBackend to use askAndRender
  const prevRoute = window.routeToBackend;
  window.routeToBackend = async function(text, opts){
    if (!text) return;
    try{
      const done = await askAndRender(text);
      if (!done && typeof prevRoute === 'function'){
        // fall back to original route (e.g., TTS path)
        return prevRoute.call(this, text, opts);
      }
    }catch(e){
      if (typeof prevRoute === 'function') return prevRoute.call(this, text, opts);
    }
  };

  // 2) If there’s a global handlePrompt, wrap it too (prompt buttons)
  if (typeof window.handlePrompt === 'function'){
    const prevHandlePrompt = window.handlePrompt;
    window.handlePrompt = async function(promptText){
      try{
        const ok = await askAndRender(promptText);
        if (!ok) return prevHandlePrompt.call(this, promptText);
      }catch(e){ return prevHandlePrompt.call(this, promptText); }
    };
  }

  // 3) Add a tiny manual prompt form if none exists (non-breaking)
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('promptForm')) return;
    const left = document.getElementById('left') || document.querySelector('.card');
    if (!left) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<form id="promptForm_glue" style="display:flex;gap:8px;margin-top:8px">
      <input id="promptText_glue" type="text" placeholder="Type a prompt…" style="flex:1;background:#0f1118;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:10px 12px;color:#e6e9f1;">
      <button type="submit" style="padding:10px 14px;border-radius:12px;background:#111523;border:1px solid rgba(255,255,255,0.1);color:#e8ecf3;">Ask</button>
    </form>`;
    left.appendChild(wrap);
    const form = document.getElementById('promptForm_glue');
    const input = document.getElementById('promptText_glue');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (input.value||'').trim();
      if (!val) return;
      if (typeof window.pushTurn === 'function') window.pushTurn('user', val);
      window.routeToBackend(val, { forceLLM:true });
      input.value='';
    });
  });

  log('glue loaded');
})();