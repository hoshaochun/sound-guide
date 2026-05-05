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

// One global tour state. The guide picks which exhibit plays for everyone.
//   exhibitId  — currently selected exhibit, or null if none yet
//   playing    — whether audio is playing right now
//   position   — seconds into the track at the moment updatedAt was captured
//   updatedAt  — server epoch ms when state was last set
const state = {
  exhibitId: null,
  playing: false,
  position: 0,
  updatedAt: Date.now(),
};
const TOUR_ROOM = 'tour';

function snapshot() {
  return {
    exhibitId: state.exhibitId,
    exhibit: state.exhibitId ? exhibitMap[state.exhibitId] : null,
    playing: state.playing,
    position: state.position,
    updatedAt: state.updatedAt,
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
app.get('/api/state',    (_req, res) => res.json(snapshot()));
app.get('/api/time',     (_req, res) => res.json({ serverNow: Date.now() }));

// One QR code that everyone scans to join the tour.
app.get('/api/qr', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/listen`;
  const png = await QRCode.toBuffer(url, { width: 768, margin: 2 });
  res.type('png').send(png);
});

io.on('connection', socket => {
  let role = null;          // 'guide' or 'listener'

  socket.on('listener:join', () => {
    role = 'listener';
    socket.join(TOUR_ROOM);
    socket.emit('state', snapshot());
  });

  socket.on('guide:auth', (token, ack) => {
    if (token !== GUIDE_TOKEN) {
      if (typeof ack === 'function') ack({ ok: false });
      return;
    }
    role = 'guide';
    socket.join(TOUR_ROOM); // so the guide also receives broadcasts
    if (typeof ack === 'function') ack({ ok: true, exhibits, state: snapshot() });
  });

  socket.on('guide:select', exhibitId => {
    if (role !== 'guide' || !exhibitMap[exhibitId]) return;
    state.exhibitId = exhibitId;
    state.position = 0;
    state.playing = false;
    state.updatedAt = Date.now();
    io.to(TOUR_ROOM).emit('state', snapshot());
  });

  socket.on('guide:play', () => {
    if (role !== 'guide' || !state.exhibitId) return;
    if (state.playing) return;
    state.playing = true;
    state.updatedAt = Date.now();
    io.to(TOUR_ROOM).emit('state', snapshot());
  });

  socket.on('guide:pause', () => {
    if (role !== 'guide' || !state.exhibitId) return;
    if (!state.playing) return;
    state.position = state.position + (Date.now() - state.updatedAt) / 1000;
    state.playing = false;
    state.updatedAt = Date.now();
    io.to(TOUR_ROOM).emit('state', snapshot());
  });

  socket.on('guide:seek', position => {
    if (role !== 'guide' || !state.exhibitId) return;
    if (typeof position !== 'number' || position < 0) return;
    state.position = position;
    state.updatedAt = Date.now();
    io.to(TOUR_ROOM).emit('state', snapshot());
  });

  socket.on('guide:stop', () => {
    if (role !== 'guide' || !state.exhibitId) return;
    state.playing = false;
    state.position = 0;
    state.updatedAt = Date.now();
    io.to(TOUR_ROOM).emit('state', snapshot());
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
