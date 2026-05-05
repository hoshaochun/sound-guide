(() => {
  const $ = sel => document.querySelector(sel);

  const params = new URLSearchParams(location.search);
  const exhibitId = params.get('e');

  const titleEl = $('#exhibit-title');
  const descEl  = $('#exhibit-desc');
  const joinCard = $('#join-card');
  const joinBtn = $('#join-btn');
  const playerCard = $('#player-card');
  const statusEl = $('#status');
  const timeEl = $('#time');
  const progressEl = $('#progress');
  const audio = $('#player');

  if (!exhibitId) {
    titleEl.textContent = 'No exhibit specified';
    descEl.textContent = 'This page should be opened by scanning an exhibit’s QR code.';
    joinCard.hidden = true;
    return;
  }

  let exhibit = null;
  let serverState = null;
  let lastApplied = null;          // updatedAt of the last state we acted on
  let mediaReady = false;          // audio metadata loaded -> seeking is safe
  const clock = new SyncClock();
  let socket = null;

  async function loadExhibit() {
    const r = await fetch(`/api/exhibits/${encodeURIComponent(exhibitId)}`);
    if (!r.ok) {
      titleEl.textContent = 'Exhibit not found';
      joinCard.hidden = true;
      return;
    }
    exhibit = await r.json();
    titleEl.textContent = exhibit.title;
    descEl.textContent = exhibit.description || '';
    audio.src = exhibit.audio;
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function targetPosition() {
    if (!serverState) return 0;
    if (!serverState.playing) return serverState.position;
    return serverState.position + (clock.serverNow() - serverState.updatedAt) / 1000;
  }

  function renderStatus() {
    if (!serverState) {
      statusEl.textContent = 'connecting'; statusEl.className = 'status connecting';
      return;
    }
    statusEl.textContent = serverState.playing ? 'PLAYING' : 'PAUSED';
    statusEl.className = 'status ' + (serverState.playing ? 'playing' : 'paused');
  }

  // Apply each new server state exactly once. Between events the local audio
  // plays freely — we accept a small drift over the duration of a track in
  // exchange for not glitching the audio with periodic seeks.
  function applyState({ force = false } = {}) {
    if (!serverState) return;
    if (!force && lastApplied === serverState.updatedAt) return;
    if (!mediaReady) return; // will be retried from the canplay handler
    lastApplied = serverState.updatedAt;

    if (!serverState.playing) {
      if (!audio.paused) audio.pause();
      return;
    }

    const target = targetPosition();
    const dur = isFinite(audio.duration) ? audio.duration : 0;
    if (dur && target >= dur) {
      audio.pause();
      return;
    }
    try { audio.currentTime = target; } catch (_) {}
    audio.play().catch(() => {});
  }

  // UI ticker — purely cosmetic, no sync work.
  setInterval(() => {
    if (audio.duration) progressEl.value = audio.currentTime / audio.duration;
    timeEl.textContent = fmt(audio.currentTime);
  }, 250);

  joinBtn.onclick = async () => {
    joinBtn.disabled = true;
    joinBtn.textContent = 'Joining…';

    await loadExhibit();
    if (!exhibit) return;

    audio.addEventListener('loadedmetadata', () => { mediaReady = true; applyState(); });
    audio.addEventListener('canplay',        () => { mediaReady = true; applyState(); });

    // Tap gesture lets us prime audio playback on iOS/Android.
    try { audio.muted = false; await audio.play(); audio.pause(); } catch (_) {}

    await clock.sync();

    socket = io({ autoConnect: true });
    socket.on('connect', () => socket.emit('listener:join', exhibitId));
    socket.on('state', s => {
      serverState = s;
      renderStatus();
      applyState();
    });

    joinCard.hidden = true;
    playerCard.hidden = false;
  };

  // Phone was locked / tab was hidden — when it comes back, treat it like a
  // fresh start: re-sync the clock and re-apply the current server state once.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && socket) {
      await clock.sync(3);
      applyState({ force: true });
    }
  });
})();
