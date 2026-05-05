// Smoke test: verify guide auth -> select -> play broadcasts state to listener.
const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3017';
const TOKEN = process.env.GUIDE_TOKEN || 'guide-secret-change-me';

const guide = io(URL);
const listener = io(URL);

const events = [];
const log = (who, ev, data) => events.push({ who, ev, data });

let done = false;
function finish(err) {
  if (done) return; done = true;
  guide.close(); listener.close();
  console.log(JSON.stringify(events, null, 2));
  if (err) { console.error('FAIL:', err); process.exit(1); }
  console.log('OK');
  process.exit(0);
}

listener.on('state', s => log('listener', 'state', s));
guide.on('state',    s => log('guide',    'state', s));

guide.on('connect', () => {
  guide.emit('guide:auth', TOKEN, resp => {
    log('guide', 'auth', resp);
    if (!resp.ok) return finish('auth failed');
    listener.emit('listener:join', 'ex1');
    setTimeout(() => guide.emit('guide:select', 'ex1'), 50);
    setTimeout(() => guide.emit('guide:play'), 150);
    setTimeout(() => guide.emit('guide:seek', 5), 350);
    setTimeout(() => guide.emit('guide:pause'), 550);
    setTimeout(() => {
      const listenerStates = events.filter(e => e.who === 'listener' && e.ev === 'state');
      const sawPlay  = listenerStates.some(s => s.data.playing === true);
      const sawSeek  = listenerStates.some(s => s.data.position >= 5 && s.data.position < 6);
      const sawPause = listenerStates.some(s => s.data.playing === false && s.data.position > 0);
      if (!sawPlay)  return finish('listener never saw playing=true');
      if (!sawSeek)  return finish('listener never saw seek to 5s');
      if (!sawPause) return finish('listener never saw pause');
      finish();
    }, 800);
  });
});

setTimeout(() => finish('timeout'), 3000);
