/**
 * Task 22.1 — Stop/Start visual toggle (non‑regressive)
 * - Expects existing elements:
 *      <video id="dopVideo" autoplay muted loop playsinline>…</video>
 *      <button id="stopStartBtn">Stop</button>
 * - Keeps autoplay/mute/loop intact (no baseline changes).
 * - Only toggles the button label and calls pause()/play().
 */

(function () {
  const video = document.getElementById('dopVideo');
  const btn = document.getElementById('stopStartBtn');

  if (!video || !btn) {
    console.warn('[22.1] Missing #dopVideo or #stopStartBtn — add those IDs to your existing elements.');
    return;
  }

  // Visual state helpers
  function setStop() {
    btn.textContent = 'Stop';
    btn.setAttribute('aria-pressed', 'true');
    btn.classList.remove('is-start');
    btn.classList.add('is-stop');
  }
  function setStart() {
    btn.textContent = 'Start';
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('is-stop');
    btn.classList.add('is-start');
  }

  // Initialize label based on current playback
  function syncToVideoState() {
    if (!video.paused && !video.ended) setStop();
    else setStart();
  }

  // Button click → toggle play/pause (no baseline regression)
  btn.addEventListener('click', () => {
    if (!video.paused && !video.ended) {
      try { video.pause(); } catch (e) {}
      setStart();
      return;
    }
    try { video.play(); } catch (e) {}
    setStop();
  });

  // Keep label in sync with actual media events
  video.addEventListener('playing', syncToVideoState);
  video.addEventListener('pause',   syncToVideoState);
  video.addEventListener('ended',   syncToVideoState);
  document.addEventListener('visibilitychange', syncToVideoState);

  // First sync on load
  if (video.readyState >= 2) syncToVideoState();
  else video.addEventListener('loadeddata', syncToVideoState);

  // Optional tiny CSS polish injected here (scoped to the button)
  const css = `
    #stopStartBtn.is-stop { opacity: 1; }
    #stopStartBtn.is-start { opacity: .9; }
    #stopStartBtn { transition: opacity .15s ease, transform .06s ease; }
    #stopStartBtn:active { transform: scale(0.98); }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();
