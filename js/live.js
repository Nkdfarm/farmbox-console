// Live updates (0.7.208, owner 3 Oct 2026: "add live update"). The phones and the consoles of a site share one
// Supabase Realtime broadcast channel: whoever changes something says "moved", and everybody else reads again at
// once instead of at the next minute — a task taken on a phone shows its lock here in about a second.
// Nothing travels on the channel but that one word: what moved is read from the database as always, with each
// person's own rights. No table is published; the minute's refresh stays underneath for a missed message.
import { URL_BASE, ANON } from './api.js';

let ws = null, topic = null, beat = null, retry = null, ref = 0, onMoved = null, debounce = null, lastSaid = 0;

const send = (event, payload, t = topic) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ topic: t, event, ref: String(++ref), payload }));
};
function close() {
  clearInterval(beat); clearTimeout(retry); beat = retry = null;
  if (ws) { ws.onclose = null; try { ws.close(); } catch { /* already closed */ } ws = null; }
}
function open() {
  if (!topic || ws || document.hidden || !navigator.onLine) return;
  try { ws = new WebSocket(URL_BASE.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + ANON + '&vsn=1.0.0'); }
  catch { ws = null; return; }
  ws.onopen = () => {
    send('phx_join', { config: { broadcast: { self: false }, presence: { key: '' } } });
    beat = setInterval(() => send('heartbeat', {}, 'phoenix'), 25000);
  };
  ws.onmessage = e => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.topic !== topic || d.event !== 'broadcast' || d.payload?.event !== 'moved') return;
    clearTimeout(debounce);
    debounce = setTimeout(() => { try { onMoved?.(); } catch { /* the page went away */ } }, 1200);
  };
  ws.onclose = () => { clearInterval(beat); ws = null; retry = setTimeout(open, 20000); };
  ws.onerror = () => { try { ws?.close(); } catch { /* nothing to close */ } };
}

// watch a site (its home unit's id): `moved` is called, at most once a second or so, when somebody changed something
export function liveWatch(siteId, moved) {
  const t = siteId ? 'realtime:fb-live-' + siteId : null;
  onMoved = moved;
  if (t === topic && ws) return;
  close(); topic = t; open();
}
// say that something changed here (any write of this console does, through api.js)
export function liveSay() {
  if (Date.now() - lastSaid < 1000) return;
  lastSaid = Date.now();
  send('broadcast', { type: 'broadcast', event: 'moved', payload: {} });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) close(); else open(); });
addEventListener('online', open);
addEventListener('fbc:wrote', liveSay);
