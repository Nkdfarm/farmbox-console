// Cameras (0.7.230, owner 5 Oct 2026: "connect the Reolink Duo 3 to Naked Heart"). The camera stays on the farm's
// own network: go2rtc on the always-on farm PC turns its RTSP into a browser stream, and a Cloudflare Tunnel publishes
// only the player at cam.nkd.farm. This console never holds a camera password or address, only that public name.
// Setup: ..\Vision\docs\camera\README.md.
//
// A tile two wide in the dashboard's grid, playing as soon as the overview opens (0.7.231, owner: "put it here,
// already open, at the top" — the gap the second row of tiles leaves). The farm is on 5G, so the stream is dropped
// whenever the tab is hidden and picked up again when it is seen; leaving the overview drops it too. With both
// units on screen only the first tile plays, the other waits for Watch. ⤢ opens the player in its own tab
// (left, by the name: the player's own MSE/HLS label sits top right).
//
// The Naked Heart sign-in opens the camera (0.7.234, owner 10 Oct 2026: "to have acces to the app we have a password
// anyway"; who may watch: "every one in naked heart"). The player sat behind a Cloudflare Access e-mail login of its
// own, and that login page refuses to be shown inside another page: the tile stayed black on every computer that had
// not opened ⤢ and signed in there first. Now the tile asks the platform for a pass (edge function camera-pass) and
// hands it to the gate in front of the camera (cam-gate.js, beside the setup), which keeps it as a cookie for the
// player. Nothing of the pass is kept here. When either step fails the player is asked for all the same: the gate
// then says what is wrong in the tile itself.
import { el } from './ui.js';
import { fn } from './api.js';

const CAM = 'https://cam.nkd.farm';
// unit: the FarmBox the camera looks at (its code, the pill on the overview); only that unit's overview shows it
const CAMERAS = [{ src: 'duo3', name: 'Duo 3', unit: 'FL' }];   // FarmLab (owner, 5 Oct 2026)

const player = c => `${CAM}/stream.html?src=${encodeURIComponent(c.src)}&mode=mse,hls`;
const playing = () => document.querySelector('.cam-tile iframe');

// One pass a visit, asked again when half its life is gone; several tiles share the one request.
let passUntil = 0, asking = null;
function door() {
  if (Date.now() < passUntil) return Promise.resolve();
  asking ||= (async () => {
    const p = await fn('camera-pass', null, { quiet: true });   // asks, changes nothing: not a write (api.js)
    const r = await fetch(CAM + '/pass', { method: 'POST', credentials: 'include', headers: { Authorization: 'Bearer ' + p.pass } });
    if (r.ok) passUntil = Date.now() + (p.expires_in || 0) * 500;
  })().catch(() => { /* offline, no camera for this account, the gate not answering: the player says so */ })
      .finally(() => { asking = null; });
  return asking;
}

export function cameraTiles(farm) {
  return CAMERAS.filter(c => c.unit === farm?.code).map(tile);
}

function tile(c) {
  const t = el('div', 'tile cam-tile');
  const screen = el('div', 'cam-screen');
  const bar = el('div', 'cam-bar');
  bar.append(el('span', 'cam-name', `${c.name} · live`));
  const watch = el('button', 'cam-btn', 'Watch');
  watch.type = 'button';
  const tab = el('a', 'cam-btn', '⤢');
  tab.href = player(c); tab.target = '_blank'; tab.rel = 'noopener';
  tab.title = 'Open in its own tab';
  bar.append(watch, tab);
  t.append(screen, bar);

  let wanted = false, turn = 0;
  const start = async () => {
    if (screen.firstChild) return;
    const mine = ++turn;
    await door();
    // hidden, left or started again while the pass was on its way
    if (mine !== turn || screen.firstChild || !t.isConnected || document.hidden) return;
    const f = el('iframe');
    f.src = player(c); f.title = `${c.name} live`; f.allow = 'autoplay; fullscreen';
    screen.append(f); watch.hidden = true;
  };
  const stop = () => { turn++; screen.textContent = ''; watch.hidden = false; };
  watch.onclick = () => { wanted = true; start(); };

  const seen = () => {
    if (!t.isConnected) { document.removeEventListener('visibilitychange', seen); return; }
    if (document.hidden) stop(); else if (wanted) start();
  };
  document.addEventListener('visibilitychange', seen);
  // once in the page: play, unless another camera tile already does (both units on screen)
  requestAnimationFrame(() => {
    if (!t.isConnected || playing()) return;
    wanted = true;
    if (!document.hidden) start();
  });
  return t;
}
