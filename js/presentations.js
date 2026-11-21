// ═══════════════════════════════════════════════════════════════════════════
// Roadmap › Presentations — the decks made in Claude Slides, for the franchisor (migration 0294)
//
// A list of decks (a thumbnail of the first slide, the title, the slide count); a click plays one full screen with
// its click steps (slideplayer.js). The decks live in the database and their pictures in the private bucket
// "presentations", read through signed addresses that last an hour: nothing of a deck is in the console's files,
// which are public. They are not kept on this computer either (the reads are not in api.js READ_RPCS), so the tab
// needs a connection. Decks are edited in Claude Slides and brought here by scripts/import-deck.py.
// ═══════════════════════════════════════════════════════════════════════════
import { api, rpc, URL_BASE } from './api.js';
import { el, loading, pageHead, emptyState, toast, isFranchisor } from './ui.js';
import { cleanSlide, slideBox, loadFaces, playDeck } from './slideplayer.js';

const BUCKET = 'presentations';
const blobsIn = html => [...String(html || '').matchAll(/\/_blob\/([0-9a-f]{32}\.(?:png|jpe?g|webp|gif))/g)].map(m => m[1]);

// signed addresses for <deck>/<file>, in one request; a picture that cannot be signed is left out of the slide
async function signed(pairs) {
  const paths = [...new Set(pairs.map(([d, f]) => `${d}/${f}`))];
  const out = new Map();
  if (!paths.length) return out;
  const res = await api('/storage/v1/object/sign/' + BUCKET, { method: 'POST', body: JSON.stringify({ expiresIn: 3600, paths }), quiet: true });
  (res || []).forEach(x => { if (x?.signedURL && x.path) out.set(x.path, URL_BASE + '/storage/v1' + x.signedURL); });
  return out;
}

export async function renderPresentations(container) {
  container.textContent = '';
  if (!isFranchisor()) { container.append(el('div', 'note', 'The presentations are for the franchisor.')); return; }
  container.append(loading('Reading the presentations…'));
  let decks, urls;
  try {
    decks = await rpc('presentation_decks', {}, { quiet: true });
    urls = await signed((decks || []).flatMap(d => blobsIn(d.first).map(f => [d.id, f]))).catch(() => new Map());
  } catch (e) {
    if (!container.isConnected) return;
    container.textContent = '';
    container.append(el('div', 'note bad', e.message));
    return;
  }
  if (!container.isConnected) return;
  const root = el('div', 'rm-page');
  root.append(pageHead(null, 'Decks made in Claude Slides. Click one to present it full screen: → or a click for the next step, ← back, N for the notes, Esc to close.'));
  if (!decks?.length) { root.append(emptyState('No presentation yet. They are brought in from Claude Slides with scripts/import-deck.py.')); container.replaceChildren(root); return; }
  const list = el('div', 'pz-list');
  for (const d of decks) {
    loadFaces(d.faces);
    const row = el('button', 'pz-row');
    row.type = 'button';
    row.setAttribute('aria-label', `Present ${d.title}, ${d.slides} slide${d.slides === 1 ? '' : 's'}`);
    const thumb = el('div', 'pz-thumb');
    try { thumb.append(slideBox(d, cleanSlide(d.first || '', f => urls.get(`${d.id}/${f}`)), 240).host); } catch { /* no thumbnail */ }
    const txt = el('div', 'pz-txt');
    txt.append(el('h3', null, d.title), el('span', null, `${d.slides} slide${d.slides === 1 ? '' : 's'}` +
      (d.imported_at ? ` · brought in ${new Date(d.imported_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })}` : '')));
    row.append(thumb, txt, el('span', 'pz-go', 'Present ▸'));
    row.onclick = () => present(d.id, row);
    list.append(row);
  }
  root.append(list);
  container.replaceChildren(root);
}

async function present(id, row) {
  row.disabled = true;
  try {
    const deck = await rpc('presentation_deck', { p_id: id }, { quiet: true });
    const urls = await signed((deck.slides || []).flatMap(s => blobsIn(s.html).map(f => [deck.id, f])));
    playDeck(deck, f => urls.get(`${deck.id}/${f}`), row);   // Esc brings the focus back to the row
  } catch (e) {
    toast(`The presentation did not open: ${e?.message || 'check your connection'}`, 'bad');
  } finally { row.disabled = false; }
}
