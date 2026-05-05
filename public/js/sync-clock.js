// Estimates client->server clock offset so we can interpret server timestamps.
// Usage:
//   const clock = new SyncClock();
//   await clock.sync();              // sample a few times
//   const elapsed = clock.now() - serverTimestamp; // ms since serverTimestamp
//
// Algorithm: NTP-ish. Send t0=clientNow, server replies t1=serverNow,
// receive at t2=clientNow. Round-trip = t2-t0. Best estimate of server clock
// at moment server replied: t1. Offset = t1 - (t0 + (t2-t0)/2). Take min RTT
// sample for stability.
class SyncClock {
  constructor() { this.offset = 0; }
  async sync(samples = 5) {
    let best = { rtt: Infinity, offset: 0 };
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      const r  = await fetch('/api/time', { cache: 'no-store' });
      const t2 = Date.now();
      const { serverNow } = await r.json();
      const rtt    = t2 - t0;
      const offset = serverNow - (t0 + rtt / 2);
      if (rtt < best.rtt) best = { rtt, offset };
    }
    this.offset = best.offset;
    return this.offset;
  }
  // Server-time "now" estimate, in ms.
  serverNow() { return Date.now() + this.offset; }
}
window.SyncClock = SyncClock;
