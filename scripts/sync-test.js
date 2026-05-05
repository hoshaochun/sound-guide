// Smoke test for the single-room model:
//   guide auth -> select ex1 -> play -> seek -> select ex2 -> stop
// All transitions should reach a connected listener.
const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3018';
const TOKEN = process.env.GUIDE_TOKEN || 'guide-secret-change-me';

const guide = io(URL);
const listener = io(URL);
const events = [];
const log = (who, ev, data) => events.push({ who, ev, data });

let done = false;
function finish(err) {
  if (done) return; done = true;
  guide.close(); listener.close();
  if (err) {
    console.error('FAIL:', err);
    console.log(JSON.stringify(events, null, 2));
    process.exit(1);
  }
  console.log('OK — listener saw:',
    events.filter(e => e.who === 'listener' && e.ev === 'state')
          .map(e => `[${e.data.exhibitId || '-'} pos=${e.data.position} play=${e.data.playing}]`).join(' '));
  process.exit(0);
}

listener.on('state', s => log('listener', 'state', s));

guide.on('connect', () => {
  guide.emit('guide:auth', TOKEN, resp => {
    if (!resp || !resp.ok) return finish('auth failed');
    listener.emit('listener:join');
    setTimeout(() => guide.emit('guide:select', 'ex1'), 50);
    setTimeout(() => guide.emit('guide:play'), 150);
    setTimeout(() => guide.emit('guide:seek', 5), 350);
    setTimeout(() => guide.emit('guide:select', 'ex2'), 500);
    setTimeout(() => guide.emit('guide:play'), 600);
    setTimeout(() => guide.emit('guide:stop'), 800);
    setTimeout(() => {
      const states = events.filter(e => e.who === 'listener' && e.ev === 'state');
      const sawEx1Play  = states.some(s => s.data.exhibitId === 'ex1' && s.data.playing);
      const sawSeek5    = states.some(s => s.data.exhibitId === 'ex1' && s.data.position >= 5);
      const sawEx2      = states.some(s => s.data.exhibitId === 'ex2');
      const sawStop     = states.some(s => s.data.exhibitId === 'ex2' && !s.data.playing && s.data.position === 0);
      if (!sawEx1Play) return finish('listener never saw ex1 playing');
      if (!sawSeek5)   return finish('listener never saw ex1 seeked to 5s');
      if (!sawEx2)     return finish('listener never saw exhibit switch to ex2');
      if (!sawStop)    return finish('listener never saw stop on ex2');
      finish();
    }, 1100);
  });
});

setTimeout(() => finish('timeout'), 3000);
