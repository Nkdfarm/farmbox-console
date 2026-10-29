// ═══════════════════════════════════════════════════════════════════════════
// The farm gallery (console 0.7.286, migration 0265, owner 29 Oct 2026: "a tab in naked brain as farm gallery, where we
// can store and easily pickup photo from naked heart, just generic farm gallery")
//
// A shared inbox of photos: somebody on the floor, in the store or in a tunnel takes a photo on the phone (Naked Brain ›
// Gallery); the person at the desk finds it here and uses it where a photo belongs — a product's label first.
//
//   renderGallery(container, farm) — Office › Gallery: a grid by day (the farm's day), thumbnails signed in one request,
//     filters: tag · person · from/to · unused · to tidy (90 days unused) · archived; "More" pages with `before`.
//     A click opens the photo full size: tag and note editable, Archive, Delete (never while it is used), where it is
//     used, who took it and when. The farm and its sister units are seen together
//   pickFromGallery(farm, { tag, multiple }) — one drawer to choose from the same grid, the tag pre-set (and changeable);
//     resolves with the chosen photo objects, [] when cancelled. Picking links the same file, it copies nothing: the
//     caller then asks the database to use it (Products: add_product_photo_from_gallery)
// Bucket farm-gallery (private), <farm>/<yyyy-mm>/<uuid>.jpg and its thumbnail <uuid>-t.jpg. A database before 0265 answers
// 404 (PGRST202): "The gallery is not available yet", not an error.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, api, URL_BASE } from './api.js';
import { el, toast, busy, drawer, confirmDrawer, field, input, selectBox, loading, pageHead, farmToday, parseYmd, addDays, ymd, FARM_TZ } from './ui.js';

const BUCKET = 'farm-gallery';
const TAGS = [['label', 'Label'], ['equipment', 'Equipment'], ['pest', 'Pest'], ['delivery', 'Delivery'], ['receipt', 'Receipt'], ['crop', 'Crop'], ['other', 'Other']];
const tagName = t => (TAGS.find(x => x[0] === t) || [, t || 'Untagged'])[1];
const VIEWS = [['all', 'All'], ['unused', 'Unused'], ['tidy', 'To tidy'], ['archived', 'Archived']];
const PAGE = 30;

const errText = e => String(e?.message || e).replace(/^\d+ /, '');
// the database before 0265 has none of these functions
const gone = e => e?.status === 404 || e?.body?.code === 'PGRST202' || /PGRST202|could not find the function/i.test(String(e?.message || ''));
const tzOf = farm => farm?.timezone || FARM_TZ;
const dayOf = (ts, z) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts)); } catch { return String(ts).slice(0, 10); } };
const clock = (ts, z) => ts ? new Date(ts).toLocaleTimeString('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit' }) : '';
const stamp = (ts, z) => ts ? new Date(ts).toLocaleString('en-GB', { timeZone: z, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const bigDay = (k, z) => {
  const today = farmToday(z), yest = ymd(addDays(parseYmd(today), -1));
  const long = parseYmd(k).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return k === today ? 'Today · ' + long : k === yest ? 'Yesterday · ' + long : long;
};
const size = n => n == null ? null : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const encPath = path => path.split('/').map(encodeURIComponent).join('/');

// one request signs every file of the list for an hour (as Unfiled photos does, for the evidence bucket)
async function signAll(paths) {
  const out = new Map();
  if (!paths.length) return out;
  try {
    const res = await api('/storage/v1/object/sign/' + BUCKET, { method: 'POST', body: JSON.stringify({ expiresIn: 3600, paths }), quiet: true });
    (res || []).forEach(x => { if (x?.signedURL && x.path) out.set(x.path, URL_BASE + '/storage/v1' + x.signedURL); });
  } catch { /* the cells say nothing: the photo is not lost */ }
  return out;
}

const unavailable = () => el('div', 'empty', 'The gallery is not available yet');

// ── the grid: the page and the picker draw the same one ──
// o = { tag, pick, multiple, selected (Map id → photo), onSelect(), onOpen(photo) }
function makeGrid(farm, o = {}) {
  const z = tzOf(farm);
  const f = { tag: o.tag || '', person: '', from: '', to: '', view: 'all' };
  const urls = new Map();            // path → signed address, kept while the grid lives
  const cells = new Map();           // photo id → its button (the picker marks the chosen ones)
  let photos = [], hasMore = false, tidyN = 0, seq = 0;

  const root = el('div', 'fg');
  const bar = el('div', 'tr-filters');
  const tagSel = selectBox([['', 'Any tag'], ...TAGS, ...(f.tag && !TAGS.some(t => t[0] === f.tag) ? [[f.tag, f.tag]] : [])], f.tag);
  const personSel = selectBox([['', 'Anybody']], '');
  const from = input({ type: 'date' }), to = input({ type: 'date' });
  [['Tag', tagSel], ['Taken by', personSel], ['From', from], ['To', to]].forEach(([l, n]) => {
    const w = el('label', 'tr-filter'); w.append(el('span', 'hint', l), n); bar.append(w);
  });
  const chips = el('div', 'chips fg-views');
  const views = VIEWS.filter(([v]) => !o.pick || v === 'all' || v === 'unused');
  const paintChips = () => {
    chips.textContent = '';
    views.forEach(([v, label]) => {
      const b = el('button', 'chip' + (f.view === v ? ' on' : ''), v === 'tidy' && tidyN ? `${label} (${tidyN})` : label);
      b.type = 'button'; b.setAttribute('aria-pressed', String(f.view === v));
      if (v === 'unused') b.title = 'Photos no product (or anything else) uses yet';
      if (v === 'tidy') b.title = 'Unused for more than 90 days: look at them, then archive or delete';
      b.onclick = () => { if (f.view === v) return; f.view = v; paintChips(); load(); };
      chips.append(b);
    });
  };
  paintChips();

  const list = el('div');
  const moreBtn = el('button', 'btn', 'More'); moreBtn.hidden = true;
  moreBtn.onclick = () => load(true);
  const foot = el('div', 'row fg-more'); foot.append(moreBtn);
  root.append(bar, chips, list, foot);

  const args = more => {
    const p = { limit: PAGE };
    if (f.tag) p.tag = f.tag;
    if (f.person) p.person = f.person;
    if (f.from) p.from = f.from;
    if (f.to) p.to = f.to;
    if (f.view === 'unused') p.unused = true;
    if (f.view === 'tidy') p.tidy = true;
    if (f.view === 'archived') p.archived = true;
    if (more && photos.length) p.before = photos[photos.length - 1].created_at;
    return p;
  };

  async function load(more = false) {
    const mine = ++seq;
    if (!more) { busy(moreBtn, false); photos = []; hasMore = false; moreBtn.hidden = true; list.textContent = ''; list.append(loading('Reading the gallery…')); }
    else busy(moreBtn, true, 'Reading…');
    let r;
    try { r = await rpc('farm_photos', { p_farm: farm.id, p: args(more) }); }
    catch (e) {
      if (mine !== seq) return;
      if (more) { busy(moreBtn, false); toast(errText(e), 'bad'); return; }
      if (gone(e)) { root.textContent = ''; root.append(unavailable()); return; }
      list.textContent = ''; list.append(el('div', 'note bad', errText(e)));
      return;
    }
    if (mine !== seq) return;           // a newer choice of filters is on its way
    if (more) busy(moreBtn, false);
    const seen = new Set(photos.map(p => p.id));
    photos = photos.concat((r.photos || []).filter(p => !seen.has(p.id)));
    hasMore = !!r.more;
    if (!more) {
      tidyN = Number(r.to_tidy) || 0;
      paintChips();
      // who took photos: the answer's list, the person chosen kept even when this choice has none of theirs
      const keep = f.person;
      personSel.textContent = '';
      const people = r.people || [];
      [['', 'Anybody'], ...people.map(x => [x.id, `${x.name} (${x.n})`]), ...(keep && !people.some(x => x.id === keep) ? [[keep, 'This person']] : [])]
        .forEach(([v, label]) => { const op = el('option', null, label); op.value = v; personSel.append(op); });
      personSel.value = keep;
    }
    render();
  }

  function render() {
    list.textContent = ''; cells.clear();
    moreBtn.hidden = !hasMore;
    if (!photos.length) {
      const any = f.tag || f.person || f.from || f.to || f.view !== 'all';
      list.append(el('div', 'empty', any ? 'No photo for this choice.' : 'No photo in the gallery yet. A photo taken in Naked Brain › Gallery appears here once it is sent.'));
      return;
    }
    const days = new Map();
    // by the day it was sent, as the list pages and the dates filter (taken_at is shown on the photo)
    photos.forEach(p => { const k = dayOf(p.created_at, z); (days.get(k) || days.set(k, []).get(k)).push(p); });
    [...days.keys()].sort().reverse().forEach(k => {
      const sec = el('section', 'fg-day');
      const head = el('div', 'fg-dayhead');
      head.append(el('h3', null, bigDay(k, z)), el('span', 'hint', `${days.get(k).length} photo${days.get(k).length === 1 ? '' : 's'}`));
      const g = el('div', 'fg-grid');
      days.get(k).forEach(p => g.append(cell(p)));
      sec.append(head, g);
      list.append(sec);
    });
    fill();
  }

  function cell(p) {
    const b = el('button', 'fg-cell' + (p.archived_at ? ' fg-off' : '')); b.type = 'button';
    const im = el('img'); im.alt = tagName(p.tag); im.loading = 'lazy'; im.dataset.path = p.thumb_path || p.path;
    const cap = el('span', 'fg-cap');
    cap.append(el('b', null, tagName(p.tag)), ' · ' + [p.by ? String(p.by).split(/\s+/)[0] : null, clock(p.taken_at || p.created_at, z)].filter(Boolean).join(' · '));
    const badges = el('span', 'fg-badges');
    if (p.archived_at) badges.append(el('span', 'pill', 'archived'));
    if ((p.uses || []).length) { const u = el('span', 'pill ok', 'used'); u.title = p.uses.map(x => x.label).join(', '); badges.append(u); }
    b.append(im, badges, cap);
    if (p.farm_id && p.farm_id !== farm.id && p.farm) cap.append(el('span', 'hint', ' · ' + p.farm));
    if (p.note) b.title = p.note;
    if (o.pick) {
      b.setAttribute('aria-pressed', String(o.selected.has(p.id)));
      b.classList.toggle('on', o.selected.has(p.id));
      b.onclick = () => {
        if (o.selected.has(p.id)) o.selected.delete(p.id);
        else { if (!o.multiple) o.selected.clear(); o.selected.set(p.id, p); }
        cells.forEach((c, id) => { c.classList.toggle('on', o.selected.has(id)); c.setAttribute('aria-pressed', String(o.selected.has(id))); });
        o.onSelect?.();
      };
    } else b.onclick = () => o.onOpen?.(p);
    cells.set(p.id, b);
    return b;
  }

  // thumbnails: the ones not signed yet, in one request
  async function fill() {
    const need = [...new Set(photos.map(p => p.thumb_path || p.path))].filter(x => !urls.has(x));
    if (need.length) (await signAll(need)).forEach((u, k) => urls.set(k, u));
    list.querySelectorAll('img[data-path]').forEach(im => { const u = urls.get(im.dataset.path); if (u && !im.getAttribute('src')) im.src = u; });
  }

  tagSel.onchange = () => { f.tag = tagSel.value; load(); };
  personSel.onchange = () => { f.person = personSel.value; load(); };
  from.onchange = () => { f.from = from.value; load(); };
  to.onchange = () => { f.to = to.value; load(); };

  return { root, reload: () => load(), rerender: render };
}

// ── Office › Gallery ──
export async function renderGallery(container, farm) {
  container.textContent = '';
  container.append(pageHead('Gallery', 'The farm\'s photos, sent from the phone (Naked Brain › Gallery): find one here and use it where a photo belongs — a product\'s label first. '
    + 'Unused photos are never deleted by themselves; after 90 days unused they show under "To tidy".'));
  const grid = makeGrid(farm, { onOpen: p => openPhoto(farm, p, { onEdited: grid.rerender, onReload: grid.reload }) });
  container.append(grid.root);
  grid.reload();
}

// ── one photo, full size ──
function openPhoto(farm, ph, cb = {}) {
  const z = tzOf(farm);
  const d = drawer(`${tagName(ph.tag)} photo`, `${stamp(ph.taken_at || ph.created_at, z)}${ph.by ? ' · ' + ph.by : ''}`);
  d.box.classList.add('fg-drawer');
  const close = el('button', 'btn', 'Close'); close.onclick = d.close;

  // the photo itself: the signed address of the full file, a click opens it in a tab of its own
  const full = el('a', 'fg-full'); full.target = '_blank'; full.rel = 'noopener';
  const im = el('img'); im.alt = tagName(ph.tag);
  full.append(im, el('div', 'hint', 'Reading the photo…'));
  signAll([ph.path]).then(m => {
    const u = m.get(ph.path);
    full.querySelector('.hint')?.remove();
    if (u) { im.src = u; full.href = u; full.title = 'Open in a new tab'; }
    else full.append(el('div', 'hint', 'The photo could not be opened.'));
  });
  d.body.append(full);
  if (ph.archived_at) d.body.append(el('div', 'note', `Archived on ${stamp(ph.archived_at, z)}: it is off the list, the file stays.`));
  const inline = el('div');             // an answer of the database that needs reading, in the drawer (a photo still in use)
  d.body.append(inline);

  const facts = el('dl', 'tr-facts');
  const fact = (k, v) => { if (v == null || v === '') return; facts.append(el('dt', null, k), el('dd', null, v)); };
  const paintFacts = () => {
    facts.textContent = '';
    fact('Taken', stamp(ph.taken_at || ph.created_at, z));
    fact('Sent', ph.created_at && ph.taken_at && Math.abs(new Date(ph.created_at) - new Date(ph.taken_at)) > 6e4 ? stamp(ph.created_at, z) : null);
    fact('Taken by', ph.by || null);
    fact('Farm', ph.farm || null);
    fact('Size', [ph.width && ph.height ? `${ph.width} × ${ph.height}` : null, size(ph.bytes)].filter(Boolean).join(' · ') || null);
  };
  paintFacts();
  d.body.append(facts);

  // where it is used
  const used = el('div');
  const paintUses = () => {
    used.textContent = '';
    used.append(el('div', 'pd-hlabel', 'Used in'));
    if (!(ph.uses || []).length) { used.append(el('div', 'hint', 'Nowhere yet. Nothing here is deleted by itself.')); return; }
    const ul = el('ul', 'fg-uses');
    ph.uses.forEach(u => {
      const li = el('li');
      const name = u.label || 'a product';
      if (u.kind === 'product_label' && u.product_id) {
        li.append('Label photo of ');
        const a = el('a', null, name); a.href = '#';
        a.onclick = async e => {
          e.preventDefault();
          try { await openUsedProduct(farm, u.product_id); } catch (err) { toast(errText(err), 'bad'); }
        };
        li.append(a);
      } else li.append(name);
      li.append(el('span', 'hint', ` · ${[u.at ? stamp(u.at, z).slice(0, 10) : null, u.by].filter(Boolean).join(' · ')}`));
      ul.append(li);
    });
    used.append(ul);
  };
  paintUses();
  d.body.append(used);

  // the tag and the note
  let save = null;
  if (ph.may_edit) {
    const tag = selectBox([...TAGS, ...(ph.tag && !TAGS.some(t => t[0] === ph.tag) ? [[ph.tag, ph.tag]] : [])], ph.tag || 'other');
    const note = el('textarea'); note.rows = 3; note.value = ph.note || ''; note.placeholder = 'optional';
    const form = el('div', 'tr-form');
    form.append(field('Tag', tag), field('Note', note));
    d.body.append(el('div', 'pd-hlabel', 'Tag and note'), form);
    save = el('button', 'btn btn-primary', 'Save');
    save.onclick = async () => {
      busy(save, true, 'Saving…');
      try {
        Object.assign(ph, await rpc('edit_farm_photo', { p_farm: farm.id, p_photo: ph.id, p: { tag: tag.value, note: note.value.trim() || null } }));
        busy(save, false); toast('Saved', 'ok'); cb.onEdited?.();
        d.box.querySelector('header h2').textContent = `${tagName(ph.tag)} photo`;
      } catch (e) { busy(save, false); toast(errText(e), 'bad'); }
    };
  } else {
    d.body.append(el('div', 'pd-hlabel', 'Tag and note'), el('div', null, [tagName(ph.tag), ph.note].filter(Boolean).join(' · ')));
    d.body.append(el('div', 'hint', 'The person who took it, the Admin, the Farm manager, the Office and the Agronomist change a tag or a note.'));
  }

  if (ph.may_delete) {
    const del = el('button', 'btn btn-danger', 'Delete…');
    del.title = 'Deletes the photo and its file for good; refused while a product uses it';
    del.onclick = async () => {
      inline.textContent = '';
      if (!await confirmDrawer('Delete this photo?', 'The photo and its file are deleted for good. This cannot be undone. A photo that is used somewhere is refused.', 'Delete', true)) return;
      busy(del, true, 'Deleting…');
      try {
        const r = await rpc('delete_farm_photo', { p_farm: farm.id, p_photo: ph.id });
        // the row is gone: the two files follow (a failure leaves a file no row names, harmless but shown nowhere)
        await Promise.all((r?.paths || []).filter(Boolean).map(p => api(`/storage/v1/object/${BUCKET}/${encPath(p)}`, { method: 'DELETE' }).catch(() => {})));
        toast('Photo deleted', 'ok'); d.close(); cb.onReload?.();
      } catch (e) {
        busy(del, false);
        // 23503: used in …, with the words to say where to take it out first
        if (e?.body?.code === '23503' || /^used in/i.test(errText(e))) inline.append(el('div', 'note warn', errText(e)));
        else toast(errText(e), 'bad');
      }
    };
    d.footer.append(del);
  }
  d.footer.append(el('span', 'spacer'));
  if (ph.may_edit) {
    const arc = el('button', 'btn', ph.archived_at ? 'Unarchive' : 'Archive');
    arc.title = ph.archived_at ? 'Back on the list' : 'Off the list, the file stays';
    arc.onclick = async () => {
      busy(arc, true, '…');
      try {
        Object.assign(ph, await rpc('archive_farm_photo', { p_farm: farm.id, p_photo: ph.id, p_archive: !ph.archived_at }));
        toast(ph.archived_at ? 'Archived' : 'Back from the archive', 'ok'); d.close(); cb.onReload?.();
      } catch (e) { busy(arc, false); toast(errText(e), 'bad'); }
    };
    d.footer.append(arc);
  }
  d.footer.append(close);
  if (save) d.footer.append(save);
}

// the product's own drawer (js/product.js), found by its id in the catalogue; loaded when asked, product.js asks this module too
async function openUsedProduct(farm, productId) {
  const [{ openProduct }, lib, cat] = await Promise.all([import('./product.js'), rpc('ipm_library', { p_farm: farm.id }), rpc('pest_catalog', {})]);
  const p = (lib.products || []).find(x => x.id === productId);
  if (!p) throw new Error('That product is no longer on the list');
  openProduct(farm, p, code => (cat || []).find(k => k.code === code)?.label || code, { farmName: farm.name, catalog: cat || [] });
}

// ── choose from the gallery (the one drawer every "From the gallery" button opens) ──
export function pickFromGallery(farm, { tag = '', multiple = false } = {}) {
  return new Promise(resolve => {
    const d = drawer(multiple ? 'Pick photos from the gallery' : 'Pick a photo from the gallery',
      multiple ? 'Click the photos to use, then Use' : 'Click the photo to use, then Use', { onClose: () => resolve([]) });   // Escape or the scrim = none
    d.box.classList.add('fg-drawer');
    const chosen = new Map();
    const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
    const use = el('button', 'btn btn-primary', 'Use'); use.disabled = true;
    const count = el('span', 'hint');
    const onSelect = () => {
      use.disabled = !chosen.size;
      use.textContent = chosen.size > 1 ? `Use ${chosen.size} photos` : 'Use';
      count.textContent = chosen.size ? `${chosen.size} chosen` : '';
    };
    // answer first: closing answers "none" through onClose, and a promise keeps its first answer
    use.onclick = () => { resolve([...chosen.values()]); d.close(); };
    const grid = makeGrid(farm, { tag, pick: true, multiple, selected: chosen, onSelect });
    d.body.append(grid.root);
    d.footer.append(count, el('span', 'spacer'), cancel, use);
    grid.reload();
  });
}
