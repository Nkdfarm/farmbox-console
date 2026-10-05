// Cameras (0.7.230, owner 5 Oct 2026: "connect the Reolink Duo 3 to Naked Heart"). The camera stays on the farm's
// own network: go2rtc on the always-on farm PC turns its RTSP into a browser stream, and a Cloudflare Tunnel publishes
// only the player at cam.nkd.farm, behind a Cloudflare Access e-mail login. This console never holds a camera
// password or address, only that public name. Setup: Ugly200 docs/camera/README.md.
//
// Nothing plays until somebody presses Watch: the farm is on 5G, and a stream left open on an office screen would
// spend the upload all day. Open in a tab is there because Safari will not show the Access login inside the card
// while this console lives on github.io and the cameras on nkd.farm; in its own tab the login always works.
import { el } from './ui.js';

const CAM = 'https://cam.nkd.farm';
const CAMERAS = [{ src: 'duo3', name: 'Duo 3', ratio: '32 / 9' }];

const player = c => `${CAM}/stream.html?src=${encodeURIComponent(c.src)}&mode=mse,hls`;

export function camerasCard() {
  const card = el('div', 'card');
  card.style.marginTop = 'var(--space-4)';
  const head = el('div', 'card-pad row');
  head.append(el('div', 'sec-title', 'Cameras'));
  head.append(el('div', 'spacer'));
  head.append(el('span', 'hint', 'Live · sign in with your e-mail the first time'));
  card.append(head);
  CAMERAS.forEach(c => card.append(camera(c)));
  return card;
}

function camera(c) {
  const wrap = el('div', 'card-pad');
  wrap.style.paddingTop = '0';
  const bar = el('div', 'row');
  bar.append(el('b', null, c.name), el('div', 'spacer'));
  const watch = el('button', 'btn btn-sm', 'Watch');
  watch.type = 'button';
  const tab = el('a', 'btn btn-sm', 'Open in a tab');
  tab.href = player(c); tab.target = '_blank'; tab.rel = 'noopener';
  bar.append(watch, tab);

  const screen = el('div');
  Object.assign(screen.style, { position: 'relative', aspectRatio: c.ratio, background: '#000', borderRadius: '8px',
    overflow: 'hidden', marginTop: 'var(--space-2)', display: 'none' });

  watch.onclick = () => {
    if (screen.firstChild) { screen.textContent = ''; screen.style.display = 'none'; watch.textContent = 'Watch'; return; }
    const f = el('iframe');
    f.src = player(c); f.title = `${c.name} live`; f.allow = 'autoplay; fullscreen';
    Object.assign(f.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', border: '0' });
    screen.append(f); screen.style.display = ''; watch.textContent = 'Stop';
  };
  wrap.append(bar, screen);
  return wrap;
}
