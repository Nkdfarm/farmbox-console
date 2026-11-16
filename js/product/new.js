// A product of our own: the New product drawer (split from product.js, 16 Nov 2026)
import { rpc, api } from '../api.js';
import { el, drawer, toast, busy, input, field, selectBox } from '../ui.js';
import { pickFromGallery } from '../gallery.js';
import { kindBox, PHOTO_KIND, errText, shrink } from './fields.js';

// ── a product of our own ──
export function openNewProduct(farm, products, onCreated, onOpenExisting) {
  const d = drawer('New product', 'A product of our own: give it a name, or just add the photos of its label — the AI reads them');
  const name = input({ placeholder: 'as on the label (empty: the AI reads it from the photos)' });
  const supplier = input({ placeholder: 'optional' });
  const kind = kindBox('chemical', []);
  const unit = selectBox([['ml', 'ml (a liquid)'], ['g', 'g (a powder, granules)'], ['kg', 'kg (a solid in bulk)'], ['units', 'units (traps, sachets, cards)'], ['individuals', 'individuals (living)']], 'ml');
  const living = input({ type: 'checkbox' });
  const lw = el('label', 'lb-check'); lw.append(living, el('span', null, 'A living product (predators, parasitoids): ordered for each use, never stocked'));
  kind.onchange = () => { if (kind.value === 'beneficial') { living.checked = true; unit.value = 'individuals'; } };
  // a name like one already in the list: open that one instead of adding it twice
  const like = el('div', 'lb-like');
  name.oninput = () => {
    const t = name.value.trim().toLowerCase();
    like.textContent = '';
    if (t.length < 3) return;
    const hits = products.filter(x => x.name.toLowerCase().includes(t) || t.includes(x.name.toLowerCase())).slice(0, 4);
    if (!hits.length) return;
    like.append(el('span', 'hint', 'Already in the list: '));
    hits.forEach((x, i) => {
      const a = el('a', null, `${x.name} (${x.supplier})`); a.href = '#';
      a.onclick = e => { e.preventDefault(); d.close(); onOpenExisting?.(x); };
      if (i) like.append(document.createTextNode(' · '));
      like.append(a);
    });
  };
  const kindPhoto = selectBox(PHOTO_KIND, 'label');
  const pick = input({ type: 'file', accept: 'image/*', multiple: true }); pick.hidden = true;
  const choose = el('button', 'btn btn-sm', 'Choose photos'); choose.onclick = () => pick.click();
  const picked = el('div', 'hint');
  let fromGallery = [];   // the photos picked from the gallery (0.7.286), linked once the product exists
  const paintPicked = () => {
    const n = pick.files.length + fromGallery.length;
    picked.textContent = n ? `${n} photo${n === 1 ? '' : 's'} chosen${fromGallery.length ? ` (${fromGallery.length} from the gallery)` : ''} — the AI reads them once the product is added` : '';
  };
  pick.onchange = paintPicked;
  const gallery = el('button', 'btn btn-sm', 'From the gallery');
  gallery.title = 'Choose photos the farm already sent from the phone (Office › Gallery)';
  gallery.onclick = async () => {
    const chosen = await pickFromGallery(farm, { tag: 'label', multiple: true });
    if (chosen.length) { fromGallery = chosen; paintPicked(); }
  };
  const f = el('div', 'tr-form');
  f.append(field('Name', name), field('Supplier', supplier), field('Kind', kind), field('The store counts it in', unit));
  d.body.append(f, like, lw, el('div', 'pd-hlabel', 'Label photos'), el('div', 'row lb-acts'), picked);
  d.body.lastChild.previousSibling.append(field('First photo is the', kindPhoto), choose, gallery, pick);
  d.body.append(el('div', 'hint', 'It is seen by your unit and its sister units only. Everything else — rate, withholding, re-entry, packs — comes from its label: read by the AI and validated by you, or typed in with Edit.'));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Add the product');
  let made = null;   // the product, once it exists: a retry sends the photos only
  go.onclick = async () => {
    const files = [...pick.files], total = files.length + fromGallery.length;
    if (!name.value.trim() && !total) { toast('Give it a name, or add the photos of its label', 'bad'); name.focus(); return; }
    busy(go, true, 'Adding…');
    try {
      let r = made || await rpc('create_own_product', { p_farm: farm.id, p: { name: name.value, supplier: supplier.value, kind: kind.value,
        unit: unit.value, perishable: living.checked, from_photos: total > 0 } });
      made = r;
      const p = r.product;
      for (let i = 0; i < files.length; i++) {
        busy(go, true, `Sending photo ${i + 1} of ${files.length}…`);
        const path = `${farm.id}/${p.id}/${crypto.randomUUID()}.jpg`;
        await api('/storage/v1/object/product-labels/' + path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: await shrink(files[i]) });
        r = await rpc('add_product_photo', { p_farm: farm.id, p_product: p.id, p_path: path, p_kind: i === 0 ? kindPhoto.value : 'back' });
      }
      // the gallery's photos: the same files, linked (twice for the same product is one row)
      for (let i = 0; i < fromGallery.length; i++) {
        busy(go, true, `Adding gallery photo ${i + 1} of ${fromGallery.length}…`);
        r = await rpc('add_product_photo_from_gallery', { p_farm: farm.id, p_product: p.id, p_photo: fromGallery[i].id, p_kind: !files.length && i === 0 ? kindPhoto.value : 'back' });
      }
      toast(total ? 'Added — the AI is reading its label' : 'Added', 'ok');
      d.close();
      onCreated?.({ ...r.product, _new: true, _autoRead: total > 0 });
    } catch (e) {
      busy(go, false);
      if (!made) { toast(errText(e), 'bad'); return; }
      // the product is there, a photo did not go: open it — its photos can be added from its own window
      toast(`Added, but a photo did not go: ${errText(e)}. Add it from the product.`, 'bad');
      d.close();
      onCreated?.({ ...made.product, _new: true });
    }
  };
  d.footer.append(cancel, go);
}
