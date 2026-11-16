// The product drawer's label photos block (split from product.js, 16 Nov 2026)
import { rpc, fn, api } from '../api.js';
import { el, toast, busy, input, field, selectBox, confirmDrawer } from '../ui.js';
import { pickFromGallery } from '../gallery.js';
import { PHOTO_KIND, day, errText, shrink, encPath, photoUrl } from './fields.js';

// ── the label photos ──
export function photosBlock(ctx) {
  const { farm, p, took } = ctx;
  const w = el('section', 'lb-sec');
  const head = el('div', 'lb-head');
  head.append(el('div', 'pd-hlabel', `Label photos${ctx.det.photos.length ? ' · ' + ctx.det.photos.length : ''}`), el('span', 'spacer'));
  w.append(head);
  const strip = el('div', 'lb-photos');
  ctx.det.photos.forEach(ph => {
    const fig = el('figure', 'lb-photo');
    const img = el('img'); img.alt = (PHOTO_KIND.find(k => k[0] === ph.kind) || [, ph.kind])[1]; img.loading = 'lazy';
    const a = el('a'); a.target = '_blank'; a.rel = 'noopener'; a.append(img);
    photoUrl(ph).then(u => { if (u) { img.src = u; a.href = u; } });
    const cap = el('figcaption', null, `${img.alt} · ${ph.by || '?'} · ${day(ph.at)}`);
    fig.append(a, cap);
    if (ph.may_remove) {
      const x = el('button', 'btn btn-sm btn-ghost lb-x', '✕'); x.title = 'Remove this photo';
      x.onclick = async () => {
        if (!await confirmDrawer('Remove this photo?', 'It goes from this product for your unit and its sister units. The log keeps a line that it was removed.'
          + (ph.bucket === 'farm-gallery' ? ' The photo stays in the gallery.' : ''), 'Remove', true)) return;
        try {
          const r = await rpc('remove_product_photo', { p_farm: farm.id, p_photo: ph.id });
          // a photo picked from the gallery answers removed_path null: its file stays in the gallery, nothing to delete
          if (r.removed_path) api('/storage/v1/object/product-labels/' + encPath(r.removed_path), { method: 'DELETE' }).catch(() => {});
          took(r);
        } catch (e) { toast(errText(e), 'bad'); }
      };
      fig.append(x);
    }
    strip.append(fig);
  });
  if (!ctx.det.photos.length) strip.append(el('div', 'hint', ctx.det.may_label
    ? 'No photo yet. Add the front and the back of the label — the small print is what the AI reads.'
    : 'No photo of this label yet.'));
  w.append(strip);

  if (ctx.det.may_label) {
    const acts = el('div', 'row lb-acts');
    const kind = selectBox(PHOTO_KIND, ctx.det.photos.some(x => x.kind === 'label') ? 'back' : 'label');
    const pick = input({ type: 'file', accept: 'image/*', multiple: true }); pick.hidden = true;
    const add = el('button', 'btn btn-sm', 'Add label photos');
    add.onclick = () => pick.click();
    // the farm gallery (0.7.286): photos the phones sent, tagged "label" first; the same file is linked, not copied
    const gal = el('button', 'btn btn-sm', 'From the gallery');
    gal.title = 'Choose photos the farm already sent from the phone (Office › Gallery)';
    gal.onclick = async () => {
      const chosen = await pickFromGallery(farm, { tag: 'label', multiple: true });
      if (!chosen.length) return;
      let r = null;
      try {
        for (let i = 0; i < chosen.length; i++) {
          busy(gal, true, `Adding ${i + 1} of ${chosen.length}…`);
          r = await rpc('add_product_photo_from_gallery', { p_farm: farm.id, p_product: p.id, p_photo: chosen[i].id, p_kind: kind.value });
        }
        busy(gal, false); toast(chosen.length === 1 ? 'Photo added' : `${chosen.length} photos added`, 'ok');
      } catch (e) { busy(gal, false); toast(errText(e), 'bad'); }
      if (r) took(r);
    };
    pick.onchange = async () => {
      const files = [...pick.files]; pick.value = '';
      if (!files.length) return;
      let r = null;
      try {
        for (let i = 0; i < files.length; i++) {
          busy(add, true, `Sending ${i + 1} of ${files.length}…`);
          const blob = await shrink(files[i]);
          const path = `${farm.id}/${p.id}/${crypto.randomUUID()}.jpg`;
          await api('/storage/v1/object/product-labels/' + path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
          r = await rpc('add_product_photo', { p_farm: farm.id, p_product: p.id, p_path: path, p_kind: kind.value });
        }
        busy(add, false); toast(files.length === 1 ? 'Photo added' : `${files.length} photos added`, 'ok');
      } catch (e) { busy(add, false); toast(errText(e), 'bad'); }
      if (r) took(r);
    };
    const read = el('button', 'btn btn-sm btn-primary', ctx.det.check ? 'Read the label again' : 'Read the label with AI');
    ctx.readBtn = read;
    read.disabled = !ctx.det.photos.length;
    read.title = ctx.det.photos.length ? 'The AI reads every field from the photos and proposes; nothing is saved until you validate.' : 'Add a photo of the label first.';
    read.onclick = async () => {
      busy(read, true, 'The AI is reading the label… (up to a minute)');
      try {
        const r = await fn('label-check', { farm_id: farm.id, product_id: p.id });
        if (!r?.ok) throw new Error(r?.error || 'the AI gave no answer');
        ctx.changed = true; await ctx.load();
        const n = (r.check.fields || []).filter(f => f.differs).length;
        toast(n ? `${n} field${n === 1 ? '' : 's'} differ from the label — review them below` : 'The label agrees with the catalogue — validate it below', 'ok');
        ctx.mount.querySelector('.lb-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { busy(read, false); toast(errText(e), 'bad'); }
    };
    acts.append(field('Photo of', kind), add, gal, pick, el('span', 'spacer'), read);
    w.append(acts);
  }
  return w;
}
