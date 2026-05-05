const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const PUBLIC_HOST = process.env.PUBLIC_HOST || '140.112.90.44';
const GUIDE_TOKEN = process.env.GUIDE_TOKEN || 'guide-secret-change-me';

const exhibits = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'exhibits.json'), 'utf8')
).exhibits;
const exhibitMap = Object.fromEntries(exhibits.map(e => [e.id, e]));

// Per-exhibit playback state. Authoritative on the server.
//   playing      — bool, currently playing or paused
//   position     — seconds into the track at the moment updatedAt was captured
//   updatedAt    — server epoch ms when state was set
const state = {};
for (const e of exhibits) {
  state[e.id] = { playing: false, position: 0, updatedAt: Date.now() };
}

function snapshot(exhibitId) {
  const s = state[exhibitId];
  return {
    exhibitId,
    playing: s.playing,
    position: s.position,
    updatedAt: s.updatedAt,
    serverNow: Date.now(),
  };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/audio', express.static(path.join(__dirname, 'audio')));

app.get('/listen', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'listen.html')));
app.get('/guide',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'guide.html')));

app.get('/api/exhibits', (_req, res) => res.json(exhibits));

app.get('/api/exhibits/:id', (req, res) => {
  const ex = exhibitMap[req.params.id];
  if (!ex) return res.status(404).json({ error: 'not found' });
  res.json(ex);
});

app.get('/api/state/:id', (req, res) => {
  if (!state[req.params.id]) return res.status(404).json({ error: 'not found' });
  res.json(snapshot(req.params.id));
});

app.get('/api/qr/:id', async (req, res) => {
  const ex = exhibitMap[req.params.id];
  if (!ex) return res.status(404).send('not found');
  const host = req.get('host');
  const proto = req.protocol;
  const url = `${proto}://${host}/listen?e=${encodeURIComponent(ex.id)}`;
  const png = await QRCode.toBuffer(url, { width: 512, margin: 2 });
  res.type('png').send(png);
});

app.get('/api/time', (_req, res) => res.json({ serverNow: Date.now() }));

io.on('connection', socket => {
  let role = null;          // 'guide' or 'listener'
  let joinedExhibit = null;

  socket.on('listener:join', exhibitId => {
    if (!state[exhibitId]) return;
    role = 'listener';
    joinedExhibit = exhibitId;
    socket.join(exhibitId);
    socket.emit('state', snapshot(exhibitId));
  });

  socket.on('guide:auth', (token, ack) => {
    if (token !== GUIDE_TOKEN) {
      if (typeof ack === 'function') ack({ ok: false });
      return;
    }
    role = 'guide';
    if (typeof ack === 'function') ack({ ok: true, exhibits });
  });

  socket.on('guide:select', exhibitId => {
    if (role !== 'guide' || !state[exhibitId]) return;
    if (joinedExhibit && joinedExhibit !== exhibitId) {
      socket.leave(joinedExhibit);
    }
    joinedExhibit = exhibitId;
    socket.join(exhibitId);
    socket.emit('state', snapshot(exhibitId));
  });

  socket.on('guide:play', () => {
    if (role !== 'guide' || !joinedExhibit) return;
    const s = state[joinedExhibit];
    if (s.playing) return;
    s.playing = true;
    s.updatedAt = Date.now();
    io.to(joinedExhibit).emit('state', snapshot(joinedExhibit));
  });

  socket.on('guide:pause', () => {
    if (role !== 'guide' || !joinedExhibit) return;
    const s = state[joinedExhibit];
    if (!s.playing) return;
    // Freeze position at "where we are now".
    s.position = s.position + (Date.now() - s.updatedAt) / 1000;
    s.playing = false;
    s.updatedAt = Date.now();
    io.to(joinedExhibit).emit('state', snapshot(joinedExhibit));
  });

  socket.on('guide:seek', position => {
    if (role !== 'guide' || !joinedExhibit) return;
    if (typeof position !== 'number' || position < 0) return;
    const s = state[joinedExhibit];
    s.position = position;
    s.updatedAt = Date.now();
    io.to(joinedExhibit).emit('state', snapshot(joinedExhibit));
  });

  socket.on('guide:stop', () => {
    if (role !== 'guide' || !joinedExhibit) return;
    const s = state[joinedExhibit];
    s.playing = false;
    s.position = 0;
    s.updatedAt = Date.now();
    io.to(joinedExhibit).emit('state', snapshot(joinedExhibit));
  });
});

server.listen(PORT, () => {
  // On Render, RENDER_EXTERNAL_URL is the full https://... URL of the service.
  // Otherwise fall back to the configured public host + port (useful for self-hosting).
  const base = process.env.RENDER_EXTERNAL_URL || `http://${PUBLIC_HOST}:${PORT}`;
  console.log(`Sound guide running on ${base}`);
  console.log(`Guide page:    ${base}/guide  (token: ${GUIDE_TOKEN})`);
  console.log(`QR overview:   ${base}/qr.html`);
});
