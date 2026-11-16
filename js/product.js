// ═══════════════════════════════════════════════════════════════════════════
// One product of the catalogue (console 0.7.284, migration 0263, owner 29 Oct 2026: "add the possibility to add label
// pictures on each product … ai check the information and propose modifications or validation for each entries with
// highlighted text in case of modification, user can check each entry and modify manually and validate all
// modifications … the available stock … the possibility to add/modify stock (with his format and volume and qty)";
// then "Farm manager, agronomist, admin and office, create a log … made by ai on dd/mm/yyyy, validated by user on,
// modified by user").
//
//   openProduct(farm, p, label, opts) — the drawer of Scouting › Products:
//     • what the catalogue says (read only)
//     • Label photos: front, back, leaflet, safety data sheet, pack — added by the Admin, Farm manager, Office and
//       Agronomist (product-labels bucket, <farm>/<product>/<uuid>.jpg), seen by everyone; or picked from the farm
//       gallery ("From the gallery", 0.7.286, migration 0265: the same file, signed from its own bucket, farm-gallery;
//       taking it off the product leaves the file in the gallery)
//     • Read the label with AI (edge function label-check) → a review, field by field: Now · Label says (what differs
//       highlighted) · the value to keep, editable · a tick. A changed safety figure (rate, withholding, re-entry,
//       applications, interval) is never ticked for you. Validate saves the ticked ones and marks the product validated
//       against the label
//     • Edit (0.7.287, migration 0266, owner 29 Oct 2026: "before we need to be able to edit/modify each product"): every
//       field a person may change, in sections; Save keeps it as it is checked, Save and validate marks it validated
//       against the label. A label field saved without validating makes a validated product "not validated" again
//     • In the store: what is held, the lots still there (first in, first out) with their expiry, Add stock (packs ×
//       size, the pack, the lot, the expiry) and Correct the count; the Stock page shows the same movements
//     • History: every change, the AI's and the people's, dd/mm/yyyy, with Undo
//     • Side effects on beneficials (0.7.288, migration 0267): for a spray, what it does to each beneficial (safe,
//       moderate, harmful, unknown, how many days, where it was read) — the catalogue's rows and the unit's own, which
//       come first; for a beneficial, the sprays known to touch it. The four roles add the unit's own; the franchisor
//       the catalogue's. The treatment's preview warns from them
//   openChangeLog(farm, onOpen) — the log of the whole catalogue
//   openNewProduct(farm, products, onCreated, onOpenExisting) — a product of our own (0.7.285, migration 0264, owner
//     29 Oct 2026: "add the possibility to add a product manually just adding photos as well"): a name, or none when
//     its label photos follow; with photos the drawer opens and the AI reads them at once, name, supplier and kind
//     included. A name like one already in the list says so first. Seen by this unit and its sister units only.
//     Its photos are chosen on this computer or picked from the gallery (0.7.286)
// The system proposes, a person validates: nothing the AI read is saved until somebody presses Validate.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, drawer, toast, loading, confirmDrawer } from './ui.js';
import { KIND, SPRAY } from './kinds.js';
import { errText } from './product/fields.js';
import { openEditor } from './product/editor.js';
import { factsBlock } from './product/facts.js';
import { photosBlock } from './product/photos.js';
import { reviewBlock } from './product/review.js';
import { stockBlock } from './product/stock.js';
import { effectsBlock } from './product/effects.js';
import { historyBlock } from './product/history.js';

// what the drawer and the log read from the pieces now in js/product/ (16 Nov 2026); the names stay exported from here
export { FIELD, expiryPill } from './product/fields.js';
export { openChangeLog } from './product/log.js';
export { openNewProduct } from './product/new.js';

export function openProduct(farm, p, label, opts = {}) {
  const d = drawer(p.name, `${p.supplier} · ${KIND[p.kind] || p.kind}`, { onClose: () => { if (ctx.changed) opts.onChanged?.(); } });
  d.box.classList.add('tr-drawer');
  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(close);
  const mount = el('div');
  d.body.append(mount);
  mount.append(loading('Reading the product…'));
  // what the blocks in js/product/ share with this drawer: they read ctx.det, and write ctx.changed and ctx.readBtn
  const ctx = { farm, p, opts, d, mount, det: null, changed: !!p._new, readBtn: null, took: null, load: null };   // a product just added is in the list when the drawer closes

  const load = async () => {
    try { ctx.det = await rpc('product_detail', { p_farm: farm.id, p_product: p.id }); paint(); }
    catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', errText(e))); }
  };
  // every write answers with the whole product again
  const took = r => { ctx.det = r; ctx.changed = true; Object.assign(p, r.product); const h = d.box.querySelector('header h2'); if (h) h.textContent = r.product.name;
    const sub = d.box.querySelector('header .hint'); if (sub) sub.textContent = `${r.product.supplier} · ${KIND[r.product.kind] || r.product.kind}`;
    d.box.setAttribute('aria-label', r.product.name); paint(); };
  ctx.took = took; ctx.load = load;
  let autoRead = !!opts.autoRead;

  function paint() {
    const pr = ctx.det.product;
    mount.textContent = '';
    mount.append(factsBlock(ctx, pr, label));
    mount.append(photosBlock(ctx));
    if (ctx.det.check) mount.append(reviewBlock(ctx, ctx.det.check));
    if (!pr.perishable && pr.item_id) mount.append(stockBlock(ctx, pr));
    else if (pr.perishable) mount.append(el('div', 'note', 'A living product: ordered for each application, never stocked.'));
    if (SPRAY.includes(pr.kind) || pr.kind === 'beneficial') mount.append(effectsBlock(ctx, pr));
    mount.append(historyBlock(ctx));
    footer();
    // a new product with its photos: the AI reads them as soon as the drawer is open
    if (autoRead && ctx.readBtn && !ctx.readBtn.disabled && !ctx.det.check) { autoRead = false; ctx.readBtn.click(); }
  }
  function footer() {
    d.footer.textContent = '';
    if (ctx.det.may_label) {
      const ed = el('button', 'btn btn-primary', 'Edit');
      ed.title = 'Change any field of this product, for your unit and its sister units';
      ed.onclick = () => openEditor(ctx);
      d.footer.append(ed);
    }
    if (ctx.det.may_archive) {
      const off = el('button', 'btn btn-ghost', 'Take off the list');
      off.title = 'A product of our own: it leaves the list, its history and stock movements stay.';
      off.onclick = async () => {
        if (!await confirmDrawer('Take this product off the list?', `${ctx.det.product.name} leaves Products for your unit and its sister units. Its history and its stock movements stay.`, 'Take it off', true)) return;
        try { await rpc('archive_own_product', { p_farm: farm.id, p_product: p.id }); ctx.changed = true; toast('Taken off the list', 'ok'); d.close(); }
        catch (e) { toast(errText(e), 'bad'); }
      };
      d.footer.append(off);
    }
    d.footer.append(el('span', 'spacer'), close);
  }


  load();
  return d;
}
