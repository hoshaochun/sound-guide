(() => {
  const $ = sel => document.querySelector(sel);

  const authCard = $('#auth-card');
  const controlCard = $('#control-card');
  const tokenInput = $('#token');
  const authBtn = $('#auth-btn');
  const authMsg = $('#auth-msg');
  const exhibitList = $('#exhibit-list');
  const currentTitle = $('#current-title');
  const statusEl = $('#status');
  const timeEl = $('#time');
  const progressEl = $('#progress');
  const playBtn = $('#play-btn');
  const pauseBtn = $('#pause-btn');
  const backBtn = $('#back-btn');
  const fwdBtn = $('#fwd-btn');
  const stopBtn = $('#stop-btn');

  const socket = io({ autoConnect: true });
  const clock = new SyncClock();

  let exhibits = [];
  let currentExhibitId = null;
  let serverState = null; // last snapshot from server

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function currentPosition() {
    if (!serverState) return 0;
    if (!serverState.playing) return serverState.position;
    return serverState.position + (clock.serverNow() - serverState.updatedAt) / 1000;
  }

  function renderExhibits() {
    exhibitList.innerHTML = '';
    for (const ex of exhibits) {
      const li = document.createElement('li');
      const sel = ex.id === currentExhibitId;
      li.innerHTML = `
        <strong>${ex.title}</strong>
        <div class="muted">${ex.description || ''}</div>
      `;
      const btn = document.createElement('button');
      btn.textContent = sel ? 'Selected' : 'Select';
      btn.className = sel ? '' : 'secondary';
      btn.disabled = sel;
      btn.onclick = () => {
        currentExhibitId = ex.id;
        socket.emit('guide:select', ex.id);
        currentTitle.textContent = ex.title;
        renderExhibits();
      };
      li.appendChild(btn);
      exhibitList.appendChild(li);
    }
  }

  function renderStatus() {
    if (!serverState) {
      statusEl.textContent = 'connecting';
      statusEl.className = 'status connecting';
      return;
    }
    statusEl.textContent = serverState.playing ? 'PLAYING' : 'PAUSED';
    statusEl.className = 'status ' + (serverState.playing ? 'playing' : 'paused');
  }

  function tick() {
    if (!serverState) return;
    const pos = currentPosition();
    timeEl.textContent = fmt(pos);
    // We don't know audio duration here; keep progress bar relative-ish.
    progressEl.value = (pos % 60) / 60;
  }
  setInterval(tick, 250);

  authBtn.onclick = async () => {
    authMsg.textContent = 'Signing in…';
    await clock.sync();
    socket.emit('guide:auth', tokenInput.value, resp => {
      if (!resp || !resp.ok) {
        authMsg.textContent = 'Invalid token.';
        return;
      }
      exhibits = resp.exhibits;
      authCard.hidden = true;
      controlCard.hidden = false;
      renderExhibits();
    });
  };

  socket.on('state', s => { serverState = s; renderStatus(); });

  function requireExhibit() {
    if (!currentExhibitId) { alert('Select an exhibit first.'); return false; }
    return true;
  }

  playBtn.onclick  = () => requireExhibit() && socket.emit('guide:play');
  pauseBtn.onclick = () => requireExhibit() && socket.emit('guide:pause');
  stopBtn.onclick  = () => requireExhibit() && socket.emit('guide:stop');
  backBtn.onclick  = () => requireExhibit() && socket.emit('guide:seek', Math.max(0, currentPosition() - 10));
  fwdBtn.onclick   = () => requireExhibit() && socket.emit('guide:seek', currentPosition() + 10);
})();
