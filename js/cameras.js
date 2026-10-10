// Cameras (0.7.230, owner 5 Oct 2026: "connect the Reolink Duo 3 to Naked Heart"). The camera stays on the farm's
// own network: go2rtc on the always-on farm PC turns its RTSP into a browser stream, and a Cloudflare Tunnel publishes
// only the player at cam.nkd.farm, behind a Cloudflare Access e-mail login. This console never holds a camera
// password or address, only that public name. Setup: Ugly200 docs/camera/README.md.
//
// A tile two wide in the dashboard's grid, playing as soon as the overview opens (0.7.231, owner: "put it here,
// already open, at the top" — the gap the second row of tiles leaves). The farm is on 5G, so the stream is dropped
// whenever the tab is hidden and picked up again when it is seen; leaving the overview drops it too. With both
// units on screen only the first tile plays, the other waits for Watch. ⤢ opens the player in its own tab:
// (left, by the name: the player's own MSE/HLS label sits top right.) Safari will not show the Access login inside the console while it lives on github.io and the cameras on nkd.farm.
import { el } from './ui.js';

const CAM = 'https://cam.nkd.farm';
// unit: the FarmBox the camera looks at (its code, the pill on the overview); only that unit's overview shows it
const CAMERAS = [{ src: 'duo3', name: 'Duo 3', unit: 'FL' }];   // FarmLab (owner, 5 Oct 2026)

const player = c => `${CAM}/stream.html?src=${encodeURIComponent(c.src)}&mode=mse,hls`;
const playing = () => document.querySelector('.cam-tile iframe');

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
  tab.title = 'Open in its own tab (sign in there the first time)';
  bar.append(watch, tab);
  t.append(screen, bar);

  let wanted = false;
  const start = () => {
    if (screen.firstChild) return;
    const f = el('iframe');
    f.src = player(c); f.title = `${c.name} live`; f.allow = 'autoplay; fullscreen';
    screen.append(f); watch.hidden = true;
  };
  const stop = () => { screen.textContent = ''; watch.hidden = false; };
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
