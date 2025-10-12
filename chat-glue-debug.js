/* chat-glue-debug.js
   Adds verbose logs and a test button to FORCE a fresh LLM→HeyGen render.
   Safe: does not replace your code; only wraps.
*/
(() => {
  if (window.__chatGlueDebugLoaded) return; window.__chatGlueDebugLoaded = true;
  console.log("[chat-glue][debug] loaded");

  const HEYGEN_POLL_MS = 3000;
  const HEYGEN_POLL_MAX = 80;
  const qs = new URLSearchParams(location.search);
  const dopId = qs.get('id') || (window.dopId || 'demo');

  async function j(url, opts){ const r = await fetch(url, opts); if(!r.ok) throw new Error(r.status+" "+r.statusText); return r.json(); }

  function playVideo(url){
    if (typeof window.playHeyGenVideo === 'function') { console.log("[chat-glue][debug] play via playHeyGenVideo", url); return window.playHeyGenVideo(url); }
    const resp = document.getElementById('resp');
    if (resp && resp.tagName === 'VIDEO'){ console.log("[chat-glue][debug] play via #resp", url); resp.src = url; resp.muted = true; resp.loop = true; resp.autoplay = true; resp.playsInline = true; resp.play().catch(()=>{}); return; }
    const mediaBox = document.getElementById('mediaBox') || document.getElementById('dopHero');
    if (mediaBox){
      console.log("[chat-glue][debug] play via mediaBox", url);
      mediaBox.querySelectorAll('video,img').forEach(n => n.remove());
      const v = document.createElement('video');
      v.src = url; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      mediaBox.appendChild(v);
    } else {
      console.log("[chat-glue][debug] opening video in new tab");
      window.open(url, "_blank");
    }
  }

  async function pollHeygenJob(jobId){
    for (let i=0;i<HEYGEN_POLL_MAX;i++){
      await new Promise(r => setTimeout(r, HEYGEN_POLL_MS));
      try{
        const stat = await j(`/.netlify/functions/heygen-proxy?job_id=${encodeURIComponent(jobId)}&id=${encodeURIComponent(dopId)}`);
        console.log("[chat-glue][debug] poll", stat);
        if (stat.status === 'completed' && stat.url){ playVideo(stat.url); return true; }
        if (stat.status === 'failed') throw new Error('heygen failed');
      }catch(e){ console.warn("[chat-glue][debug] poll error", e); }
    }
    return false;
  }

  async function llmReply(text){
    console.log("[chat-glue][debug] LLM in", text);
    const res = await j('/.netlify/functions/session-chat', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ id:dopId, message:text, sessionId: (window.sessionId || 's') })
    });
    console.log("[chat-glue][debug] LLM out", res);
    return (res && res.reply) || text;
  }

  async function startHeygen(script){
    console.log("[chat-glue][debug] HeyGen start", script);
    const start = await j('/.netlify/functions/heygen-proxy', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ id:dopId, script })
    });
    console.log("[chat-glue][debug] HeyGen start result", start);
    return start.job_id;
  }

  async function askAndRender(inputText){
    try{
      console.log("[chat-glue][debug] askAndRender", inputText);
      const script = await llmReply(inputText);
      const job = await startHeygen(script);
      const ok = await pollHeygenJob(job);
      return ok;
    } catch(e){
      console.warn("[chat-glue][debug] askAndRender fallback", e);
      if (typeof window.speak === 'function') window.speak(inputText);
      return false;
    }
  }

  const prevRoute = window.routeToBackend;
  window.routeToBackend = async function(text, opts){
    console.log("[chat-glue][debug] routeToBackend patched", text, opts);
    if (!text) return;
    try{
      const done = await askAndRender(text);
      if (!done && typeof prevRoute === 'function'){
        return prevRoute.call(this, text, opts);
      }
    }catch(e){
      if (typeof prevRoute === 'function') return prevRoute.call(this, text, opts);
    }
  };

  if (typeof window.handlePrompt === 'function'){
    const prevHandlePrompt = window.handlePrompt;
    window.handlePrompt = async function(promptText){
      console.log("[chat-glue][debug] handlePrompt patched", promptText);
      try{
        const ok = await askAndRender(promptText);
        if (!ok) return prevHandlePrompt.call(this, promptText);
      }catch(e){ return prevHandlePrompt.call(this, promptText); }
    };
  }

  // Add a FORCE button to test a brand-new prompt (ensures generation path runs)
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('glueForceBtn')) return;
    const left = document.getElementById('left') || document.querySelector('.card');
    if (!left) return;
    const btn = document.createElement('button');
    btn.id = 'glueForceBtn';
    btn.textContent = 'Force New HeyGen Render';
    btn.style.cssText = 'margin-top:8px;width:100%;padding:10px 12px;border-radius:12px;background:#111523;border:1px solid rgba(255,255,255,0.1);color:#e8ecf3;cursor:pointer';
    btn.onclick = () => {
      const unique = "New prompt at " + new Date().toISOString().slice(11,19);
      if (typeof window.pushTurn === 'function') window.pushTurn('user', unique);
      window.routeToBackend(unique, { forceLLM:true });
    };
    left.appendChild(btn);
  });
})();