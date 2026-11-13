// A minimal in-memory Nostr relay for local development and tests.
//   node scripts/dev-relay.js   then open the app with ?relays=ws://localhost:7777
import { WebSocketServer } from 'ws';

const events = new Map();
const subs = new Map(); // ws -> Map<subId, filters>
const match = (ev, f) =>
  (!f.kinds || f.kinds.includes(ev.kind)) &&
  Object.entries(f).every(([k, vals]) => !k.startsWith('#') || ev.tags.some((t) => t[0] === k.slice(1) && vals.includes(t[1])));

const wss = new WebSocketServer({ port: Number(process.env.PORT) || 7777 });
wss.on('connection', (ws) => {
  subs.set(ws, new Map());
  ws.on('close', () => subs.delete(ws));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const [type, a, ...rest] = msg;
    if (type === 'EVENT') {
      const fresh = !events.has(a.id);
      events.set(a.id, a);
      ws.send(JSON.stringify(['OK', a.id, true, '']));
      if (fresh) for (const [peer, m] of subs) for (const [id, filters] of m) if (filters.some((f) => match(a, f))) peer.send(JSON.stringify(['EVENT', id, a]));
    } else if (type === 'REQ') {
      subs.get(ws).set(a, rest);
      for (const ev of events.values()) if (rest.some((f) => match(ev, f))) ws.send(JSON.stringify(['EVENT', a, ev]));
      ws.send(JSON.stringify(['EOSE', a]));
    } else if (type === 'CLOSE') subs.get(ws).delete(a);
  });
});
console.log(`dev relay on ws://localhost:${wss.options.port}`);
