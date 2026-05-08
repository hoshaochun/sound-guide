(() => {
  const $ = sel => document.querySelector(sel);

  const titleEl = $('#exhibit-title');
  const descEl  = $('#exhibit-desc');
  const joinCard = $('#join-card');
  const joinBtn = $('#join-btn');
  const playerCard = $('#player-card');
  const statusEl = $('#status');
  const timeEl = $('#time');
  const progressEl = $('#progress');
  const audio = $('#player');

  let serverState = null;
  let lastApplied = null;          // updatedAt of the last state we acted on
  let mediaReady = false;          // audio metadata loaded -> seeking is safe
  let loadedExhibitId = null;      // which exhibit is currently in audio.src
  const clock = new SyncClock();
  let socket = null;

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
    if (!serverState.exhibitId) {
      statusEl.textContent = 'WAITING';   statusEl.className = 'status connecting';
      return;
    }
    statusEl.textContent = serverState.playing ? 'PLAYING' : 'PAUSED';
    statusEl.className = 'status ' + (serverState.playing ? 'playing' : 'paused');
  }

  // Sync once per server state change, then let the device play freely.
  function applyState({ force = false } = {}) {
    if (!serverState || !serverState.exhibitId) return;
    if (!force && lastApplied === serverState.updatedAt) return;
    if (!mediaReady) return; // canplay handler will retry
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

  // Load (or swap) the audio file for the current exhibit, then re-apply state.
  function loadExhibitAudio() {
    if (!serverState || !serverState.exhibit) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      titleEl.textContent = '等待播放員…';
      descEl.textContent = '';
      loadedExhibitId = null;
      mediaReady = false;
      return;
    }
    if (serverState.exhibitId === loadedExhibitId) return;

    loadedExhibitId = serverState.exhibitId;
    mediaReady = false;
    lastApplied = null;
    titleEl.textContent = serverState.exhibit.title;
    descEl.textContent  = serverState.exhibit.description || '';
    audio.pause();
    audio.src = serverState.exhibit.audio;
    audio.load();
  }

  // UI ticker — purely cosmetic.
  setInterval(() => {
    if (audio.duration) progressEl.value = audio.currentTime / audio.duration;
    timeEl.textContent = fmt(audio.currentTime);
  }, 250);

  // Audio element listeners — set once, fire on every src change.
  audio.addEventListener('loadedmetadata', () => { mediaReady = true; applyState(); });
  audio.addEventListener('canplay',        () => { mediaReady = true; applyState(); });

  joinBtn.onclick = async () => {
    joinBtn.disabled = true;
    joinBtn.textContent = '加入中…';

    // Prime audio for later programmatic playback. We DO NOT await the
    // returned promise — on iOS Safari, calling play() on an audio element
    // with no src returns a promise that never settles, which would hang
    // the whole join flow. The synchronous play() call inside this click
    // handler is what actually grants the user-gesture permission.
    try {
      audio.muted = false;
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      audio.pause();
    } catch (_) {}

    joinBtn.textContent = '同步中…';
    try { await clock.sync(); } catch (e) { console.error('clock sync failed', e); }

    joinBtn.textContent = '連線中…';
    socket = io({ autoConnect: true });
    socket.on('connect',       () => socket.emit('listener:join'));
    socket.on('connect_error', e => { console.error('connect_error', e.message); statusEl.textContent = '連線失敗'; });
    socket.on('state', s => {
      serverState = s;
      renderStatus();
      loadExhibitAudio();
      applyState();
    });

    joinCard.hidden = true;
    playerCard.hidden = false;
  };

  // Re-sync once when phone wakes from lock.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && socket) {
      await clock.sync(3);
      applyState({ force: true });
    }
  });
})();
