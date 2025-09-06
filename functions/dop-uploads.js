<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
  <title>Chat with DOP - Dopple Talent Agency</title>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&display=swap" rel="stylesheet">

  <style>
    :root{
      --bg:#0e0f12; --bg-2:#08090c;
      --panel:#12131a; --panel-2:#1a1b25;
      --text:#ececf1; --muted:#b7b8c3;
      --stroke:#26283a; --stroke-strong:#3a3b52;
      --accent:#8a8cff;
      --ok:#16db65; --warn:#ffd166; --stop:#ff6b6b;
      --shadow:0 10px 30px rgba(0,0,0,.35); --radius:16px;
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0; font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      color:var(--text);
      background:
        radial-gradient(1200px 600px at 80% -10%, rgba(94,97,255,.12), transparent 40%),
        radial-gradient(900px 480px at 0% 110%, rgba(138,140,255,.10), transparent 45%),
        linear-gradient(180deg,var(--bg),var(--bg-2));
      min-height:100vh;
    }

    .wrap{max-width:1100px; margin:0 auto; padding:28px 20px 48px}
    .card{
      position:relative;
      background:linear-gradient(180deg,var(--panel),var(--panel-2));
      border:1px solid var(--stroke);
      border-radius:var(--radius);
      box-shadow:var(--shadow);
      padding:26px 22px 32px;
      margin:18px 0;
    }
    .section{max-width:980px; margin:0 auto}
    
    /* Header */
    .header{
      display:flex; align-items:center; gap:16px; margin-bottom:24px;
      padding:16px 0; border-bottom:1px solid var(--stroke);
    }
    .avatar{
      width:50px; height:50px; border-radius:50%;
      background:var(--stroke); object-fit:cover;
    }
    .dop-info h1{
      margin:0; font-size:1.5rem; font-weight:700;
      font-family:'Montserrat',sans-serif;
    }
    .dop-info p{margin:4px 0 0; color:var(--muted); font-size:14px}

    /* Loading/Error States */
    .status{
      text-align:center; padding:40px; color:var(--muted);
    }
    .status.error{color:var(--stop)}
    .spinner{
      width:32px; height:32px; border:3px solid var(--stroke);
      border-top-color:var(--accent); border-radius:50%;
      animation:spin 1s linear infinite; margin:0 auto 16px;
    }
    @keyframes spin{to{transform:rotate(360deg)}}

    /* Prompt buttons */
    .prompt-grid{
      display:flex; flex-wrap:wrap; justify-content:center;
      gap:12px 14px; margin:18px auto 36px; max-width:1000px; padding:0 6px;
    }
    .btn{
      appearance:none; border:none; cursor:pointer;
      padding:10px 14px; border-radius:16px; font-size:12px;
      font-family:'Montserrat',sans-serif; font-weight:700; text-transform:uppercase;
      background:linear-gradient(180deg,#fff,#efefef); color:#000;
      border:1px solid #e7e7e7; white-space:nowrap;
      transition:transform .15s ease, opacity .15s ease;
    }
    .btn:hover{transform:translateY(-1px)}
    .btn[disabled]{opacity:.45; cursor:not-allowed}

    /* Video/Image Display */
    .hero{display:flex; justify-content:center; position:relative; margin-bottom:24px}
    .dop-video{
      width:min(100%,560px); aspect-ratio:16/9; max-height:400px; border-radius:14px;
      border:1px solid var(--stroke-strong);
      box-shadow:0 12px 32px rgba(0,0,0,.35);
      background:var(--panel); object-fit:cover;
    }
    .dop-image{
      width:min(100%,400px); max-height:400px; border-radius:14px;
      border:1px solid var(--stroke-strong);
      box-shadow:0 12px 32px rgba(0,0,0,.35);
      object-fit:cover; background:var(--panel);
    }

    /* Status pill */
    .status-rail{display:flex; justify-content:center; margin-top:16px}
    .pill{
      display:inline-flex; align-items:center; gap:8px;
      background:#191a23; border:1px solid var(--stroke-strong);
      color:#cfd0dc; border-radius:999px; padding:7px 12px;
      font-size:12px; letter-spacing:.2px;
      box-shadow:0 6px 16px rgba(0,0,0,.25);
    }
    .dot{width:8px; height:8px; border-radius:999px; background:#666}
    .pill.thinking .dot{background:#8a8cff}
    .pill.generating .dot{background:#ffd166}
    .pill.speaking .dot{background:#16db65}
    .pill.ready .dot{background:#6f7284}

    /* HeyGen badge */
    .heygen-badge{
      position:absolute; top:12px; right:12px;
      background:linear-gradient(135deg,#00d4ff,#0099cc);
      color:#000; font-size:10px; font-weight:700;
      padding:4px 8px; border-radius:12px; text-transform:uppercase;
      box-shadow:0 4px 12px rgba(0,212,255,.3);
    }

    @media (max-width:480px){
      .header{flex-direction:column; text-align:center}
      .dop-video, .dop-image{max-height:300px}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card section">
      <!-- DOP Header -->
      <div class="header" id="dopHeader" style="display:none">
        <img class="avatar" id="dopAvatar" alt="DOP Avatar" />
        <div class="dop-info">
          <h1 id="dopName">Loading...</h1>
          <p id="dopDescription">Loading personality...</p>
        </div>
      </div>

      <!-- Loading/Error States -->
      <div class="status" id="loadingState">
        <div class="spinner"></div>
        <div>Loading your DOP...</div>
      </div>
      
      <div class="status error" id="errorState" style="display:none">
        <div>Sorry, this DOP couldn't be loaded.</div>
        <div style="font-size:12px; margin-top:8px" id="errorDetails"></div>
      </div>

      <!-- Chat Interface (hidden until loaded) -->
      <div id="chatInterface" style="display:none">
        <!-- DOP Video/Image Display -->
        <div class="hero">
          <video class="dop-video" id="dopVideo" style="display:none" controls playsinline>
            Your browser does not support video playback.
          </video>
          <img class="dop-image" id="dopImage" alt="DOP" />
          <div class="heygen-badge" id="heygenBadge" style="display:none">AI Avatar</div>
        </div>

        <!-- Status pill -->
        <div class="status-rail">
          <div id="statusPill" class="pill ready">
            <span class="dot"></span>
            <span id="pillText">Ready</span>
          </div>
        </div>

        <!-- Prompt Buttons -->
        <div class="prompt-grid" id="promptGrid">
          <!-- Dynamically populated -->
        </div>
      </div>
    </div>
  </div>

  <script>
    // Get DOP ID from URL
    const pathParts = window.location.pathname.split('/');
    const dopId = pathParts[pathParts.length - 1] || new URLSearchParams(window.location.search).get('id');

    // Elements
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const errorDetails = document.getElementById('errorDetails');
    const chatInterface = document.getElementById('chatInterface');
    const dopHeader = document.getElementById('dopHeader');
    const dopName = document.getElementById('dopName');
    const dopDescription = document.getElementById('dopDescription');
    const dopAvatar = document.getElementById('dopAvatar');
    const dopImage = document.getElementById('dopImage');
    const dopVideo = document.getElementById('dopVideo');
    const heygenBadge = document.getElementById('heygenBadge');
    const promptGrid = document.getElementById('promptGrid');
    const statusPill = document.getElementById('statusPill');
    const pillText = document.getElementById('pillText');

    // Session state
    let persona = null;
    let sessionId = generateSessionId();

    function generateSessionId() {
      return 'chat_' + Math.random().toString(36).substr(2, 9);
    }

    // Status pill
    function setPill(mode, text) {
      statusPill.classList.remove('thinking', 'generating', 'speaking', 'ready');
      statusPill.classList.add(mode);
      pillText.textContent = text;
    }

    // Load DOP persona
    async function loadDOP() {
      if (!dopId) {
        showError('No DOP ID provided in URL');
        return;
      }

      try {
        // Load persona config
        const personaResponse = await fetch(`/.netlify/functions/dop-persona?id=${encodeURIComponent(dopId)}`);
        
        if (!personaResponse.ok) {
          const errorData = await personaResponse.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to load DOP (${personaResponse.status})`);
        }

        persona = await personaResponse.json();
        
        // Update UI with DOP info
        dopName.textContent = persona.displayName || persona.name || 'DOP';
        dopDescription.textContent = persona.description || 'Your AI doppelgänger';
        
        // Set avatar and main image using base64 data
        if (persona.image || persona.imageBase64) {
          const imageUrl = persona.image || `data:image/jpeg;base64,${persona.imageBase64}`;
          dopAvatar.src = imageUrl;
          dopImage.src = imageUrl;
        }

        // Show HeyGen badge if avatar is available
        if (persona.heygenEnabled && persona.heygenAvatarId) {
          heygenBadge.style.display = 'block';
        }

        // Create prompt buttons
        if (persona.prompts && persona.prompts.length > 0) {
          promptGrid.innerHTML = persona.prompts.map(prompt => 
            `<button class="btn" onclick="askPrompt('${prompt.replace(/'/g, "\\\'")}')">${prompt}</button>`
          ).join('');
        }

        // Show chat interface
        loadingState.style.display = 'none';
        dopHeader.style.display = 'flex';
        chatInterface.style.display = 'block';
        
        console.log('DOP loaded successfully:', persona);

      } catch (error) {
        console.error('Failed to load DOP:', error);
        showError(error.message);
      }
    }

    function showError(message) {
      loadingState.style.display = 'none';
      errorState.style.display = 'block';
      errorDetails.textContent = message;
    }

    // Chat functions with HeyGen video generation
    function askPrompt(promptText) {
      console.log('Asking:', promptText);
      setPill('thinking', 'Thinking...');
      
      // Call session-chat with this persona
      fetch('/.netlify/functions/session-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          message: promptText,
          personaId: dopId,
          context: []
        })
      })
      .then(response => response.json())
      .then(data => {
        if (data.reply) {
          console.log('DOP replied:', data.reply);
          
          // Generate HeyGen video if avatar is available
          if (persona.heygenEnabled && persona.heygenAvatarId) {
            generateHeyGenVideo(data.reply);
          } else {
            // Fallback to audio only
            speakText(data.reply);
          }
        } else {
          setPill('ready', 'Ready');
        }
      })
      .catch(error => {
        console.error('Chat error:', error);
        alert('Sorry, there was an error with the conversation.');
        setPill('ready', 'Ready');
      });
    }

    // Generate HeyGen video response
    async function generateHeyGenVideo(text) {
      setPill('generating', 'Generating video...');
      
      try {
        console.log('Generating HeyGen video with avatar:', persona.heygenAvatarId);
        
        const response = await fetch('/.netlify/functions/heygen-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate_video',
            text: text,
            avatarId: persona.heygenAvatarId,
            voiceId: persona.voiceId
          })
        });

        const result = await response.json();
        console.log('HeyGen response:', result);
        
        if (result.success && result.video_id) {
          // Poll for video completion
          checkVideoStatus(result.video_id);
        } else {
          console.warn('HeyGen video generation failed:', result);
          throw new Error('Video generation failed');
        }
      } catch (error) {
        console.error('HeyGen video error:', error);
        // Fallback to audio
        speakText(text);
      }
    }

    // Check video generation status
    async function checkVideoStatus(videoId) {
      try {
        const response = await fetch('/.netlify/functions/heygen-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_video',
            videoId: videoId
          })
        });

        const result = await response.json();
        
        if (result.success) {
          if (result.status === 'completed' && result.video_url) {
            // Play the generated video
            playHeyGenVideo(result.video_url);
          } else if (result.status === 'processing') {
            // Keep polling
            setTimeout(() => checkVideoStatus(videoId), 3000);
          } else {
            throw new Error('Video generation failed');
          }
        } else {
          throw new Error('Status check failed');
        }
      } catch (error) {
        console.error('Video status check error:', error);
        setPill('ready', 'Ready');
      }
    }

    // Play HeyGen generated video
    function playHeyGenVideo(videoUrl) {
      setPill('speaking', 'Speaking...');
      
      // Hide image, show video
      dopImage.style.display = 'none';
      dopVideo.style.display = 'block';
      dopVideo.src = videoUrl;
      
      dopVideo.onended = () => {
        // Show image again, hide video
        dopVideo.style.display = 'none';
        dopImage.style.display = 'block';
        setPill('ready', 'Ready');
      };
      
      dopVideo.onerror = () => {
        dopVideo.style.display = 'none';
        dopImage.style.display = 'block';
        setPill('ready', 'Ready');
      };
      
      dopVideo.play().catch(console.error);
    }

    // Fallback audio-only response
    async function speakText(text) {
      setPill('speaking', 'Speaking...');
      
      try {
        const voiceId = persona?.voiceId || null;
        
        const response = await fetch('/.netlify/functions/tts-eleven', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text,
            voiceId: voiceId
          })
        });

        if (response.ok) {
          const audioBuffer = await response.arrayBuffer();
          const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
          const audioUrl = URL.createObjectURL(audioBlob);
          
          const audio = new Audio(audioUrl);
          await audio.play();
          
          audio.addEventListener('ended', () => {
            setPill('ready', 'Ready');
            URL.revokeObjectURL(audioUrl);
          });
        } else {
          throw new Error('TTS failed');
        }
      } catch (error) {
        console.error('TTS error:', error);
        setPill('ready', 'Ready');
      }
    }

    // Initialize
    loadDOP();
  </script>
</body>
</html>